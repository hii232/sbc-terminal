"""Golden 12-company SEC audit gate.

Writes data/audits/golden-company-audit.json.
Fails only on unresolved comparable source conflicts; SEC-only fields remain
reported evidence, not zero-filled terminal values.
"""
import json
import re
import sys
from pathlib import Path
from datetime import date

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = ["AAPL", "MSFT", "GOOGL", "META", "NVDA", "PLTR", "CRM", "CRWD", "SNOW", "UBER", "COIN", "CRWV"]
MODEL_VERSION = "4.0.0"

CORE_FIELDS = {
    "revenue": ("revenue", 0.02, "Revenue"),
    "netIncome": ("ni", 0.02, "Net income"),
    "sbc": ("sbc", 0.03, "Stock-based compensation"),
    "buyback": ("buyback", 0.05, "Share repurchases"),
    "dilShares": ("shares", 0.01, "Diluted weighted-average shares"),
}
SUPPLEMENTAL_FIELDS = {
    "ocf": ("ocf", 0.03, "Operating cash flow"),
    "capex": ("capex", 0.05, "Capital expenditures"),
}
SEC_ONLY_FIELDS = {
    "periodEndShares": "Period-end shares outstanding",
    "taxWithholding": "Employee tax withholding",
}


def load_js_const(path, name):
    text = path.read_text(encoding="utf-8")
    m = re.search(rf"const {name} = (.*?);\n", text, re.S)
    if not m:
        raise RuntimeError(f"could not locate {name} in {path}")
    return json.loads(m.group(1))


def company_block(src, tk):
    return re.search(r'ticker:"' + re.escape(tk) + r'".*?note:', src, re.S).group(0)


def arr_from(block, key):
    mm = re.search(re.escape(key) + r":\[([^\]]*)\]", block)
    if not mm:
        return None
    vals = []
    for raw in mm.group(1).split(","):
        x = raw.strip()
        if not x:
            continue
        if x == "null":
            vals.append(None)
            continue
        vals.append(float(x))
    return vals if vals else []


def nested_arr_from(block, obj, key):
    mm = re.search(re.escape(obj) + r":\{(.*?)\}", block, re.S)
    return arr_from(mm.group(1), key) if mm else None


def latest_four_quarters(block):
    mm = re.search(r"qd:\{(.*?)\},\s*gd:", block, re.S)
    if not mm:
        return {"status": "missing"}
    qd = mm.group(1)
    labels = re.search(r"labels:\[([^\]]*)\]", qd)
    labels = [x.strip().strip('"') for x in labels.group(1).split(",")] if labels else []
    return {
        "status": "terminal-snapshot",
        "labels": labels[-4:],
        "fieldCount": sum(1 for k in ["revenue", "ni", "sbc", "buyback", "shares"] if re.search(k + r":\[", qd)),
        "note": "latest four-quarter terminal snapshot; SEC quarter matching is not used for the deployment gate yet",
    }


def local_values(src, tk):
    block = company_block(src, tk)
    fy = [x.strip().strip('"') for x in re.search(r"fy:\[([^\]]*)\]", block).group(1).split(",")]
    vals = {
        "fy": fy,
        "revenue": arr_from(block, "revenue"),
        "netIncome": arr_from(block, "ni"),
        "sbc": arr_from(block, "sbc"),
        "buyback": arr_from(block, "buyback"),
        "dilShares": arr_from(block, "shares"),
        "ocf": nested_arr_from(block, "qm", "ocf"),
        "capex": nested_arr_from(block, "qm", "capex"),
        "latestFourQuarters": latest_four_quarters(block),
    }
    return vals


def evidence(f):
    return {
        "form": f.get("form"),
        "filed": f.get("filed"),
        "accn": f.get("accn"),
        "tag": f.get("tag"),
        "periodStart": f.get("periodStart"),
        "periodEnd": f.get("periodEnd") or f.get("end"),
        "fiscalYear": f.get("fiscalYear"),
        "fiscalPeriod": f.get("fiscalPeriod"),
        "unit": f.get("unit"),
        "restated": bool(f.get("restated")),
        "supersedes": f.get("supersedes"),
    }


def matched_pair(S, L, key):
    f = (S.get("f") or {}).get(key)
    hist = (f or {}).get("hist") or []
    series = L.get(key) or []
    years = L.get("fy") or []
    for i in range(min(len(series), len(years)) - 1, -1, -1):
        lv = series[i]
        if lv is None:
            continue
        yr = str(years[i])
        candidates = [h for h in hist if str(h.get("periodEnd", ""))[:4] == yr]
        if not candidates:
            candidates = [h for h in hist if str(h.get("fiscalYear")) == yr]
        if candidates:
            h = sorted(candidates, key=lambda x: x.get("filed", ""))[-1]
            return h.get("value"), lv, h
    return None, None, f


def compare_field(S, L, key, local_key, tol, label, severity):
    raw_sv, lv, f = matched_pair(S, L, key)
    sv = raw_sv / 1e9 if raw_sv is not None else None
    if sv is None or lv is None:
        return {
            "label": label,
            "severity": severity,
            "status": "not-comparable",
            "secB": None if sv is None else round(sv, 3),
            "terminalB": lv,
            "evidence": evidence(f) if f else None,
        }, False, False
    diff = abs(lv - sv) / max(abs(sv), 1e-9)
    status = "verified" if diff <= tol else "CONFLICT"
    return {
        "label": label,
        "severity": severity,
        "status": status,
        "secB": round(sv, 3),
        "terminalB": round(lv, 3),
        "diffPct": round(diff * 100, 2),
        "evidence": evidence(f),
    }, status == "verified", status == "CONFLICT"


def sec_only_field(S, key, label):
    f = (S.get("f") or {}).get(key)
    if not f:
        return {"label": label, "severity": "evidence", "status": "missing", "evidence": None}
    scaled = f["v"] / 1e9
    return {
        "label": label,
        "severity": "evidence",
        "status": "reported-sec-only",
        "secB": round(scaled, 3),
        "evidence": evidence(f),
    }


sec = load_js_const(ROOT / "sec.js", "SEC")
src = (ROOT / "data.js").read_text(encoding="utf-8")

out = {
    "asOf": date.today().isoformat(),
    "modelVersion": MODEL_VERSION,
    "method": "expanded SEC-XBRL vs terminal reconciliation",
    "reviewer": "automated SEC audit gate",
    "companies": {},
}
tot_verified = 0
tot_conflicts = 0
tot_core_conflicts = 0

for tk in GOLDEN:
    S, L = sec.get(tk, {}), local_values(src, tk)
    fields = {}
    for key, (local_key, tol, label) in CORE_FIELDS.items():
        row, verified, conflict = compare_field(S, L, key, local_key, tol, label, "core")
        fields[key] = row
        tot_verified += int(verified)
        tot_conflicts += int(conflict)
        tot_core_conflicts += int(conflict)
    for key, (local_key, tol, label) in SUPPLEMENTAL_FIELDS.items():
        row, verified, conflict = compare_field(S, L, key, local_key, tol, label, "supplemental")
        fields[key] = row
        tot_verified += int(verified)
        tot_conflicts += int(conflict)
    for key, label in SEC_ONLY_FIELDS.items():
        fields[key] = sec_only_field(S, key, label)

    latest = S.get("latest")
    annual_report = {
        "status": "reported" if latest and latest.get("accn") else "missing",
        "form": latest.get("form") if latest else None,
        "filed": latest.get("filed") if latest else None,
        "accn": latest.get("accn") if latest else None,
    }
    latest_quarters = L.get("latestFourQuarters")
    conflicts = [k for k, v in fields.items() if v.get("status") == "CONFLICT"]
    out["companies"][tk] = {
        "reviewer": "automated SEC audit gate",
        "reviewDate": date.today().isoformat(),
        "pass": not conflicts,
        "latestAnnualReport": annual_report,
        "latestFourQuarters": latest_quarters,
        "fields": fields,
        "notes": "SEC-only fields are evidence rows and are not converted to terminal zeros.",
    }

out["summary"] = {
    "verifiedFields": tot_verified,
    "conflictFields": tot_conflicts,
    "coreConflictFields": tot_core_conflicts,
    "pass": tot_conflicts == 0,
}

(ROOT / "data" / "audits").mkdir(parents=True, exist_ok=True)
(ROOT / "data" / "audits" / "golden-company-audit.json").write_text(json.dumps(out, indent=1), encoding="utf-8")

print(f"golden audit: {tot_verified} verified, {tot_conflicts} conflicts")
for tk, c in out["companies"].items():
    con = [k for k, v in c["fields"].items() if v.get("status") == "CONFLICT"]
    print(f"  {tk}: {'OK' if not con else 'CONFLICTS: ' + ','.join(con)}")
if tot_conflicts:
    sys.exit(1)
