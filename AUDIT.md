# SBC Terminal Audit

Date: 2026-07-11
Model: `SBC_MODEL_VERSION = "4.0.0"`
Universe: exactly 60 companies

## Current Gate

Passing local checks:

- `node tests/run_tests.js` - 53 passed, 0 failed
- `python scripts/golden_audit.py` - 82 verified fields, 0 conflicts
- `node tests/browser_smoke.js` - opens all 60 companies, core tools, mobile layout, and offline reload
- universe/security gate - exactly 60 companies, no FLUT, no duplicate tickers, SEC source files present, simple secret scan clean

## Data Rules

- SEC filings are the primary financial layer.
- Missing data stays `null`; it is never converted to zero.
- FMP fallback data is stored as secondary evidence and does not overwrite SEC-backed arrays.
- Period matching is conservative. If the terminal cannot match the intended fiscal period, the field is marked missing/not comparable instead of falling back to the latest SEC value.
- Low-confidence companies do not enter the main ranking and do not receive precise valuation or final buy/avoid calls.

## Golden Audit

Audited companies:

`AAPL`, `MSFT`, `GOOGL`, `META`, `NVDA`, `PLTR`, `CRM`, `CRWD`, `SNOW`, `UBER`, `COIN`, `CRWV`

Fields checked:

- revenue
- net income
- operating cash flow
- capital expenditures
- SBC
- buybacks
- diluted weighted-average shares
- period-end shares outstanding
- employee tax withholding
- latest annual report metadata
- latest four-quarter terminal snapshot

Current result:

- 82 verified fields
- 0 conflicts
- pass: true

The machine-readable output is in `data/audits/golden-company-audit.json`.

## Resolved Conflicts

- `PLTR` latest buyback updated from `$0.070B` to SEC value `$0.075B`.
- `CRWD` annual diluted shares corrected to SEC share units: `0.227B`, `0.233B`, `0.245B`, `0.251B`.
- `CRWD` capex corrected to SEC PP&E capex and FCF re-derived.
- `COIN` capex after 2022 is left missing unless a comparable SEC annual fact exists.

## Remaining Limitations

- Supplemental operating cash flow and capex comparisons are displayed in the app audit, but do not block the core filing-verified badge unless they affect the core owner-earnings fields.
- Company-specific tax-withholding data is used when SEC-tagged; otherwise the model labels the 25% of SBC proxy as low-confidence.
- Full manual filing review still needs reviewer notes, exact evidence excerpts, and latest four-quarter checks for every audited company.
- Live options chains, transcripts, and institutional news feeds require paid data sources.

## Deployment Rule

Do not deploy unless:

- universe is exactly 60
- `DATA.length === 60`
- `Object.keys(SEC).length === 60`
- golden audit passes
- regression tests pass
- browser smoke tests pass
- no high-severity source conflicts remain
- no exposed API credentials are detected
