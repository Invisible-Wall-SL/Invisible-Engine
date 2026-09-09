"""The Atlas style panel cannot be left silently unsaved across a render.

Run:  py test_atlas_style_gate.py   (from services/atlas-tool, PYTHONPATH=../_shared)

`📝 Atlas style` is the one settings panel the main "💾 Save changes" does not
carry: `collect()` sends the region cards, and `style.positive_prefix/suffix/
negative` persist ONLY through the panel's own "Save atlas style" button, which
posts to `/saveglobalstyle`.

So the failure was: type a prompt there, press the big Save, render — and the
render composes `_resolve_text` from the SAVED style while your typing sits on
screen looking applied. Reported as "the general prompt is not getting
processed", and it costs a GPU render to notice. The panel is a collapsed
`<details>`, so there was nothing to see either.

Now the panel flags itself dirty (a badge on the SUMMARY, visible while
collapsed) and `renderSel` refuses to start until the author saves or backs out.
These are source-structure assertions: the behaviour itself is browser JS with no
DOM harness here, and what would rot silently is the ORDER — a gate that ends up
after `saveAll()`, or gets dropped in a refactor, still parses and still passes
the page-JS suite.
"""
from __future__ import annotations

import io
import re
import sys
from pathlib import Path

SRC = Path(__file__).with_name("ui_server.py")

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)


def strip_comments(js: str) -> str:
    """Drop `//` line comments so an index test measures CODE, not prose."""
    return "\n".join(re.sub(r"//.*$", "", ln) for ln in js.split("\n"))


def body_of(fn: str, text: str) -> str:
    """Source of one top-level JS function, up to the next one."""
    i = text.index(f"function {fn}(")
    j = text.find("\nfunction ", i + 1)
    k = text.find("\nasync function ", i + 1)
    ends = [e for e in (j, k) if e > 0]
    return text[i:min(ends)] if ends else text[i:]


def main() -> int:
    text = io.open(SRC, encoding="utf-8").read()

    print("\n-- the panel can say it is holding something")
    check("the panel is addressable", 'id="gstylepanel"' in text, True)
    check("the badge lives on the SUMMARY, so a collapsed panel still shows it",
          re.search(r"<summary>[^<]*Atlas style.*?id=\"gstyledirty\".*?</summary>",
                    text, re.S) is not None, True)
    check("the badge says the render will ignore it",
          "this render will NOT use it" in text, True)

    print("\n-- the main save still does not carry the style (the root cause)")
    collect = body_of("collect", text)
    check("collect() sends no style keys",
          any(k in collect for k in ("gpre", "gsuf", "gneg", "positive_prefix")), False)
    check("...so the panel's own button is still the only writer",
          text.count("/saveglobalstyle"), 2)   # the fetch + the route

    print("\n-- the render is gated, and gated BEFORE anything is written")
    # Comments are stripped first: the gate's own comment names saveAll(), and an
    # index test that counts prose finds the wrong call and passes on nothing.
    render = strip_comments(body_of("renderSel", text))
    # The GUARD, not just a mention of the function: a gate neutered to `if(false)`
    # leaves gstyleDirty() in the body (the post-save re-check uses it too) and a
    # name-only assertion goes on passing over a dead branch.
    GATE = "if(gstyleDirty()){{"
    check("renderSel guards on gstyleDirty()", GATE in render, True)
    # The gate must be the FIRST branch in the function. Testing only that the name
    # appears is not enough: neutering the guard to `if(false)` leaves gstyleDirty()
    # in the now-dead body (the post-save re-check uses it too), so a name-only test
    # goes on passing over a render that no longer asks.
    check("...and it is the first branch, so nothing runs ahead of it",
          render.index("if(") == render.index(GATE), True)
    check("renderSel still calls saveAll()", "saveAll()" in render, True)
    check("the gate runs BEFORE saveAll() — declining must write nothing",
          render.index(GATE) < render.index("saveAll()"), True)
    check("declining returns instead of falling through",
          "return;" in render.split("saveAll()")[0], True)

    print("\n-- the dirty flag tracks the SAVED value, not the page load")
    save = body_of("saveGlobalStyle", text)
    check("a successful save re-baselines", "_styleSaved=_styleNow()" in save, True)
    check("...only when the write landed", "indexOf('saved')" in save, True)
    check("comparison is stripped, matching _saveglobalstyle",
          ".value.trim()" in body_of("_styleNow", text), True)

    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: " + ", ".join(FAILED))
        return 1
    print("all atlas-style-gate fixtures pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
