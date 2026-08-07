"""Estimate-collector fixtures — the Yahoo fallback meets live data only in
CI, so its parsing contract is pinned here against real-shaped quoteSummary
earningsTrend JSON.

Run:  python tests/test_estimates_fallback.py
"""
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import collect_estimates as ce  # noqa: E402

FAILED = []


def ok(cond, name, detail=""):
    if not cond:
        FAILED.append(f"{name} {detail}")


def trend_payload(trend):
    import json
    return json.dumps({"quoteSummary": {"result": [{"earningsTrend": {"trend": trend}}]}})


FULL = [
    {"period": "0q", "earningsEstimate": {"avg": {"raw": 1.0}}},
    {"period": "0y",
     "earningsEstimate": {"avg": {"raw": 5.61, "fmt": "5.61"}, "numberOfAnalysts": {"raw": 24}},
     "revenueEstimate": {"avg": {"raw": 366400000000}, "numberOfAnalysts": {"raw": 22}}},
    {"period": "+1y",
     "earningsEstimate": {"avg": {"raw": 6.10}, "numberOfAnalysts": {"raw": 27}},
     "revenueEstimate": {"avg": {"raw": 392800000000}, "numberOfAnalysts": {"raw": 25}}},
    {"period": "+5y", "growth": {"raw": 0.12}},
]

with patch.object(ce, "yahoo_get", return_value=trend_payload(FULL)):
    snap = ce.collect_yahoo("TESTX", object(), "crumb")
ok(snap.get("error") is None, "full trend parses without error", str(snap))
ok(snap["currentYearEps"] == 5.61, "current-FY EPS comes from the 0y period", str(snap.get("currentYearEps")))
ok(snap["nextYearEps"] == 6.10, "next-FY EPS comes from the +1y period", str(snap.get("nextYearEps")))
ok(snap["currentYearRevenue"] == 366400000000, "current-FY revenue read", str(snap.get("currentYearRevenue")))
ok(snap["nextYearRevenue"] == 392800000000, "next-FY revenue read", str(snap.get("nextYearRevenue")))
ok(snap["analystCountEps"] == 27, "analyst count prefers the next-FY panel", str(snap.get("analystCountEps")))
ok(snap["source"] == ce.YAHOO_SOURCE, "snapshot declares its Yahoo source", str(snap.get("source")))
ok(snap["revisionBreadth"] is None, "revision breadth is never inferred", str(snap.get("revisionBreadth")))

# --- missing fields stay None, never zero ---
PARTIAL = [{"period": "0y", "earningsEstimate": {"avg": {"raw": 3.25}}}]
with patch.object(ce, "yahoo_get", return_value=trend_payload(PARTIAL)):
    snap = ce.collect_yahoo("TESTX", object(), "crumb")
ok(snap.get("error") is None, "partial trend still yields a snapshot")
ok(snap["currentYearEps"] == 3.25, "present field read")
ok(snap["nextYearEps"] is None, "absent next-FY EPS stays None, not 0", str(snap.get("nextYearEps")))
ok(snap["currentYearRevenue"] is None, "absent revenue stays None, not 0", str(snap.get("currentYearRevenue")))

# --- no fiscal-year consensus at all -> explicit error, no invented snapshot ---
EMPTY = [{"period": "0q", "earningsEstimate": {"avg": {"raw": 1.0}}}]
with patch.object(ce, "yahoo_get", return_value=trend_payload(EMPTY)):
    snap = ce.collect_yahoo("TESTX", object(), "crumb")
ok(snap.get("error") is not None, "quarter-only trend is NOT passed off as fiscal-year consensus", str(snap))

# --- network failure -> error snapshot, upsert keeps history empty ---
import urllib.error


def boom(url, opener):
    raise urllib.error.URLError("HTTP Error 403: Forbidden")


with patch.object(ce, "yahoo_get", boom):
    snap = ce.collect_yahoo("TESTX", object(), "crumb")
ok(snap.get("error") is not None, "fetch failure returns an error snapshot")
hist = {"ticker": "TESTX", "name": "Test", "source": "not collected yet", "snapshots": [], "notes": []}
hist = ce.upsert_snapshot(hist, snap)
ok(hist["snapshots"] == [], "an error never appends a snapshot", str(hist["snapshots"]))
ok(hist.get("lastError", {}).get("message"), "the error is recorded for the UI to disclose")

# --- a good snapshot replaces same-day, clears the error, sorts by date ---
good = {"date": ce.TODAY, "ticker": "TESTX", "source": ce.YAHOO_SOURCE,
        "currentYearEps": 2.0, "currentYearRevenue": None, "nextYearEps": 2.4,
        "nextYearRevenue": None, "analystCountEps": 5, "analystCountRevenue": None,
        "revisionBreadth": None, "note": "test"}
hist = ce.upsert_snapshot(hist, dict(good))
ok(len(hist["snapshots"]) == 1 and hist["snapshots"][0]["nextYearEps"] == 2.4, "good snapshot lands")
ok("lastError" not in hist, "a successful collection clears lastError")
hist = ce.upsert_snapshot(hist, dict(good, nextYearEps=2.5))
ok(len(hist["snapshots"]) == 1 and hist["snapshots"][0]["nextYearEps"] == 2.5, "same-day snapshot replaces, never duplicates")

if FAILED:
    print(f"{len(FAILED)} estimate-fallback fixture(s) FAILED:")
    for f in FAILED:
        print("  ✗", f)
    sys.exit(1)
print("estimate-fallback fixtures: all passed")
