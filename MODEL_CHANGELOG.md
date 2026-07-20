# SBC Model Changelog

## Universe + gate maintenance - 2026-07-20

- Universe expanded to exactly 126 official companies (insurers added: PGR, TRV, ALL, HIG, CB). Model versions unchanged.
- Verification gate made universe-size and calendar-week agnostic: browser smoke reads the count from `data/universe.json`; earnings-calendar tests validate structure and window filtering against `EARNINGS_FOCUS.asOf` instead of hardcoded tickers/dates.
- Bundled earnings focus week refreshed to July 20-24, 2026 (sources: company IR pages and market calendars; estimates only where published).
- Score/audit artifacts regenerated for the 126 universe (previous `latest-scores.json` was stale at 121).
- README/AUDIT counts reconciled to 126.

## 4.1.1 - 2026-07-12

- Fixed SEC period alignment: runtime matching now uses exact `periodEnd`, not fiscalYear labels.
- Rebuilt annual financial arrays from SEC-aligned annual rows instead of replacing only the latest array element.
- Made SEC operating cash flow and capex primary runtime fields and calculates FCF from aligned SEC OCF minus SEC capex.
- Added conflict classification buckets for true conflicts, period mismatches, definition mismatches, unit mismatches, stale/missing facts and detailed SEC evidence rows.
- Replaced old `FILING VERIFIED*` badge logic with `FULL FILING VERIFIED`, `CORE FILING VERIFIED`, `PARTIALLY VERIFIED`, and `NOT VERIFIED`.
- Removed forced minimum data-confidence score from the filing badge; confidence now reflects actual coverage and unresolved issue severity.
- Hardened `scripts/sec_ingest.py` to key annual facts by exact period-end date and added initial `ifrs-full` taxonomy support plus `config/company-tag-overrides.json`.
- Added `data/audits/sec-period-alignment-report.json` and NVDA/CRM regression tests.

## 4.1.0 - 2026-07-12

- Added `scores.js`, a separate market/business score engine.
- Added six visible company scores: Business Quality, Growth and Execution, Market Reward, Shareholder Economics, Valuation, and Data Confidence.
- Removed Clean/Middle/High/Tragic as the main company opinion; those labels remain inside SBC-only analysis.
- Added Long-Term Investment View and Market Reward View with explicit weights. Data Confidence is not additive.
- Added Expectations Gap, bear/base/bull valuation cases, What Changed?, and thesis-breaking alert tabs.
- Added Quality x Market Map for the full official universe.
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
