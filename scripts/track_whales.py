"""
SBC TERMINAL — whale tracker (SEC EDGAR, keyless)
=================================================
Tracks the biggest institutional owners straight from the primary source —
for each configured whale (BlackRock, Berkshire Hathaway, Citadel):

  - recent EDGAR filings (10-K/Q, 8-K, 13F-HR, SC 13G/A, ...)
  - the two most recent 13F-HR holdings reports, parsed and DIFFED:
      new positions · exits · biggest adds · biggest trims · top holdings
  - universe overlay: the whale's stake (and quarter-over-quarter change)
    in every official-universe name it holds

Honesty notes baked into the output:
  - 13F data is a QUARTERLY snapshot filed up to 45 days late (the SEC
    deadline, not a data defect) — asOf/filed dates are always shown.
  - Each whale carries a style note the app displays: Berkshire is a
    concentrated ACTIVE book (highest-signal 13F filed); BlackRock is
    overwhelmingly INDEX flows; Citadel is a hedged multi-strategy /
    market-making book where position moves are the weakest signal.

Writes data/whales.json (source of truth) and whales.js (app bundle).
Heavy 13F parsing is cached per accession. Runs in the daily workflow.

Usage:  python scripts/track_whales.py
"""
import json, re, sys, time, urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_JSON = ROOT / "data" / "whales.json"
OUT_JS = ROOT / "whales.js"
UNIVERSE = ROOT / "data" / "universe.json"
UA = {"User-Agent": "SBC-Terminal research hamza@nouman.ca"}

# Per-whale candidate filer CIKs — the script self-selects whichever CIK
# actually files 13F-HR (EDGAR has legacy/subsidiary CIKs; no guessing).
WHALES = [
    {"key": "berkshire", "label": "Berkshire Hathaway", "ciks": [1067983],
     "style": "Warren Buffett's concentrated ACTIVE book — the highest-signal 13F filed. New buys and exits here are deliberate decisions."},
    {"key": "blackrock", "label": "BlackRock", "ciks": [2012383, 1364742, 1086364],  # 2012383 = post-2024 holdco
     "style": "~90% index autopilot — routine moves are index flows, not opinions. Watch the deviations: new positions, exits, outsized trims."},
    {"key": "citadel", "label": "Citadel", "ciks": [1423053],
     "style": "Multi-strategy hedge fund + market maker — the book is full of hedges and inventory, so single-position moves are the WEAKEST signal of the three. Directional reads here need extra skepticism."},
]


def get(url, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    time.sleep(0.15)  # stay well under SEC rate limits
    return data if binary else data.decode("utf-8", "replace")


def get_json(url):
    return json.loads(get(url))


def pick_filer(candidates):
    """Among candidate CIKs, pick the one with the MOST RECENT 13F-HR.
    (Corporate reorganizations move filers to new CIKs — e.g. BlackRock's
    2024 holdco swap — so 'first CIK with any 13F' can be years stale.)"""
    best = None
    for cik in candidates:
        try:
            sub = get_json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")
        except Exception:
            continue
        r = (sub.get("filings") or {}).get("recent") or {}
        dates = [d for f, d in zip(r.get("form", []), r.get("filingDate", [])) if f == "13F-HR"]
        if dates and (best is None or max(dates) > best[2]):
            best = (cik, sub, max(dates))
    if not best:
        raise ValueError("no candidate CIK files 13F-HR")
    return best[0], best[1]


def recent_filings(sub, limit=30):
    r = (sub.get("filings") or {}).get("recent") or {}
    rows = []
    for form, fdate, accn, doc in zip(r.get("form", []), r.get("filingDate", []),
                                      r.get("accessionNumber", []), r.get("primaryDocument", [])):
        rows.append({"form": form, "filed": fdate, "accn": accn, "doc": doc})
        if len(rows) >= limit:
            break
    return rows


def list_13f(sub, n=2):
    r = (sub.get("filings") or {}).get("recent") or {}
    out = []
    for form, fdate, accn, period in zip(r.get("form", []), r.get("filingDate", []),
                                         r.get("accessionNumber", []), r.get("reportDate", [])):
        if form == "13F-HR":
            out.append({"accn": accn, "filed": fdate, "period": period})
        if len(out) >= n:
            break
    return out


def strip_ns(tag):
    return tag.split("}", 1)[-1]


def parse_13f_holdings(cik, accn):
    """Aggregate a 13F-HR info table by CUSIP -> {name, value$, shares}."""
    folder = accn.replace("-", "")
    idx = get_json(f"https://www.sec.gov/Archives/edgar/data/{cik}/{folder}/index.json")
    items = [i["name"] for i in (idx.get("directory") or {}).get("item", [])]
    table = next((n for n in items if "infotable" in n.lower() and n.lower().endswith(".xml")), None)
    if not table:  # some filers name it differently; fall back to largest xml that is not primary_doc
        xmls = [n for n in items if n.lower().endswith(".xml") and "primary_doc" not in n.lower()]
        table = xmls[0] if xmls else None
    if not table:
        raise ValueError(f"no info table xml in {accn}")
    raw = get(f"https://www.sec.gov/Archives/edgar/data/{cik}/{folder}/{table}", binary=True)
    agg = {}
    root = ET.fromstring(raw)
    for node in root.iter():
        if strip_ns(node.tag) != "infoTable":
            continue
        f = {strip_ns(c.tag): c for c in node}
        put_call = f.get("putCall")
        if put_call is not None and (put_call.text or "").strip():
            continue  # options overlays are not share ownership
        cusip = (f.get("cusip").text or "").strip() if f.get("cusip") is not None else ""
        name = (f.get("nameOfIssuer").text or "").strip() if f.get("nameOfIssuer") is not None else ""
        try:
            value = int(float((f.get("value").text or "0").strip()))
        except (AttributeError, ValueError):
            value = 0
        shares = 0
        sh = f.get("shrsOrPrnAmt")
        if sh is not None:
            for c in sh:
                if strip_ns(c.tag) == "sshPrnamt":
                    try:
                        shares = int(float((c.text or "0").strip()))
                    except ValueError:
                        shares = 0
        if not cusip:
            continue
        row = agg.setdefault(cusip, {"name": name, "value": 0, "shares": 0})
        row["value"] += value
        row["shares"] += shares
    return agg


STOP = {"INC", "CORP", "CO", "PLC", "LTD", "THE", "CL", "A", "B", "C", "NEW", "COM",
        "CORPORATION", "COMPANY", "HOLDINGS", "HOLDING", "GROUP", "INCORPORATED", "&"}


def norm_name(s):
    words = re.sub(r"[^A-Z0-9 ]", " ", (s or "").upper()).split()
    return " ".join(w for w in words if w not in STOP)


def universe_matcher():
    uni = json.loads(UNIVERSE.read_text())["companies"]
    exact, first = {}, {}
    for c in uni:
        n = norm_name(c["name"])
        if n:
            exact[n] = c["ticker"]
            w = n.split()[0]
            if len(w) >= 4:
                first.setdefault(w, c["ticker"])
    def match(issuer):
        n = norm_name(issuer)
        if n in exact:
            return exact[n]
        w = n.split()[0] if n else ""
        return first.get(w)
    return match


def diff_holdings(cur, prev):
    match = universe_matcher()
    rows = []
    for cusip, c in cur.items():
        p = prev.get(cusip)
        chg = None
        if p and p["shares"] > 0:
            chg = round((c["shares"] / p["shares"] - 1) * 100, 2)
        rows.append({"cusip": cusip, "name": c["name"], "ticker": match(c["name"]),
                     "value": c["value"], "shares": c["shares"],
                     "prevShares": p["shares"] if p else None,
                     "sharesChgPct": chg, "isNew": p is None})
    exits = [{"cusip": k, "name": p["name"], "ticker": match(p["name"]),
              "prevValue": p["value"], "prevShares": p["shares"]}
             for k, p in prev.items() if k not in cur]
    total = sum(r["value"] for r in rows)
    for r in rows:
        r["pctOfPortfolio"] = round(r["value"] / total * 100, 3) if total else None
    rows.sort(key=lambda r: -r["value"])
    exits.sort(key=lambda r: -(r["prevValue"] or 0))
    top = rows[:25]
    inUniverse = [r for r in rows if r["ticker"]]
    newPos = [r for r in rows if r["isNew"] and (r["ticker"] or r["value"] >= 100e6)][:20]
    adds = sorted([r for r in rows if not r["isNew"] and r["sharesChgPct"] is not None
                   and r["sharesChgPct"] >= 3 and (r["ticker"] or r["value"] >= 300e6)],
                  key=lambda r: -r["sharesChgPct"])[:20]
    trims = sorted([r for r in rows if r["sharesChgPct"] is not None and r["sharesChgPct"] <= -3
                    and (r["ticker"] or r["prevShares"])],
                   key=lambda r: r["sharesChgPct"])[:20]
    return {"totalValue": total, "positions": len(rows), "top": top, "universe": inUniverse,
            "new": newPos, "adds": adds, "trims": trims,
            "exits": [e for e in exits if e["ticker"] or (e["prevValue"] or 0) >= 100e6][:20]}


def track_one(w, prev_whale):
    cik, sub = pick_filer(w["ciks"])
    out = {"key": w["key"], "label": w["label"], "style": w["style"],
           "cik": cik, "name": sub.get("name") or w["label"],
           "filings": recent_filings(sub), "holdings": (prev_whale or {}).get("holdings"),
           "f13": list_13f(sub, 2)}
    f13 = out["f13"]
    if f13 and (not (prev_whale or {}).get("f13") or prev_whale["f13"][0]["accn"] != f13[0]["accn"]
                or not (prev_whale or {}).get("holdings")):
        print(f"  [{w['key']}] parsing 13F {f13[0]['accn']} (period {f13[0]['period']})…")
        cur = parse_13f_holdings(cik, f13[0]["accn"])
        prevH = {}
        if len(f13) > 1:
            print(f"  [{w['key']}] parsing prior 13F {f13[1]['accn']}…")
            prevH = parse_13f_holdings(cik, f13[1]["accn"])
        d = diff_holdings(cur, prevH)
        d["period"] = f13[0]["period"]
        d["filed"] = f13[0]["filed"]
        d["prevPeriod"] = f13[1]["period"] if len(f13) > 1 else None
        out["holdings"] = d
        print(f"  [{w['key']}] {d['positions']} positions, ${d['totalValue']/1e9:,.0f}B, "
              f"{len(d['universe'])} universe matches, {len(d['new'])} new, {len(d['exits'])} exits")
    else:
        print(f"  [{w['key']}] 13F unchanged — refreshed filings list only")
    return out


def main():
    prev_out = {}
    if OUT_JSON.exists():
        try:
            prev_out = json.loads(OUT_JSON.read_text())
        except Exception:
            prev_out = {}
    prev_whales = prev_out.get("whales") or {}
    out = {"asOf": date.today().isoformat(),
           "source": "SEC EDGAR (submissions + 13F-HR info tables)", "whales": {}}
    for w in WHALES:
        try:
            out["whales"][w["key"]] = track_one(w, prev_whales.get(w["key"]))
        except Exception as e:  # one broken whale must not sink the others
            print(f"  [{w['key']}] FAILED: {e}", file=sys.stderr)
            if prev_whales.get(w["key"]):
                out["whales"][w["key"]] = prev_whales[w["key"]]
    if not out["whales"]:
        print("no whale data at all — keeping previous bundle", file=sys.stderr)
        sys.exit(1)
    OUT_JSON.write_text(json.dumps(out) + "\n")
    OUT_JS.write_text(
        "/* AUTO-GENERATED by scripts/track_whales.py — institutional whales via\n"
        "   SEC EDGAR. 13F = quarterly snapshot with a 45-day legal filing lag.\n"
        "   Each whale carries a style note (active vs index vs hedged) that the\n"
        "   app must display. Missing data stays missing. */\n"
        "const WHALES_INTEL = " + json.dumps(out) + ";\n")
    print(f"wrote {OUT_JSON.relative_to(ROOT)} and {OUT_JS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
