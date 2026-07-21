# SBC Terminal Audit

Date: 2026-07-20
Model: `SBC_MODEL_VERSION = "4.0.0"`
Universe: exactly 126 official companies

## Current Gate

Passing local checks:

- `node tests/run_tests.js` - 116 passed, 0 failed
- `python scripts/golden_audit.py` - 83 verified fields, 0 conflicts
- `node tests/browser_smoke.js` - opens all 126 companies, core tools, mobile layout, and offline reload
- universe/security gate - exactly 126 official companies, 126 DATA rows, 126 SEC rows, no FLUT, no duplicate tickers, SEC source files present, simple secret scan clean

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

- 83 verified fields
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

## Open Findings — 2026-07-20 code review (verified, deferred)

Fixed in this review: null retention rendered as "keeps 0¢/$" in verdicts/options/overview; insurers missing from both SECTOR_MAP tables (scored on ROIC/FCF branch); DATA AUDIT tier counters keyed on legacy labels (always showed 0 verified); TTM buyback null-as-zero; estimate-revision sign flip on negative priors; score-engine null-coercion set (empty growth history, net debt, growth-adjusted valuation, expectations gap, final label, sector strength); revision horizons no longer reuse one short baseline; service-worker precache version mismatch (offline was dead on first install); TRV mktCap 0 and 100x shares typo; stale score snapshot.

Still open, in priority order:

1. `rebuildSecAlignedAnnuals` keeps stale short aggregator arrays for fields with zero SEC facts, index-misaligned against the rebuilt `fy` axis (31 names affected, e.g. TSLA/SHOP buyback len 4 vs fy len 10, V shares len 4). Fields need re-indexing by fiscal-year label, and `trueOwnerEarnings`' per-field `lastVal` can still pair values from different fiscal years.
2. `CRWD` share basis: Yahoo reports ~1.0B shares (annual + quarterly + mktCap) while every SEC filing through the FY2026 10-K (filed 2026-03-05) reports ~0.251B diluted. Annual arrays now hold the SEC basis per the SEC-primary rule (enforced mechanically by `update_data.py`'s SEC override pass), but `qd.shares`/`mktCap` remain on Yahoo's basis. If CrowdStrike executed a ~4:1 split after 2026-03-05, Yahoo is split-adjusted and the SEC annual basis must be adjusted (see `ADS_SHARE_DIVISOR` mechanism in `scripts/sec_ingest.py` for the pattern); verify against the latest 10-Q/8-K before touching.
3. `ttm()` sums whatever quarters exist (1-3 nulls silently understate "TTM" revenue/NI/SBC); should require 4 or label the shortfall.
4. `quoteChangeOf` coerces missing day-change to 0 ("0.00%" instead of missing) and feeds it as neutral momentum.
5. Market Reward has no minimum-coverage gate (currently ~35% coverage while estimate histories are empty) and Growth acceleration double-counts into both views.
6. Clean/Middle/High/Tragic bucket still drives watchlist/screener filters, AVOID calls, portfolio allocation and calendar columns despite being spec'd as SBC-X-Ray-only.
7. charts.js: all-null series render a blank SVG (no "no data" state); `donut(null)` clamps to 0 (call sites now guarded).
8. tabSBC "Wall St adj" bar duplicates headline P/E (no non-GAAP P/E computed); `sbcPctOCF` never recomputed from SEC arrays.
9. iOS `apple-touch-icon` is SVG (unsupported) — needs PNG 180/192/512 incl. maskable; no CSP meta.
10. Dead code to delete: first `renderCalendar`/`refreshAllLive`/`updateLiveDot` declarations (shadowed), `legacyDataQualityOf`, `SEC_FIELD_TO_LOCAL`, `secValueForDisplay`, `RANK_COLS` + dead first body build in `renderRankings`, legacy `renderHome`, no-op ternaries in `scoreVal`/`fmtPct`, unused `gm` in scores.js `whatChanged`.

Needs owner action: set the `FMP_API_KEY` repo secret so estimate histories start accumulating (workflow runs green but writes empty snapshots); merge to main so the repaired data-refresh workflow can push again.

## Deployment Rule

Do not deploy unless:

- Official universe is exactly 126
- `DATA.length === 126`
- `Object.keys(SEC).length === 126`
- golden audit passes
- regression tests pass
- browser smoke tests pass
- no high-severity source conflicts remain
- no exposed API credentials are detected
