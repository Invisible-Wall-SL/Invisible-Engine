"""Offline guard: an AI layer is a second render OF THE SAME SOURCE (no R2, no ComfyUI).

Run:  PYTHONPATH=".;../_shared" py test_ai_layers.py   (from services/atlas-tool)

WHY THIS SHAPE AND NOT A "DUPLICATE PAGE" BUTTON. The ask was a button that
clones an atlas under a new name, so one source image could be rendered into
several layers on separate sheets. The tool cannot express that safely: an
atlas IS one manifest and one page, but a region's SOURCES and its committed
output are keyed by REGION NAME at the PROJECT level --

    batch/<name>_00001_.png      the variant pile
    input/refs/userref_<name>.png    the reference
    input/refs/useroutput_<name>.png the committed image

-- so a cloned page that keeps its region names shares the source (which is the
point) but ALSO shares `useroutput_<name>.png`, and the second layer's picture
overwrites the first's. Rename the regions to dodge that and the link back to
the source is gone, which was the whole feature.

A layer sidesteps both: `<base><suffix>` is an ordinary region with its own
name -- so its own pile, its own pick, its own committed image, no collision --
carrying `layer_of`, which is read at RENDER time to borrow the base's refs and
at COMPOSE time to crop it to the base's footprint. One manifest, one page, two
renders that line up.

The contract these assertions pin:
  * a layer inherits the refs it does not set, BY REFERENCE -- resolution never
    writes back, so repointing the base moves every layer and no stale copy can
    outlive the edit;
  * a ref the layer sets ITSELF wins, per key, not all-or-nothing;
  * a dangling `layer_of` (base deleted) is inert, not an error;
  * an AI layer takes the base's registration crop, exactly as an FX layer
    does -- this is the one that keeps two independent renders in register;
  * an AI layer is NOT an FX layer: `rebuild_fx_layers` must never touch it, or
    Create Atlas would overwrite a paid render with a local pixel op;
  * `/addlayer` refuses a chain, a duplicate, a missing base and an FX suffix;
  * `layer_of` is identity -- the copy/paste settings button must not carry it.

ASCII only in the labels: a non-Latin-1 glyph raises UnicodeEncodeError on this
box's cp1252 console and aborts the whole suite.
"""
from __future__ import annotations

import json
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
# Fixtures
# --------------------------------------------------------------------------
def _stage(regions: list[dict]) -> Path:
    """A staged manifest the handler can round-trip, with ui_server pointed at
    it and the R2 mirror stubbed out."""
    mp = Path(tempfile.mkdtemp()) / "atlas_manifest_test.json"
    mp.write_text(json.dumps(
        {"atlas": {"layout": "pack"}, "style": {}, "regions": regions}),
        encoding="utf-8")
    u.manifest_path = lambda: mp                                  # noqa: E731
    u._mirror = lambda p: None                                    # noqa: E731
    return mp


def _handler():
    """The request handler's methods are plain functions of `self` here -- none
    of the ones under test touch the socket, so an unconstructed instance is
    the honest way to call them without standing up a server."""
    return u.Handler.__new__(u.Handler)


def _read(mp: Path) -> dict:
    return json.loads(mp.read_text(encoding="utf-8"))


def _by_name(regions: list[dict]) -> dict:
    return {r["name"]: r for r in regions}


def _glyph(size: tuple[int, int], box: tuple[int, int, int, int]) -> Image.Image:
    """An RGBA canvas opaque only inside `box` -- so its alpha bbox is exactly
    `box` and a crop derived from it is measurable."""
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    img.paste(Image.new("RGBA", (box[2] - box[0], box[3] - box[1]),
                        (255, 0, 0, 255)), (box[0], box[1]))
    return img


# --------------------------------------------------------------------------
# 1. The base link
# --------------------------------------------------------------------------
def test_the_base_resolves_explicitly_and_by_suffix():
    check("an explicit layer_of names the base",
          ba.layer_base_name({"name": "H1_fire", "layer_of": "H1"}), "H1")
    check("an FX suffix still names the base (unchanged)",
          ba.layer_base_name({"name": "H1_glow"}), "H1")
    check("a plain region is nobody's layer",
          ba.layer_base_name({"name": "H1"}), None)
    # The explicit link wins: a layer may legitimately be NAMED after an FX
    # mode while being a render of another slot entirely.
    check("layer_of beats the suffix",
          ba.layer_base_name({"name": "H1_glow", "layer_of": "H2"}), "H2")
    check("a blank layer_of is not a link",
          ba.layer_base_name({"name": "H1_fire", "layer_of": "   "}), None)


# --------------------------------------------------------------------------
# 2. Ref inheritance -- the "same source image" guarantee
# --------------------------------------------------------------------------
def test_a_layer_inherits_the_refs_it_does_not_set():
    base = {"name": "H1", "style_ref": "refs/userref_H1.png",
            "shape_ref": "refs/shape_H1.png"}
    layer = {"name": "H1_fire", "layer_of": "H1", "prompt": "on fire"}
    got = ba.resolve_layer_refs(layer, _by_name([base, layer]))
    check("the style ref comes from the base",
          got.get("style_ref"), "refs/userref_H1.png")
    check("the shape ref comes from the base",
          got.get("shape_ref"), "refs/shape_H1.png")
    check("its own prompt is untouched", got.get("prompt"), "on fire")


def test_resolution_never_writes_back():
    # THE point of by-reference: the manifest keeps holding the LINK. If
    # resolution mutated the region, the next save would freeze today's ref
    # into the layer and repointing the base would stop moving it.
    base = {"name": "H1", "style_ref": "refs/userref_H1.png"}
    layer = {"name": "H1_fire", "layer_of": "H1"}
    ba.resolve_layer_refs(layer, _by_name([base, layer]))
    check("the stored layer still owns no ref", "style_ref" in layer, False)


def test_repointing_the_base_moves_the_layer():
    base = {"name": "H1", "style_ref": "refs/old.png"}
    layer = {"name": "H1_fire", "layer_of": "H1"}
    first = ba.resolve_layer_refs(layer, _by_name([base, layer]))
    base["style_ref"] = "refs/new.png"
    second = ba.resolve_layer_refs(layer, _by_name([base, layer]))
    check("before", first.get("style_ref"), "refs/old.png")
    check("after, with no edit to the layer", second.get("style_ref"),
          "refs/new.png")


def test_both_ref_keys_are_live_not_just_the_style_one():
    mp = _stage([{"name": "H1", "style_ref": "refs/a.png",
                  "shape_ref": "refs/b.png"}])
    _handler()._addlayer({"base": "H1", "suffix": "fire"})
    m = _read(mp)
    by = _by_name(m["regions"])
    got = ba.resolve_layer_refs(by["H1_fire"], by)
    check("style ref resolves", got.get("style_ref"), "refs/a.png")
    check("shape ref resolves", got.get("shape_ref"), "refs/b.png")
    by["H1"]["style_ref"] = "refs/a2.png"
    by["H1"]["shape_ref"] = "refs/b2.png"
    moved = ba.resolve_layer_refs(by["H1_fire"], by)
    check("and BOTH follow the base",
          (moved.get("style_ref"), moved.get("shape_ref")),
          ("refs/a2.png", "refs/b2.png"))


def test_the_layers_own_ref_wins_per_key():
    base = {"name": "H1", "style_ref": "refs/base_style.png",
            "shape_ref": "refs/base_shape.png"}
    layer = {"name": "H1_fire", "layer_of": "H1",
             "style_ref": "refs/mine.png"}
    got = ba.resolve_layer_refs(layer, _by_name([base, layer]))
    check("its own style ref is kept", got.get("style_ref"), "refs/mine.png")
    check("and the shape ref is still inherited",
          got.get("shape_ref"), "refs/base_shape.png")


def test_nothing_to_inherit_returns_the_same_object():
    layer = {"name": "H1_fire", "layer_of": "H1", "style_ref": "refs/mine.png"}
    base = {"name": "H1", "style_ref": "refs/base.png"}
    check("a layer that owns every ref is passed through untouched",
          ba.resolve_layer_refs(layer, _by_name([base, layer])) is layer, True)
    check("a plain region is passed through untouched",
          ba.resolve_layer_refs(base, _by_name([base])) is base, True)


def test_a_dangling_layer_of_is_inert():
    # Deleting a base must not break its layers -- they become ordinary
    # regions that render on their own refs. Not an error, just no inheritance.
    layer = {"name": "H1_fire", "layer_of": "H1"}
    got = ba.resolve_layer_refs(layer, _by_name([layer]))
    check("no base, no inheritance, no raise", got is layer, True)


def test_an_fx_layer_inherits_nothing_here():
    # shine.py reads the base's committed PIXELS through fx_source, not its
    # refs. Filling these in for an FX layer would be noise.
    base = {"name": "H1", "style_ref": "refs/base.png"}
    fx = {"name": "H1_glow", "mode": "glow"}
    check("an _glow region is left alone",
          ba.resolve_layer_refs(fx, _by_name([base, fx])) is fx, True)


# --------------------------------------------------------------------------
# 3. Registration -- two independent renders that still line up
# --------------------------------------------------------------------------
def test_an_ai_layer_takes_the_bases_registration_crop():
    batch = Path(tempfile.mkdtemp())
    # The base's art: a 40x40 glyph centred on a 100x100 canvas.
    base_src = batch / "H1_00001_.png"
    _glyph((100, 100), (30, 30, 70, 70)).save(base_src)
    base = {"name": "H1", "x": 0, "y": 0, "w": 64, "h": 64}
    layer = {"name": "H1_fire", "layer_of": "H1", "x": 0, "y": 0,
             "w": 64, "h": 64}
    # The layer's own render sprawls wider -- exactly the case that would
    # otherwise be self-cropped to a different scale and drift off the base.
    img = _glyph((100, 100), (10, 10, 90, 90))
    box = ba.layer_registration_crop(img, layer, _by_name([base, layer]), batch)
    check("the box is the BASE's bbox, not the layer's own",
          box, (30, 30, 70, 70))
    check("a plain region still self-crops (None)",
          ba.layer_registration_crop(img, base, _by_name([base]), batch), None)


def test_an_equal_slot_degenerates_to_the_bases_bbox():
    # Same-size slots: the layer gets exactly the base's footprint. A bigger
    # slot buys proportionally more room, which is what lets a halo survive.
    batch = Path(tempfile.mkdtemp())
    _glyph((100, 100), (40, 40, 60, 60)).save(batch / "H1_00001_.png")
    base = {"name": "H1", "w": 50, "h": 50}
    same = {"name": "H1_a", "layer_of": "H1", "w": 50, "h": 50}
    wider = {"name": "H1_b", "layer_of": "H1", "w": 100, "h": 100}
    img = _glyph((100, 100), (0, 0, 100, 100))
    reg = _by_name([base, same, wider])
    check("equal slot -> the base's bare bbox",
          ba.layer_registration_crop(img, same, reg, batch), (40, 40, 60, 60))
    check("double slot -> the same centre, twice the box",
          ba.layer_registration_crop(img, wider, reg, batch), (30, 30, 70, 70))


def test_a_mismatched_canvas_declines_to_guess():
    # A layer rendered at another size is not in the base's pixel space, so a
    # box built from the base's bbox would be meaningless. Fall back to
    # self-cropping rather than place the art wrongly with confidence.
    batch = Path(tempfile.mkdtemp())
    _glyph((100, 100), (30, 30, 70, 70)).save(batch / "H1_00001_.png")
    base = {"name": "H1", "w": 64, "h": 64}
    layer = {"name": "H1_fire", "layer_of": "H1", "w": 64, "h": 64}
    img = _glyph((200, 200), (10, 10, 190, 190))
    check("different canvas -> None",
          ba.layer_registration_crop(img, layer, _by_name([base, layer]),
                                     batch), None)


def test_which_trim_mode_actually_consumes_the_crop():
    """The crop is a no-op under the DEFAULT trim and essential under the
    other, and that is not a defect -- it is the same split fit_to_region
    already documents for FX layers. Pinned because the fixture tests call
    layer_registration_crop directly and so cannot see it, and because the
    guide makes a promise that is only true on one branch.

    Solid art cannot show this: cropped to its ink and scaled to fill, a
    rectangle lands on the whole rect whatever box you hand it. So the layer
    carries an opaque CORE plus a faint halo far out, and we measure where the
    CORE lands."""
    batch = Path(tempfile.mkdtemp())
    core = (96, 96, 160, 160)
    base_art = _glyph((256, 256), core)
    layer_art = _glyph((256, 256), core)
    for xy in ((32, 32), (220, 220)):
        layer_art.paste(Image.new("RGBA", (4, 4), (0, 0, 255, 40)), xy)
    base_art.save(batch / "H1_00001_.png")

    base = {"name": "H1", "x": 0, "y": 0, "w": 128, "h": 128}
    layer = {"name": "H1_fire", "layer_of": "H1", "x": 0, "y": 0,
             "w": 128, "h": 128}
    box = ba.layer_registration_crop(layer_art, layer, _by_name([base, layer]),
                                     batch)

    def core_of(img):
        return img.getchannel("A").point(
            lambda v: 255 if v > 200 else 0).getbbox()

    def placed(art, region, crop, trim):
        ba.ATLAS_META.clear()
        ba.ATLAS_META.update({"layout": "pack", "pack_trim": trim})
        return core_of(ba.fit_to_region(art, region, crop))

    try:
        # keep (the DEFAULT): both frames are placed on their whole canvas, so
        # they register by construction and the crop changes nothing.
        want = placed(base_art, base, None, "keep")
        check("keep: the layer registers with NO crop at all",
              placed(layer_art, layer, None, "keep"), want)
        check("keep: and the crop is inert, not harmful",
              placed(layer_art, layer, box, "keep"), want)
        # alpha: each frame is cropped to its own ink, so the layer's halo
        # shrinks its core -- this is the case the crop exists for.
        want = placed(base_art, base, None, "alpha")
        check("alpha: WITHOUT the crop the layer does NOT register",
              placed(layer_art, layer, None, "alpha") == want, False)
        check("alpha: with the crop it does",
              placed(layer_art, layer, box, "alpha"), want)
    finally:
        ba.ATLAS_META.clear()


# --------------------------------------------------------------------------
# 4. An AI layer is not an FX layer
# --------------------------------------------------------------------------
def test_rebuild_fx_layers_never_touches_an_ai_layer():
    # The one that matters most: rebuild_fx_layers runs on every Create Atlas.
    # If it claimed AI layers, it would overwrite a paid render with a local
    # pixel op derived from the base -- silently, and every time.
    m = {"atlas": {"layout": "pack"}, "regions": [
        {"name": "H1"},
        {"name": "H1_fire", "layer_of": "H1"},            # AI layer, no mode
        {"name": "H1_neon", "layer_of": "H1", "mode": "ai"},
        {"name": "H1_glow", "mode": "glow"},              # a real FX layer
    ]}
    built: list[str] = []
    orig_all, orig_cfg, orig_build = (
        u.all_regions, u.load_config, u.build_fx_region)
    try:
        u.all_regions = lambda _m: list(_m["regions"])        # noqa: E731
        u.load_config = lambda: {"auto_fx_rebuild": True}     # noqa: E731
        u.build_fx_region = (                                 # noqa: E731
            lambda _m, nm, *a, **k: (built.append(nm), (True, ""))[1])
        rebuilt = u.rebuild_fx_layers(m)
    finally:
        u.all_regions, u.load_config, u.build_fx_region = (
            orig_all, orig_cfg, orig_build)
    check("only the FX layer was rebuilt", built, ["H1_glow"])
    check("and only it is reported", rebuilt, ["H1_glow"])


def test_an_ai_layer_switched_to_an_fx_mode_derives_from_its_declared_base():
    # The mode dropdown is still live on a layer. Turning one into a local FX
    # op must derive from the base it DECLARES, not from a base guessed out of
    # its name (`H1_fire` has no FX suffix, so name-matching would find none).
    m = {"atlas": {"layout": "pack"}, "regions": [
        {"name": "H1"}, {"name": "H1_fire", "layer_of": "H1", "mode": "glow"}]}
    built: list[str] = []
    orig_all, orig_cfg, orig_build = (
        u.all_regions, u.load_config, u.build_fx_region)
    try:
        u.all_regions = lambda _m: list(_m["regions"])        # noqa: E731
        u.load_config = lambda: {"auto_fx_rebuild": True}     # noqa: E731
        u.build_fx_region = (                                 # noqa: E731
            lambda _m, nm, *a, **k: (built.append(nm), (True, ""))[1])
        u.rebuild_fx_layers(m)
    finally:
        u.all_regions, u.load_config, u.build_fx_region = (
            orig_all, orig_cfg, orig_build)
    check("it is a candidate via layer_of", built, ["H1_fire"])


# --------------------------------------------------------------------------
# 5. /addlayer
# --------------------------------------------------------------------------
def test_addlayer_creates_a_seeded_layer():
    mp = _stage([{"name": "H1", "prompt": "a cherry", "pipeline": "flux",
                  "style_ref": "refs/userref_H1.png",
                  "shape_ref": "refs/userref_H1.png", "seed": 1234,
                  "lock": True, "variant": "00003", "x": 5, "y": 6,
                  "fit_mode": "contain", "mode": "glow", "fx": {"glow": {}}}])
    msg = _handler()._addlayer({"base": "H1", "suffix": "fire"})
    regions = _read(mp)["regions"]
    layer = _by_name(regions).get("H1_fire", {})
    check("it reports success", msg.startswith("✓"), True)
    check("the layer exists", layer.get("name"), "H1_fire")
    check("linked to its base", layer.get("layer_of"), "H1")
    check("tuning is seeded from the base", layer.get("prompt"), "a cherry")
    check("...including the pipeline", layer.get("pipeline"), "flux")
    # _COPY_BLOCK: identity, geometry and results stay the layer's own, or it
    # would be born holding the base's picked file and packed rect.
    check("the base's style ref is NOT copied in (it is inherited live)",
          "style_ref" in layer, False)
    # The one the first cut got wrong: _COPY_BLOCK holds style_ref but NOT
    # shape_ref, so the seed froze it and resolve_layer_refs then saw the layer
    # as owning it -- the live link held for one ref key out of two.
    check("...and neither is the shape ref", "shape_ref" in layer, False)
    # An AI layer is AI by definition. Seeding a base's Glow made the slot get
    # rendered for real and then overwritten from the base's pixels.
    check("the base's FX mode is not inherited", "mode" in layer, False)
    check("nor its FX params", "fx" in layer, False)
    # A placement contract belongs to the rect it was measured for -- and an
    # explicit `contain` routes compose past the registration crop entirely.
    check("nor its fit mode", "fit_mode" in layer, False)
    check("the seed is not copied", "seed" in layer, False)
    check("the lock is not copied", "lock" in layer, False)
    check("the pick is not copied", "variant" in layer, False)
    check("the rect is not copied", "x" in layer, False)
    check("the base is untouched", _by_name(regions)["H1"].get("prompt"),
          "a cherry")


def test_the_seeded_copy_is_a_starting_point_not_a_link():
    mp = _stage([{"name": "H1", "prompt": "a cherry"}])
    _handler()._addlayer({"base": "H1", "suffix": "fire"})
    m = _read(mp)
    _by_name(m["regions"])["H1"]["prompt"] = "a plum"
    mp.write_text(json.dumps(m), encoding="utf-8")
    check("editing the base does not rewrite the layer's prompt",
          _by_name(_read(mp)["regions"])["H1_fire"].get("prompt"), "a cherry")


def test_addlayer_refuses_the_four_bad_cases():
    mp = _stage([{"name": "H1"}, {"name": "H1_fire", "layer_of": "H1"}])
    h = _handler()
    check("a missing base",
          h._addlayer({"base": "nope", "suffix": "x"}).startswith("⚠"),
          True)
    check("a duplicate name",
          h._addlayer({"base": "H1", "suffix": "fire"}).startswith("⚠"),
          True)
    check("a layer of a layer",
          h._addlayer({"base": "H1_fire", "suffix": "x"}).startswith("⚠"),
          True)
    # `H1_glow` would be classified by NAME as a local FX layer, so it would be
    # rebuilt from H1's pixels rather than generated. Refuse, don't surprise.
    check("an FX suffix",
          h._addlayer({"base": "H1", "suffix": "glow"}).startswith("⚠"),
          True)
    check("a blank suffix is asked for, not guessed",
          h._addlayer({"base": "H1", "suffix": "  "}).startswith("Give"), True)
    check("nothing was written", len(_read(mp)["regions"]), 2)


def test_addlayer_sanitises_the_name():
    mp = _stage([{"name": "H1"}])
    _handler()._addlayer({"base": "H1", "suffix": "fire storm!"})
    # The name is a variant-file prefix on disk, so it must stay path-safe.
    check("punctuation collapses", "H1_fire_storm" in _by_name(
        _read(mp)["regions"]), True)


# --------------------------------------------------------------------------
# 6. layer_of is identity
# --------------------------------------------------------------------------
def test_copyfrom_does_not_carry_the_base_link():
    # Pasting settings from a layer onto a plain region must not re-parent it.
    mp = _stage([{"name": "H1"},
                 {"name": "H1_fire", "layer_of": "H1", "prompt": "on fire"},
                 {"name": "H2"}])
    _handler()._copyfrom({"src": "H1_fire", "dsts": ["H2"]})
    h2 = _by_name(_read(mp)["regions"])["H2"]
    check("the prompt is pasted", h2.get("prompt"), "on fire")
    check("the base link is NOT", "layer_of" in h2, False)


def test_a_reimport_keeps_the_base_link():
    # _normalize_converted_region rebuilds a geometry-only dict and copies an
    # ALLOWLIST of creative fields across. A key missing from it is dropped
    # silently -- which is how `fit_mode` was lost once already.
    out = u._normalize_converted_region(
        {"name": "H1_fire", "layer_of": "H1", "prompt": "p",
         "x": 0, "y": 0, "w": 8, "h": 8})
    check("layer_of survives /uploadatlas", out.get("layer_of"), "H1")


def test_deleting_a_base_names_the_layers_it_orphans():
    mp = _stage([{"name": "H1"}, {"name": "H1_fire", "layer_of": "H1"}])
    msg = _handler()._delregion({"name": "H1"})
    check("the orphan is named", "H1_fire" in msg, True)
    check("but it is kept, not cascaded",
          "H1_fire" in _by_name(_read(mp)["regions"]), True)


if __name__ == "__main__":
    for fn in (test_the_base_resolves_explicitly_and_by_suffix,
               test_a_layer_inherits_the_refs_it_does_not_set,
               test_resolution_never_writes_back,
               test_repointing_the_base_moves_the_layer,
               test_both_ref_keys_are_live_not_just_the_style_one,
               test_the_layers_own_ref_wins_per_key,
               test_nothing_to_inherit_returns_the_same_object,
               test_a_dangling_layer_of_is_inert,
               test_an_fx_layer_inherits_nothing_here,
               test_an_ai_layer_takes_the_bases_registration_crop,
               test_an_equal_slot_degenerates_to_the_bases_bbox,
               test_a_mismatched_canvas_declines_to_guess,
               test_which_trim_mode_actually_consumes_the_crop,
               test_rebuild_fx_layers_never_touches_an_ai_layer,
               test_an_ai_layer_switched_to_an_fx_mode_derives_from_its_declared_base,
               test_addlayer_creates_a_seeded_layer,
               test_the_seeded_copy_is_a_starting_point_not_a_link,
               test_addlayer_refuses_the_four_bad_cases,
               test_addlayer_sanitises_the_name,
               test_copyfrom_does_not_carry_the_base_link,
               test_a_reimport_keeps_the_base_link,
               test_deleting_a_base_names_the_layers_it_orphans):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
