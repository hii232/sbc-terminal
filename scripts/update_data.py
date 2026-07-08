"""
SBC TERMINAL — data refresher
=============================
Updates data.js in place with REAL data from Yahoo Finance (no API key needed):
  - live price, day change %, market cap, trailing P/E, GAAP TTM EPS
  - last 4 fiscal years of: revenue, net income, stock-based comp,
    buybacks, diluted average shares (as-reported filings)
  - recomputes SBC/revenue, SBC/OCF, SBC/net-income ratios

Usage:
    python scripts/update_data.py            # refresh everything
    python scripts/update_data.py NVDA PLTR  # refresh only these tickers

Run from the stock-terminal folder (or anywhere — paths are resolved
relative to this file). Requires Python 3.8+ with internet access; uses
only the standard library.
"""
import json, re, sys, time, urllib.request
from pathlib import Path
from datetime import date

DATA_JS = Path(__file__).resolve().parent.parent / "data.js"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
FUND_TYPES = ("annualTotalRevenue,annualNetIncome,annualStockBasedCompensation,"
              "annualRepurchaseOfCapitalStock,annualDilutedAverageShares,annualOperatingCashFlow")

def get(url, opener=None):
    req = urllib.request.Request(url, headers=UA)
    o = opener or urllib.request.build_opener()
    with o.open(req, timeout=30) as r:
        return r.read().decode()

def get_crumb():
    cj = urllib.request.HTTPCookieProcessor()
    opener = urllib.request.build_opener(cj)
    try:
        get("https://fc.yahoo.com", opener)
    except Exception:
        pass  # 404 is expected; cookie is set anyway
    crumb = get("https://query1.finance.yahoo.com/v1/test/getcrumb", opener)
    return opener, crumb.strip()

def fetch_quotes(tickers):
    opener, crumb = get_crumb()
    out = {}
    for i in range(0, len(tickers), 20):
        batch = ",".join(tickers[i:i+20])
        url = f"https://query1.finance.yahoo.com/v7/finance/quote?symbols={batch}&crumb={crumb}"
        for q in json.loads(get(url, opener))["quoteResponse"]["result"]:
            out[q["symbol"]] = q
    return out

def fetch_fundamentals(tk):
    url = (f"https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/"
           f"timeseries/{tk}?type={FUND_TYPES}&period1=1546300800&period2={int(time.time())}")
    d = json.loads(get(url))
    rec = {}
    for r in d["timeseries"]["result"]:
        keys = [k for k in r.keys() if k.startswith("annual")]
        if not keys:
            continue
        k = keys[0]
        rec[k] = {v["asOfDate"][:4]: v["reportedValue"]["raw"]
                  for v in (r.get(k) or []) if v and v.get("reportedValue")}
    return rec

def arr(vals, nd=2):
    def f(v):
        if v is None: return "null"
        s = f"{v:.{nd}f}".rstrip("0").rstrip(".")
        return s if s not in ("", "-0") else "0"
    return "[" + ",".join(f(v) for v in vals) + "]"

def main():
    only = {t.upper() for t in sys.argv[1:]}
    src = DATA_JS.read_text(encoding="utf-8")
    tickers = re.findall(r'co\(\{ ticker:"([A-Z]+)"', src)
    if only:
        tickers = [t for t in tickers if t in only]
    print(f"Refreshing {len(tickers)} tickers…")

    quotes = fetch_quotes(tickers)
    funds = {}
    for t in tickers:
        try:
            funds[t] = fetch_fundamentals(t)
            time.sleep(0.35)
        except Exception as e:
            print(f"  {t}: fundamentals failed ({e}) — keeping existing")

    pattern = re.compile(r'co\(\{ ticker:"([A-Z]+)".*?\}\)', re.S)

    def patch(m):
        tk, block = m.group(1), m.group(0)
        if only and tk not in only:
            return block
        q = quotes.get(tk)
        if q:
            px = q.get("regularMarketPrice")
            mc = (q.get("marketCap") or 0) / 1e9
            pe = q.get("trailingPE")
            eps = q.get("epsTrailingTwelveMonths")
            if px: block = re.sub(r"price:[\d.]+", f"price:{px:.2f}", block)
            block = re.sub(r"change:-?[\d.]+", f"change:{q.get('regularMarketChangePercent', 0):.2f}", block)
            if mc: block = re.sub(r"mktCap:[\d.]+", f"mktCap:{mc:.1f}", block)
            block = re.sub(r"headlinePE:(?:[\d.]+|null)",
                           f"headlinePE:{pe:.1f}" if pe else "headlinePE:null", block)
            if eps is not None:
                old = re.search(r"gaapEPS:(-?[\d.]+)", block)
                old_ng = re.search(r"nonGaapEPS:(-?[\d.]+)", block)
                if old and old_ng and float(old.group(1)) > 0 and eps > 0:
                    ng = eps * float(old_ng.group(1)) / float(old.group(1))
                    block = re.sub(r"nonGaapEPS:-?[\d.]+", f"nonGaapEPS:{ng:.2f}", block)
                block = re.sub(r"gaapEPS:-?[\d.]+", f"gaapEPS:{eps:.2f}", block)
        f = funds.get(tk)
        if f and f.get("annualTotalRevenue"):
            years = sorted(f["annualTotalRevenue"].keys())
            B = 1e9
            def series(key, absval=False, fill=None):
                d = f.get(key, {})
                return [abs(d[y])/B if absval and y in d else d[y]/B if y in d else fill
                        for y in years]
            rev = series("annualTotalRevenue"); ni = series("annualNetIncome")
            sbc = series("annualStockBasedCompensation")
            bb = series("annualRepurchaseOfCapitalStock", absval=True, fill=0.0)
            sh = series("annualDilutedAverageShares"); ocf = series("annualOperatingCashFlow")
            block = re.sub(r"revenue:\[[^\]]*\]", "revenue:" + arr(rev), block)
            block = re.sub(r"ni:\[[^\]]*\]", "ni:" + arr(ni), block)
            block = re.sub(r"sbc:\[[^\]]*\]", "sbc:" + arr(sbc, 3), block)
            block = re.sub(r"buyback:\[[^\]]*\]", "buyback:" + arr(bb), block)
            block = re.sub(r"shares:\[[^\]]*\]", "shares:" + arr(sh, 3), block)
            fy = "fy:[" + ",".join(f'"{y}"' for y in years) + "],"
            if "fy:[" in block:
                block = re.sub(r"fy:\[[^\]]*\],", fy, block)
            else:
                block = block.replace("sbcPctRev:", fy + " sbcPctRev:")
            ls, lr, ln = sbc[-1], rev[-1], ni[-1]
            lo = ocf[-1] if ocf else None
            if ls is not None and lr:
                block = re.sub(r"sbcPctRev:[\d.]+", f"sbcPctRev:{ls/lr*100:.1f}", block)
            if ls is not None and ln and ln > 0:
                block = re.sub(r"sbcPctNI:(?:[\d.]+|null)", f"sbcPctNI:{ls/ln*100:.0f}", block)
            if ls is not None and lo:
                block = re.sub(r"sbcPctOCF:[\d.]+", f"sbcPctOCF:{ls/lo*100:.1f}", block)
        print(f"  {tk}: ok")
        return block

    src = pattern.sub(patch, src)
    src = re.sub(r'o\.snapshot = "[^"]*";',
                 f'o.snapshot = "quotes + annual fundamentals: Yahoo Finance · {date.today().isoformat()}";',
                 src)
    DATA_JS.write_text(src, encoding="utf-8")
    print(f"\nWrote {DATA_JS}")

if __name__ == "__main__":
    main()
