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
    "Crypto Exchange": "XLF", "Fintech Brokerage": "XLF",
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
  const INFLATION = {
    asOf: "May 2026", nextRelease: "June CPI scheduled July 14, 2026 8:30 ET",
    source: "BLS CPI/PPI public data snapshot bundled 2026-07-13",
    series: [
      { k: "Headline CPI", yoy: 4.2, latest: 335.123, heat: "hot", why: "all-items inflation is still above the Fed comfort zone" },
      { k: "Core CPI", yoy: 2.9, latest: 336.846, heat: "sticky", why: "core excludes food/energy and drives rate expectations" },
      { k: "Shelter", yoy: 3.4, latest: 428.677, heat: "sticky", why: "rent/OER lag keeps services inflation slow to cool" },
      { k: "Energy", yoy: 23.5, latest: 346.042, heat: "shock", why: "energy shock hits transports, consumers and input costs first" },
      { k: "Food", yoy: 3.1, latest: 349.032, heat: "warm", why: "food pressure hits staples volumes and low-income consumer spend" },
      { k: "PPI Final Demand", yoy: 6.5, latest: 158.012, heat: "margin", why: "producer prices lead margin pressure unless pricing power holds" },
    ],
  };
  const INFLATION_SECTORS = {
    SMH: { name: "Semis / AI", multiple: 3, input: 2, demand: 1, pass: 1, note: "long-duration multiples and capex cycles are vulnerable to sticky rates; energy/input shocks pressure fabs and equipment." },
    XLK: { name: "Software / Tech", multiple: 3, input: 1, demand: 1, pass: 2, note: "high multiples re-rate when inflation keeps rates high; best software offsets with pricing power and low physical input costs." },
    XLY: { name: "Consumer Discretionary", multiple: 2, input: 2, demand: 3, pass: 1, note: "inflation taxes the consumer; weak pass-through names lose volume or margin." },
    XLP: { name: "Staples", multiple: 1, input: 2, demand: 0, pass: 2, note: "defensive demand helps, but food/freight inflation tests gross margin and private-label trade-down." },
    XLE: { name: "Energy", multiple: 0, input: 0, demand: 1, pass: 3, note: "energy inflation is usually a revenue tailwind, unless demand destruction appears." },
    XLF: { name: "Financials", multiple: 1, input: 0, demand: 2, pass: 2, note: "higher rates can help net interest income, but credit losses and weaker asset prices are the offset." },
    XLV: { name: "Health Care", multiple: 1, input: 1, demand: 0, pass: 2, note: "defensive demand and regulated/reimbursed pricing make the sector less cyclical." },
    XLI: { name: "Industrials", multiple: 1, input: 3, demand: 1, pass: 1, note: "labor, freight, metals and energy feed directly into margins unless backlog pricing resets." },
    XLC: { name: "Comms / Media", multiple: 2, input: 1, demand: 2, pass: 1, note: "ad budgets and subscriptions weaken if inflation squeezes consumers and SMBs." },
    XLB: { name: "Materials", multiple: 1, input: 2, demand: 1, pass: 2, note: "commodity inflation can help revenue, but spread businesses need pricing over input costs." },
    XLRE: { name: "Real Estate", multiple: 3, input: 2, demand: 2, pass: 1, note: "rate-sensitive cap rates and financing costs dominate; rent escalators help only with a lag." },
    SPY: { name: "Market", multiple: 2, input: 2, demand: 1, pass: 1, note: "sticky inflation raises discount rates and compresses multiples first." },
  };
  const EARNINGS_FOCUS = {
    asOf: "2026-07-13",
    source: "Earnings Whispers most-anticipated week + market-calendar cross-check",
    note: "July 13-17, 2026 earnings week: banks test credit/NII, ASML/TSM test AI capex, NFLX tests consumer and ads.",
    rows: [
      { date: "2026-07-14", symbol: "JPM", name: "JPMorgan Chase", hour: "bmo", theme: "Banks / credit" },
      { date: "2026-07-14", symbol: "BAC", name: "Bank of America", hour: "bmo", theme: "Banks / credit" },
      { date: "2026-07-14", symbol: "C", name: "Citigroup", hour: "bmo", theme: "Banks / credit" },
      { date: "2026-07-14", symbol: "GS", name: "Goldman Sachs", hour: "bmo", theme: "Capital markets" },
      { date: "2026-07-14", symbol: "WFC", name: "Wells Fargo", hour: "bmo", theme: "Banks / credit" },
      { date: "2026-07-15", symbol: "ASML", name: "ASML", hour: "bmo", theme: "AI capex / semi equipment", epsEstimate: 6.88 },
      { date: "2026-07-15", symbol: "BLK", name: "BlackRock", hour: "bmo", theme: "Asset management" },
      { date: "2026-07-15", symbol: "JNJ", name: "Johnson & Johnson", hour: "bmo", theme: "Health care" },
      { date: "2026-07-15", symbol: "MS", name: "Morgan Stanley", hour: "bmo", theme: "Capital markets" },
      { date: "2026-07-15", symbol: "PGR", name: "Progressive", hour: "bmo", theme: "Insurance" },
      { date: "2026-07-16", symbol: "TSM", name: "Taiwan Semiconductor", hour: "bmo", theme: "AI semis / foundry" },
      { date: "2026-07-16", symbol: "UNH", name: "UnitedHealth", hour: "bmo", theme: "Health care / managed care" },
      { date: "2026-07-16", symbol: "GE", name: "GE Aerospace", hour: "bmo", theme: "Industrials / aerospace" },
      { date: "2026-07-16", symbol: "NFLX", name: "Netflix", hour: "amc", theme: "Consumer / ads", epsEstimate: 0.79 },
      { date: "2026-07-16", symbol: "AA", name: "Alcoa", hour: "amc", theme: "Materials / aluminum" },
      { date: "2026-07-17", symbol: "AXP", name: "American Express", hour: "bmo", theme: "Consumer credit" },
      { date: "2026-07-17", symbol: "FITB", name: "Fifth Third", hour: "bmo", theme: "Regional banks" },
      { date: "2026-07-17", symbol: "RF", name: "Regions Financial", hour: "bmo", theme: "Regional banks" },
      { date: "2026-07-17", symbol: "TRV", name: "Travelers", hour: "bmo", theme: "Insurance" },
      { date: "2026-07-17", symbol: "ERIC", name: "Ericsson", hour: "bmo", theme: "Telecom equipment" },
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
    const ttmBuyback = sum(ttmRows.map(r => hasNum(r.buyback) ? +r.buyback : 0));
    if (avgP && usable.length >= 5 && ttmSbc > 0) {
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
    if (expected !== 121) fail("universe has " + expected + " tickers, expected exactly 121");
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
  function inflationOf(d) {
    const etf = sectorETF(d.sector);
    const p = INFLATION_SECTORS[etf] || INFLATION_SECTORS.SPY;
    const m = marketScoreOf(d) || {};
    const bq = m.businessQuality?.score ?? 50;
    const val = m.valuation?.score ?? 50;
    const margin = d.revenue?.length && d.ni?.length ? (lastVal(d.ni) / Math.max(0.001, lastVal(d.revenue))) * 100 : null;
    const duration = d.truePE == null ? 3 : d.truePE > 70 ? 3 : d.truePE > 40 ? 2 : d.truePE > 25 ? 1 : 0;
    const pricing = bq >= 75 ? 3 : bq >= 62 ? 2 : bq >= 48 ? 1 : 0;
    const marginShield = margin == null ? 1 : margin >= 25 ? 2 : margin >= 12 ? 1 : 0;
    const inputCost = p.input + (d.bucket === "tragic" ? 1 : d.bucket === "high" ? 0.5 : 0);
    const demandHit = p.demand + (["Retail", "Travel", "Restaurants", "Apparel", "Auto/AI", "Ride-Hailing", "Gaming"].includes(d.sector) ? 1 : 0);
    const rateHit = p.multiple + duration + (val < 35 ? 1 : 0);
    const passThrough = p.pass + pricing + marginShield;
    const raw = passThrough - inputCost - demandHit - rateHit;
    const score = Math.max(0, Math.min(100, Math.round(50 + raw * 8)));
    const label = score >= 68 ? "inflation resilient" : score >= 52 ? "mixed" : score >= 38 ? "pressured" : "high risk";
    const color = score >= 68 ? "var(--green)" : score >= 52 ? "var(--amber)" : score >= 38 ? "var(--orange)" : "var(--red)";
    const bits = [];
    if (rateHit >= 5) bits.push("multiple pressure from sticky rates");
    if (inputCost >= 3) bits.push("input-cost margin pressure");
    if (demandHit >= 3) bits.push("consumer/demand squeeze");
    if (passThrough >= 5) bits.push("pricing power offsets inflation");
    if (etf === "XLE") bits.push("energy inflation can be a revenue tailwind");
    return { etf, profile: p, score, label, color, rateHit, inputCost, demandHit, passThrough, margin, bits };
  }

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
      const epsRev = epsNow != null && epsPrev ? ((epsNow / epsPrev) - 1) * 100 : null;
      const revRev = revNow != null && revPrev ? ((revNow / revPrev) - 1) * 100 : null;
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
  function macroPart(d) {
    const inf = inflationOf(d);
    const score = inf.score + (inf.rateHit >= 5 ? -6 : 0) + (inf.passThrough >= 5 ? 4 : 0);
    return scorePart("macro", "Inflation/macro", score, 3, `${inf.label}: ${inf.bits.join(" - ") || inf.profile.note}`, "inflation desk", { inflationScore: inf.score });
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
  state.thesisRules = loadJSON("sbc_thesis_rules", {});
  const saveFavs = () => localStorage.setItem("sbc_favs", JSON.stringify([...state.favs]));
  const savePort = () => localStorage.setItem("sbc_portfolio", JSON.stringify(state.portfolio));
  const saveThesis = () => localStorage.setItem("sbc_thesis_rules", JSON.stringify(state.thesisRules));
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
  const VIEW_BTNS = ["homeBtn", "dailyBtn", "edgeBtn", "sectorBtn", "narrBtn", "valBtn", "rankBtn", "grahamBtn", "screenBtn", "compareBtn", "trigBtn", "mapBtn", "portBtn", "calBtn", "techBtn", "optBtn", "macroBtn", "auditBtn"];
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
    el("navNarr").classList.toggle("active", !drawerOpen && state.view === "narratives");
    el("navPE").classList.toggle("active", !drawerOpen && state.view === "valuation");
    el("navRank").classList.toggle("active", !drawerOpen && state.view === "rankings");
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
        const map = { home: showHome, dailyReview: showDailyReview, directionEdge: showDirectionEdge, sectors: showSectors, narratives: showNarratives, valuation: showValuation, inflation: showInflation,
          rankings: showRankings, graham: showGraham, screener: showScreener, compare: showCompare, qualityMap: showQualityMap,
          triggers: showTriggers, portfolio: showPortfolio, calendar: showCalendar, tech: showTech, options: showOptions, audit: showAudit };
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
          <div class="tick"><span class="star hdr-star ${state.favs.has(d.ticker) ? "on" : ""}" id="hdrStar" title="Star this name">${state.favs.has(d.ticker) ? "★" : "☆"}</span> ${d.ticker}${d.derived ? ' <span class="derived-tag" title="Framework fields auto-derived from aggregator data">◐ auto</span>' : ""} <span class="derived-tag" style="color:${dataQualityOf(d).color};border-color:${dataQualityOf(d).color}" title="${dataQualityOf(d).tip}">${dataQualityOf(d).label}</span>${conflictBadge}</div>
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
      ${[["overview", "OVERVIEW"], ["quality", "QUALITY"], ["gap", "EXPECTATIONS"], ["alerts", "ALERTS"], ["sbc", "★ SBC X-RAY"], ["graham", "🛡 GRAHAM VALUE"], ["financials", "FINANCIALS"], ["earnings", "EARNINGS"], ["news", "NEWS"], ["framework", "FRAMEWORK"]]
        .map(([k, l]) => `<button data-tab="${k}" class="${currentTab === k ? "active" : ""}">${l}</button>`).join("")}
    </div>`;

    el("main").innerHTML = header + tabs
      + `<div class="sub" style="margin:-6px 0 10px;font-size:9px">source priority: SEC filing facts -> company filings -> secondary checks -> estimates -> missing · latest SEC filing: ${d.secv && d.secv.latest && d.secv.latest.form ? d.secv.latest.form + " filed " + d.secv.latest.filed : "none on record"} · model ${SBC_MODEL_VERSION} / ${FORMULA_VERSION} · retention is explanation only (${d.keepSource === "computed" ? "computed" : "insufficient/fallback"}) · ${dataQualityOf(d).label.toLowerCase()}</div>`
      + `<div id="tabBody"></div>`;
    el("main").querySelectorAll(".tabs button").forEach(btn =>
      btn.onclick = () => { currentTab = btn.dataset.tab; render(); syncNav(); pushNav(); });
    const hs = el("hdrStar"); if (hs) hs.onclick = () => { toggleFav(d.ticker); render(); };
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
    else if (currentTab === "gap") body.innerHTML = tabGap(d);
    else if (currentTab === "alerts") {
      body.innerHTML = tabAlerts(d);
      wireThesisForm(d);
    }
    else if (currentTab === "financials") {
      body.innerHTML = tabFinancials(d);
      body.querySelectorAll(".fin-toggle").forEach(b =>
        b.onclick = () => { finMode = b.dataset.m; renderTab(d); });
    }
    else if (currentTab === "graham") body.innerHTML = tabGraham(d);
    else if (currentTab === "earnings") body.innerHTML = tabEarnings(d);
    else if (currentTab === "news") body.innerHTML = tabNews(d);
    else if (currentTab === "framework") body.innerHTML = tabFramework(d);
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
  function tabGap(d) {
    return `<div class="grid g3">
      ${expectationsGapCard(d)}
      ${valuationCasesCard(d)}
      ${whatChangedCard(d)}
    </div>`;
  }
  function thesisRuleFor(d) {
    return state.thesisRules[d.ticker] || {};
  }
  function tabAlerts(d) {
    const t = thesisRuleFor(d);
    const out = window.ScoreEngine ? window.ScoreEngine.thesisAlerts(d, t, marketContext()) : { alerts: [] };
    const alertHtml = out.alerts.length
      ? out.alerts.map(a => `<div class="note callout" style="margin-top:8px">${a}</div>`).join("")
      : `<div class="note" style="margin-top:8px;border-left-color:var(--green)">No thesis-breaking alerts fired for the saved rules.</div>`;
    return `<div class="grid g2">
      <div class="card">
        <h3>THESIS-BREAKING ALERTS <span class="unit">saved per ticker on this device</span></h3>
        <div class="thesis-grid">
          <label>Min revenue growth %<input id="thMinRev" type="number" value="${t.minRevenueGrowth ?? ""}" placeholder="e.g. 10"></label>
          <label>Min operating margin %<input id="thMinOp" type="number" value="${t.minOperatingMargin ?? ""}" placeholder="e.g. 20"></label>
          <label>Max SBC / revenue %<input id="thMaxSbc" type="number" value="${t.maxSbcRevenue ?? ""}" placeholder="e.g. 12"></label>
          <label>Min 3M RS vs sector pp<input id="thMinRs" type="number" value="${t.minRelativeStrength ?? ""}" placeholder="e.g. -5"></label>
          <label>Max owner P/E<input id="thMaxPe" type="number" value="${t.maxOwnerPE ?? ""}" placeholder="e.g. 35"></label>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="action-btn" id="saveThesis">SAVE ALERTS</button>
          <button class="ghost-btn" id="clearThesis">CLEAR</button>
        </div>
      </div>
      <div class="card">
        <h3>ALERT STATUS <span class="unit">${out.broken || 0} fired</span></h3>
        ${alertHtml}
      </div>
      ${whatChangedCard(d)}
    </div>`;
  }
  function wireThesisForm(d) {
    const val = (id) => {
      const raw = el(id)?.value;
      return raw === "" || raw == null ? null : +raw;
    };
    const cleanRule = (r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v != null && Number.isFinite(v)));
    const save = () => {
      state.thesisRules[d.ticker] = cleanRule({
        minRevenueGrowth: val("thMinRev"),
        minOperatingMargin: val("thMinOp"),
        maxSbcRevenue: val("thMaxSbc"),
        minRelativeStrength: val("thMinRs"),
        maxOwnerPE: val("thMaxPe"),
      });
      if (!Object.keys(state.thesisRules[d.ticker]).length) delete state.thesisRules[d.ticker];
      saveThesis();
      flash("Thesis alerts saved for " + d.ticker, "ok");
      renderTab(d);
    };
    const s = el("saveThesis"); if (s) s.onclick = save;
    const c = el("clearThesis"); if (c) c.onclick = () => { delete state.thesisRules[d.ticker]; saveThesis(); flash("Thesis alerts cleared", "ok"); renderTab(d); };
  }

  function tabOverview(d) {
    const px = d.px && d.px.v && d.px.v.length >= 10 ? d.px : null;
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
        <div style="display:flex;justify-content:center;margin:6px 0">${Chart.donut(d.ownersKeep)}</div>
        <div class="sub" style="text-align:center">Shareholders keep <b style="color:var(--text)">${(d.ownersKeep * 100).toFixed(1)}¢</b> of each GAAP earnings dollar after true SBC economics.</div>
      </div>

      <div class="card"><h3>GAAP EPS</h3><div class="stat">$${d.gaapEPS?.toFixed(2) ?? "–"}</div><div class="sub">what's actually reported</div></div>
      <div class="card"><h3>WALL ST ADJ EPS</h3><div class="stat" style="color:var(--orange)">$${d.nonGaapEPS?.toFixed(2) ?? "–"}</div>
        <div class="sub">${d.gaapEPS && d.nonGaapEPS ? "+" + (((d.nonGaapEPS - d.gaapEPS) / d.gaapEPS) * 100).toFixed(0) + "% above GAAP" : ""}</div></div>
      <div class="card"><h3>EST OWNER EPS</h3><div class="stat" style="color:var(--amber)">$${d.sbcAdjEPS?.toFixed(2) ?? "–"}</div><div class="sub">${d.ownerEpsSource || "owner EPS estimate"} — value off this, not adjusted EPS</div></div>

      ${ivLadderCard(d)}

      ${capexCard(d)}

      ${qualityCard(d)}

      ${analystCard(d)}

      ${inflationCard(d)}

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
        <h3>SEC FILING CHECK <span class="unit">${sv.latest && sv.latest.form ? sv.latest.form + " filed " + sv.latest.filed + " · accn " + sv.latest.accn : ""} · SEC facts never silently overwritten</span></h3>
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
    const streetRev = nextQ?.revAvg ?? revToB(numFrom(nextCal, ["revenueEstimate"]));
    const streetEps = nextQ?.epsAvg ?? numFrom(nextCal, ["epsEstimate"]);
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
    return `${keyNote}
    <div class="grid g3">
      <div class="card" style="grid-column:span 2;border-left:3px solid ${riskColor}">
        <h3>EARNINGS SETUP <span class="unit">consensus vs actual trend</span></h3>
        <div style="display:flex;flex-wrap:wrap;gap:14px">
          ${cardStat("Next report", nextCal ? shortDate(nextCal.date) : "-", nextCal ? `${eventDays} days · ${nextCal.hour || "time n/a"} · Finnhub` : "connect Finnhub or wait for calendar")}
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

  function inflationCard(d) {
    const x = inflationOf(d);
    const bits = x.bits.length ? x.bits.join(" · ") : x.profile.note;
    const channel = x.rateHit >= 5 ? "multiple compression first" :
      x.inputCost >= 3 ? "margin pressure first" :
      x.demandHit >= 3 ? "revenue pressure first" :
      x.passThrough >= 5 ? "pricing power can defend EPS" : "mixed EPS and multiple effects";
    return `<div class="card" style="border-left:3px solid ${x.color}">
      <h3>INFLATION X-RAY <span class="unit">${x.profile.name}</span></h3>
      <div class="stat" style="color:${x.color}">${x.score}</div>
      <div class="sub">${x.label} · ${channel}</div>
      <div class="kv"><span class="k">Stock-price channel</span><span class="v">${bits}</span></div>
      <div class="kv"><span class="k">Rates / P/E pressure</span><span class="v">${x.rateHit.toFixed(1)} / 7</span></div>
      <div class="kv"><span class="k">Input-cost pressure</span><span class="v">${x.inputCost.toFixed(1)} / 4</span></div>
      <div class="kv"><span class="k">Consumer demand hit</span><span class="v">${x.demandHit.toFixed(1)} / 4</span></div>
      <div class="kv"><span class="k">Pricing-power shield</span><span class="v">${x.passThrough.toFixed(1)} / 8</span></div>
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
            ["6 · Valuation re-rate", "Owner EPS = adjusted owner earnings / diluted shares; owner P/E = price / owner EPS."],
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
            ["The All Map", "Baseball-field view on the ⊞ EST P/E tab: Fat Pitches (≥15% implied), Just Outside (10–15%), The Out Field (<10%)."],
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
    DATA.filter(d => dataConfidenceOf(d).rankable).forEach(d => { const L = ivLadder(d); zones[L ? L.zone : "out"].push({ d, L }); });
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

  /* ------------------------ MASTER RANKING ENGINE ------------------------ */
  // Rankings ARE the brain: rankOf() reads verdictOf(), so the leaderboard,
  // the screener and every stock page share ONE unified conclusion.
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
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

      <div class="note" style="margin-bottom:12px">The official 121-name universe enters the main ranking when owner-earnings can be computed. The DATA column is a separate trust gauge: 80+ means filing-verified, lower scores mean ranked with caution because SEC cross-check coverage is incomplete. If required SBC/share facts are missing, the ticker stays in Not Ranked instead of getting fake numbers.</div>
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

  /* ------------------------ 🛡 GRAHAM VALUE SCREENER ------------------------ */
  const grahamState = { sort: "score", dir: -1 };
  function renderGraham() {
    const rows = DATA.map(d => ({ d, G: grahamOf(d) })).filter(x => x.G);
    const netnets = rows.filter(x => x.G.netnet).sort((a, b) => a.G.priceToNcav - b.G.priceToNcav);
    const stalwarts = rows.filter(x => x.G.passed >= 6).sort((a, b) => b.G.passed - a.G.passed || b.G.score - a.G.score);
    const byMOS = rows.filter(x => x.G.grahamMOS != null).sort((a, b) => b.G.grahamMOS - a.G.grahamMOS);

    const raw = (o, k) => k === "score" ? o.G.score : k === "mos" ? o.G.grahamMOS : k === "pb" ? o.G.pb
      : k === "cr" ? o.G.currentRatio : k === "ncav" ? o.G.priceToNcav : k === "passed" ? o.G.passed
      : k === "div" ? o.G.divYield : o.d[k];
    const sorted = [...rows].sort((a, b) => {
      const va = raw(a, grahamState.sort), vb = raw(b, grahamState.sort);
      if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
      return (va - vb) * grahamState.dir;
    });

    const COLS = [
      { k: "score", label: "G-SCORE" }, { k: "passed", label: "CHECKS" },
      { k: "mos", label: "GRAHAM MOS" }, { k: "pb", label: "P/B" },
      { k: "cr", label: "CURR RATIO" }, { k: "ncav", label: "PRICE/NCAV" },
      { k: "div", label: "DIV YLD" }, { k: "mktCap", label: "MKT CAP" },
    ];
    const th = COLS.map(c => `<th data-gsort="${c.k}" class="${grahamState.sort === c.k ? "sorted" : ""}">${c.label}${grahamState.sort === c.k ? (grahamState.dir < 0 ? " ▾" : " ▴") : ""}</th>`).join("");
    const body = sorted.map((x, i) => {
      const d = x.d, G = x.G;
      const sc = G.score >= 60 ? "var(--green)" : G.score >= 45 ? "var(--amber)" : "var(--red)";
      return `<tr data-tk="${d.ticker}">
        <td><span class="rk-num">${i + 1}</span></td>
        <td><span class="rk-tk">${d.ticker}</span> <span class="sub">${d.sector}</span></td>
        <td><span class="rk-score" style="color:${sc}">${G.score.toFixed(0)}</span></td>
        <td class="${G.passed >= 5 ? "up" : G.passed <= 2 ? "down" : ""}">${G.passed}/7</td>
        <td class="${G.grahamMOS == null ? "" : G.grahamMOS >= 0 ? "up" : "down"}">${G.grahamMOS == null ? "n/m" : (G.grahamMOS >= 0 ? "+" : "") + (G.grahamMOS * 100).toFixed(0) + "%"}</td>
        <td class="${G.pb == null ? "" : G.pb <= 1.5 ? "up" : G.pb > 4 ? "down" : ""}">${G.pb ? G.pb.toFixed(2) + "×" : "–"}</td>
        <td class="${G.currentRatio == null ? "" : G.currentRatio >= 2 ? "up" : G.currentRatio < 1 ? "down" : ""}">${G.currentRatio ? G.currentRatio.toFixed(2) : "–"}</td>
        <td class="${G.netnet ? "up" : ""}">${G.priceToNcav != null ? (G.priceToNcav * 100).toFixed(0) + "%" : "–"}</td>
        <td class="${G.paysDiv ? "up" : "sub"}">${G.paysDiv ? G.divYield.toFixed(1) + "%" : "–"}</td>
        <td class="sub">${money(d.mktCap)}</td>
      </tr>`;
    }).join("");

    el("main").innerHTML = `
      <div class="hdr">
        <div>
          <div class="tick" style="color:#5aa9d6">🛡 GRAHAM VALUE</div>
          <div class="co">classic Security Analysis — margin of safety · net current asset value · defensive checklist</div>
        </div>
        <div class="spacer"></div>
        <div style="text-align:right"><div class="sub">NET-NETS</div><div class="stat sm" style="color:var(--green)">${netnets.length}</div></div>
        <div style="text-align:right;border-left:1px solid var(--line);padding-left:14px"><div class="sub">DEFENSIVE (6-7/7)</div><div class="stat sm" style="color:var(--cyan)">${stalwarts.length}</div></div>
      </div>

      <div class="note" style="margin-bottom:12px;border-left-color:#5aa9d6">
        <b style="color:#5aa9d6">“The margin of safety is the central concept of investment.”</b> Graham valued a business by its assets, average earning power and dividends — not its story — then demanded a discount to that value. <b>Graham Number</b> = √(22.5 × EPS × book/share). <b>Net current asset value</b> = current assets − all liabilities; a stock under NCAV means you get the operating business for free. Tap a column to re-rank, a row to open.
      </div>

      ${netnets.length ? `<div class="card" style="margin-bottom:12px;border-left:3px solid var(--green)">
        <h3>★ NET-NET BARGAINS <span class="unit">trading below net current asset value — the rarest Graham signal</span></h3>
        ${Chart.hbars(netnets.slice(0, 10).map(x => ({ label: x.d.ticker, value: x.G.priceToNcav * 100, color: x.G.deepNetnet ? "var(--green)" : "var(--amber)", display: (x.G.priceToNcav * 100).toFixed(0) + "% of NCAV" })), { max: 105, labelW: 52 })}
        <div class="sub" style="margin-top:6px">Under 100% = below liquid assets net of all debt · under 67% (green) = Graham's deep two-thirds bargain.</div>
      </div>` : `<div class="note" style="margin-bottom:12px">No classic net-nets in this 121-name large-cap universe right now — expected. True net-nets are almost always tiny, forgotten micro-caps; in 1932 over 40% of NYSE industrials were net-nets, today a handful.</div>`}

      <div class="grid g2" style="margin-bottom:12px">
        <div class="card" style="border-left:3px solid var(--green)"><h3>DEEPEST MARGIN OF SAFETY <span class="unit">discount to Graham Number</span></h3>
          ${Chart.hbars(byMOS.slice(0, 10).map(x => ({ label: x.d.ticker, value: Math.max(0, x.G.grahamMOS * 100), color: "var(--green)", display: (x.G.grahamMOS >= 0 ? "+" : "") + (x.G.grahamMOS * 100).toFixed(0) + "%" })), { labelW: 52 })}</div>
        <div class="card" style="border-left:3px solid var(--cyan)"><h3>DEFENSIVE STALWARTS <span class="unit">6–7 of 7 Graham criteria</span></h3>
          ${stalwarts.length ? stalwarts.slice(0, 10).map(x => `<div class="pe-row" data-tk="${x.d.ticker}"><span class="pe-tk">${x.d.ticker}</span><span class="sub">${x.d.name}</span><span class="pe-val"><b style="color:var(--cyan)">${x.G.passed}/7</b> ${x.G.paysDiv ? x.G.divYield.toFixed(1) + "%" : ""}</span></div>`).join("") : `<div class="sub">None clear 6/7 — modern large caps rarely pass Graham's strict P/B ≤1.5 test.</div>`}</div>
      </div>

      <div class="card" style="padding:6px 8px"><div style="overflow-x:auto;max-height:64vh;overflow-y:auto"><table class="rank">
        <thead><tr><th>#</th><th>TICKER · SECTOR</th>${th}</tr></thead>
        <tbody>${body}</tbody>
      </table></div></div>`;

    el("main").querySelectorAll("th[data-gsort]").forEach(h => h.onclick = () => {
      const k = h.dataset.gsort;
      if (grahamState.sort === k) grahamState.dir *= -1;
      else { grahamState.sort = k; grahamState.dir = (k === "pb" || k === "ncav") ? 1 : -1; }
      renderGraham();
    });
    el("main").querySelectorAll("[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
  }
  function showGraham() {
    state.view = "graham";
    setViewBtn("grahamBtn");
    renderWatchlist();
    renderGraham();
    closeDrawer();
    window.scrollTo({ top: 0 });
    syncNav();
    pushNav();
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
    const keep = d.ownersKeep || 0;
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
    let v = keep >= .9 ? 2 : keep >= .8 ? 1 : keep >= .65 ? 0 : keep >= .5 ? -1 : -2;
    sig.push({ k: "SBC X-RAY", w: 20, v, why: `keeps ${(keep * 100).toFixed(0)}¢/$ · SBC ${d.sbcPctRev == null ? "n/a" : d.sbcPctRev.toFixed(1) + "% of rev"} · shares ${trend.chg >= 0 ? "+" : ""}${(trend.chg || 0).toFixed(1)}% over the record` });

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
    if (looksCheap && (keep < 0.6 || (!finSector && Q.fcfAfterSbc != null && Q.fcfAfterSbc < 0))) call = "TRAP";
    else if (d.bucket === "tragic" && score < 45) call = "AVOID";
    else if (L && (L.zone === "fat" || (cagr != null && cagr >= 0.15)) && keep >= 0.7 && qV >= 0) call = "SWING";
    else if (score >= 62 && ivV >= 0) call = "ACC";
    else if (sbcV >= 1 && qV >= 1 && ivV <= 0) call = "STALK";
    else if (score >= 48) call = "WATCH";
    else call = "PASS";
    const C = CALLS[call];

    // ---- one written thesis ----
    const bits = [];
    bits.push(keep >= .85 ? `Earnings are real (${(keep * 100).toFixed(0)}¢ of every GAAP dollar reaches owners)` : keep >= .65 ? `Earnings need a ${(100 - keep * 100).toFixed(0)}% SBC haircut` : `Reported earnings are heavily inflated by stock comp (only ${(keep * 100).toFixed(0)}¢/$ real)`);
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

  /* ------------------------ 📊 CUSTOM SCREENER ------------------------ */
  const screenState = { bucket: "all", zone: "all", gMin: 0, peMax: "", sbcMax: "", capMin: "", sector: "all", favOnly: false, divOnly: false, sort: "composite" };
  function renderQualityMap() {
    const points = window.ScoreEngine ? window.ScoreEngine.qualityMarketMap(DATA, marketContext()) : [];
    const count = points.length;
    const dots = points.map(p => {
      const x = Math.max(6, Math.min(94, 8 + (p.businessQuality || 0) * 0.84));
      const y = Math.max(6, Math.min(94, 92 - (p.marketReward || 0) * 0.84));
      const val = p.valuation == null ? 50 : p.valuation;
      const bg = val >= 70 ? "var(--green)" : val >= 55 ? "var(--amber)" : val >= 40 ? "var(--orange)" : "var(--red)";
      const fg = val >= 55 ? "#081019" : "#fff";
      const size = Math.max(28, Math.min(44, 28 + ((p.longTermView || 0) / 100) * 16));
      return `<button class="map-dot" data-tk="${p.ticker}" title="${p.ticker} · BQ ${fmtScore(p.businessQuality)} · MR ${fmtScore(p.marketReward)} · Val ${fmtScore(p.valuation)} · ${p.label}"
        style="left:${x}%;top:${y}%;width:${size}px;height:${size}px;background:${bg};color:${fg}">${p.ticker}</button>`;
    }).join("");
    el("main").innerHTML = toolHeader("◎", "QUALITY x MARKET MAP", "Business Quality on X axis, Market Reward on Y axis, dot color is valuation support",
      `<div style="text-align:right"><div class="sub">UNIVERSE</div><div class="stat sm" style="color:var(--cyan)">${count}</div></div>`)
      + `<div class="grid g3">
        <div class="card" style="grid-column:span 3">
          <h3>QUALITY VS MARKET REWARD <span class="unit">click any ticker</span></h3>
          <div class="map-wrap">
            <div class="map-axis" style="left:10px;top:8px">Market Reward ↑</div>
            <div class="map-axis" style="right:12px;bottom:8px">Business Quality →</div>
            <div class="map-axis" style="left:50%;top:50%;transform:translate(-50%,-50%);color:#263145">50 / 50</div>
            <div style="position:absolute;left:50%;top:0;bottom:0;border-left:1px dashed #263145"></div>
            <div style="position:absolute;left:0;right:0;top:50%;border-top:1px dashed #263145"></div>
            ${dots}
          </div>
          <div class="chart-legend">
            <span><i style="background:var(--green)"></i>valuation supportive</span>
            <span><i style="background:var(--amber)"></i>fair/mixed</span>
            <span><i style="background:var(--orange)"></i>demanding</span>
            <span><i style="background:var(--red)"></i>expensive/risky</span>
          </div>
        </div>
        <div class="card" style="grid-column:span 3">
          <h3>TOP QUADRANTS <span class="unit">sorted by long-term score</span></h3>
          <div style="overflow:auto"><table class="rank">
            <thead><tr><th>TICKER</th><th>LABEL</th><th>BUSINESS</th><th>MARKET</th><th>VALUATION</th><th>LONG TERM</th></tr></thead>
            <tbody>${points.slice().sort((a, b) => (b.longTermView || 0) - (a.longTermView || 0)).slice(0, 25).map(p => `<tr data-tk="${p.ticker}">
              <td><span class="rk-tk">${p.ticker}</span> <span class="sub">${p.sector}</span></td>
              <td>${p.label}</td>
              <td style="color:${scoreColorOf(p.businessQuality)}">${fmtScore(p.businessQuality)}</td>
              <td style="color:${scoreColorOf(p.marketReward)}">${fmtScore(p.marketReward)}</td>
              <td style="color:${scoreColorOf(p.valuation)}">${fmtScore(p.valuation)}</td>
              <td style="color:${scoreColorOf(p.longTermView)}">${fmtScore(p.longTermView)}</td>
            </tr>`).join("")}</tbody>
          </table></div>
        </div>
      </div>`;
    el("main").querySelectorAll("[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
  }
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

  /* ------------------------ 🎯 TRIGGERS TODAY ------------------------ */
  function renderTriggers() {
    const fats = [], belowGraham = [], netnets = [], nearLow = [];
    DATA.forEach(d => {
      const L = ivLadder(d), G = grahamOf(d);
      if (L && L.zone === "fat") fats.push({ d, v: L.impliedCAGR });
      if (G && G.grahamMOS != null && G.grahamMOS > 0.1) belowGraham.push({ d, v: G.grahamMOS });
      if (G && G.netnet) netnets.push({ d, v: G.priceToNcav });
    });
    fats.sort((a, b) => b.v - a.v); belowGraham.sort((a, b) => b.v - a.v);
    const section = (title, color, items, fmt, empty) => `<div class="card" style="border-left:3px solid ${color};margin-bottom:12px">
      <h3>${title} <span class="unit">${items.length} names</span></h3>
      ${items.length ? items.slice(0, 25).map(x => `<div class="pe-row" data-tk="${x.d.ticker}"><span class="pe-tk"><span class="star ${state.favs.has(x.d.ticker) ? "on" : ""}" data-fav="${x.d.ticker}">${state.favs.has(x.d.ticker) ? "★" : "☆"}</span> ${x.d.ticker}</span><span class="sub">${x.d.name}</span><span class="pe-val" style="color:${color}">${fmt(x.v)}</span></div>`).join("") : `<div class="sub">${empty}</div>`}</div>`;
    el("main").innerHTML = toolHeader("🎯", "TRIGGERS TODAY", "where the frameworks say ACT right now — refreshes with live prices",
      `<div style="text-align:right"><div class="sub">SIGNALS</div><div class="stat sm" style="color:var(--red)">${fats.length + belowGraham.length + netnets.length}</div></div>`)
      + section("★ FAT PITCHES — priced for ≥15%/yr (IV15)", "var(--green)", fats, v => (v * 100).toFixed(1) + "%/yr", "Nothing priced for 15%+ right now — patience is a position.")
      + section("BELOW GRAHAM NUMBER — classic margin of safety", "#5aa9d6", belowGraham, v => (v * 100).toFixed(0) + "% below fair", "Nothing trading meaningfully below its Graham Number.")
      + section("NET-NETS — below net current asset value", "var(--amber)", netnets, v => (v * 100).toFixed(0) + "% of NCAV", "No large-cap net-nets — expected.");
    el("main").querySelectorAll(".pe-row").forEach(r => r.onclick = (e) => { if (e.target.dataset.fav) { toggleFav(e.target.dataset.fav); e.stopPropagation(); renderTriggers(); } else selectTicker(r.dataset.tk); });
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

  /* ------------------------ 📅 EARNINGS CALENDAR (live Finnhub) ------------------------ */
  function renderCalendar() {
    el("main").innerHTML = toolHeader("📅", "EARNINGS CALENDAR", "upcoming reports across your universe — with the framework verdict for each")
      + `<div class="card" id="calBody"><div class="sub" style="padding:16px">Loading upcoming earnings…</div></div>`;
    const key = state.keys.finnhub;
    if (!key) { el("calBody").innerHTML = `<div class="sub" style="padding:16px">Connect a free Finnhub key (⚙ gear) to load the live earnings calendar.</div>`; return; }
    const today = new Date(), to = new Date(today.getTime() + 21 * 864e5);
    const fmt = dt => dt.toISOString().slice(0, 10);
    fetchJsonWithRetry(`https://finnhub.io/api/v1/calendar/earnings?from=${fmt(today)}&to=${fmt(to)}&token=${key}`, { provider: "Finnhub calendar", ticker: "UNIVERSE" })
      .then(j => {
        const uni = new Set(DATA.map(d => d.ticker));
        const items = (j.earningsCalendar || []).filter(e => uni.has(e.symbol)).sort((a, b) => a.date.localeCompare(b.date));
        if (!items.length) { el("calBody").innerHTML = `<div class="sub" style="padding:16px">No upcoming reports for your universe in the next 3 weeks.</div>`; return; }
        el("calBody").innerHTML = `<div style="overflow-x:auto"><table class="rank">
          <thead><tr><th>DATE</th><th>TICKER</th><th>EPS EST</th><th>WHEN</th><th>SBC BUCKET</th><th>IV15 ZONE</th></tr></thead>
          <tbody>${items.slice(0, DATA.length).map(e => { const d = DATA.find(x => x.ticker === e.symbol), L = d && ivLadder(d), z = L ? ZONE[L.zone].label : "n/m";
            return `<tr data-tk="${e.symbol}"><td>${e.date}</td><td><span class="rk-tk">${e.symbol}</span></td>
              <td>${e.epsEstimate != null ? "$" + e.epsEstimate.toFixed(2) : "–"}</td>
              <td class="sub">${e.hour === "bmo" ? "pre-open" : e.hour === "amc" ? "after-close" : e.hour || ""}</td>
              <td style="color:${d ? BUCKETS[d.bucket].color : "var(--muted)"}">${d ? d.bucket : "?"}</td>
              <td style="color:${L ? ZONE[L.zone].color : "var(--muted)"}">${z}</td></tr>`; }).join("")}</tbody></table></div>`;
        el("calBody").querySelectorAll("tr[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
      }).catch(() => { el("calBody").innerHTML = `<div class="sub" style="padding:16px">Couldn't load the calendar (rate limit or network). Try again shortly.</div>`; });
  }

  /* ============================================================================
     ⚄ OPTIONS DESK — the frameworks turned into option plays.
     Real ~35-day ATM implied vol + realized vol + put/call OI per name
     (opt:{} blocks). Premium estimates are Black-Scholes on the stored ATM
     vol — approximations for sizing the idea, not executable quotes.
     ============================================================================ */
  const normCdf = (x) => {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const dNorm = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
    const p = dNorm * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x >= 0 ? 1 - p : p;
  };
  function bsPrice(type, S, K, iv, dte, r = 0.04) {
    if (!S || !K || !iv || !dte || dte <= 0) return null;
    const T = dte / 365, sq = iv * Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + iv * iv / 2) * T) / sq, d2 = d1 - sq;
    return type === "put"
      ? K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1)
      : S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  }
  const roundStrike = (p) => { const inc = p < 25 ? 2.5 : p < 100 ? 5 : p < 250 ? 10 : p < 500 ? 25 : 50; return Math.round(p / inc) * inc; };

  // one stock -> its best option play (or null)
  function optionPlayOf(d, V) {
    V = V || verdictOf(d);
    if (V.noRank) return null;
    const L = V.L, o = d.opt;
    const price = L ? L.price : (state.live[d.ticker]?.quote?.price ?? d.price);
    if (!price || price <= 0) return null;
    // dte recomputed from stored expiry so it can never silently age; chains
    // inside 7 days (or expired) are excluded from premium estimates.
    let dte = 35, chainStale = false;
    if (o && o.exp) {
      dte = Math.round((Date.parse(o.exp + "T21:00:00Z") - Date.now()) / 864e5);
      if (dte < 7) chainStale = true;
    }
    const iv = o && !chainStale ? o.iv : null, rv = o ? o.rv : null;
    const rich = iv && rv ? iv / rv : null; // premium richness: IV vs realized
    const keep = d.ownersKeep || 0;

    // 1 · GET PAID TO WAIT — cash-secured put at the IV15 buy target
    if (L && ["STALK", "WATCH", "ACC"].includes(V.call) && keep >= 0.8 && V.score >= 55
        && price > L.IV15 && price <= L.IV15 * 1.5) {
      const K = roundStrike(Math.min(L.IV15, price * 0.97));
      if (K > 0 && K < price) {
        const prem = iv ? bsPrice("put", price, K, iv, dte) : null;
        const annYield = prem && K ? (prem / K) * (365 / dte) * 100 : null;
        return { type: "csp", label: "SELL PUT — PAID TO WAIT", color: "var(--green)", K, prem, annYield, rich, iv, dte, exp: o && o.exp,
          why: `${V.C.label.split(" — ")[0]} at $${price.toFixed(0)} · IV15 buy target $${L.IV15.toFixed(0)} — sell the $${K} put: collect ${annYield ? annYield.toFixed(0) + "%/yr" : "premium"} or get the entry you already wanted${rich ? (rich >= 1.15 ? " · premium RICH (IV " + (iv * 100).toFixed(0) + "% vs " + (rv * 100).toFixed(0) + "% realized)" : rich <= 0.9 ? " · premium thin — smaller edge" : "") : ""}` };
      }
    }
    // 2 · FAT-PITCH CALLS — leverage the swing
    if (L && (V.call === "SWING" || (V.call === "ACC" && V.cagr >= 0.13)) && keep >= 0.7) {
      const K = roundStrike(price);
      const prem = iv ? bsPrice("call", price, K, iv, dte) : null;
      return { type: "call", label: "LONG CALLS / LEAPS — FAT PITCH", color: "#7dd87d", K, prem, rich, iv, dte, exp: o && o.exp,
        why: `${V.C.label.split(" — ")[0]} · priced for ${(V.cagr * 100).toFixed(0)}%/yr on the range — ${rich != null ? (rich <= 1.05 ? "options fairly priced (IV " + (iv * 100).toFixed(0) + "% ≈ realized " + (rv * 100).toFixed(0) + "%) — leverage the pitch with LEAPS" : "premium rich — prefer stock, deep-ITM LEAPS or call spreads") : "prefer long-dated, deep-ITM strikes"}` };
    }
    // 3 · PREMIUM HARVEST — covered calls on clean, fully-priced names
    if (L && keep >= 0.85 && V.cagr != null && V.cagr < 0.09 && rich != null && rich >= 1.15 && V.call !== "TRAP" && V.call !== "AVOID") {
      const K = roundStrike(price * 1.08);
      const prem = iv ? bsPrice("call", price, K, iv, dte) : null;
      const annYield = prem ? (prem / price) * (365 / dte) * 100 : null;
      return { type: "cc", label: "COVERED CALL — HARVEST", color: "var(--amber)", K, prem, annYield, rich, iv, dte, exp: o && o.exp,
        why: `clean earnings but only ${(V.cagr * 100).toFixed(0)}%/yr at this price · IV ${(iv * 100).toFixed(0)}% vs ${(rv * 100).toFixed(0)}% realized — sell the $${K} call against stock for ${annYield ? "~" + annYield.toFixed(0) + "%/yr" : "premium"} while you wait` };
    }
    // 4 · BEARISH — dilution machines priced for negative returns
    if ((V.call === "AVOID" || V.call === "TRAP") && V.cagr != null && V.cagr < 0.02) {
      const K = roundStrike(price * 0.9);
      const prem = iv ? bsPrice("put", price, K, iv, dte) : null;
      return { type: "bear", label: "BEARISH — PUTS / SPREADS", color: "var(--red)", K, prem, rich, iv, dte, exp: o && o.exp,
        why: `${V.C.label.split(" — ")[0]} · priced for ${(V.cagr * 100).toFixed(1)}%/yr even on the friendly case${rich != null ? (rich >= 1.2 ? " · IV already rich (" + (iv * 100).toFixed(0) + "%) — use put SPREADS, not naked longs" : " · downside not fully priced (IV " + (iv * 100).toFixed(0) + "%)") : ""} · momentum can run — size small, define risk` };
    }
    return null;
  }

  const optDteNow = (o) => o && o.exp ? Math.round((Date.parse(o.exp + "T21:00:00Z") - Date.now()) / 864e5) : null;
  const optAsOf = (o) => o && o.exp && o.dte != null ? new Date(Date.parse(o.exp + "T21:00:00Z") - o.dte * 864e5) : null;
  const optState = { earnings: {}, earnLoaded: false, earnFailed: false, sort: "iv", dir: -1 };
  function renderOptions() {
    const key = state.keys.finnhub;
    const withOpt = DATA.filter(d => d.opt && d.opt.iv);
    const plays = [];
    DATA.forEach(d => { const p = optionPlayOf(d); if (p) plays.push({ d, p }); });
    const buckets = { csp: [], call: [], cc: [], bear: [] };
    plays.forEach(x => buckets[x.p.type].push(x));
    buckets.csp.sort((a, b) => (b.p.annYield || 0) - (a.p.annYield || 0));
    buckets.call.sort((a, b) => (a.p.rich || 9) - (b.p.rich || 9));
    buckets.cc.sort((a, b) => (b.p.annYield || 0) - (a.p.annYield || 0));
    buckets.bear.sort((a, b) => (a.p.rich || 9) - (b.p.rich || 9));

    const earn = optState.earnings;
    const row = (x) => {
      const d = x.d, p = x.p;
      const e = earn[d.ticker];
      return `<div class="op-row" data-tk="${d.ticker}">
        <span class="pe-tk">${d.ticker}${e ? ` <span title="earnings ${e}" style="color:var(--orange)">⚠</span>` : ""}</span>
        <span class="sub">${p.why}${e ? ` · <b style="color:var(--orange)">earnings ${e} — premium juiced, expect a move</b>` : ""}</span>
        <span class="op-strike" style="color:${p.color}">$${p.K}${p.exp ? `<br><span class="sub" style="font-weight:400">${p.exp.slice(5)} · ${p.prem != null ? "≈$" + p.prem.toFixed(2) : "est n/a"}${p.annYield ? " · " + p.annYield.toFixed(0) + "%/yr" : ""}</span>` : ""}</span>
      </div>`;
    };
    const section = (title, color, arr, sub) => arr.length ? `<div class="card" style="margin-bottom:12px;border-left:3px solid ${color}">
      <h3>${title} <span class="unit">${sub} · ${arr.length} names</span></h3>${arr.slice(0, 12).map(row).join("")}</div>` : "";

    const sorted = [...withOpt].map(d => ({ d, r: d.opt.rv ? d.opt.iv / d.opt.rv : null }))
      .sort((a, b) => {
        const k = optState.sort;
        const va = k === "iv" ? a.d.opt.iv : k === "rv" ? (a.d.opt.rv ?? -1) : k === "rich" ? (a.r ?? -1) : (a.d.opt.pcr ?? -1);
        const vb = k === "iv" ? b.d.opt.iv : k === "rv" ? (b.d.opt.rv ?? -1) : k === "rich" ? (b.r ?? -1) : (b.d.opt.pcr ?? -1);
        return (va - vb) * optState.dir;
      });

    el("main").innerHTML = toolHeader("⚄", "OPTIONS DESK", "the frameworks turned into trades — strikes from the IV ladder, direction from the brain, pricing vs realized vol",
      `<div style="text-align:right"><div class="sub">PLAYS ON THE TAPE</div><div class="stat sm" style="color:#d6a2ff">${plays.length}</div></div>`)
      + `<div class="note" style="margin-bottom:12px;border-left-color:#d6a2ff">Plays surface here automatically when a setup qualifies: <b style="color:var(--green)">sell puts</b> where you already want to own at the IV15 target · <b style="color:#7dd87d">long calls</b> on fat pitches with fair vol · <b style="color:var(--amber)">covered calls</b> on clean-but-priced names with rich premium · <b style="color:var(--red)">puts/spreads</b> on dilution machines. Premiums are Black-Scholes estimates on the stored ~35-day ATM vol — for sizing the idea, not executable quotes. ⚠ = earnings inside 3 weeks. ${!key ? '<b style="color:var(--orange)">No Finnhub key — earnings dates are NOT being checked; verify before trading premium.</b>' : optState.earnFailed ? '<b style="color:var(--orange)">Earnings-calendar check FAILED — verify earnings dates yourself.</b>' : !optState.earnLoaded ? "Checking earnings calendar…" : "Earnings dates checked live."}</div>`
      + section("🟢 GET PAID TO WAIT — CASH-SECURED PUTS AT YOUR BUY PRICE", "var(--green)", buckets.csp, "strike ≈ IV15 buy target · EST. annualized yield · capital at risk = strike × 100/contract — highest yields carry the highest assignment risk")
      + section("🚀 FAT-PITCH CALLS — LEVERAGE THE SWING", "#7dd87d", buckets.call, "brain says swing/accumulate · cheapest vol first · max loss = 100% of premium paid")
      + section("🌾 PREMIUM HARVEST — COVERED CALLS", "var(--amber)", buckets.cc, "clean earnings, fully priced, rich IV")
      + section("🔻 BEARISH — DEFINED-RISK PUTS", "var(--red)", buckets.bear, "dilution machines priced for negative returns")
      + (withOpt.length ? `<div class="card" style="padding:6px 8px"><h3 style="padding:6px 8px 0">THE VOL BOARD <span class="unit">${withOpt.length} names · IV snapshot ${(() => { const a = optAsOf(withOpt[0] && withOpt[0].opt); if (!a) return "date unknown"; const days = Math.round((Date.now() - a.getTime()) / 864e5); return a.toISOString().slice(0, 10) + (days > 7 ? " · <b style=&quot;color:var(--orange)&quot;>⚠ " + days + "d OLD — refresh --options before trading</b>" : ""); })()} · tap a column to sort · IV/RV &gt; 1.15 = premium rich (sell) · &lt; 0.9 = cheap (buy)</span></h3>
        <div style="overflow-x:auto;max-height:56vh;overflow-y:auto"><table class="rank">
        <thead><tr><th>TICKER</th><th data-osort="iv" class="${optState.sort === "iv" ? "sorted" : ""}">ATM IV</th><th data-osort="rv" class="${optState.sort === "rv" ? "sorted" : ""}">REALIZED</th><th data-osort="rich" class="${optState.sort === "rich" ? "sorted" : ""}">IV/RV</th><th data-osort="pcr" class="${optState.sort === "pcr" ? "sorted" : ""}">PUT/CALL OI</th><th>EXPIRY</th><th>PLAY</th></tr></thead>
        <tbody>${sorted.slice(0, DATA.length).map((y) => { const d = y.d, r = y.r; const pl = plays.find(x => x.d.ticker === d.ticker); const p = pl && pl.p;
          return `<tr data-tk="${d.ticker}"><td><span class="rk-tk">${d.ticker}</span> <span class="sub">${d.sector}</span></td>
          <td>${(d.opt.iv * 100).toFixed(0)}%</td><td class="sub">${d.opt.rv ? (d.opt.rv * 100).toFixed(0) + "%" : "–"}</td>
          <td class="${r == null ? "" : r >= 1.15 ? "up" : r <= 0.9 ? "down" : ""}">${r ? r.toFixed(2) : "–"}</td>
          <td class="${d.opt.pcr == null ? "" : d.opt.pcr >= 1.3 ? "down" : d.opt.pcr <= 0.6 ? "up" : ""}">${d.opt.pcr ?? "–"}</td>
          <td class="${(optDteNow(d.opt) ?? 99) < 7 ? "down" : "sub"}">${d.opt.exp ? d.opt.exp.slice(5) + " (" + (optDteNow(d.opt) ?? "?") + "d)" + ((optDteNow(d.opt) ?? 99) < 7 ? " ⚠" : "") : "–"}</td>
          <td>${p ? `<span class="op-badge" style="color:${p.color};border-color:${p.color}">${p.label.split(" — ")[0]}</span>` : ""}</td></tr>`; }).join("")}</tbody>
        </table></div></div>`
      : `<div class="note">Options data hasn't been baked in yet — ask me to refresh options and I'll pull ~35-day implied vol, realized vol and open interest for the whole universe. The play sections above still work off the frameworks.</div>`);

    el("main").querySelectorAll("[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
    el("main").querySelectorAll("th[data-osort]").forEach(h => h.onclick = (ev) => {
      ev.stopPropagation();
      const k = h.dataset.osort;
      if (optState.sort === k) optState.dir *= -1; else { optState.sort = k; optState.dir = -1; }
      renderOptions();
    });

    // earnings flags (live, async — re-annotate once loaded)
    if (key && !optState.earnLoaded && !optState.earnFailed) {
      const today = new Date(), to = new Date(today.getTime() + 21 * 864e5);
      const fmtD = dt => dt.toISOString().slice(0, 10);
      fetchJsonWithRetry(`https://finnhub.io/api/v1/calendar/earnings?from=${fmtD(today)}&to=${fmtD(to)}&token=${key}`, { provider: "Finnhub options earnings", ticker: "UNIVERSE" })
        .then(j => {
          const uni = new Set(DATA.map(d => d.ticker));
          (j.earningsCalendar || []).forEach(e => { if (uni.has(e.symbol)) optState.earnings[e.symbol] = e.date; });
          optState.earnLoaded = true;
          if (state.view === "options") renderOptions();
        }).catch(() => { optState.earnFailed = true; if (state.view === "options") renderOptions(); });
    }
  }
  const showOptions = () => showView("options", renderOptions, "optBtn");

  function renderInflation() {
    const rows = DATA.map(d => ({ d, inf: inflationOf(d), m: marketScoreOf(d), L: ivLadder(d) }));
    const resilient = [...rows].sort((a, b) => b.inf.score - a.inf.score || (b.m?.businessQuality?.score || 0) - (a.m?.businessQuality?.score || 0)).slice(0, 10);
    const pressured = [...rows].sort((a, b) => a.inf.score - b.inf.score || (b.d.truePE || 0) - (a.d.truePE || 0)).slice(0, 10);
    const sectorRows = Object.entries(INFLATION_SECTORS).filter(([k]) => k !== "SPY").map(([k, p]) => {
      const names = rows.filter(x => x.inf.etf === k);
      const avg = names.length ? names.reduce((a, x) => a + x.inf.score, 0) / names.length : 50;
      return { k, p, avg };
    }).sort((a, b) => a.avg - b.avg);
    const macroCard = (s) => `<div class="card"><h3>${s.k}</h3><div class="stat" style="color:${s.yoy >= 6 ? "var(--red)" : s.yoy >= 4 ? "var(--orange)" : s.yoy >= 3 ? "var(--amber)" : "var(--green)"}">${s.yoy.toFixed(1)}%</div><div class="sub">YoY · ${s.heat}</div><div class="sub" style="margin-top:6px">${s.why}</div></div>`;
    const stockRow = (x) => `<div class="home-row" data-tk="${x.d.ticker}"><div><b>${x.d.ticker}</b><span>${x.d.sector}</span></div><div class="sub">${x.inf.bits.slice(0, 2).join(" · ") || x.inf.profile.note}</div><strong style="color:${x.inf.color}">${x.inf.score}</strong></div>`;
    el("main").innerHTML = `
      <div class="hdr">
        <div><div class="tick" style="color:var(--orange)">INFLATION DESK</div><div class="co">CPI · Core CPI · Shelter · Energy · Food · PPI -> sector pressure -> ticker impact</div></div>
        <div class="spacer"></div><div style="text-align:right"><div class="sub">SNAPSHOT</div><div class="stat sm">${INFLATION.asOf}</div></div>
      </div>
      <div class="note" style="margin-bottom:12px">Bundled official macro snapshot: ${INFLATION.source}. ${INFLATION.nextRelease}. This desk estimates how inflation can affect stock prices through <b>valuation multiples</b>, <b>margins</b>, <b>consumer demand</b>, and <b>sector pass-through</b>.</div>
      <div class="grid g3" style="margin-bottom:12px">${INFLATION.series.map(macroCard).join("")}</div>
      <div class="grid g2">
        <div class="card"><h3>SECTOR INFLATION PRESSURE <span class="unit">higher score = more resilient</span></h3>${sectorRows.map(x => `<div class="home-row"><div><b>${x.k}</b><span>${x.p.name}</span></div><div class="sub">${x.p.note}</div><strong style="color:${scoreColorOf(x.avg)}">${x.avg.toFixed(0)}</strong></div>`).join("")}</div>
        <div class="card"><h3>INFLATION RESILIENT WATCHLIST</h3>${resilient.map(stockRow).join("")}</div>
        <div class="card"><h3>INFLATION PRESSURED WATCHLIST</h3>${pressured.map(stockRow).join("")}</div>
        <div class="card"><h3>HOW TO READ IT</h3>
          <div class="note" style="margin-bottom:8px"><b style="color:var(--red)">Sticky core/shelter</b> raises discount rates and hurts long-duration P/E. <b style="color:var(--orange)">PPI/energy</b> hits margins first. <b style="color:var(--green)">Pricing power</b> and high margins are the shield.</div>
          <div class="kv"><span class="k">Stock price path</span><span class="v">multiple compression + EPS revisions</span></div>
          <div class="kv"><span class="k">Best defense</span><span class="v">pricing power, low input cost, clean balance sheet</span></div>
          <div class="kv"><span class="k">Worst setup</span><span class="v">high P/E, weak margins, consumer sensitivity</span></div>
        </div>
      </div>`;
    el("main").querySelectorAll("[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
  }
  function showInflation() { showView("inflation", renderInflation, "macroBtn"); }

  /* ============ 🧾 DATA AUDIT — can this terminal be trusted? ============ */
  function renderAudit() {
    const tiers = { "FILING VERIFIED*": 0, "PARTIALLY VERIFIED": 0, "HEURISTIC": 0 };
    let conflicts = 0, verifiedFields = 0, missingFields = 0;
    const total = DATA.length;
    DATA.forEach(d => {
      const sv = d.secv || { verified: [], conflict: [], missing: [] };
      tiers[dataQualityOf(d).label]++;
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
    const atLeastPartial = tiers["FILING VERIFIED*"] + tiers["PARTIALLY VERIFIED"];
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
      `<div style="text-align:right"><div class="sub">FILING VERIFIED*</div><div class="stat sm" style="color:var(--green)">${tiers["FILING VERIFIED*"]}/${total}</div><div class="sub">${atLeastPartial}/${total} at least partial</div></div>`)
      + `<div class="grid g3" style="margin-bottom:12px">
        <div class="card"><h3>VERSIONS</h3>
          <div class="kv"><span class="k">Official universe</span><span class="v">${typeof UNIVERSE_VERSION !== "undefined" ? UNIVERSE_VERSION : "?"} (${DATA.length} names)</span></div>
          <div class="kv"><span class="k">SBC model</span><span class="v">${SBC_MODEL_VERSION}</span></div>
          <div class="kv"><span class="k">Formulas</span><span class="v">${FORMULA_VERSION}</span></div>
          <div class="kv"><span class="k">SEC data generated</span><span class="v">${typeof SEC_META !== "undefined" ? SEC_META.generated.slice(0, 10) : "n/a"}</span></div></div>
        <div class="card"><h3>VERIFICATION</h3>
          <div class="kv"><span class="k">Filing verified*</span><span class="v up">${tiers["FILING VERIFIED*"]}</span></div>
          <div class="kv"><span class="k">Partially verified</span><span class="v" style="color:var(--amber)">${tiers["PARTIALLY VERIFIED"]}</span></div>
          <div class="kv"><span class="k">Heuristic</span><span class="v sub">${tiers["HEURISTIC"]}</span></div>
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
      <div class="note" style="margin-bottom:12px">*FILING VERIFIED = 5+ core fields automatically reconciled to SEC XBRL facts with no open conflicts. PARTIALLY VERIFIED = at least 2 SEC matches, but conflicts or missing/non-comparable fields remain. This is NOT a manual line-by-line audit. Conflicts are flagged, never silently resolved. Missing SEC facts stay missing — never zero. Current coverage: <b>${tiers["FILING VERIFIED*"]}/${total} filing verified*</b>, <b>${atLeastPartial}/${total} at least partially verified</b>, <b>${missingFields}</b> missing/non-comparable field checks.</div>
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

  const showScreener = () => showView("screener", renderScreener, "screenBtn");
  const showCompare = () => showView("compare", renderCompare, "compareBtn");
  const showTriggers = () => showView("triggers", renderTriggers, "trigBtn");
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
  function renderCalendar() {
    el("main").innerHTML = toolHeader("📅", "EARNINGS CALENDAR", "market focus + upcoming reports across your universe")
      + `<div class="card" id="calBody"><div class="sub" style="padding:16px">Loading upcoming earnings...</div></div>`;
    const today = new Date(), to = new Date(today.getTime() + 21 * 864e5);
    const uni = new Set(allCompanies().map(d => d.ticker));
    const focusRows = bundledEarningsRows(today, to, false);
    const bundledUniRows = bundledEarningsRows(today, to, true);
    const rowHtml = (e, showTheme = false) => {
      const d = companyOf(e.symbol), L = d ? ivLadder(d) : null, z = L ? ZONE[L.zone].label : "market focus";
      const src = e.live ? "live" : e.bundled ? "focus" : "";
      const bucketColor = d ? BUCKETS[d.bucket].color : "var(--muted)";
      return `<tr ${d ? `data-tk="${e.symbol}"` : ""}><td>${e.date}</td><td><span class="rk-tk">${e.symbol}</span>${!d ? ` <span class="unit">${e.name || ""}</span>` : ""}</td>
        <td>${e.epsEstimate != null ? "$" + (+e.epsEstimate).toFixed(2) : "-"}</td>
        <td class="sub">${earningsWhen(e.hour)}</td>
        ${showTheme ? `<td class="sub">${e.theme || src}</td>` : `<td style="color:${bucketColor}">${d ? d.bucket : src}</td><td style="color:${L ? ZONE[L.zone].color : "var(--muted)"}">${z}</td>`}
      </tr>`;
    };
    const renderBody = (items, sourceLine) => {
      const focus = focusRows.length ? `<div class="card" style="margin-bottom:12px">
        <h3>THIS WEEK'S MARKET EARNINGS TAPE <span class="unit">${EARNINGS_FOCUS.source}</span></h3>
        <div class="note" style="margin-bottom:10px">${EARNINGS_FOCUS.note}</div>
        <div style="overflow-x:auto"><table class="rank">
          <thead><tr><th>DATE</th><th>TICKER</th><th>EPS EST</th><th>WHEN</th><th>WHY IT MATTERS</th></tr></thead>
          <tbody>${focusRows.map(e => rowHtml(e, true)).join("")}</tbody>
        </table></div>
      </div>` : "";
      el("calBody").outerHTML = focus + `<div class="card" id="calBody">
        <h3>YOUR 121-STOCK EARNINGS CALENDAR <span class="unit">${sourceLine}</span></h3>
        <div style="overflow-x:auto"><table class="rank">
          <thead><tr><th>DATE</th><th>TICKER</th><th>EPS EST</th><th>WHEN</th><th>SBC BUCKET</th><th>IV15 ZONE</th></tr></thead>
          <tbody>${items.slice(0, 80).map(e => rowHtml(e, false)).join("") || `<tr><td colspan="6" class="sub" style="padding:16px">No upcoming reports for your universe in the next 3 weeks.</td></tr>`}</tbody>
        </table></div>
      </div>`;
      el("main").querySelectorAll("tr[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
    };
    const key = state.keys.finnhub;
    if (!key) { renderBody(bundledUniRows, "bundled focus week; connect Finnhub for the full live feed"); return; }
    fetchJsonWithRetry(`https://finnhub.io/api/v1/calendar/earnings?from=${fmtEarningsDate(today)}&to=${fmtEarningsDate(to)}&token=${key}`, { provider: "Finnhub calendar", ticker: "UNIVERSE" })
      .then(j => {
        const live = (j.earningsCalendar || []).filter(e => uni.has(e.symbol));
        renderBody(mergeEarningsRows(live, bundledUniRows), "bundled focus week merged with live Finnhub");
      }).catch(() => { renderBody(bundledUniRows, "Finnhub unavailable; showing bundled focus week"); });
  }
  const showCalendar = () => showView("calendar", renderCalendar, "calBtn");

  /* ============================================================================
     ⌬ TECH DESK — the whole framework pointed at tech only.
     Tech is where SBC lives: software, semis, internet, payments/fintech.
     ============================================================================ */
  const TECH_EXTRA = new Set(["Social Media", "Streaming", "Gaming", "E-commerce", "E-commerce/Cloud",
    "Payments", "Crypto Exchange", "Fintech Brokerage", "Gaming/Betting"]);
  const isTech = (d) => ["XLK", "SMH"].includes(sectorETF(d.sector)) || TECH_EXTRA.has(d.sector);

  function techScatter(items) {
    // x = revenue CAGR %, y = SBC % of revenue → "is the SBC buying growth?"
    const W = 700, H = 380, P = { t: 26, r: 16, b: 34, l: 44 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const X = (g) => P.l + clamp((g + 10) / 50, 0, 1) * iw;      // -10%..+40%
    const Y = (s) => P.t + ih - clamp(s / 30, 0, 1) * ih;        // 0..30%+
    let g = "";
    // quadrant shading (split at 15% growth, 10% SBC)
    const mx = X(15), my = Y(10);
    g += `<rect x="${P.l}" y="${P.t}" width="${mx - P.l}" height="${my - P.t}" fill="rgba(255,91,107,.06)"/>`;      // low growth, high SBC
    g += `<rect x="${mx}" y="${my}" width="${P.l + iw - mx}" height="${P.t + ih - my}" fill="rgba(38,208,124,.06)"/>`; // high growth, low SBC
    [0, 10, 20, 30].forEach(s => { const y = Y(s); g += `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" stroke="#1c2434"/><text x="${P.l - 5}" y="${y + 3}" fill="#7d8798" font-size="8.5" text-anchor="end">${s}%</text>`; });
    [-10, 0, 10, 20, 30, 40].forEach(x => { const xx = X(x); g += `<text x="${xx}" y="${H - 16}" fill="#7d8798" font-size="8.5" text-anchor="middle">${x >= 0 ? "+" : ""}${x}%</text>`; });
    g += `<text x="${P.l + 6}" y="${P.t + 12}" fill="var(--red)" font-size="9.5" font-weight="700">WORST: DILUTION WITHOUT GROWTH</text>`;
    g += `<text x="${W - P.r - 6}" y="${P.t + ih - 8}" fill="var(--green)" font-size="9.5" font-weight="700" text-anchor="end">ELITE: GROWTH WITHOUT DILUTION</text>`;
    g += `<text x="${W / 2}" y="${H - 4}" fill="#576072" font-size="9" text-anchor="middle">REVENUE CAGR →</text>`;
    g += `<text x="12" y="${P.t + ih / 2}" fill="#576072" font-size="9" text-anchor="middle" transform="rotate(-90 12 ${P.t + ih / 2})">SBC % OF REVENUE →</text>`;
    const bcol = { clean: "#26d07c", middle: "#ffb000", high: "#ff8a3d", tragic: "#ff5b6b" };
    const byCap = [...items].sort((a, b) => b.d.mktCap - a.d.mktCap);
    const labeled = new Set(byCap.slice(0, 22).map(x => x.d.ticker));
    let dots = "";
    items.forEach(({ d, q }) => {
      if (q.revCAGR == null || d.sbcPctRev == null) return;
      const x = X(q.revCAGR), y = Y(d.sbcPctRev);
      dots += `<g data-tk="${d.ticker}" style="cursor:pointer">
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${labeled.has(d.ticker) ? 5 : 3.5}" fill="${bcol[d.bucket]}" stroke="#05070c" stroke-width="1"><title>${d.ticker} — rev CAGR ${q.revCAGR.toFixed(0)}%, SBC ${d.sbcPctRev.toFixed(1)}% of rev</title></circle>
        ${labeled.has(d.ticker) ? `<text x="${x.toFixed(1)}" y="${(y - 7).toFixed(1)}" fill="${bcol[d.bucket]}" font-size="8.5" font-weight="700" text-anchor="middle">${d.ticker}</text>` : ""}</g>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${g}${dots}</svg>`;
  }

  function renderTech() {
    const tech = DATA.filter(isTech);
    const rest = DATA.filter(d => !isTech(d));
    const items = tech.map(d => ({ d, q: qualityOf(d), r: rankOf(d), X: capexOf(d) }));
    const med = (arr) => medianOf(arr);
    const stat = {
      sbcT: med(tech.map(d => d.sbcPctRev)), sbcR: med(rest.map(d => d.sbcPctRev)),
      keepT: med(tech.map(d => d.ownersKeep)), keepR: med(rest.map(d => d.ownersKeep)),
      peT: med(tech.map(d => d.truePE)), peR: med(rest.map(d => d.truePE)),
      gapT: med(tech.filter(d => d.gaapEPS > 0 && d.nonGaapEPS > 0).map(d => (d.nonGaapEPS / d.gaapEPS - 1) * 100)),
      gapR: med(rest.filter(d => d.gaapEPS > 0 && d.nonGaapEPS > 0).map(d => (d.nonGaapEPS / d.gaapEPS - 1) * 100)),
    };
    const fats = items.filter(x => x.r.zone === "fat").length;
    const worst = [...tech].filter(d => d.sbcPctRev != null).sort((a, b) => b.sbcPctRev - a.sbcPctRev).slice(0, 12);
    const cleanest = [...tech].filter(d => d.sbcPctRev != null && d.mktCap > 20).sort((a, b) => a.sbcPctRev - b.sbcPctRev).slice(0, 12);
    const board = [...items].sort((a, b) => b.r.composite - a.r.composite).slice(0, 15);
    const smh = secByT("SMH"), xlk = secByT("XLK"), spy = secByT("SPY");
    const relSemis = +(retOver(smh, 3) - retOver(xlk, 3)).toFixed(1);

    const cell = (k, vT, vR, fmt, goodLow) => {
      const better = vT != null && vR != null ? (goodLow ? vT < vR : vT > vR) : null;
      return `<div style="flex:1;min-width:118px;text-align:center;border-right:1px solid var(--line)">
        <div class="sub">${k}</div>
        <div class="stat sm" style="color:${better == null ? "var(--text)" : better ? "var(--green)" : "var(--red)"}">${fmt(vT)}</div>
        <div class="sub">rest of market: ${fmt(vR)}</div></div>`;
    };

    el("main").innerHTML = toolHeader("⌬", "TECH DESK", `the whole framework pointed at ${tech.length} tech names — software · semis · internet · payments`,
      `<div style="text-align:right"><div class="sub">FAT PITCHES IN TECH</div><div class="stat sm" style="color:${fats ? "var(--green)" : "var(--red)"}">${fats}</div></div>`)
      + `<div class="card" style="margin-bottom:12px;padding:10px 6px"><div style="display:flex;flex-wrap:wrap;align-items:center">
          <div style="min-width:96px;text-align:center"><div class="sub" style="color:#7da2ff;font-weight:700;letter-spacing:1px">TECH vs<br>THE REST</div></div>
          ${cell("MEDIAN SBC / REVENUE", stat.sbcT, stat.sbcR, v => v == null ? "–" : v.toFixed(1) + "%", true)}
          ${cell("OWNER-¢ KEPT / $1", stat.keepT, stat.keepR, v => v == null ? "–" : (v * 100).toFixed(0) + "¢", false)}
          ${cell("MEDIAN EST P/E", stat.peT, stat.peR, v => v == null ? "–" : v.toFixed(1) + "x", true)}
          ${cell("NON-GAAP INFLATION", stat.gapT, stat.gapR, v => v == null ? "–" : "+" + v.toFixed(0) + "%", true)}
        </div>
        <div class="sub" style="padding:8px 12px 2px">This strip is the whole thesis in four numbers: tech pays more of your earnings to employees, keeps less per GAAP dollar, trades richer on true earnings, and inflates non-GAAP harder than the rest of the market.</div></div>`
      + `<div class="card" style="margin-bottom:12px;border-left:3px solid #7da2ff">
          <h3>DILUTION vs GROWTH — IS THE SBC BUYING ANYTHING? <span class="unit">each dot a tech name · tap to open · quadrants split at 15% growth / 10% SBC</span></h3>
          ${techScatter(items)}
          <div class="sub" style="margin-top:6px">The framework's one allowance: high SBC can be rational <i>if</i> it buys elite growth (top-right). Top-left — heavy dilution with slowing growth — is where shareholder value goes to die.</div></div>`
      + `<div class="grid g2" style="margin-bottom:12px">
        <div class="card" style="border-left:3px solid var(--red)"><h3>THE DILUTION LEAGUE — WORST SBC/REVENUE</h3>
          ${Chart.hbars(worst.map(d => ({ label: d.ticker, value: d.sbcPctRev, color: d.sbcPctRev >= 20 ? "var(--red)" : "var(--orange)", display: d.sbcPctRev.toFixed(1) + "%" })), { labelW: 52 })}</div>
        <div class="card" style="border-left:3px solid var(--green)"><h3>CLEANEST BIG TECH — LOWEST SBC/REVENUE <span class="unit">&gt;$20B cap</span></h3>
          ${Chart.hbars(cleanest.map(d => ({ label: d.ticker, value: Math.max(d.sbcPctRev, 0.1), color: "var(--green)", display: d.sbcPctRev.toFixed(1) + "%" })), { labelW: 52 })}</div>
      </div>`
      + (() => {
        const spenders = items.filter(x => x.X && x.X.lastCapex > 1).sort((a, b) => b.X.lastCapex - a.X.lastCapex).slice(0, 10);
        const holes = items.filter(x => x.X && !x.X.assetLight && x.X.score < 35).length;
        const paying = items.filter(x => x.X && !x.X.assetLight && x.X.score >= 60).length;
        return `<div class="card" style="margin-bottom:12px;border-left:3px solid var(--orange)">
          <h3>🏗 THE AI CAPEX CYCLE — WHO'S SPENDING, AND IS IT WORKING? <span class="unit">top tech capex budgets · bar = latest-FY capex · color = efficiency score</span></h3>
          ${Chart.hbars(spenders.map(x => ({
            label: x.d.ticker, value: x.X.lastCapex,
            color: x.X.score >= 60 ? "var(--green)" : x.X.score >= 35 ? "var(--amber)" : "var(--red)",
            display: "$" + x.X.lastCapex.toFixed(0) + "B · " + x.X.score,
          })), { labelW: 52 })}
          <div class="sub" style="margin-top:6px"><b class="up">${paying}</b> tech names' capex is paying for itself in revenue · <b class="down">${holes}</b> are spending into a hole. Green = revenue justifies the spend, red = buildout on faith. Tap a stock and open its 🏗 CAPEX X-RAY for the full picture.</div>
        </div>`;
      })()
      + `<div class="grid g2" style="margin-bottom:12px">
        <div class="card"><h3>SEMIS vs SOFTWARE — WHERE'S TECH'S MONEY GOING? <span class="unit">12M cumulative return</span></h3>
          ${Chart.line([{ points: perfSeries(smh), color: "#ffb000" }, { points: perfSeries(xlk), color: "#37c6ff" }, { points: perfSeries(spy), color: "#d8e0ea" }], SECTORS.labels, { h: 190, zero: true })}
          <div class="chart-legend"><span><i style="background:#ffb000"></i>SMH semis</span><span><i style="background:#37c6ff"></i>XLK software/tech</span><span><i style="background:#d8e0ea"></i>SPY</span></div>
          <div class="sub" style="margin-top:5px">Semis ${relSemis >= 0 ? "+" : ""}${relSemis}pp vs software over 3M — ${relSemis >= 2 ? "the AI-hardware trade is still leading tech." : relSemis <= -2 ? "leadership has rotated from chips back to software." : "semis and software roughly in step."}</div></div>
        <div class="card"><h3>⚛ TECH BRAIN BOARD — TOP 15 <span class="unit">by unified brain score</span></h3>
          ${board.map((x, i) => `<div class="pe-row" data-tk="${x.d.ticker}">
            <span class="pe-tk"><span class="rk-num">${i + 1}</span> ${x.d.ticker}</span>
            <span class="sub">${x.d.sector} · ${x.r.cagr == null ? "n/m" : (x.r.cagr * 100).toFixed(0) + "%/yr"} · SBC ${x.d.sbcPctRev == null ? "–" : x.d.sbcPctRev.toFixed(1) + "%"}</span>
            <span class="pe-val"><b style="color:${x.r.composite >= 62 ? "var(--green)" : x.r.composite >= 48 ? "var(--amber)" : "var(--red)"}">${x.r.composite.toFixed(0)}</b> <span style="color:${x.r.C.color};font-size:9px;font-weight:700">${x.r.C.label.split(" — ")[0]}</span></span>
          </div>`).join("")}</div>
      </div>`;
    el("main").querySelectorAll("[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
  }
  const showTech = () => showView("tech", renderTech, "techBtn");

  /* ------------------------ EST OWNER-EARNINGS P/E SCREENER view ------------------------ */
  const medianOf = (arr) => { const a = arr.filter(v => v != null).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const bucketColor = (b) => BUCKETS[b].color;

  function peRow(d, cap) {
    const fwd = forwardPEOf(d);
    const hw = clamp((d.headlinePE / cap) * 100, 1, 100);
    const xw = clamp(((d.truePE - d.headlinePE) / cap) * 100, 0, 100 - hw);
    return `<div class="pe-row" data-tk="${d.ticker}" title="${d.name} — headline ${d.headlinePE}x to owner ${d.truePE}x · forward ${fwd.pe == null ? "n/m" : fwd.pe.toFixed(1) + "x"} (${fwd.source})">
      <span class="pe-tk"><i class="sec-dot" style="background:${bucketColor(d.bucket)}"></i>${d.ticker}</span>
      <div class="pe-bar"><i style="width:${hw}%;background:var(--cyan)"></i><i style="width:${xw}%;background:var(--red)"></i></div>
      <span class="pe-val"><b style="color:var(--amber)">${d.truePE.toFixed(1)}x</b> <span class="sub">${d.headlinePE.toFixed(0)}x hdl</span><br><span class="sub"><b style="color:var(--cyan)">${fwd.pe == null ? "n/m" : fwd.pe.toFixed(1) + "x"}</b> fwd</span></span>
    </div>`;
  }

  function renderValuation() {
    const groups = {};
    const rankableUniverse = DATA.filter(d => dataConfidenceOf(d).rankable);
    DATA.forEach(d => { const etf = SECTOR_MAP[d.sector] || "XLK"; (groups[etf] = groups[etf] || []).push(d); });
    const secs = Object.entries(groups).map(([etf, ds]) => {
      const withPE = ds.filter(d => dataConfidenceOf(d).rankable && d.truePE && d.headlinePE).sort((a, b) => a.truePE - b.truePE);
      const noPE = ds.filter(d => !dataConfidenceOf(d).rankable || !d.truePE || !d.headlinePE);
      return { etf, s: secByT(etf), withPE, noPE, med: medianOf(withPE.map(d => d.truePE)) };
    }).filter(g => g.withPE.length || g.noPE.length)
      .sort((a, b) => (a.med ?? 1e9) - (b.med ?? 1e9));

    const all = rankableUniverse.filter(d => d.truePE && d.headlinePE);
    const map = allMapSVG();
    const globalCap = all.length ? Math.min(120, Math.max(...all.map(d => d.truePE))) : 30;
    const cheapest = [...all].sort((a, b) => a.truePE - b.truePE).slice(0, 10);
    const dearest = [...all].sort((a, b) => b.truePE - a.truePE).slice(0, 10);
    const fwdAll = rankableUniverse.map(d => ({ d, f: forwardPEOf(d) })).filter(x => x.f.pe != null);
    const fwdCheap = [...fwdAll].sort((a, b) => a.f.pe - b.f.pe).slice(0, 10);
    const fwdRow = (x) => `<div class="pe-row" data-tk="${x.d.ticker}" title="${x.d.name} — forward P/E ${x.f.pe.toFixed(1)}x (${x.f.source})">
      <span class="pe-tk"><i class="sec-dot" style="background:${bucketColor(x.d.bucket)}"></i>${x.d.ticker}</span>
      <span class="sub">${x.d.sector} · owner ${x.d.truePE ? x.d.truePE.toFixed(1) + "x" : "n/m"} · ${x.f.source}</span>
      <span class="pe-val"><b style="color:var(--cyan)">${x.f.pe.toFixed(1)}x</b> <span class="sub">fwd</span></span>
    </div>`;

    const secCards = secs.map(g => {
      const cap = Math.min(120, Math.max(...(g.withPE.length ? g.withPE.map(d => d.truePE) : [30])) * 1.05);
      const r3 = g.s ? retOver(g.s, 3) : null;
      return `<div class="card">
        <h3>${(g.s ? g.s.name : g.etf).toUpperCase()} · ${g.etf}
          <span class="unit">median owner P/E <b style="color:var(--amber)">${g.med ? g.med.toFixed(1) + "x" : "n/m"}</b>${r3 != null ? ` · 3M <b class="${r3 >= 0 ? "up" : "down"}">${r3 >= 0 ? "+" : ""}${r3.toFixed(1)}%</b>` : ""}</span></h3>
        ${g.withPE.map(d => peRow(d, cap)).join("")}
        ${g.noPE.length ? `<div class="sub" style="margin-top:6px">n/m (GAAP loss or no P/E): ${g.noPE.map(d => `<span class="tag" data-tk="${d.ticker}" style="cursor:pointer">${d.ticker}</span>`).join("")}</div>` : ""}
      </div>`;
    }).join("");

    el("main").innerHTML = `
      <div class="hdr">
        <div>
          <div class="tick" style="color:var(--green)">⊞ EST OWNER-EARNINGS P/E SCREENER</div>
          <div class="co">SBC-adjusted owner valuation + Forward P/E vs sector competitors</div>
        </div>
        <div class="spacer"></div>
        <div style="text-align:right">
          <div class="sub">MEDIAN OWNER P/E · RANKED ${all.length}/${DATA.length}</div>
          <div class="stat sm" style="color:var(--amber)">${medianOf(all.map(d => d.truePE)) == null ? "n/m" : medianOf(all.map(d => d.truePE)).toFixed(1) + "x"}</div>
        </div>
      </div>
      <div class="note" style="margin-bottom:12px">
        <b style="color:var(--cyan)">Cyan</b> = headline / forward P/E · <b style="color:var(--red)">red</b> = the owner-economics premium you actually pay · <b style="color:var(--amber)">amber number</b> = owner P/E. Forward P/E uses next-year consensus when collected; otherwise Street adjusted EPS proxy. Tap any row to open the stock.
      </div>
      <div class="card" style="margin-bottom:12px;border-left:3px solid var(--green)">
        <h3>THE ALL MAP — WHERE EVERY PITCH LANDS <span class="unit">IV-ladder DCF on SBC-adj owner earnings · ${map.counts.fat} fat pitches · ${map.counts.just} just outside · ${map.counts.out} out field · tap a dot</span></h3>
        ${map.svg}
        <div class="sub" style="margin-top:6px">Distance from home plate = the 15-year CAGR today's price offers, from the IV ladder (see any stock's Overview). A low multiple is not necessarily a value — quality sets each name's growth and exit multiple. GAAP-loss names are parked in the Out Field.</div>
      </div>
      <div class="grid g2" style="margin-bottom:12px">
        <div class="card" style="border-left:3px solid var(--green)">
          <h3>CHEAPEST IN THE MARKET <span class="unit">est owner-earnings P/E, whole board</span></h3>
          ${cheapest.map(d => peRow(d, globalCap)).join("")}
        </div>
        <div class="card" style="border-left:3px solid var(--cyan)">
          <h3>CHEAPEST FORWARD P/E <span class="unit">Street EPS / forward estimate view</span></h3>
          ${fwdCheap.map(fwdRow).join("")}
        </div>
        <div class="card" style="border-left:3px solid var(--red)">
          <h3>MOST EXPENSIVE <span class="unit">est owner-earnings P/E, whole board</span></h3>
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
    pushNav();
  }
  function showQualityMap() {
    showView("qualityMap", renderQualityMap, "mapBtn");
  }

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

  function renderHome() {
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
    const movers = [...DATA].sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0)).slice(0, 6);
    const sectors = SECTORS.series.filter(s => s.t !== "SPY").map(s => ({ s, r3: retOver(s, 3), fd: flowDelta(s) }))
      .sort((a, b) => b.r3 - a.r3).slice(0, 5);
    const medianPE = medianOf(ranked.map(x => x.r.truePE).filter(Boolean));
    const fat = ranked.filter(x => x.r.zone === "fat").length;
    const row = (x, right, sub = "") => `<div class="home-row" data-tk="${x.d.ticker}">
      <div><b>${x.d.ticker}</b><span>${x.d.sector}</span></div>
      <div class="sub">${sub || x.m?.finalLabel?.label || ""}</div>
      <strong>${right}</strong>
    </div>`;
    const buyRow = (x) => {
      const great = x.L.IV15, starter = x.L.IV12, px = x.L.price;
      const gap = great / px - 1;
      return `<div class="home-row buy-row" data-tk="${x.d.ticker}">
        <div><b>${x.d.ticker}</b><span>BQ ${x.m.businessQuality.score} · ${x.d.sector}</span></div>
        <div class="sub">now $${px.toFixed(px >= 100 ? 0 : 2)} · starter $${starter.toFixed(starter >= 100 ? 0 : 2)}</div>
        <strong class="${gap >= 0 ? "up" : "down"}">$${great.toFixed(great >= 100 ? 0 : 2)}</strong>
      </div>`;
    };
    const moverRow = (d) => `<div class="home-row" data-tk="${d.ticker}">
      <div><b>${d.ticker}</b><span>${d.sector}</span></div>
      <div class="sub">${d.name}</div>
      <strong class="${signCls(d.change || 0)}">${arrow(d.change || 0)}${Math.abs(d.change || 0).toFixed(2)}%</strong>
    </div>`;
    el("main").innerHTML = `
      <div class="hdr home-hero">
        <div>
          <div class="tick gradient-title">HOME DASHBOARD</div>
          <div class="co">market reward + business quality command center · ${DATA.length} official names · ${ranked.length} ranked</div>
        </div>
        <div class="spacer"></div>
        <div style="text-align:right">
          <div class="sub">BEST SETUP</div>
          <div class="stat sm" style="color:var(--green)">${leaders[0]?.d.ticker || "--"}</div>
        </div>
      </div>
      <div class="grid g4 home-metrics" style="margin-bottom:12px">
        <div class="card"><h3>RANKED UNIVERSE</h3><div class="stat" style="color:var(--green)">${ranked.length}/${DATA.length}</div><div class="sub">all official names scored</div></div>
        <div class="card"><h3>FAT PITCHES</h3><div class="stat" style="color:var(--green)">${fat}</div><div class="sub">IV ladder in the zone</div></div>
        <div class="card"><h3>MEDIAN OWNER P/E</h3><div class="stat" style="color:var(--amber)">${medianPE ? medianPE.toFixed(1) + "x" : "--"}</div><div class="sub">ranked positive owner EPS</div></div>
        <div class="card"><h3>TOP COMBO</h3><div class="stat" style="color:var(--cyan)">${leaders[0] ? combo(leaders[0]) : "--"}</div><div class="sub">business quality + market reward</div></div>
      </div>
      <div class="grid g2" style="margin-bottom:12px">
        ${dailyReviewPreviewCard()}
        ${directionEdgePreviewCard()}
      </div>
      <div class="grid g2">
        <div class="card" style="border-left:3px solid var(--green)"><h3>GREAT BUSINESSES — BUY PRICES <span class="unit">great buy = IV15 · starter = IV12</span></h3>
          <div class="note" style="margin-bottom:8px">These are model watch prices, not automatic orders. <b style="color:var(--green)">Great buy</b> means the IV ladder estimates a 15% required-return entry; <b style="color:var(--amber)">starter</b> is the 12% zone for scaling/watching.</div>
          ${buyList.map(buyRow).join("")}
        </div>
        <div class="card"><h3>BEST BUSINESS + MARKET REWARD</h3>${leaders.map(x => row(x, combo(x) + "/100", `BQ ${x.m.businessQuality.score} · MR ${x.m.marketReward.score}`)).join("")}</div>
        <div class="card"><h3>CHEAPEST OWNER P/E</h3>${cheap.map(x => row(x, x.r.truePE.toFixed(1) + "x", x.m.finalLabel.label)).join("")}</div>
        <div class="card"><h3>OVERHEATED WATCH</h3>${hot.map(x => row(x, x.r.truePE.toFixed(1) + "x", `Valuation ${x.m.valuation.score}/100`)).join("")}</div>
        <div class="card"><h3>BIGGEST MOVES</h3>${movers.map(moverRow).join("")}</div>
        <div class="card"><h3>SECTOR PULSE</h3>${sectors.map(x => `<div class="home-row" data-sector="${x.s.t}"><div><b>${x.s.t}</b><span>${x.s.name}</span></div><div class="sub">flow ${x.fd >= 0 ? "+" : ""}${x.fd.toFixed(1)}pp</div><strong class="${signCls(x.r3)}">${x.r3 >= 0 ? "+" : ""}${x.r3.toFixed(1)}%</strong></div>`).join("")}</div>
        <div class="card"><h3>OPEN NEXT</h3>
          <div class="note">Start with the combo leaders, then compare them against Cheapest Owner P/E and Overheated Watch. Use Sector Pulse to decide whether the market is confirming the thesis or fighting it.</div>
        </div>
      </div>`;
    el("main").querySelectorAll("[data-tk]").forEach(r => r.onclick = () => selectTicker(r.dataset.tk));
    el("main").querySelectorAll("[data-sector]").forEach(r => r.onclick = showSectors);
    const openDaily = el("openDailyReview");
    if (openDaily) openDaily.onclick = showDailyReview;
    const openEdge = el("openDirectionEdge");
    if (openEdge) openEdge.onclick = showDirectionEdge;
  }
  function showHome() {
    state.view = "home";
    setViewBtn("homeBtn");
    renderWatchlist();
    renderHome();
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
  const oddsPill = (p, label) => {
    const col = p >= 70 ? "var(--green)" : p >= 50 ? "var(--amber)" : "var(--red)";
    return `<div style="display:flex;align-items:center;gap:8px;margin-top:8px">
      <div class="meter" style="flex:1;margin-top:0"><i style="width:${p}%;background:${col}"></i></div>
      <span style="font-size:11px;font-weight:800;color:${col};white-space:nowrap">${p.toFixed(0)}/100</span>
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
      `${leader.t} +${retOver(leader, 3).toFixed(1)}% over 3M vs S&P ${spy3 >= 0 ? "+" : ""}${spy3.toFixed(1)}% · activity share ${flowDelta(leader) >= 0 ? "confirms — trading dollars concentrating here" : "diverges — price up but activity share falling (fragile)"}`,
      Chart.line([
        { points: perfSeries(leader), color: leader.color },
        { points: perfSeries(second), color: second.color },
        { points: perfSeries(spy), color: spy.color },
      ], SECTORS.labels, { h: 160, zero: true }) +
      `<div class="chart-legend"><span><i style="background:${leader.color}"></i>${leader.t}</span><span><i style="background:${second.color}"></i>${second.t}</span><span><i style="background:${spy.color}"></i>SPY</span></div>`,
      50 + leadEdge * 2.5 + flowDelta(leader) * 8, "leadership momentum score (heuristic, not a probability)", leader.color);

    // 2) money rotation
    const n2 = narrCard(
      `TRADING ACTIVITY SHIFTING TOWARD ${rotIn.name.toUpperCase()}, AWAY FROM ${rotOut.name.toUpperCase()}`,
      `${rotIn.t} taking ${flowDelta(rotIn) >= 0 ? "+" : ""}${flowDelta(rotIn).toFixed(1)}pp more of all sector dollars vs its 6M average · ${rotOut.t} ${flowDelta(rotOut).toFixed(1)}pp`,
      Chart.line([
        { points: flowShareOf(rotIn), color: rotIn.color },
        { points: flowShareOf(rotOut), color: rotOut.color },
      ], SECTORS.labels, { h: 150 }) +
      `<div class="chart-legend"><span><i style="background:${rotIn.color}"></i>${rotIn.t} $-share</span><span><i style="background:${rotOut.color}"></i>${rotOut.t} $-share</span></div>`,
      50 + flowDelta(rotIn) * 10, "activity-shift momentum score (heuristic, not a probability)", rotIn.color);

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
      50 - lagGap * 2.5, "weakness momentum score (heuristic, not a probability)", "var(--red)");

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
        fetchJsonWithRetry(base + "economy", { provider: "Polymarket economy", ticker: "NARRATIVE", cacheMs: 10 * 60 * 1000 }).catch(() => []),
        fetchJsonWithRetry(base + "crypto", { provider: "Polymarket crypto", ticker: "NARRATIVE", cacheMs: 10 * 60 * 1000 }).catch(() => []),
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
    pushNav();
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
      else if (state.view === "home") renderHome();
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

  async function fetchFmpQuoteBatch(tickers) {
    if (!state.keys.fmp || !tickers.length) return 0;
    const symbols = tickers.join(",");
    const rows = await fetchJsonWithRetry(`https://financialmodelingprep.com/api/v3/quote/${symbols}?apikey=${state.keys.fmp}`, {
      provider: "FMP quote batch", ticker: "UNIVERSE", cacheMs: 15 * 1000
    });
    if (!Array.isArray(rows)) return 0;
    let ok = 0;
    rows.forEach(q => {
      const tk = q.symbol || q.ticker;
      const ch = q.changesPercentage ?? q.changePercentage ?? q.changePercent;
      if (applyLiveQuote(tk, q.price, ch, "FMP batch")) ok++;
    });
    return ok;
  }

  async function fetchYahooQuote(tk) {
    const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tk)}?range=1d&interval=1m&includePrePost=true`;
    const url = `https://r.jina.ai/http://${target}`;
    const txt = await fetchTextWithRetry(url, { provider: "Jina/Yahoo chart quote", ticker: tk, cacheMs: 10 * 1000, timeoutMs: 6500, retries: 1 });
    const start = txt.indexOf("{\"chart\"");
    const end = txt.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Yahoo chart JSON not found");
    const j = JSON.parse(txt.slice(start, end + 1));
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

  function refreshAllLive() {
    if (!state.keys.finnhub && !state.keys.fmp) return;
    // Full official Core universe, quotes only, sequential with progress;
    // one failure never stops the rest.
    const all = DATA.slice();
    let done = 0, fails = 0;
    flash(`Prices updated: 0 / ${all.length}…`, "ok");
    all.forEach((d, i) => setTimeout(async () => {
      try { await fetchLive(d.ticker, false); } catch (e) { fails++; }
      done++;
      if (done % 5 === 0 || done === all.length)
        flash(`Prices updated: ${done - fails} / ${all.length}${fails ? ` · ${fails} failed` : ""}${done === all.length ? " · done" : "…"}`, "ok");
    }, i * 1100));
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
      .slice(0, 30)
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
    const all = state.keys.finnhub || state.keys.fmp ? allCompanies().map(d => d.ticker) : noKeyQuoteTickers();
    let ok = 0, fails = 0, source = state.keys.fmp ? "FMP batch" : state.keys.finnhub ? "Finnhub rotation" : "Yahoo";
    if (!silent) flash("Live prices updating...", "ok");
    try {
      if (state.keys.fmp) {
        ok = await fetchFmpQuoteBatch(all);
      } else if (state.keys.finnhub) {
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
      if (!silent) flash(`Live prices updated: ${ok}/${state.keys.finnhub || state.keys.fmp ? allCompanies().length : all.length}${fails ? ` - ${fails} failed` : ""}`, ok ? "ok" : "err");
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
    if (["GRAHAM", "VALUE", "NETNET", "NET-NET", "MOS", "SAFETY", "DEFENSIVE"].includes(q)) {
      showGraham(); flash("Graham value screener", "ok"); return;
    }
    if (["SCREEN", "SCREENER", "FILTER"].includes(q)) { showScreener(); return; }
    if (["COMPARE", "VS", "COMPARISON"].includes(q)) { showCompare(); return; }
    if (["MAP", "QUALITY", "QUALITY MAP", "MARKET MAP", "BUSINESS QUALITY"].includes(q)) { showQualityMap(); flash("Quality x Market map", "ok"); return; }
    if (["TRIGGERS", "TRIGGER", "ALERTS", "BUY"].includes(q)) { showTriggers(); return; }
    if (["PORTFOLIO", "POSITIONS", "HOLDINGS", "MYPORT"].includes(q)) { showPortfolio(); return; }
    if (["CALENDAR", "EARNINGS", "CAL"].includes(q)) { showCalendar(); return; }
    if (["TECH", "SW50", "SOFTWARE", "SEMIS", "TECHDESK"].includes(q)) { showTech(); return; }
    if (["OPTIONS", "OPTS", "PUTS", "CALLS", "VOL", "IV"].includes(q)) { showOptions(); return; }
    if (["INFLATION", "CPI", "PPI", "MACRO", "RATES", "FED"].includes(q)) { showInflation(); flash("Inflation desk", "ok"); return; }
    if (["AUDIT", "TRUST", "PROVENANCE", "SOURCES"].includes(q)) { showAudit(); return; }
    if (["PE", "P/E", "TRUEPE", "TRUE PE", "VALUATION", "SCREENER", "CHEAP"].includes(q)) {
      showValuation(); flash("Est owner-earnings P/E screener", "ok"); return;
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
    el("dailyBtn").onclick = showDailyReview;
    el("edgeBtn").onclick = showDirectionEdge;
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
    el("grahamBtn").onclick = showGraham;
    el("screenBtn").onclick = showScreener;
    el("compareBtn").onclick = showCompare;
    el("trigBtn").onclick = showTriggers;
    el("mapBtn").onclick = showQualityMap;
    el("portBtn").onclick = showPortfolio;
    el("calBtn").onclick = showCalendar;
    el("techBtn").onclick = showTech;
    el("optBtn").onclick = showOptions;
    el("macroBtn").onclick = showInflation;
    el("auditBtn").onclick = showAudit;
    el("drawerClose").onclick = closeDrawer;
    el("navSearch").onclick = () => {
      closeDrawer();
      window.scrollTo({ top: 0 });
      el("cmdInput").focus();
      flash("Ticker search ready", "ok");
    };
    el("backdrop").onclick = closeDrawer;
    window.addEventListener("resize", syncMobileChrome);

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
      navigator.serviceWorker.register("sw.js?v=44").then((reg) => reg.update()).catch(() => {});
    }
  }
  // regression-test / console handle: production engines, read-only
  window.__engines = { ivLadder, grahamOf, verdictOf, rankOf, qualityOf, capexOf,
    buybackQuality, optionPlayOf, bsPrice, normCdf, shareTrend, medianOf, trueOwnerEarnings,
    tabFinancials, renderAudit, secCheckOf, dataQualityOf, dataConfidenceOf, analyzeNews,
    lastVal, fetchQuoteOnly, fetchNews, fetchAnalystData, fetchInsiderData, fetchFundamentalsFallback,
    fetchJsonWithRetry, ScoreEngine: window.ScoreEngine, marketScoreOf, refreshMarketScores, forwardPEOf,
    inflationOf, directionEdgeOf, INFLATION, EARNINGS_FOCUS, bundledEarningsRows, mergeEarningsRows,
    applyLiveQuote, fetchFmpQuoteBatch, fetchYahooQuote, fetchYahooQuoteBatch, refreshAllLive, startLiveTape, isMarketHours,
    allCompanies, companyOf,
    SBC_MODEL_VERSION, FORMULA_VERSION };
  document.addEventListener("DOMContentLoaded", init);
})();
