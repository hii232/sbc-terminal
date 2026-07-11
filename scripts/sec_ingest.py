"""SEC filing ingestion for the official stock universe.
Pulls XBRL companyfacts for every CIK; extracts core owner-earnings facts with
FULL provenance (form, filed date, accession number, tag, period); writes:
  data/raw/<T>/sec-facts-extract.json   (verbatim fact arrays, never edited)
  data/companies/<T>.json               (clean layer w/ per-value provenance)
  sec.js                                (compact bundle the app loads)
  data/audits/golden-company-audit.json (12-name SEC-vs-terminal comparison)
    python scripts/sec_ingest.py
"""
import json, re, sys, time, urllib.request
from pathlib import Path
from datetime import date, datetime

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "SBC-Terminal research hamza@nouman.ca"}

# tag -> (our key, preferred us-gaap tags in priority order, unit)
FIELDS = {
    "revenue":   (["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues",
                   "RevenueFromContractWithCustomerIncludingAssessedTax",
                   "SalesRevenueNet"], "USD"),
    "netIncome": (["NetIncomeLoss"], "USD"),
    "ocf":       (["NetCashProvidedByUsedInOperatingActivities",
                   "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"], "USD"),
    "capex":     (["PaymentsToAcquirePropertyPlantAndEquipment",
                   "PaymentsToAcquireProductiveAssets",
                   "PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets"], "USD"),
    "sbc":       (["ShareBasedCompensation",
                   "AllocatedShareBasedCompensationExpense"], "USD"),
    "buyback":   (["PaymentsForRepurchaseOfCommonStock"], "USD"),
    "dilShares": (["WeightedAverageNumberOfDilutedSharesOutstanding"], "shares"),
    "taxWithholding": (["PaymentsRelatedToTaxWithholdingForShareBasedCompensation",
                        "PaymentsForTaxesRelatedToNetShareSettlementOfEquityAwards"], "USD"),
    "esppProceeds": (["ProceedsFromIssuanceOfSharesUnderIncentiveAndShareBasedCompensationPlansIncludingStockOptions",
                      "ProceedsFromStockPlans", "ProceedsFromIssuanceOfCommonStock"], "USD"),
}
ANNUAL_FORMS = {"10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"}

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode()

def annual_facts(units_list):
    """Pick one fact per fiscal year: annual duration (330-400d), annual form,
    newest filing wins (amendments/restatements replace, older kept in history)."""
    by_year = {}
    for f in units_list:
        form = f.get("form", "")
        if form not in ANNUAL_FORMS:
            continue
        start, end = f.get("start"), f.get("end")
        if start and end:
            try:
                days = (datetime.fromisoformat(end) - datetime.fromisoformat(start)).days
                if not (330 <= days <= 400):   # excludes quarterly + cumulative facts
                    continue
            except ValueError:
                continue
        elif not end:
            continue
        fy = f.get("fy") or int(end[:4])
        key = end[:7]  # period-end month key beats fy label mismatches
        prev = by_year.get(key)
        if prev is None or (f.get("filed", "") > prev.get("filed", "")):
            if prev is not None:
                f = dict(f); f["supersedes"] = {"value": prev["val"], "filed": prev.get("filed"), "accn": prev.get("accn")}
            by_year[key] = f
    out = sorted(by_year.values(), key=lambda x: x["end"])
    return out[-10:]  # last 10 fiscal years

def extract(tk, cik10):
    raw = json.loads(get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik10}.json"))
    gaap = raw.get("facts", {}).get("us-gaap", {})
    dei = raw.get("facts", {}).get("dei", {})
    company = {"ticker": tk, "cik": cik10, "entityName": raw.get("entityName"),
               "retrievedAt": datetime.utcnow().isoformat() + "Z", "fields": {}}
    raw_extract = {}
    latest = {"filed": "", "form": "", "accn": ""}
    for key, (tags, unit) in FIELDS.items():
        # MERGE annual facts across ALL candidate tags: companies switch XBRL
        # tags over time (first-tag-wins truncated NVDA history at FY2022).
        # Per period, the higher-priority tag wins; periods union across tags.
        by_period = {}
        for pri, tag in enumerate(tags):
            node = gaap.get(tag)
            if not node:
                continue
            units = node.get("units", {})
            arr = units.get(unit) or units.get("USD") or units.get("shares") or []
            ann = annual_facts(arr)
            if ann:
                raw_extract[tag] = arr  # verbatim
            for f in ann:
                k = f["end"][:7]
                prev = by_period.get(k)
                if prev is None or pri < prev[0]:
                    by_period[k] = (pri, tag, f)
        got = None; used_tag = None
        if by_period:
            merged = sorted(by_period.values(), key=lambda x: x[2]["end"])[-10:]
            got = [dict(f, _tag=tag) for (pri, tag, f) in merged]
            used_tag = "multi" if len({t for (_, t, _) in merged}) > 1 else merged[0][1]
        if got:
            vals = []
            for f in got:
                vals.append({
                    "value": f["val"], "unit": unit, "periodStart": f.get("start"),
                    "periodEnd": f["end"], "fiscalYear": f.get("fy"),
                    "fiscalPeriod": f.get("fp"), "form": f.get("form"),
                    "filedDate": f.get("filed"), "accessionNumber": f.get("accn"),
                    "xbrlTag": f.get("_tag", used_tag), "sourceType": "SEC",
                    "sourceStatus": "reported",
                    "restated": "supersedes" in f,
                    "supersedes": f.get("supersedes"),
                    "confidence": 100,
                })
                if f.get("filed", "") > latest["filed"]:
                    latest = {"filed": f.get("filed"), "form": f.get("form"), "accn": f.get("accn")}
            company["fields"][key] = vals
        else:
            company["fields"][key] = {"sourceStatus": "missing",
                                      "note": "no annual fact found under known tags — missing, NOT zero"}
    # period-end shares from dei (point-in-time; newest per year)
    ecso = dei.get("EntityCommonStockSharesOutstanding", {}).get("units", {}).get("shares", [])
    if ecso:
        by_y = {}
        for f in ecso:
            y = (f.get("end") or "")[:4]
            if y and (y not in by_y or f.get("filed", "") > by_y[y].get("filed", "")):
                by_y[y] = f
        company["fields"]["periodEndShares"] = [
            {"value": f["val"], "unit": "shares", "periodEnd": f.get("end"),
             "form": f.get("form"), "filedDate": f.get("filed"),
             "accessionNumber": f.get("accn"), "xbrlTag": "dei:EntityCommonStockSharesOutstanding",
             "sourceType": "SEC", "sourceStatus": "reported", "confidence": 100}
            for f in sorted(by_y.values(), key=lambda x: x["end"])[-10:]]
    company["latestFiling"] = latest
    return company, raw_extract

uni = json.loads((ROOT / "data" / "universe.json").read_text(encoding="utf-8"))
(ROOT / "data" / "companies").mkdir(parents=True, exist_ok=True)
(ROOT / "data" / "audits").mkdir(parents=True, exist_ok=True)
(ROOT / "data" / "errors").mkdir(parents=True, exist_ok=True)

bundle, errors = {}, {}
for i, c in enumerate(uni["companies"]):
    tk = c["ticker"]
    try:
        comp, raw_extract = extract(tk, c["cik10"])
        rawdir = ROOT / "data" / "raw" / tk
        rawdir.mkdir(parents=True, exist_ok=True)
        (rawdir / "sec-facts-extract.json").write_text(json.dumps(raw_extract), encoding="utf-8")
        (ROOT / "data" / "companies" / f"{tk}.json").write_text(json.dumps(comp, indent=1), encoding="utf-8")
        # compact for app: latest FY value + provenance per field + 10y series
        fields = {}
        for k, v in comp["fields"].items():
            if isinstance(v, list) and v:
                last = v[-1]
                fields[k] = {"v": last["value"], "end": last["periodEnd"],
                             "form": last["form"], "filed": last["filedDate"],
                             "accn": last["accessionNumber"], "tag": last["xbrlTag"],
                             "hist": [[x["periodEnd"][:4], x["value"]] for x in v]}
            else:
                fields[k] = None  # missing, NOT zero
        bundle[tk] = {"cik": c["cik10"], "latest": comp["latestFiling"], "f": fields}
        print(f"  {tk}: ok ({sum(1 for x in fields.values() if x)} fields)", flush=True)
    except Exception as e:
        errors[tk] = str(e)
        print(f"  {tk}: FAILED {e}", flush=True)
    time.sleep(0.15)

meta = {"generated": datetime.utcnow().isoformat() + "Z",
        "universeVersion": uni["universeVersion"], "source": "SEC XBRL companyfacts",
        "companies": len(bundle), "errors": errors}
js = ("/* SEC FILING FACTS — primary source layer. Generated by scripts/sec_ingest.py.\n"
      "   Every value carries form / filed date / accession number / XBRL tag.\n"
      "   Missing fields are null — missing is NOT zero. */\n"
      "const SEC_META = " + json.dumps(meta) + ";\n"
      "const SEC = " + json.dumps(bundle) + ";\n"
      'if (typeof window !== "undefined") { window.SEC = SEC; window.SEC_META = SEC_META; }\n')
(ROOT / "sec.js").write_text(js, encoding="utf-8")
if errors:
    (ROOT / "data" / "errors" / "sec-ingest-errors.json").write_text(json.dumps(errors, indent=1), encoding="utf-8")
print(f"\nWROTE sec.js — {len(bundle)}/{len(uni['companies'])} companies, {len(errors)} errors", flush=True)
