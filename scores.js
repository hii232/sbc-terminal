/* =========================================================================
   SBC TERMINAL - market reward + business quality score engine
   Keeps SBC analysis separate from the overall company opinion.
   ========================================================================= */
(function () {
  const MARKET_TERMINAL_VERSION = "4.1.0";
  const SCORE_WEIGHTS = {
    businessQuality: {
      returnOnCapital: 20, fcfStrength: 20, competitiveStrength: 15,
      revenueDurability: 15, marginQuality: 15, balanceSheet: 15,
    },
    growthExecution: {
      revenueGrowth: 20, revenueAcceleration: 15, earningsGrowth: 15,
      marginExpansion: 15, fcfPerShare: 15, managementExecution: 20,
    },
    marketReward: {
      epsRevisions: 20, revenueRevisions: 15, growthAcceleration: 15,
      surpriseHistory: 10, guidanceDirection: 10, relativeStrength: 15,
      postEarningsReaction: 10, sectorStrength: 5,
    },
    shareholderEconomics: {
      sbcBurden: 20, fcfDilutionBurden: 20, oneYearDilution: 15,
      fiveYearDilution: 15, buybackEffectiveness: 15, ownerEpsGrowth: 15,
    },
    longTermView: {
      businessQuality: 30, growthExecution: 25, valuation: 20,
      shareholderEconomics: 15, marketReward: 10,
    },
    marketRewardView: {
      marketReward: 45, growthExecution: 25, businessQuality: 15,
      valuation: 10, shareholderEconomics: 5,
    },
  };

  const SECTOR_BASELINES = {
    XLK: { gross: 62, op: 24, netDebtFcf: 3.0, fcfMargin: 18 },
    SMH: { gross: 55, op: 25, netDebtFcf: 2.5, fcfMargin: 16 },
    XLC: { gross: 55, op: 22, netDebtFcf: 3.0, fcfMargin: 14 },
    XLY: { gross: 38, op: 12, netDebtFcf: 3.5, fcfMargin: 8 },
    XLP: { gross: 34, op: 12, netDebtFcf: 4.0, fcfMargin: 7 },
    XLF: { gross: 0, op: 0, netDebtFcf: null, fcfMargin: null },
    XLV: { gross: 62, op: 20, netDebtFcf: 3.0, fcfMargin: 12 },
    XLE: { gross: 42, op: 18, netDebtFcf: 2.5, fcfMargin: 10 },
    XLI: { gross: 34, op: 13, netDebtFcf: 3.0, fcfMargin: 8 },
    XLB: { gross: 28, op: 12, netDebtFcf: 3.0, fcfMargin: 7 },
    XLRE: { gross: 0, op: 0, netDebtFcf: null, fcfMargin: null },
    XLU: { gross: 32, op: 18, netDebtFcf: 5.5, fcfMargin: 4 },
    SPY: { gross: 45, op: 17, netDebtFcf: 3.5, fcfMargin: 10 },
  };

  const SECTOR_MAP = {
    "Consumer Tech": "XLK", "Software": "XLK", "Software/AI": "XLK", "HR Tech": "XLK",
    "Networking": "XLK", "Cybersecurity": "XLK", "AdTech": "XLK", "IT Services": "XLK",
    "AI Infrastructure": "XLK", "Neocloud": "XLK", "EDA Software": "SMH",
    "Semis": "SMH", "Semis/AI": "SMH", "Semi Equip": "SMH", "Semis/IP": "SMH",
    "E-commerce": "XLY", "E-commerce/Cloud": "XLY", "Auto/AI": "XLY", "Retail": "XLP",
    "Travel": "XLY", "Ride-Hailing": "XLY", "Gaming": "XLC", "Streaming": "XLC",
    "Social Media": "XLC", "Media": "XLC", "Telecom": "XLC", "Payments": "XLF",
    "Banks": "XLF", "Asset Mgmt": "XLF", "Financial Data": "XLF", "Crypto Exchange": "XLF",
    "Fintech Brokerage": "XLF", "Pharma": "XLV", "Managed Care": "XLV",
    "Life Sciences": "XLV", "Medical Devices": "XLV", "Biotech": "XLV", "Energy": "XLE",
    "Industrials": "XLI", "Public Safety Tech": "XLI", "Machinery": "XLI",
    "Aerospace": "XLI", "Rails": "XLI", "Defense": "XLI", "Staples": "XLP",
    "Beverages": "XLP", "Mega Retail": "XLP", "Industrial Gas": "XLB", "Materials": "XLB",
    "REIT": "XLRE", "Utilities": "XLU", "Technology": "XLK", "Financials": "XLF",
    "Health Care": "XLV", "Consumer Disc": "XLY", "Comm Services": "XLC",
  };

  const n = (v) => v != null && Number.isFinite(+v) ? +v : null;
  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  const round = (v, d = 0) => v == null || !Number.isFinite(v) ? null : +v.toFixed(d);
  const last = (arr) => {
    const a = Array.isArray(arr) ? arr : [];
    for (let i = a.length - 1; i >= 0; i--) if (n(a[i]) != null) return +a[i];
    return null;
  };
  const first = (arr) => {
    const a = Array.isArray(arr) ? arr : [];
    for (let i = 0; i < a.length; i++) if (n(a[i]) != null) return +a[i];
    return null;
  };
  const clean = (arr) => (arr || []).filter(v => n(v) != null).map(Number);
  const pct = (a, b) => a != null && b != null && b !== 0 ? ((a / b) - 1) * 100 : null;
  const div = (a, b) => a != null && b != null && b !== 0 ? a / b : null;
  const cagr = (arr) => {
    const a = clean(arr);
    if (a.length < 2 || a[0] <= 0 || a[a.length - 1] <= 0) return null;
    return (Math.pow(a[a.length - 1] / a[0], 1 / (a.length - 1)) - 1) * 100;
  };
  const slope = (arr) => {
    const a = clean(arr);
    if (a.length < 2) return null;
    return a[a.length - 1] - a[0];
  };
  const stdev = (arr) => {
    const a = clean(arr);
    if (a.length < 2) return null;
    const m = a.reduce((x, y) => x + y, 0) / a.length;
    return Math.sqrt(a.reduce((x, y) => x + Math.pow(y - m, 2), 0) / a.length);
  };
  const scoreRange = (v, lo, hi) => v == null ? null : clamp(((v - lo) / (hi - lo)) * 100);
  const scoreLower = (v, good, bad) => v == null ? null : clamp(((bad - v) / (bad - good)) * 100);
  const weighted = (parts) => {
    let got = 0, wt = 0, details = [];
    parts.forEach(p => {
      if (p.score == null || !Number.isFinite(p.score)) {
        details.push({ ...p, score: null, status: "missing" });
        return;
      }
      got += p.score * p.weight;
      wt += p.weight;
      details.push({ ...p, score: round(p.score, 0), status: "used" });
    });
    return { score: wt ? Math.round(got / wt) : null, coverage: Math.round((wt / parts.reduce((a, p) => a + p.weight, 0)) * 100), details };
  };
  const sectorETF = (d) => SECTOR_MAP[d.sector] || "SPY";
  const secByT = (ctx, t) => (ctx.sectors && ctx.sectors.series || []).find(s => s.t === t);
  const retOver = (series, months) => {
    if (!series || !series.closes || series.closes.length < 2) return null;
    const c = series.closes, n0 = Math.max(0, c.length - 1 - months), n1 = c.length - 1;
    return pct(c[n1], c[n0]);
  };
  const priceReturn = (d, weeks) => {
    const p = d.px && d.px.v;
    if (!p || p.length < 2) return null;
    const i = Math.max(0, p.length - 1 - weeks);
    return pct(p[p.length - 1], p[i]);
  };
  const margins = (d) => {
    const rev = d.revenue || [], gross = d.qm && d.qm.gross || [], op = d.qm && d.qm.opinc || [], fcf = d.qm && d.qm.fcf || [];
    return {
      gross: rev.map((r, i) => r ? div(gross[i], r) * 100 : null),
      op: rev.map((r, i) => r ? div(op[i], r) * 100 : null),
      fcf: rev.map((r, i) => r ? div(fcf[i], r) * 100 : null),
      net: rev.map((r, i) => r ? div((d.ni || [])[i], r) * 100 : null),
    };
  };
  const latestQGrowth = (d) => {
    const q = d.qd && d.qd.revenue;
    if (!q || q.length < 5 || !q[q.length - 5]) return null;
    return pct(q[q.length - 1], q[q.length - 5]);
  };
  const seqGrowths = (arr) => {
    const a = Array.isArray(arr) ? arr : [];
    const out = [];
    for (let i = 1; i < a.length; i++) out.push(pct(a[i], a[i - 1]));
    return out;
  };
  const annualGrowths = (arr) => {
    const a = Array.isArray(arr) ? arr : [];
    const out = [];
    for (let i = 1; i < a.length; i++) out.push(pct(a[i], a[i - 1]));
    return out;
  };
  const fcfPerShareSeries = (d) => (d.qm && d.qm.fcf || []).map((v, i) => {
    const sh = (d.shares || [])[i];
    return v != null && sh ? v / sh : null;
  });
  const ownerEpsSeries = (d) => (d.ni || []).map((ni, i) => {
    const sbc = d.sbc && d.sbc[i], sh = d.shares && d.shares[i];
    return ni != null && sbc != null && sh ? (ni - 0.25 * sbc) / sh : null;
  });
  const recurringProxy = (d) => /Software|Cloud|Cyber|Payments|Data|Subscription|Streaming|ServiceNow|Adobe|Intuit|Workday|Mongo|Datadog|Cloudflare/i.test(`${d.sector} ${d.name}`);

  function estimateRevision(history, field, days) {
    const snaps = history && Array.isArray(history.snapshots) ? history.snapshots.filter(s => s && s.date && n(s[field]) != null) : [];
    if (snaps.length < 2) return null;
    const latest = snaps[snaps.length - 1];
    const latestTime = Date.parse(latest.date);
    let prior = null;
    for (let i = snaps.length - 2; i >= 0; i--) {
      if ((latestTime - Date.parse(snaps[i].date)) / 864e5 >= days) { prior = snaps[i]; break; }
    }
    if (!prior) prior = snaps[0];
    const chg = pct(+latest[field], +prior[field]);
    return { latest: +latest[field], prior: +prior[field], pct: chg, days: Math.round((latestTime - Date.parse(prior.date)) / 864e5) };
  }

  function revisionScore(history, field) {
    const r7 = estimateRevision(history, field, 7);
    const r30 = estimateRevision(history, field, 30);
    const r90 = estimateRevision(history, field, 90);
    const vals = [r7, r30, r90].filter(Boolean).map(r => r.pct).filter(v => v != null);
    if (!vals.length) return { score: null, note: "revision history unavailable", revisions: { r7, r30, r90 } };
    const avg = vals.reduce((a, v) => a + v, 0) / vals.length;
    return { score: scoreRange(avg, -8, 8), note: `${round(avg, 1)}% average revision`, revisions: { r7, r30, r90 } };
  }

  function businessQuality(d, ctx) {
    const g = d.gd || {}, m = margins(d), rev = last(d.revenue), ni = last(d.ni);
    const fcf = last(d.qm && d.qm.fcf), ocf = last(d.qm && d.qm.ocf), op = last(d.qm && d.qm.opinc);
    const base = SECTOR_BASELINES[sectorETF(d)] || SECTOR_BASELINES.SPY;
    const invested = n(g.debt) != null && n(g.eq) != null ? (g.debt || 0) + (g.eq || 0) - (g.cash || 0) : null;
    const roic = invested && invested > 0 && op != null ? (op * 0.79 / invested) * 100 : null;
    const roe = g.eq > 0 && ni != null ? (ni / g.eq) * 100 : null;
    const returnScore = sectorETF(d) === "XLF" || sectorETF(d) === "XLRE" ? scoreRange(roe, 5, 18) : scoreRange(roic, 5, 30);
    const fcfMargin = rev && fcf != null ? (fcf / rev) * 100 : null;
    const fcfps = fcfPerShareSeries(d);
    const fcfScore = weighted([
      { k: "FCF margin", weight: 8, score: scoreRange(fcfMargin, -5, Math.max(18, (base.fcfMargin || 10) * 1.8)), why: `FCF margin ${round(fcfMargin, 1)}%` },
      { k: "FCF/share growth", weight: 7, score: scoreRange(cagr(fcfps), -10, 25), why: `FCF/share CAGR ${round(cagr(fcfps), 1)}%` },
      { k: "Cash conversion", weight: 5, score: scoreRange(div(ocf, Math.abs(ni)), 0.5, 1.5), why: `OCF / net income ${round(div(ocf, Math.abs(ni)), 2)}x` },
    ]).score;
    const gross = last(m.gross), opm = last(m.op);
    const compScore = weighted([
      { k: "Gross margin level", weight: 6, score: scoreRange(gross, (base.gross || 40) - 15, (base.gross || 40) + 25), why: `gross margin ${round(gross, 1)}% vs sector baseline ${base.gross || "n/a"}%` },
      { k: "Margin stability", weight: 5, score: scoreLower(stdev(m.op), 3, 18), why: `op-margin stdev ${round(stdev(m.op), 1)}pp` },
      { k: "Recurring proxy", weight: 4, score: recurringProxy(d) ? 75 : 50, why: recurringProxy(d) ? "qualitative recurring/repeat revenue proxy" : "no recurring revenue proxy used" },
    ]).score;
    const revGrowths = annualGrowths(d.revenue);
    const durScore = weighted([
      { k: "Revenue CAGR", weight: 7, score: scoreRange(cagr(d.revenue), -5, 25), why: `annual revenue CAGR ${round(cagr(d.revenue), 1)}%` },
      { k: "Growth consistency", weight: 5, score: scoreRange(revGrowths.filter(v => v > 0).length, 0, Math.max(1, revGrowths.length)), why: `${revGrowths.filter(v => v > 0).length}/${revGrowths.length} positive-growth years` },
      { k: "Decline risk", weight: 3, score: scoreLower(Math.min(...revGrowths.filter(v => v != null)), -5, -35), why: `worst annual growth ${round(Math.min(...revGrowths.filter(v => v != null)), 1)}%` },
    ]).score;
    const marginScore = weighted([
      { k: "Gross-margin trend", weight: 5, score: scoreRange(slope(m.gross), -8, 8), why: `gross-margin change ${round(slope(m.gross), 1)}pp` },
      { k: "Operating-margin trend", weight: 5, score: scoreRange(slope(m.op), -8, 8), why: `operating-margin change ${round(slope(m.op), 1)}pp` },
      { k: "FCF-margin trend", weight: 5, score: scoreRange(slope(m.fcf), -8, 8), why: `FCF-margin change ${round(slope(m.fcf), 1)}pp` },
    ]).score;
    const netDebt = n(g.debt) != null || n(g.cash) != null ? (g.debt || 0) - (g.cash || 0) : null;
    const balanceScore = sectorETF(d) === "XLF"
      ? weighted([
        { k: "Equity returns", weight: 8, score: scoreRange(roe, 6, 18), why: `ROE ${round(roe, 1)}%` },
        { k: "Liquidity", weight: 7, score: g.ca && g.cl ? scoreRange(g.ca / g.cl, 0.8, 2.0) : null, why: `current ratio ${round(div(g.ca, g.cl), 2)}x` },
      ]).score
      : weighted([
        { k: "Net debt / FCF", weight: 8, score: netDebt != null && fcf != null ? scoreLower(netDebt / Math.max(Math.abs(fcf), 0.01), -2, base.netDebtFcf || 4) : null, why: `net debt / FCF ${round(div(netDebt, Math.max(Math.abs(fcf || 0), 0.01)), 1)}x` },
        { k: "Liquidity", weight: 4, score: g.ca && g.cl ? scoreRange(g.ca / g.cl, 0.8, 2.5) : null, why: `current ratio ${round(div(g.ca, g.cl), 2)}x` },
        { k: "Self funding", weight: 3, score: fcf != null ? scoreRange(fcf, -2, 5) : null, why: `FCF ${round(fcf, 2)}B` },
      ]).score;
    return weighted([
      { k: "Return on capital", weight: 20, score: returnScore, why: sectorETF(d) === "XLF" || sectorETF(d) === "XLRE" ? `ROE ${round(roe, 1)}%` : `ROIC ${round(roic, 1)}%` },
      { k: "Free-cash-flow strength", weight: 20, score: fcfScore, why: `FCF margin ${round(fcfMargin, 1)}%, FCF/share CAGR ${round(cagr(fcfps), 1)}%` },
      { k: "Competitive strength", weight: 15, score: compScore, why: `gross margin ${round(gross, 1)}%, stability and recurring proxy` },
      { k: "Revenue durability", weight: 15, score: durScore, why: `revenue CAGR ${round(cagr(d.revenue), 1)}%, consistency ${revGrowths.filter(v => v > 0).length}/${revGrowths.length}` },
      { k: "Margin quality", weight: 15, score: marginScore, why: `gross/op/FCF margin trend` },
      { k: "Balance sheet", weight: 15, score: balanceScore, why: sectorETF(d) === "XLF" ? "sector-adjusted financial balance sheet" : `net debt ${round(netDebt, 2)}B` },
    ]);
  }

  function growthExecution(d) {
    const m = margins(d), q = d.qd || {}, seq = seqGrowths(q.revenue);
    const latestSeq = last(seq), prevSeq = seq.length >= 2 ? seq[seq.length - 2] : null;
    const revAccel = latestSeq != null && prevSeq != null ? latestSeq - prevSeq : null;
    const ownerGrowth = cagr(ownerEpsSeries(d));
    const fcfpsGrowth = cagr(fcfPerShareSeries(d));
    const marginExp = weighted([
      { k: "Gross margin", weight: 5, score: scoreRange(slope(m.gross), -6, 8), why: `gross margin change ${round(slope(m.gross), 1)}pp` },
      { k: "Operating margin", weight: 5, score: scoreRange(slope(m.op), -6, 8), why: `operating margin change ${round(slope(m.op), 1)}pp` },
      { k: "FCF margin", weight: 5, score: scoreRange(slope(m.fcf), -6, 8), why: `FCF margin change ${round(slope(m.fcf), 1)}pp` },
    ]).score;
    const mgmt = weighted([
      { k: "Positive revenue years", weight: 6, score: scoreRange(annualGrowths(d.revenue).filter(v => v > 0).length, 0, Math.max(1, annualGrowths(d.revenue).length)), why: "execution consistency proxy" },
      { k: "FCF positive", weight: 5, score: last(d.qm && d.qm.fcf) != null ? (last(d.qm && d.qm.fcf) > 0 ? 75 : 25) : null, why: `latest FCF ${round(last(d.qm && d.qm.fcf), 2)}B` },
      { k: "Capex results", weight: 4, score: scoreRange(cagr(d.revenue), -5, 25), why: "capex results proxy from revenue growth" },
      { k: "Guidance/beat history", weight: 5, score: null, why: "guidance/beat history unavailable until estimate snapshots accumulate" },
    ]).score;
    return weighted([
      { k: "Revenue growth", weight: 20, score: weighted([
        { k: "latest q", weight: 8, score: scoreRange(latestQGrowth(d), -10, 35), why: "" },
        { k: "three-year", weight: 12, score: scoreRange(cagr(d.revenue), -5, 25), why: "" },
      ]).score, why: `latest quarter YoY ${round(latestQGrowth(d), 1)}%, annual CAGR ${round(cagr(d.revenue), 1)}%` },
      { k: "Revenue acceleration", weight: 15, score: scoreRange(revAccel, -8, 8), why: `sequential growth changed ${round(revAccel, 1)}pp` },
      { k: "Earnings growth", weight: 15, score: scoreRange(ownerGrowth, -10, 30), why: `owner EPS CAGR ${round(ownerGrowth, 1)}%` },
      { k: "Margin expansion", weight: 15, score: marginExp, why: "gross/op/FCF margin expansion" },
      { k: "FCF/share growth", weight: 15, score: scoreRange(fcfpsGrowth, -10, 30), why: `FCF/share CAGR ${round(fcfpsGrowth, 1)}%` },
      { k: "Management execution", weight: 20, score: mgmt, why: "growth consistency, FCF and capex-results proxy; guidance history labelled unavailable" },
    ]);
  }

  function relativeStrength(d, ctx) {
    const spy = secByT(ctx, "SPY"), sec = secByT(ctx, sectorETF(d));
    const r1 = priceReturn(d, 4), r3 = priceReturn(d, 13), r6 = priceReturn(d, 26), r12 = priceReturn(d, 52);
    const spy3 = retOver(spy, 3), sec3 = retOver(sec, 3), sec12 = retOver(sec, 12);
    return {
      oneMonth: r1, threeMonth: r3, sixMonth: r6, twelveMonth: r12,
      vsSpy3: r3 != null && spy3 != null ? r3 - spy3 : null,
      vsSector3: r3 != null && sec3 != null ? r3 - sec3 : null,
      sectorVsSpy12: sec12 != null && retOver(spy, 12) != null ? sec12 - retOver(spy, 12) : null,
    };
  }

  function marketReward(d, ctx) {
    const hist = ctx.estimates && ctx.estimates[d.ticker];
    const epsRev = revisionScore(hist, "nextYearEps");
    const revRev = revisionScore(hist, "nextYearRevenue");
    const ge = growthExecution(d);
    const rs = relativeStrength(d, ctx);
    const sector = secByT(ctx, sectorETF(d)), spy = secByT(ctx, "SPY");
    const sectorStrength = sector && spy ? scoreRange(retOver(sector, 3) - retOver(spy, 3), -8, 8) : null;
    const rsScore = weighted([
      { k: "1M", weight: 3, score: scoreRange(rs.oneMonth, -10, 15), why: "" },
      { k: "3M vs sector", weight: 5, score: scoreRange(rs.vsSector3, -12, 12), why: "" },
      { k: "3M vs SPY", weight: 4, score: scoreRange(rs.vsSpy3, -12, 12), why: "" },
      { k: "12M raw", weight: 3, score: scoreRange(rs.twelveMonth, -25, 60), why: "" },
    ]).score;
    return weighted([
      { k: "EPS estimate revisions", weight: 20, score: epsRev.score, why: epsRev.note },
      { k: "Revenue estimate revisions", weight: 15, score: revRev.score, why: revRev.note },
      { k: "Growth acceleration", weight: 15, score: ge.details.find(x => x.k === "Revenue acceleration")?.score, why: "fundamental acceleration proxy" },
      { k: "Earnings surprise history", weight: 10, score: null, why: "last-four-quarter surprise history unavailable in bundled data" },
      { k: "Guidance direction", weight: 10, score: null, why: "guidance history unavailable until snapshots/news parser accumulate" },
      { k: "Relative strength", weight: 15, score: rsScore, why: `3M vs sector ${round(rs.vsSector3, 1)}pp, vs SPY ${round(rs.vsSpy3, 1)}pp` },
      { k: "Post-earnings reaction", weight: 10, score: null, why: "earnings-day/five-day reaction history not bundled yet" },
      { k: "Sector strength", weight: 5, score: sectorStrength, why: `sector 3M vs SPY ${round(retOver(sector, 3) - retOver(spy, 3), 1)}pp` },
    ]);
  }

  function shareholderEconomics(d) {
    const sbc = last(d.sbc), rev = last(d.revenue), fcf = last(d.qm && d.qm.fcf), shares = clean(d.shares);
    const oneYr = shares.length >= 2 ? pct(shares[shares.length - 1], shares[shares.length - 2]) : null;
    const fiveYr = shares.length >= 2 ? pct(shares[shares.length - 1], shares[0]) : null;
    const buyback = last(d.buyback);
    const ownerGrowth = cagr(ownerEpsSeries(d));
    return weighted([
      { k: "SBC burden", weight: 20, score: scoreLower(div(sbc, rev) * 100, 2, 20), why: `SBC/revenue ${round(div(sbc, rev) * 100, 1)}%` },
      { k: "FCF dilution burden", weight: 20, score: fcf != null && sbc != null ? scoreLower(div(sbc, Math.abs(fcf)) * 100, 5, 80) : null, why: `SBC/FCF ${round(div(sbc, Math.abs(fcf)) * 100, 1)}%` },
      { k: "One-year dilution", weight: 15, score: scoreLower(oneYr, -3, 8), why: `1Y share change ${round(oneYr, 1)}%` },
      { k: "Five-year dilution", weight: 15, score: scoreLower(fiveYr, -12, 25), why: `record share change ${round(fiveYr, 1)}%` },
      { k: "Buyback effectiveness", weight: 15, score: buyback != null && sbc != null ? scoreRange(buyback - sbc, -sbc, Math.max(sbc * 2, 0.01)) : null, why: `buybacks less SBC ${round((buyback || 0) - (sbc || 0), 2)}B` },
      { k: "Owner EPS growth", weight: 15, score: scoreRange(ownerGrowth, -10, 25), why: `owner EPS CAGR ${round(ownerGrowth, 1)}%` },
    ]);
  }

  function valuation(d, ctx) {
    const fcf = last(d.qm && d.qm.fcf), sbc = last(d.sbc), mcap = d.mktCap, price = d.price;
    const g = d.gd || {}, ev = mcap != null ? mcap + (g.debt || 0) - (g.cash || 0) : null;
    const gaapYield = d.gaapEPS && price ? (d.gaapEPS / price) * 100 : null;
    const fcfYield = fcf != null && mcap ? (fcf / mcap) * 100 : null;
    const adjFcf = fcf != null && sbc != null ? fcf - sbc : null;
    const adjFcfYield = adjFcf != null && mcap ? (adjFcf / mcap) * 100 : null;
    const ownerYield = d.ownerEps && price ? (d.ownerEps / price) * 100 : null;
    const evFcf = ev != null && fcf > 0 ? ev / fcf : null;
    const evAdjFcf = ev != null && adjFcf > 0 ? ev / adjFcf : null;
    const peers = (ctx.data || []).filter(x => x !== d && x.sector === d.sector && x.truePE).map(x => x.truePE).sort((a, b) => a - b);
    const peerMedian = peers.length ? peers[Math.floor(peers.length / 2)] : null;
    const growth = Math.max(cagr(d.revenue) || 0, cagr(ownerEpsSeries(d)) || 0);
    return weighted([
      { k: "GAAP earnings yield", weight: 10, score: scoreRange(gaapYield, 0, 7), why: `GAAP yield ${round(gaapYield, 1)}%` },
      { k: "FCF yield", weight: 14, score: scoreRange(fcfYield, -2, 8), why: `FCF yield ${round(fcfYield, 1)}%` },
      { k: "SBC-adjusted FCF yield", weight: 14, score: scoreRange(adjFcfYield, -3, 7), why: `FCF after SBC yield ${round(adjFcfYield, 1)}%` },
      { k: "Owner earnings yield", weight: 18, score: scoreRange(ownerYield, 0, 7), why: `owner earnings yield ${round(ownerYield, 1)}%` },
      { k: "EV/FCF", weight: 12, score: scoreLower(evFcf, 12, 60), why: `EV/FCF ${round(evFcf, 1)}x` },
      { k: "EV/adjusted FCF", weight: 12, score: scoreLower(evAdjFcf, 12, 70), why: `EV/adj FCF ${round(evAdjFcf, 1)}x` },
      { k: "Peer comparison", weight: 10, score: d.truePE && peerMedian ? scoreLower(d.truePE / peerMedian, 0.7, 1.8) : null, why: `owner P/E ${round(d.truePE, 1)}x vs peer median ${round(peerMedian, 1)}x` },
      { k: "Growth-adjusted valuation", weight: 10, score: d.truePE ? scoreLower(d.truePE / Math.max(growth, 1), 1.2, 5.0) : null, why: `owner P/E / growth ${round(d.truePE / Math.max(growth, 1), 2)}x` },
    ]);
  }

  function dataConfidence(d) {
    if (d.dataConfidence && d.dataConfidence.score != null) return d.dataConfidence;
    const sv = d.secv || { verified: [], conflict: [], missing: [] };
    let score = 20 + (sv.verified || []).length * 12 - (sv.conflict || []).length * 12 - (sv.missing || []).length * 3;
    if (d.dataBlocked) score = Math.min(score, 50);
    return { score: clamp(Math.round(score)), rankable: score >= 80 && !d.dataBlocked, reason: "score-engine fallback confidence" };
  }

  function combine(scores, weights) {
    return weighted(Object.entries(weights).map(([k, w]) => ({ k, weight: w, score: scores[k] && scores[k].score, why: k })));
  }

  function finalLabel(scores) {
    const b = scores.businessQuality.score, g = scores.growthExecution.score, m = scores.marketReward.score;
    const s = scores.shareholderEconomics.score, v = scores.valuation.score;
    let label = "Mixed evidence", reasons = [];
    if (b >= 85 && g >= 70 && v >= 55) label = "Elite compounder";
    else if (b >= 85 && v < 50) label = "Elite business, expensive stock";
    else if (g >= 70 && m >= 70) label = "Improving business, market noticing";
    else if (b >= 75 && m < 50) label = "Great business, market not rewarding it yet";
    else if (b < 45 && m >= 70) label = "Weak business, strong speculation";
    else if (b >= 70 && s < 45) label = "Shareholder leakage problem";
    else if (v >= 70 && (g < 45 || b < 50 || m < 45)) label = "Value trap risk";
    if (b != null) reasons.push(`Business Quality ${b}`);
    if (g != null) reasons.push(`Growth and Execution ${g}`);
    if (m != null) reasons.push(`Market Reward ${m}`);
    if (s != null) reasons.push(`Shareholder Economics ${s}`);
    if (v != null) reasons.push(`Valuation ${v}`);
    return { label, reasons };
  }

  function expectationsGap(d, ctx) {
    const ownerEps = d.ownerEps || null;
    const sectorPeers = (ctx.data || []).filter(x => x !== d && x.sector === d.sector && x.truePE).map(x => x.truePE).sort((a, b) => a - b);
    const exitMultiple = sectorPeers.length ? clamp(sectorPeers[Math.floor(sectorPeers.length / 2)], 12, 38) : 22;
    const requiredOwnerGrowth = ownerEps && ownerEps > 0 && d.price ? (Math.pow(d.price / (ownerEps * exitMultiple), 1 / 5) - 1) * 100 : null;
    const fcfMargin = last(margins(d).fcf);
    const revBase = cagr(d.revenue);
    const hist = ctx.estimates && ctx.estimates[d.ticker];
    const snaps = hist && hist.snapshots || [];
    const latest = snaps[snaps.length - 1] || {};
    const consensusRevGrowth = latest.currentYearRevenue && latest.nextYearRevenue ? pct(latest.nextYearRevenue, latest.currentYearRevenue) : null;
    const consensusFcfMargin = null;
    const terminalRev = revBase;
    const terminalFcf = fcfMargin;
    const compare = consensusRevGrowth != null ? consensusRevGrowth - requiredOwnerGrowth : terminalRev != null && requiredOwnerGrowth != null ? terminalRev - requiredOwnerGrowth : null;
    let label = "Insufficient data";
    if (compare != null) {
      if (compare >= 8) label = "Large positive gap";
      else if (compare >= 3) label = "Moderate positive gap";
      else if (compare >= -3) label = "Fairly priced";
      else if (compare >= -8) label = "Moderate expectations risk";
      else label = "Extreme expectations risk";
    }
    return {
      label,
      marketImplied: { revenueGrowth: round(requiredOwnerGrowth, 1), futureFcfMargin: round(fcfMargin, 1), ownerEpsGrowth: round(requiredOwnerGrowth, 1), exitMultiple: round(exitMultiple, 1) },
      consensus: { revenueGrowth: round(consensusRevGrowth, 1), futureFcfMargin: consensusFcfMargin, source: snaps.length ? "estimate history snapshot" : "unavailable" },
      terminalBase: { revenueGrowth: round(terminalRev, 1), futureFcfMargin: round(terminalFcf, 1), ownerEpsGrowth: round(cagr(ownerEpsSeries(d)), 1) },
      gapPct: round(compare, 1),
      assumptions: [`5-year horizon`, `exit owner P/E ${round(exitMultiple, 1)}x`, `owner EPS ${round(ownerEps, 2)}`, `FCF margin from latest annual data`],
    };
  }

  function whatChanged(d) {
    const q = d.qd || {};
    const n = q.revenue && q.revenue.length || 0;
    if (n < 2) return { label: "Insufficient data", sentences: ["Quarterly data is not available."], score: null };
    const revSeq = seqGrowths(q.revenue);
    const latestRev = revSeq[revSeq.length - 1], prevRev = revSeq[revSeq.length - 2];
    const gm = q.revenue.map((r, i) => r ? null : null); // retained for future gross-quarter support
    const epsNow = last(q.ni) != null && last(q.shares) ? last(q.ni) / last(q.shares) : null;
    const epsPrev = q.ni && q.shares && q.ni.length >= 2 && q.shares.length >= 2 ? q.ni[q.ni.length - 2] / q.shares[q.shares.length - 2] : null;
    const fcfps = fcfPerShareSeries(d);
    const fcfNow = last(fcfps), fcfPrev = fcfps.length >= 2 ? fcfps[fcfps.length - 2] : null;
    const sbcRevNow = last(q.sbc) != null && last(q.revenue) ? (last(q.sbc) / last(q.revenue)) * 100 : null;
    const shareNow = last(q.shares), sharePrev = q.shares && q.shares.length >= 2 ? q.shares[q.shares.length - 2] : null;
    let score = 50;
    if (latestRev != null && prevRev != null) score += clamp(latestRev - prevRev, -10, 10);
    if (epsNow != null && epsPrev != null) score += clamp(pct(epsNow, epsPrev) / 2, -10, 10);
    if (fcfNow != null && fcfPrev != null) score += clamp(pct(fcfNow, fcfPrev) / 2, -10, 10);
    if (shareNow != null && sharePrev != null) score -= clamp(pct(shareNow, sharePrev) * 2, -8, 8);
    if (sbcRevNow != null && sbcRevNow > 15) score -= 4;
    score = clamp(score);
    const label = score >= 75 ? "Much better" : score >= 58 ? "Better" : score >= 45 ? "Mostly unchanged" : score >= 30 ? "Worse" : "Much worse";
    const sentences = [
      latestRev != null && prevRev != null ? `Revenue growth changed from ${round(prevRev, 1)}% to ${round(latestRev, 1)}%.` : "Revenue acceleration is unavailable.",
      epsNow != null && epsPrev != null ? `EPS changed from $${round(epsPrev, 2)} to $${round(epsNow, 2)}.` : "EPS change is unavailable.",
      fcfNow != null && fcfPrev != null ? `Free cash flow per share changed from $${round(fcfPrev, 2)} to $${round(fcfNow, 2)}.` : "Free cash flow per share change is unavailable.",
      sbcRevNow != null ? `SBC/revenue is ${round(sbcRevNow, 1)}%.` : "SBC/revenue for the newest quarter is unavailable.",
      shareNow != null && sharePrev != null ? `Share count changed ${round(pct(shareNow, sharePrev), 1)}% sequentially.` : "Share-count change is unavailable.",
    ];
    return { label, score: Math.round(score), sentences };
  }

  function thesisAlerts(d, thesis, ctx) {
    const s = scoreCompany(d, ctx);
    const rs = relativeStrength(d, ctx);
    const qGrowth = latestQGrowth(d);
    const opm = last(margins(d).op);
    const sbcRev = last(d.sbc) != null && last(d.revenue) ? (last(d.sbc) / last(d.revenue)) * 100 : null;
    const alerts = [];
    const t = thesis || {};
    if (t.minRevenueGrowth != null && qGrowth != null && qGrowth < t.minRevenueGrowth) alerts.push(`Revenue growth ${round(qGrowth, 1)}% is below thesis floor ${t.minRevenueGrowth}%.`);
    if (t.minOperatingMargin != null && opm != null && opm < t.minOperatingMargin) alerts.push(`Operating margin ${round(opm, 1)}% is below thesis floor ${t.minOperatingMargin}%.`);
    if (t.maxSbcRevenue != null && sbcRev != null && sbcRev > t.maxSbcRevenue) alerts.push(`SBC/revenue ${round(sbcRev, 1)}% is above thesis limit ${t.maxSbcRevenue}%.`);
    if (t.minRelativeStrength != null && rs.vsSector3 != null && rs.vsSector3 < t.minRelativeStrength) alerts.push(`3M relative strength vs sector ${round(rs.vsSector3, 1)}pp is below thesis floor ${t.minRelativeStrength}pp.`);
    if (t.maxOwnerPE != null && d.truePE != null && d.truePE > t.maxOwnerPE) alerts.push(`Owner P/E ${round(d.truePE, 1)}x is above thesis limit ${t.maxOwnerPE}x.`);
    return { alerts, broken: alerts.length, scoreSnapshot: s };
  }

  function scoreCompany(d, ctx = {}) {
    const scores = {
      businessQuality: businessQuality(d, ctx),
      growthExecution: growthExecution(d, ctx),
      marketReward: marketReward(d, ctx),
      shareholderEconomics: shareholderEconomics(d),
      valuation: valuation(d, ctx),
      dataConfidence: dataConfidence(d),
    };
    const longTerm = combine(scores, SCORE_WEIGHTS.longTermView);
    const marketView = combine(scores, SCORE_WEIGHTS.marketRewardView);
    const label = finalLabel(scores);
    const rise = [];
    const risk = [];
    if ((scores.marketReward.score || 0) >= 65) rise.push("Market reward and relative strength are improving.");
    if ((scores.growthExecution.score || 0) >= 65) rise.push("Growth, margins or FCF/share are improving.");
    if ((scores.valuation.score || 0) >= 60) rise.push("Current expectations appear achievable relative to owner earnings.");
    if ((scores.businessQuality.score || 0) >= 75) rise.push("Business quality is high.");
    if ((scores.valuation.score || 100) < 45) risk.push("Valuation requires strong future results.");
    if ((scores.shareholderEconomics.score || 100) < 50) risk.push("Shareholder economics show SBC or dilution leakage.");
    if ((scores.marketReward.score || 100) < 45) risk.push("The market is not rewarding the business yet.");
    if ((scores.growthExecution.score || 100) < 45) risk.push("Growth or execution is weakening.");
    return {
      version: MARKET_TERMINAL_VERSION,
      ...scores,
      longTermView: longTerm,
      marketRewardView: marketView,
      finalLabel: label,
      expectationsGap: expectationsGap(d, ctx),
      whatChanged: whatChanged(d),
      relativeStrength: relativeStrength(d, ctx),
      whyRise: rise.length ? rise : ["No major upside driver is proven by the bundled data."],
      whatCouldGoWrong: risk.length ? risk : ["Main risk is paying too much if expectations reset."],
    };
  }

  function scoreUniverse(data, ctx = {}) {
    return (data || []).map(d => ({ ticker: d.ticker, name: d.name, sector: d.sector, scores: scoreCompany(d, { ...ctx, data }) }));
  }

  function qualityMarketMap(data, ctx = {}) {
    return scoreUniverse(data, ctx).map(x => ({
      ticker: x.ticker, name: x.name, sector: x.sector,
      businessQuality: x.scores.businessQuality.score,
      marketReward: x.scores.marketReward.score,
      valuation: x.scores.valuation.score,
      longTermView: x.scores.longTermView.score,
      label: x.scores.finalLabel.label,
    }));
  }

  window.ScoreEngine = {
    MARKET_TERMINAL_VERSION,
    SCORE_WEIGHTS,
    scoreCompany,
    scoreUniverse,
    qualityMarketMap,
    expectationsGap,
    whatChanged,
    thesisAlerts,
    relativeStrength,
  };
})();
