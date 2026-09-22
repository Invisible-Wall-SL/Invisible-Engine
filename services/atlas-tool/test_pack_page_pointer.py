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

    def push_file(self, local_path, key) -> bool:
        # Faithful to the real one: it SWALLOWS the error and reports False —
        # it never raises. A fake that raised let the caller's dead `except`
        # look alive.
        if self.fail_push:
            return False
        self.objects[str(key)] = Path(local_path).read_bytes()
        return True

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


# --------------------------------------------------------------------------
# 5. The 2026-09-16 regression: a page that is not this compose's page must
#    never be published, and must never be deployed.
#
#    WHAT HAPPENED. `publish_pack_page` mirrors each composed page to
#    `<C>/<P>/atlas/<stem>_new.webp`, and `cloud_paths.hydrate()` pulls `atlas/`
#    in a BACKGROUND thread. `pull_prefix` re-downloaded any object whose byte
#    count differed from the local file -- newer local file or not -- so a pull
#    that landed while (or just after) compose ran replaced the FRESH page with
#    the OLD one from the bucket and stamped it with a brand-new mtime. The
#    "is this page from this compose?" check is an mtime check, so it passed;
#    the old 2047x1173 page was published under a 1934x1612 packing and then
#    deployed. In the game: every frame cropped from the wrong canvas (offset,
#    off-centre art) and the 7 rects below y=1173 dropped -- a 25-frame clip
#    shipped with 18 frames.
#
#    Three guards, tested here: hydration does not overwrite newer local work;
#    an older `.webp` never shadows the `.png` beside it; and neither publish
#    nor deploy accepts a page whose MEASURED size contradicts the manifest.
# --------------------------------------------------------------------------
def _backdate(p: Path, seconds: int = 120) -> None:
    t = p.stat().st_mtime - seconds
    os.utime(p, (t, t))


def test_a_stale_webp_never_shadows_the_png_compose_just_wrote() -> None:
    bucket = FakeR2()
    mp = _fixture({"H1": (120, 90), "L1": (64, 64)}, {
        "layout": "pack",
        "source_image_path": "unassigned/cloud/sheets/SquidIdle/SquidIdle.png",
    })

    def stale_webp_beside_a_fresh_png(p: Path, stem: str) -> None:
        _compose_the_declared_page(p, stem)
        # The shape hydration leaves behind: a page from an EARLIER packing,
        # in the format everything prefers, sitting next to the real one.
        out = Path(u.ATLAS_DIR) / f"{stem}_new.webp"
        Image.new("RGBA", (2047, 1173), (0, 0, 0, 255)).save(out, "WEBP")
        _backdate(out)

    _install(bucket, mp, compose=stale_webp_beside_a_fresh_png)
    u.run_compose()

    m = _read(mp)
    key = m["atlas"]["source_image_path"]
    check("the older .webp is ignored and the .png is named", key,
          "unassigned/cloud/atlas/SquidIdle_new.png")
    check("the stale .webp is NOT in the bucket",
          "unassigned/cloud/atlas/SquidIdle_new.webp" in bucket.objects, False)
    import io
    with Image.open(io.BytesIO(bucket.objects[key])) as page:
        check("and what IS published is the size this atlas packed",
              page.size, (m["atlas"]["width"], m["atlas"]["height"]))
    check("the log says which file it refused and why",
          "Ignored SquidIdle_new.webp" in str(u._run_cmd.note), True)


def test_a_page_whose_size_contradicts_the_manifest_is_never_published() -> None:
    """The measured check -- the only one an mtime cannot fool. The page here is
    as fresh as any compose could make it; it is simply not the page these rects
    were packed into."""
    bucket = FakeR2()
    mp = _fixture({"H1": (120, 90), "L1": (64, 64)}, {
        "layout": "pack",
        "source_image_path": "unassigned/cloud/sheets/SquidIdle/SquidIdle.png",
    })

    def a_page_from_another_packing(p: Path, stem: str) -> None:
        out = Path(u.ATLAS_DIR)
        for ext in ("png", "webp"):
            Image.new("RGBA", (2047, 1173), (0, 0, 0, 255)).save(
                out / f"{stem}_new.{ext}")

    _install(bucket, mp, compose=a_page_from_another_packing)
    u.run_compose()

    m = _read(mp)
    check("nothing was pushed under atlas/",
          [k for k in bucket.objects if "/atlas/" in k], [])
    check("the manifest keeps its previous pointer",
          m["atlas"]["source_image_path"],
          "unassigned/cloud/sheets/SquidIdle/SquidIdle.png")
    note = str(u._run_cmd.note)
    check("the log names both sizes",
          "2047×1173" in note and f"{m['atlas']['width']}×{m['atlas']['height']}"
          in note, True)
    check("...and it is a refusal, not a warning after the fact",
          note.startswith("⚠ Page pointer not updated"), True)


def _compose_the_declared_page_with_ink(mp: Path, stem: str) -> None:
    """As `_compose_the_declared_page`, but with each region's rect actually
    inked -- the deploy refuses a frame map over a page that is blank, and that
    refusal would mask the ones under test here."""
    m = json.loads(mp.read_text(encoding="utf-8"))
    w, h = int(m["atlas"]["width"]), int(m["atlas"]["height"])
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for r in m.get("regions") or []:
        if all(k in r for k in ("x", "y", "w", "h")):
            canvas.paste(Image.new("RGBA", (int(r["w"]), int(r["h"])),
                                   (200, 30, 30, 255)), (int(r["x"]), int(r["y"])))
    out = Path(u.ATLAS_DIR)
    canvas.save(out / f"{stem}_new.png")
    canvas.save(out / f"{stem}_new.webp", "WEBP", quality=95)


def _deploy_ready(bucket: FakeR2, regions: dict) -> Path:
    """A packed, composed manifest with a mirrored deploy prefix, ready to
    deploy. Returns its path."""
    mp = _fixture(regions, {"layout": "pack"})
    _install(bucket, mp, compose=_compose_the_declared_page_with_ink)
    u.run_compose()
    m = _read(mp)
    m["deploy_path"] = "sprites/SquidIdle"
    mp.write_text(json.dumps(m, indent=2), encoding="utf-8")
    return mp


def _deploy() -> str:
    """`_deployatlas` touches no request state (no `self.` anywhere in it), so
    the real method drives straight off the class."""
    return u.Handler._deployatlas(None)


def test_the_deploy_ships_every_frame_when_page_and_rects_agree() -> None:
    """The control for the two refusals below: with the page this compose
    actually wrote, all 25 frames make it into the spritesheet."""
    bucket = FakeR2()
    names = {f"clip_{i:04d}": (64, 64) for i in range(0, 50, 2)}
    mp = _deploy_ready(bucket, names)
    note = _deploy()
    check("it deployed", note.startswith("✓ Deployed") or "✓ Deployed" in note,
          True)
    sheet = json.loads(
        bucket.objects["unassigned/cloud/deploy/sprites/SquidIdle/SquidIdle.json"])
    check("all 25 frames shipped -- none dropped off the bottom of the page",
          len(sheet["frames"]), 25)
    m = _read(mp)
    check("and meta.size is the page that was shipped",
          (sheet["meta"]["size"]["w"], sheet["meta"]["size"]["h"]),
          (m["atlas"]["width"], m["atlas"]["height"]))


def test_the_deploy_refuses_a_page_that_contradicts_the_manifest() -> None:
    """The live half of the bug: 25 rects packed 1934x1612, a 2047x1173 page in
    the bucket, 7 frames silently gone. The deploy already MEASURED the page --
    it just measured it after uploading, and only dropped the frames that fell
    off it. Now nothing is uploaded at all."""
    bucket = FakeR2()
    names = {f"clip_{i:04d}": (64, 64) for i in range(0, 50, 2)}
    mp = _deploy_ready(bucket, names)
    _deploy()
    before = dict(bucket.objects)
    m = _read(mp)
    w, h = int(m["atlas"]["width"]), int(m["atlas"]["height"])
    # Wider and shorter than the page the manifest declares -- the live shape.
    # Derived FROM the packed page, never a hardcoded ±px: which way round the
    # packer lays 25 equal tiles out is its business (`atlas.pack_trim`'s
    # default flipping to `keep` turned this fixture's 68x1652 column into a
    # 1980x174 band, and a literal `h - 439` then asked PIL for a negative
    # height), and this test is about the size DISAGREEING, not about its value.
    bad_w, bad_h = w + 113, max(1, h // 3)
    for ext in ("png", "webp"):
        Image.new("RGBA", (bad_w, bad_h), (0, 0, 0, 255)).save(
            Path(u.ATLAS_DIR) / f"SquidIdle_new.{ext}")

    note = _deploy()

    check("the deploy is refused outright", note.startswith("⚠ REFUSED to deploy"),
          True)
    check("...naming the page size and the packed size",
          f"{bad_w}×{bad_h}" in note and f"{w}×{h}" in note, True)
    check("nothing was uploaded -- the previous deploy still stands",
          bucket.objects, before)


def test_the_deploy_does_not_ship_a_stale_webp() -> None:
    bucket = FakeR2()
    mp = _deploy_ready(bucket, {"H1": (120, 90), "L1": (64, 64)})
    m = _read(mp)
    w, h = int(m["atlas"]["width"]), int(m["atlas"]["height"])
    webp = Path(u.ATLAS_DIR) / "SquidIdle_new.webp"
    Image.new("RGBA", (2047, 1173), (0, 0, 0, 255)).save(webp, "WEBP")
    _backdate(webp)
    bucket.objects.clear()

    note = _deploy()

    dest = "unassigned/cloud/deploy/sprites/SquidIdle"
    check("the stale .webp is not shipped", f"{dest}/SquidIdle.webp"
          in bucket.objects, False)
    check("the .png compose wrote is shipped instead",
          f"{dest}/SquidIdle.png" in bucket.objects, True)
    sheet = json.loads(bucket.objects[f"{dest}/SquidIdle.json"])
    check("and the frame map points at it", sheet["meta"]["image"],
          "SquidIdle.png")
    check("meta.size is the packed page", (sheet["meta"]["size"]["w"],
          sheet["meta"]["size"]["h"]), (w, h))
    check("the note says what it left behind",
          "Did NOT ship SquidIdle_new.webp" in note, True)


def test_the_deploy_does_not_ship_a_stale_webp_of_the_RIGHT_size() -> None:
    """The case the size check cannot see: a leftover page of the same layout,
    so the only thing wrong with it is its pixels. Compose writes the .png and
    THEN the .webp, so a webp older than the png beside it was not written by
    the same run -- that ordering is the whole test."""
    bucket = FakeR2()
    mp = _deploy_ready(bucket, {"H1": (120, 90), "L1": (64, 64)})
    m = _read(mp)
    w, h = int(m["atlas"]["width"]), int(m["atlas"]["height"])
    webp = Path(u.ATLAS_DIR) / "SquidIdle_new.webp"
    Image.new("RGBA", (w, h), (0, 255, 0, 255)).save(webp, "WEBP")
    _backdate(webp)
    bucket.objects.clear()

    note = _deploy()

    dest = "unassigned/cloud/deploy/sprites/SquidIdle"
    check("the right-sized but OLDER .webp is still not shipped",
          f"{dest}/SquidIdle.webp" in bucket.objects, False)
    check("the .png from this compose is", f"{dest}/SquidIdle.png"
          in bucket.objects, True)
    check("and it is named as left behind",
          "Did NOT ship SquidIdle_new.webp" in note, True)


def test_hydration_never_overwrites_a_newer_local_file() -> None:
    """The mechanism itself, at its source. `pull_prefix` used to re-download
    over ANY local file whose byte count differed from the object -- including
    one written seconds ago by a compose that had not been pushed yet."""
    import iw_common.storage as st

    root = Path(tempfile.mkdtemp(prefix="pull-newer-"))
    fresh = root / "atlas" / "SquidIdle_new.webp"
    fresh.parent.mkdir(parents=True, exist_ok=True)
    fresh.write_bytes(b"the page this compose just wrote")
    missing = root / "atlas" / "Other_new.webp"
    older = root / "atlas" / "Older_new.webp"
    older.write_bytes(b"downloaded a while back, then re-uploaded elsewhere")
    _backdate(older, 600)

    now = fresh.stat().st_mtime
    objects = {
        "c/p/atlas/SquidIdle_new.webp": (b"the OLD page, still in the bucket",
                                         now - 300),
        "c/p/atlas/Other_new.webp": (b"a page this container has never seen",
                                     now - 300),
        "c/p/atlas/Older_new.webp": (b"a genuinely newer object", now),
    }

    class FakeClient:
        def download_file(self, bucket, key, dest):
            Path(dest).write_bytes(objects[key][0])

    real_list, real_client, real_bucket = st.list_keys, st._client, st._bucket
    st.list_keys = lambda prefix: [                              # noqa: E731
        {"key": k, "size": len(v[0]), "mtime": v[1]}
        for k, v in objects.items() if k.startswith(prefix)]
    st._client = lambda: FakeClient()                            # noqa: E731
    st._bucket = lambda: "bucket"                                # noqa: E731
    try:
        pulled = st.pull_prefix("c/p/atlas/", root, "c/p/")
    finally:
        st.list_keys, st._client, st._bucket = real_list, real_client, real_bucket

    check("the freshly composed page is NOT clobbered by the old object",
          fresh.read_bytes(), b"the page this compose just wrote")
    check("a file this container does not have is still pulled",
          missing.is_file(), True)
    check("...and so is an object genuinely newer than our copy",
          older.read_bytes(), b"a genuinely newer object")
    check("two downloads, not three", pulled, 2)


if __name__ == "__main__":
    for fn in (test_a_repack_repoints_the_manifest_at_the_page_it_just_composed,
               test_the_webp_is_preferred_but_a_png_only_compose_still_resolves,
               test_a_failed_mirror_leaves_the_old_pointer_standing,
               test_a_leftover_page_from_an_earlier_run_is_refused,
               test_a_non_pack_manifest_is_left_exactly_as_it_was,
               test_the_page_basename_join_still_only_sees_sheet_maker_pages,
               test_the_flipbook_sheet_no_longer_declares_pack,
               test_a_stale_webp_never_shadows_the_png_compose_just_wrote,
               test_a_page_whose_size_contradicts_the_manifest_is_never_published,
               test_the_deploy_ships_every_frame_when_page_and_rects_agree,
               test_the_deploy_refuses_a_page_that_contradicts_the_manifest,
               test_the_deploy_does_not_ship_a_stale_webp,
               test_the_deploy_does_not_ship_a_stale_webp_of_the_RIGHT_size,
               test_hydration_never_overwrites_a_newer_local_file):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
