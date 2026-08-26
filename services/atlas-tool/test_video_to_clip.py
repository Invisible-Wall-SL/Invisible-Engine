"""Offline fixtures for video → packed sheet → clip frames (no R2, no GPU).

Run:  py test_video_to_clip.py   (from services/atlas-tool, PYTHONPATH=../_shared:.)

Builds a REAL animated WEBP in memory with Pillow and runs the real packer over
it, so these prove pixel and geometry behaviour rather than mocking it away.

Each assertion stands for a specific way this silently goes wrong:

  * trim recorded in snake_case (or not at all) → the launcher drops it → every
    frame's tight rect scales to fill its box → the animation PULSES;
  * `Image.getbbox()` instead of the alpha channel → an opaque frame gets its
    black borders cropped, so opaque art shrinks and drifts;
  * clip frames emitted in the PACKER's order (area-descending) instead of
    source order → the animation plays scrambled;
  * bare frame names → they resolve against the flat cache where every sheet's
    frames collide, and a symbol plays another symbol's animation.
"""
from __future__ import annotations

import io
import json
import sys
import tempfile
from pathlib import Path

from PIL import Image

import video_runner
import video_to_clip

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)


def check_near(label: str, got: float, want: float, tol: float = 0.05) -> None:
    ok = abs(float(got) - float(want)) <= tol
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got {got!r}, want ~{want!r}")
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
CANVAS = 200
BOX = 40


def make_frames(n: int, *, opaque: bool = False, blank_at: int = -1) -> list[Image.Image]:
    """`n` frames, each a solid box that MOVES — so every frame trims to a
    different offset and a mis-recorded trim shows up as a wrong number."""
    frames = []
    for i in range(n):
        if opaque:
            im = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 255))
        else:
            im = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
        if i != blank_at:
            x = 10 + i * 5
            y = 20 + i * 3
            im.paste((255, 40, 40, 255), (x, y, x + BOX, y + BOX))
        frames.append(im)
    return frames


def make_webp(frames: list[Image.Image], duration: int = 100) -> bytes:
    buf = io.BytesIO()
    frames[0].save(buf, format="WEBP", save_all=True, append_images=frames[1:],
                   duration=duration, lossless=True, loop=0)
    return buf.getvalue()


def stub_world(webp: bytes, frame_count: int):
    """In-memory R2 + a temp staging root + a fake finished session."""
    tmp = Path(tempfile.mkdtemp(prefix="iw-v2c-"))
    objects: dict[str, bytes] = {}
    (tmp / "manifests").mkdir(parents=True, exist_ok=True)

    video_to_clip.storage.put = lambda k, b, c=None: objects.__setitem__(k, b)
    video_to_clip.project_paths.resolve = lambda: {
        "r2_project_prefix": "clientx/projecty",
        "staging_root": tmp,
        "manifest_dir": tmp / "manifests",
    }
    video_runner.read_variation = lambda sid, name: webp
    video_runner.get_session = lambda sid: {
        "id": sid,
        "variations": [{"index": 1, "status": "done", "file": "001.webp"},
                       {"index": 2, "status": "running", "file": ""}],
    }
    return tmp, objects


def test_probe() -> None:
    stub_world(make_webp(make_frames(8), duration=100), 8)
    info = video_to_clip.probe_variation("s1", 1)
    check("probe counts frames", info["frames"], 8)
    check("probe reads canvas size", (info["width"], info["height"]), (CANVAS, CANVAS))
    check_near("probe derives fps from the webp duration", info["fps"], 10.0)
    check("probe detects alpha", info["has_alpha"], True)
    # Pillow exposes a WEBP frame's duration only after seek()+load(); reading it
    # off ImageSequence.Iterator yields None and the fps silently falls back to
    # the default. A wrong-but-plausible fps is exactly the kind of bug that
    # ships, so assert the REAL rate rather than merely "some number".
    check("fps is read, not defaulted", info["fps"] != video_to_clip.DEFAULT_FPS, True)
    check("frame duration survives the round-trip", info["duration_ms"], 100)

    stub_world(make_webp(make_frames(3, opaque=True)), 3)
    check("probe reports an OPAQUE video as having no alpha",
          video_to_clip.probe_variation("s1", 1)["has_alpha"], False)

    check_raises("an unfinished variation is refused",
                 lambda: video_to_clip.probe_variation("s1", 2), "not finished")
    check_raises("an unknown variation is refused",
                 lambda: video_to_clip.probe_variation("s1", 9), "no variation")


def test_build_and_trim() -> None:
    n = 6
    tmp, objects = stub_world(make_webp(make_frames(n)), n)
    res = video_to_clip.build_clip_sheet("sess1", 1, name="Coin Spin")

    check("frame count matches the source", res["used_frames"], n)
    check("clip fps follows the source", round(res["fps"]), 10)
    check("alpha reported through to the clip", res["has_alpha"], True)
    check("sheet name is slugged", res["name"], "Coin_Spin")

    # ORDER: the packer sorts by area, the clip must not.
    expect = [f"Coin_Spin_{i:04d}" for i in range(n)]
    check("frames are in SOURCE order",
          [f.split("::", 1)[1] for f in res["frames"]], expect)
    check("every frame ref is atlas-scoped",
          all("::" in f for f in res["frames"]), True)
    check("assetKey is a manifest key",
          res["assetKey"].startswith("clientx/projecty/manifests/atlas_manifest_"), True)

    # The manifest the launcher will parse.
    man = json.loads(objects[res["assetKey"]].decode())
    check("manifest page is a resolvable R2 key",
          man["atlas"]["source_image_path"], "clientx/projecty/sheets/Coin_Spin/Coin_Spin.png")
    check("the page object exists at that key",
          man["atlas"]["source_image_path"] in objects, True)
    check("manifest declares the page size",
          (man["atlas"]["width"] > 0, man["atlas"]["height"] > 0), (True, True))

    by_name = {r["name"]: r for r in man["regions"]}
    check("every frame has a region", sorted(by_name) == sorted(expect), True)

    # TRIM — the whole ballgame. Frame i's box sits at (10+5i, 20+3i), BOX wide.
    for i in (0, 3, 5):
        r = by_name[f"Coin_Spin_{i:04d}"]
        check(f"frame {i} trims to the ink box", (r["w"], r["h"]), (BOX, BOX))
        check(f"frame {i} records its offset in CAMEL case",
              (r["offX"], r["offY"]), (10 + i * 5, 20 + i * 3))
        check(f"frame {i} records the untrimmed canvas",
              (r["origW"], r["origH"]), (CANVAS, CANVAS))
    check("no snake_case trim leaks into the manifest",
          any(k in by_name["Coin_Spin_0000"] for k in ("off_x", "orig_w")), False)
    check("regions are marked contain, not stretched",
          by_name["Coin_Spin_0000"]["fit_mode"], "contain")

    # PIXELS: the composed page really carries each frame at its packed rect.
    page = Image.open(io.BytesIO(objects[man["atlas"]["source_image_path"]])).convert("RGBA")
    r0 = by_name["Coin_Spin_0000"]
    check("the packed rect holds the frame's pixels",
          page.getpixel((r0["x"] + 2, r0["y"] + 2)), (255, 40, 40, 255))
    check("the gutter between frames stays transparent",
          page.getpixel((r0["x"] + r0["w"] + 1, r0["y"]))[3], 0)

    # The sibling TexturePacker JSON is the inverse the editor reads.
    tp_key = man["atlas"]["texturepacker_json"]
    tp = json.loads(objects[tp_key].decode())
    check("TP json names the sibling page", tp["meta"]["image"], "Coin_Spin.png")
    check("TP json carries the trim as spriteSourceSize",
          (tp["frames"]["Coin_Spin_0000.png"]["spriteSourceSize"]["x"],
           tp["frames"]["Coin_Spin_0000.png"]["spriteSourceSize"]["y"]), (10, 20))
    check("TP json carries the untrimmed sourceSize",
          tp["frames"]["Coin_Spin_0000.png"]["sourceSize"], {"w": CANVAS, "h": CANVAS})


def test_opaque_keeps_full_canvas() -> None:
    tmp, objects = stub_world(make_webp(make_frames(3, opaque=True)), 3)
    res = video_to_clip.build_clip_sheet("s", 1, name="opaque")
    man = json.loads(objects[res["assetKey"]].decode())
    r = man["regions"][0]
    check("an OPAQUE frame is not cropped by colour", (r["w"], r["h"]), (CANVAS, CANVAS))
    check("an opaque frame records a zero offset", (r["offX"], r["offY"]), (0, 0))


def test_blank_frame_placeholder() -> None:
    tmp, objects = stub_world(make_webp(make_frames(4, blank_at=2)), 4)
    res = video_to_clip.build_clip_sheet("s", 1, name="gap")
    check("a fully transparent frame still occupies a slot", res["used_frames"], 4)
    man = json.loads(objects[res["assetKey"]].decode())
    blank = next(r for r in man["regions"] if r["name"].endswith("0002"))
    check("the blank frame packs as a 1x1 placeholder", (blank["w"], blank["h"]), (1, 1))
    check("the blank frame keeps the real canvas size",
          (blank["origW"], blank["origH"]), (CANVAS, CANVAS))


def test_range_stride_and_resize() -> None:
    n = 10
    tmp, objects = stub_world(make_webp(make_frames(n)), n)
    res = video_to_clip.build_clip_sheet("s", 1, name="trimmed", start=2, end=8, stride=2)
    check("range + stride select the right frames",
          [f.split("::", 1)[1] for f in res["frames"]],
          ["trimmed_0002", "trimmed_0004", "trimmed_0006"])
    check("region names keep the SOURCE index under a stride",
          res["frames"][1].endswith("_0004"), True)
    check_near("a stride divides the clip fps", res["fps"], 5.0)

    tmp, objects = stub_world(make_webp(make_frames(4)), 4)
    res = video_to_clip.build_clip_sheet("s", 1, name="small", max_size=100)
    man = json.loads(objects[res["assetKey"]].decode())
    r = man["regions"][0]
    check("max_size downscales the canvas", (r["origW"], r["origH"]), (100, 100))
    check("the trimmed rect scales with it", r["w"] <= BOX, True)

    check_raises("an empty range is refused",
                 lambda: video_to_clip.build_clip_sheet("s", 1, start=3, end=3),
                 "no frames")


def test_multipage_split() -> None:
    """Frames that cannot share a 2048 page spill onto more pages, and the clip
    still plays in order across them."""
    # Each frame must DIFFER: the WEBP encoder collapses byte-identical
    # consecutive frames into one, so a dozen identical squares would arrive as
    # `n_frames == 1` and quietly prove nothing.
    big = []
    for i in range(12):
        im = Image.new("RGBA", (700, 700), (10, 200, 90, 255))  # full-bleed: nothing to trim
        im.paste((i * 20, 10, 250 - i * 15, 255), (0, 0, 40, 40))
        big.append(im)
    tmp, objects = stub_world(make_webp(big), 12)
    res = video_to_clip.build_clip_sheet("s", 1, name="wide")

    check("it split across pages", len(res["pages"]) > 1, True)
    check("every page fits the cap",
          all(p["width"] <= 2048 and p["height"] <= 2048 for p in res["pages"]), True)
    check("all frames survived the split", res["used_frames"], 12)
    check("frames stay in source order across pages",
          [f.split("::", 1)[1] for f in res["frames"]],
          [f"wide_{i:04d}" for i in range(12)])

    sheets = {f.split("::", 1)[0] for f in res["frames"]}
    check("frames really are spread over several manifests", len(sheets) > 1, True)
    check("every referenced manifest was written",
          all(k in objects for k in sheets), True)
    check("assetKey is one of them", res["assetKey"] in sheets, True)


if __name__ == "__main__":
    test_probe()
    test_build_and_trim()
    test_opaque_keeps_full_canvas()
    test_blank_frame_placeholder()
    test_range_stride_and_resize()
    test_multipage_split()
    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: {', '.join(FAILED)}")
        sys.exit(1)
    print("all video-to-clip fixtures pass")
