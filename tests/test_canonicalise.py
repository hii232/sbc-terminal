"""Canonicalisation contract — the step that makes convergence countable.

Convergence counting is string equality, so if this stage degrades, the
Narrative Radar does not error: it silently undercounts. That is exactly what
happened on the 224-company sweep, where a single "cluster everything" call
had to echo all 2,779 phrases back inside its clusters, blew a 49,786-token
ceiling, truncated, and shipped a board built on raw phrasing. Nothing failed
loudly; "international market expansion" and "international market growth"
just sat next to each other as separate narratives.

These fixtures pin the properties that make that impossible to repeat: no
response scales with the corpus, an invented label can never enter the
vocabulary, and a partial failure degrades to raw phrases instead of wrong
ones. The collector meets the real API only in CI, so the client is stubbed.

Run:  python tests/test_canonicalise.py
"""
import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import collect_language as CL  # noqa: E402

# The disk cache is its own fixture section at the bottom; everything above it
# pins the API contract, so it runs cache-off to stay hermetic.
CL.CANON_CACHE = None

FAILED = []


def ok(cond, name, detail=""):
    if not cond:
        FAILED.append(f"{name} {detail}")


class _Msg:
    def __init__(self, body, stop="end_turn"):
        self.content = [types.SimpleNamespace(type="text", text=body)]
        self.stop_reason = stop


class _Stream:
    def __init__(self, msg):
        self.msg = msg

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get_final_message(self):
        return self.msg


class FakeClient:
    """First call returns the vocabulary; later calls assign one batch each.

    Every assignment response smuggles in a label that is NOT in the
    vocabulary, because a model inventing its own label is the precise way the
    fragmentation bug comes back.
    """

    def __init__(self, labels, fail_batches=(), vocab_stop="end_turn"):
        self.labels = labels
        self.fail = set(fail_batches)
        self.vocab_stop = vocab_stop
        self.calls = 0
        self.batch_sizes = []
        self.vocab_budget = None
        self.messages = types.SimpleNamespace(stream=self._stream)

    def _stream(self, **kw):
        self.calls += 1
        if self.calls == 1:
            self.vocab_budget = kw["max_tokens"]
            return _Stream(_Msg(json.dumps({"labels": self.labels}), self.vocab_stop))
        idx = self.calls - 1
        phrases = kw["messages"][0]["content"].split("PHRASES:\n")[1].splitlines()
        self.batch_sizes.append(len(phrases))
        if idx in self.fail:
            return _Stream(_Msg("{}", stop="max_tokens"))
        rows = [{"phrase": p, "label": self.labels[0]} for p in phrases]
        rows.append({"phrase": phrases[0], "label": "invented label not in vocabulary"})
        return _Stream(_Msg(json.dumps({"assignments": rows})))


CL.ASSIGN_BATCH = 5
SMALL = {f"theme number {i}" for i in range(13)}   # -> batches of 5, 5, 3

# --- every phrase lands on a vocabulary label, in bounded batches ---
c = FakeClient(["ai infrastructure buildout", "supply chain resilience"])
m = CL.canonicalise(c, SMALL)
ok(len(m) == 13, "every phrase is mapped when all batches succeed", str(len(m)))
ok(c.batch_sizes == [5, 5, 3], "phrases are split into fixed-size batches", str(c.batch_sizes))

# --- the fragmentation guard: a model-invented label is discarded ---
ok("invented label not in vocabulary" not in set(m.values()),
   "a label outside the vocabulary never enters the mapping", str(set(m.values())))

# --- a failed batch costs ONLY its own phrases ---
c = FakeClient(["ai infrastructure buildout"], fail_batches={2})
m = CL.canonicalise(c, SMALL)
ok(len(m) == 8, "a failed batch leaves its phrases raw and spares the rest", str(len(m)))

# --- no vocabulary means keep raw phrasing, never guess ---
ok(CL.canonicalise(FakeClient([]), SMALL) == {},
   "an empty vocabulary degrades to raw themes rather than a wrong mapping")
ok(CL.canonicalise(FakeClient(["x"], vocab_stop="max_tokens"), SMALL) == {},
   "a truncated vocabulary response is treated as failure, not as partial truth")

# --- empty corpus makes no call at all ---
c = FakeClient(["x"])
ok(CL.canonicalise(c, set()) == {} and c.calls == 0, "an empty corpus costs nothing")

# --- THE REGRESSION: response size must not scale with the corpus ---
# 2,779 is the real count from the sweep that truncated.
CL.ASSIGN_BATCH = 200
BIG = {f"strategic theme variant {i}" for i in range(2779)}
c = FakeClient(["label one"])
CL.canonicalise(c, BIG)
ok(max(c.batch_sizes) <= 200,
   "no assignment call ever exceeds one batch, however large the corpus",
   str(max(c.batch_sizes)))
ok(c.vocab_budget < 40000,
   "the vocabulary call stays far below the ceiling that truncated at 49,786",
   str(c.vocab_budget))
ok(sum(c.batch_sizes) == 2779, "every phrase is still offered for assignment",
   str(sum(c.batch_sizes)))

# --- the vocabulary is deduplicated and shape-checked ---
c = FakeClient(["Ai Buildout", "ai buildout", "  ", "a much too long label that runs well past four words"])
CL.canonicalise(c, {"one theme"})
labels = CL.propose_labels(FakeClient(["Ai Buildout", "ai buildout", " "]), {"x"})
ok(labels == ["ai buildout"], "vocabulary is lowercased, de-duplicated and blank-stripped", str(labels))

# --- THE COST GUARD: an unchanged corpus never re-buys its mapping ---
# Canonicalisation runs on every scheduled refresh but the corpus only changes
# when a filing lands; without this cache the pipeline paid for the identical
# mapping seven times a week.
import tempfile  # noqa: E402

CL.ASSIGN_BATCH = 5
CL.CANON_CACHE = Path(tempfile.mkdtemp()) / "_canon.json"

c = FakeClient(["label one"])
first = CL.canonicalise(c, SMALL)
ok(c.calls > 0 and len(first) == 13, "first run over a corpus computes and caches", str(c.calls))
c = FakeClient(["label one"])
again = CL.canonicalise(c, SMALL)
ok(c.calls == 0 and again == first,
   "an unchanged corpus reuses the cached mapping at zero model calls", str(c.calls))

c = FakeClient(["label one"])
CL.canonicalise(c, SMALL | {"a brand new theme"})
ok(c.calls > 0, "a changed corpus recomputes instead of serving stale mappings", str(c.calls))

# a degraded run must not freeze its degradation into the cache
CL.CANON_CACHE.unlink(missing_ok=True)
c = FakeClient(["label one"], fail_batches={2})
CL.canonicalise(c, SMALL)
c = FakeClient(["label one"])
CL.canonicalise(c, SMALL)
ok(c.calls > 0, "a partially-failed run is never cached — the next run retries", str(c.calls))

# the models are part of the cache key: switching models re-canonicalises
prev_model = CL.CANON_MODEL
CL.CANON_MODEL = "some-other-model"
c = FakeClient(["label one"])
CL.canonicalise(c, SMALL)
ok(c.calls > 0, "a model change invalidates the cache", str(c.calls))
CL.CANON_MODEL = prev_model

if FAILED:
    print("\n".join("  x FAIL: " + f for f in FAILED))
    print(f"\n{len(FAILED)} failed")
    sys.exit(1)
print("canonicalisation: all fixtures pass")
