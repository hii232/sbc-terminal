const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
global.window = { addEventListener: () => {}, __engines: null };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.document = { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
global.navigator = {};
global.history = { state: null, pushState: () => {}, replaceState: () => {} };
global.fetch = () => Promise.reject(new Error("no network in report"));

const files = ["universe.js", "data.js", "sec.js", "segments.js", "sectors.js", "estimates.js", "scores.js", "charts.js", "app.js"];
vm.runInThisContext(`${files.map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n")}
globalThis.__REPORT = { DATA, SEC, E: window.__engines };`, { filename: "sec-alignment-report-bundle.js" });

const { DATA, SEC, E } = global.__REPORT;
const byTicker = {};
const summary = {
  asOf: new Date().toISOString(),
  universe: DATA.length,
  trueConflicts: 0,
  periodMismatches: 0,
  definitionMismatches: 0,
  unitMismatches: 0,
  missingFacts: 0,
  missingStandardTags: 0,
  customTagMappingsNeeded: 0,
  ifrsCompaniesNeedingReview: 0,
  fullFilingVerified: 0,
  coreFilingVerified: 0,
  partiallyVerified: 0,
  notVerified: 0,
  rankableCompanies: 0,
};

for (const d of DATA) {
  const q = E.dataQualityOf(d);
  const dc = E.dataConfidenceOf(d);
  const sv = d.secv || {};
  const ifrsReview = d.ticker === "ASML" && q.label === "NOT VERIFIED";
  const customNeeded = (sv.missing || []).some(x => /MISSING SEC FACT/.test(x.type || x.status || ""));
  const missingStandard = (sv.missing || []).length;
  summary.trueConflicts += (sv.conflict || []).length;
  summary.periodMismatches += (sv.periodMismatch || []).length;
  summary.definitionMismatches += (sv.definitionMismatch || []).length;
  summary.unitMismatches += (sv.unitMismatch || []).length;
  summary.missingFacts += (sv.missing || []).length;
  summary.missingStandardTags += missingStandard;
  summary.customTagMappingsNeeded += customNeeded ? 1 : 0;
  summary.ifrsCompaniesNeedingReview += ifrsReview ? 1 : 0;
  summary.fullFilingVerified += q.label === "FULL FILING VERIFIED" ? 1 : 0;
  summary.coreFilingVerified += q.label === "CORE FILING VERIFIED" ? 1 : 0;
  summary.partiallyVerified += q.label === "PARTIALLY VERIFIED" ? 1 : 0;
  summary.notVerified += q.label === "NOT VERIFIED" ? 1 : 0;
  summary.rankableCompanies += dc.rankable ? 1 : 0;
  byTicker[d.ticker] = {
    label: q.label,
    dataConfidence: dc.score,
    rankable: dc.rankable,
    latestPeriodEnd: d.annualPeriods && d.annualPeriods.at(-1)?.periodEnd,
    trueConflicts: sv.conflict || [],
    periodMismatches: sv.periodMismatch || [],
    missing: sv.missing || [],
    missingReason: ifrsReview ? "FOREIGN IFRS MAPPING NEEDED" : customNeeded ? "CUSTOM TAG MAPPING NEEDED" : missingStandard ? "MISSING SEC FACT" : null,
  };
}

const out = {
  ...summary,
  rankableBeforeFix: null,
  rankableAfterFix: summary.rankableCompanies,
  note: "Before-fix rankable count was not recomputed because the old fiscalYear matcher has been removed. This report is generated from exact periodEnd matching.",
  byTicker,
};

fs.mkdirSync(path.join(ROOT, "data", "audits"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data", "audits", "sec-period-alignment-report.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`SEC alignment report: ${summary.trueConflicts} true conflicts, ${summary.periodMismatches} period mismatches, ${summary.rankableCompanies} rankable`);
