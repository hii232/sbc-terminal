/* MORNING BRIEF — the terminal's daily summary, written for a phone screen.

   The app only helps if it gets opened. This composes the handful of things
   that actually changed overnight and prints them as markdown; the workflow
   posts it as a GitHub issue, which GitHub pushes to the phone and inbox
   with no API keys, no mail server and no third-party service.

   Discipline is the same as everywhere else in this terminal:
     - every number comes from the production engines, not a re-implementation
     - a section with nothing to say prints "nothing" rather than filler
     - the proof status is included so the brief can never read as if the
       model were already validated

       node scripts/daily_brief.js  [> brief.md]                            */
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
// Must load every data bundle index.html loads, or the brief describes a board
// the reader cannot find in the terminal.
const files = ["universe.js", "data.js", "sec.js", "segments.js", "sectors.js", "charts.js", "scores.js",
  "estimates.js", "earnings.js", "signals.js", "whales.js", "insiders.js", "language.js", "track.js", "app.js"]
  .filter(f => fs.existsSync(path.join(root, f)));
vm.runInThisContext(files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n"));
const E = global.window.__engines;
if (!E || !E.masterBoard) { console.error("engines unavailable"); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);
const LIVE = "https://hii232.github.io/sbc-terminal/index.html";
const out = [];
const w = (s = "") => out.push(s);
const pct = (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
const money = (v) => v >= 1e9 ? "$" + (v / 1e9).toFixed(1) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : "$" + Math.round(v / 1e3) + "K";

/* ---------- 1. the one-line state of the board ---------- */
const board = E.masterBoard();
const regime = E.macroRegimeOf && E.macroRegimeOf();
w(`## 📈 Morning Brief — ${today}`);
w();
if (regime) w(`**Market regime: ${regime.label}** (${regime.score}/100) — ${regime.bits ? regime.bits.slice(0, 2).join(" · ") : ""}`);
w(`**${board.length} names ranked.** Top signal: **${board[0].ticker} (${board[0].score})** — ${board[0].best ? board[0].best.why : ""}`);
w();

/* ---------- 2. what changed overnight ---------- */
const events = (E.signalsEvents() || []).filter(e => e.d === today).sort((a, b) => b.m - a.m);
w(`### 💡 What changed`);
if (!events.length) w(`Nothing new in the ledger today. A quiet tape is a real answer, not a missing one.`);
else {
  events.slice(0, 8).forEach(e => w(`- **${e.tk}** · ${e.title}${e.detail ? ` — ${e.detail}` : ""}`));
  if (events.length > 8) w(`- _…and ${events.length - 8} more in the app._`);
}
w();

/* ---------- 3. where independent signals agree ---------- */
const ctx = { ledger: E.earningsLedger(), narrs: E.narrativeHeatAll(), whales: E.whaleActionMap() };
const conv = E.convictionBoard(5);
w(`### 🎯 Signal confluence`);
if (!conv.length) w(`No name has 3+ independent signals agreeing today. That is the tape telling you to wait.`);
else conv.forEach(c => w(`- **${c.d.ticker}** — ${c.bulls} agree / ${c.bears} object: ${c.votes.filter(v => v.dir > 0).slice(0, 3).map(v => v.label).join(", ")}`));
w();

/* ---------- 4. insider buying (the rarest signal here) ---------- */
const clusters = (E.insiderClusters ? E.insiderClusters(5) : []).filter(x => x.s && x.s.buyers >= 1);
w(`### 👤 Insiders buying`);
if (!clusters.length) w(`No open-market insider purchases in the window. Rare by nature — which is why a cluster matters.`);
else clusters.forEach(x => w(`- **${x.d.ticker}** — ${x.s.buyers} buyer${x.s.buyers === 1 ? "" : "s"}${x.s.senior ? " incl. CEO/CFO" : ""}${Number.isFinite(x.s.buyValue) ? ` · ${money(x.s.buyValue)}` : ""} (${x.s.label})`));
w();

/* ---------- 5. earnings inside the week ---------- */
const upcoming = (E.upcomingEarningsRows(7) || []).slice(0, 6);
w(`### 🎯 Reporting this week`);
if (!upcoming.length) w(`No universe names report in the next 7 days.`);
else upcoming.forEach(e => {
  const d = E.companyOf(e.symbol);
  const o = d ? E.beatOddsOf(d, ctx.ledger) : null;
  w(`- **${e.symbol}** ${e.date}${o && o.score != null ? ` · beat odds ${o.score} (${o.label})` : ""}`);
});
w();

/* ---------- 6. thesis breaks worth knowing about ---------- */
const breaks = DATA.map(d => E.exitSignalsOf(d, ctx)).filter(x => x && x.sev >= 4)
  .sort((a, b) => b.sev - a.sev).slice(0, 5);
w(`### 🚪 Thesis breaks`);
if (!breaks.length) w(`Nothing on the board is breaking down badly enough to flag.`);
else breaks.forEach(x => w(`- **${x.d.ticker}** — ${x.label}: ${x.breaks.slice(0, 2).map(b => b.what).join("; ")}`));
w();

/* ---------- 7. the honesty footer, every single day ---------- */
const ps = E.proofStatusOf(typeof TRACK_HISTORY !== "undefined" ? TRACK_HISTORY : []);
const next = (ps.horizons || []).find(h => !h.ready);
w(`---`);
w(`### 🔬 Is any of this proven yet?`);
if (!ps.snapshots) w(`No track record recorded yet.`);
else if (next) w(`**Not yet.** Recording since ${ps.since} (${ps.snapshots} snapshots). The first ${next.label} verdict unlocks **${next.unlockDate}** — ${next.daysLeft} days away. Until then every score here is an untested hypothesis, and should be sized like one.`);
else w(`Forward-return evidence is now unlocked — see the Proof Scoreboard on the Track Record page for which signals are earning their place.`);
w();
w(`[Open the terminal →](${LIVE})`);
w();
w(`<sub>Research signals, not investment advice. Generated by \`scripts/daily_brief.js\` from the same engines the app uses.</sub>`);

const md = out.join("\n");
const file = path.join(root, "data", "brief.md");
fs.writeFileSync(file, md + "\n", "utf8");
process.stdout.write(md + "\n");
console.error(`brief written to ${path.relative(root, file)} (${md.length} chars)`);
