const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OFFICIAL_COUNT = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "universe.json"), "utf8")).count;
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
  // Blocked external fetches (Stocktwits/Yahoo/Finnhub have no network in CI)
  // surface as resource-load console errors; those are environmental, not app bugs.
  page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource|net::ERR_|ERR_INTERNET|fetch/i.test(msg.text())) errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(err.message));

  try {
    await page.goto(`${base}/index.html?ci=${Date.now()}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#main", { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector("#main")?.textContent.includes("Owner-Earnings Dashboard"), { timeout: 10000 });
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
    ok(globals.dataLen === OFFICIAL_COUNT, `DATA length ${globals.dataLen}`);
    ok(globals.universeLen === OFFICIAL_COUNT, `UNIVERSE length ${globals.universeLen}`);
    ok(globals.secCount === OFFICIAL_COUNT && globals.secMetaCompanies === OFFICIAL_COUNT, "SEC company count mismatch");
    ok(globals.secMetaModel === "4.0.0", "SEC pipeline version missing"); // sec_ingest.py's own stamp
    ok(globals.model === "4.5.0", "app model version missing");
    ok(globals.marketModel === "4.1.0", "market/business score model missing");
    ok(!globals.hasFlut, "FLUT must not be bundled");
    ok(!globals.oldPhrase, "old true-P/E shortcut copy is still visible");
    ok(await page.locator('#wlSort option[value="qualityReward"]').count() === 1, "quality + market reward watchlist sort missing");
    ok(await page.locator('#wlSort option[value="directionEdge"]').count() === 1, "direction edge watchlist sort missing");

    for (const ticker of globals.tickers) {
      await page.fill("#cmdInput", ticker);
      await page.click(".cmd .go");
      await page.waitForFunction((t) => document.querySelector("#main")?.textContent.includes(t), ticker, { timeout: 3000 });
      ok((await page.textContent("#main")).includes("DRAWDOWN FROM RUNNING HIGH"), `${ticker} drawdown card missing`);
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
    ok((await page.textContent("#main")).includes("POSITION PLAYBOOK"), "position playbook card missing");
    ok((await page.textContent("#main")).includes("WHAT WOULD PROVE THIS WRONG"), "playbook invalidation section missing");
    const pb = await page.evaluate(() => window.__engines.playbookOf(window.__engines.companyOf("AAPL")));
    ok(pb && pb.sizePct > 0 && pb.sizePct <= pb.maxPosition, "playbook sizes within the cap on a live page", String(pb && pb.sizePct));
    ok(pb && pb.stopPrice > 0 && pb.stopPrice < pb.price, "playbook invalidation price below the live price");

    await page.click("#hdrStar");
    await page.click('#filter button[data-b="fav"]');
    await page.waitForFunction((count) => document.querySelector("#wlCount")?.textContent.trim().startsWith(`1/${count}`), OFFICIAL_COUNT, { timeout: 3000 });

    const views = [
      ["#easyBtn", "TODAY'S GAME PLAN"],
      ["#signalsBtn", "THE MASTER SIGNAL"],
      ["#narrBtn", "MARKET NARRATIVES"],
      ["#fpeBtn", "FORWARD P/E"],
      ["#dailyBtn", "DAILY REVIEW"],
      ["#edgeBtn", "DIRECTION EDGE"],
      ["#rankBtn", "MASTER RANKINGS"],
      ["#trackBtn", "SIGNAL CALIBRATION"],
      ["#auditBtn", "DATA AUDIT"],
      ["#compareBtn", "COMPARE"],
      ["#screenBtn", "CUSTOM SCREENER"],
      ["#sectorBtn", "SECTOR FLOW"],
      ["#setupsBtn", "BEST SETUPS"],
      ["#blackrockBtn", "WHALE TRACKER"],
      ["#calBtn", "EARNINGS COMMAND CENTER"],  // keep last: the earnings checks below read this view
    ];
    // Nav moved to the top bar; the legacy drawer buttons still carry the wiring
    // but are display:none, so drive them programmatically (their handlers are
    // exactly what the top-nav items delegate to).
    for (const [selector, expected] of views) {
      await page.evaluate((s) => document.querySelector(s).click(), selector);
      await page.waitForFunction((txt) => document.querySelector("#main")?.textContent.includes(txt), expected, { timeout: 3000 });
    }
    // Earnings Command Center: season tape + beat-odds board render in bundled
    // mode with any bundle state (empty seed or populated pipeline output).
    const cal = await page.evaluate(() => ({
      upcoming: window.__engines.upcomingEarningsRows(21).length,
      ledger: window.__engines.earningsLedger().length,
      text: document.querySelector("#main")?.textContent || "",
    }));
    ok(cal.text.includes("BEAT/MISS TAPE"), "beat/miss tape section missing");
    ok(cal.text.includes("DRIFT BOARD"), "PEAD drift board missing");
    ok(cal.text.includes("BEAT ODDS"), "beat odds board missing");
    ok(cal.text.includes("MACRO REGIME"), "macro regime card missing");
    if (cal.upcoming > 0) ok(cal.text.includes("UP NEXT"), "upcoming reports table missing despite rows");

    // Master Signal board: the ranked table renders, and its rank/size controls work.
    await page.evaluate(() => document.querySelector("#signalsBtn").click());
    await page.waitForFunction(() => document.querySelector("#main")?.textContent.includes("THE MASTER SIGNAL"), { timeout: 3000 });
    const boardRows = await page.evaluate(() => document.querySelectorAll("#main table.rank tbody tr[data-tk]").length);
    ok(boardRows >= 20, "master signal board renders its ranked rows", String(boardRows));
    const mb = await page.evaluate(() => {
      const b = window.__engines.masterBoard();
      return { n: b.length, top: b[0].score, bottom: b[b.length - 1].score, rank1: b[0].rank };
    });
    ok(mb.n >= OFFICIAL_COUNT * 0.8, "master board ranks most of the universe in the browser", String(mb.n));
    ok(mb.rank1 === 1 && mb.top >= mb.bottom, "board ordering holds in the browser");
    await page.evaluate(() => document.querySelector('#main [data-bsize="0"]').click());
    await page.waitForFunction((n) => document.querySelectorAll("#main table.rank tbody tr[data-tk]").length >= n, mb.n, { timeout: 3000 });
    await page.evaluate(() => document.querySelector('#main [data-bsort="price"]').click());
    await page.waitForFunction(() => document.querySelector("#main")?.textContent.includes("THE MASTER SIGNAL"), { timeout: 3000 });

    // Condensed TOP navigation: a few groups, and clicking a group's item navigates.
    const topnav = await page.evaluate(() => ({
      groups: document.querySelectorAll("#topnav .topnav-group").length,
      tools: document.querySelectorAll("#topnav .topnav-group [data-tool]").length,
      hasWatch: !!document.querySelector("#topnav #topWatch"),
    }));
    ok(topnav.groups >= 4 && topnav.groups <= 7, "top nav condensed into 4-7 groups", String(topnav.groups));
    ok(topnav.tools === 18, "all 18 tools reachable from the top nav", String(topnav.tools));
    ok(topnav.hasWatch, "watchlist reachable from the top nav");
    await page.evaluate(() => {
      const g = [...document.querySelectorAll("#topnav .topnav-group")].find((x) => x.querySelector('[data-tool="screenBtn"]'));
      g.querySelector(":scope > button").click();
      g.querySelector('[data-tool="screenBtn"]').click();
    });
    await page.waitForFunction(() => document.querySelector("#main")?.textContent.includes("CUSTOM SCREENER"), { timeout: 3000 });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    // On mobile the scrolling top nav is replaced by a fixed 5-tab bottom bar
    // (Home/Setups/Earnings/Portfolio/More); everything not on the bar lives
    // in the More sheet, so all 18 tools stay reachable in at most two taps.
    await page.waitForSelector("#tabbar button", { timeout: 10000 });
    const mobile = await page.evaluate(() => {
      const bar = document.querySelector("#tabbar");
      const r = bar.getBoundingClientRect();
      return {
        tabs: bar.querySelectorAll("button").length,
        topnavHidden: getComputedStyle(document.querySelector("#topnav")).display === "none",
        pinnedToBottom: Math.abs(r.bottom - window.innerHeight) < 2,
        sheetTools: document.querySelectorAll("#moreSheet [data-tool]").length,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      };
    });
    ok(mobile.tabs === 5, "mobile shows exactly 5 bottom tabs", String(mobile.tabs));
    ok(mobile.topnavHidden, "the scrolling top nav is hidden on mobile in favour of the tab bar");
    ok(mobile.pinnedToBottom, "the tab bar is pinned to the bottom of the viewport");
    ok(!mobile.overflow, "mobile viewport has horizontal overflow");
    // every one of the 18 tools is still reachable: 4 on the bar + the rest in More
    ok(mobile.sheetTools + 4 === 18, "all 18 tools reachable (4 tabs + More sheet)", `${mobile.sheetTools}+4`);
    // the More sheet actually opens and routes
    await page.evaluate(() => document.querySelector('#tabbar [data-tab="__more"]').click());
    await page.waitForFunction(() => document.querySelector("#moreSheet")?.classList.contains("open"), { timeout: 3000 });
    await page.evaluate(() => document.querySelector('#moreSheet [data-tool="screenBtn"]').click());
    await page.waitForFunction(() => document.querySelector("#main")?.textContent.includes("CUSTOM SCREENER"), { timeout: 5000 });
    ok(await page.evaluate(() => !document.querySelector("#moreSheet").classList.contains("open")),
      "picking a tool from the More sheet closes it");
    await page.evaluate(() => document.querySelector('#tabbar [data-tab="homeBtn"]').click());
    await page.waitForFunction(() => document.querySelector("#main")?.textContent.includes("Owner-Earnings Dashboard"), { timeout: 5000 });

    // Sparklines are the element that makes a finance row scannable; they were
    // previously display:none on mobile. A tile's line must also agree with the
    // number printed under it -- colouring the 13-month shape by its own
    // first-to-last once put a green line above a red -19.3% 1M.
    const sparks = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll(".bz-index-tile")].map((t) => ({
        stroke: t.querySelector(".tile-spark path")?.getAttribute("stroke"),
        down: !!t.querySelector("em")?.classList.contains("down"),
        hasSpark: !!t.querySelector(".tile-spark"),
      }));
      const moverSpark = document.querySelector(".bz-mover .bz-spark svg");
      return {
        tiles,
        tileSparks: tiles.filter((t) => t.hasSpark).length,
        moverSparks: document.querySelectorAll(".bz-mover .bz-spark svg").length,
        moverSparkVisible: moverSpark ? getComputedStyle(moverSpark.parentElement).display !== "none" : false,
      };
    });
    ok(sparks.tileSparks >= 3, "index tiles draw sparklines", String(sparks.tileSparks));
    ok(sparks.moverSparks >= 2, "mover rows draw sparklines on mobile", String(sparks.moverSparks));
    ok(sparks.moverSparkVisible, "mover sparklines are visible on mobile, not display:none");
    const mismatched = sparks.tiles.filter((t) => t.stroke && (t.down !== (t.stroke === "var(--red)")));
    ok(mismatched.length === 0, "every index tile's sparkline colour agrees with its own % sign", JSON.stringify(mismatched));

    // The "0/224 live" state must be actionable, not just described.
    const hasConnect = await page.evaluate(() => !!document.querySelector("#homeConnectLive"));
    if (hasConnect) {
      await page.evaluate(() => document.querySelector("#homeConnectLive").click());
      await page.waitForFunction(() => document.querySelector("#modal")?.classList.contains("open"), { timeout: 3000 });
      ok(await page.evaluate(() => document.activeElement?.id === "finnhubKey"),
        "connect-live focuses the Finnhub key field");
      await page.evaluate(() => document.querySelector("#closeModal").click());
    }
    await page.evaluate(() => document.querySelector("#navList").click());
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
    await page.evaluate(() => document.querySelector("#navPE").click());
    await page.waitForFunction(() => document.querySelector("#main")?.textContent.includes("CUSTOM SCREENER"), { timeout: 3000 });

    const swSupported = await page.evaluate(() => "serviceWorker" in navigator);
    if (swSupported) {
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.reload({ waitUntil: "domcontentloaded" });
      await context.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("#main", { timeout: 10000 });
      // still at the mobile viewport here, so the top nav is display:none --
      // assert it rebuilt in the DOM ('attached', not 'visible') and that the
      // tab bar, which is the nav the user actually sees on mobile, is live.
      await page.waitForSelector("#topnav .topnav-group", { state: "attached", timeout: 10000 });
      ok((await page.$$("#topnav .topnav-group")).length >= 4, "offline reload lost the top-nav shell");
      await page.waitForSelector("#tabbar button", { timeout: 10000 });
      ok((await page.$$("#tabbar button")).length === 5, "offline reload lost the mobile tab bar");
      await context.setOffline(false);
    }

    ok(errors.length === 0, `browser console errors:\n${errors.join("\n")}`);
    console.log(`browser smoke OK: official ${OFFICIAL_COUNT}-stock universe, core views, mobile, offline reload`);
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
