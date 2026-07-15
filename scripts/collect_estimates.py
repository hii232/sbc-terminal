"""Collect daily analyst estimate snapshots for the 120-stock universe.

The terminal uses these files only as point-in-time history. If no API key is
available, the script still creates explicit empty histories so the UI can say
"unavailable" instead of inventing revisions from one current estimate.
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
    for c in companies:
        tk = c["ticker"]
        hist = read_history(tk, c["name"])
        snap = collect_for(tk)
        hist = upsert_snapshot(hist, snap)
        write_history(hist)
        if FMP_KEY:
            time.sleep(0.35)
    write_js(companies)
    mode = "collected from FMP" if FMP_KEY else "created empty histories; FMP_API_KEY not set"
    print(f"estimate history: {mode} for {len(companies)} tickers")


if __name__ == "__main__":
    main()
