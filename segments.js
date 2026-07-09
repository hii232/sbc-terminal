/* =========================================================================
   SBC TERMINAL — REVENUE BY SEGMENT ("where the money comes from")
   Real reported segment / product / geographic revenue from the latest
   10-K filings, $B. Curated for the marquee names people drill into; stocks
   without an entry simply don't show the segment card.
   basis: how the company reports — "segment" | "product" | "region" | "division"
   ========================================================================= */
const SEGMENTS = {
  // ---------- BIG TECH ----------
  META: { fy: "FY2024", basis: "segment", segs: [
    ["Advertising", 160.6], ["Family of Apps — other", 1.6], ["Reality Labs — Quest, Ray-Ban smart glasses", 2.1]],
    note: "Advertising is ~97% of revenue. Reality Labs (VR headsets + smart glasses) is tiny and loses ~$17B/yr — a bet on the future, not a business yet." },
  AAPL: { fy: "FY2024", basis: "product", segs: [
    ["iPhone", 201.2], ["Services", 96.2], ["Wearables, Home & Accessories", 37.0], ["Mac", 30.0], ["iPad", 26.7]],
    note: "iPhone is still ~half of revenue; Services (App Store, iCloud, ads, AppleCare) is the fastest-growing and highest-margin engine." },
  MSFT: { fy: "FY2024", basis: "segment", segs: [
    ["Intelligent Cloud — Azure, servers", 105.4], ["Productivity & Business Processes — Office, LinkedIn", 77.7], ["More Personal Computing — Windows, Xbox, Search", 62.0]],
    note: "Azure-led Intelligent Cloud is the growth core; gaming scaled up via the Activision acquisition." },
  GOOGL: { fy: "FY2024", basis: "segment", segs: [
    ["Google Search", 198.1], ["Google Cloud", 43.2], ["Subscriptions, Platforms & Devices", 40.3], ["YouTube ads", 36.1], ["Google Network", 30.4], ["Other Bets", 1.6]],
    note: "Search is still ~56% of revenue; ads in total (Search + YouTube + Network) are ~75%. Cloud is the growth + margin story." },
  AMZN: { fy: "FY2024", basis: "segment", segs: [
    ["Online stores", 247], ["Third-party seller services", 156], ["AWS", 108], ["Advertising", 56], ["Subscriptions — Prime", 44], ["Physical stores", 21]],
    note: "AWS is ~17% of revenue but the large majority of operating profit. Advertising is now a $56B+ high-margin business hiding in a retailer." },
  NFLX: { fy: "FY2024", basis: "region", segs: [
    ["US & Canada (UCAN)", 17.4], ["EMEA", 12.0], ["Latin America", 4.8], ["Asia-Pacific", 4.4]],
    note: "Reported by region. The ad-supported tier and the paid-sharing crackdown are the new growth engines on top of subscriptions." },
  DIS: { fy: "FY2024", basis: "segment", segs: [
    ["Entertainment — Disney+, studios, linear", 41.2], ["Experiences — Parks & cruises", 34.2], ["Sports — ESPN", 17.3]],
    note: "Experiences (Parks) is the profit engine; streaming just turned profitable; ESPN is going direct-to-consumer." },
  UBER: { fy: "FY2024", basis: "segment", segs: [
    ["Mobility — rides", 25.0], ["Delivery — Eats", 13.8], ["Freight", 5.2]],
    note: "Mobility is the profit core; Delivery scaled to profitability; advertising is a fast-growing high-margin layer on both." },
  SHOP: { fy: "FY2024", basis: "segment", segs: [
    ["Merchant Solutions — payments, capital, shipping", 6.3], ["Subscription Solutions", 2.6]],
    note: "Merchant Solutions scales with GMV; take-rate expansion (Payments, Capital, Tax) is the story, not subscription seats." },
  PLTR: { fy: "FY2024", basis: "segment", segs: [
    ["Government — defense & intel", 1.57], ["Commercial", 1.30]],
    note: "Government was the base; US Commercial (AIP / Foundry) is now the hyper-growth driver and the whole bull thesis." },
  ORCL: { fy: "FY2024", basis: "segment", segs: [
    ["Cloud services & license support", 39.4], ["Services", 5.4], ["Cloud license & on-premise", 5.1], ["Hardware", 3.0]],
    note: "Shift to cloud (OCI infrastructure + Fusion/NetSuite SaaS); OCI AI-training demand is the new growth driver." },
  CRM: { fy: "FY2024", basis: "segment", segs: [
    ["Subscription & support", 32.5], ["Professional services", 2.3]],
    note: "Nearly all recurring subscription; Data Cloud + Agentforce (AI agents) are the newest monetization levers." },
  ADBE: { fy: "FY2024", basis: "segment", segs: [
    ["Digital Media — Creative + Document Cloud", 15.9], ["Digital Experience", 5.4], ["Publishing & Advertising", 0.3]],
    note: "Creative Cloud is the moat; Firefly AI monetization and Document Cloud (Acrobat/Sign) are the growth levers." },
  IBM: { fy: "FY2024", basis: "segment", segs: [
    ["Software — Red Hat, watsonx", 26.3], ["Consulting", 20.7], ["Infrastructure — mainframe", 13.1], ["Financing", 0.7]],
    note: "Pivoted to software + consulting; Infrastructure (Z mainframe) is cyclical with hardware refresh cycles." },
  ACN: { fy: "FY2024", basis: "segment", segs: [
    ["Managed Services", 34], ["Consulting", 30]],
    note: "Split roughly half consulting / half managed services; GenAI bookings are the new growth narrative." },

  // ---------- SEMIS ----------
  NVDA: { fy: "FY2025", basis: "segment", segs: [
    ["Data Center — AI GPUs", 115.2], ["Gaming", 11.4], ["Professional Visualization", 1.9], ["Automotive & Robotics", 1.7], ["OEM & Other", 0.4]],
    note: "Data Center is ~88% of revenue — the entire thesis is AI accelerators. Gaming, once the core business, is now a rounding error." },
  AMD: { fy: "FY2024", basis: "segment", segs: [
    ["Data Center — EPYC, Instinct AI", 12.6], ["Client — PC CPUs", 7.1], ["Embedded — Xilinx", 3.6], ["Gaming", 2.6]],
    note: "Data Center (server CPUs + Instinct AI GPUs) overtook Client as the biggest and fastest-growing segment." },
  AVGO: { fy: "FY2024", basis: "segment", segs: [
    ["Semiconductor solutions", 30.1], ["Infrastructure software", 21.5]],
    note: "The VMware acquisition roughly doubled software; AI networking + custom accelerators (XPUs) drive the semi side." },
  QCOM: { fy: "FY2024", basis: "segment", segs: [
    ["Chips — QCT (handsets, auto, IoT)", 33.2], ["Licensing — QTL", 5.6], ["Strategic Initiatives — QSI", 0.1]],
    note: "QCT chips are the bulk; QTL licensing is small but extremely high margin. Auto & IoT are the diversification-away-from-Apple story." },
  INTC: { fy: "FY2024", basis: "segment", segs: [
    ["Client Computing — PC", 30.3], ["Data Center & AI", 12.8], ["Network & Edge", 5.8], ["Mobileye", 1.6], ["Altera — FPGA", 1.5]],
    note: "Still PC-dependent while trying to stand up a foundry business; Data Center share was lost to AMD and NVDA." },
  MU: { fy: "FY2024", basis: "segment", segs: [
    ["Compute & Networking", 11.7], ["Mobile", 6.5], ["Storage", 4.0], ["Embedded", 3.6]],
    note: "AI/HBM memory demand now shows up in Compute & Networking; deeply cyclical DRAM/NAND pricing drives everything." },
  TXN: { fy: "FY2024", basis: "segment", segs: [
    ["Analog", 12.5], ["Embedded Processing", 2.5], ["Other", 1.5]],
    note: "Analog is the crown jewel — tens of thousands of long-life catalog parts, mostly industrial & automotive end markets." },

  // ---------- AUTO / ENERGY ----------
  TSLA: { fy: "FY2024", basis: "segment", segs: [
    ["Automotive", 77.1], ["Services & other", 10.5], ["Energy generation & storage", 10.1]],
    note: "Still overwhelmingly a car company; Energy (Powerwall / Megapack) is the fastest-growing piece and the margin bright spot." },

  // ---------- PHARMA (by drug — where the money really comes from) ----------
  LLY: { fy: "FY2024", basis: "product", segs: [
    ["Mounjaro — diabetes", 11.5], ["Trulicity", 5.3], ["Verzenio — oncology", 5.3], ["Zepbound — obesity", 4.9], ["Jardiance", 3.9], ["Taltz", 3.4], ["Other products", 10]],
    note: "The incretin franchise (Mounjaro + Zepbound, both tirzepatide) is now the growth engine and >35% of revenue. Concentration is the risk & the reward." },
  MRK: { fy: "FY2024", basis: "product", segs: [
    ["Keytruda — oncology", 29.5], ["Gardasil — HPV vaccine", 8.6], ["Animal Health", 5.9], ["Other vaccines", 6], ["Other products", 14]],
    note: "Keytruda is ~46% of pharma revenue and faces a 2028 patent cliff — that single-drug concentration is the whole bear case." },
  ABBV: { fy: "FY2024", basis: "product", segs: [
    ["Skyrizi", 11.7], ["Humira", 9.0], ["Rinvoq", 5.9], ["Botox — aesthetic + therapeutic", 5.5], ["Other products", 22]],
    note: "Skyrizi + Rinvoq successfully replaced the Humira patent-cliff revenue — the immunology handoff is the reason the stock works." },
  PFE: { fy: "FY2024", basis: "product", segs: [
    ["Eliquis", 7.4], ["Prevnar family", 6.3], ["Paxlovid — COVID", 5.7], ["Vyndaqel family", 5.5], ["Comirnaty — COVID", 5.4], ["Oncology (Ibrance etc.)", 12], ["Other", 20]],
    note: "Post-COVID cliff normalized; the Seagen oncology acquisition and cardiovascular/vaccine franchises are the go-forward base." },
  JNJ: { fy: "FY2024", basis: "segment", segs: [
    ["Innovative Medicine — pharma", 57], ["MedTech — devices", 31]],
    note: "Split between branded pharma and medical devices after spinning off the consumer business (Kenvue)." },

  // ---------- FINANCIALS (by division) ----------
  JPM: { fy: "FY2024", basis: "division", segs: [
    ["Consumer & Community Banking", 70], ["Corporate & Investment Bank", 49], ["Asset & Wealth Management", 21], ["Commercial Banking", 15]],
    note: "Diversified 'fortress' model; CIB (trading + banking) swings with markets while CCB is the deposit/lending base. Managed net revenue." },
  BAC: { fy: "FY2024", basis: "division", segs: [
    ["Consumer Banking", 40], ["Global Wealth & Investment Mgmt", 22], ["Global Banking", 22], ["Global Markets", 19]],
    note: "Deposit-funded consumer base plus Merrill wealth management; most rate-sensitive of the big banks." },
  V: { fy: "FY2024", basis: "segment", segs: [
    ["Data processing", 18.8], ["Service", 16.1], ["International transactions", 12.7], ["Other", 3.0]],
    note: "Fees on payment volume & cross-border; ~$13B of 'client incentives' are netted against these gross revenues." },
  MA: { fy: "FY2024", basis: "segment", segs: [
    ["Payment network", 15.9], ["Value-added services & solutions", 12.0]],
    note: "Core network scales with switched volume; value-added services (cyber, data, consulting) is the faster grower." },

  // ---------- CONSUMER ----------
  WMT: { fy: "FY2024", basis: "segment", segs: [
    ["Walmart US", 441], ["Walmart International", 115], ["Sam's Club", 86]],
    note: "Walmart US is the core; e-commerce, advertising (Walmart Connect) and membership are the margin-mix improvers." },
  COST: { fy: "FY2024", basis: "region", segs: [
    ["United States", 199], ["Canada", 28], ["Other International", 27], ["Membership fees", 4.8]],
    note: "Razor-thin merchandise margins — the profit is essentially the high-margin, recurring membership fee stream." },
  MCD: { fy: "FY2024", basis: "segment", segs: [
    ["International Operated Markets", 12.5], ["US", 10.3], ["International Developmental Licensed", 3.0]],
    note: "Heavily franchised — high-margin rent & royalty streams rather than company restaurant sales." },
  SBUX: { fy: "FY2024", basis: "segment", segs: [
    ["North America", 26.7], ["International", 7.9], ["Channel Development", 1.8]],
    note: "US comps drive the model; China is the swing factor within International." },
  NKE: { fy: "FY2024", basis: "region", segs: [
    ["North America", 21.4], ["EMEA", 13.6], ["Greater China", 7.5], ["Asia-Pacific & Latin America", 6.7], ["Converse", 2.1]],
    note: "Greater China is the margin swing factor; the DTC-vs-wholesale mix is the ongoing strategic story." },
  PG: { fy: "FY2024", basis: "segment", segs: [
    ["Fabric & Home Care", 29], ["Baby, Feminine & Family Care", 20], ["Beauty", 15], ["Health Care", 12], ["Grooming", 7]],
    note: "Staples breadth with pricing power across Tide, Pampers, Olay, Gillette." },
  KO: { fy: "FY2024", basis: "region", segs: [
    ["North America", 18], ["Bottling Investments", 8], ["EMEA", 8], ["Asia-Pacific", 5], ["Latin America", 5], ["Global Ventures", 3]],
    note: "An asset-light concentrate model; most bottling is franchised out, leaving high-margin syrup sales." },
  PEP: { fy: "FY2024", basis: "segment", segs: [
    ["PepsiCo Beverages NA", 27.8], ["Frito-Lay NA", 24.9], ["International (beverages + snacks)", 35], ["Quaker Foods NA", 3.1]],
    note: "Snacks (Frito-Lay) are the profit engine — higher margin and more defensible than the beverage business." },

  // ---------- INDUSTRIALS ----------
  BA: { fy: "FY2024", basis: "segment", segs: [
    ["Defense, Space & Security", 23.9], ["Commercial Airplanes", 22.9], ["Global Services", 19.9]],
    note: "Commercial (737/787) is the recovery story; Defense has struggled with fixed-price contract losses; Services is the steady cash generator." },
  CAT: { fy: "FY2024", basis: "segment", segs: [
    ["Energy & Transportation", 28.9], ["Construction Industries", 25.9], ["Resource Industries", 12.0]],
    note: "Late-cycle industrial; Energy & Transportation (engines, power gen, incl. data-center backup) is the newest growth angle." },
};
if (typeof window !== "undefined") window.SEGMENTS = SEGMENTS;
