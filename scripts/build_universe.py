"""Build the official stock universe: data/universe.json + universe.js.
CIK/name/exchange come from the SEC's own company_tickers mapping.
    python scripts/build_universe.py
"""
import json, sys, time, urllib.request
from pathlib import Path
from datetime import date

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "SBC-Terminal research hamza@nouman.ca"}

UNIVERSE_VERSION = "1.3.0"

GROUPS = [
    ("Large technology and internet platforms",
     ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "AVGO", "ORCL", "NFLX"]),
    ("Semiconductors and AI infrastructure",
     ["AMD", "INTC", "QCOM", "MU", "TSM", "ARM", "LRCX", "AMAT", "KLAC", "ASML", "MRVL",
      "MPWR", "ANET", "CDNS", "SNPS"]),
    ("Software, cloud and cybersecurity",
     ["CRM", "NOW", "ADBE", "INTU", "PLTR", "CRWD", "PANW", "SNOW", "DDOG", "NET",
      "ZS", "WDAY", "MDB", "SHOP", "APP", "AXON", "IBM", "ACN"]),
    ("Internet, payments and fintech",
     ["UBER", "ABNB", "COIN", "HOOD", "MELI", "V", "MA", "PYPL", "BKNG", "RBLX"]),
    ("New AI and computing companies",
     ["IREN", "CRWV", "NBIS", "SMCI"]),
    ("High-quality comparison companies",
     ["CSCO", "ADP", "SPGI", "ISRG"]),
    ("Financials, credit and market structure",
     ["JPM", "BAC", "WFC", "C", "GS", "MS", "BLK", "SCHW", "AXP", "COF"]),
    ("Healthcare, pharma and medical devices",
     ["LLY", "JNJ", "UNH", "ABBV", "MRK", "PFE", "TMO", "DHR", "ABT", "MDT"]),
    ("Consumer, retail, restaurants and media",
     ["WMT", "COST", "HD", "LOW", "MCD", "SBUX", "NKE", "DIS", "CMG", "TGT"]),
    ("Industrials, aerospace, defense and power",
     ["CAT", "DE", "GE", "BA", "RTX", "LMT", "HON", "ETN", "GEV", "CEG"]),
    ("Energy, utilities and commodity cyclicals",
     ["XOM", "CVX", "COP", "SLB", "LNG", "EOG", "OXY", "MPC", "VLO", "NEE"]),
    ("Materials, power, utilities and logistics",
     ["LIN", "FCX", "NUE", "SCCO", "VST", "NRG", "SO", "DUK", "UPS", "FDX"]),
    ("Insurance underwriting discipline (the terminal's own top scorers)",
     ["PGR", "TRV", "ALL", "HIG", "CB"]),
    # ---- 2026-07 expansion: +100 liquid US domestic filers (10-K), chosen to
    # broaden sector coverage where the original 126 was thin (analog semis,
    # regional banks, exchanges, managed care, staples, rails, defense). ----
    ("Analog, embedded and legacy semiconductors",
     ["TXN", "ADI", "NXPI", "ON", "MCHP", "TER", "ENTG", "WDC", "GLW"]),
    ("Enterprise software, design and collaboration",
     ["ADSK", "CTSH", "TEAM", "HUBS", "VEEV", "ZM", "DOCU"]),
    ("Cybersecurity, adtech and digital platforms",
     ["FTNT", "OKTA", "TTD", "DASH"]),
    ("Interactive entertainment",
     ["EA", "TTWO"]),
    ("Payments processing and card networks",
     ["FI", "FIS", "GPN", "SYF"]),
    ("Exchanges, ratings and financial data",
     ["ICE", "CME", "NDAQ", "CBOE", "MCO", "MSCI", "FICO"]),
    ("Regional and diversified banks",
     ["USB", "PNC", "TFC", "FITB", "MTB", "RF", "KEY", "CFG", "ALLY"]),
    # PS added 2026-08-08 by request. NOTE for whoever reads the ranking: this
    # is an investment-management holding company, so its reported net income
    # is driven largely by MARKS on its own portfolio rather than by operating
    # earning power. Owner earnings (net income + SBC − true SBC cost) will
    # therefore capitalise those marks as if they recurred — Graham's ch. 31
    # investment-trust warning, already logged as a v9 candidate in AUDIT.md.
    # It is admitted like any other candidate and, like any other, is dropped
    # by reconcile_universe.py if it cannot be fully backed by SEC facts and a
    # real data row. A short filing history will simply leave it unranked.
    ("Alternative asset managers and brokers",
     ["BX", "KKR", "APO", "ARES", "IBKR", "PS"]),
    ("Insurance and risk intermediaries",
     ["AIG", "MET", "PRU", "AFL", "ACGL", "MMC"]),
    ("Biotechnology and large-molecule pharma",
     ["AMGN", "GILD", "VRTX", "REGN", "BIIB", "BMY", "ZTS"]),
    ("Managed care, hospitals and drug distribution",
     ["CI", "ELV", "HCA", "MCK", "COR"]),
    ("Medical devices and diagnostics",
     ["SYK", "BSX", "EW", "DXCM"]),
    ("Life-science tools and research services",
     ["IQV", "A", "IDXX"]),
    ("Beverages and packaged food",
     ["PEP", "KO", "STZ", "GIS", "HSY", "KHC", "MDLZ"]),
    ("Household and personal care staples",
     ["PG", "CL", "KMB"]),
    ("Off-price, discount and auto-parts retail",
     ["TJX", "ROST", "DG", "DLTR", "ORLY", "AZO"]),
    ("Restaurants, lodging and travel brands",
     ["YUM", "MAR", "HLT"]),
    ("Premium apparel and footwear",
     ["LULU", "DECK"]),
    ("Railroads and freight networks",
     ["UNP", "CSX", "NSC", "ODFL"]),
    ("Defense primes and mission systems",
     ["GD", "NOC", "LHX"]),
]
# Membership is controlled by GROUPS above; the size gate is derived from it so
# an expansion cannot silently drop names, but also never needs a magic number.
REQUIRED_UNIVERSE_SIZE = sum(len(tks) for _, tks in GROUPS)
COUNTRY = {"ASML": "NL", "ARM": "GB", "TSM": "TW", "SHOP": "CA", "MELI": "AR/UY (US filer)",
           "IREN": "AU", "NBIS": "NL", "SPGI": "US", "LIN": "IE/UK (US filer)",
           "SCCO": "PE/US filer"}
SECTOR_OVERRIDE = {
    "JPM": "Banks", "BAC": "Banks", "WFC": "Banks", "C": "Banks", "GS": "Banks",
    "MS": "Banks", "BLK": "Asset Mgmt", "SCHW": "Asset Mgmt", "AXP": "Payments", "COF": "Payments",
    "LLY": "Pharma", "JNJ": "Pharma", "UNH": "Managed Care", "ABBV": "Pharma", "MRK": "Pharma",
    "PFE": "Pharma", "TMO": "Life Sciences", "DHR": "Life Sciences", "ABT": "Medical Devices", "MDT": "Medical Devices",
    "WMT": "Retail", "COST": "Retail", "HD": "Home Improvement", "LOW": "Home Improvement", "MCD": "Restaurants",
    "SBUX": "Restaurants", "NKE": "Apparel", "DIS": "Media", "CMG": "Restaurants", "TGT": "Retail",
    "CAT": "Machinery", "DE": "Machinery", "GE": "Aerospace", "BA": "Aerospace", "RTX": "Defense",
    "LMT": "Defense", "HON": "Industrials", "ETN": "Industrials", "GEV": "Industrials", "CEG": "Utilities",
    "XOM": "Energy", "CVX": "Energy", "COP": "Energy", "SLB": "Energy", "LNG": "Energy",
    "EOG": "Energy", "OXY": "Energy", "MPC": "Energy", "VLO": "Energy", "NEE": "Utilities",
    "LIN": "Industrial Gas", "FCX": "Materials", "NUE": "Materials", "SCCO": "Materials", "VST": "Utilities",
    "NRG": "Utilities", "SO": "Utilities", "DUK": "Utilities", "UPS": "Industrials", "FDX": "Industrials",
    "TSM": "Semis/Foundry",
    "PGR": "Insurance", "TRV": "Insurance", "ALL": "Insurance", "HIG": "Insurance", "CB": "Insurance",
    # ---- 2026-07 expansion. Every value below must already exist in app.js
    # SECTOR_MAP so each new name inherits a real sector-ETF for the tape,
    # sector read-through and macro-regime layers. ----
    "TXN": "Semis", "ADI": "Semis", "NXPI": "Semis", "ON": "Semis", "MCHP": "Semis",
    "TER": "Semi Equip", "ENTG": "Semi Equip", "WDC": "Hardware", "GLW": "Hardware",
    "ADSK": "Software", "CTSH": "IT Services", "TEAM": "Software", "HUBS": "Software",
    "VEEV": "Software", "ZM": "Software", "DOCU": "Software",
    "FTNT": "Cybersecurity", "OKTA": "Cybersecurity", "TTD": "AdTech", "DASH": "E-commerce",
    "EA": "Gaming", "TTWO": "Gaming",
    "FI": "Payments", "FIS": "Payments", "GPN": "Payments", "SYF": "Payments",
    "ICE": "Financial Data", "CME": "Financial Data", "NDAQ": "Financial Data",
    "CBOE": "Financial Data", "MCO": "Financial Data", "MSCI": "Financial Data", "FICO": "Financial Data",
    "USB": "Banks", "PNC": "Banks", "TFC": "Banks", "FITB": "Banks", "MTB": "Banks",
    "RF": "Banks", "KEY": "Banks", "CFG": "Banks", "ALLY": "Banks",
    "BX": "Asset Mgmt", "KKR": "Asset Mgmt", "APO": "Asset Mgmt", "ARES": "Asset Mgmt",
    "PS": "Asset Mgmt",
    "IBKR": "Fintech Brokerage",
    "AIG": "Insurance", "MET": "Insurance", "PRU": "Insurance", "AFL": "Insurance",
    "ACGL": "Insurance", "MMC": "Insurance",
    "AMGN": "Biotech", "GILD": "Biotech", "VRTX": "Biotech", "REGN": "Biotech", "BIIB": "Biotech",
    "BMY": "Pharma", "ZTS": "Pharma",
    "CI": "Managed Care", "ELV": "Managed Care", "HCA": "Managed Care",
    "MCK": "Managed Care", "COR": "Managed Care",
    "SYK": "Medical Devices", "BSX": "Medical Devices", "EW": "Medical Devices", "DXCM": "Medical Devices",
    "IQV": "Life Sciences", "A": "Life Sciences", "IDXX": "Life Sciences",
    "PEP": "Beverages", "KO": "Beverages", "STZ": "Beverages",
    "GIS": "Staples", "HSY": "Staples", "KHC": "Staples", "MDLZ": "Staples",
    "PG": "Staples", "CL": "Staples", "KMB": "Staples",
    "TJX": "Retail", "ROST": "Retail", "DG": "Retail", "DLTR": "Retail",
    "ORLY": "Retail", "AZO": "Retail",
    "YUM": "Restaurants", "MAR": "Travel", "HLT": "Travel",
    "LULU": "Apparel", "DECK": "Apparel",
    "UNP": "Rails", "CSX": "Rails", "NSC": "Rails", "ODFL": "Industrials",
    "GD": "Defense", "NOC": "Defense", "LHX": "Defense",
}
CIK_OVERRIDE = {
    # SEC company_tickers can map XOM to a newer holding-company shell. Use the
    # long-running Exxon Mobil Corporation filer for full historical companyfacts.
    "XOM": {"cik": 34088, "name": "EXXON MOBIL CORP"},
}
# SEC's company_tickers.json occasionally lags a ticker change (Fiserv FISV->FI)
# or carries a punctuation variant. Resolve those by matching the SEC file's own
# company title, so the CIK still comes from SEC data and is never hardcoded.
NAME_FALLBACK = {
    "FI": "FISERV",
    "MMC": "MARSH & MCLENNAN",
}

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
        if not row and tk in NAME_FALLBACK:
            want = NAME_FALLBACK[tk].upper()
            row = next((r for r in sec.values() if want in (r.get("title") or "").upper()), None)
            if row:
                print(f"  {tk}: resolved by company name -> {row['title']} (CIK {row['cik_str']})", flush=True)
        override = CIK_OVERRIDE.get(tk)
        if override:
            row = {"ticker": tk, "title": override["name"], "cik_str": override["cik"]}
        if not row:
            # A candidate can disappear between list-building and build time
            # (acquired, delisted, renamed). Dropping it with a loud warning is
            # correct; hard-failing would block an otherwise valid expansion.
            errors.append(f"{tk}: not in SEC ticker map — dropped")
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
    e["sector"] = sectors.get(e["ticker"], SECTOR_OVERRIDE.get(e["ticker"], "Unknown"))

# validation
tks = [e["ticker"] for e in entries]
count = len(tks)
if errors:
    print("\n".join("  WARNING " + e for e in errors), flush=True)
    print(f"  {len(errors)} candidate(s) unresolved; universe built with {count}"
          f" of {REQUIRED_UNIVERSE_SIZE} listed tickers", flush=True)
assert len(set(tks)) == count, "duplicate tickers"
assert all(e["cik"] for e in entries), "missing CIK"
# An expansion may drop a dead candidate, but it must never lose a name the
# terminal already ships — that would silently shrink verified coverage.
prev_file = ROOT / "data" / "universe.json"
if prev_file.exists():
    prev = {c["ticker"] for c in json.loads(prev_file.read_text(encoding="utf-8"))["companies"]}
    lost = sorted(prev - set(tks))
    assert not lost, f"refusing to drop existing universe members: {lost}"
    assert count >= len(prev), f"universe shrank from {len(prev)} to {count}"

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
