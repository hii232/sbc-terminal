/* Extended 60 coverage layer.
   These tickers are searchable and live-quote enabled, but they are not part of
   the audited Core 60 SBC/SEC scoring universe until full filing data is added. */
const EXTENDED_VERSION = "1.0.0";
const EXTENDED_ASOF = "2026-07-15";
const EXTENDED_NOTE = "Extended live-only ticker. Not SBC ranked until SEC/SBC data is built.";
const EXTENDED_DATA = [
  { ticker: "JPM", name: "JPMorgan Chase", sector: "Banks", bucket: "extended", grade: "EXT", reason: "Bank credit, net-interest-income and capital-markets pulse" },
  { ticker: "BAC", name: "Bank of America", sector: "Banks", bucket: "extended", grade: "EXT", reason: "Large-bank credit and rate sensitivity" },
  { ticker: "WFC", name: "Wells Fargo", sector: "Banks", bucket: "extended", grade: "EXT", reason: "Consumer and commercial-credit cycle read-through" },
  { ticker: "C", name: "Citigroup", sector: "Banks", bucket: "extended", grade: "EXT", reason: "Global bank risk appetite and credit quality" },
  { ticker: "GS", name: "Goldman Sachs", sector: "Banks", bucket: "extended", grade: "EXT", reason: "Trading, investment-banking and capital-markets signal" },
  { ticker: "MS", name: "Morgan Stanley", sector: "Banks", bucket: "extended", grade: "EXT", reason: "Wealth management plus capital-markets signal" },
  { ticker: "BLK", name: "BlackRock", sector: "Asset Mgmt", bucket: "extended", grade: "EXT", reason: "Asset flows, ETF demand and market-risk appetite" },
  { ticker: "SCHW", name: "Charles Schwab", sector: "Asset Mgmt", bucket: "extended", grade: "EXT", reason: "Brokerage cash sweep and retail-investor activity" },
  { ticker: "AXP", name: "American Express", sector: "Payments", bucket: "extended", grade: "EXT", reason: "Affluent-consumer spend and credit quality" },
  { ticker: "COF", name: "Capital One", sector: "Payments", bucket: "extended", grade: "EXT", reason: "Consumer-credit loss cycle and card-spend pressure" },

  { ticker: "LLY", name: "Eli Lilly", sector: "Pharma", bucket: "extended", grade: "EXT", reason: "GLP-1 demand and large-cap healthcare leadership" },
  { ticker: "JNJ", name: "Johnson & Johnson", sector: "Pharma", bucket: "extended", grade: "EXT", reason: "Defensive healthcare and medical-products read-through" },
  { ticker: "UNH", name: "UnitedHealth", sector: "Managed Care", bucket: "extended", grade: "EXT", reason: "Managed-care margins and utilization pressure" },
  { ticker: "ABBV", name: "AbbVie", sector: "Pharma", bucket: "extended", grade: "EXT", reason: "Pharma cash-flow durability and patent-cycle risk" },
  { ticker: "MRK", name: "Merck", sector: "Pharma", bucket: "extended", grade: "EXT", reason: "Large-cap pharma valuation and pipeline sentiment" },
  { ticker: "PFE", name: "Pfizer", sector: "Pharma", bucket: "extended", grade: "EXT", reason: "Post-Covid reset and pharma value signal" },
  { ticker: "TMO", name: "Thermo Fisher", sector: "Life Sciences", bucket: "extended", grade: "EXT", reason: "Biopharma tools demand and funding cycle" },
  { ticker: "DHR", name: "Danaher", sector: "Life Sciences", bucket: "extended", grade: "EXT", reason: "Life-science tools and industrial-quality compounder signal" },
  { ticker: "ABT", name: "Abbott Laboratories", sector: "Medical Devices", bucket: "extended", grade: "EXT", reason: "Medical-device demand and defensive quality" },
  { ticker: "MDT", name: "Medtronic", sector: "Medical Devices", bucket: "extended", grade: "EXT", reason: "Device-cycle and healthcare value read-through" },

  { ticker: "WMT", name: "Walmart", sector: "Retail", bucket: "extended", grade: "EXT", reason: "Consumer health, food inflation and trade-down signal" },
  { ticker: "COST", name: "Costco", sector: "Retail", bucket: "extended", grade: "EXT", reason: "High-quality retail and membership demand" },
  { ticker: "HD", name: "Home Depot", sector: "Home Improvement", bucket: "extended", grade: "EXT", reason: "Housing, repair/remodel and big-ticket consumer demand" },
  { ticker: "LOW", name: "Lowe's", sector: "Home Improvement", bucket: "extended", grade: "EXT", reason: "Housing-cycle and home-improvement demand" },
  { ticker: "MCD", name: "McDonald's", sector: "Restaurants", bucket: "extended", grade: "EXT", reason: "Global consumer value-seeking and pricing power" },
  { ticker: "SBUX", name: "Starbucks", sector: "Restaurants", bucket: "extended", grade: "EXT", reason: "Consumer discretionary traffic and China read-through" },
  { ticker: "NKE", name: "Nike", sector: "Apparel", bucket: "extended", grade: "EXT", reason: "Apparel demand, brand pricing and inventory cycle" },
  { ticker: "DIS", name: "Disney", sector: "Media", bucket: "extended", grade: "EXT", reason: "Media, parks, streaming and consumer-spend signal" },
  { ticker: "CMG", name: "Chipotle", sector: "Restaurants", bucket: "extended", grade: "EXT", reason: "Restaurant traffic, margin and pricing-power benchmark" },
  { ticker: "TGT", name: "Target", sector: "Retail", bucket: "extended", grade: "EXT", reason: "Middle-income consumer and discretionary retail pressure" },

  { ticker: "CAT", name: "Caterpillar", sector: "Machinery", bucket: "extended", grade: "EXT", reason: "Cyclical machinery, capex and commodity-cycle barometer" },
  { ticker: "DE", name: "Deere", sector: "Machinery", bucket: "extended", grade: "EXT", reason: "Ag equipment, credit and cyclical-industrial demand" },
  { ticker: "GE", name: "GE Aerospace", sector: "Aerospace", bucket: "extended", grade: "EXT", reason: "Aerospace engines and industrial-quality leadership" },
  { ticker: "BA", name: "Boeing", sector: "Aerospace", bucket: "extended", grade: "EXT", reason: "Aerospace supply-chain and safety-cycle risk" },
  { ticker: "RTX", name: "RTX", sector: "Defense", bucket: "extended", grade: "EXT", reason: "Defense, aerospace aftermarket and geopolitical spend" },
  { ticker: "LMT", name: "Lockheed Martin", sector: "Defense", bucket: "extended", grade: "EXT", reason: "Defense-budget and geopolitical-risk signal" },
  { ticker: "HON", name: "Honeywell", sector: "Industrials", bucket: "extended", grade: "EXT", reason: "Industrial automation and cycle-quality benchmark" },
  { ticker: "ETN", name: "Eaton", sector: "Industrials", bucket: "extended", grade: "EXT", reason: "Electrification, grid capex and power-infrastructure demand" },
  { ticker: "GEV", name: "GE Vernova", sector: "Industrials", bucket: "extended", grade: "EXT", reason: "Power equipment, grid buildout and energy transition" },
  { ticker: "CEG", name: "Constellation Energy", sector: "Utilities", bucket: "extended", grade: "EXT", reason: "Nuclear power and AI data-center power narrative" },

  { ticker: "XOM", name: "Exxon Mobil", sector: "Energy", bucket: "extended", grade: "EXT", reason: "Oil major, energy inflation and cash-return signal" },
  { ticker: "CVX", name: "Chevron", sector: "Energy", bucket: "extended", grade: "EXT", reason: "Oil major, commodity cycle and capital discipline" },
  { ticker: "COP", name: "ConocoPhillips", sector: "Energy", bucket: "extended", grade: "EXT", reason: "Upstream oil cycle and free-cash-flow leverage" },
  { ticker: "SLB", name: "Schlumberger", sector: "Energy", bucket: "extended", grade: "EXT", reason: "Oilfield services and upstream capex cycle" },
  { ticker: "LNG", name: "Cheniere Energy", sector: "Energy", bucket: "extended", grade: "EXT", reason: "LNG export cycle and global gas demand" },
  { ticker: "EOG", name: "EOG Resources", sector: "Energy", bucket: "extended", grade: "EXT", reason: "Shale discipline and upstream-quality benchmark" },
  { ticker: "OXY", name: "Occidental Petroleum", sector: "Energy", bucket: "extended", grade: "EXT", reason: "Oil leverage, debt paydown and commodity beta" },
  { ticker: "MPC", name: "Marathon Petroleum", sector: "Energy", bucket: "extended", grade: "EXT", reason: "Refining margins and fuel-demand signal" },
  { ticker: "VLO", name: "Valero Energy", sector: "Energy", bucket: "extended", grade: "EXT", reason: "Refining crack spreads and energy-cycle read-through" },
  { ticker: "NEE", name: "NextEra Energy", sector: "Utilities", bucket: "extended", grade: "EXT", reason: "Utilities, renewables and rate-sensitive dividend proxy" },

  { ticker: "LIN", name: "Linde", sector: "Industrial Gas", bucket: "extended", grade: "EXT", reason: "Industrial gas quality and global industrial demand" },
  { ticker: "FCX", name: "Freeport-McMoRan", sector: "Materials", bucket: "extended", grade: "EXT", reason: "Copper, electrification and global-growth signal" },
  { ticker: "NUE", name: "Nucor", sector: "Materials", bucket: "extended", grade: "EXT", reason: "Steel demand, construction and industrial cycle" },
  { ticker: "SCCO", name: "Southern Copper", sector: "Materials", bucket: "extended", grade: "EXT", reason: "Copper-cycle and commodity-inflation signal" },
  { ticker: "VST", name: "Vistra", sector: "Utilities", bucket: "extended", grade: "EXT", reason: "Power prices, load growth and AI electricity demand" },
  { ticker: "NRG", name: "NRG Energy", sector: "Utilities", bucket: "extended", grade: "EXT", reason: "Merchant power and electricity-demand volatility" },
  { ticker: "SO", name: "Southern Company", sector: "Utilities", bucket: "extended", grade: "EXT", reason: "Regulated utility and rate sensitivity" },
  { ticker: "DUK", name: "Duke Energy", sector: "Utilities", bucket: "extended", grade: "EXT", reason: "Regulated utility, power demand and rate sensitivity" },
  { ticker: "UPS", name: "United Parcel Service", sector: "Industrials", bucket: "extended", grade: "EXT", reason: "Parcel volumes, logistics and economic-demand pulse" },
  { ticker: "FDX", name: "FedEx", sector: "Industrials", bucket: "extended", grade: "EXT", reason: "Global shipping volumes and industrial-demand signal" },
].map((d) => ({
  ...d,
  extended: true,
  note: EXTENDED_NOTE,
  price: null,
  change: 0,
  mktCap: 0,
}));

if (typeof window !== "undefined") {
  window.EXTENDED_VERSION = EXTENDED_VERSION;
  window.EXTENDED_ASOF = EXTENDED_ASOF;
  window.EXTENDED_DATA = EXTENDED_DATA;
}
