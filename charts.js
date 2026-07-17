/* =========================================================================
   SBC TERMINAL — zero-dependency SVG charts (theme-aware, crisp)
   Every function returns an SVG string.
   ========================================================================= */
(function () {
  const C = {
    grid: "#1c2434", axis: "#576072", text: "#7d8798",
    amber: "#ffb000", green: "#26d07c", red: "#ff5b6b",
    cyan: "#37c6ff", orange: "#ff8a3d", purple: "#b48cff",
  };
  const fmt = (n, step) => {
    if (n == null || isNaN(n)) return "–";
    const a = Math.abs(n);
    if (a >= 1000) return (n / 1000).toFixed(1) + "k";
    // precision follows the tick step so small ranges don't produce duplicate labels
    if (step != null) {
      const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
      return n.toFixed(dec);
    }
    if (a >= 100) return n.toFixed(0);
    if (a >= 1) return n.toFixed(1);
    return n.toFixed(2);
  };
  function niceScale(min, max, ticks = 4) {
    if (min === max) { max = max || 1; min = 0; }
    const range = max - min;
    const step0 = range / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    let step = mag * (norm >= 5 ? 5 : norm >= 2 ? 2 : 1);
    const nmin = Math.floor(min / step) * step;
    const nmax = Math.ceil(max / step) * step;
    const out = [];
    for (let v = nmin; v <= nmax + step / 2; v += step) out.push(+v.toFixed(6));
    return { min: nmin, max: nmax, ticks: out };
  }

  /* ---------- LINE CHART (multi-series) ---------- */
  function line(series, xlabels, opts = {}) {
    const W = opts.w || 520, H = opts.h || 190;
    const P = { t: 12, r: 14, b: 22, l: 38 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    let lo = Infinity, hi = -Infinity;
    series.forEach(s => s.points.forEach(v => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
    if (opts.zero) lo = Math.min(lo, 0);
    const sc = niceScale(lo, hi, 4);
    const x = i => P.l + (xlabels.length === 1 ? iw / 2 : (i / (xlabels.length - 1)) * iw);
    const y = v => P.t + ih - ((v - sc.min) / (sc.max - sc.min)) * ih;
    let g = "";
    sc.ticks.forEach(t => {
      const yy = y(t);
      g += `<line x1="${P.l}" y1="${yy}" x2="${W - P.r}" y2="${yy}" stroke="${C.grid}"/>`;
      g += `<text x="${P.l - 5}" y="${yy + 3}" fill="${C.text}" font-size="8.5" text-anchor="end">${fmt(t, sc.ticks[1] - sc.ticks[0])}</text>`;
    });
    xlabels.forEach((lb, i) => {
      g += `<text x="${x(i)}" y="${H - 6}" fill="${C.text}" font-size="8.5" text-anchor="middle">${lb}</text>`;
    });
    let paths = "";
    series.forEach(s => {
      const col = s.color || C.cyan;
      let d = "", area = "";
      s.points.forEach((v, i) => {
        if (v == null) return;
        const cmd = d ? "L" : "M";
        d += `${cmd}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      });
      if (opts.area && series.length === 1) {
        area = `<path d="${d}L${x(s.points.length - 1)} ${y(sc.min)} L${x(0)} ${y(sc.min)} Z" fill="${col}" opacity="0.08"/>`;
      }
      paths += area + `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>`;
      s.points.forEach((v, i) => { if (v != null) paths += `<circle cx="${x(i)}" cy="${y(v)}" r="2.4" fill="${col}"/>`; });
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${g}${paths}</svg>`;
  }

  /* ---------- DRAWDOWN CHART (percentage below running high) ---------- */
  function drawdown(points, xlabels, opts = {}) {
    const vals = points.map(v => Number.isFinite(+v) ? +v : null);
    const W = opts.w || 700, H = opts.h || 220;
    const P = { t: 16, r: 58, b: 25, l: 44 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const valid = vals.filter(v => v != null);
    if (valid.length < 2) return "";
    const worst = Math.min(...valid, 0);
    const floor = Math.min(-5, Math.floor(worst / 5) * 5);
    const x = i => P.l + (vals.length === 1 ? iw / 2 : (i / (vals.length - 1)) * iw);
    const y = v => P.t + ((0 - v) / (0 - floor)) * ih;
    let grid = "";
    for (let tick = 0; tick >= floor; tick -= 5) {
      const yy = y(tick);
      grid += `<line x1="${P.l}" y1="${yy}" x2="${W - P.r}" y2="${yy}" stroke="${C.grid}"/>`;
      grid += `<text x="${P.l - 6}" y="${yy + 3}" fill="${C.text}" font-size="9" text-anchor="end">${tick}%</text>`;
    }
    let path = "";
    vals.forEach((v, i) => { if (v != null) path += `${path ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; });
    const first = vals.findIndex(v => v != null), last = vals.findLastIndex(v => v != null);
    const area = `${path}L${x(last).toFixed(1)} ${y(0).toFixed(1)} L${x(first).toFixed(1)} ${y(0).toFixed(1)} Z`;
    let labels = "";
    xlabels.forEach((label, i) => {
      if (label) labels += `<text x="${x(i)}" y="${H - 6}" fill="${C.text}" font-size="9" text-anchor="${i === 0 ? "start" : i === xlabels.length - 1 ? "end" : "middle"}">${label}</text>`;
    });
    const current = vals[last];
    const tagY = Math.max(P.t + 9, Math.min(H - P.b - 5, y(current)));
    const tagColor = current <= -20 ? "#ff4560" : current <= -10 ? C.red : C.orange;
    return `<svg class="drawdown-svg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Drawdown from running high">
      ${grid}
      <path d="${area}" fill="${tagColor}" opacity="0.10"/>
      <path d="${path}" fill="none" stroke="${tagColor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(last)}" cy="${y(current)}" r="3.5" fill="${tagColor}"/>
      <rect x="${W - P.r + 5}" y="${tagY - 10}" width="48" height="20" rx="4" fill="${tagColor}"/>
      <text x="${W - P.r + 29}" y="${tagY + 4}" fill="#fff" font-size="10" font-weight="800" text-anchor="middle">${current.toFixed(1)}%</text>
      ${labels}
    </svg>`;
  }

  /* ---------- GROUPED / SINGLE BAR CHART ---------- */
  function bars(groups, xlabels, opts = {}) {
    // groups: [{name,color,values:[...]}]
    const W = opts.w || 520, H = opts.h || 190;
    const P = { t: 12, r: 14, b: 22, l: 38 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    let lo = 0, hi = -Infinity;
    groups.forEach(s => s.values.forEach(v => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
    const sc = niceScale(lo, hi, 4);
    const y = v => P.t + ih - ((v - sc.min) / (sc.max - sc.min)) * ih;
    const zeroY = y(0);
    const nG = xlabels.length, nS = groups.length;
    const gw = iw / nG, bw = Math.min((gw * 0.7) / nS, 34);
    let g = "";
    sc.ticks.forEach(t => {
      const yy = y(t);
      g += `<line x1="${P.l}" y1="${yy}" x2="${W - P.r}" y2="${yy}" stroke="${C.grid}"/>`;
      g += `<text x="${P.l - 5}" y="${yy + 3}" fill="${C.text}" font-size="8.5" text-anchor="end">${fmt(t, sc.ticks[1] - sc.ticks[0])}</text>`;
    });
    let rects = "";
    xlabels.forEach((lb, gi) => {
      const gx = P.l + gi * gw + gw / 2;
      groups.forEach((s, si) => {
        const v = s.values[gi]; if (v == null) return;
        const bx = gx - (nS * bw) / 2 + si * bw + 1;
        const yy = y(v), h = Math.abs(yy - zeroY);
        const col = s.color || C.amber;
        rects += `<rect x="${bx}" y="${Math.min(yy, zeroY)}" width="${bw - 2}" height="${Math.max(h, 1)}" rx="2" fill="${col}"><title>${lb} ${s.name}: ${fmt(v)}</title></rect>`;
      });
      g += `<text x="${gx}" y="${H - 6}" fill="${C.text}" font-size="8.5" text-anchor="middle">${lb}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${g}${rects}</svg>`;
  }

  /* ---------- HORIZONTAL COMPARISON BAR (headline vs owner P/E etc) ---------- */
  function hbars(items, opts = {}) {
    // items: [{label, value, color, max?}]
    const W = opts.w || 260, rowH = 26, pad = 8;
    const H = items.length * rowH + pad * 2;
    const labelW = opts.labelW || 92;
    const max = opts.max || Math.max(...items.map(i => i.value || 0)) * 1.1 || 1;
    let s = "";
    items.forEach((it, i) => {
      const y = pad + i * rowH;
      const bw = ((it.value || 0) / max) * (W - labelW - 46);
      s += `<text x="0" y="${y + 15}" fill="${C.text}" font-size="9.5">${it.label}</text>`;
      s += `<rect x="${labelW}" y="${y + 5}" width="${W - labelW - 46}" height="11" rx="3" fill="#0b101b"/>`;
      s += `<rect x="${labelW}" y="${y + 5}" width="${Math.max(bw, 2)}" height="11" rx="3" fill="${it.color}"/>`;
      s += `<text x="${W - 42}" y="${y + 15}" fill="#d8e0ea" font-size="10" font-weight="700">${it.display || fmt(it.value)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%">${s}</svg>`;
  }

  /* ---------- DONUT (owner-earnings retention) ---------- */
  function donut(pct, opts = {}) {
    const size = opts.size || 120, r = size / 2 - 10, cx = size / 2, cy = size / 2;
    const c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(1, pct));
    const col = p >= 0.85 ? C.green : p >= 0.7 ? C.amber : p >= 0.55 ? C.orange : C.red;
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#0b101b" stroke-width="11"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="11"
        stroke-dasharray="${c * p} ${c}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>
      <text x="${cx}" y="${cy - 1}" fill="#d8e0ea" font-size="20" font-weight="800" text-anchor="middle">${(p * 100).toFixed(0)}¢</text>
      <text x="${cx}" y="${cy + 15}" fill="${C.text}" font-size="8" text-anchor="middle">KEPT / $1 GAAP</text>
    </svg>`;
  }

  window.Chart = { line, drawdown, bars, hbars, donut, C };
})();
