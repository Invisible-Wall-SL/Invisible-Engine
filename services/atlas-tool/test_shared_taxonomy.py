"""Offline self-test for shared_taxonomy (the one taxonomy every render injects).

No R2, no ComfyUI: `storage` is stubbed before import, and `inject` takes its
contract-lookup as a parameter.

Run:  py test_shared_taxonomy.py
Exits non-zero if any assertion fails; prints "N passed, 0 failed" on success.
"""
from __future__ import annotations

import os
import sys
import types

# Self-locating so this runs under ComfyUI's embedded python too, whose `._pth` ignores
# both PYTHONPATH and the script directory — that is the interpreter with PyYAML on it.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# --- stub `storage` before shared_taxonomy imports it ----------------------------


class Conflict(Exception):
    pass


class ObjectUnreadable(Exception):
    pass


class FakeR2:
    def __init__(self):
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.n = 0

    def get_with_etag(self, key):
        return self.objects.get(key)

    def put(self, key, body, content_type=None, *, if_match=None, if_none_match=None):
        have = self.objects.get(key)
        if if_match is not None and (have is None or have[1] != if_match):
            raise Conflict(f"if_match {if_match!r} did not match")
        self.n += 1
        etag = f'"etag{self.n}"'
        self.objects[key] = (body, etag)
        return etag


R2 = FakeR2()
_stub = types.ModuleType("storage")
_stub.get_with_etag = R2.get_with_etag
_stub.put = R2.put
_stub.Conflict = Conflict
_stub.ObjectUnreadable = ObjectUnreadable
sys.modules["storage"] = _stub

import shared_taxonomy as st  # noqa: E402

PASSED = 0
FAILED = 0


def check(label: str, cond: bool, detail: str = "") -> None:
    global PASSED, FAILED
    if cond:
        PASSED += 1
    else:
        FAILED += 1
        print(f"FAIL: {label}" + (f" -- {detail}" if detail else ""))


GOOD = """
version: 1
roles: [BACKGROUND, MAIN_CHARACTER, ASSET, ENVIRONMENT, UNRESOLVED]
categories:
  background:
    default_role: BACKGROUND
    importance: 0.1
  asset:
    default_role: ASSET
    importance: 1.0
rules:
  - category: asset
    keywords: [raft, rope, lantern]
    priority: 50
"""


# --- validate --------------------------------------------------------------------

rep = st.validate(GOOD)
check("a good taxonomy validates", rep.ok, rep.summary())
check("roles are counted", rep.roles[-1] == "UNRESOLVED", str(rep.roles))
check("categories are counted", sorted(rep.categories) == ["asset", "background"])
check("keywords are counted", rep.keyword_count == 3, str(rep.keyword_count))
check("summary reads back", "3 keywords" in rep.summary(), rep.summary())

check("empty is refused", not st.validate("").ok)
check("non-YAML is refused", not st.validate("roles: [A\n  bad: : :").ok)
check("a bare list is refused", not st.validate("- a\n- b").ok)

no_unresolved = GOOD.replace(", UNRESOLVED]", "]")
check("UNRESOLVED is required", not st.validate(no_unresolved).ok)

misordered = GOOD.replace(
    "roles: [BACKGROUND, MAIN_CHARACTER, ASSET, ENVIRONMENT, UNRESOLVED]",
    "roles: [UNRESOLVED, BACKGROUND, MAIN_CHARACTER, ASSET, ENVIRONMENT]",
)
check("UNRESOLVED must be last", not st.validate(misordered).ok)

bad_role = GOOD.replace("default_role: ASSET", "default_role: NOT_A_ROLE")
rep = st.validate(bad_role)
check("a category pointing at an unknown role is refused", not rep.ok)
check("...and says which", any("NOT_A_ROLE" in e for e in rep.errors), str(rep.errors))

bad_rule = GOOD.replace("- category: asset", "- category: nosuchcategory")
check("a rule for an undefined category is refused", not st.validate(bad_rule).ok)

no_kw = GOOD.split("rules:")[0]
rep = st.validate(no_kw)
check("no keywords is legal", rep.ok, rep.summary())
check("...but warns, because clip scores against them", bool(rep.warnings), str(rep.warnings))


# --- load / save round trip ------------------------------------------------------

text, etag = st.load()
check("nothing stored reads as None", text is None and etag is None)

new_etag = st.save(GOOD)
text, etag = st.load()
check("what was saved reads back", text == GOOD)
check("the etag comes back", etag == new_etag and bool(etag))

try:
    st.save("not a taxonomy at all")
    check("an invalid save is refused", False, "no ValueError raised")
except ValueError:
    check("an invalid save is refused", True)

text, etag = st.load()
check("a refused save did not overwrite", text == GOOD)

st.save(GOOD + "\n# edited\n", if_match=etag)
check("a compare-and-swap with the right etag lands", st.load()[0].endswith("# edited\n"))

try:
    st.save(GOOD, if_match=etag)  # stale — someone else saved in between
    check("a stale compare-and-swap is refused", False, "no Conflict raised")
except Conflict:
    check("a stale compare-and-swap is refused", True)


# --- inject ----------------------------------------------------------------------

def graph():
    return {
        "1": {"class_type": "SemanticLayerAnalyze", "inputs": {"taxonomy_path": ""}},
        "2": {"class_type": "SemanticLayerRouter", "inputs": {"taxonomy_yaml": ""}},
        "3": {"class_type": "LoadImage", "inputs": {"image": "a.png"}},
    }


yes = lambda cls: cls.startswith("Semantic")  # noqa: E731
g = graph()
touched = st.inject(g, "TAXONOMY", declares_input=yes)
check("both semantic nodes are injected", sorted(touched) == ["1", "2"], str(touched))
check("the text lands", g["1"]["inputs"]["taxonomy_yaml"] == "TAXONOMY")
check("an unrelated node is untouched", "taxonomy_yaml" not in g["3"]["inputs"])

g = graph()
g["1"]["inputs"]["taxonomy_yaml"] = "MINE"
touched = st.inject(g, "TAXONOMY", declares_input=yes)
check("an explicit taxonomy is never overwritten", g["1"]["inputs"]["taxonomy_yaml"] == "MINE")
check("...and is reported as untouched", touched == ["2"], str(touched))

g = graph()
g["1"]["inputs"]["taxonomy_yaml"] = ["9", 0]  # wired from another node
st.inject(g, "TAXONOMY", declares_input=yes)
check("a LINKED input is not replaced", g["1"]["inputs"]["taxonomy_yaml"] == ["9", 0])

g = graph()
touched = st.inject(g, "TAXONOMY", declares_input=lambda cls: False)
check("a backend without the input is skipped entirely", touched == [], str(touched))

g = graph()
touched = st.inject(g, "TAXONOMY", declares_input=lambda cls: None)
check(
    "no contract: only a node already naming the field is injected",
    touched == ["2"],
    str(touched),
)

g = graph()
check("an empty taxonomy injects nothing", st.inject(g, "  ", declares_input=yes) == [])


print(f"{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
