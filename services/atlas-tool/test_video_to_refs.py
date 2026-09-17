"""Offline fixtures for video → Atlas Maker reference images (no R2, no GPU).

Run:  py test_video_to_refs.py   (from services/atlas-tool, PYTHONPATH=../_shared:.)

Builds a REAL animated WEBP in memory with Pillow and runs the real module over
it, with R2 and the path resolver stubbed. The frames that come out are compared
PIXEL-FOR-PIXEL against the frames that went in, because every way this export
goes wrong is silent:

  * a downscale or an alpha-trim sneaking in from the sibling `toclip` path →
    the "reference image" is no longer the render, and the Atlas Maker
    regenerates from a shrunken, re-cropped picture;
  * `shape_ref` instead of `style_ref` → `normalize_shape_ref` grayscales,
    thresholds and rebuilds it on a 1024² canvas: the picture is destroyed and
    the region generates from a silhouette;
  * a ref path the resolver cannot take → `LoadImage: Invalid image file`, or
    (worse) a basename fallback landing on ANOTHER export's frame;
  * an R2 key that is not the one `_locate_ref_in_staging` asks for → works
    until the container restarts, then every ref is gone;
  * packer geometry on a region → the manifest claims rects for a page that
    does not exist, and Create Atlas is no longer the thing that lays them out;
  * an over-budget range TRUNCATED instead of refused → a manifest that is
    complete-looking and short, in the one artifact whose job is to say which
    frames there are.

…and one way it went wrong LOUDLY, which is the newest fixture here: a seeded
page that could not hold every frame used to ABORT the export. Full-size frames
(a 1080x1920 render, ten of them) cannot be arranged under the 4096px seed
ceiling at all, so the one thing this export exists for — getting the images
into the Atlas Maker — became unreachable on the strength of four numbers that
nothing had read yet and that the author retypes anyway. The export now always
proceeds and states the shortfall in `note`; `MAX_PAGE_SIDE` is a seed ceiling,
not a gate.

THE PAGE THIS EXPORT SEEDS. It writes `atlas.layout: "grid"` plus the four
geometry fields `ui_server.grid_layout` reads — and that IS the fix behind #710's
bug report. Under the `pack` layout this used to write, `auto_pack_layout` packs
at a hardcoded 2048 width and then OVERWRITES `atlas.width/height` with the
packer's result, so the Atlas width/height + Default cell width/height the author
typed into ⚙ Settings were read by nothing and discarded on the next Create
Atlas. Here those four are INPUT: seeded to fit the frames at native size, then
retyped by the author and re-flowed. `test_grid_layout.py` owns the layout half;
this file owns what the export hands it, and the last test walks the handoff end
to end so the two halves cannot drift apart.
"""
from __future__ import annotations

import io
import json
import sys
import tempfile
from itertools import islice
from pathlib import Path
from types import SimpleNamespace

from PIL import Image, ImageSequence

import batch_atlas
import storage
import video_runner
import video_to_refs

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)


def check_raises(label: str, fn, needle: str = "") -> None:
    try:
        fn()
    except Exception as e:  # noqa: BLE001 — asserting the raise
        if needle and needle.lower() not in str(e).lower():
            print(f"FAIL {label}\n       raised {e!r}, expected {needle!r}")
            FAILED.append(label)
            return
        print(f"ok   {label}")
        return
    print(f"FAIL {label} — did not raise")
    FAILED.append(label)


# --- the synthetic source video --------------------------------------------
# Deliberately NOT square and deliberately bigger than a thumbnail: a downscale
# that preserved the aspect ratio, or one that only kicked in past 256px, would
# still have to change these numbers.
CANVAS_W, CANVAS_H = 260, 180
BOX = 40

# The owner's own case, at the REAL ceiling: a full-size portrait render. Ten
# 1080x1920 frames have no arrangement at all under 4096px (3x2 = 6 cells is the
# most that page holds), which is exactly the arithmetic the export used to
# refuse on. Not monkeypatched anywhere — this is the shipped ceiling.
BIG_W, BIG_H = 1080, 1920
BIG_N = 10

# The project's effective generation size, written into the sandboxed staging
# root as a real `atlas_config.json`. Deliberately NOT the 1024x1024 default:
# the `settings` block this export writes has to prove it RESOLVED the project's
# value, and a fixture asserting the default would pass just as well if the
# lookup were skipped entirely.
GEN_W, GEN_H = 1536, 768


def make_frames(n: int, w: int = CANVAS_W,
                h: int = CANVAS_H) -> list[Image.Image]:
    """`n` frames, each a solid box that MOVES on a transparent field — so a
    frame is identifiable by its pixels, an alpha-trim would change its size,
    and a stride picking the wrong frame is visible rather than plausible."""
    frames = []
    for i in range(n):
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        x, y = 10 + i * 5, 20 + i * 3
        im.paste((255, 40, 40, 255), (x, y, x + BOX, y + BOX))
        frames.append(im)
    return frames


def make_webp(frames: list[Image.Image], duration: int = 100) -> bytes:
    buf = io.BytesIO()
    frames[0].save(buf, format="WEBP", save_all=True, append_images=frames[1:],
                   duration=duration, lossless=True, loop=0)
    return buf.getvalue()


R2 = "clientx/projecty"


def stub_world(webp: bytes):
    """In-memory R2 + a temp staging root + a fake finished session.

    `input_dir` is `staging_root/input`, exactly as `cloud_paths.resolve()`
    builds it — the cold-container test below depends on that relationship
    holding, because `_hydrate_from_r2_by_name` writes under STAGING_ROOT while
    generation reads under INPUT_DIR, and they have to be the same file."""
    tmp = Path(tempfile.mkdtemp(prefix="iw-v2r-"))
    objects: dict[str, bytes] = {}
    (tmp / "manifests").mkdir(parents=True, exist_ok=True)
    (tmp / "input").mkdir(parents=True, exist_ok=True)
    # `batch_atlas._config_paths` looks here FIRST (the staging copy the UI
    # writes), so this is the project's effective config for the duration.
    (tmp / "atlas_config.json").write_text(
        json.dumps({"gen_width": GEN_W, "gen_height": GEN_H}), encoding="utf-8")

    storage.put = lambda k, b, c=None: objects.__setitem__(k, b)
    storage.get = lambda k: objects.get(k)
    video_to_refs.project_paths.resolve = lambda: {
        "r2_project_prefix": R2,
        "staging_root": tmp,
        "input_dir": tmp / "input",
        "manifest_dir": tmp / "manifests",
    }
    video_runner.read_variation = lambda sid, name: webp
    video_runner.get_session = lambda sid: {
        "id": sid,
        "variations": [{"index": 1, "status": "done", "file": "001.webp"},
                       {"index": 2, "status": "running", "file": ""}],
    }
    return tmp, objects


def webp_frames(webp: bytes) -> list[Image.Image]:
    """What the extractor is supposed to reproduce, decoded independently."""
    im = Image.open(io.BytesIO(webp))
    return [f.convert("RGBA") for f in ImageSequence.Iterator(im)]


def test_full_resolution_refs() -> None:
    n = 6
    src = make_frames(n)
    webp = make_webp(src)
    tmp, objects = stub_world(webp)

    res = video_to_refs.build_ref_set("sess1", 1, name="Coin Spin")

    # --- the response contract the launcher UI is built against ---
    check("the response carries exactly the contracted keys",
          sorted(res), ["atlas_name", "frames", "height", "manifest",
                        "regions", "width"])
    check("atlas_name is the shown slug", res["atlas_name"], "coin_spin")
    check("manifest is the manifest FILENAME",
          res["manifest"], "atlas_manifest_coin_spin.json")
    check("one region per exported frame", res["regions"], n)
    check("frames agrees with regions", res["frames"], n)
    check("width/height are the render's own size",
          (res["width"], res["height"]), (CANVAS_W, CANVAS_H))
    # `note` is a caveat about the SEEDED PAGE, and this one holds everything —
    # so it is absent. Pinned because a note on a clean export reads as a fault.
    check("no note when the seeded page holds every frame",
          res.get("note", ""), "")

    man = json.loads((tmp / "manifests" / res["manifest"]).read_text("utf-8"))

    # --- the manifest is an EMPTY grid atlas: the page is DECLARED, not built ---
    # 6 frames of 260x180: 2 columns x 3 rows is the smallest page by area, and
    # the near-squarest of the four tied at that area (260x1080, 520x540,
    # 780x360, 1560x180).
    check("the atlas block is a grid, sized to hold the frames at native size",
          man["atlas"], {"layout": "grid", "width": 520, "height": 540,
                         "cell_width": CANVAS_W, "cell_height": CANVAS_H})
    check("the cell IS the frame — no downscale is baked into the geometry",
          (man["atlas"]["cell_width"], man["atlas"]["cell_height"]),
          (res["width"], res["height"]))
    # A fresh export states its generation size rather than inheriting whatever
    # the project-wide default happens to be on the day it is generated.
    check("a settings block carries the resolved generation size",
          man["settings"], {"gen_width": GEN_W, "gen_height": GEN_H})
    check("the empty style block is there, as on a new atlas",
          man["style"], {"positive_prefix": "", "positive_suffix": "", "negative": ""})

    expect = [f"coin_spin_{i:04d}" for i in range(n)]
    check("regions are one per frame, in source order",
          [r["name"] for r in man["regions"]], expect)
    check("a region carries its name, a style_ref and a fit_mode",
          sorted({k for r in man["regions"] for k in r}),
          ["fit_mode", "name", "style_ref"])
    check("every region is placed `contain` by default — one uniform scale, "
          "one centre, no crop",
          {r["fit_mode"] for r in man["regions"]}, {"contain"})
    # The rects are grid_layout's on every Create Atlas. Freezing them here is
    # what would make an edited cell size do nothing — the reported bug.
    check("no region carries packer geometry",
          any(k in r for r in man["regions"]
              for k in ("x", "y", "w", "h", "rotated",
                        "offX", "offY", "origW", "origH")), False)
    # shape_ref would be grayscaled, thresholded and rebuilt on a 1024² canvas
    # by batch_atlas.normalize_shape_ref — it destroys a picture.
    check("no region carries a shape_ref",
          any("shape_ref" in r for r in man["regions"]), False)

    # --- the ref path form (the nested-vs-flat decision, pinned) ---
    ref0 = man["regions"][0]["style_ref"]
    check("the style_ref is INPUT_DIR-relative, nested per export",
          ref0, "refs/video/coin_spin/coin_spin_0000.png")
    check("the leaf name is UNIQUE, not a generic frame_0000.png",
          Path(ref0).name.startswith("coin_spin"), True)
    staged = tmp / "input" / ref0
    check("the ref really is on disk where that path points", staged.is_file(), True)
    # The real resolver, not a re-implementation of it: this is the form
    # `_upload_workflow_refs` / the serverless transport feed to LoadImage.
    check("batch_atlas' ref resolver accepts it and finds THIS file",
          batch_atlas._locate_ref_in_staging(ref0), staged)

    # --- the R2 mirror ---
    check("every ref is mirrored to R2 under input/",
          all(f"{R2}/input/{r['style_ref']}" in objects for r in man["regions"]), True)
    check("the manifest is mirrored to R2 under manifests/",
          f"{R2}/manifests/{res['manifest']}" in objects, True)
    check("the R2 manifest is the staged one, byte for byte",
          objects[f"{R2}/manifests/{res['manifest']}"],
          (tmp / "manifests" / res["manifest"]).read_bytes())

    # --- PIXELS: full resolution, untrimmed, un-downscaled ---
    decoded = webp_frames(webp)
    for i in (0, 3, 5):
        png = Image.open(io.BytesIO(
            objects[f"{R2}/input/refs/video/coin_spin/coin_spin_{i:04d}.png"]))
        check(f"frame {i} is RGBA at the render's own size",
              (png.mode, png.size), ("RGBA", (CANVAS_W, CANVAS_H)))
        check(f"frame {i} is the source frame PIXEL FOR PIXEL — no trim, no scale",
              png.convert("RGBA").tobytes(), decoded[i].tobytes())
        check(f"frame {i} is frame {i}, not a repeat of the first",
              png.convert("RGBA").getpixel((10 + i * 5 + 2, 20 + i * 3 + 2)),
              (255, 40, 40, 255))


def test_cold_container_hydrate() -> None:
    """The refs outlive this container. `atlas-tool` mirrors `input/` from R2
    once at startup, so a ref written after that pull is fetched BY KEY on
    demand — which only works if the key we wrote is the key the resolver asks
    for. Wrong key = every ref silently gone after a restart."""
    tmp, objects = stub_world(make_webp(make_frames(3)))
    res = video_to_refs.build_ref_set("sess1", 1, name="cold")
    man = json.loads((tmp / "manifests" / res["manifest"]).read_text("utf-8"))
    ref = man["regions"][0]["style_ref"]

    staged = tmp / "input" / ref
    want = staged.read_bytes()
    staged.unlink()
    check("with staging wiped, the resolver re-fetches it from R2 by key",
          batch_atlas._locate_ref_in_staging(ref), staged)
    check("...and it is the same image, back in the same place",
          staged.read_bytes(), want)


def test_range_and_stride() -> None:
    n = 10
    webp = make_webp(make_frames(n))
    tmp, objects = stub_world(webp)
    res = video_to_refs.build_ref_set("s", 1, name="trimmed",
                                      start=2, end=8, stride=2)
    man = json.loads((tmp / "manifests" / res["manifest"]).read_text("utf-8"))

    check("range + stride select the right frames",
          [r["name"] for r in man["regions"]],
          ["trimmed_0002", "trimmed_0004", "trimmed_0006"])
    check("the counts follow the selection, not the source", res["frames"], 3)
    check("only the selected frames were written",
          sorted(k for k in objects if "/input/" in k),
          [f"{R2}/input/refs/video/trimmed/trimmed_{i:04d}.png" for i in (2, 4, 6)])

    # Names are the SOURCE index — so prove the file under `_0004` really is
    # source frame 4, not the second frame of the selection.
    decoded = webp_frames(webp)
    got = Image.open(io.BytesIO(
        objects[f"{R2}/input/refs/video/trimmed/trimmed_0004.png"])).convert("RGBA")
    check("a strided region holds its SOURCE frame's pixels",
          got.tobytes(), decoded[4].tobytes())

    check_raises("an empty range is refused",
                 lambda: video_to_refs.build_ref_set("s", 1, name="none",
                                                     start=3, end=3),
                 "no frames")


def test_over_budget_raises() -> None:
    """Past the ceiling it RAISES — and writes nothing. A truncated export is
    indistinguishable from a complete one once it is a manifest."""
    tmp, objects = stub_world(make_webp(make_frames(6)))
    real = video_to_refs.MAX_REF_FRAMES
    try:
        video_to_refs.MAX_REF_FRAMES = 3
        check_raises("an over-budget frame count raises",
                     lambda: video_to_refs.build_ref_set("s", 1, name="toomany"),
                     "max 3")
        check("...before writing any ref", objects, {})
        check("...and before writing a manifest",
              list((tmp / "manifests").glob("*.json")), [])
        # The ceiling is on the SELECTION, so a stride brings the same range
        # back under it rather than making the export unreachable.
        res = video_to_refs.build_ref_set("s", 1, name="strided", stride=3)
        check("a stride brings the same range under the ceiling", res["frames"], 2)
    finally:
        video_to_refs.MAX_REF_FRAMES = real


def test_refusals() -> None:
    tmp, objects = stub_world(make_webp(make_frames(4)))
    check_raises("an unfinished variation is refused",
                 lambda: video_to_refs.build_ref_set("sess1", 2, name="busy"),
                 "not finished")
    check_raises("an unknown variation is refused",
                 lambda: video_to_refs.build_ref_set("sess1", 9, name="ghost"),
                 "no variation")
    check_raises("a name that slugs to nothing is refused",
                 lambda: video_to_refs.build_ref_set("sess1", 1, name="!!!"),
                 "letters or numbers")

    # An existing atlas holds prompts somebody wrote. Refuse, don't blank it.
    video_to_refs.build_ref_set("sess1", 1, name="dup")
    before = (tmp / "manifests" / "atlas_manifest_dup.json").read_bytes()
    check_raises("an existing atlas name is refused, not overwritten",
                 lambda: video_to_refs.build_ref_set("sess1", 1, name="DUP",
                                                     stride=2),
                 "already exists")
    check("...and the existing manifest is untouched",
          (tmp / "manifests" / "atlas_manifest_dup.json").read_bytes(), before)

    stub_world(b"not a webp at all")
    check_raises("an unreadable render is refused",
                 lambda: video_to_refs.build_ref_set("sess1", 1, name="junk"),
                 "could not read")

    # A header that promises more frames than the decoder delivers (a truncated
    # render) must not leave a SHORT manifest behind — one reads as a complete
    # export of a shorter animation, in the artifact whose whole job is to say
    # which frames there are. Injected, because a WEBP that lies about its own
    # frame count cannot be built honestly.
    tmp2, _ = stub_world(make_webp(make_frames(4)))
    real_seq = video_to_refs.ImageSequence
    try:
        video_to_refs.ImageSequence = SimpleNamespace(
            Iterator=lambda im: islice(real_seq.Iterator(im), 2))
        check_raises("a render that decodes short is refused, not exported short",
                     lambda: video_to_refs.build_ref_set("sess1", 1, name="short"),
                     "truncated")
    finally:
        video_to_refs.ImageSequence = real_seq
    check("...leaving no manifest behind",
          list((tmp2 / "manifests").glob("*.json")), [])


def test_the_seeded_page_is_the_smallest_that_fits() -> None:
    """The page seed is arithmetic, so it is checked as arithmetic. Smallest by
    AREA, tie-broken on the shorter long side then the fewer columns — so equal
    -area choices resolve to the near-square one (520x540, not 1560x180) while a
    strictly smaller strip still wins on area (100x500 beats 300x200).

    Every value above the ceiling block is pinned as it shipped: the fitting
    path is the one the author sees on nearly every export, nobody has
    complained about it, and it must not drift while the overflow path changes
    underneath it."""
    g = video_to_refs._grid_page
    check("one frame is one cell", g(1, 100, 100), (100, 100))
    check("four squares square up", g(4, 100, 100), (200, 200))
    check("five squares take the zero-waste strip — it is genuinely smaller",
          g(5, 100, 100), (100, 500))
    check("six 260x180 frames pick the squarest of the equal-area options",
          g(6, CANVAS_W, CANVAS_H), (520, 540))
    # 7 cells of 300x200 fit a 3x3 page (900x600) with two wasted — or a 1x7
    # strip (300x1400) with none. Area decides, and a zero-waste strip wins:
    # the seed is a starting point, and squaring it up is one Settings edit.
    check("minimum area beats squareness when the two disagree",
          g(7, 300, 200), (300, 1400))
    check("the page is always an exact multiple of the cell, never rounded up",
          [d % c for d, c in zip(g(7, 300, 200), (300, 200))], [0, 0])
    check("a big count still lands well inside the ceiling",
          g(120, 100, 100), (1000, 1200))

    # --- and when nothing fits it still ANSWERS. It used to raise here. ---
    real = video_to_refs.MAX_PAGE_SIDE
    try:
        # 400px ceiling, 260x180 cell: no arrangement holds 6, so the seed is
        # the most cells the ceiling allows (1x2) — not a refusal, and not a
        # page past the ceiling.
        video_to_refs.MAX_PAGE_SIDE = 400
        check("frames that cannot all fit get the LARGEST USABLE page",
              g(6, CANVAS_W, CANVAS_H), (260, 360))
        check("...still inside the ceiling on both sides",
              max(g(6, CANVAS_W, CANVAS_H)) <= 400, True)
        check("the fullest page, not the smallest — every cell the cap allows",
              g(100, 100, 100), (400, 400))
        video_to_refs.MAX_PAGE_SIDE = 200
        # A page THAT big is the author's to solve in 🧩 Atlas settings; it is
        # not a reason to withhold the images.
        check("a cell bigger than the whole ceiling seeds exactly ONE cell",
              g(6, CANVAS_W, CANVAS_H), (CANVAS_W, CANVAS_H))
    finally:
        video_to_refs.MAX_PAGE_SIDE = real
    # Never raises is the contract, so even nonsense gets an answer rather than
    # a ZeroDivisionError travelling up as a 500-shaped {"error"}.
    check("a degenerate zero-size cell answers instead of dividing by zero",
          g(3, 0, 0), (1, 3))


def refs_landed(tmp: Path, objects: dict, man: dict, n: int) -> bool:
    """Every region's ref really is in staging AND in R2 — the pair every other
    fixture here checks separately, asked as one question so the overflow tests
    can assert a COMPLETE export in a line."""
    refs = [r["style_ref"] for r in man.get("regions") or []]
    return (len(refs) == n
            and all((tmp / "input" / p).is_file() for p in refs)
            and all(f"{R2}/input/{p}" in objects for p in refs))


def test_a_page_the_frames_outgrow_still_exports() -> None:
    """MAX_PAGE_SIDE is a SEED ceiling, not a gate — and this is the fixture
    that stops it becoming one again.

    Nothing is packed or composed at export time, so a page that cannot hold
    every frame is a guess the author retypes in 🧩 Atlas settings, not a
    verdict. Refusing on it withheld the full-resolution reference images that
    are the whole point of the export. So: the seed becomes the largest usable
    page, every frame is still written, and the shortfall is SAID in `note`."""
    tmp, objects = stub_world(make_webp(make_frames(6)))
    real = video_to_refs.MAX_PAGE_SIDE
    try:
        # 400px ceiling, 260x180 cell: 1 column x 2 rows = 2 cells for 6 frames.
        video_to_refs.MAX_PAGE_SIDE = 400
        res = video_to_refs.build_ref_set("s", 1, name="huge")
        man = json.loads((tmp / "manifests" / res["manifest"]).read_text("utf-8"))

        check("frames the ceiling cannot hold are EXPORTED, not refused",
              res["frames"], 6)
        check("...every one of them, in frame order",
              [r["name"] for r in man["regions"]],
              [f"huge_{i:04d}" for i in range(6)])
        check("...each one in staging and in R2",
              refs_landed(tmp, objects, man, 6), True)
        check("...at the render's own size, untouched by the shortfall",
              Image.open(io.BytesIO(objects[
                  f"{R2}/input/{man['regions'][0]['style_ref']}"])).size,
              (CANVAS_W, CANVAS_H))
        check("...and the manifest is written, to staging and to R2",
              ((tmp / "manifests" / res["manifest"]).is_file(),
               f"{R2}/manifests/{res['manifest']}" in objects), (True, True))
        check("the seed is the largest usable page, not an oversized one",
              (man["atlas"]["width"], man["atlas"]["height"]), (260, 360))
        check("...inside the ceiling on both sides",
              max(man["atlas"]["width"], man["atlas"]["height"]) <= 400, True)
        check("...at the frame's own size as the cell, as ever",
              (man["atlas"]["cell_width"], man["atlas"]["cell_height"]),
              (CANVAS_W, CANVAS_H))

        note = res.get("note") or ""
        check("the response SAYS the page is short", bool(note), True)
        check("...naming how many were exported and how many the page holds",
              ("(6 of them)" in note, "1×2 = 2 cell(s) of 260×180" in note,
               "4 of them would not fit" in note), (True, True, True))
        check("...and the two fields that fix it, where they live, and when",
              ("Raise Atlas width/height" in note,
               "lower Default cell width/height" in note,
               "🧩 Atlas settings" in note, "Create Atlas" in note),
              (True, True, True, True))

        # A stride still brings the same range under the ceiling — and THAT
        # export gets no note, because its seed really does hold everything.
        res = video_to_refs.build_ref_set("s", 1, name="strided", stride=4)
        man = json.loads((tmp / "manifests" / res["manifest"]).read_text("utf-8"))
        check("a stride brings the same range under the ceiling",
              (res["frames"], man["atlas"]["width"], man["atlas"]["height"]),
              (2, 260, 360))
        check("...and an export whose page fits carries no note",
              res.get("note", ""), "")

        # Not even one cell fits: seed the one cell anyway. A page that big is
        # the author's to solve in Settings — it is not a reason to withhold six
        # images they can already use as references somewhere else.
        video_to_refs.MAX_PAGE_SIDE = 200
        res = video_to_refs.build_ref_set("s", 1, name="giant")
        man = json.loads((tmp / "manifests" / res["manifest"]).read_text("utf-8"))
        check("a frame bigger than the whole ceiling still exports",
              res["frames"], 6)
        check("...with every ref on disk and in R2",
              refs_landed(tmp, objects, man, 6), True)
        check("...seeded at exactly one cell",
              (man["atlas"]["width"], man["atlas"]["height"]),
              (CANVAS_W, CANVAS_H))
        note = res.get("note") or ""
        check("...and a note that names the ceiling it is past",
              ("a single cell is already past the 200px side" in note,
               "5 of them would not fit" in note), (True, True))
    finally:
        video_to_refs.MAX_PAGE_SIDE = real


def test_full_size_frames_export_at_the_real_ceiling() -> None:
    """THE OWNER'S CASE, at the ceiling that actually ships (4096, not a
    monkeypatched one): ten frames of a 1080x1920 render. No arrangement of them
    fits — 3x2 = 6 cells is the most that page holds — and the export used to
    abort right there, so full-size frames could not reach the Atlas Maker at
    all. They must arrive, and the response must say what the seed cannot do."""
    webp = make_webp(make_frames(BIG_N, BIG_W, BIG_H))
    tmp, objects = stub_world(webp)
    check("this is the shipped ceiling, not a patched one",
          video_to_refs.MAX_PAGE_SIDE, 4096)

    res = video_to_refs.build_ref_set("sess1", 1, name="Full Size")
    man = json.loads((tmp / "manifests" / res["manifest"]).read_text("utf-8"))

    check("the export SUCCEEDS", (res["atlas_name"], res["frames"]),
          ("full_size", BIG_N))
    check("...at the render's own full size", (res["width"], res["height"]),
          (BIG_W, BIG_H))
    check("...with every ref in staging and in R2",
          refs_landed(tmp, objects, man, BIG_N), True)
    check("...in frame order, one region each",
          [r["name"] for r in man["regions"]],
          [f"full_size_{i:04d}" for i in range(BIG_N)])
    decoded = webp_frames(webp)
    for i in (0, BIG_N - 1):
        png = Image.open(io.BytesIO(objects[
            f"{R2}/input/refs/video/full_size/full_size_{i:04d}.png"]))
        check(f"frame {i} is full resolution, RGBA, pixel for pixel",
              (png.mode, png.size, png.convert("RGBA").tobytes()),
              ("RGBA", (BIG_W, BIG_H), decoded[i].tobytes()))
    check("the seeded page is the largest usable one",
          man["atlas"], {"layout": "grid", "width": 3240, "height": 3840,
                         "cell_width": BIG_W, "cell_height": BIG_H})
    check("...and it does not exceed the ceiling on either side",
          max(man["atlas"]["width"], man["atlas"]["height"])
          <= video_to_refs.MAX_PAGE_SIDE, True)

    # The exact string the owner reads. Pinned whole: this is the only place the
    # arithmetic and the fix are stated, so a wording edit that quietly drops
    # either one has to be a deliberate edit to this line.
    check("the note is the whole story, in one breath", res.get("note"),
          "⚠ Every frame was exported (10 of them), but the 3240×3840 page "
          "seeded here holds 3×2 = 6 cell(s) of 1080×1920 — 4 of them would "
          "not fit. Raise Atlas width/height or lower Default cell "
          "width/height in 🧩 Atlas settings before you press Create Atlas; "
          "nothing is packed yet, so every reference image is already in the "
          "Atlas Maker either way.")
    print(f"     note → {res.get('note')}")

    # The note is not crying wolf, and the fix it names is the fix that works.
    import ui_server

    layout_note, changed = ui_server.grid_layout(man)
    check("Create Atlas really would refuse this page", changed, False)
    check("...on the same arithmetic the note named",
          "3×2 = 6 cell(s)" in (layout_note or ""), True)
    man["atlas"]["cell_width"], man["atlas"]["cell_height"] = 648, 768
    _note, changed = ui_server.grid_layout(man)
    check("and lowering the cell — the note's own advice — lays it out",
          (changed, [(r["x"], r["y"]) for r in man["regions"][:3]]),
          (True, [(0, 0), (648, 0), (1296, 0)]))


def test_fit_mode() -> None:
    """`fit` is the one placement field this export writes. `contain` is the
    default because it is the only one of the three that keeps a flipbook a
    flipbook — uniform scale, one centre, nothing cropped or stretched."""
    tmp, objects = stub_world(make_webp(make_frames(4)))

    res = video_to_refs.build_ref_set("s", 1, name="covered", fit="cover")
    man = json.loads((tmp / "manifests" / res["manifest"]).read_text("utf-8"))
    check("an explicit fit reaches every region",
          {r["fit_mode"] for r in man["regions"]}, {"cover"})

    res = video_to_refs.build_ref_set("s", 1, name="cased", fit="  FILL  ")
    man = json.loads((tmp / "manifests" / res["manifest"]).read_text("utf-8"))
    check("case and whitespace are normalized",
          {r["fit_mode"] for r in man["regions"]}, {"fill"})

    # Rejected, not coerced: a typo silently falling back to the default places
    # every frame the caller did NOT ask for, and placement is invisible until
    # the atlas is composed.
    before = sorted(objects)
    check_raises("an unknown fit is refused",
                 lambda: video_to_refs.build_ref_set("s", 1, name="bogus",
                                                     fit="containe"),
                 "unknown fit")
    check("...and nothing was written for it", sorted(objects), before)
    check("...and no manifest was left behind",
          (tmp / "manifests" / "atlas_manifest_bogus.json").exists(), False)


def test_the_export_and_the_layout_agree() -> None:
    """THE HANDOFF, end to end — the two halves of the reported bug in one test.

    The export seeds the page; `ui_server.grid_layout` is what Create Atlas runs
    over it. Everything must land: every frame placed, in FRAME ORDER, row-major,
    with nothing left over — and then the author retypes the cell size and the
    whole grid re-flows, which is the thing that used to do nothing at all."""
    import ui_server

    n = 6
    tmp, objects = stub_world(make_webp(make_frames(n)))
    res = video_to_refs.build_ref_set("s", 1, name="handoff")
    mp = tmp / "manifests" / res["manifest"]
    man = json.loads(mp.read_text("utf-8"))

    note, changed = ui_server.grid_layout(man)
    check("Create Atlas places every exported frame", changed, True)
    check("...row-major, in frame order, at the seeded cell",
          [(r["name"], r["x"], r["y"], r["w"], r["h"]) for r in man["regions"]],
          [("handoff_0000", 0, 0, 260, 180), ("handoff_0001", 260, 0, 260, 180),
           ("handoff_0002", 0, 180, 260, 180),
           ("handoff_0003", 260, 180, 260, 180),
           ("handoff_0004", 0, 360, 260, 180),
           ("handoff_0005", 260, 360, 260, 180)])
    check("the seeded page is exactly full — no cell wasted",
          "spare" in (note or ""), False)
    check("and the page the author sees is the page the export seeded",
          (man["atlas"]["width"], man["atlas"]["height"]), (520, 540))

    # ⚙ Settings: halve the cell, press Create Atlas again.
    man["atlas"]["cell_width"], man["atlas"]["cell_height"] = 130, 90
    _note, changed = ui_server.grid_layout(man)
    check("a re-run at a new cell size re-flows the whole grid", changed, True)
    check("...to the new cells, still in frame order",
          [(r["x"], r["y"], r["w"], r["h"]) for r in man["regions"]],
          [(0, 0, 130, 90), (130, 0, 130, 90), (260, 0, 130, 90),
           (390, 0, 130, 90), (0, 90, 130, 90), (130, 90, 130, 90)])
    check("the author's page is still the author's",
          (man["atlas"]["width"], man["atlas"]["height"]), (520, 540))
    check("the fit the export stamped survives every re-flow",
          {r["fit_mode"] for r in man["regions"]}, {"contain"})
    check("and so does the ref each region generates from",
          [r["style_ref"] for r in man["regions"]],
          [f"refs/video/handoff/handoff_{i:04d}.png" for i in range(n)])


def test_route() -> None:
    """The ROUTE, not just the module: a dispatch string that never matches is
    invisible until the UI calls it, and the failure shape is part of the
    contract — a refusal is `{"error": …}`, exactly as /video/toclip answers."""
    import ui_server

    class FakeHandler(ui_server.Handler):
        def __init__(self, path: str, body: dict) -> None:
            self.path = path
            self.headers = {"Content-Length": str(len(json.dumps(body)))}
            self.rfile = io.BytesIO(json.dumps(body).encode())
            self.sent: dict = {}
            self._set_cookie = None

        def _send(self, code, ctype, body, extra_headers=None):
            self.sent = {"code": code, "ctype": ctype, "body": body}

        def _gate(self):
            return (True, None)

        def _resolve_context(self):
            pass

        def _resolve_publish(self):
            pass

    tmp, objects = stub_world(make_webp(make_frames(5)))

    ok = FakeHandler("/video/torefs", {"session": "sess1", "variation": 1,
                                       "name": "Routed", "stride": 2})
    ok.do_POST()
    check("the route answers 200", ok.sent["code"], 200)
    check("as JSON", ok.sent["ctype"], "application/json")
    body = json.loads(ok.sent["body"])
    check("carrying the contract", sorted(body),
          ["atlas_name", "frames", "height", "manifest", "regions", "width"])
    check("with the export the module made", (body["atlas_name"], body["frames"]),
          ("routed", 3))

    busy = FakeHandler("/video/torefs", {"session": "sess1", "variation": 2,
                                         "name": "Nope"})
    busy.do_POST()
    check("a refusal is still a 200", busy.sent["code"], 200)
    check("...carrying {error: …}, the /video/toclip convention",
          "not finished" in json.loads(busy.sent["body"])["error"].lower(), True)

    # `fit` is the ONE field the request contract grew — optional, defaulting to
    # contain. The launcher panel is being built against exactly this.
    fitted = FakeHandler("/video/torefs", {"session": "sess1", "variation": 1,
                                           "name": "Fitted", "fit": "cover"})
    fitted.do_POST()
    man = json.loads(
        (tmp / "manifests" / "atlas_manifest_fitted.json").read_text("utf-8"))
    check("the route passes `fit` through to every region",
          {r["fit_mode"] for r in man["regions"]}, {"cover"})
    check("...and the response shape is unchanged by it",
          sorted(json.loads(fitted.sent["body"])),
          ["atlas_name", "frames", "height", "manifest", "regions", "width"])

    omitted = FakeHandler("/video/torefs", {"session": "sess1", "variation": 1,
                                            "name": "Omitted"})
    omitted.do_POST()
    man = json.loads(
        (tmp / "manifests" / "atlas_manifest_omitted.json").read_text("utf-8"))
    check("omitting `fit` defaults to contain",
          {r["fit_mode"] for r in man["regions"]}, {"contain"})

    bad = FakeHandler("/video/torefs", {"session": "sess1", "variation": 1,
                                        "name": "Bad", "fit": "stretch"})
    bad.do_POST()
    check("an unknown fit comes back as {error: …}, not a 500",
          "unknown fit" in json.loads(bad.sent["body"])["error"].lower(), True)

    # A seed too small for the frames is a NOTE ON A SUCCESS, not an error: the
    # launcher panel renders it beside the export it describes. The distinction
    # is the whole bug — it used to arrive as {"error"} with no export behind it.
    real = video_to_refs.MAX_PAGE_SIDE
    try:
        video_to_refs.MAX_PAGE_SIDE = 400
        noted = FakeHandler("/video/torefs", {"session": "sess1",
                                              "variation": 1, "name": "Noted"})
        noted.do_POST()
        body = json.loads(noted.sent["body"])
        check("a short seed answers 200 with no error",
              (noted.sent["code"], "error" in body), (200, False))
        check("...carrying the contract plus `note`", sorted(body),
              ["atlas_name", "frames", "height", "manifest", "note", "regions",
               "width"])
        check("...every frame still exported", body["frames"], 5)
        check("...and the note survives JSON with its arithmetic intact",
              (body["note"].startswith("⚠"), "(5 of them)" in body["note"],
               "3 of them would not fit" in body["note"]), (True, True, True))
    finally:
        video_to_refs.MAX_PAGE_SIDE = real


if __name__ == "__main__":
    test_full_resolution_refs()
    test_cold_container_hydrate()
    test_range_and_stride()
    test_over_budget_raises()
    test_the_seeded_page_is_the_smallest_that_fits()
    test_a_page_the_frames_outgrow_still_exports()
    test_full_size_frames_export_at_the_real_ceiling()
    test_fit_mode()
    test_refusals()
    test_the_export_and_the_layout_agree()
    test_route()
    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: {', '.join(FAILED)}")
        sys.exit(1)
    print("all video-to-refs fixtures pass")
