"""Add px:{} blocks: REAL 12-month weekly closing prices per ticker (Yahoo),
so the terminal never renders synthetic price charts.
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
    pts = [(ts[i], c) for i, c in enumerate(closes) if c]
    if len(pts) < 10:
        return None
    # ~52 weekly closes; label first/last dates for provenance
    vals = ",".join(f"{c:.2f}" for _, c in pts)
    d0 = time.strftime("%Y-%m-%d", time.gmtime(pts[0][0]))
    d1 = time.strftime("%Y-%m-%d", time.gmtime(pts[-1][0]))
    return f'px:{{v:[{vals}], from:"{d0}", to:"{d1}"}},'

src = DATA_JS.read_text(encoding="utf-8")
only = {t.upper() for t in sys.argv[1:]}
tickers = re.findall(r'co\(\{ ticker:"([A-Z]+)"', src)
if only:
    tickers = [t for t in tickers if t in only]
print(f"{len(tickers)} tickers", flush=True)

out, fails = {}, []
for i, tk in enumerate(tickers):
    try:
        p = fetch_px(tk)
        if p:
            out[tk] = p
        else:
            fails.append(tk)
    except Exception:
        fails.append(tk)
    if (i + 1) % 80 == 0:
        print(f"  {i+1}/{len(tickers)} — got {len(out)}", flush=True)
    time.sleep(0.22)
print(f"built {len(out)}, failed {len(fails)}", flush=True)

pat = re.compile(r'co\(\{ ticker:"([A-Z]+)".*?\}\)', re.S)
def patch(m):
    tk, block = m.group(1), m.group(0)
    p = out.get(tk)
    if not p:
        return block
    if "px:{" in block:
        return re.sub(r"px:\{[^}]*\},", p, block)
    return block.replace("    note:", "    " + p + "\n    note:")

src = pat.sub(patch, src)
DATA_JS.write_text(src, encoding="utf-8")
print(f"WROTE data.js — {len(out)} px blocks", flush=True)
