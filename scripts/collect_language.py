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
  2. SEC 8-K Item 2.02 exhibit EX-99.1 (the quarterly earnings press
     release, which carries management's prepared framing). Free, primary,
     public domain, and always reachable.
A company that yields neither is recorded as missing -- never guessed.

WHAT IS STORED — and what deliberately is NOT:
  Only DERIVED PHRASE COUNTS land in data/ and language.js. Raw transcript
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
PERIODS_PER_COMPANY = 4   # quarters of history -> gives the engine a time axis
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
def sec_earnings_releases(cik10, want):
    """8-K Item 2.02 (Results of Operations) exhibits — management's own
    written framing of the quarter. Public domain and always available."""
    try:
        sub = json.loads(get(f"https://data.sec.gov/submissions/CIK{cik10}.json"))
    except Exception:
        return []
    rec = sub.get("filings", {}).get("recent", {})
    forms = rec.get("form", [])
    out = []
    for i in range(len(forms)):
        if out and len(out) >= want:
            break
        if forms[i] != "8-K":
            continue
        if "2.02" not in (rec.get("items", [""] * len(forms))[i] or ""):
            continue
        accn = rec["accessionNumber"][i].replace("-", "")
        filed = rec["filingDate"][i]
        base = f"https://www.sec.gov/Archives/edgar/data/{int(cik10)}/{accn}"
        try:
            idx = json.loads(get(f"{base}/index.json"))
            items = idx.get("directory", {}).get("item", [])
        except Exception:
            continue
        # EX-99.1 is the earnings release by convention; fall back to any ex99
        docs = [x.get("name", "") for x in items if x.get("name", "").lower().endswith((".htm", ".html", ".txt"))]
        pick = next((n for n in docs if re.search(r"ex.?99[._-]?1", n, re.I)), None) \
            or next((n for n in docs if re.search(r"ex.?99", n, re.I)), None)
        if not pick:
            continue
        try:
            text = html_to_text(get(f"{base}/{pick}"))
        except Exception:
            continue
        if len(text) < 400:
            continue
        q = (int(filed[5:7]) - 1) // 3 + 1
        out.append({"period": f"{filed[:4]}Q{q}", "date": filed,
                    "source": "SEC 8-K EX-99.1 earnings release", "text": text})
        time.sleep(0.2)
    return out


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

    bundle, src_counts, missing = {}, Counter(), []
    for i, c in enumerate(companies):
        tk = c["ticker"]
        docs = fmp_transcripts(tk, PERIODS_PER_COMPANY)
        if not docs:
            docs = sec_earnings_releases(c["cik10"], PERIODS_PER_COMPANY)
        if not docs:
            missing.append(tk)
            print(f"  {tk}: no management text found", flush=True)
            time.sleep(0.15)
            continue

        periods = []
        for doc in docs:
            counts = phrase_counts(doc["text"])
            if not counts:
                continue
            periods.append({
                "period": doc["period"],
                "date": doc["date"],
                "source": doc["source"],
                "words": len(WORD_RE.findall(doc["text"].lower())),
                # DERIVED COUNTS ONLY — doc["text"] is dropped here, never stored
                "phrases": dict(counts.most_common(TOP_PHRASES)),
            })
        if not periods:
            missing.append(tk)
            continue
        periods.sort(key=lambda p: p["date"], reverse=True)
        src_counts[periods[0]["source"]] += 1
        bundle[tk] = {"name": c["name"], "sector": c.get("sector"), "periods": periods}
        (outdir / f"{tk}.json").write_text(json.dumps(bundle[tk], indent=1), encoding="utf-8")
        print(f"  {tk}: {len(periods)} period(s) via {periods[0]['source']}", flush=True)
        time.sleep(0.15)

    meta = {
        "generated": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "companies": len(bundle),
        "requested": len(companies),
        "sources": dict(src_counts),
        "missing": missing,
        "note": "Derived phrase counts only. Raw transcript/exhibit text is never stored or republished.",
    }
    js = ("/* MANAGEMENT LANGUAGE — derived phrase counts from earnings-call transcripts\n"
          "   (FMP) and SEC 8-K EX-99.1 earnings releases. Generated by\n"
          "   scripts/collect_language.py. NO raw transcript text is stored here:\n"
          "   only counts, so nothing licensed is republished and the bundle stays small. */\n"
          "const LANGUAGE_META = " + json.dumps(meta) + ";\n"
          "const LANGUAGE = " + json.dumps(bundle) + ";\n"
          'if (typeof window !== "undefined") { window.LANGUAGE = LANGUAGE; window.LANGUAGE_META = LANGUAGE_META; }\n')
    (ROOT / "language.js").write_text(js, encoding="utf-8")
    size = (ROOT / "language.js").stat().st_size / 1024
    print(f"\nWROTE language.js — {len(bundle)}/{len(companies)} companies, "
          f"{dict(src_counts)}, {size:.0f} KB", flush=True)


if __name__ == "__main__":
    main()
