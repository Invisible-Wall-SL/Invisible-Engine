"""Offline guard: `atlas.layout: "grid"` — the page the AUTHOR sizes (no R2, no
GPU, no ComfyUI).

Run:  PYTHONPATH=".;../_shared" py test_grid_layout.py   (from services/atlas-tool)

THE BUG THIS CLOSES. The 🖼 To Atlas Maker export wrote `atlas: {"layout":
"pack"}`. On that layout `auto_pack_layout` packs at a HARDCODED 2048 page width
with `height=0`, never reads `atlas.width`/`height`, and then OVERWRITES both
with the packer's own result; every rect is derived from the art it measured, so
`cell_width`/`cell_height` are never read either. Those four fields are the only
ones the ⚙ Settings panel offers for page geometry (`ATLAS_GEOM_FIELDS`, "always
per-manifest, no global fallback"), so the author typed an atlas size and a cell
size into a manifest whose packer discarded all four and said nothing. Reported
live: set width/height + cell width/height, press Create Atlas, nothing changes.

`grid_layout` is the third layout state (there were two: `pack`, or absent =
`.atlas`-bound / legacy cell grid). It INVERTS the pack contract: the four
fields are input, read on every Create Atlas and never written back, and the
rects fall out of them arithmetically. What that buys, and what is asserted
below:

  * the page and the cell are the author's, so editing either and re-running
    Create Atlas RE-FLOWS every rect — the owner's actual complaint;
  * region order is untouched, because the export writes one region per frame in
    frame order and that order IS the animation;
  * over capacity it REFUSES. `batch_atlas` has no page concept at all (a
    manifest has one `source_image`), so there is no second sheet to overflow
    onto, and a grid that silently dropped its tail would be indistinguishable
    from a complete one. Same rule as `MAX_REF_FRAMES` and the ref-zip ceiling.

Sibling guards, do not break them: `test_auto_pack_clear.py`,
`test_stale_pack_rects.py` and `test_pack_page_pointer.py` own the `pack` half.
The gates that used to read `layout == "pack"` are shared by both from-scratch
layouts now (`batch_atlas.is_from_scratch`), and the last section here pins
which ones were widened and which were deliberately left pack-only.

ASCII only in the labels: a non-Latin-1 glyph aborts the suite on this box's
cp1252 console.
"""
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

from PIL import Image

# Sandbox staging BEFORE importing the tool: ATLAS_DIR / BATCH_DIR / INPUT_DIR /
# MANIFEST_DIR all resolve out of it.
_STAGING = tempfile.mkdtemp(prefix="grid-layout-")
os.environ["ATLAS_STAGING"] = _STAGING

import batch_atlas  # noqa: E402
import slice_atlas  # noqa: E402
import ui_server as u  # noqa: E402

FAILED: list[str] = []
PASSED: list[str] = []


def _say(text: str) -> None:
    enc = sys.stdout.encoding or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def check(label: str, got, want) -> None:
    ok = got == want
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       got  {got!r}\n       want {want!r}")


def check_true(label: str, got) -> None:
    check(label, bool(got), True)


def _grid(page: tuple[int, int], cell: tuple[int, int], n: int,
          **extra) -> dict:
    """A grid manifest with `n` named regions and NO geometry on any of them --
    the shape the export writes."""
    atlas = {"layout": "grid", "width": page[0], "height": page[1],
             "cell_width": cell[0], "cell_height": cell[1]}
    atlas.update(extra)
    return {
        "atlas": atlas,
        "style": {"positive_prefix": "", "positive_suffix": "", "negative": ""},
        "regions": [{"name": f"clip_{i:04d}",
                     "style_ref": f"refs/video/clip/clip_{i:04d}.png",
                     "fit_mode": "contain"} for i in range(n)],
    }


def _rects(m: dict) -> list[tuple[int, int, int, int]]:
    return [(r["x"], r["y"], r["w"], r["h"]) for r in m["regions"]]


# --------------------------------------------------------------------------
# 1. The maths, and the order.
# --------------------------------------------------------------------------
def test_the_grid_maths() -> None:
    """7 regions, 100px cells, a 300x300 page: a 3x3 grid filled row-major with
    two cells to spare. Every coordinate spelled out -- an off-by-one in the
    row/column split is exactly the kind of thing that still "looks packed"."""
    m = _grid((300, 300), (100, 100), 7)
    note, changed = u.grid_layout(m)

    check("every region is placed row-major, left to right then down",
          _rects(m),
          [(0, 0, 100, 100), (100, 0, 100, 100), (200, 0, 100, 100),
           (0, 100, 100, 100), (100, 100, 100, 100), (200, 100, 100, 100),
           (0, 200, 100, 100)])
    check("the manifest order is preserved -- it IS the animation",
          [r["name"] for r in m["regions"]],
          [f"clip_{i:04d}" for i in range(7)])
    check("it reports that it mutated the manifest, so the caller saves",
          changed, True)
    check_true("the note names the grid it built",
               note and "3x3 grid".replace("x", "×") in note)
    check_true("...and says how many cells are spare", note and "2 cell(s) spare" in note)


def test_a_partial_last_row_is_still_row_major() -> None:
    """A page WIDER than it is tall, and a count that does not divide: the last
    row is short and starts at column 0, not wherever the previous one ended."""
    m = _grid((600, 400), (200, 200), 4)
    u.grid_layout(m)
    check("4 regions in a 3x2 grid fill row 0 then wrap",
          _rects(m), [(0, 0, 200, 200), (200, 0, 200, 200),
                      (400, 0, 200, 200), (0, 200, 200, 200)])


# --------------------------------------------------------------------------
# 2. THE OWNER'S COMPLAINT: change the cell, press Create Atlas, it re-flows.
# --------------------------------------------------------------------------
def test_changing_the_cell_reflows_every_rect() -> None:
    """The whole point of the fix. `grid_layout` runs on EVERY Create Atlas and
    re-reads the manifest's CURRENT settings, so nothing is frozen at export."""
    m = _grid((600, 400), (200, 200), 6)
    u.grid_layout(m)
    check("first run: a 3x2 grid of 200px cells",
          _rects(m), [(0, 0, 200, 200), (200, 0, 200, 200), (400, 0, 200, 200),
                      (0, 200, 200, 200), (200, 200, 200, 200),
                      (400, 200, 200, 200)])

    # What the author does in the Settings panel: `atlas_cell_width` -> 150.
    m["atlas"]["cell_width"] = 150
    note, changed = u.grid_layout(m)
    check("second run: 4 columns now fit, so every rect re-flows",
          _rects(m), [(0, 0, 150, 200), (150, 0, 150, 200), (300, 0, 150, 200),
                      (450, 0, 150, 200), (0, 200, 150, 200),
                      (150, 200, 150, 200)])
    check("...and it says so, so the caller saves the new geometry",
          changed, True)
    check_true("...and the note describes the NEW grid, not the old one",
               note and "4×2 grid" in note)

    # A shrink too: fewer columns, and the tail moves DOWN rather than off.
    m["atlas"]["cell_width"] = 300
    m["atlas"]["cell_height"] = 100
    u.grid_layout(m)
    check("a third run re-flows again -- geometry is never frozen",
          _rects(m), [(0, 0, 300, 100), (300, 0, 300, 100), (0, 100, 300, 100),
                      (300, 100, 300, 100), (0, 200, 300, 100),
                      (300, 200, 300, 100)])


def test_a_second_identical_run_reports_no_change() -> None:
    """Create Atlas is pressed repeatedly. A no-op re-flow must NOT claim it
    mutated the manifest -- `_write_manifest_at` mirrors to R2 inside the
    manifest lock, so a spurious `changed` is a network PUT per press."""
    m = _grid((300, 300), (100, 100), 4)
    first_note, first_changed = u.grid_layout(m)
    before = json.dumps(m, sort_keys=True)
    note, changed = u.grid_layout(m)
    check("the first run changed something", first_changed, True)
    check("the second run changed nothing", changed, False)
    check("...and the manifest really is byte-identical",
          json.dumps(m, sort_keys=True), before)
    check("...but it still reports the layout it resolved",
          note == first_note and bool(note), True)


# --------------------------------------------------------------------------
# 3. The page is INPUT. This is the inversion of the pack contract.
# --------------------------------------------------------------------------
def test_the_page_size_is_never_overwritten() -> None:
    """`auto_pack_layout` ends with `atlas["width"] = result["width"]`. If grid
    ever grows that line the Settings fields become output again and the
    original bug is back, one re-flow later."""
    m = _grid((640, 480), (100, 100), 5)
    u.grid_layout(m)
    check("the author's page survives run 1",
          (m["atlas"]["width"], m["atlas"]["height"]), (640, 480))
    check("...and so does the author's cell",
          (m["atlas"]["cell_width"], m["atlas"]["cell_height"]), (100, 100))
    # 640/100 = 6 columns and 480/100 = 4 rows: the page is NOT an exact
    # multiple of the cell, which is the case where a "helpful" shrink-to-fit
    # would be most tempting.
    m["atlas"]["cell_width"] = 128
    u.grid_layout(m)
    check("...and both survive a re-flow at a different cell size",
          (m["atlas"]["width"], m["atlas"]["height"]), (640, 480))
    check("the layout key is left alone too", m["atlas"]["layout"], "grid")


def test_the_unusable_slack_is_named() -> None:
    """640x480 in 128px cells leaves a 0px right margin but an 96px bottom one.
    Say it: that is page area the author paid for and no cell can ever use."""
    m = _grid((640, 480), (128, 128), 4)
    note, _changed = u.grid_layout(m)
    check_true("the note names the leftover strip", note and "96px at the bottom" in note)


# --------------------------------------------------------------------------
# 4. Over capacity: refuse, do not shorten.
# --------------------------------------------------------------------------
def test_over_capacity_changes_nothing() -> None:
    m = _grid((300, 300), (100, 100), 10)
    before = json.dumps(m, sort_keys=True)
    note, changed = u.grid_layout(m)

    check("nothing is written", changed, False)
    check("...and the manifest is byte-for-byte what it was",
          json.dumps(m, sort_keys=True), before)
    check("no region was placed, not even the ones that would have fit",
          any("x" in r for r in m["regions"]), False)
    check_true("the note names the CAPACITY", note and "= 9 cell(s)" in note)
    check_true("...and the COUNT", note and "10 region(s)" in note)
    check_true("...and the overflow", note and "1 would not fit" in note)
    # The three knobs, because "it does not fit" without them is a dead end.
    check_true("...and the knob: a bigger page",
               note and "raise Atlas width/height" in note)
    check_true("...and the knob: a smaller cell",
               note and "lower Default cell width/height" in note)
    check_true("...and the knob: fewer frames",
               note and "bigger stride" in note)


def test_exactly_full_is_not_over() -> None:
    """The boundary: capacity == count places everything and mentions no spare."""
    m = _grid((300, 300), (100, 100), 9)
    note, changed = u.grid_layout(m)
    check("all nine are placed", len(_rects(m)), 9)
    check("the last one is the bottom-right cell", _rects(m)[-1],
          (200, 200, 100, 100))
    check("it saves", changed, True)
    check("no spare is claimed", "spare" in (note or ""), False)


# --------------------------------------------------------------------------
# 5. Degenerate input: a readable note, never a traceback.
# --------------------------------------------------------------------------
def _note_for(atlas_overrides: dict, n: int = 3) -> tuple[str, bool]:
    m = _grid((300, 300), (100, 100), n)
    m["atlas"].update(atlas_overrides)
    for k, v in list(m["atlas"].items()):
        if v is None:
            m["atlas"].pop(k)
    try:
        note, changed = u.grid_layout(m)
    except Exception as e:  # noqa: BLE001 -- the point is that it must not
        return (f"RAISED {type(e).__name__}: {e}", True)
    check("...nothing was placed", any("x" in r for r in m["regions"]), False)
    return (note or "", changed)


def test_degenerate_sizes_return_a_note() -> None:
    note, changed = _note_for({"cell_width": None})
    check_true("a missing cell width is named, not crashed on",
               "Default cell width" in note and "missing" in note)
    check("...and nothing is saved", changed, False)

    note, _ = _note_for({"width": 0})
    check_true("a zero atlas width is named", "Atlas width" in note)

    note, _ = _note_for({"height": "", "cell_height": ""})
    check_true("two blanks are named together, with the right verb",
               "Atlas height" in note and "Default cell height" in note
               and "are missing" in note)

    note, _ = _note_for({"width": "nonsense"})
    check_true("a non-numeric size reads as missing rather than raising",
               "Atlas width" in note)

    note, _ = _note_for({"cell_width": 400, "cell_height": 400})
    check_true("a cell bigger than the page is named",
               "bigger than the page" in note)
    check_true("...with the fix", "Lower Default cell" in note)

    note, _ = _note_for({}, n=0)
    check_true("an atlas with no regions says so", "no regions yet" in note)

    # A string that PARSES is honoured, because the Settings panel round-trips
    # through JSON and a hand-edited manifest is a real input.
    m = _grid((300, 300), (100, 100), 2)
    m["atlas"]["cell_width"] = "150"
    u.grid_layout(m)
    check("a numeric string size is honoured", _rects(m)[1], (150, 0, 150, 100))


def test_a_broken_region_list_never_escapes() -> None:
    """`never raises` is a contract the caller leans on -- run_compose catches,
    but a raise there costs the pre-note of every other pre-pass."""
    m = _grid((300, 300), (100, 100), 2)
    m["regions"].append("not a dict")
    m["regions"].append({"no": "name"})
    try:
        note, changed = u.grid_layout(m)
    except Exception as e:  # noqa: BLE001
        note, changed = f"RAISED {e}", None
    check("the junk entries are skipped, the real ones placed",
          [(r.get("x"), r.get("y")) for r in m["regions"][:2]],
          [(0, 0), (100, 0)])
    check("and it still reports a save", changed, True)
    check("the note is a note, not a traceback",
          str(note).startswith("RAISED"), False)


# --------------------------------------------------------------------------
# 6. What a grid re-flow clears -- and the one thing it must NOT.
# --------------------------------------------------------------------------
def test_stale_trim_goes_but_fit_mode_stays() -> None:
    """A grid rect IS the authored cell, never a tight crop, so a trim record on
    it describes a frame this layout does not have -- and a surviving `orig_*`
    is live input: its mere PRESENCE is what `fit_to_region` reads as
    `spine_slot`, flipping placement to `fill`. `fit_mode` is the opposite case:
    on `pack` it is derived output and gets popped, here it is the author's
    choice (the export's `fit` control) and must survive every re-flow."""
    m = _grid((300, 300), (100, 100), 1)
    m["regions"][0].update({
        "off_x": 3, "off_y": 4, "orig_w": 64, "orig_h": 64,
        "offX": 3, "offY": 4, "origW": 64, "origH": 64,
        "bounds": "1,2,3,4", "offsets": "3,4,64,64",
        "rotated": True, "rotate": 90,
        "prompt": "a gold coin",
    })
    u.grid_layout(m)
    r = m["regions"][0]
    check("every trim spelling is gone",
          [k for k in ("off_x", "off_y", "orig_w", "orig_h",
                       "offX", "offY", "origW", "origH") if k in r], [])
    check("the .atlas-owned geometry is gone too",
          [k for k in ("bounds", "offsets") if k in r], [])
    check("the rotation flag is gone -- a grid cell is upright by construction",
          [k for k in ("rotated", "rotate") if k in r], [])
    check("the author's fit_mode SURVIVES", r.get("fit_mode"), "contain")
    check("and so does the creative data", r.get("prompt"), "a gold coin")
    check("the rect is the cell", (r["x"], r["y"], r["w"], r["h"]),
          (0, 0, 100, 100))


def test_a_superseded_texturepacker_descriptor_is_dropped() -> None:
    """Same reason as the pack path: the launcher's `backfillMissingGeometry`
    treats a named descriptor as AUTHORITATIVE and would overwrite every rect by
    name, restoring the OLD grid on top of the new page."""
    m = _grid((300, 300), (100, 100), 2,
              texturepacker_json="unassigned/cloud/sheets/clip/clip.json")
    _note, changed = u.grid_layout(m)
    check("the descriptor is popped", "texturepacker_json" in m["atlas"], False)
    check("...and that alone is a save", changed, True)


# --------------------------------------------------------------------------
# 7. The two layouts stay out of each other's way.
# --------------------------------------------------------------------------
def test_auto_pack_layout_never_touches_a_grid_atlas() -> None:
    """If it did, it would repack at its hardcoded 2048 width and overwrite the
    author's page with the packer's -- the original bug, from the other side."""
    m = _grid((300, 300), (100, 100), 3)
    before = json.dumps(m, sort_keys=True)
    check("auto_pack_layout no-ops on a grid atlas", u.auto_pack_layout(m),
          (None, False))
    check("...touching nothing", json.dumps(m, sort_keys=True), before)


def test_grid_layout_never_touches_anything_else() -> None:
    pack = {"atlas": {"layout": "pack"}, "regions": [{"name": "H1"}]}
    bound = {"atlas": {"atlas_file": "rig.atlas", "width": 512, "height": 512,
                       "cell_width": 64, "cell_height": 64},
             "regions": [{"name": "H1"}]}
    for label, man in (("a pack atlas", pack),
                       ("an .atlas-bound / legacy cell-grid atlas", bound),
                       ("a manifest with no atlas block at all", {})):
        before = json.dumps(man, sort_keys=True)
        check(f"grid_layout no-ops on {label}", u.grid_layout(man),
              (None, False))
        check(f"...touching nothing on {label}",
              json.dumps(man, sort_keys=True), before)


def test_auto_pack_layout_still_works_on_a_pack_atlas() -> None:
    """The gate change must not have closed the pack door. No art here, so the
    proof is that it reached its own 'nothing generated yet' branch at all --
    a non-pack manifest returns None and never gets that far."""
    note, changed = u.auto_pack_layout(
        {"atlas": {"layout": "pack"}, "regions": [{"name": "H1"}]})
    check_true("a pack atlas still enters auto_pack_layout",
               note and "nothing generated yet" in note)
    check("...and reports nothing to save", changed, False)


# --------------------------------------------------------------------------
# 8. The shared gate helper, and which gates it was let into.
# --------------------------------------------------------------------------
def test_is_from_scratch() -> None:
    def _m(layout):
        return {"atlas": {}} if layout is None else {"atlas": {"layout": layout}}

    for layout, want in ((None, False), ("", False), ("pack", True),
                         ("grid", True), ("  GRID  ", True), ("PACK", True),
                         ("sheet", False)):
        check(f"is_from_scratch({layout!r})",
              batch_atlas.is_from_scratch(_m(layout)), want)
    check("a manifest with no atlas block is not from-scratch",
          batch_atlas.is_from_scratch({}), False)
    check("atlas_layout normalizes case and whitespace",
          batch_atlas.atlas_layout({"atlas": {"layout": " Grid "}}), "grid")


def test_the_page_pointer_covers_grid_too() -> None:
    """WIDENED. A grid atlas composes its own page and re-derives every rect on
    every Create Atlas, exactly as pack does, so a `source_image_path` left
    naming some earlier page is the same wrong answer. Proven through the gate:
    with no composed page on disk, a manifest the pointer OWNS comes back with a
    refusal note, one it does not comes back None."""
    real = u._composed_page
    tmp = Path(tempfile.mkdtemp(prefix="grid-pointer-"))
    try:
        u._composed_page = lambda stem: (None, None)                # noqa: E731
        out = {}
        for label, atlas in (
                ("grid", {"layout": "grid", "width": 300, "height": 300,
                          "cell_width": 100, "cell_height": 100}),
                ("pack", {"layout": "pack", "width": 128, "height": 128}),
                ("bound", {"atlas_file": "rig.atlas", "width": 512,
                           "height": 512})):
            mp = tmp / f"atlas_manifest_{label}.json"
            mp.write_text(json.dumps({"atlas": atlas, "regions": []}),
                          encoding="utf-8")
            out[label] = u.publish_pack_page(mp, 0.0)
        check_true("a GRID manifest is inside the gate now",
                   out["grid"] and "compose wrote no" in out["grid"])
        check_true("a pack manifest still is",
                   out["pack"] and "compose wrote no" in out["pack"])
        check("an .atlas-bound manifest is still left alone", out["bound"], None)
    finally:
        u._composed_page = real


def test_compose_skips_an_unplaced_grid_region() -> None:
    """WIDENED, in batch_atlas' compose. On a from-scratch layout "no rect"
    means "not on this page" -- but `region_box`'s fallback answers
    (0, 0, cell_w, cell_h) on a grid, because cell_width/cell_height ARE set
    there. Every unplaced region would be painted into the TOP-LEFT CELL, one
    over another, under whatever did belong there. The real compose is run.
    """
    tmp = Path(tempfile.mkdtemp(prefix="grid-compose-"))
    art = tmp / "art.png"
    Image.new("RGBA", (100, 100), (255, 0, 0, 255)).save(art)

    mp = tmp / "atlas_manifest_gridcompose.json"
    mp.write_text(json.dumps({
        "atlas": {"layout": "grid", "width": 300, "height": 100,
                  "cell_width": 100, "cell_height": 100},
        "style": {},
        "regions": [
            # Placed in the MIDDLE cell, so the top-left one is provably empty
            # unless something wrongly falls back into it.
            {"name": "placed", "output_override": str(art),
             "x": 100, "y": 0, "w": 100, "h": 100},
            {"name": "unplaced", "output_override": str(art)},
        ],
    }), encoding="utf-8")
    out = tmp / "page.png"

    argv = sys.argv
    buf = io.StringIO()
    try:
        sys.argv = ["batch_atlas.py", "--manifest", str(mp), "--output",
                    str(out), "--compose-only", "--include-rotated",
                    "--include-hidden"]
        with redirect_stdout(buf):
            batch_atlas.main()
    finally:
        sys.argv = argv
    log = buf.getvalue()

    check_true("the un-rected region is skipped, by name",
               "skip unplaced: not placed on this page" in log)
    check_true("...and the placed one is composed", "placed placed <- " in log)
    page = Image.open(out).convert("RGBA")
    check("the page is the author's page", page.size, (300, 100))
    check("the middle cell holds the art", page.getpixel((150, 50)),
          (255, 0, 0, 255))
    check("the TOP-LEFT cell is empty -- nothing fell back into it",
          page.getpixel((50, 50)), (0, 0, 0, 0))


def test_slice_skips_an_unplaced_grid_region() -> None:
    """WIDENED, in slice_atlas. The same fallback, the other direction: slicing
    an un-rected grid region would crop the top-left cell and bind it as that
    region's reference image -- a plausible file of the wrong art."""
    src = Image.new("RGBA", (300, 100), (0, 0, 0, 0))
    src.paste((0, 255, 0, 255), (100, 0, 200, 100))
    out_dir = Path(str(batch_atlas.INPUT_DIR)) / "slicetest"
    regions = [{"name": "placed", "x": 100, "y": 0, "w": 100, "h": 100},
               {"name": "unplaced"}]
    snapshot = dict(batch_atlas.ATLAS_META)
    try:
        batch_atlas.ATLAS_META.clear()
        batch_atlas.ATLAS_META.update({"layout": "grid", "width": 300,
                                       "height": 100, "cell_width": 100,
                                       "cell_height": 100})
        with redirect_stdout(io.StringIO()) as buf:
            written = slice_atlas.slice_regions(src, regions, out_dir)
    finally:
        batch_atlas.ATLAS_META.clear()
        batch_atlas.ATLAS_META.update(snapshot)
    check("only the placed region is sliced", sorted(written), ["placed"])
    check_true("...and the skip is logged",
               "skip unplaced: not placed on this page" in buf.getvalue())


def test_the_blank_rect_drop_stays_pack_only() -> None:
    """NOT widened, deliberately. `_deployatlas` DROPS a region whose rect the
    page is blank under, on the grounds that a pack rect is only ever stamped
    after measuring non-empty art -- so a blank one is definitionally a fault.
    grid_layout never opens an image, so on a grid a blank cell is the ordinary
    "not generated yet" state; dropping it would turn a visible hole into a
    missing frame, and the non-pack branch already reports it correctly."""
    src = Path(u.__file__).read_text(encoding="utf-8")
    body = src.split("blank: list[str] = []")[1].split("atlas_path =")[0]
    check("the deploy flag asks for `pack` exactly, not is_from_scratch",
          'batch_atlas.atlas_layout(m) == "pack"' in body, True)
    check("...and says why it is not the shared helper",
          "DELIBERATELY `pack` alone" in body, True)


if __name__ == "__main__":
    for fn in (test_the_grid_maths,
               test_a_partial_last_row_is_still_row_major,
               test_changing_the_cell_reflows_every_rect,
               test_a_second_identical_run_reports_no_change,
               test_the_page_size_is_never_overwritten,
               test_the_unusable_slack_is_named,
               test_over_capacity_changes_nothing,
               test_exactly_full_is_not_over,
               test_degenerate_sizes_return_a_note,
               test_a_broken_region_list_never_escapes,
               test_stale_trim_goes_but_fit_mode_stays,
               test_a_superseded_texturepacker_descriptor_is_dropped,
               test_auto_pack_layout_never_touches_a_grid_atlas,
               test_grid_layout_never_touches_anything_else,
               test_auto_pack_layout_still_works_on_a_pack_atlas,
               test_is_from_scratch,
               test_the_page_pointer_covers_grid_too,
               test_compose_skips_an_unplaced_grid_region,
               test_slice_skips_an_unplaced_grid_region,
               test_the_blank_rect_drop_stays_pack_only):
        _say(f"\n-- {fn.__name__}")
        fn()
    print()
    if FAILED:
        _say(f"{len(FAILED)} FAILED of {len(FAILED) + len(PASSED)}: "
             + ", ".join(FAILED))
        sys.exit(1)
    _say(f"all {len(PASSED)} grid-layout fixtures pass")
