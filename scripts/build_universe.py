"""Build the official stock universe: data/universe.json + universe.js.
CIK/name/exchange come from the SEC's own company_tickers mapping.
    python scripts/build_universe.py
"""
import json, sys, time, urllib.request
from pathlib import Path
from datetime import date

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "SBC-Terminal research hamza@nouman.ca"}

UNIVERSE_VERSION = "1.0.0"

GROUPS = [
    ("Large technology and internet platforms",
     ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "AVGO", "ORCL", "NFLX"]),
    ("Semiconductors and AI infrastructure",
     ["AMD", "INTC", "QCOM", "MU", "ARM", "LRCX", "AMAT", "KLAC", "ASML", "MRVL",
      "MPWR", "ANET", "CDNS", "SNPS"]),
    ("Software, cloud and cybersecurity",
     ["CRM", "NOW", "ADBE", "INTU", "PLTR", "CRWD", "PANW", "SNOW", "DDOG", "NET",
      "ZS", "WDAY", "MDB", "SHOP", "APP", "AXON", "IBM", "ACN"]),
    ("Internet, payments and fintech",
     ["UBER", "ABNB", "COIN", "HOOD", "MELI", "V", "MA", "PYPL", "BKNG", "RBLX", "FLUT"]),
    ("New AI and computing companies",
     ["IREN", "CRWV", "NBIS", "SMCI"]),
    ("High-quality comparison companies",
     ["CSCO", "ADP", "SPGI", "ISRG"]),
]
COUNTRY = {"ASML": "NL", "ARM": "GB", "SHOP": "CA", "MELI": "AR/UY (US filer)",
           "FLUT": "IE",
           "IREN": "AU", "NBIS": "NL", "SPGI": "US"}

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode()

print("fetching SEC company_tickers.json…", flush=True)
sec = json.loads(get("https://www.sec.gov/files/company_tickers.json"))
by_ticker = {}
for row in sec.values():
    by_ticker[row["ticker"].upper()] = row

entries, errors = [], []
today = date.today().isoformat()
for group, tks in GROUPS:
    for tk in tks:
        row = by_ticker.get(tk)
        if not row:
            errors.append(f"{tk}: not in SEC ticker map")
            continue
        entries.append({
            "ticker": tk,
            "name": row["title"],
            "cik": int(row["cik_str"]),
            "cik10": str(row["cik_str"]).zfill(10),
            "sector": None,          # filled from data.js below
            "industry": group,
            "country": COUNTRY.get(tk, "US"),
            "reportingCurrency": "USD",
            "exchange": "NASDAQ/NYSE (US listing)",
            "reason": group,
            "universeVersion": UNIVERSE_VERSION,
            "dateAdded": today,
            "status": "active",
        })

# sector from existing data.js
import re
src = (ROOT / "data.js").read_text(encoding="utf-8")
sectors = dict(re.findall(r'ticker:"([A-Z]+)", name:"[^"]*", sector:"([^"]*)"', src))
for e in entries:
    e["sector"] = sectors.get(e["ticker"], "Unknown")

# validation
tks = [e["ticker"] for e in entries]
count = len(tks)
assert count >= 60, f"universe has {count} tickers; expected at least 60: {errors}"
assert len(set(tks)) == count, "duplicate tickers"
assert all(e["cik"] for e in entries), "missing CIK"
assert not errors, errors

(ROOT / "data").mkdir(exist_ok=True)
(ROOT / "data" / "universe.json").write_text(
    json.dumps({"universeVersion": UNIVERSE_VERSION, "asOf": today, "count": count,
                "companies": entries}, indent=1), encoding="utf-8")

js = ("/* OFFICIAL STOCK UNIVERSE — the only file controlling terminal membership.\n"
      "   Regenerate with scripts/build_universe.py (CIKs from SEC company_tickers). */\n"
      f'const UNIVERSE_VERSION = "{UNIVERSE_VERSION}";\n'
      f'const UNIVERSE_ASOF = "{today}";\n'
      "const UNIVERSE_LIST = " + json.dumps(entries) + ";\n"
      'if (typeof window !== "undefined") { window.UNIVERSE_VERSION = UNIVERSE_VERSION; window.UNIVERSE_LIST = UNIVERSE_LIST; window.UNIVERSE_ASOF = UNIVERSE_ASOF; }\n')
(ROOT / "universe.js").write_text(js, encoding="utf-8")
print(f"universe.json + universe.js written: {count} companies, version {UNIVERSE_VERSION}")
for e in entries[:3]:
    print(" ", e["ticker"], e["cik10"], e["name"])
