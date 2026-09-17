"""Offline guard: a re-pack MOVES a frame, it does not re-author it -- and the
alpha trim is optional (no R2, no GPU, no ComfyUI).

Run:  PYTHONIOENCODING=utf-8 PYTHONPATH=".;../_shared" py test_pack_trim.py
      (from services/atlas-tool)

THE FAULT. A flipbook animation re-composed in the Atlas Maker played with the
character "moving up and down left and right in an unnatural way". Live evidence
(invisible_wall/test6, sheet S_New_Squid_Idle, 25 regions): the manifest's
regions carried NO trim metadata in either spelling, and had 24 distinct packed
sizes. `_deployatlas` has to write a `sourceSize`, so with nothing recorded its
`_pick(..., default=rw/rh)` fills the gap with each frame's OWN packed size --
every frame then declares itself its own tight crop, and PIXI anchors each one
on a different centre. The character walks around.

The trim was there when the sheet was authored: `video_to_clip._extract` trims
by alpha but RECORDS the trim ("Trim is recorded, never just applied"), writing
camelCase `offX/offY/origW/origH` where `origW/origH` is the PRE-trim frame. It
was destroyed by `auto_pack_layout`, which re-derives every rect from the art
and then clears `_REPACK_CLEARED_KEYS` -- trim included.

That clear is right about the RECT and wrong about the CANVAS. Where a frame
sits on the page is the packer's to re-derive; what canvas the frame was drawn
on is a property of the source art and is invariant under repacking.

WHAT THIS PINS.
  1. The invariant: after a re-pack, every region's recorded original canvas is
     unchanged from before it -- in whichever spelling the manifest used.
  2. The carry only PRESERVES, never invents: an atlas that recorded no trim
     re-packs exactly as it did before this existed, and art that is no longer
     the crop the record describes drops it, as before.
  3. The option: `atlas.pack_trim: "keep"` packs full canvases, so every frame
     shares ONE canvas and one centre -- with `fit_mode: "contain"` so compose
     pastes verbatim instead of re-centring each frame on its own ink.
  4. IT IS NOT THE PACKER'S SETTING. It governs COMPOSE, on `grid` as much as on
     `pack`: `batch_atlas.fit_to_region` reads it (via ATLAS_META) and a grid
     atlas composes different pixels under the two modes -- §5 below runs both
     and compares. #719 hid the control on `grid` because only
     `auto_pack_layout` called `pack_trim_mode`, which was true and was not the
     question: the cropping went on happening one function along.
  5. `keep` IS THE DEFAULT (owner direction 2026-09-17). Absent, blank and
     unrecognised all read as "do not crop"; a stored `alpha` still wins, and
     nothing rewrites a stored manifest.

Sibling guards, do not break them: `test_auto_pack_clear.py` (the clear itself)
and `test_pack_page_pointer.py` (a Flipbook sheet no longer declares `pack`, so
it never reaches the clear at all).

ASCII only in the labels: a non-Latin-1 glyph aborts the suite on this box's
cp1252 console.
"""
from __future__ import annotations

import contextlib
import sys
import tempfile
from pathlib import Path

from PIL import Image

import batch_atlas
import ui_server as u

FAILED: list[str] = []
PASSED: list[str] = []

CANVAS = 320          # the one canvas every frame of a clip is drawn on
FRAMES = 3
# Per-frame ink box (x, y, w, h) inside that canvas -- deliberately a different
# size AND a different position each time, which is what makes each frame's own
# tight crop a different "original canvas" once the record is gone.
INK = [(40, 50, 60, 70), (55, 44, 72, 66), (38, 61, 64, 80)]


def _say(text: str) -> None:
    enc = sys.stdout.encoding or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def check(label: str, got, want) -> None:
    ok = got == want
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       got  {got!r}\n       want {want!r}")


def _frame(i: int) -> Image.Image:
    """One full CANVAS x CANVAS frame with its ink at INK[i]."""
    im = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    x, y, w, h = INK[i]
    im.paste((255, 0, 0, 255), (x, y, x + w, y + h))
    return im


def _crop_manifest(tmp: Path, camel: bool = True,
                   pack_trim: str = "") -> dict:
    """The shape a Flipbook sheet is in after the Atlas Maker's auto-seed: each
    region's bound art is the page SLICE -- i.e. the already-trimmed crop, at
    exactly the region's recorded w x h -- and the region records the trim that
    says where that crop sat on its CANVAS x CANVAS frame.

    `camel` picks the spelling. Both are real: this tool writes snake_case,
    `video_to_clip` writes camelCase because the launcher's `parseRegions`
    reads only that. `pack_trim` is the stored `atlas.pack_trim`; blank stores
    nothing, which is the un-set manifest and therefore PACK_TRIM_DEFAULT."""
    regions = []
    for i in range(FRAMES):
        x, y, w, h = INK[i]
        crop = _frame(i).crop((x, y, x + w, y + h))
        p = tmp / f"f{i}.png"
        crop.save(p)
        trim = ({"offX": x, "offY": y, "origW": CANVAS, "origH": CANVAS}
                if camel else
                {"off_x": x, "off_y": y, "orig_w": CANVAS, "orig_h": CANVAS})
        regions.append({
            "name": f"Squid_{i:04d}",
            "output_override": str(p),
            # A stale rect from the page this re-pack replaces.
            "x": 700 + i * 20, "y": 900, "w": w, "h": h,
            "rotated": False, "fit_mode": "contain",
            **trim,
        })
    return {"atlas": _atlas(pack_trim), "regions": regions}


def _atlas(pack_trim: str = "", layout: str = "pack") -> dict:
    """An `atlas` block, carrying `pack_trim` only when the case is ABOUT a
    stored value. A fixture that wants the default must store nothing -- writing
    the default's current spelling in would make it pass whatever the default
    became."""
    return {"layout": layout,
            **({"pack_trim": pack_trim} if pack_trim else {})}


def _full_frame_manifest(tmp: Path, pack_trim: str = "") -> dict:
    """The other real shape: the bound art IS the whole canvas (an AI render, or
    a video frame that was never trimmed), and nothing records a trim -- because
    nothing has been cut off yet."""
    regions = []
    for i in range(FRAMES):
        p = tmp / f"full{i}.png"
        _frame(i).save(p)
        regions.append({"name": f"Squid_{i:04d}", "output_override": str(p)})
    return {"atlas": _atlas(pack_trim), "regions": regions}


def _sourcesize(n: dict) -> tuple[int, int]:
    """What `_deployatlas` will write as this frame's `sourceSize`. Mirrors its
    `_pick("orig_w", "origW", default=rw)` -- the default that turns a missing
    record into "this frame's canvas is its own crop"."""
    return (int(n.get("orig_w", n["w"])), int(n.get("orig_h", n["h"])))


def _offset(n: dict) -> tuple[int, int]:
    return (int(n.get("off_x", 0)), int(n.get("off_y", 0)))


@contextlib.contextmanager
def _active(m: dict):
    """Make `m` the manifest compose is running for.

    `batch_atlas.ATLAS_META` IS `manifest["atlas"]` -- `batch_atlas.main` stamps
    it before composing a page, and `fit_to_region` reads the Frame trim off it
    the same way `region_box` reads the cell size. A fixture that calls
    `fit_to_region` without setting it is composing for SOME OTHER atlas."""
    snapshot = dict(batch_atlas.ATLAS_META)
    batch_atlas.ATLAS_META.clear()
    batch_atlas.ATLAS_META.update(m.get("atlas") or {})
    try:
        yield
    finally:
        batch_atlas.ATLAS_META.clear()
        batch_atlas.ATLAS_META.update(snapshot)


def _canvases(m: dict) -> list[tuple]:
    """Each region's recorded original canvas, read the way every consumer reads
    it (either spelling)."""
    return [(u._recorded_trim(r) or (None, None, None, None))[2:]
            for r in m["regions"]]


# --------------------------------------------------------------------------
# 1. The invariant.
# --------------------------------------------------------------------------

def test_the_recorded_canvas_survives_a_repack() -> None:
    with tempfile.TemporaryDirectory() as td:
        m = _crop_manifest(Path(td))
        before = _canvases(m)
        rects_before = [(r["w"], r["h"]) for r in m["regions"]]
        note, changed = u.auto_pack_layout(m)
        check("it really re-packed", (bool(changed), "Auto-packed 3" in note),
              (True, True))
        check("every frame's original canvas is unchanged",
              _canvases(m), before)
        check("...and is the ONE canvas they were drawn on",
              set(_canvases(m)), {(CANVAS, CANVAS)})
        check("the offsets still place each crop where it was",
              [(u._recorded_trim(r) or ())[:2] for r in m["regions"]],
              [(x, y) for x, y, _w, _h in INK])
        check("the rects themselves are still the tight crops",
              [(r["w"], r["h"]) for r in m["regions"]], rects_before)
        check("...and were MOVED onto the new page",
              [(r["x"], r["y"]) for r in m["regions"]]
              != [(700, 900), (720, 900), (740, 900)], True)


def test_the_spelling_the_manifest_uses_is_the_spelling_kept() -> None:
    """Writing the wrong spelling back is the same data loss with extra steps:
    the launcher's `parseRegions` reads ONLY camelCase, this tool's own readers
    take either. Match the producer, don't convert it."""
    for camel in (True, False):
        with tempfile.TemporaryDirectory() as td:
            m = _crop_manifest(Path(td), camel=camel)
            u.auto_pack_layout(m)
            r = m["regions"][0]
            want = ["offX", "offY", "origW", "origH"] if camel else [
                "off_x", "off_y", "orig_w", "orig_h"]
            unwanted = ["off_x", "orig_w"] if camel else ["offX", "origW"]
            check(f"camel={camel}: the four fields are written back",
                  [k for k in want if k in r], want)
            check(f"camel={camel}: and not in the other spelling",
                  [k for k in unwanted if k in r], [])


def test_the_kept_canvas_reaches_the_deploy_normalizer() -> None:
    """Stated where it is observable. `_deployatlas`'s fallback fills a missing
    `orig_*` with the frame's own packed size, so "the record survived" is only
    meaningful if the reader that builds the TexturePacker frame sees it."""
    with tempfile.TemporaryDirectory() as td:
        m = _crop_manifest(Path(td))
        u.auto_pack_layout(m)
        normed = [u._normalize_converted_region(r) for r in m["regions"]]
        check("every deployed frame declares the SAME sourceSize",
              {_sourcesize(n) for n in normed}, {(CANVAS, CANVAS)})
        check("...and a spriteSourceSize that differs per frame (the trim)",
              len({_offset(n) for n in normed}), FRAMES)


def test_a_carried_trim_does_not_stretch_the_art_on_compose() -> None:
    """The objection #683 raised against keeping `orig_*`: `fit_to_region`
    reads its mere PRESENCE as `spine_slot` and flips the default from
    `contain` to `fill`. Harmless HERE, and worth pinning rather than
    asserting: the rect a re-pack stamps is derived from the art's OWN alpha
    bbox, so the slot's aspect is the art's aspect and fill == contain. Note
    what is NOT done as a result -- no `fit_mode` is stamped in alpha mode.
    Explicit `contain` would route to `_packer_compose_tile`, which does not
    alpha-crop, and would shrink the whole canvas into the bbox-sized rect.

    `alpha` is stored EXPLICITLY: this case is about that mode, and a stored
    value is unaffected by what the default is."""
    with tempfile.TemporaryDirectory() as td:
        m = _crop_manifest(Path(td), pack_trim="alpha")
        u.auto_pack_layout(m)
        r = m["regions"][1]
        check("alpha mode stamps no placement contract", "fit_mode" in r, False)
        was, batch_atlas.PADDING_PCT = batch_atlas.PADDING_PCT, 0.0
        try:
            src = Image.open(r["output_override"]).convert("RGBA")
            with _active(m):
                out = batch_atlas.fit_to_region(src, r)
        finally:
            batch_atlas.PADDING_PCT = was
        check("...and the tile is the crop, pixel for pixel",
              (out.size, out.tobytes() == src.tobytes()),
              ((r["w"], r["h"]), True))


# --------------------------------------------------------------------------
# 2. The carry only preserves -- it never invents.
# --------------------------------------------------------------------------

def test_an_atlas_that_recorded_no_trim_still_gets_none() -> None:
    """`alpha` must stay byte-identical to the behaviour every existing atlas
    was packed with. Inventing `orig_* = the render canvas` here would re-base
    every already-shipped symbol sheet."""
    with tempfile.TemporaryDirectory() as td:
        m = _full_frame_manifest(Path(td), pack_trim="alpha")
        u.auto_pack_layout(m)
        check("no trim was synthesized",
              [k for r in m["regions"] for k in u._TRIM_CAMEL
               if k in r or u._TRIM_CAMEL[k] in r], [])
        check("and the rect is still the alpha bbox",
              [(r["w"], r["h"]) for r in m["regions"]],
              [(w, h) for _x, _y, w, h in INK])
        check("no fit_mode is stamped either",
              [r.get("fit_mode") for r in m["regions"]], [None] * FRAMES)


def test_art_that_is_no_longer_that_crop_drops_the_record() -> None:
    """A regenerated region's art is NEW. The canvas the old record names then
    describes nothing, so it goes -- exactly as it did before this change."""
    with tempfile.TemporaryDirectory() as td:
        m = _crop_manifest(Path(td))
        # Re-render region 0 at a size that is not the crop it recorded.
        p = Path(td) / "regen.png"
        im = Image.new("RGBA", (200, 150), (0, 0, 0, 0))
        im.paste((0, 255, 0, 255), (10, 10, 90, 90))
        im.save(p)
        m["regions"][0]["output_override"] = str(p)
        u.auto_pack_layout(m)
        check("the regenerated region keeps no stale canvas",
              u._recorded_trim(m["regions"][0]), None)
        check("its untouched siblings keep theirs",
              _canvases(m)[1:], [(CANVAS, CANVAS)] * (FRAMES - 1))


def test_pack_trim_mode_normalizes_to_not_cropping() -> None:
    """The default is `keep` (owner direction 2026-09-17): an atlas that never
    set this is not cropped. Only a STORED `alpha` crops."""
    check("absent", u.pack_trim_mode({"atlas": {"layout": "pack"}}), "keep")
    check("empty", u.pack_trim_mode({"atlas": {"pack_trim": ""}}), "keep")
    check("whitespace", u.pack_trim_mode({"atlas": {"pack_trim": "   "}}),
          "keep")
    check("nonsense", u.pack_trim_mode({"atlas": {"pack_trim": "yes"}}), "keep")
    check("no atlas block at all", u.pack_trim_mode({}), "keep")
    check("keep", u.pack_trim_mode({"atlas": {"pack_trim": "KEEP "}}), "keep")
    check("a stored alpha still wins",
          u.pack_trim_mode({"atlas": {"pack_trim": "alpha"}}), "alpha")
    check("...in any case/whitespace",
          u.pack_trim_mode({"atlas": {"pack_trim": " ALPHA "}}), "alpha")
    check("the constant says so", u.PACK_TRIM_DEFAULT, "keep")
    check("and the panel and the compose path share ONE normalizer",
          u.pack_trim_mode is batch_atlas.pack_trim_mode, True)
    check("...and one default",
          u.PACK_TRIM_DEFAULT, batch_atlas.PACK_TRIM_DEFAULT)
    check("every offered choice is a mode the compose path knows",
          sorted(u.PACK_TRIM_MODES), sorted(batch_atlas.PACK_TRIM_MODES))


# --------------------------------------------------------------------------
# 3. The option: keep the full frame.
# --------------------------------------------------------------------------

def test_alpha_mode_is_what_scatters_the_centres() -> None:
    """The control for the test below: this is the reported symptom, reproduced.
    Untrimmed art + `alpha` = one distinct 'original canvas' per frame once the
    deploy fills the missing record in."""
    with tempfile.TemporaryDirectory() as td:
        m = _full_frame_manifest(Path(td), pack_trim="alpha")
        u.auto_pack_layout(m)
        normed = [u._normalize_converted_region(r) for r in m["regions"]]
        check("each frame declares its own canvas",
              len({_sourcesize(n) for n in normed}), FRAMES)


def test_keep_gives_every_frame_one_common_canvas() -> None:
    with tempfile.TemporaryDirectory() as td:
        m = _full_frame_manifest(Path(td))
        m["atlas"]["pack_trim"] = "keep"
        note, changed = u.auto_pack_layout(m)
        check("it packed", bool(changed), True)
        check("...and says so", "full frames kept" in (note or ""), True)
        check("every rect is the whole frame",
              {(r["w"], r["h"]) for r in m["regions"]}, {(CANVAS, CANVAS)})
        normed = [u._normalize_converted_region(r) for r in m["regions"]]
        check("so every deployed frame shares ONE canvas",
              {_sourcesize(n) for n in normed}, {(CANVAS, CANVAS)})
        check("...at a zero offset -- one common centre",
              {_offset(n) for n in normed}, {(0, 0)})


def test_keep_stamps_the_contain_contract_so_compose_pastes_verbatim() -> None:
    """Without an explicit `contain`, `fit_to_region` falls to its legacy path:
    alpha-crop the art and re-centre it in the rect -- which would put the
    per-frame centre straight back, at a uniform size. Explicit `contain` runs
    `_packer_compose_tile`, and rect == image size makes that a pass-through."""
    with tempfile.TemporaryDirectory() as td:
        m = _full_frame_manifest(Path(td))
        m["atlas"]["pack_trim"] = "keep"
        u.auto_pack_layout(m)
        check("every placed region is pasted verbatim",
              [r.get("fit_mode") for r in m["regions"]], ["contain"] * FRAMES)
        # Prove it end to end: the composed tile must be the frame unchanged.
        # Through `_active`, so `fit_to_region` reads the same Frame trim the
        # compose subprocess would -- under `keep` it skips the alpha crop AND
        # the sheet-parity short-circuit, and rect == canvas makes `contain`
        # a 1.0 scale pasted at (0, 0).
        r = m["regions"][1]
        src = Image.open(r["output_override"]).convert("RGBA")
        with _active(m):
            out = batch_atlas.fit_to_region(src, r)
        check("...and the tile compose produces is the frame, pixel for pixel",
              (out.size, out.tobytes() == src.tobytes()),
              ((CANVAS, CANVAS), True))


def test_keep_says_so_when_it_did_not_deliver_one_centre() -> None:
    """`keep` keeps the canvas each region's COMMITTED ART is on. That is the
    whole of what it can do: it cannot give back a canvas the art was already
    cropped to, and it does not make two differently-sized renders agree.

    This is not hypothetical. On the sheet that prompted the setting the bound
    art is NOT the sheet page -- the page's cells are fully opaque 320x320, and
    were measured 0/25 against the manifest's rects -- so what the packer trims
    is each region's generated/background-removed variant. If those variants
    disagree on canvas size (a region re-rendered after a gen-size change,
    `gpt_image_size: match_ref`, a hand-uploaded image), `keep` packs full
    frames that still do not line up. Label it honestly rather than let the
    headline claim a centre it did not produce."""
    with tempfile.TemporaryDirectory() as td:
        m = _full_frame_manifest(Path(td))
        m["atlas"]["pack_trim"] = "keep"
        # One region re-rendered on a different canvas.
        odd = Path(td) / "odd.png"
        im = Image.new("RGBA", (200, 260), (0, 0, 0, 0))
        im.paste((0, 0, 255, 255), (20, 20, 120, 160))
        im.save(odd)
        m["regions"][2]["output_override"] = str(odd)
        note, _changed = u.auto_pack_layout(m)
        check("the mismatch is named, not glossed over",
              "do NOT share one centre" in (note or ""), True)
        check("...and the sizes it found are shown",
              ("200x260" in (note or "").replace("×", "x")
               or "200×260" in (note or "")), True)


def test_keep_is_silent_when_it_did_deliver() -> None:
    """The converse, so the warning cannot become noise that gets ignored."""
    with tempfile.TemporaryDirectory() as td:
        m = _full_frame_manifest(Path(td))
        m["atlas"]["pack_trim"] = "keep"
        note, _changed = u.auto_pack_layout(m)
        check("no warning when the canvases agree",
              "do NOT share one centre" in (note or ""), False)


def test_keep_still_carries_a_recorded_trim() -> None:
    """The two are orthogonal. `keep` controls how much of the AVAILABLE art is
    packed; the carry preserves what the art's canvas was recorded to be. A
    sheet whose bound art is already a crop cannot get its margins back, so it
    keeps needing the record."""
    with tempfile.TemporaryDirectory() as td:
        m = _crop_manifest(Path(td))
        m["atlas"]["pack_trim"] = "keep"
        u.auto_pack_layout(m)
        check("the recorded canvas is still the one canvas",
              set(_canvases(m)), {(CANVAS, CANVAS)})


# --------------------------------------------------------------------------
# 4. The deploy no longer invents a canvas in silence.
# --------------------------------------------------------------------------

def test_deploy_names_the_corruption_signature() -> None:
    """`_deployatlas` needs a live handler + R2, so this pins the guard by
    source: the condition, and that it reads real trim rather than the `_pick`
    default it is warning about."""
    src = Path("ui_server.py").read_text(encoding="utf-8")
    body = src.split("def _deployatlas(")[1].split("\n    def ")[0]
    check("it counts regions that carry a REAL trim record",
          "_recorded_trim(r) is not None" in body, True)
    check("...gated on a pack atlas with no trim and mixed frame sizes",
          "_is_pack and tp_regions and trimmed_count == 0" in body
          and "len(framed_sizes) > 1" in body, True)
    check("...and the note names both remedies it has",
          ("keep the whole frame" in body, "Flipbook" in body),
          (True, True))


# --------------------------------------------------------------------------
# 5. THE GRID. Frame trim governs COMPOSE, so it is live under both layouts.
#
# #719 hid this control on a `grid` atlas, having measured that
# `pack_trim_mode` is called at exactly one place -- inside `auto_pack_layout`.
# That was true, and it was not the question: nothing about a grid rect needs
# the art measured (the cell IS the layout), but the ART still has to be placed
# INTO that rect, and `batch_atlas.fit_to_region` crops it to its alpha to do
# it. The owner lost the only say he had over cropping that was still going on.
#
# The shape below is the real one: `video_to_refs` exports a `grid` atlas whose
# page and cell size the author typed, and stamps its `fit` choice --
# `DEFAULT_FIT = "contain"` -- on every region.
# --------------------------------------------------------------------------

MOVE = [(40, 40), (100, 40), (160, 120)]   # the SAME ink, walked across
MOVE_SIZE = 60


def _moving_frame(i: int) -> Image.Image:
    """Frame `i` of an animation: one identical MOVE_SIZE square, drawn where
    the animator put it on the shared CANVAS x CANVAS canvas.

    Identical INK is the whole point. It makes the two modes answer a question
    with one right answer: whatever compose does to the art, the three tiles
    must still differ, because the only thing that distinguishes these frames is
    WHERE the square sits. Three identical tiles = the animation is gone."""
    im = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    x, y = MOVE[i]
    im.paste((255, 0, 0, 255), (x, y, x + MOVE_SIZE, y + MOVE_SIZE))
    return im


def _grid_manifest(tmp: Path, cell: tuple[int, int], pack_trim: str = "",
                   fit: str = "contain") -> dict:
    """A `grid` atlas in the shape 🖼 To Atlas Maker exports, with its frames
    committed as bound art. The page is one row of cells, so `grid_layout` has
    room for every frame."""
    regions = []
    for i in range(FRAMES):
        p = tmp / f"move{i}.png"
        _moving_frame(i).save(p)
        regions.append({"name": f"Squid_{i:04d}", "output_override": str(p),
                        "fit_mode": fit})
    atlas = _atlas(pack_trim, layout="grid")
    atlas.update(width=cell[0] * FRAMES, height=cell[1],
                 cell_width=cell[0], cell_height=cell[1])
    return {"atlas": atlas, "regions": regions}


def _composed_tiles(m: dict) -> list[Image.Image]:
    """What Create Atlas would paste onto the page, per region, through the
    REAL layout pass and the REAL `fit_to_region`.

    PADDING_PCT is pinned to 0 for the duration: it is a global config knob that
    only exists on the alpha path, and these cases are about WHERE the art
    lands, not about how much margin a crop is given."""
    note, _changed = u.grid_layout(m)
    if not note or note.startswith("⚠"):
        raise AssertionError(f"grid_layout refused to lay this out: {note}")
    was, batch_atlas.PADDING_PCT = batch_atlas.PADDING_PCT, 0.0
    try:
        with _active(m):
            return [batch_atlas.fit_to_region(
                Image.open(r["output_override"]).convert("RGBA"), r)
                for r in m["regions"]]
    finally:
        batch_atlas.PADDING_PCT = was


def _ink(im: Image.Image) -> tuple[int, int, int, int] | None:
    return im.getchannel("A").getbbox()


def test_a_grid_atlas_composes_different_pixels_under_the_two_modes() -> None:
    """THE ask, stated as pixels. Not "the manifest field round-trips" -- the
    page itself has to come out different, or the control is decoration."""
    for cell in ((400, 400), (260, 200), (200, 200)):
        with tempfile.TemporaryDirectory() as td:
            a = _composed_tiles(_grid_manifest(Path(td), cell,
                                               pack_trim="alpha"))
            k = _composed_tiles(_grid_manifest(Path(td), cell,
                                               pack_trim="keep"))
            check(f"cell {cell[0]}x{cell[1]}: the two modes place the art "
                  f"differently",
                  [x.tobytes() for x in a] == [x.tobytes() for x in k], False)
            check(f"...on the same {cell[0]}x{cell[1]} cell either way",
                  {x.size for x in a} | {x.size for x in k}, {cell})


def test_alpha_on_a_grid_flattens_the_animation() -> None:
    """The symptom, reproduced on a grid. Crop each frame to its own ink and the
    three frames of this clip become the SAME PICTURE: the square is cut out of
    the canvas that said where it was, then re-placed by the cell. Byte-for-byte
    identical tiles, and a character that stands still while the clip plays."""
    with tempfile.TemporaryDirectory() as td:
        tiles = _composed_tiles(_grid_manifest(Path(td), (400, 400),
                                               pack_trim="alpha"))
        check("all three frames composed to the same pixels",
              tiles[0].tobytes() == tiles[1].tobytes() == tiles[2].tobytes(),
              True)
        check("...with the ink pinned to one box",
              len({_ink(t) for t in tiles}), 1)


def test_keep_on_a_grid_keeps_the_motion_the_art_was_drawn_with() -> None:
    """The converse, and the arithmetic: the canvas maps into the cell by ONE
    transform, so the square lands where the animator put it, scaled. A 320
    canvas in a 400 cell is scaled by 1.25, so the authored 60px step must come
    out as exactly 75px -- measured off the composed tiles, not asserted."""
    with tempfile.TemporaryDirectory() as td:
        tiles = _composed_tiles(_grid_manifest(Path(td), (400, 400),
                                               pack_trim="keep"))
        boxes = [_ink(t) for t in tiles]
        check("no two frames are the same picture",
              len({t.tobytes() for t in tiles}), FRAMES)
        scale = 400 / CANVAS
        want = [(round(x * scale), round(y * scale)) for x, y in MOVE]
        got = [(b[0], b[1]) for b in boxes]
        # LANCZOS rings a hard edge by a pixel or two either way, so the ink box
        # is compared to within 3px. The failure this guards is measured in tens
        # of pixels (the alpha path above pins all three at 170,170).
        check("every frame lands where it was drawn, scaled into the cell",
              [abs(g[0] - w[0]) <= 3 and abs(g[1] - w[1]) <= 3
               for g, w in zip(got, want)], [True] * FRAMES)
        check("...so the authored 60px step is a 75px step on the page",
              [(got[i + 1][0] - got[i][0], got[i + 1][1] - got[i][1])
               for i in range(FRAMES - 1)],
              [(round((MOVE[i + 1][0] - MOVE[i][0]) * scale),
                round((MOVE[i + 1][1] - MOVE[i][1]) * scale))
               for i in range(FRAMES - 1)])


def test_a_grid_cell_of_another_aspect_crops_under_alpha_and_not_under_keep(
) -> None:
    """The case that makes `fit_mode:"contain"` no defence on its own. An
    explicit `contain` short-circuits to `_packer_compose_tile`, which scales the
    whole canvas but CENTRES IT BY THE INK -- so the moment the scaled canvas
    does not exactly fill the cell (a different aspect, or a cell bigger than the
    canvas) every frame is re-centred on its own square again."""
    with tempfile.TemporaryDirectory() as td:
        a = _composed_tiles(_grid_manifest(Path(td), (260, 200),
                                           pack_trim="alpha"))
        k = _composed_tiles(_grid_manifest(Path(td), (260, 200),
                                           pack_trim="keep"))
        check("alpha pins every frame's ink to one box",
              len({_ink(t) for t in a}), 1)
        check("keep moves it, frame by frame", len({_ink(t) for t in k}),
              FRAMES)


def test_every_fit_mode_is_ink_blind_under_keep() -> None:
    """`fit_mode` says HOW the element maps into the cell; Frame trim says WHAT
    the element is. Under `keep` the element is the whole canvas for all three,
    so all three keep the motion -- including `fill` and `cover`, which under
    `alpha` stretch each frame's own crop to the cell and flatten the clip."""
    for fit in ("contain", "cover", "fill"):
        with tempfile.TemporaryDirectory() as td:
            a = _composed_tiles(_grid_manifest(Path(td), (400, 400),
                                               pack_trim="alpha", fit=fit))
            k = _composed_tiles(_grid_manifest(Path(td), (400, 400),
                                               pack_trim="keep", fit=fit))
            check(f"fit={fit}: alpha composes one picture three times",
                  len({t.tobytes() for t in a}), 1)
            check(f"fit={fit}: keep composes three",
                  len({t.tobytes() for t in k}), FRAMES)


def test_frame_trim_is_read_off_the_manifest_compose_is_running() -> None:
    """How it reaches `fit_to_region` at all: `ATLAS_META` IS the active
    manifest's `atlas` block. Pinned because the wiring is invisible -- the
    function takes an image and a region, and the setting is on neither."""
    with tempfile.TemporaryDirectory() as td:
        m = _grid_manifest(Path(td), (400, 400), pack_trim="keep")
        u.grid_layout(m)
        r = m["regions"][2]
        src = Image.open(r["output_override"]).convert("RGBA")
        batch_atlas.ATLAS_META.clear()      # no active manifest at all
        blind = batch_atlas.fit_to_region(src, r)
        with _active(m):
            aware = batch_atlas.fit_to_region(src, r)
        check("with no active manifest it falls back to the alpha dispatch",
              blind.tobytes() == aware.tobytes(), False)
        check("...and with this one active, the frame keeps its place",
              _ink(aware)[0] > _ink(blind)[0], True)


def test_a_manifest_this_tool_did_not_lay_out_is_never_re_interpreted() -> None:
    """THE GATE, and the reason the flip is safe to ship. `keep_full_frame` asks
    `is_from_scratch` first, so a `.atlas`-bound rig slot, a Sheet-Maker cell and
    a legacy cell-grid region compose byte-for-byte as before no matter what
    `pack_trim` says -- none of their rects was derived from the art, so none of
    them may be re-read by a setting last touched on some other atlas."""
    with tempfile.TemporaryDirectory() as td:
        base = _grid_manifest(Path(td), (400, 400), pack_trim="keep")
        for layout, bound in (("", {}), ("", {"atlas_file": "symbols.atlas"}),
                              ("freeform", {})):
            m = {"atlas": {**{k: v for k, v in base["atlas"].items()
                              if k != "layout"}, **bound},
                 "regions": [dict(r) for r in base["regions"]]}
            if layout:
                m["atlas"]["layout"] = layout
            for r in m["regions"]:
                r.update(x=0, y=0, w=400, h=400)
            was, batch_atlas.PADDING_PCT = batch_atlas.PADDING_PCT, 0.0
            try:
                with _active(m):
                    got = [batch_atlas.fit_to_region(
                        Image.open(r["output_override"]).convert("RGBA"), r)
                        for r in m["regions"]]
                plain = [batch_atlas.fit_to_region(
                    Image.open(r["output_override"]).convert("RGBA"), r)
                    for r in m["regions"]]
            finally:
                batch_atlas.PADDING_PCT = was
            check(f"layout={layout!r} bound={bool(bound)}: pack_trim is not "
                  f"read at all",
                  [g.tobytes() for g in got] == [p.tobytes() for p in plain],
                  True)
            check("...and that IS the alpha dispatch (one picture, three times)",
                  len({g.tobytes() for g in got}), 1)
        check("the gate is one function, and it asks is_from_scratch",
              (batch_atlas.keep_full_frame({"atlas": {"layout": "grid",
                                                      "pack_trim": "keep"}}),
               batch_atlas.keep_full_frame({"atlas": {"layout": "pack"}}),
               batch_atlas.keep_full_frame({"atlas": {"pack_trim": "keep"}})),
              (True, True, False))
        # ...and `is_atlas_bound` too. Both CAN be set at once -- the Source
        # .atlas row renders on every panel, so a path typed onto a `pack`
        # atlas leaves `layout` and `atlas_file` together, and compose then
        # takes its geometry from the `.atlas` while `is_from_scratch` still
        # says True. Those rects are a rig's authored footprints.
        check("a bound atlas is never re-read, whatever its layout says",
              [batch_atlas.keep_full_frame(
                  {"atlas": {"layout": L, "pack_trim": "keep",
                             "atlas_file": "symbols.atlas"}})
               for L in ("pack", "grid", "")], [False, False, False])


# --------------------------------------------------------------------------
# 6. THE DEFAULT FLIP. What it does, and what it deliberately does not do.
# --------------------------------------------------------------------------

def test_the_inspector_says_what_compose_will_do() -> None:
    """`ui_server._placement_mode` is documented as mirroring `fit_to_region`'s
    dispatch exactly, and the Region Overlay Inspector prints it per region.
    Under `keep` the sheet-parity branch is not taken, so it must stop saying it
    is -- an inspector that names a branch compose does not run is worse than no
    inspector, because it is the thing you check WHEN the pixels surprise you."""
    r = {"name": "f", "x": 0, "y": 0, "w": 400, "h": 400, "fit_mode": "contain"}
    check("alpha: an explicit contain still reads as sheet parity",
          u._placement_mode(r)["key"], "parity")
    keep = u._placement_mode(r, True)
    check("keep: it reads as contain instead", keep["key"], "contain")
    check("...and says the art is not cropped", "no crop" in keep["note"], True)
    src = Path("ui_server.py").read_text(encoding="utf-8")
    check("...and the page asks the manifest, not the region",
          "_view_region(r, keep_full)" in src
          and "keep_full = batch_atlas.keep_full_frame(m)" in src, True)


def test_keep_does_not_re_pad_a_frame_it_never_cropped() -> None:
    """The other half of "nothing alpha-derived runs": `padding_pct` is margin
    for a TIGHT CROP -- room so a symbol cut to its ink does not touch the edges
    of its slot. The authored canvas already carries whatever margin the art
    has, so re-padding it shrinks the frame inside its own rect: on `pack`,
    where the rect IS the canvas, an 8% pad means the whole frame is scaled to
    ~86% and the clip plays smaller than it was drawn.

    Run at a REAL padding (the shipped config is a live knob, and every other
    fit_to_region case here pins it to 0 to take it out of the arithmetic)."""
    with tempfile.TemporaryDirectory() as td:
        m = _full_frame_manifest(Path(td), pack_trim="keep")
        u.auto_pack_layout(m)
        r = m["regions"][1]
        src = Image.open(r["output_override"]).convert("RGBA")
        was, batch_atlas.PADDING_PCT = batch_atlas.PADDING_PCT, 0.1
        try:
            with _active(m):
                kept = batch_atlas.fit_to_region(src, r)
            alpha = dict(m["atlas"], pack_trim="alpha")
            with _active({"atlas": alpha}):
                cropped = batch_atlas.fit_to_region(src, dict(r,
                                                              fit_mode=""))
        finally:
            batch_atlas.PADDING_PCT = was
        check("keep places the frame 1:1, padding or no padding",
              (kept.size, kept.tobytes() == src.tobytes()),
              ((CANVAS, CANVAS), True))
        check("...while the alpha path does inset it, which is what the "
              "padding is for",
              cropped.tobytes() == src.tobytes(), False)


def test_an_atlas_with_an_explicit_choice_is_unaffected_by_the_flip() -> None:
    """A stored value is a decision, and the flip does not revisit it. The pair
    is run side by side so the assertion is a DIFFERENCE, not two absolutes that
    could both drift."""
    with tempfile.TemporaryDirectory() as td:
        stored = _full_frame_manifest(Path(td), pack_trim="alpha")
        u.auto_pack_layout(stored)
        check("a stored alpha still packs the tight crop",
              [(r["w"], r["h"]) for r in stored["regions"]],
              [(w, h) for _x, _y, w, h in INK])
        check("...and is still what the manifest says",
              stored["atlas"]["pack_trim"], "alpha")
        unset = _full_frame_manifest(Path(td))
        u.auto_pack_layout(unset)
        check("while an atlas that never chose now packs the whole frame",
              {(r["w"], r["h"]) for r in unset["regions"]},
              {(CANVAS, CANVAS)})


def test_the_new_default_is_never_written_into_a_manifest() -> None:
    """Not silently rewritten, in either direction: an atlas that never set this
    still has no `pack_trim` after a re-pack. The default lives in ONE place,
    so changing it again later changes every un-set atlas -- which is the point
    of a default and the opposite of a migration."""
    with tempfile.TemporaryDirectory() as td:
        m = _full_frame_manifest(Path(td))
        check("nothing stored to begin with", "pack_trim" in m["atlas"], False)
        u.auto_pack_layout(m)
        check("...and nothing stored after a full re-pack",
              "pack_trim" in m["atlas"], False)
        check("...though it reads as the default meanwhile",
              u.pack_trim_mode(m), "keep")


if __name__ == "__main__":
    for fn in (test_the_recorded_canvas_survives_a_repack,
               test_the_spelling_the_manifest_uses_is_the_spelling_kept,
               test_the_kept_canvas_reaches_the_deploy_normalizer,
               test_a_carried_trim_does_not_stretch_the_art_on_compose,
               test_an_atlas_that_recorded_no_trim_still_gets_none,
               test_art_that_is_no_longer_that_crop_drops_the_record,
               test_pack_trim_mode_normalizes_to_not_cropping,
               test_alpha_mode_is_what_scatters_the_centres,
               test_keep_gives_every_frame_one_common_canvas,
               test_keep_stamps_the_contain_contract_so_compose_pastes_verbatim,
               test_keep_says_so_when_it_did_not_deliver_one_centre,
               test_keep_is_silent_when_it_did_deliver,
               test_keep_still_carries_a_recorded_trim,
               test_deploy_names_the_corruption_signature,
               test_a_grid_atlas_composes_different_pixels_under_the_two_modes,
               test_alpha_on_a_grid_flattens_the_animation,
               test_keep_on_a_grid_keeps_the_motion_the_art_was_drawn_with,
               test_a_grid_cell_of_another_aspect_crops_under_alpha_and_not_under_keep,
               test_every_fit_mode_is_ink_blind_under_keep,
               test_frame_trim_is_read_off_the_manifest_compose_is_running,
               test_a_manifest_this_tool_did_not_lay_out_is_never_re_interpreted,
               test_the_inspector_says_what_compose_will_do,
               test_keep_does_not_re_pad_a_frame_it_never_cropped,
               test_an_atlas_with_an_explicit_choice_is_unaffected_by_the_flip,
               test_the_new_default_is_never_written_into_a_manifest):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
