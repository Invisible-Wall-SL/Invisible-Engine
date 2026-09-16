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
     re-packs exactly as it did before this existed (the default), and art that
     is no longer the crop the record describes drops it, as before.
  3. The option: `atlas.pack_trim: "keep"` packs full canvases, so every frame
     shares ONE canvas and one centre -- with `fit_mode: "contain"` so compose
     pastes verbatim instead of re-centring each frame on its own ink.

Sibling guards, do not break them: `test_auto_pack_clear.py` (the clear itself)
and `test_pack_page_pointer.py` (a Flipbook sheet no longer declares `pack`, so
it never reaches the clear at all).

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


def _crop_manifest(tmp: Path, camel: bool = True) -> dict:
    """The shape a Flipbook sheet is in after the Atlas Maker's auto-seed: each
    region's bound art is the page SLICE -- i.e. the already-trimmed crop, at
    exactly the region's recorded w x h -- and the region records the trim that
    says where that crop sat on its CANVAS x CANVAS frame.

    `camel` picks the spelling. Both are real: this tool writes snake_case,
    `video_to_clip` writes camelCase because the launcher's `parseRegions`
    reads only that."""
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
    return {"atlas": {"layout": "pack"}, "regions": regions}


def _full_frame_manifest(tmp: Path) -> dict:
    """The other real shape: the bound art IS the whole canvas (an AI render, or
    a video frame that was never trimmed), and nothing records a trim -- because
    nothing has been cut off yet."""
    regions = []
    for i in range(FRAMES):
        p = tmp / f"full{i}.png"
        _frame(i).save(p)
        regions.append({"name": f"Squid_{i:04d}", "output_override": str(p)})
    return {"atlas": {"layout": "pack"}, "regions": regions}


def _sourcesize(n: dict) -> tuple[int, int]:
    """What `_deployatlas` will write as this frame's `sourceSize`. Mirrors its
    `_pick("orig_w", "origW", default=rw)` -- the default that turns a missing
    record into "this frame's canvas is its own crop"."""
    return (int(n.get("orig_w", n["w"])), int(n.get("orig_h", n["h"])))


def _offset(n: dict) -> tuple[int, int]:
    return (int(n.get("off_x", 0)), int(n.get("off_y", 0)))


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
    alpha-crop, and would shrink the whole canvas into the bbox-sized rect."""
    import batch_atlas
    with tempfile.TemporaryDirectory() as td:
        m = _crop_manifest(Path(td))
        u.auto_pack_layout(m)
        r = m["regions"][1]
        check("alpha mode stamps no placement contract", "fit_mode" in r, False)
        was, batch_atlas.PADDING_PCT = batch_atlas.PADDING_PCT, 0.0
        try:
            src = Image.open(r["output_override"]).convert("RGBA")
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
    """The default must be byte-identical to the behaviour every existing atlas
    was packed with. Inventing `orig_* = the render canvas` here would re-base
    every already-shipped symbol sheet."""
    with tempfile.TemporaryDirectory() as td:
        m = _full_frame_manifest(Path(td))
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


def test_pack_trim_mode_normalizes_to_the_historical_default() -> None:
    check("absent", u.pack_trim_mode({"atlas": {"layout": "pack"}}), "alpha")
    check("empty", u.pack_trim_mode({"atlas": {"pack_trim": ""}}), "alpha")
    check("nonsense", u.pack_trim_mode({"atlas": {"pack_trim": "yes"}}), "alpha")
    check("keep", u.pack_trim_mode({"atlas": {"pack_trim": "KEEP "}}), "keep")
    check("alpha", u.pack_trim_mode({"atlas": {"pack_trim": "alpha"}}), "alpha")


# --------------------------------------------------------------------------
# 3. The option: keep the full frame.
# --------------------------------------------------------------------------

def test_alpha_mode_is_what_scatters_the_centres() -> None:
    """The control for the test below: this is the reported symptom, reproduced.
    Untrimmed art + the default trim = one distinct 'original canvas' per frame
    once the deploy fills the missing record in."""
    with tempfile.TemporaryDirectory() as td:
        m = _full_frame_manifest(Path(td))
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
        import batch_atlas
        r = m["regions"][1]
        src = Image.open(r["output_override"]).convert("RGBA")
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
          ("keep the full frame" in body, "Flipbook" in body), (True, True))


if __name__ == "__main__":
    for fn in (test_the_recorded_canvas_survives_a_repack,
               test_the_spelling_the_manifest_uses_is_the_spelling_kept,
               test_the_kept_canvas_reaches_the_deploy_normalizer,
               test_a_carried_trim_does_not_stretch_the_art_on_compose,
               test_an_atlas_that_recorded_no_trim_still_gets_none,
               test_art_that_is_no_longer_that_crop_drops_the_record,
               test_pack_trim_mode_normalizes_to_the_historical_default,
               test_alpha_mode_is_what_scatters_the_centres,
               test_keep_gives_every_frame_one_common_canvas,
               test_keep_stamps_the_contain_contract_so_compose_pastes_verbatim,
               test_keep_says_so_when_it_did_not_deliver_one_centre,
               test_keep_is_silent_when_it_did_deliver,
               test_keep_still_carries_a_recorded_trim,
               test_deploy_names_the_corruption_signature):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
