"""Add px:{} blocks (REAL 12-month weekly closes) and pd:{} blocks (last ~70
daily closes for RSI/technicals) per ticker, from Yahoo — the terminal never
renders synthetic price data.
    python scripts/gen_prices.py
"""
import json, re, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import update_data as U

DATA_JS = Path(__file__).resolve().parent.parent / "data.js"

def fetch_px(tk):
    d = json.loads(U.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{tk}?interval=1wk&range=1y"))
    r = d["chart"]["result"][0]
    closes = r["indicators"]["quote"][0]["close"]
    ts = r["timestamp"]
    # Keep every weekly slot on a uniform grid: a gap becomes null, not a
    # compacted point. The terminal's time axis maps index->date by a fixed
    # weekly cadence, so dropping slots would slide every later point onto the
    # wrong date. Trim only leading/trailing nulls (pre-listing / no-print).
    grid = list(zip(ts, closes))
    while grid and grid[0][1] is None:
        grid.pop(0)
    while grid and grid[-1][1] is None:
        grid.pop()
    if len([c for _, c in grid if c is not None]) < 10:
        return None
    vals = ",".join("null" if c is None else f"{c:.2f}" for _, c in grid)
    d0 = time.strftime("%Y-%m-%d", time.gmtime(grid[0][0]))
    d1 = time.strftime("%Y-%m-%d", time.gmtime(grid[-1][0]))
    return f'px:{{v:[{vals}], from:"{d0}", to:"{d1}"}},'

def fetch_pd(tk):
    """Last ~70 daily closes (gaps dropped — RSI needs consecutive prints)."""
    d = json.loads(U.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{tk}?interval=1d&range=6mo"))
    r = d["chart"]["result"][0]
    closes = [c for c in r["indicators"]["quote"][0]["close"] if c is not None][-70:]
    ts = r["timestamp"]
    if len(closes) < 20:
        return None
    vals = ",".join(f"{c:.2f}" for c in closes)
    d1 = time.strftime("%Y-%m-%d", time.gmtime(ts[-1]))
    return f'pd:{{v:[{vals}], to:"{d1}"}},'

src = DATA_JS.read_text(encoding="utf-8")
only = {t.upper() for t in sys.argv[1:]}
tickers = re.findall(r'co\(\{ ticker:"([A-Z]+)"', src)
if only:
    tickers = [t for t in tickers if t in only]
print(f"{len(tickers)} tickers", flush=True)

out, outd, fails = {}, {}, []
for i, tk in enumerate(tickers):
    try:
        p = fetch_px(tk)
        if p:
            out[tk] = p
        else:
            fails.append(tk)
    except Exception:
        fails.append(tk)
    try:
        pdb = fetch_pd(tk)
        if pdb:
            outd[tk] = pdb
    except Exception:
        pass  # daily closes are an enhancement; weekly px is the required layer
    if (i + 1) % 80 == 0:
        print(f"  {i+1}/{len(tickers)} — got {len(out)} px / {len(outd)} pd", flush=True)
    time.sleep(0.22)
print(f"built {len(out)} px / {len(outd)} pd, failed {len(fails)}", flush=True)

pat = re.compile(r'co\(\{ ticker:"([A-Z]+)".*?\}\)', re.S)
def patch(m):
    tk, block = m.group(1), m.group(0)
    p, pdl = out.get(tk), outd.get(tk)
    if p:
        if "px:{" in block:
            block = re.sub(r"px:\{[^}]*\},", p, block)
        else:
            block = block.replace("    note:", "    " + p + "\n    note:")
    if pdl:
        if "pd:{" in block:
            block = re.sub(r"pd:\{[^}]*\},", pdl, block)
        elif "px:{" in block:
            block = re.sub(r"(px:\{[^}]*\},)", r"\1\n    " + pdl.replace("\\", "\\\\"), block, count=1)
    return block

src = pat.sub(patch, src)
DATA_JS.write_text(src, encoding="utf-8")
print(f"WROTE data.js — {len(out)} px / {len(outd)} pd blocks", flush=True)
