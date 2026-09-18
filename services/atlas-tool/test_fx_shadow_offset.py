"""Offline guard: a `_shadow` FX cell keeps its drop offset THROUGH compose
(no R2, no GPU, no ComfyUI).

Run:  PYTHONIOENCODING=utf-8 PYTHONPATH=".;../_shared" py test_fx_shadow_offset.py
      (from services/atlas-tool)

THE FAULT. `shine.make_shadow` is the ONE asymmetric FX builder: every other
mode (glow, blur, zoom, colour, shine) grows its ink concentrically around the
glyph it derives from, and a drop shadow deliberately does not -- the whole
effect IS the offset. It used to express that offset by pasting the blurred
silhouette into a canvas the SAME SIZE as the base, shifted:

    out = Image.new("RGBA", base.size, ...)   # base-sized
    out.paste(solid, (dx, dy), solid)         # ...and shifted inside it

which loses the drop twice over:
  1. CLIPPED. Whatever the shift pushes past the canvas edge is simply gone,
     so art that reaches its own canvas edge kept only half the drop (the
     blob's bbox centre lands dy/2 low, not dy).
  2. RE-CENTRED. `packer.compose` -- replayed verbatim by
     `batch_atlas._packer_compose_tile` for a Sheet-Maker cell's explicit
     `fit_mode:"contain"` -- centres a cell's VISIBLE BBOX in its rect. A lone
     blob's bbox IS the blob, so centring it puts the shadow exactly where the
     glyph is and the drop is gone. Measured before the fix: every rect whose
     aspect no longer matched the art's composed the shadow at drift (0, 0)
     from its base, i.e. no drop at all.

That is fallout of the sheet-parity rect-convention fix, NOT a regression to
revert: the pre-fix path preserved the offset only by alpha-cropping the shadow
to its base's bbox and upscaling ~5x, which is the bug the parity work exists to
remove.

THE FIX, in two halves, because the offset has to survive BOTH steps:
  * `shine.make_shadow` grows its canvas SYMMETRICALLY, by 2|dx| x 2|dy|, and
    blurs the already-shifted alpha there. The canvas centre still coincides
    with the base canvas's centre (so the layer stays in the base's pixel
    space), nothing is clipped, and the drop is carried by WHERE the blob sits
    in the canvas. At offset (0, 0) the margin is zero and the output is
    byte-for-byte what it always was.
  * `batch_atlas.fx_registration` + `_fx_parity_tile` place an FX layer by its
    BASE's transform instead of its own ink -- the same premise as the crop box
    the alpha path already uses. For every symmetric effect the two answers
    agree, so those go to the untouched `_packer_compose_tile` replay and the
    sheet-parity contract is exact, byte for byte. Only a layer whose ink
    disagrees with its base's (an offset shadow) is placed by the anchor.

WHAT THIS PINS.
  1. Zero-offset parity: `make_shadow` at (0, 0) is byte-identical to the old
     builder, on inset and full-bleed art, black and tinted.
  2. The canvas carries the offset: grown by exactly 2|dx| x 2|dy|, and the
     silhouette is never clipped -- proved against the old builder, which did
     clip it.
  3. COMPOSED DRIFT IS (0, 0) on the sheet-parity path for a range of offsets
     -- both signs, both axes, both at once, and zero -- through the REAL
     `fit_to_region`, over rects that do and do not match the art's aspect.
     The legacy alpha path is measured too, as a scale-free ratio (it scales by
     the ink, not the canvas) and against the old pair byte-for-byte, because
     that path was placing the drop correctly all along and must keep doing it.
  4. No regression for anything else: every other FX mode, and a zero-offset
     shadow, composes byte-identically to the bare `_packer_compose_tile`
     replay; a non-FX region never reaches any of this; and the alpha path's
     crop box is unmoved for art whose blob was not being clipped.

ASCII only in the labels: a non-Latin-1 glyph aborts the suite on this box's
cp1252 console.
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageFilter

import batch_atlas
import shine

FAILED: list[str] = []
PASSED: list[str] = []

CANVAS = 512
# The realistic FX source: a cut-out symbol with transparent margin, so its own
# ink bbox is measurable and the blob is not fighting the canvas edge.
INSET = 120
BLUR = 14.0
# make_shadow scales blur and offset by max(size)/256, so every offset below is
# doubled on a 512 canvas.
REF = 256.0


def _say(text: str) -> None:
    enc = sys.stdout.encoding or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def check(label: str, got, want) -> None:
    ok = got == want
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       got  {got!r}\n       want {want!r}")


def _glyph(canvas: int = CANVAS, inset: int = INSET) -> Image.Image:
    im = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    im.paste((200, 30, 30, 255), (inset, inset, canvas - inset, canvas - inset))
    return im


def _full_bleed(canvas: int = CANVAS) -> Image.Image:
    """Art whose ink reaches its own canvas edge -- the case the old builder
    clipped, and the one the live report was measured on."""
    return Image.new("RGBA", (canvas, canvas), (20, 20, 200, 255))


def _old_make_shadow(base: Image.Image, *, color=(0, 0, 0), blur=BLUR,
                     opacity=0.55, offset_x=0, offset_y=8) -> Image.Image:
    """`shine.make_shadow` as it shipped before this fix. Kept verbatim so the
    parity claim in (1) is a DIFFERENCE against the real previous behaviour,
    not against a restatement of the new one."""
    base = base.convert("RGBA")
    alpha = base.split()[-1]
    scale = max(base.size) / 256.0
    radius = max(0.0, blur * scale)
    mask = alpha.filter(ImageFilter.GaussianBlur(radius)) if radius > 0 else alpha
    op = max(0.0, min(1.0, opacity))
    mask = mask.point(lambda p: int(p * op))
    out = Image.new("RGBA", base.size, (0, 0, 0, 0))
    solid = Image.new("RGBA", base.size, (*color, 0))
    solid.putalpha(mask)
    dx, dy = int(round(offset_x * scale)), int(round(offset_y * scale))
    out.paste(solid, (dx, dy), solid)
    return out


def _ink(im: Image.Image):
    return im.getchannel("A").getbbox()


def _ink_centre(im: Image.Image):
    bb = _ink(im)
    return None if not bb else ((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2)


def _compose_pair(td: Path, base_img: Image.Image, fx_img: Image.Image,
                  rect: tuple[int, int], fit: str = "contain",
                  suffix: str = "_shadow",
                  fx_rect: tuple[int, int] | None = None):
    """Base tile + FX tile, through the REAL layout inputs and the REAL
    `fit_to_region` -- including the registration record compose builds for it,
    resolved the same way (`fx_registration` off the bound art).

    PADDING_PCT is pinned to 0 for the duration: it is a global config knob on
    the alpha path only, and these cases are about WHERE the art lands."""
    bp, fp = td / "base.png", td / "fx.png"
    base_img.save(bp)
    fx_img.save(fp)
    base = {"name": "T", "x": 0, "y": 0, "w": rect[0], "h": rect[1],
            "output_override": str(bp)}
    fr = fx_rect or rect
    fx = {"name": f"T{suffix}", "x": 0, "y": 0, "w": fr[0], "h": fr[1],
          "output_override": str(fp)}
    if fit:
        base["fit_mode"] = fit
        fx["fit_mode"] = fit
    by_name = {base["name"]: base, fx["name"]: fx}
    snapshot = dict(batch_atlas.ATLAS_META)
    batch_atlas.ATLAS_META.clear()
    batch_atlas.ATLAS_META.update({"width": 4096, "height": 4096})
    was, batch_atlas.PADDING_PCT = batch_atlas.PADDING_PCT, 0.0
    try:
        b = batch_atlas.fit_to_region(base_img.copy(), base)
        reg = batch_atlas.fx_registration(fx_img, fx, by_name, td)
        f = batch_atlas.fit_to_region(fx_img.copy(), fx,
                                      reg["box"] if reg else None, reg)
    finally:
        batch_atlas.PADDING_PCT = was
        batch_atlas.ATLAS_META.clear()
        batch_atlas.ATLAS_META.update(snapshot)
    return b, f, reg


def _drift(td: Path, src: Image.Image, rect: tuple[int, int],
           off: tuple[int, int], fit: str = "contain"):
    """How far the composed shadow lands from where it was ASKED to land.

    Measured on the composed page's own pixels: the base tile's ink centre is
    where the glyph ends up, the FX tile's ink centre is where the blob ends up,
    and the difference has to be the authored offset scaled by whatever compose
    scaled the art by. (0, 0) means the drop survived intact."""
    sh = shine.make_shadow(src, blur=BLUR, offset_x=off[0], offset_y=off[1])
    b, f, reg = _compose_pair(td, src, sh, rect, fit)
    cb, cf = _ink_centre(b), _ink_centre(f)
    s = (max(src.size) / REF) * reg["scale"]
    return (round(cf[0] - cb[0] - off[0] * s, 1),
            round(cf[1] - cb[1] - off[1] * s, 1))


# Both signs on both axes, both axes at once, and zero -- zero being the case
# that must be bit-for-bit what shipped.
OFFSETS = [(0, 8), (0, -8), (6, 0), (-6, 0), (6, 12), (-9, -5), (0, 0)]
# A rect the art's aspect matches (compose pastes verbatim), one it does not
# (compose re-centres -- the branch that used to eat the drop), one bigger than
# the art (scale clamps at 1.0), one square and smaller.
RECTS = [(CANVAS, CANVAS), (256, 256), (300, 256), (256, 512)]


# --------------------------------------------------------------------------
# 1. Zero offset is untouched.
# --------------------------------------------------------------------------

def test_a_zero_offset_shadow_is_byte_for_byte_what_it_always_was() -> None:
    """The parity case. A shadow with no drop was never mis-placed, so the fix
    must be invisible to it -- on art that fills its canvas as much as on art
    that does not, and on a tinted shadow as much as a black one (the tint
    rides the alpha through a paste-through-itself that is easy to lose)."""
    for src, tag in ((_glyph(), "inset"), (_full_bleed(), "full-bleed"),
                     (_glyph(256, 40), "small")):
        for col in ((0, 0, 0), (255, 80, 0)):
            old = _old_make_shadow(src, color=col, offset_x=0, offset_y=0)
            new = shine.make_shadow(src, color=col, offset_x=0, offset_y=0)
            check(f"{tag} {col}: identical to the old builder",
                  (new.size, new.tobytes() == old.tobytes()),
                  (src.size, True))


# --------------------------------------------------------------------------
# 2. The canvas carries the offset, instead of eating it.
# --------------------------------------------------------------------------

def test_the_canvas_grows_symmetrically_by_twice_the_offset() -> None:
    """Symmetric is the load-bearing word: the grown canvas's centre is still
    the base canvas's centre, which is what keeps the layer in the base's pixel
    space (`fx_registration` maps the base's bbox straight across the margin)."""
    src = _glyph()
    for ox, oy in OFFSETS:
        sh = shine.make_shadow(src, offset_x=ox, offset_y=oy)
        s = max(src.size) / REF
        check(f"off ({ox},{oy}): canvas grown by 2|d| on each axis", sh.size,
              (src.width + 2 * abs(round(ox * s)),
               src.height + 2 * abs(round(oy * s))))


def test_the_blob_sits_at_the_offset_instead_of_being_clipped_to_it() -> None:
    """The first half of the loss, on the art that showed it: a full-bleed
    silhouette shifted inside its own canvas loses everything past the edge, so
    the old builder's blob measured HALF the drop (dy/2) and the new one is
    whole. Compared against the old builder so the failure is a difference."""
    src = _full_bleed()
    for oy in (8, -8, 12):
        d = round(oy * (max(src.size) / REF))
        old = _old_make_shadow(src, blur=0.0, offset_y=oy)
        new = shine.make_shadow(src, blur=0.0, offset_y=oy)
        ob, nb = _ink(old), _ink(new)
        check(f"oy={oy}: the old builder kept {abs(ob[3] - ob[1])} of "
              f"{src.height} rows", abs(ob[3] - ob[1]), src.height - abs(d))
        check(f"oy={oy}: the whole silhouette survives now",
              (nb[2] - nb[0], nb[3] - nb[1]), src.size)
        check(f"oy={oy}: ...sitting the full drop off centre, not half of it",
              (nb[1] + nb[3]) / 2 - new.height / 2, float(d))


# --------------------------------------------------------------------------
# 3. THE ask, as pixels on the composed page: drift (0, 0).
# --------------------------------------------------------------------------

def test_the_composed_drop_is_exactly_what_was_asked_for() -> None:
    """The headline. Through the REAL `fit_to_region` on the sheet-parity path
    (explicit `fit_mode:"contain"`, the branch a Sheet-Maker cell takes), for
    every offset and every rect shape: the shadow lands the authored offset away
    from its glyph, scaled by whatever compose scaled the art by."""
    with tempfile.TemporaryDirectory() as td:
        src = _glyph()
        for rect in RECTS:
            got = [_drift(Path(td), src, rect, off) for off in OFFSETS]
            check(f"parity path, rect {rect[0]}x{rect[1]}: drift is (0,0) for "
                  f"every offset", got, [(0.0, 0.0)] * len(OFFSETS))


def test_the_legacy_alpha_path_keeps_the_drop_when_the_slot_can_carry_it(
) -> None:
    """The other placement an FX cell can take: no `fit_mode`, so the alpha path
    crops to the base-derived box and fits THAT to the rect. The box is the
    base's bbox grown by the ratio of the two slots, so the drop survives to the
    extent the FX slot is bigger than the base's -- exactly as the halo does.

    Measured as a RATIO (drop over glyph height) because this path scales by the
    ink, not by the canvas, and each tile is centred in its own rect: a
    scale-free reading is the only one that means the same thing on all three
    slot pairs."""
    src = _glyph()
    ink = _ink(src)
    glyph_h = ink[3] - ink[1]
    with tempfile.TemporaryDirectory() as t:
        td = Path(t)
        for base_rect, ratio in (((300, 300), 1.25), ((256, 256), 1.5),
                                 ((400, 300), 1.25)):
            fx_rect = (round(base_rect[0] * ratio), round(base_rect[1] * ratio))
            got, want = [], []
            for oy in (8, -8, 12, 0):
                sh = shine.make_shadow(src, blur=BLUR, offset_y=oy)
                b, f, _reg = _compose_pair(td, src, sh, base_rect, fit="",
                                           fx_rect=fx_rect)
                bb, fb = _ink(b), _ink(f)
                drop = (((fb[1] + fb[3]) / 2 - f.height / 2)
                        - ((bb[1] + bb[3]) / 2 - b.height / 2))
                got.append(drop / (bb[3] - bb[1]))
                want.append(oy * (CANVAS / REF) / glyph_h)
            # Within 0.2% of the glyph's height: this path resizes twice with
            # LANCZOS and reads a soft blob's bbox, so the ink box is a
            # sub-pixel measurement. The failure it guards is the whole drop.
            check(f"alpha path, base {base_rect[0]}x{base_rect[1]} into an FX "
                  f"slot {ratio}x its size: the drop is drawn at its authored "
                  f"fraction of the glyph",
                  [abs(g - w) <= 0.002 for g, w in zip(got, want)],
                  [True] * len(want))


def test_the_legacy_alpha_path_composes_what_it_always_did() -> None:
    """No-regression on the path that was NOT broken. For art with margin the
    blob never reached the canvas edge, so nothing the alpha path can see has
    changed: the new shadow on its grown canvas, cropped by the box that moved
    with the margin, composes to the same bytes as the old shadow cropped by the
    old box."""
    src = _glyph()
    with tempfile.TemporaryDirectory() as t:
        td = Path(t)
        for rect in RECTS:
            same = []
            for oy in (8, -8, 12, 0):
                _b, new, _r = _compose_pair(td, src,
                                            shine.make_shadow(src, blur=BLUR,
                                                              offset_y=oy),
                                            rect, fit="")
                _b2, old, _r2 = _compose_pair(td, src,
                                              _old_make_shadow(src,
                                                               offset_y=oy),
                                              rect, fit="")
                same.append(new.tobytes() == old.tobytes())
            check(f"alpha path, rect {rect[0]}x{rect[1]}: identical to the old "
                  f"pair at every offset", same, [True] * 4)


def test_this_is_a_difference_the_old_pair_could_not_produce() -> None:
    """The control. The same measurement against the OLD builder placed by the
    OLD rule (its own bbox, i.e. the bare packer replay) on the rect shape that
    re-centres: the drop is not merely smaller, it is GONE -- the composed
    shadow sits on top of the glyph. Without this the assertion above could
    be passing for some reason other than the fix."""
    with tempfile.TemporaryDirectory() as td:
        src = _glyph()
        rect = (300, 256)
        base = {"name": "T", "x": 0, "y": 0, "w": rect[0], "h": rect[1],
                "fit_mode": "contain"}
        snapshot = dict(batch_atlas.ATLAS_META)
        batch_atlas.ATLAS_META.clear()
        batch_atlas.ATLAS_META.update({"width": 4096, "height": 4096})
        try:
            b = batch_atlas.fit_to_region(src.copy(), base)
            drops = []
            for ox, oy in OFFSETS:
                old = _old_make_shadow(src, offset_x=ox, offset_y=oy)
                f = batch_atlas._packer_compose_tile(old, rect[0], rect[1],
                                                     False)
                cb, cf = _ink_centre(b), _ink_centre(f)
                drops.append((round(cf[0] - cb[0], 1), round(cf[1] - cb[1], 1)))
        finally:
            batch_atlas.ATLAS_META.clear()
            batch_atlas.ATLAS_META.update(snapshot)
        check("the old pair composed every offset to the same place as the "
              "glyph", drops, [(0.0, 0.0)] * len(OFFSETS))
        _ = td


def test_a_rotated_cell_carries_the_drop_round_with_it() -> None:
    """A rotated cell is packed 90 degrees clockwise, and packer centres a
    rotated cell by its RECTANGLE (a bbox would be in pre-rotation space) -- so
    that is how its base was placed and how the FX layer has to be placed to
    stay with it. The drop rides along: a (dx, dy) offset comes out as
    (-dy, dx) once the tile is turned."""
    src = _glyph()
    with tempfile.TemporaryDirectory() as t:
        td = Path(t)
        got, want = [], []
        for ox, oy in ((0, 8), (6, 0), (-9, -5)):
            sh = shine.make_shadow(src, blur=BLUR, offset_x=ox, offset_y=oy)
            bp, fp = td / "base.png", td / "fx.png"
            src.save(bp)
            sh.save(fp)
            rect = (300, 256)
            base = {"name": "T", "x": 0, "y": 0, "w": rect[0], "h": rect[1],
                    "fit_mode": "contain", "rotated": True,
                    "output_override": str(bp)}
            fx = {"name": "T_shadow", "x": 0, "y": 0, "w": rect[0],
                  "h": rect[1], "fit_mode": "contain", "rotated": True,
                  "output_override": str(fp)}
            snapshot = dict(batch_atlas.ATLAS_META)
            batch_atlas.ATLAS_META.clear()
            batch_atlas.ATLAS_META.update({"width": 4096, "height": 4096})
            try:
                b = batch_atlas.fit_to_region(src.copy(), base)
                reg = batch_atlas.fx_registration(sh, fx, {"T": base,
                                                           "T_shadow": fx}, td)
                f = batch_atlas.fit_to_region(sh.copy(), fx, reg["box"], reg)
            finally:
                batch_atlas.ATLAS_META.clear()
                batch_atlas.ATLAS_META.update(snapshot)
            check(f"off ({ox},{oy}): the tile is the packed (h x w) footprint",
                  (b.size, f.size), ((rect[1], rect[0]), (rect[1], rect[0])))
            cb, cf = _ink_centre(b), _ink_centre(f)
            s = (CANVAS / REF) * reg["scale"]
            got.append((round(cf[0] - cb[0]), round(cf[1] - cb[1])))
            want.append((round(-oy * s), round(ox * s)))
        check("the drop turns with the cell", got, want)


# --------------------------------------------------------------------------
# 4. Everything else is untouched.
# --------------------------------------------------------------------------

def test_every_symmetric_fx_still_composes_through_the_bare_replay() -> None:
    """The sheet-parity contract, kept exact rather than "within a pixel". An
    FX layer whose ink is already centred on its base's is placed by the
    untouched `_packer_compose_tile`, so a glow/blur/zoom/colour/shine cell --
    and a zero-offset shadow -- composes to the same bytes it did before any of
    this existed."""
    src = _glyph()
    builds = {
        "glow": shine.make_glow(src),
        "blur": shine.make_blur(src),
        "zoom": shine.make_zoom(src),
        "colour": shine.make_recolour(src),
        "shine": shine.make_shine(src),
        "shadow": shine.make_shadow(src, offset_x=0, offset_y=0),
    }
    with tempfile.TemporaryDirectory() as td:
        for mode, im in builds.items():
            same = []
            for rect in RECTS + [(600, 600)]:
                _b, f, reg = _compose_pair(Path(td), src, im, rect,
                                           suffix=f"_{mode}")
                bare = batch_atlas._packer_compose_tile(im.copy(), rect[0],
                                                       rect[1], False)
                same.append(bool(reg and reg["replay"])
                            and f.tobytes() == bare.tobytes())
            check(f"{mode}: replayed verbatim on every rect", same,
                  [True] * len(same))


def test_an_offset_shadow_is_the_only_layer_that_leaves_the_replay() -> None:
    """Stated as the dispatch, not as pixels: `replay` is what decides, and it
    is False for exactly one thing."""
    src = _glyph()
    with tempfile.TemporaryDirectory() as td:
        flags = {}
        for mode, im in (("glow", shine.make_glow(src)),
                         ("shadow0", shine.make_shadow(src, offset_x=0,
                                                       offset_y=0)),
                         ("shadow8", shine.make_shadow(src, offset_y=8)),
                         ("shadow-x", shine.make_shadow(src, offset_x=-6,
                                                        offset_y=0))):
            _b, _f, reg = _compose_pair(Path(td), src, im, (256, 256),
                                        suffix="_shadow" if "shadow" in mode
                                        else f"_{mode}")
            flags[mode] = reg["replay"]
        check("only an OFFSET shadow needs the base-registered tile", flags,
              {"glow": True, "shadow0": True, "shadow8": False,
               "shadow-x": False})


def test_a_region_that_is_not_an_fx_layer_is_never_registered() -> None:
    """The gate. `fx_registration` answers None for anything that is not a
    `<base><suffix>` layer with a resolvable base, so a plain cell keeps the
    bare replay -- including a shadow whose base is not in the manifest."""
    src = _glyph()
    sh = shine.make_shadow(src, offset_y=8)
    with tempfile.TemporaryDirectory() as t:
        td = Path(t)
        p = td / "a.png"
        sh.save(p)
        plain = {"name": "T", "x": 0, "y": 0, "w": 256, "h": 256,
                 "fit_mode": "contain", "output_override": str(p)}
        orphan = {"name": "Nobody_shadow", "x": 0, "y": 0, "w": 256, "h": 256,
                  "fit_mode": "contain", "output_override": str(p)}
        check("a non-FX name registers nothing",
              batch_atlas.fx_registration(sh, plain, {"T": plain}, td), None)
        check("an FX name with no base registers nothing",
              batch_atlas.fx_registration(sh, orphan, {}, td), None)


def test_art_that_is_not_the_bases_canvas_is_refused() -> None:
    """The guard that kept hand-made FX art out of the registration, widened
    only as far as the fix needs: the base's canvas, or the base's canvas with
    a WHOLE and SYMMETRIC margin. Anything else is not in the base's pixel
    space and its numbers would be a guess."""
    src = _glyph()
    with tempfile.TemporaryDirectory() as t:
        td = Path(t)
        bp = td / "b.png"
        src.save(bp)
        base = {"name": "T", "x": 0, "y": 0, "w": 256, "h": 256,
                "output_override": str(bp)}
        fx = {"name": "T_shadow", "x": 0, "y": 0, "w": 256, "h": 256}
        by = {"T": base, "T_shadow": fx}
        cases = {
            "the base's own canvas": (CANVAS, CANVAS),
            "a symmetric margin": (CANVAS + 24, CANVAS + 8),
            "an odd margin": (CANVAS + 3, CANVAS),
            "smaller than the base": (CANVAS - 8, CANVAS),
        }
        got = {k: batch_atlas.fx_registration(
            Image.new("RGBA", size, (0, 0, 0, 12)), fx, by, td) is not None
            for k, size in cases.items()}
        check("only the base's canvas, symmetrically grown, registers", got,
              {"the base's own canvas": True, "a symmetric margin": True,
               "an odd margin": False, "smaller than the base": False})


def test_the_alpha_paths_crop_box_is_unmoved_for_art_it_was_not_clipping(
) -> None:
    """No-regression on the box itself. For art with margin the blob never
    reached the canvas edge, so the grown canvas changes nothing the alpha path
    can see: the box moves with the margin and cuts the same pixels."""
    src = _glyph()
    with tempfile.TemporaryDirectory() as t:
        td = Path(t)
        bp = td / "b.png"
        src.save(bp)
        base = {"name": "T", "x": 0, "y": 0, "w": 300, "h": 300,
                "output_override": str(bp)}
        fx = {"name": "T_shadow", "x": 0, "y": 0, "w": 300, "h": 300}
        by = {"T": base, "T_shadow": fx}
        for oy in (8, -8, 12):
            old = _old_make_shadow(src, offset_y=oy)
            new = shine.make_shadow(src, offset_y=oy)
            ob = batch_atlas.fx_registration(old, fx, by, td)["box"]
            nb = batch_atlas.fx_registration(new, fx, by, td)["box"]
            m = (new.height - old.height) // 2
            check(f"oy={oy}: the box moves with the margin and nothing else",
                  nb, (ob[0], ob[1] + m, ob[2], ob[3] + m))
            check(f"oy={oy}: ...so it crops the identical pixels",
                  new.crop(nb).tobytes() == old.crop(ob).tobytes(), True)


if __name__ == "__main__":
    for fn in (test_a_zero_offset_shadow_is_byte_for_byte_what_it_always_was,
               test_the_canvas_grows_symmetrically_by_twice_the_offset,
               test_the_blob_sits_at_the_offset_instead_of_being_clipped_to_it,
               test_the_composed_drop_is_exactly_what_was_asked_for,
               test_the_legacy_alpha_path_keeps_the_drop_when_the_slot_can_carry_it,
               test_the_legacy_alpha_path_composes_what_it_always_did,
               test_this_is_a_difference_the_old_pair_could_not_produce,
               test_a_rotated_cell_carries_the_drop_round_with_it,
               test_every_symmetric_fx_still_composes_through_the_bare_replay,
               test_an_offset_shadow_is_the_only_layer_that_leaves_the_replay,
               test_a_region_that_is_not_an_fx_layer_is_never_registered,
               test_art_that_is_not_the_bases_canvas_is_refused,
               test_the_alpha_paths_crop_box_is_unmoved_for_art_it_was_not_clipping):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
