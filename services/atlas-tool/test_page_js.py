"""Syntax-check the JavaScript embedded in the Atlas Maker page. No R2, no GPU.

Run:  PYTHONPATH=../_shared:. py test_page_js.py   (needs node on PATH)

THE OUTAGE THIS EXISTS FOR (2026-09-08). `PAGE` is a plain triple-quoted Python
string — NOT a raw one — and it carries ~86 KB of JavaScript. So every escape
written into that JavaScript is consumed by PYTHON first:

    sha.title='... first 12 chars.\\n'      ->  a REAL newline inside a JS string
    open(\\'workflow.json\\')                ->  open('workflow.json')

Both produce an unterminated JS string literal. A browser then fails the WHOLE
inline <script>, so every function it defines is undefined at once — in the real
incident `renderSel` vanished and not one button in the tool did anything.

What makes it worth a dedicated suite is how completely the existing checks
missed it. `py_compile` passed (it is valid Python). Every Python test passed
(none renders the page). The server returned HTTP 200 with a page that looked
correct. `.format()` resolved all 25 placeholders. The only symptom was a silent
SyntaxError in the browser console, and the tool was shipped and deployed.

The rule this encodes: to put a backslash in the embedded JS, DOUBLE it in the
Python source — or, better, write the JS so it needs no escape at all.
"""
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

import ui_server as u

PASSED: list[str] = []
FAILED: list[str] = []


def _say(text: str) -> None:
    enc = sys.stdout.encoding or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def check(label: str, got, want) -> None:
    ok = got == want
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       got  {got!r}\n       want {want!r}")


# Placeholders that land in JS VALUE position (`var rn={flash_region};`), where a
# blank would be a syntax error of this harness's own making. `null` parses as a
# JS expression and is inert as HTML text.
_JS_VALUE = {"bp_bound_roles_js", "bp_params_js", "bp_param_values_js",
             "bp_list_js", "bp_can_publish_js", "cb", "chosen_client",
             "chosen_project", "flash_region", "ot", "picked"}


def render_page() -> str:
    names = sorted(set(
        re.findall(r"(?<!\{)\{([a-z_][a-z0-9_]*)\}(?!\})", u.PAGE)))
    filler = {n: ("null" if n in _JS_VALUE or n.endswith("_js") else "")
              for n in names}
    return u.PAGE.format(**filler)


def node_check(js: str) -> tuple[bool, str]:
    """True if `node --check` accepts this source."""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False,
                                     encoding="utf-8") as fh:
        fh.write(js)
        tmp = fh.name
    try:
        r = subprocess.run(["node", "--check", tmp],
                           capture_output=True, text=True)
        return r.returncode == 0, r.stderr.strip()
    finally:
        Path(tmp).unlink(missing_ok=True)


def scripts_of(html: str) -> list[str]:
    return [s for s in re.findall(r"<script[^>]*>(.*?)</script>", html, re.S)
            if s.strip()]


def test_every_inline_script_parses() -> None:
    """The regression test proper."""
    html = render_page()
    blocks = scripts_of(html)
    check("the page has inline script to check", bool(blocks), True)
    for i, body in enumerate(blocks):
        ok, err = node_check(body)
        if not ok:
            _say("       " + "\n       ".join(err.split("\n")[:10]))
        check(f"inline <script> block {i} parses ({len(body)} chars)", ok, True)


def test_the_harness_would_have_caught_the_real_bug() -> None:
    """A guard that passes no matter what proves nothing. Re-inject the exact
    line that broke production and confirm `node --check` rejects it."""
    broken = (
        "function renderBpManage(){\n"
        "  let sha=document.createElement('code');\n"
        # what Python actually emitted: the escapes already eaten
        "  sha.title='sha256 of the stored graph (first 12 chars).\n'\n"
        "    +'json.load(open('workflow.json')),sort_keys=True,';\n"
        "}\n"
    )
    ok, _ = node_check(broken)
    check("the 2026-09-08 line is rejected", ok, False)
    fixed = (
        "function renderBpManage(){\n"
        "  let sha=document.createElement('code');\n"
        "  sha.title='sha256 of the stored graph (first 12 chars).';\n"
        "}\n"
    )
    ok, err = node_check(fixed)
    check("the escape-free replacement is accepted", ok, True)


def test_no_lone_backslash_escape_survives_into_the_page() -> None:
    """A backslash reaching the rendered JS is not automatically wrong (`\\n`
    written as `\\\\n` in the source is correct and common), but a REAL newline
    or quote inside a single-quoted JS string is exactly the failure mode. Catch
    the specific shape: a `.title=` / `.textContent=` assignment whose opening
    quote is not closed on the same line."""
    html = render_page()
    offenders = []
    for block in scripts_of(html):
        for n, line in enumerate(block.split("\n"), 1):
            m = re.search(r"\.(?:title|textContent|placeholder)\s*=\s*'", line)
            if not m:
                continue
            rest = line[m.end():]
            # strip escaped quotes, then look for the closing one
            if "'" not in rest.replace("\\'", ""):
                offenders.append(f"line {n}: {line.strip()[:90]}")
    check("no unterminated single-quoted assignment", offenders, [])


if __name__ == "__main__":
    for fn in (test_every_inline_script_parses,
               test_the_harness_would_have_caught_the_real_bug,
               test_no_lone_backslash_escape_survives_into_the_page):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
