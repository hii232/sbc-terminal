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
