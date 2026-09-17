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
  * packer geometry on a region, or `atlas.width/height` → the manifest claims
    a page that does not exist and Create Atlas is no longer the thing that
    builds it;
  * an over-budget range TRUNCATED instead of refused → a manifest that is
    complete-looking and short, in the one artifact whose job is to say which
    frames there are.
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


def make_frames(n: int) -> list[Image.Image]:
    """`n` frames, each a solid box that MOVES on a transparent field — so a
    frame is identifiable by its pixels, an alpha-trim would change its size,
    and a stride picking the wrong frame is visible rather than plausible."""
    frames = []
    for i in range(n):
        im = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
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

    man = json.loads((tmp / "manifests" / res["manifest"]).read_text("utf-8"))

    # --- the manifest is an EMPTY pack atlas: nothing was packed ---
    check("the atlas block declares pack layout and NOTHING else",
          man["atlas"], {"layout": "pack"})
    check("no page size is claimed — there is no page",
          any(k in man["atlas"] for k in ("width", "height")), False)
    check("the empty style block is there, as on a new atlas",
          man["style"], {"positive_prefix": "", "positive_suffix": "", "negative": ""})

    expect = [f"coin_spin_{i:04d}" for i in range(n)]
    check("regions are one per frame, in source order",
          [r["name"] for r in man["regions"]], expect)
    check("a region carries ONLY its name and a style_ref",
          sorted({k for r in man["regions"] for k in r}), ["name", "style_ref"])
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


if __name__ == "__main__":
    test_full_resolution_refs()
    test_cold_container_hydrate()
    test_range_and_stride()
    test_over_budget_raises()
    test_refusals()
    test_route()
    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: {', '.join(FAILED)}")
        sys.exit(1)
    print("all video-to-refs fixtures pass")
