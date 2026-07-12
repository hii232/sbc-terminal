# SBC Model Changelog

## 4.1.0 - 2026-07-12

- Added `scores.js`, a separate market/business score engine.
- Added six visible company scores: Business Quality, Growth and Execution, Market Reward, Shareholder Economics, Valuation, and Data Confidence.
- Removed Clean/Middle/High/Tragic as the main company opinion; those labels remain inside SBC-only analysis.
- Added Long-Term Investment View and Market Reward View with explicit weights. Data Confidence is not additive.
- Added Expectations Gap, bear/base/bull valuation cases, What Changed?, and thesis-breaking alert tabs.
- Added Quality x Market Map for the full 60-stock universe.
- Changed watchlist sorting to new metrics instead of bucket order and added compact score columns plus warnings.
- Added daily analyst-estimate history workflow and per-ticker `data/estimates/history/*.json` files.
- Added score export and no-lookahead backtest report. Full factor backtesting is blocked until point-in-time fundamentals and estimate histories exist; current report includes only an honest price-momentum pilot.
- Expanded tests and browser smoke coverage for the score engine, map, dashboard, mobile layout and offline shell.

## 4.0.0 - 2026-07-11

- Enforced exact 60-company universe.
- Removed FLUT from the official universe and data bundle.
- Changed missing-data behavior: required missing values now produce `null`, not zero.
- Changed owner-earnings valuation to direct owner EPS:
  `owner earnings / diluted shares`, then `price / owner EPS`.
- Retention percentage is explanatory only; it no longer drives estimated P/E.
- Added accounting, base economic, and conservative owner-earnings cases.
- Added data-confidence gate: below 80 means no main ranking, no precise valuation, and no final buy/avoid verdict.
- Made FMP financials fallback-only; they no longer overwrite SEC-backed arrays.
- Added full SEC period metadata to compact `sec.js` facts.
- Made golden audit a CI gate with pass/fail output.
- Expanded golden audit to include operating cash flow, capex, SEC-only period-end shares, tax withholding, latest annual filing metadata and latest-quarter snapshot evidence.
- Corrected CRWD and COIN capex handling to avoid non-SEC or non-comparable values being treated as current facts.
