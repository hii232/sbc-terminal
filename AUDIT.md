# SBC Terminal Audit

Date: 2026-07-15
Model: `SBC_MODEL_VERSION = "4.0.0"`
Universe: exactly 120 official companies

## Current Gate

Passing local checks:

- `node tests/run_tests.js` - 104 passed, 0 failed
- `python scripts/golden_audit.py` - 83 verified fields, 0 conflicts
- `node tests/browser_smoke.js` - opens all 120 companies, core tools, mobile layout, and offline reload
- universe/security gate - exactly 120 official companies, 120 DATA rows, 120 SEC rows, no FLUT, no duplicate tickers, SEC source files present, simple secret scan clean

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

## Deployment Rule

Do not deploy unless:

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

---

# v3.0 (2026-07) — response to external audit: owner-economics engine rebuilt

**External-audit triage:** several flagged items (exposed key, synthetic chart,
"True" labels, missing Options desk) were reviewed against a stale cache — the
live main serves v19+ with all of them fixed (curl-verified). The following
were VALID and are now fixed:

1. **Pure-diluter failure (Critical 1) — FIXED.** Economic SBC cost is now
   `max(GAAP SBC, market value of reconciled employee shares) + 25% withholding`.
   A no-buyback diluter can never again show owner earnings above net income.
   Regression-tested (fixtures 4.x).
2. **Manual ownersKeep (Critical 2) — FIXED for 588/650.** Retention is now
   COMPUTED at runtime: pooled multi-year Σowner/ΣNI with the latest year
   share-reconciled (Δshares + buyback$/avg-price, capped at 1.5×SBC$/avg-price;
   excess flagged as non-SBC issuance). Fallback names (pooled NI ≤ 0) keep the
   seeded heuristic and are labeled `fallback`. Est-P/E and owner-EPS derive
   from the computed value — recomputed after any live financials merge.
3. **M&A share misclassification (Critical 3) — FIXED.** Issuance beyond what
   SBC can explain is excluded from SBC cost and flagged; auto-derived names
   bucketed "tragic" purely from such issuance are reclassified at runtime
   (e.g. Smurfit Westrock: tragic/F → middle/C, flagged "non-SBC issuance").
4. **Live data not recomputing the model (Critical 4) — FIXED.** One function
   (`recomputeOwnerEconomics`) owns retention/est-P/E/owner-EPS; runs at load
   and after FMP merges.
5. **"Money flow" (Critical 7) — RENAMED** to TRADING-ACTIVITY SHARE with an
   explicit "volume has a buyer and a seller" disclosure. Brain vote renamed
   SECTOR MOMENTUM (it is price momentum).
6. **Narrative "odds" (Critical 8) — RENAMED** to momentum scores "(heuristic,
   not a probability)". The only remaining "odds" are Polymarket's real
   market-implied odds, which is the correct term.
7. **Brain false precision — FIXED.** Verdict shows a HEURISTIC SCORE BAND
   (±6) plus DATA CONFIDENCE (LOW / MEDIUM / MEDIUM-HIGH; HIGH is reserved for
   filing-verified data, which does not exist yet).
8. **Fat Pitch language** — zone descriptions now say "model-implied … a
   scenario, not a promise"; buyback accretion notes it compares against
   today's model value, not historical purchase prices.

Tests: 30 assertions, all passing (`node tests/run_tests.js`).
Still open (unchanged): SEC XBRL filing verification, paid options chains,
news intelligence, reverse DCF — see §4 above.

---

# v4.0 (2026-07) — ELITE rebuild: 60-stock universe, SEC filings as primary source

- **Universe**: exactly 60 approved names (`universe.json`, UNIVERSE_VERSION
  1.0.0, CIKs from SEC's own ticker map). App refuses to boot on any violation.
  The 650-name expansion was REMOVED (DATA.length === 60).
- **SEC XBRL ingestion** (`scripts/sec_ingest.py`): 10 years of annual facts for
  9 core fields across all 60 CIKs; every value carries form / filed date /
  accession number / XBRL tag / period; amended filings supersede (older kept);
  facts merged across candidate tags per period (fixes tag-switch truncation).
  Raw extracts in `data/raw/`, clean layer in `data/companies/`, app bundle `sec.js`.
- **Cross-check layer**: aggregator vs SEC at load; badges FILING VERIFIED* (43)
  / PARTIALLY VERIFIED (16) / HEURISTIC (1); 23 field-level conflicts remain
  flagged (tag/period differences) — never silently resolved. $50M materiality
  floor on dollar comparisons.
- **SEC-authoritative repair (case study)**: the cross-check caught the
  aggregator reporting diluted shares at 4× (CRWD), 10× (KLAC) and 25× (BKNG)
  the filed counts — corrupted series that had been silently poisoning
  per-share math. The app now adopts the 10-K values with a VISIBLE repair
  record (`sharesAggregatorRejected`), shown in the SEC FILING CHECK card.
- **SEC-reported SBC tax withholding** now feeds owner earnings for 47/60 names
  (replaces the 25% proxy; source labeled per name).
- **Golden 12-company audit**: 58 fields verified, 0 conflicts
  (`data/audits/golden-company-audit.json`).
- **Automation**: GitHub Actions — tests on push; weekday data refresh with
  tests gating the commit. No API keys anywhere in the repo.
- **Tests**: 44 assertions incl. universe validation, provenance integrity,
  missing≠zero, share-repair verification — all passing.
