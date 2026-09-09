"""Which roles a blueprint must bind to be publishable.

Run:  py test_blueprint_roles.py   (from services/atlas-tool, PYTHONPATH=../_shared)

`output` is the one STRUCTURAL role — it names the node the image is read from, so
a blueprint without it cannot produce a region and is refused.

`positive` and `seed` used to be refused too. That assumed every blueprint is a
GENERATION graph. A PROCESSING one — upscale, relight, matting — has no sampler
and no text encoder, so neither role has anything to bind, and the publish was
simply unreachable: the modal demanded a seed the graph could not offer, with no
way forward. Nothing downstream needs them (`_set_node_input` is a documented
no-op for an absent binding, and `_seed_in_png` already returns None for a graph
with no KSampler), so the refusal bought nothing and cost a whole class of
blueprint.

The advice that WAS worth keeping — "your graph has a seed and you left it
unbound, so every render comes out identical" — needs the graph and the author
together, so it lives in the publish modal (`bpRoleWarn` / `unboundExpected`).
This validator sees only a missing key and cannot tell that apart from a graph
with no seed at all, so it must not guess.
"""
from __future__ import annotations

import os
import sys
import tempfile

# Sandbox the staging tree before importing: the module resolves paths at import.
os.environ.setdefault("ATLAS_STAGING", tempfile.mkdtemp(prefix="bp-roles-"))

import blueprints  # noqa: E402

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)



def publish_verdict(bindings: dict) -> str:
    """'ok' or the ValueError text from the real validator."""
    manifest = {"id": "bp", "name": "BP", "bindings": bindings}
    try:
        blueprints._validate_manifest("bp", dict(manifest))
        return "ok"
    except ValueError as e:
        return str(e)


OUT = {"node": "5"}
SEED = {"node": "4", "field": "seed"}
POS = {"node": "2", "field": "text"}
REF = {"node": "1", "field": "image"}


def main() -> int:
    print("\n-- the structural role")
    check("output alone publishes", publish_verdict({"output": OUT}), "ok")
    check("no output is refused",
          "required role 'output' is unmapped" in publish_verdict({"seed": SEED, "positive": POS}),
          True)
    check("an output with no node is refused",
          "required role 'output' is unmapped" in publish_verdict({"output": {"field": "x"}}),
          True)

    print("\n-- a PROCESSING graph: no sampler, no text encoder (the bug)")
    check("no seed, no positive publishes",
          publish_verdict({"output": OUT, "style_ref": REF}), "ok")
    check("no seed alone publishes", publish_verdict({"output": OUT, "positive": POS}), "ok")
    check("no positive alone publishes", publish_verdict({"output": OUT, "seed": SEED}), "ok")

    print("\n-- the rest of the contract still holds")
    check("a non-output role still needs a field",
          "has no 'field'" in publish_verdict({"output": OUT, "seed": {"node": "4"}}),
          True)
    check("output needs no field", publish_verdict({"output": OUT}), "ok")

    print("\n-- the role constants")
    check("output is the only structural role", blueprints.STRUCTURAL_ROLES, ("output",))
    check("seed is known but not structural",
          ("seed" in blueprints.KNOWN_ROLES, "seed" in blueprints.STRUCTURAL_ROLES),
          (True, False))
    check("positive is known but not structural",
          ("positive" in blueprints.KNOWN_ROLES, "positive" in blueprints.STRUCTURAL_ROLES),
          (True, False))
    for role in ("positive", "negative", "seed", "width", "height", "style_ref",
                 "shape_ref", "output"):
        check(f"'{role}' is still a known role", role in blueprints.KNOWN_ROLES, True)

    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: " + ", ".join(FAILED))
        return 1
    print("all blueprint-role fixtures pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
