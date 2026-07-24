"""
SBC TERMINAL — earnings intelligence collector
==============================================
Fetches, for every official-universe ticker, from Yahoo Finance quoteSummary
(keyless, same crumb technique as update_data.py):

  - earningsHistory : last 4 quarters of EPS actual vs estimate + surprise %
                      (the beat/miss ledger — refreshed daily, so a company
                      that reports tonight shows its beat on the next run)
  - calendarEvents  : next earnings date (or date window) + consensus EPS/rev
  - earningsTrend   : current-quarter EPS revisions (up/down last 7/30 days),
                      EPS estimate drift (now vs 7/30/60/90 days ago),
                      consensus revenue and analyst counts

Writes data/earnings_intel.json (source of truth) and regenerates earnings.js
(browser bundle: window-global EARNINGS_INTEL).

Missing values stay null — never coerced to zero. A ticker whose fetch fails
keeps its previous entry (staleness visible via fetchedAt).

Usage:
    python scripts/collect_earnings.py            # whole universe
    python scripts/collect_earnings.py NVDA AAPL  # only these tickers
"""
import json, sys, time, urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UNIVERSE = ROOT / "data" / "universe.json"
INTEL_JSON = ROOT / "data" / "earnings_intel.json"
EARNINGS_JS = ROOT / "earnings.js"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
MODULES = "earningsHistory,calendarEvents,earningsTrend,upgradeDowngradeHistory"


def get(url, opener=None):
    req = urllib.request.Request(url, headers=UA)
    o = opener or urllib.request.build_opener()
    with o.open(req, timeout=30) as r:
        return r.read().decode()


def get_crumb():
    cj = urllib.request.HTTPCookieProcessor()
    opener = urllib.request.build_opener(cj)
    try:
        get("https://fc.yahoo.com", opener)
    except Exception:
        pass  # 404 expected; cookie is set anyway
    crumb = get("https://query1.finance.yahoo.com/v1/test/getcrumb", opener)
    return opener, crumb.strip()


def raw(node):
    """Yahoo wraps numbers as {raw, fmt}; return raw or None. Never 0-coerce."""
    if isinstance(node, dict):
        v = node.get("raw")
        return v if isinstance(v, (int, float)) else None
    return node if isinstance(node, (int, float)) else None


def ymd(node):
    v = raw(node)
    if v is None:
        return None
    try:
        return datetime.fromtimestamp(v, tz=timezone.utc).strftime("%Y-%m-%d")
    except (OverflowError, OSError, ValueError):
        return None


def parse_ticker(result):
    """quoteSummary result -> per-ticker intel dict. Missing stays None."""
    eh = (result.get("earningsHistory") or {}).get("history") or []
    history = []
    for h in eh:
        row = {
            "quarter": ymd(h.get("quarter")),
            "epsActual": raw(h.get("epsActual")),
            "epsEstimate": raw(h.get("epsEstimate")),
            "surprisePct": raw(h.get("surprisePercent")),
        }
        if row["surprisePct"] is not None:
            row["surprisePct"] = round(row["surprisePct"] * 100, 2)
        if any(v is not None for v in row.values()):
            history.append(row)
    history.sort(key=lambda r: r["quarter"] or "")

    cal = (result.get("calendarEvents") or {}).get("earnings") or {}
    dates = [d for d in (ymd(x) for x in (cal.get("earningsDate") or [])) if d]
    out = {
        "nextDate": dates[0] if dates else None,
        "nextDateEnd": dates[-1] if len(dates) > 1 else None,
        "nextDateEstimate": bool(cal.get("isEarningsDateEstimate")) or None,
        "epsEstimate": raw(cal.get("earningsAverage")),
        "epsLow": raw(cal.get("earningsLow")),
        "epsHigh": raw(cal.get("earningsHigh")),
        "revEstimate": raw(cal.get("revenueAverage")),
        "history": history,
    }

    # analyst rating actions (firm, from -> to). The free feed carries the
    # ACTION only — the analyst's reasoning is not included and is never
    # invented; the app attaches a matching news headline when one exists.
    from datetime import timedelta
    ratings = []
    hist45 = (date.today() - timedelta(days=45)).isoformat()
    for g in (result.get("upgradeDowngradeHistory") or {}).get("history") or []:
        gd = None
        t = g.get("epochGradeDate")
        if isinstance(t, (int, float)):
            try:
                gd = datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%d")
            except (OverflowError, OSError, ValueError):
                gd = None
        if not gd or gd < hist45:
            continue
        firm = (g.get("firm") or "").strip()
        if not firm:
            continue
        ratings.append({
            "date": gd,
            "firm": firm,
            "from": (g.get("fromGrade") or "").strip() or None,
            "to": (g.get("toGrade") or "").strip() or None,
            "action": (g.get("action") or "").strip() or None,  # up|down|init|main|reit
        })
    ratings.sort(key=lambda r: r["date"], reverse=True)
    out["ratings"] = ratings[:12]

    trend = (result.get("earningsTrend") or {}).get("trend") or []
    cq = next((t for t in trend if t.get("period") == "0q"), None)
    if cq:
        rev = cq.get("epsRevisions") or {}
        drift = cq.get("epsTrend") or {}
        rr = cq.get("revenueEstimate") or {}
        ee = cq.get("earningsEstimate") or {}
        out["trend"] = {
            "endDate": cq.get("endDate"),
            "growth": raw(cq.get("growth")),
            "revUp7": raw(rev.get("upLast7days")),
            "revUp30": raw(rev.get("upLast30days")),
            "revDown7": raw(rev.get("downLast7days")),
            "revDown30": raw(rev.get("downLast30days")),
            "epsNow": raw(drift.get("current")),
            "eps7dAgo": raw(drift.get("7daysAgo")),
            "eps30dAgo": raw(drift.get("30daysAgo")),
            "eps60dAgo": raw(drift.get("60daysAgo")),
            "eps90dAgo": raw(drift.get("90daysAgo")),
            "revenueAvg": raw(rr.get("avg")),
            "analystsEps": raw(ee.get("numberOfAnalysts")),
            "analystsRev": raw(rr.get("numberOfAnalysts")),
        }
    else:
        out["trend"] = None
    return out


def fetch_ticker(tk, opener, crumb):
    url = (f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{tk}"
           f"?modules={MODULES}&crumb={crumb}")
    d = json.loads(get(url, opener))
    results = (d.get("quoteSummary") or {}).get("result") or []
    if not results:
        raise ValueError("empty quoteSummary result")
    return parse_ticker(results[0])


def load_previous():
    if INTEL_JSON.exists():
        try:
            return json.loads(INTEL_JSON.read_text())
        except Exception:
            pass
    return {"asOf": None, "source": None, "tickers": {}}


def write_bundle(intel):
    INTEL_JSON.write_text(json.dumps(intel, indent=1, sort_keys=True) + "\n")
    js = (
        "/* AUTO-GENERATED by scripts/collect_earnings.py — do not edit by hand.\n"
        "   Beat/miss ledger + next-report consensus + estimate revisions for the\n"
        "   official universe. Missing values are null, never zero. */\n"
        "const EARNINGS_INTEL = "
        + json.dumps(intel, indent=1, sort_keys=True)
        + ";\n"
    )
    EARNINGS_JS.write_text(js)


def main():
    only = {t.upper() for t in sys.argv[1:]}
    uni = json.loads(UNIVERSE.read_text())["companies"]
    tickers = [c["ticker"] for c in uni if not only or c["ticker"] in only]
    prev = load_previous()
    intel = {
        "asOf": date.today().isoformat(),
        "source": "Yahoo Finance quoteSummary (earningsHistory, calendarEvents, earningsTrend)",
        "tickers": dict(prev.get("tickers") or {}),
    }
    opener, crumb = get_crumb()
    okc = failc = 0
    for i, tk in enumerate(tickers):
        try:
            row = fetch_ticker(tk, opener, crumb)
            row["fetchedAt"] = date.today().isoformat()
            # Stamp reportedOn: the first refresh where a fiscal quarter shows up
            # in earningsHistory is (approximately) the morning after the report.
            # Only stamped when the ticker already had a tracked entry — a
            # first-ever ingest must not fake report dates for old quarters.
            prev_row = (prev.get("tickers") or {}).get(tk)
            prev_hist = {h.get("quarter"): h for h in (prev_row or {}).get("history") or []}
            for h in row["history"]:
                old = prev_hist.get(h["quarter"])
                if old and old.get("reportedOn"):
                    h["reportedOn"] = old["reportedOn"]
                elif prev_row and h["quarter"] and h["quarter"] not in prev_hist:
                    h["reportedOn"] = date.today().isoformat()
            intel["tickers"][tk] = row
            okc += 1
        except Exception as e:  # keep previous entry; staleness shows in fetchedAt
            failc += 1
            print(f"  ! {tk}: {e}", file=sys.stderr)
            # transient throttle? re-arm crumb once every few failures
            if failc % 5 == 0:
                try:
                    opener, crumb = get_crumb()
                except Exception:
                    pass
        if i % 20 == 19:
            print(f"  … {i + 1}/{len(tickers)} ({okc} ok, {failc} failed)")
        time.sleep(0.35)  # stay polite / under throttle
    print(f"earnings intel: {okc} fetched, {failc} failed, "
          f"{len(intel['tickers'])} total entries")
    if okc == 0 and not only:
        print("nothing fetched — keeping previous bundle untouched", file=sys.stderr)
        sys.exit(1)
    write_bundle(intel)
    print(f"wrote {INTEL_JSON.relative_to(ROOT)} and {EARNINGS_JS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
