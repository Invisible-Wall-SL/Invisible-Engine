"""Syntax-check the JavaScript embedded in the Atlas Maker page. No R2, no GPU.

Run:  PYTHONPATH=".;../_shared" py test_page_js.py   (needs node on PATH)

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

THREE LAYERS, because the bug arrives by three different routes:

1. THE SOURCE SCAN. Read ui_server.py as TEXT and fail on any odd-length
   backslash run Python would consume, naming file:line — across ALL FIVE
   module-level templates, and before anything is rendered. This is the only
   layer that reports the offending LINE, and the only one that covers a
   template the page never renders.
2. THE REAL RENDER. `PAGE.format()` exactly as the server calls it, every
   inline <script> through `node --check`. This is the layer that sees what
   the browser sees, including anything `.format()` itself introduces.
3. THE OTHER TEMPLATES. `IW_TOOLBAR` / `ATLASVIEW` / `CARD` carry script too
   and have no single render path to borrow, so their slots are filled with
   `null` and parsed the same way.

Layer 1 finds only breakage that leaves a BACKSLASH in the source. The other
direction ships with none at all: an editing tool that eats `\\n` writes a REAL
newline into the file, so the literal is already broken with nothing for a
backslash scan to see. That landed in `savedOk()` on 2026-09-14 and the
backslash scan passed on the dead page — which is why layers 2 and 3 parse for
real rather than pattern-matching. A missing `node` FAILS loudly rather than
skipping quietly, because a silent pass is the one outcome this suite exists to
prevent.
"""
from __future__ import annotations

import io
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import ui_server as u

SRC = Path(u.__file__)
NODE = shutil.which("node")

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


# ---------------------------------------------------------------- layer 1

# What a backslash can escape in a non-raw Python string. `\\` is excluded: an
# even run is already the literal-backslash form we want.
INTERPRETED = set("nrtvfab0'\"xuUN\n")

# `\"` emits a plain `"`. Every use in these templates sits inside a
# SINGLE-quoted JS string, where a bare `"` is legal and terminates nothing.
BENIGN = {'"'}


def template_spans(lines: list[str]) -> list[tuple[str, int, int]]:
    """(name, first_body_line, last_body_line) for each MODULE-level template."""
    out = []
    for i, ln in enumerate(lines):
        m = re.match(r'^([A-Z][A-Z0-9_]*) = f?"""', ln)
        if not m:
            continue
        j = i
        while j + 1 < len(lines) and '"""' not in lines[j + 1]:
            j += 1
        out.append((m.group(1), i, j))
    return out


def interpreted_escapes(lines: list[str], lo: int, hi: int) -> list[tuple[int, str, str]]:
    hits = []
    for n in range(lo, hi + 1):
        ln = lines[n]
        # The opening line carries the `NAME = """` prefix; only its tail is body.
        # `[-1]`, not `[1]`, so a single-line span (lo == hi on an ordinary body
        # line) is scannable too — that is what pins the digest tooltip below.
        body = ln.split('"""', 1)[-1] if n == lo else ln
        for m in re.finditer(r"\\+", body):
            nxt = body[m.end():m.end() + 1] or "\n"
            if len(m.group(0)) % 2 == 1 and nxt in INTERPRETED and nxt not in BENIGN:
                hits.append((n + 1, nxt, body.strip()[:90]))
    return hits


# ---------------------------------------------------------------- layers 2/3

SCRIPT_RE = re.compile(r"<script\b[^>]*>(.*?)</script>", re.S | re.I)
# A single `{name}` slot -- NOT the `{{`/`}}` that .format() collapses to braces.
PLACEHOLDER = re.compile(r"(?<!\{)\{([a-z_][a-z0-9_]*)\}(?!\})")

# Placeholders that land in JS VALUE position (`var rn={flash_region};`), where a
# blank would be a syntax error of this harness's own making. `null` parses as a
# JS expression and is inert as HTML text.
_JS_VALUE = {"bp_bound_roles_js", "bp_params_js", "bp_param_values_js",
             "bp_list_js", "bp_can_publish_js", "cb", "chosen_client",
             "chosen_project", "flash_region", "ot", "picked"}


def render_page() -> str:
    names = sorted(set(PLACEHOLDER.findall(u.PAGE)))
    filler = {n: ("null" if n in _JS_VALUE or n.endswith("_js") else "")
              for n in names}
    return u.PAGE.format(**filler)


def source_lines() -> list[str]:
    return io.open(SRC, encoding="utf-8").read().split("\n")


def other_templates() -> list[tuple[str, str, bool]]:
    """(name, value, needs_format) for every module-level UPPERCASE string
    constant that carries <script>, minus PAGE — which layer 2 renders for real.

    Read off the IMPORTED MODULE, not the source, so Python's escape
    interpretation is already applied and a template assembled at import
    (`SPLASH = splash_html(...)`) is covered too — the one the `ast`-based
    predecessor of this suite could not see at all.

    `needs_format` separates the two kinds, and getting it wrong invents a
    failure: a literal `NAME = \"\"\"...\"\"\"` template is a `.format()` source,
    so its `{slot}` must be filled and its `{{`/`}}` collapsed — while an
    already-assembled string is FINAL and its braces are real JavaScript.
    Substituting into `SPLASH` rewrote a destructuring `const {...}=gen.next()`
    into `const null=gen.next()` and failed a page that was perfectly fine."""
    literal = {name for name, _, _ in template_spans(source_lines())}
    out = []
    for name, val in vars(u).items():
        if name == "PAGE" or not re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
            continue
        if isinstance(val, str) and "<script" in val.lower():
            out.append((name, val, name in literal))
    return sorted(out)


def node_check(js: str) -> tuple[bool, str]:
    """True if `node --check` accepts this source."""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False,
                                     encoding="utf-8") as fh:
        fh.write(js)
        tmp = fh.name
    try:
        r = subprocess.run([NODE or "node", "--check", tmp],
                           capture_output=True, text=True)
        return r.returncode == 0, r.stderr.strip()
    finally:
        Path(tmp).unlink(missing_ok=True)


def scripts_of(html: str) -> list[str]:
    return [s for s in SCRIPT_RE.findall(html) if s.strip()]


def parse_each(label: str, blocks: list[str]) -> None:
    for i, body in enumerate(blocks):
        ok, err = node_check(body)
        if not ok:
            _say("       " + "\n       ".join(err.split("\n")[:10]))
        check(f"{label} <script> {i} parses ({len(body)} chars)", ok, True)


# ---------------------------------------------------------------- tests


def test_no_escape_python_would_eat_in_any_template() -> None:
    """Layer 1: the break, reported at its source line, before any render."""
    lines = io.open(SRC, encoding="utf-8").read().split("\n")
    spans = template_spans(lines)
    check("module-level templates found", [s[0] for s in spans] != [], True)
    check("PAGE is one of them", any(s[0] == "PAGE" for s in spans), True)

    for name, lo, hi in spans:
        hits = interpreted_escapes(lines, lo, hi)
        for lineno, ch, snippet in hits:
            _say(f"       {SRC.name}:{lineno}  \\{ch}  {snippet}")
        if hits:
            _say(f"       ^ write \\\\{hits[0][1]} so the escape survives "
                 "into the browser")
        check(f"{name}: no escape Python would eat", [h[0] for h in hits], [])

    # The exact statement that broke, pinned by PROPERTY rather than by remedy.
    # There are two ways to be safe here and this must accept both: double the
    # escape, or write the tooltip so it needs none. The original fix doubled a
    # `\n`; the one that shipped instead made it a single line with no backslash
    # at all, which is the better of the two and which an "is it doubled?" check
    # would have rejected. So assert what actually matters — this line carries
    # nothing Python would eat on the way to the browser.
    sha = [ln for ln in lines if "sha256 of the stored graph" in ln]
    check("blueprint digest tooltip still present", len(sha), 1)
    if sha:
        at = lines.index(sha[0])
        check("...and it carries no escape Python would eat",
              [h[0] for h in interpreted_escapes(lines, at, at)], [])


def test_every_inline_script_parses() -> None:
    """Layer 2: the regression test proper, on the REAL rendered page."""
    blocks = scripts_of(render_page())
    check("the page has inline script to check", bool(blocks), True)
    parse_each("PAGE", blocks)


def test_every_other_template_script_parses() -> None:
    """Layer 3: the templates PAGE's render path never touches."""
    others = other_templates()
    check("the other script-carrying templates were found", bool(others), True)
    for name, raw, needs_format in others:
        html = raw
        if needs_format:
            html = (PLACEHOLDER.sub("null", raw)
                    .replace("{{", "{").replace("}}", "}"))
        parse_each(name, scripts_of(html))


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
    tests = [test_no_escape_python_would_eat_in_any_template]
    if NODE:
        tests += [test_every_inline_script_parses,
                  test_every_other_template_script_parses,
                  test_the_harness_would_have_caught_the_real_bug,
                  test_no_lone_backslash_escape_survives_into_the_page]
    else:
        # Loud, not quiet: three of the five layers cannot run without node, and
        # a suite that reports success on a page it never parsed is the exact
        # failure this file exists to make impossible.
        FAILED.append("node missing (the JS parse checks could NOT run)")

    for fn in tests:
        print(f"\n-- {fn.__name__}")
        fn()

    if not NODE:
        _say("\nFAIL node is not on PATH -- the JS parse checks did NOT run")
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
