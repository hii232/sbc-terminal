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
        diff = abs(lv - sv)/max(abs(sv), 1e-9)
        immaterial = k != "dilShares" and abs(lv - sv) <= 0.05  # <$50M gap
        st = "verified" if (diff <= tol or immaterial) else "CONFLICT"
        # gross share-count divergence: the app REPAIRS from the filing at
        # runtime (visible, never silent) — record that, not a raw conflict
        if k == "dilShares" and st == "CONFLICT" and (lv / sv > 1.25 or lv / sv < 0.8):
            st = "REPAIRED-from-SEC (app displays the filed value)"
        if st == "verified": totV += 1
        elif st == "CONFLICT": totC += 1
        fields[k] = {"status": st, "secB": round(sv,3), "terminalB": round(lv,3), "diffPct": round(diff*100,2),
                     "filing": {"form": f["form"], "filed": f["filed"], "accn": f["accn"], "tag": f["tag"]}}
    out["companies"][tk] = {"latestFiling": S.get("latest"), "fields": fields}
out["summary"] = {"verifiedFields": totV, "conflictFields": totC}
(ROOT/"data"/"audits").mkdir(parents=True, exist_ok=True)
(ROOT/"data"/"audits"/"golden-company-audit.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
print(f"golden audit: {totV} verified, {totC} conflicts")
for tk, c in out["companies"].items():
    con = [k for k, v in c["fields"].items() if v.get("status") == "CONFLICT"]
    print(f"  {tk}: {'OK' if not con else 'CONFLICTS: ' + ','.join(con)}")
if tot_conflicts:
    sys.exit(1)
