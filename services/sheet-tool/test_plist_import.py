"""Offline checks for the cocos2d `.plist` importer.

    py test_plist_import.py [path/to/real.plist]

No framework — the sheet tool has no test infra, and this is exactly the kind of pure
coordinate contract that must be verified offline rather than by staring at a rendered
atlas ([[feedback_validate_data_contracts_offline]]).

The synthetic fixture is self-contained so this runs anywhere. Pass a real plist as an
argument to additionally sanity-check that file (page bounds + zero overlaps).
"""

from __future__ import annotations

import plistlib
import sys
import tempfile
from pathlib import Path

from plist_import import (
    PlistImportError,
    detect_sequences,
    parse_plist,
    to_texturepacker,
    validate,
)

FAILS = 0


def check(cond: bool, msg: str) -> None:
    global FAILS
    if cond:
        print(f"  OK {msg}")
    else:
        FAILS += 1
        print(f"  X  {msg}")


def write_plist(frames: dict, meta: dict) -> Path:
    path = Path(tempfile.mkdtemp()) / "fixture.plist"
    with path.open("wb") as fh:
        plistlib.dump({"frames": frames, "metadata": meta}, fh)
    return path


META = {
    "format": 3,
    "pixelFormat": "RGBA8888",
    "premultiplyAlpha": False,
    "realTextureFileName": "sheet.png",
    "size": "{512,512}",
    "textureFileName": "sheet.png",
}


def frame(rect: str, size: str, offset: str, source: str, rotated: bool) -> dict:
    return {
        "aliases": [],
        "spriteOffset": offset,
        "spriteSize": size,
        "spriteSourceSize": source,
        "textureRect": rect,
        "textureRotated": rotated,
    }


print("plist import — trim offset conversion (centre y-up -> top-left y-down)")
p = write_plist(
    {
        # Untrimmed, dead centre: offsets must be the plain centring inset.
        "a_00.png": frame("{{0,0},{100,100}}", "{100,100}", "{0,0}", "{200,200}", False),
        # Positive x, positive y: y-up means +y moves the art UP, so `top` DECREASES.
        "a_01.png": frame("{{0,0},{100,100}}", "{100,100}", "{10,20}", "{200,200}", False),
        # Negative y must push `top` DOWN — the sign flip that is easy to get backwards.
        "a_02.png": frame("{{0,0},{100,100}}", "{100,100}", "{0,-20}", "{200,200}", False),
    },
    META,
)
by = {f["name"]: f for f in parse_plist(p)["frames"]}
check(by["a_00"]["trim_x"] == 50 and by["a_00"]["trim_y"] == 50, "centred frame -> (50,50)")
check(by["a_01"]["trim_x"] == 60, "+x offset moves trim_x right (50+10=60)")
check(by["a_01"]["trim_y"] == 30, "+y offset (y-UP) moves trim_y UP (50-20=30)")
check(by["a_02"]["trim_y"] == 70, "-y offset moves trim_y DOWN (50+20=70)")

print("plist import — rotation footprint")
p = write_plist(
    {
        # Two rotated frames packed side by side. Under the CORRECT reading each occupies
        # h x w = 60x30, so they do not touch. Misread as w x h = 30x60 they overlap.
        "r_00.png": frame("{{0,0},{30,60}}", "{30,60}", "{0,0}", "{30,60}", True),
        "r_01.png": frame("{{60,0},{30,60}}", "{30,60}", "{0,0}", "{30,60}", True),
        "r_02.png": frame("{{0,30},{30,60}}", "{30,60}", "{0,0}", "{30,60}", True),
    },
    META,
)
parsed = parse_plist(p)
check(
    all(f["w"] == 30 and f["h"] == 60 for f in parsed["frames"]),
    "a rotated frame keeps its UNROTATED w/h",
)
# r_00 occupies x 0..60, y 0..30; r_02 starts at y=30 -> touching, not overlapping.
check(len(validate(parsed)) == 0, "correctly-read rotated frames do not overlap")

print("plist import — validation catches a misread page")
bad = parse_plist(
    write_plist({"o_00.png": frame("{{500,500},{100,100}}", "{100,100}", "{0,0}", "{100,100}", False)}, META)
)
check(any("past the" in m for m in validate(bad)), "an out-of-bounds frame is reported")

print("plist import — TexturePacker emission")
tp = to_texturepacker(parse_plist(write_plist(
    {"t_00.png": frame("{{4,8},{100,150}}", "{100,150}", "{5,-5}", "{200,200}", True)}, META,
)))
fr = tp["frames"]["t_00.png"]
check(fr["frame"] == {"x": 4, "y": 8, "w": 100, "h": 150}, "frame rect round-trips")
check(fr["rotated"] is True, "rotation flag round-trips")
check(fr["trimmed"] is True, "a trimmed frame is marked trimmed")
check(fr["sourceSize"] == {"w": 200, "h": 200}, "sourceSize is the UNTRIMMED size")
check(fr["spriteSourceSize"]["x"] == 55 and fr["spriteSourceSize"]["y"] == 30, "trim -> top-left origin")
check(tp["meta"]["size"] == {"w": 512, "h": 512}, "page size carried into meta")

print("plist import — refuses what it cannot read")
for bad_meta, label in [({**META, "format": 2}, "format 2"), ({**META, "format": 0}, "format 0")]:
    try:
        parse_plist(write_plist({"x_00.png": frame("{{0,0},{1,1}}", "{1,1}", "{0,0}", "{1,1}", False)}, bad_meta))
        check(False, f"{label} is refused")
    except PlistImportError:
        check(True, f"{label} is refused with a clear error")

print("plist import — sequence detection")
seqs = detect_sequences([f"a_{i:02d}" for i in range(49)])
check(len(seqs) == 1 and len(seqs[0]["frames"]) == 49, "49 consecutive frames -> one clip")
check(seqs[0]["frames"][:3] == ["a_00", "a_01", "a_02"], "the run is in numeric order")
# Numeric, not lexicographic: f2 before f10.
unpadded = detect_sequences([f"b_{i}" for i in range(1, 12)])
check(unpadded[0]["frames"][1] == "b_2", "unpadded numbering sorts numerically, not lexically")
# A gap splits the run — usually two animations on one sheet, not one with a hole.
split = detect_sequences(["c_0", "c_1", "c_2", "c_7", "c_8", "c_9"])
check(len(split) == 2, "a numbering gap splits the run into two clips")
# Runs shorter than min_len are not clips.
check(detect_sequences(["d_0", "d_1"]) == [], "a 2-frame run is not treated as a clip")
# Non-sequence names are ignored, not crashed on.
check(detect_sequences(["logo", "bg", "e_0", "e_1", "e_2"])[0]["stem"] == "e", "unnumbered names are ignored")

if len(sys.argv) > 1:
    real = Path(sys.argv[1])
    print(f"plist import — real file: {real.name}")
    rp = parse_plist(real)
    problems = validate(rp)
    check(not problems, f"{len(rp['frames'])} frames, page {rp['width']}x{rp['height']}, no problems")
    for m in problems[:5]:
        print(f"     {m}")
    for s in detect_sequences([f["name"] for f in rp["frames"]]):
        print(f"     sequence {s['stem']!r}: {len(s['frames'])} frames")

print()
print("PLIST IMPORT: " + ("PASSED" if FAILS == 0 else f"{FAILS} FAILURE(S)"))
sys.exit(1 if FAILS else 0)
