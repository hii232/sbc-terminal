"""Promote newly added universe tickers into real DATA co({...}) rows.

Run after:
  python scripts/build_universe.py
  python scripts/sec_ingest.py

It reads the current official universe, finds tickers missing from data.js,
fetches Yahoo quote/fundamental rows, supplements annual cash-flow/capex/SBC
from SEC company files when Yahoo is sparse, and appends normal company records.
"""
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import update_data as U

ROOT = Path(__file__).resolve().parent.parent
DATA_JS = ROOT / "data.js"
B = 1e9

LOW_SBC_OK = {"XOM", "CVX", "SCCO"}


def js_num(v, d=2):
    if v is None:
        return "null"
    try:
        v = float(v)
    except Exception:
        return "null"
    s = f"{v:.{d}f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def arr(vals, d=2):
    return "[" + ",".join(js_num(v, d) for v in vals) + "]"


def qstr(s):
    return json.dumps(s or "")


def sec_fields(tk):
    p = ROOT / "data" / "companies" / f"{tk}.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8")).get("fields", {})


def sec_series(fields, key, years, scale=B, absval=False):
    vals = fields.get(key)
    out = {str(y): None for y in years}
    if not isinstance(vals, list):
        return out
    for row in vals:
        yr = str(row.get("fiscalYear") or (row.get("periodEnd") or "")[:4])
        if yr in out and row.get("value") is not None:
            v = float(row["value"]) / scale
            out[yr] = abs(v) if absval else v
    return out


def yahoo_series(f, key, years, scale=B, absval=False, fill=None):
    src = f.get(key, {})
    out = []
    for y in years:
      if y in src:
        v = float(src[y]) / scale
        out.append(abs(v) if absval else v)
      else:
        out.append(fill)
    return out


def classify(sector, rev, ni, sbc, buyback, shares):
    latest_rev = next((v for v in reversed(rev) if v not in (None, 0)), None)
    latest_sbc = next((v for v in reversed(sbc) if v is not None), None)
    sbc_pct = latest_sbc / latest_rev * 100 if latest_rev and latest_sbc is not None else None
    sh0 = next((v for v in shares if v not in (None, 0)), None)
    sh1 = next((v for v in reversed(shares) if v not in (None, 0)), None)
    sh_chg = ((sh1 / sh0) - 1) * 100 if sh0 and sh1 else 0
    profitable = next((v for v in reversed(ni) if v is not None), 0) > 0
    if sbc_pct is None:
        bucket, grade = "middle", "C"
    elif sbc_pct < 2.5 and sh_chg <= 2:
        bucket, grade = "clean", "A"
    elif sbc_pct < 5 and sh_chg <= 5:
        bucket, grade = "clean", "B"
    elif sbc_pct < 8:
        bucket, grade = "middle", "C"
    elif sbc_pct < 15:
        bucket, grade = "high", "D"
    else:
        bucket, grade = "tragic", "F"
    if not profitable and bucket == "clean":
        bucket, grade = "middle", "C"
    if sector in {"Banks", "Asset Mgmt", "Payments"} and bucket == "tragic":
        bucket, grade = "high", "D"
    return bucket, grade, sbc_pct, sh_chg


def build_qd(f):
    return U.build_qd(f)


def build_qm(fields, years):
    ocf = [sec_series(fields, "ocf", years).get(y) for y in years]
    capex = [sec_series(fields, "capex", years, absval=True).get(y) for y in years]
    if not any(v is not None for v in ocf) and not any(v is not None for v in capex):
        return None
    fcf = [(o - c) if o is not None and c is not None else None for o, c in zip(ocf, capex)]
    return f"qm:{{ocf:{arr(ocf)}, fcf:{arr(fcf)}, capex:{arr(capex)}}},"


def record(tk, meta, quote, f, fields):
    years = sorted(f.get("annualTotalRevenue", {}).keys())[-4:]
    if len(years) < 3:
        raise RuntimeError(f"{tk}: insufficient annual revenue history")
    rev = yahoo_series(f, "annualTotalRevenue", years)
    ni = yahoo_series(f, "annualNetIncome", years)
    sbc = yahoo_series(f, "annualStockBasedCompensation", years)
    if not any(v is not None for v in sbc):
        sec_sbc = sec_series(fields, "sbc", years)
        sbc = [sec_sbc.get(y) for y in years]
    if not any(v is not None for v in sbc) and tk in LOW_SBC_OK:
        sbc = [None for _ in years]
    buyback = yahoo_series(f, "annualRepurchaseOfCapitalStock", years, absval=True, fill=0.0)
    if not any(v not in (None, 0) for v in buyback):
        sec_bb = sec_series(fields, "buyback", years, absval=True)
        buyback = [sec_bb.get(y) if sec_bb.get(y) is not None else 0 for y in years]
    shares = yahoo_series(f, "annualDilutedAverageShares", years)
    if not any(v is not None for v in shares):
        sec_sh = sec_series(fields, "dilShares", years)
        shares = [sec_sh.get(y) for y in years]
    sector = meta["sector"]
    bucket, grade, sbc_pct, sh_chg = classify(sector, rev, ni, sbc, buyback, shares)
    latest_sbc = next((v for v in reversed(sbc) if v is not None), None)
    latest_rev = next((v for v in reversed(rev) if v not in (None, 0)), None)
    latest_ni = next((v for v in reversed(ni) if v not in (None, 0)), None)
    ocf_y = yahoo_series(f, "annualOperatingCashFlow", years)
    latest_ocf = next((v for v in reversed(ocf_y) if v not in (None, 0)), None)
    price = quote.get("regularMarketPrice")
    eps = quote.get("epsTrailingTwelveMonths")
    pe = quote.get("trailingPE") or (price / eps if price and eps and eps > 0 else None)
    mcap = (quote.get("marketCap") or 0) / B if quote else 0
    change = quote.get("regularMarketChangePercent", 0) if quote else 0
    sbc_ni = latest_sbc / latest_ni * 100 if latest_sbc is not None and latest_ni and latest_ni > 0 else None
    sbc_ocf = latest_sbc / latest_ocf * 100 if latest_sbc is not None and latest_ocf else None
    qd = build_qd(f)
    gd = U.build_gd(f, quote or {})
    qm = build_qm(fields, years)
    note = f"{meta.get('reason') or 'Official 121 coverage'}; data generated from Yahoo fundamentals and SEC companyfacts. Review SBC tags before treating as fully audited."
    lines = [
        f'  co({{ ticker:{qstr(tk)}, name:{qstr(meta["name"])}, sector:{qstr(sector)}, bucket:{qstr(bucket)}, grade:{qstr(grade)},',
        f'    price:{js_num(price)}, change:{js_num(change)}, mktCap:{js_num(mcap, 1)}, headlinePE:{js_num(pe, 1)}, ownersKeep:0.85,',
        f'    gaapEPS:{js_num(eps)}, nonGaapEPS:{js_num(eps)},',
        f'    fy:[{",".join(qstr(y) for y in years)}], sbcPctRev:{js_num(sbc_pct, 1)}, sbcPctOCF:{js_num(sbc_ocf, 1)}, sbcPctNI:{js_num(sbc_ni, 0)},',
        f'    revenue:{arr(rev)}, ni:{arr(ni)}, sbc:{arr(sbc, 3)},',
        f'    buyback:{arr(buyback)}, shares:{arr(shares, 3)},',
    ]
    for block in (qd, gd, qm):
        if block:
            lines.append("    " + block)
    lines.append(f'    note:{qstr(note)} }}),')
    return "\n".join(lines)


def main():
    src = DATA_JS.read_text(encoding="utf-8")
    have = set(re.findall(r'co\(\{ ticker:"([A-Z]+)"', src))
    uni = json.loads((ROOT / "data" / "universe.json").read_text(encoding="utf-8"))["companies"]
    missing = [c for c in uni if c["ticker"] not in have]
    if not missing:
        print("No missing DATA rows.")
        return
    tickers = [c["ticker"] for c in missing]
    print(f"Generating DATA rows for {len(tickers)} tickers: {', '.join(tickers)}", flush=True)
    quotes = U.fetch_quotes(tickers)
    blocks = []
    for c in missing:
        tk = c["ticker"]
        try:
            f = U.fetch_fundamentals(tk)
            fields = sec_fields(tk)
            blocks.append(record(tk, c, quotes.get(tk, {}), f, fields))
            print(f"  {tk}: data row ok", flush=True)
        except Exception as exc:
            print(f"  {tk}: failed {exc}", flush=True)
            raise
        time.sleep(0.25)
    insert = "\n\n  /* ================= EXPANDED OFFICIAL 121 COVERAGE ================= */\n" + "\n\n".join(blocks) + "\n"
    src = src.replace("\n];\n\n/* ordering for the framework legend */", "\n" + insert + "];\n\n/* ordering for the framework legend */")
    DATA_JS.write_text(src, encoding="utf-8")
    print(f"WROTE {DATA_JS} with {len(blocks)} promoted rows", flush=True)


if __name__ == "__main__":
    main()
