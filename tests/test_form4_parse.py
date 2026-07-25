"""Form 4 parser fixtures — the collector meets live SEC data only in CI,
so its parsing contract is pinned here against real-shaped ownership XML.

Run:  python tests/test_form4_parse.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from collect_insiders import parse_form4, summarize  # noqa: E402

FAILED = []


def ok(cond, name, detail=""):
    if not cond:
        FAILED.append(f"{name} {detail}")


# --- a real open-market purchase by a CEO (the signal we care about) ---
BUY = b"""<?xml version="1.0"?>
<ownershipDocument>
  <documentType>4</documentType>
  <periodOfReport>2026-07-10</periodOfReport>
  <issuer><issuerCik>0000320193</issuerCik><issuerTradingSymbol>TEST</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>SMITH JANE A</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>0</isDirector><isOfficer>1</isOfficer><isTenPercentOwner>0</isTenPercentOwner>
      <officerTitle>Chief Executive Officer</officerTitle>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-07-10</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>10000</value></transactionShares>
        <transactionPricePerShare><value>25.50</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>60000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>"""

r = parse_form4(BUY, "0001-26-000001", "2026-07-11")
ok(r["owner"] == "Smith Jane A", "owner name normalized", r["owner"])
ok(r["role"] == "Chief Executive Officer", "officer title captured", r["role"])
ok(r["senior"] is True, "CEO detected as senior")
ok(r["planned"] is False, "no 10b5-1 flag when absent")
ok(len(r["txns"]) == 1, "one transaction parsed")
t = r["txns"][0]
ok(t["code"] == "P" and t["kind"] == "buy" and t["decision"] is True, "code P is a decision-grade buy")
ok(t["shares"] == 10000 and t["price"] == 25.5 and t["value"] == 255000, "shares/price/value computed", str(t))
ok(t["acquired"] is True and t["derivative"] is False, "acquired + non-derivative flags")
ok(t["held"] == 60000, "post-transaction holding captured")

# --- compensation mechanics must never read as a decision ---
GRANT = BUY.replace(b"<transactionCode>P</transactionCode>", b"<transactionCode>A</transactionCode>") \
           .replace(b"<transactionPricePerShare><value>25.50</value></transactionPricePerShare>",
                    b"<transactionPricePerShare><value>0.00</value></transactionPricePerShare>")
g = parse_form4(GRANT, "0001-26-000002", "2026-07-11")["txns"][0]
ok(g["decision"] is False and g["kind"] == "grant/award", "code A is compensation, not a decision", g["kind"])
ok(g["value"] is None, "zero-price grant yields NO fake dollar value", str(g["value"]))

for code, kind in [(b"M", "option exercise"), (b"F", "tax withholding"), (b"G", "gift")]:
    x = parse_form4(BUY.replace(b"<transactionCode>P</transactionCode>",
                                b"<transactionCode>" + code + b"</transactionCode>"), "a", "2026-07-11")["txns"][0]
    ok(x["decision"] is False and x["kind"] == kind, f"code {code.decode()} excluded from decisions", x["kind"])

# --- 10b5-1 detection: post-2022 checkbox AND legacy footnote text ---
CHECKBOX = BUY.replace(b"<documentType>4</documentType>",
                       b"<documentType>4</documentType><aff10b5One>true</aff10b5One>")
ok(parse_form4(CHECKBOX, "a", "2026-07-11")["planned"] is True, "aff10b5One checkbox detected")
FOOTNOTE = BUY.replace(b"</nonDerivativeTable>",
                       b"</nonDerivativeTable><footnotes><footnote id=\"F1\">Sale under a Rule 10b5-1 plan adopted earlier.</footnote></footnotes>")
ok(parse_form4(FOOTNOTE, "a", "2026-07-11")["planned"] is True, "10b5-1 footnote text detected")

# --- namespaced documents and <value>-wrapped relationship flags ---
NS = b"""<?xml version="1.0"?>
<ns:ownershipDocument xmlns:ns="http://www.sec.gov/edgar/ownership">
  <ns:reportingOwner><ns:reportingOwnerId><ns:rptOwnerName>DOE JOHN</ns:rptOwnerName></ns:reportingOwnerId>
    <ns:reportingOwnerRelationship><ns:isDirector><ns:value>1</ns:value></ns:isDirector></ns:reportingOwnerRelationship>
  </ns:reportingOwner>
  <ns:nonDerivativeTable><ns:nonDerivativeTransaction>
    <ns:transactionDate><ns:value>2026-07-01</ns:value></ns:transactionDate>
    <ns:transactionCoding><ns:transactionCode>P</ns:transactionCode></ns:transactionCoding>
    <ns:transactionAmounts><ns:transactionShares><ns:value>500</ns:value></ns:transactionShares>
      <ns:transactionPricePerShare><ns:value>10</ns:value></ns:transactionPricePerShare></ns:transactionAmounts>
  </ns:nonDerivativeTransaction></ns:nonDerivativeTable>
</ns:ownershipDocument>"""
n = parse_form4(NS, "a", "2026-07-02")
ok(n["owner"] == "Doe John", "namespaced owner parsed", n["owner"])
ok(n["role"] == "Director", "director role from flag with no title", n["role"])
ok(n["senior"] is False, "plain director is not senior")
ok(n["txns"] and n["txns"][0]["value"] == 5000, "namespaced amounts parsed", str(n["txns"]))

# --- malformed / missing amounts stay missing, never zero ---
NOAMT = b"""<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>X Y</rptOwnerName></reportingOwnerId></reportingOwner>
  <nonDerivativeTable><nonDerivativeTransaction>
    <transactionDate><value>2026-07-01</value></transactionDate>
    <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
  </nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>"""
m = parse_form4(NOAMT, "a", "2026-07-02")["txns"][0]
ok(m["shares"] is None and m["price"] is None and m["value"] is None, "absent amounts stay None, never 0", str(m))
ok(m["code"] == "P", "transaction still recorded with what is known")

# --- summarize: cluster accounting, plan filtering, window cutoff ---
def filing(owner, code, dt, senior=False, planned=False, shares=100, price=10, deriv=False):
    return {"accn": owner + dt, "filed": dt, "owner": owner, "role": "Officer",
            "senior": senior, "planned": planned,
            "txns": [{"code": code, "kind": "buy" if code == "P" else "sell",
                      "decision": code in ("P", "S"), "derivative": deriv, "date": dt,
                      "shares": shares, "price": price, "value": shares * price,
                      "acquired": code == "P", "held": None}]}

s = summarize("TT", [
    filing("Ann", "P", "2026-07-10", senior=True),
    filing("Bob", "P", "2026-07-05"),
    filing("Cid", "P", "2026-07-06", planned=True),      # pre-scheduled: not conviction
    filing("Dee", "P", "2026-01-01"),                    # outside the 90-day window
    filing("Eve", "S", "2026-07-08"),
], "2026-05-01")
ok(s["buyerCount"] == 2, "planned + out-of-window buyers excluded from the cluster count", str(s["buyerCount"]))
ok(set(s["buyers"]) == {"Ann", "Bob"}, "cluster names are the real open-market buyers", str(s["buyers"]))
ok(s["seniorBuyer"] is True, "senior buyer detected in the cluster")
ok(s["buyValue"] == 2000, "buy value sums only conviction buys", str(s["buyValue"]))
ok(len(s["buys"]) == 3 and len(s["sells"]) == 1, "in-window rows still listed for context", f"{len(s['buys'])}/{len(s['sells'])}")
ok(s["lastBuy"] == "2026-07-10", "most recent conviction buy surfaced", str(s["lastBuy"]))

s2 = summarize("TT", [filing("Ann", "P", "2026-07-10", deriv=True)], "2026-05-01")
ok(s2["buyerCount"] == 0, "derivative acquisitions are not open-market conviction buys")
s3 = summarize("TT", [filing("Ann", "A", "2026-07-10")], "2026-05-01")
ok(s3["buyerCount"] == 0 and s3["mechanics"] == 1, "grants counted as mechanics, not buys", str(s3["mechanics"]))

# --- issuer identity: a company's EDGAR feed carries Form 4s where it is the
#     REPORTING OWNER of somebody else's stock. Those must be attributable. ---
r2 = parse_form4(BUY, "a", "2026-07-11")
ok(r2["issuerCik"] == 320193, "issuer CIK extracted so foreign filings can be dropped", str(r2["issuerCik"]))
OTHER = BUY.replace(b"<issuerCik>0000320193</issuerCik>", b"<issuerCik>0001543151</issuerCik>")
ok(parse_form4(OTHER, "a", "2026-07-11")["issuerCik"] == 1543151,
   "a filing about another issuer reports that issuer's CIK, not this one")
NOISSUER = b"""<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>A B</rptOwnerName></reportingOwnerId></reportingOwner>
  <nonDerivativeTable><nonDerivativeTransaction><transactionCoding><transactionCode>P</transactionCode></transactionCoding>
  </nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>"""
ok(parse_form4(NOISSUER, "a", "2026-07-11")["issuerCik"] is None, "absent issuer stays None rather than a wrong guess")

# --- security title is captured so ADS vs ordinary-share rows are separable ---
ok(r2["txns"][0]["security"] == "Common Stock", "security title recorded", r2["txns"][0]["security"])

if FAILED:
    print("\n".join("  x FAIL: " + f for f in FAILED))
    print(f"\n{len(FAILED)} failed")
    sys.exit(1)
print("form 4 parser: all fixtures pass")
