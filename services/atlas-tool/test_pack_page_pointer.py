"""Offline guard: a `pack` atlas's DECLARED PAGE and its RECTS come from the
same producer (no R2, no GPU, no ComfyUI).

Run:  PYTHONPATH=".;../_shared" py test_pack_page_pointer.py   (from services/atlas-tool)

THE SHAPE THIS REMOVES. `atlas.layout: "pack"` means the Atlas Maker owns the
layout: `auto_pack_layout` re-measures every region's art and re-derives
`x/y/w/h` plus `atlas.width/height` on every Create Atlas. But the manifests that
carried that declaration pointed `atlas.source_image_path` at a page NOBODY
re-packs -- a Flipbook sheet under `sheets/`, an import under `refs/atlas/` --
so the very first re-pack left the manifest naming a page its own rects no
longer fit. Nothing errored: the launcher cropped fresh rects out of a
differently-sized page and `/editor`, `/symbols` and `/flipbook` all showed
sliced-wrong pixels. Seen live on `invisible_wall/test6`, 2026-09-16: manifest
2047x1173, declared page 1934x1612.

Two halves, fixed on both sides of the line:

  * a manifest that really is `pack` now names THIS tool's own composed page
    (`<C>/<P>/atlas/<stem>_new.webp`) -- and that page is mirrored to R2 FIRST,
    so the key it names is never absent from the bucket (`publish_pack_page`);
  * a manifest whose layout is owned by another packer (Flipbook video mode)
    stops declaring `pack` at all, so nothing re-packs it and its page, rects
    and TexturePacker descriptor stay one consistent set.

ASCII only in the labels: a non-Latin-1 glyph aborts the suite on this box's
cp1252 console.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

from PIL import Image

# Sandbox staging BEFORE importing the tool: ATLAS_DIR / BATCH_DIR / MANIFEST_DIR
# all resolve out of it at import time.
_STAGING = tempfile.mkdtemp(prefix="pack-page-")
os.environ["ATLAS_STAGING"] = _STAGING

import ui_server as u  # noqa: E402
import video_to_clip  # noqa: E402

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
# A fake bucket. Every write the tool makes lands here keyed exactly as R2
# would key it, so a test can assert "the key the manifest names IS in the
# bucket" -- the invariant the whole change exists for.
# --------------------------------------------------------------------------
class FakeR2:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.fail_push = False

    def push_file(self, local_path, key) -> None:
        if self.fail_push:
            raise OSError("bucket unreachable")
        self.objects[str(key)] = Path(local_path).read_bytes()

    def put(self, key, body, content_type=None, **kw) -> None:
        self.objects[str(key)] = body

    def delete(self, key) -> None:
        self.objects.pop(str(key), None)

    def push_dir(self, src_root, key_root) -> int:
        return 0

    def get(self, key):
        return self.objects.get(str(key))

    def list_keys(self, prefix):
        return [{"key": k} for k in self.objects if k.startswith(str(prefix))]


def _tile(w: int, h: int, colour: tuple[int, int, int, int]) -> Image.Image:
    """Art with a transparent margin, so the ALPHA-TRIMMED footprint
    auto_pack_layout measures is genuinely smaller than the file."""
    im = Image.new("RGBA", (w + 20, h + 20), (0, 0, 0, 0))
    im.paste(Image.new("RGBA", (w, h), colour), (10, 10))
    return im


def _fixture(regions: dict[str, tuple[int, int]], atlas: dict) -> Path:
    """A manifest on disk plus one committed variant PNG per region."""
    man_dir = Path(u.MANIFEST_DIR)
    batch = Path(u.BATCH_DIR)
    man_dir.mkdir(parents=True, exist_ok=True)
    batch.mkdir(parents=True, exist_ok=True)
    # One staging tree for the whole suite: clear any composed page an earlier
    # case left, or "was this page written by THIS compose" reads the wrong file.
    out = Path(u.ATLAS_DIR)
    out.mkdir(parents=True, exist_ok=True)
    for p in out.glob("*_new.*"):
        p.unlink()
    for name, (w, h) in regions.items():
        _tile(w, h, (200, 30, 30, 255)).save(batch / f"{name}_00001_.png")
    mp = man_dir / "atlas_manifest_SquidIdle.json"
    mp.write_text(json.dumps({
        "atlas": atlas,
        "style": {},
        "export_prefix": "unassigned/cloud/sheets/SquidIdle",
        "regions": [{"name": n} for n in regions],
    }, indent=2), encoding="utf-8")
    return mp


def _install(bucket: FakeR2, mp: Path, *, compose=None):
    """Point the tool at `mp` + the fake bucket, and stand in for the compose
    subprocess. `compose(mp, stem)` writes whatever page this test wants."""
    u.storage = bucket
    u.creative_manifest_path = lambda: mp                         # noqa: E731
    u.project_paths.ensure_lazy = lambda sub: None                # noqa: E731
    u.rebuild_fx_layers_at = lambda p, base_names=None: ([], [])  # noqa: E731

    def fake_run_cmd(cmd, total, post_hook=None, pre_note=None, **kw):
        stem = Path(cmd[cmd.index("--manifest") + 1]).stem.replace(
            "atlas_manifest_", "")
        if compose is not None:
            compose(mp, stem)
        # The real _run_cmd runs the hook after the subprocess exits, and its
        # note goes to the visible log.
        fake_run_cmd.note = post_hook() if post_hook else None

    fake_run_cmd.note = None
    u._run_cmd = fake_run_cmd
    return fake_run_cmd


def _compose_the_declared_page(mp: Path, stem: str) -> None:
    """What batch_atlas --compose-only does, reduced to the one fact that
    matters here: the page it writes is exactly the size the manifest declares
    at the moment it reads it."""
    m = json.loads(mp.read_text(encoding="utf-8"))
    w, h = int(m["atlas"]["width"]), int(m["atlas"]["height"])
    out = Path(u.ATLAS_DIR)
    out.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.save(out / f"{stem}_new.png")
    canvas.save(out / f"{stem}_new.webp", "WEBP", quality=95)


def _read(mp: Path) -> dict:
    return json.loads(mp.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------
# 1. The invariant: page and rects, one producer, one run.
# --------------------------------------------------------------------------
def test_a_repack_repoints_the_manifest_at_the_page_it_just_composed() -> None:
    bucket = FakeR2()
    mp = _fixture({"H1": (120, 90), "L1": (64, 64)}, {
        "layout": "pack",
        # The Flipbook's page: a DIFFERENT packing, written by another producer.
        "source_image": "SquidIdle.png",
        "source_image_path": "unassigned/cloud/sheets/SquidIdle/SquidIdle.png",
        "texturepacker_json": "unassigned/cloud/sheets/SquidIdle/SquidIdle.json",
        "width": 1934, "height": 1612,
    })
    _install(bucket, mp, compose=_compose_the_declared_page)

    u.run_compose()

    m = _read(mp)
    key = m["atlas"]["source_image_path"]
    check("the manifest names the Atlas Maker's own composed page",
          key, "unassigned/cloud/atlas/SquidIdle_new.webp")
    check("...and that key IS in the bucket (never a dangling pointer)",
          key in bucket.objects, True)
    check("source_image agrees with it", m["atlas"]["source_image"],
          "SquidIdle_new.webp")

    # THE INVARIANT, measured in pixels: the page the manifest points at has the
    # size the manifest's rects were packed into.
    import io
    with Image.open(io.BytesIO(bucket.objects[key])) as page:
        check("the declared page's real size == the packed page size",
              page.size, (m["atlas"]["width"], m["atlas"]["height"]))
    check("...which is NOT the page it came in naming",
          (m["atlas"]["width"], m["atlas"]["height"]) == (1934, 1612), False)
    for r in m["regions"]:
        check(f"region {r['name']} fits inside the declared page",
              r["x"] + r["w"] <= m["atlas"]["width"]
              and r["y"] + r["h"] <= m["atlas"]["height"], True)

    check("the superseded TexturePacker descriptor is gone (it outranks the "
          "manifest's own rects in the launcher)",
          "texturepacker_json" in m["atlas"], False)
    check("export_prefix is left alone -- provenance, and it gates the seed",
          m.get("export_prefix"), "unassigned/cloud/sheets/SquidIdle")
    check("the log says where the page went",
          str(u._run_cmd.note).startswith("Page → unassigned/cloud/atlas/"),
          True)

    # Slice (and anything else that needs the page bitmap) resolves the new
    # location: `atlas/` had never been a page location before, so the by-BASENAME
    # fallback -- which scans only refs/ and sheets/ -- would have missed it.
    import batch_atlas
    cands = batch_atlas.source_image_candidates(m, None, "")
    check("source_image_candidates offers the composed page, and it is on disk",
          any(c.exists() and c.name == "SquidIdle_new.webp" for c in cands), True)


def test_the_webp_is_preferred_but_a_png_only_compose_still_resolves() -> None:
    """Deploy ships WebP-only when the encode worked; when it didn't, the PNG is
    the page -- and the manifest must name whichever one actually exists."""
    bucket = FakeR2()
    mp = _fixture({"H1": (80, 80)}, {"layout": "pack"})

    def png_only(p: Path, stem: str) -> None:
        _compose_the_declared_page(p, stem)
        (Path(u.ATLAS_DIR) / f"{stem}_new.webp").unlink()

    _install(bucket, mp, compose=png_only)
    u.run_compose()
    key = _read(mp)["atlas"]["source_image_path"]
    check("falls back to the .png page", key,
          "unassigned/cloud/atlas/SquidIdle_new.png")
    check("...and it is in the bucket", key in bucket.objects, True)

    # A zero-byte WEBP is the failed-encode case compose deletes; if one does
    # survive it must never be named.
    bucket2 = FakeR2()
    mp2 = _fixture({"H1": (80, 80)}, {"layout": "pack"})

    def empty_webp(p: Path, stem: str) -> None:
        _compose_the_declared_page(p, stem)
        (Path(u.ATLAS_DIR) / f"{stem}_new.webp").write_bytes(b"")

    _install(bucket2, mp2, compose=empty_webp)
    u.run_compose()
    check("a 0-byte webp is refused in favour of the png",
          _read(mp2)["atlas"]["source_image_path"],
          "unassigned/cloud/atlas/SquidIdle_new.png")


# --------------------------------------------------------------------------
# 2. It never opens a window where the manifest names a missing key.
# --------------------------------------------------------------------------
def test_a_failed_mirror_leaves_the_old_pointer_standing() -> None:
    bucket = FakeR2()
    mp = _fixture({"H1": (80, 80)}, {
        "layout": "pack",
        "source_image_path": "unassigned/cloud/sheets/SquidIdle/SquidIdle.png",
    })
    _install(bucket, mp, compose=_compose_the_declared_page)
    bucket.fail_push = True

    u.run_compose()

    check("the manifest still names its previous page",
          _read(mp)["atlas"]["source_image_path"],
          "unassigned/cloud/sheets/SquidIdle/SquidIdle.png")
    check("...rather than a key that is not in the bucket",
          "unassigned/cloud/atlas/SquidIdle_new.webp" in bucket.objects, False)
    check("and the log says so", str(u._run_cmd.note).startswith(
        "⚠ Composed page not mirrored"), True)


def test_a_leftover_page_from_an_earlier_run_is_refused() -> None:
    """Compose produced nothing this run (it bails when there is no geometry, it
    can fail outright). The `<stem>_new.*` still on disk describes an OLDER
    packing, so publishing it under the rects just stamped would recreate the
    exact mismatch."""
    bucket = FakeR2()
    mp = _fixture({"H1": (80, 80)}, {
        "layout": "pack",
        "source_image_path": "unassigned/cloud/sheets/SquidIdle/SquidIdle.png",
    })
    stale = Path(u.ATLAS_DIR)
    stale.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (2, 2), (0, 0, 0, 255)).save(stale / "SquidIdle_new.png")
    os.utime(stale / "SquidIdle_new.png", (1_600_000_000, 1_600_000_000))

    _install(bucket, mp, compose=None)  # the subprocess writes nothing
    u.run_compose()

    check("the stale page is not published",
          "unassigned/cloud/atlas/SquidIdle_new.png" in bucket.objects, False)
    check("the manifest keeps its previous pointer",
          _read(mp)["atlas"]["source_image_path"],
          "unassigned/cloud/sheets/SquidIdle/SquidIdle.png")
    check("and the log names the reason",
          "predates this compose" in str(u._run_cmd.note), True)


# --------------------------------------------------------------------------
# 3. Only `pack` manifests are touched.
# --------------------------------------------------------------------------
def test_a_non_pack_manifest_is_left_exactly_as_it_was() -> None:
    """Sheet-Maker sheets, `.atlas`-bound rigs and raw imports own their own
    layout. auto_pack_layout no-ops for them, and so must the page pointer."""
    bucket = FakeR2()
    original = {
        "source_image": "S_Lotus.png",
        "source_image_path": "unassigned/cloud/sheets/S_Lotus/S_Lotus.png",
        "texturepacker_json": "unassigned/cloud/sheets/S_Lotus/S_Lotus.json",
        "width": 512, "height": 512,
    }
    mp = _fixture({"H1": (80, 80)}, dict(original))
    _install(bucket, mp, compose=_compose_the_declared_page)

    # (note, changed) since the unplaced-rect fix; `changed` is the save
    # signal the caller used to infer from the note's leading glyph.
    check("auto_pack_layout no-ops on it",
          u.auto_pack_layout(_read(mp)), (None, False))
    u.run_compose()
    check("the atlas block is byte-for-byte what it was",
          _read(mp)["atlas"], original)
    check("nothing was pushed under atlas/",
          [k for k in bucket.objects if "/atlas/" in k], [])


def test_the_page_basename_join_still_only_sees_sheet_maker_pages() -> None:
    """`_sheet_manifest_for` joins on the page BASENAME, and a pack atlas's page
    basename is now `<stem>_new.webp`. No Sheet-Maker manifest ever names a page
    like that, so the fit_mode repair stays off pack atlases -- where it was
    always pointless anyway (auto_pack_layout pops `fit_mode`)."""
    check("the composed page basename is read out of the manifest",
          u._page_basename({"atlas": {
              "source_image": "SquidIdle_new.webp",
              "source_image_path": "unassigned/cloud/atlas/SquidIdle_new.webp",
          }}), "SquidIdle_new.webp")
    check("and it matches no Sheet-Maker manifest",
          u._sheet_manifest_for({"atlas": {
              "source_image": "SquidIdle_new.webp"}}), None)
    check("a pack repack drops fit_mode anyway", "fit_mode" in
          Path(u.__file__).read_text(encoding="utf-8")
          .split("def auto_pack_layout(")[1].split("\ndef ")[0], True)


# --------------------------------------------------------------------------
# 4. The other half: the Flipbook sheet stops claiming a layout it does not own.
# --------------------------------------------------------------------------
def test_the_flipbook_sheet_no_longer_declares_pack() -> None:
    packed = {"width": 1934, "height": 1612,
              "regions": [{"name": "clip_0000", "x": 0, "y": 0,
                           "w": 10, "h": 10, "rotated": False}]}
    regions = [{"name": "clip_0000", "x": 0, "y": 0, "w": 10, "h": 10,
                "rotated": False, "off_x": 1, "off_y": 2,
                "orig_w": 12, "orig_h": 14}]
    man = video_to_clip._build_manifest(
        "clip", packed, regions,
        "unassigned/cloud/sheets/clip/clip.png",
        "unassigned/cloud/sheets/clip/clip.json",
        "unassigned/cloud/sheets/clip")

    check("no layout declaration", "layout" in man["atlas"], False)
    check("auto_pack_layout therefore never touches it",
          u.auto_pack_layout(man), (None, False))
    check("its page pointer stays the packer's own page",
          man["atlas"]["source_image_path"],
          "unassigned/cloud/sheets/clip/clip.png")
    check("and so does its descriptor -- page, rects and TP JSON are one set",
          man["atlas"]["texturepacker_json"],
          "unassigned/cloud/sheets/clip/clip.json")
    check("the camelCase frame trim a re-pack would have discarded survives",
          (man["regions"][0]["offX"], man["regions"][0]["origW"]), (1, 12))


if __name__ == "__main__":
    for fn in (test_a_repack_repoints_the_manifest_at_the_page_it_just_composed,
               test_the_webp_is_preferred_but_a_png_only_compose_still_resolves,
               test_a_failed_mirror_leaves_the_old_pointer_standing,
               test_a_leftover_page_from_an_earlier_run_is_refused,
               test_a_non_pack_manifest_is_left_exactly_as_it_was,
               test_the_page_basename_join_still_only_sees_sheet_maker_pages,
               test_the_flipbook_sheet_no_longer_declares_pack):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
