"""
SBC TERMINAL — universe reconciler
==================================
The official universe may only contain names the terminal can actually back
with data. After an expansion (build_universe -> sec_ingest -> promote), some
candidates can legitimately fail: a thin filer, a missing XBRL taxonomy, a
delisting between list-building and ingest.

This script drops any universe entry that lacks BOTH required proofs:

  - a real co({...}) financial row in data.js
  - SEC artifacts: data/companies/<T>.json and data/raw/<T>/sec-facts-extract.json

and rewrites data/universe.json + universe.js to the reconciled membership.
Nothing is invented to fill a gap; the universe simply shrinks to the truth,
and every count gate reads from this file rather than a hardcoded number.

    python scripts/reconcile_universe.py            # apply
    python scripts/reconcile_universe.py --check     # report only, exit 1 if drift
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UNI_JSON = ROOT / "data" / "universe.json"
UNI_JS = ROOT / "universe.js"


def data_js_tickers():
    src = (ROOT / "data.js").read_text(encoding="utf-8")
    return set(re.findall(r'co\(\{ ticker:"([A-Z]+)"', src))


def has_sec_artifacts(tk):
    return ((ROOT / "data" / "companies" / f"{tk}.json").exists()
            and (ROOT / "data" / "raw" / tk / "sec-facts-extract.json").exists())


def main():
    check_only = "--check" in sys.argv
    uni = json.loads(UNI_JSON.read_text(encoding="utf-8"))
    have_data = data_js_tickers()
    keep, dropped = [], []
    for c in uni["companies"]:
        tk = c["ticker"]
        reasons = []
        if tk not in have_data:
            reasons.append("no data.js row")
        if not has_sec_artifacts(tk):
            reasons.append("missing SEC artifacts")
        (dropped if reasons else keep).append((c, reasons) if reasons else c)

    if dropped:
        print(f"dropping {len(dropped)} unbacked ticker(s):")
        for c, reasons in dropped:
            print(f"  {c['ticker']}: {', '.join(reasons)}")
    else:
        print("every universe ticker is fully backed by data.js + SEC artifacts")

    if check_only:
        sys.exit(1 if dropped else 0)
    if not dropped:
        return

    uni["companies"] = keep
    uni["count"] = len(keep)
    UNI_JSON.write_text(json.dumps(uni, indent=1), encoding="utf-8")

    js = UNI_JS.read_text(encoding="utf-8")
    js = re.sub(r"const UNIVERSE_LIST = .*?;\n",
                "const UNIVERSE_LIST = " + json.dumps(keep) + ";\n", js, count=1, flags=re.S)
    UNI_JS.write_text(js, encoding="utf-8")
    print(f"reconciled universe: {len(keep)} companies")


if __name__ == "__main__":
    main()
