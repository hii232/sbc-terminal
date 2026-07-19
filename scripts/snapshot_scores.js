/* Score-tracking snapshot: records every name's brain score, call and price so
   the terminal builds an OUT-OF-SAMPLE track record of its own model.
   Runs in the data-refresh workflow (weekdays). One snapshot per calendar day;
   re-running on the same day overwrites that day's snapshot.
       node scripts/snapshot_scores.js                                      */
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
  "scores.js", "estimates.js", "news.js", "app.js"].filter(f => fs.existsSync(path.join(root, f)));
vm.runInThisContext(files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n"));
global.Chart = global.window.Chart;
const E = global.window.__engines;
if (!E || !E.verdictOf) { console.error("engines unavailable"); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);
const entries = DATA.map(d => {
  const V = E.verdictOf(d);
  // names the engine refuses to score (insufficient data) are recorded as
  // null — never fabricated into a number, and excluded from cohort math
  const score = V && Number.isFinite(V.score) ? +V.score.toFixed(1) : null;
  return { t: d.ticker, s: score, c: V && V.call ? V.call : "NO_SCORE", p: d.price };
});
console.log(`scored: ${entries.filter(e => e.s != null).length}, unscored (insufficient data): ${entries.filter(e => e.s == null).length}`);

const trackDir = path.join(root, "data", "track");
fs.mkdirSync(trackDir, { recursive: true });
const histFile = path.join(trackDir, "history.json");
let hist = [];
if (fs.existsSync(histFile)) hist = JSON.parse(fs.readFileSync(histFile, "utf8"));
hist = hist.filter(s => s.date !== today);           // one per day
hist.push({ date: today, universe: DATA.length, entries });
hist.sort((a, b) => a.date.localeCompare(b.date));
fs.writeFileSync(histFile, JSON.stringify(hist), "utf8");

// compact app bundle: keep at most ~260 snapshots (about a trading year)
const keep = hist.slice(-260);
const js = "/* MODEL TRACK RECORD — daily brain-score snapshots (script-generated).\n" +
  "   The scoring model is UNTESTED until this history proves it. */\n" +
  "const TRACK_HISTORY = " + JSON.stringify(keep) + ";\n" +
  'if (typeof window !== "undefined") window.TRACK_HISTORY = TRACK_HISTORY;\n';
fs.writeFileSync(path.join(root, "track.js"), js, "utf8");
console.log(`snapshot ${today}: ${entries.length} names, history now ${hist.length} snapshot(s)`);
