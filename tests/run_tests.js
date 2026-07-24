/* SBC TERMINAL — regression tests against the PRODUCTION engines.
   Loads the real data.js / app.js in Node with browser stubs and tests
   window.__engines. Run:  node tests/run_tests.js                      */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---- browser stubs (enough for module load; init() is never called) ----
global.window = { addEventListener: () => {}, __engines: null };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.document = { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] };
global.navigator = {};
global.history = { state: null, pushState: () => {}, replaceState: () => {} };
global.fetch = () => Promise.reject(new Error("no network in tests"));

const root = path.join(__dirname, "..");
const src = ["universe.js", "data.js", "sec.js", "segments.js", "sectors.js", "estimates.js", "earnings.js", "signals.js", "blackrock.js", "scores.js", "charts.js", "app.js"]
  .map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");
vm.runInThisContext(src, { filename: "bundle.js" });
const E = global.window.__engines;
if (!E) { console.error("FATAL: __engines not exported"); process.exit(1); }

let pass = 0, fail = 0;
const ok = (cond, name, detail = "") => {
  if (cond) { pass++; }
  else { fail++; console.error("  ✗ FAIL:", name, detail); }
};

// =============== Drawdown calculation ===============
{
  const sample = E.tickerDrawdown({
    ticker: "TEST",
    price: 104,
    px: { from: "2025-07-01", to: "2026-07-01", v: [100, 105, 110, 115, 120, 90, 100, 130, 110, 104] },
  });
  ok(sample && sample.current === -20, "drawdown uses latest price versus running peak", String(sample?.current));
  ok(sample && sample.worst === -25, "drawdown identifies worst decline", String(sample?.worst));
  ok(sample && sample.peak === 130, "drawdown preserves running peak", String(sample?.peak));
}

// =============== 1. Null-safety primitives ===============
{
  ok(E.lastVal([]) === null, "lastVal([]) -> null, never fake zero");
  ok(E.lastVal([null, undefined, 0]) === 0, "lastVal preserves real zero");
}

// =============== 2. IV ladder invariants (production data) ===============
{
  let checked = 0, monotonic = 0, nanFree = 0;
  for (let i = 0; i < DATA.length; i += 2) {
    const d = DATA[i], L = E.ivLadder(d);
    if (!L) continue;
    checked++;
    if (L.IV20 < L.IV18 && L.IV18 < L.IV15 && L.IV15 < L.IV12 && L.IV12 < L.IV10 && L.IV10 < L.IV8) monotonic++;
    if ([L.IV15, L.impliedCAGR, L.FV].every(v => Number.isFinite(v))) nanFree++;
  }
  ok(checked > 20, "IV ladder sampled enough names", String(checked));
  ok(monotonic === checked, "IV20<IV18<IV15<IV12<IV10<IV8 for all", `${monotonic}/${checked}`);
  ok(nanFree === checked, "ladder outputs finite", `${nanFree}/${checked}`);
  // loss-maker: no owner earnings -> no ladder (never a fake fair value)
  const loser = DATA.find(d => d.gaapEPS != null && d.gaapEPS <= 0);
  if (loser) ok(E.ivLadder(loser) === null, "negative-EPS name gets NO ladder", loser.ticker);
}

// =============== 3. Buyback classification fixtures ===============
{
  const base = { ticker: "TEST", price: 100, ownersKeep: 0.9, shares: [1, 1, 1, 1] };
  // pure diluter: no buybacks, shares rising
  const diluter = { ...base, buyback: [0, 0, 0, 0], sbc: [1, 1, 1, 1], shares: [1, 1.05, 1.1, 1.16] };
  ok(E.buybackQuality(diluter).real === 0 && E.buybackQuality(diluter).anti === 0, "pure diluter: no buyback credit");
  // aggressive repurchaser: bb >> sbc, shares falling
  const shrinker = { ...base, buyback: [0, 0, 0, 10], sbc: [0, 0, 0, 1], shares: [1.2, 1.1, 1.0, 0.9] };
  const bq1 = E.buybackQuality(shrinker);
  ok(bq1.real > bq1.anti && !bq1.uncertain, "real repurchaser classified real, not uncertain");
  // M&A trap: bb > sbc in dollars BUT share count did not fall -> must flag uncertain
  const mna = { ...base, buyback: [0, 0, 0, 10], sbc: [0, 0, 0, 1], shares: [1.0, 1.1, 1.3, 1.4] };
  const bq2 = E.buybackQuality(mna);
  ok(bq2.uncertain === true, "M&A/raise issuance flags classification as UNCERTAIN");
  ok(/uncertain/i.test(bq2.t), "uncertainty is stated in the label");
}

// =============== 4. Owner-earnings fixtures ===============
{
  // zero SBC: owner earnings == NI
  const clean = { ni: [5, 5, 5, 5], sbc: [0, 0, 0, 0], buyback: [1, 1, 1, 1] };
  const oe = E.trueOwnerEarnings(clean);
  ok(Math.abs(oe.owner - 5) < 1e-9, "zero-SBC: owner earnings == net income", String(oe.owner));
  // THE PURE-DILUTER TEST (v3): a company paying employees in stock with no
  // buybacks must NEVER show owner earnings above net income.
  const diluter = { ni: [4], sbc: [2], buyback: [0] };
  const oe2 = E.trueOwnerEarnings(diluter);
  ok(oe2.owner < oe2.ni, "PURE DILUTER: owner earnings BELOW net income", `owner=${oe2.owner} ni=${oe2.ni}`);
  ok(Math.abs(oe2.owner - (oe2.ni + oe2.sbc - oe2.trueCost)) < 1e-9, "identity: NI + SBC - trueCost");
  ok(Math.abs(oe2.trueCost - 2.5) < 1e-9, "no-share-data: cost = GAAP SBC floor + 25% withholding", String(oe2.trueCost));
  // diluter WITH share data: employee shares priced at market, capped at
  // 1.5x SBC value; the excess is flagged as non-SBC issuance (M&A/raise)
  const dil2 = { ni: [10, 10], sbc: [2, 2], buyback: [0, 0], shares: [1, 1.1], px: { v: [50, 50, 50] }, price: 50 };
  const oe4 = E.trueOwnerEarnings(dil2);
  ok(oe4.owner < 10, "share-reconciled diluter: owner < NI", String(oe4.owner));
  ok(oe4.mnaShares > 0, "issuance beyond SBC cap flagged as non-SBC (M&A/raise)", String(oe4.mnaShares));
  ok(Math.abs(oe4.shareCost - 3) < 1e-9, "employee share cost = capped shares x avg price", String(oe4.shareCost));
  // negative NI: identity holds, GAAP-SBC floor applies, no fabricated positives
  const loser = { ni: [-2], sbc: [1], buyback: [0] };
  const oe3 = E.trueOwnerEarnings(loser);
  ok(Math.abs(oe3.owner - (-2 + 1 - 1.25)) < 1e-9, "negative NI handled by identity (GAAP-SBC floor)");
  const missing = { ticker: "MISS", ni: [5], sbc: [null], buyback: [1], shares: [1], price: 10, gaapEPS: 5, headlinePE: 2 };
  const blocked = E.trueOwnerEarnings(missing);
  ok(blocked.insufficientData === true && blocked.owner === null && blocked.trueCost === null, "missing SBC cannot produce owner earnings");
  ok(E.verdictOf(missing).noRank === true, "missing required data cannot enter verdict/ranking");
}

// =============== 6. Brain sanity across the full production universe ===============
{
  let bad = [];
  for (const d of DATA) {
    const V = E.verdictOf(d);
    if (V.noRank) {
      if (V.score !== null || V.call !== "NOTRANK") bad.push(d.ticker);
    } else if (!(V.score >= 0 && V.score <= 100) || !V.call || !V.C) bad.push(d.ticker);
  }
  ok(bad.length === 0, "verdictOf: rankable names score; only truly missing-data names are NOTRANK", bad.slice(0, 5).join(","));
}

// =============== 6b. Direction Edge sanity across the full universe ===============
{
  const validLabels = new Set(["LIKELY UP", "UP BIAS", "NO EDGE", "DOWN BIAS", "LIKELY DOWN", "LOW CONFIDENCE"]);
  let bad = [], lowCoverage = 0, hasMissing = 0;
  for (const d of DATA) {
    const edge = E.directionEdgeOf(d);
    if (!edge || !Number.isFinite(edge.score) || edge.score < 0 || edge.score > 100) bad.push(`${d.ticker}:score`);
    if (!Number.isFinite(edge.coverage) || edge.coverage < 0 || edge.coverage > 100) bad.push(`${d.ticker}:coverage`);
    if (!validLabels.has(edge.label)) bad.push(`${d.ticker}:label:${edge && edge.label}`);
    if (!Array.isArray(edge.parts) || edge.parts.length < 6) bad.push(`${d.ticker}:parts`);
    if (edge.coverage < 45) lowCoverage++;
    if (edge.missing && edge.missing.length) hasMissing++;
  }
  ok(bad.length === 0, "directionEdgeOf: finite 0-100 score, valid label, valid parts for every name", bad.slice(0, 8).join(","));
  ok(lowCoverage >= 0, "directionEdgeOf: low coverage names handled without crashing", String(lowCoverage));
  ok(hasMissing > 0, "directionEdgeOf: source gaps are explicitly tracked", String(hasMissing));
}

// =============== 7. Graham engine guards ===============
{
  let nanBad = [];
  for (let i = 0; i < DATA.length; i += 2) {
    const G = E.grahamOf(DATA[i]);
    if (G && [G.score, G.passed].some(v => !Number.isFinite(v))) nanBad.push(DATA[i].ticker);
  }
  ok(nanBad.length === 0, "grahamOf outputs finite", nanBad.join(","));
}

// =============== 8. Runtime-computed retention (no manual ownersKeep) ===============
{
  let computed = 0, sane = 0, sampled = 0, consistent = 0;
  for (let i = 0; i < DATA.length; i += 1) {
    const d = DATA[i]; sampled++;
    if (d.keepSource === "computed") computed++;
    if (d.ownersKeep == null || (d.ownersKeep >= 0.30 && d.ownersKeep <= 0.98)) sane++;
    if (d.truePE == null || d.ownerEps == null || Math.abs(d.truePE - d.price / d.ownerEps) < 0.2) consistent++;
  }
  ok(computed / sampled > 0.7, "retention COMPUTED (not manual) for >70% of sample", computed + "/" + sampled);
  ok(sane === sampled, "retention within [0.30, 0.98] or unavailable", sane + "/" + sampled);
  ok(consistent === sampled, "est P/E == price / direct owner EPS", consistent + "/" + sampled);
  const mu = DATA.find(d => d.ticker === "MU");
  ok(mu && /TTM quarterly/.test(mu.ownerEpsSource) && mu.truePE < 35,
    "MU owner P/E uses comparable TTM owner EPS, not stale annual EPS",
    mu ? `${mu.truePE}x from ${mu.ownerEpsSource}` : "MU missing");
  const headlineMismatch = DATA.filter(d => d.gaapEPS > 0 && d.headlinePE && d.price &&
    Math.abs(d.headlinePE - d.price / d.gaapEPS) > 0.6);
  ok(headlineMismatch.length === 0, "headline P/E reconciles to price / GAAP EPS for the whole universe",
    headlineMismatch.map(d => d.ticker).join(","));
  const rankedAnnualBasis = DATA.filter(d => E.dataConfidenceOf(d).rankable && d.truePE && !/TTM quarterly/.test(d.ownerEpsSource || ""));
  // 126-universe: TRV/ALL/HIG run on annual SEC basis until their first quarterly ingest
  ok(rankedAnnualBasis.length <= 21, "ranked valuation mostly uses TTM owner EPS; annual-basis exceptions are visible",
    rankedAnnualBasis.map(d => `${d.ticker}:${d.ownerEpsSource}`).join(","));
  const forwardRows = DATA.map(d => ({ d, f: E.forwardPEOf(d) })).filter(x => E.dataConfidenceOf(x.d).rankable && x.f.pe != null);
  ok(forwardRows.length >= 45, "forward P/E available for most rankable names", String(forwardRows.length));
  const muFwd = E.forwardPEOf(mu);
  ok(muFwd.pe > 0 && muFwd.pe < mu.truePE, "MU forward P/E appears beside owner P/E and is finite", `${muFwd.pe}x`);
}

// =============== 9. Universe + SEC filing layer ===============
{
  const expected = typeof UNIVERSE_LIST !== "undefined" ? UNIVERSE_LIST.length : 0;
  ok(expected === 126, "UNIVERSE_LIST length is exactly 126", String(expected));
  ok(DATA.length === 126, "DATA length is exactly 126", String(DATA.length));
  ok(!UNIVERSE_LIST.some(u => u.ticker === "FLUT"), "FLUT is not in official universe");
  ok(!DATA.some(d => d.ticker === "FLUT"), "FLUT is not in DATA");
  ok(UNIVERSE_LIST.some(u => u.ticker === "TSM" && u.cik10 === "0001046179"), "TSM is in official universe with SEC CIK");
  ok(DATA.some(d => d.ticker === "TSM" && d.sector === "Semis/Foundry"), "TSM has a DATA financial row");
  ok(new Set(UNIVERSE_LIST.map(u => u.ticker)).size === expected, "no duplicate tickers");
  ok(UNIVERSE_LIST.every(u => u.cik && u.name && u.sector), "every name has identity + CIK");
  const uniSet = new Set(UNIVERSE_LIST.map(u => u.ticker));
  ok(DATA.every(d => uniSet.has(d.ticker)), "no unapproved tickers in DATA");
  ok(DATA.every(d => d.ticker && d.name && d.sector && d.price != null), "all 126 official names carry identity and quote snapshot");
  ok(UNIVERSE_LIST.every(u => DATA.some(d => d.ticker === u.ticker)), "every approved universe ticker has a DATA financial row");
  // SEC layer integrity: provenance on every fact
  ok(typeof SEC !== "undefined" && Object.keys(SEC).length === 126, "SEC facts for exactly 126 official names", `${Object.keys(SEC || {}).length}/126`);
  let provOk = 0, checked = 0;
  for (const tk of Object.keys(SEC)) {
    const f = SEC[tk].f.revenue;
    if (f) { checked++; if (f.form && f.filed && f.accn && f.tag) provOk++; }
  }
  ok(provOk === checked && checked >= 115, "every SEC fact carries form+filed+accession+tag", `${provOk}/${checked}`);
  // cross-check ran: verified majority, conflicts flagged not hidden
  const full = DATA.filter(d => E.dataQualityOf(d).label === "FULL FILING VERIFIED").length;
  const core = DATA.filter(d => E.dataQualityOf(d).label === "CORE FILING VERIFIED").length;
  // Fully verified count moves as the official universe grows; the rest are PARTIAL.
  // 20-F filers, tag variants) — tracked in AUDIT.md as the next data milestone
  ok(full >= 85, "85+ names FULL FILING VERIFIED", String(full));
  ok(full + core >= 100, "100+ names full/core filing verified", `${full + core}/${expected}`);
  const partial = DATA.filter(d => ["FULL FILING VERIFIED", "CORE FILING VERIFIED", "PARTIALLY VERIFIED"].includes(E.dataQualityOf(d).label)).length;
  ok(partial >= expected - 1, "all but at most one name at least partially SEC-verified", `${partial}/${expected}`);
  ok(DATA.every(d => d.secv), "secCheck ran for every name");
  ok(!src.includes("nothing filing-verified"), "no stale contradictory filing-verification wording");
  // missing is NOT zero: fixture with no SBC data must not produce computed retention
  const noSbc = { ticker: "XX", ni: [5, 5, 5], sbc: [null, null, null], buyback: [1, 1, 1], price: 10, gaapEPS: 1, headlinePE: 10, ownersKeep: 0.9 };
  const st = E.trueOwnerEarnings(noSbc);
  ok(st.sbcMissing === true && st.owner === null, "missing SBC flagged as missing, not zero");
  // A company that runs no buyback program has a KNOWN zero, not missing data —
  // it must stay rankable. (Regression guard: a refresh once nulled absent
  // buybacks and dropped TSLA/ARM/RBLX/IREN/NEE out of the ranking.)
  const noBuyback = E.buybackQuality({ buyback: [0, 0, 0, 0], sbc: [0.2, 0.2, 0.2, 0.2], shares: [1, 1, 1, 1] });
  ok(noBuyback.insufficientData !== true && noBuyback.t === "No buybacks", "zero-buyback company is a known zero, not insufficient data", JSON.stringify(noBuyback.t));
  const missingBuyback = E.buybackQuality({ buyback: [null, null, null, null], sbc: [0.2, 0.2, 0.2, 0.2] });
  ok(missingBuyback.insufficientData === true, "genuinely missing buyback stays flagged insufficient (not coerced to zero)");
  const rankedUniverse = DATA.filter(d => E.rankOf(d).noRank !== true);
  ok(rankedUniverse.length >= 116, "116+ official names enter the main ranking when owner earnings can be computed", String(rankedUniverse.length));
  const lowConfidenceRanked = DATA.filter(d => E.dataConfidenceOf(d).score < 80 && E.rankOf(d).noRank !== true);
  ok(lowConfidenceRanked.length >= 6, "low-confidence names are ranked with caution instead of hidden",
    lowConfidenceRanked.map(d => `${d.ticker}:${E.dataConfidenceOf(d).score}`).join(","));
  const stillBlocked = DATA.filter(d => E.rankOf(d).noRank === true);
  const sourceBlocked = new Set(["C", "XOM", "CVX", "SCCO", "CB"]);
  ok(stillBlocked.length <= 5 && stillBlocked.every(d => sourceBlocked.has(d.ticker)),
    "only source-proof gaps remain NOT RANKED", stillBlocked.map(d => d.ticker).join(","));
  const verifiedYoung = ["CRWD", "PLTR", "UBER"].map(t => DATA.find(d => d.ticker === t));
  ok(verifiedYoung.every(d => d && E.dataConfidenceOf(d).score >= 80 && E.rankOf(d).noRank !== true),
    "verified owner-EPS names rank even when retention history is unavailable",
    verifiedYoung.map(d => d && `${d.ticker}:${E.dataConfidenceOf(d).score}/${E.rankOf(d).noRank ? "blocked" : "ranked"}`).join(","));
  const tsm = DATA.find(d => d.ticker === "TSM");
  ok(tsm && tsm.truePE != null && tsm.ownerEps != null && E.rankOf(tsm).noRank !== true,
    "TSM ranks with ADR-aligned owner EPS", tsm ? `${tsm.truePE}x / ${tsm.ownerEps}` : "TSM missing");
}

// =============== 10. SEC period alignment ===============
{
  const n = DATA.find(d => d.ticker === "NVDA");
  ok(n.annualPeriods.at(-1).periodEnd === "2026-01-25", "NVDA latest SEC period is FY ended 2026-01-25", n.annualPeriods.at(-1).periodEnd);
  ok(n.secPrimary.ocf.at(-1).periodEnd === "2026-01-25", "NVDA OCF uses exact latest periodEnd", n.secPrimary.ocf.at(-1).periodEnd);
  ok(n.secPrimary.capex.at(-1).periodEnd === "2026-01-25", "NVDA capex uses exact latest periodEnd", n.secPrimary.capex.at(-1).periodEnd);
  ok(n.secPrimary.revenue.at(-1).periodEnd === n.secPrimary.ocf.at(-1).periodEnd, "NVDA revenue and OCF periods align");
  ok(n.secv.periodMismatch.length === 0, "NVDA has no period mismatch after aligned SEC rebuild", JSON.stringify(n.secv.periodMismatch));
  ok(n.secv.conflict.length === 0, "NVDA period issues are not labelled source conflicts", JSON.stringify(n.secv.conflict));

  const crm = DATA.find(d => d.ticker === "CRM");
  const crmEnd = crm.annualPeriods.at(-1).periodEnd;
  ok(crmEnd === crm.secPrimary.revenue.at(-1).periodEnd, "CRM revenue matched by periodEnd, not fiscalYear label", crmEnd);
  ok(crm.secPrimary.ocf.at(-1).periodEnd === crm.secPrimary.revenue.at(-1).periodEnd, "CRM OCF aligns to same period as revenue");
  ok(crm.secPrimary.capex.at(-1).periodEnd === crm.secPrimary.revenue.at(-1).periodEnd, "CRM capex aligns to same period as revenue");
}

// =============== 11. News narrative scorer ===============
{
  const metaCompute = E.analyzeNews({
    headline: "Meta plans to sell excess AI compute capacity to outside customers",
    summary: "The move could add GPU supply to the market.",
    source: "fixture",
    datetime: Math.floor(Date.now() / 1000)
  }, "META");
  ok(metaCompute.score < -40, "META compute resale -> bearish impact score", String(metaCompute.score));
  ok(metaCompute.industries.includes("Semis/AI") && metaCompute.industries.includes("Neocloud"),
    "compute resale maps to semis + neocloud", metaCompute.industries.join(","));
  ok(metaCompute.tickers.includes("NVDA") && metaCompute.tickers.includes("CRWV"),
    "compute resale names affected semis/neocloud tickers", metaCompute.tickers.join(","));

  const capexUp = E.analyzeNews({
    headline: "Hyperscaler raises AI data center capex and places new GPU orders",
    source: "fixture"
  }, "MSFT");
  ok(capexUp.score > 30, "AI capex raise -> bullish infrastructure score", String(capexUp.score));
}

// =============== 11. Market/business score engine ===============
{
  const S = global.window.ScoreEngine;
  ok(!!S, "ScoreEngine exported on window");
  ok(S.MARKET_TERMINAL_VERSION === "4.1.0", "market terminal version 4.1.0");
  ok(!Object.prototype.hasOwnProperty.call(S.SCORE_WEIGHTS.longTermView, "dataConfidence"), "Data Confidence is not additive in long-term score");
  ok(!Object.prototype.hasOwnProperty.call(S.SCORE_WEIGHTS.marketRewardView, "dataConfidence"), "Data Confidence is not additive in market reward score");
  const ctx = { data: DATA, sectors: SECTORS, estimates: ESTIMATE_HISTORY };
  let scoreOk = 0, sixOk = 0, confidenceOk = 0;
  for (const d of DATA) {
    const s = S.scoreCompany(d, ctx);
    const keys = ["businessQuality", "growthExecution", "marketReward", "shareholderEconomics", "valuation", "dataConfidence", "longTermView", "marketRewardView"];
    const inRange = keys.every(k => s[k] && (s[k].score == null || (s[k].score >= 0 && s[k].score <= 100)));
    if (inRange) scoreOk++;
    if (["businessQuality", "growthExecution", "marketReward", "shareholderEconomics", "valuation", "dataConfidence"].every(k => s[k])) sixOk++;
    if (s.dataConfidence.score === E.dataConfidenceOf(d).score) confidenceOk++;
  }
  ok(scoreOk === DATA.length, "all market/business scores are bounded 0..100 or null", `${scoreOk}/${DATA.length}`);
  ok(sixOk === DATA.length, "six-score dashboard available for every ticker", `${sixOk}/${DATA.length}`);
  ok(confidenceOk === DATA.length, "ScoreEngine uses production Data Confidence gate", `${confidenceOk}/${DATA.length}`);

  const noHist = DATA.find(d => ESTIMATE_HISTORY[d.ticker] && ESTIMATE_HISTORY[d.ticker].snapshots.length === 0);
  if (noHist) {
    const mr = S.scoreCompany(noHist, ctx).marketReward;
    const epsRev = mr.details.find(x => x.k === "EPS estimate revisions");
    const revRev = mr.details.find(x => x.k === "Revenue estimate revisions");
    ok(epsRev.score === null && /unavailable/i.test(epsRev.why), "missing EPS revision history stays unavailable, not zero");
    ok(revRev.score === null && /unavailable/i.test(revRev.why), "missing revenue revision history stays unavailable, not zero");
  }
  const map = S.qualityMarketMap(DATA, ctx);
  ok(map.length === 126, "quality x market map covers exactly 126 tickers", String(map.length));
  ok(map.every(p => p.ticker && p.label), "quality map rows have ticker and label");
}

// =============== 12. Macro regime (computed from sector tape, never hardcoded) ===============
{
  const r = E.macroRegimeOf();
  ok(r && r.score >= 0 && r.score <= 100, "macro regime score bounded 0..100", JSON.stringify(r && r.score));
  ok(r && ["RISK-ON", "NEUTRAL", "RISK-OFF"].includes(r.label), "macro regime label is valid", r && r.label);
  ok(r && Number.isFinite(r.spy3) && Number.isFinite(r.breadth3), "regime derives from real SPY + breadth tape");
  ok(r && /^\d{4}-\d{2}-\d{2}$/.test(r.asOf), "regime carries the sector tape asOf date", r && r.asOf);
}

// =============== 13. Earnings focus calendar ===============
{
  // Week-agnostic: the bundle is refreshed regularly, so assert structure and
  // filtering behavior against its own asOf date instead of hardcoded tickers.
  const rows = E.EARNINGS_FOCUS && E.EARNINGS_FOCUS.rows || [];
  ok(rows.length >= 10, "earnings focus week is bundled", String(rows.length));
  ok(/^\d{4}-\d{2}-\d{2}$/.test(E.EARNINGS_FOCUS.asOf), "earnings focus week carries an asOf date");
  ok(rows.every(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.symbol && e.name), "bundled focus rows carry date, symbol and name");
  const asOf = new Date(`${E.EARNINGS_FOCUS.asOf}T12:00:00Z`);
  const from = new Date(asOf.getTime() - 864e5), to = new Date(asOf.getTime() + 14 * 864e5);
  ok(rows.every(e => {
    const d = new Date(`${e.date}T12:00:00Z`);
    return d >= from && d <= to;
  }), "bundled focus rows stay within two weeks of their asOf date");
  const all = E.bundledEarningsRows(from, to, false);
  const uni = E.bundledEarningsRows(from, to, true);
  ok(all.length === rows.length, "date-window filter keeps the whole bundled week", `${all.length}/${rows.length}`);
  ok(E.bundledEarningsRows(new Date("2000-01-01T12:00:00Z"), new Date("2000-01-08T12:00:00Z"), false).length === 0, "date-window filter excludes out-of-range rows");
  const coverage = new Set(DATA.map(d => d.ticker));
  ok(uni.every(e => coverage.has(e.symbol)), "coverage-only earnings rows stay inside the official universe");
  const probe = all[0];
  const merged = E.mergeEarningsRows([{ symbol: probe.symbol, date: probe.date, epsEstimate: 9.99, hour: "bmo" }], all);
  ok(merged.find(e => e.symbol === probe.symbol && e.date === probe.date).epsEstimate === 9.99, "live earnings row overrides bundled estimate when available");
}

// =============== 13b. Earnings intelligence engine ===============
{
  // Works with an empty seed AND a populated pipeline bundle — never crashes,
  // never fabricates. Missing inputs must lower coverage, not fake neutrality.
  ok(typeof EARNINGS_INTEL !== "undefined" && EARNINGS_INTEL.tickers && typeof EARNINGS_INTEL.tickers === "object",
    "EARNINGS_INTEL bundle is loaded with a tickers map");
  ok(E.earnIntelOf("__NOPE__") === null, "unknown ticker -> null intel, not a fake row");
  let bad = [], nullScores = 0, scored = 0;
  const validLabels = new Set(["STRONG BEAT SETUP", "LEAN BEAT", "COIN FLIP", "AT RISK", "MISS RISK", "NOT ENOUGH DATA"]);
  for (const d of DATA) {
    const o = E.beatOddsOf(d);
    if (!o || !Array.isArray(o.parts) || o.parts.length !== 6) { bad.push(`${d.ticker}:parts`); continue; }
    if (o.score != null && (!Number.isFinite(o.score) || o.score < 0 || o.score > 100)) bad.push(`${d.ticker}:score`);
    if (!Number.isFinite(o.coverage) || o.coverage < 0 || o.coverage > 100) bad.push(`${d.ticker}:coverage`);
    if (!validLabels.has(o.label)) bad.push(`${d.ticker}:label:${o.label}`);
    if (o.parts.some(p => p.score != null && (p.score < 0 || p.score > 100))) bad.push(`${d.ticker}:part-range`);
    if (o.score == null) nullScores++; else scored++;
  }
  ok(bad.length === 0, "beatOddsOf: 6 bounded components, bounded score/coverage, valid label for all 126", bad.slice(0, 6).join(","));
  ok(scored + nullScores === DATA.length, "every name resolves to scored or explicitly not-enough-data");
  const stats = E.earnBeatStats("__NOPE__");
  ok(stats === null, "beat stats for unknown ticker are null, never zeroed");
  const ledger = E.earningsLedger();
  ok(Array.isArray(ledger), "earnings ledger is always an array");
  ok(ledger.every(r => r.symbol && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.epsActual != null),
    "ledger rows carry symbol, ISO date and a real reported EPS");
  ok(ledger.every((r, i) => i === 0 || ledger[i - 1].date >= r.date), "ledger is sorted newest first");
  const up = E.upcomingEarningsRows(21);
  const today = new Date().toISOString().slice(0, 10);
  ok(Array.isArray(up) && up.every(e => e.date >= today), "upcoming rows are all in the future window");
  ok(up.every((e, i) => i === 0 || up[i - 1].date <= e.date), "upcoming rows are sorted by date");
  const sc = E.seasonScorecard(ledger);
  ok(sc.reported === ledger.length && (sc.beatRate == null || (sc.beatRate >= 0 && sc.beatRate <= 1)),
    "season scorecard counts reported rows and keeps beat rate in [0,1] or null");
  const nvda = DATA.find(d => d.ticker === "NVDA");
  const rt = E.peerReadThrough(nvda, ledger);
  ok(rt === null || (rt.n >= 2 && rt.beatShare >= 0 && rt.beatShare <= 1), "peer read-through needs >=2 peers or stays null");
}

// =============== 13d. Edge layer: drift, calibration, signals ===============
{
  // PEAD drift score: bounded, direction-aware, missing-safe
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const nvda = DATA.find(d => d.ticker === "NVDA");
  const beat = { symbol: "NVDA", date: daysAgo(7), epsActual: 1.1, epsEstimate: 1.0, surprisePct: 10, revActual: 5e10, revEstimate: 4.8e10 };
  const ds = E.driftScoreOf(beat, nvda);
  ok(ds && ds.score >= 3 && ds.score <= 97 && ds.up === true, "fresh clean beat produces a bounded upward drift score", JSON.stringify(ds && ds.score));
  ok(ds.windowLeft > 0 && ds.windowLeft <= 60, "drift window decays inside the 60-day research window");
  const miss = { ...beat, epsActual: 0.85, surprisePct: -15, revActual: 4.5e10 };
  const dm = E.driftScoreOf(miss, nvda);
  ok(dm && dm.up === false && dm.score < ds.score, "hard miss scores below the beat and is flagged downward", `${dm && dm.score} vs ${ds.score}`);
  ok(E.driftScoreOf({ ...beat, date: daysAgo(90) }, nvda) === null, "stale reports (>60d) leave the drift board, not linger");
  ok(E.driftScoreOf({ symbol: "NVDA", date: daysAgo(5) }, nvda) === null, "no actual/estimate -> no drift score, never fabricated");

  // calibration: pure math over synthetic snapshots
  const mk = (date, px) => ({ date, universe: 2, entries: [
    { t: "AAA", s: 80, c: "ACC", p: px, dl: "LIKELY UP", bo: 75, mr: 80 },
    { t: "BBB", s: 20, c: "AVOID", p: px, dl: "LIKELY DOWN", bo: 30, mr: 30 },
  ] });
  const hist = [mk("2026-01-01", 100), mk("2026-02-05", 110), mk("2026-03-15", 121)];
  const cal = E.calibrationOf(hist, 28);
  ok(cal.windows === 2, "calibration finds every closed forward window", String(cal.windows));
  const de = cal.groups["Direction Edge"];
  ok(de && de.length === 2, "both direction-edge buckets present (LIKELY UP + LIKELY DOWN)", JSON.stringify(de && de.map(r => r.bucket)));
  const upB = de.find(r => r.bucket === "LIKELY UP");
  ok(upB && upB.n === 2 && upB.hitRate === 1 && upB.avg > 9, "bucket stats: n, hit rate and avg forward return computed", JSON.stringify(upB));
  ok(upB.judged === false, "n<20 -> verdict withheld (honest small-sample handling)");
  ok(E.calibrationOf([], 28).windows === 0, "empty history -> zero windows, no crash");
  ok(E.calibrationOf(hist, 365).windows === 0, "horizon longer than history -> zero windows");

  // signals bundle: empty-safe structure
  const evs = E.signalsEvents();
  ok(Array.isArray(evs), "signals events always an array");
  ok(evs.every(e => e.d && e.tk && e.type && Number.isFinite(e.m) && e.title), "every signal event carries date, ticker, type, materiality, title");

  // analyst rating reason matching: attaches only a genuine, time-adjacent headline
  const rating = { date: "2026-07-20", firm: "Morgan Stanley", from: "Equal-Weight", to: "Overweight", action: "up" };
  const ts = Math.floor(Date.parse("2026-07-20T14:00:00Z") / 1000);
  const news = [
    { headline: "Random market story", datetime: ts, url: "x" },
    { headline: "Morgan Stanley upgrades on AI server demand", summary: "price target to $250", datetime: ts, url: "y" },
    { headline: "Morgan Stanley upgrades again much later", datetime: ts + 30 * 86400, url: "z" },
  ];
  const why = E.ratingReasonFrom(news, rating);
  ok(why && why.url === "y", "reason = the time-adjacent headline naming the firm and the action", JSON.stringify(why));
  ok(E.ratingReasonFrom([{ headline: "unrelated", datetime: ts }], rating) === null, "no matching headline -> null reason, never invented");
  ok(E.ratingReasonFrom(null, rating) === null, "no news loaded -> null reason");

  // easy mode: grades and plain-language translators are total and honest
  ok(E.gradeOf(null).g === "?", "unknown score -> '?' grade, not a fake letter");
  ok(E.gradeOf(85).g === "A" && E.gradeOf(67).g === "B" && E.gradeOf(52).g === "C" && E.gradeOf(40).g === "D" && E.gradeOf(10).g === "F", "grade bands map correctly");
  ok(DATA.every(d => typeof E.easySentence(d) === "string" && E.easySentence(d).length > 10), "every ticker gets a plain-English sentence");
  // BlackRock bundle: empty-safe structure
  const B = E.blkIntel();
  ok(B && Array.isArray(B.filings) && "holdings" in B, "BlackRock bundle loads with filings array and holdings slot");
  ok(B.holdings === null || (Array.isArray(B.holdings.top) && Array.isArray(B.holdings.universe)), "holdings are null (arming) or carry top/universe arrays");
  for (const type of ["filing", "analyst", "earnings", "revisions", "edge", "score", "whale", "unknown"]) {
    const words = E.easyEventWords({ tk: "NVDA", type, title: "UPGRADED x", detail: "" });
    ok(typeof words === "string" && words.length > 5, `easy translator handles '${type}' events`);
  }
}

// =============== 13c. Price-window helpers ===============
{
  const d = DATA.find(x => x.px && Array.isArray(x.px.v) && x.px.v.length >= 20);
  ok(d, "at least one name carries a weekly price series for the time machine");
  const norm3m = E.pxNormalized(d, 13);
  ok(Array.isArray(norm3m) && norm3m[0] === 0, "normalized series starts at 0% (indexed to window start)", JSON.stringify(norm3m && norm3m[0]));
  ok(norm3m.every(v => Number.isFinite(v)), "normalized series has no NaN/gaps from valid prices");
  const r6 = E.pxReturn(d, 26), sl = E.pxWindowSlice(d, 26);
  const expected = +(((sl[sl.length - 1] / sl[0]) - 1) * 100);
  ok(Math.abs(r6 - expected) < 1e-6, "window return matches (last/first - 1) over the slice", `${r6} vs ${expected}`);
  ok(E.pxWindowSlice(d, 13).length <= 14, "3M window slices ~13 weeks, not the whole series", String(E.pxWindowSlice(d, 13).length));
  ok(E.pxReturn({ ticker: "XX" }, 26) === null && E.pxNormalized({ px: { v: [null, null] } }, 26) === null, "missing price history -> null, never fabricated");
  ok(E.tmDateLabels(26).filter(Boolean).length >= 2, "time axis produces dated tick labels");
  // Coverage gate: a short (recent-listing) series must NOT be ranked as a full-window return.
  const shortName = { ticker: "IPO", px: { v: Array.from({ length: 15 }, (_, i) => 100 + i), from: "2026-04-01", to: "2026-07-20" } };
  ok(E.pxReturn(shortName, 52) === null, "15-week series returns null for a 1Y window (not a fake 1Y return)");
  ok(E.pxReturn(shortName, 13) != null, "same series still reports the 3M window it actually covers");
  // Null grid: interior gaps stay gaps; normalization uses the first finite close and preserves positions.
  const gapped = { px: { v: [100, null, 110, 120, null, 130], from: "2026-06-08", to: "2026-07-13" } };
  const gn = E.pxNormalized(gapped, 5);
  ok(gn && gn[0] === 0 && gn[1] === null && Math.abs(gn[2] - 10) < 1e-6, "gapped series: base=first finite, gaps stay null, positions preserved", JSON.stringify(gn));
}

// =============== 14. Live quote tape ===============
{
  ok(E.isMarketHours(new Date("2026-07-13T14:00:00Z")) === true, "market-hours detector true during regular session");
  ok(E.isMarketHours(new Date("2026-07-13T22:00:00Z")) === false, "market-hours detector false after close");
  ok(E.isMarketHours(new Date("2026-07-12T14:00:00Z")) === false, "market-hours detector false on Sunday");
  const aapl = DATA.find(d => d.ticker === "AAPL");
  const oldPe = aapl.truePE;
  const okQuote = E.applyLiveQuote("AAPL", aapl.price + 10, 1.23, "fixture");
  ok(okQuote === true, "applyLiveQuote accepts valid live price");
  ok(aapl.truePE !== oldPe, "live quote recomputes price-derived owner P/E");
  ok(E.applyLiveQuote("AAPL", 0, 0, "bad") === false, "applyLiveQuote rejects zero/invalid price");
  ok(typeof E.fetchYahooQuote === "function" && typeof E.fetchYahooQuoteBatch === "function", "no-key Yahoo quote fallback is exported");
  const panw = DATA.find(d => d.ticker === "PANW");
  const panwOldHeadline = panw.headlinePE;
  ok(E.applyLiveQuote("PANW", panw.price * 1.25, 1.35, "Yahoo") === true, "PANW can update from no-key quote fallback");
  ok(panw.headlinePE !== panwOldHeadline, "PANW headline P/E recomputes from live fallback price");
  ok(E.applyLiveQuote("JPM", 250.12, 0.42, "fixture") === true, "expanded official tickers accept live quote updates");
  ok(E.companyOf("JPM") && DATA.some(d => d.ticker === "JPM"), "JPM lookup is available as a normal official DATA row");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
