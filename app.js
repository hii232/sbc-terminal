/* =========================================================================
   SBC TERMINAL — application logic
   SEC-first bundled data + live layer (Finnhub quotes/news, FMP fallback checks).
   ========================================================================= */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (id) => document.getElementById(id);
  const money = (n, d = 1) => n == null || isNaN(n) ? "–" : "$" + (Math.abs(n) >= 1000 ? (n / 1000).toFixed(2) + "T" : n.toFixed(d) + "B");
  const pct = (n, d = 1) => n == null || isNaN(n) ? "–" : n.toFixed(d) + "%";
  const signCls = (n) => n >= 0 ? "up" : "down";
  const arrow = (n) => (n >= 0 ? "▲" : "▼");

  // No API keys ship in this codebase. Users supply their own via the ⚙ gear;
  // they are kept in this browser's localStorage (convenient, NOT secure storage —
  // anyone with access to this device/profile can read them).
  const DEFAULT_FINNHUB = "";
  const SHELL_BUILD = "70"; // visible build tag — must match index.html ?v= and sw.js V
  const state = {
    active: null,
    view: "home", // 'home' | 'stock' | 'sectors' | 'narratives'
    bucket: "all",
    watchSort: localStorage.getItem("sbc_watch_sort") || "longTermView",
    keys: { finnhub: localStorage.getItem("finnhubKey") || DEFAULT_FINNHUB, fmp: localStorage.getItem("fmpKey") || "" },
    live: {}, // ticker -> {quote, news}
    liveTimer: null,
    quoteRefreshing: false,
    liveStatus: { lastFullRefresh: null, lastCount: 0, source: "snapshot" },
    dailyReviewLoading: false,
    dailyReviewFetchedAt: null,
    secOn: new Set(["XLK", "SMH", "XLF", "XLV", "XLE", "SPY"]), // default sector lines
  };

  /* map each stock's sector to its ETF for the sector-context card */
  const SECTOR_MAP = {
    "Consumer Tech": "XLK", "Software": "XLK", "Software/AI": "XLK", "HR Tech": "XLK",
    "Networking": "XLK", "Cybersecurity": "XLK", "AdTech": "XLK", "IT Services": "XLK",
    "AI Infrastructure": "XLK", "Neocloud": "XLK", "Hardware": "SMH", "EDA Software": "SMH",
    "Semis": "SMH", "Semis/AI": "SMH", "Semi Equip": "SMH", "Semis/IP": "SMH",
    "E-commerce": "XLY", "E-commerce/Cloud": "XLY", "Auto/AI": "XLY", "Retail": "XLP",
    "Home Improvement": "XLY", "Restaurants": "XLY", "Apparel": "XLY", "Travel": "XLY",
    "Ride-Hailing": "XLY", "Gaming/Betting": "XLY", "Gaming": "XLC", "Streaming": "XLC", "Social Media": "XLC",
    "Media": "XLC", "Telecom": "XLC",
    "Payments": "XLF", "Banks": "XLF", "Asset Mgmt": "XLF", "Financial Data": "XLF",
    "Crypto Exchange": "XLF", "Fintech Brokerage": "XLF", "Insurance": "XLF",
    "Pharma": "XLV", "Managed Care": "XLV", "Life Sciences": "XLV",
    "Medical Devices": "XLV", "Biotech": "XLV",
    "Energy": "XLE",
    "Industrials": "XLI", "Public Safety Tech": "XLI", "Machinery": "XLI",
    "Aerospace": "XLI", "Rails": "XLI", "Defense": "XLI",
    "Staples": "XLP", "Beverages": "XLP", "Mega Retail": "XLP",
    "Industrial Gas": "XLB", "Materials": "XLB",
    "REIT": "XLRE", "Utilities": "XLU",
    // GICS display strings used by the auto-derived expansion
    "Technology": "XLK", "Financials": "XLF", "Health Care": "XLV",
    "Consumer Disc": "XLY", "Comm Services": "XLC",
  };
  const sectorETF = (sec) => SECTOR_MAP[sec] || "SPY"; // safe fallback
  const EARNINGS_FOCUS = {
    asOf: "2026-07-20",
    source: "Company IR dates + market-calendar cross-check (CNBC / Yahoo / MarketBeat)",
    note: "July 20-24, 2026 earnings week: GOOGL and TSLA headline Wednesday night (AI monetization + autonomy vs valuation); TXN, NOW, IBM and INTC test the semis / enterprise-AI tape; KO, GM and UNP read on consumer, tariffs and freight.",
    rows: [
      { date: "2026-07-21", symbol: "GM", name: "General Motors", hour: "bmo", theme: "Autos / tariffs", epsEstimate: 3.17 },
      { date: "2026-07-21", symbol: "KO", name: "Coca-Cola", theme: "Staples / pricing power" },
      { date: "2026-07-21", symbol: "PM", name: "Philip Morris", theme: "Staples / smoke-free mix" },
      { date: "2026-07-21", symbol: "RTX", name: "RTX", theme: "Defense / aerospace" },
      { date: "2026-07-21", symbol: "MMM", name: "3M", theme: "Industrials / margins" },
      { date: "2026-07-22", symbol: "T", name: "AT&T", hour: "bmo", theme: "Telecom / subscribers" },
      { date: "2026-07-22", symbol: "GOOGL", name: "Alphabet", hour: "amc", theme: "AI monetization / ads / cloud" },
      { date: "2026-07-22", symbol: "TSLA", name: "Tesla", hour: "amc", theme: "Autonomy / EV margins" },
      { date: "2026-07-22", symbol: "TXN", name: "Texas Instruments", hour: "amc", theme: "Analog semis cycle" },
      { date: "2026-07-22", symbol: "NOW", name: "ServiceNow", hour: "amc", theme: "Enterprise AI software" },
      { date: "2026-07-22", symbol: "IBM", name: "IBM", hour: "amc", theme: "Enterprise AI / software" },
      { date: "2026-07-23", symbol: "UNP", name: "Union Pacific", hour: "bmo", theme: "Freight / economy bellwether" },
      { date: "2026-07-23", symbol: "INTC", name: "Intel", hour: "amc", theme: "Foundry turnaround", epsEstimate: 0.21 },
      { date: "2026-07-24", symbol: "VZ", name: "Verizon", hour: "bmo", theme: "Telecom / consumer" },
    ],
  };
  const secByT = (t) => SECTORS.series.find(s => s.t === t);
  const perfSeries = (s) => s.closes.map(c => +(((c / s.closes[0]) - 1) * 100).toFixed(1));
  const retOver = (s, m) => { // % return over last m months
    const c = s.closes, n = c.length - 1, i = Math.max(0, n - m);
    return +(((c[n] / c[i]) - 1) * 100).toFixed(1);
  };

  /* ------------------------ SBC math helpers ------------------------ */
  const hasNum = (v) => v != null && Number.isFinite(+v);
  const lastVal = (arr) => {
    const a = Array.isArray(arr) ? arr : [];
    for (let i = a.length - 1; i >= 0; i--) if (hasNum(a[i])) return +a[i];
    return null;
  };
  const fyLabels = (d) => d.fy || YEARS.map(String);
  function sbcSeverity(p) { // % of revenue -> label/color
    if (p == null) return { t: "n/a", c: "var(--muted)" };
    if (p < 5) return { t: "MANAGEABLE", c: "var(--green)" };
    if (p < 10) return { t: "WATCH", c: "var(--amber)" };
    if (p < 20) return { t: "SERIOUS", c: "var(--orange)" };
    return { t: "RED FLAG", c: "var(--red)" };
  }
  function shareTrend(shares) {
    const s = (shares || []).filter(hasNum);
    if (s.length < 2 || !s[0]) return { chg: null, t: "Insufficient data", c: "var(--dim)" };
    const a = s[0], b = s[s.length - 1];
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
    if (bb == null || sbc == null) return { anti: null, real: null, t: "Insufficient data — buybacks or SBC missing", c: "var(--dim)", uncertain: true, insufficientData: true };
    if (bb <= 0.05) return { anti: 0, real: 0, t: "No buybacks", c: "var(--muted)" };
    const anti = Math.min(bb, sbc);
    const real = Math.max(0, bb - sbc);
    let t = real > bb * 0.4 ? "Mostly REAL reduction" : real > 0 ? "Hybrid" : "Pure anti-dilution treadmill";
    let c = real > bb * 0.4 ? "var(--green)" : real > 0 ? "var(--amber)" : "var(--red)";
    // Cross-check vs the actual share count: if buyback $ exceeded SBC $ but
    // shares did NOT fall, issuance beyond SBC (M&A, raises, converts) is in
    // play and the dollar-based split is unreliable. Never claim "real
    // reduction" that the share count itself contradicts.
    let uncertain = false;
    const shArr = (d.shares || []).filter(v => v != null);
    if (real > 0 && shArr.length >= 2 && shArr[shArr.length - 1] >= shArr[0] * 0.998) {
      t += " — but share count didn't fall: issuance beyond SBC (M&A/raise?) — split uncertain";
      c = "var(--amber)"; uncertain = true;
    }
    return { anti, real, t, c, uncertain };
  }
  function trueOwnerEarnings(d) {
    // v3 economics. GAAP expenses SBC at grant-date fair value; we REPLACE that
    // with an estimate of the CURRENT economic cost of equity comp:
    //   shareCost   = max(GAAP SBC, market value of employee shares issued)
    //                 — floored at GAAP SBC, so a pure diluter can never show
    //                   owner earnings above net income (the old model could)
    //   withholding = 0.25 × SBC (vest-date tax-settlement proxy, financing CF)
    // Employee shares are reconciled from the share count:
    //   grossIssued ≈ Δ diluted shares + shares repurchased (buyback$ ÷ avg px)
    //   capped at 1.5 × SBC$ ÷ avg px — the excess is issuance SBC cannot
    //   explain (M&A, raises, converts): EXCLUDED from SBC cost and FLAGGED.
    const ni = lastVal(d.ni);
    const sbc = lastVal(d.sbc);
    const bb = lastVal(d.buyback);
    const missing = [];
    if (ni == null) missing.push("net income");
    if (sbc == null) missing.push("SBC");
    if (bb == null) missing.push("buybacks");
    if (missing.length) {
      return { ni, sbc, bb, trueCost: null, owner: null, shareCost: null, withholding: null,
        withholdingSource: "missing", sbcMissing: sbc == null, buybackMissing: bb == null,
        empShares: null, mnaShares: 0, avgP: null, antiDil: null, cases: null,
        insufficientData: true, reason: "Insufficient data: missing " + missing.join(", ") };
    }
    const pxArr = d.px && d.px.v && d.px.v.length ? d.px.v : null;
    const avgP = pxArr ? pxArr.reduce((a, v) => a + v, 0) / pxArr.length : (d.price || null);
    const sh = (d.shares || []).filter(v => v != null);
    let empShares = null, mnaShares = 0, shareCost = sbc; // floor = GAAP SBC
    if (avgP && sh.length >= 2 && sbc > 0) {
      const dSh = sh[sh.length - 1] - sh[sh.length - 2];   // latest-FY change (B)
      const bought = bb > 0 ? bb / avgP : 0;               // B shares retired
      const grossIssued = Math.max(0, dSh + bought);
      const cap = (sbc * 1.5) / avgP;                      // most SBC can explain
      empShares = Math.min(grossIssued, cap);
      mnaShares = Math.max(0, grossIssued - cap);
      shareCost = Math.max(sbc, empShares * avgP);
    }
    // Withholding: use the company's SEC-REPORTED vest-date tax withholding
    // when filed; only fall back to the 25%-of-SBC proxy when it is not.
    const secW = (typeof SEC !== "undefined" && SEC[d.ticker] && SEC[d.ticker].f && SEC[d.ticker].f.taxWithholding)
      ? SEC[d.ticker].f.taxWithholding.v / 1e9 : null;
    const withholding = secW != null ? secW : sbc * 0.25;
    const withholdingSource = secW != null ? "SEC-reported employee tax withholding" : "low-confidence estimate (25% of SBC proxy)";
    const sbcMissing = !(d.sbc || []).some(v => v != null);
    const trueCost = shareCost + withholding;
    const owner = ni + sbc - trueCost;
    const conservativeCost = Math.max(trueCost * 1.15, sbc * 1.35 + withholding);
    return { ni, sbc, trueCost, owner, shareCost, withholding, withholdingSource, sbcMissing,
             empShares, mnaShares, avgP, antiDil: Math.min(bb, sbc), insufficientData: false,
             cases: {
               accounting: { label: "Accounting case", cost: sbc, owner: ni },
               base: { label: "Base economic case", cost: trueCost, owner },
               conservative: { label: "Conservative case", cost: conservativeCost, owner: ni + sbc - conservativeCost },
             } };
  }

  /* ---- runtime owner-retention: COMPUTED, never trusted from data.js ----
     Pooled multi-year retention Σowner/ΣNI (per-year floor model; latest year
     gets the full share-reconciled model). Overwrites the seeded heuristic
     ownersKeep for every name where inputs exist; falls back (labeled) only
     when they don't. Re-run after any live financials merge.               */
  function ttmOwnerEarnings(d) {
    const q = d.qd || {};
    const niArr = Array.isArray(q.ni) ? q.ni : [];
    const sbcArr = Array.isArray(q.sbc) ? q.sbc : [];
    const shareArr = Array.isArray(q.shares) ? q.shares : [];
    const bbArr = Array.isArray(q.buyback) ? q.buyback : [];
    const rows = [];
    for (let i = 0; i < Math.max(niArr.length, sbcArr.length, shareArr.length); i++) {
      rows.push({ ni: niArr[i], sbc: sbcArr[i], shares: shareArr[i], buyback: bbArr[i] });
    }
    const usable = rows.filter(r => hasNum(r.ni) && hasNum(r.sbc) && hasNum(r.shares));
    if (usable.length < 4) return null;
    const ttmRows = usable.slice(-4);
    const sum = a => a.reduce((x, y) => x + y, 0);
    const ttmNI = sum(ttmRows.map(r => +r.ni)), ttmSbc = sum(ttmRows.map(r => +r.sbc));
    const latestShares = +ttmRows[ttmRows.length - 1].shares;
    const pxArr = d.px && d.px.v && d.px.v.length ? d.px.v.slice(-26) : null;
    const avgP = pxArr ? pxArr.reduce((a, v) => a + v, 0) / pxArr.length : (d.price || null);
    let shareCost = ttmSbc, mnaShares = 0;
    // Reconciling share cost needs real buyback data for all four quarters —
    // missing quarters must not be summed as zero buybacks.
    const bbComplete = ttmRows.every(r => hasNum(r.buyback));
    const ttmBuyback = bbComplete ? sum(ttmRows.map(r => +r.buyback)) : null;
    if (avgP && usable.length >= 5 && ttmSbc > 0 && bbComplete) {
      const dSh = +usable[usable.length - 1].shares - +usable[usable.length - 5].shares;
      const bought = ttmBuyback > 0 ? ttmBuyback / avgP : 0;
      const grossIssued = Math.max(0, dSh + bought);
      const cap = (ttmSbc * 1.5) / avgP;
      const empShares = Math.min(grossIssued, cap);
      mnaShares = Math.max(0, grossIssued - cap);
      shareCost = Math.max(ttmSbc, empShares * avgP);
    }
    const withholding = ttmSbc * 0.25;
    const owner = ttmNI + ttmSbc - shareCost - withholding;
    return { owner, ownerEps: latestShares > 0 ? +(owner / latestShares).toFixed(2) : null,
      ni: ttmNI, sbc: ttmSbc, shareCost, withholding, mnaShares, source: "TTM quarterly owner EPS" };
  }
  function recomputeOwnerEconomics(d) {
    const yrs = (d.ni || []).length;
    let sumNI = 0, sumOwner = 0, valid = 0;
    for (let i = 0; i < yrs; i++) {
      const ni = d.ni[i];
      const sbc = d.sbc && d.sbc[i];
      if (!hasNum(ni) || !hasNum(sbc)) continue;
      sumNI += ni; sumOwner += ni - 0.25 * sbc; valid++;
    }
    const st = trueOwnerEarnings(d);
    if (st.insufficientData) {
      d.ownersKeep = null;
      d.keepSource = "insufficient";
      d.sbcAdjEPS = null;
      d.ownerEps = null;
      d.truePE = null;
      d.dataBlocked = true;
      d.dataBlockReason = st.reason;
      return;
    }
    if (valid && st.ni != null) {
      const lastNi = lastVal(d.ni), lastSbc = lastVal(d.sbc);
      sumOwner += st.owner - (lastNi - 0.25 * lastSbc); // swap in reconciled latest year
    }
    let keep = null;
    const sbcAllMissing = !(d.sbc || []).some(v => v != null);
    if (valid >= 2 && sumNI > 0 && !sbcAllMissing) keep = Math.min(0.98, Math.max(0.30, sumOwner / sumNI));
    if (keep != null && isFinite(keep)) {
      d.ownersKeep = +keep.toFixed(2);
      d.keepSource = "computed";
    } else {
      d.ownersKeep = null;
      d.keepSource = "insufficient";
    }
    d.mnaFlag = st.mnaShares > 0.001;
    // contradiction repair: auto-derived names bucketed "tragic" purely from a
    // share-count explosion that reconciliation traces to NON-SBC issuance
    if (d.derived && d.mnaFlag && d.bucket === "tragic" && (d.sbcPctRev == null || d.sbcPctRev < 9)) {
      d.bucket = "middle";
      if (d.grade === "F") d.grade = "C";
      d.reclassified = true;
    }
    const sh = lastVal(d.shares);
    const ttm = ttmOwnerEarnings(d);
    d.ownerEps = ttm && ttm.ownerEps != null ? ttm.ownerEps
      : st.owner != null && sh && sh > 0 ? +(st.owner / sh).toFixed(2) : null;
    d.ownerEpsSource = ttm && ttm.ownerEps != null ? ttm.source : "latest annual owner EPS";
    d.ownerTtm = ttm || null;
    d.sbcAdjEPS = d.ownerEps;
    d.truePE = d.ownerEps && d.ownerEps > 0 && d.price ? +(d.price / d.ownerEps).toFixed(1) : null;
    d.dataBlocked = d.ownerEps == null;
    d.dataBlockReason = d.dataBlocked
      ? "Insufficient data for direct owner-EPS valuation"
      : (d.keepSource === "insufficient" ? "Owner-EPS computed; multi-year retention unavailable." : "");
  }
  /* ---------- OFFICIAL STOCK UNIVERSE VALIDATION (fatal on failure) ---------- */
  (function validateUniverse() {
    const fail = (msg) => {
      document.addEventListener("DOMContentLoaded", () => {
        document.body.innerHTML = '<div style="padding:40px;font-family:monospace;color:#ff5b6b;background:#05070c;min-height:100vh">' +
          "<h2>UNIVERSE VALIDATION FAILED</h2><p>" + msg + "</p><p>The terminal refuses to run with an invalid universe.</p></div>";
      });
      throw new Error("UNIVERSE: " + msg);
    };
    if (typeof UNIVERSE_LIST === "undefined") fail("universe.js not loaded");
    const uni = UNIVERSE_LIST.map(u => u.ticker);
    const expected = uni.length;
    if (expected !== 126) fail("universe has " + expected + " tickers, expected exactly 126");
    if (new Set(uni).size !== expected) fail("duplicate tickers in universe");
    if (UNIVERSE_LIST.some(u => !u.cik || !u.name)) fail("ticker missing identity/CIK");
    const have = DATA.map(d => d.ticker);
    if (have.length !== expected) fail("DATA has " + have.length + " companies, expected " + expected);
    const haveSet = new Set(have);
    const missing = uni.filter(t => !haveSet.has(t));
    const extra = have.filter(t => !new Set(uni).has(t));
    if (missing.length) fail("approved tickers missing from data: " + missing.join(", "));
    if (extra.length) fail("unapproved tickers present: " + extra.join(", "));
  })();

  /* ---------- SEC FILING CROSS-CHECK (primary-source layer) ----------
     Compares each company's latest-FY aggregator values against SEC XBRL
     facts (sec.js, with accession numbers). A lower-quality source never
     overwrites SEC silently: matches -> verified, differences -> CONFLICT
     flagged for review, absent SEC facts -> missing (never zero).        */
  const SEC_CORE_FIELDS = ["revenue", "netIncome", "sbc", "buyback", "dilShares"];
  const SEC_CASH_FIELDS = ["ocf", "capex"];
  const SEC_FIELD_TO_LOCAL = {
    revenue: ["revenue", 1e9, 2],
    netIncome: ["ni", 1e9, 2],
    sbc: ["sbc", 1e9, 3],
    buyback: ["buyback", 1e9, 2],
    dilShares: ["shares", 1e9, 3],
    ocf: ["ocf", 1e9, 2],
    capex: ["capex", 1e9, 2],
  };
  const annualSecHist = (ticker, field) => {
    const hist = (typeof SEC !== "undefined" && SEC[ticker] && SEC[ticker].f && SEC[ticker].f[field] && SEC[ticker].f[field].hist) || [];
    return hist.filter(x => x && x.periodEnd && hasNum(x.value) && /^(10-K|10-K\/A|20-F|20-F\/A|40-F|40-F\/A)$/.test(x.form || ""));
  };
  const factDurationDays = (x) => {
    if (!x || !x.periodStart || !x.periodEnd) return null;
    const a = Date.parse(x.periodStart), b = Date.parse(x.periodEnd);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 864e5) : null;
  };
  const sameAnnualDefinition = (a, b) => {
    if (!a || !b) return false;
    if (a.periodEnd !== b.periodEnd) return false;
    if ((a.unit || "") !== (b.unit || "")) return false;
    const da = factDurationDays(a), db = factDurationDays(b);
    if (da != null && db != null && Math.abs(da - db) > 10) return false;
    return true;
  };
  function latestSecFact(ticker, field) {
    const hist = annualSecHist(ticker, field);
    return hist.slice().sort((a, b) =>
      String(a.periodEnd).localeCompare(String(b.periodEnd)) ||
      String(a.filed || "").localeCompare(String(b.filed || "")) ||
      String(a.accn || "").localeCompare(String(b.accn || ""))
    ).at(-1) || null;
  }
  function secFactForPeriod(ticker, field, targetPeriodEnd) {
    if (!targetPeriodEnd) return null;
    const hist = annualSecHist(ticker, field).filter(x => x.periodEnd === targetPeriodEnd);
    return hist.slice().sort((a, b) =>
      String(a.filed || "").localeCompare(String(b.filed || "")) ||
      String(a.accn || "").localeCompare(String(b.accn || ""))
    ).at(-1) || null;
  }
  function secAnnualPeriods(d) {
    const ends = new Set();
    ["revenue", "netIncome", "sbc", "ocf", "capex", "dilShares", "buyback"].forEach(k =>
      annualSecHist(d.ticker, k).forEach(x => ends.add(x.periodEnd)));
    return [...ends].sort().map(periodEnd => {
      const row = { periodEnd };
      ["revenue", "netIncome", "sbc", "buyback", "dilShares", "ocf", "capex"].forEach(k => { row[k] = secFactForPeriod(d.ticker, k, periodEnd); });
      const anchor = row.revenue || row.netIncome || row.ocf || row.capex || row.dilShares;
      row.periodStart = anchor && anchor.periodStart || null;
      row.form = anchor && anchor.form || null;
      row.filed = anchor && anchor.filed || null;
      row.accn = anchor && anchor.accn || null;
      row.fiscalLabel = anchor && anchor.fiscalYear ? "FY" + anchor.fiscalYear : "FY ended " + periodEnd;
      row.completeCore = SEC_CORE_FIELDS.every(k => !!row[k]);
      row.completeCash = SEC_CASH_FIELDS.every(k => !!row[k]);
      return row;
    }).filter(row => row.revenue || row.netIncome || row.ocf || row.capex || row.dilShares).slice(-10);
  }
  function rebuildSecAlignedAnnuals(d) {
    const rows = secAnnualPeriods(d);
    d.annualPeriods = rows;
    if (!rows.length) return;
    d.secPrimary = {};
    d.fy = rows.map(r => r.periodEnd.slice(0, 4));
    const setSeries = (secKey, localKey, scale, digits) => {
      const vals = rows.map(r => r[secKey] ? +(r[secKey].value / scale).toFixed(digits) : null);
      if (vals.some(v => v != null)) {
        d[localKey] = vals;
        d.secPrimary[localKey] = rows.map(r => r[secKey] || null);
      }
    };
    setSeries("revenue", "revenue", 1e9, 2);
    setSeries("netIncome", "ni", 1e9, 2);
    setSeries("sbc", "sbc", 1e9, 3);
    setSeries("buyback", "buyback", 1e9, 2);
    setSeries("dilShares", "shares", 1e9, 3);
    if (!d.qm) d.qm = {};
    const ocf = rows.map(r => r.ocf ? +(r.ocf.value / 1e9).toFixed(2) : null);
    const capex = rows.map(r => r.capex ? +(r.capex.value / 1e9).toFixed(2) : null);
    if (ocf.some(v => v != null)) { d.qm.ocf = ocf; d.secPrimary.ocf = rows.map(r => r.ocf || null); }
    if (capex.some(v => v != null)) { d.qm.capex = capex; d.secPrimary.capex = rows.map(r => r.capex || null); }
    if (ocf.some(v => v != null) || capex.some(v => v != null)) {
      d.qm.fcf = rows.map((r, i) => ocf[i] != null && capex[i] != null ? +(ocf[i] - capex[i]).toFixed(2) : null);
      d.secPrimary.fcf = rows.map((r, i) => r.ocf && r.capex ? { value: r.ocf.value - r.capex.value, periodEnd: r.periodEnd, source: "SEC ocf minus SEC capex" } : null);
    }
    d.buybackStatus = rows.map(r => r.buyback ? "reported-value" : "parser-missing");
    const rev = lastVal(d.revenue), sbc = lastVal(d.sbc), ni = lastVal(d.ni);
    d.sbcPctRev = rev && sbc != null ? +((sbc / rev) * 100).toFixed(1) : null;
    d.sbcPctNI = ni && ni > 0 && sbc != null ? +((sbc / ni) * 100).toFixed(0) : null;
  }
  function secCheckOf(d) {
    const S = (typeof SEC !== "undefined") && SEC[d.ticker];
    const res = { verified: [], conflict: [], periodMismatch: [], definitionMismatch: [], unitMismatch: [], staleSecondary: [], missing: [], details: [], latest: S ? S.latest : null };
    if (!S || !S.f) { res.missing.push({ k: "all" }); return res; }
    const latestPeriod = d.annualPeriods && d.annualPeriods.length ? d.annualPeriods[d.annualPeriods.length - 1].periodEnd : null;
    const cmp = (k, local, scale, tol, digits) => {
      const fact = secFactForPeriod(d.ticker, k, latestPeriod);
      if (!fact || local == null) {
        res.missing.push({ k, type: fact ? "missing local value" : "MISSING SEC FACT", periodEnd: latestPeriod });
        res.details.push({ k, status: fact ? "missing local value" : "MISSING SEC FACT", secFact: fact, localValue: local, valueUsed: fact ? "SEC" : "local/unavailable" });
        return;
      }
      const sec = fact.value;
      const comparableSec = digits != null ? +(sec / scale).toFixed(digits) * scale : sec;
      const lv = local * scale;
      const diff = Math.abs(lv - comparableSec) / Math.max(Math.abs(comparableSec), 1e-9);
      const detail = {
        k, sec, local: lv, diffPct: +(diff * 100).toFixed(1),
        secPeriod: fact.periodEnd, localPeriod: latestPeriod, form: fact.form,
        filed: fact.filed, accn: fact.accn, tag: fact.tag, valueUsed: "SEC primary",
      };
      if (diff <= tol) {
        res.verified.push(detail);
        res.details.push({ ...detail, status: "verified" });
      } else {
        const latest = latestSecFact(d.ticker, k);
        const type = latest && latest.periodEnd !== latestPeriod ? "PERIOD MISMATCH" : "TRUE CONFLICT";
        (type === "PERIOD MISMATCH" ? res.periodMismatch : res.conflict).push({ ...detail, type });
        res.details.push({ ...detail, status: type });
      }
    };
    const latestAligned = (arr) => Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
    cmp("revenue", latestAligned(d.revenue), 1e9, 0.02, 2);
    cmp("netIncome", latestAligned(d.ni), 1e9, 0.02, 2);
    cmp("sbc", latestAligned(d.sbc), 1e9, 0.03, 3);
    cmp("buyback", latestAligned(d.buyback), 1e9, 0.05, 2);
    cmp("dilShares", latestAligned(d.shares), 1e9, 0.01, 3);
    if (d.qm) { cmp("ocf", latestAligned(d.qm.ocf), 1e9, 0.03, 2); cmp("capex", latestAligned(d.qm.capex), 1e9, 0.05, 2); }
    return res;
  }

  function secValueForDisplay(d, k) {
    const periodEnd = d.annualPeriods && d.annualPeriods.length ? d.annualPeriods[d.annualPeriods.length - 1].periodEnd : null;
    const fact = secFactForPeriod(d.ticker, k, periodEnd) || latestSecFact(d.ticker, k);
    return fact ? { value: fact.value, meta: fact } : null;
  }

  function applySecPrimary(d) {
    rebuildSecAlignedAnnuals(d);
  }

  DATA.forEach(applySecPrimary);
  DATA.forEach(recomputeOwnerEconomics);
  DATA.forEach(d => { d.secv = secCheckOf(d); });

  function marketContext() {
    return {
      data: DATA,
      sectors: typeof SECTORS !== "undefined" ? SECTORS : { series: [] },
      estimates: typeof ESTIMATE_HISTORY !== "undefined" ? ESTIMATE_HISTORY : {},
    };
  }
  function refreshMarketScores() {
    if (!window.ScoreEngine) return;
    DATA.forEach(d => {
      d.dataConfidence = dataConfidenceOf(d);
      d.marketScores = window.ScoreEngine.scoreCompany(d, marketContext());
    });
  }
  function marketScoreOf(d) {
    if (!d.marketScores && window.ScoreEngine) {
      d.dataConfidence = dataConfidenceOf(d);
      d.marketScores = window.ScoreEngine.scoreCompany(d, marketContext());
    }
    return d.marketScores;
  }
  function forwardPEOf(d) {
    const hist = (typeof ESTIMATE_HISTORY !== "undefined" && ESTIMATE_HISTORY[d.ticker] && ESTIMATE_HISTORY[d.ticker].snapshots) || [];
    const snap = hist.length ? hist[hist.length - 1] : null;
    const eps = snap && hasNum(snap.nextYearEps) ? +snap.nextYearEps
      : hasNum(d.forwardEPS) ? +d.forwardEPS
      : hasNum(d.nonGaapEPS) ? +d.nonGaapEPS
      : null;
    const pe = hasNum(d.forwardPE) ? +d.forwardPE
      : eps && eps > 0 && d.price ? +(d.price / eps).toFixed(1)
      : null;
    const source = snap && hasNum(snap.nextYearEps) ? "next-year consensus EPS"
      : hasNum(d.forwardEPS) || hasNum(d.forwardPE) ? "forward estimate"
      : hasNum(d.nonGaapEPS) ? "Street adjusted EPS proxy"
      : "unavailable";
    return { pe, eps, source };
  }
  const scoreVal = (d, key) => {
    const s = marketScoreOf(d);
    if (!s) return null;
    if (key === "qualityReward") {
      const bq = s.businessQuality?.score;
      const mr = s.marketReward?.score;
      return bq == null || mr == null ? null : Math.round((bq + mr) / 2);
    }
    return key === "longTermView" || key === "marketRewardView"
      ? s[key]?.score
      : s[key]?.score;
  };
  const scoreColorOf = (v) => v == null ? "var(--dim)" : v >= 75 ? "var(--green)" : v >= 58 ? "var(--amber)" : v >= 42 ? "var(--orange)" : "var(--red)";

  /* ------------------------ direction edge engine ------------------------ */
  function pctMoveFrom(vals, lookback) {
    const a = (vals || []).filter(hasNum);
    if (a.length < 2) return null;
    const end = a[a.length - 1];
    const start = a[Math.max(0, a.length - 1 - lookback)];
    return start > 0 ? ((end / start) - 1) * 100 : null;
  }
  const scorePart = (key, label, score, weight, why, source, raw) => ({
    key, label,
    score: score == null || !Number.isFinite(+score) ? null : Math.round(clamp(+score, 0, 100)),
    weight, why: why || "", source: source || "terminal", raw: raw || {},
  });
  function estimateSetupPart(d) {
    const hist = (typeof ESTIMATE_HISTORY !== "undefined" && ESTIMATE_HISTORY[d.ticker] && ESTIMATE_HISTORY[d.ticker].snapshots) || [];
    const snapVal = (s, keys) => {
      for (const k of keys) if (hasNum(s && s[k])) return +s[k];
      return null;
    };
    if (hist.length >= 2) {
      const latest = hist[hist.length - 1], prev = hist[0];
      const epsNow = snapVal(latest, ["nextYearEps", "currentYearEps", "epsAvg", "estimatedEpsAvg", "epsEstimate"]);
      const epsPrev = snapVal(prev, ["nextYearEps", "currentYearEps", "epsAvg", "estimatedEpsAvg", "epsEstimate"]);
      const revNow = snapVal(latest, ["nextYearRevenue", "currentYearRevenue", "revenueAvg", "estimatedRevenueAvg", "revenueEstimate"]);
      const revPrev = snapVal(prev, ["nextYearRevenue", "currentYearRevenue", "revenueAvg", "estimatedRevenueAvg", "revenueEstimate"]);
      const epsRev = epsNow != null && epsPrev ? ((epsNow - epsPrev) / Math.abs(epsPrev)) * 100 : null;
      const revRev = revNow != null && revPrev ? ((revNow - revPrev) / Math.abs(revPrev)) * 100 : null;
      const used = [epsRev, revRev].filter(hasNum);
      if (used.length) {
        const s = 50 + (epsRev || 0) * 2.1 + (revRev || 0) * 1.2;
        const txt = `estimate revisions: EPS ${epsRev == null ? "n/a" : epsRev.toFixed(1) + "%"}, revenue ${revRev == null ? "n/a" : revRev.toFixed(1) + "%"}`;
        return scorePart("estimates", "Estimate revisions", s, 22, txt, `${hist.length} stored snapshots`, { epsRev, revRev });
      }
    }
    const live = state.live[d.ticker] || {};
    const annual = cleanEstRows(live.streetEstimates?.annual || []);
    const nextFY = annual[0] || null;
    const ttmRev = d.qd ? ttm(d.qd.revenue) : null;
    const fyRevGrowthNeed = nextFY?.revAvg != null && ttmRev ? (nextFY.revAvg / ttmRev - 1) * 100 : null;
    const fyEps = nextFY?.epsAvg;
    if (fyRevGrowthNeed != null || fyEps != null) {
      const valPenalty = d.truePE && d.truePE > 45 ? -8 : d.truePE && d.truePE < 25 ? 5 : 0;
      const s = 50 + (fyRevGrowthNeed || 0) * 1.1 + valPenalty;
      const txt = `live Street setup: FY revenue asks for ${fyRevGrowthNeed == null ? "n/a" : fyRevGrowthNeed.toFixed(1) + "%"} growth; no revision history yet`;
      return scorePart("estimates", "Estimate setup", s, 22, txt, "FMP live estimate table", { fyRevGrowthNeed, fyEps });
    }
    return scorePart("estimates", "Estimate revisions", null, 22, "missing estimate-revision history; connect/collect snapshots before trusting this layer", "missing");
  }
  function momentumPart(d) {
    const vals = d.px && d.px.v ? d.px.v : [];
    const m1 = pctMoveFrom(vals, 4);
    const m3 = pctMoveFrom(vals, 13);
    const day = quoteChangeOf(d);
    if (m1 == null && m3 == null && day == null) return scorePart("momentum", "Price momentum", null, 18, "no price tape", "missing");
    const s = 50 + (m1 || 0) * 1.25 + (m3 || 0) * 0.55 + (day || 0) * 1.7;
    const txt = `price tape: 1M ${m1 == null ? "n/a" : m1.toFixed(1) + "%"}, 3M ${m3 == null ? "n/a" : m3.toFixed(1) + "%"}, today ${day >= 0 ? "+" : ""}${(day || 0).toFixed(1)}%`;
    return scorePart("momentum", "Price momentum", s, 18, txt, vals.length >= 14 ? "weekly price history + live quote" : "limited price history", { m1, m3, day });
  }
  function sectorConfirmationPart(d) {
    const etf = sectorETF(d.sector);
    const s = secByT(etf), spy = secByT("SPY");
    if (!s || !spy) return scorePart("sector", "Sector confirmation", null, 13, "sector tape unavailable", "missing");
    const r1 = retOver(s, 1), r3 = retOver(s, 3), spy3 = retOver(spy, 3), fd = flowDelta(s);
    const rs = r3 - spy3;
    const score = 50 + rs * 1.8 + r1 * 1.0 + (fd || 0) * 3.5;
    const txt = `${etf}: 3M ${r3 >= 0 ? "+" : ""}${r3.toFixed(1)}%, vs SPY ${rs >= 0 ? "+" : ""}${rs.toFixed(1)}pp, flow ${fd >= 0 ? "+" : ""}${fd.toFixed(1)}pp`;
    return scorePart("sector", "Sector confirmation", score, 13, txt, "sector ETF tape", { etf, r1, r3, rs, fd });
  }
  function newsPart(d) {
    const rows = analyzedNewsForTicker(d.ticker);
    if (!rows.length) {
      return scorePart("news", "News/narrative", null, 14,
        state.keys.finnhub ? "no scored live headline loaded for this ticker" : "connect Finnhub for live headline scoring",
        state.keys.finnhub ? "not scanned" : "missing");
    }
    const top = rows[0];
    const avg = rows.slice(0, 3).reduce((a, x) => a + x.score, 0) / Math.min(3, rows.length);
    const score = 50 + top.score * 0.38 + avg * 0.18;
    return scorePart("news", "News/narrative", score, 14, `${top.narrative}: ${top.score > 0 ? "+" : ""}${top.score} - ${top.headline}`, "Finnhub headline scorer", { topScore: top.score, avg });
  }
  function optionsPositioningPart(d) {
    const o = d.opt;
    if (!o || !o.iv) return scorePart("options", "Options/positioning", null, 8, "options, skew and short-interest data not bundled for this name", "missing");
    const rich = o.rv ? o.iv / o.rv : null;
    let score = 50;
    const bits = [];
    if (rich != null) {
      score += rich <= 0.9 ? 7 : rich >= 1.25 ? -5 : 0;
      bits.push(`IV/RV ${rich.toFixed(2)}x`);
    }
    if (o.pcr != null) {
      score += o.pcr <= 0.65 ? 8 : o.pcr >= 1.35 ? -9 : 0;
      bits.push(`put/call OI ${o.pcr}`);
    }
    const dte = optDteNow(o);
    if (dte != null && dte < 7) { score -= 6; bits.push("chain stale/near expiry"); }
    return scorePart("options", "Options/positioning", score, 8, bits.join(" - ") || "options tape neutral", "bundled options snapshot", { rich, pcr: o.pcr, dte });
  }
  function valuationSetupPart(d) {
    const L = ivLadder(d);
    const ms = marketScoreOf(d);
    if (!L || L.impliedCAGR == null) {
      const fallback = (ms?.valuation?.score ?? 35) - (d.bucket === "tragic" ? 8 : 0);
      return scorePart("valuation", "Valuation setup", fallback, 12, "no positive owner earnings; valuation support is weak until earnings turn positive", "owner earnings unavailable");
    }
    const score = 50 + (L.impliedCAGR - 0.10) * 260 + ((ms?.valuation?.score ?? 50) - 50) * 0.25;
    const txt = `IV ladder offers ${(L.impliedCAGR * 100).toFixed(1)}%/yr; IV15 buy price $${L.IV15.toFixed(L.IV15 >= 100 ? 0 : 2)}`;
    return scorePart("valuation", "Valuation setup", score, 12, txt, "IV ladder + owner P/E", { cagr: L.impliedCAGR, buy: L.IV15 });
  }
  function qualityRewardPart(d) {
    const ms = marketScoreOf(d);
    if (!ms) return scorePart("quality", "Business/market score", null, 10, "score engine unavailable", "missing");
    const score = (ms.businessQuality.score * 0.35) + (ms.growthExecution.score * 0.25) + (ms.marketReward.score * 0.30) + (ms.shareholderEconomics.score * 0.10);
    return scorePart("quality", "Business/market score", score, 10, `BQ ${ms.businessQuality.score}, growth ${ms.growthExecution.score}, market reward ${ms.marketReward.score}`, "score engine", {});
  }
  /* Market regime computed from the daily-refreshed sector/SPY tape — no
     hardcoded macro snapshots. Auto-updates with every data refresh. */
  function macroRegimeOf() {
    const spy = secByT("SPY");
    if (!spy || !SECTORS.series || SECTORS.series.length < 5) return null;
    const secOnly = SECTORS.series.filter(s => s.t !== "SPY");
    const spy1 = retOver(spy, 1), spy3 = retOver(spy, 3);
    const breadth3 = secOnly.filter(s => retOver(s, 3) > 0).length / secOnly.length * 100;
    const defensives = ["XLP", "XLV", "XLU"];
    const defFlow = secOnly.filter(s => defensives.includes(s.t)).reduce((a, s) => a + (flowDelta(s) || 0), 0);
    const score = clamp(Math.round(50 + spy3 * 1.6 + spy1 * 2.2 + (breadth3 - 50) * 0.35 - defFlow * 2.5), 0, 100);
    const label = score >= 66 ? "RISK-ON" : score >= 45 ? "NEUTRAL" : "RISK-OFF";
    const color = score >= 66 ? "var(--green)" : score >= 45 ? "var(--amber)" : "var(--red)";
    const bits = [
      `SPY 1M ${spy1 >= 0 ? "+" : ""}${spy1.toFixed(1)}% / 3M ${spy3 >= 0 ? "+" : ""}${spy3.toFixed(1)}%`,
      `${Math.round(breadth3)}% of sectors positive over 3M`,
      defFlow > 0.6 ? "dollars rotating INTO defensives (caution)" : defFlow < -0.6 ? "dollars rotating out of defensives" : "defensive flows balanced",
    ];
    return { score, label, color, bits, spy1, spy3, breadth3, defFlow, asOf: SECTORS.asof };
  }
  function macroPart(d) {
    const regime = macroRegimeOf();
    if (!regime) return scorePart("macro", "Macro regime", null, 3, "sector/SPY tape unavailable", "missing");
    const etf = sectorETF(d.sector);
    const s = secByT(etf);
    const align = s ? (retOver(s, 3) - regime.spy3) * 0.8 : 0;
    return scorePart("macro", "Macro regime", regime.score + align, 3,
      `${regime.label}: ${regime.bits[0]} - ${regime.bits[1]}`, `sector tape as of ${regime.asOf}`, { regime: regime.score, align });
  }
  function directionEdgeOf(d) {
    const parts = [
      estimateSetupPart(d), momentumPart(d), sectorConfirmationPart(d), newsPart(d),
      optionsPositioningPart(d), valuationSetupPart(d), qualityRewardPart(d), macroPart(d),
    ];
    const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
    const used = parts.filter(p => p.score != null);
    const usedWeight = used.reduce((a, p) => a + p.weight, 0);
    const raw = usedWeight ? used.reduce((a, p) => a + p.score * p.weight, 0) / usedWeight : 50;
    const score = Math.round(clamp(raw, 0, 100));
    const coverage = Math.round((usedWeight / totalWeight) * 100);
    const L = ivLadder(d);
    const confidence = coverage >= 75 ? "high" : coverage >= 55 ? "medium" : "low";
    let label = "NO EDGE", color = "var(--amber)", action = "Wait for cleaner evidence";
    if (coverage < 45) { label = "LOW CONFIDENCE"; color = "var(--dim)"; action = "Do not force it - missing too many signal layers"; }
    else if (score >= 66) { label = "LIKELY UP"; color = "var(--green)"; action = "Long research candidate - confirm catalyst and risk"; }
    else if (score >= 57) { label = "UP BIAS"; color = "var(--cyan)"; action = "Constructive, but needs confirmation"; }
    else if (score <= 34) { label = "LIKELY DOWN"; color = "var(--red)"; action = "Avoid/short research candidate - define risk"; }
    else if (score <= 43) { label = "DOWN BIAS"; color = "var(--orange)"; action = "Weak setup - avoid adding unless thesis improves"; }
    if (L && L.IV15 && priceOf(d) <= L.IV15 && score >= 55) action = "Buy-zone research candidate - price is at/under IV15";
    const missing = parts.filter(p => p.score == null).map(p => p.label);
    return { d, score, label, color, action, confidence, coverage, parts, missing, L };
  }
  function directionPartRows(edge) {
    return edge.parts.map(p => `<div class="edge-part ${p.score == null ? "missing" : ""}">
      <span>${escapeHtml(p.label)}</span>
      <b style="color:${scoreColorOf(p.score)}">${p.score == null ? "--" : p.score}</b>
      <small>${escapeHtml(p.why).slice(0, 120)}</small>
    </div>`).join("");
  }
  function directionEdgeCard(d) {
    const e = directionEdgeOf(d);
    const topDrivers = e.parts.filter(p => p.score != null).sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50)).slice(0, 3);
    return `<div class="card edge-card" style="grid-column:span 3;border-left:3px solid ${e.color}">
      <h3>DIRECTION EDGE <span class="unit">near-term research signal - not a guarantee - coverage ${e.coverage}%</span></h3>
      <div class="edge-hero">
        <div class="edge-score" style="color:${e.color}">${e.score}<small>${e.label}</small></div>
        <div>
          <div class="note" style="border-left-color:${e.color}"><b>Action:</b> ${escapeHtml(e.action)}. Confidence is ${e.confidence}; missing layers: ${e.missing.length ? e.missing.map(escapeHtml).join(", ") : "none"}.</div>
          <div class="reason-list" style="margin-top:8px">${topDrivers.map(p => `<div><b style="color:${scoreColorOf(p.score)}">${p.label} ${p.score}</b> - ${escapeHtml(p.why)}</div>`).join("")}</div>
        </div>
      </div>
      <div class="edge-grid">${directionPartRows(e)}</div>
    </div>`;
  }
  /* ------------------------ favorites + portfolio (localStorage) ------------------------ */
  const loadJSON = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
  state.favs = new Set(loadJSON("sbc_favs", []));
  state.portfolio = loadJSON("sbc_portfolio", {}); // ticker -> {shares, cost}
  const saveFavs = () => localStorage.setItem("sbc_favs", JSON.stringify([...state.favs]));
  const savePort = () => localStorage.setItem("sbc_portfolio", JSON.stringify(state.portfolio));
  function toggleFav(tk) { state.favs.has(tk) ? state.favs.delete(tk) : state.favs.add(tk); saveFavs(); renderWatchlist(); }
  const priceOf = (d) => state.live[d.ticker]?.quote?.price ?? d.price;
  const allCompanies = () => DATA;
  const companyOf = (tk) => DATA.find(d => d.ticker === tk);
  const quotePriceOf = (d) => {
    const p = state.live[d.ticker]?.quote?.price ?? d.price;
    return p != null && Number.isFinite(+p) && +p > 0 ? +p : null;
  };
  const quoteChangeOf = (d) => state.live[d.ticker]?.quote?.changePct ?? (Number.isFinite(+d.change) ? +d.change : 0);
  const priceTextOf = (d) => {
    const p = quotePriceOf(d);
    return p == null ? "--" : p.toFixed(2);
  };

  /* ------------------------ watchlist ------------------------ */
  const watchMetric = (d, key) => {
    if (key === "truePE") return d.truePE != null ? -d.truePE : -9999;
    if (key === "mktCap") return d.mktCap || 0;
    if (key === "directionEdge") return directionEdgeOf(d).score ?? -1;
    return scoreVal(d, key) ?? -1;
  };
  function miniSpark(d) {
    const vals = (d.px?.v || []).filter(v => v != null).slice(-22);
    if (vals.length < 2) return "";
    const W = 104, H = 38, P = 3;
    const lo = Math.min(...vals), hi = Math.max(...vals), rng = hi - lo || 1;
    const x = i => P + (i / (vals.length - 1)) * (W - P * 2);
    const y = v => P + (H - P * 2) - ((v - lo) / rng) * (H - P * 2);
    const base = vals[0];
    const line = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
    const col = vals.at(-1) >= base ? "var(--green)" : "var(--red)";
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <line x1="${P}" y1="${y(base).toFixed(1)}" x2="${W - P}" y2="${y(base).toFixed(1)}" stroke="rgba(154,168,187,.42)" stroke-width="1" stroke-dasharray="5 4"/>
      <path d="${line}" fill="none" stroke="${col}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  const watchScoreText = (s) => s == null ? "--" : String(Math.round(s));
  function liveHeaderStatus() {
    if (!state.liveStatus.lastFullRefresh) return state.keys.finnhub || state.keys.fmp ? "live pending" : "yahoo pending";
    const age = state.liveStatus.lastFullRefresh ? Math.round((Date.now() - state.liveStatus.lastFullRefresh) / 1000) : null;
    const src = state.liveStatus.source === "Yahoo" ? "YH" : state.liveStatus.source === "FMP batch" ? "FMP" : state.liveStatus.source === "Finnhub rotation" ? "FH" : "live";
    return `${isMarketHours() ? "live" : "stale"} ${src} ${state.liveStatus.lastCount || 0}${age == null ? "" : `/${age}s`}`;
  }
  function renderWatchlist() {
    const universe = allCompanies();
    const list = universe.filter(d => state.bucket === "all" ? true : state.bucket === "fav" ? state.favs.has(d.ticker) : d.bucket === state.bucket)
      .sort((a, b) => watchMetric(b, state.watchSort) - watchMetric(a, state.watchSort) || b.mktCap - a.mktCap);
    el("wlCount").textContent = `${list.length}/${universe.length} - ${liveHeaderStatus()}`;
    const bcol = { clean: "var(--green)", middle: "var(--amber)", high: "var(--orange)", tragic: "var(--red)" };
    if (state.bucket === "fav" && !list.length) {
      el("watchlist").innerHTML = `<div class="sub" style="padding:16px;text-align:center">No starred names yet.<br>Tap the ☆ on any stock to add it here.</div>`;
      return;
    }
    el("watchlist").innerHTML = list.map(d => {
      const ch = quoteChangeOf(d);
      const ms = marketScoreOf(d);
      const de = directionEdgeOf(d);
      const warn = ms?.whatCouldGoWrong?.[0] || "";
      return `<div class="row ${state.active === d.ticker && state.view === "stock" ? "sel" : ""}" data-tk="${d.ticker}">
        <div class="bucketbar" style="background:${bcol[d.bucket] || "var(--cyan)"}"></div>
        <div style="min-width:0">
          <div class="tk"><span class="star ${state.favs.has(d.ticker) ? "on" : ""}" data-fav="${d.ticker}">${state.favs.has(d.ticker) ? "★" : "☆"}</span> ${d.ticker} <span style="font-size:9px;color:var(--dim)">${d.grade}</span></div>
          <div class="nm">${d.name}</div>
          <div class="mini-scores">
            <span class="mini-score">LT <b>${watchScoreText(ms?.longTermView?.score)}</b></span>
                 <span class="mini-score">MR <b>${watchScoreText(ms?.marketReward?.score)}</b></span>
                 <span class="mini-score">BQ <b>${watchScoreText(ms?.businessQuality?.score)}</b></span>
                 <span class="mini-score">VAL <b>${watchScoreText(ms?.valuation?.score)}</b></span>
                 <span class="mini-score">DE <b style="color:${de.color}">${watchScoreText(de.score)}</b></span>
          </div>
          ${warn ? `<div class="warn-line">${warn}</div>` : ""}
        </div>
        <div class="spark-wrap">${miniSpark(d)}</div>
        <div>
          <div class="px">${priceTextOf(d)}</div>
          <div class="ch ${signCls(ch)}">${arrow(ch)}${Math.abs(ch).toFixed(2)}%</div>
          <div class="mr-chip ${de.score >= 50 ? "up" : "down"}">DE ${de.score}</div>
        </div>
      </div>`;
    }).join("");
    $("#watchlist").querySelectorAll(".row").forEach(r =>
      r.onclick = (e) => { if (e.target.dataset.fav) { toggleFav(e.target.dataset.fav); e.stopPropagation(); } else selectTicker(r.dataset.tk); });
  }

  /* ------------------------ tabs state ------------------------ */
  let currentTab = "overview";
  const VIEW_BTNS = ["homeBtn", "easyBtn", "signalsBtn", "dailyBtn", "edgeBtn", "sectorBtn", "rankBtn", "screenBtn", "compareBtn", "portBtn", "calBtn", "setupsBtn", "blackrockBtn", "auditBtn", "trackBtn", "journalBtn"];

  // Condensed top navigation: the tool views grouped into a few labelled
  // menus. Each item delegates to its existing hidden drawer button, so all the
  // show*() wiring stays intact. (Group membership finalized from a design pass.)
  const NAV_GROUPS = [
    { name: "Home", icon: "🏠", tools: [
      { id: "homeBtn", label: "Home Dashboard", ic: "🏠" },
      { id: "easyBtn", label: "Easy Mode — Game Plan", ic: "🧭" },
    ] },
    { name: "Signals", icon: "💡", tools: [
      { id: "signalsBtn", label: "What Changed", ic: "💡" },
    ] },
    { name: "Earnings", icon: "🎯", tools: [
      { id: "calBtn", label: "Earnings Command Center", ic: "🎯" },
    ] },
    { name: "Market", icon: "📈", tools: [
      { id: "dailyBtn", label: "Daily Review", ic: "📰" },
      { id: "edgeBtn", label: "Direction Edge", ic: "🧭" },
      { id: "sectorBtn", label: "Sectors", ic: "◈" },
      { id: "blackrockBtn", label: "Whale Tracker", ic: "🐋" },
    ] },
    { name: "Stocks", icon: "🔍", tools: [
      { id: "setupsBtn", label: "Best Setups", ic: "⭐" },
      { id: "rankBtn", label: "Rankings", ic: "⚡" },
      { id: "screenBtn", label: "Screener", ic: "📊" },
      { id: "compareBtn", label: "Compare", ic: "⚖" },
    ] },
    { name: "Mine", icon: "💼", tools: [
      { id: "portBtn", label: "Portfolio", ic: "💼" },
      { id: "journalBtn", label: "Thesis Journal", ic: "✎" },
      { id: "trackBtn", label: "Track Record", ic: "📈" },
      { id: "auditBtn", label: "Data Audit — sources & trust", ic: "🧾" },
    ] },
  ];
  function closeTopnavDD() {
    el("topnav").querySelectorAll(".topnav-group.open").forEach(g => g.classList.remove("open"));
  }
  function renderTopNav() {
    const nav = el("topnav");
    if (!nav) return;
    nav.innerHTML = NAV_GROUPS.map((g, gi) => `
      <div class="topnav-group" data-g="${gi}">
        <button type="button" aria-haspopup="true">${g.icon} ${g.name}<span style="font-size:9px;opacity:.55;margin-left:1px">▾</span></button>
        <div class="topnav-dd" role="menu">${g.tools.map(t => `<button type="button" role="menuitem" data-tool="${t.id}"><span class="tn-ic">${t.ic}</span>${t.label}</button>`).join("")}</div>
      </div>`).join("")
      + `<button type="button" id="topWatch" class="topnav-watch" title="Watchlist">★ Watchlist</button>`;
    nav.querySelectorAll(".topnav-group").forEach(group => {
      const btn = group.querySelector(":scope > button");
      btn.onclick = (e) => {
        e.stopPropagation();
        const wasOpen = group.classList.contains("open");
        closeTopnavDD();
        if (!wasOpen) {
          group.classList.add("open");
          // position the fixed dropdown under its button (escapes the bar's scroll clip)
          const dd = group.querySelector(".topnav-dd");
          const r = btn.getBoundingClientRect();
          dd.style.top = Math.round(r.bottom + 6) + "px";
          dd.style.left = Math.round(Math.max(6, Math.min(r.left, window.innerWidth - dd.offsetWidth - 8))) + "px";
        }
      };
      group.querySelectorAll("[data-tool]").forEach(item => item.onclick = (e) => {
        e.stopPropagation();
        closeTopnavDD();
        const real = el(item.dataset.tool);
        if (real) real.click(); // delegate to the existing show*() wiring
      });
    });
    el("topWatch").onclick = (e) => { e.stopPropagation(); closeTopnavDD(); $("aside").classList.contains("open") ? closeDrawer() : openDrawer(); };
    document.addEventListener("click", closeTopnavDD);
    nav.addEventListener("scroll", closeTopnavDD, { passive: true }); // a fixed dropdown would detach if the bar scrolls
    syncTopNav();
  }
  function syncTopNav() {
    const nav = el("topnav");
    if (!nav) return;
    const activeId = VIEW_BTNS.find(id => { const e = el(id); return e && e.classList.contains("active"); });
    nav.querySelectorAll(".topnav-group").forEach((group, gi) => {
      const inGroup = (NAV_GROUPS[gi].tools || []).some(t => t.id === activeId);
      group.classList.toggle("current", inGroup);
      group.querySelectorAll("[data-tool]").forEach(item => item.classList.toggle("active", item.dataset.tool === activeId));
    });
    const w = el("topWatch");
    if (w) w.classList.toggle("active", $("aside").classList.contains("open"));
  }
  function setViewBtn(activeId) { VIEW_BTNS.forEach(id => el(id).classList.toggle("active", id === activeId)); }
  function showView(view, renderFn, btnId) {
    state.view = view; setViewBtn(btnId); renderWatchlist(); renderFn();
    closeDrawer(); window.scrollTo({ top: 0 }); syncNav(); pushNav();
  }
  function selectTicker(tk) {
    state.active = tk;
    state.view = "stock";
    setViewBtn(null);
    renderWatchlist();
    render();
    closeDrawer();
    window.scrollTo({ top: 0 });
    syncNav();
    pushNav();
    fetchLive(tk);
  }
  function showSectors() {
    state.view = "sectors";
    setViewBtn("sectorBtn");
    renderWatchlist();
    renderSectors();
    closeDrawer();
    window.scrollTo({ top: 0 });
    syncNav();
    pushNav();
  }

  /* ------------------------ mobile drawer + bottom nav ------------------------ */
  function openDrawer() {
    const drawer = $("aside");
    drawer.classList.add("open");
    drawer.scrollTop = 0;
    el("backdrop").classList.add("show");
    syncNav();
  }
  function closeDrawer() {
    $("aside").classList.remove("open");
    el("backdrop").classList.remove("show");
    syncNav();
  }
  function syncNav() {
    const drawerOpen = $("aside").classList.contains("open");
    const drawerMode = window.matchMedia("(max-width:720px)").matches;
    el("navList").classList.toggle("active", drawerOpen);
    el("navList").setAttribute("aria-expanded", drawerOpen ? "true" : "false");
    $("aside").setAttribute("aria-hidden", drawerMode && !drawerOpen ? "true" : "false");
    el("navSectors").classList.toggle("active", !drawerOpen && state.view === "sectors");
    el("navNarr").classList.toggle("active", !drawerOpen && state.view === "calendar");
    el("navPE").classList.toggle("active", !drawerOpen && state.view === "screener");
    el("navRank").classList.toggle("active", !drawerOpen && state.view === "rankings");
    syncTopNav();
  }
  function syncMobileChrome() {
    el("cmdInput").placeholder = window.matchMedia("(max-width:720px)").matches
      ? "Ticker / command"
      : "Type a ticker (e.g. NVDA) and press GO / Enter";
    syncNav();
  }

  /* ------------------------ phone back-button / history navigation ------------
     Every navigation (stock, tab, tool view) becomes a history entry, so the
     phone's back button moves back and forth INSIDE the app instead of
     leaving it. Back also closes the drawer first if it's open. ------------- */
  let navRestoring = false;
  const navKey = (st) => st ? `${st.view}|${st.tk || ""}|${st.tab || ""}` : "";
  function pushNav(force) {
    if (navRestoring) return;
    const st = state.view === "stock"
      ? { view: "stock", tk: state.active, tab: currentTab }
      : { view: state.view };
    if (!force && navKey(history.state) === navKey(st)) return; // no duplicate entries
    try {
      if (history.state == null) history.replaceState(st, "", "");
      else history.pushState(st, "", "");
    } catch (e) { /* history API unavailable (file://) — ignore */ }
  }
  function restoreNav(st) {
    navRestoring = true;
    try {
      if (!st || st.view === "stock") {
        if (st && st.tab) currentTab = st.tab;
        selectTicker((st && st.tk) || state.active || "NVDA");
      } else {
        const map = { home: showHome, easy: showEasy, signals: showSignals, blackrock: showBlackrock, setups: showSetups, dailyReview: showDailyReview, directionEdge: showDirectionEdge, sectors: showSectors,
          rankings: showRankings, screener: showScreener, compare: showCompare,
          portfolio: showPortfolio, calendar: showCalendar, audit: showAudit, track: showTrack, journal: showJournal };
        (map[st.view] || (() => selectTicker(state.active || "NVDA")))();
      }
    } finally { navRestoring = false; }
  }
  window.addEventListener("popstate", (e) => {
    if ($("aside").classList.contains("open")) {
      closeDrawer();
      pushNav(true); // back only closed the drawer — keep the current view on the stack
      return;
    }
    restoreNav(e.state);
  });

  /* ------------------------ main render ------------------------ */
  function render() {
    const d = companyOf(state.active);
    if (!d) return;
    const lv = state.live[d.ticker] || {};
    const price = lv.quote?.price ?? d.price;
    const change = lv.quote?.changePct ?? d.change;
    const ms = marketScoreOf(d);
    const mainLabel = ms?.finalLabel?.label || "Not scored";
    const mainScore = ms?.longTermView?.score;
    const conflictBadge = d.secv && d.secv.conflict.length
      ? ` <span class="derived-tag" style="color:var(--red);border-color:var(--red)" title="${d.secv.conflict.map(c => c.k + ": SEC vs terminal differ " + c.diffPct + "%").join(" · ")}">⚠ ${d.secv.conflict.length} TRUE SOURCE CONFLICT${d.secv.conflict.length > 1 ? "S" : ""}</span>`
      : d.secv && d.secv.periodMismatch.length
        ? ` <span class="derived-tag" style="color:var(--orange);border-color:var(--orange)" title="${d.secv.periodMismatch.map(c => c.k + ": " + c.secPeriod + " vs " + c.localPeriod).join(" · ")}">${d.secv.periodMismatch.length} PERIOD MISMATCH${d.secv.periodMismatch.length > 1 ? "ES" : ""}</span>`
        : "";
    const gradeColors = { A: "var(--green)", B: "var(--cyan)", C: "var(--amber)", D: "var(--orange)", F: "var(--red)" };
    const gc = gradeColors[d.grade];

    const header = `
      <div class="hdr">
        <div>
          <div class="tick"><span class="star hdr-star ${state.favs.has(d.ticker) ? "on" : ""}" id="hdrStar" title="Star this name">${state.favs.has(d.ticker) ? "★" : "☆"}</span> <span class="star" id="hdrThesis" title="Write/read your thesis — the terminal is a reading list until you do">✎</span> ${d.ticker}${d.derived ? ' <span class="derived-tag" title="Framework fields auto-derived from aggregator data">◐ auto</span>' : ""} <span class="derived-tag" style="color:${dataQualityOf(d).color};border-color:${dataQualityOf(d).color}" title="${dataQualityOf(d).tip}">${dataQualityOf(d).label}</span>${conflictBadge}</div>
          <div class="co">${d.name} · ${d.sector}</div>
        </div>
        <div>
          <div class="pxbig">$${price.toFixed(2)}</div>
          <div class="chbig ${signCls(change)}">${arrow(change)} ${Math.abs(change).toFixed(2)}% ${lv.quote ? '<span style="color:var(--green);font-size:9px">● LIVE</span>' : `<span style="color:var(--dim);font-size:9px">snapshot ${((d.snapshot || "").match(/\d{4}-\d{2}-\d{2}/) || [""])[0]} — not live</span>`}</div>
        </div>
        <div style="border-left:1px solid var(--line);padding-left:16px">
          <div class="sub">MKT CAP</div><div class="stat sm">${money(d.mktCap)}</div>
        </div>
        <div>
          <div class="sub">HEADLINE P/E</div><div class="stat sm">${d.headlinePE ?? "n/m"}</div>
        </div>
        <div>
          <div class="sub" style="color:var(--amber)">EST OWNER-EARNINGS P/E</div>
          <div class="stat sm" style="color:var(--amber)">${d.truePE ?? "n/m"}</div>
        </div>
        <div class="spacer"></div>
        <div style="text-align:center">
          <div class="sub" style="margin-bottom:4px">MGMT</div>
          <div class="grade" style="color:${gc};border-color:${gc}">${d.grade}</div>
        </div>
        <div style="text-align:right">
          <span class="badge" style="color:${scoreColorOf(mainScore)};border-color:${scoreColorOf(mainScore)}">${mainLabel.toUpperCase()}</span>
          <div class="sub" style="margin-top:5px">Long-term score ${mainScore == null ? "--" : mainScore}/100 · Data confidence ${ms?.dataConfidence?.score ?? "--"}/100</div>
        </div>
      </div>`;

    const tabs = `<div class="tabs">
      ${[["overview", "OVERVIEW"], ["quality", "QUALITY"], ["sbc", "★ SBC X-RAY"], ["graham", "🛡 GRAHAM VALUE"], ["financials", "FINANCIALS"], ["earnings", "EARNINGS"], ["news", "NEWS"]]
        .map(([k, l]) => `<button data-tab="${k}" class="${currentTab === k ? "active" : ""}">${l}</button>`).join("")}
    </div>`;

    el("main").innerHTML = header + tabs
      + `<div class="sub" style="margin:-6px 0 10px;font-size:9px">source priority: SEC filing facts -> company filings -> secondary checks -> estimates -> missing · latest SEC filing: ${d.secv && d.secv.latest && d.secv.latest.form ? d.secv.latest.form + " filed " + d.secv.latest.filed : "none on record"} · model ${SBC_MODEL_VERSION} / ${FORMULA_VERSION} · retention is explanation only (${d.keepSource === "computed" ? "computed" : "insufficient/fallback"}) · ${dataQualityOf(d).label.toLowerCase()}</div>`
      + `<div id="tabBody"></div>`;
    el("main").querySelectorAll(".tabs button").forEach(btn =>
      btn.onclick = () => { currentTab = btn.dataset.tab; render(); syncNav(); pushNav(); });
    const hs = el("hdrStar"); if (hs) hs.onclick = () => { toggleFav(d.ticker); render(); };
    const ht = el("hdrThesis"); if (ht) ht.onclick = () => { journalState.prefill = d.ticker; showJournal(); };
    renderTab(d);
  }

  /* ------------------------ tab bodies ------------------------ */
  function renderTab(d) {
    const body = el("tabBody");
    if (currentTab === "overview") {
      body.innerHTML = tabOverview(d);
      const g1 = el("dcfG1"), ex = el("dcfEx");
      if (g1 && ex) {
        const apply = () => {
          dcfState[d.ticker] = { g1: +g1.value / 100, exit: +ex.value };
          el("dcfG1v").textContent = g1.value + "%"; el("dcfExv").textContent = ex.value + "×";
          renderTab(d);
        };
        g1.oninput = () => el("dcfG1v").textContent = g1.value + "%";
        ex.oninput = () => el("dcfExv").textContent = ex.value + "×";
        g1.onchange = apply; ex.onchange = apply;
        const rs = el("dcfReset"); if (rs) rs.onclick = () => { delete dcfState[d.ticker]; renderTab(d); };
      }
    }
    else if (currentTab === "sbc") body.innerHTML = tabSBC(d);
    else if (currentTab === "quality") body.innerHTML = tabQuality(d);
    else if (currentTab === "financials") {
      body.innerHTML = tabFinancials(d);
      body.querySelectorAll(".fin-toggle").forEach(b =>
        b.onclick = () => { finMode = b.dataset.m; renderTab(d); });
    }
    else if (currentTab === "graham") body.innerHTML = tabGraham(d);
    else if (currentTab === "earnings") body.innerHTML = tabEarnings(d);
    else if (currentTab === "news") body.innerHTML = tabNews(d);
    body.querySelectorAll("[data-news-tk]").forEach(x =>
      x.onclick = (e) => { e.preventDefault(); e.stopPropagation(); selectTicker(x.dataset.newsTk); });
  }

  const SCORE_LABELS = {
    businessQuality: "Business Quality",
    growthExecution: "Growth + Execution",
    marketReward: "Market Reward",
    shareholderEconomics: "Shareholder Economics",
    valuation: "Valuation",
    dataConfidence: "Data Confidence",
  };
  const fmtScore = (v) => v == null ? "--" : Math.round(v);
  function scoreTile(label, part) {
    const score = part?.score;
    return `<div class="score-card">
      <div class="lab">${label}</div>
      <div class="num" style="color:${scoreColorOf(score)}">${fmtScore(score)}</div>
      <div class="cov">${part?.coverage != null ? "coverage " + part.coverage + "%" : "separate gate"}</div>
    </div>`;
  }
  function scoreDetails(part) {
    if (!part || !part.details) return `<div class="sub">No component details available.</div>`;
    return part.details.map(x => `<div class="kv"><span class="k">${x.k}</span><span class="v" style="color:${scoreColorOf(x.score)}">${fmtScore(x.score)}</span></div>
      <div class="sub" style="margin:-1px 0 5px">${x.why || (x.status === "missing" ? "missing, not counted as zero" : "")}</div>`).join("");
  }
  function marketDashboard(d) {
    const ms = marketScoreOf(d);
    if (!ms) return `<div class="note callout">Market/business scores did not load. Check scores.js.</div>`;
    return `
      <div class="score-strip">
        ${scoreTile(SCORE_LABELS.businessQuality, ms.businessQuality)}
        ${scoreTile(SCORE_LABELS.growthExecution, ms.growthExecution)}
        ${scoreTile(SCORE_LABELS.marketReward, ms.marketReward)}
        ${scoreTile(SCORE_LABELS.shareholderEconomics, ms.shareholderEconomics)}
        ${scoreTile(SCORE_LABELS.valuation, ms.valuation)}
        ${scoreTile(SCORE_LABELS.dataConfidence, ms.dataConfidence)}
      </div>
      <div class="view-strip">
        <div class="view-card">
          <div class="sub">LONG-TERM INVESTMENT VIEW</div>
          <div class="big" style="color:${scoreColorOf(ms.longTermView.score)}">${fmtScore(ms.longTermView.score)}</div>
          <div class="sub">Quality 30% · Growth 25% · Valuation 20% · Shareholder economics 15% · Market reward 10%</div>
        </div>
        <div class="view-card">
          <div class="sub">MARKET REWARD VIEW</div>
          <div class="big" style="color:${scoreColorOf(ms.marketRewardView.score)}">${fmtScore(ms.marketRewardView.score)}</div>
          <div class="sub">Market reward 45% · Growth 25% · Quality 15% · Valuation 10% · Shareholder economics 5%</div>
        </div>
      </div>`;
  }
  function marketConclusionCard(d) {
    const ms = marketScoreOf(d);
    const labelColor = scoreColorOf(ms?.longTermView?.score);
    const rs = (ms?.finalLabel?.reasons || []).join(" · ");
    return `<div class="card" style="grid-column:span 3;border-color:${labelColor}">
      <h3>COMPANY VIEW — BUSINESS, MARKET, PRICE <span class="unit">SBC is one input, not the main label</span></h3>
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
        <div style="min-width:220px">
          <div class="stat" style="font-size:28px;color:${labelColor}">${ms?.finalLabel?.label || "Not scored"}</div>
          <div class="sub">${rs}</div>
        </div>
        <div style="flex:1;min-width:240px">
          <div class="note" style="border-left-color:${labelColor}">
            <b>Plain English:</b> ${plainEnglishView(d, ms)}
          </div>
        </div>
      </div>
      <div class="grid g2" style="margin-top:10px">
        <div class="case-box"><b style="color:var(--green)">Why it can rise</b><div class="reason-list">${(ms?.whyRise || []).map(x => `<div>${x}</div>`).join("")}</div></div>
        <div class="case-box"><b style="color:var(--orange)">What can go wrong</b><div class="reason-list">${(ms?.whatCouldGoWrong || []).map(x => `<div>${x}</div>`).join("")}</div></div>
      </div>
    </div>`;
  }
  function plainEnglishView(d, ms) {
    if (!ms) return "The score engine is unavailable.";
    const b = ms.businessQuality.score, g = ms.growthExecution.score, m = ms.marketReward.score, s = ms.shareholderEconomics.score, v = ms.valuation.score;
    const bits = [
      b >= 70 ? "the business quality is strong" : b < 45 ? "the business quality is weak" : "business quality is mixed",
      g >= 65 ? "execution is improving" : g < 45 ? "execution is slowing" : "execution is not decisive",
      m >= 65 ? "the market is rewarding it" : m < 45 ? "the market is not rewarding it yet" : "market reward is neutral",
      s >= 65 ? "shareholder economics are clean enough" : s < 45 ? "SBC/dilution leakage needs attention" : "shareholder economics are mixed",
      v >= 65 ? "valuation is supportive" : v < 45 ? "valuation is demanding" : "valuation is fair-to-mixed",
    ];
    return `${d.ticker}: ${bits.join("; ")}. Data Confidence is ${fmtScore(ms.dataConfidence.score)}/100 and is a separate trust gate, not a bullish point.`;
  }
  function valuationCases(d) {
    const ms = marketScoreOf(d), gap = ms?.expectationsGap;
    const owner = d.ownerEps || 0, price = priceOf(d), exit = gap?.marketImplied?.exitMultiple || 22;
    const baseGrowth = gap?.terminalBase?.ownerEpsGrowth ?? gap?.terminalBase?.revenueGrowth ?? 5;
    return [
      { label: "Bear", growth: Math.max(-15, baseGrowth - 9), multiple: Math.max(8, exit - 8) },
      { label: "Base", growth: baseGrowth, multiple: exit },
      { label: "Bull", growth: Math.min(35, baseGrowth + 8), multiple: Math.min(45, exit + 8) },
    ].map(c => {
      const future = owner > 0 ? owner * Math.pow(1 + c.growth / 100, 5) : null;
      const value = future != null ? future * c.multiple : null;
      const fiveYr = value && price ? (Math.pow(value / price, 1 / 5) - 1) * 100 : null;
      return { ...c, futureOwnerEps: future, value, fiveYr };
    });
  }
  function expectationsGapCard(d) {
    const g = marketScoreOf(d)?.expectationsGap;
    if (!g) return "";
    const cell = (title, x) => `<div class="case-box">
      <b>${title}</b>
      <div class="kv"><span class="k">Revenue growth</span><span class="v">${x.revenueGrowth == null ? "--" : x.revenueGrowth + "%"}</span></div>
      <div class="kv"><span class="k">Owner EPS growth</span><span class="v">${x.ownerEpsGrowth == null ? "--" : x.ownerEpsGrowth + "%"}</span></div>
      <div class="kv"><span class="k">FCF margin</span><span class="v">${x.futureFcfMargin == null ? "--" : x.futureFcfMargin + "%"}</span></div>
      ${x.exitMultiple ? `<div class="kv"><span class="k">Exit owner P/E</span><span class="v">${x.exitMultiple}x</span></div>` : ""}
    </div>`;
    return `<div class="card" style="grid-column:span 3">
      <h3>EXPECTATIONS GAP <span class="unit">${g.label} · gap ${g.gapPct == null ? "--" : g.gapPct + "pp"}</span></h3>
      <div class="case-grid">
        ${cell("Market-implied", g.marketImplied)}
        ${cell("Street consensus", g.consensus)}
        ${cell("Terminal base", g.terminalBase)}
      </div>
      <div class="sub" style="margin-top:8px">Consensus uses stored analyst-estimate snapshots only. If history is missing, it stays unavailable instead of inventing a trend. Assumptions: ${g.assumptions.join(" · ")}.</div>
    </div>`;
  }
  function valuationCasesCard(d) {
    return `<div class="card" style="grid-column:span 3">
      <h3>VALUATION CASES <span class="unit">bear / base / bull, owner-EPS driven</span></h3>
      <div class="case-grid">${valuationCases(d).map(c => `<div class="case-box">
        <b style="color:${c.label === "Bull" ? "var(--green)" : c.label === "Bear" ? "var(--red)" : "var(--amber)"}">${c.label}</b>
        <div class="kv"><span class="k">5Y owner EPS growth</span><span class="v">${c.growth.toFixed(1)}%</span></div>
        <div class="kv"><span class="k">Exit owner P/E</span><span class="v">${c.multiple.toFixed(1)}x</span></div>
        <div class="kv"><span class="k">5Y value</span><span class="v">${c.value == null ? "--" : "$" + c.value.toFixed(0)}</span></div>
        <div class="kv"><span class="k">Implied return</span><span class="v" style="color:${scoreColorOf(c.fiveYr == null ? null : c.fiveYr + 50)}">${c.fiveYr == null ? "--" : c.fiveYr.toFixed(1) + "%/yr"}</span></div>
      </div>`).join("")}</div>
    </div>`;
  }
  function whatChangedCard(d) {
    const w = marketScoreOf(d)?.whatChanged;
    if (!w) return "";
    return `<div class="card" style="grid-column:span 3">
      <h3>WHAT CHANGED? <span class="unit">${w.label} · ${w.score == null ? "--" : w.score + "/100"}</span></h3>
      <div class="reason-list">${w.sentences.map(x => `<div>${x}</div>`).join("")}</div>
    </div>`;
  }
  function scoreDetailCard(title, part, span = 1) {
    return `<div class="card" style="grid-column:span ${span}">
      <h3>${title} <span class="unit">${fmtScore(part?.score)}/100 · coverage ${part?.coverage ?? "--"}%</span></h3>
      ${scoreDetails(part)}
    </div>`;
  }
  function tabQuality(d) {
    const ms = marketScoreOf(d);
    return `${marketDashboard(d)}
      <div class="grid g3">
        ${marketConclusionCard(d)}
        ${scoreDetailCard("BUSINESS QUALITY", ms.businessQuality)}
        ${scoreDetailCard("GROWTH + EXECUTION", ms.growthExecution)}
        ${scoreDetailCard("MARKET REWARD", ms.marketReward)}
        ${scoreDetailCard("SHAREHOLDER ECONOMICS", ms.shareholderEconomics)}
        ${scoreDetailCard("VALUATION", ms.valuation)}
        ${scoreDetailCard("DATA CONFIDENCE", { score: ms.dataConfidence.score, coverage: 100, details: [{ k: "Separate trust gate", score: ms.dataConfidence.score, why: ms.dataConfidence.reason }] })}
      </div>`;
  }
  function tickerDrawdown(d) {
    const px = d.px && Array.isArray(d.px.v) ? d.px : null;
    if (!px) return null;
    const prices = px.v.filter(v => Number.isFinite(+v) && +v > 0).map(Number);
    if (prices.length < 10) return null;
    const liveQuote = state.live[d.ticker]?.quote;
    const currentPrice = liveQuote?.price != null && Number.isFinite(+liveQuote.price) && +liveQuote.price > 0
      ? +liveQuote.price
      : quotePriceOf(d);
    const today = new Date().toISOString().slice(0, 10);
    if (currentPrice != null) {
      if (px.to === today) prices[prices.length - 1] = currentPrice;
      else prices.push(currentPrice);
    }
    let peak = -Infinity;
    const values = prices.map(price => {
      peak = Math.max(peak, price);
      return +(((price / peak) - 1) * 100).toFixed(2);
    });
    const labels = values.map(() => "");
    labels[0] = px.from?.slice(5) || "START";
    labels[labels.length - 1] = liveQuote ? "LIVE" : (px.to?.slice(5) || "LATEST");
    return {
      values,
      labels,
      current: values.at(-1),
      worst: Math.min(...values),
      peak,
      price: prices.at(-1),
      source: liveQuote ? `${liveQuote.source || "live quote"} · ${new Date(liveQuote.ts || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : `latest loaded quote · ${px.to}`,
    };
  }

  function tabOverview(d) {
    const px = d.px && d.px.v && d.px.v.length >= 10 ? d.px : null;
    const dd = tickerDrawdown(d);
    return `<div class="grid g3">
      <div style="grid-column:span 3">${marketDashboard(d)}</div>

      ${marketConclusionCard(d)}

      ${directionEdgeCard(d)}

      ${expectationsGapCard(d)}

      ${whatChangedCard(d)}

      ${newsBrainCard(d)}

      <div class="card" style="grid-column:span 2">
        <h3>PRICE — 12M WEEKLY CLOSES <span class="unit">${px ? "real Yahoo Finance data · " + px.from + " → " + px.to + ((Date.now() - Date.parse(px.to)) / 864e5 > 14 ? " · <b style=&quot;color:var(--orange)&quot;>STALE — refresh gen_prices.py</b>" : "") : "unavailable"}</span></h3>
        ${px ? Chart.line([{ points: px.v, color: "var(--cyan)" }], px.v.map((_, i) => i === 0 ? px.from.slice(5) : i === px.v.length - 1 ? px.to.slice(5) : ""), { area: true, h: 200 })
             : `<div class="sub" style="padding:28px 10px;text-align:center">Real price history not bundled for this name.<br>Run <b>python scripts/gen_prices.py</b> to fetch it — this terminal does not draw synthetic charts.</div>`}
      </div>
      <div class="card">
        <h3>OWNER-EARNINGS RETENTION</h3>
        ${d.ownersKeep == null
          ? `<div class="sub" style="padding:24px 10px;text-align:center">Retention is not computable from the filings yet (needs 2+ years of positive pooled net income). Shown as unavailable, not zero.</div>`
          : `<div style="display:flex;justify-content:center;margin:6px 0">${Chart.donut(d.ownersKeep)}</div>
        <div class="sub" style="text-align:center">Shareholders keep <b style="color:var(--text)">${(d.ownersKeep * 100).toFixed(1)}¢</b> of each GAAP earnings dollar after true SBC economics.</div>`}
      </div>

      <div class="card drawdown-card" style="grid-column:span 3">
        <h3>DRAWDOWN FROM RUNNING HIGH <span class="unit">${dd ? `12M weekly history + ${dd.source}` : "price history unavailable"}</span></h3>
        ${dd ? `<div class="drawdown-stats">
            <div><span>CURRENT DRAWDOWN</span><b class="${dd.current <= -20 ? "down" : dd.current < 0 ? "warn" : "up"}">${dd.current.toFixed(1)}%</b></div>
            <div><span>WORST 12M</span><b class="down">${dd.worst.toFixed(1)}%</b></div>
            <div><span>RUNNING PEAK</span><b>$${dd.peak.toFixed(2)}</b></div>
            <div><span>CURRENT PRICE</span><b>$${dd.price.toFixed(2)}</b></div>
          </div>
          ${Chart.drawdown(dd.values, dd.labels, { h: 220 })}
          <div class="sub drawdown-note">Drawdown measures the decline from each date's highest prior price. A new high resets the line to 0%.</div>`
          : `<div class="sub" style="padding:28px 10px;text-align:center">No verified 12-month price history is available for this ticker, so no drawdown is calculated.</div>`}
      </div>

      <div class="card"><h3>GAAP EPS</h3><div class="stat">$${d.gaapEPS?.toFixed(2) ?? "–"}</div><div class="sub">what's actually reported</div></div>
      <div class="card"><h3>WALL ST ADJ EPS</h3><div class="stat" style="color:var(--orange)">$${d.nonGaapEPS?.toFixed(2) ?? "–"}</div>
        <div class="sub">${d.gaapEPS && d.nonGaapEPS ? "+" + (((d.nonGaapEPS - d.gaapEPS) / d.gaapEPS) * 100).toFixed(0) + "% above GAAP" : ""}</div></div>
      <div class="card"><h3>EST OWNER EPS</h3><div class="stat" style="color:var(--amber)">$${d.sbcAdjEPS?.toFixed(2) ?? "–"}</div><div class="sub">${d.ownerEpsSource || "owner EPS estimate"} — value off this, not adjusted EPS</div></div>

      ${ivLadderCard(d)}

      ${capexCard(d)}

      ${qualityCard(d)}

      ${analystCard(d)}

      ${ratingsTapeCard(d)}

      ${sectorContextCard(d)}

      <div class="card" style="grid-column:span 3">
        <h3>CURATOR NOTE</h3>
        <div class="note ${d.bucket === "tragic" || d.bucket === "high" ? "callout" : ""}">${d.note}</div>
      </div>
    </div>`;
  }

  function tabSBC(d) {
    const st = trueOwnerEarnings(d);
    const sev = sbcSeverity(d.sbcPctRev);
    const trend = shareTrend(d.shares);
    const bq = buybackQuality(d);
    const yrs = fyLabels(d);
    if (st.insufficientData) {
      return `<div class="note callout" style="margin-bottom:12px"><b>Insufficient data.</b> ${st.reason}. Owner earnings, adjusted valuation, quality score and terminal verdict are intentionally unavailable until those fields are verified.</div>`;
    }

    // step 5 waterfall as horizontal bars
    const waterfall = Chart.hbars([
      { label: "GAAP NI", value: st.ni, color: "var(--cyan)", display: money(st.ni) },
      { label: "+ SBC add-back", value: st.sbc, color: "var(--dim)", display: "+" + money(st.sbc) },
      { label: "− true SBC cost", value: st.trueCost, color: "var(--red)", display: "−" + money(st.trueCost) },
      { label: "= OWNER EARN", value: Math.max(st.owner, 0), color: "var(--amber)", display: money(st.owner) },
    ], { max: Math.max(st.ni + st.sbc, st.sbc) * 1.05, labelW: 96 });
    const caseRows = st.cases ? Object.values(st.cases).map(c => {
      const sh = lastVal(d.shares);
      const eps = c.owner != null && sh ? c.owner / sh : null;
      const pe = eps && eps > 0 && d.price ? d.price / eps : null;
      return `<tr><td>${c.label}</td><td>${money(c.cost)}</td><td>${money(c.owner)}</td><td>${eps == null ? "n/m" : "$" + eps.toFixed(2)}</td><td>${pe == null ? "n/m" : pe.toFixed(1) + "x"}</td></tr>`;
    }).join("") : "";

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
        <div class="sub" style="margin-top:4px;color:${trend.c}"><b>${trend.chg == null ? "n/a" : (trend.chg >= 0 ? "+" : "") + trend.chg.toFixed(1) + "%"}</b> over 5Y — ${trend.t}${d.mnaFlag ? " · includes issuance beyond SBC (M&A/raise) — not all employee dilution" : ""}</div>
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
        <h3>④ ESTIMATED OWNER EARNINGS <span class="unit">latest FY, $B</span></h3>
        ${waterfall}
        <div style="overflow-x:auto;margin-top:8px"><table class="rank mini">
          <thead><tr><th>CASE</th><th>SBC COST</th><th>OWNER EARN</th><th>OWNER EPS</th><th>OWNER P/E</th></tr></thead>
          <tbody>${caseRows}</tbody>
        </table></div>
        <div class="sub" style="margin-top:6px">Est. cost = employee-share cost ${money(st.shareCost)} (${st.empShares != null ? "≈" + (st.empShares * 1000).toFixed(0) + "M shares reconciled from the count at avg $" + st.avgP.toFixed(0) + ", floored at GAAP SBC" : "GAAP SBC floor — share reconciliation unavailable"}) + vest-date tax withholding ${money(st.withholding)} <b>(${st.withholdingSource})</b>.${st.mnaShares > 0.001 ? ` <b style=\"color:var(--amber)\">${(st.mnaShares * 1000).toFixed(0)}M shares of issuance exceed what SBC can explain (M&A/raise/converts) — excluded from SBC cost.</b>` : ""} Retention here is <b>${d.keepSource === "computed" ? "computed (pooled multi-year)" : "a heuristic fallback"}</b>, not filing-verified.</div>
      </div>

      <!-- STEP 6: valuation re-rate -->
      <div class="card">
        <h3>⑤ VALUATION RE-RATE</h3>
        ${Chart.hbars([
          { label: "Headline P/E", value: d.headlinePE || 0, color: "var(--cyan)", display: (d.headlinePE ?? "n/m") + "x" },
          { label: "Wall St adj", value: d.headlinePE || 0, color: "var(--orange)", display: (d.headlinePE ?? "n/m") + "x" },
          { label: "OWNER P/E", value: d.truePE || 0, color: "var(--amber)", display: (d.truePE ?? "n/m") + "x" },
        ], { max: (d.truePE || d.headlinePE || 1) * 1.15, labelW: 92 })}
        <div class="note ${d.truePE > (d.headlinePE || 0) * 1.25 ? "callout" : ""}" style="margin-top:10px">
          Owner EPS ${d.ownerEps != null ? "$" + d.ownerEps.toFixed(2) : "n/a"} (${d.ownerEpsSource || "owner EPS estimate"}) = adjusted owner earnings divided by diluted weighted-average shares; owner P/E = current price divided by owner EPS. Retention (${d.ownersKeep == null ? "n/a" : (d.ownersKeep * 100).toFixed(0) + "¢/$"}) is explanation only.
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

  const SEG_COLORS = ["var(--cyan)", "var(--amber)", "var(--green)", "var(--purple)", "var(--orange)", "#5aa9d6", "#ff6ec7", "#7d9be8", "#c9a86a", "#6fd8d8"];
  const SEG_BASIS = { segment: "by reporting segment", product: "by product / drug", region: "by region", division: "by division" };
  function segmentCard(d) {
    const S = (typeof SEGMENTS !== "undefined") && SEGMENTS[d.ticker];
    if (!S) return "";
    const total = S.segs.reduce((a, s) => a + s[1], 0);
    const sorted = [...S.segs].sort((a, b) => b[1] - a[1]);
    const rows = sorted.map((s, i) => {
      const [name, val] = s, pct = (val / total) * 100;
      return `<div class="seg-row">
        <div class="seg-name" title="${name}">${name}</div>
        <div class="seg-track"><i style="width:${Math.max(pct, 1.5)}%;background:${SEG_COLORS[i % SEG_COLORS.length]}"></i></div>
        <div class="seg-val">$${val >= 100 ? val.toFixed(0) : val.toFixed(1)}B <span class="sub">${pct.toFixed(0)}%</span></div>
      </div>`;
    }).join("");
    return `<div class="card" style="margin-bottom:12px;border-left:3px solid var(--cyan)">
      <h3>REVENUE BY SEGMENT — WHERE THE MONEY COMES FROM <span class="unit">${S.fy} · ${SEG_BASIS[S.basis] || "by segment"} · $B</span></h3>
      ${rows}
      <div class="note" style="margin-top:10px">${S.note}</div>
    </div>`;
  }

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

    const secCard = (() => {
      const sv = d.secv, S = (typeof SEC !== "undefined") && SEC[d.ticker];
      if (!S || !S.f) return `<div class="card" style="margin-bottom:12px"><h3>SEC FILING CHECK</h3><div class="sub">No SEC facts on record for this name — run scripts/sec_ingest.py.</div></div>`;
      const NAMES = { revenue: "Revenue", netIncome: "Net income", sbc: "Stock-based comp", buyback: "Buybacks", dilShares: "Diluted shares", ocf: "Operating cash flow", capex: "Capex", taxWithholding: "SBC tax withholding", esppProceeds: "Stock-plan proceeds", periodEndShares: "Period-end shares" };
      const fmtSec = (k, v) => k === "dilShares" || k === "periodEndShares" ? (v / 1e9).toFixed(3) + "B sh" : "$" + (v / 1e9).toFixed(2) + "B";
      const row = (st, cls, k, sec, local, extra) => `<tr><td>${NAMES[k] || k}</td><td class="${cls}">${st}</td><td>${sec != null ? fmtSec(k, sec) : "–"}</td><td class="sub">${local != null ? fmtSec(k, local) : "–"}</td><td class="sub">${extra || ""}</td></tr>`;
      let rows = "";
      (sv.verified || []).forEach(c => rows += row("✓ verified", "up", c.k, c.sec, c.local, "Δ " + c.diffPct + "%"));
      (sv.conflict || []).forEach(c => rows += row("⚠ CONFLICT — review", "down", c.k, c.sec, c.local, "Δ " + c.diffPct + "% — no source auto-wins"));
      (sv.periodMismatch || []).forEach(c => rows += row("PERIOD MISMATCH", "down", c.k, c.sec, c.local, `${c.secPeriod || "SEC ?"} vs ${c.localPeriod || "terminal ?"}`));
      ["taxWithholding", "esppProceeds", "periodEndShares"].forEach(k => { const f = S.f[k]; if (f) rows += row("reported (SEC only)", "up", k, f.v, null, f.form + " " + f.filed); });
      (sv.missing || []).forEach(c => { if (c.k !== "all") rows += row("missing — NOT zero", "sub", c.k, null, null, ""); });
      const detailRows = (sv.details || []).map(c => `<tr>
        <td>${NAMES[c.k] || c.k}</td><td class="${c.status === "verified" ? "up" : c.status === "TRUE CONFLICT" ? "down" : "sub"}">${c.status}</td>
        <td>${c.sec != null ? fmtSec(c.k, c.sec) : "—"}</td><td>${c.local != null ? fmtSec(c.k, c.local) : "—"}</td>
        <td class="sub">${c.secPeriod || c.secFact?.periodEnd || "—"}</td><td class="sub">${c.localPeriod || "—"}</td>
        <td class="sub">${c.form || c.secFact?.form || "—"} ${c.filed || c.secFact?.filed || ""}</td>
        <td class="sub">${c.accn || c.secFact?.accn || "—"}</td><td class="sub">${c.tag || c.secFact?.tag || "—"}</td><td class="sub">${c.valueUsed || "SEC primary"}</td>
      </tr>`).join("");
      return `<div class="card" style="margin-bottom:12px;border-left:3px solid ${sv.conflict.length ? "var(--red)" : sv.periodMismatch.length ? "var(--orange)" : "var(--green)"}">
        <h3>SEC FILING CHECK <span class="unit">${sv.latest && sv.latest.form ? sv.latest.form + " filed " + sv.latest.filed + " · accn " + sv.latest.accn : ""} · SEC facts never silently overwritten${(() => { const u = (typeof UNIVERSE_LIST !== "undefined") && UNIVERSE_LIST.find(x => x.ticker === d.ticker); return u && sv.latest && sv.latest.accn ? ` · <a href="https://www.sec.gov/Archives/edgar/data/${u.cik}/${sv.latest.accn.replace(/-/g, "")}/" target="_blank" rel="noopener" style="color:var(--cyan)">READ THE ACTUAL FILING →</a>` : ""; })()}</span></h3>
        <div style="overflow-x:auto"><table class="fin"><tr><th style="text-align:left">FIELD</th><th style="text-align:left">STATUS</th><th>SEC FILING</th><th>TERMINAL</th><th>NOTE</th></tr>${rows}</table></div>
        <h3 style="margin-top:12px">CONFLICT / PERIOD DETAILS <span class="unit">same-period facts only become true conflicts</span></h3>
        <div style="overflow-x:auto"><table class="fin"><tr><th>FIELD</th><th>REASON</th><th>SEC VALUE</th><th>OTHER VALUE</th><th>SEC PERIOD</th><th>OTHER PERIOD</th><th>FILING</th><th>ACCESSION</th><th>TAG</th><th>MODEL USES</th></tr>${detailRows}</table></div>
      </div>`;
    })();
    const html = `${toggle}${secCard}${segmentCard(d)}<div class="grid g2">
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

  const numFrom = (o, keys) => {
    if (!o) return null;
    for (const k of keys) {
      const v = o[k];
      if (v !== null && v !== undefined && v !== "" && Number.isFinite(+v)) return +v;
    }
    return null;
  };
  const dateFrom = (o) => o ? (o.date || o.fiscalDateEnding || o.period || o.calendarDate || o.reportDate || o.fillingDate || "") : "";
  const revToB = (v) => v == null ? null : (Math.abs(v) > 10000 ? v / 1e9 : v);
  const fmtDollar = (n, d = 2) => n == null || isNaN(n) ? "-" : "$" + n.toFixed(d);
  const fmtRevEst = (n) => n == null || isNaN(n) ? "-" : money(revToB(n));
  const shortDate = (s) => {
    if (!s) return "-";
    const dt = new Date(s + "T12:00:00");
    return isNaN(dt) ? s : dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };
  const daysTo = (s) => {
    if (!s) return null;
    const dt = new Date(s + "T12:00:00");
    if (isNaN(dt)) return null;
    return Math.round((dt - new Date()) / 864e5);
  };
  const estRow = (r) => ({
    date: dateFrom(r),
    epsAvg: numFrom(r, ["epsAvg", "estimatedEpsAvg", "epsEstimate", "estimatedEps", "eps"]),
    epsLow: numFrom(r, ["epsLow", "estimatedEpsLow"]),
    epsHigh: numFrom(r, ["epsHigh", "estimatedEpsHigh"]),
    revAvg: revToB(numFrom(r, ["revenueAvg", "estimatedRevenueAvg", "revenueEstimate", "estimatedRevenue", "revenue"])),
    revLow: revToB(numFrom(r, ["revenueLow", "estimatedRevenueLow"])),
    revHigh: revToB(numFrom(r, ["revenueHigh", "estimatedRevenueHigh"])),
    analystsEps: numFrom(r, ["numberAnalystsEstimatedEps", "numAnalystsEps", "analystsEps"]),
    analystsRev: numFrom(r, ["numberAnalystsEstimatedRevenue", "numAnalystsRevenue", "analystsRevenue"]),
    raw: r
  });
  const cleanEstRows = (rows) => (Array.isArray(rows) ? rows.map(estRow)
    .filter(r => r.date || r.epsAvg != null || r.revAvg != null)
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")) : []);

  /* ====================================================================
     EARNINGS INTELLIGENCE ENGINE
     Bundled layer: EARNINGS_INTEL (earnings.js) — beat/miss history,
     next-report consensus and estimate revisions, refreshed daily by the
     data pipeline. Live layer: Finnhub universe calendar — actual EPS and
     revenue appear the same session a company reports, polled automatically
     while the Command Center is open. Every component is missing-safe:
     an unavailable input stays null and lowers coverage, it never fakes 50.
     ==================================================================== */
  const earnIntelOf = (tk) => (typeof EARNINGS_INTEL !== "undefined" && EARNINGS_INTEL.tickers && EARNINGS_INTEL.tickers[tk]) || null;
  const earnIntelAsOf = () => (typeof EARNINGS_INTEL !== "undefined" && EARNINGS_INTEL.asOf) || null;
  const todayISO = () => new Date().toISOString().slice(0, 10);

  function earnBeatStats(tk) {
    const it = earnIntelOf(tk);
    const rows = (it && it.history || []).filter(h => h.epsActual != null && h.epsEstimate != null);
    if (!rows.length) return null;
    const beats = rows.filter(h => h.epsActual > h.epsEstimate).length;
    const surprises = rows.map(h => h.surprisePct).filter(hasNum);
    const avgSurprise = surprises.length ? surprises.reduce((a, v) => a + v, 0) / surprises.length : null;
    return { n: rows.length, beats, beatRate: beats / rows.length, avgSurprise, rows };
  }

  /* live Finnhub layer: symbol -> latest calendar row (with actuals once reported) */
  state.earnLive = { rows: {}, fetchedAt: null, error: "", loading: false, timer: null };
  async function refreshEarningsLive(force = false) {
    const key = state.keys.finnhub;
    const L = state.earnLive;
    if (!key || L.loading) return false;
    if (!force && L.fetchedAt && Date.now() - L.fetchedAt < 3 * 60e3) return false;
    L.loading = true;
    const fmt = (dt) => dt.toISOString().slice(0, 10);
    const from = fmt(new Date(Date.now() - 14 * 864e5)), to = fmt(new Date(Date.now() + 21 * 864e5));
    try {
      const j = await fetchJsonWithRetry(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${key}`,
        { provider: "Finnhub earnings calendar", ticker: "UNIVERSE" });
      const uni = new Set(DATA.map(d => d.ticker));
      const fresh = [];
      const rows = {};
      (j.earningsCalendar || []).forEach(e => {
        if (!uni.has(e.symbol)) return;
        rows[e.symbol] = e;
        const old = L.rows[e.symbol];
        if (hasNum(e.epsActual) && (!old || !hasNum(old.epsActual))) fresh.push(e);
      });
      const hadData = L.fetchedAt != null;
      state.earnLive = { ...L, rows, fetchedAt: Date.now(), error: "", loading: false };
      if (hadData && fresh.length) {
        const line = fresh.slice(0, 3).map(e => `${e.symbol} ${hasNum(e.epsEstimate) ? (e.epsActual > e.epsEstimate ? "BEAT" : e.epsActual < e.epsEstimate ? "MISSED" : "IN-LINE") : "reported"}`).join(" · ");
        flash(`⚡ New results: ${line}`, "ok");
      }
      return true;
    } catch {
      state.earnLive = { ...L, error: "Finnhub earnings calendar unavailable", loading: false };
      return false;
    }
  }
  /* during BMO/AMC report windows poll fast; otherwise slow */
  function inEarningsWindow(now = new Date()) {
    const p = etParts(now);
    if (p.day === 0 || p.day === 6) return false;
    const mins = p.hour * 60 + p.minute;
    return (mins >= 5 * 60 + 30 && mins <= 9 * 60 + 45) || (mins >= 15 * 60 + 55 && mins <= 20 * 60);
  }
  function startEarningsAutoPoll() {
    if (state.earnLive.timer) clearInterval(state.earnLive.timer);
    state.earnLive.timer = setInterval(async () => {
      if (state.view !== "calendar" || document.hidden || !state.keys.finnhub) return;
      const fastLane = inEarningsWindow();
      const age = state.earnLive.fetchedAt ? Date.now() - state.earnLive.fetchedAt : Infinity;
      if (age < (fastLane ? 3 * 60e3 : 12 * 60e3)) return;
      const changed = await refreshEarningsLive(true);
      if (changed && state.view === "calendar") renderEarningsCmd();
    }, 45 * 1000);
  }

  /* season ledger: everything that has REPORTED in the window, live-first.
     Three honesty tiers: live Finnhub rows carry the exact report date;
     pipeline-stamped rows carry the morning the result first appeared (≈);
     and quarters whose END falls inside the window with actuals on file are
     PROVABLY reported (a company cannot have actuals without reporting) —
     shown with the fiscal quarter end as the approximate date. */
  function earningsLedger(daysBack = 45) {
    const cutoff = new Date(Date.now() - daysBack * 864e5).toISOString().slice(0, 10);
    const qCutoff = new Date(Date.now() - 65 * 864e5).toISOString().slice(0, 10);
    const today = todayISO();
    const out = new Map();
    DATA.forEach(d => {
      const it = earnIntelOf(d.ticker);
      (it && it.history || []).forEach(h => {
        if (h.epsActual == null) return;
        if (h.reportedOn && h.reportedOn >= cutoff) {
          out.set(d.ticker, { symbol: d.ticker, date: h.reportedOn, dateIsApprox: true, quarter: h.quarter,
            epsActual: h.epsActual, epsEstimate: h.epsEstimate, surprisePct: h.surprisePct, source: "bundled" });
        } else if (!h.reportedOn && h.quarter && h.quarter >= qCutoff && h.quarter <= today && !out.has(d.ticker)) {
          out.set(d.ticker, { symbol: d.ticker, date: h.quarter, dateIsApprox: true, postQuarter: true, quarter: h.quarter,
            epsActual: h.epsActual, epsEstimate: h.epsEstimate, surprisePct: h.surprisePct, source: "bundled" });
        }
      });
    });
    Object.values(state.earnLive.rows).forEach(e => {
      if (!hasNum(e.epsActual) || !e.date || e.date < cutoff || e.date > today) return;
      const surprise = hasNum(e.epsEstimate) && Math.abs(e.epsEstimate) > 1e-9
        ? ((e.epsActual - e.epsEstimate) / Math.abs(e.epsEstimate)) * 100 : null;
      out.set(e.symbol, { symbol: e.symbol, date: e.date, dateIsApprox: false, quarter: e.quarter ? `${e.year}Q${e.quarter}` : null,
        epsActual: e.epsActual, epsEstimate: hasNum(e.epsEstimate) ? e.epsEstimate : null,
        revActual: hasNum(e.revenueActual) ? e.revenueActual : null, revEstimate: hasNum(e.revenueEstimate) ? e.revenueEstimate : null,
        surprisePct: surprise != null ? +surprise.toFixed(2) : null, hour: e.hour, source: "live" });
    });
    return [...out.values()].sort((a, b) => b.date.localeCompare(a.date) || a.symbol.localeCompare(b.symbol));
  }

  /* upcoming reports: live calendar > bundled intel > curated focus week */
  function upcomingEarningsRows(daysAhead = 21) {
    const today = todayISO();
    const to = new Date(Date.now() + daysAhead * 864e5).toISOString().slice(0, 10);
    const out = new Map();
    DATA.forEach(d => {
      const it = earnIntelOf(d.ticker);
      if (!it || !it.nextDate || it.nextDate < today || it.nextDate > to) return;
      out.set(d.ticker, { symbol: d.ticker, date: it.nextDate, dateEnd: it.nextDateEnd, estimated: !!it.nextDateEstimate,
        epsEstimate: it.epsEstimate, revEstimate: it.revEstimate, source: "bundled" });
    });
    Object.values(state.earnLive.rows).forEach(e => {
      if (hasNum(e.epsActual) || !e.date || e.date < today || e.date > to) return;
      out.set(e.symbol, { symbol: e.symbol, date: e.date, hour: e.hour,
        epsEstimate: hasNum(e.epsEstimate) ? e.epsEstimate : (out.get(e.symbol) || {}).epsEstimate ?? null,
        revEstimate: hasNum(e.revenueEstimate) ? e.revenueEstimate : (out.get(e.symbol) || {}).revEstimate ?? null, source: "live" });
    });
    bundledEarningsRows(new Date(), new Date(Date.now() + daysAhead * 864e5), true).forEach(e => {
      if (!out.has(e.symbol)) out.set(e.symbol, { symbol: e.symbol, date: e.date, hour: e.hour, epsEstimate: e.epsEstimate ?? null, revEstimate: null, source: "focus" });
    });
    return [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
  }

  /* micro read-through: how the stock's own sector is clearing the bar this season */
  function peerReadThrough(d, ledger) {
    const rows = (ledger || earningsLedger()).filter(r => {
      if (r.symbol === d.ticker || r.surprisePct == null) return false;
      const peer = companyOf(r.symbol);
      return peer && sectorETF(peer.sector) === sectorETF(d.sector);
    });
    if (rows.length < 2) return null;
    const beats = rows.filter(r => r.surprisePct > 0).length;
    const avg = rows.reduce((a, r) => a + r.surprisePct, 0) / rows.length;
    return { n: rows.length, beatShare: beats / rows.length, avgSurprise: avg, symbols: rows.map(r => r.symbol) };
  }

  /* ------------------- BEAT ODDS MODEL -------------------
     A transparent, weighted composite answering one question: how loaded is
     the setup for this company to clear the Street's EPS bar next report?
     It is a research signal on 0-100 — NOT a probability, NOT a guarantee. */
  function beatOddsOf(d, ledger) {
    const it = earnIntelOf(d.ticker);
    const parts = [];
    // 1 · beat track record (companies that habitually guide-to-beat keep doing it)
    const bs = earnBeatStats(d.ticker);
    parts.push(scorePart("track", "Beat track record",
      bs ? 50 + (bs.beatRate - 0.5) * 85 + clamp(bs.avgSurprise ?? 0, -12, 12) * 1.6 : null, 28,
      bs ? `beat ${bs.beats}/${bs.n} recent quarters, avg surprise ${bs.avgSurprise == null ? "n/a" : (bs.avgSurprise >= 0 ? "+" : "") + bs.avgSurprise.toFixed(1) + "%"}` : "no bundled beat history yet — runs after first data refresh",
      bs ? "bundled earnings history" : "missing"));
    // 2 · estimate revision momentum (analysts walking numbers up = de-risked bar)
    const t = it && it.trend;
    let revScore = null, revWhy = "no revision tape for the current quarter";
    if (t) {
      const totalAnalysts = hasNum(t.analystsEps) && t.analystsEps > 0 ? t.analystsEps : null;
      const up = t.revUp30, down = t.revDown30;
      const net = hasNum(up) && hasNum(down) && totalAnalysts ? (up - down) / totalAnalysts : hasNum(up) && hasNum(down) && (up + down) > 0 ? (up - down) / (up + down) : null;
      const drift = hasNum(t.epsNow) && hasNum(t.eps90dAgo) && Math.abs(t.eps90dAgo) > 1e-9 ? ((t.epsNow - t.eps90dAgo) / Math.abs(t.eps90dAgo)) * 100 : null;
      if (net != null || drift != null) {
        revScore = 50 + (net ?? 0) * 55 + clamp(drift ?? 0, -15, 15) * 1.4;
        revWhy = `30d revisions ${hasNum(up) ? up : "?"}▲/${hasNum(down) ? down : "?"}▼${drift != null ? ` · consensus EPS drift 90d ${(drift >= 0 ? "+" : "") + drift.toFixed(1)}%` : ""}`;
      }
    }
    if (revScore == null) {
      const est = estimateSetupPart(d);
      if (est.score != null) { revScore = est.score; revWhy = est.why; }
    }
    parts.push(scorePart("revisions", "Revision momentum", revScore, 24, revWhy, t ? "analyst revision tape" : "estimate snapshots"));
    // 3 · pre-earnings tape (relative strength into the print)
    const m1 = pctMoveFrom(d.px && d.px.v || [], 4);
    const s = secByT(sectorETF(d.sector));
    const sec1 = s ? retOver(s, 1) : null;
    parts.push(scorePart("tape", "Pre-report tape",
      m1 == null ? null : 50 + (sec1 != null ? (m1 - sec1) * 1.7 : 0) + m1 * 0.7, 14,
      m1 == null ? "no recent price tape" : `1M ${m1 >= 0 ? "+" : ""}${m1.toFixed(1)}%${sec1 != null ? ` vs sector ${(m1 - sec1) >= 0 ? "+" : ""}${(m1 - sec1).toFixed(1)}pp` : ""}`,
      m1 == null ? "missing" : "weekly price history"));
    // 4 · peer read-through (micro events: sector peers already cleared/failed the bar)
    const rt = peerReadThrough(d, ledger);
    parts.push(scorePart("peers", "Sector read-through",
      rt ? 50 + (rt.beatShare - 0.5) * 62 + clamp(rt.avgSurprise, -10, 10) * 1.9 : null, 14,
      rt ? `${rt.n} sector peers reported: ${Math.round(rt.beatShare * 100)}% beat, avg surprise ${(rt.avgSurprise >= 0 ? "+" : "") + rt.avgSurprise.toFixed(1)}%` : "fewer than 2 sector peers reported this season yet",
      rt ? "season ledger" : "missing"));
    // 5 · macro regime (macro events: risk appetite decides how beats get paid)
    const regime = macroRegimeOf();
    parts.push(scorePart("macro", "Macro regime",
      regime ? regime.score : null, 10,
      regime ? `${regime.label} — ${regime.bits[0]}` : "sector/SPY tape unavailable",
      regime ? `sector tape as of ${regime.asOf}` : "missing"));
    // 6 · expectation bar (a bar priced for acceleration is harder to clear)
    let barScore = null, barWhy = "consensus growth ask unavailable";
    const askGrowth = t && hasNum(t.growth) ? t.growth * 100 : null;
    const recentYoY = d.qd ? yoyPct(d.qd.ni.map((n, i) => n == null || !d.qd.shares[i] ? null : n / d.qd.shares[i])) : null;
    if (askGrowth != null) {
      const gap = recentYoY != null ? askGrowth - recentYoY : null;
      barScore = 50 - clamp(gap ?? (askGrowth > 25 ? 10 : 0), -25, 25) * 1.1;
      barWhy = `Street asks ${askGrowth >= 0 ? "+" : ""}${askGrowth.toFixed(0)}% EPS growth${gap != null ? ` — ${Math.abs(gap).toFixed(0)}pp ${gap > 0 ? "ABOVE" : "below"} the recent trend` : ""}`;
    }
    parts.push(scorePart("bar", "Expectation bar", barScore, 10, barWhy, askGrowth != null ? "consensus vs filings" : "missing"));

    const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
    const used = parts.filter(p => p.score != null);
    const usedWeight = used.reduce((a, p) => a + p.weight, 0);
    const score = usedWeight ? Math.round(clamp(used.reduce((a, p) => a + p.score * p.weight, 0) / usedWeight, 0, 100)) : null;
    const coverage = Math.round((usedWeight / totalWeight) * 100);
    let label = "COIN FLIP", color = "var(--amber)";
    if (score == null || coverage < 40) { label = "NOT ENOUGH DATA"; color = "var(--dim)"; }
    else if (score >= 68) { label = "STRONG BEAT SETUP"; color = "var(--green)"; }
    else if (score >= 57) { label = "LEAN BEAT"; color = "var(--cyan)"; }
    else if (score <= 35) { label = "MISS RISK"; color = "var(--red)"; }
    else if (score <= 44) { label = "AT RISK"; color = "var(--orange)"; }
    const drivers = used.sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50)).slice(0, 2);
    return { d, score, coverage, label, color, parts, drivers, intel: it };
  }

  /* ------------------- POST-EARNINGS DRIFT (PEAD) -------------------
     The most durable public-data anomaly: stocks that beat with rising
     estimates tend to keep drifting for weeks because the market
     underreacts. This scores each recent reporter's drift setup. It is a
     research signal grounded in published research, not a guarantee. */
  function driftScoreOf(r, dNow) {
    if (!r || r.epsActual == null || r.epsEstimate == null || !r.date) return null;
    const daysSince = Math.round((Date.now() - Date.parse(r.date + "T16:00:00Z")) / 864e5);
    if (daysSince < 0 || daysSince > 60) return null;
    const d = dNow || companyOf(r.symbol);
    if (!d) return null;
    const bits = [];
    const surprise = r.surprisePct != null ? clamp(r.surprisePct, -15, 15) : (r.epsActual > r.epsEstimate ? 3 : -3);
    let score = 50 + surprise * 2.6;
    bits.push(`EPS surprise ${r.surprisePct != null ? (r.surprisePct >= 0 ? "+" : "") + r.surprisePct.toFixed(1) + "%" : r.epsActual > r.epsEstimate ? "beat" : "miss"}`);
    if (hasNum(r.revActual) && hasNum(r.revEstimate)) {
      const revBeat = r.revActual > r.revEstimate;
      score += revBeat ? 7 : -8;
      bits.push(revBeat ? "revenue also beat" : "revenue missed");
    }
    const it = earnIntelOf(r.symbol);
    if (it && it.trend && hasNum(it.trend.revUp30) && hasNum(it.trend.revDown30)) {
      const net = it.trend.revUp30 - it.trend.revDown30;
      score += clamp(net, -10, 10) * 0.9;
      bits.push(`revisions since: ${net >= 0 ? "+" : ""}${net} net`);
    }
    const weeksBack = Math.max(1, Math.round(daysSince / 7));
    const reaction = pctMoveFrom(d.px && d.px.v || [], weeksBack);
    if (reaction != null) {
      // PEAD needs the initial reaction to CONFIRM the surprise's direction
      score += clamp(reaction * Math.sign(surprise || 1), -8, 8);
      bits.push(`tape since report ${reaction >= 0 ? "+" : ""}${reaction.toFixed(1)}%`);
    }
    score = Math.round(clamp(score, 3, 97));
    const up = surprise >= 0;
    let label, color;
    if (up && score >= 70) { label = "STRONG DRIFT"; color = "var(--green)"; }
    else if (up && score >= 58) { label = "DRIFT CANDIDATE"; color = "var(--cyan)"; }
    else if (!up && score <= 34) { label = "DOWNSIDE DRIFT"; color = "var(--red)"; }
    else { label = "NO CLEAR DRIFT"; color = "var(--amber)"; }
    return { symbol: r.symbol, score, label, color, daysSince, windowLeft: Math.max(0, 60 - daysSince), bits, up };
  }

  /* ------------------- RSI + BEST SETUPS -------------------
     RSI(14) on real daily closes (Wilder smoothing) from the bundled pd:{}
     blocks. A Best Setup = the brain's quality/valuation gate AND the tape
     at a washed-out RSI — great business, fair price, seller exhaustion.
     RSI-oversold on a WEAK business is a falling knife, so the quality
     gate is applied first and the page says so. */
  function rsiOf(d, period = 14) {
    const closes = (d && d.pd && Array.isArray(d.pd.v) ? d.pd.v : []).filter(v => Number.isFinite(v) && v > 0);
    if (closes.length < period + 2) return null;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const ch = closes[i] - closes[i - 1];
      if (ch >= 0) gain += ch; else loss -= ch;
    }
    let avgG = gain / period, avgL = loss / period, prev = null;
    const rsiAt = (g, l) => l === 0 && g === 0 ? 50 : l === 0 ? 100 : g === 0 ? 0 : 100 - 100 / (1 + g / l);
    let value = rsiAt(avgG, avgL);
    for (let i = period + 1; i < closes.length; i++) {
      const ch = closes[i] - closes[i - 1];
      avgG = (avgG * (period - 1) + Math.max(ch, 0)) / period;
      avgL = (avgL * (period - 1) + Math.max(-ch, 0)) / period;
      prev = value;
      value = rsiAt(avgG, avgL);
    }
    return { value: +value.toFixed(1), prev: prev == null ? null : +prev.toFixed(1), asOf: d.pd.to || null, days: closes.length };
  }
  const rsiZone = (v) => v == null ? { label: "n/a", color: "var(--dim)" }
    : v <= 30 ? { label: "OVERSOLD — at the bottom", color: "var(--green)" }
    : v <= 38 ? { label: "washed out", color: "var(--cyan)" }
    : v <= 55 ? { label: "neutral", color: "var(--muted)" }
    : v <= 70 ? { label: "warm", color: "var(--amber)" }
    : { label: "OVERBOUGHT — chasing", color: "var(--red)" };
  function bestSetupsOf() {
    const rows = [];
    for (const d of DATA) {
      const ms = marketScoreOf(d);
      if (!ms || !dataConfidenceOf(d).rankable) continue;
      const bq = ms.businessQuality.score, lt = ms.longTermView.score, val = ms.valuation.score;
      if (bq == null || lt == null || bq < 65 || lt < 55) continue; // quality gate FIRST
      const edge = directionEdgeOf(d);
      if (edge && edge.label === "LIKELY DOWN") continue;
      const r = rsiOf(d);
      const L = ivLadder(d);
      const price = priceOf(d);
      // technical alignment: max points when RSI sits at the bottom on a
      // quality name; crossing back UP through 30 is the classic trigger
      let tech = null, techWhy = "RSI unavailable — daily closes land with the next data refresh";
      if (r) {
        tech = r.value <= 30 ? 100 : r.value <= 35 ? 88 : r.value <= 40 ? 74 : r.value <= 50 ? 56 : r.value <= 60 ? 42 : r.value <= 70 ? 26 : 10;
        if (r.prev != null && r.prev < 30 && r.value >= 30) tech = Math.min(100, tech + 8);
        techWhy = `RSI(14) ${r.value}${r.prev != null && r.prev < 30 && r.value >= 30 ? " — just crossed UP out of oversold (classic trigger)" : " — " + rsiZone(r.value).label}`;
      }
      let pxPos = null, pxWhy = "no IV15 buy target (owner earnings unavailable)";
      if (L && price) {
        const ratio = price / L.IV15;
        pxPos = ratio <= 1 ? 100 : ratio <= 1.1 ? 82 : ratio <= 1.25 ? 62 : ratio <= 1.5 ? 42 : 20;
        pxWhy = ratio <= 1 ? `price $${price.toFixed(0)} is AT/BELOW the IV15 buy target $${L.IV15.toFixed(0)}` : `price is ${((ratio - 1) * 100).toFixed(0)}% above the IV15 buy target $${L.IV15.toFixed(0)}`;
      }
      const parts = [
        { k: "brain", label: "Brain (long-term view)", s: lt, w: 0.30, why: `LTV ${lt} · quality ${bq}` },
        { k: "value", label: "Valuation", s: val, w: 0.16, why: `valuation score ${val ?? "?"}` },
        { k: "rsi", label: "RSI position", s: tech, w: 0.30, why: techWhy },
        { k: "buyzone", label: "Buy-zone proximity", s: pxPos, w: 0.14, why: pxWhy },
        { k: "edge", label: "Direction edge", s: edge ? edge.score : null, w: 0.10, why: edge ? `${edge.label} (${edge.score})` : "edge unavailable" },
      ];
      const used = parts.filter(p => p.s != null);
      const wSum = used.reduce((a, p) => a + p.w, 0);
      const score = wSum ? Math.round(clamp(used.reduce((a, p) => a + p.s * p.w, 0) / wSum, 0, 100)) : null;
      const coverage = Math.round(wSum / parts.reduce((a, p) => a + p.w, 0) * 100);
      const aligned = r != null && r.value <= 38 && bq >= 70 && (pxPos == null || pxPos >= 62);
      rows.push({ d, score, coverage, aligned, rsi: r, edge, L, parts,
        label: aligned ? "PRIME — BRAIN + RSI ALIGNED" : r == null ? "BRAIN ONLY (RSI pending)" : r.value > 65 ? "QUALITY BUT OVERHEATED" : "QUALITY WATCH",
        color: aligned ? "var(--green)" : r == null ? "var(--dim)" : r.value > 65 ? "var(--orange)" : "var(--amber)" });
    }
    return rows.filter(x => x.score != null).sort((a, b) => (b.aligned - a.aligned) || b.score - a.score);
  }

  /* ------------------- SIGNAL CALIBRATION -------------------
     Grades every recorded signal against what prices actually did next.
     Pure function over TRACK_HISTORY snapshots so it is unit-testable.
     Windows overlap (daily snapshots); n counts observations, not
     independent bets — stated in the UI. No verdicts before n >= 20. */
  function calibrationOf(history, horizonDays) {
    const H = Array.isArray(history) ? history : [];
    const groups = {}; // groupKey -> bucket -> {n, hits, sum}
    const rec = (group, bucket, ret) => {
      if (!Number.isFinite(ret)) return;
      const g = groups[group] = groups[group] || {};
      const b = g[bucket] = g[bucket] || { n: 0, hits: 0, sum: 0 };
      b.n++; if (ret > 0) b.hits++; b.sum += ret;
    };
    let windows = 0;
    for (let i = 0; i < H.length; i++) {
      const base = H[i];
      const target = H.find(sn => (Date.parse(sn.date) - Date.parse(base.date)) / 864e5 >= horizonDays);
      if (!target) continue;
      windows++;
      const nowP = {};
      target.entries.forEach(e => { if (e.p > 0) nowP[e.t] = e.p; });
      for (const e of base.entries) {
        if (!(e.p > 0) || !(nowP[e.t] > 0)) continue;
        const ret = (nowP[e.t] / e.p - 1) * 100;
        if (e.dl) rec("Direction Edge", e.dl, ret);
        if (e.bo != null) rec("Beat Odds (report ≤45d)", e.bo >= 68 ? "68+ strong setup" : e.bo >= 40 ? "40–67 mixed" : "<40 miss risk", ret);
        if (e.c && e.c !== "NO_SCORE") rec("Verdict call", e.c, ret);
        if (e.mr != null) rec("Market Reward", e.mr >= 70 ? "70+" : e.mr >= 50 ? "50–69" : "<50", ret);
      }
    }
    const out = { horizonDays, windows, groups: {} };
    for (const [g, buckets] of Object.entries(groups)) {
      out.groups[g] = Object.entries(buckets).map(([bucket, b]) => ({
        bucket, n: b.n, hitRate: b.hits / b.n, avg: b.sum / b.n, judged: b.n >= 20,
      })).sort((a, b) => b.avg - a.avg);
    }
    return out;
  }

  async function loadEarningsIntel(tk) {
    const live = state.live[tk] = state.live[tk] || {};
    if (live.earningsLoading) return;
    if (live.earningsFetchedAt && Date.now() - live.earningsFetchedAt < 10 * 60 * 1000) return;
    const fh = state.keys.finnhub, fmp = state.keys.fmp;
    if (!fh && !fmp) return;
    live.earningsLoading = true;
    live.earningsError = "";
    const tasks = [];
    if (fh) {
      const from = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
      const to = new Date(Date.now() + 180 * 864e5).toISOString().slice(0, 10);
      tasks.push(fetchJsonWithRetry(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${tk}&token=${fh}`, { provider: "Finnhub earnings", ticker: tk })
        .then(j => {
          const rows = (j.earningsCalendar || []).filter(e => !e.symbol || e.symbol === tk)
            .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
          live.earningsCalendar = rows;
        }).catch(() => { live.earningsError = "Finnhub earnings calendar unavailable"; }));
    }
    if (fmp) {
      const get = (period) => fetchJsonWithRetry(`https://financialmodelingprep.com/stable/analyst-estimates?symbol=${tk}&period=${period}&page=0&limit=8&apikey=${fmp}`, { provider: `FMP ${period} estimates`, ticker: tk })
        .then(j => Array.isArray(j) ? j : (Array.isArray(j?.data) ? j.data : []));
      tasks.push(Promise.all([get("annual"), get("quarter")])
        .then(([annual, quarter]) => { live.streetEstimates = { annual, quarter }; })
        .catch(() => { live.estimatesError = "FMP analyst estimates unavailable"; }));
    }
    await Promise.all(tasks);
    live.earningsLoading = false;
    live.earningsFetchedAt = Date.now();
    if (state.active === tk && currentTab === "earnings") render();
  }

  function tabEarnings(d) {
    loadEarningsIntel(d.ticker);
    const live = state.live[d.ticker] || {};
    const calRows = (live.earningsCalendar || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const today = new Date().toISOString().slice(0, 10);
    const nextCal = calRows.find(e => (e.date || "") >= today) || null;
    const lastCal = calRows.filter(e => (e.date || "") < today).slice(-1)[0] || null;
    const annual = cleanEstRows(live.streetEstimates?.annual);
    const quarter = cleanEstRows(live.streetEstimates?.quarter);
    const nextQ = quarter.find(e => !e.date || e.date >= today) || quarter[0] || null;
    const nextFY = annual.find(e => !e.date || e.date >= today) || annual[0] || null;
    const hasQ = !!(d.qd && d.qd.revenue && d.qd.revenue.length);
    const qd = hasQ ? d.qd : null;
    const qLabels = qd ? qd.labels.slice() : [];
    const qRev = qd ? qd.revenue.slice() : [];
    const qEps = qd ? qd.ni.map((n, i) => n == null || !qd.shares[i] ? null : +(n / qd.shares[i]).toFixed(2)) : [];
    const qOwnerEps = qEps.map(v => v == null ? null : +(v * d.ownersKeep).toFixed(2));
    const lastRev = qRev.length ? qRev[qRev.length - 1] : null;
    const lastEps = qEps.length ? qEps[qEps.length - 1] : null;
    const lastOwnerEps = qOwnerEps.length ? qOwnerEps[qOwnerEps.length - 1] : null;
    const ttmRev = qd ? ttm(qd.revenue) : null;
    const revYoy = qd ? yoyPct(qd.revenue) : null;
    const epsYoy = qd ? yoyPct(qEps) : null;
    const bundledIntel = earnIntelOf(d.ticker);
    const streetRev = nextQ?.revAvg ?? revToB(numFrom(nextCal, ["revenueEstimate"])) ?? revToB(bundledIntel?.revEstimate ?? null);
    const streetEps = nextQ?.epsAvg ?? numFrom(nextCal, ["epsEstimate"]) ?? (bundledIntel?.epsEstimate ?? null);
    const fyStreetRev = nextFY?.revAvg;
    const fyStreetEps = nextFY?.epsAvg;
    const qRevGrowthNeed = streetRev != null && lastRev ? (streetRev / lastRev - 1) * 100 : null;
    const fyRevGrowthNeed = fyStreetRev != null && ttmRev ? (fyStreetRev / ttmRev - 1) * 100 : null;
    const epsPremium = streetEps != null && lastOwnerEps ? (streetEps / lastOwnerEps - 1) * 100 : null;
    const L = ivLadder(d);
    const eventDays = nextCal ? daysTo(nextCal.date) : null;
    const riskBits = [];
    let risk = 0;
    if (eventDays != null && eventDays <= 21) { risk += 2; riskBits.push("earnings inside 3 weeks"); }
    if (qRevGrowthNeed != null && revYoy != null && qRevGrowthNeed > revYoy + 8) { risk += 2; riskBits.push("Street revenue asks for acceleration"); }
    if (epsPremium != null && epsPremium > 20) { risk += 2; riskBits.push("Street EPS sits far above owner EPS"); }
    if (d.truePE && d.truePE > 45) { risk += 1; riskBits.push("valuation leaves little room"); }
    if (L && priceOf(d) > L.IV15) { risk += 1; riskBits.push("price is above IV15 buy target"); }
    if (!state.keys.finnhub && !state.keys.fmp) riskBits.push("connect keys for live consensus");
    const riskLabel = risk >= 5 ? "HIGH EXPECTATION RISK" : risk >= 3 ? "MEDIUM EXPECTATION RISK" : "LOWER EXPECTATION RISK";
    const riskColor = risk >= 5 ? "var(--red)" : risk >= 3 ? "var(--orange)" : "var(--green)";
    const cardStat = (label, val, sub, color = "var(--text)") => `<div style="flex:1;min-width:145px">
      <div class="sub">${label}</div><div class="stat sm" style="color:${color}">${val}</div><div class="sub">${sub || ""}</div></div>`;
    const estTable = (rows, title) => rows.length ? `<div class="card">
      <h3>${title} <span class="unit">FMP analyst estimates · not filing facts</span></h3>
      <div style="overflow-x:auto"><table class="fin">
        <tr><th>period</th><th>rev avg</th><th>rev range</th><th>eps avg</th><th>eps range</th><th>analysts</th></tr>
        ${rows.slice(0, 6).map(r => `<tr>
          <td>${r.date || "-"}</td>
          <td>${money(r.revAvg)}</td>
          <td class="sub">${r.revLow != null || r.revHigh != null ? `${money(r.revLow)}-${money(r.revHigh)}` : "-"}</td>
          <td>${fmtDollar(r.epsAvg)}</td>
          <td class="sub">${r.epsLow != null || r.epsHigh != null ? `${fmtDollar(r.epsLow)}-${fmtDollar(r.epsHigh)}` : "-"}</td>
          <td class="sub">${r.analystsRev || r.analystsEps || "-"}</td>
        </tr>`).join("")}
      </table></div>
    </div>` : "";
    const revChartVals = streetRev != null ? qRev.concat([streetRev]) : qRev;
    const revChartLabels = streetRev != null ? qLabels.concat(["Street"]) : qLabels;
    const epsChartVals = streetEps != null ? qEps.concat([streetEps]) : qEps;
    const epsOwnerVals = streetEps != null ? qOwnerEps.concat([null]) : qOwnerEps;
    const epsChartLabels = streetEps != null ? qLabels.concat(["Street"]) : qLabels;
    const keyNote = !state.keys.finnhub && !state.keys.fmp
      ? `<div class="note callout" style="margin-bottom:12px">Connect Finnhub/FMP keys with the gear to unlock live earnings dates, EPS estimates, revenue estimates and analyst forecast tables. Offline, this tab uses the bundled quarterly filing trend only.</div>`
      : live.earningsLoading ? `<div class="note" style="margin-bottom:12px">Loading live Street estimates...</div>`
      : "";
    const odds = beatOddsOf(d);
    const intel = odds.intel;
    const intelNext = intel && intel.nextDate && intel.nextDate >= new Date().toISOString().slice(0, 10) ? intel.nextDate : null;
    const beatHistRows = (intel && intel.history || []).slice(-4).reverse();
    const oddsCard = `<div class="card edge-card" style="grid-column:span 3;border-left:3px solid ${odds.color}">
      <h3>BEAT ODDS <span class="unit">will they clear the Street's bar next report? research signal, not a probability · coverage ${odds.coverage}%</span></h3>
      <div class="edge-hero">
        <div class="edge-score" style="color:${odds.color}">${odds.score == null ? "--" : odds.score}<small>${odds.label}</small></div>
        <div>
          <div class="note" style="border-left-color:${odds.color}">${odds.drivers.length ? odds.drivers.map(p => `<b style="color:${scoreColorOf(p.score)}">${p.label} ${Math.round(p.score)}</b> — ${escapeHtml(p.why)}`).join("<br>") : "Not enough bundled data yet — the daily pipeline fills beat history and revision tape."}</div>
          ${beatHistRows.length ? `<div style="overflow-x:auto;margin-top:8px"><table class="fin">
            <tr><th style="text-align:left">FISCAL QTR</th><th>EPS ACTUAL</th><th>EPS EST</th><th>SURPRISE</th><th>RESULT</th></tr>
            ${beatHistRows.map(h => `<tr><td>${h.quarter || "-"}</td><td>${h.epsActual != null ? "$" + h.epsActual.toFixed(2) : "–"}</td><td>${h.epsEstimate != null ? "$" + h.epsEstimate.toFixed(2) : "–"}</td>
              <td class="${(h.surprisePct ?? 0) >= 0 ? "up" : "down"}">${h.surprisePct != null ? (h.surprisePct >= 0 ? "+" : "") + h.surprisePct.toFixed(1) + "%" : "–"}</td>
              <td>${h.epsActual != null && h.epsEstimate != null ? (h.epsActual > h.epsEstimate ? `<b style="color:var(--green)">BEAT</b>` : h.epsActual < h.epsEstimate ? `<b style="color:var(--red)">MISS</b>` : `<b style="color:var(--amber)">IN-LINE</b>`) : "–"}</td></tr>`).join("")}
          </table></div>` : ""}
        </div>
      </div>
      <div class="edge-grid">${odds.parts.map(p => `<div class="edge-part ${p.score == null ? "missing" : ""}">
        <span>${escapeHtml(p.label)}</span>
        <b style="color:${scoreColorOf(p.score)}">${p.score == null ? "--" : Math.round(p.score)}</b>
        <small>${escapeHtml(p.why).slice(0, 120)}</small>
      </div>`).join("")}</div>
    </div>`;
    return `${keyNote}
    <div class="grid g3">
      ${oddsCard}
      <div class="card" style="grid-column:span 2;border-left:3px solid ${riskColor}">
        <h3>EARNINGS SETUP <span class="unit">consensus vs actual trend</span></h3>
        <div style="display:flex;flex-wrap:wrap;gap:14px">
          ${cardStat("Next report", nextCal ? shortDate(nextCal.date) : intelNext ? shortDate(intelNext) : "-",
            nextCal ? `${eventDays} days · ${nextCal.hour || "time n/a"} · Finnhub` : intelNext ? `${daysTo(intelNext)} days · bundled pipeline${intel.nextDateEstimate ? " · provider-estimated" : ""}` : "connect Finnhub or wait for the pipeline")}
          ${cardStat("Street next EPS", streetEps != null ? fmtDollar(streetEps) : "-", epsPremium != null ? `${epsPremium >= 0 ? "+" : ""}${epsPremium.toFixed(0)}% vs latest owner EPS` : "consensus / non-GAAP", epsPremium != null && epsPremium > 20 ? "var(--orange)" : "var(--text)")}
          ${cardStat("Street next revenue", streetRev != null ? money(streetRev) : "-", qRevGrowthNeed != null ? `${qRevGrowthNeed >= 0 ? "+" : ""}${qRevGrowthNeed.toFixed(1)}% vs latest qtr` : "consensus revenue")}
          ${cardStat("FY street revenue", fyStreetRev != null ? money(fyStreetRev) : "-", fyRevGrowthNeed != null ? `${fyRevGrowthNeed >= 0 ? "+" : ""}${fyRevGrowthNeed.toFixed(1)}% vs TTM` : "annual consensus")}
        </div>
        <div class="note" style="margin-top:12px;border-left-color:${riskColor}">
          <b style="color:${riskColor}">${riskLabel}.</b> ${riskBits.length ? riskBits.join(" · ") : "Street bar looks reachable against the recent trend."}
        </div>
      </div>
      <div class="card">
        <h3>WHAT HAS TO HAPPEN</h3>
        <div class="kv"><span class="k">Recent revenue YoY</span><span class="v ${revYoy == null ? "" : revYoy >= 0 ? "up" : "down"}">${pct(revYoy)}</span></div>
        <div class="kv"><span class="k">Street qtr rev ask</span><span class="v">${pct(qRevGrowthNeed)}</span></div>
        <div class="kv"><span class="k">Recent EPS YoY</span><span class="v ${epsYoy == null ? "" : epsYoy >= 0 ? "up" : "down"}">${pct(epsYoy)}</span></div>
        <div class="kv"><span class="k">Latest owner EPS</span><span class="v">${fmtDollar(lastOwnerEps)}</span></div>
        <div class="kv"><span class="k">SBC / revenue</span><span class="v" style="color:${sbcSeverity(d.sbcPctRev).c}">${pct(d.sbcPctRev)}</span></div>
        <div class="sub" style="margin-top:8px">If the Street EPS beat comes from adding SBC back while shares keep rising, it is not a clean beat in this framework.</div>
      </div>
      <div class="card" style="grid-column:span 2">
        <h3>REVENUE: ACTUAL QUARTERS vs STREET <span class="unit">$B · estimate is provider consensus</span></h3>
        ${revChartVals.length ? Chart.bars([{ name: "Revenue", values: revChartVals, color: "var(--cyan)" }], revChartLabels, { h: 180 }) : `<div class="sub">No quarterly revenue trend bundled.</div>`}
      </div>
      <div class="card">
        <h3>EPS: GAAP vs OWNER vs STREET</h3>
        ${epsChartVals.length ? Chart.bars([
          { name: "GAAP EPS", values: epsChartVals, color: "var(--green)" },
          { name: "Owner EPS", values: epsOwnerVals, color: "var(--amber)" }
        ], epsChartLabels, { h: 180 }) : `<div class="sub">No quarterly EPS trend bundled.</div>`}
        <div class="chart-legend"><span><i style="background:var(--green)"></i>GAAP / Street EPS</span><span><i style="background:var(--amber)"></i>SBC-adj owner EPS</span></div>
      </div>
      <div class="card">
        <h3>LAST REPORTED RESULT <span class="unit">${lastCal ? "Finnhub" : "filing trend"}</span></h3>
        <div class="kv"><span class="k">Report date</span><span class="v">${lastCal ? shortDate(lastCal.date) : qLabels[qLabels.length - 1] || "-"}</span></div>
        <div class="kv"><span class="k">Actual EPS</span><span class="v">${fmtDollar(numFrom(lastCal, ["epsActual"]) ?? lastEps)}</span></div>
        <div class="kv"><span class="k">Estimate EPS</span><span class="v">${fmtDollar(numFrom(lastCal, ["epsEstimate"]))}</span></div>
        <div class="kv"><span class="k">Actual revenue</span><span class="v">${fmtRevEst(numFrom(lastCal, ["revenueActual"]) ?? lastRev)}</span></div>
        <div class="kv"><span class="k">Estimate revenue</span><span class="v">${fmtRevEst(numFrom(lastCal, ["revenueEstimate"]))}</span></div>
      </div>
      ${estTable(quarter, "QUARTERLY STREET ESTIMATES")}
      ${estTable(annual, "ANNUAL STREET ESTIMATES")}
      <div class="card" style="grid-column:span 3">
        <h3>SOURCE DISCIPLINE</h3>
        <div class="sub">Earnings dates and EPS/revenue estimate fields come from live market-data providers when keys are connected. They are <b>Street consensus / non-GAAP expectation data</b>, not SEC filing facts. Filing history, SBC burden, share count and owner EPS come from the terminal's bundled filing/SEC layer.</div>
      </div>
    </div>`;
  }


  const NEWS_RULES = [
    {
      id: "compute-resale", narrative: "AI compute supply hits the market", score: -72,
      industries: ["Semis/AI", "Neocloud", "AI Infrastructure"], tickers: ["NVDA", "AMD", "AVGO", "MRVL", "ARM", "SMCI", "CRWV", "NBIS", "IREN", "ANET", "ASML", "AMAT", "LRCX"],
      why: "extra compute supply can pressure GPU scarcity, cloud pricing and the AI capex story",
      patterns: [/\b(sell|selling|resell|rent|lease|offer|market)\b.*\b(compute|gpu|ai capacity|data center capacity)\b/i, /\b(excess|unused|spare|surplus)\b.*\b(compute|gpu|ai capacity)\b/i]
    },
    {
      id: "ai-capex-up", narrative: "AI capex wave accelerating", score: 58,
      industries: ["Semis/AI", "Semi Equip", "Neocloud", "Power/Data Centers"], tickers: ["NVDA", "AVGO", "AMD", "ASML", "AMAT", "LRCX", "KLAC", "SMCI", "CRWV", "NBIS", "IREN", "ANET"],
      why: "more data-center and GPU spending supports the upstream AI infrastructure chain",
      patterns: [/\b(raise|boost|increase|accelerate|expand|spend|invest|build)\b.*\b(ai|gpu|data center|datacenter|compute|capex|capital expenditure)\b/i, /\b(gpu|ai chip|accelerator)\b.*\b(order|orders|demand|shortage|sold out)\b/i]
    },
    {
      id: "ai-capex-cut", narrative: "AI capex digestion risk", score: -64,
      industries: ["Semis/AI", "Semi Equip", "Neocloud", "AI Infrastructure"], tickers: ["NVDA", "AMD", "AVGO", "ASML", "AMAT", "LRCX", "KLAC", "SMCI", "CRWV", "NBIS", "IREN", "ANET"],
      why: "capex delays or digestion break the extrapolation that every AI supplier keeps compounding",
      patterns: [/\b(cut|cuts|reduce|pause|delay|defer|cancel|slow|digest)\b.*\b(ai|gpu|data center|datacenter|compute|capex|capital expenditure)\b/i]
    },
    {
      id: "export-controls", narrative: "Export-control shock", score: -55,
      industries: ["Semis/AI", "Semi Equip"], tickers: ["NVDA", "AMD", "ASML", "AMAT", "LRCX", "KLAC", "QCOM", "MRVL"],
      why: "new restrictions can remove revenue, raise compliance risk and compress multiples",
      patterns: [/\b(export control|export ban|china restriction|license requirement|entity list|sanction)\b/i]
    },
    {
      id: "guidance-up", narrative: "Fundamental bar lifted", score: 48,
      industries: ["Company / peers"], tickers: [],
      why: "guidance raises move the benchmark that investors will compare future quarters against",
      patterns: [/\b(raise|raises|raised|boost|lifts|increase)\b.*\b(guidance|outlook|forecast|revenue|eps|profit)\b/i, /\b(beat|beats|tops|exceeds)\b.*\b(estimates|expectations|consensus)\b/i]
    },
    {
      id: "guidance-down", narrative: "Earnings revision risk", score: -58,
      industries: ["Company / peers"], tickers: [],
      why: "guide-downs and misses often matter more than valuation screens in the next trading window",
      patterns: [/\b(cut|cuts|lower|lowers|slashed|miss|misses|below)\b.*\b(guidance|outlook|forecast|revenue|eps|profit|estimates|consensus)\b/i]
    },
    {
      id: "regulatory", narrative: "Regulatory overhang", score: -42,
      industries: ["Mega-cap platforms", "Payments", "AI platforms"], tickers: ["AAPL", "GOOGL", "META", "AMZN", "MSFT", "V", "MA", "PYPL", "COIN", "HOOD"],
      why: "antitrust, privacy and platform rules can cap margins or force model changes",
      patterns: [/\b(antitrust|doj|ftc|eu probe|probe|investigation|lawsuit|privacy|fine|regulator|regulatory)\b/i]
    },
    {
      id: "buyback", narrative: "Capital return headline", score: 22,
      industries: ["Shareholder yield"], tickers: [],
      why: "buybacks only matter if they reduce the share count and are done below intrinsic value",
      patterns: [/\b(buyback|repurchase|share repurchase|dividend|capital return)\b/i]
    },
    {
      id: "cost-cut", narrative: "Margin defense / growth question", score: 14,
      industries: ["Operating leverage"], tickers: [],
      why: "cost cuts can help margins, but they may also signal weaker demand",
      patterns: [/\b(layoff|layoffs|job cuts|restructuring|cost cuts|cost reduction|efficiency)\b/i]
    },
    {
      id: "deal", narrative: "Demand validation", score: 34,
      industries: ["Company / suppliers"], tickers: [],
      why: "large deals and partnerships can validate demand, but only if they convert to revenue and cash",
      patterns: [/\b(partnership|contract|deal|customer win|agreement|strategic alliance)\b/i]
    }
  ];

  const impactColor = (s) => s >= 35 ? "var(--green)" : s <= -35 ? "var(--red)" : Math.abs(s) >= 15 ? "var(--amber)" : "var(--muted)";
  const impactTone = (s) => s >= 35 ? "BULLISH" : s <= -35 ? "BEARISH" : Math.abs(s) >= 15 ? "WATCH" : "LOW SIGNAL";
  function analyzeNews(n, sourceTicker) {
    const d = DATA.find(x => x.ticker === sourceTicker);
    const text = `${n.headline || n.title || ""} ${n.summary || n.description || ""}`;
    const matches = [];
    let score = 0;
    const industries = new Set(d ? [d.sector] : []);
    const tickers = new Set(sourceTicker ? [sourceTicker] : []);
    NEWS_RULES.forEach(rule => {
      if (rule.patterns.some(rx => rx.test(text))) {
        matches.push(rule);
        score += rule.score;
        rule.industries.forEach(x => industries.add(x));
        rule.tickers.forEach(x => tickers.add(x));
      }
    });
    score = Math.max(-100, Math.min(100, Math.round(score)));
    const main = matches[0] || { narrative: "Company headline", why: "not enough structured signal for a sector call", industries: [], tickers: [] };
    return {
      ticker: sourceTicker,
      headline: n.headline || n.title || "",
      summary: n.summary || "",
      url: n.url || "",
      source: n.source || "",
      datetime: n.datetime || 0,
      score,
      tone: impactTone(score),
      color: impactColor(score),
      narrative: main.narrative,
      why: matches.length ? matches.map(m => m.why).join(" · ") : main.why,
      industries: [...industries].slice(0, 6),
      tickers: [...tickers].filter(Boolean).slice(0, 12),
      tags: matches.map(m => m.id)
    };
  }
  const analyzedNewsForTicker = (tk) => ((state.live[tk] && state.live[tk].news) || [])
    .map(n => analyzeNews(n, tk))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || (b.datetime || 0) - (a.datetime || 0));

  function impactTickerChips(tickers) {
    return tickers.map(tk => `<span class="impact-chip impact-tk" data-news-tk="${tk}">${tk}</span>`).join("");
  }
  function newsAnalysisRow(a) {
    const dt = a.datetime ? new Date(a.datetime * 1000).toLocaleString() : "";
    return `<div class="news-impact-grid">
      <div class="impact-score" style="color:${a.color}">${a.score > 0 ? "+" : ""}${a.score}<small>${a.tone}</small></div>
      <div>
        <div class="nt">${escapeHtml(a.headline)}</div>
        <div class="nm"><span class="news-src">${escapeHtml(a.source)}</span>${dt ? " · " + dt : ""} · ${escapeHtml(a.narrative)}</div>
        <div style="margin-top:5px">${a.industries.map(x => `<span class="impact-chip hot">${escapeHtml(x)}</span>`).join("")}</div>
      </div>
      <div style="text-align:right;min-width:130px">
        <div class="sub">AFFECTED</div>
        <div>${impactTickerChips(a.tickers)}</div>
      </div>
    </div>`;
  }

  function newsBrainCard(d) {
    const rows = analyzedNewsForTicker(d.ticker);
    if (!state.keys.finnhub) {
      return `<div class="card news-impact" style="grid-column:span 3">
        <h3>NEWS BRAIN — NARRATIVE IMPACT SCORER <span class="unit">connect Finnhub for live headlines</span></h3>
        <div class="note" style="border-left-color:var(--cyan)">When news hits, this card scores the headline, tags the affected industry, and turns it into a trading narrative. Example rule: if META sells or leases excess AI compute, the terminal flags <b>AI compute supply hits the market</b> and marks semis/neocloud names like NVDA, SMCI, CRWV, NBIS and IREN as affected.</div>
      </div>`;
    }
    if (!rows.length) {
      return `<div class="card news-impact" style="grid-column:span 3">
        <h3>NEWS BRAIN — ${d.ticker} <span class="unit">live narrative layer</span></h3>
        <div class="sub">No scored headlines loaded yet. Use the live button or reopen this ticker after connecting Finnhub.</div>
      </div>`;
    }
    const top = rows[0];
    return `<div class="card news-impact" style="grid-column:span 3;border-left-color:${top.color}">
      <h3>NEWS BRAIN — ${top.narrative.toUpperCase()} <span class="unit">top live headline · impact score ${top.score > 0 ? "+" : ""}${top.score}</span></h3>
      <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
        <div class="impact-score" style="color:${top.color};min-width:86px">${top.score > 0 ? "+" : ""}${top.score}<small>${top.tone}</small></div>
        <div style="flex:1;min-width:220px">
          <div style="font-size:13px;color:var(--text);font-weight:700">${escapeHtml(top.headline)}</div>
          <div class="sub" style="margin-top:5px">${escapeHtml(top.why)}</div>
          <div style="margin-top:8px">${top.industries.map(x => `<span class="impact-chip hot">${escapeHtml(x)}</span>`).join("")}</div>
        </div>
        <div style="min-width:160px"><div class="sub">AFFECTED STOCKS</div>${impactTickerChips(top.tickers)}</div>
      </div>
      ${rows.slice(1, 3).map(a => `<div class="sub" style="margin-top:8px;color:${a.color}">${a.score > 0 ? "+" : ""}${a.score} · ${escapeHtml(a.narrative)} · ${escapeHtml(a.headline).slice(0, 110)}</div>`).join("")}
    </div>`;
  }

  function tabNews(d) {
    const lv = state.live[d.ticker];
    if (lv?.news?.length) {
      const rows = analyzedNewsForTicker(d.ticker);
      return `${newsBrainCard(d)}
        <div class="card" style="margin-top:12px"><h3>LIVE NEWS ANALYSIS · ${d.ticker} <span class="unit">via Finnhub · model-scored, not investment advice</span></h3>
          ${rows.slice(0, 20).map(a => `<a class="news-item" href="${a.url}" target="_blank" rel="noopener">${newsAnalysisRow(a)}</a>`).join("")}
        </div>`;
    }
    return `${newsBrainCard(d)}<div class="card" style="margin-top:12px">
      <h3>NEWS · ${d.ticker}</h3>
      <div class="note" style="margin:12px 0 10px">Live headlines require a free Finnhub key. Click the ⚙ gear (top-right) to connect — then news for <b>every</b> ticker streams in automatically.</div>
      <div class="sub">While disconnected, use the SBC X-RAY and FINANCIALS tabs — those run entirely on bundled snapshots.</div>
      <div style="margin-top:12px">
        <span class="tag">Check: is any headline about a buyback?</span>
        <span class="tag">If so → did share count actually fall, or just offset SBC?</span>
        <span class="tag">Ignore "adjusted EPS beat" until SBC is x-rayed.</span>
      </div>
    </div>`;
  }

  /* sector-context strip shown on each stock's overview */
  function sectorContextCard(d) {
    const etf = sectorETF(d.sector);
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
          <div class="sub" style="color:${rel >= 0 ? "var(--green)" : "var(--red)"}">${rel >= 0 ? "outperforming S&P" : "lagging S&P"}</div>
        </div>
      </div>
    </div>`;
  }

  /* ============================================================================
     GRAHAM & DODD ENGINE — classic Security Analysis (7th ed.) principles
     Intrinsic value from assets, earning power and dividends; margin of safety;
     net current asset value (net-net); Graham Number; the defensive checklist;
     and the investment-vs-speculation test. Complements the modern IV15 lens.
     ============================================================================ */
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  function grahamOf(d) {
    const g = d.gd;
    if (!g) return null;
    const sh = d.shares && d.shares[d.shares.length - 1];        // billions of shares
    if (!sh) return null;
    const price = state.live[d.ticker]?.quote?.price ?? d.price;
    const eps = d.gaapEPS;
    // --- asset-value anchors (all $B / B shares = $/share) ---
    const bvps = g.eq != null ? g.eq / sh : null;               // book value per share
    const tbvps = g.tbv != null ? g.tbv / sh : null;            // tangible book
    const pb = bvps && bvps > 0 ? price / bvps : null;
    const ptbv = tbvps && tbvps > 0 ? price / tbvps : null;
    // net current asset value (Graham net-net): current assets − ALL liabilities
    const ncav = g.ca != null && g.tl != null ? g.ca - g.tl : null;
    const ncavps = ncav != null ? ncav / sh : null;
    const priceToNcav = ncavps && ncavps > 0 ? price / ncavps : null; // <1 below NCAV, <0.667 deep bargain
    // liquidating value estimate (Graham rule-of-thumb haircuts)
    const liq = (g.cash != null && g.rec != null && g.inv != null && g.tl != null)
      ? (g.cash * 1.0 + g.rec * 0.8 + g.inv * 0.667 + Math.max(0, (g.ta - g.cash - g.rec - g.inv)) * 0.15 - g.tl) : null;
    const liqps = liq != null ? liq / sh : null;
    // --- financial strength ---
    const currentRatio = g.ca != null && g.cl ? g.ca / g.cl : null;
    const workingCap = g.ca != null && g.cl != null ? g.ca - g.cl : null;
    const ltdVsWC = g.ltd != null && workingCap && workingCap > 0 ? g.ltd / workingCap : null;
    const de = g.debt != null && g.eq && g.eq > 0 ? g.debt / g.eq : null;
    // --- Graham Number = √(22.5 × EPS × BVPS)  [22.5 = 15 P/E × 1.5 P/B] ---
    const grahamNumber = eps > 0 && bvps > 0 ? Math.sqrt(22.5 * eps * bvps) : null;
    const grahamMOS = grahamNumber && price > 0 ? (grahamNumber - price) / grahamNumber : null; // >0 = below fair value
    // --- earning power (average earnings over the record, not one year) ---
    const nis = (d.ni || []).filter(v => v != null);
    const avgEps = nis.length && sh ? (nis.reduce((a, v) => a + v, 0) / nis.length) / sh : null;
    const epStable = nis.length >= 3 && nis.every(v => v > 0);
    const epGrowth = nis.length >= 2 && nis[nis.length - 1] > nis[0];
    const earningPowerPE = avgEps && avgEps > 0 ? price / avgEps : null;
    // --- dividends ---
    const divYield = g.divYield ? g.divYield * 100 : (g.divRate && price ? (g.divRate / price) * 100 : 0);
    const paysDiv = (g.divRate || 0) > 0 || (g.divPaid || 0) > 0;
    // --- Graham's defensive 7-point checklist (adapted from Security Analysis) ---
    const checks = [
      { k: "Adequate size", pass: d.mktCap >= 10, detail: money(d.mktCap) + " mkt cap" },
      { k: "Strong financial condition", pass: currentRatio != null ? currentRatio >= 2 : (de != null ? de < 1 : false), detail: currentRatio != null ? "current ratio " + currentRatio.toFixed(2) : (de != null ? "D/E " + de.toFixed(2) : "n/a") },
      { k: "Earnings stability (no deficits)", pass: epStable, detail: epStable ? "positive every year" : "deficit in the record" },
      { k: "Dividend record", pass: paysDiv, detail: paysDiv ? divYield.toFixed(1) + "% yield" : "pays none" },
      { k: "Earnings growth", pass: epGrowth, detail: epGrowth ? "up over the record" : "flat / declining" },
      { k: "Moderate P/E (≤15×)", pass: eps > 0 && d.headlinePE != null && d.headlinePE <= 15, detail: d.headlinePE ? d.headlinePE.toFixed(0) + "×" : "n/m" },
      { k: "Moderate price/book (≤1.5×)", pass: pb != null && pb > 0 && pb <= 1.5, detail: pb ? pb.toFixed(2) + "× book" : "n/a" },
    ];
    const passed = checks.filter(c => c.pass).length;
    // --- investment vs speculation (Ch.4): safety of principal + satisfactory return ---
    const safety = (currentRatio != null ? currentRatio >= 1.5 : (de != null ? de < 1.5 : false)) && epStable;
    const isInvestment = safety && (paysDiv || (avgEps && avgEps > 0));
    // Graham value score 0..100
    const sChk = (passed / 7) * 100;
    const sMOS = grahamMOS == null ? 40 : clamp01((grahamMOS + 0.5) / 1.0) * 100; // -50%→0, +50%→100
    const sFin = currentRatio != null ? clamp01((currentRatio - 1) / 2) * 100 : (de != null ? clamp01((2 - de) / 2) * 100 : 40);
    const netnetBonus = priceToNcav != null && priceToNcav < 1 ? (priceToNcav < 0.667 ? 100 : 70) : 0;
    const score = 0.40 * sChk + 0.30 * sMOS + 0.15 * sFin + 0.15 * netnetBonus;
    return {
      price, eps, bvps, tbvps, pb, ptbv, ncav, ncavps, priceToNcav, liqps,
      currentRatio, workingCap, ltdVsWC, de, grahamNumber, grahamMOS,
      avgEps, epStable, epGrowth, earningPowerPE, divYield, paysDiv,
      checks, passed, isInvestment, score,
      netnet: priceToNcav != null && priceToNcav < 1,
      deepNetnet: priceToNcav != null && priceToNcav < 0.667,
    };
  }

  function tabGraham(d) {
    const G = grahamOf(d);
    if (!G) return `<div class="card"><h3>GRAHAM & DODD ANALYSIS</h3><div class="sub">Balance-sheet data unavailable for ${d.ticker}.</div></div>`;
    const price = G.price;
    const grade = G.passed >= 6 ? "A" : G.passed >= 5 ? "B" : G.passed >= 4 ? "C" : G.passed >= 2 ? "D" : "F";
    const gc = { A: "var(--green)", B: "var(--cyan)", C: "var(--amber)", D: "var(--orange)", F: "var(--red)" }[grade];
    // intrinsic-value anchors bar chart (per share vs price)
    const anchors = [
      { label: "Price", value: price, color: "var(--red)", display: "$" + price.toFixed(2) },
      { label: "Book value", value: G.bvps, color: "var(--cyan)", display: G.bvps ? "$" + G.bvps.toFixed(2) : "–" },
      { label: "Tangible book", value: G.tbvps, color: "#5aa9d6", display: G.tbvps ? "$" + G.tbvps.toFixed(2) : "–" },
      { label: "Net-current-asset", value: G.ncavps, color: "var(--amber)", display: G.ncavps ? "$" + G.ncavps.toFixed(2) : "n/a" },
      { label: "Graham Number", value: G.grahamNumber, color: "var(--green)", display: G.grahamNumber ? "$" + G.grahamNumber.toFixed(2) : "n/m" },
    ].filter(a => a.value != null && a.value > 0);
    const maxA = Math.max(...anchors.map(a => a.value)) * 1.05;

    return `
    <div class="note" style="margin-bottom:12px"><b style="color:var(--cyan)">Graham &amp; Dodd, Security Analysis (7th ed.).</b> Intrinsic value is “that value which is justified by the facts — assets, earnings, dividends, prospects — as distinct from market quotations.” You only need an approximate measure, and a <b>margin of safety</b> between that value and price. This is the classic asset-and-earning-power lens that complements the modern IV15/SBC view. <b>Share-basis caveat:</b> per-share anchors divide by diluted <i>weighted-average</i> shares (aggregator limit), not period-end actual shares — figures can differ a few percent from filing-exact values.</div>

    <div class="grid g3">
      <div class="card" style="grid-column:span 2;border-left:3px solid ${gc}">
        <h3>INTRINSIC-VALUE ANCHORS <span class="unit">per share vs price — where does the market sit?</span></h3>
        ${Chart.hbars(anchors, { max: maxA, labelW: 108 })}
        <div class="sub" style="margin-top:6px">${G.grahamMOS != null
          ? (G.grahamMOS >= 0 ? `Trading <b class="up">${(G.grahamMOS * 100).toFixed(0)}% below</b> the Graham Number — a margin of safety exists on the classic measure.`
            : `Trading <b class="down">${(-G.grahamMOS * 100).toFixed(0)}% above</b> the Graham Number — no classic margin of safety.`)
          : "Graham Number needs positive GAAP earnings and book value — n/m here (typical for growth or loss-making names)."}</div>
      </div>
      <div class="card" style="text-align:center">
        <h3>DEFENSIVE GRADE</h3>
        <div class="grade" style="font-size:34px;width:64px;height:64px;margin:8px auto;color:${gc};border-color:${gc}">${grade}</div>
        <div class="stat sm" style="color:${gc}">${G.passed}/7</div>
        <div class="sub">Graham criteria passed</div>
        <div class="badge" style="display:inline-block;margin-top:8px;color:${G.isInvestment ? "var(--green)" : "var(--red)"};border-color:${G.isInvestment ? "var(--green)" : "var(--red)"}">${G.isInvestment ? "INVESTMENT" : "SPECULATIVE"}</div>
        <div class="sub" style="margin-top:3px">safety of principal + satisfactory return?</div>
      </div>
    </div>

    ${(G.netnet || G.deepNetnet) ? `<div class="note" style="margin-top:12px;border-left-color:var(--green)"><b style="color:var(--green)">★ NET-NET.</b> ${d.ticker} trades at ${(G.priceToNcav * 100).toFixed(0)}% of net current asset value (current assets − all liabilities). ${G.deepNetnet ? "Below Graham's classic two-thirds bargain threshold — the rarest signal in value investing." : "Below NCAV — you're getting the business for less than its liquid assets net of debt."}</div>` : ""}

    <div class="grid g2" style="margin-top:12px">
      <div class="card">
        <h3>THE 7-POINT DEFENSIVE CHECKLIST</h3>
        ${G.checks.map(c => `<div class="kv"><span class="k">${c.pass ? "✅" : "❌"} ${c.k}</span><span class="v" style="color:${c.pass ? "var(--green)" : "var(--muted)"}">${c.detail}</span></div>`).join("")}
      </div>
      <div class="card">
        <h3>FINANCIAL STRENGTH &amp; VALUE RATIOS</h3>
        <div class="kv"><span class="k">Current ratio (want ≥2)</span><span class="v" style="color:${G.currentRatio == null ? "var(--muted)" : G.currentRatio >= 2 ? "var(--green)" : G.currentRatio >= 1.5 ? "var(--amber)" : "var(--red)"}">${G.currentRatio ? G.currentRatio.toFixed(2) : "n/a (financial)"}</span></div>
        <div class="kv"><span class="k">LT debt vs working capital (want &lt;1)</span><span class="v" style="color:${G.ltdVsWC == null ? "var(--muted)" : G.ltdVsWC < 1 ? "var(--green)" : "var(--red)"}">${G.ltdVsWC != null ? G.ltdVsWC.toFixed(2) : "n/a"}</span></div>
        <div class="kv"><span class="k">Debt / equity</span><span class="v" style="color:${G.de == null ? "var(--muted)" : G.de < 1 ? "var(--green)" : G.de < 2 ? "var(--amber)" : "var(--red)"}">${G.de != null ? G.de.toFixed(2) : "–"}</span></div>
        <div class="kv"><span class="k">Price / book</span><span class="v">${G.pb ? G.pb.toFixed(2) + "×" : "n/a"}</span></div>
        <div class="kv"><span class="k">Price / tangible book</span><span class="v">${G.ptbv ? G.ptbv.toFixed(2) + "×" : (G.tbvps <= 0 ? "neg. tangible book" : "n/a")}</span></div>
        <div class="kv"><span class="k">Earning power (avg EPS)</span><span class="v">${G.avgEps ? "$" + G.avgEps.toFixed(2) + " · " + (G.earningPowerPE ? G.earningPowerPE.toFixed(0) + "× avg" : "") : "–"}</span></div>
        <div class="kv"><span class="k">Dividend</span><span class="v" style="color:${G.paysDiv ? "var(--green)" : "var(--muted)"}">${G.paysDiv ? G.divYield.toFixed(2) + "% yield" : "none"}</span></div>
        <div class="kv"><span class="k">Est. liquidating value / sh</span><span class="v">${G.liqps ? "$" + G.liqps.toFixed(2) : "n/a"}</span></div>
      </div>
    </div>

    <div class="card" style="margin-top:12px"><h3>CLASSIC vs MODERN — THE DUAL VERDICT</h3>
      ${(() => {
        const L = ivLadder(d);
        const modern = L ? (L.zone === "fat" ? "FAT PITCH (" + (L.impliedCAGR * 100).toFixed(0) + "%/yr IV15)" : L.zone === "just" ? "JUST OUTSIDE (" + (L.impliedCAGR * 100).toFixed(0) + "%/yr)" : "OUT FIELD (" + (L.impliedCAGR * 100).toFixed(0) + "%/yr)") : "no owner-earnings floor";
        const modernGood = L && L.zone !== "out";
        const classicGood = G.passed >= 5 || G.netnet;
        const agree = modernGood === classicGood;
        return `<div class="verdict">
          <span class="pill ${classicGood ? "g" : "r"}">GRAHAM (classic): ${classicGood ? "passes value tests" : "fails value tests"} — ${G.passed}/7${G.netnet ? ", net-net" : ""}</span>
          <span class="pill ${modernGood ? "g" : "r"}">IV15 (modern): ${modern}</span>
          <span class="pill" style="color:${agree ? "var(--green)" : "var(--amber)"};border-color:${agree ? "rgba(38,208,124,.4)" : "rgba(255,176,0,.4)"}">${agree ? "✓ BOTH LENSES AGREE" : "⚠ LENSES DISAGREE — dig deeper"}</span>
        </div>
        <div class="sub" style="margin-top:8px">${agree
          ? (classicGood ? "Both the classic margin-of-safety screen and the modern owner-earnings DCF like this — the strongest kind of setup." : "Both lenses are cautious — cheap-looking or not, neither the balance sheet nor the cash-flow math supports a buy here.")
          : "Classic and modern disagree. Often this is a high-quality compounder that screens 'expensive' on book value (modern likes it, Graham doesn't), or an asset-cheap but low-growth/declining business (Graham likes it, modern doesn't). Graham himself noted quality can justify paying above simple asset value."}</div>`;
      })()}
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
  function ivLadder(d, override) {
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
    let exit = Q.exit;
    if (override) { if (override.g1 != null) g1 = override.g1; if (override.exit != null) exit = override.exit; }
    const g2 = g1 * 0.6, g3 = Math.min(g2, 0.04);
    // owner-EPS stream for 15 years + exit value on year-15 earnings
    const stream = [];
    let e = E0;
    for (let y = 1; y <= 15; y++) { e *= 1 + (y <= 5 ? g1 : y <= 10 ? g2 : g3); stream.push(e); }
    const FV = e * exit;
    // IVr = full DCF: every year's owner earnings + terminal value, discounted at r
    const iv = (r) => stream.reduce((a, ey, i) => a + ey / Math.pow(1 + r, i + 1), 0) + FV / Math.pow(1 + r, 15);
    const price = state.live[d.ticker]?.quote?.price ?? d.price;
    let impliedCAGR = null; // solve iv(r) = price by bisection
    if (price > 0) {
      let lo = -0.5, hi = 1.0;
      for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; iv(mid) > price ? (lo = mid) : (hi = mid); }
      impliedCAGR = (lo + hi) / 2;
    }
    // ---- GROWTH-CASE (AI-cycle) scenario: same DCF, strictness relaxed ----
    // No quality haircut, growth cap lifted to 35%, exit multiple +3. This is
    // the "what if I'm being too 1940 about this cycle" number — shown next to
    // the conservative one so you see the RANGE, not a single dogma.
    const rawG = (gRecent ?? gCagr ?? 0.06) * 0.6 + (gCagr ?? gRecent ?? 0.06) * 0.4;
    const g1gc = clamp(rawG, 0.02, 0.35), g2gc = g1gc * 0.65, g3gc = 0.04;
    const streamGc = [];
    let egc = E0;
    for (let y = 1; y <= 15; y++) { egc *= 1 + (y <= 5 ? g1gc : y <= 10 ? g2gc : g3gc); streamGc.push(egc); }
    const FVgc = egc * (Q.exit + 3);
    const ivgc = (r) => streamGc.reduce((a, ey, i) => a + ey / Math.pow(1 + r, i + 1), 0) + FVgc / Math.pow(1 + r, 15);
    let gcCAGR = null;
    if (price > 0) {
      let lo = -0.5, hi = 1.2;
      for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; ivgc(mid) > price ? (lo = mid) : (hi = mid); }
      gcCAGR = (lo + hi) / 2;
    }
    return {
      E0, g1, g2, g3, exit, FV, price, impliedCAGR, defG1: clamp(((gRecent ?? gCagr ?? 0.06) * 0.6 + (gCagr ?? gRecent ?? 0.06) * 0.4) * Q.hair, 0.01, d.inflecting ? 0.25 : Q.cap), defExit: Q.exit,
      IV20: iv(0.20), IV18: iv(0.18), IV15: iv(0.15), IV12: iv(0.12), IV10: iv(0.10), IV8: iv(0.08),
      baseline: d.bucket === "clean" ? iv(0.08) : d.bucket === "middle" ? iv(0.09) : iv(0.10),
      zone: impliedCAGR >= 0.15 ? "fat" : impliedCAGR >= 0.10 ? "just" : "out",
      gcCAGR, gcIV15: ivgc(0.15), gcG1: g1gc,
      gcZone: gcCAGR == null ? "out" : gcCAGR >= 0.15 ? "fat" : gcCAGR >= 0.10 ? "just" : "out",
    };
  }
  const ZONE = {
    fat:  { label: "FAT PITCH",     color: "var(--green)", desc: "model-implied 15%+ CAGR over 15y — a scenario, not a promise" },
    just: { label: "JUST OUTSIDE",  color: "var(--amber)", desc: "priced for 10–15% CAGR" },
    out:  { label: "THE OUT FIELD", color: "var(--red)",   desc: "priced for <10% CAGR" },
  };
  function buybackAccretion(d, L) {
    const bb = d.buyback && d.buyback[d.buyback.length - 1];
    if (!bb || bb <= 0.05 || !L) return null;
    const acc = L.price <= L.baseline;
    return { acc, txt: acc
      ? `Buying back BELOW baseline IV ($${L.baseline.toFixed(0)}) — accretive vs TODAY&#39;S model value (not the price actually paid historically).`
      : `Buying back ABOVE baseline IV ($${L.baseline.toFixed(0)}) — pulls shares in but DILUTES intrinsic value per share. The depressing nuance of offsetting SBC at high prices.` };
  }

  const dcfState = {}; // ticker -> {g1, exit} manual override
  function ivLadderCard(d) {
    const ov = dcfState[d.ticker];
    const L = ivLadder(d, ov);
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
          <div class="sub">implied 15-year CAGR · conservative</div>
          <div class="badge" style="color:${z.color};border-color:${z.color};display:inline-block;margin-top:8px">${z.label}</div>
          <div class="sub" style="margin-top:4px">${z.desc}</div>
          ${L.gcCAGR != null ? `<div style="margin-top:10px;padding-top:9px;border-top:1px dashed var(--line)">
            <div class="sub" style="color:#7da2ff;font-weight:700;letter-spacing:.5px">GROWTH-CASE (AI CYCLE)</div>
            <div class="stat sm" style="color:${ZONE[L.gcZone].color}">${(L.gcCAGR * 100).toFixed(1)}%/yr</div>
            <div class="sub">no quality haircut · growth to ${(L.gcG1 * 100).toFixed(0)}% · IV15 $${L.gcIV15.toFixed(L.gcIV15 >= 100 ? 0 : 2)}</div>
            ${L.gcZone !== L.zone ? `<div class="sub" style="margin-top:4px;color:var(--amber)">the two lenses disagree — size the position off the conservative number, decide whether to stay at the table off this one</div>` : ""}
          </div>` : ""}
          ${acc ? `<div class="note ${acc.acc ? "" : "callout"}" style="margin-top:10px;text-align:left;font-size:10.5px">${acc.txt}</div>` : ""}
        </div>
      </div>
      <div style="margin-top:12px;border-top:1px dashed var(--line);padding-top:10px">
        <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center">
          <span class="sub" style="color:var(--amber)">✎ STRESS-TEST YOUR ASSUMPTIONS:</span>
          <label class="sub">growth <b id="dcfG1v">${(L.g1 * 100).toFixed(0)}%</b>
            <input type="range" id="dcfG1" min="0" max="30" value="${(L.g1 * 100).toFixed(0)}" style="vertical-align:middle;width:120px"></label>
          <label class="sub">exit mult <b id="dcfExv">${L.exit}×</b>
            <input type="range" id="dcfEx" min="8" max="35" value="${L.exit}" style="vertical-align:middle;width:120px"></label>
          ${ov ? `<button class="scr-reset" id="dcfReset">reset to model</button>` : ""}
        </div>
      </div>
    </div>`;
  }

  function rankOf(d) {
    const V = verdictOf(d);
    if (V.noRank) return { noRank: true, dataConfidence: V.dataConfidence, composite: null, truePE: null,
      cagr: null, mom: V.mom, zone: "out", call: V.call, C: V.C, thesis: V.thesis };
    return { L: V.L, cagr: V.cagr, truePE: d.truePE || null, mom: V.mom, dataConfidence: V.dataConfidence,
             composite: V.score, zone: V.zone, call: V.call, C: V.C, thesis: V.thesis };
  }
  function thesisOf(d, r) { return r.thesis || ""; }

  const RANK_COLS = [
    { k: "composite", label: "BRAIN SCORE" },
    { k: "call", label: "CALL" },
    { k: "cagr", label: "IMPLIED CAGR" },
    { k: "truePE", label: "EST P/E" },
    { k: "sbcPctRev", label: "SBC/REV" },
    { k: "ownersKeep", label: "OWNER ¢" },
    { k: "graham", label: "GRAHAM /7" },
    { k: "capex", label: "CAPEX EFF" },
    { k: "mom", label: "SEC 3M" },
    { k: "mktCap", label: "MKT CAP" },
  ];
  const rankState = { sort: "longTerm", dir: -1 };

  function renderRankings() {
    const rankCols = [
      { k: "longTerm", label: "LONG TERM" },
      { k: "marketView", label: "MKT REWARD VIEW" },
      { k: "label", label: "LABEL" },
      { k: "businessQuality", label: "BUSINESS" },
      { k: "growthExecution", label: "GROWTH" },
      { k: "marketReward", label: "MKT REWARD" },
      { k: "valuation", label: "VALUATION" },
      { k: "shareholderEconomics", label: "SH ECON" },
      { k: "dataConfidence", label: "DATA" },
      { k: "truePE", label: "EST P/E" },
      { k: "mktCap", label: "MKT CAP" },
    ];
    const allRows = DATA.map(d => ({ d, r: rankOf(d), G: grahamOf(d), X: capexOf(d), m: marketScoreOf(d) }));
    const blocked = allRows.filter(x => x.r.noRank);
    const rows = allRows.filter(x => !x.r.noRank);
    const raw = (o, k) => k === "longTerm" ? o.m?.longTermView?.score
      : k === "marketView" ? o.m?.marketRewardView?.score
      : k === "label" ? o.m?.longTermView?.score
      : ["businessQuality", "growthExecution", "marketReward", "valuation", "shareholderEconomics", "dataConfidence"].includes(k) ? o.m?.[k]?.score
      : k === "truePE" ? o.r.truePE : k === "mktCap" ? o.d.mktCap : o.d[k];
    rows.sort((a, b) => {
      const va = raw(a, rankState.sort), vb = raw(b, rankState.sort);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;   // missing always sinks to the bottom
      if (vb == null) return -1;
      return (va - vb) * rankState.dir;
    });

    // headline cards computed independently of the current table sort
    const byScore = [...rows].sort((a, b) => (b.m?.longTermView?.score || -1) - (a.m?.longTermView?.score || -1));
    const byCagr = [...rows].filter(x => x.r.cagr != null).sort((a, b) => b.r.cagr - a.r.cagr);
    const byCheap = [...rows].filter(x => x.r.truePE).sort((a, b) => a.r.truePE - b.r.truePE);
    const best = byScore[0];
    const fats = rows.filter(x => x.r.zone === "fat").length;

    const th = rankCols.map(c => `<th data-sort="${c.k}" class="${rankState.sort === c.k ? "sorted" : ""}">${c.label}${rankState.sort === c.k ? (rankState.dir < 0 ? " ▾" : " ▴") : ""}</th>`).join("");
    let body = rows.map((x, i) => {
      const d = x.d, r = x.r;
      const zc = { fat: "var(--green)", just: "var(--amber)", out: "var(--red)" }[r.zone];
      const sc = r.composite >= 62 ? "var(--green)" : r.composite >= 48 ? "var(--amber)" : "var(--red)";
      return `<tr data-tk="${d.ticker}">
        <td><span class="rk-num">${i + 1}</span></td>
        <td><span class="rk-tk">${d.ticker}</span> <span class="sub">${d.sector}</span></td>
        <td><span class="rk-score" style="color:${sc}">${r.composite.toFixed(0)}</span></td>
        <td style="color:${r.C.color};font-weight:700;font-size:9.5px">${r.C.label.split(" — ")[0]}</td>
        <td class="${r.cagr == null ? "" : r.cagr >= 0.15 ? "up" : r.cagr < 0.10 ? "down" : ""}" style="${r.cagr != null && r.cagr >= 0.1 && r.cagr < 0.15 ? "color:var(--amber)" : ""}">${r.cagr == null ? "n/m" : (r.cagr * 100).toFixed(1) + "%"}</td>
        <td style="color:var(--amber)">${r.truePE ? r.truePE.toFixed(1) + "x" : "n/m"}</td>
        <td class="${d.sbcPctRev == null ? "" : d.sbcPctRev < 5 ? "up" : d.sbcPctRev >= 15 ? "down" : ""}">${d.sbcPctRev == null ? "–" : d.sbcPctRev.toFixed(1) + "%"}</td>
        <td>${d.ownersKeep ? (d.ownersKeep * 100).toFixed(0) + "¢" : "–"}</td>
        <td class="${x.G == null ? "" : x.G.passed >= 5 ? "up" : x.G.passed <= 2 ? "down" : ""}" style="color:#5aa9d6">${x.G ? x.G.passed + "/7" : "–"}</td>
        <td class="${x.X == null ? "" : x.X.score >= 60 ? "up" : x.X.score < 35 ? "down" : ""}">${x.X ? x.X.score + (x.X.assetLight ? "·AL" : "") : "–"}</td>
        <td class="${r.mom >= 0 ? "up" : "down"}">${r.mom >= 0 ? "+" : ""}${r.mom.toFixed(1)}</td>
        <td class="sub">${money(d.mktCap)}</td>
      </tr>`;
    }).join("");

    const rankCell = (x, k) => {
      const m = x.m;
      if (k === "label") return `<td>${m?.finalLabel?.label || "--"}</td>`;
      if (k === "truePE") return `<td style="color:var(--amber)">${x.r.truePE ? x.r.truePE.toFixed(1) + "x" : "n/m"}</td>`;
      if (k === "mktCap") return `<td class="sub">${money(x.d.mktCap)}</td>`;
      const v = raw(x, k);
      return `<td style="color:${scoreColorOf(v)};font-weight:700">${fmtScore(v)}</td>`;
    };
    body = rows.map((x, i) => `<tr data-tk="${x.d.ticker}">
      <td><span class="rk-num">${i + 1}</span></td>
      <td><span class="rk-tk">${x.d.ticker}</span> <span class="sub">${x.d.sector}</span></td>
      ${rankCols.map(c => rankCell(x, c.k)).join("")}
    </tr>`).join("");

    el("main").innerHTML = `
      <div class="hdr">
        <div>
          <div class="tick" style="color:var(--purple)">⚛ THE BRAIN — MASTER RANKINGS</div>
          <div class="co">every engine votes — SBC x-ray · IV15 DCF · Graham · quality &amp; cash · buyback truth · sector flow → ONE score, ONE call per stock</div>
        </div>
        <div class="spacer"></div>
        <div style="text-align:right">
          <div class="sub">FAT PITCHES</div><div class="stat sm" style="color:var(--green)">${fats}</div>
        </div>
        <div style="text-align:right;border-left:1px solid var(--line);padding-left:14px">
          <div class="sub">RANKED / UNIVERSE</div><div class="stat sm">${rows.length}/${DATA.length}</div>
        </div>
      </div>

      <div class="grid g3" style="margin-bottom:12px">
        <div class="card" style="border-left:3px solid var(--green)"><h3>#1 BY SCORE — ${best ? best.d.ticker : "–"}</h3>
          <div class="stat" style="color:var(--green)">${best ? best.r.composite.toFixed(0) : "–"}<span class="sub" style="font-weight:400">/100</span></div>
          <div class="sub" style="margin-top:4px">${best ? thesisOf(best.d, best.r) : "No companies passed the data-confidence gate."}</div></div>
        <div class="card"><h3>TOP CAGR — ${byCagr[0]?.d.ticker || "–"}</h3>
          <div class="stat" style="color:var(--green)">${byCagr[0] ? (byCagr[0].r.cagr * 100).toFixed(1) + "%" : "–"}<span class="sub" style="font-weight:400">/yr</span></div>
          <div class="sub" style="margin-top:4px">highest IV15 implied 15-year compounded return</div></div>
        <div class="card"><h3>CHEAPEST EST P/E — ${byCheap[0]?.d.ticker || "–"}</h3>
          <div class="stat" style="color:var(--amber)">${byCheap[0] ? byCheap[0].r.truePE.toFixed(1) + "x" : "–"}</div>
          <div class="sub" style="margin-top:4px">${byCheap[0] ? byCheap[0].d.name : ""} — lowest SBC-adjusted multiple</div></div>
      </div>

      <div class="note" style="margin-bottom:12px">
        <b style="color:var(--purple)">The brain score</b> merges every engine's weighted vote: IV15 DCF 25% · SBC x-ray 20% · quality &amp; cash (ROIC + FCF-after-SBC) 20% · Graham 15% · buyback truth 10% · sector flow 10% (+ insiders when live). The CALL column is the one-line conclusion — open any stock to see the full vote breakdown and written thesis on ⚛ THE VERDICT card. Tap a column to re-rank, a row to open.
      </div>

      <div class="note" style="margin-bottom:12px">The official 126-name universe enters the main ranking when owner-earnings can be computed. The DATA column is a separate trust gauge: 80+ means filing-verified, lower scores mean ranked with caution because SEC cross-check coverage is incomplete. If required SBC/share facts are missing, the ticker stays in Not Ranked instead of getting fake numbers.</div>
      <div class="card" style="padding:6px 8px"><div style="overflow-x:auto;max-height:70vh;overflow-y:auto"><table class="rank">
        <thead><tr><th>#</th><th>TICKER · SECTOR</th>${th}</tr></thead>
        <tbody>${body}</tbody>
      </table></div></div>
      ${blocked.length ? `<div class="card" style="padding:6px 8px;margin-top:12px;border-left:3px solid var(--dim)"><h3>NOT RANKED — MORE FILING DATA NEEDED <span class="unit">${blocked.length} names</span></h3><div style="overflow-x:auto"><table class="rank"><thead><tr><th>TICKER</th><th>DATA CONF.</th><th>REASON</th></tr></thead><tbody>${blocked.map(x => `<tr data-tk="${x.d.ticker}"><td><span class="rk-tk">${x.d.ticker}</span> <span class="sub">${x.d.sector}</span></td><td>${x.r.dataConfidence.score}/100</td><td class="sub">${x.r.dataConfidence.reason}</td></tr>`).join("")}</tbody></table></div></div>` : ""}`;

    el("main").querySelectorAll("th[data-sort]").forEach(h => h.onclick = () => {
      const k = h.dataset.sort;
      if (rankState.sort === k) rankState.dir *= -1;
      else { rankState.sort = k; rankState.dir = (k === "truePE" || k === "sbcPctRev") ? 1 : -1; }
      renderRankings();
    });
    el("main").querySelectorAll("tr[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
  }


  /* ============================================================================
     QUALITY / COMPOUNDER + FCF ENGINE (uses qm:{} blocks when present)
     ============================================================================ */
  function qualityOf(d) {
    const g = d.gd, qm = d.qm;
    const sh = lastVal(d.shares);
    const ni = lastVal(d.ni), rev = lastVal(d.revenue), sbc = lastVal(d.sbc);
    const hasCore = ni != null && rev != null && sbc != null;
    const roe = g && g.eq > 0 && ni != null ? (ni / g.eq) * 100 : null;
    const netMargin = rev && ni != null ? (ni / rev) * 100 : null;
    const grossMargin = qm && qm.gross && rev ? (lastVal(qm.gross) / rev) * 100 : null;
    const opMargin = qm && qm.opinc && rev ? (lastVal(qm.opinc) / rev) * 100 : null;
    const investedCap = g ? (g.debt || 0) + (g.eq || 0) - (g.cash || 0) : null;
    const nopat = qm && qm.opinc ? lastVal(qm.opinc) * 0.79 : ni;
    const roic = investedCap && investedCap > 0 && nopat != null ? (nopat / investedCap) * 100 : null;
    const shs = (d.shares || []).filter(x => x != null);
    const shareCAGR = shs.length >= 2 && shs[0] > 0 ? (Math.pow(shs[shs.length - 1] / shs[0], 1 / (shs.length - 1)) - 1) * 100 : null;
    const rv = (d.revenue || []).filter(x => x != null && x > 0);
    const revCAGR = rv.length >= 2 ? (Math.pow(rv[rv.length - 1] / rv[0], 1 / (rv.length - 1)) - 1) * 100 : null;
    const fcf = qm && qm.fcf ? lastVal(qm.fcf) : null;
    const ocf = qm && qm.ocf ? lastVal(qm.ocf) : null;
    const fcfYield = fcf != null && d.mktCap ? (fcf / d.mktCap) * 100 : null;
    const fcfPerShare = fcf != null && sh ? fcf / sh : null;
    const ocfToNi = ocf != null && ni && ni > 0 ? ocf / ni : null;
    const fcfAfterSbc = fcf != null && sbc != null ? fcf - sbc : null;
    const fcfAfterSbcYield = fcfAfterSbc != null && d.mktCap ? (fcfAfterSbc / d.mktCap) * 100 : null;
    const fcfMargin = fcf != null && rev ? (fcf / rev) * 100 : null;
    return { roe, roic, netMargin, grossMargin, opMargin, shareCAGR, revCAGR, fcf, ocf, fcfYield, fcfPerShare, ocfToNi, fcfAfterSbc, fcfAfterSbcYield, fcfMargin, sbc, hasFcf: fcf != null, hasCore, unavailable: !hasCore };
  }

  /* ============================================================================
     CAPEX X-RAY — does revenue justify the spend?
     Built for the AI-capex cycle: the score is incremental annual revenue
     bought per cumulative capex dollar over the filing window. High capex is
     NOT penalized if the revenue shows up (NVDA-style); it is penalized when
     the spend runs far ahead of what it earns (buildout-on-faith).
     ============================================================================ */
  function capexOf(d) {
    const qm = d.qm;
    if (!qm || !qm.capex || !qm.capex.some(v => v != null)) return null;
    const rev = d.revenue || [];
    const lastRev = lastVal(rev), lastCapex = lastVal(qm.capex);
    const lastOcf = qm.ocf ? lastVal(qm.ocf) : null, lastFcf = qm.fcf ? lastVal(qm.fcf) : null;
    if (!lastRev || lastCapex == null) return null;
    const intensity = (lastCapex / lastRev) * 100;                        // capex % of revenue
    const capexToOcf = lastOcf > 0 ? (lastCapex / lastOcf) * 100 : null;  // % of cash flow consumed
    const cV = qm.capex.filter(v => v != null), rV = rev.filter(v => v != null && v > 0);
    const capexGrowth = cV.length >= 2 && cV[0] > 0.02 ? (cV[cV.length - 1] / cV[0] - 1) * 100 : null;
    const revGrowth = rV.length >= 2 ? (rV[rV.length - 1] / rV[0] - 1) * 100 : null;
    // THE SCORE INPUT: $ of new annual revenue per $1 of cumulative capex
    let incRevPerDollar = null;
    const sumCapex = cV.reduce((a, v) => a + v, 0);
    if (rV.length >= 2 && sumCapex > 0.05) incRevPerDollar = (rV[rV.length - 1] - rV[0]) / sumCapex;
    const assetLight = intensity < 4;
    let score;
    if (assetLight) score = incRevPerDollar == null ? 70 : clamp(60 + incRevPerDollar * 20, 55, 95);
    else if (incRevPerDollar == null) score = 40;
    else if (incRevPerDollar <= 0) score = clamp(15 + incRevPerDollar * 30, 0, 15);
    else score = clamp(Math.pow(clamp01(incRevPerDollar / 1.5), 0.6) * 100, 5, 100);
    if (lastFcf != null && lastFcf < 0 && intensity >= 8) score = Math.max(0, score - 18); // buildout eating FCF
    score = Math.round(score);
    let verdict, color;
    if (assetLight) { verdict = "ASSET-LIGHT — capex isn't the story here"; color = "var(--cyan)"; }
    else if (score >= 60) { verdict = "CAPEX BUYING GROWTH — the spend is justified by revenue"; color = "var(--green)"; }
    else if (score >= 35) { verdict = "SPENDING AHEAD OF REVENUE — the buildout has to pay off"; color = "var(--amber)"; }
    else { verdict = "CAPEX BLACK HOLE — the spend is not showing up in revenue"; color = "var(--red)"; }
    return { intensity, capexToOcf, capexGrowth, revGrowth, incRevPerDollar, lastCapex, lastFcf, sumCapex, score, verdict, color, assetLight };
  }

  function capexCard(d) {
    const C = capexOf(d);
    if (!C) return "";
    const labels = fyLabels(d);
    const isRateBase = ["XLU", "XLRE", "XLE"].includes(sectorETF(d.sector));
    const kv = (k, v, color) => `<div class="kv"><span class="k">${k}</span><span class="v" ${color ? `style="color:${color}"` : ""}>${v}</span></div>`;
    return `<div class="card" style="grid-column:span 3;border-left:3px solid ${C.color}">
      <h3>🏗 CAPEX X-RAY — DOES REVENUE JUSTIFY THE SPEND? <span class="unit">latest FY capex ${money(C.lastCapex)} · built for the AI-capex cycle</span></h3>
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:2;min-width:260px">
          ${Chart.bars([
            { name: "Revenue", color: "var(--cyan)", values: d.revenue },
            { name: "Capex", color: "var(--orange)", values: d.qm.capex },
          ], labels, { h: 165 })}
          <div class="chart-legend"><span><i style="background:var(--cyan)"></i>Revenue</span><span><i style="background:var(--orange)"></i>Capex</span></div>
        </div>
        <div style="flex:1;min-width:200px;text-align:center;border-left:1px solid var(--line);padding-left:16px">
          <div class="stat" style="font-size:34px;color:${C.color}">${C.score}</div>
          <div class="sub">CAPEX EFFICIENCY /100</div>
          <div class="badge" style="display:inline-block;margin-top:8px;color:${C.color};border-color:${C.color}">${C.verdict.split(" — ")[0]}</div>
          <div class="sub" style="margin-top:4px">${C.verdict.split(" — ")[1] || ""}</div>
        </div>
        <div style="flex:1;min-width:210px">
          ${kv("Capex % of revenue", C.intensity.toFixed(1) + "%", C.intensity < 4 ? "var(--cyan)" : C.intensity > 20 ? "var(--orange)" : null)}
          ${kv("$1 capex → new annual revenue", C.incRevPerDollar == null ? "n/a" : "$" + C.incRevPerDollar.toFixed(2), C.incRevPerDollar >= 0.8 ? "var(--green)" : C.incRevPerDollar != null && C.incRevPerDollar < 0.2 ? "var(--red)" : null)}
          ${kv("Capex growth (window)", C.capexGrowth == null ? "–" : (C.capexGrowth >= 0 ? "+" : "") + C.capexGrowth.toFixed(0) + "%")}
          ${kv("Revenue growth (window)", C.revGrowth == null ? "–" : (C.revGrowth >= 0 ? "+" : "") + C.revGrowth.toFixed(0) + "%", C.capexGrowth != null && C.revGrowth != null ? (C.revGrowth >= C.capexGrowth ? "var(--green)" : "var(--orange)") : null)}
          ${kv("Capex eats % of cash flow", C.capexToOcf == null ? "–" : C.capexToOcf.toFixed(0) + "%", C.capexToOcf > 80 ? "var(--red)" : null)}
          ${kv("FCF after all of it", C.lastFcf == null ? "–" : money(C.lastFcf), C.lastFcf >= 0 ? "var(--green)" : "var(--red)")}
        </div>
      </div>
      <div class="sub" style="margin-top:8px">Score = new annual revenue per cumulative capex dollar over the filing window. High capex is fine <b>if the revenue shows up</b> — that's the whole question of this AI cycle.${isRateBase ? " Caveat: utilities/REITs/energy spend into a rate base or reserves by design — judge the trend, not the level." : ""}</div>
    </div>`;
  }

  /* small helpers shared by the tool views */
  const fmtPct = (v, d = 1) => v == null || isNaN(v) ? "–" : (v >= 0 ? "" : "") + v.toFixed(d) + "%";
  const cls = (v, good, bad) => v == null ? "" : v >= good ? "up" : v <= bad ? "down" : "";
  const FORMULA_VERSION = "v4.0 (2026-07)";
  const SBC_MODEL_VERSION = "4.0.0"; // bump when any engine formula changes
  // Data-quality per spec: SEC XBRL reconciliation is automated, not a manual
  // line-by-line audit. Retention/owner-earnings remain model estimates.
  //  FILING VERIFIED*    — 5+ core fields match SEC XBRL and no open conflicts
  //  PARTIALLY VERIFIED  — 2+ fields match SEC XBRL, or conflicts/missing fields remain
  //  HEURISTIC           — insufficient SEC comparability; verify before sizing
  const legacyDataQualityOf = (d) => {
    const sv = d.secv;
    const coreConflict = sv ? sv.conflict.filter(c => !["ocf", "capex"].includes(c.k)) : [];
    if (sv && coreConflict.length === 0 && sv.verified.length >= 5)
      return { label: "FILING VERIFIED*", color: "var(--green)",
        tip: `${sv.verified.length} core fields reconciled to SEC XBRL facts (latest: ${sv.latest ? sv.latest.form + " filed " + sv.latest.filed + " · accn " + sv.latest.accn : "n/a"}). *Automated reconciliation within tolerance — see 🧾 DATA AUDIT; not a manual line-by-line audit.` };
    if (sv && sv.verified.length >= 2)
      return { label: "PARTIALLY VERIFIED", color: "var(--amber)",
        tip: `${sv.verified.length} fields matched SEC filings · ${sv.conflict.length} conflicts flagged · ${sv.missing.length} not comparable. See the SEC FILING CHECK card on FINANCIALS.` };
    return { label: "HEURISTIC", color: "var(--dim)", tip: "Insufficient SEC reconciliation — aggregator data + derived fields. Verify before sizing real money." };
  };
  const dataQualityOf = (d) => {
    const sv = d.secv;
    const coreConflict = sv ? sv.conflict.filter(c => !["ocf", "capex"].includes(c.k)) : [];
    const coreVerified = sv ? ["revenue", "netIncome", "sbc", "dilShares"].every(k => sv.verified.some(x => x.k === k)) : false;
    const cashVerified = sv ? ["ocf", "capex"].every(k => sv.verified.some(x => x.k === k)) : false;
    const unresolved = sv ? sv.conflict.length + sv.periodMismatch.length + sv.definitionMismatch.length + sv.unitMismatch.length : 0;
    if (sv && coreVerified && cashVerified && unresolved === 0) {
      return { label: "FULL FILING VERIFIED", color: "var(--green)",
        tip: `${sv.verified.length} fields aligned to exact SEC period-end facts (latest: ${sv.latest ? sv.latest.form + " filed " + sv.latest.filed + " · accn " + sv.latest.accn : "n/a"}).` };
    }
    if (sv && coreVerified && coreConflict.length === 0) {
      return { label: "CORE FILING VERIFIED", color: "var(--cyan)",
        tip: "Core income/share fields align by exact SEC periodEnd. Cash-flow, buyback or supplemental fields may still need review." };
    }
    if (sv && sv.verified.length >= 2) {
      return { label: "PARTIALLY VERIFIED", color: "var(--amber)",
        tip: `${sv.verified.length} fields matched exact SEC periods · ${sv.conflict.length} true conflicts · ${sv.periodMismatch.length} period mismatches · ${sv.missing.length} missing/not comparable.` };
    }
    return { label: "NOT VERIFIED", color: "var(--dim)", tip: "Parser coverage is weak, IFRS/custom-tag mapping may be needed, or public history is insufficient." };
  };
  function dataConfidenceOf(d) {
    const sv = d.secv || { verified: [], conflict: [], missing: [] };
    const dq = dataQualityOf(d);
    const coreConflict = sv.conflict.filter(c => !["ocf", "capex"].includes(c.k));
    const supplementalConflict = sv.conflict.length - coreConflict.length;
    let score = 20 + sv.verified.length * 10
      - coreConflict.length * 24
      - supplementalConflict * 10
      - (sv.periodMismatch || []).length * 7
      - (sv.definitionMismatch || []).length * 5
      - (sv.unitMismatch || []).length * 15
      - sv.missing.length * 3;
    if (dq.label === "FULL FILING VERIFIED") score += 12;
    if (dq.label === "CORE FILING VERIFIED") score += 8;
    if (dq.label === "PARTIALLY VERIFIED") score = Math.min(score, 79);
    if (dq.label === "NOT VERIFIED") score = Math.min(score, 55);
    if (d.dataBlocked) score = Math.min(score, 50);
    score = Math.max(0, Math.min(100, Math.round(score)));
    const hasOwnerValuation = d.ownerEps != null && Number.isFinite(d.ownerEps);
    const rankable = hasOwnerValuation && !d.dataBlocked;
    const reason = rankable
      ? (score >= 80
        ? "Rankable: core filing facts reconcile to SEC and owner-EPS can be computed."
        : "Ranked with caution: owner-EPS can be computed, but filing cross-check coverage is incomplete.")
      : (d.dataBlockReason || "Not ranked: more filing data is needed.");
    return { score, rankable, label: rankable ? (score >= 80 ? "RANKABLE" : "LOW CONFIDENCE RANKED") : "LOW CONFIDENCE", reason };
  }
  refreshMarketScores();
  const toolHeader = (icon, title, sub, right = "") => `<div class="hdr"><div><div class="tick" style="color:var(--cyan)">${icon} ${title}</div><div class="co">${sub}</div></div><div class="spacer"></div>${right}</div>`;

  /* ============================================================================
     ⚛ THE BRAIN — the unified verdict engine
     Every framework in the terminal votes (-2..+2, weighted); the votes merge
     into ONE score, ONE call, ONE written thesis. Rankings, the screener and
     the stock page all read from this — no more separate conclusions.
     ============================================================================ */
  const CALLS = {
    SWING:  { label: "SWING — FAT PITCH",        color: "var(--green)",  desc: "priced for 15%+ owner-earnings returns and quality holds up — the pitch you wait for" },
    ACC:    { label: "ACCUMULATE",               color: "#7dd87d",       desc: "most engines bullish — build the position on weakness" },
    STALK:  { label: "STALK — WAIT FOR PRICE",   color: "var(--amber)",  desc: "great business, wrong price — set the alert and be patient" },
    WATCH:  { label: "WATCH",                    color: "#c9a86a",       desc: "mixed evidence — needs a catalyst or a better price" },
    PASS:   { label: "PASS",                     color: "var(--orange)", desc: "not enough return for the risk — better pitches elsewhere" },
    TRAP:   { label: "VALUE TRAP",               color: "var(--red)",    desc: "screens cheap but the earnings aren't real — the cheapness is the bait" },
    AVOID:  { label: "AVOID — DILUTION MACHINE", color: "var(--red)",    desc: "run for employees, not shareholders — not investable until SBC discipline changes" },
    NOTRANK: { label: "NOT RANKED — MORE FILING DATA NEEDED", color: "var(--dim)", desc: "no precise valuation or final buy/avoid verdict until the source proof is strong enough" },
  };
  function verdictOf(d) {
    const dc = dataConfidenceOf(d);
    const L = ivLadder(d);
    const G = grahamOf(d);
    const Q = qualityOf(d);
    const bq = buybackQuality(d);
    const trend = shareTrend((d.shares || []).filter(v => v != null));
    const etf = sectorETF(d.sector), s = secByT(etf), spy = secByT("SPY");
    const mom = s && spy ? retOver(s, 3) - retOver(spy, 3) : 0;
    const lv = state.live[d.ticker] || {};
    // Missing retention stays missing: it must not read as "keeps 0¢/$".
    const keep = hasNum(d.ownersKeep) ? d.ownersKeep : null;
    const sig = [];
    if (!dc.rankable) {
      const C = CALLS.NOTRANK;
      return {
        score: null, call: "NOTRANK", C,
        sig: [{ k: "DATA CONFIDENCE", w: 100, v: -2, why: `${dc.score}/100 · ${dc.reason}` }],
        bulls: 0, bears: 1,
        thesis: "Not ranked — more filing data is needed. The terminal will not issue a precise valuation or final buy/avoid verdict for this company yet.",
        L: null, G, Q, CX: null, cagr: null, mom, zone: "out",
        noRank: true, noVerdict: true, dataConfidence: dc,
      };
    }

    // 1 · SBC X-Ray — is the earnings dollar real? (w20)
    let v = keep == null ? 0 : keep >= .9 ? 2 : keep >= .8 ? 1 : keep >= .65 ? 0 : keep >= .5 ? -1 : -2;
    sig.push({ k: "SBC X-RAY", w: 20, v, why: `${keep == null ? "retention not computable from filings yet" : `keeps ${(keep * 100).toFixed(0)}¢/$`} · SBC ${d.sbcPctRev == null ? "n/a" : d.sbcPctRev.toFixed(1) + "% of rev"} · shares ${trend.chg >= 0 ? "+" : ""}${(trend.chg || 0).toFixed(1)}% over the record` });

    // 2 · IV15 DCF — what return does today's price offer? (w25)
    // Prices the RANGE, not the dogma: 65% conservative + 35% AI-cycle growth
    // case. Strictness still dominates, but a strong growth case is evidence.
    const consCagr = L ? L.impliedCAGR : null;
    const cagr = consCagr == null ? null : (L.gcCAGR != null ? consCagr * 0.65 + L.gcCAGR * 0.35 : consCagr);
    v = cagr == null ? -2 : cagr >= .15 ? 2 : cagr >= .12 ? 1 : cagr >= .09 ? 0 : cagr >= .05 ? -1 : -2;
    sig.push({ k: "IV15 DCF", w: 25, v, why: cagr == null ? "no positive owner earnings to price — Out Field by default" : `conservative ${(consCagr * 100).toFixed(1)}% · growth-case ${L.gcCAGR == null ? "n/a" : (L.gcCAGR * 100).toFixed(1) + "%"} → prices the range at ${(cagr * 100).toFixed(1)}%/yr · IV15 $${L.IV15.toFixed(L.IV15 >= 100 ? 0 : 2)} vs $${L.price.toFixed(2)}` });

    // 3 · Graham — classic asset-value margin of safety (w15)
    if (G) {
      v = G.netnet ? 2 : G.passed >= 6 ? 2 : G.passed >= 5 ? 1 : G.passed >= 4 ? 0 : G.passed >= 3 ? -1 : -2;
      if (G.grahamMOS != null && G.grahamMOS > 0.1 && v < 2) v++;
      const mosTxt = G.grahamMOS == null ? "Graham № n/m" : G.grahamMOS >= 0 ? `${(G.grahamMOS * 100).toFixed(0)}% below Graham №` : `${(-G.grahamMOS * 100).toFixed(0)}% above Graham №`;
      sig.push({ k: "GRAHAM", w: 15, v, why: `${G.passed}/7 defensive${G.netnet ? " · NET-NET" : ""} · ${mosTxt} · ${G.isInvestment ? "investment-grade" : "speculative"}` });
    } else sig.push({ k: "GRAHAM", w: 15, v: 0, why: "balance-sheet data n/a" });

    // 4 · Quality & Cash — does the business earn its keep? (w20)
    // Banks/insurers/REITs: FCF & ROIC are not meaningful (loan books, float,
    // property depreciation distort them) — judge on ROE instead.
    const finSector = etf === "XLF" || etf === "XLRE";
    if (finSector) {
      v = Q.roe == null ? 0 : Q.roe >= 15 ? 2 : Q.roe >= 10 ? 1 : Q.roe >= 7 ? 0 : -1;
      sig.push({ k: "QUALITY & CASH", w: 20, v, why: `ROE ${Q.roe == null ? "n/a" : Q.roe.toFixed(0) + "%"} · FCF/ROIC not meaningful for financials — judged on returns on equity` });
    } else {
      v = Q.roic == null ? 0 : Q.roic >= 20 ? 2 : Q.roic >= 12 ? 1 : Q.roic >= 8 ? 0 : -1;
      if (Q.fcfAfterSbc != null && Q.fcfAfterSbc < 0) v = -2;
      else if (Q.ocfToNi != null && Q.ocfToNi < 0.8 && v > -1) v--;
      sig.push({ k: "QUALITY & CASH", w: 20, v, why: `ROIC ${Q.roic == null ? "n/a" : Q.roic.toFixed(0) + "%"} · FCF-after-SBC ${Q.fcfAfterSbc == null ? "n/a" : money(Q.fcfAfterSbc) + " (" + fmtPct(Q.fcfAfterSbcYield, 1) + " yield)"} · OCF/NI ${Q.ocfToNi ? Q.ocfToNi.toFixed(2) + "×" : "n/a"}` });
    }

    // 5 · Capital return — real buybacks, honest dividends, or a treadmill? (w10)
    const acc = L ? buybackAccretion(d, L) : null;
    const divY = d.gd ? (d.gd.divYield ? d.gd.divYield * 100 : (d.gd.divRate && L && L.price > 0 ? (d.gd.divRate / L.price) * 100 : 0)) : 0;
    let bbWhy;
    if (bq.anti === 0 && bq.real === 0) {
      if (trend.chg > 3) { v = -1; bbWhy = "no buybacks and shares rising — pure dilution"; }
      else if (divY >= 3) { v = 1; bbWhy = `no buybacks but a ${divY.toFixed(1)}% dividend does the returning`; }
      else { v = 0; bbWhy = divY > 0.5 ? `no buybacks · ${divY.toFixed(1)}% dividend — modest capital return` : "no buybacks, no dividend — everything is reinvested (or diluted)"; }
    } else if (bq.real > bq.anti) { v = acc && acc.acc ? 2 : 1; bbWhy = `${bq.t.toLowerCase()}${acc ? (acc.acc ? " · below baseline IV (accretive)" : " · above baseline IV (dilutes IV/share)") : ""}${divY >= 2 ? ` · plus a ${divY.toFixed(1)}% dividend` : ""}`; }
    else { v = -1; bbWhy = `${bq.t.toLowerCase()}${acc ? (acc.acc ? " · below baseline IV (accretive)" : " · above baseline IV (dilutes IV/share)") : ""}`; }
    if (trend.chg > 12) { v = -2; bbWhy += " · count exploding"; }
    sig.push({ k: "CAPITAL RETURN", w: 10, v, why: bbWhy });

    // 6 · Sector flow — is money coming toward this name? (w10)
    v = mom >= 3 ? 2 : mom >= 1 ? 1 : mom >= -1 ? 0 : mom >= -3 ? -1 : -2;
    sig.push({ k: "SECTOR MOMENTUM", w: 10, v, why: `${s ? s.name : d.sector} ${mom >= 0 ? "+" : ""}${mom.toFixed(1)}pp vs S&P over 3M — ${mom >= 1 ? "leading" : mom <= -1 ? "lagging" : "inline"} (price momentum, not fund flow)` });

    // 7 · Capex X-Ray — does revenue justify the spend? (w8, only when capex matters)
    const CX = capexOf(d);
    if (CX && !CX.assetLight) {
      v = CX.score >= 80 ? 2 : CX.score >= 60 ? 1 : CX.score >= 35 ? 0 : CX.score >= 20 ? -1 : -2;
      let cxWhy = `capex ${CX.intensity.toFixed(0)}% of revenue · $1 of capex bought $${CX.incRevPerDollar == null ? "n/a" : CX.incRevPerDollar.toFixed(2)} of new annual revenue · ${CX.verdict.split(" — ")[0]}`;
      const de = d.gd && d.gd.eq > 0 ? (d.gd.debt || 0) / d.gd.eq : null;
      if (CX.score < 35 && de != null && de > 1.5) { v = Math.max(-2, v - 1); cxWhy += ` · and it's debt-funded (D/E ${de.toFixed(1)})`; }
      sig.push({ k: "CAPEX X-RAY", w: 8, v, why: cxWhy });
    }

    // 8 · Insiders — live bonus signal when loaded (w5)
    if (lv.insider) {
      const ins = lv.insider;
      v = ins.net > 0.05 ? 2 : ins.net > 0 ? 1 : ins.net < -1 ? -1 : 0;
      sig.push({ k: "INSIDERS", w: 5, v, why: `${ins.net >= 0 ? "+" : ""}${ins.net.toFixed(2)}M shares net 6M (${ins.buys} buys / ${ins.sells} sells)${v === 2 && L && L.price <= L.IV15 ? " — buying below IV15, the elite signal" : ""}` });
    }

    // ---- merge: one score ----
    const wSum = sig.reduce((a, x) => a + x.w, 0);
    const score = sig.reduce((a, x) => a + x.w * ((x.v + 2) / 4) * 100, 0) / wSum;
    const bulls = sig.filter(x => x.v > 0).length, bears = sig.filter(x => x.v < 0).length;

    // ---- one call (hard rules first, then score) ----
    const sbcV = sig[0].v, ivV = sig[1].v, qV = sig[3].v;
    const looksCheap = (d.truePE && d.truePE < 22) || (G && (G.passed >= 5 || G.netnet));
    let call;
    if (looksCheap && ((keep != null && keep < 0.6) || (!finSector && Q.fcfAfterSbc != null && Q.fcfAfterSbc < 0))) call = "TRAP";
    else if (d.bucket === "tragic" && score < 45) call = "AVOID";
    else if (L && (L.zone === "fat" || (cagr != null && cagr >= 0.15)) && keep != null && keep >= 0.7 && qV >= 0) call = "SWING";
    else if (score >= 62 && ivV >= 0) call = "ACC";
    else if (sbcV >= 1 && qV >= 1 && ivV <= 0) call = "STALK";
    else if (score >= 48) call = "WATCH";
    else call = "PASS";
    const C = CALLS[call];

    // ---- one written thesis ----
    const bits = [];
    bits.push(keep == null ? "Owner retention can't be computed from the filings yet" : keep >= .85 ? `Earnings are real (${(keep * 100).toFixed(0)}¢ of every GAAP dollar reaches owners)` : keep >= .65 ? `Earnings need a ${(100 - keep * 100).toFixed(0)}% SBC haircut` : `Reported earnings are heavily inflated by stock comp (only ${(keep * 100).toFixed(0)}¢/$ real)`);
    bits.push(cagr == null ? "and there's no owner-earnings floor to value it on" : cagr >= .15 ? `today's price pays you ${(cagr * 100).toFixed(0)}%/yr — a genuine fat pitch` : cagr >= .10 ? `the price offers a decent ${(cagr * 100).toFixed(0)}%/yr, just outside the fat-pitch zone` : `the price only offers ${(cagr * 100).toFixed(1)}%/yr — you're paying for the story`);
    if (G) bits.push(G.netnet ? "Graham would buy it below liquidation value" : G.passed >= 5 ? `the classic lens agrees (${G.passed}/7 defensive)` : `the classic lens is unimpressed (${G.passed}/7)`);
    if (Q.roic != null) bits.push(Q.roic >= 15 ? `and at ${Q.roic.toFixed(0)}% ROIC the business earns its keep` : Q.roic < 8 ? `and ${Q.roic.toFixed(0)}% ROIC says capital isn't compounding here` : "");
    if (CX && !CX.assetLight) bits.push(CX.score >= 60 ? `the heavy capex (${CX.intensity.toFixed(0)}% of revenue) is earning its way in` : CX.score < 35 ? `and the capex (${CX.intensity.toFixed(0)}% of revenue) is a black hole revenue hasn't justified yet` : `capex is running ahead of revenue — the buildout is a bet still being proven`);
    const thesis = bits.filter(Boolean).join("; ") + `. ${C.desc.charAt(0).toUpperCase() + C.desc.slice(1)}.`;

    return { score, call, C, sig, bulls, bears, thesis, L, G, Q, CX, cagr, mom, zone: L ? L.zone : "out" };
  }

  function verdictCard(d) {
    const V = verdictOf(d);
    const dq = dataQualityOf(d);
    const sv = d.secv || { verified: [], conflict: [], missing: [] };
    const modelConf = d.keepSource === "computed" ? ((d.qm && d.gd && d.px) ? "MEDIUM-HIGH" : "MEDIUM") : "LOW";
    const modelColor = d.keepSource === "computed" ? ((d.qm && d.gd && d.px) ? "var(--green)" : "var(--amber)") : "var(--red)";
    if (V.noRank) {
      return `<div class="card" style="grid-column:span 3;border:1px solid var(--line)">
        <h3>THE VERDICT — NOT RANKED <span class="unit">data confidence ${V.dataConfidence.score}/100</span></h3>
        <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;margin-top:4px">
          <div style="text-align:center;min-width:170px">
            <div class="stat" style="font-size:28px;color:var(--dim)">Insufficient data</div>
            <div class="sub">No main ranking · no precise valuation · no final buy/avoid verdict</div>
          </div>
          <div class="note" style="flex:1;min-width:260px">${V.dataConfidence.reason}<br>SEC cross-check: <b style="color:${dq.color}">${dq.label}</b> · ${sv.verified.length} matched · ${sv.conflict.length} conflicts · ${sv.missing.length} missing/not comparable.</div>
        </div>
      </div>`;
    }
    const secLine = `${sv.verified.length} SEC-matched field${sv.verified.length === 1 ? "" : "s"} · ${sv.conflict.length} conflict${sv.conflict.length === 1 ? "" : "s"} · ${sv.missing.length} missing/not comparable`;
    const votePill = (v) => {
      const m = { "2": ["▲▲", "var(--green)"], "1": ["▲", "#7dd87d"], "0": ["·", "var(--dim)"], "-1": ["▼", "var(--orange)"], "-2": ["▼▼", "var(--red)"] }[String(v)];
      return `<span style="color:${m[1]};font-weight:800;width:26px;display:inline-block;text-align:center">${m[0]}</span>`;
    };
    const scoreColor = V.score >= 62 ? "var(--green)" : V.score >= 48 ? "var(--amber)" : "var(--red)";
    return `<div class="card" style="grid-column:span 3;border:1px solid ${V.C.color};box-shadow:0 0 18px ${V.C.color.startsWith("var") ? "rgba(255,255,255,.06)" : V.C.color + "33"}">
      <h3>⚛ THE VERDICT — EVERY ENGINE, ONE CONCLUSION <span class="unit">${V.bulls} bullish · ${V.sig.length - V.bulls - V.bears} neutral · ${V.bears} bearish</span></h3>
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;margin-top:4px">
        <div style="text-align:center;min-width:150px">
          <div class="stat" style="font-size:34px;color:${scoreColor}">${Math.max(0, V.score - 6).toFixed(0)}–${Math.min(100, V.score + 6).toFixed(0)}</div>
          <div class="sub">HEURISTIC SCORE BAND /100</div>
          <div class="sub" style="margin-top:4px">MODEL CONFIDENCE: <b style="color:${modelColor}">${modelConf}</b><br>
            SEC CROSS-CHECK: <b style="color:${dq.color}">${dq.label}</b> · ${secLine}<br>
            retention ${d.keepSource === "computed" ? "computed from as-reported data" : "heuristic fallback"} · not itself a filing fact</div>
          <div class="badge" style="display:inline-block;margin-top:9px;font-size:11px;padding:5px 12px;color:${V.C.color};border-color:${V.C.color}">${V.C.label}</div>
        </div>
        <div style="flex:1;min-width:260px">
          ${V.sig.map(x => `<div style="display:grid;grid-template-columns:26px 118px 1fr;gap:8px;align-items:baseline;padding:3px 0;border-bottom:1px dashed rgba(132,158,194,.16)">
            ${votePill(x.v)}<span class="sub" style="font-weight:700;letter-spacing:.5px">${x.k}</span><span class="sub">${x.why}</span></div>`).join("")}
        </div>
      </div>
      <div class="note" style="margin-top:12px;border-left-color:${V.C.color}"><b style="color:${V.C.color}">Thesis:</b> ${V.thesis}</div>
    </div>`;
  }

  function qualityCard(d) {
    const Q = qualityOf(d);
    const kv = (k, v, c) => `<div style="text-align:center;flex:1;min-width:84px"><div class="sub">${k}</div><div class="stat sm" ${c ? `style="color:${c}"` : ""}>${v}</div></div>`;
    const roicC = Q.roic == null ? null : Q.roic >= 15 ? "var(--green)" : Q.roic >= 8 ? "var(--amber)" : "var(--red)";
    const scagrC = Q.shareCAGR == null ? null : Q.shareCAGR < -1 ? "var(--green)" : Q.shareCAGR <= 1 ? "var(--amber)" : "var(--red)";
    return `<div class="card" style="grid-column:span 3"><h3>QUALITY &amp; CASH — IS IT A COMPOUNDER? ${Q.hasFcf ? "" : '<span class="unit">FCF data n/a</span>'}</h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${kv("ROIC", fmtPct(Q.roic, 0), roicC)}
        ${kv("ROE", fmtPct(Q.roe, 0))}
        ${kv("Gross mgn", fmtPct(Q.grossMargin, 0))}
        ${kv("Oper. mgn", fmtPct(Q.opMargin, 0))}
        ${kv("Net mgn", fmtPct(Q.netMargin, 0))}
        ${kv("Rev CAGR", fmtPct(Q.revCAGR, 0))}
        ${kv("Share CAGR", fmtPct(Q.shareCAGR, 1), scagrC)}
        ${kv("FCF yield", fmtPct(Q.fcfYield, 1))}
      </div>
      ${Q.hasFcf ? `<div class="note" style="margin-top:10px">Reported FCF ${money(Q.fcf)} → after treating SBC as the real cash-equivalent cost it is, owner FCF ≈ <b>${money(Q.fcfAfterSbc)}</b> (${fmtPct(Q.fcfAfterSbcYield, 1)} yield). OCF/NI ${Q.ocfToNi ? Q.ocfToNi.toFixed(2) + "×" : "–"} — ${Q.ocfToNi >= 1.1 ? "earnings well-backed by cash" : "watch earnings quality"}. ${Q.shareCAGR != null && Q.shareCAGR < -1 ? "Falling share count + " : ""}${Q.roic != null && Q.roic >= 15 ? "high ROIC = a real compounder." : Q.roic != null && Q.roic < 8 ? "low ROIC — SBC isn't buying great returns." : ""}</div>` : ""}
    </div>`;
  }

  function analystCard(d) {
    if (!state.keys.finnhub) return "";
    const lv = state.live[d.ticker] || {}, a = lv.analyst, ins = lv.insider;
    const L = ivLadder(d), price = priceOf(d);
    const tgt = a && a.targetMean ? (() => { const up = (a.targetMean / price - 1) * 100; return `<div style="flex:1;min-width:130px"><div class="sub">WALL ST TARGET (mean)</div><div class="stat sm">$${a.targetMean.toFixed(0)} <span class="${up >= 0 ? "up" : "down"}" style="font-size:11px">${up >= 0 ? "+" : ""}${up.toFixed(0)}%</span></div><div class="sub">range $${(a.targetLow || 0).toFixed(0)}–$${(a.targetHigh || 0).toFixed(0)}</div></div>`; })()
      : `<div style="flex:1;min-width:130px"><div class="sub">WALL ST TARGET</div><div class="sub" style="margin-top:6px">loading…</div></div>`;
    const iv = L ? `<div style="flex:1;min-width:130px"><div class="sub">YOUR IV15 BUY TARGET</div><div class="stat sm" style="color:var(--amber)">$${L.IV15.toFixed(0)}</div><div class="sub">${price <= L.IV15 ? "below IV15 — buy zone" : "above IV15"}</div></div>` : "";
    const insH = ins ? `<div style="flex:1;min-width:140px"><div class="sub">INSIDER 6M (net)</div><div class="stat sm ${ins.net >= 0 ? "up" : "down"}">${ins.net >= 0 ? "+" : ""}${ins.net.toFixed(2)}M sh</div><div class="sub">${ins.buys} buys · ${ins.sells} sells</div></div>` : "";
    return `<div class="card" style="grid-column:span 3"><h3>WALL STREET vs YOUR INTRINSIC VALUE · INSIDER ACTIVITY <span class="unit">live</span></h3>
      <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start">${tgt}${iv}${insH}</div>
      <div class="sub" style="margin-top:8px">Wall Street targets extrapolate price momentum; your IV15 is a return-based buy price on SBC-adjusted owner earnings. Insiders buying below IV15 is the highest-quality signal.</div>
    </div>`;
  }

  /* analyst rating actions (bundled, keyless) + best-effort stated reason
     from live headlines. The free ratings feed carries firm/from/to only —
     when a matching headline exists it is shown AS the stated reason; when
     none does, the reason is marked unavailable, never invented. */
  const RATING_TIER1 = new Set(["morgan stanley", "goldman sachs", "jpmorgan", "j.p. morgan", "jp morgan",
    "bofa securities", "bank of america", "ubs", "barclays", "citigroup", "citi", "wells fargo",
    "deutsche bank", "evercore isi", "bernstein", "jefferies", "rbc capital", "hsbc"]);
  function ratingReasonFrom(newsRows, r) {
    if (!Array.isArray(newsRows)) return null;
    const firmWord = (r.firm || "").split(" ")[0].toLowerCase();
    const from = Date.parse(r.date) - 4 * 864e5, to = Date.parse(r.date) + 4 * 864e5;
    const hit = newsRows.find(n => {
      const ms = (n.datetime || 0) * 1000;
      if (ms < from || ms > to) return false;
      const txt = `${n.headline || ""} ${n.summary || ""}`.toLowerCase();
      return txt.includes(firmWord) && /upgrad|downgrad|overweight|underweight|outperform|price target|initiat|rating/.test(txt);
    });
    return hit ? { headline: hit.headline, url: hit.url } : null;
  }
  function ratingsTapeCard(d) {
    const ratings = (earnIntelOf(d.ticker)?.ratings || []);
    if (!ratings.length) return "";
    const news = state.live[d.ticker]?.news;
    const row = (r) => {
      const tier1 = RATING_TIER1.has((r.firm || "").toLowerCase());
      const col = r.action === "up" ? "var(--green)" : r.action === "down" ? "var(--red)" : "var(--muted)";
      const verb = r.action === "up" ? "UPGRADE" : r.action === "down" ? "DOWNGRADE" : r.action === "init" ? "NEW COVERAGE" : "MAINTAINED";
      const why = ratingReasonFrom(news, r);
      return `<div style="padding:9px 0;border-bottom:1px solid rgba(132,158,194,.13)">
        <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
          <b style="color:${col}">${verb}</b>
          <b>${escapeHtml(r.firm)}</b>${tier1 ? `<span class="impact-chip hot">TIER-1</span>` : ""}
          <span class="sub">${r.from && r.to ? `${escapeHtml(r.from)} → ${escapeHtml(r.to)}` : escapeHtml(r.to || "")} · ${r.date}</span>
        </div>
        <div class="sub" style="margin-top:3px">${why
          ? `stated reason: ${why.url ? `<a href="${why.url}" target="_blank" rel="noopener" style="color:var(--cyan)">${escapeHtml(why.headline)}</a>` : escapeHtml(why.headline)}`
          : `reasoning not published in the free ratings feed${state.keys.finnhub ? " — no matching headline found" : " — connect a Finnhub key to auto-match the announcing headline"}`}</div>
      </div>`;
    };
    return `<div class="card" style="grid-column:span 3">
      <h3>ANALYST RATING ACTIONS <span class="unit">last 45 days · bundled daily · reasons attached from headlines, never invented</span></h3>
      ${ratings.slice(0, 8).map(row).join("")}
    </div>`;
  }

  /* ------------------------ 📊 CUSTOM SCREENER ------------------------ */
  const screenState = { bucket: "all", zone: "all", gMin: 0, peMax: "", sbcMax: "", capMin: "", sector: "all", favOnly: false, divOnly: false, sort: "composite" };
  function renderScreener() {
    const sectors = [...new Set(DATA.map(d => sectorETF(d.sector)))];
    const S = screenState;
    const rows = DATA.filter(d => {
      if (S.favOnly && !state.favs.has(d.ticker)) return false;
      if (S.bucket !== "all" && d.bucket !== S.bucket) return false;
      if (S.sector !== "all" && sectorETF(d.sector) !== S.sector) return false;
      if (S.capMin && d.mktCap < +S.capMin) return false;
      if (S.sbcMax !== "" && (d.sbcPctRev == null || d.sbcPctRev > +S.sbcMax)) return false;
      if (S.peMax !== "" && (!d.truePE || d.truePE > +S.peMax)) return false;
      const G = grahamOf(d);
      if (S.gMin > 0 && (!G || G.passed < S.gMin)) return false;
      if (S.divOnly && !(G && G.paysDiv)) return false;
      const L = ivLadder(d);
      if (S.zone !== "all" && (!L || L.zone !== S.zone)) return false;
      return true;
    }).map(d => ({ d, r: rankOf(d), G: grahamOf(d) })).filter(x => !x.r.noRank);
    const raw = (o, k) => k === "composite" ? o.r.composite : k === "cagr" ? o.r.cagr : k === "truePE" ? o.r.truePE : k === "graham" ? (o.G ? o.G.passed : null) : o.d[k];
    rows.sort((a, b) => { const va = raw(a, S.sort), vb = raw(b, S.sort); if (va == null) return 1; if (vb == null) return -1; return (vb - va); });

    const sel = (id, val, opts) => `<select data-f="${id}" class="scr-input">${opts.map(o => `<option value="${o[0]}" ${o[0] == val ? "selected" : ""}>${o[1]}</option>`).join("")}</select>`;
    const num = (id, val, ph) => `<input data-f="${id}" class="scr-input" type="number" value="${val}" placeholder="${ph}" style="width:74px" />`;
    const controls = `<div class="scr-bar">
      ${sel("bucket", S.bucket, [["all", "All buckets"], ["clean", "Clean"], ["middle", "Middle"], ["high", "High SBC"], ["tragic", "Tragic"]])}
      ${sel("zone", S.zone, [["all", "Any IV zone"], ["fat", "Fat Pitch"], ["just", "Just Outside"], ["out", "Out Field"]])}
      ${sel("sector", S.sector, [["all", "All sectors"], ...sectors.map(s => [s, s])])}
      ${sel("gMin", S.gMin, [[0, "Graham ≥ any"], [4, "Graham ≥ 4/7"], [5, "Graham ≥ 5/7"], [6, "Graham ≥ 6/7"]])}
      <span class="scr-lbl">Est owner-earnings P/E ≤</span>${num("peMax", S.peMax, "any")}
      <span class="scr-lbl">SBC/rev ≤</span>${num("sbcMax", S.sbcMax, "%")}
      <span class="scr-lbl">Cap ≥</span>${num("capMin", S.capMin, "$B")}
      <label class="scr-chk"><input type="checkbox" data-f="favOnly" ${S.favOnly ? "checked" : ""}/>★ only</label>
      <label class="scr-chk"><input type="checkbox" data-f="divOnly" ${S.divOnly ? "checked" : ""}/>pays div</label>
      <button class="scr-reset" id="scrReset">reset</button>
    </div>`;
    const body = rows.map((x, i) => {
      const d = x.d, r = x.r, sc = r.composite >= 62 ? "var(--green)" : r.composite >= 48 ? "var(--amber)" : "var(--red)";
      return `<tr data-tk="${d.ticker}"><td><span class="rk-num">${i + 1}</span></td>
        <td><span class="rk-tk">${d.ticker}</span> <span class="sub">${d.sector}</span></td>
        <td><b style="color:${sc}">${r.composite.toFixed(0)}</b></td>
        <td class="${r.cagr == null ? "" : r.cagr >= .15 ? "up" : r.cagr < .1 ? "down" : ""}">${r.cagr == null ? "n/m" : (r.cagr * 100).toFixed(1) + "%"}</td>
        <td style="color:var(--amber)">${r.truePE ? r.truePE.toFixed(1) + "x" : "n/m"}</td>
        <td class="${d.sbcPctRev == null ? "" : d.sbcPctRev < 5 ? "up" : d.sbcPctRev >= 15 ? "down" : ""}">${d.sbcPctRev == null ? "–" : d.sbcPctRev.toFixed(1) + "%"}</td>
        <td style="color:#5aa9d6">${x.G ? x.G.passed + "/7" : "–"}</td>
        <td class="sub">${money(d.mktCap)}</td></tr>`;
    }).join("");
    el("main").innerHTML = toolHeader("📊", "CUSTOM SCREENER", "query all " + DATA.length + " names by any combination of the frameworks",
      `<div style="text-align:right"><div class="sub">MATCHES</div><div class="stat sm" style="color:#ff6ec7">${rows.length}</div></div>`)
      + controls
      + `<div class="card" style="padding:6px 8px"><div style="overflow:auto;max-height:66vh"><table class="rank">
        <thead><tr><th>#</th><th>TICKER · SECTOR</th><th>SCORE</th><th>IV CAGR</th><th>EST P/E</th><th>SBC/REV</th><th>GRAHAM</th><th>MKT CAP</th></tr></thead>
        <tbody>${body || `<tr><td colspan="8" style="padding:20px;text-align:center" class="sub">No matches — loosen the filters.</td></tr>`}</tbody></table></div></div>`;
    el("main").querySelectorAll(".scr-input").forEach(inp => inp.onchange = () => { screenState[inp.dataset.f] = inp.value; renderScreener(); });
    el("main").querySelectorAll('input[type=checkbox]').forEach(c => c.onchange = () => { screenState[c.dataset.f] = c.checked; renderScreener(); });
    el("scrReset").onclick = () => { Object.assign(screenState, { bucket: "all", zone: "all", gMin: 0, peMax: "", sbcMax: "", capMin: "", sector: "all", favOnly: false, divOnly: false }); renderScreener(); };
    el("main").querySelectorAll("tr[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
  }

  /* ------------------------ ⚖ COMPARE ------------------------ */
  const compareState = { tickers: ["NVDA", "AMD", "AVGO"] };
  function renderCompare() {
    const picks = compareState.tickers.map(t => DATA.find(d => d.ticker === t)).filter(Boolean);
    const metrics = [
      ["Price", d => "$" + priceOf(d).toFixed(2), null],
      ["Market cap", d => money(d.mktCap), d => d.mktCap],
      ["Bucket", d => d.bucket.toUpperCase(), null],
      ["Mgmt grade", d => d.grade, null],
      ["Headline P/E", d => d.headlinePE ? d.headlinePE.toFixed(1) + "x" : "n/m", d => -(d.headlinePE || 999)],
      ["Est owner-earnings P/E (SBC-adj)", d => d.truePE ? d.truePE.toFixed(1) + "x" : "n/m", d => -(d.truePE || 999)],
      ["IV15 implied CAGR", d => { const L = ivLadder(d); return L ? (L.impliedCAGR * 100).toFixed(1) + "%" : "n/m"; }, d => { const L = ivLadder(d); return L ? L.impliedCAGR : -9; }],
      ["SBC / revenue", d => d.sbcPctRev == null ? "–" : d.sbcPctRev.toFixed(1) + "%", d => d.sbcPctRev == null ? 999 : -d.sbcPctRev],
      ["Owner earnings kept", d => (d.ownersKeep * 100).toFixed(0) + "¢", d => d.ownersKeep],
      ["Graham checklist", d => { const G = grahamOf(d); return G ? G.passed + "/7" : "–"; }, d => { const G = grahamOf(d); return G ? G.passed : -1; }],
      ["ROE", d => fmtPct(qualityOf(d).roe, 0), d => qualityOf(d).roe],
      ["ROIC", d => fmtPct(qualityOf(d).roic, 0), d => qualityOf(d).roic],
      ["Net margin", d => fmtPct(qualityOf(d).netMargin, 0), d => qualityOf(d).netMargin],
      ["FCF yield", d => fmtPct(qualityOf(d).fcfYield, 1), d => qualityOf(d).fcfYield],
      ["Share count 5y CAGR", d => fmtPct(qualityOf(d).shareCAGR, 1), d => { const v = qualityOf(d).shareCAGR; return v == null ? null : -v; }],
      ["Dividend yield", d => { const G = grahamOf(d); return G && G.paysDiv ? G.divYield.toFixed(2) + "%" : "–"; }, d => { const G = grahamOf(d); return G ? G.divYield : 0; }],
    ];
    const best = (m) => { if (!m[2]) return null; let bi = -1, bv = -Infinity; picks.forEach((d, i) => { const v = m[2](d); if (v != null && !isNaN(v) && v > bv) { bv = v; bi = i; } }); return bi; };
    const head = `<tr><th>METRIC</th>${picks.map(d => `<th style="text-align:right"><span class="rk-tk">${d.ticker}</span> <span class="rem" data-rem="${d.ticker}" style="cursor:pointer;color:var(--red)">✕</span></th>`).join("")}</tr>`;
    const body = metrics.map(m => { const bi = best(m); return `<tr><td>${m[0]}</td>${picks.map((d, i) => `<td style="text-align:right;${i === bi ? "color:var(--green);font-weight:700" : ""}">${m[1](d)}</td>`).join("")}</tr>`; }).join("");
    el("main").innerHTML = toolHeader("⚖", "COMPARE", "up to 4 names, head to head — best value in each row highlighted green")
      + `<div class="scr-bar"><input id="cmpAdd" class="scr-input" placeholder="add ticker…" style="width:120px;text-transform:uppercase" />
         <button class="scr-reset" id="cmpAddBtn">+ add</button>
         <span class="sub" style="align-self:center">${picks.length}/4</span></div>
      <div class="card" style="padding:6px 8px"><div style="overflow-x:auto"><table class="rank">
        <thead>${head}</thead><tbody>${body}</tbody></table></div></div>`;
    const add = () => { const t = el("cmpAdd").value.trim().toUpperCase(); if (t && DATA.find(d => d.ticker === t) && !compareState.tickers.includes(t) && compareState.tickers.length < 4) { compareState.tickers.push(t); renderCompare(); } else if (t) flash(DATA.find(d => d.ticker === t) ? "Already added / max 4" : t + " not found", "err"); };
    el("cmpAddBtn").onclick = add;
    el("cmpAdd").onkeydown = (e) => { if (e.key === "Enter") add(); };
    el("main").querySelectorAll("[data-rem]").forEach(x => x.onclick = () => { compareState.tickers = compareState.tickers.filter(t => t !== x.dataset.rem); renderCompare(); });
  }


  /* ------------------------ 💼 PORTFOLIO ------------------------ */
  const usd = (n) => { // raw dollars -> $, K, M, B
    if (n == null || isNaN(n)) return "–";
    const s = n < 0 ? "-" : "", a = Math.abs(n);
    if (a >= 1e9) return s + "$" + (a / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(1) + "K";
    return s + "$" + a.toFixed(0);
  };
  function renderPortfolio() {
    const rows = Object.entries(state.portfolio).map(([tk, p]) => {
      const d = DATA.find(x => x.ticker === tk); if (!d) return null;
      const price = priceOf(d), val = p.shares * price, cost = p.shares * p.cost, pl = val - cost;
      return { d, p, price, val, cost, pl, plPct: cost ? (pl / cost) * 100 : 0 };
    }).filter(Boolean);
    const totVal = rows.reduce((a, r) => a + r.val, 0);
    const totCost = rows.reduce((a, r) => a + r.cost, 0);
    const totPL = totVal - totCost;
    // framework exposure (value-weighted)
    let wKeep = 0, wCagr = 0, wGraham = 0, tragicVal = 0, cagrDen = 0;
    const buckAlloc = { clean: 0, middle: 0, high: 0, tragic: 0 };
    rows.forEach(r => {
      const w = totVal ? r.val / totVal : 0;
      wKeep += w * r.d.ownersKeep;
      const L = ivLadder(r.d); if (L) { wCagr += r.val * L.impliedCAGR; cagrDen += r.val; }
      const G = grahamOf(r.d); if (G) wGraham += w * G.passed;
      if (r.d.bucket === "tragic") tragicVal += r.val;
      buckAlloc[r.d.bucket] += r.val;
    });
    const body = rows.map(r => `<tr data-tk="${r.d.ticker}">
      <td><span class="rk-tk">${r.d.ticker}</span> <span class="sub">${r.d.bucket}</span></td>
      <td>${r.p.shares}</td><td class="sub">$${r.p.cost.toFixed(2)}</td><td>$${r.price.toFixed(2)}</td>
      <td>${usd(r.val)}</td>
      <td class="${r.pl >= 0 ? "up" : "down"}">${r.pl >= 0 ? "+" : ""}${usd(r.pl)}</td>
      <td class="${r.pl >= 0 ? "up" : "down"}">${r.plPct >= 0 ? "+" : ""}${r.plPct.toFixed(1)}%</td>
      <td class="sub">${totVal ? (r.val / totVal * 100).toFixed(0) : 0}%</td>
      <td><span class="rem" data-rem="${r.d.ticker}" style="cursor:pointer;color:var(--red)">✕</span></td></tr>`).join("");
    const bcol = { clean: "var(--green)", middle: "var(--amber)", high: "var(--orange)", tragic: "var(--red)" };
    const allocBar = totVal ? `<div class="seg-track" style="height:14px;display:flex">${["clean", "middle", "high", "tragic"].map(b => buckAlloc[b] ? `<i style="width:${buckAlloc[b] / totVal * 100}%;background:${bcol[b]}" title="${b}"></i>` : "").join("")}</div>` : "";
    el("main").innerHTML = toolHeader("💼", "PORTFOLIO", "your positions x-rayed by the same frameworks — stored only in your browser")
      + `<div class="grid g4" style="margin-bottom:12px">
        <div class="card"><h3>MARKET VALUE</h3><div class="stat">${usd(totVal)}</div></div>
        <div class="card"><h3>TOTAL P&L</h3><div class="stat ${totPL >= 0 ? "up" : "down"}">${totPL >= 0 ? "+" : ""}${usd(totPL)}</div><div class="sub ${totPL >= 0 ? "up" : "down"}">${totCost ? (totPL / totCost * 100).toFixed(1) + "%" : ""}</div></div>
        <div class="card"><h3>OWNER-EARNINGS KEPT <span class="unit">wtd</span></h3><div class="stat" style="color:${wKeep >= .85 ? "var(--green)" : wKeep >= .7 ? "var(--amber)" : "var(--red)"}">${rows.length ? (wKeep * 100).toFixed(0) + "¢" : "–"}</div><div class="sub">per $1 GAAP across the book</div></div>
        <div class="card"><h3>WTD IV15 CAGR · GRAHAM</h3><div class="stat">${cagrDen ? (wCagr / cagrDen * 100).toFixed(1) + "%" : "–"}</div><div class="sub">Graham ${rows.length ? (wGraham).toFixed(1) + "/7 avg" : "–"} · ${totVal ? (tragicVal / totVal * 100).toFixed(0) : 0}% in tragic-tier</div></div>
      </div>
      ${rows.length ? `<div class="card" style="margin-bottom:12px"><h3>QUALITY-BUCKET ALLOCATION</h3>${allocBar}<div class="chart-legend"><span><i style="background:var(--green)"></i>Clean</span><span><i style="background:var(--amber)"></i>Middle</span><span><i style="background:var(--orange)"></i>High</span><span><i style="background:var(--red)"></i>Tragic</span></div></div>` : ""}
      <div class="scr-bar">
        <input id="poTk" class="scr-input" placeholder="ticker" style="width:90px;text-transform:uppercase"/>
        <input id="poSh" class="scr-input" type="number" placeholder="shares" style="width:90px"/>
        <input id="poC" class="scr-input" type="number" placeholder="cost/share" style="width:100px"/>
        <button class="scr-reset" id="poAdd">+ add / update position</button>
      </div>
      <div class="card" style="padding:6px 8px"><div style="overflow-x:auto"><table class="rank">
        <thead><tr><th>TICKER</th><th>SHARES</th><th>COST</th><th>PRICE</th><th>VALUE</th><th>P&L $</th><th>P&L %</th><th>WT</th><th></th></tr></thead>
        <tbody>${body || `<tr><td colspan="9" class="sub" style="padding:20px;text-align:center">No positions yet — add one above. Data stays in your browser.</td></tr>`}</tbody></table></div></div>`;
    el("poAdd").onclick = () => {
      const tk = el("poTk").value.trim().toUpperCase(), sh = +el("poSh").value, c = +el("poC").value;
      if (!DATA.find(d => d.ticker === tk)) return flash(tk + " not in universe", "err");
      if (!sh || sh <= 0) return flash("Enter share count", "err");
      state.portfolio[tk] = { shares: sh, cost: c || priceOf(DATA.find(d => d.ticker === tk)) };
      savePort(); renderPortfolio();
    };
    el("main").querySelectorAll("[data-rem]").forEach(x => x.onclick = (e) => { e.stopPropagation(); delete state.portfolio[x.dataset.rem]; savePort(); renderPortfolio(); });
    el("main").querySelectorAll("tr[data-tk]").forEach(r => r.onclick = (e) => { if (!e.target.dataset.rem) selectTicker(r.dataset.tk); });
  }


  const optDteNow = (o) => o && o.exp ? Math.round((Date.parse(o.exp + "T21:00:00Z") - Date.now()) / 864e5) : null;


  /* ============ 🧾 DATA AUDIT — can this terminal be trusted? ============ */
  function renderAudit() {
    const tiers = { "FULL FILING VERIFIED": 0, "CORE FILING VERIFIED": 0, "PARTIALLY VERIFIED": 0, "NOT VERIFIED": 0 };
    let conflicts = 0, verifiedFields = 0, missingFields = 0;
    const total = DATA.length;
    DATA.forEach(d => {
      const sv = d.secv || { verified: [], conflict: [], missing: [] };
      const label = dataQualityOf(d).label;
      tiers[label] = (tiers[label] || 0) + 1;
      conflicts += sv.conflict.length;
      verifiedFields += sv.verified.length;
      missingFields += sv.missing.length;
    });
    const valuationAudit = DATA.map(d => {
      const dc = dataConfidenceOf(d);
      const impliedHeadlinePE = d.gaapEPS > 0 && d.price ? +(d.price / d.gaapEPS).toFixed(1) : null;
      const flags = [];
      if (impliedHeadlinePE != null && d.headlinePE != null && Math.abs(d.headlinePE - impliedHeadlinePE) > 0.6) flags.push("headline mismatch");
      if (dc.rankable && d.truePE && !/TTM quarterly/.test(d.ownerEpsSource || "")) flags.push("annual basis");
      if (dc.rankable && d.truePE == null && d.ownerEps != null && d.ownerEps <= 0) flags.push("negative owner EPS");
      else if (dc.rankable && d.truePE == null) flags.push("missing owner P/E");
      if (d.truePE != null && d.truePE > 80) flags.push("high owner P/E");
      return { d, dc, impliedHeadlinePE, flags };
    });
    const valCounts = {
      mismatch: valuationAudit.filter(x => x.flags.includes("headline mismatch")).length,
      annual: valuationAudit.filter(x => x.flags.includes("annual basis")).length,
      missing: valuationAudit.filter(x => x.flags.includes("missing owner P/E")).length,
      negative: valuationAudit.filter(x => x.flags.includes("negative owner EPS")).length,
      high: valuationAudit.filter(x => x.flags.includes("high owner P/E")).length,
    };
    const fullyVerified = tiers["FULL FILING VERIFIED"] + tiers["CORE FILING VERIFIED"];
    const atLeastPartial = fullyVerified + tiers["PARTIALLY VERIFIED"];
    const rows = [...DATA].sort((a, b) => a.ticker.localeCompare(b.ticker)).map(d => {
      const q = dataQualityOf(d), sv = d.secv || { verified: [], conflict: [], missing: [], latest: null };
      return `<tr data-tk="${d.ticker}"><td><span class="rk-tk">${d.ticker}</span></td>
        <td style="color:${q.color}">${q.label}</td>
        <td class="sub">${sv.latest && sv.latest.form ? sv.latest.form + " · " + sv.latest.filed : "–"}</td>
        <td class="up">${sv.verified.length}</td>
        <td class="${sv.conflict.length ? "down" : "sub"}">${sv.conflict.length}</td>
        <td class="sub">${sv.missing.length}</td>
        <td class="sub">${d.keepSource === "computed" ? "computed" : "fallback"}</td></tr>`;
    }).join("");
    el("main").innerHTML = toolHeader("🧾", "DATA AUDIT", "provenance, versions and verification status — judge for yourself whether to trust the numbers",
      `<div style="text-align:right"><div class="sub">FILING VERIFIED*</div><div class="stat sm" style="color:var(--green)">${fullyVerified}/${total}</div><div class="sub">${atLeastPartial}/${total} at least partial</div></div>`)
      + `<div class="grid g3" style="margin-bottom:12px">
        <div class="card"><h3>VERSIONS</h3>
          <div class="kv"><span class="k">Official universe</span><span class="v">${typeof UNIVERSE_VERSION !== "undefined" ? UNIVERSE_VERSION : "?"} (${DATA.length} names)</span></div>
          <div class="kv"><span class="k">SBC model</span><span class="v">${SBC_MODEL_VERSION}</span></div>
          <div class="kv"><span class="k">Formulas</span><span class="v">${FORMULA_VERSION}</span></div>
          <div class="kv"><span class="k">SEC data generated</span><span class="v">${typeof SEC_META !== "undefined" ? SEC_META.generated.slice(0, 10) : "n/a"}</span></div></div>
        <div class="card"><h3>VERIFICATION</h3>
          <div class="kv"><span class="k">Full filing verified</span><span class="v up">${tiers["FULL FILING VERIFIED"]}</span></div>
          <div class="kv"><span class="k">Core filing verified</span><span class="v up">${tiers["CORE FILING VERIFIED"]}</span></div>
          <div class="kv"><span class="k">Partially verified</span><span class="v" style="color:var(--amber)">${tiers["PARTIALLY VERIFIED"]}</span></div>
          <div class="kv"><span class="k">Not verified</span><span class="v sub">${tiers["NOT VERIFIED"]}</span></div>
          <div class="kv"><span class="k">SEC-matched fields</span><span class="v up">${verifiedFields}</span></div>
          <div class="kv"><span class="k">Open source conflicts</span><span class="v ${conflicts ? "down" : "up"}">${conflicts}</span></div></div>
        <div class="card"><h3>FRESHNESS</h3>
          <div class="kv"><span class="k">Fundamentals snapshot</span><span class="v">${((DATA[0].snapshot || "").match(/\d{4}-\d{2}-\d{2}/) || ["?"])[0]}</span></div>
          <div class="kv"><span class="k">Regression tests</span><span class="v">node tests/run_tests.js</span></div>
          <button class="scr-reset" id="checkUpdate" style="margin-top:8px">Check for data update</button></div>
        <div class="card"><h3>VALUATION AUDIT</h3>
          <div class="kv"><span class="k">Headline P/E mismatches</span><span class="v ${valCounts.mismatch ? "down" : "up"}">${valCounts.mismatch}</span></div>
          <div class="kv"><span class="k">Annual-basis exceptions</span><span class="v ${valCounts.annual ? "sub" : "up"}">${valCounts.annual}</span></div>
          <div class="kv"><span class="k">Missing owner P/E</span><span class="v ${valCounts.missing ? "down" : "up"}">${valCounts.missing}</span></div>
          <div class="kv"><span class="k">Negative owner EPS</span><span class="v ${valCounts.negative ? "down" : "up"}">${valCounts.negative}</span></div>
          <div class="kv"><span class="k">High owner P/E checks</span><span class="v" style="color:var(--amber)">${valCounts.high}</span></div></div>
      </div>
      <div class="note" style="margin-bottom:12px">*FILING VERIFIED = 5+ core fields automatically reconciled to SEC XBRL facts with no open conflicts. PARTIALLY VERIFIED = at least 2 SEC matches, but conflicts or missing/non-comparable fields remain. This is NOT a manual line-by-line audit. Conflicts are flagged, never silently resolved. Missing SEC facts stay missing — never zero. Current coverage: <b>${fullyVerified}/${total} filing verified*</b>, <b>${atLeastPartial}/${total} at least partially verified</b>, <b>${missingFields}</b> missing/non-comparable field checks.</div>
      <div class="card" style="padding:6px 8px"><div style="overflow-x:auto;max-height:62vh;overflow-y:auto"><table class="rank">
        <thead><tr><th>TICKER</th><th>BADGE</th><th>LATEST FILING</th><th>VERIFIED</th><th>CONFLICTS</th><th>N/A</th><th>RETENTION</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>`;
    el("main").querySelectorAll("tr[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
    const cu = el("checkUpdate");
    if (cu) cu.onclick = () => {
      fetch("sec.js?cb=" + Date.now(), { cache: "no-store" }).then(r => r.text()).then(t => {
        const m = t.match(/"generated": ?"([^"]+)"/);
        if (m && typeof SEC_META !== "undefined" && m[1] !== SEC_META.generated) {
          flash("Newer data available — reloading…", "ok");
          setTimeout(() => location.reload(), 800);
        } else flash("You have the newest data (" + (m ? m[1].slice(0, 10) : "?") + ")", "ok");
      }).catch(() => flash("Update check failed — network?", "err"));
    };
  }
  const showAudit = () => showView("audit", renderAudit, "auditBtn");

  /* ============================================================================
     📈 TRACK RECORD — is the model actually any good?
     Daily brain-score snapshots (scripts/snapshot_scores.js, run by the
     data-refresh workflow) accumulate into an OUT-OF-SAMPLE record. Until the
     record exists, this page says so — the score is a hypothesis, not an edge.
     ============================================================================ */
  function renderTrack() {
    const H = (typeof TRACK_HISTORY !== "undefined") ? TRACK_HISTORY : [];
    const latest = H.length ? H[H.length - 1] : null;
    const first = H.length ? H[0] : null;
    const daysSpan = latest && first ? Math.round((Date.parse(latest.date) - Date.parse(first.date)) / 864e5) : 0;

    let cohortHtml = "";
    if (latest) {
      const sorted = latest.entries.filter(e => e.s != null).sort((a, b) => b.s - a.s);
      const qSize = Math.ceil(sorted.length / 5);
      const qs = [0, 1, 2, 3, 4].map(i => sorted.slice(i * qSize, (i + 1) * qSize));
      cohortHtml = `<div class="card" style="margin-bottom:12px"><h3>TODAY'S COHORTS <span class="unit">snapshot ${latest.date} · these are the bets being recorded</span></h3>
        <div style="overflow-x:auto"><table class="rank"><thead><tr><th>QUINTILE</th><th>AVG SCORE</th><th>NAMES</th><th style="text-align:left">SAMPLE</th></tr></thead><tbody>
        ${qs.map((q, i) => `<tr><td>Q${i + 1}${i === 0 ? " (top)" : i === 4 ? " (bottom)" : ""}</td>
          <td>${(q.reduce((a, x) => a + x.s, 0) / q.length).toFixed(1)}</td><td>${q.length}</td>
          <td style="text-align:left" class="sub">${q.slice(0, 6).map(x => x.t).join(", ")}${q.length > 6 ? "…" : ""}</td></tr>`).join("")}
        </tbody></table></div></div>`;
    }

    let fwdHtml = "";
    const base = H.find(sn => latest && (Date.parse(latest.date) - Date.parse(sn.date)) >= 30 * 864e5);
    if (base && latest && base.date !== latest.date) {
      const nowP = {}; latest.entries.forEach(e => nowP[e.t] = e.p);
      const rows = base.entries.filter(e => e.s != null && e.p > 0 && nowP[e.t] > 0)
        .map(e => ({ ...e, ret: (nowP[e.t] / e.p - 1) * 100 })).sort((a, b) => b.s - a.s);
      const qSize = Math.ceil(rows.length / 5);
      const qs = [0, 1, 2, 3, 4].map(i => rows.slice(i * qSize, (i + 1) * qSize));
      const avg = (arr) => arr.reduce((a, x) => a + x.ret, 0) / Math.max(arr.length, 1);
      const spread = avg(qs[0]) - avg(qs[4]);
      const calls = {};
      rows.forEach(r => { (calls[r.c] = calls[r.c] || []).push(r.ret); });
      fwdHtml = `<div class="card" style="margin-bottom:12px;border-left:3px solid ${spread > 0 ? "var(--green)" : "var(--red)"}">
        <h3>FORWARD RETURNS — ${base.date} → ${latest.date} <span class="unit">${Math.round((Date.parse(latest.date) - Date.parse(base.date)) / 864e5)} days · price return only, no dividends</span></h3>
        <div style="overflow-x:auto"><table class="rank"><thead><tr><th>QUINTILE (by score on ${base.date})</th><th>AVG RETURN</th></tr></thead><tbody>
          ${qs.map((q, i) => `<tr><td>Q${i + 1}</td><td class="${avg(q) >= 0 ? "up" : "down"}">${avg(q) >= 0 ? "+" : ""}${avg(q).toFixed(1)}%</td></tr>`).join("")}
          <tr><td><b>Q1 − Q5 spread (the model's claim)</b></td><td class="${spread > 0 ? "up" : "down"}"><b>${spread >= 0 ? "+" : ""}${spread.toFixed(1)}pp</b></td></tr>
        </tbody></table></div>
        <div style="overflow-x:auto;margin-top:8px"><table class="rank"><thead><tr><th>CALL COHORT</th><th>N</th><th>AVG RETURN</th></tr></thead><tbody>
          ${Object.entries(calls).sort((a, b) => avg(b[1].map(v => ({ ret: v }))) - avg(a[1].map(v => ({ ret: v })))).map(([c, arr]) => { const m = arr.reduce((x, y) => x + y, 0) / arr.length; return `<tr><td>${c}</td><td>${arr.length}</td><td class="${m >= 0 ? "up" : "down"}">${m >= 0 ? "+" : ""}${m.toFixed(1)}%</td></tr>`; }).join("")}
        </tbody></table></div>
        <div class="sub" style="margin-top:8px">One window proves nothing — spreads must persist across many windows before the score deserves capital. Judge after 12 months, not 12 days.</div></div>`;
    } else {
      fwdHtml = `<div class="note" style="margin-bottom:12px;border-left-color:var(--amber)"><b>No forward-return evidence yet.</b> Tracking since <b>${first ? first.date : "today"}</b> (${H.length} snapshot${H.length === 1 ? "" : "s"}, ${daysSpan} days). The first cohort comparison unlocks at 30 days of history; a real verdict needs a year. Until then every score in this terminal is an <b>untested hypothesis</b> — size accordingly.</div>`;
    }

    /* signal calibration: which signals actually predict? */
    let calHtml = "";
    {
      const horizons = [[28, "4 WEEKS"], [84, "12 WEEKS"]].map(([days, label]) => ({ label, cal: calibrationOf(H, days) }));
      const withData = horizons.filter(h => h.cal.windows > 0 && Object.keys(h.cal.groups).length);
      const fmtRet = (v) => `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</span>`;
      const grpTable = (name, rows) => `<h3 style="margin-top:12px">${name}</h3>
        <div style="overflow-x:auto"><table class="rank"><thead><tr><th>BUCKET</th><th>OBS</th><th>HIT RATE</th><th>AVG FWD RETURN</th><th>VERDICT</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td style="text-align:left">${escapeHtml(r.bucket)}</td><td>${r.n}</td>
          <td>${Math.round(r.hitRate * 100)}%</td><td>${fmtRet(r.avg)}</td>
          <td class="sub">${r.judged ? (r.avg > 1 && r.hitRate >= 0.55 ? '<b style="color:var(--green)">earning trust</b>' : r.avg < -1 ? '<b style="color:var(--red)">inverse / avoid-signal</b>' : "indistinct so far") : `collecting — n&lt;20`}</td></tr>`).join("")}
        </tbody></table></div>`;
      calHtml = `<div class="card" style="margin-bottom:12px;border-left:3px solid var(--cyan)">
        <h3>SIGNAL CALIBRATION — WHICH SIGNALS ACTUALLY PREDICT <span class="unit">forward returns per signal bucket · overlapping daily windows, obs ≠ independent bets</span></h3>
        ${withData.length ? withData.map(h => `<div class="sub" style="margin-top:6px;font-weight:800;letter-spacing:.6px">${h.label} FORWARD (${h.cal.windows} window${h.cal.windows === 1 ? "" : "s"})</div>
          ${Object.entries(h.cal.groups).map(([g, rows]) => grpTable(g, rows)).join("")}`).join("")
        : `<div class="sub" style="padding:10px 0;line-height:1.6">No signal is old enough to grade yet — snapshots must age ${28}+ days before their first forward window closes (recording since <b>${first ? first.date : "today"}</b>). Every signal the terminal shows — Direction Edge labels, Beat Odds buckets, Market Reward tiers, verdict calls — is being recorded daily and will be graded here automatically. Until a bucket reaches 20 observations its verdict is withheld; anything that proves non-predictive should be deleted from the app.</div>`}
      </div>`;
    }
    el("main").innerHTML = toolHeader("📈", "MODEL TRACK RECORD", "the terminal grading itself — do high scores actually earn their returns?",
      `<div style="text-align:right"><div class="sub">SNAPSHOTS</div><div class="stat sm">${H.length}</div></div>`)
      + `<div class="note" style="margin-bottom:12px">Every data refresh records each name's brain score, call, Direction Edge, Beat Odds and price (scripts/snapshot_scores.js). This page compares past signals against what prices did next — the ONLY honest way a model earns trust. No backtest, no cherry-picks: the record starts ${first ? first.date : "today"} and cannot be rewritten.</div>`
      + calHtml + fwdHtml + cohortHtml;
  }
  const showTrack = () => showView("track", renderTrack, "trackBtn");

  /* ============================================================================
     ✎ THESIS JOURNAL — the terminal is a reading list until you write one.
     Local-only (this browser). Forces the discipline: what must be true,
     what breaks it, targets, size, exit — BEFORE the money moves.
     ============================================================================ */
  const journalState = { prefill: null };
  const loadJournal = () => { try { return JSON.parse(localStorage.getItem("sbc_journal") || "[]"); } catch { return []; } };
  const saveJournal = (j) => localStorage.setItem("sbc_journal", JSON.stringify(j));
  function renderJournal() {
    const J = loadJournal().sort((a, b) => b.created.localeCompare(a.created));
    const pre = journalState.prefill || ""; journalState.prefill = null;
    const fld = (id, ph, tall) => tall
      ? `<textarea id="${id}" class="scr-input" placeholder="${ph}" style="width:100%;min-height:56px;margin-bottom:6px"></textarea>`
      : `<input id="${id}" class="scr-input" placeholder="${ph}" style="width:100%;margin-bottom:6px">`;
    const entryHtml = J.map((e, i) => {
      const ageDays = Math.round((Date.now() - Date.parse(e.created)) / 864e5);
      const due = ageDays >= 90;
      return `<div class="card" style="margin-bottom:10px;border-left:3px solid ${due ? "var(--orange)" : "var(--green)"}">
        <h3><span class="rk-tk" data-tk="${e.ticker}" style="cursor:pointer">${e.ticker}</span> — ${e.created.slice(0, 10)} <span class="unit">${ageDays}d old${due ? " · ⚠ REVIEW DUE — has anything broken?" : ""}</span>
          <button class="scr-reset" data-del="${i}" style="margin-left:auto;font-size:9px;padding:2px 8px">delete</button></h3>
        <div class="kv"><span class="k">Thesis</span><span class="v" style="font-weight:400;text-align:right;max-width:70%">${e.thesis}</span></div>
        ${e.must ? `<div class="kv"><span class="k">Must be true</span><span class="v" style="font-weight:400;text-align:right;max-width:70%">${e.must}</span></div>` : ""}
        ${e.breakers ? `<div class="kv"><span class="k">Thesis breakers</span><span class="v" style="font-weight:400;text-align:right;max-width:70%;color:var(--red)">${e.breakers}</span></div>` : ""}
        ${e.targets ? `<div class="kv"><span class="k">Bear / base / bull</span><span class="v">${e.targets}</span></div>` : ""}
        ${e.size ? `<div class="kv"><span class="k">Size & max loss</span><span class="v">${e.size}</span></div>` : ""}
        ${e.exit ? `<div class="kv"><span class="k">Exit plan</span><span class="v" style="font-weight:400;text-align:right;max-width:70%">${e.exit}</span></div>` : ""}
      </div>`;
    }).join("");

    el("main").innerHTML = toolHeader("✎", "THESIS JOURNAL", "no thesis, no trade — write it before the money moves (stored only in this browser)",
      `<div style="text-align:right"><div class="sub">WRITTEN THESES</div><div class="stat sm" style="color:${J.length ? "var(--green)" : "var(--red)"}">${J.length}</div></div>`)
      + (J.length === 0 ? `<div class="note" style="margin-bottom:12px;border-left-color:var(--red)"><b>Zero written theses.</b> Weeks of terminal-building, eighteen views, and no investment case on paper — the tool is ahead of the process. Pick ONE name the terminal rates well, read its latest filing (link on the FINANCIALS tab), and write the five fields below. That's the whole job.</div>` : "")
      + `<div class="card" style="margin-bottom:14px"><h3>NEW THESIS</h3>
        <input id="jTicker" class="scr-input" placeholder="TICKER" value="${pre}" style="width:120px;margin-bottom:6px;text-transform:uppercase">
        ${fld("jThesis", "Thesis — why does the market misprice this? (one paragraph max)", true)}
        ${fld("jMust", "What MUST be true for this to work", false)}
        ${fld("jBreak", "What breaks it — the condition that makes you sell", false)}
        ${fld("jTargets", "Bear / base / bull per-share values", false)}
        ${fld("jSize", "Position size + max loss you accept", false)}
        ${fld("jExit", "Exit plan (price, date, or event)", false)}
        <div style="display:flex;gap:8px">
          <button class="scr-reset" id="jSave" style="color:var(--green);border-color:var(--green)">Save thesis</button>
          <button class="scr-reset" id="jExport">Export JSON</button>
        </div></div>` + entryHtml;

    el("jSave").onclick = () => {
      const g = (id) => (el(id).value || "").trim();
      const tk = g("jTicker").toUpperCase();
      if (!tk || !g("jThesis")) { flash("Ticker + thesis are the minimum", "err"); return; }
      if (!DATA.find(d => d.ticker === tk)) { flash(tk + " is not in the official universe", "err"); return; }
      const J2 = loadJournal();
      J2.push({ ticker: tk, thesis: g("jThesis"), must: g("jMust"), breakers: g("jBreak"),
        targets: g("jTargets"), size: g("jSize"), exit: g("jExit"), created: new Date().toISOString() });
      saveJournal(J2); flash("Thesis saved — review it after the next earnings report", "ok"); renderJournal();
    };
    el("jExport").onclick = () => {
      const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), theses: loadJournal() }, null, 1)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "sbc-theses.json"; a.click();
    };
    el("main").querySelectorAll("[data-del]").forEach(b => b.onclick = (ev) => {
      ev.stopPropagation();
      const J2 = loadJournal().sort((a, b) => b.created.localeCompare(a.created));
      J2.splice(+b.dataset.del, 1); saveJournal(J2); renderJournal();
    });
    el("main").querySelectorAll(".rk-tk[data-tk]").forEach(t => t.onclick = () => selectTicker(t.dataset.tk));
  }
  const showJournal = () => showView("journal", renderJournal, "journalBtn");

  const showScreener = () => showView("screener", renderScreener, "screenBtn");
  const showCompare = () => showView("compare", renderCompare, "compareBtn");
  const showPortfolio = () => showView("portfolio", renderPortfolio, "portBtn");
  const fmtEarningsDate = (dt) => dt.toISOString().slice(0, 10);
  const earningsWhen = (hour) => hour === "bmo" ? "pre-open" : hour === "amc" ? "after-close" : hour || "";
  function bundledEarningsRows(fromDate, toDate, universeOnly = false) {
    const uni = new Set(allCompanies().map(d => d.ticker));
    const from = fmtEarningsDate(fromDate), to = fmtEarningsDate(toDate);
    return EARNINGS_FOCUS.rows
      .filter(e => e.date >= from && e.date <= to && (!universeOnly || uni.has(e.symbol)))
      .map(e => ({ ...e, bundled: true, focus: true }));
  }
  function mergeEarningsRows(liveRows, bundledRows) {
    const map = new Map();
    bundledRows.forEach(e => map.set(`${e.symbol}|${e.date}`, { ...e }));
    liveRows.forEach(e => {
      const symbol = e.symbol, date = e.date, k = `${symbol}|${date}`;
      map.set(k, { ...(map.get(k) || {}), ...e, symbol, date, live: true });
    });
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
  }
  /* ============================================================================
     ⭐ BEST SETUPS — the brain's picks, only when the tape agrees.
     Quality gate first (great business, sane price), then RSI(14) on real
     daily closes decides alignment: washed-out RSI on a quality name is
     the setup; oversold junk is a falling knife and never shows here. */
  function renderSetups() {
    const rows = bestSetupsOf();
    const prime = rows.filter(x => x.aligned);
    const rest = rows.filter(x => !x.aligned).slice(0, 14);
    const anyRsi = rows.some(x => x.rsi);
    const rsiChip = (r) => {
      const z = rsiZone(r ? r.value : null);
      return `<span class="rk-pill" style="background:${z.color};color:#071018" title="RSI(14) daily${r && r.asOf ? " · closes to " + r.asOf : ""}">${r ? r.value : "?"}</span>`;
    };
    const row = (x) => `<tr data-tk="${x.d.ticker}">
      <td style="text-align:left"><span class="rk-tk">${x.d.ticker}</span> <span class="sub">${x.d.sector}</span></td>
      <td><span class="rk-pill" style="background:${x.color};color:#071018">${x.score}</span></td>
      <td>${rsiChip(x.rsi)} <span class="sub">${x.rsi ? rsiZone(x.rsi.value).label : "pending"}</span></td>
      <td class="sub">${x.parts.find(p => p.k === "buyzone").why}</td>
      <td><b style="color:${x.color};font-size:10px">${x.label}</b></td>
    </tr>`;
    const primeCard = (x) => `<div class="card" style="border-left:3px solid var(--green)" data-tk="${x.d.ticker}">
      <h3>${x.d.ticker} — ${x.score} <span class="unit">${escapeHtml(x.d.name)}</span></h3>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:4px 0 8px">
        ${rsiChip(x.rsi)} <b style="color:var(--green)">${x.rsi ? rsiZone(x.rsi.value).label : ""}</b>
        ${x.rsi && x.rsi.prev != null && x.rsi.prev < 30 && x.rsi.value >= 30 ? `<span class="impact-chip hot">CROSSED UP OUT OF OVERSOLD</span>` : ""}
      </div>
      ${x.parts.map(p => `<div class="kv"><span class="k">${p.label}</span><span class="v" style="color:${scoreColorOf(p.s)}">${p.s == null ? "–" : Math.round(p.s)} <span class="sub">${escapeHtml(p.why)}</span></span></div>`).join("")}
    </div>`;
    el("main").innerHTML = `
      <div class="hdr">
        <div><div class="tick gradient-title">⭐ BEST SETUPS</div>
        <div class="co">Only the brain's highest-conviction names — surfaced when the tape hands them to you at a washed-out RSI. Quality first, technicals as the trigger.</div></div>
        <div class="spacer"></div>
        <div style="text-align:right"><div class="sub">CANDIDATES PASSING THE GATE</div><div class="stat sm" style="color:var(--gold)">${rows.length}</div></div>
      </div>
      <div class="note" style="margin-bottom:12px"><b>How this list works:</b> a name must FIRST pass the brain's gate (business quality ≥65, long-term view ≥55, verified data, not LIKELY DOWN). Only then does the tape matter: RSI(14) on real daily closes at/near the bottom (≤38) plus proximity to the IV15 buy price marks a <b style="color:var(--green)">PRIME</b> setup. Oversold RSI on a weak business is a falling knife — those names are filtered out before you ever see them. ${anyRsi ? "" : "<b>RSI arms on the next data refresh (daily closes are being added to the bundle).</b>"} Research signals, not advice.</div>
      ${prime.length ? `<div class="grid g2" style="margin-bottom:12px">${prime.slice(0, 6).map(primeCard).join("")}</div>`
        : `<div class="card" style="margin-bottom:12px;border-left:3px solid var(--amber)"><h3>NO PRIME SETUPS RIGHT NOW</h3>
          <div class="sub" style="padding:8px 0;line-height:1.6">${anyRsi ? "Nothing on the board is both brain-approved AND at a washed-out RSI today. That is normal — prime setups appear in selloffs, which is exactly when they're hardest to act on. The watch list below shows what gets promoted the moment its RSI breaks down." : "The quality side is ranked below; RSI alignment switches on after the next data refresh."}</div></div>`}
      <div class="card">
        <h3>THE WATCH LIST — QUALITY WAITING FOR A TAPE TRIGGER <span class="unit">sorted by setup score · promoted to PRIME when RSI washes out</span></h3>
        <div style="overflow-x:auto"><table class="rank">
          <thead><tr><th style="text-align:left">TICKER</th><th>SETUP</th><th>RSI(14)</th><th>BUY ZONE</th><th>STATUS</th></tr></thead>
          <tbody>${rest.map(row).join("") || `<tr><td colspan="5" class="sub" style="padding:14px">Nothing passes the quality gate right now.</td></tr>`}</tbody>
        </table></div>
      </div>`;
    el("main").querySelectorAll("[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
  }
  const showSetups = () => showView("setups", renderSetups, "setupsBtn");

  /* ============================================================================
     🐋 WHALE TRACKER — the biggest owners, from the primary source.
     Per whale (Berkshire, BlackRock, Citadel): recent EDGAR filings + the
     two latest 13F holdings reports, diffed. Honesty on-screen: 13Fs are
     quarterly with a 45-day legal lag, and each whale's style note says
     how much signal its moves actually carry (active vs index vs hedged). */
  const whalesIntel = () => (typeof WHALES_INTEL !== "undefined" ? WHALES_INTEL : null);
  const whaleState = { focus: "berkshire" };
  const blkIntel = () => {
    const W = whalesIntel();
    if (!W || !W.whales) return null;
    return W.whales[whaleState.focus] || Object.values(W.whales)[0] || null;
  };
  const blkMoney = (v) => v == null ? "–" : v >= 1e12 ? "$" + (v / 1e12).toFixed(2) + "T" : v >= 1e9 ? "$" + (v / 1e9).toFixed(1) + "B" : "$" + (v / 1e6).toFixed(0) + "M";
  const blkShares = (s) => s == null ? "–" : s >= 1e9 ? (s / 1e9).toFixed(2) + "B" : s >= 1e6 ? (s / 1e6).toFixed(1) + "M" : String(s);
  function renderBlackrock() {
    const B = blkIntel();
    const H = B && B.holdings;
    const edgarDoc = (f) => B && B.cik && f.doc ? `https://www.sec.gov/Archives/edgar/data/${B.cik}/${f.accn.replace(/-/g, "")}/${f.doc}` : null;
    const nameCell = (r) => `${r.ticker ? `<span class="rk-tk">${r.ticker}</span> ` : ""}<span class="${r.ticker ? "sub" : ""}">${escapeHtml(r.name)}</span>`;
    const chgCell = (v) => v == null ? `<span class="sub">new</span>` : `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</span>`;
    const moveRow = (r, right, rightCls = "") => `<tr ${r.ticker ? `data-tk="${r.ticker}"` : ""}>
      <td style="text-align:left">${nameCell(r)}</td><td class="${rightCls}">${right}</td></tr>`;
    const moveCard = (title, color, rows, rightHead, note) => `<div class="card" style="border-left:3px solid ${color}">
      <h3>${title} <span class="unit">${note}</span></h3>
      ${rows.length ? `<div style="overflow-x:auto"><table class="rank"><thead><tr><th style="text-align:left">NAME</th><th>${rightHead}</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`
        : `<div class="sub" style="padding:12px">none this quarter</div>`}
    </div>`;
    const W = whalesIntel();
    const whaleChips = ["berkshire", "blackrock", "citadel"].map(k => {
      const label = k === "berkshire" ? "🎩 BERKSHIRE" : k === "blackrock" ? "⬛ BLACKROCK" : "🏰 CITADEL";
      return `<button class="sec-chip ${whaleState.focus === k ? "on" : ""}" data-whale="${k}" style="${whaleState.focus === k ? "background:var(--cyan)" : ""}">${label}</button>`;
    }).join("");
    el("main").innerHTML = `
      <div class="hdr">
        <div><div class="tick gradient-title">🐋 WHALE TRACKER</div>
        <div class="co">What the biggest investors on Earth file, buy and sell — straight from SEC EDGAR, no middleman.</div></div>
        <div class="spacer"></div>
        <div style="text-align:right"><div class="sub">EDGAR ${B && B.cik ? "CIK " + B.cik : ""}</div><div class="stat sm">${W && W.asOf ? "checked " + W.asOf : "first run pending"}</div></div>
      </div>
      <div class="sec-chips" style="margin-bottom:10px">${whaleChips}</div>
      <div class="note" style="margin-bottom:12px"><b>${B ? escapeHtml(B.label || "") : ""} — read this first:</b> 13F holdings are a quarterly snapshot the SEC lets managers file up to 45 days late — that lag is the law, not a glitch. ${B && B.style ? escapeHtml(B.style) : ""} The signal lives in the <b>deviations</b>: brand-new positions, outright exits, and outsized adds or trims — exactly what this page surfaces.</div>
      ${!B ? `<div class="card"><h3>ARMING</h3><div class="sub" style="padding:10px 0;line-height:1.6">The tracker pulls each whale's EDGAR submissions and parses their two most recent 13F holdings reports on the next data refresh — Berkshire Hathaway, BlackRock and Citadel. Filings feed, buy/sell diff, top holdings, and their stake in every one of your ${DATA.length} names, all automatic.</div></div>` : !H ? `<div class="card"><h3>ARMING — HOLDINGS PARSE PENDING</h3><div class="sub" style="padding:10px 0;line-height:1.6">${escapeHtml(B.label)}'s filings feed below is live; the 13F holdings diff lands on the next data refresh.</div></div>` : `
      <div class="grid g4" style="margin-bottom:12px">
        <div class="card"><h3>PORTFOLIO (13F)</h3><div class="stat" style="color:var(--cyan)">${blkMoney(H.totalValue)}</div><div class="sub">${H.positions.toLocaleString()} positions · quarter ended ${H.period || "?"}</div></div>
        <div class="card"><h3>FILED</h3><div class="stat sm">${H.filed || "–"}</div><div class="sub">vs prior quarter ${H.prevPeriod || "–"}</div></div>
        <div class="card"><h3>YOUR UNIVERSE OVERLAP</h3><div class="stat" style="color:var(--gold)">${H.universe.length}</div><div class="sub">of ${DATA.length} names held by ${escapeHtml(B.label)}</div></div>
        <div class="card"><h3>DEVIATIONS</h3><div class="stat" style="color:var(--purple)">${H.new.length + H.exits.length}</div><div class="sub">${H.new.length} new positions · ${H.exits.length} exits</div></div>
      </div>
      <div class="grid g2" style="margin-bottom:12px">
        ${moveCard("🟢 BOUGHT — NEW POSITIONS", "var(--green)", H.new.map(r => moveRow(r, blkMoney(r.value))), "POSITION SIZE", "did not exist last quarter")}
        ${moveCard("🔴 SOLD — FULL EXITS", "var(--red)", H.exits.map(r => moveRow(r, blkMoney(r.prevValue))), "WAS WORTH", "held last quarter, gone now")}
        ${moveCard("▲ ADDED TO", "var(--cyan)", H.adds.map(r => moveRow(r, chgCell(r.sharesChgPct))), "SHARES QoQ", "share count up ≥3% quarter over quarter")}
        ${moveCard("▼ TRIMMED", "var(--orange)", H.trims.map(r => moveRow(r, chgCell(r.sharesChgPct))), "SHARES QoQ", "share count down ≥3% quarter over quarter")}
      </div>
      <div class="card" style="margin-bottom:12px">
        <h3>TOP HOLDINGS <span class="unit">by market value · quarter ended ${H.period || "?"}</span></h3>
        <div style="overflow-x:auto"><table class="rank">
          <thead><tr><th>#</th><th style="text-align:left">NAME</th><th>VALUE</th><th>% OF PORTFOLIO</th><th>SHARES</th><th>SHARES QoQ</th></tr></thead>
          <tbody>${H.top.map((r, i) => `<tr ${r.ticker ? `data-tk="${r.ticker}"` : ""}>
            <td class="rk-num">${i + 1}</td><td style="text-align:left">${nameCell(r)}</td>
            <td>${blkMoney(r.value)}</td><td>${r.pctOfPortfolio != null ? r.pctOfPortfolio.toFixed(2) + "%" : "–"}</td>
            <td class="sub">${blkShares(r.shares)}</td><td>${r.isNew ? `<b style="color:var(--green)">NEW</b>` : chgCell(r.sharesChgPct)}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>
      <div class="card" style="margin-bottom:12px">
        <h3>${escapeHtml((B.label || "").toUpperCase())} × YOUR ${DATA.length}-STOCK UNIVERSE <span class="unit">their stake in your names, QoQ</span></h3>
        <div style="overflow-x:auto;max-height:52vh;overflow-y:auto"><table class="rank">
          <thead><tr><th style="text-align:left">TICKER</th><th>VALUE</th><th>SHARES</th><th>SHARES QoQ</th></tr></thead>
          <tbody>${H.universe.map(r => `<tr data-tk="${r.ticker}">
            <td style="text-align:left"><span class="rk-tk">${r.ticker}</span> <span class="sub">${escapeHtml(r.name)}</span></td>
            <td>${blkMoney(r.value)}</td><td class="sub">${blkShares(r.shares)}</td>
            <td>${r.isNew ? `<b style="color:var(--green)">NEW</b>` : chgCell(r.sharesChgPct)}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>`}
      <div class="card">
        <h3>THEIR RECENT SEC FILINGS <span class="unit">live EDGAR feed · click to read the actual document</span></h3>
        ${(B && B.filings || []).length ? (B.filings || []).slice(0, 20).map(f => {
          const u = edgarDoc(f);
          return `<div class="kv"><span class="k">${f.filed} · <b style="color:var(--text)">${escapeHtml(f.form)}</b></span>
            <span class="v">${u ? `<a href="${u}" target="_blank" rel="noopener" style="color:var(--cyan)">open on EDGAR →</a>` : `<span class="sub">${f.accn}</span>`}</span></div>`;
        }).join("") : `<div class="sub" style="padding:12px">Filing feed fills on the next data refresh.</div>`}
      </div>`;
    el("main").querySelectorAll("[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
    el("main").querySelectorAll("[data-whale]").forEach(b => b.onclick = () => { whaleState.focus = b.dataset.whale; renderBlackrock(); });
  }
  const showBlackrock = () => showView("blackrock", renderBlackrock, "blackrockBtn");

  /* ============================================================================
     🧭 EASY MODE — TODAY'S GAME PLAN
     Every engine in the terminal, translated into words a 10-year-old can
     act on: letter grades, traffic lights, one plain sentence per idea.
     Same math underneath — nothing is dumbed down, only the language.
     Honesty rules still apply: "we don't know" is said out loud. */
  const gradeOf = (s) => s == null ? { g: "?", c: "var(--dim)" }
    : s >= 80 ? { g: "A", c: "var(--green)" } : s >= 65 ? { g: "B", c: "var(--cyan)" }
    : s >= 50 ? { g: "C", c: "var(--amber)" } : s >= 35 ? { g: "D", c: "var(--orange)" } : { g: "F", c: "var(--red)" };
  function easySentence(d) {
    const ms = marketScoreOf(d);
    if (!ms) return "We don't have enough checked numbers to grade this one yet.";
    const b = ms.businessQuality.score, v = ms.valuation.score, m = ms.marketReward.score;
    const biz = b == null ? "We can't grade the business yet" : b >= 75 ? "Great business" : b >= 60 ? "Good business" : b >= 45 ? "OK business" : "Weak business";
    const px = v == null ? "price grade unknown" : v >= 65 ? "the price looks fair or cheap" : v >= 45 ? "the price is not a bargain" : "the price is expensive";
    const crowd = m == null ? "" : m >= 65 ? " Other investors are noticing it too." : m < 45 ? " Other investors are ignoring it right now." : "";
    return `${biz}, and ${px}.${crowd}`;
  }
  function easyRow(tk, sentence, right, rightColor, sub = "") {
    const d = companyOf(tk);
    return `<div class="home-row" data-tk="${tk}" style="grid-template-columns:minmax(0,1fr) auto;padding:11px 0">
      <div><b>${tk}</b><span style="max-width:none;white-space:normal">${escapeHtml(d ? d.name : "")}${sub ? " · " + sub : ""}</span>
        <span style="white-space:normal;color:var(--text);font-size:12px;margin-top:3px">${sentence}</span></div>
      <strong style="color:${rightColor};font-size:22px">${right}</strong>
    </div>`;
  }
  function easyEventWords(e) {
    const d = companyOf(e.tk);
    const nm = d ? d.name.split(" ")[0] : e.tk;
    switch (e.type) {
      case "filing": return `${nm} handed in its official report to the government. ${/DECELERATED/.test(e.detail) ? "It's growing slower than before." : /ACCELERATED/.test(e.detail) ? "It's growing faster than before." : "We checked it against the last one."}`;
      case "analyst": return /DOWNGRADED/.test(e.title) ? `A big bank now likes ${nm} less than before.` : /UPGRADED/.test(e.title) ? `A big bank now likes ${nm} more than before.` : `A big bank started following ${nm}.`;
      case "whale": { const mgr = e.title.split(" ")[0]; return /NEW|ADDED/.test(e.title) ? `${mgr} — one of the biggest investors on Earth — bought more of ${nm}.` : `${mgr} — one of the biggest investors on Earth — sold some or all of its ${nm}.`; }
      case "earnings": return /BEAT/.test(e.title) ? `${nm} made MORE money than the experts guessed. Nice.` : /MISS/.test(e.title) ? `${nm} made LESS money than the experts guessed. Careful.` : `${nm} has a report coming and it looks ${/STRONG/.test(e.title) ? "strong" : "shaky"}.`;
      case "revisions": return /POSITIVE|UP/.test(e.title) ? `The experts are raising their guesses for ${nm}. That's usually a good sign.` : `The experts are lowering their guesses for ${nm}. That's usually a warning.`;
      case "edge": return /LIKELY UP|UP BIAS/.test(e.title) ? `Our robot's arrows turned UP for ${nm}.` : `Our robot's arrows turned DOWN for ${nm}.`;
      case "score": return /ABOVE|jumped/.test(e.title) ? `${nm}'s report card just got better.` : `${nm}'s report card just got worse.`;
      default: return e.title;
    }
  }
  function renderEasy() {
    const ledger = earningsLedger();
    const scored = DATA.map(d => ({ d, ms: marketScoreOf(d), L: ivLadder(d) })).filter(x => x.ms);
    // 1 · great businesses at fair prices (the whole game in one list)
    const great = scored
      .filter(x => (x.ms.businessQuality.score ?? 0) >= 70 && (x.ms.valuation.score ?? 0) >= 55 && dataConfidenceOf(x.d).rankable)
      .sort((a, b) => (b.ms.longTermView.score ?? 0) - (a.ms.longTermView.score ?? 0)).slice(0, 6);
    // 2 · report cards coming up, looking strong
    const upcoming = upcomingEarningsRows(14)
      .map(e => ({ e, o: companyOf(e.symbol) ? beatOddsOf(companyOf(e.symbol), ledger) : null }))
      .filter(x => x.o && x.o.score != null && x.o.score >= 65 && x.o.coverage >= 55)
      .sort((a, b) => b.o.score - a.o.score).slice(0, 5);
    // 3 · winning streaks (drift)
    const streaks = ledger.map(r => ({ r, ds: driftScoreOf(r) }))
      .filter(x => x.ds && x.ds.up && x.ds.score >= 58)
      .sort((a, b) => b.ds.score - a.ds.score).slice(0, 5);
    // 4 · be careful list: miss risk, downside drift, tier-1 downgrades
    const careful = [];
    upcomingEarningsRows(14).forEach(e => {
      const d = companyOf(e.symbol); if (!d) return;
      const o = beatOddsOf(d, ledger);
      if (o && o.score != null && o.score <= 40 && o.coverage >= 55)
        careful.push({ tk: e.symbol, why: `Report coming ${e.date} and the signs look weak — experts guess it might disappoint.` });
    });
    ledger.forEach(r => {
      const ds = driftScoreOf(r);
      if (ds && !ds.up && ds.label === "DOWNSIDE DRIFT")
        careful.push({ tk: r.symbol, why: "Just disappointed everyone. Stocks that disappoint often stay weak for a while." });
    });
    signalsEvents().filter(e => e.type === "analyst" && /DOWNGRADED/.test(e.title) && e.m >= 70).slice(0, 4)
      .forEach(e => careful.push({ tk: e.tk, why: "A big famous bank just said it likes this stock less." }));
    const carefulTop = [...new Map(careful.map(c => [c.tk, c])).values()].slice(0, 6);
    // 5 · what just happened, in plain words
    const happened = signalsEvents().slice().sort((a, b) => b.d.localeCompare(a.d) || b.m - a.m).slice(0, 6);
    const gradeChip = (s) => { const g = gradeOf(s); return `<span class="grade" style="display:inline-grid;width:34px;height:34px;font-size:16px;color:${g.c};border-color:${g.c}">${g.g}</span>`; };
    el("main").innerHTML = `
      <div class="hdr">
        <div><div class="tick gradient-title">🧭 TODAY'S GAME PLAN</div>
        <div class="co">The whole terminal in plain words. Same math, simpler language. A = awesome, F = stay away, ? = we honestly don't know.</div></div>
      </div>
      <div class="note" style="margin-bottom:12px;border-left-color:var(--gold)"><b>The whole game in one sentence:</b> buy pieces of great companies when the price is fair, let them grow for years, and don't panic when the line wiggles. Everything below just helps you do that.</div>
      <div class="grid g2">
        <div class="card" style="border-left:3px solid var(--green)">
          <h3>🏆 GREAT COMPANIES AT FAIR PRICES <span class="unit">the main list — strong business + sane price</span></h3>
          ${great.length ? great.map(x => { const r = rsiOf(x.d); const extra = r && r.value <= 35 ? " 🔥 And right now sellers are exhausted (RSI at the bottom) — this is what a real sale looks like." : ""; return easyRow(x.d.ticker, easySentence(x.d) + extra, gradeOf(x.ms.longTermView.score).g, gradeOf(x.ms.longTermView.score).c); }).join("") : `<div class="sub" style="padding:12px">Right now nothing is both great AND fairly priced. That happens! Waiting is allowed — it's what the best investors do most of the time.</div>`}
        </div>
        <div class="card" style="border-left:3px solid var(--cyan)">
          <h3>📝 REPORT CARDS COMING UP <span class="unit">companies about to tell everyone how they did</span></h3>
          ${upcoming.length ? upcoming.map(x => {
            const bs = earnBeatStats(x.e.symbol);
            return easyRow(x.e.symbol, `Report day is ${x.e.date}. ${bs ? `It has beaten the experts' guesses ${bs.beats} of its last ${bs.n} times.` : ""} The signs look strong — but strong signs are a hint, not a promise.`, x.o.score, x.o.color, "");
          }).join("") : `<div class="sub" style="padding:12px">No strong-looking report cards in the next two weeks.</div>`}
        </div>
        <div class="card" style="border-left:3px solid var(--gold)">
          <h3>🔥 ON A WINNING STREAK <span class="unit">just beat expectations — winners often keep winning for a few weeks</span></h3>
          ${streaks.length ? streaks.map(x => easyRow(x.r.symbol, `Just made more money than the experts guessed${x.r.surprisePct != null ? ` (${x.r.surprisePct >= 0 ? "+" : ""}${x.r.surprisePct.toFixed(0)}% more)` : ""}. History says stocks like this often keep climbing for a few weeks — not always.`, x.ds.score, x.ds.color)).join("") : `<div class="sub" style="padding:12px">No fresh winning streaks right now.</div>`}
        </div>
        <div class="card" style="border-left:3px solid var(--red)">
          <h3>⚠️ BE CAREFUL HERE <span class="unit">warning signs our robot found</span></h3>
          ${carefulTop.length ? carefulTop.map(c => easyRow(c.tk, c.why, "⚠", "var(--red)")).join("") : `<div class="sub" style="padding:12px">No big warning signs on the board today.</div>`}
        </div>
        <div class="card" style="grid-column:span 2;border-left:3px solid var(--purple)">
          <h3>📣 WHAT JUST HAPPENED <span class="unit">the news feed, translated</span></h3>
          ${happened.length ? happened.map(e => easyRow(e.tk, easyEventWords(e), e.m, e.m >= 80 ? "var(--red)" : e.m >= 65 ? "var(--orange)" : "var(--muted)", e.d)).join("") : `<div class="sub" style="padding:12px">Quiet day so far. The robot checks everything again every school-day morning.</div>`}
        </div>
        <div class="card" style="grid-column:span 2">
          <h3>🥇 THE GOLDEN RULES <span class="unit">what elite investors actually do — it's boringly simple</span></h3>
          <div class="sub" style="line-height:1.8;font-size:12.5px">
            1. <b>Only buy what you understand.</b> If you can't explain what the company sells in one sentence, skip it.<br>
            2. <b>Great company + fair price + patience</b> beats everything else. The 🏆 list is exactly that.<br>
            3. <b>Never bet money you need.</b> Elite investors survive being wrong — that's their real secret.<br>
            4. <b>Winning slowly IS winning.</b> Getting rich fast is luck; getting rich slow is skill.<br>
            5. <b>This app does homework, not magic.</b> Grades and scores are strong hints from real numbers — nobody on Earth knows for sure what a stock does next, and anyone who says they do is selling something.
          </div>
        </div>
      </div>`;
    el("main").querySelectorAll("[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
  }
  const showEasy = () => showView("easy", renderEasy, "easyBtn");

  /* ============================================================================
     💡 WHAT CHANGED — THE SIGNALS FEED
     Levels are what everyone knows; the edge is in the deltas. This view
     renders the daily diff ledger built by scripts/build_signals.js:
     score inflections, direction-edge flips, revision flips, fresh
     beats/misses, and same-day SEC filing diffs — ranked by materiality. */
  const signalsEvents = () => (typeof SIGNALS !== "undefined" && Array.isArray(SIGNALS.events)) ? SIGNALS.events : [];
  const signalsAsOf = () => (typeof SIGNALS !== "undefined" && SIGNALS.asOf) || null;
  const SIG_TYPES = {
    filing: { label: "FILING", color: "var(--purple)" },
    whale: { label: "WHALES", color: "var(--ice)" },
    analyst: { label: "ANALYST", color: "var(--pink)" },
    earnings: { label: "EARNINGS", color: "var(--gold)" },
    revisions: { label: "REVISIONS", color: "var(--cyan)" },
    edge: { label: "EDGE FLIP", color: "var(--green)" },
    score: { label: "SCORE", color: "var(--amber)" },
  };
  const sigState = { filter: "all" };
  function signalRow(e) {
    const t = SIG_TYPES[e.type] || { label: e.type.toUpperCase(), color: "var(--muted)" };
    const d = companyOf(e.tk);
    return `<div class="home-row" ${d ? `data-tk="${e.tk}"` : ""} style="grid-template-columns:56px minmax(0,1fr) auto">
      <div><strong style="color:${e.m >= 80 ? "var(--red)" : e.m >= 65 ? "var(--orange)" : "var(--muted)"};font-size:16px">${e.m}</strong><span class="sub" style="font-size:8.5px">IMPACT</span></div>
      <div><b>${e.tk} <span class="impact-chip" style="color:${t.color};border-color:${t.color}">${t.label}</span></b>
        <span style="white-space:normal;color:var(--text);font-size:12px">${escapeHtml(e.title)}</span>
        <span style="white-space:normal">${escapeHtml(e.detail || "")}</span></div>
      <div class="sub" style="white-space:nowrap">${d ? d.sector : ""}</div>
    </div>`;
  }
  function renderSignals() {
    const all = signalsEvents();
    const rows = sigState.filter === "all" ? all : all.filter(e => e.type === sigState.filter);
    const byDate = new Map();
    rows.forEach(e => { if (!byDate.has(e.d)) byDate.set(e.d, []); byDate.get(e.d).push(e); });
    const today = todayISO();
    const dateLabel = (dt) => dt === today ? "TODAY" : Math.round((Date.parse(today) - Date.parse(dt)) / 864e5) === 1 ? "YESTERDAY" : dt;
    const chip = (key, label) => `<button class="sec-chip ${sigState.filter === key ? "on" : ""}" data-sigf="${key}"
      style="${sigState.filter === key ? "background:var(--cyan)" : ""}">${label}</button>`;
    const counts = {};
    all.forEach(e => counts[e.type] = (counts[e.type] || 0) + 1);
    el("main").innerHTML = `
      <div class="hdr">
        <div><div class="tick gradient-title">💡 WHAT CHANGED</div>
        <div class="co">The daily diff of every signal the terminal tracks — inflections, flips and filings, ranked by impact. Deltas are the edge; levels are the encyclopedia.</div></div>
        <div class="spacer"></div>
        <div style="text-align:right"><div class="sub">LEDGER</div><div class="stat sm">${signalsAsOf() ? "diffed " + signalsAsOf() : "arming"}</div></div>
      </div>
      <div class="sec-chips" style="margin-bottom:12px">
        ${chip("all", `ALL ${all.length}`)}
        ${Object.entries(SIG_TYPES).map(([k, t]) => chip(k, `${t.label} ${counts[k] || 0}`)).join("")}
      </div>
      ${(() => {
        // ACTIVE SETUPS NOW — computed live from current data so this page is
        // useful even on a quiet ledger day. These are states, not deltas.
        const ledger = earningsLedger();
        const setups = upcomingEarningsRows(21)
          .map(e => ({ e, o: companyOf(e.symbol) ? beatOddsOf(companyOf(e.symbol), ledger) : null }))
          .filter(x => x.o && x.o.score != null && x.o.score >= 65 && x.o.coverage >= 55)
          .sort((a, b) => b.o.score - a.o.score).slice(0, 5);
        const drifts = ledger.map(r => ({ r, ds: driftScoreOf(r) }))
          .filter(x => x.ds && (x.ds.label === "STRONG DRIFT" || x.ds.label === "DRIFT CANDIDATE"))
          .sort((a, b) => b.ds.score - a.ds.score).slice(0, 5);
        const tapes = DATA.map(d => {
          const t = earnIntelOf(d.ticker)?.trend;
          return t && hasNum(t.revUp30) && hasNum(t.revDown30) ? { tk: d.ticker, net: t.revUp30 - t.revDown30 } : null;
        }).filter(Boolean).sort((a, b) => b.net - a.net);
        const hot = tapes.filter(x => x.net >= 5).slice(0, 4);
        const cold = tapes.filter(x => x.net <= -5).slice(-4).reverse();
        const mini = (title, color, items) => `<div>
          <h3 style="margin:0 0 4px;color:${color}">${title}</h3>
          ${items.length ? items.join("") : `<div class="sub" style="padding:6px 0">none right now</div>`}
        </div>`;
        const li = (tk, right, sub, color) => `<div class="home-row" data-tk="${tk}" style="padding:6px 0">
          <div><b>${tk}</b><span>${sub}</span></div><div></div><strong style="color:${color}">${right}</strong></div>`;
        return `<div class="card" style="margin-bottom:12px;border-left:3px solid var(--cyan)">
          <h3>ACTIVE SETUPS RIGHT NOW <span class="unit">current states computed live — the feed below tracks how they change day over day</span></h3>
          <div class="grid g3" style="margin-top:6px">
            ${mini("🎯 STRONG BEAT SETUPS", "var(--green)", setups.map(x => li(x.e.symbol, x.o.score, `reports ${x.e.date}`, x.o.color)))}
            ${mini("📈 DRIFT CANDIDATES", "var(--cyan)", drifts.map(x => li(x.r.symbol, x.ds.score, `${x.ds.label} · ${x.ds.windowLeft}d window left`, x.ds.color)))}
            ${mini("🔥 REVISION TAPES", "var(--amber)", hot.map(x => li(x.tk, "+" + x.net, "net 30d EPS revisions", "var(--green)"))
              .concat(cold.map(x => li(x.tk, String(x.net), "net 30d EPS revisions", "var(--red)"))))}
          </div>
        </div>`;
      })()}
      ${rows.length ? [...byDate.entries()].map(([dt, evs]) => `<div class="card" style="margin-bottom:12px">
        <h3>${dateLabel(dt)} <span class="unit">${evs.length} signal${evs.length === 1 ? "" : "s"} · sorted by impact</span></h3>
        ${evs.sort((a, b) => b.m - a.m).map(signalRow).join("")}
      </div>`).join("")
      : `<div class="card"><h3>THE FEED IS ARMING</h3>
        <div class="sub" style="line-height:1.6;padding:6px 0">The signals engine diffs every tracked input once per weekday data refresh: business-quality / market-reward / long-term score inflections, Direction Edge label flips, analyst revision-tape flips, consensus drift inflections, Beat Odds regime entries for reports inside 3 weeks, fresh beats and misses, and same-day SEC filing diffs (growth acceleration, SBC burden, share-count turns). ${signalsAsOf() ? `The baseline was recorded <b>${signalsAsOf()}</b> — the first deltas appear on the next refresh, and every weekday after.` : "The first pipeline run records the baseline."} Nothing is backfilled or invented: a quiet tape shows a quiet feed.</div></div>`}
      <div class="card" style="margin-top:12px"><h3>WHY DELTAS, NOT LEVELS</h3>
        <div class="sub" style="line-height:1.6">A score of 75 is public knowledge the moment it is computed. The tradeable information is the day it <b>became</b> 75 — the inflection, before attention catches up. This feed exists so the terminal opens with "what changed since yesterday" instead of "here are 126 rated stocks." Filing diffs carry the highest impact weight because almost nobody reads filings the day they land.</div></div>`;
    el("main").querySelectorAll("[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
    el("main").querySelectorAll("[data-sigf]").forEach(b => b.onclick = () => { sigState.filter = b.dataset.sigf; renderSignals(); });
  }
  const showSignals = () => showView("signals", renderSignals, "signalsBtn");

  /* ============================================================================
     🎯 EARNINGS COMMAND CENTER
     One screen for the whole season: who just beat or missed (live the moment
     actuals hit when a Finnhub key is connected, next-morning via the bundled
     pipeline otherwise), who reports next, and how loaded each setup is —
     the Beat Odds composite recomputes automatically as macro (regime tape)
     and micro (peer results) inputs change. ================================= */
  const oddsPillHtml = (o) => o.score == null
    ? `<span class="rk-pill" style="background:rgba(118,133,156,.16);color:var(--dim)">n/a</span>`
    : `<span class="rk-pill" style="background:${o.color};color:#071018" title="coverage ${o.coverage}%">${o.score}</span>`;
  const surpriseChip = (r) => {
    if (r.epsActual == null || r.epsEstimate == null) return `<span class="sub">reported</span>`;
    const beat = r.epsActual > r.epsEstimate, inline = r.epsActual === r.epsEstimate;
    const col = inline ? "var(--amber)" : beat ? "var(--green)" : "var(--red)";
    const word = inline ? "IN-LINE" : beat ? "BEAT" : "MISS";
    return `<b style="color:${col}">${word}</b>${r.surprisePct != null ? ` <span class="sub">${r.surprisePct >= 0 ? "+" : ""}${r.surprisePct.toFixed(1)}%</span>` : ""}`;
  };
  function seasonScorecard(ledger) {
    const withEst = ledger.filter(r => r.epsActual != null && r.epsEstimate != null);
    const beats = withEst.filter(r => r.epsActual > r.epsEstimate).length;
    const surprises = withEst.map(r => r.surprisePct).filter(hasNum);
    const avg = surprises.length ? surprises.reduce((a, v) => a + v, 0) / surprises.length : null;
    const revRows = ledger.filter(r => hasNum(r.revActual) && hasNum(r.revEstimate));
    const revBeats = revRows.filter(r => r.revActual > r.revEstimate).length;
    return { reported: ledger.length, scored: withEst.length, beats,
      beatRate: withEst.length ? beats / withEst.length : null, avgSurprise: avg,
      revScored: revRows.length, revBeatRate: revRows.length ? revBeats / revRows.length : null };
  }
  function renderEarningsCmd() {
    refreshEarningsLive();
    const ledger = earningsLedger();
    const upcoming = upcomingEarningsRows();
    const card = seasonScorecard(ledger);
    const regime = macroRegimeOf();
    const asOf = earnIntelAsOf();
    const live = !!state.keys.finnhub;
    const liveAge = state.earnLive.fetchedAt ? Math.round((Date.now() - state.earnLive.fetchedAt) / 1000) : null;
    const oddsByTk = new Map();
    const oddsFor = (tk) => {
      if (!oddsByTk.has(tk)) { const d = companyOf(tk); oddsByTk.set(tk, d ? beatOddsOf(d, ledger) : null); }
      return oddsByTk.get(tk);
    };
    const statCard = (label, val, sub, color = "var(--text)") => `<div class="card"><h3>${label}</h3>
      <div class="stat" style="color:${color}">${val}</div><div class="sub">${sub}</div></div>`;
    const pctOrDash = (v) => v == null ? "–" : Math.round(v * 100) + "%";

    const reportedRow = (r) => {
      const d = companyOf(r.symbol);
      const w1 = d ? pctMoveFrom(d.px && d.px.v || [], 1) : null;
      return `<tr data-tk="${r.symbol}">
        <td>${r.postQuarter ? `<span title="quarter ended ${r.date}; actuals on file prove it reported — exact date unknown">qtr ${r.date}≈</span>` : `${r.date}${r.dateIsApprox ? `<span class="sub" title="approximate — stamped by the daily pipeline">≈</span>` : ""}`}${r.source === "live" ? ` <b style="color:var(--green)" title="live Finnhub actuals">⚡</b>` : ""}</td>
        <td><span class="rk-tk">${r.symbol}</span> <span class="sub">${d ? d.sector : ""}</span></td>
        <td>${surpriseChip(r)}</td>
        <td>${r.epsActual != null ? "$" + (+r.epsActual).toFixed(2) : "–"} <span class="sub">vs ${r.epsEstimate != null ? "$" + (+r.epsEstimate).toFixed(2) : "?"}</span></td>
        <td>${hasNum(r.revActual) ? fmtRevEst(r.revActual) : "–"} <span class="sub">${hasNum(r.revEstimate) ? "vs " + fmtRevEst(r.revEstimate) : ""}</span>${hasNum(r.revActual) && hasNum(r.revEstimate) ? (r.revActual >= r.revEstimate ? ` <b style="color:var(--green)">✓</b>` : ` <b style="color:var(--red)">✗</b>`) : ""}</td>
        <td class="${w1 == null ? "sub" : w1 >= 0 ? "up" : "down"}">${w1 == null ? "–" : (w1 >= 0 ? "+" : "") + w1.toFixed(1) + "%"}</td>
      </tr>`;
    };
    const upcomingRow = (e) => {
      const d = companyOf(e.symbol);
      const o = oddsFor(e.symbol);
      const dd = daysTo(e.date);
      const topDriver = o && o.drivers.length ? o.drivers[0] : null;
      return `<tr ${d ? `data-tk="${e.symbol}"` : ""}>
        <td>${e.date}${e.dateEnd ? `<span class="sub">→${e.dateEnd.slice(5)}</span>` : ""}${e.estimated ? `<span class="sub" title="date is provider-estimated">*</span>` : ""} <span class="sub">${dd != null ? (dd === 0 ? "today" : dd + "d") : ""}</span></td>
        <td><span class="rk-tk">${e.symbol}</span> <span class="sub">${d ? d.sector : "market focus"}</span></td>
        <td class="sub">${earningsWhen(e.hour) || (e.source === "bundled" ? "time TBC" : "")}</td>
        <td>${e.epsEstimate != null ? "$" + (+e.epsEstimate).toFixed(2) : "–"}</td>
        <td>${e.revEstimate != null ? fmtRevEst(e.revEstimate) : "–"}</td>
        <td>${o ? oddsPillHtml(o) : "–"} ${o && o.score != null ? `<b style="color:${o.color};font-size:10px">${o.label}</b>` : ""}</td>
        <td class="sub" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${topDriver ? `${topDriver.label}: ${escapeHtml(topDriver.why)}` : ""}</td>
      </tr>`;
    };
    // sector read-through: which bars are being cleared this season
    const bySector = new Map();
    ledger.forEach(r => {
      const d = companyOf(r.symbol);
      if (!d || r.surprisePct == null) return;
      const etf = sectorETF(d.sector);
      if (!bySector.has(etf)) bySector.set(etf, []);
      bySector.get(etf).push(r);
    });
    const sectorRows = [...bySector.entries()].map(([etf, rows]) => {
      const avg = rows.reduce((a, r) => a + r.surprisePct, 0) / rows.length;
      const beats = rows.filter(r => r.surprisePct > 0).length;
      return { etf, n: rows.length, avg, beatShare: beats / rows.length, symbols: rows.map(r => r.symbol) };
    }).sort((a, b) => b.avg - a.avg);
    const bestOdds = upcoming.map(e => oddsFor(e.symbol)).filter(o => o && o.score != null && o.coverage >= 55)
      .sort((a, b) => b.score - a.score).slice(0, 8);

    el("main").innerHTML = `
      <div class="hdr">
        <div><div class="tick gradient-title">🎯 EARNINGS COMMAND CENTER</div>
        <div class="co">Beat/miss tape · Beat Odds on every upcoming report · macro regime + sector read-through, recomputed as results land</div></div>
        <div class="spacer"></div>
        <div style="text-align:right">
          <div class="sub">${live ? `⚡ LIVE AUTO-UPDATE${liveAge != null ? ` · synced ${liveAge < 90 ? liveAge + "s" : Math.round(liveAge / 60) + "m"} ago` : " · syncing…"}` : "BUNDLED MODE"}</div>
          <div class="stat sm" style="color:${live ? "var(--green)" : "var(--amber)"}">${live ? (inEarningsWindow() ? "REPORT WINDOW — polling fast" : "watching the tape") : asOf ? "pipeline " + asOf : "first refresh pending"}</div>
        </div>
      </div>
      ${!live ? `<div class="note" style="margin-bottom:12px">Bundled mode: the beat/miss ledger updates every weekday morning via the data pipeline. Add a <b>free Finnhub key</b> (⚙ gear) and this screen re-checks the tape automatically every few minutes — beats and misses appear the same session they are reported, with a flash alert.</div>` : ""}
      ${state.earnLive.error ? `<div class="note callout" style="margin-bottom:12px">${state.earnLive.error} — showing bundled data.</div>` : ""}
      <div class="grid g4" style="margin-bottom:12px">
        ${statCard("REPORTED THIS SEASON", card.reported, `${card.scored} with consensus on file`, "var(--cyan)")}
        ${statCard("EPS BEAT RATE", pctOrDash(card.beatRate), card.scored ? `${card.beats}/${card.scored} cleared the bar` : "no scored reports yet", card.beatRate == null ? "var(--dim)" : card.beatRate >= 0.6 ? "var(--green)" : card.beatRate >= 0.45 ? "var(--amber)" : "var(--red)")}
        ${statCard("AVG EPS SURPRISE", card.avgSurprise == null ? "–" : (card.avgSurprise >= 0 ? "+" : "") + card.avgSurprise.toFixed(1) + "%", card.revBeatRate != null ? `revenue beat rate ${pctOrDash(card.revBeatRate)}` : "vs consensus", card.avgSurprise == null ? "var(--dim)" : card.avgSurprise >= 0 ? "var(--green)" : "var(--red)")}
        ${statCard("MACRO REGIME", regime ? regime.label : "–", regime ? regime.bits[0] : "sector tape unavailable", regime ? regime.color : "var(--dim)")}
      </div>
      <div class="card" style="margin-bottom:12px;border-left:3px solid var(--green)">
        <h3>JUST REPORTED — THE BEAT/MISS TAPE <span class="unit">last 45 days · ⚡ = live actuals · ≈ = approximate date (qtr = fiscal quarter end; actuals on file prove the report)</span></h3>
        ${ledger.length ? `<div style="overflow-x:auto"><table class="rank">
          <thead><tr><th>DATE</th><th>TICKER</th><th>EPS RESULT</th><th>EPS ACT vs EST</th><th>REVENUE</th><th>1W TAPE</th></tr></thead>
          <tbody>${ledger.slice(0, 40).map(reportedRow).join("")}</tbody></table></div>`
        : `<div class="sub" style="padding:14px">No reported results in the window yet. ${live ? "The live tape will populate as companies report." : asOf ? "The daily pipeline stamps results as they appear." : "Run the data-refresh pipeline once to seed the ledger."}</div>`}
      </div>
      ${(() => {
        const drifts = ledger.map(r => ({ r, ds: driftScoreOf(r) })).filter(x => x.ds)
          .sort((a, b) => b.ds.score - a.ds.score);
        const actionable = drifts.filter(x => x.ds.label !== "NO CLEAR DRIFT");
        return `<div class="card" style="margin-bottom:12px;border-left:3px solid var(--gold)">
        <h3>DRIFT BOARD — POST-EARNINGS DRIFT (PEAD) <span class="unit">beats with confirmation tend to keep drifting for ~60 days (documented anomaly) · research signal, not advice</span></h3>
        ${actionable.length ? `<div style="overflow-x:auto"><table class="rank">
          <thead><tr><th>TICKER</th><th>REPORTED</th><th>DRIFT SCORE</th><th>SETUP</th><th>WINDOW LEFT</th><th>EVIDENCE</th></tr></thead>
          <tbody>${actionable.slice(0, 15).map(x => { const d = companyOf(x.r.symbol); return `<tr data-tk="${x.r.symbol}">
            <td><span class="rk-tk">${x.r.symbol}</span> <span class="sub">${d ? d.sector : ""}</span></td>
            <td class="sub">${x.r.date}${x.r.dateIsApprox ? "≈" : ""} (${x.ds.daysSince}d ago)</td>
            <td><span class="rk-pill" style="background:${x.ds.color};color:#071018">${x.ds.score}</span></td>
            <td><b style="color:${x.ds.color};font-size:10px">${x.ds.label}</b></td>
            <td><div class="meter" style="width:90px;margin-top:0"><i style="width:${Math.round((x.ds.windowLeft / 60) * 100)}%;background:${x.ds.color}"></i></div><span class="sub">${x.ds.windowLeft}d</span></td>
            <td class="sub" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${x.ds.bits.join(" · ")}</td>
          </tr>`; }).join("")}</tbody></table></div>
        <div class="sub" style="margin-top:8px">Drift = surprise size + revenue confirmation + post-report revisions + tape confirmation, decaying over the ~60-day research window. Beats that the market shrugged off score low — the anomaly needs confirmation, not hope.</div>`
        : `<div class="sub" style="padding:14px">No drift setups in the window — the board fills as season results land${live ? "" : " (or connect a Finnhub key for same-day results)"}.</div>`}
      </div>`;
      })()}
      <div class="card" style="margin-bottom:12px;border-left:3px solid var(--cyan)">
        <h3>UP NEXT — EVERY REPORT WITH ITS BEAT ODDS <span class="unit">next 3 weeks · odds are a research signal, not a probability · * = estimated date</span></h3>
        ${upcoming.length ? `<div style="overflow-x:auto"><table class="rank">
          <thead><tr><th>DATE</th><th>TICKER</th><th>WHEN</th><th>EPS EST</th><th>REV EST</th><th>BEAT ODDS</th><th>TOP DRIVER</th></tr></thead>
          <tbody>${upcoming.slice(0, 60).map(upcomingRow).join("")}</tbody></table></div>`
        : `<div class="sub" style="padding:14px">No upcoming reports on file for the next 3 weeks${asOf ? "" : " — the first pipeline run fills this"}.</div>`}
      </div>
      <div class="grid g2">
        <div class="card" style="border-left:3px solid var(--gold)">
          <h3>HIGHEST BEAT ODDS ON THE BOARD <span class="unit">upcoming reports · coverage ≥ 55%</span></h3>
          ${bestOdds.length ? bestOdds.map(o => `<div class="home-row" data-tk="${o.d.ticker}">
            <div><b>${o.d.ticker}</b><span>${o.d.sector}${o.intel && o.intel.nextDate ? " · " + o.intel.nextDate : ""}</span></div>
            <div class="sub">${o.drivers.map(p => `${p.label} ${Math.round(p.score)}`).join(" · ")}</div>
            <strong style="color:${o.color}">${o.score}</strong>
          </div>`).join("") : `<div class="sub" style="padding:14px">Not enough data coverage yet — odds appear once beat history and revision tape are bundled.</div>`}
        </div>
        <div class="card" style="border-left:3px solid var(--purple)">
          <h3>SECTOR READ-THROUGH <span class="unit">how each sector is clearing the bar this season — feeds peers' Beat Odds automatically</span></h3>
          ${sectorRows.length ? sectorRows.map(s => `<div class="home-row" data-sector="${s.etf}">
            <div><b>${s.etf}</b><span>${s.n} reported</span></div>
            <div class="sub">${Math.round(s.beatShare * 100)}% beat · ${s.symbols.slice(0, 6).join(", ")}</div>
            <strong class="${s.avg >= 0 ? "up" : "down"}">${s.avg >= 0 ? "+" : ""}${s.avg.toFixed(1)}%</strong>
          </div>`).join("") : `<div class="sub" style="padding:14px">Read-through builds as season results land.</div>`}
        </div>
      </div>
      <div class="card" style="margin-top:12px">
        <h3>HOW BEAT ODDS WORK — NO BLACK BOX</h3>
        <div class="sub" style="line-height:1.6">Six weighted, fully-inspectable components: <b>beat track record</b> (28) · <b>revision momentum</b> (24) · <b>pre-report tape</b> (14) · <b>sector read-through</b> (14, micro events — peers' results flow in automatically) · <b>macro regime</b> (10, computed from the live sector/SPY tape, never a hardcoded snapshot) · <b>expectation bar</b> (10, how demanding the consensus ask is vs the filed trend). Missing inputs stay missing and reduce coverage — they are never scored as neutral 50. Open any ticker's EARNINGS tab for its full component breakdown. This is a research signal, not investment advice.</div>
      </div>`;
    el("main").querySelectorAll("[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
    el("main").querySelectorAll("[data-sector]").forEach(r => r.onclick = () => { state.secOn.add(r.dataset.sector); showSectors(); });
    if (live && !state.earnLive.fetchedAt) {
      // first paint fired the fetch above; repaint once the tape arrives
      const t = setInterval(() => {
        if (state.view !== "calendar") { clearInterval(t); return; }
        if (state.earnLive.fetchedAt || state.earnLive.error) { clearInterval(t); renderEarningsCmd(); }
      }, 600);
    }
  }
  const showCalendar = () => { showView("calendar", renderEarningsCmd, "calBtn"); startEarningsAutoPoll(); };


  /* ============================================================================
     📈 TIME MACHINE — tickers moving over time + social sentiment.
     Everything here is real: 53 weeks of Yahoo weekly closes bundled per name
     (d.px.v), plus the Stocktwits sentiment stream / day-over-day log. Nothing
     is synthesized; a name without price history is simply skipped.
     ============================================================================ */
  // Grid-preserving: a missing weekly close stays null in place so index->date
  // never slides. Consumers use the first/last FINITE value and skip null gaps.
  const pxVals = (d) => (d && d.px && Array.isArray(d.px.v)) ? d.px.v.map(v => Number.isFinite(v) ? v : null) : null;
  const firstFinite = (a) => { for (const v of a) if (Number.isFinite(v)) return v; return null; };
  const lastFinite = (a) => { for (let i = a.length - 1; i >= 0; i--) if (Number.isFinite(a[i])) return a[i]; return null; };
  function pxWindowSlice(d, weeks) {
    const v = pxVals(d);
    if (!v || v.length < 3) return null;
    return v.slice(Math.max(0, v.length - 1 - weeks));
  }
  // A series covers the requested window only if its grid reaches back far
  // enough. A recent listing with 20 weeks must NOT be ranked as a "1Y" return.
  const pxCovers = (s, weeks) => s && (s.length - 1) >= weeks * 0.9;
  function pxReturn(d, weeks) {
    const s = pxWindowSlice(d, weeks);
    if (!s || !pxCovers(s, weeks)) return null;
    const a = firstFinite(s), b = lastFinite(s);
    if (a == null || b == null || a <= 0) return null;
    return (b / a - 1) * 100;
  }
  function pxNormalized(d, weeks) {
    const s = pxWindowSlice(d, weeks);
    if (!s || !pxCovers(s, weeks)) return null;
    const base = firstFinite(s);
    if (base == null || base <= 0) return null;
    return s.map(v => Number.isFinite(v) ? +(((v / base) - 1) * 100).toFixed(2) : null);
  }
  function tmDateLabels(weeks, n = 5) {
    // Anchor the date axis to the LONGEST valid series so every plotted series
    // is <= the axis length and only ever gets left-padded, never front-sliced
    // (which would drop its 0% baseline).
    const ref = DATA.filter(d => d.px && d.px.to && pxVals(d) && pxVals(d).length >= 2)
      .sort((a, b) => pxVals(b).length - pxVals(a).length)[0];
    if (!ref) return [];
    const total = pxVals(ref).length;
    const start = Math.max(0, total - 1 - weeks);
    const count = total - start;
    const toParts = ref.px.to.split("-").map(Number);
    const toMs = Date.UTC(toParts[0], toParts[1] - 1, toParts[2]);
    const every = Math.max(1, Math.ceil(count / n));
    const out = [];
    for (let i = 0; i < count; i++) {
      const idxFromEnd = count - 1 - i;
      const dt = new Date(toMs - idxFromEnd * 7 * 864e5);
      out.push((i % every === 0 || i === count - 1) ? `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}` : "");
    }
    return out;
  }


  /* ------------------------ EST OWNER-EARNINGS P/E SCREENER view ------------------------ */
  const medianOf = (arr) => { const a = arr.filter(v => v != null).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const bucketColor = (b) => BUCKETS[b].color;


  const DAILY_SECTOR_LENS = {
    SMH: { watch: "AI capex, compute supply, export controls, memory/equipment read-through", tickers: ["NVDA", "AMD", "AVGO", "ASML", "AMAT", "LRCX", "SMCI", "NBIS", "IREN"] },
    XLK: { watch: "rate pressure, software budgets, cloud demand, AI monetization", tickers: ["MSFT", "ORCL", "ADBE", "CRM", "NOW", "PLTR", "CRWD"] },
    XLC: { watch: "ads, engagement, AI platform spend, regulation", tickers: ["META", "GOOGL", "NFLX", "DIS"] },
    XLY: { watch: "consumer demand, credit stress, autos, travel, restaurants", tickers: ["AMZN", "TSLA", "BKNG", "UBER", "MCD", "CMG"] },
    XLP: { watch: "food inflation, private-label trade-down, margin pass-through", tickers: ["WMT", "COST", "KO", "PG", "PEP"] },
    XLF: { watch: "rates, credit, capital markets, consumer charge-offs", tickers: ["JPM", "GS", "MS", "WFC", "AXP", "V", "MA"] },
    XLV: { watch: "managed-care margins, trial/regulatory headlines, defensive rotation", tickers: ["UNH", "JNJ", "LLY", "ABBV", "ISRG"] },
    XLE: { watch: "oil/gas move, inflation impulse, demand destruction risk", tickers: ["XOM", "CVX"] },
    XLI: { watch: "orders, backlog, labor/freight inflation, capex cycle", tickers: ["CAT", "GE", "AXON"] },
    XLB: { watch: "commodity spreads, China demand, input-cost pass-through", tickers: [] },
    XLRE: { watch: "rates, cap rates, financing stress", tickers: [] },
    XLU: { watch: "rates, power demand, AI data-center load growth", tickers: [] },
  };

  function dailySectorTape() {
    const groups = {};
    DATA.forEach(d => {
      const etf = sectorETF(d.sector);
      const s = secByT(etf) || { t: etf, name: etf, color: "var(--cyan)" };
      groups[etf] = groups[etf] || { etf, name: s.name || etf, color: s.color || "var(--cyan)", members: [] };
      groups[etf].members.push({ d, ch: quoteChangeOf(d), weight: Math.max(1, d.mktCap || 1) });
    });
    return Object.values(groups).map(g => {
      const totalW = g.members.reduce((a, x) => a + x.weight, 0) || g.members.length || 1;
      const avg = g.members.reduce((a, x) => a + x.ch, 0) / (g.members.length || 1);
      const weighted = g.members.reduce((a, x) => a + x.ch * x.weight, 0) / totalW;
      const up = g.members.filter(x => x.ch >= 0).length;
      const sorted = [...g.members].sort((a, b) => Math.abs(b.ch) - Math.abs(a.ch));
      return {
        ...g,
        avg: +avg.toFixed(2),
        weighted: +weighted.toFixed(2),
        move: +weighted.toFixed(2),
        breadth: Math.round((up / (g.members.length || 1)) * 100),
        top: sorted.slice(0, 5),
        sectors: new Set(g.members.map(x => x.d.sector)),
      };
    }).sort((a, b) => Math.abs(b.move) - Math.abs(a.move));
  }

  function dailyHeadlineRows() {
    const seen = new Set();
    return Object.keys(state.live).flatMap(tk => analyzedNewsForTicker(tk).map(a => ({ ...a, sourceTicker: tk })))
      .filter(a => {
        const key = (a.url || a.headline || "") + "|" + a.sourceTicker;
        if (!a.headline || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || (b.datetime || 0) - (a.datetime || 0));
  }

  function dailyDriverForSector(sec) {
    const sectorTickers = new Set(sec.members.map(x => x.d.ticker));
    const sectorNames = sec.sectors || new Set();
    const rows = dailyHeadlineRows().filter(a => {
      const sourceHit = sectorTickers.has(a.sourceTicker) || sectorTickers.has(a.ticker);
      const affectedHit = a.tickers.some(tk => sectorTickers.has(tk));
      const industryHit = a.industries.some(ind => sectorNames.has(ind));
      return sourceHit || affectedHit || industryHit;
    });
    const signAligned = (a) => (sec.move < 0 && a.score < 0) || (sec.move > 0 && a.score > 0) ? 1 : 0;
    return rows.sort((a, b) => signAligned(b) - signAligned(a) || Math.abs(b.score) - Math.abs(a.score) || (b.datetime || 0) - (a.datetime || 0))[0] || null;
  }

  function dailyReviewFocusTickers() {
    const seen = new Set();
    const out = [];
    const add = (tk) => { if (companyOf(tk) && !seen.has(tk)) { seen.add(tk); out.push(tk); } };
    dailySectorTape().slice(0, 3).forEach(s => {
      s.top.slice(0, 4).forEach(x => add(x.d.ticker));
      (DAILY_SECTOR_LENS[s.etf]?.tickers || []).slice(0, 3).forEach(add);
    });
    [...DATA].sort((a, b) => Math.abs(quoteChangeOf(b)) - Math.abs(quoteChangeOf(a))).slice(0, 8).forEach(d => add(d.ticker));
    return out.slice(0, 12);
  }

  function dailyReviewModel() {
    const sectors = dailySectorTape();
    const worst = [...sectors].sort((a, b) => a.move - b.move)[0] || null;
    const best = [...sectors].sort((a, b) => b.move - a.move)[0] || null;
    const focus = worst && best ? (Math.abs(worst.move) >= Math.abs(best.move) ? worst : best) : (worst || best);
    const driver = focus ? dailyDriverForSector(focus) : null;
    const moveWord = !focus ? "mixed" : focus.move < -0.15 ? "fell" : focus.move > 0.15 ? "rose" : "was flat";
    const why = driver
      ? `because ${driver.narrative.toLowerCase()} hit the tape`
      : state.keys.finnhub
        ? state.dailyReviewLoading ? "while headline scan is still running" : "with no scored headline driver loaded yet"
        : "from price tape only; connect Finnhub for headline drivers";
    const headline = focus ? `${focus.name} ${moveWord} ${focus.move >= 0 ? "+" : ""}${focus.move.toFixed(2)}% ${why}.` : "Market tape is unavailable.";
    const marketMove = DATA.reduce((a, d) => a + quoteChangeOf(d) * Math.max(1, d.mktCap || 1), 0) /
      (DATA.reduce((a, d) => a + Math.max(1, d.mktCap || 1), 0) || 1);
    return {
      sectors, worst, best, focus, driver, headline,
      marketMove: +marketMove.toFixed(2),
      newsRows: dailyHeadlineRows(),
      asOf: new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    };
  }

  function dailyTickerChips(tickers) {
    const seen = new Set();
    return (tickers || []).filter(tk => companyOf(tk) && !seen.has(tk) && seen.add(tk)).slice(0, 10)
      .map(tk => `<span class="impact-chip impact-tk" data-tk="${tk}">${tk}</span>`).join("");
  }

  function dailySectorRow(s) {
    const driver = dailyDriverForSector(s);
    const lens = DAILY_SECTOR_LENS[s.etf] || { watch: "confirm whether news, rates, earnings or positioning drove the move", tickers: [] };
    const affected = driver ? driver.tickers : s.top.map(x => x.d.ticker).concat(lens.tickers || []);
    const tone = s.move < -0.15 ? "Pressure" : s.move > 0.15 ? "Strength" : "Flat";
    return `<div class="daily-sector" data-sector="${s.etf}" style="border-left-color:${s.color}">
      <div>
        <div class="daily-sector-title">${escapeHtml(s.name)} <span>${s.etf}</span></div>
        <div class="sub">${tone} - breadth ${s.breadth}% up - watch ${escapeHtml(lens.watch)}</div>
        ${driver ? `<div class="sub" style="margin-top:5px;color:${driver.color}">${driver.score > 0 ? "+" : ""}${driver.score} ${escapeHtml(driver.narrative)} - ${escapeHtml(driver.headline).slice(0, 130)}</div>` : `<div class="sub" style="margin-top:5px">No scored headline attached yet. The move is coming from the price tape.</div>`}
        <div style="margin-top:7px">${dailyTickerChips(affected)}</div>
      </div>
      <div class="daily-move ${signCls(s.move)}">${s.move >= 0 ? "+" : ""}${s.move.toFixed(2)}%<span>${s.top.map(x => x.d.ticker + " " + (x.ch >= 0 ? "+" : "") + x.ch.toFixed(1) + "%").join(" / ")}</span></div>
    </div>`;
  }

  function dailyReviewPreviewCard() {
    const R = dailyReviewModel();
    const f = R.focus;
    const color = f?.color || "var(--cyan)";
    return `<div class="card daily-review-card" style="grid-column:span 2;border-left:3px solid ${color}">
      <h3>DAILY REVIEW <span class="unit">${R.asOf} - ${liveHeaderStatus()}</span></h3>
      <div class="daily-headline">${escapeHtml(R.headline)}</div>
      <div class="daily-mini-grid">
        <div><span>Market tape</span><b class="${signCls(R.marketMove)}">${R.marketMove >= 0 ? "+" : ""}${R.marketMove.toFixed(2)}%</b></div>
        <div><span>Strongest</span><b class="${signCls(R.best?.move || 0)}">${R.best ? `${R.best.etf} ${R.best.move >= 0 ? "+" : ""}${R.best.move.toFixed(1)}%` : "--"}</b></div>
        <div><span>Weakest</span><b class="${signCls(R.worst?.move || 0)}">${R.worst ? `${R.worst.etf} ${R.worst.move >= 0 ? "+" : ""}${R.worst.move.toFixed(1)}%` : "--"}</b></div>
      </div>
      <button class="action-btn" id="openDailyReview" type="button">OPEN DAILY REVIEW</button>
    </div>`;
  }

  function renderDailyReview() {
    const R = dailyReviewModel();
    const focusColor = R.focus?.color || "var(--cyan)";
    const newsStatus = !state.keys.finnhub
      ? "Connect Finnhub to attach live headline drivers"
      : state.dailyReviewLoading
        ? "Scanning focused movers for headline drivers..."
        : state.dailyReviewFetchedAt
          ? `Headline scan ${Math.round((Date.now() - state.dailyReviewFetchedAt) / 60000)}m ago`
          : "Headlines not scanned yet";
    const drivers = R.newsRows.slice(0, 8).map(a => `<a class="news-item" href="${a.url}" target="_blank" rel="noopener">${newsAnalysisRow(a)}</a>`).join("");
    el("main").innerHTML = `
      <div class="hdr">
        <div>
          <div class="tick gradient-title">DAILY REVIEW</div>
          <div class="co">market recap - sector moves - headline drivers - affected tickers</div>
        </div>
        <div class="spacer"></div>
        <div style="text-align:right">
          <div class="sub">AS OF</div>
          <div class="stat sm" style="color:var(--cyan)">${R.asOf}</div>
        </div>
      </div>
      <div class="card daily-review-card" style="margin-bottom:12px;border-left:3px solid ${focusColor}">
        <h3>TODAY'S TAPE <span class="unit">${liveStatusText()}</span></h3>
        <div class="daily-headline">${escapeHtml(R.headline)}</div>
        <div class="daily-mini-grid">
          <div><span>Market tape</span><b class="${signCls(R.marketMove)}">${R.marketMove >= 0 ? "+" : ""}${R.marketMove.toFixed(2)}%</b></div>
          <div><span>Strongest sector</span><b class="${signCls(R.best?.move || 0)}">${R.best ? `${R.best.name} ${R.best.move >= 0 ? "+" : ""}${R.best.move.toFixed(2)}%` : "--"}</b></div>
          <div><span>Weakest sector</span><b class="${signCls(R.worst?.move || 0)}">${R.worst ? `${R.worst.name} ${R.worst.move >= 0 ? "+" : ""}${R.worst.move.toFixed(2)}%` : "--"}</b></div>
          <div><span>News layer</span><b style="color:${state.keys.finnhub ? "var(--cyan)" : "var(--orange)"}">${escapeHtml(newsStatus)}</b></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="action-btn" id="scanDailyNews" type="button">SCAN HEADLINES</button>
          <button class="ghost-btn" id="dailyRefreshPrices" type="button">REFRESH PRICES</button>
        </div>
      </div>
      <div class="grid g2">
        <div class="card" style="border-left:3px solid var(--cyan)">
          <h3>SECTOR RECAP <span class="unit">grouped by terminal universe, market-cap weighted</span></h3>
          ${R.sectors.map(dailySectorRow).join("")}
        </div>
        <div class="card news-impact">
          <h3>HEADLINE DRIVERS <span class="unit">${R.newsRows.length ? "scored live headlines" : "none loaded"}</span></h3>
          ${drivers || `<div class="note">No live headline drivers are loaded for the recap. Connect Finnhub or press SCAN HEADLINES; the price tape still shows which sectors moved.</div>`}
        </div>
    </div>`;
    el("main").querySelectorAll("[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
    el("main").querySelectorAll("[data-news-tk]").forEach(r => r.onclick = (e) => { e.preventDefault(); e.stopPropagation(); selectTicker(r.dataset.newsTk); });
    el("main").querySelectorAll("[data-sector]").forEach(r => r.onclick = () => { state.secOn.add(r.dataset.sector); showSectors(); });
    el("scanDailyNews").onclick = () => {
      if (!state.keys.finnhub) {
        flash("Connect Finnhub to scan headline drivers", "err");
        el("gearBtn").click();
        return;
      }
      loadDailyReviewNews(true);
    };
    el("dailyRefreshPrices").onclick = () => refreshAllLive({ silent: false });
  }

  function showDailyReview() {
    state.view = "dailyReview";
    setViewBtn("dailyBtn");
    renderWatchlist();
    renderDailyReview();
    closeDrawer();
    window.scrollTo({ top: 0 });
    syncNav();
    pushNav();
    loadDailyReviewNews(false);
  }

  function directionUniverse() {
    return DATA.map(d => ({ d, e: directionEdgeOf(d), m: marketScoreOf(d), r: rankOf(d) }));
  }
  function directionListRow(x) {
    const L = x.e.L;
    const px = priceOf(x.d);
    const buy = L && L.IV15 ? "$" + L.IV15.toFixed(L.IV15 >= 100 ? 0 : 2) : "--";
    const gap = L && L.IV15 && px ? ((L.IV15 / px) - 1) * 100 : null;
    const gapTxt = gap == null ? "buy zone n/a" : `${gap >= 0 ? "+" : ""}${gap.toFixed(0)}% to IV15`;
    return `<div class="edge-row" data-tk="${x.d.ticker}" style="border-left-color:${x.e.color}">
      <div>
        <b>${x.d.ticker}</b><span>${x.d.sector} - ${x.d.name}</span>
        <small>${escapeHtml(x.e.action)} - ${gapTxt}</small>
      </div>
      <div class="edge-row-mid">
        <span>coverage ${x.e.coverage}%</span>
        <span>BQ ${x.m?.businessQuality?.score ?? "--"} / MR ${x.m?.marketReward?.score ?? "--"}</span>
        <span>buy ${buy}</span>
      </div>
      <strong style="color:${x.e.color}">${x.e.score}<small>${x.e.label}</small></strong>
    </div>`;
  }
  function directionSection(title, arr, sub, color) {
    return `<div class="card" style="border-left:3px solid ${color}">
      <h3>${title} <span class="unit">${sub} - ${arr.length} names</span></h3>
      ${arr.length ? arr.slice(0, 12).map(directionListRow).join("") : `<div class="note">No names qualify right now.</div>`}
    </div>`;
  }
  function directionEdgePreviewCard() {
    const rows = directionUniverse();
    const ranked = rows.filter(x => x.e.coverage >= 45);
    const up = [...ranked].sort((a, b) => b.e.score - a.e.score)[0];
    const down = [...ranked].sort((a, b) => a.e.score - b.e.score)[0];
    const noEdge = rows.filter(x => x.e.label === "NO EDGE" || x.e.label === "LOW CONFIDENCE").length;
    return `<div class="card edge-card" style="grid-column:span 2;border-left:3px solid var(--cyan)">
      <h3>DIRECTION EDGE <span class="unit">up/down research signal - coverage aware</span></h3>
      <div class="daily-headline">${up ? `${up.d.ticker} has the best current upside setup (${up.e.score}/100).` : "No high-coverage upside setup loaded yet."}</div>
      <div class="daily-mini-grid">
        <div><span>Best up setup</span><b style="color:${up?.e.color || "var(--dim)"}">${up ? `${up.d.ticker} ${up.e.score}` : "--"}</b></div>
        <div><span>Weakest setup</span><b style="color:${down?.e.color || "var(--dim)"}">${down ? `${down.d.ticker} ${down.e.score}` : "--"}</b></div>
        <div><span>No edge / low conf</span><b style="color:var(--amber)">${noEdge}</b></div>
        <div><span>Source gaps</span><b style="color:var(--orange)">${rows.filter(x => x.e.missing.length).length}</b></div>
      </div>
      <button class="action-btn" id="openDirectionEdge" type="button">OPEN DIRECTION EDGE</button>
    </div>`;
  }
  function renderDirectionEdge() {
    const rows = directionUniverse();
    const highCov = rows.filter(x => x.e.coverage >= 45);
    const up = highCov.filter(x => x.e.score >= 57).sort((a, b) => b.e.score - a.e.score);
    const down = highCov.filter(x => x.e.score <= 43).sort((a, b) => a.e.score - b.e.score);
    const wait = [...rows].filter(x => x.e.score > 43 && x.e.score < 57 || x.e.coverage < 45)
      .sort((a, b) => (a.e.coverage - b.e.coverage) || Math.abs(a.e.score - 50) - Math.abs(b.e.score - 50));
    const best = [...highCov].sort((a, b) => b.e.score - a.e.score)[0];
    const weakest = [...highCov].sort((a, b) => a.e.score - b.e.score)[0];
    const missingEst = rows.filter(x => x.e.parts.find(p => p.key === "estimates" && p.score == null)).length;
    const missingNews = rows.filter(x => x.e.parts.find(p => p.key === "news" && p.score == null)).length;
    const missingOpt = rows.filter(x => x.e.parts.find(p => p.key === "options" && p.score == null)).length;
    el("main").innerHTML = `
      <div class="hdr">
        <div>
          <div class="tick gradient-title">DIRECTION EDGE</div>
          <div class="co">near-term up/down research score - estimates, momentum, sector tape, news, options, valuation, quality, macro</div>
        </div>
        <div class="spacer"></div>
        <div style="text-align:right"><div class="sub">BEST UP SETUP</div><div class="stat sm" style="color:${best?.e.color || "var(--dim)"}">${best?.d.ticker || "--"}</div></div>
        <div style="text-align:right;border-left:1px solid var(--line);padding-left:16px"><div class="sub">WEAKEST SETUP</div><div class="stat sm" style="color:${weakest?.e.color || "var(--dim)"}">${weakest?.d.ticker || "--"}</div></div>
      </div>
      <div class="grid g4 home-metrics" style="margin-bottom:12px">
        <div class="card"><h3>LIKELY UP / UP BIAS</h3><div class="stat" style="color:var(--green)">${up.length}</div><div class="sub">score >=57 and coverage >=45%</div></div>
        <div class="card"><h3>LIKELY DOWN / DOWN BIAS</h3><div class="stat" style="color:var(--red)">${down.length}</div><div class="sub">score <=43 and coverage >=45%</div></div>
        <div class="card"><h3>NO EDGE / LOW CONF</h3><div class="stat" style="color:var(--amber)">${wait.length}</div><div class="sub">wait for cleaner evidence</div></div>
        <div class="card"><h3>SOURCE GAPS</h3><div class="stat" style="color:var(--orange)">${missingEst}/${missingNews}/${missingOpt}</div><div class="sub">estimates / news / options missing</div></div>
      </div>
      <div class="note" style="margin-bottom:12px;border-left-color:var(--cyan)">This is a research-priority signal, not a price forecast. Biggest edge comes when estimate revisions, price action, sector flow and news all point the same way. If coverage is low, treat the score as a watchlist flag only.</div>
      <div class="grid g2">
        ${directionSection("LIKELY UP NOW", up, "constructive evidence stack", "var(--green)")}
        ${directionSection("LIKELY DOWN / AVOID", down, "weak evidence stack", "var(--red)")}
        ${directionSection("NO EDGE - WAIT", wait, "mixed or missing evidence", "var(--amber)")}
        <div class="card">
          <h3>FULL BOARD <span class="unit">${rows.length} names - sorted by direction score</span></h3>
          <div style="overflow-x:auto;max-height:58vh;overflow-y:auto"><table class="rank">
            <thead><tr><th>TICKER</th><th>DIRECTION</th><th>SCORE</th><th>COVERAGE</th><th>BUY PRICE</th><th>PRICE</th><th>DRIVER</th></tr></thead>
            <tbody>${[...rows].sort((a, b) => b.e.score - a.e.score).map(x => {
              const L = x.e.L;
              const driver = x.e.parts.filter(p => p.score != null).sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50))[0];
              return `<tr data-tk="${x.d.ticker}"><td><span class="rk-tk">${x.d.ticker}</span> <span class="sub">${x.d.sector}</span></td>
                <td style="color:${x.e.color};font-weight:800">${x.e.label}</td>
                <td>${x.e.score}</td><td>${x.e.coverage}%</td>
                <td>${L && L.IV15 ? "$" + L.IV15.toFixed(L.IV15 >= 100 ? 0 : 2) : "--"}</td>
                <td>$${priceOf(x.d).toFixed(priceOf(x.d) >= 100 ? 0 : 2)}</td>
                <td class="sub">${driver ? escapeHtml(driver.label + ": " + driver.why).slice(0, 90) : "--"}</td></tr>`;
            }).join("")}</tbody>
          </table></div>
        </div>
      </div>`;
    el("main").querySelectorAll("[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
  }
  function showDirectionEdge() {
    showView("directionEdge", renderDirectionEdge, "edgeBtn");
  }

  function renderHomeMobileDashboard() {
    const scored = DATA.map(d => ({ d, m: marketScoreOf(d), r: rankOf(d), f: forwardPEOf(d) }));
    const ranked = scored.filter(x => !x.r.noRank);
    const combo = (x) => Math.round(((x.m?.businessQuality?.score || 0) + (x.m?.marketReward?.score || 0)) / 2);
    const leaders = [...ranked].sort((a, b) => combo(b) - combo(a)).slice(0, 6);
    const buyList = [...ranked].map(x => ({ ...x, L: ivLadder(x.d) }))
      .filter(x => x.L && (x.m?.businessQuality?.score || 0) >= 60)
      .sort((a, b) => (b.m.businessQuality.score - a.m.businessQuality.score) || ((b.L.IV15 / b.L.price) - (a.L.IV15 / a.L.price)))
      .slice(0, 8);
    const cheap = [...ranked].filter(x => x.r.truePE).sort((a, b) => a.r.truePE - b.r.truePE).slice(0, 6);
    const hot = [...ranked].filter(x => x.r.truePE).sort((a, b) => (b.r.truePE || 0) - (a.r.truePE || 0)).slice(0, 6);
    // Freshness-consistent movers: mixing a few live intraday quotes with the
    // morning snapshot for everyone else makes the movers list "whichever names
    // happened to refresh". Until live coverage is broad, rank AND display every
    // name on the same morning-snapshot basis, and say so.
    const liveCoverage = DATA.filter(d => state.live[d.ticker]?.quote).length;
    const broadLive = liveCoverage >= 40;
    const moverChange = (d) => broadLive ? quoteChangeOf(d) : (Number.isFinite(+d.change) ? +d.change : 0);
    const moverPrice = (d) => broadLive ? quotePriceOf(d) : (Number.isFinite(+d.price) && +d.price > 0 ? +d.price : null);
    const moverBasis = broadLive ? "live" : "morning snapshot";
    const movers = [...DATA].sort((a, b) => Math.abs(moverChange(b)) - Math.abs(moverChange(a))).slice(0, 6);
    const sectors = SECTORS.series.filter(s => s.t !== "SPY").map(s => ({ s, r3: retOver(s, 3), fd: flowDelta(s) }))
      .sort((a, b) => b.r3 - a.r3).slice(0, 5);
    const medianPE = medianOf(ranked.map(x => x.r.truePE).filter(Boolean));
    const fat = ranked.filter(x => x.r.zone === "fat").length;
    const R = dailyReviewModel();
    const today = new Date();
    const homeDate = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const fmtPx = (v) => v == null || !Number.isFinite(+v) ? "--" : "$" + (+v).toFixed(2);
    const pct = (v, d = 2) => `${v >= 0 ? "+" : ""}${(+v).toFixed(d)}%`;
    const marketTiles = ["SPY", "SMH", "XLK"].map(t => secByT(t)).filter(Boolean).map(s => ({
      t: s.t,
      name: s.name,
      px: s.closes[s.closes.length - 1],
      move: retOver(s, 1),
      color: s.color || "var(--cyan)",
    }));
    const gainers = [...DATA].filter(d => moverChange(d) > 0).sort((a, b) => moverChange(b) - moverChange(a)).slice(0, 3);
    const losers = [...DATA].filter(d => moverChange(d) < 0).sort((a, b) => moverChange(a) - moverChange(b)).slice(0, 3);
    const stockDay = leaders[0] || ranked[0];
    let earningsRows = upcomingEarningsRows(21);
    if (!earningsRows.length) {
      const asOf = new Date(`${EARNINGS_FOCUS.asOf}T00:00:00`);
      earningsRows = bundledEarningsRows(asOf, new Date(asOf.getTime() + 33 * 864e5), true);
    }
    earningsRows = earningsRows.slice(0, 4);
    const row = (x, right, sub = "") => `<div class="home-row" data-tk="${x.d.ticker}">
      <div><b>${x.d.ticker}</b><span>${x.d.sector}</span></div>
      <div class="sub">${sub || x.m?.finalLabel?.label || ""}</div>
      <strong>${right}</strong>
    </div>`;
    const buyRow = (x) => {
      const great = x.L.IV15, starter = x.L.IV12, px = x.L.price;
      const gap = great / px - 1;
      return `<div class="home-row buy-row" data-tk="${x.d.ticker}">
        <div><b>${x.d.ticker}</b><span>BQ ${x.m.businessQuality.score} &middot; ${x.d.sector}</span></div>
        <div class="sub">now $${px.toFixed(px >= 100 ? 0 : 2)} &middot; starter $${starter.toFixed(starter >= 100 ? 0 : 2)}</div>
        <strong class="${gap >= 0 ? "up" : "down"}">$${great.toFixed(great >= 100 ? 0 : 2)}</strong>
      </div>`;
    };
    const moverRow = (d) => {
      const ch = quoteChangeOf(d);
      return `<div class="home-row" data-tk="${d.ticker}">
        <div><b>${d.ticker}</b><span>${d.sector}</span></div>
        <div class="sub">${d.name}</div>
        <strong class="${signCls(ch)}">${arrow(ch)}${Math.abs(ch).toFixed(2)}%</strong>
      </div>`;
    };
    const moverCompact = (d) => {
      const ch = moverChange(d);
      return `<div class="bz-mover" data-tk="${d.ticker}">
        <div><b>${d.ticker}</b><span>${escapeHtml(d.name)}</span></div>
        <div class="bz-spark">${miniSpark(d)}</div>
        <strong>${fmtPx(moverPrice(d))}<span class="${signCls(ch)}">${pct(ch)}</span></strong>
      </div>`;
    };
    const marketTile = (x) => `<button class="bz-index-tile" data-sector="${x.t}" type="button" style="--tile:${x.color}">
      <b>${x.t}</b><span>${fmtPx(x.px)}</span><em class="${signCls(x.move)}">${pct(x.move, 1)} 1M</em>
    </button>`;
    const storyAge = (a) => {
      if (!a.datetime) return "latest";
      const ms = a.datetime > 1e12 ? a.datetime : a.datetime * 1000;
      const hrs = Math.max(1, Math.round((Date.now() - ms) / 36e5));
      return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
    };
    const liveStories = R.newsRows.slice(0, 4).map(a => ({
      headline: a.headline,
      sub: a.narrative || "Scored headline driver",
      tickers: [...new Set([...(a.tickers || []), a.ticker, a.sourceTicker].filter(Boolean))].slice(0, 5),
      score: a.score || 0,
      age: storyAge(a),
    }));
    const seenSectors = new Set();
    const fallbackStories = [R.focus, R.worst, R.best].filter(s => s && !seenSectors.has(s.etf) && seenSectors.add(s.etf)).map(s => {
      const driver = dailyDriverForSector(s);
      const lens = DAILY_SECTOR_LENS[s.etf] || {};
      const down = s.move < 0;
      return {
        headline: driver ? driver.headline : `${s.name} ${down ? "is under pressure" : "is leading"} ${pct(s.move)} as the tape reprices ${lens.watch || "sector fundamentals"}.`,
        sub: driver ? driver.narrative : (lens.watch || "Price tape driver"),
        tickers: s.top.slice(0, 5).map(x => x.d.ticker),
        score: Math.round(s.move * 10),
        age: "price tape",
      };
    });
    const stories = (liveStories.length ? liveStories : fallbackStories).slice(0, 4);
    const storyCard = (s) => `<div class="bz-news-card" ${s.tickers[0] ? `data-tk="${s.tickers[0]}"` : ""}>
      <h3>${escapeHtml(s.headline || "No headline loaded yet")}</h3>
      <div class="bz-news-meta"><span>${escapeHtml(s.age)}</span><span class="${signCls(s.score)}">${s.score >= 0 ? "+" : ""}${Math.round(s.score)} impact</span></div>
      <p>${escapeHtml(s.sub || "Open Daily Review for sector context and affected tickers.")}</p>
      <div class="bz-chips">${s.tickers.map(tk => `<button type="button" data-tk="${tk}">${tk}</button>`).join("")}</div>
    </div>`;
    const earningsRow = (e) => {
      const d = companyOf(e.symbol), o = d ? beatOddsOf(d) : null;
      const eps = hasNum(e.epsEstimate) ? +e.epsEstimate : d && hasNum(d.forwardEPS) ? +d.forwardEPS : null;
      return `<div class="bz-earn-row" ${d ? `data-tk="${e.symbol}"` : ""}>
        <div><b>${e.symbol}</b><span>${escapeHtml(e.name || d?.name || "")}</span></div>
        <div><span>${e.date}</span><em>${earningsWhen(e.hour) || "time n/a"}</em></div>
        <div><span>EPS EST</span><b>${eps == null ? "--" : "$" + eps.toFixed(2)}</b></div>
        <strong style="color:${o?.color || "var(--muted)"}">${o && o.score != null ? o.score : "--"}<span>${o && o.score != null ? "BEAT ODDS" : "focus"}</span></strong>
      </div>`;
    };
    const analystRows = [...ranked].filter(x => x.f.pe != null).sort((a, b) => combo(b) - combo(a)).slice(0, 4);
    const analystRow = (x) => `<div class="bz-rating-row" data-tk="${x.d.ticker}">
      <div><b>${x.d.ticker}</b><span>${x.d.sector}</span></div>
      <div><span>FWD P/E</span><b>${x.f.pe.toFixed(1)}x</b></div>
      <div><span>BQ + MR</span><b>${combo(x)}</b></div>
      <strong class="${signCls(quoteChangeOf(x.d))}">${pct(quoteChangeOf(x.d))}</strong>
    </div>`;
    el("main").innerHTML = `
      <div class="bz-home">
        <section class="bz-hero">
          <div>
            <div class="bz-kicker">SBC TERMINAL</div>
            <h1>HOME DASHBOARD</h1>
            <p>Daily tape, movers, earnings, buy prices, and owner-economics edge. ${DATA.length} official names, ${ranked.length} ranked. <span class="sub">build v${SHELL_BUILD}</span></p>
          </div>
          <button class="bz-best" type="button" ${stockDay ? `data-tk="${stockDay.d.ticker}"` : ""}>
            <span>BEST SETUP</span><b>${stockDay?.d.ticker || "--"}</b><em>${stockDay ? `BQ ${stockDay.m.businessQuality.score} / MR ${stockDay.m.marketReward.score}` : "n/a"}</em>
          </button>
        </section>
        <div class="bz-index-strip">${marketTiles.map(marketTile).join("")}</div>
        <section class="bz-panel bz-movers-panel">
          <div class="bz-section-head"><h2>Watchlist Movers <span class="unit" style="font-weight:600">${moverBasis} · ${liveCoverage}/${DATA.length} live</span></h2><button id="openAllMovers" type="button">View All Movers</button></div>
          <div class="note" style="margin:-4px 0 10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <button id="homeRefreshPrices" type="button" style="cursor:pointer;background:none;border:1px solid var(--line);border-radius:6px;padding:3px 10px;color:var(--cyan)">↻ Refresh prices</button>
            <span id="homeLiveStatus" class="sub">${state.liveStatus.lastFullRefresh ? `${liveCoverage} live · updated ${Math.round((Date.now() - state.liveStatus.lastFullRefresh) / 1000)}s ago` : "fetching live prices…"}${state.liveStatus.lastError ? ` · last error: ${escapeHtml(state.liveStatus.lastError)}` : ""}</span>
            ${liveCoverage < 40 && !state.keys.finnhub ? `<span class="sub">For instant live quotes (no proxy): add a free <b>Finnhub</b> key in ⚙️.</span>` : ""}
          </div>
          <div class="bz-mover-cols">
            <div><h3>GAINERS</h3>${gainers.length ? gainers.map(moverCompact).join("") : `<div class="note">No positive movers loaded yet.</div>`}</div>
            <div><h3>LOSERS</h3>${losers.length ? losers.map(moverCompact).join("") : `<div class="note">No negative movers loaded yet.</div>`}</div>
          </div>
        </section>
        <section class="bz-panel bz-brief">
          <div>
            <h2>Morning Update</h2>
            <p>${escapeHtml(R.headline)}</p>
            <span>${homeDate} &middot; ${liveHeaderStatus()}</span>
          </div>
          <button id="openDailyReviewTop" type="button">Read Details</button>
        </section>
        <section class="bz-panel">
          <div class="bz-section-head"><h2>What Changed</h2><button id="openSignals" type="button">Full Feed</button></div>
          ${(() => {
            const evs = signalsEvents().slice().sort((a, b) => b.d.localeCompare(a.d) || b.m - a.m).slice(0, 5);
            return evs.length ? evs.map(signalRow).join("")
              : `<div class="note">The signals engine diffs every score, revision tape and SEC filing each weekday refresh. ${signalsAsOf() ? `Baseline recorded ${signalsAsOf()} — first deltas land on the next refresh.` : "First pipeline run records the baseline."}</div>`;
          })()}
        </section>
        <section class="bz-feature" ${stockDay ? `data-tk="${stockDay.d.ticker}"` : ""}>
          <div class="bz-feature-pill">${stockDay?.d.ticker || "--"}</div>
          <div><h2>Stock Of The Day</h2><p>${stockDay ? `${stockDay.d.name}: best combined business quality and market reward setup on the board.` : "No ranked setup loaded."}</p></div>
          <button type="button">Open</button>
        </section>
        <section class="bz-panel bz-why">
          <h2>Why Is It Moving?</h2>
          ${stories.length ? stories.map(storyCard).join("") : `<div class="note">No news driver loaded yet. Open Daily Review to scan headlines.</div>`}
        </section>
        <section class="bz-panel">
          <div class="bz-section-head"><h2>Upcoming Earnings</h2><button id="openEarnCmd" type="button">Command Center</button></div>
          <div class="bz-earnings">${earningsRows.length ? earningsRows.map(earningsRow).join("") : `<div class="note">No bundled earnings in the current window.</div>`}</div>
        </section>
        <section class="bz-panel">
          <h2>Street + Model Setup</h2>
          ${analystRows.map(analystRow).join("")}
        </section>
        <section class="bz-score-strip">
          <div><span>RANKED UNIVERSE</span><b class="up">${ranked.length}/${DATA.length}</b><em>all official names scored</em></div>
          <div><span>FAT PITCHES</span><b class="up">${fat}</b><em>IV ladder in the zone</em></div>
          <div><span>MEDIAN OWNER P/E</span><b>${medianPE ? medianPE.toFixed(1) + "x" : "--"}</b><em>ranked positive owner EPS</em></div>
          <div><span>TOP COMBO</span><b>${leaders[0] ? combo(leaders[0]) : "--"}</b><em>business quality + market reward</em></div>
        </section>
      </div>
      <div class="grid g2">
        <div class="card" style="border-left:3px solid var(--green)"><h3>GREAT BUSINESSES - BUY PRICES <span class="unit">great buy = IV15 &middot; starter = IV12</span></h3>
          <div class="note" style="margin-bottom:8px">These are model watch prices, not automatic orders. <b style="color:var(--green)">Great buy</b> means the IV ladder estimates a 15% required-return entry; <b style="color:var(--amber)">starter</b> is the 12% zone for scaling/watching.</div>
          ${buyList.map(buyRow).join("")}
        </div>
        <div class="card"><h3>BEST BUSINESS + MARKET REWARD</h3>${leaders.map(x => row(x, combo(x) + "/100", `BQ ${x.m.businessQuality.score} &middot; MR ${x.m.marketReward.score}`)).join("")}</div>
        <div class="card"><h3>CHEAPEST OWNER P/E</h3>${cheap.map(x => row(x, x.r.truePE.toFixed(1) + "x", x.m.finalLabel.label)).join("")}</div>
        <div class="card"><h3>OVERHEATED WATCH</h3>${hot.map(x => row(x, x.r.truePE.toFixed(1) + "x", `Valuation ${x.m.valuation.score}/100`)).join("")}</div>
        <div class="card"><h3>BIGGEST MOVES</h3>${movers.map(moverRow).join("")}</div>
        <div class="card"><h3>SECTOR PULSE</h3>${sectors.map(x => `<div class="home-row" data-sector="${x.s.t}"><div><b>${x.s.t}</b><span>${x.s.name}</span></div><div class="sub">flow ${x.fd >= 0 ? "+" : ""}${x.fd.toFixed(1)}pp</div><strong class="${signCls(x.r3)}">${x.r3 >= 0 ? "+" : ""}${x.r3.toFixed(1)}%</strong></div>`).join("")}</div>
        <div class="card"><h3>OPEN NEXT</h3>
          <div class="note">Start with the combo leaders, then compare them against Cheapest Owner P/E and Overheated Watch. Use Sector Pulse to decide whether the market is confirming the thesis or fighting it.</div>
        </div>
      </div>`;
    el("main").querySelectorAll("[data-tk]").forEach(r => r.onclick = (e) => { e.stopPropagation(); selectTicker(r.dataset.tk); });
    el("main").querySelectorAll("[data-sector]").forEach(r => r.onclick = (e) => { e.stopPropagation(); state.secOn.add(r.dataset.sector); showSectors(); });
    const openDaily = el("openDailyReviewTop");
    if (openDaily) openDaily.onclick = showDailyReview;
    const openMovers = el("openAllMovers");
    if (openMovers) openMovers.onclick = showRankings;
    const openEarn = el("openEarnCmd");
    if (openEarn) openEarn.onclick = showCalendar;
    const openSig = el("openSignals");
    if (openSig) openSig.onclick = showSignals;
    const refreshBtn = el("homeRefreshPrices");
    if (refreshBtn) refreshBtn.onclick = async () => {
      refreshBtn.textContent = "↻ refreshing…"; refreshBtn.disabled = true;
      state.fmpBlocked = false; // let the user force a fresh attempt
      await refreshAllLive({ silent: false });
      if (state.view === "home") renderHomeMobileDashboard();
    };
  }

  function showHome() {
    state.view = "home";
    setViewBtn("homeBtn");
    renderWatchlist();
    renderHomeMobileDashboard();
    closeDrawer();
    window.scrollTo({ top: 0 });
    syncNav();
    pushNav();
  }
  function showRankings() {
    state.view = "rankings";
    setViewBtn("rankBtn");
    rankState.sort = "longTerm"; rankState.dir = -1; // always land on the business/market ranking
    renderWatchlist();
    renderRankings();
    closeDrawer();
    window.scrollTo({ top: 0 });
    syncNav();
    pushNav();
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
          <h3>TRADING-ACTIVITY SHARE <span class="unit">% of all sector-ETF dollars TRADED / month — activity, NOT net fund flow</span></h3>
          ${flowChart}
          <div class="sub" style="margin-top:6px">Rising = a growing share of trading dollars. Volume has a buyer AND a seller — this measures attention, not net capital in or out. Same chip toggles as above (SPY excluded).</div>
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

  /* ------------------------ LIVE DATA ------------------------ */
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const requestCache = new Map();
  function noteRequest(meta, status, ageMs, message) {
    const tk = meta && meta.ticker;
    if (!tk || tk === "UNIVERSE" || !companyOf(tk)) return;
    state.live[tk] = state.live[tk] || {};
    state.live[tk].requests = state.live[tk].requests || [];
    state.live[tk].requests.unshift({
      provider: meta.provider || "provider",
      status,
      ageMs: Math.max(0, ageMs || 0),
      message: message || "",
      at: Date.now(),
    });
    state.live[tk].requests = state.live[tk].requests.slice(0, 8);
  }
  async function fetchJsonWithRetry(url, meta = {}) {
    const { provider = "provider", ticker = "", timeoutMs = 8000, retries = 2, cacheMs = 5 * 60 * 1000 } = meta;
    const cached = requestCache.get(url);
    if (cached && cacheMs > 0 && Date.now() - cached.ts < cacheMs) {
      noteRequest({ provider, ticker }, "cache", Date.now() - cached.ts, "fresh cached response");
      return cached.data;
    }
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      try {
        const r = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
        if (timer) clearTimeout(timer);
        if (r.status === 429) { const e = new Error(`${provider} ${ticker} HTTP 429`); e.rateLimited = true; throw e; }
        if (!r.ok) throw new Error(`${provider} ${ticker} HTTP ${r.status}`);
        const data = await r.json();
        requestCache.set(url, { ts: Date.now(), data });
        noteRequest({ provider, ticker }, "network", 0, "fresh response");
        return data;
      } catch (e) {
        if (timer) clearTimeout(timer);
        lastErr = e;
        if (attempt === retries) break;
        await sleep((e && e.rateLimited ? 1400 : 450) * Math.pow(2, attempt));
      }
    }
    noteRequest({ provider, ticker }, "error", cached ? Date.now() - cached.ts : 0, (lastErr && lastErr.message) || "request failed");
    throw new Error(`${provider} ${ticker}: ${(lastErr && lastErr.message) || "request failed"}`);
  }
  async function fetchTextWithRetry(url, meta = {}) {
    const { provider = "provider", ticker = "", timeoutMs = 8000, retries = 1, cacheMs = 60 * 1000 } = meta;
    const cached = requestCache.get(url);
    if (cached && cacheMs > 0 && Date.now() - cached.ts < cacheMs) return cached.data;
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      try {
        const r = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error(`${provider} ${ticker} HTTP ${r.status}`);
        const data = await r.text();
        requestCache.set(url, { ts: Date.now(), data });
        return data;
      } catch (e) {
        if (timer) clearTimeout(timer);
        lastErr = e;
        if (attempt === retries) break;
        await sleep(450 * Math.pow(2, attempt));
      }
    }
    throw new Error(`${provider} ${ticker}: ${(lastErr && lastErr.message) || "request failed"}`);
  }
  async function fetchQuoteOnly(tk) { return fetchLive(tk, false); }
  async function fetchNews(tk) { return state.keys.finnhub ? fetchJsonWithRetry(`https://finnhub.io/api/v1/company-news?symbol=${tk}&from=${new Date(Date.now() - 30 * 864e5).toISOString().slice(0,10)}&to=${new Date().toISOString().slice(0,10)}&token=${state.keys.finnhub}`, { provider: "Finnhub news", ticker: tk }) : null; }
  async function loadDailyReviewNews(force = false) {
    if (location.search.includes("ci=") || !state.keys.finnhub || state.dailyReviewLoading) return 0;
    if (!force && state.dailyReviewFetchedAt && Date.now() - state.dailyReviewFetchedAt < 20 * 60 * 1000) return 0;
    state.dailyReviewLoading = true;
    if (state.view === "dailyReview") renderDailyReview();
    const tickers = dailyReviewFocusTickers();
    let ok = 0;
    try {
      for (const tk of tickers) {
        try {
          const n = await fetchNews(tk);
          if (Array.isArray(n)) {
            state.live[tk] = state.live[tk] || {};
            state.live[tk].news = n;
            ok++;
          }
        } catch (e) { /* one bad ticker should not kill the recap */ }
        await sleep(850);
      }
      state.dailyReviewFetchedAt = Date.now();
      return ok;
    } finally {
      state.dailyReviewLoading = false;
      if (state.view === "dailyReview") renderDailyReview();
      else if (state.view === "home") renderHomeMobileDashboard();
      if (ok) flash(`Daily review headlines scanned: ${ok}/${tickers.length}`, "ok");
    }
  }
  async function fetchAnalystData(tk) { return state.keys.finnhub ? fetchJsonWithRetry(`https://finnhub.io/api/v1/stock/price-target?symbol=${tk}&token=${state.keys.finnhub}`, { provider: "Finnhub analyst", ticker: tk }) : null; }
  async function fetchInsiderData(tk) { return state.keys.finnhub ? fetchJsonWithRetry(`https://finnhub.io/api/v1/stock/insider-transactions?symbol=${tk}&from=${new Date(Date.now() - 183 * 864e5).toISOString().slice(0,10)}&token=${state.keys.finnhub}`, { provider: "Finnhub insider", ticker: tk }) : null; }
  async function fetchFundamentalsFallback(tk) {
    if (!state.keys.fmp) return null;
    const d = DATA.find(x => x.ticker === tk); if (!d) return null;
    const [inc, cf] = await Promise.all([
      fetchJsonWithRetry(`https://financialmodelingprep.com/api/v3/income-statement/${tk}?limit=5&apikey=${state.keys.fmp}`, { provider: "FMP income fallback", ticker: tk }),
      fetchJsonWithRetry(`https://financialmodelingprep.com/api/v3/cash-flow-statement/${tk}?limit=5&apikey=${state.keys.fmp}`, { provider: "FMP cash-flow fallback", ticker: tk }),
    ]);
    return mergeFmp(d, inc, cf);
  }

  function applyLiveQuote(tk, price, changePct, source) {
    const d = companyOf(tk);
    if (!d || !price || price <= 0) return false;
    state.live[tk] = state.live[tk] || {};
    state.live[tk].quote = { price: +price, changePct: changePct ?? 0, source: source || "live", ts: Date.now() };
    state.live[tk].fetchedAt = Date.now();
    // Recompute price-derived multiples and score tiles whenever live price moves.
    if (d.gaapEPS > 0) d.headlinePE = +(price / d.gaapEPS).toFixed(1);
    if (d.ownerEps > 0) d.truePE = +(price / d.ownerEps).toFixed(1);
    delete d.marketScores;
    return true;
  }

  function applyFmpRows(rows) {
    if (!Array.isArray(rows)) return 0;
    let ok = 0;
    rows.forEach(q => {
      const tk = q.symbol || q.ticker;
      const ch = q.changesPercentage ?? q.changePercentage ?? q.changePercent ?? q.change_percent;
      if (applyLiveQuote(tk, q.price, ch, "FMP")) ok++;
    });
    return ok;
  }
  // FMP migrated to the /stable/ API; keys issued now often can't hit the legacy
  // /api/v3/ endpoints (they 403). Try stable first, fall back to legacy, and —
  // crucially — surface the failure instead of silently leaving prices stale.
  async function fetchFmpQuoteBatch(tickers) {
    if (!state.keys.fmp || !tickers.length) return 0;
    const key = encodeURIComponent(state.keys.fmp);
    const endpoints = [
      (csv) => `https://financialmodelingprep.com/stable/batch-quote?symbols=${csv}&apikey=${key}`,
      (csv) => `https://financialmodelingprep.com/api/v3/quote/${csv}?apikey=${key}`,
    ];
    let lastErr = null;
    for (const build of endpoints) {
      try {
        let ok = 0;
        for (let i = 0; i < tickers.length; i += 50) {
          const csv = tickers.slice(i, i + 50).join(",");
          const rows = await fetchJsonWithRetry(build(csv), { provider: "FMP quotes", ticker: "UNIVERSE", cacheMs: 15 * 1000, retries: 0, timeoutMs: 9000 });
          ok += applyFmpRows(rows);
        }
        if (ok > 0) return ok;
        lastErr = new Error("FMP returned no usable rows (key tier may not cover quotes)");
      } catch (e) { lastErr = e; }
    }
    state.liveStatus = { ...state.liveStatus, lastError: lastErr ? String(lastErr.message || lastErr) : "FMP unavailable" };
    // Stop using this FMP key for the rest of the session (its tier won't serve
    // quotes) — future cycles skip straight to the free feed, no repeated 403s.
    state.fmpBlocked = true;
    flash(`FMP quotes unavailable on this key (${state.liveStatus.lastError}). Using the free feed instead — no key needed.`, "err");
    return fetchYahooQuoteBatch(tickers.slice(0, 48));
  }

  // Yahoo's chart endpoint is keyless but its CORS behaviour varies by network,
  // so — like Social Buzz — escalate through relays instead of depending on one.
  async function fetchYahooChartJson(tk) {
    const path = `query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tk)}?range=1d&interval=1m&includePrePost=true`;
    const direct = `https://${path}`;
    const relays = [
      direct,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(direct)}`,
      `https://corsproxy.io/?url=${encodeURIComponent(direct)}`,
    ];
    for (const url of relays) {
      try {
        const j = await fetchJsonWithRetry(url, { provider: "Yahoo chart", ticker: tk, cacheMs: 10 * 1000, retries: 0, timeoutMs: 7000 });
        if (j && j.chart) return j;
      } catch { /* try next relay */ }
    }
    const txt = await fetchTextWithRetry(`https://r.jina.ai/http://${path}`, { provider: "Yahoo chart via Jina", ticker: tk, cacheMs: 10 * 1000, timeoutMs: 9000, retries: 0 });
    const s = txt.indexOf('{"chart"'), e = txt.lastIndexOf("}");
    if (s < 0 || e <= s) throw new Error("Yahoo chart unreachable");
    return JSON.parse(txt.slice(s, e + 1));
  }
  async function fetchYahooQuote(tk) {
    const j = await fetchYahooChartJson(tk);
    const r = j?.chart?.result?.[0];
    const m = r?.meta || {};
    const q = r?.indicators?.quote?.[0] || {};
    const closes = (q.close || []).filter(v => v != null && Number.isFinite(+v));
    const price = +(m.regularMarketPrice ?? closes.at(-1));
    const prev = +(m.previousClose ?? m.chartPreviousClose);
    const changePct = Number.isFinite(price) && Number.isFinite(prev) && prev > 0 ? ((price - prev) / prev) * 100 : 0;
    return applyLiveQuote(tk, price, changePct, "Yahoo");
  }

  async function fetchYahooQuoteBatch(tickers) {
    let ok = 0;
    const batch = 2;
    for (let i = 0; i < tickers.length; i += batch) {
      const chunk = tickers.slice(i, i + batch);
      const results = await Promise.all(chunk.map(tk => fetchYahooQuote(tk).catch(() => false)));
      ok += results.filter(Boolean).length;
      if (i + batch < tickers.length) await sleep(900);
    }
    return ok;
  }

  async function fetchLive(tk, full = true) {
    const d = companyOf(tk);
    if (!d) return;
    if (location.search.includes("ci=")) return;
    state.live[tk] = state.live[tk] || {};
    const k = state.keys;
    const tasks = [];
    if (k.finnhub) {
      tasks.push(fetchJsonWithRetry(`https://finnhub.io/api/v1/quote?symbol=${tk}&token=${k.finnhub}`, { provider: "Finnhub quote", ticker: tk, cacheMs: 30 * 1000 })
        .then(q => {
          if (q && q.c) applyLiveQuote(tk, q.c, q.dp ?? 0, "Finnhub");
        }).catch(() => {}));
      if (full) { // news only for the selected ticker — keeps the free key inside 60 calls/min
        const to = Math.floor(Date.now() / 1000), from = to - 60 * 60 * 24 * 30;
        const fd = new Date(from * 1000).toISOString().slice(0, 10);
        const td = new Date(to * 1000).toISOString().slice(0, 10);
        tasks.push(fetchJsonWithRetry(`https://finnhub.io/api/v1/company-news?symbol=${tk}&from=${fd}&to=${td}&token=${k.finnhub}`, { provider: "Finnhub news", ticker: tk })
          .then(n => { if (Array.isArray(n)) state.live[tk].news = n; }).catch(() => {}));
        // Wall Street price target
        tasks.push(fetchJsonWithRetry(`https://finnhub.io/api/v1/stock/price-target?symbol=${tk}&token=${k.finnhub}`, { provider: "Finnhub analyst", ticker: tk })
          .then(a => { if (a && (a.targetMean || a.targetMedian)) state.live[tk].analyst = { targetMean: a.targetMean || a.targetMedian, targetLow: a.targetLow, targetHigh: a.targetHigh }; }).catch(() => {}));
        // insider transactions (last ~6 months, net shares)
        const insFrom = new Date(Date.now() - 183 * 864e5).toISOString().slice(0, 10);
        tasks.push(fetchJsonWithRetry(`https://finnhub.io/api/v1/stock/insider-transactions?symbol=${tk}&from=${insFrom}&token=${k.finnhub}`, { provider: "Finnhub insider", ticker: tk })
          .then(j => {
            const arr = j && j.data || []; let net = 0, buys = 0, sells = 0;
            arr.forEach(t => { const ch = t.change || 0; net += ch; if (ch > 0) buys++; else if (ch < 0) sells++; });
            state.live[tk].insider = { net: net / 1e6, buys, sells };
          }).catch(() => {}));
      }
    }
    if (!k.finnhub && k.fmp) {
      tasks.push(fetchFmpQuoteBatch([tk]).catch(() => 0));
    }
    if (!k.finnhub && !k.fmp) {
      tasks.push(fetchYahooQuote(tk).catch(() => false));
    }
    if (full && k.fmp) {
      tasks.push(Promise.all([
        fetchJsonWithRetry(`https://financialmodelingprep.com/api/v3/income-statement/${tk}?limit=5&apikey=${k.fmp}`, { provider: "FMP income fallback", ticker: tk }).catch(() => null),
        fetchJsonWithRetry(`https://financialmodelingprep.com/api/v3/cash-flow-statement/${tk}?limit=5&apikey=${k.fmp}`, { provider: "FMP cash-flow fallback", ticker: tk }).catch(() => null),
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
    // FMP is a secondary fallback/check only. It must never overwrite SEC-backed arrays.
    if (rev.length >= 3) {
      state.live[d.ticker] = state.live[d.ticker] || {};
      state.live[d.ticker].fundamentalsFallback = {
        source: "FMP fallback (not applied over SEC filing facts)",
        fetchedAt: Date.now(),
        revenue: rev, ni, shares, sbc, buyback,
      };
      state.live[d.ticker].financialsSource = "FMP fallback stored; SEC display unchanged";
      return state.live[d.ticker].fundamentalsFallback;
    }
    return null;
  }

  function updateLiveDot() {
    const on = !!(state.keys.finnhub || state.keys.fmp);
    el("liveDot").classList.toggle("on", on);
    el("liveBtn").title = on ? "LIVE data connected" : "Bundled snapshots (click gear to connect)";
  }

  function etParts(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(now).reduce((a, p) => (a[p.type] = p.value, a), {});
    return { day: parts.weekday, mins: (+parts.hour) * 60 + (+parts.minute) };
  }
  function isMarketHours(now = new Date()) {
    const p = etParts(now);
    return !["Sat", "Sun"].includes(p.day) && p.mins >= 570 && p.mins <= 960;
  }
  function liveStatusText() {
    const age = state.liveStatus.lastFullRefresh ? Math.round((Date.now() - state.liveStatus.lastFullRefresh) / 1000) : null;
    const open = isMarketHours() ? "market open" : "market closed";
    const src = state.liveStatus.source || (state.keys.finnhub ? "Finnhub rotation" : state.keys.fmp ? "FMP batch" : "Yahoo fallback");
    const denom = state.keys.finnhub || state.keys.fmp ? allCompanies().length : "visible";
    return `${open} - ${src} - ${state.liveStatus.lastCount || 0}/${denom}${age == null ? "" : ` - ${age}s ago`}`;
  }
  function noKeyQuoteTickers() {
    const seen = new Set();
    const out = [];
    const add = (tk) => { if (tk && !seen.has(tk)) { seen.add(tk); out.push(tk); } };
    add(state.active);
    allCompanies()
      .filter(d => state.bucket === "all" ? true : state.bucket === "fav" ? state.favs.has(d.ticker) : d.bucket === state.bucket)
      .sort((a, b) => watchMetric(b, state.watchSort) - watchMetric(a, state.watchSort) || b.mktCap - a.mktCap)
      .slice(0, 48)
      .forEach(d => add(d.ticker));
    return out;
  }
  async function refreshAllLive(opts = {}) {
    const silent = !!opts.silent;
    if (location.search.includes("ci=")) return 0;
    if (!state.keys.finnhub && !state.keys.fmp && typeof navigator !== "undefined" && navigator.onLine === false) {
      state.liveStatus = { lastFullRefresh: state.liveStatus.lastFullRefresh, lastCount: state.liveStatus.lastCount || 0, source: "offline" };
      updateLiveDot();
      return 0;
    }
    if (state.quoteRefreshing) return state.liveStatus.lastCount || 0;
    state.quoteRefreshing = true;
    // Refresh the names the user is most likely looking at FIRST (active ticker,
    // favourites, then biggest by market cap), so on a rate-limited/slow path the
    // visible board freshens before the long tail — instead of universe order.
    const prioritized = () => {
      const seen = new Set(), out = [];
      const add = (tk) => { if (tk && !seen.has(tk)) { seen.add(tk); out.push(tk); } };
      add(state.active);
      allCompanies().filter(d => state.favs.has(d.ticker)).forEach(d => add(d.ticker));
      [...allCompanies()].sort((a, b) => (b.mktCap || 0) - (a.mktCap || 0)).forEach(d => add(d.ticker));
      return out;
    };
    // FMP that already 403'd this session is skipped so we don't burn every
    // cycle on a key its tier won't honour — go straight to the free feed.
    const useFmp = state.keys.fmp && !state.fmpBlocked;
    const useFinnhub = !useFmp && state.keys.finnhub;
    const all = (useFmp || useFinnhub) ? prioritized() : noKeyQuoteTickers();
    let ok = 0, fails = 0, source = useFmp ? "FMP batch" : useFinnhub ? "Finnhub rotation" : "Yahoo (free)";
    if (!silent) flash("Live prices updating...", "ok");
    try {
      if (useFmp) {
        ok = await fetchFmpQuoteBatch(all);
      } else if (useFinnhub) {
        for (const tk of all) {
          try { await fetchLive(tk, false); if (state.live[tk]?.quote) ok++; }
          catch (e) { fails++; }
          await sleep(1050);
        }
      } else {
        ok = await fetchYahooQuoteBatch(all);
      }
      state.liveStatus = { lastFullRefresh: Date.now(), lastCount: ok, source };
      if (state.active && state.live[state.active]?.quote) render();
      renderWatchlist();
      updateLiveDot();
      if (!silent) flash(`Live prices updated: ${ok}/${all.length} via ${source}${fails ? ` - ${fails} failed` : ""}`, ok ? "ok" : "err");
      return ok;
    } finally {
      state.quoteRefreshing = false;
    }
  }
  function startLiveTape() {
    if (state.liveTimer) clearInterval(state.liveTimer);
    refreshAllLive({ silent: false });
    state.liveTimer = setInterval(() => {
      if (document.hidden) return;
      if (isMarketHours()) refreshAllLive({ silent: true });
      else if (!state.liveStatus.lastFullRefresh || Date.now() - state.liveStatus.lastFullRefresh > 10 * 60 * 1000) refreshAllLive({ silent: true });
    }, state.keys.fmp ? 30 * 1000 : state.keys.finnhub ? 70 * 1000 : 45 * 1000);
  }
  function updateLiveDot() {
    const on = !!state.liveStatus.lastFullRefresh || !!(state.keys.finnhub || state.keys.fmp);
    el("liveDot").classList.toggle("on", on);
    el("liveBtn").title = liveStatusText();
  }

  /* ------------------------ command / search ------------------------ */
  function runCommand(q) {
    q = (q || "").trim().toUpperCase();
    if (!q) return;
    if (["RANK", "RANKINGS", "RANKING", "LEADERBOARD", "SCORE", "BEST", "TOP"].includes(q)) {
      showRankings(); flash("Master rankings", "ok"); return;
    }
    if (["DAILY", "RECAP", "REVIEW", "DAILY REVIEW", "MARKET REVIEW", "MARKET RECAP", "TODAY"].includes(q)) {
      showDailyReview(); flash("Daily review", "ok"); return;
    }
    if (["EDGE", "DIRECTION", "DIRECTION EDGE", "UP DOWN", "UP/DOWN", "SIGNAL", "SIGNALS"].includes(q)) {
      showDirectionEdge(); flash("Direction edge", "ok"); return;
    }
    if (["SCREEN", "SCREENER", "FILTER"].includes(q)) { showScreener(); return; }
    if (["COMPARE", "VS", "COMPARISON"].includes(q)) { showCompare(); return; }
    if (["PORTFOLIO", "POSITIONS", "HOLDINGS", "MYPORT"].includes(q)) { showPortfolio(); return; }
    if (["CALENDAR", "EARNINGS", "CAL", "BEATS", "BEAT", "ODDS", "DRIFT", "PEAD"].includes(q)) { showCalendar(); flash("Earnings command center", "ok"); return; }
    if (["SIGNALS", "SIGNAL", "CHANGED", "WHAT CHANGED", "FEED", "DELTAS", "NEW"].includes(q)) { showSignals(); flash("What changed — signals feed", "ok"); return; }
    if (["EASY", "SIMPLE", "GAME PLAN", "GAMEPLAN", "PLAN", "KID", "HELP ME"].includes(q)) { showEasy(); flash("Easy mode — today's game plan", "ok"); return; }
    if (["SETUPS", "SETUP", "BEST", "BEST SETUPS", "RSI", "ALIGN", "PRIME"].includes(q)) { showSetups(); flash("Best setups — brain + RSI", "ok"); return; }
    if (["BLACKROCK", "13F", "WHALE", "WHALES", "BLACK ROCK"].includes(q)) { showBlackrock(); flash("Whale tracker", "ok"); return; }
    if (["BERKSHIRE", "BUFFETT", "WARREN"].includes(q)) { whaleState.focus = "berkshire"; showBlackrock(); flash("Whale tracker — Berkshire", "ok"); return; }
    if (["CITADEL", "GRIFFIN"].includes(q)) { whaleState.focus = "citadel"; showBlackrock(); flash("Whale tracker — Citadel", "ok"); return; }
    if (["AUDIT", "TRUST", "PROVENANCE", "SOURCES"].includes(q)) { showAudit(); return; }
    if (["TRACK", "RECORD", "SCORECARD", "PROOF"].includes(q)) { showTrack(); return; }
    if (["JOURNAL", "THESIS", "THESES"].includes(q)) { showJournal(); return; }
    if (["PE", "P/E", "TRUEPE", "TRUE PE", "VALUATION", "CHEAP", "GRAHAM", "VALUE", "MAP", "QUALITY"].includes(q)) {
      showRankings(); flash("Master rankings — sort by owner P/E, Graham or quality", "ok"); return;
    }
    if (["SECTORS", "SECTOR", "FLOW", "ROTATION"].includes(q) || SECTORS.series.some(s => s.t === q)) {
      showSectors();
      if (SECTORS.series.some(s => s.t === q)) { state.secOn.add(q); renderSectors(); }
      flash("Sector flow view", "ok");
      return;
    }
    const searchable = allCompanies();
    const hit = searchable.find(d => d.ticker === q) || searchable.find(d => d.ticker.startsWith(q)) ||
      searchable.find(d => d.name.toUpperCase().includes(q));
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
    const ws = el("wlSort");
    if (ws) {
      ws.value = state.watchSort;
      ws.onchange = () => {
        state.watchSort = ws.value;
        localStorage.setItem("sbc_watch_sort", state.watchSort);
        renderWatchlist();
        refreshAllLive({ silent: true });
      };
    }
    // filter buttons
    el("filter").querySelectorAll("button").forEach(b => b.onclick = () => {
      state.bucket = b.dataset.b;
      el("filter").querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b));
      renderWatchlist();
      refreshAllLive({ silent: true });
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
      if (state.liveTimer) clearInterval(state.liveTimer);
      state.liveTimer = null;
      state.liveStatus = { lastFullRefresh: null, lastCount: 0, source: "Yahoo" };
      startLiveTape();
      updateLiveDot(); flash("Keys cleared — back to snapshots", "ok");
    };
    el("saveKeys").onclick = () => {
      state.keys.finnhub = el("finnhubKey").value.trim();
      state.keys.fmp = el("fmpKey").value.trim();
      localStorage.setItem("finnhubKey", state.keys.finnhub);
      localStorage.setItem("fmpKey", state.keys.fmp);
      el("modal").classList.remove("open");
      updateLiveDot();
      startLiveTape();
    };
    el("liveBtn").onclick = () => startLiveTape();
    el("homeBtn").onclick = showHome;
    el("easyBtn").onclick = showEasy;
    el("blackrockBtn").onclick = showBlackrock;
    el("setupsBtn").onclick = showSetups;
    el("signalsBtn").onclick = showSignals;
    el("dailyBtn").onclick = showDailyReview;
    el("edgeBtn").onclick = showDirectionEdge;
    el("sectorBtn").onclick = showSectors;

    // mobile bottom nav + drawer
    el("navList").onclick = () => $("aside").classList.contains("open") ? closeDrawer() : openDrawer();
    el("navSectors").onclick = showSectors;
    el("navNarr").onclick = showCalendar;
    el("navPE").onclick = showScreener;
    el("navRank").onclick = showRankings;
    el("rankBtn").onclick = showRankings;
    el("screenBtn").onclick = showScreener;
    el("compareBtn").onclick = showCompare;
    el("portBtn").onclick = showPortfolio;
    el("calBtn").onclick = showCalendar;
    el("auditBtn").onclick = showAudit;
    el("trackBtn").onclick = showTrack;
    el("journalBtn").onclick = showJournal;
    el("drawerClose").onclick = closeDrawer;
    el("navSearch").onclick = () => {
      closeDrawer();
      window.scrollTo({ top: 0 });
      el("cmdInput").focus();
      flash("Ticker search ready", "ok");
    };
    el("backdrop").onclick = closeDrawer;
    window.addEventListener("resize", syncMobileChrome);

    renderTopNav();
    showHome();
    syncMobileChrome();
    updateLiveDot();
    tickClock(); setInterval(tickClock, 1000);
    startLiveTape();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAllLive({ silent: true }); });
    setInterval(updateLiveDot, 15 * 1000);
    // PWA: offline/phone support (only when served over http(s), not file://)
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      const hadController = !!navigator.serviceWorker.controller;
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController || refreshing) return;
        refreshing = true;
        location.reload();
      });
      navigator.serviceWorker.register("sw.js?v=70").then((reg) => reg.update()).catch(() => {});
    }
  }
  // regression-test / console handle: production engines, read-only
  window.__engines = { ivLadder, grahamOf, verdictOf, rankOf, qualityOf, capexOf,
    buybackQuality, shareTrend, medianOf, trueOwnerEarnings,
    tabFinancials, renderAudit, secCheckOf, dataQualityOf, dataConfidenceOf, analyzeNews,
    lastVal, fetchQuoteOnly, fetchNews, fetchAnalystData, fetchInsiderData, fetchFundamentalsFallback,
    fetchJsonWithRetry, ScoreEngine: window.ScoreEngine, marketScoreOf, refreshMarketScores, forwardPEOf,
    directionEdgeOf, macroRegimeOf, EARNINGS_FOCUS, bundledEarningsRows, mergeEarningsRows,
    beatOddsOf, earnBeatStats, earningsLedger, upcomingEarningsRows, peerReadThrough, earnIntelOf, seasonScorecard,
    driftScoreOf, calibrationOf, signalsEvents, ratingReasonFrom, gradeOf, easySentence, easyEventWords, blkIntel, whalesIntel, rsiOf, bestSetupsOf,
    pxReturn, pxNormalized, pxWindowSlice, tmDateLabels,
    applyLiveQuote, fetchFmpQuoteBatch, fetchYahooQuote, fetchYahooQuoteBatch, refreshAllLive, startLiveTape, isMarketHours,
    allCompanies, companyOf, tickerDrawdown,
    SBC_MODEL_VERSION, FORMULA_VERSION };
  document.addEventListener("DOMContentLoaded", init);
})();
