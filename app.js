/* =========================================================================
   SBC TERMINAL — application logic
   Bundled data + live layer (Finnhub quotes/news, FMP financials).
   ========================================================================= */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (id) => document.getElementById(id);
  const money = (n, d = 1) => n == null || isNaN(n) ? "–" : "$" + (Math.abs(n) >= 1000 ? (n / 1000).toFixed(2) + "T" : n.toFixed(d) + "B");
  const pct = (n, d = 1) => n == null || isNaN(n) ? "–" : n.toFixed(d) + "%";
  const signCls = (n) => n >= 0 ? "up" : "down";
  const arrow = (n) => (n >= 0 ? "▲" : "▼");

  const DEFAULT_FINNHUB = "d977d8pr01qs09n8fingd977d8pr01qs09n8fio0"; // ships with terminal; replace in ⚙ if rate-limited
  const state = {
    active: null,
    view: "stock", // 'stock' | 'sectors' | 'narratives'
    bucket: "all",
    keys: { finnhub: localStorage.getItem("finnhubKey") || DEFAULT_FINNHUB, fmp: localStorage.getItem("fmpKey") || "" },
    live: {}, // ticker -> {quote, news}
    secOn: new Set(["XLK", "SMH", "XLF", "XLV", "XLE", "SPY"]), // default sector lines
  };

  /* map each stock's sector to its ETF for the sector-context card */
  const SECTOR_MAP = {
    "Consumer Tech": "XLK", "Software": "XLK", "Software/AI": "XLK", "HR Tech": "XLK",
    "Networking": "XLK", "Cybersecurity": "XLK", "AdTech": "XLK", "IT Services": "XLK",
    "AI Infrastructure": "XLK", "Neocloud": "XLK", "EDA Software": "SMH",
    "Semis": "SMH", "Semis/AI": "SMH", "Semi Equip": "SMH", "Semis/IP": "SMH",
    "E-commerce": "XLY", "E-commerce/Cloud": "XLY", "Auto/AI": "XLY", "Retail": "XLP",
    "Home Improvement": "XLY", "Restaurants": "XLY", "Apparel": "XLY", "Travel": "XLY",
    "Ride-Hailing": "XLY", "Gaming/Betting": "XLY", "Gaming": "XLC", "Streaming": "XLC", "Social Media": "XLC",
    "Media": "XLC", "Telecom": "XLC",
    "Payments": "XLF", "Banks": "XLF", "Asset Mgmt": "XLF", "Financial Data": "XLF",
    "Crypto Exchange": "XLF", "Fintech Brokerage": "XLF",
    "Pharma": "XLV", "Managed Care": "XLV", "Life Sciences": "XLV",
    "Medical Devices": "XLV", "Biotech": "XLV",
    "Energy": "XLE",
    "Industrials": "XLI", "Public Safety Tech": "XLI", "Machinery": "XLI",
    "Aerospace": "XLI", "Rails": "XLI", "Defense": "XLI",
    "Staples": "XLP", "Beverages": "XLP", "Mega Retail": "XLP",
    "Industrial Gas": "XLB", "Materials": "XLB",
    "REIT": "XLRE", "Utilities": "XLU",
  };
  const secByT = (t) => SECTORS.series.find(s => s.t === t);
  const perfSeries = (s) => s.closes.map(c => +(((c / s.closes[0]) - 1) * 100).toFixed(1));
  const retOver = (s, m) => { // % return over last m months
    const c = s.closes, n = c.length - 1, i = Math.max(0, n - m);
    return +(((c[n] / c[i]) - 1) * 100).toFixed(1);
  };

  /* ------------------------ SBC math helpers ------------------------ */
  const lastVal = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return 0; };
  const fyLabels = (d) => d.fy || YEARS.map(String);
  function sbcSeverity(p) { // % of revenue -> label/color
    if (p == null) return { t: "n/a", c: "var(--muted)" };
    if (p < 5) return { t: "MANAGEABLE", c: "var(--green)" };
    if (p < 10) return { t: "WATCH", c: "var(--amber)" };
    if (p < 20) return { t: "SERIOUS", c: "var(--orange)" };
    return { t: "RED FLAG", c: "var(--red)" };
  }
  function shareTrend(shares) {
    const a = shares[0], b = shares[shares.length - 1];
    const chg = ((b - a) / a) * 100;
    let t, c;
    if (chg < -3) { t = "FALLING — real buybacks"; c = "var(--green)"; }
    else if (chg <= 3) { t = "FLAT — treadmill risk"; c = "var(--amber)"; }
    else if (chg <= 12) { t = "RISING — dilution"; c = "var(--orange)"; }
    else { t = "EXPLODING — value transfer"; c = "var(--red)"; }
    return { chg, t, c };
  }
  function buybackQuality(d) {
    // classify last-year buyback vs sbc
    const bb = lastVal(d.buyback);
    const sbc = lastVal(d.sbc);
    if (bb <= 0.05) return { anti: 0, real: 0, t: "No buybacks", c: "var(--muted)" };
    const anti = Math.min(bb, sbc);
    const real = Math.max(0, bb - sbc);
    const t = real > bb * 0.4 ? "Mostly REAL reduction" : real > 0 ? "Hybrid" : "Pure anti-dilution treadmill";
    const c = real > bb * 0.4 ? "var(--green)" : real > 0 ? "var(--amber)" : "var(--red)";
    return { anti, real, t, c };
  }
  function trueOwnerEarnings(d) {
    // simplified Burry: GAAP NI + GAAP SBC addback - true economic SBC cost
    // true economic SBC cost ≈ anti-dilution buyback (offset) + a withholding proxy (~25% of SBC)
    const ni = lastVal(d.ni);
    const sbc = lastVal(d.sbc);
    const bb = lastVal(d.buyback);
    const antiDil = Math.min(bb, sbc);
    const withholding = sbc * 0.25;
    const trueCost = antiDil + withholding;
    const owner = ni + sbc - trueCost;
    return { ni, sbc, trueCost, owner, antiDil, withholding };
  }

  /* ------------------------ watchlist ------------------------ */
  const BUCKET_ORDER = { clean: 0, middle: 1, high: 2, tragic: 3 };
  function renderWatchlist() {
    const list = DATA.filter(d => state.bucket === "all" || d.bucket === state.bucket)
      .sort((a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] || b.mktCap - a.mktCap);
    el("wlCount").textContent = list.length + "/" + DATA.length;
    const bcol = { clean: "var(--green)", middle: "var(--amber)", high: "var(--orange)", tragic: "var(--red)" };
    el("watchlist").innerHTML = list.map(d => {
      const lv = state.live[d.ticker];
      const price = lv?.quote?.price ?? d.price;
      const ch = lv?.quote?.changePct ?? d.change;
      return `<div class="row ${state.active === d.ticker && state.view === "stock" ? "sel" : ""}" data-tk="${d.ticker}">
        <div class="bucketbar" style="background:${bcol[d.bucket]}"></div>
        <div style="min-width:0">
          <div class="tk">${d.ticker} <span style="font-size:9px;color:var(--dim)">${d.grade}</span></div>
          <div class="nm">${d.name}</div>
        </div>
        <div>
          <div class="px">${price.toFixed(2)}</div>
          <div class="ch ${signCls(ch)}">${arrow(ch)}${Math.abs(ch).toFixed(2)}%</div>
        </div>
      </div>`;
    }).join("");
    $("#watchlist").querySelectorAll(".row").forEach(r =>
      r.onclick = () => selectTicker(r.dataset.tk));
  }

  /* ------------------------ tabs state ------------------------ */
  let currentTab = "overview";
  const VIEW_BTNS = ["sectorBtn", "narrBtn", "valBtn", "rankBtn"];
  function setViewBtn(activeId) { VIEW_BTNS.forEach(id => el(id).classList.toggle("active", id === activeId)); }
  function selectTicker(tk) {
    state.active = tk;
    state.view = "stock";
    setViewBtn(null);
    renderWatchlist();
    render();
    closeDrawer();
    window.scrollTo({ top: 0 });
    syncNav();
    if (state.keys.finnhub || state.keys.fmp) fetchLive(tk);
  }
  function showSectors() {
    state.view = "sectors";
    setViewBtn("sectorBtn");
    renderWatchlist();
    renderSectors();
    closeDrawer();
    window.scrollTo({ top: 0 });
    syncNav();
  }

  /* ------------------------ mobile drawer + bottom nav ------------------------ */
  function openDrawer() { $("aside").classList.add("open"); el("backdrop").classList.add("show"); syncNav(); }
  function closeDrawer() { $("aside").classList.remove("open"); el("backdrop").classList.remove("show"); syncNav(); }
  function syncNav() {
    const drawerOpen = $("aside").classList.contains("open");
    el("navList").classList.toggle("active", drawerOpen);
    el("navSectors").classList.toggle("active", !drawerOpen && state.view === "sectors");
    el("navNarr").classList.toggle("active", !drawerOpen && state.view === "narratives");
    el("navPE").classList.toggle("active", !drawerOpen && state.view === "valuation");
    el("navRank").classList.toggle("active", !drawerOpen && state.view === "rankings");
  }

  /* ------------------------ main render ------------------------ */
  function render() {
    const d = DATA.find(x => x.ticker === state.active);
    if (!d) return;
    const lv = state.live[d.ticker] || {};
    const price = lv.quote?.price ?? d.price;
    const change = lv.quote?.changePct ?? d.change;
    const b = BUCKETS[d.bucket];
    const gradeColors = { A: "var(--green)", B: "var(--cyan)", C: "var(--amber)", D: "var(--orange)", F: "var(--red)" };
    const gc = gradeColors[d.grade];

    const header = `
      <div class="hdr">
        <div>
          <div class="tick">${d.ticker}</div>
          <div class="co">${d.name} · ${d.sector}</div>
        </div>
        <div>
          <div class="pxbig">$${price.toFixed(2)}</div>
          <div class="chbig ${signCls(change)}">${arrow(change)} ${Math.abs(change).toFixed(2)}% ${lv.quote ? '<span style="color:var(--green);font-size:9px">● LIVE</span>' : '<span style="color:var(--dim);font-size:9px">snapshot</span>'}</div>
        </div>
        <div style="border-left:1px solid var(--line);padding-left:16px">
          <div class="sub">MKT CAP</div><div class="stat sm">${money(d.mktCap)}</div>
        </div>
        <div>
          <div class="sub">HEADLINE P/E</div><div class="stat sm">${d.headlinePE ?? "n/m"}</div>
        </div>
        <div>
          <div class="sub" style="color:var(--amber)">TRUE P/E (SBC-adj)</div>
          <div class="stat sm" style="color:var(--amber)">${d.truePE ?? "n/m"}</div>
        </div>
        <div class="spacer"></div>
        <div style="text-align:center">
          <div class="sub" style="margin-bottom:4px">MGMT</div>
          <div class="grade" style="color:${gc};border-color:${gc}">${d.grade}</div>
        </div>
        <div style="text-align:right">
          <span class="badge" style="color:${b.color};border-color:${b.color}">${b.label.toUpperCase()}</span>
          <div class="sub" style="margin-top:5px">${b.desc}</div>
        </div>
      </div>`;

    const tabs = `<div class="tabs">
      ${[["overview", "OVERVIEW"], ["sbc", "★ SBC X-RAY"], ["financials", "FINANCIALS"], ["news", "NEWS"], ["framework", "FRAMEWORK"]]
        .map(([k, l]) => `<button data-tab="${k}" class="${currentTab === k ? "active" : ""}">${l}</button>`).join("")}
    </div>`;

    el("main").innerHTML = header + tabs + `<div id="tabBody"></div>`;
    el("main").querySelectorAll(".tabs button").forEach(btn =>
      btn.onclick = () => { currentTab = btn.dataset.tab; render(); syncNav(); });
    renderTab(d);
  }

  /* ------------------------ tab bodies ------------------------ */
  function renderTab(d) {
    const body = el("tabBody");
    if (currentTab === "overview") body.innerHTML = tabOverview(d);
    else if (currentTab === "sbc") body.innerHTML = tabSBC(d);
    else if (currentTab === "financials") {
      body.innerHTML = tabFinancials(d);
      body.querySelectorAll(".fin-toggle").forEach(b =>
        b.onclick = () => { finMode = b.dataset.m; renderTab(d); });
    }
    else if (currentTab === "news") body.innerHTML = tabNews(d);
    else if (currentTab === "framework") body.innerHTML = tabFramework(d);
  }

  function tabOverview(d) {
    const priceSeries = fakePricePath(d);
    const st = trueOwnerEarnings(d);
    const sev = sbcSeverity(d.sbcPctRev);
    const trend = shareTrend(d.shares);
    return `<div class="grid g3">
      <div class="card" style="grid-column:span 2">
        <h3>PRICE · 12M INTRADAY PROXY <span class="unit">${state.live[d.ticker]?.quote ? "anchored to live px" : "illustrative"}</span></h3>
        ${Chart.line([{ points: priceSeries, color: "var(--cyan)" }], priceLabels(), { area: true, h: 200 })}
      </div>
      <div class="card">
        <h3>OWNER-EARNINGS RETENTION</h3>
        <div style="display:flex;justify-content:center;margin:6px 0">${Chart.donut(d.ownersKeep)}</div>
        <div class="sub" style="text-align:center">Shareholders keep <b style="color:var(--text)">${(d.ownersKeep * 100).toFixed(1)}¢</b> of each GAAP earnings dollar after true SBC economics.</div>
      </div>

      <div class="card"><h3>GAAP EPS</h3><div class="stat">$${d.gaapEPS?.toFixed(2) ?? "–"}</div><div class="sub">what's actually reported</div></div>
      <div class="card"><h3>WALL ST ADJ EPS</h3><div class="stat" style="color:var(--orange)">$${d.nonGaapEPS?.toFixed(2) ?? "–"}</div>
        <div class="sub">${d.gaapEPS && d.nonGaapEPS ? "+" + (((d.nonGaapEPS - d.gaapEPS) / d.gaapEPS) * 100).toFixed(0) + "% above GAAP" : ""}</div></div>
      <div class="card"><h3>TRUE SBC-ADJ EPS</h3><div class="stat" style="color:var(--amber)">$${d.sbcAdjEPS?.toFixed(2) ?? "–"}</div><div class="sub">the number to value off</div></div>

      ${ivLadderCard(d)}

      ${sectorContextCard(d)}

      <div class="card" style="grid-column:span 3">
        <h3>QUICK VERDICT</h3>
        <div class="verdict">
          <span class="pill ${sev.t === "MANAGEABLE" ? "g" : "r"}" style="color:${sev.c}">SBC/REV ${pct(d.sbcPctRev)} · ${sev.t}</span>
          <span class="pill" style="color:${trend.c}">SHARES 5Y ${trend.chg >= 0 ? "+" : ""}${trend.chg.toFixed(1)}% · ${trend.t}</span>
          <span class="pill ${d.truePE && d.headlinePE && d.truePE > d.headlinePE * 1.2 ? "r" : "g"}">RE-RATE ${d.headlinePE ?? "n/m"}x → ${d.truePE ?? "n/m"}x true</span>
        </div>
        <div class="note ${d.bucket === "tragic" || d.bucket === "high" ? "callout" : ""}" style="margin-top:10px">${d.note}</div>
      </div>
    </div>`;
  }

  function tabSBC(d) {
    const st = trueOwnerEarnings(d);
    const sev = sbcSeverity(d.sbcPctRev);
    const trend = shareTrend(d.shares);
    const bq = buybackQuality(d);
    const yrs = fyLabels(d);

    // step 5 waterfall as horizontal bars
    const waterfall = Chart.hbars([
      { label: "GAAP NI", value: st.ni, color: "var(--cyan)", display: money(st.ni) },
      { label: "+ SBC add-back", value: st.sbc, color: "var(--dim)", display: "+" + money(st.sbc) },
      { label: "− true SBC cost", value: st.trueCost, color: "var(--red)", display: "−" + money(st.trueCost) },
      { label: "= OWNER EARN", value: Math.max(st.owner, 0), color: "var(--amber)", display: money(st.owner) },
    ], { max: Math.max(st.ni + st.sbc, st.sbc) * 1.05, labelW: 96 });

    return `
    <div class="note" style="margin-bottom:12px"><b style="color:var(--amber)">★ MANDATORY SECTION.</b> Every analysis runs the 7-step Burry SBC / dilution / true-owner-earnings check. A stock is not truly cheap until it is cheap on SBC-adjusted owner earnings per share — not Wall Street adjusted EPS.</div>

    <div class="grid g3">
      <!-- STEP 2: SBC burden -->
      <div class="card">
        <h3>① SBC BURDEN <span class="unit" style="color:${sev.c}">${sev.t}</span></h3>
        ${sbcMeter("SBC / Revenue", d.sbcPctRev, 25)}
        ${sbcMeter("SBC / Op Cash Flow", d.sbcPctOCF, 50)}
        ${sbcMeter("SBC / GAAP Net Income", d.sbcPctNI, 100)}
        <div class="sub" style="margin-top:8px">Rules: &lt;5% ok · 5–10% watch · 10–20% serious · 20%+ red flag</div>
      </div>

      <!-- STEP 3: share count truth -->
      <div class="card">
        <h3>② SHARE-COUNT TRUTH <span class="unit">diluted, B</span></h3>
        ${Chart.line([{ points: d.shares, color: trend.c.includes("green") ? "var(--green)" : trend.c.includes("red") ? "var(--red)" : "var(--amber)" }], yrs, { h: 130 })}
        <div class="sub" style="margin-top:4px;color:${trend.c}"><b>${trend.chg >= 0 ? "+" : ""}${trend.chg.toFixed(1)}%</b> over 5Y — ${trend.t}</div>
      </div>

      <!-- STEP 4: buyback quality -->
      <div class="card">
        <h3>③ BUYBACK QUALITY</h3>
        ${Chart.bars([
          { name: "Anti-dilution", color: "var(--dim)", values: d.buyback.map((b, i) => Math.min(b ?? 0, d.sbc[i] ?? 0)) },
          { name: "Real reduction", color: "var(--green)", values: d.buyback.map((b, i) => Math.max(0, (b ?? 0) - (d.sbc[i] ?? 0))) },
        ], yrs, { h: 130 })}
        <div class="chart-legend"><span><i style="background:var(--dim)"></i>Offset SBC</span><span><i style="background:var(--green)"></i>Real cut</span></div>
        <div class="sub" style="margin-top:4px;color:${bq.c}">${bq.t}</div>
        ${(() => { const acc = buybackAccretion(d, ivLadder(d)); return acc ? `<div class="sub" style="margin-top:5px;color:${acc.acc ? "var(--green)" : "var(--red)"}">IV check: ${acc.txt}</div>` : ""; })()}
      </div>
    </div>

    <div class="grid g2" style="margin-top:12px">
      <!-- STEP 5: true owner earnings waterfall -->
      <div class="card">
        <h3>④ TRUE OWNER EARNINGS <span class="unit">latest FY, $B</span></h3>
        ${waterfall}
        <div class="sub" style="margin-top:6px">True cost = anti-dilution buyback (${money(st.antiDil)}) + est. tax-withholding on vesting (${money(st.withholding)}). Withholding often hides in <b>financing</b> cash flows (ASU 2016-09).</div>
      </div>

      <!-- STEP 6: valuation re-rate -->
      <div class="card">
        <h3>⑤ VALUATION RE-RATE</h3>
        ${Chart.hbars([
          { label: "Headline P/E", value: d.headlinePE || 0, color: "var(--cyan)", display: (d.headlinePE ?? "n/m") + "x" },
          { label: "Wall St adj", value: d.headlinePE || 0, color: "var(--orange)", display: (d.headlinePE ?? "n/m") + "x" },
          { label: "TRUE P/E", value: d.truePE || 0, color: "var(--amber)", display: (d.truePE ?? "n/m") + "x" },
        ], { max: (d.truePE || d.headlinePE || 1) * 1.15, labelW: 92 })}
        <div class="note ${d.truePE > (d.headlinePE || 0) * 1.25 ? "callout" : ""}" style="margin-top:10px">
          Headline ${d.headlinePE ?? "n/m"}x ÷ ${(d.ownersKeep * 100).toFixed(0)}¢ retention = <b>${d.truePE ?? "n/m"}x</b> on owner earnings.
          ${d.truePE > (d.headlinePE || 0) * 1.25 ? "The stock is materially more expensive than it screens." : "Reasonably close — earnings quality holds up."}
        </div>
      </div>
    </div>

    <!-- STEP 1 & 7 : earnings-quality gap + mgmt score -->
    <div class="grid g2" style="margin-top:12px">
      <div class="card">
        <h3>⑥ REPORTED-EARNINGS-QUALITY GAP</h3>
        ${Chart.bars([{ name: "EPS", values: [d.gaapEPS, d.nonGaapEPS, d.sbcAdjEPS], color: "var(--amber)" }],
          ["GAAP", "Wall St Adj", "True SBC-adj"], { h: 150 })}
        <div class="sub">The wider Wall-St-adj sits above GAAP, the more the "beat" is manufactured by adding SBC back as if it were free.</div>
      </div>
      <div class="card">
        <h3>⑦ MANAGEMENT SCORE</h3>
        <div style="display:flex;align-items:center;gap:14px;margin:6px 0">
          <div class="grade" style="font-size:30px;width:56px;height:56px;color:${{A:'var(--green)',B:'var(--cyan)',C:'var(--amber)',D:'var(--orange)',F:'var(--red)'}[d.grade]};border-color:${{A:'var(--green)',B:'var(--cyan)',C:'var(--amber)',D:'var(--orange)',F:'var(--red)'}[d.grade]}">${d.grade}</div>
          <div class="sub" style="font-size:11.5px">${GRADE_MEANING[d.grade]}</div>
        </div>
        <div style="margin-top:8px">
          <div class="kv"><span class="k">Run for shareholders or employees?</span><span class="v" style="color:${d.grade <= 'B' ? 'var(--green)' : d.grade >= 'D' ? 'var(--red)' : 'var(--amber)'}">${d.grade <= 'B' ? 'SHAREHOLDERS' : d.grade >= 'D' ? 'EMPLOYEES' : 'MIXED'}</span></div>
          <div class="kv"><span class="k">GAAP close to owner EPS?</span><span class="v">${d.ownersKeep >= .85 ? 'YES' : d.ownersKeep >= .7 ? 'PARTLY' : 'NO'}</span></div>
          <div class="kv"><span class="k">Non-GAAP wildly above GAAP?</span><span class="v">${d.gaapEPS && d.nonGaapEPS && d.nonGaapEPS > d.gaapEPS * 1.4 ? 'YES ⚠' : 'no'}</span></div>
          <div class="kv"><span class="k">Buybacks actually cut shares?</span><span class="v">${shareTrend(d.shares).chg < -3 ? 'YES' : 'NO'}</span></div>
        </div>
      </div>
    </div>`;
  }

  /* --- quarterly helpers --- */
  let finMode = "qtr"; // 'qtr' | 'fy'
  const ttm = (arr) => {
    if (!arr) return null;
    const t = arr.slice(-4).filter(v => v != null);
    return t.length ? t.reduce((a, v) => a + v, 0) : null;
  };
  const yoyPct = (arr) => { // latest quarter vs same quarter last year (5-point series)
    if (!arr || arr.length < 5) return null;
    const a = arr[arr.length - 5], b = arr[arr.length - 1];
    if (a == null || b == null || a <= 0) return null;
    return ((b / a) - 1) * 100;
  };
  const yoyChip = (arr, invert = false) => {
    const v = yoyPct(arr);
    if (v == null) return "";
    const good = invert ? v <= 0 : v >= 0;
    return `<span class="unit" style="color:${good ? "var(--green)" : "var(--red)"};font-weight:700">${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}% YoY</span>`;
  };

  function tabFinancials(d) {
    const hasQ = !!(d.qd && d.qd.revenue);
    const mode = hasQ ? finMode : "fy";
    const q = mode === "qtr";
    const labels = q ? d.qd.labels : fyLabels(d);
    const D = q ? d.qd : d;
    const unit = q ? "$B / QUARTER" : "$B / FY";
    const rows = (label, arr, fmt2 = money) => `<tr><td>${label}</td>${arr.map(v => `<td>${v == null ? "–" : fmt2(v)}</td>`).join("")}</tr>`;
    const live = state.live[d.ticker]?.financialsSource;

    // toggle
    const toggle = hasQ ? `<div style="display:flex;gap:6px;margin-bottom:12px">
      <button class="fin-toggle ${q ? "on" : ""}" data-m="qtr">QUARTERLY</button>
      <button class="fin-toggle ${!q ? "on" : ""}" data-m="fy">ANNUAL</button>
      <span class="sub" style="align-self:center;margin-left:8px">${q ? "last 5 reported quarters · through " + d.qd.labels[d.qd.labels.length - 1] : "last 4 fiscal years"}</span>
    </div>` : "";

    // TTM strip (from quarterly data)
    let ttmStrip = "";
    if (hasQ) {
      const tRev = ttm(d.qd.revenue), tNi = ttm(d.qd.ni), tSbc = ttm(d.qd.sbc), tBb = ttm(d.qd.buyback);
      const cell = (lbl, val, color) => `<div style="flex:1;min-width:110px;text-align:center;border-right:1px solid var(--line)">
        <div class="sub">${lbl}</div><div class="stat sm" ${color ? `style="color:${color}"` : ""}>${val}</div></div>`;
      ttmStrip = `<div class="card" style="grid-column:span 2;padding:10px 6px">
        <div style="display:flex;flex-wrap:wrap;align-items:center">
          <div style="min-width:90px;text-align:center"><div class="sub" style="color:var(--amber);font-weight:700;letter-spacing:1.5px">TTM</div><div class="sub">trailing 12M</div></div>
          ${cell("REVENUE", money(tRev), "var(--cyan)")}
          ${cell("GAAP NET INCOME", money(tNi), tNi >= 0 ? "var(--green)" : "var(--red)")}
          ${cell("SBC", money(tSbc), "var(--red)")}
          ${cell("BUYBACKS", money(tBb), "var(--amber)")}
          ${cell("SBC / REVENUE", tRev && tSbc != null ? (tSbc / tRev * 100).toFixed(1) + "%" : "–", sbcSeverity(tRev && tSbc != null ? tSbc / tRev * 100 : null).c)}
          ${cell("BUYBACK / SBC", tSbc ? (tBb / tSbc).toFixed(1) + "x" : "–", tBb > tSbc ? "var(--green)" : "var(--orange)")}
        </div>
      </div>`;
    }

    const html = `${toggle}<div class="grid g2">
      ${ttmStrip}
      <div class="card"><h3>REVENUE <span class="unit">${unit}</span> ${q ? yoyChip(D.revenue) : ""}</h3>
        ${Chart.bars([{ name: "Revenue", values: D.revenue, color: "var(--cyan)" }], labels, { h: 180 })}</div>
      <div class="card"><h3>GAAP NET INCOME <span class="unit">${unit}</span> ${q ? yoyChip(D.ni) : ""}</h3>
        ${Chart.bars([{ name: "NI", values: D.ni, color: "var(--green)" }], labels, { h: 180 })}</div>
      <div class="card"><h3>STOCK-BASED COMP <span class="unit">${unit}</span> ${q ? yoyChip(D.sbc, true) : ""}</h3>
        ${Chart.bars([{ name: "SBC", values: D.sbc, color: "var(--red)" }], labels, { h: 180 })}</div>
      <div class="card"><h3>BUYBACKS vs SBC <span class="unit">${unit}</span></h3>
        ${Chart.bars([{ name: "Buyback", color: "var(--amber)", values: D.buyback || [] }, { name: "SBC", color: "var(--red)", values: D.sbc }], labels, { h: 180 })}
        <div class="chart-legend"><span><i style="background:var(--amber)"></i>Buyback</span><span><i style="background:var(--red)"></i>SBC</span></div>
      </div>
      <div class="card" style="grid-column:span 2"><h3>DILUTED SHARES <span class="unit">billions · ${q ? "quarterly — the dilution truth at high resolution" : "annual"}</span> ${q ? yoyChip(D.shares, true) : ""}</h3>
        ${Chart.line([{ points: D.shares, color: shareTrend(D.shares.filter(v => v != null)).c }], labels, { h: 150 })}</div>
      <div class="card" style="grid-column:span 2">
        <h3>FINANCIAL SUMMARY <span class="unit">${live ? "● " + live + " (live)" : d.snapshot}</span></h3>
        <div style="overflow-x:auto"><table class="fin">
          <tr><th>$B</th>${labels.map(y => `<th>${y}</th>`).join("")}</tr>
          ${rows("Revenue", D.revenue)}
          ${rows("Net income (GAAP)", D.ni)}
          ${rows("Stock-based comp", D.sbc)}
          ${rows("SBC % of revenue", D.revenue.map((r, i) => D.sbc[i] == null || !r ? null : (D.sbc[i] / r) * 100), v => v.toFixed(1) + "%")}
          ${rows("Buybacks", D.buyback || [])}
          ${rows("Diluted shares (B)", D.shares, v => v.toFixed(3))}
          ${q ? rows("Revenue QoQ", D.revenue.map((v, i) => i === 0 || v == null || D.revenue[i - 1] == null || D.revenue[i - 1] <= 0 ? null : ((v / D.revenue[i - 1]) - 1) * 100), v => (v >= 0 ? "+" : "") + v.toFixed(1) + "%") : ""}
        </table></div>
      </div>
    </div>`;
    return html;
  }

  function tabNews(d) {
    const lv = state.live[d.ticker];
    if (lv?.news?.length) {
      return `<div class="card"><h3>LIVE NEWS · ${d.ticker} <span class="unit">via Finnhub</span></h3>` +
        lv.news.slice(0, 20).map(n => `<a class="news-item" href="${n.url}" target="_blank" rel="noopener">
          <div class="nt">${escapeHtml(n.headline)}</div>
          <div class="nm"><span class="news-src">${escapeHtml(n.source || "")}</span> · ${new Date(n.datetime * 1000).toLocaleString()}</div>
        </a>`).join("") + `</div>`;
    }
    return `<div class="card">
      <h3>NEWS · ${d.ticker}</h3>
      <div class="note" style="margin-bottom:10px">Live headlines require a free Finnhub key. Click the ⚙ gear (top-right) to connect — then news for <b>every</b> ticker streams in automatically.</div>
      <div class="sub">While disconnected, use the SBC X-RAY and FINANCIALS tabs — those run entirely on bundled snapshots.</div>
      <div style="margin-top:12px">
        <span class="tag">Check: is any headline about a buyback?</span>
        <span class="tag">If so → did share count actually fall, or just offset SBC?</span>
        <span class="tag">Ignore "adjusted EPS beat" until SBC is x-rayed.</span>
      </div>
    </div>`;
  }

  function tabFramework(d) {
    return `<div class="card"><h3>THE PERMANENT FRAMEWORK — SBC / DILUTION / TRUE-OWNER-EARNINGS</h3>
      <div class="note" style="margin-bottom:12px">Core claim: GAAP earnings can overstate what shareholders keep, and Wall-Street adjusted earnings are usually <b>worse</b> because analysts add SBC back as if it's free. In the NASDAQ-100 sample the author cites, GAAP overstated true owner earnings by ~19.78% and adjusted earnings by ~42.12% — shareholders kept only ~83.49¢ of each GAAP dollar.</div>
      <div class="grid g2">
        <div>
          <h3 style="margin-top:0">7-STEP CHECK</h3>
          ${[
            ["1 · Reported-earnings quality", "How much better does non-GAAP look than GAAP, and is SBC the reason?"],
            ["2 · SBC burden", "SBC / revenue, gross profit, OCF, net income, market cap."],
            ["3 · Share-count truth", "Diluted shares over 1/3/5/10y — falling, flat, rising, or exploding?"],
            ["4 · Buyback quality", "Split anti-dilution (offsets SBC) vs real reduction; only bullish if shares fall AND price < intrinsic value."],
            ["5 · True owner earnings", "GAAP NI + SBC add-back − true economic SBC cost (offset buyback + withholding − option/ESPP inflows)."],
            ["6 · Valuation re-rate", "Headline P/E ÷ owner-earnings retention = true P/E."],
            ["7 · Management score", "A→F on SBC discipline, buyback honesty, share-count direction."],
          ].map(([k, v]) => `<div class="kv"><span class="k" style="max-width:150px">${k}</span><span class="v" style="text-align:right;font-weight:400;color:var(--muted);font-size:10.5px">${v}</span></div>`).join("")}
        </div>
        <div>
          <h3 style="margin-top:0">3 SBC SITUATIONS</h3>
          <div class="note" style="margin-bottom:8px"><b style="color:var(--cyan)">Pure dilution</b> — company hands employees stock, share count rises, you own less.</div>
          <div class="note" style="margin-bottom:8px"><b style="color:var(--amber)">Buyback treadmill</b> — buybacks only offset issuance. You think you got capital return; the company just paid cash to prevent dilution.</div>
          <div class="note callout" style="margin-bottom:14px"><b style="color:var(--red)">Hybrid</b> — some buybacks offset SBC, some truly cut shares. You must separate the two.</div>
          <h3>WHERE THIS CAN BE WRONG</h3>
          <div class="sub" style="line-height:1.7">
            • SBC can be rational if $1B of stock creates $10B of durable value.<br>
            • The market may already know (PLTR/CRWD/DDOG long debated) — it's a <b>quality filter & haircut</b>, not an auto-short.<br>
            • Buybacks below intrinsic value can still be fine even while offsetting dilution.<br>
            • Young post-IPO names distort on one-time founder/retention grants — separate recurring vs one-time.<br>
            • It only adjusts SBC — not capitalized software, leases, goodwill, customer concentration, or debt.
          </div>
        </div>
      </div>
      <div class="note" style="margin-top:14px;border-left-color:var(--green)"><b>One-sentence rule:</b> A stock is not truly cheap until it is cheap on SBC-adjusted owner earnings per share, not Wall Street adjusted EPS.</div>
    </div>

    <div class="card" style="margin-top:12px"><h3>THE IV15 OVERLAY — FROM EARNINGS QUALITY TO A BUY PRICE</h3>
      <div class="note" style="margin-bottom:12px">A low multiple is not necessarily a value. <b style="color:var(--amber)">IV15</b> is the price at which you'd expect <b>15% compounded annual returns over 15 years</b> — a buy target from a multi-stage DCF built on SBC-adjusted owner earnings and business quality, not a simple P/E. A higher-quality business can be a fat pitch above IV15; a lower-quality one only well below it.</div>
      <div class="grid g2">
        <div>
          ${[
            ["The IV ladder", "IV20 < IV18 < IV15 < IV12 < IV10 < IV8 in price. Set alerts at every rung; IV15 ★ is the swing trigger."],
            ["Baseline intrinsic value", "Sits between IV8 and IV10 depending on quality — this terminal uses IV8 for clean names, IV9 middle, IV10 lower tiers."],
            ["The buyback nuance", "Buybacks BELOW baseline IV are accretive to intrinsic value per share. Above it, they pull shares in but DILUTE IV/share — which is what most tech companies do when offsetting SBC at high prices."],
            ["Inflecting companies", "Get a 4th DCF stage (growth cap lifted to 25%) — e.g. DKNG. The value is in the transition."],
            ["The All Map", "Baseball-field view on the ⊞ TRUE P/E tab: Fat Pitches (≥15% implied), Just Outside (10–15%), The Out Field (<10%)."],
          ].map(([k, v]) => `<div class="kv"><span class="k" style="max-width:150px">${k}</span><span class="v" style="text-align:right;font-weight:400;color:var(--muted);font-size:10.5px">${v}</span></div>`).join("")}
        </div>
        <div>
          <div class="sub" style="line-height:1.7">
            <b style="color:var(--text)">How this terminal computes it</b> (simplified but faithful):<br>
            • Base = SBC-adjusted owner EPS (the Step-5 number).<br>
            • Stage 1 (yrs 1–5): revenue growth blend, haircut &amp; capped by quality tier.<br>
            • Stage 2 (yrs 6–10): 60% of stage 1 · Stage 3 (yrs 11–15): ≤4%.<br>
            • Exit multiple by quality: clean 18x → tragic 10x.<br>
            • IVr = year-15 value ÷ (1+r)¹⁵ · implied CAGR = what today's price offers.<br><br>
            <b style="color:var(--red)">Caveats:</b> it's a screen, not the full model — no per-name debt, serial-acquirer, or bedeviled-accounting adjustments. Use it to rank pitches, then do the work.
          </div>
        </div>
      </div>
    </div>`;
  }

  /* sector-context strip shown on each stock's overview */
  function sectorContextCard(d) {
    const etf = SECTOR_MAP[d.sector];
    const s = etf && secByT(etf);
    if (!s) return "";
    const chip = (m, lbl) => {
      const v = retOver(s, m);
      return `<div style="text-align:center;min-width:64px">
        <div class="sub">${lbl}</div>
        <div class="stat sm ${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</div>
      </div>`;
    };
    const spy = secByT("SPY");
    const rel = +(retOver(s, 3) - retOver(spy, 3)).toFixed(1);
    return `<div class="card" style="grid-column:span 3">
      <h3>SECTOR CONTEXT — ${s.name.toUpperCase()} (${s.t}) <span class="unit">click ◈ SECTOR FLOW for full rotation view</span></h3>
      <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:240px">${Chart.line([{ points: perfSeries(s), color: s.color }], SECTORS.labels, { h: 110, area: true })}</div>
        ${chip(1, "1M")}${chip(3, "3M")}${chip(6, "6M")}${chip(12, "12M")}
        <div style="text-align:center;min-width:90px;border-left:1px solid var(--line);padding-left:14px">
          <div class="sub">vs S&P · 3M</div>
          <div class="stat sm ${rel >= 0 ? "up" : "down"}">${rel >= 0 ? "+" : ""}${rel.toFixed(1)}pp</div>
          <div class="sub" style="color:${rel >= 0 ? "var(--green)" : "var(--red)"}">${rel >= 0 ? "money rotating IN" : "money rotating OUT"}</div>
        </div>
      </div>
    </div>`;
  }

  /* ------------------------ IV15 ENGINE (Burry DCF buy targets) ------------------------ */
  // IVr = the price at which you'd expect r% CAGR over 15 years, built on
  // SBC-adjusted owner EPS, 3-stage growth (4th "inflection" stage for flagged
  // names), quality-set exit multiple. IV15 is the buy target; baseline IV
  // (IV8–IV10 by quality) is where buybacks stop being accretive.
  const IV_Q = {
    clean:  { cap: 0.16, exit: 18, hair: 1.00 },
    middle: { cap: 0.14, exit: 15, hair: 0.85 },
    high:   { cap: 0.11, exit: 12, hair: 0.70 },
    tragic: { cap: 0.09, exit: 10, hair: 0.55 },
  };
  function ivLadder(d) {
    const E0 = d.sbcAdjEPS;
    if (!E0 || E0 <= 0) return null; // GAAP-loss names: no owner earnings to price
    let gRecent = null, gCagr = null;
    if (d.qd && d.qd.revenue && d.qd.revenue.length >= 5 && d.qd.revenue[0] > 0)
      gRecent = d.qd.revenue[4] / d.qd.revenue[0] - 1;
    const rv = (d.revenue || []).filter(v => v != null && v > 0);
    if (rv.length >= 3) gCagr = Math.pow(rv[rv.length - 1] / rv[0], 1 / (rv.length - 1)) - 1;
    const Q = IV_Q[d.bucket];
    let g1 = ((gRecent ?? gCagr ?? 0.06) * 0.6 + (gCagr ?? gRecent ?? 0.06) * 0.4) * Q.hair;
    g1 = clamp(g1, 0.01, d.inflecting ? 0.25 : Q.cap); // inflection: growth cap lifted
    const g2 = g1 * 0.6, g3 = Math.min(g2, 0.04);
    // owner-EPS stream for 15 years + exit value on year-15 earnings
    const stream = [];
    let e = E0;
    for (let y = 1; y <= 15; y++) { e *= 1 + (y <= 5 ? g1 : y <= 10 ? g2 : g3); stream.push(e); }
    const FV = e * Q.exit;
    // IVr = full DCF: every year's owner earnings + terminal value, discounted at r
    const iv = (r) => stream.reduce((a, ey, i) => a + ey / Math.pow(1 + r, i + 1), 0) + FV / Math.pow(1 + r, 15);
    const price = state.live[d.ticker]?.quote?.price ?? d.price;
    let impliedCAGR = null; // solve iv(r) = price by bisection
    if (price > 0) {
      let lo = -0.5, hi = 1.0;
      for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; iv(mid) > price ? (lo = mid) : (hi = mid); }
      impliedCAGR = (lo + hi) / 2;
    }
    return {
      E0, g1, g2, g3, exit: Q.exit, FV, price, impliedCAGR,
      IV20: iv(0.20), IV18: iv(0.18), IV15: iv(0.15), IV12: iv(0.12), IV10: iv(0.10), IV8: iv(0.08),
      baseline: d.bucket === "clean" ? iv(0.08) : d.bucket === "middle" ? iv(0.09) : iv(0.10),
      zone: impliedCAGR >= 0.15 ? "fat" : impliedCAGR >= 0.10 ? "just" : "out",
    };
  }
  const ZONE = {
    fat:  { label: "FAT PITCH",     color: "var(--green)", desc: "priced for 15%+ CAGR over 15y" },
    just: { label: "JUST OUTSIDE",  color: "var(--amber)", desc: "priced for 10–15% CAGR" },
    out:  { label: "THE OUT FIELD", color: "var(--red)",   desc: "priced for <10% CAGR" },
  };
  function buybackAccretion(d, L) {
    const bb = d.buyback && d.buyback[d.buyback.length - 1];
    if (!bb || bb <= 0.05 || !L) return null;
    const acc = L.price <= L.baseline;
    return { acc, txt: acc
      ? `Buying back BELOW baseline IV ($${L.baseline.toFixed(0)}) — accretive to intrinsic value per share.`
      : `Buying back ABOVE baseline IV ($${L.baseline.toFixed(0)}) — pulls shares in but DILUTES intrinsic value per share. The depressing nuance of offsetting SBC at high prices.` };
  }

  function ivLadderCard(d) {
    const L = ivLadder(d);
    if (!L) return `<div class="card" style="grid-column:span 3">
      <h3>IV LADDER — BURRY DCF BUY TARGETS</h3>
      <div class="sub">No positive SBC-adjusted owner earnings — the IV ladder needs real owner earnings to price. GAAP-loss names live in the Out Field by default.</div></div>`;
    const z = ZONE[L.zone];
    const rungs = [["IV20", L.IV20], ["IV18", L.IV18], ["IV15 ★", L.IV15], ["IV12", L.IV12], ["IV10", L.IV10], ["IV8 · baseline", L.IV8]];
    const maxV = Math.max(L.IV8, L.price) * 1.08;
    const bars = rungs.map(([lb, v]) => {
      const isIV15 = lb.startsWith("IV15");
      return `<div style="display:grid;grid-template-columns:104px 1fr 76px;gap:8px;align-items:center;padding:3px 0">
        <span class="sub" style="${isIV15 ? "color:var(--amber);font-weight:700" : ""}">${lb}</span>
        <div class="pe-bar" style="position:relative">
          <i style="width:${clamp(v / maxV * 100, 1, 100)}%;background:${isIV15 ? "var(--amber)" : v >= L.price ? "var(--green)" : "#31405c"}"></i>
          <span style="position:absolute;left:${clamp(L.price / maxV * 100, 0, 98)}%;top:-2px;bottom:-2px;width:2px;background:var(--red)"></span>
        </div>
        <span style="font-size:11px;text-align:right;font-weight:${isIV15 ? 800 : 400};color:${isIV15 ? "var(--amber)" : "var(--text)"}">$${v.toFixed(v >= 100 ? 0 : 2)}</span>
      </div>`;
    }).join("");
    const acc = buybackAccretion(d, L);
    return `<div class="card" style="grid-column:span 3;border-left:3px solid ${z.color}">
      <h3>IV LADDER — BURRY DCF BUY TARGETS <span class="unit">3-stage DCF on SBC-adj owner EPS $${L.E0.toFixed(2)} · growth ${(L.g1 * 100).toFixed(0)}%→${(L.g2 * 100).toFixed(0)}%→${(L.g3 * 100).toFixed(0)}% · exit ${L.exit}x${d.inflecting ? " · ⚡ INFLECTING (4th stage)" : ""}</span></h3>
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:2;min-width:260px">${bars}
          <div class="sub" style="margin-top:4px">red line = current price $${L.price.toFixed(2)} · green rungs = buy targets at/above today's price · IV15 ★ is THE buy trigger</div></div>
        <div style="flex:1;min-width:180px;text-align:center;border-left:1px solid var(--line);padding-left:16px">
          <div class="sub">AT TODAY'S PRICE THE MARKET OFFERS</div>
          <div class="stat" style="color:${z.color}">${(L.impliedCAGR * 100).toFixed(1)}%/yr</div>
          <div class="sub">implied 15-year CAGR</div>
          <div class="badge" style="color:${z.color};border-color:${z.color};display:inline-block;margin-top:8px">${z.label}</div>
          <div class="sub" style="margin-top:4px">${z.desc}</div>
          ${acc ? `<div class="note ${acc.acc ? "" : "callout"}" style="margin-top:10px;text-align:left;font-size:10.5px">${acc.txt}</div>` : ""}
        </div>
      </div>
    </div>`;
  }

  /* ---- ALL MAP: baseball-field view of the whole board ---- */
  function allMapSVG() {
    const W = 700, H = 400, hx = W / 2, hy = H - 18;
    const pt = (deg, rad) => { const a = (deg * Math.PI) / 180; return [hx + rad * Math.sin(a), hy - rad * Math.cos(a)]; };
    const arc = (rad) => { const [x1, y1] = pt(-45, rad), [x2, y2] = pt(45, rad); return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${rad} ${rad} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`; };
    const band = (r1, r2, fill) => {
      const [ax, ay] = pt(-45, r1), [bx, by] = pt(-45, r2), [cx2, cy2] = pt(45, r2), [dx, dy] = pt(45, r1);
      return `<path d="M${ax} ${ay} L${bx} ${by} A${r2} ${r2} 0 0 1 ${cx2} ${cy2} L${dx} ${dy} A${r1} ${r1} 0 0 0 ${ax} ${ay}" fill="${fill}"/>`;
    };
    const zones = { fat: [], just: [], out: [] };
    DATA.forEach(d => { const L = ivLadder(d); zones[L ? L.zone : "out"].push({ d, L }); });
    Object.values(zones).forEach(z => z.sort((a, b) => (b.L?.impliedCAGR ?? -1) - (a.L?.impliedCAGR ?? -1)));
    const RB = { fat: [70, 155], just: [168, 248], out: [260, 345] };
    let dots = "";
    Object.entries(zones).forEach(([zn, arr]) => {
      const [r1, r2] = RB[zn];
      arr.forEach((it, i) => {
        const n = arr.length;
        const deg = n === 1 ? 0 : -41 + (82 * i) / (n - 1);
        const rad = r1 + (r2 - r1) * (0.2 + 0.6 * ((i % 3) / 2));
        const [x, y] = pt(deg, rad);
        const col = { fat: "#26d07c", just: "#ffb000", out: "#ff5b6b" }[zn];
        const cagr = it.L ? (it.L.impliedCAGR * 100).toFixed(1) + "%" : "n/m (GAAP loss)";
        const showLabel = zn !== "out";
        dots += `<g data-tk="${it.d.ticker}" style="cursor:pointer">
          <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${zn === "fat" ? 6 : 4.5}" fill="${col}" stroke="#05070c" stroke-width="1.2"><title>${it.d.ticker} — implied 15y CAGR ${cagr}</title></circle>
          ${showLabel ? `<text x="${x.toFixed(1)}" y="${(y - 8).toFixed(1)}" fill="${col}" font-size="8.5" font-weight="700" text-anchor="middle">${it.d.ticker}</text>` : ""}</g>`;
      });
    });
    const [flx, fly] = pt(-45, 350), [frx, fry] = pt(45, 350);
    return { svg: `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">
      ${band(60, 158, "rgba(38,208,124,.07)")}${band(158, 251, "rgba(255,176,0,.06)")}${band(251, 348, "rgba(255,91,107,.05)")}
      <path d="${arc(158)}" stroke="#26d07c" stroke-dasharray="4 4" fill="none" opacity=".5"/>
      <path d="${arc(251)}" stroke="#ffb000" stroke-dasharray="4 4" fill="none" opacity=".5"/>
      <path d="${arc(348)}" stroke="#ff5b6b" stroke-dasharray="4 4" fill="none" opacity=".4"/>
      <line x1="${hx}" y1="${hy}" x2="${flx}" y2="${fly}" stroke="#31405c"/><line x1="${hx}" y1="${hy}" x2="${frx}" y2="${fry}" stroke="#31405c"/>
      <rect x="${hx - 5}" y="${hy - 5}" width="10" height="10" fill="#d8e0ea" transform="rotate(45 ${hx} ${hy})"/>
      <text x="${hx}" y="${hy - 42}" fill="#26d07c" font-size="11" font-weight="800" text-anchor="middle">FAT PITCHES ≥15%</text>
      <text x="${hx}" y="${hy - 192}" fill="#ffb000" font-size="10" font-weight="700" text-anchor="middle" opacity=".85">JUST OUTSIDE 10–15%</text>
      <text x="${hx}" y="${hy - 288}" fill="#ff5b6b" font-size="10" font-weight="700" text-anchor="middle" opacity=".85">THE OUT FIELD &lt;10%</text>
      ${dots}
    </svg>`, counts: { fat: zones.fat.length, just: zones.just.length, out: zones.out.length }, zones };
  }

  /* ------------------------ MASTER RANKING ENGINE (all logic in harmony) ------------------------ */
  // One composite score per stock blending every layer of the terminal:
  //   VALUE   — IV15 implied 15y CAGR (the DCF verdict)          40%
  //   QUALITY — SBC-adjusted earnings quality (owner-earnings)   25%
  //   CHEAP   — TRUE P/E (SBC-adjusted), lower better            20%
  //   FLOW    — sector money rotation (3M relative to S&P)       15%
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  function rankOf(d) {
    const L = ivLadder(d);
    const cagr = L ? L.impliedCAGR : null;          // e.g. 0.12
    const truePE = d.truePE || null;
    // sector 3M momentum vs SPY
    const etf = SECTOR_MAP[d.sector], s = etf && secByT(etf), spy = secByT("SPY");
    const mom = s ? retOver(s, 3) - retOver(spy, 3) : 0;

    // sub-scores 0..100
    const vScore = cagr == null ? (d.truePE ? 25 : 8) : clamp01((cagr + 0.05) / 0.25) * 100; // -5%→0, +20%→100
    const qScore = clamp01(d.ownersKeep ? (d.ownersKeep - 0.35) / (0.97 - 0.35) : 0) * 100;   // 35¢→0, 97¢→100
    const cScore = truePE == null ? 20 : clamp01((45 - truePE) / (45 - 10)) * 100;             // 45x→0, 10x→100
    const fScore = clamp01((mom + 12) / 24) * 100;                                             // -12pp→0, +12pp→100

    const composite = 0.40 * vScore + 0.25 * qScore + 0.20 * cScore + 0.15 * fScore;
    return { L, cagr, truePE, mom, vScore, qScore, cScore, fScore, composite, zone: L ? L.zone : "out" };
  }
  function thesisOf(d, r) {
    const bits = [];
    if (r.cagr != null) bits.push(r.cagr >= 0.15 ? `fat pitch at ${(r.cagr * 100).toFixed(0)}%/yr` : r.cagr >= 0.10 ? `just outside at ${(r.cagr * 100).toFixed(0)}%/yr` : `priced rich at ${(r.cagr * 100).toFixed(0)}%/yr`);
    else bits.push("GAAP loss — no owner-earnings floor");
    bits.push(d.ownersKeep >= 0.9 ? "clean owner earnings" : d.ownersKeep >= 0.7 ? "moderate SBC haircut" : `only ${(d.ownersKeep * 100).toFixed(0)}¢/$ kept after SBC`);
    if (r.truePE) bits.push(`${r.truePE.toFixed(0)}x true P/E`);
    bits.push(r.mom >= 2 ? "sector money rotating in" : r.mom <= -2 ? "sector out of favor" : "neutral sector flow");
    return bits.join(" · ");
  }

  const RANK_COLS = [
    { k: "composite", label: "SCORE" },
    { k: "cagr", label: "IMPLIED CAGR" },
    { k: "truePE", label: "TRUE P/E" },
    { k: "headlinePE", label: "HDL P/E" },
    { k: "sbcPctRev", label: "SBC/REV" },
    { k: "ownersKeep", label: "OWNER ¢" },
    { k: "mom", label: "SEC 3M" },
    { k: "mktCap", label: "MKT CAP" },
  ];
  const rankState = { sort: "composite", dir: -1 };

  function renderRankings() {
    const rows = DATA.map(d => ({ d, r: rankOf(d) }));
    const raw = (o, k) => k === "composite" ? o.r.composite : k === "cagr" ? o.r.cagr
      : k === "truePE" ? o.r.truePE : k === "mom" ? o.r.mom : o.d[k];
    rows.sort((a, b) => {
      const va = raw(a, rankState.sort), vb = raw(b, rankState.sort);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;   // missing always sinks to the bottom
      if (vb == null) return -1;
      return (va - vb) * rankState.dir;
    });

    // headline cards computed independently of the current table sort
    const byScore = [...rows].sort((a, b) => b.r.composite - a.r.composite);
    const byCagr = [...rows].filter(x => x.r.cagr != null).sort((a, b) => b.r.cagr - a.r.cagr);
    const byCheap = [...rows].filter(x => x.r.truePE).sort((a, b) => a.r.truePE - b.r.truePE);
    const best = byScore[0];
    const fats = rows.filter(x => x.r.zone === "fat").length;

    const th = RANK_COLS.map(c => `<th data-sort="${c.k}" class="${rankState.sort === c.k ? "sorted" : ""}">${c.label}${rankState.sort === c.k ? (rankState.dir < 0 ? " ▾" : " ▴") : ""}</th>`).join("");
    const body = rows.map((x, i) => {
      const d = x.d, r = x.r;
      const zc = { fat: "var(--green)", just: "var(--amber)", out: "var(--red)" }[r.zone];
      const sc = r.composite >= 62 ? "var(--green)" : r.composite >= 48 ? "var(--amber)" : "var(--red)";
      return `<tr data-tk="${d.ticker}">
        <td><span class="rk-num">${i + 1}</span></td>
        <td><span class="rk-tk">${d.ticker}</span> <span class="sub">${d.sector}</span></td>
        <td><span class="rk-score" style="color:${sc}">${r.composite.toFixed(0)}</span></td>
        <td class="${r.cagr == null ? "" : r.cagr >= 0.15 ? "up" : r.cagr < 0.10 ? "down" : ""}" style="${r.cagr != null && r.cagr >= 0.1 && r.cagr < 0.15 ? "color:var(--amber)" : ""}">${r.cagr == null ? "n/m" : (r.cagr * 100).toFixed(1) + "%"}</td>
        <td style="color:var(--amber)">${r.truePE ? r.truePE.toFixed(1) + "x" : "n/m"}</td>
        <td class="sub">${d.headlinePE ? d.headlinePE.toFixed(0) + "x" : "n/m"}</td>
        <td class="${d.sbcPctRev == null ? "" : d.sbcPctRev < 5 ? "up" : d.sbcPctRev >= 15 ? "down" : ""}">${d.sbcPctRev == null ? "–" : d.sbcPctRev.toFixed(1) + "%"}</td>
        <td>${d.ownersKeep ? (d.ownersKeep * 100).toFixed(0) + "¢" : "–"}</td>
        <td class="${r.mom >= 0 ? "up" : "down"}">${r.mom >= 0 ? "+" : ""}${r.mom.toFixed(1)}</td>
        <td class="sub">${money(d.mktCap)}</td>
      </tr>`;
    }).join("");

    el("main").innerHTML = `
      <div class="hdr">
        <div>
          <div class="tick" style="color:var(--purple)">⚡ MASTER RANKINGS</div>
          <div class="co">every layer in harmony — IV15 CAGR · owner-earnings quality · true P/E · sector flow → one score & thesis</div>
        </div>
        <div class="spacer"></div>
        <div style="text-align:right">
          <div class="sub">FAT PITCHES</div><div class="stat sm" style="color:var(--green)">${fats}</div>
        </div>
        <div style="text-align:right;border-left:1px solid var(--line);padding-left:14px">
          <div class="sub">UNIVERSE</div><div class="stat sm">${DATA.length}</div>
        </div>
      </div>

      <div class="grid g3" style="margin-bottom:12px">
        <div class="card" style="border-left:3px solid var(--green)"><h3>#1 BY SCORE — ${best.d.ticker}</h3>
          <div class="stat" style="color:var(--green)">${best.r.composite.toFixed(0)}<span class="sub" style="font-weight:400">/100</span></div>
          <div class="sub" style="margin-top:4px">${thesisOf(best.d, best.r)}</div></div>
        <div class="card"><h3>TOP CAGR — ${byCagr[0]?.d.ticker || "–"}</h3>
          <div class="stat" style="color:var(--green)">${byCagr[0] ? (byCagr[0].r.cagr * 100).toFixed(1) + "%" : "–"}<span class="sub" style="font-weight:400">/yr</span></div>
          <div class="sub" style="margin-top:4px">highest IV15 implied 15-year compounded return</div></div>
        <div class="card"><h3>CHEAPEST TRUE P/E — ${byCheap[0]?.d.ticker || "–"}</h3>
          <div class="stat" style="color:var(--amber)">${byCheap[0] ? byCheap[0].r.truePE.toFixed(1) + "x" : "–"}</div>
          <div class="sub" style="margin-top:4px">${byCheap[0] ? byCheap[0].d.name : ""} — lowest SBC-adjusted multiple</div></div>
      </div>

      <div class="note" style="margin-bottom:12px">
        <b style="color:var(--purple)">Composite score</b> = 40% IV15 implied CAGR + 25% owner-earnings quality (SBC retention) + 20% true P/E cheapness + 15% sector money-flow. Tap any column header to re-rank; tap a row to open the stock. This is a screen to rank pitches — not a substitute for the full model.
      </div>

      <div class="card" style="padding:6px 8px"><div style="overflow-x:auto;max-height:70vh;overflow-y:auto"><table class="rank">
        <thead><tr><th>#</th><th>TICKER · SECTOR</th>${th}</tr></thead>
        <tbody>${body}</tbody>
      </table></div></div>`;

    el("main").querySelectorAll("th[data-sort]").forEach(h => h.onclick = () => {
      const k = h.dataset.sort;
      if (rankState.sort === k) rankState.dir *= -1;
      else { rankState.sort = k; rankState.dir = (k === "truePE" || k === "sbcPctRev") ? 1 : -1; }
      renderRankings();
    });
    el("main").querySelectorAll("tr[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
  }

  /* ------------------------ TRUE P/E SCREENER view ------------------------ */
  const medianOf = (arr) => { const a = arr.filter(v => v != null).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const bucketColor = (b) => BUCKETS[b].color;

  function peRow(d, cap) {
    const hw = clamp((d.headlinePE / cap) * 100, 1, 100);
    const xw = clamp(((d.truePE - d.headlinePE) / cap) * 100, 0, 100 - hw);
    return `<div class="pe-row" data-tk="${d.ticker}" title="${d.name} — headline ${d.headlinePE}x → true ${d.truePE}x (keeps ${(d.ownersKeep * 100).toFixed(0)}¢/$)">
      <span class="pe-tk"><i class="sec-dot" style="background:${bucketColor(d.bucket)}"></i>${d.ticker}</span>
      <div class="pe-bar"><i style="width:${hw}%;background:var(--cyan)"></i><i style="width:${xw}%;background:var(--red)"></i></div>
      <span class="pe-val"><b style="color:var(--amber)">${d.truePE.toFixed(1)}x</b> <span class="sub">${d.headlinePE.toFixed(0)}x hdl</span></span>
    </div>`;
  }

  function renderValuation() {
    const groups = {};
    DATA.forEach(d => { const etf = SECTOR_MAP[d.sector] || "XLK"; (groups[etf] = groups[etf] || []).push(d); });
    const secs = Object.entries(groups).map(([etf, ds]) => {
      const withPE = ds.filter(d => d.truePE && d.headlinePE).sort((a, b) => a.truePE - b.truePE);
      const noPE = ds.filter(d => !d.truePE || !d.headlinePE);
      return { etf, s: secByT(etf), withPE, noPE, med: medianOf(withPE.map(d => d.truePE)) };
    }).filter(g => g.withPE.length || g.noPE.length)
      .sort((a, b) => (a.med ?? 1e9) - (b.med ?? 1e9));

    const all = DATA.filter(d => d.truePE && d.headlinePE);
    const map = allMapSVG();
    const globalCap = Math.min(120, Math.max(...all.map(d => d.truePE)));
    const cheapest = [...all].sort((a, b) => a.truePE - b.truePE).slice(0, 10);
    const dearest = [...all].sort((a, b) => b.truePE - a.truePE).slice(0, 10);

    const secCards = secs.map(g => {
      const cap = Math.min(120, Math.max(...(g.withPE.length ? g.withPE.map(d => d.truePE) : [30])) * 1.05);
      const r3 = g.s ? retOver(g.s, 3) : null;
      return `<div class="card">
        <h3>${(g.s ? g.s.name : g.etf).toUpperCase()} · ${g.etf}
          <span class="unit">median TRUE P/E <b style="color:var(--amber)">${g.med ? g.med.toFixed(1) + "x" : "n/m"}</b>${r3 != null ? ` · 3M <b class="${r3 >= 0 ? "up" : "down"}">${r3 >= 0 ? "+" : ""}${r3.toFixed(1)}%</b>` : ""}</span></h3>
        ${g.withPE.map(d => peRow(d, cap)).join("")}
        ${g.noPE.length ? `<div class="sub" style="margin-top:6px">n/m (GAAP loss or no P/E): ${g.noPE.map(d => `<span class="tag" data-tk="${d.ticker}" style="cursor:pointer">${d.ticker}</span>`).join("")}</div>` : ""}
      </div>`;
    }).join("");

    el("main").innerHTML = `
      <div class="hdr">
        <div>
          <div class="tick" style="color:var(--green)">⊞ TRUE P/E SCREENER</div>
          <div class="co">SBC-adjusted valuation vs sector competitors · sectors & stocks ranked cheapest → most expensive</div>
        </div>
        <div class="spacer"></div>
        <div style="text-align:right">
          <div class="sub">MEDIAN TRUE P/E · ALL ${all.length} NAMES</div>
          <div class="stat sm" style="color:var(--amber)">${medianOf(all.map(d => d.truePE)).toFixed(1)}x</div>
        </div>
      </div>
      <div class="note" style="margin-bottom:12px">
        <b style="color:var(--cyan)">Cyan</b> = headline P/E · <b style="color:var(--red)">red</b> = the SBC dilution premium you actually pay · <b style="color:var(--amber)">amber number</b> = TRUE P/E (headline ÷ owner-earnings retention). Colored dot = quality bucket. Tap any row to open the stock.
      </div>
      <div class="card" style="margin-bottom:12px;border-left:3px solid var(--green)">
        <h3>THE ALL MAP — WHERE EVERY PITCH LANDS <span class="unit">IV-ladder DCF on SBC-adj owner earnings · ${map.counts.fat} fat pitches · ${map.counts.just} just outside · ${map.counts.out} out field · tap a dot</span></h3>
        ${map.svg}
        <div class="sub" style="margin-top:6px">Distance from home plate = the 15-year CAGR today's price offers, from the IV ladder (see any stock's Overview). A low multiple is not necessarily a value — quality sets each name's growth and exit multiple. GAAP-loss names are parked in the Out Field.</div>
      </div>
      <div class="grid g2" style="margin-bottom:12px">
        <div class="card" style="border-left:3px solid var(--green)">
          <h3>CHEAPEST IN THE MARKET <span class="unit">true P/E, whole board</span></h3>
          ${cheapest.map(d => peRow(d, globalCap)).join("")}
        </div>
        <div class="card" style="border-left:3px solid var(--red)">
          <h3>MOST EXPENSIVE <span class="unit">true P/E, whole board</span></h3>
          ${dearest.map(d => peRow(d, globalCap)).join("")}
        </div>
      </div>
      <div class="grid g2">${secCards}</div>`;

    el("main").querySelectorAll("[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
  }

  function showValuation() {
    state.view = "valuation";
    setViewBtn("valBtn");
    renderWatchlist();
    renderValuation();
    closeDrawer();
    window.scrollTo({ top: 0 });
    syncNav();
  }
  function showRankings() {
    state.view = "rankings";
    setViewBtn("rankBtn");
    rankState.sort = "composite"; rankState.dir = -1; // always land on the harmony ranking
    renderWatchlist();
    renderRankings();
    closeDrawer();
    window.scrollTo({ top: 0 });
    syncNav();
  }

  /* ------------------------ NARRATIVES view ------------------------ */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function flowShareOf(s) { // sector's % of total sector-ETF dollar volume per month
    const secOnly = SECTORS.series.filter(x => x.t !== "SPY");
    const totals = SECTORS.labels.map((_, i) => secOnly.reduce((a, x) => a + (x.flow[i] || 0), 0));
    return s.flow.map((v, i) => totals[i] ? +((v / totals[i]) * 100).toFixed(1) : null);
  }
  function flowDelta(s) { // current $-volume share vs trailing-6M average, in pp
    const sh = flowShareOf(s), n = sh.length - 1;
    const avg6 = sh.slice(Math.max(0, n - 6), n).reduce((a, v) => a + v, 0) / Math.min(6, n);
    return (sh[n] ?? sh[n - 1]) - avg6;
  }
  const oddsPill = (p, label) => {
    const col = p >= 70 ? "var(--green)" : p >= 50 ? "var(--amber)" : "var(--red)";
    return `<div style="display:flex;align-items:center;gap:8px;margin-top:8px">
      <div class="meter" style="flex:1;margin-top:0"><i style="width:${p}%;background:${col}"></i></div>
      <span style="font-size:11px;font-weight:800;color:${col};white-space:nowrap">${p.toFixed(0)}%</span>
      <span class="sub" style="white-space:nowrap">${label}</span>
    </div>`;
  };
  const narrCard = (headline, sub, body, odds, oddsLabel, accent = "var(--amber)") => `
    <div class="card" style="border-left:3px solid ${accent}">
      <div style="font-size:15px;font-weight:800;letter-spacing:.5px;line-height:1.3;color:var(--text)">${headline}</div>
      <div class="sub" style="margin:4px 0 10px">${sub}</div>
      ${body}
      ${odds != null ? oddsPill(clamp(odds, 5, 95), oddsLabel) : ""}
    </div>`;

  function renderNarratives() {
    const secOnly = SECTORS.series.filter(s => s.t !== "SPY");
    const spy = secByT("SPY");
    const spy3 = retOver(spy, 3);
    const ranked = [...secOnly].sort((a, b) => retOver(b, 3) - retOver(a, 3));
    const leader = ranked[0], second = ranked[1], laggard = ranked[ranked.length - 1];
    const byDelta = [...secOnly].sort((a, b) => flowDelta(b) - flowDelta(a));
    const rotIn = byDelta[0], rotOut = byDelta[byDelta.length - 1];

    // 1) leadership
    const leadEdge = retOver(leader, 3) - spy3;
    const n1 = narrCard(
      `MARKET IS REWARDING ${leader.name.toUpperCase()} RIGHT NOW`,
      `${leader.t} +${retOver(leader, 3).toFixed(1)}% over 3M vs S&P ${spy3 >= 0 ? "+" : ""}${spy3.toFixed(1)}% · money flow ${flowDelta(leader) >= 0 ? "confirms — dollars rotating in" : "diverges — price up but dollars leaving (fragile)"}`,
      Chart.line([
        { points: perfSeries(leader), color: leader.color },
        { points: perfSeries(second), color: second.color },
        { points: perfSeries(spy), color: spy.color },
      ], SECTORS.labels, { h: 160, zero: true }) +
      `<div class="chart-legend"><span><i style="background:${leader.color}"></i>${leader.t}</span><span><i style="background:${second.color}"></i>${second.t}</span><span><i style="background:${spy.color}"></i>SPY</span></div>`,
      50 + leadEdge * 2.5 + flowDelta(leader) * 8, "odds leadership holds", leader.color);

    // 2) money rotation
    const n2 = narrCard(
      `MONEY IS ROTATING INTO ${rotIn.name.toUpperCase()}, OUT OF ${rotOut.name.toUpperCase()}`,
      `${rotIn.t} taking ${flowDelta(rotIn) >= 0 ? "+" : ""}${flowDelta(rotIn).toFixed(1)}pp more of all sector dollars vs its 6M average · ${rotOut.t} ${flowDelta(rotOut).toFixed(1)}pp`,
      Chart.line([
        { points: flowShareOf(rotIn), color: rotIn.color },
        { points: flowShareOf(rotOut), color: rotOut.color },
      ], SECTORS.labels, { h: 150 }) +
      `<div class="chart-legend"><span><i style="background:${rotIn.color}"></i>${rotIn.t} $-share</span><span><i style="background:${rotOut.color}"></i>${rotOut.t} $-share</span></div>`,
      50 + flowDelta(rotIn) * 10, "odds rotation continues", rotIn.color);

    // 3) laggard
    const lagGap = retOver(laggard, 3) - spy3;
    const n3 = narrCard(
      `MARKET IS PUNISHING ${laggard.name.toUpperCase()}`,
      `${laggard.t} ${retOver(laggard, 3) >= 0 ? "+" : ""}${retOver(laggard, 3).toFixed(1)}% over 3M, ${Math.abs(lagGap).toFixed(1)}pp behind the S&P · 12M: ${retOver(laggard, 12) >= 0 ? "+" : ""}${retOver(laggard, 12).toFixed(1)}%`,
      Chart.line([
        { points: perfSeries(laggard), color: laggard.color },
        { points: perfSeries(spy), color: spy.color },
      ], SECTORS.labels, { h: 150, zero: true }) +
      `<div class="chart-legend"><span><i style="background:${laggard.color}"></i>${laggard.t}</span><span><i style="background:${spy.color}"></i>SPY</span></div>`,
      50 - lagGap * 2.5, "odds weakness persists", "var(--red)");

    // 4) buyback mirage (across all tickers, TTM)
    let totBB = 0, totAnti = 0, totReal = 0;
    DATA.forEach(d => {
      if (!d.qd) return;
      const bb = ttm(d.qd.buyback) || 0, sbc = ttm(d.qd.sbc) || 0;
      totBB += bb; totAnti += Math.min(bb, sbc); totReal += Math.max(0, bb - sbc);
    });
    const realPct = totBB ? (totReal / totBB) * 100 : 0;
    const n4 = narrCard(
      `THE BUYBACK MIRAGE: ONLY ${realPct.toFixed(0)}¢ OF EVERY BUYBACK DOLLAR SHRINKS THE SHARE COUNT`,
      `Across all ${DATA.length} names (TTM): $${totBB.toFixed(0)}B announced buybacks — $${totAnti.toFixed(0)}B just offsets SBC issuance`,
      Chart.hbars([
        { label: "Announced", value: totBB, color: "var(--cyan)", display: "$" + totBB.toFixed(0) + "B" },
        { label: "Anti-dilution", value: totAnti, color: "var(--red)", display: "$" + totAnti.toFixed(0) + "B" },
        { label: "REAL return", value: totReal, color: "var(--green)", display: "$" + totReal.toFixed(0) + "B" },
      ], { labelW: 96 }),
      null, "", "var(--orange)");

    // 5) dilution tax by tier (median TTM SBC/revenue per bucket)
    const med = (arr) => { const a = arr.filter(v => v != null).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
    const tierSbc = Object.keys(BUCKETS).map(b => {
      const vals = DATA.filter(d => d.bucket === b && d.qd).map(d => {
        const r = ttm(d.qd.revenue), s = ttm(d.qd.sbc);
        return r && s != null ? (s / r) * 100 : null;
      });
      return { b, v: med(vals) };
    });
    const n5 = narrCard(
      `THE DILUTION TAX: TRAGIC TIER PAYS ${tierSbc[3].v?.toFixed(0) ?? "?"}x THE SBC OF CLEAN NAMES`,
      `Median TTM stock-comp as % of revenue, by quality tier — this is the framework in one chart`,
      Chart.hbars(tierSbc.map(t => ({
        label: BUCKETS[t.b].label.split(" ")[0].toUpperCase(),
        value: t.v || 0, color: BUCKETS[t.b].color, display: (t.v ?? 0).toFixed(1) + "%",
      })), { labelW: 96 }),
      null, "", "var(--purple)");

    // 6) today's tape
    const tape = DATA.map(d => ({ tk: d.ticker, ch: state.live[d.ticker]?.quote?.changePct ?? d.change }))
      .sort((a, b) => b.ch - a.ch);
    const green = tape.filter(t => t.ch > 0).length;
    const movers = [...tape.slice(0, 5), ...tape.slice(-5)];
    const n6 = narrCard(
      `TODAY'S TAPE: ${green} OF ${tape.length} NAMES GREEN`,
      `${green > tape.length / 2 ? "Breadth positive — buyers in control" : "Breadth negative — risk-off tape"} · biggest movers below ${state.keys.finnhub ? "(live quotes streaming)" : ""}`,
      Chart.hbars(movers.map(m => ({
        label: m.tk, value: Math.abs(m.ch), color: m.ch >= 0 ? "var(--green)" : "var(--red)",
        display: (m.ch >= 0 ? "+" : "−") + Math.abs(m.ch).toFixed(1) + "%",
      })), { labelW: 52 }),
      (green / tape.length) * 100, "of the board is green", green > tape.length / 2 ? "var(--green)" : "var(--red)");

    // 7) fat pitches (IV15 engine)
    const map = allMapSVG();
    const fats = map.zones.fat.slice(0, 10);
    const n7 = narrCard(
      `${map.counts.fat} FAT PITCHES ON THE FIELD`,
      map.counts.fat ? `Priced for ≥15%/yr over 15 years on SBC-adjusted owner earnings — the only zone where you swing. ${map.counts.just} just outside, ${map.counts.out} in the out field.`
        : `Nothing on the board is priced for 15%/yr right now — patience is a position. ${map.counts.just} names sit just outside (10–15%).`,
      fats.length ? Chart.hbars(fats.map(f => ({
        label: f.d.ticker, value: f.L.impliedCAGR * 100, color: "var(--green)",
        display: (f.L.impliedCAGR * 100).toFixed(1) + "%/yr",
      })), { labelW: 52 }) : Chart.hbars(map.zones.just.slice(0, 8).map(f => ({
        label: f.d.ticker, value: f.L.impliedCAGR * 100, color: "var(--amber)",
        display: (f.L.impliedCAGR * 100).toFixed(1) + "%/yr",
      })), { labelW: 52 }),
      null, "", "var(--green)");

    // 8) live Polymarket odds (graceful fallback)
    const pm = `<div class="card" style="border-left:3px solid var(--cyan)">
      <div style="font-size:15px;font-weight:800;color:var(--text)">PREDICTION MARKETS — LIVE POLYMARKET ODDS</div>
      <div class="sub" style="margin:4px 0 10px">What real-money bettors price in right now · highest-volume open markets</div>
      <div id="pmBody"><div class="sub">Loading Polymarket…</div></div>
    </div>`;

    el("main").innerHTML = `
      <div class="hdr">
        <div>
          <div class="tick" style="color:var(--amber)">◆ NARRATIVES</div>
          <div class="co">What the market is telling you — computed live from price, money flow, and the SBC framework</div>
        </div>
        <div class="spacer"></div>
        <div style="text-align:right"><div class="sub">DATA AS OF</div><div class="stat sm">${SECTORS.asof}</div></div>
      </div>
      <div class="grid g2">${n1}${n2}${n3}${n6}${n7}${n4}${n5}
        <div style="grid-column:span 2">${pm}</div>
      </div>`;
    el("main").querySelectorAll(".card [data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
    loadPolymarket();
  }

  async function loadPolymarket() {
    const box = el("pmBody");
    if (!box) return;
    try {
      const base = "https://gamma-api.polymarket.com/events?closed=false&order=volume24hr&ascending=false&limit=6&tag_slug=";
      const [eco, cry] = await Promise.all([
        fetch(base + "economy").then(r => r.json()).catch(() => []),
        fetch(base + "crypto").then(r => r.json()).catch(() => []),
      ]);
      const events = [...(Array.isArray(eco) ? eco : []), ...(Array.isArray(cry) ? cry : [])]
        .sort((a, b) => (+b.volume24hr || 0) - (+a.volume24hr || 0)).slice(0, 7);
      const rows = events.map(ev => {
        try {
          const ms = (ev.markets || []).filter(m => m.outcomePrices);
          if (!ms.length) return "";
          // grouped events: show the most contested outcome (nearest 50/50); binary: show YES odds
          const scored = ms.map(m => ({ m, p: JSON.parse(m.outcomePrices).map(Number)[0] }))
            .sort((a, b) => Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5));
          const top = ms.length > 1 ? scored[0] : scored.sort((a, b) => b.p - a.p)[0];
          const p = clamp(top.p * 100, 0, 100);
          const label = ms.length > 1 ? escapeHtml(top.m.groupItemTitle || top.m.question) : "YES";
          const col = p >= 65 ? "var(--green)" : p >= 40 ? "var(--amber)" : "var(--red)";
          const vol = ev.volume24hr ? "$" + (+ev.volume24hr / 1e6).toFixed(1) + "M/24h" : "";
          return `<div style="padding:8px 0;border-bottom:1px solid var(--line)">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap">
              <span style="font-size:12px;color:var(--text)">${escapeHtml(ev.title)}</span>
              <b style="color:${col};white-space:nowrap">${p.toFixed(0)}% — ${label}</b>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
              <div class="meter" style="flex:1;margin-top:0"><i style="width:${p}%;background:${col}"></i></div>
              <span class="sub" style="white-space:nowrap">${vol}</span>
            </div>
          </div>`;
        } catch { return ""; }
      }).filter(Boolean);
      box.innerHTML = rows.length ? rows.join("") : `<div class="sub">No markets returned — try again later.</div>`;
    } catch {
      box.innerHTML = `<div class="sub">Polymarket unreachable right now — the odds above are computed from market data instead.</div>`;
    }
  }

  function showNarratives() {
    state.view = "narratives";
    setViewBtn("narrBtn");
    renderWatchlist();
    renderNarratives();
    closeDrawer();
    window.scrollTo({ top: 0 });
    syncNav();
  }

  /* ------------------------ SECTOR FLOW view ------------------------ */
  function renderSectors() {
    const S = SECTORS.series;
    const labels = SECTORS.labels;
    const on = S.filter(s => state.secOn.has(s.t));

    // 1) cumulative performance lines for toggled sectors
    const perfChart = Chart.line(
      on.map(s => ({ points: perfSeries(s), color: s.color })),
      labels, { h: 250, zero: true });

    // 2) money-flow share: each sector's % of total sector $ volume per month (excl SPY)
    const secOnly = S.filter(s => s.t !== "SPY");
    const totals = labels.map((_, i) => secOnly.reduce((a, s) => a + (s.flow[i] || 0), 0));
    const flowShare = (s) => s.flow.map((v, i) => totals[i] ? +((v / totals[i]) * 100).toFixed(1) : null);
    const flowChart = Chart.line(
      on.filter(s => s.t !== "SPY").map(s => ({ points: flowShare(s), color: s.color })),
      labels, { h: 220, zero: false });

    // 3) leaders/laggards 3M
    const ranked = [...secOnly].sort((a, b) => retOver(b, 3) - retOver(a, 3));
    const llBars = Chart.hbars(
      ranked.map(s => ({
        label: s.t, value: Math.abs(retOver(s, 3)),
        color: retOver(s, 3) >= 0 ? "var(--green)" : "var(--red)",
        display: (retOver(s, 3) >= 0 ? "+" : "−") + Math.abs(retOver(s, 3)).toFixed(1) + "%",
      })), { labelW: 46 });

    // 4) scoreboard: returns + flow trend (MTD share vs trailing-6M avg share)
    const rows = ranked.map(s => {
      const sh = flowShare(s);
      const n = sh.length - 1;
      const avg6 = sh.slice(Math.max(0, n - 6), n).reduce((a, v) => a + v, 0) / Math.min(6, n);
      const cur = sh[n] ?? sh[n - 1];
      const delta = cur - avg6;
      const cell = (v) => `<td class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</td>`;
      return `<tr>
        <td><i class="sec-dot" style="background:${s.color}"></i><b>${s.t}</b> <span style="color:var(--dim);font-size:9.5px">${s.name}</span></td>
        ${cell(retOver(s, 1))}${cell(retOver(s, 3))}${cell(retOver(s, 6))}${cell(retOver(s, 12))}
        <td>${(s.flow[s.flow.length - 2] || 0).toFixed(0)}</td>
        <td class="${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "▲ IN" : "▼ OUT"} ${Math.abs(delta).toFixed(1)}pp</td>
      </tr>`;
    }).join("");

    const spy = secByT("SPY");
    const chips = S.map(s => {
      const isOn = state.secOn.has(s.t);
      return `<span class="sec-chip ${isOn ? "on" : ""}" data-sec="${s.t}"
        style="${isOn ? `background:${s.color};border-color:${s.color}` : `color:${s.color}`}">${s.t}</span>`;
    }).join("");

    el("main").innerHTML = `
      <div class="hdr">
        <div>
          <div class="tick" style="color:var(--cyan)">◈ SECTOR FLOW</div>
          <div class="co">12-month rotation monitor · 11 SPDR sectors + semis vs S&P 500</div>
        </div>
        <div class="spacer"></div>
        <div style="text-align:right">
          <div class="sub">S&P 500 · 12M</div>
          <div class="stat sm ${retOver(spy, 12) >= 0 ? "up" : "down"}">${retOver(spy, 12) >= 0 ? "+" : ""}${retOver(spy, 12).toFixed(1)}%</div>
        </div>
        <div style="text-align:right;border-left:1px solid var(--line);padding-left:16px">
          <div class="sub">DATA AS OF</div>
          <div class="stat sm">${SECTORS.asof}</div>
        </div>
      </div>

      <div class="grid g2">
        <div class="card" style="grid-column:span 2">
          <h3>SECTOR ROTATION — CUMULATIVE RETURN % <span class="unit">rebased to ${labels[0]} · click chips to toggle</span></h3>
          <div class="sec-chips" id="secChips">${chips}</div>
          ${perfChart}
        </div>

        <div class="card">
          <h3>MONEY FLOW — SHARE OF SECTOR $ VOLUME <span class="unit">% of all sector-ETF dollars traded / month</span></h3>
          ${flowChart}
          <div class="sub" style="margin-top:6px">Rising line = money rotating <b class="up">into</b> that sector; falling = rotating <b class="down">out</b>. Same chip toggles as above (SPY excluded).</div>
        </div>

        <div class="card">
          <h3>LEADERS / LAGGARDS — 3M RETURN</h3>
          ${llBars}
        </div>

        <div class="card" style="grid-column:span 2">
          <h3>FLOW SCOREBOARD <span class="unit">sorted by 3M return · flow = MTD $-volume share vs 6M avg</span></h3>
          <div style="overflow-x:auto"><table class="sec">
            <tr><th>SECTOR</th><th>1M</th><th>3M</th><th>6M</th><th>12M</th><th>$VOL/MO ($B)</th><th>FLOW</th></tr>
            ${rows}
          </table></div>
        </div>
      </div>`;

    el("secChips").querySelectorAll(".sec-chip").forEach(c => c.onclick = () => {
      const t = c.dataset.sec;
      state.secOn.has(t) ? state.secOn.delete(t) : state.secOn.add(t);
      renderSectors();
    });
  }

  /* ------------------------ small UI builders ------------------------ */
  function sbcMeter(label, val, cap) {
    if (val == null) return `<div class="kv"><span class="k">${label}</span><span class="v">n/a</span></div>`;
    const w = Math.min(100, (val / cap) * 100);
    const c = val < 5 ? "var(--green)" : val < 10 ? "var(--amber)" : val < 20 ? "var(--orange)" : "var(--red)";
    return `<div style="margin:7px 0">
      <div style="display:flex;justify-content:space-between;font-size:10.5px"><span style="color:var(--muted)">${label}</span><span style="font-weight:700;color:${c}">${val.toFixed(1)}%</span></div>
      <div class="meter"><i style="width:${w}%;background:${c}"></i></div>
    </div>`;
  }
  function escapeHtml(s) { return (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // deterministic pseudo price path anchored to current price
  function fakePricePath(d) {
    const price = state.live[d.ticker]?.quote?.price ?? d.price;
    const n = 26; const out = []; let seed = 0;
    for (let i = 0; i < d.ticker.length; i++) seed += d.ticker.charCodeAt(i);
    let v = price * (0.72 + (d.bucket === "tragic" ? 0.05 : 0.18));
    const drift = (price - v) / n;
    for (let i = 0; i < n; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const noise = (seed / 233280 - 0.5) * price * 0.05;
      v = v + drift + noise;
      out.push(+v.toFixed(2));
    }
    out[n - 1] = price;
    return out;
  }
  function priceLabels() { return ["12M", "", "", "9M", "", "", "6M", "", "", "3M", "", "", "NOW"].filter((_, i) => i % 2 === 0).concat().slice(0, 13); }

  /* ------------------------ LIVE DATA ------------------------ */
  async function fetchLive(tk, full = true) {
    const d = DATA.find(x => x.ticker === tk);
    if (!d) return;
    state.live[tk] = state.live[tk] || {};
    const k = state.keys;
    const tasks = [];
    if (k.finnhub) {
      tasks.push(fetch(`https://finnhub.io/api/v1/quote?symbol=${tk}&token=${k.finnhub}`)
        .then(r => r.json()).then(q => {
          if (q && q.c) state.live[tk].quote = { price: q.c, changePct: q.dp ?? 0 };
        }).catch(() => {}));
      if (full) { // news only for the selected ticker — keeps the free key inside 60 calls/min
        const to = Math.floor(Date.now() / 1000), from = to - 60 * 60 * 24 * 30;
        const fd = new Date(from * 1000).toISOString().slice(0, 10);
        const td = new Date(to * 1000).toISOString().slice(0, 10);
        tasks.push(fetch(`https://finnhub.io/api/v1/company-news?symbol=${tk}&from=${fd}&to=${td}&token=${k.finnhub}`)
          .then(r => r.json()).then(n => { if (Array.isArray(n)) state.live[tk].news = n; }).catch(() => {}));
      }
    }
    if (k.fmp) {
      tasks.push(Promise.all([
        fetch(`https://financialmodelingprep.com/api/v3/income-statement/${tk}?limit=5&apikey=${k.fmp}`).then(r => r.json()).catch(() => null),
        fetch(`https://financialmodelingprep.com/api/v3/cash-flow-statement/${tk}?limit=5&apikey=${k.fmp}`).then(r => r.json()).catch(() => null),
      ]).then(([inc, cf]) => mergeFmp(d, inc, cf)));
    }
    await Promise.all(tasks);
    state.live[tk].fetchedAt = Date.now();
    if (state.active === tk) render();
    renderWatchlist();
    updateLiveDot();
  }

  function mergeFmp(d, inc, cf) {
    if (!Array.isArray(inc) || !inc.length) return;
    const rows = inc.slice().reverse(); // oldest -> newest
    const cfRows = Array.isArray(cf) ? cf.slice().reverse() : [];
    const B = 1e9;
    const rev = [], ni = [], shares = [], sbc = [], buyback = [];
    rows.forEach((r, i) => {
      rev.push(+(r.revenue / B).toFixed(2));
      ni.push(+(r.netIncome / B).toFixed(2));
      shares.push(+((r.weightedAverageShsOutDil || r.weightedAverageShsOut || 0) / B).toFixed(3));
      const c = cfRows.find(x => x.calendarYear === r.calendarYear);
      sbc.push(c ? +((c.stockBasedCompensation || 0) / B).toFixed(2) : (d.sbc[i] ?? 0));
      buyback.push(c ? +((Math.abs(c.commonStockRepurchased || 0)) / B).toFixed(2) : (d.buyback[i] ?? 0));
    });
    // only overwrite if we got a full-ish series
    if (rev.length >= 3) {
      d.revenue = rev; d.ni = ni; d.shares = shares;
      d.sbc = sbc; d.buyback = buyback;
      const latestRev = rev[rev.length - 1], latestNi = ni[ni.length - 1], latestSbc = sbc[sbc.length - 1];
      if (latestRev) d.sbcPctRev = +((latestSbc / latestRev) * 100).toFixed(1);
      if (latestNi > 0) d.sbcPctNI = +((latestSbc / latestNi) * 100).toFixed(0);
      state.live[d.ticker] = state.live[d.ticker] || {};
      state.live[d.ticker].financialsSource = "FMP";
    }
  }

  function refreshAllLive() {
    if (!state.keys.finnhub && !state.keys.fmp) return;
    flash("Streaming live quotes…", "ok");
    // quotes only, ~55/min stagger to respect the free-tier rate limit
    DATA.forEach((d, i) => setTimeout(() => fetchLive(d.ticker, false), i * 1100));
  }

  function updateLiveDot() {
    const on = !!(state.keys.finnhub || state.keys.fmp);
    el("liveDot").classList.toggle("on", on);
    el("liveBtn").title = on ? "LIVE data connected" : "Bundled snapshots (click gear to connect)";
  }

  /* ------------------------ command / search ------------------------ */
  function runCommand(q) {
    q = (q || "").trim().toUpperCase();
    if (!q) return;
    if (["RANK", "RANKINGS", "RANKING", "LEADERBOARD", "SCORE", "BEST", "TOP"].includes(q)) {
      showRankings(); flash("Master rankings", "ok"); return;
    }
    if (["PE", "P/E", "TRUEPE", "TRUE PE", "VALUATION", "SCREENER", "CHEAP"].includes(q)) {
      showValuation(); flash("True P/E screener", "ok"); return;
    }
    if (["NARRATIVES", "NARRATIVE", "NARR", "STORIES", "STORY", "POLYMARKET"].includes(q)) {
      showNarratives(); flash("Narratives view", "ok"); return;
    }
    if (["SECTORS", "SECTOR", "FLOW", "ROTATION"].includes(q) || SECTORS.series.some(s => s.t === q)) {
      showSectors();
      if (SECTORS.series.some(s => s.t === q)) { state.secOn.add(q); renderSectors(); }
      flash("Sector flow view", "ok");
      return;
    }
    const hit = DATA.find(d => d.ticker === q) || DATA.find(d => d.ticker.startsWith(q)) ||
      DATA.find(d => d.name.toUpperCase().includes(q));
    if (hit) { selectTicker(hit.ticker); flash("Loaded " + hit.ticker, "ok"); }
    else flash(`"${q}" not in watchlist. Add a key & it will fetch, or pick from the list.`, "err");
  }

  /* ------------------------ misc ------------------------ */
  let flashTimer;
  function flash(msg, kind) {
    const f = el("flash"); f.textContent = msg; f.className = "flash show " + (kind || "");
    clearTimeout(flashTimer); flashTimer = setTimeout(() => f.className = "flash", 2600);
  }
  function tickClock() {
    const d = new Date();
    const opts = { hour: "2-digit", minute: "2-digit", second: "2-digit" };
    el("clock").innerHTML = d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " · <b>" + d.toLocaleTimeString(undefined, opts) + "</b> ET";
  }

  /* ------------------------ init ------------------------ */
  function init() {
    // filter buttons
    el("filter").querySelectorAll("button").forEach(b => b.onclick = () => {
      state.bucket = b.dataset.b;
      el("filter").querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b));
      renderWatchlist();
    });
    // command bar
    el("cmdForm").onsubmit = (e) => { e.preventDefault(); runCommand(el("cmdInput").value); el("cmdInput").value = ""; };
    // modal
    el("gearBtn").onclick = () => {
      el("finnhubKey").value = state.keys.finnhub;
      el("fmpKey").value = state.keys.fmp;
      el("modal").classList.add("open");
    };
    el("closeModal").onclick = () => el("modal").classList.remove("open");
    el("modal").onclick = (e) => { if (e.target === el("modal")) el("modal").classList.remove("open"); };
    el("clearKeys").onclick = () => {
      localStorage.removeItem("finnhubKey"); localStorage.removeItem("fmpKey");
      state.keys = { finnhub: "", fmp: "" }; el("finnhubKey").value = ""; el("fmpKey").value = "";
      updateLiveDot(); flash("Keys cleared — back to snapshots", "ok");
    };
    el("saveKeys").onclick = () => {
      state.keys.finnhub = el("finnhubKey").value.trim();
      state.keys.fmp = el("fmpKey").value.trim();
      localStorage.setItem("finnhubKey", state.keys.finnhub);
      localStorage.setItem("fmpKey", state.keys.fmp);
      el("modal").classList.remove("open");
      updateLiveDot();
      refreshAllLive();
    };
    el("liveBtn").onclick = () => { if (state.keys.finnhub || state.keys.fmp) refreshAllLive(); else el("gearBtn").click(); };
    el("sectorBtn").onclick = showSectors;
    el("narrBtn").onclick = showNarratives;
    el("valBtn").onclick = showValuation;

    // mobile bottom nav + drawer
    el("navList").onclick = () => $("aside").classList.contains("open") ? closeDrawer() : openDrawer();
    el("navSectors").onclick = showSectors;
    el("navNarr").onclick = showNarratives;
    el("navPE").onclick = showValuation;
    el("navRank").onclick = showRankings;
    el("rankBtn").onclick = showRankings;
    el("navSearch").onclick = () => { closeDrawer(); window.scrollTo({ top: 0 }); el("cmdInput").focus(); };
    el("backdrop").onclick = closeDrawer;

    renderWatchlist();
    selectTicker("NVDA");
    updateLiveDot();
    tickClock(); setInterval(tickClock, 1000);
    if (state.keys.finnhub || state.keys.fmp) refreshAllLive();
    // PWA: offline/phone support (only when served over http(s), not file://)
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
