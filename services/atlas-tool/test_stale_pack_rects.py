"""Offline guard: a re-packed atlas never deploys a frame for art it doesn't hold.

Run:  PYTHONPATH=".;../_shared" py test_stale_pack_rects.py   (from services/atlas-tool)

THE FAULT. `auto_pack_layout` re-runs the MaxRects packer on EVERY Create Atlas
for a `layout:"pack"` manifest: it measures each region's committed art, packs
it into a freshly-sized page, and stamps new x/y/w/h onto every region it
placed. A region with nothing to measure -- added but not generated yet, or its
variant file gone -- was left UNPLACED, which really meant "left holding the
rect the PREVIOUS packing gave it" while every other region moved and the page
changed size underneath it.

Nothing downstream could tell that rect from a live one. `_deployatlas`'s
manifest-regions fallback emits a TexturePacker frame for any region with a
complete rect, so the stale one shipped into the deployed `.json` as a
well-formed frame addressing arbitrary pixels of the new page. The sheet looked
right, the descriptor parsed, and the affected symbol just showed some other
symbol's art -- with nothing anywhere saying so.

THE RULE: a silently wrong frame is worse than a loud failure. So the packer-
owned geometry is DERIVED OUTPUT and is cleared off anything the packer did not
just place; the deploy emits no frame for a region with no rect, and names what
it left out. The game then fails to find the frame -- loud, and traceable to the
region the tool already named.

The contract these assertions pin:
  * a re-pack strips x/y/w/h (and the trim keys) off every unplaced region, so
    the stale rect cannot survive to the deploy;
  * placed regions still get their fresh rect, and rotated_regions is walked
    too (a bucket this file has silently dropped before);
  * but measuring NOTHING AT ALL does not strip -- that is equally the
    signature of a failed staging hydration, and wiping every rect on a network
    blip (then mirroring it to R2) is the bigger harm. That page is caught at
    the deploy instead, which refuses a frame map over a blank page;
  * compose skips a pack region with no rect, so the window between the strip
    and the subprocess can't let region_box paint one symbol over the whole
    sheet -- and what it skips is exactly what gets no frame, so that skip can
    never orphan a descriptor;
  * a rect the page is BLANK under is refused too. That is the partial, quieter
    form of the same bug, it predates the skip above, and it comes in by a
    different door: compose's own "no generated variant found" drops a region
    that still holds a rect;
  * the tool says out loud which regions left the atlas -- dropping a symbol is
    not allowed to be silent either;
  * the deploy's frame writer refuses a rect that leaves the page (the state
    every manifest packed before this fix is already in) and names it;
  * a rotated region is bounds-checked at its real (h x w) page footprint, not
    its (w x h) display size -- and the test calls the SHIPPED predicate.

ASCII only in the labels: a non-Latin-1 glyph raises UnicodeEncodeError on this
box's cp1252 console and aborts the whole suite.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image

import batch_atlas as ba
import ui_server as u

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


# --------------------------------------------------------------------------
# Fixtures: real PNGs on disk, measured by the real packer.
# --------------------------------------------------------------------------
def _art(batch: Path, name: str, size: tuple[int, int]) -> None:
    """One opaque variant PNG, so its alpha bbox is the whole canvas."""
    Image.new("RGBA", size, (255, 0, 0, 255)).save(batch / f"{name}_00001_.png")


_TMP: list[Path] = []
_ORIG = (u.BATCH_DIR, ba.BATCH_DIR)


def _packed(regions: list[dict], art: dict[str, tuple[int, int]]
            ) -> tuple[dict, str | None, bool]:
    """Run the REAL auto_pack_layout over `regions`, with art for `art` only.

    Restores the module BATCH_DIRs afterwards: these are process globals, so
    leaving them pointed at a temp dir would poison any suite run alongside
    this one."""
    batch = Path(tempfile.mkdtemp())
    _TMP.append(batch)
    batch = batch / "batch"
    batch.mkdir(parents=True)
    for name, size in art.items():
        _art(batch, name, size)
    u.BATCH_DIR = str(batch)
    ba.BATCH_DIR = batch
    m = {"atlas": {"layout": "pack"}, "style": {},
         "regions": [dict(r) for r in regions]}
    try:
        return (m, *u.auto_pack_layout(m))
    finally:
        u.BATCH_DIR, ba.BATCH_DIR = _ORIG


def _cleanup() -> None:
    for d in _TMP:
        shutil.rmtree(d, ignore_errors=True)


def _region(m: dict, name: str) -> dict:
    return next(r for bucket in ("regions", "rotated_regions")
                for r in m.get(bucket, []) if r["name"] == name)


# --------------------------------------------------------------------------
# 1. The outage: an unplaced region keeping the previous page's rect
# --------------------------------------------------------------------------
def test_a_region_with_no_art_loses_the_previous_packings_rect() -> None:
    """H1 has art; L1's rect is left over from a pack that is gone."""
    m, _note, _ch = _packed(
        [{"name": "H1", "prompt": "a cherry"},
         {"name": "L1", "x": 700, "y": 400, "w": 120, "h": 120,
          "rotated": True}],
        {"H1": (64, 64)})
    l1 = _region(m, "L1")
    check("the stale rect is gone", [k for k in ("x", "y", "w", "h")
                                     if k in l1], [])
    check("...and so is the rotation flag that went with it",
          "rotated" in l1, False)
    check("the region itself survives (it is still in the atlas to generate)",
          l1["name"], "L1")
    check("the placed region got its fresh rect",
          (_region(m, "H1")["w"], _region(m, "H1")["h"]), (64, 64))


def test_the_trim_geometry_goes_too() -> None:
    """off_x/orig_w/fit_mode describe the same dead placement as the rect.
    Leaving them would let a later import read the region as pre-trimmed."""
    m, _n, _c = _packed(
        [{"name": "H1", "prompt": "a cherry"},
         {"name": "L1", "x": 9, "y": 9, "w": 10, "h": 10, "off_x": 3,
          "off_y": 4, "orig_w": 20, "orig_h": 20, "fit_mode": "contain",
          "bounds": [0, 0, 10, 10], "offsets": [3, 4]}],
        {"H1": (64, 64)})
    l1 = _region(m, "L1")
    check("no packer-owned key is left behind",
          [k for k in u._PACK_GEOM_KEYS if k in l1], [])
    check("...but the creative fields are untouched", "name" in l1, True)


def test_a_never_placed_region_is_not_reported_as_lost() -> None:
    """A region added but never generated had no rect to lose. Reporting it as
    'removed from the atlas' would cry wolf on the ordinary growth path."""
    m, note, changed = _packed(
        [{"name": "H1", "prompt": "a cherry"}, {"name": "L1"}],
        {"H1": (64, 64)})
    check("it is counted as not-generated-yet", "not generated yet" in note,
          True)
    check("...and NOT as removed", "REMOVED" in note, False)
    check("the pack still saves (it stamped a layout)", changed, True)
    check("L1 has no invented geometry",
          [k for k in u._PACK_GEOM_KEYS if k in _region(m, "L1")], [])


def test_losing_a_rect_is_said_out_loud() -> None:
    m, note, _c = _packed(
        [{"name": "H1", "prompt": "a cherry"},
         {"name": "L1", "x": 700, "y": 400, "w": 120, "h": 120}],
        {"H1": (64, 64)})
    check("the note says a region was removed", "REMOVED" in note, True)
    # Split defensively: a regression here must read FAIL, not IndexError --
    # a crashing assertion takes every later test in the file down with it.
    tail = note.split("REMOVED")[-1] if "REMOVED" in note else ""
    check("...and names it", "L1" in tail, True)
    check("...and says the deploy will have no frame for it",
          "no frame" in note, True)


def test_rotated_regions_is_walked_too() -> None:
    """The bucket this file has silently dropped before (see _deployatlas's
    fallback comment). A stale rect there ships exactly the same way."""
    batch = Path(tempfile.mkdtemp()) / "batch"
    batch.mkdir(parents=True)
    _art(batch, "H1", (64, 64))
    u.BATCH_DIR = str(batch)
    ba.BATCH_DIR = batch
    m = {"atlas": {"layout": "pack"}, "style": {},
         "regions": [{"name": "H1", "prompt": "a cherry"}],
         "rotated_regions": [{"name": "R1", "x": 500, "y": 500, "w": 40,
                              "h": 40, "rotated": True}]}
    note, _c = u.auto_pack_layout(m)
    check("the rotated bucket's stale rect is stripped too",
          [k for k in ("x", "y", "w", "h") if k in _region(m, "R1")], [])
    check("...and it is named in the note", "R1" in note, True)


# --------------------------------------------------------------------------
# 2. The "nothing generated yet" branch -- it now has work to do
# --------------------------------------------------------------------------
def test_measuring_nothing_at_all_does_not_wipe_the_geometry() -> None:
    """The one case where the strip must NOT run.

    `cloud_paths.ensure_lazy` swallows every R2 error, so "no region measured"
    is equally the signature of a failed staging hydration. Clearing every rect
    on a network blip -- and mirroring THAT manifest back to R2 -- is a bigger
    harm than the stale rects it removes. The resulting page is caught at the
    other end instead (the deploy refuses a frame map over a blank page)."""
    m, note, changed = _packed(
        [{"name": "H1", "x": 0, "y": 0, "w": 64, "h": 64},
         {"name": "L1", "x": 70, "y": 0, "w": 64, "h": 64}], {})
    check("it says nothing was generated", "nothing generated yet" in note,
          True)
    check("the rects are LEFT ALONE", _region(m, "H1")["x"], 0)
    check("nothing is written back", changed, False)
    check("but the risk is spelled out", "do not deploy" in note, True)
    check("...naming the regions still holding a rect",
          "H1" in note and "L1" in note, True)


def test_an_empty_pack_atlas_reports_no_risk() -> None:
    """Nothing generated AND nothing stale: no write, and no scary warning."""
    _m, note, changed = _packed([{"name": "H1"}], {})
    check("still reports the state", "nothing generated yet" in note, True)
    check("asks for no save", changed, False)
    check("and says nothing about deploying", "do not deploy" in note, False)


def test_the_deploy_refuses_a_frame_map_over_a_blank_page() -> None:
    """The other end of the branch above: if compose produced no ink at all,
    every frame would address empty pixels, so no `.json` is written."""
    body = _deploy_body()
    check("a blank composed page is detected", "page_ink" in body, True)
    check("...and refuses the frame map", "REFUSED to write the spritesheet"
          in body, True)


def test_compose_skips_a_pack_region_with_no_rect() -> None:
    """The window this closes: auto_pack strips a rect, then a render commits
    that region's art before the compose subprocess reads the manifest. With
    art but no rect, region_box answers (0, 0, whole page) -- so compose would
    paint ONE symbol across the entire sheet, destroying every other region."""
    check("region_box really does invent a full-page box",
          (lambda: (ba.ATLAS_META.update({"width": 1024, "height": 2048}),
                    ba.region_box({"name": "X"}))[1])(), (0, 0, 1024, 2048))
    ba.ATLAS_META.clear()
    src = Path(ba.__file__).read_text(encoding="utf-8")
    body = src.split("if args.compose_only:")[1].split("\n    # ---- ")[0]
    check("compose skips an unplaced region instead", "_unplaced(region)"
          in body, True)
    check("...and only on a pack layout, where the rect is derived",
          'is_pack = str(atlas.get("layout", ""))' in body, True)


def test_what_compose_skips_never_has_a_frame_to_orphan() -> None:
    """The invariant that makes the compose skip safe to add.

    The worry: compose skipping regions leaves a page with holes, which then
    gets published while those regions still carry rects -- a descriptor
    promising art the page does not have. It cannot happen from THIS skip,
    because the two sets are disjoint by construction: `_unplaced` fires only
    on a region with no complete rect, and a region with no complete rect never
    reaches the frame writer (it goes to `no_rect`). Pinned rather than argued,
    since the argument is the whole reason the skip is allowed to exist."""
    unplaced = {"name": "L1"}                      # no rect -> compose skips
    placed = {"name": "H1", "x": 0, "y": 0, "w": 8, "h": 8}
    check("compose's skip test fires on the rect-less one",
          not all(unplaced.get(k) is not None for k in ("x", "y", "w", "h")),
          True)
    check("...and not on the placed one",
          not all(placed.get(k) is not None for k in ("x", "y", "w", "h")),
          False)
    # The deploy's own test for "can this be a frame" -- same four keys.
    def _framable(r: dict) -> bool:
        try:
            int(r["x"]), int(r["y"]), int(r["w"]), int(r["h"])
        except (KeyError, TypeError, ValueError):
            return False
        return True
    check("so the skipped region is exactly the one with no frame",
          _framable(unplaced), False)
    check("and the composed one keeps its frame", _framable(placed), True)


def _page(size: tuple[int, int], ink: list[tuple[int, int, int, int]]
          ) -> Image.Image:
    """A page alpha channel with opaque art only inside `ink` boxes."""
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    for box in ink:
        img.paste(Image.new("RGBA", (box[2] - box[0], box[3] - box[1]),
                            (255, 0, 0, 255)), (box[0], box[1]))
    return img.getchannel("A")


def test_a_rect_the_page_is_blank_under_is_refused() -> None:
    """The residual the compose skip does NOT cover, and it predates it:
    compose's own 'no generated variant found' drops a region that still holds
    a rect, when its art goes away between Create Atlas measuring it and the
    subprocess. The page then has a hole under a live rect -- a frame the game
    resolves to nothing, which is the quiet version of this whole bug."""
    alpha = _page((128, 128), [(0, 0, 64, 64)])
    painted = {"name": "H1", "x": 0, "y": 0, "w": 64, "h": 64, "rotated": False}
    hole = {"name": "L1", "x": 64, "y": 64, "w": 64, "h": 64, "rotated": False}
    check("a rect with art under it passes",
          u._rect_has_ink(alpha, painted), True)
    check("a rect the page is blank under is caught",
          u._rect_has_ink(alpha, hole), False)


def test_the_blank_rect_test_uses_the_rotated_footprint() -> None:
    """Same trap as the bounds check: the writer never swaps w/h, so a rotated
    region's ink lives in (h x w). Cropping (w x h) would sample the wrong box
    and could report art for a hole (or a hole for art)."""
    # Ink only in the 40-wide x 200-tall strip the rotated region really uses.
    alpha = _page((256, 256), [(0, 0, 40, 200)])
    rot = {"name": "R1", "x": 0, "y": 0, "w": 200, "h": 40, "rotated": True}
    check("the rotated region reads as inked", u._rect_has_ink(alpha, rot),
          True)
    # Its unrotated box reaches into the blank right-hand side, but the ink at
    # the origin means a (w x h) crop would ALSO say "inked" -- so prove the
    # footprint matters with a case where only the true box is empty.
    alpha2 = _page((256, 256), [(60, 0, 200, 40)])
    rot2 = {"name": "R2", "x": 0, "y": 0, "w": 200, "h": 40, "rotated": True}
    check("...and a rotated region whose TRUE footprint is blank is caught "
          "(its unrotated box would have found the ink)",
          u._rect_has_ink(alpha2, rot2), False)


def test_the_blank_rect_guard_is_pack_only_and_reports_either_way() -> None:
    """A bound `.atlas` is authored elsewhere and may legitimately carry an
    empty slot, so there a blank rect is reported, not dropped."""
    body = _deploy_body()
    check("the drop is gated on a pack layout",
          "if blank and _is_pack:" in body, True)
    check("...but the report is not", "region(s) have a rect the page is "
          in body, True)
    check("and it names the cause the user can act on",
          "Re-generate " in body, True)


def test_the_ink_test_has_no_alpha_threshold() -> None:
    """A tolerance here would drop REAL art: the tail of a fade-out, a soft
    glow FX frame, a low-alpha shadow. Those measure non-empty at pack time (so
    they get a rect) and would read as "blank" at deploy under any threshold --
    dropping a frame that is genuinely there. Strict > 0, pinned."""
    faint = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    faint.putpixel((8, 8), (255, 0, 0, 1))   # the faintest possible non-zero
    one = {"name": "F", "x": 0, "y": 0, "w": 16, "h": 16, "rotated": False}
    check("a single alpha=1 pixel counts as ink",
          u._rect_has_ink(faint.getchannel("A"), one), True)
    opaque_but_clear = Image.new("RGBA", (16, 16), (255, 0, 0, 0))
    check("...while coloured-but-fully-transparent does not (the webp page's "
          "gutter is exactly this, and it must not read as art)",
          u._rect_has_ink(opaque_but_clear.getchannel("A"), one), False)


def test_a_dropped_frame_is_attributable_at_both_ends() -> None:
    """The consumer worry: a frame dropped at DEPLOY lands after the flipbook
    clips page's author-time dangling check has already passed, so a clip that
    was valid when authored plays short. It is not silent at either end --
    the deploy names the regions, and the runtime names the clip. Pinned
    together so neither half is removed believing the other covers it."""
    body = _deploy_body()
    check("the deploy says what the drop looks like in the game",
          "playing SHORT" in body, True)
    fb = (Path(u.__file__).parents[2] / "packages" / "pixi-svelte" / "src"
          / "lib" / "components" / "Flipbook.svelte")
    src = fb.read_text(encoding="utf-8") if fb.is_file() else ""
    check("and the runtime reports the missing frames by name",
          "frame(s) missing from loadedAssets" in src, True)
    check("...naming the clip, so it is traceable to a deploy",
          'Flipbook "${clip.id}"' in src, True)


def test_the_parity_scan_reports_instead_of_raising() -> None:
    """batch_atlas.ATLAS_META is never populated in the ui_server process, so
    region_box on a rect-less region raises int(None) there. The inspector
    rendered that TypeError where a verdict belongs."""
    got = u._parity_of({"name": "L1", "output_override": str(Path(u.__file__))},
                       None)
    check("it answers with a verdict", got.get("verdict"), "NO SOURCE")
    check("...that says what is actually wrong",
          "not placed on this page" in got.get("why", ""), True)


def test_a_non_pack_manifest_is_left_completely_alone() -> None:
    """An `.atlas`-bound manifest's geometry is NOT ours to clear."""
    m = {"atlas": {"layout": "grid", "width": 100, "height": 100},
         "regions": [{"name": "H1", "x": 1, "y": 2, "w": 3, "h": 4}]}
    note, changed = u.auto_pack_layout(m)
    check("no note", note, None)
    check("no save", changed, False)
    check("the rect is untouched", _region(m, "H1")["x"], 1)


# --------------------------------------------------------------------------
# 3. The deploy's own guard -- for every manifest already in the bad state
# --------------------------------------------------------------------------
def _frames(regions: list[dict], page: tuple[int, int]) -> dict:
    """Drive the real frame writer the way _deployatlas does."""
    out = Path(tempfile.mkdtemp()) / "sheet.json"
    import atlas_writers
    atlas_writers.write_texturepacker_json(
        out, "sheet.webp", page[0], page[1], regions)
    return json.loads(out.read_text(encoding="utf-8"))


_on_page = u._rect_on_page  # THE shipped predicate, never a copy of it


def test_the_deploy_refuses_a_rect_that_leaves_the_page() -> None:
    """The exact shape of the outage: the page shrank on a re-pack, so the old
    rect now sits past its edge. It is not this region's art by definition."""
    page = (256, 256)
    live = {"name": "H1", "x": 0, "y": 0, "w": 64, "h": 64, "rotated": False}
    stale = {"name": "L1", "x": 700, "y": 400, "w": 120, "h": 120,
             "rotated": False}
    check("the live region passes", _on_page(live, *page), True)
    check("the stale one is refused", _on_page(stale, *page), False)
    doc = _frames([live], page)
    check("only the live frame is written", sorted(doc["frames"]), ["H1.png"])


def test_a_rotated_region_is_checked_at_its_page_footprint() -> None:
    """The writer never swaps w/h, so a rotated region occupies (h x w) on the
    page. Checking (w x h) would pass a rect that overruns the right edge and
    fail one that fits -- both silently wrong."""
    page = (256, 256)
    # Display 200x40; on the page it lies down as 40 wide x 200 tall.
    fits = {"name": "R1", "x": 210, "y": 0, "w": 200, "h": 40, "rotated": True}
    overruns = {"name": "R2", "x": 0, "y": 210, "w": 200, "h": 40,
                "rotated": True}
    check("a rotated region that fits its (h x w) footprint is kept",
          _on_page(fits, *page), True)
    check("...and one that overruns it is refused",
          _on_page(overruns, *page), False)
    check("checking the unrotated size would have got the first one wrong",
          fits["x"] + fits["w"] <= page[0], False)


def test_a_degenerate_rect_is_refused() -> None:
    check("a zero-width rect is not a frame",
          _on_page({"name": "Z", "x": 0, "y": 0, "w": 0, "h": 10,
                    "rotated": False}, 256, 256), False)
    check("nor is a negative origin",
          _on_page({"name": "N", "x": -1, "y": 0, "w": 10, "h": 10,
                    "rotated": False}, 256, 256), False)


def _deploy_body() -> str:
    src = Path(u.__file__).read_text(encoding="utf-8")
    return src.split("def _deployatlas(")[1].split("\n    def _newatlas(")[0]


def test_the_deploy_source_names_what_it_dropped() -> None:
    """A grep, but the cheapest guard against the drop going back to silent."""
    body = _deploy_body()
    check("regions with no rect are collected, not just skipped",
          "no_rect.append" in body, True)
    check("out-of-page regions are collected too",
          "off_page.append" in body, True)
    check("both are reported in the deploy note",
          "DROPPED from the" in body and "no placement on" in body, True)
    check("the bounds check measures the REAL page, not the manifest's claim",
          "_rect_on_page(n, real_w, real_h)" in body, True)
    check("and refusing every region does not report 'no regions[]'",
          "EVERY region was refused" in body, True)


if __name__ == "__main__":
    for fn in (test_a_region_with_no_art_loses_the_previous_packings_rect,
               test_the_trim_geometry_goes_too,
               test_a_never_placed_region_is_not_reported_as_lost,
               test_losing_a_rect_is_said_out_loud,
               test_rotated_regions_is_walked_too,
               test_measuring_nothing_at_all_does_not_wipe_the_geometry,
               test_an_empty_pack_atlas_reports_no_risk,
               test_the_deploy_refuses_a_frame_map_over_a_blank_page,
               test_compose_skips_a_pack_region_with_no_rect,
               test_what_compose_skips_never_has_a_frame_to_orphan,
               test_a_rect_the_page_is_blank_under_is_refused,
               test_the_blank_rect_test_uses_the_rotated_footprint,
               test_the_blank_rect_guard_is_pack_only_and_reports_either_way,
               test_the_ink_test_has_no_alpha_threshold,
               test_a_dropped_frame_is_attributable_at_both_ends,
               test_the_parity_scan_reports_instead_of_raising,
               test_a_non_pack_manifest_is_left_completely_alone,
               test_the_deploy_refuses_a_rect_that_leaves_the_page,
               test_a_rotated_region_is_checked_at_its_page_footprint,
               test_a_degenerate_rect_is_refused,
               test_the_deploy_source_names_what_it_dropped):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
