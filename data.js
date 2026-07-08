/* =========================================================================
   SBC TERMINAL — bundled dataset
   -------------------------------------------------------------------------
   Quotes AND annual fundamentals are REAL data pulled from Yahoo Finance on
   2026-07-08 (last 4 fiscal years per company, as-reported filings). Refresh
   anytime by re-running scripts/update_data.py.
   Connect a Finnhub / FMP key (gear icon) to overwrite quotes, news and the
   financial arrays with live data.

   Units:
     price/change  -> USD / %
     mktCap        -> USD billions
     revenue/ni/sbc/buyback -> USD billions (per fiscal year)
     shares        -> billions of diluted shares
     eps values    -> USD per share
     ownersKeep    -> fraction of each GAAP $ shareholders actually keep
                      after true SBC economics (Burry-style)
   Years: 2021..2025
   Buckets: clean | middle | high | tragic
   Grades:  A B C D F
   ========================================================================= */

const YEARS = [2021, 2022, 2023, 2024, 2025];

/* helper: build a company record with sane defaults */
function co(o) {
  o.truePE = o.headlinePE && o.ownersKeep ? +(o.headlinePE / o.ownersKeep).toFixed(1) : null;
  o.sbcAdjEPS = o.gaapEPS != null && o.ownersKeep != null ? +(o.gaapEPS * o.ownersKeep).toFixed(2) : null;
  o.snapshot = "quotes + annual fundamentals: Yahoo Finance · 2026-07-08";
  return o;
}

const DATA = [
  /* ================= CLEAN / SHAREHOLDER-FRIENDLY ================= */
  co({ ticker:"AAPL", name:"Apple Inc.", sector:"Consumer Tech", bucket:"clean", grade:"A",
    price:310.69, change:0.01, mktCap:4563.2, headlinePE:37.6, ownersKeep:0.94,
    gaapEPS:8.26, nonGaapEPS:8.45,
    fy:["2022","2023","2024","2025"], sbcPctRev:3.1, sbcPctOCF:11.5, sbcPctNI:11,
    revenue:[394.33,383.29,391.04,416.16], ni:[99.8,97,93.74,112.01], sbc:[9.038,10.833,11.688,12.863],
    buyback:[89.4,77.55,94.95,90.71], shares:[16.326,15.813,15.408,15.005],
    note:"Falling share count driven by genuine buybacks well above SBC offset. Cleanest large-cap capital return." }),

  co({ ticker:"MSFT", name:"Microsoft Corp.", sector:"Software", bucket:"clean", grade:"A",
    price:382.64, change:-1.59, mktCap:2842.4, headlinePE:22.8, ownersKeep:0.90,
    gaapEPS:16.80, nonGaapEPS:17.57,
    fy:["2022","2023","2024","2025"], sbcPctRev:4.3, sbcPctOCF:8.8, sbcPctNI:12,
    revenue:[198.27,211.91,245.12,281.72], ni:[72.74,72.36,88.14,101.83], sbc:[7.502,9.611,10.734,11.974],
    buyback:[32.7,22.25,17.25,18.42], shares:[7.54,7.472,7.469,7.465],
    note:"SBC meaningful but modest vs cash flow; share count roughly flat, buybacks mostly offset dilution." }),

  co({ ticker:"MU", name:"Micron Technology", sector:"Semis", bucket:"clean", grade:"A",
    price:927.07, change:-1.21, mktCap:1047.0, headlinePE:21.0, ownersKeep:0.92,
    gaapEPS:44.20, nonGaapEPS:46.04,
    fy:["2022","2023","2024","2025"], sbcPctRev:2.6, sbcPctOCF:5.5, sbcPctNI:11,
    revenue:[30.76,15.54,25.11,37.38], ni:[8.69,-5.83,0.78,8.54], sbc:[0.514,0.596,0.833,0.972],
    buyback:[2.43,0.42,0.3,0], shares:[1.122,1.093,1.118,1.125],
    note:"Cyclical but low SBC intensity. GAAP tracks owner earnings closely through the cycle." }),

  co({ ticker:"CSCO", name:"Cisco Systems", sector:"Networking", bucket:"clean", grade:"A",
    price:113.15, change:1.22, mktCap:446.0, headlinePE:37.7, ownersKeep:0.91,
    gaapEPS:3.00, nonGaapEPS:3.63,
    fy:["2022","2023","2024","2025"], sbcPctRev:6.4, sbcPctOCF:25.7, sbcPctNI:36,
    revenue:[51.56,57,53.8,56.65], ni:[11.81,12.61,10.32,10.18], sbc:[1.886,2.353,3.074,3.641],
    buyback:[8.38,4.89,6.78,7.22], shares:[4.192,4.105,4.062,3.998],
    note:"Steadily shrinking share count; buybacks exceed SBC. Mature, shareholder-aligned." }),

  co({ ticker:"TXN", name:"Texas Instruments", sector:"Semis", bucket:"clean", grade:"A",
    price:301.79, change:2.89, mktCap:274.7, headlinePE:51.7, ownersKeep:0.93,
    gaapEPS:5.84, nonGaapEPS:5.99,
    fy:["2022","2023","2024","2025"], sbcPctRev:2.4, sbcPctOCF:5.9, sbcPctNI:8,
    revenue:[20.03,17.52,15.64,17.68], ni:[8.75,6.51,4.8,5], sbc:[0.289,0.362,0.387,0.419],
    buyback:[3.62,0.29,0.93,1.48], shares:[0.926,0.916,0.919,0.913],
    note:"Low SBC, disciplined buybacks, per-share compounding intact." }),

  co({ ticker:"ADP", name:"Automatic Data Processing", sector:"HR Tech", bucket:"clean", grade:"A",
    price:242.45, change:-1.28, mktCap:96.9, headlinePE:22.6, ownersKeep:0.95,
    gaapEPS:10.71, nonGaapEPS:10.87,
    fy:["2022","2023","2024","2025"], sbcPctRev:1.3, sbcPctOCF:5.4, sbcPctNI:7,
    revenue:[16.5,18.01,19.2,20.56], ni:[2.95,3.41,3.75,4.08], sbc:[0.202,0.22,0.243,0.266],
    buyback:[1.97,1.12,1.23,1.28], shares:[0.421,0.416,0.412,0.409],
    note:"Textbook clean compounder: tiny SBC, falling share count." }),

  co({ ticker:"COST", name:"Costco Wholesale", sector:"Retail", bucket:"clean", grade:"A",
    price:960.00, change:1.32, mktCap:425.7, headlinePE:48.5, ownersKeep:0.97,
    gaapEPS:19.80, nonGaapEPS:19.86,
    fy:["2022","2023","2024","2025"], sbcPctRev:0.3, sbcPctOCF:6.4, sbcPctNI:11,
    revenue:[226.95,242.29,254.45,275.24], ni:[5.84,6.29,7.37,8.1], sbc:[0.724,0.774,0.818,0.86],
    buyback:[0.44,0.68,0.7,0.9], shares:[0.445,0.444,0.445,0.445],
    note:"Almost no SBC games. Expensive on P/E but earnings are real." }),

  co({ ticker:"GILD", name:"Gilead Sciences", sector:"Pharma", bucket:"clean", grade:"A",
    price:135.50, change:-0.63, mktCap:168.2, headlinePE:18.4, ownersKeep:0.90,
    gaapEPS:7.35, nonGaapEPS:9.06,
    fy:["2022","2023","2024","2025"], sbcPctRev:3.0, sbcPctOCF:8.9, sbcPctNI:11,
    revenue:[27.28,27.12,28.75,29.44], ni:[4.59,5.67,0.48,8.51], sbc:[0.637,0.766,0.835,0.894],
    buyback:[1.4,1,1.15,1.92], shares:[1.262,1.258,1.255,1.255],
    note:"Modest SBC; non-GAAP add-backs are mostly amortization, not SBC inflation." }),

  co({ ticker:"HON", name:"Honeywell", sector:"Industrials", bucket:"clean", grade:"A",
    price:220.79, change:-1.89, mktCap:70.0, headlinePE:17.6, ownersKeep:0.93,
    gaapEPS:12.51, nonGaapEPS:13.09,
    fy:["2022","2023","2024","2025"], sbcPctRev:0.5, sbcPctOCF:3.1, sbcPctNI:4,
    revenue:[35.47,33.01,34.72,37.44], ni:[4.97,5.66,5.71,4.73], sbc:[0.188,0.197,0.189,0.196],
    buyback:[4.2,3.71,1.66,3.8], shares:[0.342,0.334,0.328,0.321],
    note:"Industrial discipline: low SBC, consistent share shrink." }),

  co({ ticker:"ASML", name:"ASML Holding", sector:"Semi Equip", bucket:"clean", grade:"A",
    price:1758.42, change:0.64, mktCap:677.7, headlinePE:59.5, ownersKeep:0.94,
    gaapEPS:29.53, nonGaapEPS:29.94,
    fy:["2022","2023","2024","2025"], sbcPctRev:0.6, sbcPctOCF:3.5, sbcPctNI:2,
    revenue:[21.17,27.56,28.26,32.67], ni:[5.62,7.84,7.57,9.61], sbc:[0.069,0.135,0.173,0.202],
    buyback:[4.64,1,0.5,5.95], shares:[0.398,0.394,0.394,0.389],
    note:"Monopoly economics, negligible SBC intensity, real buybacks." }),

  co({ ticker:"MELI", name:"MercadoLibre", sector:"E-commerce", bucket:"clean", grade:"B",
    price:1778.66, change:-1.93, mktCap:90.2, headlinePE:46.9, ownersKeep:0.88,
    gaapEPS:37.90, nonGaapEPS:41.89,
    fy:["2022","2023","2024","2025"], sbcPctRev:3.8, sbcPctOCF:8.0, sbcPctNI:14.0,
    revenue:[10.78,15.11,20.78,28.89], ni:[0.48,0.99,1.91,2], sbc:[0.001,0.167,null,null],
    buyback:[0.15,0.36,0,0], shares:[0.051,0.051,0.051,0.051],
    note:"SBC rising with scale but small vs LatAm growth runway. Watch dilution creep." }),

  /* ================= MIDDLE / MEANINGFUL HAIRCUT ================= */
  co({ ticker:"GOOGL", name:"Alphabet", sector:"Software", bucket:"middle", grade:"B",
    price:361.02, change:-1.64, mktCap:4405.4, headlinePE:27.6, ownersKeep:0.84,
    gaapEPS:13.10, nonGaapEPS:14.00,
    fy:["2022","2023","2024","2025"], sbcPctRev:6.2, sbcPctOCF:15.1, sbcPctNI:19,
    revenue:[282.84,307.39,350.02,402.84], ni:[59.97,73.8,100.12,132.17], sbc:[19.362,22.46,22.785,24.953],
    buyback:[59.3,61.5,62.22,45.71], shares:[13.159,12.722,12.447,12.23],
    note:"High absolute SBC but buybacks now shrink share count; ~16c/$ leakage. Needs haircut, not fatal." }),

  co({ ticker:"AMZN", name:"Amazon", sector:"E-commerce/Cloud", bucket:"middle", grade:"C",
    price:241.31, change:-1.90, mktCap:2595.7, headlinePE:31.1, ownersKeep:0.78,
    gaapEPS:7.77, nonGaapEPS:8.96,
    fy:["2022","2023","2024","2025"], sbcPctRev:2.7, sbcPctOCF:14.0, sbcPctNI:25,
    revenue:[513.98,574.78,637.96,716.92], ni:[-2.72,30.43,59.25,77.67], sbc:[19.621,24.023,22.011,19.467],
    buyback:[6,0,0,0], shares:[10.189,10.492,10.721,10.827],
    note:"SBC is a huge share of GAAP NI and share count rises. 'FCF' historically flattered by SBC add-back." }),

  co({ ticker:"NVDA", name:"NVIDIA", sector:"Semis/AI", bucket:"middle", grade:"C",
    price:198.36, change:0.73, mktCap:4804.5, headlinePE:30.3, ownersKeep:0.83,
    gaapEPS:6.54, nonGaapEPS:7.40,
    fy:["2023","2024","2025","2026"], sbcPctRev:3.0, sbcPctOCF:6.2, sbcPctNI:5,
    revenue:[26.97,60.92,130.5,215.94], ni:[4.37,29.76,72.88,120.07], sbc:[2.709,3.549,4.737,6.386],
    buyback:[10.04,9.53,33.71,40.09], shares:[25.07,24.94,24.804,24.514],
    note:"Burry: much of FY26 buyback offset SBC dilution. NVDA to STOP excluding SBC from non-GAAP starting FQ1'27 — true multiple higher than screens show." }),

  co({ ticker:"AMD", name:"Advanced Micro Devices", sector:"Semis", bucket:"middle", grade:"D",
    price:507.02, change:-1.76, mktCap:826.7, headlinePE:169.6, ownersKeep:0.70,
    gaapEPS:2.99, nonGaapEPS:4.81,
    fy:["2022","2023","2024","2025"], sbcPctRev:4.7, sbcPctOCF:21.2, sbcPctNI:38,
    revenue:[23.6,22.68,25.79,34.64], ni:[1.32,0.85,1.64,4.33], sbc:[1.081,1.384,1.407,1.638],
    buyback:[4.11,1.41,1.59,1.92], shares:[1.571,1.625,1.637,1.636],
    note:"Non-GAAP EPS ~60% above GAAP largely from SBC + acquisition add-backs. Share count up post-Xilinx. Big haircut." }),

  co({ ticker:"ADBE", name:"Adobe", sector:"Software", bucket:"middle", grade:"C",
    price:220.10, change:-0.65, mktCap:87.5, headlinePE:12.6, ownersKeep:0.80,
    gaapEPS:17.48, nonGaapEPS:19.85,
    fy:["2022","2023","2024","2025"], sbcPctRev:8.2, sbcPctOCF:19.4, sbcPctNI:27,
    revenue:[17.61,19.41,21.5,23.77], ni:[4.76,5.43,5.56,7.13], sbc:[1.44,1.718,1.833,1.942],
    buyback:[6.55,4.4,9.5,11.28], shares:[0.471,0.459,0.45,0.427],
    note:"SBC ~9% of revenue; buybacks now shrinking shares. Classic buyback-partly-treadmill name." }),

  co({ ticker:"NFLX", name:"Netflix", sector:"Streaming", bucket:"middle", grade:"B",
    price:75.91, change:-0.36, mktCap:319.6, headlinePE:24.5, ownersKeep:0.92,
    gaapEPS:3.10, nonGaapEPS:3.21,
    fy:["2022","2023","2024","2025"], sbcPctRev:0.8, sbcPctOCF:3.6, sbcPctNI:3,
    revenue:[31.62,33.72,39,45.18], ni:[4.49,5.41,8.71,10.98], sbc:[0.575,0.339,0.273,0.368],
    buyback:[0,6.05,6.26,9.13], shares:[4.513,4.495,4.393,4.344],
    note:"Cut SBC sharply post-2022; now real buybacks. Improving quality trajectory." }),

  co({ ticker:"INTU", name:"Intuit", sector:"Software", bucket:"middle", grade:"C",
    price:272.14, change:-3.21, mktCap:74.4, headlinePE:16.6, ownersKeep:0.76,
    gaapEPS:16.39, nonGaapEPS:24.09,
    fy:["2022","2023","2024","2025"], sbcPctRev:10.5, sbcPctOCF:31.7, sbcPctNI:51,
    revenue:[12.73,14.37,16.29,18.83], ni:[2.07,2.38,2.96,3.87], sbc:[1.308,1.712,1.94,1.968],
    buyback:[1.86,1.97,1.99,2.77], shares:[0.284,0.283,0.284,0.283],
    note:"Non-GAAP EPS ~45% above GAAP, mostly SBC + amortization. Buybacks roughly offset dilution." }),

  co({ ticker:"CDNS", name:"Cadence Design", sector:"EDA Software", bucket:"middle", grade:"C",
    price:369.17, change:-0.51, mktCap:101.8, headlinePE:85.9, ownersKeep:0.78,
    gaapEPS:4.30, nonGaapEPS:6.04,
    fy:["2022","2023","2024","2025"], sbcPctRev:8.6, sbcPctOCF:26.3, sbcPctNI:41,
    revenue:[3.56,4.09,4.64,5.3], ni:[0.85,1.04,1.06,1.11], sbc:[0.27,0.326,0.391,0.455],
    buyback:[1.16,0.84,0.79,1.09], shares:[0.275,0.273,0.274,0.273],
    note:"Great business, rich multiple. SBC meaningful; true P/E well above headline." }),

  co({ ticker:"SNPS", name:"Synopsys", sector:"EDA Software", bucket:"middle", grade:"C",
    price:428.93, change:-1.76, mktCap:82.1, headlinePE:98.2, ownersKeep:0.77,
    gaapEPS:4.37, nonGaapEPS:6.20,
    fy:["2022","2023","2024","2025"], sbcPctRev:12.7, sbcPctOCF:58.8, sbcPctNI:67,
    revenue:[4.62,5.32,6.13,7.05], ni:[0.98,1.23,2.26,1.33], sbc:[0.459,0.563,0.692,0.893],
    buyback:[1.1,1.16,0,0], shares:[0.156,0.155,0.156,0.166],
    note:"Same EDA profile as CDNS: durable, but SBC drives a wide GAAP/non-GAAP gap." }),

  /* ================= HIGH SBC CONCERN ================= */
  co({ ticker:"AVGO", name:"Broadcom", sector:"Semis", bucket:"high", grade:"D",
    price:387.25, change:4.44, mktCap:1842.4, headlinePE:64.4, ownersKeep:0.68,
    gaapEPS:6.01, nonGaapEPS:7.35,
    fy:["2022","2023","2024","2025"], sbcPctRev:11.8, sbcPctOCF:27.5, sbcPctNI:33,
    revenue:[33.2,35.82,51.57,63.89], ni:[11.49,14.08,5.89,23.13], sbc:[1.533,2.171,5.741,7.568],
    buyback:[8.46,7.68,12.39,6.31], shares:[4.23,4.27,4.778,4.853],
    note:"Heavy SBC + acquisition-driven dilution (VMware). Share count rose; buybacks partly a treadmill. Materially overstated GAAP." }),

  co({ ticker:"LRCX", name:"Lam Research", sector:"Semi Equip", bucket:"high", grade:"D",
    price:330.92, change:1.47, mktCap:413.8, headlinePE:62.7, ownersKeep:0.70,
    gaapEPS:5.28, nonGaapEPS:6.05,
    fy:["2022","2023","2024","2025"], sbcPctRev:1.9, sbcPctOCF:5.6, sbcPctNI:6,
    revenue:[17.23,17.43,14.91,18.44], ni:[4.61,4.51,3.83,5.36], sbc:[0.259,0.287,0.293,0.343],
    buyback:[3.87,2.02,2.84,3.42], shares:[1.406,1.358,1.32,1.29],
    note:"Burry flags LRCX SBC quality; buybacks shrink shares but true SBC cost (withholding + offset) larger than GAAP expense." }),

  co({ ticker:"MPWR", name:"Monolithic Power", sector:"Semis", bucket:"high", grade:"D",
    price:1295.18, change:1.76, mktCap:63.6, headlinePE:92.5, ownersKeep:0.66,
    gaapEPS:14.00, nonGaapEPS:18.26,
    fy:["2022","2023","2024","2025"], sbcPctRev:8.2, sbcPctOCF:27.1, sbcPctNI:37,
    revenue:[1.79,1.82,2.21,2.79], ni:[0.44,0.43,1.59,0.62], sbc:[0.161,0.15,0.206,0.227],
    buyback:[0,0,0.64,0.01], shares:[0.048,0.049,0.049,0.048],
    note:"SBC ~12% of revenue and rising share count. Premium multiple gets much worse on owner earnings." }),

  co({ ticker:"APP", name:"AppLovin", sector:"AdTech", bucket:"high", grade:"D",
    price:513.50, change:-2.74, mktCap:172.5, headlinePE:44.6, ownersKeep:0.64,
    gaapEPS:11.51, nonGaapEPS:17.89,
    fy:["2022","2023","2024","2025"], sbcPctRev:3.8, sbcPctOCF:5.3, sbcPctNI:6,
    revenue:[2.82,1.84,3.22,5.48], ni:[-0.19,0.36,1.58,3.33], sbc:[0.192,0.363,0.369,0.21],
    buyback:[0.34,1.15,0.98,2.19], shares:[0.372,0.363,0.348,0.342],
    note:"Explosive fundamentals but heavy SBC; recent real buybacks help. Verify durability before trusting the re-rate." }),

  co({ ticker:"ARM", name:"Arm Holdings", sector:"Semis/IP", bucket:"high", grade:"F",
    price:292.31, change:-2.70, mktCap:312.2, headlinePE:348.0, ownersKeep:0.55,
    gaapEPS:0.84, nonGaapEPS:1.45,
    fy:["2023","2024","2025","2026"], sbcPctRev:21.4, sbcPctOCF:69.0, sbcPctNI:116,
    revenue:[2.68,3.23,4.01,4.92], ni:[0.52,0.31,0.79,0.9], sbc:[0.079,1.037,0.82,1.052],
    buyback:[0,0,0,0], shares:[1.026,1.044,1.066,1.068],
    note:"SBC > 20% of revenue and larger than GAAP NI. No buybacks, rising shares. Non-GAAP flatters heavily." }),

  /* ================= TRAGIC TIER ================= */
  co({ ticker:"TSLA", name:"Tesla", sector:"Auto/AI", bucket:"tragic", grade:"D",
    price:394.06, change:-2.20, mktCap:1480.0, headlinePE:361.5, ownersKeep:0.72,
    gaapEPS:1.09, nonGaapEPS:1.29,
    fy:["2022","2023","2024","2025"], sbcPctRev:3.0, sbcPctOCF:19.2, sbcPctNI:74,
    revenue:[81.46,96.77,97.69,94.83], ni:[12.58,15,7.13,3.79], sbc:[1.56,1.812,1.999,2.825],
    buyback:[0,0,0,0], shares:[3.475,3.483,3.216,3.526],
    note:"Rising share count, no buybacks, and the 2018 CEO award is a giant historical dilution event. Owner earnings well below GAAP over the period." }),

  co({ ticker:"PLTR", name:"Palantir", sector:"Software/AI", bucket:"tragic", grade:"F",
    price:129.01, change:-3.99, mktCap:309.3, headlinePE:145.0, ownersKeep:0.45,
    gaapEPS:0.89, nonGaapEPS:1.51,
    fy:["2022","2023","2024","2025"], sbcPctRev:15.3, sbcPctOCF:32.0, sbcPctNI:42,
    revenue:[1.91,2.23,2.87,4.48], ni:[-0.37,0.21,0.46,1.63], sbc:[0.565,0.476,0.692,0.684],
    buyback:[0,0,0.06,0.07], shares:[2.061,2.295,2.447,2.565],
    note:"SBC ~18% of revenue, share count still climbing. Reported GAAP profit heavily dependent on SBC being ignored by the Street." }),

  co({ ticker:"CRWD", name:"CrowdStrike", sector:"Cybersecurity", bucket:"tragic", grade:"F",
    price:188.43, change:-3.18, mktCap:191.9, headlinePE:null, ownersKeep:0.40,
    gaapEPS:-0.04, nonGaapEPS:0.97,
    fy:["2023","2024","2025","2026"], sbcPctRev:22.8, sbcPctOCF:68.0, sbcPctNI:null,
    revenue:[2.24,3.06,3.95,4.81], ni:[-0.18,0.07,-0.02,-0.16], sbc:[0.527,0.649,0.861,1.097],
    buyback:[0,0,0,0], shares:[0.933,0.975,0.979,1.002],
    note:"Non-GAAP EPS ~7x GAAP. SBC ~23% of revenue, rising shares, zero buybacks. Definition of adjusted-EPS distortion." }),

  co({ ticker:"DDOG", name:"Datadog", sector:"Software", bucket:"tragic", grade:"F",
    price:255.53, change:-0.50, mktCap:91.0, headlinePE:655.2, ownersKeep:0.38,
    gaapEPS:0.39, nonGaapEPS:1.28,
    fy:["2022","2023","2024","2025"], sbcPctRev:21.9, sbcPctOCF:71.5, sbcPctNI:697,
    revenue:[1.68,2.13,2.68,3.43], ni:[-0.05,0.05,0.18,0.11], sbc:[0.363,0.482,0.57,0.751],
    buyback:[0,0,0,0], shares:[0.315,0.35,0.359,0.363],
    note:"SBC near a quarter of revenue; almost all reported profit reverses under owner-earnings math." }),

  co({ ticker:"SHOP", name:"Shopify", sector:"E-commerce", bucket:"tragic", grade:"D",
    price:116.47, change:-4.44, mktCap:151.1, headlinePE:114.2, ownersKeep:0.55,
    gaapEPS:1.02, nonGaapEPS:1.17,
    fy:["2022","2023","2024","2025"], sbcPctRev:3.9, sbcPctOCF:22.1, sbcPctNI:36,
    revenue:[5.6,7.06,8.88,11.56], ni:[-3.46,0.13,2.02,1.23], sbc:[0.549,0.615,0.43,0.449],
    buyback:[0,0,0,0], shares:[1.266,1.296,1.295,1.304],
    note:"Rising shares, no buybacks, GAAP whipsawed by investment marks. SBC a persistent ~10% of revenue leak." }),

  co({ ticker:"MRVL", name:"Marvell Technology", sector:"Semis", bucket:"tragic", grade:"F",
    price:227.35, change:-1.45, mktCap:198.9, headlinePE:78.1, ownersKeep:0.42,
    gaapEPS:2.91, nonGaapEPS:1.75,
    fy:["2023","2024","2025","2026"], sbcPctRev:7.2, sbcPctOCF:33.8, sbcPctNI:22,
    revenue:[5.92,5.51,5.77,8.19], ni:[-0.16,-0.93,-0.89,2.67], sbc:[0.552,0.61,0.597,0.591],
    buyback:[0.12,0.15,0.72,2.04], shares:[0.851,0.861,0.866,0.87],
    note:"GAAP still loss-making while non-GAAP prints profits — the gap is mostly SBC + acquisition amortization." }),

  co({ ticker:"ZS", name:"Zscaler", sector:"Cybersecurity", bucket:"tragic", grade:"F",
    price:143.78, change:-3.83, mktCap:23.3, headlinePE:null, ownersKeep:0.35,
    gaapEPS:-0.48, nonGaapEPS:3.20,
    fy:["2022","2023","2024","2025"], sbcPctRev:24.7, sbcPctOCF:68.0, sbcPctNI:null,
    revenue:[1.09,1.62,2.17,2.67], ni:[-0.39,-0.2,-0.06,-0.04], sbc:[0.41,0.445,0.528,0.661],
    buyback:[0,0,0,0], shares:[0.141,0.145,0.15,0.154],
    note:"Among the highest SBC intensity in the sample; near-zero GAAP profit propped by ignoring SBC." }),

  co({ ticker:"WDAY", name:"Workday", sector:"Software", bucket:"tragic", grade:"F",
    price:138.21, change:-3.79, mktCap:34.1, headlinePE:43.2, ownersKeep:0.40,
    gaapEPS:3.20, nonGaapEPS:20.07,
    fy:["2023","2024","2025","2026"], sbcPctRev:17.0, sbcPctOCF:55.3, sbcPctNI:235,
    revenue:[6.22,7.26,8.45,9.55], ni:[-0.37,1.38,0.53,0.69], sbc:[1.295,1.416,1.519,1.626],
    buyback:[0.07,0.42,0.7,2.9], shares:[0.255,0.265,0.269,0.268],
    note:"Non-GAAP EPS ~6x GAAP. SBC over a fifth of revenue; small buyback nowhere near offsetting dilution." }),

  co({ ticker:"AXON", name:"Axon Enterprise", sector:"Public Safety Tech", bucket:"tragic", grade:"D",
    price:598.89, change:-6.49, mktCap:48.3, headlinePE:239.6, ownersKeep:0.50,
    gaapEPS:2.50, nonGaapEPS:3.02,
    fy:["2022","2023","2024","2025"], sbcPctRev:22.8, sbcPctOCF:300.1, sbcPctNI:509,
    revenue:[1.19,1.56,2.08,2.78], ni:[0.15,0.18,0.38,0.12], sbc:[0.106,0.131,0.383,0.634],
    buyback:[0,0,0,0], shares:[0.073,0.075,0.079,0.082],
    note:"Great product story but heavy performance-share SBC and rising count. Owner earnings far below the headline." }),
];

/* ordering for the framework legend */
const BUCKETS = {
  clean:  { label:"Shareholder-Friendly", desc:"GAAP ≈ owner earnings", color:"var(--green)" },
  middle: { label:"Meaningful SBC Haircut", desc:"Adjust, not automatically fatal", color:"var(--amber)" },
  high:   { label:"High SBC Concern", desc:"Reported earnings likely overstated", color:"var(--orange)" },
  tragic: { label:"Tragic Tier", desc:"Owner earnings deeply impaired", color:"var(--red)" },
};

const GRADE_MEANING = {
  A:"Low SBC, real buybacks, shrinking share count",
  B:"Moderate SBC, transparent reporting",
  C:"High SBC, but growth may justify it",
  D:"Buyback treadmill, non-GAAP games",
  F:"Massive SBC, rising share count, fake adjusted earnings",
};

if (typeof window !== "undefined") { window.DATA = DATA; window.YEARS = YEARS; window.BUCKETS = BUCKETS; window.GRADE_MEANING = GRADE_MEANING; }
