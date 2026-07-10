# SBC TERMINAL — Owner-Earnings X-Ray

A Bloomberg-style stock financials terminal built around the **Burry SBC / dilution /
true-owner-earnings framework**. Dark terminal UI, zero-dependency SVG bar charts &
line graphs, and a mandatory *SBC X-Ray* on every stock.

> **The one-sentence rule:** A stock is not truly cheap until it is cheap on
> SBC-adjusted owner earnings per share — not Wall Street adjusted EPS.

## Run it

It's plain static HTML/JS — no build step.

- **Quickest:** double-click `index.html`.
- **Recommended (so live fetch/CORS behaves):** serve the folder —
  `python -m http.server 5178 --directory stock-terminal` then open
  `http://localhost:5178`.
- **Host it:** drop the `stock-terminal` folder on GitHub Pages / Netlify / any static host.

Everything runs **standalone** — no Claude membership, no external service required.

## Files
| file | purpose |
|------|---------|
| `index.html` | terminal shell, styling, command bar, PWA meta |
| `charts.js`  | zero-dependency SVG charts (line, grouped bars, hbars, donut) |
| `data.js`    | REAL quotes + fundamentals for 650 tickers — 152 curated + 498 auto-derived (badged '◐ auto' in-app); owner-retention is COMPUTED at runtime, not stored |
| `app.js`     | rendering, tabs, SBC math, live-data layer |
| `scripts/update_data.py` | one-command refresh of all quotes & fundamentals |
| `manifest.json` / `sw.js` / `icon.svg` | PWA: install on phone, works offline |

## Keeping data fresh
Bundled data is **real** (pulled from Yahoo Finance — quotes + as-reported annual
filings: revenue, net income, SBC, buybacks, diluted shares). To refresh:

```
python scripts/update_data.py           # all 650 tickers
python scripts/update_data.py NVDA PLTR # just these
```

No API key needed. Run it whenever you want current prices baked in.

## Get it on your phone
1. **GitHub Pages (best)** — push this folder to a GitHub repo, enable Pages
   (Settings → Pages → deploy from branch), open the URL on your phone, then
   **Add to Home Screen** (Share menu on iPhone, ⋮ menu on Android). It installs
   as a full-screen app with the chart icon and works offline.
2. **Same Wi-Fi** — run `python -m http.server 5178 --directory stock-terminal`
   on your PC, find your PC's IP (`ipconfig` → IPv4), open
   `http://YOUR-PC-IP:5178` on your phone.

## Live data (optional)
Click the ⚙ gear (top-right) and paste **free** API keys — stored only in your browser:

- **Finnhub** (`finnhub.io/register`) → live quotes + company news for every ticker.
- **FMP** (`financialmodelingprep.com`) → live income statement, cash flow, **SBC**, and
  diluted share count, which overwrite the bundled arrays and recompute the SBC ratios.

Without keys, the terminal is fully functional on bundled snapshots (clearly labeled
`snapshot <date> — not live`). With keys, the header flips to `● LIVE`.

## The SBC X-Ray (the point of the whole thing)
Every stock gets the 7-step check:

1. **Reported-earnings quality** — how far Wall-St-adjusted sits above GAAP, and whether SBC is the reason.
2. **SBC burden** — SBC / revenue, OCF, net income (rules: <5% ok · 5–10% watch · 10–20% serious · 20%+ red flag).
3. **Share-count truth** — diluted shares over 5y: falling / flat / rising / exploding.
4. **Buyback quality** — split into *anti-dilution* (just offsets SBC) vs *real reduction*.
5. **True owner earnings** — GAAP NI + SBC add-back − true economic SBC cost (offset buyback + tax-withholding proxy).
6. **Valuation re-rate** — headline P/E ÷ owner-earnings retention = true P/E.
7. **Management score** — A→F on SBC discipline, buyback honesty, share-count direction.

## Tickers covered — 650 names across every sector (4 quality buckets)
- **Shareholder-friendly (56):** AAPL, MSFT, MU, CSCO, TXN, ADP, COST, GILD, HON, ASML,
  MELI, V, MA, JPM, GS, BLK, SPGI, LLY, UNH, JNJ, ABBV, MRK, TMO, XOM, CVX, COP, CAT,
  DE, GE, UNP, LMT, RTX, ETN, PG, KO, PEP, WMT, PM, HD, MCD, NKE, BKNG, LIN, SHW, PLD,
  AMT, NEE, SO, DUK, TMUS, VZ, DIS, QCOM, AMAT, KLAC, ADI
- **Meaningful haircut (17):** GOOGL, AMZN, NVDA, AMD, ADBE, NFLX, INTU, CDNS, SNPS,
  META, ORCL, ACN, IBM, ANET, ISRG, INTC, VRTX
- **High SBC concern (12):** AVGO, LRCX, MPWR, APP, ARM, CRM, NOW, PANW, UBER, ABNB,
  COIN, HOOD
- **Tragic tier (15):** TSLA, PLTR, CRWD, DDOG, SHOP, MRVL, ZS, WDAY, AXON, SNOW, NET,
  MDB, RBLX, IREN, CRWV

Watchlist is sorted quality-first (clean → tragic), then by market cap. Every stock
shows a SECTOR CONTEXT strip tied to its sector ETF, and the ◈ SECTOR FLOW view
tracks 12-month rotation and trading-activity share (volume, not net fund flow) across all 11 SPDR sectors + semis vs SPY.

## Note on the numbers (v3.0)
All fundamentals are **real Yahoo Finance as-reported data** — refresh with
`scripts/update_data.py`. Owner-retention is **computed at runtime** for ~90% of
names (pooled multi-year owner earnings ÷ net income, latest year share-
reconciled with M&A/raise issuance excluded and flagged); the rest fall back to
labeled heuristics. Every stock shows a data-quality badge (HEURISTIC /
PARTIALLY VERIFIED — nothing is FILING VERIFIED yet) and the brain shows a
score BAND plus a data-confidence level, not a false-precision point score.
Full audit, formulas, limitations and tests: see `AUDIT.md` and
`node tests/run_tests.js` (30 assertions against the production engines).
