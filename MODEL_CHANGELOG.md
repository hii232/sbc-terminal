# SBC Model Changelog

## Best Setups: brain + RSI alignment - 2026-07-24

- gen_prices.py now also bundles pd:{} blocks — the last ~70 real daily closes per ticker — enabling true RSI(14) with Wilder smoothing (rsiOf; all-gain=100, all-loss=0, short series=null).
- New BEST SETUPS view (Stocks menu): quality gate FIRST (business quality >=65, long-term view >=55, verified data, not LIKELY DOWN), then the tape decides alignment — RSI(14) at/near the bottom (<=38) plus IV15 buy-zone proximity marks a PRIME setup; a cross back up through 30 is flagged as the classic trigger. Oversold weak businesses are filtered out before display (falling-knife guard, stated on-screen). Setup score = brain 30% + RSI 30% + valuation 16% + buy-zone 14% + direction edge 10%, coverage-weighted, missing-safe.
- Easy Mode's great-companies list gains a plain-words RSI tag ("sellers are exhausted — this is what a real sale looks like"). Shell v70.

## BlackRock tracker - 2026-07-24

- New BLACKROCK TRACKER view (Market menu): recent EDGAR filings feed (click-through to the actual documents) plus the two latest 13F-HR holdings reports parsed and diffed — new positions, full exits, adds/trims >=3%, top 25 holdings, and BlackRock's stake (with QoQ change) in every universe name. Pipeline: scripts/track_blackrock.py (keyless SEC EDGAR; heavy 13F parse cached per accession).
- Signals feed gains BLACKROCK (whale) events when a new 13F lands: new positions/exits in universe names (78), adds/trims >=8% (66); every event states the quarter and the 45-day legal lag.
- Honesty on-screen: 13Fs are quarterly with a 45-day lag, and BlackRock is mostly an index manager — the page says both, and frames deviations (not routine flows) as the signal. Shell v68.

## Easy Mode - 2026-07-24

- New EASY MODE — TODAY'S GAME PLAN view (Home menu): the whole terminal translated into plain language a 10-year-old can follow. Letter grades (A-F, honest "?" for unknown), one-sentence verdicts per stock, and five sections: great companies at fair prices, report cards coming up (Beat Odds), winning streaks (drift), be-careful list (miss risk + tier-1 downgrades + downside drift), and what-just-happened (the signals feed translated). Same engines underneath — only the language is simplified; "we don't know" is said out loud, and the golden-rules card states plainly that scores are hints, not promises. Shell v67.

## Analyst ratings layer - 2026-07-24

- Daily collector now ingests analyst rating actions (upgradeDowngradeHistory): firm, from -> to grade, action, dated — last 45 days per ticker, keyless.
- Signals feed gains ANALYST events: upgrades/downgrades within 10 days, tier-1 desks (Morgan Stanley, Goldman, JPMorgan, BofA, UBS, Barclays, Citi, ...) weighted 72, others 58; reiterations skipped unless tier-1 initiations.
- Ticker overview gains an ANALYST RATING ACTIONS tape. The stated reasoning is honest: the free feed carries the action only, so the app attaches the time-adjacent headline naming the firm and action when a news key is connected, and explicitly marks the reason unavailable otherwise — it is never invented. Shell v66.

## The edge layer: signals, drift, filing diffs, calibration - 2026-07-24

- New WHAT CHANGED signals feed (own nav group, default panel on Home): `scripts/build_signals.js` runs in the daily pipeline and diffs every tracked input against yesterday — business-quality/market-reward/long-term score inflections and threshold crossings, Direction Edge label flips, analyst revision-tape sign flips and consensus-drift inflections, Beat Odds regime entries for reports inside 3 weeks, fresh beats/misses, and same-day SEC filing diffs (revenue growth acceleration/deceleration, SBC-burden change, share-count turns, computed from filing facts the day a new accession lands). Events are materiality-ranked; the ledger keeps 21 days; nothing is backfilled or invented.
- New DRIFT BOARD (post-earnings drift / PEAD) on the Earnings Command Center: each recent reporter scored on surprise size, revenue confirmation, post-report revisions and tape confirmation, decaying across the ~60-day research window. Direction-aware (misses flag downside drift); stale or unconsensused reports are excluded, not guessed.
- New SIGNAL CALIBRATION on Track Record: daily snapshots now also record Direction Edge score/label, Beat Odds (only when a report is inside its 45-day horizon), and Market Reward tier. `calibrationOf()` grades every bucket against 4-week and 12-week forward returns with hit rates; verdicts are withheld below 20 observations, and overlapping windows are labelled as such. Signals that prove non-predictive are to be deleted.
- App shell v64.

## Deep declutter: 12-view terminal - 2026-07-23

- Consolidated six overlapping stock-ranking surfaces into two: Rankings (master leaderboard, sortable by owner P/E, Graham, quality) and Screener (custom filters). Removed the standalone Owner-Earnings P/E view, Graham Value screener view, Quality × Market Map, Triggers Today, and Tech Desk. All engines (grahamOf, quality map model, IV ladder) remain and still power the ranking columns, per-ticker tabs, and Home buy list.
- Per-ticker tabs trimmed from 10 to 7: removed EXPECTATIONS (its gap card already lives on OVERVIEW), ALERTS (device-local thesis rules that only fired when the app was open), and FRAMEWORK (static methodology essay). OVERVIEW, QUALITY, SBC X-RAY, GRAHAM VALUE, FINANCIALS, EARNINGS, NEWS remain.
- Removed the unused desktop-only Home renderer (dead code since the unified dashboard shipped).
- Final view set (12): Home, Earnings Command Center, Daily Review, Direction Edge, Sectors, Rankings, Screener, Compare, Portfolio, Thesis Journal, Track Record, Data Audit. App shell v63.

## Earnings Command Center + focus cleanup - 2026-07-23

- New EARNINGS COMMAND CENTER (replaces the plain calendar): season beat/miss tape (live Finnhub actuals with automatic fast-lane polling during report windows, or next-morning bundled results), upcoming reports with a per-name Beat Odds composite, season scorecard, and sector read-through.
- New Beat Odds model: six weighted, inspectable components — beat track record (28), revision momentum (24), pre-report tape (14), sector read-through (14, peers' season results flow in automatically), macro regime (10), expectation bar (10). Missing inputs reduce coverage; they are never scored as neutral 50. Per-ticker breakdown lives in the EARNINGS tab.
- New earnings data pipeline: `scripts/collect_earnings.py` (keyless Yahoo quoteSummary) generates `earnings.js` / `data/earnings_intel.json` in the daily data-refresh workflow; stamps `reportedOn` the first morning a new quarter appears (never backfills fake report dates on first ingest).
- Direction Edge macro layer replaced: the hardcoded inflation-profile snapshot gave way to a macro regime computed live from the SPY/sector tape (trend, breadth, defensive flows) that refreshes with every data run.
- Removed low-signal views: Social Buzz (scraped Stocktwits), Inflation Desk (static CPI snapshot), Narratives (incl. Polymarket), and Options Desk play tickets (bundled IV/RV/put-call data still feeds Direction Edge). Top nav regrouped; app shell v62.

## Social buzz sentiment timeline - 2026-07-21

- Added a sentiment-over-time line chart to Social Buzz: bullish share of tagged posts bucketed across each stream's real time span (📈 per trending ticker; empty buckets stay null, never a fabricated 50%).
- Added a day-over-day crowd-mood line persisted in localStorage (one reading per ticker per day; device-local, best-effort).
- charts.js line() gained optional fixed min/max domain (used to anchor sentiment to 0-100). App shell v54.

## Social buzz desk - 2026-07-20

- Added the Social Buzz view: Stocktwits public trending tape with crowd size, per-symbol chatter velocity from real post timestamps, and terminal context (bucket + IV15 zone) for universe names. Keyless, honest-failure, sentiment-only.
- App shell bumped to v51.

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
