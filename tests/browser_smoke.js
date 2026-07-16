const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
};

function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}

function serveStatic() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    const rel = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const { chromium } = require("playwright");
  const server = await serveStatic();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    browser = await chromium.launch({ channel: "chrome" });
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(err.message));

  try {
    await page.goto(`${base}/index.html?ci=${Date.now()}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#main", { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector("#main")?.textContent.includes("HOME DASHBOARD"), { timeout: 10000 });
    ok(!(await page.textContent("#main")).includes("source priority: SEC filing facts"), "app should boot to Home, not a single-stock page");
    ok((await page.textContent("#main")).includes("GREAT BUSINESSES"), "Home buy-price card missing");
    ok((await page.textContent("#main")).includes("great buy = IV15"), "Home buy-price methodology missing");

    const globals = await page.evaluate(() => ({
      dataLen: DATA.length,
      universeLen: UNIVERSE_LIST.length,
      secCount: Object.keys(SEC).length,
      secMetaCompanies: SEC_META.companies,
      secMetaModel: SEC_META.modelVersion,
      model: window.__engines.SBC_MODEL_VERSION,
      marketModel: window.ScoreEngine && window.ScoreEngine.MARKET_TERMINAL_VERSION,
      hasFlut: DATA.some((d) => d.ticker === "FLUT"),
      tickers: DATA.map((d) => d.ticker),
      oldPhrase: document.body.textContent.includes(["Headline P/E", "owner-earnings retention"].join(" ÷ ")),
    }));
    ok(globals.dataLen === 120, `DATA length ${globals.dataLen}`);
    ok(globals.universeLen === 120, `UNIVERSE length ${globals.universeLen}`);
    ok(globals.secCount === 120 && globals.secMetaCompanies === 120, "SEC company count mismatch");
    ok(globals.secMetaModel === "4.0.0" && globals.model === "4.0.0", "model version missing");
    ok(globals.marketModel === "4.1.0", "market/business score model missing");
    ok(!globals.hasFlut, "FLUT must not be bundled");
    ok(!globals.oldPhrase, "old true-P/E shortcut copy is still visible");
    ok(await page.locator('#wlSort option[value="qualityReward"]').count() === 1, "quality + market reward watchlist sort missing");
    ok(await page.locator('#wlSort option[value="directionEdge"]').count() === 1, "direction edge watchlist sort missing");

    for (const ticker of globals.tickers) {
      await page.fill("#cmdInput", ticker);
      await page.click(".cmd .go");
      await page.waitForFunction((t) => document.querySelector("#main")?.textContent.includes(t), ticker, { timeout: 3000 });
    }

    await page.fill("#cmdInput", "JPM");
    await page.click(".cmd .go");
    await page.waitForFunction(() => document.querySelector("#main")?.textContent.includes("source priority: SEC filing facts"), { timeout: 3000 });
    ok((await page.textContent("#main")).includes("Business Quality"), "expanded official ticker did not open as a full company page");

    await page.fill("#cmdInput", "AAPL");
    await page.click(".cmd .go");
    await page.waitForFunction(() => document.querySelector("#main")?.textContent.includes("AAPL"), { timeout: 3000 });
    ok((await page.textContent("#main")).includes("source priority: SEC filing facts"), "SEC-first source line missing");
    ok((await page.textContent("#main")).includes("Business Quality"), "six-score dashboard missing");
    ok((await page.textContent("#main")).includes("EXPECTATIONS GAP"), "expectations gap card missing");
    ok((await page.textContent("#main")).includes("DIRECTION EDGE"), "direction edge card missing");
    ok((await page.textContent("#main")).includes("INFLATION X-RAY"), "ticker-level inflation x-ray missing");

    await page.click("#hdrStar");
    await page.click('#filter button[data-b="fav"]');
    await page.waitForFunction(() => document.querySelector("#wlCount")?.textContent.trim().startsWith("1/120"), { timeout: 3000 });

    const views = [
      ["#dailyBtn", "DAILY REVIEW"],
      ["#edgeBtn", "DIRECTION EDGE"],
      ["#rankBtn", "MASTER RANKINGS"],
      ["#auditBtn", "DATA AUDIT"],
      ["#compareBtn", "COMPARE"],
      ["#screenBtn", "CUSTOM SCREENER"],
      ["#valBtn", "OWNER-EARNINGS P/E"],
      ["#sectorBtn", "SECTOR FLOW"],
      ["#mapBtn", "QUALITY x MARKET MAP"],
      ["#macroBtn", "INFLATION DESK"],
      ["#calBtn", "THIS WEEK'S MARKET EARNINGS TAPE"],
    ];
    for (const [selector, expected] of views) {
      await page.click(selector);
      await page.waitForFunction((txt) => document.querySelector("#main")?.textContent.includes(txt), expected, { timeout: 3000 });
    }
    await page.waitForFunction(() => {
      const t = document.querySelector("#main")?.textContent || "";
      return t.includes("ASML/TSM test AI capex") && t.includes("NFLX") && t.includes("July 13-17, 2026");
    }, { timeout: 3000 });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#bottomNav", { timeout: 10000 });
    const mobile = await page.evaluate(() => ({
      nav: [...document.querySelectorAll("#bottomNav button")].map((b) => b.textContent.trim()).join("|"),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    }));
    ok(mobile.nav.includes("OWNER P/E"), "mobile owner P/E nav missing");
    ok(!mobile.overflow, "mobile viewport has horizontal overflow");
    await page.click("#navList");
    await page.waitForSelector("#watchlist .spark", { timeout: 10000 });
    const mobileList = await page.evaluate(() => ({
      sparks: document.querySelectorAll("#watchlist .spark").length,
      mrPills: document.querySelectorAll("#watchlist .mr-chip").length,
      rowHeight: Math.round(document.querySelector("#watchlist .row")?.getBoundingClientRect().height || 0),
    }));
    ok(mobileList.sparks >= 50, "mobile market-list sparklines missing");
    ok(mobileList.mrPills >= 50, "mobile market-list reward pills missing");
    ok(mobileList.rowHeight >= 80, "mobile market-list rows too cramped");
    await page.click("#drawerClose");
    await page.click("#navPE");
    await page.waitForFunction(() => document.querySelector("#main")?.textContent.includes("Forward P/E"), { timeout: 3000 });

    const swSupported = await page.evaluate(() => "serviceWorker" in navigator);
    if (swSupported) {
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.reload({ waitUntil: "domcontentloaded" });
      await context.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("#main", { timeout: 10000 });
      ok((await page.textContent("#bottomNav")).includes("OWNER P/E"), "offline reload lost app shell");
      await context.setOffline(false);
    }

    ok(errors.length === 0, `browser console errors:\n${errors.join("\n")}`);
    console.log("browser smoke OK: official 120-stock universe, core views, mobile, offline reload");
  } finally {
    await context.setOffline(false).catch(() => {});
    await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
