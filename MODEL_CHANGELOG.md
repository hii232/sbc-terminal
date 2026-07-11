# SBC Model Changelog

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
