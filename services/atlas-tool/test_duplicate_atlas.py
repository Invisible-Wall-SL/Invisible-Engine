"""Offline guard: duplicating an atlas copies the SETUP and shares the SOURCE,
without the two copies ever touching each other's results. No R2, no ComfyUI.

Run:  PYTHONPATH=".;../_shared" py test_duplicate_atlas.py

THE WORKFLOW. A blueprint extracts parts of a source sequence — the character
in one pass, the background in another. The atlas is authored ONCE (regions,
source refs, blueprint, params); each further pass wants that same setup under
a new name with different prompts, producing its own sheet. Before this, every
pass meant rebuilding from an empty atlas.

WHY THE REGIONS ARE RENAMED, AND WHY THAT IS NOT COSMETIC. Generated variants
live at `batch/<region>_NNNNN_.png` — keyed by NAME, project-wide, with no
atlas anywhere in the path. Two atlases sharing a region name therefore share
ONE pile, and `_pick_variant_png` hands back the newest file in it. So a copy
that kept its names would, on its first render:

  * move the ORIGINAL's cards and its composed sheet onto the copy's art — no
    pick required, since an unpicked region already composes `files[-1]`;
  * have `_drop_superseded_picks` delete the original's pin on its next render
    (`variant_at` reads any newer id as "spent").

Only an explicit `lock` survives that, and nothing looks wrong until the wrong
art ships. `refs/useroutput_<name>.png` (the committed tile) and
`refs/fxsrc_<name>.png` are keyed the same way. Distinct names separate all
three by construction — no shared mutable state to get the scoping wrong.

WHY THE REFS ARE **NOT** RENAMED. `shape_ref`/`style_ref` hold stored PATHS and
are never re-derived from the region name — `_setref` picks the filename once,
at upload, and every reader does a plain `region.get("shape_ref")`. Copying
their values verbatim is therefore what points both atlases at the very same
source images, which is the entire point of duplicating rather than starting
over.

ASCII only in the labels: a non-Latin-1 glyph raises UnicodeEncodeError on this
box's cp1252 console and aborts the whole suite.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

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
# Fixtures: a real staging tree, so the handler writes a real second manifest.
# --------------------------------------------------------------------------
def _stage(regions: list[dict], atlas: dict | None = None,
           extra: dict | None = None) -> tuple[Path, Path]:
    root = Path(tempfile.mkdtemp())
    mdir = root / "manifests"
    mdir.mkdir(parents=True)
    mp = mdir / "atlas_manifest_characters.json"
    m = {"atlas": atlas if atlas is not None else {"layout": "pack",
                                                   "width": 1024},
         "style": {"negative": "blurry"},
         "settings": {"checkpoint": "juggernaut.safetensors",
                      "bpParams": {"extract": {"threshold": 0.4}}},
         "regions": regions}
    m.update(extra or {})
    mp.write_text(json.dumps(m), encoding="utf-8")
    u.manifest_path = lambda: mp                                  # noqa: E731
    u.MANIFEST_DIR = mdir                                         # noqa: E731
    u._mirror = lambda p: None                                    # noqa: E731
    u.list_manifests = lambda: [p.name for p in mdir.glob(        # noqa: E731
        "atlas_manifest_*.json")]
    u.load_config = lambda: {}                                    # noqa: E731
    u.save_config = lambda c: None                                # noqa: E731
    return mp, mdir


def _handler():
    return u.Handler.__new__(u.Handler)


def _regions(mp: Path) -> dict:
    m = json.loads(mp.read_text(encoding="utf-8"))
    return {r["name"]: r for r in m["regions"]}


def _doc(mp: Path) -> dict:
    return json.loads(mp.read_text(encoding="utf-8"))


SETUP = [
    {"name": "frame_001", "prompt": "the character", "negative": "text",
     "pipeline": "extract", "shape_ref": "refs/userref_frame_001.png",
     "style_ref": "refs/style_sheet.png", "controlnet_strength": 0.8,
     "x": 0, "y": 0, "w": 256, "h": 256, "fit_mode": "contain",
     "seed": 4242, "lock": True, "variant": "00007", "variant_at": "00007",
     "output_override": "refs/useroutput_frame_001.png"},
    {"name": "frame_002", "prompt": "the character", "pipeline": "extract",
     "shape_ref": "refs/userref_frame_002.png", "x": 256, "y": 0,
     "w": 256, "h": 256},
]


# --------------------------------------------------------------------------
# 1. The setup comes across
# --------------------------------------------------------------------------
def test_the_whole_setup_is_copied():
    mp, mdir = _stage([dict(r) for r in SETUP])
    msg = _handler()._duplicateatlas({"name": "backgrounds", "prefix": "bg"})
    check("it reports success", msg.startswith("✓"), True)
    dest = mdir / "atlas_manifest_backgrounds.json"
    check("the new manifest exists", dest.exists(), True)
    new = _doc(dest)
    check("atlas settings come across", new["atlas"]["width"], 1024)
    check("the layout comes across", new["atlas"]["layout"], "pack")
    check("the global style comes across", new["style"]["negative"], "blurry")
    check("per-atlas settings come across",
          new["settings"]["checkpoint"], "juggernaut.safetensors")
    check("...including blueprint params",
          new["settings"]["bpParams"]["extract"]["threshold"], 0.4)
    r = _regions(dest)["bg_frame_001"]
    check("the prompt comes across", r["prompt"], "the character")
    check("the negative comes across", r["negative"], "text")
    check("the pipeline/blueprint comes across", r["pipeline"], "extract")
    check("advanced tuning comes across", r["controlnet_strength"], 0.8)
    # The RECT is the layout being duplicated -- unlike a region->region paste,
    # where geometry is identity. Here the whole point is the same placement.
    check("the rect comes across", (r["x"], r["y"], r["w"], r["h"]),
          (0, 0, 256, 256))
    check("the fit mode comes across", r["fit_mode"], "contain")
    check("every region came across", len(_doc(dest)["regions"]), 2)


def test_the_source_refs_are_SHARED_not_renamed():
    # The linchpin: a ref is a stored PATH, never re-derived from the region
    # name, so copying the value verbatim points both atlases at one file.
    mp, mdir = _stage([dict(r) for r in SETUP])
    _handler()._duplicateatlas({"name": "backgrounds", "prefix": "bg"})
    orig = _regions(mp)["frame_001"]
    copy_ = _regions(mdir / "atlas_manifest_backgrounds.json")["bg_frame_001"]
    check("the shape ref is the ORIGINAL's file",
          copy_["shape_ref"], orig["shape_ref"])
    check("...literally the same path", copy_["shape_ref"],
          "refs/userref_frame_001.png")
    check("the style ref too", copy_["style_ref"], "refs/style_sheet.png")


# --------------------------------------------------------------------------
# 2. Nothing that could corrupt the original comes across
# --------------------------------------------------------------------------
def test_results_do_not_come_across():
    mp, mdir = _stage([dict(r) for r in SETUP])
    _handler()._duplicateatlas({"name": "backgrounds", "prefix": "bg"})
    r = _regions(mdir / "atlas_manifest_backgrounds.json")["bg_frame_001"]
    # Each of these names a file in the ORIGINAL's pile or its committed tile.
    check("the pick does not", "variant" in r, False)
    check("the pick's generation does not", "variant_at" in r, False)
    check("the seed does not", "seed" in r, False)
    check("the lock does not", "lock" in r, False)
    check("the committed tile does not", "output_override" in r, False)


def test_the_deploy_target_is_cleared():
    # deploy_path + deploy_basename decide WHERE the sheet publishes. Copied
    # verbatim, the duplicate would publish straight over the sheet the
    # original ships -- the one collision the manifest stem does NOT prevent.
    mp, mdir = _stage([dict(r) for r in SETUP],
                      extra={"deploy_path": "sprites/characters",
                             "deploy_basename": "characters"})
    _handler()._duplicateatlas({"name": "backgrounds", "prefix": "bg"})
    new = _doc(mdir / "atlas_manifest_backgrounds.json")
    check("deploy_path is cleared", "deploy_path" in new, False)
    check("deploy_basename is cleared", "deploy_basename" in new, False)
    check("the ORIGINAL keeps its deploy target",
          _doc(mp)["deploy_path"], "sprites/characters")


def test_the_two_atlases_share_no_generated_name():
    """The collision this whole design exists to prevent, stated as the test
    that would fail if the rename were ever made optional."""
    mp, mdir = _stage([dict(r) for r in SETUP])
    _handler()._duplicateatlas({"name": "backgrounds", "prefix": "bg"})
    a = set(_regions(mp))
    b = set(_regions(mdir / "atlas_manifest_backgrounds.json"))
    check("no region name is shared", a & b, set())
    # Which is what keeps these three project-level, name-keyed paths apart.
    for tmpl in ("batch/{}_00001_.png", "refs/useroutput_{}.png",
                 "refs/fxsrc_{}.png"):
        check(f"...so {tmpl.format('<region>')} never collides",
              {tmpl.format(n) for n in a} & {tmpl.format(n) for n in b}, set())


def test_a_layer_link_follows_the_rename():
    # layer_of points at a region BY NAME. Left alone it would dangle -- or,
    # worse, still resolve inside the copy to a name that no longer exists.
    mp, mdir = _stage([{"name": "H1", "prompt": "p"},
                       {"name": "H1_fire", "layer_of": "H1"}])
    _handler()._duplicateatlas({"name": "backgrounds", "prefix": "bg"})
    r = _regions(mdir / "atlas_manifest_backgrounds.json")
    check("the layer was renamed", "bg_H1_fire" in r, True)
    check("and its base link followed", r["bg_H1_fire"]["layer_of"], "bg_H1")


# --------------------------------------------------------------------------
# 3. Refusals
# --------------------------------------------------------------------------
def test_it_refuses_rather_than_overwrite():
    mp, mdir = _stage([dict(r) for r in SETUP])
    (mdir / "atlas_manifest_backgrounds.json").write_text("{}", encoding="utf-8")
    msg = _handler()._duplicateatlas({"name": "backgrounds", "prefix": "bg"})
    check("it refuses", msg.startswith("⚠"), True)
    check("and says why", "already exists" in msg, True)
    check("the existing atlas is untouched",
          (mdir / "atlas_manifest_backgrounds.json").read_text(
              encoding="utf-8"), "{}")


def test_the_tag_is_required():
    mp, mdir = _stage([dict(r) for r in SETUP])
    msg = _handler()._duplicateatlas({"name": "backgrounds", "prefix": "  "})
    check("a blank tag is refused", msg.startswith("Give"), True)
    check("and it says what the tag is FOR", "apart" in msg, True)
    check("nothing was written",
          (mdir / "atlas_manifest_backgrounds.json").exists(), False)


def test_it_refuses_a_bound_atlas():
    # A `.atlas` owns the region list; a renamed manifest region has no
    # counterpart and all_regions drops it, so the copy would come out empty.
    mp, mdir = _stage([dict(r) for r in SETUP],
                      atlas={"atlas_file": "refs/atlas/game.atlas"})
    msg = _handler()._duplicateatlas({"name": "backgrounds", "prefix": "bg"})
    check("it refuses", msg.startswith("⚠"), True)
    check("and names the reason", ".atlas" in msg, True)
    check("nothing was written",
          (mdir / "atlas_manifest_backgrounds.json").exists(), False)


def test_it_refuses_an_empty_atlas_and_a_nameless_copy():
    mp, mdir = _stage([])
    check("no regions is refused",
          _handler()._duplicateatlas({"name": "b", "prefix": "bg"}
                                     ).startswith("⚠"), True)
    mp, mdir = _stage([dict(r) for r in SETUP])
    check("no name is asked for",
          _handler()._duplicateatlas({"name": "", "prefix": "bg"}
                                     ).startswith("Give"), True)


def test_the_tag_is_sanitised():
    mp, mdir = _stage([dict(r) for r in SETUP])
    _handler()._duplicateatlas({"name": "backgrounds", "prefix": "bg 2!"})
    # The name is a variant-file prefix on disk, so it must stay path-safe.
    check("punctuation collapses",
          "bg_2_frame_001" in _regions(mdir / "atlas_manifest_backgrounds.json"),
          True)


if __name__ == "__main__":
    for fn in (test_the_whole_setup_is_copied,
               test_the_source_refs_are_SHARED_not_renamed,
               test_results_do_not_come_across,
               test_the_deploy_target_is_cleared,
               test_the_two_atlases_share_no_generated_name,
               test_a_layer_link_follows_the_rename,
               test_it_refuses_rather_than_overwrite,
               test_the_tag_is_required,
               test_it_refuses_a_bound_atlas,
               test_it_refuses_an_empty_atlas_and_a_nameless_copy,
               test_the_tag_is_sanitised):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
