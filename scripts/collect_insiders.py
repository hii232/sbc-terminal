"""
SBC TERMINAL — insider transactions from SEC Form 4 (EDGAR, keyless)
====================================================================
The only signal in this terminal that comes from the people who actually
run the businesses, spending their own money.

WHAT IS AND IS NOT A SIGNAL (this framing is baked into the output and
the app is required to display it):

  - Transaction code P = OPEN-MARKET PURCHASE. An officer or director
    chose to buy shares with their own cash. This is the signal. The
    academic literature (Lakonishok/Lee, Jeng/Metrick/Zeckhauser and
    successors) finds abnormal returns concentrated in exactly this
    case, strongest when SEVERAL insiders buy in the same window
    ("cluster buying") and when the buyer is a CEO or CFO.
  - Transaction code S = open-market sale. Mostly NOISE. Insiders sell
    for diversification, houses, divorces and taxes. A sale is not the
    mirror image of a buy and this script never treats it as one.
  - Codes A (grant/award), M (option exercise), F (shares withheld for
    taxes), G (gift), C (conversion) are COMPENSATION MECHANICS, not
    decisions. They are parsed, labelled, and excluded from the signal.
  - Rule 10b5-1 plans are pre-scheduled trades entered months earlier.
    A 10b5-1 purchase is not a fresh vote of confidence, so planned
    trades are flagged and kept out of the conviction signal. Detection
    uses both the post-2022 <aff10b5One> checkbox and footnote text.

BUDGET / CACHING: a filed Form 4 never changes, so every parsed
accession is cached permanently (data/insiders_cache.json). Only NEW
accessions cost a fetch, and a global fetch budget bounds the first run
so it cannot blow the daily workflow's time. Whatever the budget does
not reach this run is simply picked up tomorrow — coverage is reported
honestly rather than silently truncated.

Writes data/insiders.json (source of truth) and insiders.js (app bundle).

Usage:  python scripts/collect_insiders.py [--budget N] [--ticker TK ...]
"""
import argparse, json, re, sys, time, urllib.error, urllib.request
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UNIVERSE = ROOT / "data" / "universe.json"
OUT_JSON = ROOT / "data" / "insiders.json"
OUT_JS = ROOT / "insiders.js"
CACHE_FILE = ROOT / "data" / "insiders_cache.json"
UA = {"User-Agent": "SBC-Terminal research hamza@nouman.ca"}

WINDOW_DAYS = 90        # transactions this recent form the live signal
LOOKBACK_DAYS = 120     # filings scanned (a Form 4 is filed up to 2 business days late)
CACHE_KEEP_DAYS = 300   # prune cache entries that can never be in-window again
MAX_FORMS_PER_TICKER = 30
DEFAULT_BUDGET = 2200   # max NEW Form 4 documents fetched per run

# Transaction codes that represent a real, discretionary market decision.
DECISION_CODES = {"P": "buy", "S": "sell"}
# Everything else is compensation plumbing — parsed, labelled, never a signal.
MECHANIC_CODES = {
    "A": "grant/award", "M": "option exercise", "F": "tax withholding",
    "G": "gift", "C": "conversion", "D": "disposition to issuer",
}
SENIOR_RE = re.compile(r"\b(chief exec|ceo\b|chief financial|cfo\b|president|chair)", re.I)


def get(url, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    time.sleep(0.12)  # stay well under SEC's 10 req/sec guidance
    return data if binary else data.decode("utf-8", "replace")


def get_json(url):
    return json.loads(get(url))


def strip_ns(tag):
    return tag.split("}", 1)[-1]


def first_text(node, *names):
    """Value of the first matching descendant. Form 4 wraps most scalars in
    a <value> child; both shapes are handled. Missing stays None."""
    for name in names:
        for el in node.iter():
            if strip_ns(el.tag) != name:
                continue
            val = el.find("value")
            if val is None:
                for c in el:
                    if strip_ns(c.tag) == "value":
                        val = c
                        break
            txt = (val.text if val is not None else el.text) or ""
            txt = txt.strip()
            if txt:
                return txt
    return None


def to_num(txt):
    if txt is None:
        return None
    try:
        v = float(str(txt).replace(",", "").replace("$", "").strip())
    except (TypeError, ValueError):
        return None
    return v if v == v else None  # NaN never survives


def list_form4(sub, since):
    """Form 4 accessions for an issuer, newest first, within the lookback."""
    out = []
    r = (sub.get("filings") or {}).get("recent") or {}
    for form, fdate, accn, doc in zip(r.get("form", []), r.get("filingDate", []),
                                      r.get("accessionNumber", []), r.get("primaryDocument", [])):
        if form != "4" or not fdate or fdate < since:
            continue
        out.append({"accn": accn, "filed": fdate, "doc": doc})
        if len(out) >= MAX_FORMS_PER_TICKER:
            break
    return out


def fetch_form4_xml(cik, accn, doc):
    """The raw ownership XML. submissions' primaryDocument is often the
    XSL-rendered path (xslF345X05/wf-form4_x.xml); the machine-readable
    document is the same basename at the folder root. Falls back to the
    accession's index listing when the name does not resolve."""
    folder = accn.replace("-", "")
    base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{folder}"
    names = []
    if doc:
        leaf = doc.split("/")[-1]
        if leaf.lower().endswith(".xml"):
            names.append(leaf)
    for name in names:
        try:
            return get(f"{base}/{name}", binary=True)
        except urllib.error.HTTPError:
            pass
    idx = get_json(f"{base}/index.json")
    items = [i.get("name", "") for i in (idx.get("directory") or {}).get("item", [])]
    xmls = [n for n in items if n.lower().endswith(".xml") and not n.lower().startswith("xsl")]
    if not xmls:
        raise ValueError(f"no ownership xml in {accn}")
    return get(f"{base}/{xmls[0]}", binary=True)


def parse_form4(raw, accn, filed):
    """One Form 4 -> {owner, role, senior, planned, txns:[...]}.
    Never invents a number: an unparseable amount stays None and the
    transaction is still recorded with what IS known."""
    root = ET.fromstring(raw)

    # WHOSE stock is this? A company's EDGAR feed carries Form 4s where it is
    # the ISSUER *and* Form 4s where the company itself is the REPORTING OWNER
    # of somebody else's stock (corporate stakes in other issuers). Only the
    # former says anything about this ticker, so the issuer CIK is verified by
    # the caller — without this, "Uber Technologies Inc bought 800,000 shares"
    # lands on UBER's own page when it was a purchase of another company.
    issuer_cik = None
    for node in root.iter():
        if strip_ns(node.tag) == "issuer":
            txt = first_text(node, "issuerCik")
            if txt:
                try:
                    issuer_cik = int(str(txt).strip())
                except ValueError:
                    issuer_cik = None
            break

    owners, roles, senior = [], [], False
    for node in root.iter():
        if strip_ns(node.tag) != "reportingOwner":
            continue
        name = first_text(node, "rptOwnerName")
        if name:
            owners.append(" ".join(w.capitalize() for w in name.replace(",", " ").split()))
        title = first_text(node, "officerTitle") or ""
        is_dir = (first_text(node, "isDirector") or "0") in ("1", "true", "TRUE")
        is_off = (first_text(node, "isOfficer") or "0") in ("1", "true", "TRUE")
        is_ten = (first_text(node, "isTenPercentOwner") or "0") in ("1", "true", "TRUE")
        if title:
            roles.append(title.strip())
            if SENIOR_RE.search(title):
                senior = True
        elif is_dir:
            roles.append("Director")
        elif is_ten:
            roles.append("10% owner")
        elif is_off:
            roles.append("Officer")

    # Rule 10b5-1: post-2022 checkbox anywhere in the document, or a
    # footnote saying so. Either one means "pre-scheduled, not a fresh call".
    planned = False
    for el in root.iter():
        if strip_ns(el.tag) == "aff10b5One" and (el.text or "").strip().lower() in ("1", "true"):
            planned = True
    if not planned:
        for el in root.iter():
            if strip_ns(el.tag) == "footnote" and re.search(r"10b5-?1", (el.text or ""), re.I):
                planned = True
                break

    txns = []
    for node in root.iter():
        tag = strip_ns(node.tag)
        if tag not in ("nonDerivativeTransaction", "derivativeTransaction"):
            continue
        code = (first_text(node, "transactionCode") or "").strip().upper()
        if not code:
            continue
        shares = to_num(first_text(node, "transactionShares"))
        price = to_num(first_text(node, "transactionPricePerShare"))
        tdate = first_text(node, "transactionDate")
        ad = (first_text(node, "transactionAcquiredDisposedCode") or "").strip().upper()
        txns.append({
            "code": code,
            "security": (first_text(node, "securityTitle") or "").strip()[:60],
            "kind": DECISION_CODES.get(code) or MECHANIC_CODES.get(code) or "other",
            "decision": code in DECISION_CODES,
            "derivative": tag.startswith("derivative"),
            "date": tdate,
            "shares": shares,
            "price": price,
            "value": round(shares * price) if (shares is not None and price) else None,
            "acquired": ad == "A",
            "held": to_num(first_text(node, "sharesOwnedFollowingTransaction")),
        })
    return {
        "accn": accn, "filed": filed, "issuerCik": issuer_cik,
        "owner": " & ".join(dict.fromkeys(owners)) or "undisclosed",
        "role": "; ".join(dict.fromkeys(roles)) or "insider",
        "senior": senior, "planned": planned, "txns": txns,
    }


def summarize(ticker, filings, window_start):
    """Roll parsed filings into the per-ticker record the app consumes.
    Only real, unplanned, non-derivative open-market decisions inside the
    window count toward the signal; everything else is reported as context."""
    buys, sells, mechanics = [], [], 0
    for f in filings:
        for t in f["txns"]:
            tdate = t.get("date") or f["filed"]
            if not tdate or tdate < window_start:
                continue
            if not t["decision"]:
                mechanics += 1
                continue
            row = {
                "date": tdate, "owner": f["owner"], "role": f["role"],
                "senior": f["senior"], "planned": f["planned"],
                "shares": t["shares"], "price": t["price"], "value": t["value"],
                "security": t.get("security") or "",
                "derivative": t["derivative"], "accn": f["accn"], "filed": f["filed"],
            }
            (buys if t["code"] == "P" else sells).append(row)
    buys.sort(key=lambda r: r["date"], reverse=True)
    sells.sort(key=lambda r: r["date"], reverse=True)
    # the conviction set: open-market, own-money, not pre-scheduled, real stock
    real = [b for b in buys if not b["planned"] and not b["derivative"]]
    buyers = sorted({b["owner"] for b in real})
    val = [b["value"] for b in real if b["value"]]
    return {
        "ticker": ticker,
        "buys": buys[:20], "sells": sells[:20],
        "buyers": buyers,
        "buyerCount": len(buyers),
        "seniorBuyer": any(b["senior"] for b in real),
        "buyValue": sum(val) if val else None,
        "sellValue": sum(s["value"] for s in sells if s["value"]) or None,
        "mechanics": mechanics,
        "filings": len(filings),
        "lastBuy": real[0]["date"] if real else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=int, default=DEFAULT_BUDGET,
                    help="max NEW Form 4 documents to fetch this run")
    ap.add_argument("--ticker", action="append", default=None, help="limit to these tickers")
    args = ap.parse_args()

    uni = json.loads(UNIVERSE.read_text())
    companies = uni["companies"]
    if args.ticker:
        want = {t.upper() for t in args.ticker}
        companies = [c for c in companies if c["ticker"] in want]

    cache = {}
    if CACHE_FILE.exists():
        try:
            cache = json.loads(CACHE_FILE.read_text())
        except Exception:
            cache = {}

    today = date.today()
    window_start = (today - timedelta(days=WINDOW_DAYS)).isoformat()
    since = (today - timedelta(days=LOOKBACK_DAYS)).isoformat()

    tickers, scanned, budget_hit, failed, foreign = {}, 0, False, 0, 0
    spent = 0
    for c in companies:
        tk, cik = c["ticker"], c["cik"]
        try:
            sub = get_json(f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json")
            forms = list_form4(sub, since)
        except Exception as e:
            failed += 1
            print(f"  [{tk}] submissions failed: {e}", file=sys.stderr)
            continue

        parsed = []
        complete = True
        for f in forms:
            hit = cache.get(f["accn"])
            # Records cached before issuer verification existed cannot be
            # trusted (they may describe another company's stock), so they are
            # re-fetched once. The None sentinel still means "unparseable".
            if isinstance(hit, dict) and "issuerCik" not in hit:
                hit = None
                cache.pop(f["accn"], None)
            elif hit is not None:
                if hit:  # falsy sentinel = permanently unparseable, don't retry
                    parsed.append(hit)
                continue
            if spent >= args.budget:
                budget_hit = True
                complete = False
                break
            try:
                rec = parse_form4(fetch_form4_xml(cik, f["accn"], f["doc"]), f["accn"], f["filed"])
                cache[f["accn"]] = rec
                parsed.append(rec)
            except Exception as e:
                cache[f["accn"]] = None  # malformed filing: remember, never retry
                print(f"  [{tk}] {f['accn']} parse failed: {e}", file=sys.stderr)
            spent += 1

        # keep ONLY filings where this company is the issuer — a filing where
        # the company is the reporting owner is about somebody else's stock
        own = [r for r in parsed if r.get("issuerCik") in (None, int(cik))]
        foreign += len(parsed) - len(own)
        if complete:
            scanned += 1
        rec = summarize(tk, own, window_start)
        rec["complete"] = complete
        if rec["buys"] or rec["sells"] or rec["filings"]:
            tickers[tk] = rec

    # prune cache entries too old to ever matter again
    keep_before = (today - timedelta(days=CACHE_KEEP_DAYS)).isoformat()
    cache = {k: v for k, v in cache.items()
             if v is None or (v.get("filed") or "9999") >= keep_before}
    CACHE_FILE.write_text(json.dumps(cache) + "\n")

    out = {
        "asOf": today.isoformat(),
        "windowDays": WINDOW_DAYS,
        "windowStart": window_start,
        "source": "SEC EDGAR Form 4 (ownership documents)",
        "universe": len(companies),
        "scanned": scanned,
        "partial": budget_hit,
        "otherIssuerFilings": foreign,
        "tickers": tickers,
    }
    OUT_JSON.write_text(json.dumps(out) + "\n")
    OUT_JS.write_text(
        "/* AUTO-GENERATED by scripts/collect_insiders.py — SEC Form 4 insider\n"
        "   transactions. Open-market PURCHASES (code P) are the signal; sales\n"
        "   are mostly noise (diversification/taxes) and are never treated as a\n"
        "   mirror image. Grants, option exercises and tax withholding are\n"
        "   compensation mechanics, not decisions. Rule 10b5-1 trades are\n"
        "   pre-scheduled and flagged out of the conviction signal. */\n"
        "const INSIDERS = " + json.dumps(out) + ";\n")
    print(f"insiders: {len(tickers)} names with activity, {scanned}/{len(companies)} fully scanned, "
          f"{spent} new filings fetched{' (budget reached — rest resumes next run)' if budget_hit else ''}, "
          f"{foreign} filings dropped as other-issuer, {failed} lookup failures")


if __name__ == "__main__":
    main()
