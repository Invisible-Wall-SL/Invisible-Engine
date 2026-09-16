"""Offline guard: a from-scratch re-pack really CLEARS the stale trim it says
it clears (no R2, no GPU, no ComfyUI).

Run:  PYTHONPATH=".;../_shared" py test_auto_pack_clear.py   (from services/atlas-tool)

`auto_pack_layout` re-derives every region's rect from its own art, so the trim a
region carried before ("this rect is a tight crop sitting at off_x/off_y inside an
orig_w x orig_h frame") describes a frame that no longer exists. It pops those
fields for exactly that reason -- but it popped ONLY the snake_case spelling this
tool writes.

camelCase is a real producer spelling in this codebase, not a typo.
`video_to_clip.py` `_build_manifest` writes `offX/offY/origW/origH` deliberately,
because the launcher's `parseRegions` reads only camelCase (and the `RawRegion`
comment in apps/launcher-api/src/lib/server/editorRegions.ts explains at length why
teaching it snake_case is a versioned migration, not a parser tweak -- `off_y`
needs a Y-axis conversion and emitting trim re-bases the space every authored
`.irig` is frozen in). So the fix belongs on the consumer side: clear both
spellings, don't change what the producers write.

THIS IS A LATENT FAULT, NOT A LIVE ONE, and the distinction is the point. The
Flipbook sheet -- the only producer that wrote camelCase trim AND declared
`layout:"pack"`, which is the sole way into `auto_pack_layout` -- stopped
declaring `pack` in #682, for unrelated reasons (the pointer/layout contradiction;
see test_pack_page_pointer.py). That closed the one live route in and left a
clearing step that silently skips half the spellings it aims at. The next producer
to declare `pack` alongside camelCase trim pays for it with nothing to read.

And a survivor would be live input, not a dead field: the readers on this side
(`_normalize_converted_region`, `_deployatlas`'s manifest-regions fallback) take
either spelling, and an `orig_*` that merely EXISTS is what `fit_to_region` reads
as `spine_slot`, flipping placement from `contain` to `fill`.

Sibling guard, do not break it: `test_pack_page_pointer.py` asserts the opposite
end of the same contract -- a Flipbook sheet's camelCase trim SURVIVES, precisely
because it no longer declares `pack` and so never reaches the clear at all.

ASCII only in the labels: a non-Latin-1 glyph aborts the suite on this box's
cp1252 console.
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from PIL import Image

import ui_server as u

FAILED: list[str] = []
PASSED: list[str] = []

ART_W, ART_H = 20, 10


def _say(text: str) -> None:
    enc = sys.stdout.encoding or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def check(label: str, got, want) -> None:
    ok = got == want
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       got  {got!r}\n       want {want!r}")


def _art(tmp: Path) -> str:
    """A 40x30 canvas whose opaque art is a 20x10 box -- so the alpha bbox the
    re-pack measures is genuinely smaller than the file."""
    im = Image.new("RGBA", (40, 30), (0, 0, 0, 0))
    im.paste((255, 0, 0, 255), (5, 5, 5 + ART_W, 5 + ART_H))
    p = tmp / "coin.png"
    im.save(p)
    return str(p)


def _manifest(tmp: Path) -> dict:
    """One pack atlas whose region carries trim in BOTH spellings -- the shape a
    camelCase-writing producer would hand this tool if it declared `pack`, plus
    this tool's own snake_case. No shipping producer is in that state today; the
    clear has to hold for the one that next is."""
    return {
        "atlas": {"layout": "pack"},
        "regions": [{
            "name": "Coin",
            "output_override": _art(tmp),
            "x": 100, "y": 100, "w": 7, "h": 7,
            "off_x": 3, "off_y": 4, "orig_w": 64, "orig_h": 64,
            "offX": 3, "offY": 4, "origW": 64, "origH": 64,
            "fit_mode": "contain",
            "bounds": "1,2,3,4", "offsets": "3,4,64,64",
            "prompt": "a gold coin",
        }],
    }


def test_the_repack_measures_the_alpha_bbox() -> None:
    """Context for the rest: the new rect IS the tight art, which is what makes
    the old trim stale."""
    with tempfile.TemporaryDirectory() as td:
        m = _manifest(Path(td))
        note = u.auto_pack_layout(m)
        r = m["regions"][0]
        check("the region is re-rected to its alpha bbox", (r["w"], r["h"]),
              (ART_W, ART_H))
        check("...and the run reports it packed something",
              bool(note and "Auto-packed 1 region" in note), True)


def test_both_spellings_of_the_stale_trim_are_cleared() -> None:
    with tempfile.TemporaryDirectory() as td:
        m = _manifest(Path(td))
        u.auto_pack_layout(m)
        r = m["regions"][0]
        check("snake_case trim is gone",
              [k for k in ("off_x", "off_y", "orig_w", "orig_h") if k in r], [])
        check("camelCase trim is gone too (the fault this closes)",
              [k for k in ("offX", "offY", "origW", "origH") if k in r], [])
        check("the raw .atlas geometry strings are gone",
              [k for k in ("bounds", "offsets", "fit_mode") if k in r], [])
        check("creative fields are untouched", r.get("prompt"), "a gold coin")


def test_the_clear_reaches_a_reader_that_takes_either_spelling() -> None:
    """The point of the clear, stated where it is actually observable: the
    camel-tolerant normalizer must see an UNTRIMMED region. An `orig_*` that
    survives here is not a dead field -- `fit_to_region` reads its presence as
    `spine_slot` and stretches the art to the rect."""
    with tempfile.TemporaryDirectory() as td:
        m = _manifest(Path(td))
        u.auto_pack_layout(m)
        normed = u._normalize_converted_region(m["regions"][0])
        check("the reader synthesizes no trim",
              ("orig_w" in normed, "orig_h" in normed), (False, False))
        check("...and reads a zero offset",
              (normed["off_x"], normed["off_y"]), (0, 0))


def test_a_region_with_no_art_yet_is_left_alone() -> None:
    """Unplaced regions are skipped before the clear, so a not-yet-generated
    region keeps whatever it was imported with."""
    with tempfile.TemporaryDirectory() as td:
        m = _manifest(Path(td))
        m["regions"].append({"name": "Bell", "x": 0, "y": 0, "w": 8, "h": 8,
                             "origW": 64, "origH": 64})
        note = u.auto_pack_layout(m)
        check("it is reported as skipped, not packed",
              bool(note and "Bell" in note and "not generated yet" in note),
              True)
        check("...and its trim is not touched",
              m["regions"][1].get("origW"), 64)


if __name__ == "__main__":
    for fn in (test_the_repack_measures_the_alpha_bbox,
               test_both_spellings_of_the_stale_trim_are_cleared,
               test_the_clear_reaches_a_reader_that_takes_either_spelling,
               test_a_region_with_no_art_yet_is_left_alone):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
