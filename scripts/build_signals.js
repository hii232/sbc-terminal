/* WHAT-CHANGED SIGNALS ENGINE — the edge layer's daily diff pass.
   Runs in the data-refresh workflow AFTER every data source has refreshed.
   Levels are what everyone knows; this script emits the DELTAS:

     · score inflections   (business quality / market reward / long-term /
                            direction edge crossing thresholds or jumping)
     · direction-edge label flips (NO EDGE -> LIKELY UP, etc.)
     · beat-odds regime entries for reports inside 3 weeks
     · analyst revision flips (30d up/down counts changing sign, consensus
                            EPS drift inflecting)
     · fresh beats/misses  (new quarters stamped by the earnings pipeline)
     · filing diffs        (a new SEC accession landed: revenue growth
                            acceleration/deceleration, SBC burden change,
                            share-count turn — computed from filing facts)

   State lives in data/signals_state.json (yesterday's comparable values +
   processed SEC accessions). The rolling event ledger lives in
   data/signals_history.json and is bundled to signals.js for the app.
   First run emits filing events only — score deltas need a previous day.
   Nothing is fabricated: a signal that cannot be computed is skipped.

       node scripts/build_signals.js                                        */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { addEventListener: () => {}, __engines: null };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.document = { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [],
  getElementById: () => ({ innerHTML: "", classList: { toggle() {}, add() {}, remove() {} }, querySelectorAll: () => [] }) };
global.navigator = {};
global.history = { state: null, pushState: () => {}, replaceState: () => {} };
global.fetch = () => Promise.reject(new Error("no network"));

const root = path.join(__dirname, "..");
const files = ["universe.js", "data.js", "sec.js", "segments.js", "sectors.js", "charts.js",
  "scores.js", "estimates.js", "earnings.js", "app.js"].filter(f => fs.existsSync(path.join(root, f)));
vm.runInThisContext(files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n"));
const E = global.window.__engines;
if (!E || !E.directionEdgeOf) { console.error("engines unavailable"); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);
const STATE_FILE = path.join(root, "data", "signals_state.json");
const HIST_FILE = path.join(root, "data", "signals_history.json");
const OUT_JS = path.join(root, "signals.js");

const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return def; } };
const prev = readJson(STATE_FILE, { date: null, tickers: {}, accessions: {}, estimates: {} });
let history = readJson(HIST_FILE, []);

const fin = (v) => (v != null && Number.isFinite(+v) ? +v : null);
const pct1 = (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%";

/* ---------- 1. compute today's comparable state per ticker ---------- */
const stateNow = {};
for (const d of DATA) {
  const row = { p: fin(d.price) };
  try {
    const ms = E.marketScoreOf(d);
    if (ms) {
      row.bq = fin(ms.businessQuality?.score);
      row.mr = fin(ms.marketReward?.score);
      row.lt = fin(ms.longTermView?.score);
    }
    const edge = E.directionEdgeOf(d);
    if (edge && Number.isFinite(edge.score)) { row.de = edge.score; row.dl = edge.label; }
    const it = E.earnIntelOf(d.ticker);
    if (it && it.trend) {
      const up = fin(it.trend.revUp30), down = fin(it.trend.revDown30);
      if (up != null && down != null) row.rev = up - down;
      const now = fin(it.trend.epsNow), ago = fin(it.trend.eps30dAgo);
      if (now != null && ago != null && Math.abs(ago) > 1e-9) row.drift = +(((now - ago) / Math.abs(ago)) * 100).toFixed(2);
    }
    if (it && it.nextDate && it.nextDate >= today &&
        (Date.parse(it.nextDate) - Date.parse(today)) <= 21 * 864e5) {
      const odds = E.beatOddsOf(d);
      if (odds && odds.score != null && odds.coverage >= 55) { row.bo = odds.score; row.next = it.nextDate; }
    }
  } catch { /* skip broken signal, keep the rest */ }
  stateNow[d.ticker] = row;
}

/* ---------- 2. diff against yesterday -> events ---------- */
const events = [];
const add = (tk, type, m, title, detail) => events.push({ d: today, tk, type, m, title, detail });
const crossed = (a, b, level) => a != null && b != null && ((a < level && b >= level) || (a >= level && b < level));

if (prev.date && prev.date !== today) {
  for (const [tk, now] of Object.entries(stateNow)) {
    const old = prev.tickers[tk];
    if (!old) continue;
    // direction-edge label flips (the loudest tape signal we compute)
    if (now.dl && old.dl && now.dl !== old.dl) {
      const upFlip = ["LIKELY UP", "UP BIAS"].includes(now.dl) && !["LIKELY UP", "UP BIAS"].includes(old.dl);
      const downFlip = ["LIKELY DOWN", "DOWN BIAS"].includes(now.dl) && !["LIKELY DOWN", "DOWN BIAS"].includes(old.dl);
      if (upFlip || downFlip) add(tk, "edge", 75, `Direction Edge flipped: ${old.dl} → ${now.dl}`,
        `edge score ${old.de ?? "?"} → ${now.de ?? "?"}`);
    }
    // score threshold crossings + large one-day jumps
    for (const [key, label, level] of [["bq", "Business Quality", 70], ["mr", "Market Reward", 60], ["lt", "Long-Term View", 70]]) {
      const a = old[key], b = now[key];
      if (a == null || b == null) continue;
      if (crossed(a, b, level)) add(tk, "score", 65, `${label} crossed ${b >= level ? "ABOVE" : "below"} ${level}`, `${a} → ${b}`);
      else if (Math.abs(b - a) >= 8) add(tk, "score", 55, `${label} ${b > a ? "jumped" : "dropped"} ${Math.abs(b - a)} points`, `${a} → ${b}`);
    }
    // analyst revision tape flips
    if (now.rev != null && old.rev != null) {
      if (old.rev <= 0 && now.rev > 0) add(tk, "revisions", 70, "Revision tape flipped POSITIVE", `net 30d EPS revisions ${old.rev} → +${now.rev}`);
      else if (old.rev >= 0 && now.rev < 0) add(tk, "revisions", 70, "Revision tape flipped NEGATIVE", `net 30d EPS revisions +${old.rev} → ${now.rev}`);
      else if (Math.abs(now.rev - old.rev) >= 6) add(tk, "revisions", 55, `Revision tape ${now.rev > old.rev ? "accelerating" : "deteriorating"}`, `net 30d revisions ${old.rev} → ${now.rev}`);
    }
    if (now.drift != null && old.drift != null && Math.sign(now.drift) !== Math.sign(old.drift) && Math.abs(now.drift - old.drift) >= 0.5)
      add(tk, "revisions", 60, `Consensus EPS drift inflected ${now.drift > 0 ? "UP" : "DOWN"}`, `30d drift ${pct1(old.drift)} → ${pct1(now.drift)}`);
    // beat-odds regime entries for imminent reports
    if (now.bo != null && now.next) {
      const was = old.bo;
      if (now.bo >= 68 && (was == null || was < 68)) add(tk, "earnings", 65, `Entered STRONG BEAT SETUP (${now.bo}) — reports ${now.next}`, "Beat Odds composite crossed 68");
      else if (now.bo <= 35 && (was == null || was > 35)) add(tk, "earnings", 65, `Entered MISS RISK (${now.bo}) — reports ${now.next}`, "Beat Odds composite fell to 35 or below");
    }
  }
}

/* ---------- 3. fresh beats/misses stamped today by the earnings pipeline ---------- */
for (const d of DATA) {
  const it = E.earnIntelOf(d.ticker);
  for (const h of (it && it.history) || []) {
    if (h.reportedOn !== today || h.epsActual == null || h.epsEstimate == null) continue;
    const beat = h.epsActual > h.epsEstimate;
    add(d.ticker, "earnings", 85,
      `Reported: ${beat ? "BEAT" : h.epsActual < h.epsEstimate ? "MISS" : "IN-LINE"}${h.surprisePct != null ? " " + pct1(h.surprisePct) : ""}`,
      `EPS $${h.epsActual.toFixed(2)} vs $${h.epsEstimate.toFixed(2)} est · fiscal qtr ${h.quarter || "?"}${beat ? " · drift-board candidate" : ""}`);
  }
}

/* ---------- 3a. analyst rating actions (upgrades/downgrades) ---------- */
const TIER1 = new Set(["morgan stanley", "goldman sachs", "jpmorgan", "j.p. morgan", "jp morgan",
  "bofa securities", "bank of america", "ubs", "barclays", "citigroup", "citi", "wells fargo",
  "deutsche bank", "evercore isi", "bernstein", "jefferies", "rbc capital", "hsbc"]);
const ratingsEmitted = { ...(prev.ratingsEmitted || {}) };
const fresh10 = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
for (const d of DATA) {
  const it = E.earnIntelOf(d.ticker);
  for (const r of (it && it.ratings) || []) {
    if (!r.date || r.date < fresh10 || !r.firm) continue;
    const key = `${r.date}|${r.firm}|${r.to || ""}`;
    const seen = ratingsEmitted[d.ticker] = ratingsEmitted[d.ticker] || [];
    if (seen.includes(key)) continue;
    const tier1 = TIER1.has(r.firm.toLowerCase());
    const isUp = r.action === "up";
    const isDown = r.action === "down";
    // reiterations/maintains only matter from tier-1 desks; grade CHANGES always matter
    if (!isUp && !isDown && !(tier1 && r.action === "init")) { seen.push(key); continue; }
    seen.push(key);
    const verb = isUp ? "UPGRADED" : isDown ? "DOWNGRADED" : "initiated";
    events.push({ d: r.date, tk: d.ticker, type: "analyst", m: tier1 ? 72 : 58,
      title: `${r.firm} ${verb}${r.from && r.to ? `: ${r.from} → ${r.to}` : r.to ? ` at ${r.to}` : ""}`,
      detail: `${tier1 ? "tier-1 desk · " : ""}stated reasoning is not in the free ratings feed — the app attaches the matching headline when a news key is connected` });
  }
}

/* ---------- 3b. estimate-snapshot moves (point-in-time analyst data) ---------- */
const estSeen = { ...(prev.estimates || {}) };
if (typeof ESTIMATE_HISTORY !== "undefined") {
  for (const d of DATA) {
    const snaps = (ESTIMATE_HISTORY[d.ticker] || {}).snapshots || [];
    if (snaps.length < 2) continue;
    const latest = snaps[snaps.length - 1], prior = snaps[snaps.length - 2];
    if (!latest.date || estSeen[d.ticker] === latest.date) continue;
    estSeen[d.ticker] = latest.date;
    for (const [key, label] of [["currentYearEps", "current-FY EPS"], ["nextYearEps", "next-FY EPS"]]) {
      const a = fin(prior[key]), b = fin(latest[key]);
      if (a == null || b == null || Math.abs(a) < 1e-9) continue;
      const chg = ((b - a) / Math.abs(a)) * 100;
      if (Math.abs(chg) >= 0.3) {
        events.push({ d: latest.date, tk: d.ticker, type: "revisions", m: 55 + Math.min(15, Math.round(Math.abs(chg))),
          title: `Consensus ${label} moved ${pct1(chg)}`, detail: `$${a.toFixed(2)} → $${b.toFixed(2)} between daily snapshots` });
      }
    }
  }
}

/* ---------- 4. filing diffs: a new SEC accession landed ---------- */
const accSeen = { ...prev.accessions };
const filingsEmitted = { ...(prev.filingsEmitted || {}) };
const compDir = path.join(root, "data", "companies");
const fresh14 = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
for (const d of DATA) {
  const f = path.join(compDir, d.ticker + ".json");
  if (!fs.existsSync(f)) continue;
  const cj = readJson(f, null);
  const latest = cj && cj.latestFiling;
  if (!latest || !latest.accn) continue;
  accSeen[d.ticker] = latest.accn;
  // emit once per accession, and only while the filing is fresh (≤14 days) —
  // covers both "new since yesterday" and seeding a brand-new ledger with
  // genuinely recent filings without spamming months-old accessions.
  if (filingsEmitted[d.ticker] === latest.accn) continue;
  if (!latest.filed || latest.filed < fresh14) { filingsEmitted[d.ticker] = latest.accn; continue; }
  filingsEmitted[d.ticker] = latest.accn;
  // new accession since the last pass -> diff the two most recent annual periods
  const series = (key) => ((cj.fields || {})[key] || [])
    .filter(x => x && Number.isFinite(+x.value) && x.periodEnd)
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const rev = series("revenue"), sbc = series("sbc"), sh = series("dilShares");
  const bits = [];
  if (rev.length >= 3) {
    const g2 = (rev.at(-1).value / rev.at(-2).value - 1) * 100;
    const g1 = (rev.at(-2).value / rev.at(-3).value - 1) * 100;
    if (Number.isFinite(g1) && Number.isFinite(g2) && Math.abs(g2 - g1) >= 3)
      bits.push(`revenue growth ${g2 > g1 ? "ACCELERATED" : "DECELERATED"} ${pct1(g1)} → ${pct1(g2)} YoY`);
  }
  if (rev.length >= 2 && sbc.length >= 2 && rev.at(-1).periodEnd === sbc.at(-1).periodEnd) {
    const b2 = (sbc.at(-1).value / rev.at(-1).value) * 100;
    const b1 = (sbc.at(-2).value / rev.at(-2).value) * 100;
    if (Number.isFinite(b1) && Number.isFinite(b2) && Math.abs(b2 - b1) >= 1)
      bits.push(`SBC/revenue ${b2 > b1 ? "rose" : "fell"} ${b1.toFixed(1)}% → ${b2.toFixed(1)}%`);
  }
  if (sh.length >= 2) {
    const dz = (sh.at(-1).value / sh.at(-2).value - 1) * 100;
    if (Number.isFinite(dz) && Math.abs(dz) >= 1)
      bits.push(`diluted shares ${dz > 0 ? "grew" : "SHRANK"} ${pct1(dz)}`);
  }
  events.push({ d: latest.filed || today, tk: d.ticker, type: "filing", m: 90,
    title: `New ${latest.form || "SEC filing"} ingested (filed ${latest.filed || "recently"})`,
    detail: bits.length ? bits.join(" · ") : "no material change vs the prior period on tracked fields" });
}

/* ---------- 5. persist ledger + state + app bundle ---------- */
const cutoff = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
history = history.filter(e => e.d >= cutoff && e.d !== today).concat(events);
history.sort((a, b) => b.d.localeCompare(a.d) || b.m - a.m);
fs.writeFileSync(HIST_FILE, JSON.stringify(history), "utf8");
fs.writeFileSync(STATE_FILE, JSON.stringify({ date: today, tickers: stateNow, accessions: accSeen, filingsEmitted, estimates: estSeen, ratingsEmitted }), "utf8");
const bundle = { asOf: today, since: prev.date, events: history };
fs.writeFileSync(OUT_JS,
  "/* AUTO-GENERATED by scripts/build_signals.js — the daily what-changed ledger.\n" +
  "   Deltas only; levels live in the score engines. Missing signals are skipped,\n" +
  "   never fabricated. */\n" +
  "const SIGNALS = " + JSON.stringify(bundle) + ";\n", "utf8");
console.log(`signals ${today}: ${events.length} new event(s), ledger ${history.length}, prev state ${prev.date || "none (first run)"}`);
