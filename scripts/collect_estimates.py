"""Collect daily analyst estimate snapshots for the official universe (see data/universe.json).

The terminal uses these files only as point-in-time history. FMP is tried
first when FMP_API_KEY is set; any ticker FMP cannot serve (no key, 403 on
the free tier, empty rows) falls back to Yahoo's keyless earningsTrend
fiscal-year consensus — same crumb technique as collect_earnings.py — so the
whole universe accumulates real point-in-time history instead of 177 names
sitting empty forever. Every snapshot records its source; the score engine
only measures revisions between same-source snapshots, so a provider switch
can never masquerade as an estimate revision. If neither provider can serve a
ticker, its history stays explicitly empty so the UI says "unavailable"
instead of inventing revisions from one current estimate.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UNIVERSE = ROOT / "data" / "universe.json"
HISTORY_DIR = ROOT / "data" / "estimates" / "history"
JS_OUT = ROOT / "estimates.js"
TODAY = datetime.now(timezone.utc).date().isoformat()
FMP_KEY = os.environ.get("FMP_API_KEY", "").strip()
YAHOO_SOURCE = "Yahoo Finance earningsTrend fiscal-year consensus"


def load_universe() -> list[dict]:
    with UNIVERSE.open("r", encoding="utf-8") as f:
        j = json.load(f)
    return j["companies"]


def read_history(ticker: str, name: str) -> dict:
    path = HISTORY_DIR / f"{ticker}.json"
    if not path.exists():
        return {
            "ticker": ticker,
            "name": name,
            "source": "not collected yet",
            "snapshots": [],
            "notes": ["No estimate snapshots collected yet."],
        }
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_history(hist: dict) -> None:
    path = HISTORY_DIR / f"{hist['ticker']}.json"
    with path.open("w", encoding="utf-8") as f:
        json.dump(hist, f, indent=2, sort_keys=True)
        f.write("\n")


def fetch_json(url: str) -> object:
    req = urllib.request.Request(url, headers={"User-Agent": "sbc-terminal-estimate-history/1.0"})
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


YAHOO_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def yahoo_get(url: str, opener) -> str:
    req = urllib.request.Request(url, headers=YAHOO_UA)
    with opener.open(req, timeout=30) as r:
        return r.read().decode()


def yahoo_session():
    """Cookie + crumb for keyless quoteSummary (same technique as collect_earnings.py)."""
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
    try:
        yahoo_get("https://fc.yahoo.com", opener)
    except Exception:
        pass  # 404 expected; cookie is set anyway
    crumb = yahoo_get("https://query1.finance.yahoo.com/v1/test/getcrumb", opener).strip()
    return opener, crumb


def yahoo_raw(node) -> float | None:
    """Yahoo wraps numbers as {raw, fmt}; return raw or None. Never 0-coerce."""
    if isinstance(node, dict):
        v = node.get("raw")
        return float(v) if isinstance(v, (int, float)) else None
    return float(node) if isinstance(node, (int, float)) else None


def collect_yahoo(ticker: str, opener, crumb: str) -> dict | None:
    url = (f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
           f"?modules=earningsTrend&crumb={urllib.parse.quote(crumb)}")
    try:
        data = json.loads(yahoo_get(url, opener))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        return {"date": TODAY, "ticker": ticker, "source": YAHOO_SOURCE, "error": str(exc)}
    results = (data.get("quoteSummary") or {}).get("result") or []
    trend = ((results[0].get("earningsTrend") or {}).get("trend") or []) if results else []

    def annual(period: str) -> dict:
        t = next((x for x in trend if x.get("period") == period), None) or {}
        ee = t.get("earningsEstimate") or {}
        rr = t.get("revenueEstimate") or {}
        return {
            "eps": yahoo_raw(ee.get("avg")),
            "revenue": yahoo_raw(rr.get("avg")),
            "analystsEps": yahoo_raw(ee.get("numberOfAnalysts")),
            "analystsRev": yahoo_raw(rr.get("numberOfAnalysts")),
        }

    fy0, fy1 = annual("0y"), annual("+1y")
    if fy0["eps"] is None and fy1["eps"] is None and fy0["revenue"] is None and fy1["revenue"] is None:
        return {"date": TODAY, "ticker": ticker, "source": YAHOO_SOURCE, "error": "no fiscal-year consensus in earningsTrend"}
    return {
        "date": TODAY,
        "ticker": ticker,
        "source": YAHOO_SOURCE,
        "currentYearEps": fy0["eps"],
        "currentYearRevenue": fy0["revenue"],
        "nextYearEps": fy1["eps"],
        "nextYearRevenue": fy1["revenue"],
        "analystCountEps": fy1["analystsEps"] if fy1["analystsEps"] is not None else fy0["analystsEps"],
        "analystCountRevenue": fy1["analystsRev"] if fy1["analystsRev"] is not None else fy0["analystsRev"],
        "revisionBreadth": None,
        "note": "Keyless Yahoo fiscal-year consensus. Missing fields remain null and are not scored as zero.",
    }


def first_num(row: dict, keys: list[str]) -> float | None:
    for key in keys:
        val = row.get(key)
        if val is None or val == "":
            continue
        try:
            return float(val)
        except (TypeError, ValueError):
            continue
    return None


def normalize_snapshot(ticker: str, rows: list[dict]) -> dict | None:
    annual = [r for r in rows if str(r.get("period", "")).lower() in {"annual", "fy", "year"} or str(r.get("date", ""))[:4]]
    if not annual:
        annual = rows
    annual = sorted(annual, key=lambda r: str(r.get("date", "")))
    if not annual:
        return None
    current = annual[0]
    nxt = annual[1] if len(annual) > 1 else {}
    return {
        "date": TODAY,
        "ticker": ticker,
        "source": "Financial Modeling Prep analyst estimates",
        "currentYearEps": first_num(current, ["estimatedEpsAvg", "epsAvg", "epsEstimatedAverage", "eps"]),
        "currentYearRevenue": first_num(current, ["estimatedRevenueAvg", "revenueAvg", "revenueEstimatedAverage", "revenue"]),
        "nextYearEps": first_num(nxt, ["estimatedEpsAvg", "epsAvg", "epsEstimatedAverage", "eps"]),
        "nextYearRevenue": first_num(nxt, ["estimatedRevenueAvg", "revenueAvg", "revenueEstimatedAverage", "revenue"]),
        "analystCountEps": first_num(nxt, ["numberAnalystEstimatedEps", "numberAnalystsEstimatedEps", "analystCount"]),
        "analystCountRevenue": first_num(nxt, ["numberAnalystEstimatedRevenue", "numberAnalystsEstimatedRevenue", "analystCount"]),
        "revisionBreadth": None,
        "note": "Revision breadth is not inferred unless the provider supplies it directly.",
    }


def collect_for(ticker: str) -> dict | None:
    if not FMP_KEY:
        return None
    params = urllib.parse.urlencode({"symbol": ticker, "period": "annual", "apikey": FMP_KEY})
    urls = [
        f"https://financialmodelingprep.com/stable/analyst-estimates?{params}",
        f"https://financialmodelingprep.com/api/v3/analyst-estimates/{ticker}?period=annual&apikey={urllib.parse.quote(FMP_KEY)}",
    ]
    last_err = None
    for url in urls:
        try:
            data = fetch_json(url)
            rows = data if isinstance(data, list) else data.get("data", []) if isinstance(data, dict) else []
            snap = normalize_snapshot(ticker, rows)
            if snap:
                return snap
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            last_err = str(exc)
    return {"date": TODAY, "ticker": ticker, "source": "Financial Modeling Prep analyst estimates", "error": last_err or "no rows returned"}


def upsert_snapshot(hist: dict, snap: dict | None) -> dict:
    if not snap:
        hist.setdefault("snapshots", [])
        hist["source"] = hist.get("source") or "not collected yet"
        return hist
    if snap.get("error"):
        hist["lastError"] = {"date": TODAY, "message": snap["error"]}
        return hist
    snaps = [s for s in hist.get("snapshots", []) if s.get("date") != TODAY]
    snaps.append(snap)
    snaps.sort(key=lambda s: s.get("date", ""))
    hist["snapshots"] = snaps[-420:]
    hist["source"] = snap["source"]
    hist["notes"] = ["Daily point-in-time snapshots. Missing fields remain null and are not scored as zero."]
    hist.pop("lastError", None)
    return hist


def write_js(companies: list[dict]) -> None:
    payload = {}
    for c in companies:
        tk = c["ticker"]
        payload[tk] = read_history(tk, c["name"])
    text = "const ESTIMATE_HISTORY = "
    text += json.dumps(payload, indent=2, sort_keys=True)
    text += ";\nif (typeof window !== \"undefined\") window.ESTIMATE_HISTORY = ESTIMATE_HISTORY;\n"
    JS_OUT.write_text(text, encoding="utf-8")


def main() -> None:
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    companies = load_universe()
    yahoo = None  # crumb session, built once on first fallback
    counts = {"fmp": 0, "yahoo": 0, "empty": 0}
    for c in companies:
        tk = c["ticker"]
        hist = read_history(tk, c["name"])
        snap = collect_for(tk)
        if snap is None or snap.get("error"):
            # FMP couldn't serve this ticker (no key, free-tier 403, empty
            # rows) — fall back to Yahoo's keyless fiscal-year consensus.
            if yahoo is None:
                try:
                    yahoo = yahoo_session()
                except Exception as exc:
                    yahoo = ("unavailable", str(exc))
            if yahoo and yahoo[0] != "unavailable":
                fmp_err = snap.get("error") if snap else None
                snap = collect_yahoo(tk, yahoo[0], yahoo[1])
                if snap.get("error") and fmp_err:
                    snap["error"] = f"FMP: {fmp_err} | Yahoo: {snap['error']}"
                time.sleep(0.25)
        if snap and not snap.get("error"):
            counts["yahoo" if snap.get("source") == YAHOO_SOURCE else "fmp"] += 1
        else:
            counts["empty"] += 1
        hist = upsert_snapshot(hist, snap)
        write_history(hist)
        if FMP_KEY:
            time.sleep(0.35)
    write_js(companies)
    print(f"estimate history: {counts['fmp']} from FMP, {counts['yahoo']} from Yahoo fallback, "
          f"{counts['empty']} unavailable of {len(companies)} tickers")


if __name__ == "__main__":
    main()
