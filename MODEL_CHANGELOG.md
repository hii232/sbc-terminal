# SBC Model Changelog

## 4.5.0 — Fairness gate: a ranking must compare like with like - 2026-07-26

- The insider vote can be NEGATIVE, so while the Form 4 sweep was partial (106/224) only scanned names could receive its penalty — an unearned advantage for whichever half of the universe the sweep had not reached. Measured exposure: 10 names carried a penalty and 4 a bonus that 119 unscanned peers could not receive. `convictionOf` now withholds the insider vote from EVERY name until the sweep is complete, then switches it on for all of them at once. Using a real signal unevenly is worse than briefly not using it.
- `convictionOf` returns `evidence` (fraction of its 10 independent sources that could actually be consulted) and `notEvaluated` (what was missing and why). Evidence counts SOURCES CHECKED, not votes cast — a source consulted that had nothing to say is fully evaluated, so quiet names are not punished for being quiet.
- `masterSignalOf` scales the Confluence pillar's effective weight by that evidence, so incomplete data shows up as reduced coverage rather than a silent free pass. Coverage is now uniform at 98% across all 224 names.
- `collect_insiders.py` sorts NEVER-SCANNED names first. Universe order meant every budget-capped run restarted at the top of the alphabet, re-walking finished names and never reaching the tail — which is why coverage sat at 106/224 across runs. Budget raised 2200 → 4200, and names that are scanned but genuinely quiet are now recorded so the app can tell "no insider activity" apart from "not looked at yet".
- Correction to the 4.3.0 analysis: the ~5-point Confluence gap first attributed to insider coverage was largely a property of the two groups (avg business quality 52.9 vs 57.0), not the bias. The bias was real but small — 14 names scored on evidence unavailable to the rest. Both are now fixed.
- Tests: +24 assertions (382 total) — no insider vote may be cast while the sweep is incomplete, evidence completeness is identical for scanned and unscanned names, coverage is not split by scan status, and the composite still equals its evidence-adjusted weighted average.
- SBC_MODEL_VERSION 4.4.0 → 4.5.0. App shell v79.

## 4.4.0 — Forward P/E curve to 2029 - 2026-07-25

- New FORWARD P/E → 2029 view (Market menu): universe median forward P/E by year with a 25th/75th percentile band, a compare-up-to-6-companies chart, and a sortable table of every covered company across 2026-2029.
- The design problem is that ANALYST CONSENSUS DOES NOT EXTEND PAST THE NEXT FISCAL YEAR — there is no 2028/2029 EPS consensus for essentially any company. `forwardPeCurveOf` therefore labels every year `consensus` (a real estimate, with analyst count) or `projected` (the last consensus year grown at a stated rate). Consensus renders cyan/bold, projections amber/italic, the boundary is stated in the header, and hovering any projected cell shows the rate and its source.
- Projection rate prefers analysts' own published long-term growth estimate, else consensus FY0→FY1 growth, else nothing is drawn. It is clamped to [-25%, +40%] and DECAYS halfway toward a 5% long-run rate each year, because holding a 30% grower at 30% for four years is how spreadsheets produce fantasies. Negative or zero EPS yields NO multiple — a negative P/E is not a cheap stock.
- `collect_earnings.py` now also captures Yahoo's ANNUAL earningsTrend periods (0y, +1y) and the +5y long-term growth estimate, so real fiscal-year consensus becomes available keylessly for the whole universe instead of the 47 names FMP currently covers.
- Aggregates use medians, not means, and exclude multiples above 400x so one absurd number cannot drag the universe line somewhere no company sits.
- Tests: +59 assertions (348 total) pinning the invariants that matter — no curve may claim more than 2 consensus years, consensus never interleaves with projections, every projected year states its rate and source, consensus years carry no invented growth, no negative P/E is ever produced, each P/E equals price÷EPS, projections strictly decay toward the long-run rate, and the quartile band brackets the median.
- SBC_MODEL_VERSION 4.3.0 → 4.4.0. App shell v77.

## 4.3.1 — Proof Scoreboard: when does each signal earn its verdict - 2026-07-25

- New PROOF SCOREBOARD at the top of Track Record (`proofStatusOf`, pure over the snapshot history): for every tracked signal, when its clock started, how many names it covers, and the exact DATE its first verdict unlocks. The binding constraint is calendar time, not sample size — a 4-week verdict needs 4 weeks of history regardless of universe size — and signals added later start their OWN clock rather than inheriting an older signal's head start (asserted by test).
- Signals not yet recording are KEPT in the table and shown as pending. A missing row would read as "nothing to prove here", which is the opposite of true.
- `snapshot_scores.js` now records the Master Signal score AND universe rank (computed once per run, not re-ranked per name), signal confluence (bulls/bears), RSI(14) and insider buyer count — so all of them start accumulating evidence immediately. Bundle extended with signals.js / whales.js / insiders.js so those engines are available to the snapshot.
- `calibrationOf` grades four new groups: Master Signal by RANK TIER (top 10% / top 25% / upper half / lower half / bottom 25% — the ranking's actual claim is that the top beats the bottom, so it is graded as a ranking rather than a raw score), Signal Confluence by net agreement, RSI(14) by zone, and Insider buying by cluster size.
- Live status: recording since 2026-07-19, 7 snapshots. First 4-week evidence unlocks 2026-08-16; 12-week on 2026-10-11. Nothing is backfilled — backfilling a signal against prices it never saw is how backtests lie.
- Tests: +42 assertions (289 total) covering empty-history safety, per-signal clock independence, calendar-time gating of readiness, and that no observations are reported before a window closes.
- App shell v76.

## 4.3.0 — The Master Signal: one score, whole-universe rank - 2026-07-25

- New MASTER SIGNAL (`masterSignalOf`) — one 0-100 number per company built from every engine in the terminal, plus `masterBoard()` ranking all 224 names. Five deliberately independent pillars: BUSINESS 26 (quality, long-term view, shareholder economics, growth) · PRICE 22 (valuation score + measured distance to the IV15 buy price) · TAPE 18 (direction edge, market reward, RSI extension as mean reversion) · CONFLUENCE 24 (the conviction vote) · DATA TRUST 10 (SEC reconciliation). Weights sum to exactly 100, asserted by test.
- The hard problem is not summing but NOT double-counting. Conviction already fuses the event-driven signals (insider buying, whale 13Fs, analyst revisions, post-earnings drift, beat odds, narrative heat, filing diffs, tier-1 ratings), so it enters ONCE as a pillar instead of having its members re-added individually — pinned by tests asserting that none of those ten member keys exists as a pillar of its own.
- Coverage weighting is the honesty mechanism, consistent with Beat Odds: a pillar that cannot be computed is DROPPED from the weighted average, never scored as a neutral 50, and the coverage percentage travels with the score. Below 55% coverage a name is not ranked at all. Tests assert the composite equals the coverage-weighted pillar average exactly and that coverage equals the summed weight of the pillars that computed.
- New MASTER SIGNAL BOARD at the top of the What Changed (Signals) view: every rankable name ordered by score, with each row showing all five pillar scores, what is carrying it, and coverage. Controls for TOP 25 / TOP 50 / ALL and for re-ranking by any single pillar. Per-ticker MASTER SIGNAL card shows the score, the universe rank (#N of 224), pillar bars with their evidence, what is carrying vs holding back the name, and which pillars were not computable. Home gains a top-5 panel.
- Board is memoized for 45s (a full ranking touches every engine, ~150ms) so ticker pages can show rank without re-ranking per render.
- Live spread on production data: 4 TOP SIGNAL, 31 STRONG, 61 CONSTRUCTIVE, 108 NEUTRAL, 17 WEAK, 3 NEGATIVE across 224 names, scores 30-80.
- Tests: +30 assertions (247 total) covering weight sum, sort/rank/uniqueness invariants, exact composite arithmetic, missing-pillar handling, best/worst pillar correctness, anti-double-count, and that the board actually discriminates rather than flattening to one label. Browser smoke drives the board's size and sort controls.
- SBC_MODEL_VERSION 4.2.0 -> 4.3.0. App shell v75.

## 4.2.0 — Insider buying (Form 4) + Position Playbook + sell discipline - 2026-07-25

- New INSIDER SIGNAL from SEC Form 4 (`scripts/collect_insiders.py`, keyless EDGAR). The asymmetry is the model: open-market PURCHASES (transaction code P) are the signal — cluster buys (2+ distinct insiders in 90 days) and CEO/CFO buys weighted highest — while sales are treated as weak context, never a mirror image, because insiders sell for taxes and diversification. Grants (A), option exercises (M), tax withholding (F), gifts (G) and conversions (C) are parsed, labelled as compensation mechanics, and excluded from the signal. Rule 10b5-1 pre-scheduled trades are detected via BOTH the post-2022 `<aff10b5One>` checkbox and footnote text, and kept out of the conviction set.
- Collector is budgeted and permanently cached per accession (a filed Form 4 never changes), so a cold cache cannot blow the daily workflow — whatever the budget does not reach resumes the next run, and coverage is reported honestly (`scanned`, `partial`) rather than silently truncated. Runs `continue-on-error`; a failure keeps the previous bundle.
- Insider buying becomes the CONVICTION BOARD's 10th independent vote, gains an INSIDER type in the What Changed feed (cluster 88 / senior 80 / 2+ buyers 74 / single 62; one-sided selling only 55 and only when nobody is buying), a per-ticker card, an ACTIVE SETUPS panel, and an Easy Mode section ("the bosses are buying").
- New POSITION PLAYBOOK on every ticker page — the app's first answer to "how much, and what proves me wrong". Sizing is fixed-fractional risk: stake set so that being wrong down to the invalidation level costs `RISK_BUDGET_PCT` (1%) of the book, then scaled by net signal agreement, halved when the quality/data gate fails, and hard-capped at `MAX_POSITION_PCT` (6%). Volatile names therefore get SMALLER positions at equal conviction — verified by test. Invalidation is the wider of a 3-sigma volatility stop (from `dailyVolOf`, real daily closes, clamped 8-30%) and a 15% documented fallback, plus written fundamental break conditions decided before the position exists. Review date = next earnings, else 90 days. Percent-of-book only: the terminal never knows account size and never states dollar amounts.
- New SELL DISCIPLINE engine (`exitSignalsOf`) on Portfolio — the app's only exit-side logic, covering quality breakdown, negative signal confluence, downside drift, estimate cuts, tier-1 downgrades, insider selling and decelerating filings. Reports facts that changed, severity-weighted (THESIS INTACT / MINOR CRACKS / WATCH CLOSELY / THESIS BREAKING); never an instruction to sell.
- New CONCENTRATION engine (`portfolioRiskOf`) answering how many bets you actually have: narrative concentration (owning 5 AI-compute names is one bet wearing five tickers — measurable for the first time now that narratives exist), single-name >30%, sector >50%, and weight in sub-50 quality businesses.
- Tests: +27 assertions (214 total) plus a new Python fixture suite (`tests/test_form4_parse.py`, wired into CI) pinning the Form 4 parsing contract offline — transaction-code classification, 10b5-1 detection both ways, namespaced XML, missing amounts staying missing rather than zero, and cluster accounting. Browser smoke pins the playbook card and its sizing invariants.
- SBC_MODEL_VERSION 4.1.0 -> 4.2.0. App shell v74.

## 4.1.0 — Market Narratives + Conviction Board - 2026-07-24

- New MARKET NARRATIVES view (Signals menu): eleven curated story clusters — AI compute, AI power/datacenter, software under AI pressure, memory cycle, banks/rates, capital markets, managed care, defense, consumer trade-down, freight, energy — each scored 0-100 for heat, measured ONLY from members' own data: avg 1-month tape (weekly closes), breadth, net 30d analyst revisions, season beat share, tier-1 desk actions inside 10 days, whale 13F flows. Honesty gates: fewer than 2 present members or fewer than 2 live inputs -> no reading; every input used is evidenced on-screen as a "what the data says" bit; heat is never derived from opinions or scraped commentary.
- New CONVICTION BOARD atop Best Setups (pinned on Home + Easy Mode): convictionOf() fuses up to nine INDEPENDENT signals per name — Direction Edge, Beat Odds (reports inside 21 days, coverage >=55), post-earnings drift, RSI setup (washed-out only counts on quality names), analyst revisions, tier-1 rating actions, whale 13Fs (Berkshire weighted as its own voice), fresh filing diffs, narrative heat. Each votes +1/0/-1 with a stated reason; only 3+ agreeing signals make the board; objections are displayed, silent signals counted as silent, and HIGH CONFLUENCE requires 4+ bulls with zero bears. Framed on-screen as confluence, never certainty.
- Signals feed gains NARRATIVE events: build_signals.js loads the app bundle and runs the app's own narrativeHeatAll() (no duplicated math; whales.js added to its bundle so 13F flows feed CI heat) and diffs per-story heat/label vs the prior pass — label changes emit regime shifts (68), >=10-point heat moves emit momentum warnings (58). First pass records the baseline silently.
- Easy Mode gains "THE MARKET'S STORIES" (kid-language per heat label) and "WHEN ALL THE CLUES AGREE" (conviction translated); narrative events get plain-word translations.
- Tests: +18 assertions (187 total) — membership/input honesty gates, heat bounds and label bands, evidence-bit accounting, exact bull/bear/silent vote accounting, no-double-vote, board admission and net-agreement ranking, universe-membership typo guard for all 100 cluster members. Browser smoke walks the new view and pins app model 4.1.0 separately from the SEC pipeline stamp (4.0.0).
- SBC_MODEL_VERSION 4.0.0 -> 4.1.0 (additive engines; no existing formula changed). App shell v73.

## Universe expanded to 224 names - 2026-07-24

- Official universe grew 126 -> 224. 100 candidates were added across sectors the original set covered thinly (analog semis, regional banks, exchanges/ratings, managed care, staples, rails, defense); 98 promoted with full data. FI and MMC were dropped by reconcile_universe.py for insufficient annual revenue history, and ANSS/DFS were replaced (CTSH/SYF) after SEC's ticker map showed them acquired. The shipped count is the number of fully-backed names, never a target.
- Membership is data-driven everywhere: build_universe derives its size from GROUPS, run_tests reads UNIVERSE_COUNT from universe.json with proportional coverage gates, new check_universe.js gates layer agreement, and app.js's runtime validator now enforces a 126-name floor instead of an exact count.
- SYF and AFL join the acknowledged NOT-RANKED list: like C/CB, neither Yahoo nor SEC populates a ShareBasedCompensation tag for them, so owner earnings cannot be computed and are correctly refused rather than invented.
- Coverage at 224: 217 ranked, RSI on all 224, 35 names passing the Best Setups quality gate, 55 sectors. App shell v72.

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
