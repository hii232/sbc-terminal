/* Universe integrity gate (CI + local).
   data/universe.json is the single source of truth for membership; every
   other layer must agree with it exactly. Checks:
     - count is self-consistent, no duplicates, never shrinks below the
       original 126-name floor, and known control tickers are correct
     - every company carries a CIK and BOTH SEC artifacts on disk
     - sec.js was regenerated for the same company count
       node scripts/check_universe.js                                      */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const die = (msg) => { console.error("universe check FAILED:", msg); process.exit(1); };

const u = JSON.parse(fs.readFileSync(path.join(root, "data", "universe.json"), "utf8"));
const n = u.count;
const tickers = u.companies.map((c) => c.ticker);

if (!(n >= 126)) die(`count ${n} is below the 126-name floor`);
if (u.companies.length !== n) die(`count ${n} != companies array ${u.companies.length}`);
if (new Set(tickers).size !== n) die("duplicate tickers");
if (tickers.includes("FLUT")) die("FLUT must not be in the official universe");
if (!tickers.includes("TSM")) die("TSM missing from the official universe");
if (tickers.some((t) => !/^[A-Z]+$/.test(t))) die("non A-Z ticker would break data.js parsing");

for (const c of u.companies) {
  if (!c.cik || !c.cik10) die(`${c.ticker}: missing CIK`);
  if (!c.sector) die(`${c.ticker}: missing sector`);
  if (!fs.existsSync(path.join(root, "data", "companies", `${c.ticker}.json`)))
    die(`${c.ticker}: missing data/companies/${c.ticker}.json`);
  if (!fs.existsSync(path.join(root, "data", "raw", c.ticker, "sec-facts-extract.json")))
    die(`${c.ticker}: missing data/raw/${c.ticker}/sec-facts-extract.json`);
}

const sec = fs.readFileSync(path.join(root, "sec.js"), "utf8");
if (!/const SEC = /.test(sec)) die("sec.js missing SEC bundle");
if (!/"TSM"/.test(sec)) die("sec.js missing TSM");
const meta = sec.match(/"companies":\s*(\d+)/);
if (!meta) die("sec.js missing companies count in SEC_META");
if (Number(meta[1]) !== n) die(`sec.js reports ${meta[1]} companies, universe.json says ${n}`);

console.log("universe OK exactly", n);
