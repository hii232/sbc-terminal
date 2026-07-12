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
const src = ["universe.js", "data.js", "sec.js", "segments.js", "sectors.js", "estimates.js", "scores.js", "charts.js", "app.js"]
  .map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");
vm.runInThisContext(src, { filename: "bundle.js" });
const E = global.window.__engines;
if (!E) { console.error("FATAL: __engines not exported"); process.exit(1); }

let pass = 0, fail = 0;
const ok = (cond, name, detail = "") => {
  if (cond) { pass++; }
  else { fail++; console.error("  ✗ FAIL:", name, detail); }
};

// =============== 1. Black-Scholes correctness ===============
{
  ok(E.lastVal([]) === null, "lastVal([]) -> null, never fake zero");
  ok(E.lastVal([null, undefined, 0]) === 0, "lastVal preserves real zero");
  // put-call parity: C - P = S - K·e^(-rT)
  for (const [S, K, iv, dte] of [[100, 100, 0.3, 35], [250, 220, 0.6, 60], [50, 65, 0.9, 20]]) {
    const c = E.bsPrice("call", S, K, iv, dte), p = E.bsPrice("put", S, K, iv, dte);
    const parity = S - K * Math.exp(-0.04 * dte / 365);
    ok(Math.abs((c - p) - parity) < 0.02, `put-call parity S=${S} K=${K}`, `${(c - p).toFixed(3)} vs ${parity.toFixed(3)}`);
  }
  // call ≥ intrinsic, value increases with IV
  ok(E.bsPrice("call", 120, 100, 0.4, 30) >= 20, "call >= intrinsic");
  ok(E.bsPrice("call", 100, 100, 0.6, 35) > E.bsPrice("call", 100, 100, 0.3, 35), "call value rises with IV");
  ok(E.bsPrice("put", 100, 100, 0.3, 0) === null, "zero dte -> null (no fake price)");
  ok(E.normCdf(0) > 0.499 && E.normCdf(0) < 0.501, "normCdf(0) ~ 0.5");
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

// =============== 5. Options staleness (the real-money bug) ===============
{
  const mk = (exp, dteAtFetch) => ({ ticker: "TST", price: 100, ownersKeep: 0.9, bucket: "clean",
    gaapEPS: 5, sbcAdjEPS: 4.5, revenue: [10, 11, 12, 13], fy: ["2022", "2023", "2024", "2025"],
    shares: [1, 1, 1, 1], buyback: [0, 0, 0, 0], sbc: [0, 0, 0, 0], ni: [5, 5, 5, 5],
    opt: { iv: 0.4, rv: 0.3, pcr: 1, exp, dte: dteAtFetch } });
  // expired chain: play may exist but premium must be null (no stale-IV pricing)
  const expired = mk("2025-01-17", 35);
  const V = E.verdictOf(expired);
  const play = E.optionPlayOf(expired, V);
  if (play) ok(play.prem == null, "EXPIRED chain -> no premium estimate", JSON.stringify({ prem: play.prem }));
  else ok(true, "expired chain produced no play (acceptable)");
  // fresh chain: premium allowed
  const freshExp = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
  const fresh = mk(freshExp, 40);
  const play2 = E.optionPlayOf(fresh, E.verdictOf(fresh));
  if (play2) ok(play2.prem == null || Number.isFinite(play2.prem), "fresh chain premium finite when present");
  else ok(true, "no play for fixture (call gates) — acceptable");
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
  ok(bad.length === 0, "verdictOf: ranked names score; low-confidence names are NOTRANK", bad.slice(0, 5).join(","));
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
  ok(rankedAnnualBasis.length <= 1, "ranked valuation mostly uses TTM owner EPS; annual-basis exceptions are visible",
    rankedAnnualBasis.map(d => `${d.ticker}:${d.ownerEpsSource}`).join(","));
  const forwardRows = DATA.map(d => ({ d, f: E.forwardPEOf(d) })).filter(x => E.dataConfidenceOf(x.d).rankable && x.f.pe != null);
  ok(forwardRows.length >= 45, "forward P/E available for most rankable names", String(forwardRows.length));
  const muFwd = E.forwardPEOf(mu);
  ok(muFwd.pe > 0 && muFwd.pe < mu.truePE, "MU forward P/E appears beside owner P/E and is finite", `${muFwd.pe}x`);
}

// =============== 9. Universe + SEC filing layer ===============
{
  const expected = typeof UNIVERSE_LIST !== "undefined" ? UNIVERSE_LIST.length : 0;
  ok(expected === 60, "UNIVERSE_LIST length is exactly 60", String(expected));
  ok(DATA.length === 60, "DATA length is exactly 60", String(DATA.length));
  ok(!UNIVERSE_LIST.some(u => u.ticker === "FLUT"), "FLUT is not in official universe");
  ok(!DATA.some(d => d.ticker === "FLUT"), "FLUT is not in DATA");
  ok(new Set(UNIVERSE_LIST.map(u => u.ticker)).size === expected, "no duplicate tickers");
  ok(UNIVERSE_LIST.every(u => u.cik && u.name && u.sector), "every name has identity + CIK");
  const uniSet = new Set(UNIVERSE_LIST.map(u => u.ticker));
  ok(DATA.every(d => uniSet.has(d.ticker)), "no unapproved tickers in DATA");
  // SEC layer integrity: provenance on every fact
  ok(typeof SEC !== "undefined" && Object.keys(SEC).length === 60, "SEC facts for exactly 60 official names", `${Object.keys(SEC || {}).length}/60`);
  let provOk = 0, checked = 0;
  for (const tk of Object.keys(SEC)) {
    const f = SEC[tk].f.revenue;
    if (f) { checked++; if (f.form && f.filed && f.accn && f.tag) provOk++; }
  }
  ok(provOk === checked && checked >= 55, "every SEC fact carries form+filed+accession+tag", `${provOk}/${checked}`);
  // cross-check ran: verified majority, conflicts flagged not hidden
  const full = DATA.filter(d => E.dataQualityOf(d).label === "FULL FILING VERIFIED").length;
  const core = DATA.filter(d => E.dataQualityOf(d).label === "CORE FILING VERIFIED").length;
  // Fully verified count moves as the official universe grows; the rest are PARTIAL.
  // 20-F filers, tag variants) — tracked in AUDIT.md as the next data milestone
  ok(full >= 34, "34+ names FULL FILING VERIFIED", String(full));
  ok(full + core >= 40, "40+ names full/core filing verified", `${full + core}/${expected}`);
  const partial = DATA.filter(d => ["FULL FILING VERIFIED", "CORE FILING VERIFIED", "PARTIALLY VERIFIED"].includes(E.dataQualityOf(d).label)).length;
  ok(partial >= expected - 2, "all but at most two names at least partially SEC-verified", `${partial}/${expected}`);
  ok(DATA.every(d => d.secv), "secCheck ran for every name");
  ok(!src.includes("nothing filing-verified"), "no stale contradictory filing-verification wording");
  // missing is NOT zero: fixture with no SBC data must not produce computed retention
  const noSbc = { ticker: "XX", ni: [5, 5, 5], sbc: [null, null, null], buyback: [1, 1, 1], price: 10, gaapEPS: 1, headlinePE: 10, ownersKeep: 0.9 };
  const st = E.trueOwnerEarnings(noSbc);
  ok(st.sbcMissing === true && st.owner === null, "missing SBC flagged as missing, not zero");
  const lowConfidence = DATA.filter(d => E.dataConfidenceOf(d).score < 80);
  ok(lowConfidence.every(d => E.rankOf(d).noRank === true), "data confidence below 80 is blocked from main ranking", String(lowConfidence.length));
  const verifiedYoung = ["CRWD", "PLTR", "UBER"].map(t => DATA.find(d => d.ticker === t));
  ok(verifiedYoung.every(d => d && E.dataConfidenceOf(d).score >= 80 && E.rankOf(d).noRank !== true),
    "verified owner-EPS names rank even when retention history is unavailable",
    verifiedYoung.map(d => d && `${d.ticker}:${E.dataConfidenceOf(d).score}/${E.rankOf(d).noRank ? "blocked" : "ranked"}`).join(","));
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
  ok(map.length === 60, "quality x market map covers exactly 60 tickers", String(map.length));
  ok(map.every(p => p.ticker && p.label), "quality map rows have ticker and label");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
