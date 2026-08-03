"""MANAGEMENT LANGUAGE COLLECTOR — what executives actually SAY, measured.

Every other layer in this terminal reads what companies REPORT (numbers) or
what the market DOES (prices). This one reads what management SAYS, because
strategy shows up in language a quarter or two before it shows up in the
financials. When six companies independently start saying the same new
thing, that is capital being redirected -- visible before any line item
moves.

SOURCES, in priority order per company:
  1. FMP earnings-call transcript (needs FMP_API_KEY and a plan that
     includes transcripts; the richest source -- prepared remarks + Q&A)
  2. SEC 10-Q Item 2 / 10-K Item 7 Management's Discussion and Analysis --
     thousands of words in which management explains what is driving the
     business, in its own words. Free, primary, public domain, always
     reachable. (An earlier cut used 8-K earnings-release exhibits instead
     and produced garbage: those are ~800 words of tables plus a two-line
     CEO quote, so the only "themes" they yield are words like "earnings"
     and "million". Source quality, not filtering, was the fix.)
A company that yields neither is recorded as missing WITH THE REASON -- a
silent gap quietly biases every convergence count computed afterwards.

HOW THE TEXT BECOMES THEMES:
  A model READS each MD&A and names 3-6 strategic priorities, then a single
  pass canonicalises those themes across the whole corpus so two companies
  pursuing the same strategy produce the same label (convergence counting is
  string equality). Extracted themes are cached per company-period, so
  steady-state cost is about one call per newly filed 10-Q. Without an
  ANTHROPIC_API_KEY the corpus is collected but marked not-narrative-grade
  and the UI stays dark -- an empty board beats a confident wrong one.

WHAT IS STORED — and what deliberately is NOT:
  Only DERIVED THEMES land in data/ and language.js. Raw transcript
  text is held in memory, used to count, and dropped. Transcript text from
  a commercial provider is licensed content that must not be republished in
  a public repo, and full text would bloat the bundle for no analytical
  gain: the engine only ever consumes counts. SEC exhibit text is public
  domain, but is treated identically so one rule covers both sources.

  python scripts/collect_language.py            # default company count
  python scripts/collect_language.py --top 30   # narrower sweep
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "SBC-Terminal research hamza@nouman.ca"}
FMP_KEY = __import__("os").environ.get("FMP_API_KEY", "").strip()

DEFAULT_TOP = 50          # companies, ranked by market cap
PERIODS_PER_COMPANY = 3   # latest + 2 prior; enough for an adoption delta.
                          # 10-Qs are megabytes each, so every extra period is
                          # ~50 large fetches -- 3 keeps the sweep inside a
                          # sane runtime while still giving the engine a past.
TOP_PHRASES = 90          # kept per company-period (bundle size guard)
MAX_NGRAM = 4

# Pure filler. NOTE: this list is deliberately SHORT. The engine suppresses
# boilerplate statistically -- any phrase used by most of the universe is
# dropped as universal language, so "delivering shareholder value" never
# needs to be enumerated here. This list only removes tokens that would
# otherwise pollute n-grams structurally.
STOP = set("""
a an the and or but if then than that this these those of in on at to for from by with as is are was were be been
being am it its we our us you your they their them he she his her i me my have has had do does did doing will would
shall should can could may might must not no nor so such very more most much many few own same once here there
when where why how all any both each other some only just also into over under again further out up down off above
below between through during before after what which who whom whose while about against because until upon within
without across among per via s t re ve ll d m now new also like get got go going come came said say says
first second third fourth one two three four five six seven eight nine ten next last year years quarter quarters
way big top end run key add due ago yet far low set net non pro use used using make made take took give given
""".split())

# Short uppercase acronyms carry real meaning in this domain -- CPU, GPU, AI,
# HBM, ASIC, API. An earlier cut required 1-grams to be 4+ characters and
# silently dropped every one of them, throwing away exactly the kind of
# language shift this collector exists to catch. Two-letter tokens are kept
# only when the source text used them in caps, so "AI" survives without
# admitting every stray two-letter fragment.
ACRO_RE = re.compile(r"\b([A-Z]{2,6})s?\b")


def acronyms_in(text):
    return {m.group(1).lower() for m in ACRO_RE.finditer(text)}

# Structural boilerplate: legal/accounting furniture that appears verbatim in
# every filing and is never a narrative signal.
BOILER_SUBSTR = (
    "forward looking", "forward-looking", "safe harbor", "generally accepted accounting",
    "securities litigation", "private securities", "non gaap", "non-gaap", "gaap financial",
    "risk factors", "annual report", "quarterly report", "press release", "conference call",
    "webcast", "investor relations", "sec filings", "exhibit", "reconciliation of",
    "unaudited", "trademarks", "all rights reserved",
)

# GENERIC BUSINESS VOCABULARY. The rule: drop an n-gram only when EVERY token
# is generic. "cash flow", "financial measures" and "earnings growth" are all
# generic-only and vanish; "inference demand", "cloud capacity" and "GPU
# revenue" each carry at least one substantive token and survive. This is what
# separates a narrative from a filing's furniture, and it degrades gracefully
# -- a term missing from this list is still caught by the statistical
# universal-language test downstream.
GENERIC = set("""
revenue revenues earnings income profit profits loss losses margin margins sales cost costs expense expenses
cash flow flows capital financial finance fiscal gaap operating operations operational company companies business
businesses corporate segment segments results result performance growth increase increased decrease decreased
higher lower change changes compared comparison period periods annual quarterly month months week weeks date dates
million billion thousand percent basis point points dollar dollars usd amount amounts total net gross rate rates
share shares shareholder shareholders stockholder stockholders equity asset assets liability liabilities debt
balance sheet statement statements report reports reported reporting disclosure disclosures management managements
discussion analysis condition conditions factors factor future prior previous current including include includes
included primarily due driven driver drivers reflect reflects reflecting impact impacts related relating respect
approximately additional additionally significant significantly certain various overall continued continue
continues remain remains position positions level levels value values based principally partially offset
million's billions estimate estimates estimated expect expects expected anticipate anticipates believe believes
plan plans planned outlook guidance target targets range ranges strong solid record release releases inc corp
corporation ltd holdings group products product services service customers customer market markets industry
""".split())


def _informative(gram):
    """True when at least one token carries domain meaning."""
    return any(w not in GENERIC for w in gram)


WORD_RE = re.compile(r"[a-z][a-z0-9'\-]*")
SENT_SPLIT = re.compile(r"[.!?;:\n\r]+")
TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


def get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def html_to_text(html):
    """Strip markup to readable prose. Deliberately simple: the phrase counter
    only needs word order, not layout."""
    s = re.sub(r"(?is)<(script|style|table)[^>]*>.*?</\1>", " ", html)
    s = re.sub(r"(?i)<br[^>]*>|</p>|</div>|</tr>", "\n", s)
    s = TAG_RE.sub(" ", s)
    s = (s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&#8217;", "'")
          .replace("&#8220;", '"').replace("&#8221;", '"').replace("&quot;", '"')
          .replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">"))
    return WS_RE.sub(" ", s).strip()


def phrase_counts(text):
    """1..4-grams that could carry meaning. An n-gram may not start or end on a
    stopword (that is what separates 'accelerated computing' from 'of the
    accelerated'), and boilerplate furniture is dropped outright. Counting is
    per sentence so phrases never span a full stop."""
    counts = Counter()
    if not text:
        return counts
    acros = acronyms_in(text)
    for sentence in SENT_SPLIT.split(text.lower()):
        toks = [w for w in WORD_RE.findall(sentence) if len(w) > 1]
        if len(toks) < 2:
            continue
        for n in range(1, MAX_NGRAM + 1):
            for i in range(len(toks) - n + 1):
                gram = toks[i:i + n]
                if gram[0] in STOP or gram[-1] in STOP:
                    continue
                if n == 1:
                    w = gram[0]
                    keep = (len(w) >= 3) or (len(w) == 2 and w in acros)
                    if not keep:
                        continue
                if not _informative(gram):
                    continue
                phrase = " ".join(gram)
                if any(b in phrase for b in BOILER_SUBSTR):
                    continue
                counts[phrase] += 1
    return counts


# ---------------------------------------------------------------- FMP source
def fmp_transcripts(ticker, want):
    """Most recent `want` transcripts. Returns [] on any failure (no key, plan
    without transcript access, rate limit) so the SEC fallback takes over."""
    if not FMP_KEY:
        return []
    key = urllib.parse.quote(FMP_KEY)
    out, seen = [], set()
    endpoints = [
        f"https://financialmodelingprep.com/stable/earning-call-transcript-latest?symbol={ticker}&limit={want}&apikey={key}",
        f"https://financialmodelingprep.com/api/v4/earning_call_transcript?symbol={ticker}&apikey={key}",
        f"https://financialmodelingprep.com/api/v3/earning_call_transcript/{ticker}?apikey={key}",
    ]
    rows = None
    for url in endpoints:
        try:
            data = json.loads(get(url, timeout=30))
        except Exception:
            continue
        if isinstance(data, list) and data and isinstance(data[0], dict):
            rows = data
            break
    if not rows:
        return []
    for r in rows:
        content = r.get("content") or r.get("transcript") or ""
        year, q = r.get("year"), r.get("quarter")
        if not content or year is None or q is None:
            # index-only rows (v4 lists available quarters); fetch the body
            if year is None or q is None:
                continue
            try:
                body = json.loads(get(
                    f"https://financialmodelingprep.com/api/v3/earning_call_transcript/{ticker}"
                    f"?year={year}&quarter={q}&apikey={key}", timeout=30))
                content = (body[0].get("content") if isinstance(body, list) and body else "") or ""
            except Exception:
                continue
        if not content or len(content) < 400:
            continue
        period = f"{year}Q{q}"
        if period in seen:
            continue
        seen.add(period)
        out.append({"period": period, "date": (r.get("date") or "")[:10],
                    "source": "FMP earnings-call transcript", "text": content})
        if len(out) >= want:
            break
        time.sleep(0.2)
    return out


# ---------------------------------------------------------------- SEC source
# WHY MD&A AND NOT THE EARNINGS PRESS RELEASE:
# The first cut of this collector read 8-K Item 2.02 EX-99.1 exhibits. Those
# are ~800 words that are mostly financial TABLES plus legal furniture; the
# only narrative in them is a two-sentence CEO quote. Run over the real
# universe it produced exactly the failure you would predict -- the "themes"
# it surfaced were "earnings", "future", "million", "company's". No amount of
# filtering rescues a source that contains no strategy prose.
# Item 2 of a 10-Q (and Item 7 of a 10-K) is Management's Discussion and
# Analysis: thousands of words in which management explains, in its own
# words, what is driving the business and where it is spending. That is the
# narrative layer this engine needs, and it is free and primary.
MDNA_FORMS = {"10-Q", "10-K", "20-F", "40-F"}
MDNA_START = re.compile(
    r"item\s*[27][.\s:\-]*\s*management.{0,10}s\s+discussion|"
    r"operating\s+and\s+financial\s+review\s+and\s+prospects", re.I)
MDNA_END = re.compile(
    r"item\s*[38][.\s:\-]*\s*(quantitative|financial\s+statements)|"
    r"quantitative\s+and\s+qualitative\s+disclosures", re.I)
MAX_DOC_BYTES = 14_000_000


def extract_mdna(text):
    """Slice Management's Discussion and Analysis out of the filing. Falls back
    to the whole document when the headings do not match a known pattern --
    a filing whose narrative we cannot locate precisely is still far richer
    than a press release, and the phrase filter handles the rest."""
    starts = [m.start() for m in MDNA_START.finditer(text)]
    if not starts:
        return text
    # the LAST match is the section body; earlier ones are the table of contents
    start = starts[-1]
    end_m = MDNA_END.search(text, start + 200)
    section = text[start:end_m.start()] if end_m else text[start:]
    return section if len(section) > 1500 else text


def sec_narrative_filings(cik10, want):
    """MD&A from the most recent periodic filings. Returns (docs, reason) so a
    company that yields nothing says WHY -- silent gaps in a corpus quietly
    bias every convergence count that follows."""
    try:
        sub = json.loads(get(f"https://data.sec.gov/submissions/CIK{cik10}.json"))
    except Exception as e:
        return [], f"submissions fetch failed: {e}"
    rec = sub.get("filings", {}).get("recent", {})
    forms = rec.get("form", [])
    if not forms:
        return [], "no recent filings listed"
    out, tried = [], 0
    for i in range(len(forms)):
        if len(out) >= want or tried >= want + 4:
            break
        if forms[i] not in MDNA_FORMS:
            continue
        tried += 1
        accn = rec["accessionNumber"][i].replace("-", "")
        filed = rec["filingDate"][i]
        doc = rec.get("primaryDocument", [""] * len(forms))[i]
        if not doc:
            continue
        url = f"https://www.sec.gov/Archives/edgar/data/{int(cik10)}/{accn}/{doc}"
        try:
            raw = get(url, timeout=60)
        except Exception:
            time.sleep(0.3)
            continue
        if len(raw) > MAX_DOC_BYTES:
            raw = raw[:MAX_DOC_BYTES]
        text = extract_mdna(html_to_text(raw))
        if len(text) < 2500:
            time.sleep(0.2)
            continue
        end = rec.get("reportDate", [""] * len(forms))[i] or filed
        q = (int(end[5:7]) - 1) // 3 + 1 if len(end) >= 7 else 1
        out.append({"period": f"{end[:4]}Q{q}", "date": filed,
                    "source": f"SEC {forms[i]} MD&A", "text": text})
        time.sleep(0.25)
    if not out:
        return [], f"no usable MD&A in {tried} periodic filing(s)"
    return out, ""


# ---------------------------------------------------- LLM theme extraction
# Phrase-mining raw filing HTML was measured twice against the real universe
# and does not produce business narratives (see the module docstring). What
# does work is having a model READ the MD&A and name the strategy in it.
#
# Two stages, because convergence counting is string equality:
#   1. Per company-period: extract 3-6 strategic themes as short phrases.
#      High volume (one call per new filing), so this runs on Haiku.
#   2. Once per run: canonicalise every theme across the whole corpus into
#      shared labels, so "custom ASIC ramp" and "in-house accelerators"
#      collapse to one theme instead of counting as two companies saying
#      different things. This is the step that makes cross-company
#      convergence measurable at all; it is a single call, so it runs on the
#      stronger model.
#
# Cost control: extracted themes are CACHED per company-period in
# data/language/<TK>.json. A period already extracted is never sent again,
# so steady-state cost is one call per newly-filed 10-Q, not a full re-sweep.
ANTHROPIC_KEY = __import__("os").environ.get("ANTHROPIC_API_KEY", "").strip()
EXTRACT_MODEL = "claude-haiku-4-5"   # high volume, one call per new filing
CANON_MODEL = "claude-opus-5"        # one call per run over the whole corpus
MDNA_CHARS_FOR_LLM = 60_000          # ~15k tokens of MD&A is plenty of strategy

THEME_SCHEMA = {
    "type": "object",
    "properties": {
        "themes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "theme": {"type": "string", "description": "2-5 word lowercase noun phrase naming ONE strategic priority, in standard industry terminology"},
                    "quote": {"type": "string", "description": "short verbatim fragment from the filing that supports it"},
                },
                "required": ["theme", "quote"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["themes"],
    "additionalProperties": False,
}

EXTRACT_SYSTEM = """You read Management's Discussion and Analysis sections from SEC filings and name the STRATEGIC PRIORITIES management describes.

Return 3-6 themes. A theme is something the company is DOING or BETTING ON — where it is directing capital, capacity, or product effort.

Good themes: "custom silicon", "inference capacity buildout", "sovereign ai contracts", "seat-based pricing pressure", "grid interconnect constraints".
Not themes: accounting mechanics, revenue/margin movements, legal boilerplate, generic business words ("growth", "efficiency", "shareholder value"), or anything you could say about any company.

Use standard industry terminology rather than the company's own branded phrasing, so that two companies pursuing the same strategy produce the same words. Lowercase. No company names. If the filing genuinely describes no distinct strategy, return fewer themes rather than padding."""

CANON_SCHEMA = {
    "type": "object",
    "properties": {
        "clusters": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "canonical": {"type": "string", "description": "the clearest 2-4 word label for this theme"},
                    "members": {"type": "array", "items": {"type": "string"}, "description": "every input phrase belonging to this theme, verbatim"},
                },
                "required": ["canonical", "members"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["clusters"],
    "additionalProperties": False,
}

CANON_SYSTEM = """You are given strategic themes extracted from many companies' SEC filings. Different companies describe the same strategy in different words.

Group phrases that describe THE SAME underlying strategy under one canonical label. "custom asic ramp", "in-house accelerators" and "bespoke silicon program" are one theme. "inference capacity" and "training capacity" are DIFFERENT themes — do not over-merge; a merge that blurs two distinct strategies destroys the signal this exists to measure.

Every input phrase must appear in exactly one cluster. A phrase with no partner forms a cluster of one. Return only the clusters."""


def _anthropic_client():
    if not ANTHROPIC_KEY:
        return None
    try:
        import anthropic
    except ImportError:
        print("  anthropic SDK not installed — skipping LLM extraction", flush=True)
        return None
    return anthropic.Anthropic(api_key=ANTHROPIC_KEY)


def extract_themes(client, ticker, text):
    """3-6 strategic themes for one company-period. Returns [] on any failure —
    a company that fails extraction is simply absent from the corpus, which is
    honest; a fabricated theme would not be."""
    try:
        resp = client.messages.create(
            model=EXTRACT_MODEL,
            max_tokens=2000,
            system=EXTRACT_SYSTEM,
            output_config={"format": {"type": "json_schema", "schema": THEME_SCHEMA}},
            messages=[{"role": "user", "content":
                       f"Company: {ticker}\n\nMD&A section:\n\n{text[:MDNA_CHARS_FOR_LLM]}"}],
        )
        if resp.stop_reason == "refusal":
            return []
        body = next((b.text for b in resp.content if b.type == "text"), "")
        rows = json.loads(body).get("themes", [])
    except Exception as e:
        print(f"    {ticker}: theme extraction failed ({e})", flush=True)
        return []
    out = []
    for r in rows:
        t = (r.get("theme") or "").strip().lower()
        if 2 <= len(t.split()) <= 6:
            out.append({"theme": t, "quote": (r.get("quote") or "")[:240]})
    return out


def canonicalise(client, phrases):
    """Map every raw theme to a shared label. Returns {raw: canonical}; an
    empty map on failure means the caller keeps the raw phrases (degraded
    convergence, not wrong convergence)."""
    if not phrases:
        return {}
    # Every input phrase is echoed back inside the clusters, so the OUTPUT is
    # larger than the input. The first run silently blew an 8k ceiling with
    # 660 themes (~8.6k tokens needed), truncating the JSON mid-response and
    # falling back to raw themes -- which quietly collapsed convergence to
    # near zero because raw phrasing rarely matches across companies. Size the
    # ceiling from the corpus, and stream: the SDK refuses large non-streaming
    # requests that risk an HTTP timeout.
    need = int(len("\n".join(phrases)) / 4 * 2.0) + 4000
    budget = max(16000, min(need, 64000))
    print(f"  canonicalising {len(phrases)} themes (max_tokens={budget})", flush=True)
    try:
        with client.messages.stream(
            model=CANON_MODEL,
            max_tokens=budget,
            system=CANON_SYSTEM,
            output_config={"format": {"type": "json_schema", "schema": CANON_SCHEMA}},
            messages=[{"role": "user", "content": "\n".join(sorted(phrases))}],
        ) as stream:
            resp = stream.get_final_message()
        if resp.stop_reason == "refusal":
            print("  canonicalisation refused — keeping raw themes", flush=True)
            return {}
        if resp.stop_reason == "max_tokens":
            print(f"  canonicalisation TRUNCATED at {budget} tokens — keeping raw themes", flush=True)
            return {}
        body = next((b.text for b in resp.content if b.type == "text"), "")
        clusters = json.loads(body).get("clusters", [])
    except Exception as e:
        print(f"  canonicalisation failed ({e}) — keeping raw themes", flush=True)
        return {}
    mapping = {}
    for c in clusters:
        canon = (c.get("canonical") or "").strip().lower()
        if not canon:
            continue
        for m in c.get("members", []):
            mapping[(m or "").strip().lower()] = canon
    return mapping


def market_caps():
    """Rank by market cap straight from the terminal bundle — one source of
    truth, so the language sweep always covers the names the app ranks."""
    src = (ROOT / "data.js").read_text(encoding="utf-8")
    caps = {}
    for m in re.finditer(r'ticker:"([A-Z.\-]+)".{0,400}?mktCap:([\d.]+)', src, re.S):
        caps[m.group(1)] = float(m.group(2))
    return caps


def main():
    top_n = DEFAULT_TOP
    if "--top" in sys.argv:
        top_n = int(sys.argv[sys.argv.index("--top") + 1])

    uni = json.loads((ROOT / "data" / "universe.json").read_text(encoding="utf-8"))
    caps = market_caps()
    companies = sorted(uni["companies"], key=lambda c: -caps.get(c["ticker"], 0))[:top_n]

    outdir = ROOT / "data" / "language"
    outdir.mkdir(parents=True, exist_ok=True)
    client = _anthropic_client()
    if not client:
        print("No ANTHROPIC_API_KEY (or SDK) — corpus will be collected but NOT "
              "narrative-grade, and the Narrative Radar will stay dark.", flush=True)

    bundle, src_counts, missing = {}, Counter(), []
    extracted_calls, reused = 0, 0
    for c in companies:
        tk = c["ticker"]
        # Themes already extracted in a previous run are reused verbatim. This
        # is what keeps steady-state cost at roughly one model call per newly
        # filed 10-Q instead of a full re-sweep of the universe every run.
        cached = {}
        cache_path = outdir / f"{tk}.json"
        if cache_path.exists():
            try:
                for prev in json.loads(cache_path.read_text(encoding="utf-8")).get("periods", []):
                    if prev.get("themes"):
                        cached[prev["period"]] = prev
            except Exception:
                pass

        docs = fmp_transcripts(tk, PERIODS_PER_COMPANY)
        reason = ""
        if not docs:
            docs, reason = sec_narrative_filings(c["cik10"], PERIODS_PER_COMPANY)
        if not docs:
            # A cached company with no fresh fetch still belongs in the corpus.
            if cached:
                periods = sorted(cached.values(), key=lambda p: p["date"], reverse=True)
                bundle[tk] = {"name": c["name"], "sector": c.get("sector"), "periods": periods}
                src_counts[periods[0]["source"]] += 1
                reused += len(periods)
                print(f"  {tk}: {len(periods)} cached period(s), no new filing", flush=True)
                continue
            missing.append({"ticker": tk, "reason": reason or "no source yielded text"})
            print(f"  {tk}: SKIPPED — {reason or 'no source yielded text'}", flush=True)
            time.sleep(0.15)
            continue

        periods = []
        for doc in docs:
            if doc["period"] in cached:
                periods.append(cached[doc["period"]])
                reused += 1
                continue
            themes = extract_themes(client, tk, doc["text"]) if client else []
            if not themes:
                continue
            extracted_calls += 1
            periods.append({
                "period": doc["period"],
                "date": doc["date"],
                "source": doc["source"],
                "words": len(WORD_RE.findall(doc["text"].lower())),
                # DERIVED THEMES ONLY — doc["text"] is dropped here, never stored
                "themes": themes,
            })
        if not periods:
            missing.append({"ticker": tk, "reason": "text found but no themes extracted"})
            continue
        periods.sort(key=lambda p: p["date"], reverse=True)
        src_counts[periods[0]["source"]] += 1
        bundle[tk] = {"name": c["name"], "sector": c.get("sector"), "periods": periods}
        cache_path.write_text(json.dumps(bundle[tk], indent=1), encoding="utf-8")
        print(f"  {tk}: {len(periods)} period(s) via {periods[0]['source']}", flush=True)
        time.sleep(0.15)

    # ---- canonicalise across the WHOLE corpus, then publish -------------
    # Convergence counting is string equality, so this is the step that makes
    # "six companies said the same thing" measurable rather than accidental.
    raw = {t["theme"] for co in bundle.values() for p in co["periods"] for t in p["themes"]}
    mapping = canonicalise(client, raw) if (client and raw) else {}
    for co in bundle.values():
        for p in co["periods"]:
            labels = [mapping.get(t["theme"], t["theme"]) for t in p["themes"]]
            # the engine consumes {phrase: weight}; one mention per theme per
            # period, because breadth across companies is the signal, not
            # how many times one company repeated itself
            p["phrases"] = {lab: 1 for lab in labels}

    graded = bool(client) and bool(mapping or raw)
    meta = {
        "generated": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "companies": len(bundle),
        "requested": len(companies),
        "sources": dict(src_counts),
        "missing": missing,
        "note": "Derived themes only. Raw transcript/filing text is never stored or republished.",
        # HONEST QUALITY FLAG. n-gram mining over raw filing HTML was measured
        # twice against the real universe and does NOT yield business
        # narratives, so it never earns this flag; the Narrative Radar refuses
        # to render without it. Better an empty board than a confident wrong
        # one. Only model-read themes qualify.
        "narrativeGrade": graded,
        "extraction": "llm-themes-from-mdna" if graded else "none",
        "models": {"extract": EXTRACT_MODEL, "canonicalise": CANON_MODEL} if graded else {},
        "themeCalls": extracted_calls,
        "cachedPeriods": reused,
        "canonicalThemes": len(set(mapping.values())) if mapping else None,
    }
    js = ("/* MANAGEMENT LANGUAGE — strategic themes read out of SEC MD&A sections\n"
          "   (and earnings-call transcripts where available) by a model, then\n"
          "   canonicalised across companies so shared strategy is countable.\n"
          "   Generated by scripts/collect_language.py. NO raw filing or transcript\n"
          "   text is stored here — only derived themes. */\n"
          "const LANGUAGE_META = " + json.dumps(meta) + ";\n"
          "const LANGUAGE = " + json.dumps(bundle) + ";\n"
          'if (typeof window !== "undefined") { window.LANGUAGE = LANGUAGE; window.LANGUAGE_META = LANGUAGE_META; }\n')
    (ROOT / "language.js").write_text(js, encoding="utf-8")
    size = (ROOT / "language.js").stat().st_size / 1024
    print(f"\nWROTE language.js — {len(bundle)}/{len(companies)} companies, "
          f"{extracted_calls} new extraction call(s), {reused} cached period(s), "
          f"{meta['canonicalThemes']} canonical themes, narrativeGrade={graded}, {size:.0f} KB", flush=True)


if __name__ == "__main__":
    main()
