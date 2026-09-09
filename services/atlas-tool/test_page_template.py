"""The HTML/JS templates in ui_server.py must survive Python's own escaping.

Run:  py test_page_template.py   (from services/atlas-tool, PYTHONPATH=../_shared)

`PAGE` and its siblings are plain (non-raw) triple-quoted strings, so Python
INTERPRETS backslash escapes in them before a single byte reaches the browser.
Write `\\n` inside one and the emitted JS gets a real newline; write `\\'` and it
gets a bare quote. Either one lands in the middle of a JS string literal and
ends the whole `<script>` block with a SyntaxError -- and because the tool
serves ONE 87KB inline script, that is not a broken button, it is a page where
no function exists at all: no modal opens, no atlas saves, nothing.

That is not hypothetical. A `sha.title='...\\n'` tooltip (blueprint digest,
2026-09-08) shipped exactly this and took the entire Atlas Maker UI down until
it was found by syntax-checking the served page. The escape is invisible in
review: the Python source reads like the JS the author meant to write.

So this suite reads ui_server.py as TEXT (no import, no server) and fails on any
odd-length backslash run that Python would consume. `\\\\` (an escaped
backslash) and `\\"` inside a single-quoted JS string are the two harmless
forms and are allowed by construction: the first is even, the second cannot
terminate its literal.
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
        body = ln.split('"""', 1)[1] if n == lo else ln
        for m in re.finditer(r"\\+", body):
            nxt = body[m.end():m.end() + 1] or "\n"
            if len(m.group(0)) % 2 == 1 and nxt in INTERPRETED and nxt not in BENIGN:
                hits.append((n + 1, nxt, body.strip()[:90]))
    return hits


def main() -> int:
    text = io.open(SRC, encoding="utf-8").read()
    lines = text.split("\n")
    spans = template_spans(lines)

    check("templates found", [s[0] for s in spans] != [], True)
    check("PAGE is one of them", any(s[0] == "PAGE" for s in spans), True)

    for name, lo, hi in spans:
        hits = interpreted_escapes(lines, lo, hi)
        if hits:
            for lineno, ch, snippet in hits:
                print(f"       {SRC.name}:{lineno}  \\{ch}  {snippet}")
            print(f"       ^ write \\\\{hits[0][1]} so the escape survives into the browser")
        check(f"{name}: no escape Python would eat", [h[0] for h in hits], [])

    # The exact statement that broke, pinned by shape rather than by wording so a
    # reworded tooltip still has to keep its escapes doubled.
    sha = [ln for ln in lines if "sha256 of the stored graph" in ln]
    check("blueprint digest tooltip still present", len(sha), 1)
    if sha:
        check("...and its newline is doubled", sha[0].count("\\\\n"), 1)

    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: " + ", ".join(FAILED))
        return 1
    print(f"all page-template fixtures pass ({len(spans)} templates scanned)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
