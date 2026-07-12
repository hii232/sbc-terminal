const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

global.window = { addEventListener: () => {}, __engines: null };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.document = {
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
};
global.navigator = {};
global.history = { state: null, pushState: () => {}, replaceState: () => {} };
global.fetch = () => Promise.reject(new Error("no network in export"));

const files = [
  "universe.js",
  "data.js",
  "sec.js",
  "segments.js",
  "sectors.js",
  "estimates.js",
  "scores.js",
  "charts.js",
  "app.js",
];
const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n");
vm.runInThisContext(`${src}
globalThis.__SBC_EXPORT = { DATA, UNIVERSE_LIST, SEC, SECTORS, ESTIMATE_HISTORY, ScoreEngine: window.ScoreEngine, E: window.__engines };`, { filename: "score-export-bundle.js" });

const { DATA, SECTORS, ESTIMATE_HISTORY, ScoreEngine, E } = global.__SBC_EXPORT;
const ctx = { data: DATA, sectors: SECTORS, estimates: ESTIMATE_HISTORY };
const asOf = new Date().toISOString();

function scoreRow(d) {
  const s = ScoreEngine.scoreCompany(d, ctx);
  const fwd = E.forwardPEOf(d);
  return {
    ticker: d.ticker,
    name: d.name,
    sector: d.sector,
    price: d.price,
    ownerPE: d.truePE,
    ownerEPS: d.ownerEps,
    ownerEPSSource: d.ownerEpsSource || null,
    forwardPE: fwd.pe,
    forwardEPS: fwd.eps,
    forwardPESource: fwd.source,
    finalLabel: s.finalLabel.label,
    longTermView: s.longTermView.score,
    marketRewardView: s.marketRewardView.score,
    businessQuality: s.businessQuality.score,
    growthExecution: s.growthExecution.score,
    marketReward: s.marketReward.score,
    shareholderEconomics: s.shareholderEconomics.score,
    valuation: s.valuation.score,
    dataConfidence: s.dataConfidence.score,
    expectationsGap: s.expectationsGap.label,
    whatChanged: s.whatChanged.label,
    whyRise: s.whyRise,
    whatCouldGoWrong: s.whatCouldGoWrong,
  };
}

function avg(xs) {
  const vals = xs.filter((x) => Number.isFinite(x));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function noLookaheadMomentumPilot(horizonWeeks) {
  const usable = DATA.filter((d) => d.px && Array.isArray(d.px.v) && d.px.v.length > 30);
  const minLen = Math.min(...usable.map((d) => d.px.v.length));
  const periods = [];
  for (let i = 13; i < minLen - horizonWeeks; i += 1) {
    const obs = usable.map((d) => {
      const p = d.px.v;
      const factor = p[i - 13] ? (p[i] / p[i - 13]) - 1 : null;
      const future = p[i] ? (p[i + horizonWeeks] / p[i]) - 1 : null;
      return Number.isFinite(factor) && Number.isFinite(future) ? { ticker: d.ticker, factor, future } : null;
    }).filter(Boolean).sort((a, b) => b.factor - a.factor);
    if (obs.length < 20) continue;
    const q = Math.max(1, Math.floor(obs.length * 0.2));
    const top = obs.slice(0, q);
    const bottom = obs.slice(-q);
    periods.push({
      weekIndex: i,
      topAvgForwardReturn: avg(top.map((x) => x.future)),
      bottomAvgForwardReturn: avg(bottom.map((x) => x.future)),
      spread: avg(top.map((x) => x.future)) - avg(bottom.map((x) => x.future)),
      namesPerBucket: q,
    });
  }
  return {
    factor: "13-week price relative strength",
    horizonWeeks,
    method: "At each historical week, rank only by information available at that week, then measure later returns.",
    observations: periods.length,
    averageTopForwardReturnPct: avg(periods.map((p) => p.topAvgForwardReturn)) * 100,
    averageBottomForwardReturnPct: avg(periods.map((p) => p.bottomAvgForwardReturn)) * 100,
    averageSpreadPct: avg(periods.map((p) => p.spread)) * 100,
  };
}

const rows = DATA.map(scoreRow).sort((a, b) => (b.longTermView || -1) - (a.longTermView || -1));
function valuationAuditRow(d) {
  const dc = E.dataConfidenceOf(d);
  const impliedHeadlinePE = d.gaapEPS && d.gaapEPS > 0 && d.price ? +(d.price / d.gaapEPS).toFixed(1) : null;
  const headlineGap = impliedHeadlinePE != null && d.headlinePE != null ? +(d.headlinePE - impliedHeadlinePE).toFixed(2) : null;
  const flags = [];
  if (headlineGap != null && Math.abs(headlineGap) > 0.6) flags.push("headline-pe-price-eps-mismatch");
  if (dc.rankable && d.truePE && !/TTM quarterly/.test(d.ownerEpsSource || "")) flags.push("annual-owner-eps-basis");
  if (dc.rankable && d.truePE == null && d.ownerEps != null && d.ownerEps <= 0) flags.push("negative-owner-eps-no-pe");
  else if (dc.rankable && d.truePE == null) flags.push("missing-owner-pe");
  if (d.truePE != null && d.truePE > 80) flags.push("high-owner-pe-check-expectations");
  return {
    ticker: d.ticker,
    name: d.name,
    sector: d.sector,
    price: d.price,
    gaapEPS: d.gaapEPS,
    headlinePE: d.headlinePE,
    impliedHeadlinePE,
    headlineGap,
    ownerEPS: d.ownerEps,
    ownerPE: d.truePE,
    ownerEPSSource: d.ownerEpsSource || null,
    dataConfidence: dc.score,
    rankable: dc.rankable,
    flags,
  };
}
const valuationRows = DATA.map(valuationAuditRow).sort((a, b) => a.ticker.localeCompare(b.ticker));
const valuationAudit = {
  asOf,
  universe: DATA.length,
  headlinePriceEpsMismatches: valuationRows.filter(r => r.flags.includes("headline-pe-price-eps-mismatch")).length,
  rankedAnnualOwnerEpsBasis: valuationRows.filter(r => r.flags.includes("annual-owner-eps-basis")).length,
  missingOwnerPE: valuationRows.filter(r => r.flags.includes("missing-owner-pe")).length,
  negativeOwnerEpsNoPE: valuationRows.filter(r => r.flags.includes("negative-owner-eps-no-pe")).length,
  highOwnerPE: valuationRows.filter(r => r.flags.includes("high-owner-pe-check-expectations")).length,
  note: "Valuation audit checks period-basis consistency. Headline P/E must match price / GAAP EPS. Owner P/E uses TTM quarterly owner EPS when available; annual owner EPS is flagged so it is visible, not silent.",
  rows: valuationRows,
};
const scoreOut = {
  asOf,
  modelVersion: ScoreEngine.MARKET_TERMINAL_VERSION,
  count: rows.length,
  methodology: "Current snapshot scores. Data Confidence is a separate trust gate and is not additive.",
  rows,
};

const backtest = {
  asOf,
  status: "partial",
  noLookaheadPolicy: "Historical tests must rank using only data known at the historical date.",
  pointInTimeFactorBacktest: {
    status: "blocked",
    reason: "Full score factors require point-in-time fundamentals, analyst revisions, guidance, surprise history and earnings-reaction snapshots. The repo only has current bundled fundamentals today, so a full historical score backtest would be lookahead-biased.",
    nextStep: "The estimate-history workflow and future fundamentals snapshots create the dataset needed for full no-lookahead tests.",
  },
  availableNoLookaheadPilot: [
    noLookaheadMomentumPilot(4),
    noLookaheadMomentumPilot(13),
    noLookaheadMomentumPilot(26),
  ],
};

fs.mkdirSync(path.join(ROOT, "data", "scores"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "data", "backtests"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "data", "audits"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data", "scores", "latest-scores.json"), `${JSON.stringify(scoreOut, null, 2)}\n`);
fs.writeFileSync(path.join(ROOT, "data", "backtests", "score-backtest.json"), `${JSON.stringify(backtest, null, 2)}\n`);
fs.writeFileSync(path.join(ROOT, "data", "audits", "valuation-audit.json"), `${JSON.stringify(valuationAudit, null, 2)}\n`);
console.log(`wrote ${rows.length} scores and no-lookahead backtest report`);
