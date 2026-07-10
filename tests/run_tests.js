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
const src = ["data.js", "segments.js", "sectors.js", "charts.js", "app.js"]
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
  for (let i = 0; i < DATA.length; i += 13) {
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
  // heavy SBC + no buyback: owner < NI, cost = withholding proxy only
  const diluter = { ni: [4], sbc: [2], buyback: [0] };
  const oe2 = E.trueOwnerEarnings(diluter);
  ok(oe2.owner > oe2.ni && oe2.owner === oe2.ni + oe2.sbc - oe2.trueCost, "identity: NI + SBC - trueCost");
  ok(oe2.trueCost === 0.5, "no-buyback: cost = 25% withholding proxy", String(oe2.trueCost));
  // negative NI: engine must not fabricate positive owner earnings beyond identity
  const loser = { ni: [-2], sbc: [1], buyback: [0] };
  const oe3 = E.trueOwnerEarnings(loser);
  ok(Math.abs(oe3.owner - (-2 + 1 - 0.25)) < 1e-9, "negative NI handled by identity");
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
    if (!(V.score >= 0 && V.score <= 100) || !V.call || !V.C) bad.push(d.ticker);
  }
  ok(bad.length === 0, "verdictOf: score in [0,100] + a call for ALL 650 names", bad.slice(0, 5).join(","));
}

// =============== 7. Graham engine guards ===============
{
  let nanBad = [];
  for (let i = 0; i < DATA.length; i += 7) {
    const G = E.grahamOf(DATA[i]);
    if (G && [G.score, G.passed].some(v => !Number.isFinite(v))) nanBad.push(DATA[i].ticker);
  }
  ok(nanBad.length === 0, "grahamOf outputs finite", nanBad.join(","));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
