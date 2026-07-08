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

  const state = {
    active: null,
    bucket: "all",
    keys: { finnhub: localStorage.getItem("finnhubKey") || "", fmp: localStorage.getItem("fmpKey") || "" },
    live: {}, // ticker -> {quote, news}
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
  function renderWatchlist() {
    const list = DATA.filter(d => state.bucket === "all" || d.bucket === state.bucket);
    el("wlCount").textContent = list.length + "/" + DATA.length;
    const bcol = { clean: "var(--green)", middle: "var(--amber)", high: "var(--orange)", tragic: "var(--red)" };
    el("watchlist").innerHTML = list.map(d => {
      const lv = state.live[d.ticker];
      const price = lv?.quote?.price ?? d.price;
      const ch = lv?.quote?.changePct ?? d.change;
      return `<div class="row ${state.active === d.ticker ? "sel" : ""}" data-tk="${d.ticker}">
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
  function selectTicker(tk) {
    state.active = tk;
    renderWatchlist();
    render();
    if (state.keys.finnhub || state.keys.fmp) fetchLive(tk);
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
      btn.onclick = () => { currentTab = btn.dataset.tab; render(); });
    renderTab(d);
  }

  /* ------------------------ tab bodies ------------------------ */
  function renderTab(d) {
    const body = el("tabBody");
    if (currentTab === "overview") body.innerHTML = tabOverview(d);
    else if (currentTab === "sbc") body.innerHTML = tabSBC(d);
    else if (currentTab === "financials") body.innerHTML = tabFinancials(d);
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

  function tabFinancials(d) {
    const yrs = fyLabels(d);
    const rows = (label, arr, fmt2 = money) => `<tr><td>${label}</td>${arr.map(v => `<td>${fmt2(v)}</td>`).join("")}</tr>`;
    const live = state.live[d.ticker]?.financialsSource;
    return `<div class="grid g2">
      <div class="card"><h3>REVENUE <span class="unit">$B / FY</span></h3>${Chart.bars([{ name: "Revenue", values: d.revenue, color: "var(--cyan)" }], yrs, { h: 180 })}</div>
      <div class="card"><h3>GAAP NET INCOME <span class="unit">$B / FY</span></h3>${Chart.bars([{ name: "NI", values: d.ni, color: "var(--green)" }], yrs, { h: 180 })}</div>
      <div class="card"><h3>STOCK-BASED COMP <span class="unit">$B / FY</span></h3>${Chart.bars([{ name: "SBC", values: d.sbc, color: "var(--red)" }], yrs, { h: 180 })}</div>
      <div class="card"><h3>BUYBACKS vs SBC <span class="unit">$B / FY</span></h3>
        ${Chart.bars([{ name: "Buyback", color: "var(--amber)", values: d.buyback }, { name: "SBC", color: "var(--red)", values: d.sbc }], yrs, { h: 180 })}
        <div class="chart-legend"><span><i style="background:var(--amber)"></i>Buyback</span><span><i style="background:var(--red)"></i>SBC</span></div>
      </div>
      <div class="card" style="grid-column:span 2">
        <h3>FINANCIAL SUMMARY <span class="unit">${live ? "● " + live + " (live)" : d.snapshot}</span></h3>
        <table class="fin">
          <tr><th>$B</th>${yrs.map(y => `<th>${y}</th>`).join("")}</tr>
          ${rows("Revenue", d.revenue)}
          ${rows("Net income (GAAP)", d.ni)}
          ${rows("Stock-based comp", d.sbc)}
          ${rows("SBC % of revenue", d.revenue.map((r, i) => d.sbc[i] == null || !r ? null : (d.sbc[i] / r) * 100), v => v == null ? "–" : v.toFixed(1) + "%")}
          ${rows("Buybacks", d.buyback)}
          ${rows("Diluted shares (B)", d.shares, v => v.toFixed(3))}
        </table>
      </div>
    </div>`;
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
    </div>`;
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
  async function fetchLive(tk) {
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
      const to = Math.floor(Date.now() / 1000), from = to - 60 * 60 * 24 * 30;
      const fd = new Date(from * 1000).toISOString().slice(0, 10);
      const td = new Date(to * 1000).toISOString().slice(0, 10);
      tasks.push(fetch(`https://finnhub.io/api/v1/company-news?symbol=${tk}&from=${fd}&to=${td}&token=${k.finnhub}`)
        .then(r => r.json()).then(n => { if (Array.isArray(n)) state.live[tk].news = n; }).catch(() => {}));
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
    flash("Pulling live data for watchlist…", "ok");
    // stagger to respect rate limits
    DATA.forEach((d, i) => setTimeout(() => fetchLive(d.ticker), i * 350));
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
