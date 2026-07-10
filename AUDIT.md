# SBC TERMINAL — Repository Audit & Credibility Upgrade (v2.1, 2026-07)

## 1. Repository audit (as found before this upgrade)

**Architecture.** Static, dependency-free PWA: `index.html` (shell/styles), `app.js`
(one IIFE: all engines + views), `charts.js` (SVG charts), `data.js` (650 tickers ×
{quote snapshot, 4y annual + 5q quarterly fundamentals, balance sheet `gd`, quality
`qm`, options `opt`, segments via `segments.js`, sector ETFs via `sectors.js`}),
`scripts/` (keyless Yahoo refreshers), service worker + manifest (offline/phone).
Views: stock page (7 tabs) + 12 tool views, all reading one verdict engine.

**Findings (and disposition):**

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | Finnhub API key hard-coded in `app.js` (public repo) | HIGH | **FIXED** — removed from source; keys are user-supplied via ⚙. **The old key is in git history: ROTATE IT at finnhub.io.** |
| 2 | Overview price chart was a deterministic synthetic path labeled "illustrative" | HIGH (credibility) | **FIXED** — `fakePricePath` deleted. Chart now renders only real 12-month weekly closes (`px:{}` blocks, Yahoo) with period provenance, or an explicit empty state. |
| 3 | "TRUE P/E", "TRUE OWNER EARNINGS", "TRUE SBC-ADJ EPS" labels overstate certainty | HIGH (credibility) | **FIXED** — renamed to "EST OWNER-EARNINGS P/E", "ESTIMATED OWNER EARNINGS", "EST OWNER EPS" everywhere user-facing. (Internal field names like `truePE` unchanged — display only.) |
| 4 | Price-derived multiples (`headlinePE`, est P/E) computed once at data-build; live quotes didn't recompute them → stale-data risk | MEDIUM | **FIXED** — live quote updates now recompute price-derived multiples in place. |
| 5 | No data-quality/provenance labeling | MEDIUM | **FIXED** — every stock header shows a badge (HEURISTIC / PARTIALLY VERIFIED) with tooltip; provenance line (source, formula version) under the tabs. Nothing is FILING VERIFIED — see limitations. |
| 6 | localStorage key storage described neutrally | LOW | **FIXED** — modal now states it is NOT secure storage. |
| 7 | Derived metrics stored in `data.js` (`ownersKeep`, `truePE`, buckets) rather than computed from raw inputs | MEDIUM | **PARTIAL** — price-derived ones now recompute live; `ownersKeep`/buckets remain stored judgments/derivations, labeled as heuristic. Full raw-input engine is the next milestone (see §4). |
| 8 | Owner-earnings model approximates SBC economic cost (min(buyback,SBC) + 25% withholding proxy) instead of the full share-reconciliation model | MEDIUM | **OPEN** — requires per-name equity-statement inputs (tax withholding, option/ESPP proceeds, acquisition shares) that Yahoo's aggregator does not expose. Needs SEC XBRL (`companyfacts` API) ingestion. Documented as heuristic in-app. |
| 9 | No "guaranteed" claims, no fake Greeks/chains/IV found | — | Options data is real (per-name ~35d ATM IV, realized vol, OI from Yahoo chains). Premium estimates are Black-Scholes on stored ATM vol and labeled as model estimates, not quotes. |
| 10 | Duplicate calculations | LOW | One brain (`verdictOf`) feeds rankings/screener/options/tech desk; legacy per-view scores were removed in the brain refactor. |

## 2. What was implemented in this pass (PRIORITY 1 — credibility)

- Exposed API key removed from source (rotate the old one).
- Synthetic price chart removed; real 12-month weekly closes bundled for the
  universe via `scripts/gen_prices.py`; explicit empty state when absent.
- Misleading labels renamed app-wide (est owner-earnings P/E, estimated owner earnings).
- Data-quality badges + per-stock provenance line + formula version (`v2.1`).
- Stale price-derived multiples now recompute on live quotes.
- Honest key-storage wording.

## 3. Formula documentation (current, v2.1)

- **Estimated owner earnings** = GAAP NI + GAAP SBC − est. economic SBC cost,
  where est. cost ≈ min(buybacks, SBC) anti-dilution offset + 25%-of-SBC
  withholding proxy. *Heuristic — see §4 for the planned filing-grade model.*
- **Est owner-earnings P/E** = headline P/E ÷ owner-retention (ownersKeep).
- **IV ladder** = 15y 3-stage DCF on est. owner EPS (growth from actual revenue
  CAGR blend, quality-capped; 4th stage for `inflecting`); IVr solves DCF(r)=price
  by bisection. Growth case lifts caps; the brain prices 65% conservative + 35% growth case.
- **Graham layer** = NCAV, Graham Number √(22.5·EPS·BVPS), 7-point defensive checklist.
- **Capex efficiency** = incremental revenue per cumulative capex $, intensity-
  weighted; debt-funded holes penalized.
- **Brain score** = weighted votes (SBC 20, IV 25, Graham 15, Quality 20, Capital
  return 10, Flow 10, Capex 8, Insiders 5 when live) → one call with reasons.
- **Options desk** = plays gated by brain calls; strikes from IV ladder; premiums =
  Black-Scholes on stored ~35d ATM IV (labeled estimates); IV/RV richness gate.

## 4. Known limitations / next milestones (honest list)

1. **Nothing is FILING VERIFIED.** All fundamentals are Yahoo aggregator data.
   Filing-grade owner earnings needs SEC XBRL ingestion (equity statement: tax
   withholding on vested awards, option/ESPP proceeds, acquisition/raise shares)
   and a share-count reconciliation table per the spec (Phase 5) — largest open item.
2. Options: one ~35d snapshot per name (ATM IV, OI, P/C), refreshed by script —
   not a live full chain with per-contract Greeks. In-browser live chains are
   blocked by CORS on free sources; needs a paid options API (Polygon/Tradier/ORATS).
3. News is headline-level (Finnhub), not the Phase-18 intelligence pipeline.
4. Multiyear pooled retention, one-time-item normalization bridge, reverse DCF,
   sector engines beyond financial-sector guards, IV-crush matrix, per-contract
   scoring, thesis journal event-review loop: designed but not yet built.
5. Quarterly data limited to last 5 quarters; annual to ~4-5 years (Yahoo free depth).
6. No automated unit tests yet — engines live inside the app IIFE; verification is
   scripted browser evals. Extracting `engines.js` for node tests is queued.

## 5. Real data vs. what needs a paid API

- **Real, bundled, refreshable (free):** quotes, 4-5y annual + 5q quarterly
  fundamentals, balance sheets, FCF/capex, ~35d ATM IV + realized vol + OI,
  12m weekly prices, sector ETF flows, segment revenue (hand-checked, 42 names).
- **Real, live (free key, user-supplied):** Finnhub quotes/news/earnings
  calendar/insider transactions, scoped to visible watchlist.
- **Needs paid API:** live full options chains + Greeks, tick/intraday prices,
  transcripts, institutional news feeds.

## 6. Migration & deployment

- No schema migration needed; new `px:{}` blocks are additive.
- Refresh cadence: `python scripts/update_data.py` (fundamentals+quotes+sectors),
  `--options` (IV/RV/OI, ~15 min), `scripts/gen_prices.py` (12m weekly closes).
- Deploy: push to `main`; GitHub Pages serves it. If Pages hangs "building" >10 min:
  `gh api repos/<owner>/sbc-terminal/pages/builds -X POST`.
- Users must supply their own Finnhub key via ⚙ (the previously shipped key is
  removed and should be rotated).

---

# Adversarial self-audit (v2.2, 2026-07) — assuming real money

Regression harness: `node tests/run_tests.js` — loads the **production**
`app.js`/`data.js` in Node and tests the live engines (23 assertions: put-call
parity, ladder monotonicity, buyback fixtures incl. M&A trap, owner-earnings
identities, expired-chain exclusion, full-650 brain sweep). All passing.

## FIXED (this pass)

1. **Options staleness (worst find).** `dte` was frozen at fetch time — a week
   later every annualized yield, expiry label, and premium estimate was silently
   wrong. Now: days-to-expiry recomputed from the stored expiry at runtime;
   chains <7 days out are excluded from premium estimates; the Vol Board shows
   the IV snapshot date and a loud ⚠ when it is >7 days old.
2. **Buyback misclassification (M&A trap).** Buyback-vs-SBC dollar split could
   label a company "real reduction" while the share count *rose* (acquisition/
   raise issuance, e.g. AVGO-style). Now cross-checked against the actual share
   count; contradictions are flagged "split uncertain" and never shown green.
   Regression-tested with a fixture.
3. **Silent earnings-check failure.** If the earnings-calendar fetch failed (or
   no key), option plays showed no earnings warnings at all — the most dangerous
   silent failure in the desk. Now a loud banner states whether earnings dates
   were checked, are being checked, failed, or cannot be checked.
4. **Snapshot age invisible.** Header said "snapshot" without a date. Now shows
   the snapshot date and "— not live".
5. **Risk disclosure.** CSP section states capital at risk = strike × 100 and
   that the highest yields carry the highest assignment risk (yield-sorting
   otherwise rewards the junkiest vol). Calls section states max loss = 100% of
   premium.
6. **Stale price history.** 12-month chart flags itself STALE if its last close
   is >14 days old.
7. **Graham share-basis.** Disclosed that per-share anchors use diluted
   weighted-average shares, not period-end actual (aggregator limit).
8. **No-fabrication guards verified by test:** negative-EPS names get NO fair
   value ladder; zero-DTE options price as null, never 0-or-fake.

## PARTIALLY FIXED

- **Stale quotes**: snapshot date now shown and live quotes recompute derived
  multiples; but bundled prices still age between refreshes — refresh cadence is
  manual (`update_data.py`). Mitigated, not eliminated.
- **Derived judgments stored in data** (`ownersKeep`, buckets): labeled HEURISTIC
  with provenance; still not recomputed from raw inputs at runtime.
- **Lottery-option risk**: gates (quality ≥ thresholds, IV/RV, brain call) plus
  new assignment-risk warning; but there is still no per-contract liquidity/
  spread scoring (needs chain-level data — see paid).

## NOT YET IMPLEMENTED (from the 29-phase spec)

- Reverse DCF / scenario DCF UI; multiyear pooled retention selector; one-time-
  item normalization bridge; sector engines beyond financials guards; IV-crush
  matrix; shares-vs-call-vs-spread comparator; portfolio Greeks & sizing
  warnings; thesis journal event reviews; news intelligence pipeline; alerts
  engine; virtualized lists.

## REQUIRES PAID DATA

- Live full options chains, per-contract bid/ask/OI/volume and Greeks, IV rank/
  percentile history (Polygon/Tradier/ORATS-class). Current options layer is a
  real but single ~35-day ATM snapshot per name, refreshed by script.
- Intraday/tick prices; transcripts; institutional news wires.

## REQUIRES MANUAL FILING VERIFICATION

- Everything labeled HEURISTIC/PARTIALLY VERIFIED. Filing-grade owner earnings
  (Phase-5 share reconciliation: withholding cash, option/ESPP proceeds,
  acquisition shares, period-end share counts) needs SEC XBRL ingestion plus
  human reconciliation before any name can be marked FILING VERIFIED.
