"""Add opt:{} blocks to data.js: ~35-day ATM implied vol, 6-month realized vol,
put/call open-interest ratio, expiry used. Real Yahoo options + chart data."""
import json, math, re, sys, time
sys.path.insert(0, r"C:/Users/hamza/Favorites/stock-terminal/scripts")
import update_data as U

DATA_JS = r"C:/Users/hamza/Favorites/stock-terminal/data.js"
opener, crumb = U.get_crumb()

def fetch_opt(tk):
    root = json.loads(U.get(f"https://query1.finance.yahoo.com/v7/finance/options/{tk}?crumb={crumb}", opener))
    r = root["optionChain"]["result"][0]
    spot = r["quote"].get("regularMarketPrice")
    exps = r.get("expirationDates") or []
    if not spot or not exps:
        return None
    now = time.time()
    target = min(exps, key=lambda e: abs((e - now) / 86400 - 35))
    dte = round((target - now) / 86400)
    if dte < 7:  # nothing sane near 35d
        return None
    ch = r["options"][0] if r["options"] and r["options"][0].get("expirationDate") == target else None
    if ch is None:
        d2 = json.loads(U.get(f"https://query1.finance.yahoo.com/v7/finance/options/{tk}?date={target}&crumb={crumb}", opener))
        ch = d2["optionChain"]["result"][0]["options"][0]
    calls, puts = ch.get("calls") or [], ch.get("puts") or []
    if not calls or not puts:
        return None
    atm_c = min(calls, key=lambda c: abs(c["strike"] - spot))
    atm_p = min(puts, key=lambda c: abs(c["strike"] - spot))
    ivs = [x.get("impliedVolatility") for x in (atm_c, atm_p) if x.get("impliedVolatility") and 0.03 < x["impliedVolatility"] < 4]
    if not ivs:
        return None
    iv = sum(ivs) / len(ivs)
    coi = sum(c.get("openInterest") or 0 for c in calls)
    poi = sum(p.get("openInterest") or 0 for p in puts)
    pcr = round(poi / coi, 2) if coi > 50 else None
    exp_str = time.strftime("%Y-%m-%d", time.gmtime(target))
    return {"iv": round(iv, 3), "pcr": pcr, "exp": exp_str, "dte": dte}

def fetch_rv(tk):
    d = json.loads(U.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{tk}?interval=1wk&range=6mo", opener))
    closes = [c for c in d["chart"]["result"][0]["indicators"]["quote"][0]["close"] if c]
    if len(closes) < 10:
        return None
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    mean = sum(rets) / len(rets)
    var = sum((x - mean) ** 2 for x in rets) / (len(rets) - 1)
    return round(math.sqrt(var * 52), 3)

src = open(DATA_JS, encoding="utf-8").read()
tickers = re.findall(r'co\(\{ ticker:"([A-Z]+)"', src)
print(f"{len(tickers)} tickers", flush=True)

opts, fails = {}, []
for i, tk in enumerate(tickers):
    try:
        o = fetch_opt(tk)
        if o:
            rv = None
            try:
                rv = fetch_rv(tk)
            except Exception:
                pass
            parts = [f"iv:{o['iv']}"]
            parts.append(f"rv:{rv}" if rv else "rv:null")
            parts.append(f"pcr:{o['pcr']}" if o["pcr"] is not None else "pcr:null")
            parts.append(f'exp:"{o["exp"]}", dte:{o["dte"]}')
            opts[tk] = "opt:{" + ", ".join(parts) + "},"
        else:
            fails.append(tk)
    except Exception:
        fails.append(tk)
    if (i + 1) % 50 == 0:
        print(f"  {i+1}/{len(tickers)} — got {len(opts)}", flush=True)
    time.sleep(0.25)
print(f"built {len(opts)}, no options: {len(fails)}", flush=True)

pat = re.compile(r'co\(\{ ticker:"([A-Z]+)".*?\}\)', re.S)
def patch(m):
    tk, block = m.group(1), m.group(0)
    o = opts.get(tk)
    if not o:
        return block
    if "opt:{" in block:
        return re.sub(r"opt:\{[^}]*\},", o, block)
    return block.replace("    note:", "    " + o + "\n    note:")

src = pat.sub(patch, src)
open(DATA_JS, "w", encoding="utf-8").write(src)
print(f"WROTE data.js — {len(opts)} opt blocks", flush=True)
