"""Golden 12-company audit: SEC filing facts vs terminal aggregator values.
Writes data/audits/golden-company-audit.json.  python scripts/golden_audit.py"""
import json, re, io
from pathlib import Path
from datetime import date
ROOT = Path(__file__).resolve().parent.parent
GOLDEN = ["AAPL","MSFT","GOOGL","META","NVDA","PLTR","CRM","CRWD","SNOW","UBER","COIN","CRWV"]
sec = json.loads(re.search(r"const SEC = (\{.*?\});\n", (ROOT/"sec.js").read_text(encoding="utf-8"), re.S).group(1))
src = (ROOT/"data.js").read_text(encoding="utf-8")
def local(tk):
    m = re.search(r'ticker:"'+tk+r'".*?note:', src, re.S).group(0)
    def arr(k):
        mm = re.search(k+r':\[([^\]]*)\]', m)
        if not mm: return None
        vals = [None if x.strip()=="null" else float(x) for x in mm.group(1).split(",") if x.strip()]
        vals = [v for v in vals if v is not None]
        return vals[-1] if vals else None
    return {"revenue": arr("revenue"), "netIncome": arr("ni"), "sbc": arr("sbc"),
            "buyback": arr("buyback"), "dilShares": arr("shares")}
TOL = {"revenue":.02,"netIncome":.02,"sbc":.03,"buyback":.05,"dilShares":.01}
out = {"asOf": date.today().isoformat(), "method": "automated SEC-XBRL vs aggregator reconciliation (latest FY)", "companies": {}}
totV = totC = 0
for tk in GOLDEN:
    S, L = sec.get(tk, {}), local(tk)
    fields = {}
    for k, tol in TOL.items():
        f = (S.get("f") or {}).get(k)
        sv = f["v"]/1e9 if f else None
        lv = L.get(k)
        if sv is None or lv is None:
            fields[k] = {"status": "not-comparable", "sec": sv, "terminal": lv}
            continue
        diff = abs(lv - sv)/max(abs(sv), 1e-9)
        st = "verified" if diff <= tol else "CONFLICT"
        if st == "verified": totV += 1
        else: totC += 1
        fields[k] = {"status": st, "secB": round(sv,3), "terminalB": round(lv,3), "diffPct": round(diff*100,2),
                     "filing": {"form": f["form"], "filed": f["filed"], "accn": f["accn"], "tag": f["tag"]}}
    out["companies"][tk] = {"latestFiling": S.get("latest"), "fields": fields}
out["summary"] = {"verifiedFields": totV, "conflictFields": totC}
(ROOT/"data"/"audits").mkdir(parents=True, exist_ok=True)
(ROOT/"data"/"audits"/"golden-company-audit.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
print(f"golden audit: {totV} verified, {totC} conflicts")
for tk, c in out["companies"].items():
    con = [k for k,v in c["fields"].items() if v["status"]=="CONFLICT"]
    print(f"  {tk}: {'OK' if not con else 'CONFLICTS: '+','.join(con)}")
