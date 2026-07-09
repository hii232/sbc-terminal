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
| `data.js`    | REAL quotes + 4 fiscal years of real filings for 34 tickers (Yahoo Finance) |
| `app.js`     | rendering, tabs, SBC math, live-data layer |
| `scripts/update_data.py` | one-command refresh of all quotes & fundamentals |
| `manifest.json` / `sw.js` / `icon.svg` | PWA: install on phone, works offline |

## Keeping data fresh
Bundled data is **real** (pulled from Yahoo Finance — quotes + as-reported annual
filings: revenue, net income, SBC, buybacks, diluted shares). To refresh:

```
python scripts/update_data.py           # all 34 tickers
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
`snapshot` / `illustrative`). With keys, the header flips to `● LIVE`.

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
tracks 12-month rotation and money flow across all 11 SPDR sectors + semis vs SPY.

## Note on the numbers
Quotes and annual fundamentals (revenue, net income, SBC, buybacks, diluted shares)
are **real Yahoo Finance data** as of the date stamped in the FINANCIALS tab — rerun
`scripts/update_data.py` to refresh. Two things remain framework judgments, not data:
`ownersKeep` (the ¢-per-GAAP-dollar retention, set per the post's quality tiers) and
the true-owner-earnings calc's simplified economic SBC cost (anti-dilution buyback +
~25% withholding proxy). Tighten both per-name with real 10-K financing-activity data
when you go deep on a position.
