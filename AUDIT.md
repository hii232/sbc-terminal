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

Fixed 2026-08-07 (model v7, "the alignment repair" — see MODEL_CHANGELOG 7.0.0):

- Finding #1 `rebuildSecAlignedAnnuals` misalignment: fields with zero SEC facts (and margin history, which never has an SEC replacement) are now re-indexed onto the rebuilt fy axis by fiscal-year label; production-wide length agreement asserted by test. This was silently corrupting margin levels/trends/stability for every rebuilt company — fixing it moved 70/224 six-score dashboards and 206/224 master ranks, hence the v7 bump and freeze re-arm.
- Finding #3 `ttm()`: now requires four real quarters or returns missing; TTM strip renders "–" and no longer fabricates "0.0x" BUYBACK/SBC when buybacks are missing.
- Finding #4 `quoteChangeOf`: missing day-change stays null; sector tape/breadth/market-move aggregate only over real tapes; rows render "–"; a real 0.00% day is preserved.
- Finding #7 charts: all-null `line()`/`bars()` series render an explicit NO DATA state.
- Finding #9 icon: `apple-touch-icon.png` (180×180 PNG) shipped and linked.
- Estimate histories: `collect_estimates.py` gained a keyless Yahoo earningsTrend fallback for the 177 tickers FMP's free tier 403s; snapshots record their source and revisions are only measured between same-source snapshots (`tests/test_estimates_fallback.py` pins the contract in CI).

Still open, in priority order:

1. `CRWD` share basis: Yahoo reports ~1.0B shares (annual + quarterly + mktCap) while every SEC filing through the FY2026 10-K (filed 2026-03-05) reports ~0.251B diluted. Annual arrays now hold the SEC basis per the SEC-primary rule (enforced mechanically by `update_data.py`'s SEC override pass), but `qd.shares`/`mktCap` remain on Yahoo's basis. If CrowdStrike executed a ~4:1 split after 2026-03-05, Yahoo is split-adjusted and the SEC annual basis must be adjusted (see `ADS_SHARE_DIVISOR` mechanism in `scripts/sec_ingest.py` for the pattern); verify against the latest 10-Q/8-K before touching.
2. Market Reward has no minimum-coverage gate (coverage improves as the Yahoo-fallback estimate histories accumulate) and Growth acceleration double-counts into both views. Deliberately NOT fixed in v7: it is a model-design change, not a data repair, and belongs to its own version bump after the v7 freeze.
3. Clean/Middle/High/Tragic bucket still drives watchlist/screener filters, AVOID calls, portfolio allocation and calendar columns despite being spec'd as SBC-X-Ray-only. Same deferral reason as #2.
4. tabSBC "Wall St adj" bar duplicates headline P/E (no non-GAAP P/E computed); `sbcPctOCF` never recomputed from SEC arrays.
5. `trueOwnerEarnings`' per-field `lastVal` can still pair values from different fiscal years when one field is missing its latest year (arrays now share one axis, so this is "latest available per field", no longer a wrong-index pairing).
6. Dead code to delete: first `renderCalendar`/`refreshAllLive`/`updateLiveDot` declarations (shadowed), `legacyDataQualityOf`, `SEC_FIELD_TO_LOCAL`, `secValueForDisplay`, `RANK_COLS` + dead first body build in `renderRankings`, legacy `renderHome`, no-op ternaries in `scoreVal`/`fmtPct`, unused `gm` in scores.js `whatChanged`.
7. No CSP meta tag; maskable 192/512 icons still missing.

Needs owner action: an `FMP_API_KEY` repo secret still upgrades the 47 FMP-covered names to FMP-quality estimates, but is no longer blocking — the Yahoo fallback accumulates history for the whole universe keylessly.

## v8 candidates — findings from the 2026-08-07 process review (deferred: model frozen until 2026-11-05)

Found while tracing a ticker end-to-end through the ranking. All three change scores or rank order, so they wait for the freeze verdict; the display layer was made honest about them now instead.

1. **Integer-score ties decide the podium alphabetically.** Board sort is `score desc, coverage desc, ticker asc` on integer scores — at the top of the shipped board #1 vs #2 is a literal tie broken by the alphabet. Fixed at the DISPLAY level (ranks render "1=" with the tie named on board rows and ticker cards); a real fix — carrying sub-integer precision into the sort, or presenting tied names as one rank band — reorders recorded ranks and therefore waits for v8.
2. **Narrative heat votes bullish regardless of the story's own direction.** "Software Under AI Pressure" running HOT casts a + conviction vote for its members. Mechanically heat measures members' own tape/breadth/revisions (so hot = members being bought), but an adverse-framed cluster being hot is at best ambiguous evidence for a member. v8 should decide whether narrative direction (adverse vs favorable framing) modulates the vote, or whether the vote should be renamed to what it measures (cluster tape strength).
3. **The Tape pillar is the thinnest scored input** (weight 18): market reward ran for weeks on empty revision histories (now healing — fallback live since 2026-08-07, horizons fill over 7/30/90 days), and its price inputs are weekly closes + a 70-day RSI. The new `pt` daily OHLCV bundle (display-only today) is the natural v8 upgrade path for measured trend/volume inputs — IF the display layer's readings prove worth scoring, which the calibration clock exists to answer.

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
