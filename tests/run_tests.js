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
// Universe size is data-driven: data/universe.json is the single source of
// truth for membership, so an approved expansion never needs a magic number
// edited in five places — but every layer must still agree with it exactly.
const UNIVERSE_COUNT = JSON.parse(fs.readFileSync(path.join(root, "data", "universe.json"), "utf8")).count;
const atLeast = (frac) => Math.floor(UNIVERSE_COUNT * frac);
const src = ["universe.js", "data.js", "sec.js", "segments.js", "sectors.js", "estimates.js", "earnings.js", "signals.js", "whales.js", "insiders.js", "track.js", "scores.js", "charts.js", "app.js"]
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
  // Some names (e.g. recently added insurers) run on an annual SEC basis until their first quarterly ingest
  ok(rankedAnnualBasis.length <= atLeast(0.20), "ranked valuation mostly uses TTM owner EPS; annual-basis exceptions are visible",
    rankedAnnualBasis.map(d => `${d.ticker}:${d.ownerEpsSource}`).join(","));
  const forwardRows = DATA.map(d => ({ d, f: E.forwardPEOf(d) })).filter(x => E.dataConfidenceOf(x.d).rankable && x.f.pe != null);
  ok(forwardRows.length >= atLeast(0.30), "forward P/E available for most rankable names", `${forwardRows.length}/${UNIVERSE_COUNT}`);
  const muFwd = E.forwardPEOf(mu);
  // Forward P/E must be positive, finite and reconcile to price / forward EPS.
  // It must NOT be asserted to sit below the owner-earnings P/E: the two use
  // different EPS bases (owner earnings is SBC-adjusted, Street EPS is not),
  // and for a cyclical at peak earnings analysts legitimately expect LOWER
  // profits next year, which puts forward above trailing. That inversion is
  // real information, not a defect — it holds for ~a quarter of the universe.
  ok(muFwd.pe > 0 && Number.isFinite(muFwd.pe), "MU forward P/E is present, positive and finite", `${muFwd.pe}x`);
  ok(muFwd.eps == null || !(muFwd.eps > 0) || Math.abs(muFwd.pe - mu.price / muFwd.eps) < 0.6,
    "MU forward P/E reconciles to price / forward EPS", `${muFwd.pe} vs ${(mu.price / muFwd.eps).toFixed(1)}`);
  const fwdBroken = forwardRows.filter(x => !(x.f.pe > 0) || !Number.isFinite(x.f.pe));
  ok(fwdBroken.length === 0, "no rankable name carries a non-positive or infinite forward P/E",
    fwdBroken.map(x => x.d.ticker).join(","));
}

// =============== 9. Universe + SEC filing layer ===============
{
  const expected = typeof UNIVERSE_LIST !== "undefined" ? UNIVERSE_LIST.length : 0;
  ok(expected === UNIVERSE_COUNT, `UNIVERSE_LIST length matches universe.json (${UNIVERSE_COUNT})`, String(expected));
  ok(DATA.length === UNIVERSE_COUNT, `DATA length matches universe.json (${UNIVERSE_COUNT})`, String(DATA.length));
  ok(!UNIVERSE_LIST.some(u => u.ticker === "FLUT"), "FLUT is not in official universe");
  ok(!DATA.some(d => d.ticker === "FLUT"), "FLUT is not in DATA");
  ok(UNIVERSE_LIST.some(u => u.ticker === "TSM" && u.cik10 === "0001046179"), "TSM is in official universe with SEC CIK");
  ok(DATA.some(d => d.ticker === "TSM" && d.sector === "Semis/Foundry"), "TSM has a DATA financial row");
  ok(new Set(UNIVERSE_LIST.map(u => u.ticker)).size === expected, "no duplicate tickers");
  ok(UNIVERSE_LIST.every(u => u.cik && u.name && u.sector), "every name has identity + CIK");
  const uniSet = new Set(UNIVERSE_LIST.map(u => u.ticker));
  ok(DATA.every(d => uniSet.has(d.ticker)), "no unapproved tickers in DATA");
  ok(DATA.every(d => d.ticker && d.name && d.sector && d.price != null), "every official name carries identity and quote snapshot");
  ok(UNIVERSE_LIST.every(u => DATA.some(d => d.ticker === u.ticker)), "every approved universe ticker has a DATA financial row");
  // SEC layer integrity: provenance on every fact
  ok(typeof SEC !== "undefined" && Object.keys(SEC).length === UNIVERSE_COUNT, "SEC facts for every official name", `${Object.keys(SEC || {}).length}/${UNIVERSE_COUNT}`);
  let provOk = 0, checked = 0;
  for (const tk of Object.keys(SEC)) {
    const f = SEC[tk].f.revenue;
    if (f) { checked++; if (f.form && f.filed && f.accn && f.tag) provOk++; }
  }
  ok(provOk === checked && checked >= atLeast(0.90), "every SEC fact carries form+filed+accession+tag", `${provOk}/${checked}`);
  // cross-check ran: verified majority, conflicts flagged not hidden
  const full = DATA.filter(d => E.dataQualityOf(d).label === "FULL FILING VERIFIED").length;
  const core = DATA.filter(d => E.dataQualityOf(d).label === "CORE FILING VERIFIED").length;
  // Fully verified count moves as the official universe grows; the rest are PARTIAL.
  // 20-F filers, tag variants) — tracked in AUDIT.md as the next data milestone
  ok(full >= atLeast(0.60), `${atLeast(0.60)}+ names FULL FILING VERIFIED`, `${full}/${expected}`);
  ok(full + core >= atLeast(0.75), `${atLeast(0.75)}+ names full/core filing verified`, `${full + core}/${expected}`);
  const partial = DATA.filter(d => ["FULL FILING VERIFIED", "CORE FILING VERIFIED", "PARTIALLY VERIFIED"].includes(E.dataQualityOf(d).label)).length;
  ok(partial >= expected - Math.max(1, Math.ceil(expected * 0.03)), "all but a handful of names at least partially SEC-verified", `${partial}/${expected}`);
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
  ok(rankedUniverse.length >= atLeast(0.88), `${atLeast(0.88)}+ official names enter the main ranking when owner earnings can be computed`, `${rankedUniverse.length}/${expected}`);
  const lowConfidenceRanked = DATA.filter(d => E.dataConfidenceOf(d).score < 80 && E.rankOf(d).noRank !== true);
  ok(lowConfidenceRanked.length >= 6, "low-confidence names are ranked with caution instead of hidden",
    lowConfidenceRanked.map(d => `${d.ticker}:${E.dataConfidenceOf(d).score}`).join(","));
  const stillBlocked = DATA.filter(d => E.rankOf(d).noRank === true);
  // Every NOT-RANKED name must be explicitly acknowledged here with a known
  // source gap — a new blocked ticker should fail this test until a human has
  // checked why. All of these report no ShareBasedCompensation tag in either
  // Yahoo or SEC companyfacts (financials/insurers and a few resource names),
  // so owner earnings cannot be computed and the engine correctly refuses to
  // invent them rather than shipping a fabricated score.
  const sourceBlocked = new Set(["C", "XOM", "CVX", "SCCO", "CB", "SYF", "AFL"]);
  ok(stillBlocked.length <= sourceBlocked.size && stillBlocked.every(d => sourceBlocked.has(d.ticker)),
    "only acknowledged source-proof gaps remain NOT RANKED", stillBlocked.map(d => d.ticker).join(","));
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
  ok(map.length === UNIVERSE_COUNT, "quality x market map covers every official ticker", `${map.length}/${UNIVERSE_COUNT}`);
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
  ok(bad.length === 0, "beatOddsOf: 6 bounded components, bounded score/coverage, valid label for every name", bad.slice(0, 6).join(","));
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

  // PEAD's post-report "tape since report" reaction: must read DAILY closes
  // (d.pd) at day-resolution, not WEEKLY bars (d.px) bucketed in whole
  // 7-trading-day jumps -- the audit measured up to ~1 week of real
  // slippage from the old bucketing. Verify against the actual bundled
  // earnings ledger (not a synthetic daysAgo(), which would drift against
  // d.pd's own fixed "as of" date).
  const pctMoveFromLocal = (vals, lookback) => {
    const a = (vals || []).filter(v => typeof v === "number" && Number.isFinite(v));
    if (a.length < 2 || lookback == null) return null;
    const end = a[a.length - 1], start = a[Math.max(0, a.length - 1 - lookback)];
    return start > 0 ? ((end / start) - 1) * 100 : null;
  };
  const realLedger = E.earningsLedger();
  let checkedReal = 0, matchedDaily = 0, divergedFromWeekly = 0;
  for (const r of realLedger) {
    const dR = DATA.find(x => x.ticker === r.symbol);
    if (!dR || !dR.pd || !dR.pd.to) continue;
    const dsReal = E.driftScoreOf(r, dR);
    if (!dsReal) continue;
    const tapeBit = dsReal.bits.find(b => /^tape since report/.test(b));
    if (!tapeBit) continue;
    checkedReal++;
    const tds = E.ScoreEngine.tradingDaysBetween(r.date, dR.pd.to);
    const expectedDaily = pctMoveFromLocal(dR.pd.v, tds);
    const daysSinceReal = Math.round((Date.now() - Date.parse(r.date + "T16:00:00Z")) / 864e5);
    const weeksBackOld = Math.max(1, Math.round(daysSinceReal / 7));
    const expectedWeekly = pctMoveFromLocal(dR.px && dR.px.v, weeksBackOld);
    if (expectedDaily != null) {
      const shown = parseFloat(tapeBit.match(/(-?\d+\.\d+)%/)[1]);
      if (Math.abs(shown - expectedDaily) < 0.15) matchedDaily++;
      if (expectedWeekly != null && Math.abs(expectedDaily - expectedWeekly) > 1) divergedFromWeekly++;
    }
  }
  ok(checkedReal > 0, "at least one real bundled report has a driftScoreOf reaction to check", String(checkedReal));
  ok(matchedDaily === checkedReal, "every real report's shown reaction matches a daily-close (d.pd) computation, not a weekly one", `${matchedDaily}/${checkedReal}`);
  ok(divergedFromWeekly > 0, "the daily-resolution reaction differs meaningfully from the old weekly-bucketed value for real reports (proving the fix changed real output, not just refactored)", String(divergedFromWeekly));

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

  // RSI(14): Wilder smoothing on daily closes, missing-safe, bounded
  const mkPd = (vals) => ({ pd: { v: vals, to: "2026-07-24" } });
  const upOnly = mkPd(Array.from({ length: 30 }, (_, i) => 100 + i));
  const dnOnly = mkPd(Array.from({ length: 30 }, (_, i) => 130 - i));
  ok(E.rsiOf(upOnly).value === 100, "all-gains series -> RSI 100", String(E.rsiOf(upOnly).value));
  ok(E.rsiOf(dnOnly).value === 0, "all-losses series -> RSI 0", String(E.rsiOf(dnOnly).value));
  const mixed = E.rsiOf(mkPd(Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5)));
  ok(mixed && mixed.value > 0 && mixed.value < 100 && Number.isFinite(mixed.prev), "oscillating series -> interior RSI with prev bar");
  ok(E.rsiOf({ pd: { v: [1, 2, 3] } }) === null, "too few closes -> null, never fabricated");
  ok(E.rsiOf({}) === null, "no daily closes -> null");
  // best setups: quality gate first, bounded, missing-RSI tolerated
  const setups = E.bestSetupsOf();
  ok(Array.isArray(setups) && setups.every(x => x.score >= 0 && x.score <= 100 && x.coverage >= 0 && x.coverage <= 100),
    "setups are bounded with coverage");
  ok(setups.every(x => {
    const ms = E.marketScoreOf(x.d);
    return ms && ms.businessQuality.score >= 65 && ms.longTermView.score >= 55;
  }), "every setup passed the quality gate FIRST (no oversold junk)");
  ok(setups.every(x => !x.aligned || (x.rsi && x.rsi.value <= 38)), "PRIME alignment requires a real washed-out RSI");

  // easy mode: grades and plain-language translators are total and honest
  ok(E.gradeOf(null).g === "?", "unknown score -> '?' grade, not a fake letter");
  ok(E.gradeOf(85).g === "A" && E.gradeOf(67).g === "B" && E.gradeOf(52).g === "C" && E.gradeOf(40).g === "D" && E.gradeOf(10).g === "F", "grade bands map correctly");
  ok(DATA.every(d => typeof E.easySentence(d) === "string" && E.easySentence(d).length > 10), "every ticker gets a plain-English sentence");
  // whale bundle: empty-safe structure across all managers
  const W = E.whalesIntel();
  ok(W && typeof W.whales === "object", "whales bundle loads with a managers map");
  ok(Object.values(W.whales).every(w => Array.isArray(w.filings) && "holdings" in w &&
    (w.holdings === null || (Array.isArray(w.holdings.top) && Array.isArray(w.holdings.universe)))),
    "every whale carries filings + null-or-structured holdings");
  ok(E.blkIntel() === null || typeof E.blkIntel() === "object", "focused whale accessor is null-safe");
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

// =============== 15. Narrative engine + conviction (signal confluence) ===============
{
  // membership honesty: fewer than 2 present members -> no reading, ever
  ok(E.narrativeStats({ key: "x", name: "X", icon: "?", story: "", members: ["NVDA"] }) === null,
    "narrative with 1 present member reports nothing");
  ok(E.narrativeStats({ key: "y", name: "Y", icon: "?", story: "", members: ["ZZZQ1", "ZZZQ2"] }) === null,
    "narrative with 0 present members reports nothing");
  // every curated member must be a real universe ticker (typo guard)
  const badMembers = E.NARRATIVES.flatMap(n => n.members).filter(tk => !E.companyOf(tk));
  ok(badMembers.length === 0, "all narrative members exist in the universe", badMembers.join(","));
  // production clusters: shape + honesty invariants
  const heats = E.narrativeHeatAll();
  ok(Array.isArray(heats) && heats.length >= 5, "most curated narratives measurable on production data", String(heats.length));
  ok(heats.every(h => h.heat >= 0 && h.heat <= 100), "narrative heat bounded 0..100");
  ok(heats.every(h => h.inputs >= 2), "no narrative reading from fewer than 2 live inputs");
  ok(heats.every(h => h.bits.length === h.inputs), "every input used is evidenced in bits");
  ok(heats.every(h => ["HOT", "WARMING", "MIXED", "COOLING", "COLD"].includes(h.label)), "labels come from the fixed vocabulary");
  ok(heats.every((h, i, a) => i === 0 || a[i - 1].heat >= h.heat), "narrativeHeatAll sorted hottest first");
  ok(heats.every(h => (h.label === "HOT") === (h.heat >= 68)), "HOT label exactly matches its heat band");
  // conviction: vote accounting must be exact, reasons mandatory
  const c = E.convictionOf(E.companyOf("NVDA"));
  ok(c && Array.isArray(c.votes), "convictionOf returns a votes array");
  ok(c.bulls === c.votes.filter(v => v.dir > 0).length && c.bears === c.votes.filter(v => v.dir < 0).length,
    "bull/bear counts match the votes exactly");
  ok(c.silent === c.votes.filter(v => v.dir === 0).length, "silent = votes that neither agree nor object");
  ok(c.votes.every(v => v.why && v.label), "every vote states its reason");
  ok(new Set(c.votes.map(v => v.key)).size === c.votes.length, "no signal votes twice on one name");
  if (/HIGH CONFLUENCE/.test(c.label)) ok(c.bulls >= 4 && c.bears === 0, "HIGH CONFLUENCE requires 4+ bulls and 0 bears");
  // the board only shows real agreement, ranked by net agreement
  const board = E.convictionBoard(8);
  ok(board.every(x => x.bulls >= 3 || x.bears >= 3), "conviction board admits only 3+ agreeing signals");
  ok(board.every((x, i, a) => i === 0 || (a[i - 1].bulls - a[i - 1].bears) >= (x.bulls - x.bears)),
    "conviction board ranked by net signal agreement");
  ok(E.whaleActionMap() !== null && typeof E.whaleActionMap() === "object", "whale action map builds");
}

// =============== 16. Insider signal (SEC Form 4) ===============
{
  const bundle = E.insidersBundle();
  ok(bundle && typeof bundle === "object", "insiders bundle loads");
  ok(bundle.windowDays === 90, "insider window is 90 days", String(bundle.windowDays));
  const d = E.companyOf("AAPL");
  const sig = E.insiderSignalOf(d);
  if (!bundle.asOf) {
    // seed state: the engine must report NOTHING rather than a fake "quiet"
    ok(sig === null, "no insider reading before the pipeline has ever run");
    ok(E.insiderClusters().length === 0, "no clusters claimed on an empty bundle");
  } else {
    ok(sig && sig.label, "insider signal produced once data exists");
    ok(E.insiderClusters(5).every(x => x.s.buyers >= 1), "cluster list only contains real buyers");
  }
  // price sanity: a Form 4 row priced nowhere near the traded line describes a
  // different instrument (ordinary shares vs ADS, another class) and must not
  // count. This is what stopped TSM reporting 27 "buyers" off $74 rows against
  // a ~$400 traded price.
  if (bundle.asOf) {
    const withOff = DATA.map(x => E.insiderSignalOf(x)).filter(s => s && s.offMarket > 0);
    ok(withOff.every(s => s.buys.every(b => !b.price || (b.price / E.companyOf(s.ticker).price >= 0.2 && b.price / E.companyOf(s.ticker).price <= 5))),
      "no counted buy sits outside the price-sanity band");
    ok(withOff.every(s => s.buyers === new Set(s.buys.map(b => b.owner)).size),
      "buyer count is derived from the surviving rows, not the raw bundle");
    const tsm = E.insiderSignalOf(E.companyOf("TSM"));
    if (tsm && tsm.offMarket) ok(tsm.buyers < 10, "off-market rows cannot inflate a cluster", String(tsm.buyers));
  }
  // asymmetry is the whole point: sales must never score like buys
  const src = require("fs").readFileSync(require("path").join(root, "app.js"), "utf8");
  const eng = src.slice(src.indexOf("function insiderSignalOf"), src.indexOf("function insiderClusters"));
  ok(/buyers >= 3/.test(eng) && /\+= 30/.test(eng), "cluster buying carries the largest weight");
  ok(!/sellers >= 3[^)]*\)\s*\{\s*score \+=/.test(eng), "insider selling never adds to the score");
}

// =============== 17. Position playbook (sizing + invalidation) ===============
{
  // volatility from real daily closes, refusing to guess on short series
  ok(E.dailyVolOf({ pd: { v: [1, 2, 3] } }) === null, "daily vol needs a real series, not 3 points");
  const flat = { pd: { v: Array.from({ length: 40 }, () => 100) } };
  ok(E.dailyVolOf(flat) === 0, "a flat series has zero volatility, not null");
  const noisy = { pd: { v: Array.from({ length: 40 }, (_, i) => 100 * (1 + (i % 2 ? 0.05 : -0.05))) } };
  ok(E.dailyVolOf(noisy) > E.dailyVolOf(flat), "noisier series measures higher volatility");

  const d = E.companyOf("NVDA");
  const pb = E.playbookOf(d);
  ok(pb && pb.sizePct > 0, "playbook produces a position size");
  ok(pb.sizePct >= 0.5 && pb.sizePct <= pb.maxPosition, "position size stays inside the documented band", String(pb.sizePct));
  ok(DATA.map(x => E.playbookOf(x)).filter(Boolean).every(p => p.sizePct <= p.maxPosition),
    "no single idea is ever sized past the hard position cap");
  ok(pb.stopPct >= 8 && pb.stopPct <= 30, "invalidation distance bounded to 8-30%", String(pb.stopPct));
  ok(pb.stopPrice < pb.price && pb.stopPrice > 0, "invalidation price sits below the current price");
  ok(Math.abs(pb.stopPrice - pb.price * (1 - pb.stopPct / 100)) < 0.02, "stop price matches the stated stop percent");
  ok(pb.breaks.length >= 3, "at least three written invalidation conditions", String(pb.breaks.length));
  ok(pb.breaks.every(b => typeof b === "string" && b.length > 20), "every invalidation is a full sentence");
  ok(/^\d{4}-\d{2}-\d{2}$/.test(pb.review), "review date is a real ISO date", pb.review);
  ok(pb.review > "2026-01-01", "review date is in the future");
  // the core risk rule: a wider stop must yield a smaller position
  const wide = DATA.map(x => E.playbookOf(x)).filter(Boolean);
  const bySize = wide.filter(p => p.qualityOk && p.convNet === 0);
  if (bySize.length >= 2) {
    const sorted = [...bySize].sort((a, b) => a.stopPct - b.stopPct);
    ok(sorted[0].sizePct >= sorted[sorted.length - 1].sizePct,
      "tighter invalidation earns a larger position than a wider one at equal conviction",
      `${sorted[0].stopPct}%->${sorted[0].sizePct}% vs ${sorted.at(-1).stopPct}%->${sorted.at(-1).sizePct}%`);
  }
  ok(E.playbookOf({ ticker: "X", price: 0 }) === null, "no playbook without a real price");
}

// =============== 18. Sell discipline + concentration ===============
{
  const d = E.companyOf("AAPL");
  const x = E.exitSignalsOf(d);
  ok(x && Array.isArray(x.breaks), "exit engine returns a break list");
  ok(x.breaks.every(b => b.what && b.why && b.sev >= 1), "every thesis break states what broke and why");
  ok(x.sev === x.breaks.reduce((a, b) => a + b.sev, 0), "severity is the sum of its breaks");
  ok(!x.breaks.length ? x.label === "THESIS INTACT" : x.label !== "THESIS INTACT",
    "label agrees with whether anything actually broke", x.label);
  ok(E.exitSignalsOf(null) === null, "exit engine refuses a missing company");
  // no positions -> no invented risk report
  ok(E.portfolioRiskOf() === null, "concentration report is null on an empty portfolio");
}

// =============== 19. The Master Signal (one score, whole-universe rank) ===============
{
  ok(E.MASTER_PILLARS.reduce((a, p) => a + p.weight, 0) === 100, "pillar weights sum to exactly 100");
  ok(new Set(E.MASTER_PILLARS.map(p => p.key)).size === E.MASTER_PILLARS.length, "no duplicate pillar keys");

  const board = E.masterBoard();
  ok(board.length > atLeast(0.8), "most of the universe is rankable", `${board.length}/${UNIVERSE_COUNT}`);
  ok(board.every(r => r.score >= 0 && r.score <= 100), "master score bounded 0..100");
  ok(board.every(r => r.coverage >= 55), "nothing below 55% coverage is ranked");
  ok(board.every((r, i, a) => i === 0 || a[i - 1].score >= r.score), "board is sorted by score, descending");
  ok(board.every((r, i) => r.rank === i + 1), "ranks are dense and 1-based");
  ok(board.every(r => r.of === board.length), "every row knows the size of the field it was ranked in");
  ok(new Set(board.map(r => r.ticker)).size === board.length, "each company appears exactly once");

  // the composite must equal the coverage-weighted average of its own pillars
  const r = board[0];
  // confluence carries an evidence discount, so its effective weight is
  // scaled by how many of its sources could actually be consulted
  const evOf = (p) => p.key === "confluence" && r.conv && Number.isFinite(r.conv.evidence) ? r.conv.evidence : 1;
  const present = E.MASTER_PILLARS.filter(p => r.parts[p.key]);
  const wsum = present.reduce((a, p) => a + p.weight * evOf(p), 0);
  const expect = Math.round(present.reduce((a, p) => a + r.parts[p.key].score * p.weight * evOf(p), 0) / wsum);
  ok(r.score === expect, "score is exactly the coverage-weighted pillar average", `${r.score} vs ${expect}`);
  ok(Math.abs(r.coverage - wsum) < 1, "coverage is the evidence-adjusted weight of the pillars that computed",
    `${r.coverage} vs ${wsum.toFixed(1)}`);

  // a missing pillar must be DROPPED, never silently scored as a neutral 50
  const partial = DATA.map(d => E.masterSignalOf(d)).filter(x => x && Object.keys(x.parts).length < E.MASTER_PILLARS.length);
  ok(partial.every(x => x.coverage < 100), "a name missing a pillar cannot report 100% coverage");
  ok(partial.every(x => Object.values(x.parts).every(p => p.score !== null)), "no pillar is stored with a null score");

  // every pillar must justify itself, and rank-by-pillar must be honest
  ok(board.every(x => x.pillars.every(p => p.why && p.why.length > 0)), "every pillar states what produced it");
  ok(board.every(x => !x.best || x.pillars.every(p => p.score <= x.best.score)), "best pillar really is the highest-scoring one");
  ok(board.every(x => !x.worst || x.pillars.every(p => p.score >= x.worst.score)), "worst pillar really is the lowest-scoring one");

  // ANTI-DOUBLE-COUNT: confluence enters once as a pillar. Its member signals
  // (insiders, whales, revisions, drift, beat odds, narrative, filings, ratings)
  // must NOT also appear as pillars of their own.
  const keys = E.MASTER_PILLARS.map(p => p.key);
  ["insider", "whale", "revisions", "drift", "beat", "narrative", "filing", "tier1", "rsi", "edge"]
    .forEach(k => ok(!keys.includes(k), `conviction member '${k}' is not re-added as its own pillar`));

  // the board must actually discriminate, not flatten everything to one label
  const labels = new Set(board.map(x => x.label));
  ok(labels.size >= 3, "the board separates names into multiple readings", [...labels].join(","));
  ok(board[0].score - board[board.length - 1].score >= 20, "meaningful spread between best and worst",
    `${board[board.length - 1].score}..${board[0].score}`);
  ok(E.masterSignalOf(null) === null, "no signal without a company");
  // cached lookup must agree with the board it came from
  const lookup = E.masterRankOf(board[0].ticker);
  ok(lookup && lookup.rank === 1 && lookup.score === board[0].score, "rank lookup agrees with the board");
}

// =============== 20. Proof status (when does evidence unlock?) ===============
{
  ok(E.proofStatusOf([]).snapshots === 0, "empty history reports zero snapshots, not a fake status");
  ok(E.proofStatusOf([]).signals.length === 0, "no signals claimed without history");

  const H = typeof TRACK_HISTORY !== "undefined" ? TRACK_HISTORY : [];
  const ps = E.proofStatusOf(H);
  ok(ps.snapshots === H.length, "snapshot count matches the history");
  ok(ps.since === H[0].date, "recording start is the first snapshot's date");
  ok(ps.signals.length === E.TRACKED_SIGNALS.length,
    "every tracked signal appears, including ones not yet recording", `${ps.signals.length}/${E.TRACKED_SIGNALS.length}`);

  // the honesty that matters: a horizon cannot be 'ready' before enough
  // CALENDAR time has passed, no matter how many names are in the universe
  for (const h of ps.horizons) {
    ok(h.unlockDate > ps.since, "unlock date is after recording began");
    const elapsed = Math.round((Date.parse(ps.latest) - Date.parse(ps.since)) / 864e5);
    ok(h.ready === (elapsed >= h.days), `${h.label} readiness follows elapsed calendar time`, `${elapsed}d vs ${h.days}d`);
    if (!h.ready) ok(h.daysLeft > 0, "an unready horizon reports the days remaining");
  }
  // per-signal clocks start when THAT signal started recording, not at day zero
  for (const s of ps.signals) {
    if (!s.recordedSince) {
      ok(s.horizons.every(h => !h.ready && h.obs === 0), `${s.label}: nothing claimed before it records`);
      continue;
    }
    ok(s.recordedSince >= ps.since, `${s.label}: own clock starts no earlier than the history`);
    for (const h of s.horizons) {
      ok(h.unlockDate === new Date(Date.parse(s.recordedSince) + h.days * 864e5).toISOString().slice(0, 10),
        `${s.label}: ${h.label} unlock is measured from ITS OWN start date`);
      if (!h.ready) ok(h.obs === 0, `${s.label}: no observations reported before the window closes`);
    }
  }
  // a signal added later must not inherit an older signal's head start
  const late = ps.signals.filter(s => s.recordedSince && s.recordedSince > ps.since);
  if (late.length) {
    const l = late[0];
    ok(l.horizons[0].unlockDate > ps.horizons[0].unlockDate,
      "a later-added signal unlocks later than the oldest one", `${l.label} ${l.horizons[0].unlockDate}`);
  }
  ok(ps.minObs >= 20, "verdicts still require at least 20 observations", String(ps.minObs));
}

// =============== 21. Forward P/E curve to 2029 (data vs projection) ===============
{
  const curves = DATA.map(d => E.forwardPeCurveOf(d)).filter(Boolean);
  ok(curves.length > 0, "some names have a forward P/E curve", String(curves.length));

  // THE core invariant: consensus never extends past the next fiscal year.
  // If this ever fails, the app is presenting invented estimates as real.
  ok(curves.every(c => c.consensusYears <= 2),
    "no curve claims more than 2 consensus years — analysts do not publish further out",
    String(Math.max(...curves.map(c => c.consensusYears))));
  ok(curves.every(c => c.years.every(y => y.basis === "consensus" || y.basis === "projected")),
    "every year is labelled either consensus or projected");
  ok(curves.every(c => {
    const idx = c.years.map(y => y.basis);
    const lastC = idx.lastIndexOf("consensus");
    return lastC === -1 || !idx.slice(0, lastC).includes("projected");
  }), "consensus years always precede projected years — no interleaving");
  ok(curves.every(c => c.years.filter(y => y.basis === "projected").every(y => y.source && Number.isFinite(y.growth))),
    "every projected year states its growth rate and where the rate came from");
  ok(curves.every(c => c.years.filter(y => y.basis === "consensus").every(y => y.growth === undefined)),
    "consensus years carry no invented growth rate");

  // a negative/zero EPS must yield NO multiple, never a negative one
  ok(curves.every(c => c.years.every(y => y.pe === null || y.pe > 0)),
    "no negative or zero forward P/E is ever produced");
  ok(curves.every(c => c.years.every(y => y.pe === null || Math.abs(y.pe - c.price / y.eps) < 0.15)),
    "each P/E equals price divided by that year's EPS");

  // projections must decay toward the terminal rate, never compound forever
  curves.filter(c => c.projectedYears >= 2).slice(0, 40).forEach(c => {
    const p = c.years.filter(y => y.basis === "projected");
    for (let i = 1; i < p.length; i++) {
      ok(Math.abs(p[i].growth - 0.05) <= Math.abs(p[i - 1].growth - 0.05) + 1e-9,
        `${c.ticker}: each projected year decays toward the long-run rate`,
        `${p[i - 1].growth} -> ${p[i].growth}`);
    }
  });
  ok(curves.every(c => c.rate === null || (c.rate >= -0.25 && c.rate <= 0.40)),
    "projection growth is clamped — no perpetual hypergrowth");
  ok(curves.every(c => c.years.every((y, i, a) => i === 0 || y.year > a[i - 1].year)),
    "years are strictly increasing with no duplicates");
  ok(curves.every(c => !c.complete || c.years[c.years.length - 1].year >= 2029),
    "a curve marked complete really does reach 2029");

  // no forward EPS anywhere -> no curve at all, rather than a fabricated one
  ok(E.forwardPeCurveOf({ ticker: "ZZZZ", price: 100 }) === null, "no consensus anywhere yields NO curve");
  ok(E.forwardPeCurveOf(null) === null, "no company yields no curve");
  // use a name no earlier live-quote fixture touched, or priceOf would return
  // the injected quote instead of the zero we are testing
  const clean = curves.find(c => !["AAPL", "PANW", "JPM"].includes(c.ticker));
  if (clean) ok(E.forwardPeCurveOf({ ...clean.d, price: 0 }) === null, "a zero price yields no curve", clean.ticker);

  // the universe aggregate
  const U = E.forwardPeUniverse();
  if (U) {
    ok(U.years.every(y => y.q1 <= y.median && y.median <= y.q3), "quartile band brackets the median");
    ok(U.years.every(y => y.n > 0), "every plotted year is backed by real names");
    ok(U.years.every((y, i, a) => i === 0 || y.year > a[i - 1].year), "universe years increase");
    ok(U.covered <= U.universe, "covered names cannot exceed the universe");
    ok(U.years.every(y => y.consensus + y.projected === y.n), "each year's basis counts sum to its sample");
  }
}

// =============== 22. Batched live quotes (spark) ===============
{
  ok(typeof E.fetchYahooSparkBatch === "function", "batched spark fetcher is exported");
  // a spark row must produce a real quote or be rejected — never a fake price
  ok(E.applySparkResult(null) === false, "null spark row applies nothing");
  ok(E.applySparkResult({ symbol: "AAPL" }) === false, "spark row without a response applies nothing");
  ok(E.applySparkResult({ symbol: "AAPL", response: [{ meta: {} }] }) === false,
    "spark row with no price applies nothing rather than a zero");
  // applyLiveQuote deliberately leaves d.price (the bundled close) alone and
  // records the quote separately, so the observable effect is the recomputed
  // price-derived multiple
  const cost = E.companyOf("COST");
  const beforePE = cost.headlinePE;
  ok(E.applySparkResult({ symbol: "COST", response: [{ meta: { regularMarketPrice: cost.price * 1.2, previousClose: cost.price } }] }) === true,
    "a well-formed spark row applies its quote");
  ok(cost.gaapEPS <= 0 || cost.headlinePE !== beforePE, "spark quote recomputes price-derived multiples", `${beforePE} -> ${cost.headlinePE}`);
  // falls back to the last close in the series when meta omits the price
  const cl = E.companyOf("TJX").price;
  ok(E.applySparkResult({ symbol: "TJX", response: [{ meta: { previousClose: cl }, indicators: { quote: [{ close: [cl, null, cl + 3] }] } }] }) === true,
    "spark falls back to the last valid close when meta has no price");
  ok(E.applySparkResult({ symbol: "NOTREAL", response: [{ meta: { regularMarketPrice: 10, previousClose: 9 } }] }) === false,
    "a symbol outside the universe is ignored");
}

// =============== 23. Fairness gate: uneven evidence must not rank ===============
{
  const B = E.insidersBundle();
  const complete = !!(B && B.asOf && (B.scanned || 0) >= (B.universe || 0) && !B.partial);
  const ctx = { ledger: E.earningsLedger(), narrs: E.narrativeHeatAll(), whales: E.whaleActionMap() };
  const convs = DATA.map(d => E.convictionOf(d, ctx));

  if (!complete) {
    // the whole point: while the sweep is partial NO name may cast an insider
    // vote, because only the scanned ones could receive its negative case
    ok(convs.every(c => !c.votes.some(v => v.key === "insider")),
      "while the insider sweep is incomplete, no name casts an insider vote",
      String(convs.filter(c => c.votes.some(v => v.key === "insider")).length));
    ok(convs.every(c => c.notEvaluated.length > 0), "every name records the un-evaluated signal");
    // and it must apply UNIFORMLY — scanned and unscanned treated identically
    const scanned = DATA.filter(d => B.tickers && B.tickers[d.ticker]).map(d => E.convictionOf(d, ctx));
    const unscanned = DATA.filter(d => !(B.tickers && B.tickers[d.ticker])).map(d => E.convictionOf(d, ctx));
    const ev = (l) => new Set(l.map(c => c.evidence.toFixed(4)));
    ok(ev(scanned.concat(unscanned)).size === 1,
      "evidence completeness is identical for scanned and unscanned names", [...ev(scanned.concat(unscanned))].join(","));
    const boards = E.masterBoard();
    const cov = new Set(boards.map(r => r.coverage));
    ok(cov.size <= 2, "coverage is not split by whether a name happened to be scanned", [...cov].join(","));
  } else {
    ok(convs.some(c => c.votes.some(v => v.key === "insider")),
      "once the sweep is complete the insider vote is cast");
    ok(convs.every(c => c.notEvaluated.length === 0), "a complete sweep leaves nothing un-evaluated");
  }
  ok(convs.every(c => c.evidence > 0 && c.evidence <= 1), "evidence completeness is a fraction in (0,1]");
  ok(convs.every(c => Array.isArray(c.notEvaluated)), "notEvaluated is always an array");

  // the discount must never let missing evidence RAISE a score
  const board = E.masterBoard();
  ok(board.every(r => r.coverage > 0 && r.coverage <= 100), "coverage stays a valid percentage");
  ok(board.every(r => Array.isArray(r.evidenceGap)), "every ranked row reports its evidence gap");
}

// =============== 24. Owner-earnings withholding uses real SEC data (audit fix) ===============
{
  // An independent audit found the PRIMARY owner-earnings path (ttmOwnerEarnings,
  // used for the large majority of rankable names) never attempted a real
  // SEC-sourced withholding lookup at all, unlike the annual fallback path —
  // every TTM-path name used a flat 25%-of-SBC proxy regardless of what the
  // company actually reported. Measured real-data coverage before this fix:
  // 6 of 217 computable rows (2.8%). These assertions guard the fix.
  ok(typeof E.secWithholdingOf === "function", "secWithholdingOf is exported");
  ok(E.secWithholdingOf("ZZZZNOTATICKER") === null, "no SEC fact -> null, never a fabricated withholding value");
  const aapl = E.secWithholdingOf("AAPL");
  ok(aapl && hasOwnProp(aapl, "value") && aapl.value > 0, "AAPL has a real, positive SEC-reported withholding value", JSON.stringify(aapl));
  function hasOwnProp(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }

  const withData = DATA.filter(d => E.secWithholdingOf(d.ticker) != null);
  ok(withData.length > 50, "a meaningful share of the universe has the SEC withholding tag filed", String(withData.length));

  // ttmOwnerEarnings must now PREFER the real value and say so
  const ttmRows = DATA.map(d => ({ d, ttm: E.ttmOwnerEarnings(d) })).filter(x => x.ttm && x.ttm.ownerEps != null);
  ok(ttmRows.length > 100, "TTM path (the primary path) still computes for most of the universe", String(ttmRows.length));
  ok(ttmRows.every(x => x.ttm.withholdingSource === "SEC-reported employee tax withholding" || x.ttm.withholdingSource === "low-confidence estimate (25% of SBC proxy)"),
    "every TTM row states which withholding basis produced its number");
  const realCoverage = ttmRows.filter(x => x.ttm.withholdingSource.includes("SEC-reported")).length / ttmRows.length;
  ok(realCoverage > 0.30, "real SEC-sourced withholding coverage clears 30% on the primary path (was 0% before this fix)", (realCoverage * 100).toFixed(1) + "%");
  // and it must be CONSISTENT: whenever a real SEC fact exists for a ticker, the
  // TTM path must use it, never silently fall back to the proxy while a real
  // value was available
  const inconsistent = ttmRows.filter(x => E.secWithholdingOf(x.d.ticker) != null && !x.ttm.withholdingSource.includes("SEC-reported"));
  ok(inconsistent.length === 0, "no row ignores an available real SEC withholding fact in favor of the proxy",
    inconsistent.map(x => x.d.ticker).join(","));
  // and the reverse: no row claims a SEC source when none exists
  const fabricated = ttmRows.filter(x => E.secWithholdingOf(x.d.ticker) == null && x.ttm.withholdingSource.includes("SEC-reported"));
  ok(fabricated.length === 0, "no row claims a SEC source without a real underlying fact", fabricated.map(x => x.d.ticker).join(","));
  // the withholding dollar figure itself must equal the real fact's value, not
  // a rescaled or reinterpreted number
  const aaplTtm = ttmRows.find(x => x.d.ticker === "AAPL");
  if (aaplTtm && aapl) ok(Math.abs(aaplTtm.ttm.withholding - aapl.value) < 1e-9, "AAPL's TTM withholding equals the raw SEC fact value exactly");

  // trueOwnerEarnings (the annual path) must keep behaving exactly as before —
  // this fix only factored its lookup into a shared helper, changed nothing else
  const AAPL = E.companyOf("AAPL");
  const st = E.trueOwnerEarnings(AAPL);
  ok(!st.insufficientData && st.withholdingSource === "SEC-reported employee tax withholding",
    "annual path (trueOwnerEarnings) still resolves AAPL's real withholding after the refactor");
  ok(Math.abs(st.withholding - aapl.value) < 1e-9, "annual path's withholding value is unchanged by the refactor");
}

// =============== 25. Estimate-setup engine: fixed windows + sign fix (audit) ===============
{
  // An independent audit found estimateSetupPart diffed the latest snapshot
  // against hist[0] (the OLDEST snapshot ever recorded) rather than a fixed
  // lookback window, so the effective window silently widened every day
  // since collection began. It now reuses scores.js's already-correct
  // fixed-window revisionScore(). These assertions restore ESTIMATE_HISTORY
  // to its real bundled state afterward so no other test observes the mutation.
  const AAPL = E.companyOf("AAPL");
  const savedHist = (typeof ESTIMATE_HISTORY !== "undefined" && ESTIMATE_HISTORY["AAPL"]) || undefined;
  try {
    // a real revision spanning >=30 days must be picked up and must NOT keep
    // growing its effective window as more days pass (the hist[0] bug's signature)
    ESTIMATE_HISTORY["AAPL"] = { snapshots: [
      { date: "2026-05-01", nextYearEps: 8.00, nextYearRevenue: 400 },
      { date: "2026-06-25", nextYearEps: 8.05, nextYearRevenue: 402 },
      { date: "2026-07-27", nextYearEps: 8.80, nextYearRevenue: 420 },
    ] };
    const r = E.estimateSetupPart(AAPL);
    ok(r.score != null, "a real 30d+ revision produces a score");
    ok(r.source === "windowed 7/30/90-day revision (scores.js)", "estimate revisions reuse the shared fixed-window engine, not hist[0]");
    ok(Math.abs(r.raw.epsRev.revisions.r30.days - 32) <= 2, "the window used is a real ~30-day span, not the full collection history", String(r.raw.epsRev.revisions.r30.days));

    // only very-recent snapshots (collection too young for any fixed window)
    // must NOT produce a confident-looking score off a same-week comparison
    ESTIMATE_HISTORY["AAPL"] = { snapshots: [
      { date: "2026-07-24", nextYearEps: 8.7, nextYearRevenue: 418 },
      { date: "2026-07-27", nextYearEps: 8.8, nextYearRevenue: 420 },
    ] };
    const r2 = E.estimateSetupPart(AAPL);
    ok(r2.source !== "windowed 7/30/90-day revision (scores.js)" || r2.score == null,
      "snapshots too young for any real window do not produce a hist[0]-style score");
  } finally {
    if (savedHist === undefined) delete ESTIMATE_HISTORY["AAPL"]; else ESTIMATE_HISTORY["AAPL"] = savedHist;
  }

  // THE SIGN FIX: estimateSetupFallbackScore used to score a BIGGER Street
  // growth ask as MORE bullish unconditionally -- backwards, and
  // self-contradicted by this file's own separate "Street revenue asks for
  // acceleration" risk flag elsewhere. It must now score relative to the
  // company's own trailing trend, penalizing an ask that exceeds it.
  ok(typeof E.estimateSetupFallbackScore === "function", "estimateSetupFallbackScore is exported and independently testable");
  const aggressive = E.estimateSetupFallbackScore(25, 3, 30);   // asks for 25% vs a 3% trend
  const inLine = E.estimateSetupFallbackScore(3, 3, 30);        // asks for exactly trend
  const conservative = E.estimateSetupFallbackScore(1, 10, 30); // asks for less than trend
  ok(aggressive.score < 50, "an ask well ABOVE trailing trend scores BELOW neutral (was: unconditionally bullish)", String(aggressive.score));
  ok(Math.abs(inLine.score - 50) < 1, "an ask exactly in line with trend scores neutral", String(inLine.score));
  ok(conservative.score > 50, "an ask BELOW trailing trend scores above neutral", String(conservative.score));
  ok(aggressive.score < inLine.score && inLine.score < conservative.score,
    "score strictly decreases as the ask-vs-trend gap increases (monotonic, correct direction)");
  ok(E.estimateSetupFallbackScore(25, null, 30) === null, "no trend to compare against -> null, never a fabricated neutral");
  ok(E.estimateSetupFallbackScore(null, 5, 30) === null, "no ask to evaluate -> null");
  ok(aggressive.score >= 0 && aggressive.score <= 100 && conservative.score >= 0 && conservative.score <= 100,
    "fallback score always stays within 0..100");
}

// =============== 26. Peer median, growth-adjusted valuation direction, Expectations Gap basis (audit fixes) ===============
{
  const SE = E.ScoreEngine;
  ok(typeof SE.trueMedian === "function", "trueMedian is exported for direct testing");
  // the exact bug: sorted[floor(n/2)] is the upper-middle element on an even
  // array, not a true median, and has no minimum-sample floor at all
  ok(SE.trueMedian([10, 20, 30, 40], 4) === 25, "true median averages the two middle values on an even array", String(SE.trueMedian([10, 20, 30, 40], 4)));
  ok(SE.trueMedian([1, 2, 3, 4, 5, 6]) === 3.5, "true median on a 6-element array", String(SE.trueMedian([1, 2, 3, 4, 5, 6])));
  ok(SE.trueMedian([5, 15], 2) === 10, "true median on a 2-element array is the average, not the upper element", String(SE.trueMedian([5, 15], 2)));
  ok(SE.trueMedian([1, 2, 3, 4, 5]) === 3, "true median on an odd array is still the single middle element");
  ok(SE.trueMedian([1, 2, 3, 4]) === null, "fewer than 5 samples -> null, never a 'median' of a thin group (default floor)");
  ok(SE.trueMedian([1, 2, 3, 4, 5, 6, 7], 3) === 4, "custom minimum-sample floor is honored");

  // Growth-adjusted valuation: MIN, not MAX, of revenue-CAGR vs owner-EPS-CAGR.
  // Using max systematically flatters names whose revenue outgrows their owner
  // earnings -- the exact SBC/margin-leakage signature owner-earnings exists
  // to catch. Deterministic synthetic case: revenue nearly doubles (~19%
  // CAGR) while the owner-EPS-implied series stays close to flat (~1.3%
  // CAGR) -- if MAX were still used the ratio would be truePE/19 ~= 1.05x;
  // MIN correctly produces truePE/1.3 ~= 15-16x.
  ok(typeof E.ScoreEngine.valuation === "function", "valuation() is exported for direct testing");
  const synthFastRevSlowOwner = {
    ticker: "SYNTH_TEST", sector: "TestSector__no_real_peers", truePE: 20,
    revenue: [100, 110, 120, 140, 200],   // ~19% CAGR
    ni: [10, 10, 10, 10, 10.5], sbc: [1, 1, 1, 1, 1], shares: [10, 10, 10, 10, 10],
  };
  const gv = E.ScoreEngine.valuation(synthFastRevSlowOwner, { data: [synthFastRevSlowOwner] })
    .details.find(x => x.k === "Growth-adjusted valuation");
  ok(gv.score != null, "growth-adjusted valuation scores the synthetic case");
  ok(gv.score < 15, "using the SLOWER (owner-EPS) growth rate produces a low score for an aggressively priced ratio",
    `score=${gv.score} why=${gv.why}`);
  ok(/1[3-8]\.\d+x|1[3-8]x/.test(gv.why), "the ratio in the why-text reflects the ~1.3% owner-EPS rate, not the ~19% revenue rate", gv.why);

  // Expectations Gap: requiredOwnerGrowth (5yr owner-EPS CAGR) must be compared
  // against a SAME-BASIS reference when one is available, not silently
  // differenced against a revenue-basis number under the same label.
  const AAPL = E.companyOf("AAPL");
  const eg = E.marketScoreOf(AAPL).expectationsGap;
  ok(eg.compareBasis == null || eg.compareBasis.includes("owner-EPS") || eg.compareBasis.includes("proxy"),
    "expectationsGap states which basis produced its comparison");
  ok(eg.assumptions.some(a => /compared against/.test(a)), "the comparison basis is disclosed in the assumptions list");
  ok(eg.marketImplied.futureFcfMargin === null,
    "marketImplied.futureFcfMargin is honestly null, not the trailing margin relabeled as a projection");
  ok(eg.terminalBase.futureFcfMargin != null || last(AAPL.qm && AAPL.qm.fcf) == null,
    "terminalBase (explicitly the trailing/terminal figure) still reports the real trailing margin where it exists");
  function last(arr) { return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null; }
  // across the universe, no company's marketImplied.futureFcfMargin is ever
  // non-null (the specific defect: it used to be bit-identical to trailing
  // margin for 224/224 names)
  const fakeForward = DATA.map(d => E.marketScoreOf(d).expectationsGap).filter(g => g && g.marketImplied.futureFcfMargin != null);
  ok(fakeForward.length === 0, "no company reports a fabricated forward FCF margin", String(fakeForward.length));

  // peer-based sub-scores across the universe must never fire below the
  // minimum sample floor
  let peerViolations = 0;
  for (const d of DATA) {
    const peers = DATA.filter(x => x !== d && x.sector === d.sector && x.truePE).length;
    const ms = E.marketScoreOf(d);
    const v = ms && ms.valuation && ms.valuation.details && ms.valuation.details.find(x => x.k === "Peer comparison");
    if (v && v.score != null && peers < 5) peerViolations++;
  }
  ok(peerViolations === 0, "no peer-comparison sub-score fires with fewer than 5 sector peers", String(peerViolations));
}

// =============== 27. Beat Odds track record: percentile vs universe, not a flat 50% bar ===============
{
  const SE = E.ScoreEngine;
  ok(typeof SE.percentileRank === "function", "percentileRank is exported for direct testing");
  ok(SE.percentileRank(50, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) === 45,
    "percentile rank: 4 strictly below + this one itself (midpoint of the tied group)");
  ok(SE.percentileRank(50, [50, 50, 50]) === 50, "an exact 3-way tie all share the midpoint percentile (50)");
  ok(SE.percentileRank(50, [50]) === null, "fewer than 2 population members -> null, nothing to rank against");
  ok(SE.percentileRank(50, []) === null, "empty population -> null");
  ok(SE.percentileRank(null, [1, 2, 3]) === null, "non-numeric value -> null");

  ok(typeof E.beatTrackRaw === "function", "beatTrackRaw is exported for direct testing");
  const hot = E.beatTrackRaw({ beatRate: 1, avgSurprise: 20 });
  const cold = E.beatTrackRaw({ beatRate: 0.25, avgSurprise: -20 });
  ok(hot > cold, "a company with a perfect beat rate and strong surprises ranks raw-higher than a poor one");

  const pop = E.beatTrackPopulation();
  ok(Array.isArray(pop) && pop.length > 0 && pop.every(Number.isFinite),
    "beatTrackPopulation returns a non-empty array of finite raw scores");

  // The defect this replaces: scoring beat rate as distance from a flat 50%
  // midpoint pins the ceiling group (beatRate === 1.0, 137/224 real names)
  // at 98-100/100 with zero ability to tell them apart. After ranking as a
  // real percentile of the universe, that same group must actually spread
  // out, and the ceiling-jam (score >= 95) must no longer describe most of
  // the universe.
  let ceilCount = 0, scored = 0;
  const tiedGroupScores = [];
  for (const d of DATA) {
    const o = E.beatOddsOf(d);
    const track = o.parts.find(p => p.key === "track");
    if (!track || track.score == null) continue;
    scored++;
    if (track.score >= 95) ceilCount++;
    const bs = E.earnBeatStats(d.ticker);
    if (bs && bs.beatRate === 1) tiedGroupScores.push(track.score);
  }
  ok(scored > 0, "at least some names have a scored beat-track component");
  ok(ceilCount / scored < 0.15,
    `fewer than 15% of the universe sits at the 95+ ceiling (was ~60% under the flat-50%-midpoint formula)`,
    `${ceilCount}/${scored}`);
  ok(tiedGroupScores.length < 5 || new Set(tiedGroupScores.map(s => Math.round(s))).size > 10,
    "the perfect-beat-rate cohort (previously all bit-identical) now spreads across many distinct scores",
    `n=${tiedGroupScores.length} distinct=${new Set(tiedGroupScores.map(s => Math.round(s))).size}`);
}

// =============== 28. Conviction votes: cluster correlated sources for sizing only ===============
{
  ok(typeof E.clusterAdjustedNet === "function", "clusterAdjustedNet is exported for direct testing");
  ok(typeof E.CONVICTION_CLUSTERS === "object" && E.CONVICTION_CLUSTERS["earnings-estimate"],
    "the earnings-estimate cluster (revisions/beat/drift/narrative) is exported for inspection");

  const mkVotes = (obj) => Object.entries(obj).map(([key, dir]) => ({ key, dir }));
  // 4 cluster members all bullish must count as ONE net vote, not four
  ok(E.clusterAdjustedNet(mkVotes({ revisions: 1, beat: 1, drift: 1, narrative: 1 }), E.CONVICTION_CLUSTERS) === 1,
    "four correlated bullish votes net to +1, not +4");
  // mixed signal within the cluster nets to 0 (no confident net direction),
  // not a wash that still lets one side "win" arbitrarily
  ok(E.clusterAdjustedNet(mkVotes({ revisions: 1, beat: -1 }), E.CONVICTION_CLUSTERS) === 0,
    "disagreement within the correlated cluster nets to 0");
  // votes outside the cluster are untouched
  ok(E.clusterAdjustedNet(mkVotes({ insider: 1, whale: 1, tier1: -1 }), E.CONVICTION_CLUSTERS) === 1,
    "uncorrelated votes (insider/whale/tier1) still count individually");
  // a mix of clustered + solo votes combines correctly
  ok(E.clusterAdjustedNet(mkVotes({ revisions: 1, beat: 1, narrative: 1, insider: 1, whale: -1 }), E.CONVICTION_CLUSTERS) === 1,
    "one clustered net vote (+1) plus solo votes (+1, -1) combine to +1");

  // The defect this replaces: playbookOf's convMult used raw bulls-bears,
  // so 3-4 votes sharing one analyst-revision figure could each count as a
  // separate independent confirmation and push sizing to its 1.3x ceiling
  // on correlated agreement alone.
  const AAPL = E.companyOf("AAPL");
  const conv = E.convictionOf(AAPL);
  ok(Number.isInteger(conv.netForSizing), "convictionOf exposes a cluster-adjusted netForSizing field");
  ok(conv.bulls >= 0 && conv.bears >= 0, "raw bulls/bears counts are untouched (still what the Conviction Board displays)");

  // Across the real universe: the adjustment must never make the net MORE
  // extreme than the raw vote count in magnitude, and must never flip its
  // sign -- a de-duplication fix must only ever remove inflated agreement,
  // never manufacture new agreement or erase genuine dissent into a false
  // opposite reading.
  let magnitudeViolations = 0, signFlips = 0;
  for (const d of DATA) {
    const c = E.convictionOf(d);
    const rawNet = c.bulls - c.bears;
    if (Math.abs(c.netForSizing) > Math.abs(rawNet)) magnitudeViolations++;
    if (Math.sign(rawNet) !== 0 && Math.sign(c.netForSizing) !== 0 && Math.sign(rawNet) !== Math.sign(c.netForSizing)) signFlips++;
  }
  ok(magnitudeViolations === 0, "cluster-adjusted net never exceeds the raw net's magnitude for any real name", String(magnitudeViolations));
  ok(signFlips === 0, "cluster-adjusted net never flips the sign of a real name's raw net", String(signFlips));
}

// =============== 29. Market Reward: wire real data into the two permanently-null sub-parts ===============
{
  const SE = E.ScoreEngine;
  ok(typeof SE.tradingDaysBetween === "function", "tradingDaysBetween is exported for direct testing");
  ok(SE.tradingDaysBetween("2026-01-01", "2026-01-08") === 5, "7 calendar days -> ~5 trading days", String(SE.tradingDaysBetween("2026-01-01", "2026-01-08")));
  ok(SE.tradingDaysBetween("2026-01-01", "2026-01-01") === 0, "same day -> 0 trading days");
  ok(SE.tradingDaysBetween("2026-01-08", "2026-01-01") === null, "a 'from' date after 'to' -> null, never a negative count");
  ok(SE.tradingDaysBetween(null, "2026-01-01") === null, "missing input -> null");

  ok(typeof SE.earningsSurpriseOf === "function", "earningsSurpriseOf is exported for direct testing");
  ok(SE.earningsSurpriseOf("__NOPE__") === null, "unknown ticker -> null, never a fabricated average");
  const aaplSurprise = SE.earningsSurpriseOf("AAPL");
  ok(aaplSurprise && aaplSurprise.n > 0 && aaplSurprise.n <= 4 && Math.abs(aaplSurprise.avg) <= 15,
    "AAPL's surprise average is built from real bundled history and clamped like driftScoreOf's own convention",
    JSON.stringify(aaplSurprise));

  ok(typeof SE.postEarningsReactionOf === "function", "postEarningsReactionOf is exported for direct testing");
  const AAPL = E.companyOf("AAPL");
  // AAPL's bundled history has no reportedOn stamp yet (only a fiscal
  // quarter-end, which is not a real report date) -- must stay null, never
  // misaligned against a wrong day.
  ok(SE.postEarningsReactionOf(AAPL) === null, "no reportedOn stamp -> null, never a reaction measured off the wrong date");
  // At least one real ticker in the universe DOES have a reportedOn stamp
  // (the daily refresh stamps it the first time a new quarter appears) --
  // prove the plumbing produces a real, sane reaction for it end to end.
  let reactionHit = null;
  for (const d of DATA) {
    const r = SE.postEarningsReactionOf(d);
    if (r) { reactionHit = { ticker: d.ticker, r }; break; }
  }
  ok(reactionHit != null, "at least one real name resolves a post-earnings reaction from bundled reportedOn + daily closes",
    reactionHit ? JSON.stringify(reactionHit) : "none found");
  if (reactionHit) {
    ok(Number.isFinite(reactionHit.r.pct) && reactionHit.r.daysElapsed > 0 && /^\d{4}-\d{2}-\d{2}$/.test(reactionHit.r.reportedOn),
      "the resolved reaction has a real percentage, a positive elapsed trading-day count, and an ISO report date", JSON.stringify(reactionHit));
  }

  // End to end through marketReward(): the two sub-parts must no longer be
  // permanently null for names with real data, and the previous hardcoded
  // "unavailable"/"not bundled yet" why-text must be gone for them.
  const mr = E.marketScoreOf(AAPL).marketReward;
  const surprisePart = mr.details.find(x => x.k === "Earnings surprise history");
  ok(surprisePart.score != null, "AAPL's Earnings surprise history sub-part is no longer hardcoded null", JSON.stringify(surprisePart));
  ok(!/unavailable in bundled data/.test(surprisePart.why), "the stale 'unavailable in bundled data' why-text is gone once real data exists");

  let surpriseCoverage = 0;
  for (const d of DATA) {
    const part = E.marketScoreOf(d).marketReward.details.find(x => x.k === "Earnings surprise history");
    if (part && part.score != null) surpriseCoverage++;
  }
  ok(surpriseCoverage / DATA.length > 0.9, "the vast majority of the universe now has a real (non-null) earnings-surprise sub-score", `${surpriseCoverage}/${DATA.length}`);

  if (reactionHit) {
    const dCov = DATA.find(x => x.ticker === reactionHit.ticker);
    const reactionPart = E.marketScoreOf(dCov).marketReward.details.find(x => x.k === "Post-earnings reaction");
    ok(reactionPart.score != null, `${reactionHit.ticker}'s Post-earnings reaction sub-part is wired end to end through marketReward()`, JSON.stringify(reactionPart));
  }
}

// =============== 30. Universe-size disclosure in proofStatusOf/calibrationOf ===============
{
  ok(typeof E.universeSpanOf === "function", "universeSpanOf is exported for direct testing");
  const mk = (date, universe) => ({ date, universe, entries: [] });
  ok(E.universeSpanOf([mk("2026-01-01", 100), mk("2026-01-02", 100)]).changed === false,
    "a constant universe size across snapshots -> changed:false");
  const resized = E.universeSpanOf([mk("2026-01-01", 100), mk("2026-01-02", 100), mk("2026-01-03", 150)]);
  ok(resized.changed === true && resized.sizes.join(",") === "100,150" && resized.changedOn === "2026-01-03",
    "a real resize is detected, with both sizes and the exact date it changed", JSON.stringify(resized));
  ok(E.universeSpanOf([]).changed === false, "empty history -> changed:false, never a crash");
  ok(E.universeSpanOf([mk("2026-01-01", null)]).changed === false, "snapshots missing a universe field are ignored, not treated as a resize");

  // The real bundled TRACK_HISTORY is known (from the forensic audit that
  // found this gap) to span exactly one resize, 126 -> 224 names, on its
  // 6th recorded day -- prove proofStatusOf surfaces this on the real data,
  // not just in a synthetic case.
  const ps = E.proofStatusOf(TRACK_HISTORY);
  ok(ps.universeSpan && typeof ps.universeSpan.changed === "boolean", "proofStatusOf always returns a universeSpan field");
  if (TRACK_HISTORY.length && new Set(TRACK_HISTORY.map(s => s.universe)).size > 1) {
    ok(ps.universeSpan.changed === true, "proofStatusOf detects the real universe resize in the bundled track history", JSON.stringify(ps.universeSpan));
  }

  // calibrationOf must report the span of only the snapshots THAT ACTUALLY
  // CONTRIBUTED a window (base+target), not the whole history passed in --
  // a horizon with zero windows has nothing to disclose.
  ok(E.calibrationOf(TRACK_HISTORY, 28).universeSpan.changed === false,
    "no 28-day window exists yet in the real (8-day-old) history, so nothing is falsely flagged as spanning a resize");

  // Synthetic case with enough day-span for a real window: a calibration
  // window whose base+target snapshots straddle a resize must be flagged.
  const synthEntries = [{ t: "X", p: 100, dl: "LIKELY UP" }];
  const synthHistory = [
    { date: "2026-01-01", universe: 100, entries: synthEntries },
    { date: "2026-01-29", universe: 150, entries: [{ t: "X", p: 110, dl: "LIKELY UP" }] },
  ];
  const calSynth = E.calibrationOf(synthHistory, 28);
  ok(calSynth.windows === 1 && calSynth.universeSpan.changed === true,
    "a calibration window whose base and target snapshots straddle a real resize is flagged", JSON.stringify(calSynth.universeSpan));
  const synthStable = [
    { date: "2026-01-01", universe: 100, entries: synthEntries },
    { date: "2026-01-29", universe: 100, entries: [{ t: "X", p: 110, dl: "LIKELY UP" }] },
  ];
  ok(E.calibrationOf(synthStable, 28).universeSpan.changed === false,
    "a stable-universe window is not falsely flagged");
}

// =============== 31. Minor cleanups: dilution caption + playbook narrative-cluster awareness ===============
{
  // shareTrend's "over 5Y" caption was hardcoded regardless of how many
  // years d.shares actually spans (the bundle can carry up to ~10 years of
  // SEC-augmented history) -- it must now report the real span.
  ok(E.shareTrend([100, 100]).years === 1, "two data points span exactly 1 interval, not a hardcoded 5");
  ok(E.shareTrend([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]).years === 9,
    "a 10-point series spans 9 real intervals");
  ok(E.shareTrend([]).years === null, "insufficient data -> years is null, never a fabricated span");
  const AAPL = E.companyOf("AAPL");
  ok(AAPL.shares.length > 6, "sanity: AAPL's bundled share history really does exceed 5 points", String(AAPL.shares.length));
  const aaplTrend = E.shareTrend(AAPL.shares);
  ok(aaplTrend.years === AAPL.shares.length - 1, "AAPL's real caption span matches its real history length, not a hardcoded 5Y", JSON.stringify(aaplTrend));

  // playbookOf: a suggested position has no way to see that another
  // concurrently-suggested "best idea" might be the same correlated bet.
  // Annotate which NARRATIVES cluster(s) (if any) this ticker belongs to.
  const MU = DATA.find(d => d.ticker === "MU");
  const pb = E.playbookOf(MU);
  ok(pb && Array.isArray(pb.narrativeClusters), "playbookOf always returns a narrativeClusters array (possibly empty)");
  const aiCluster = pb.narrativeClusters.find(nc => nc.key === "ai-compute");
  ok(aiCluster && aiCluster.otherMembers.includes("NVDA"), "MU's playbook correctly flags it shares the AI Compute Supercycle cluster with NVDA and others", JSON.stringify(pb.narrativeClusters));
  ok(!aiCluster.otherMembers.includes("MU"), "the ticker itself is excluded from its own otherMembers list");

  // A name in no narrative cluster must not fabricate one.
  const noClusterTicker = DATA.find(d => {
    const p = E.playbookOf(d);
    return p && Array.isArray(p.narrativeClusters) && p.narrativeClusters.length === 0;
  });
  ok(noClusterTicker !== undefined, "at least one real name has zero narrative clusters, proving the field isn't always non-empty by construction");

  // options block: a stale/expired bundled chain must stay MISSING, not
  // score a fabricated -6 bearish adjustment. This data is not part of the
  // automated daily refresh, so it goes stale on a ticking clock even
  // though nothing was re-observed.
  ok(typeof E.optionsPositioningPart === "function" && typeof E.optDteNow === "function",
    "optionsPositioningPart and optDteNow are exported for direct testing");
  const iso = (daysFromNow) => new Date(Date.now() + daysFromNow * 864e5).toISOString().slice(0, 10);
  const freshOpt = { iv: 0.3, rv: 0.27, pcr: 0.5, exp: iso(20) };
  const nearExpiryOpt = { iv: 0.3, rv: 0.27, pcr: 0.5, exp: iso(3) };
  const expiredOpt = { iv: 0.3, rv: 0.27, pcr: 0.5, exp: iso(-10) };
  const freshPart = E.optionsPositioningPart({ opt: freshOpt });
  ok(freshPart.score != null, "a fresh (20d out) chain scores normally", JSON.stringify(freshPart));
  const nearPart = E.optionsPositioningPart({ opt: nearExpiryOpt });
  ok(nearPart.score === null, "a chain inside the 7-day staleness window stays null, never a fabricated bearish -6", JSON.stringify(nearPart));
  ok(/stale/i.test(nearPart.why) && !/chain stale\/near expiry/.test(nearPart.why), "the why-text names it as a data-quality issue, not the old bearish-adjustment label");
  const expiredPart = E.optionsPositioningPart({ opt: expiredOpt });
  ok(expiredPart.score === null, "an already-expired chain also stays null", JSON.stringify(expiredPart));

  // real universe: none of the 60 bundled-options tickers currently produce
  // the old -6 "chain stale/near expiry" bearish artifact (they're all
  // still comfortably outside the 7-day window as of this run, and the
  // fix removes the mechanism regardless of when that stops being true)
  let staleArtifact = 0;
  for (const d of DATA) {
    const p = E.optionsPositioningPart(d);
    if (p.why && /chain stale\/near expiry/.test(p.why)) staleArtifact++;
  }
  ok(staleArtifact === 0, "no real name's options why-text still contains the old fabricated staleness-as-bearish label");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
