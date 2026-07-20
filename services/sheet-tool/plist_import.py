"""Import a cocos2d / TexturePacker `.plist` atlas VERBATIM.

Design: docs/design/invisible-flipbook.md ("Importing a pre-packed atlas").

A `.plist` describes an atlas that ALREADY EXISTS and that a shipped game may already
depend on. So this converts the coordinate file into the formats the rest of the pipeline
already reads (TexturePacker JSON + our AI manifest) and never re-packs the page: EVERY RECT
STAYS EXACTLY WHERE IT WAS, which is what "reuse it as is" has to mean.

The pixels are byte-identical too — with one measured exception. cocos2d rotates packed
frames the opposite way round from this pipeline, so each rotated region's block is flipped
180° in place on import (`reorient_rotated_regions`); without it every rotated frame renders
upside down. 180° preserves the bounding box, so no rect moves and no neighbour is touched.
A sheet with no rotated frames is written byte-for-byte, untouched.

Deliberately NOT routed through the Sheet Maker's editable region model. That model draws
an image of `iw/ih` CENTRED inside a `w/h` cell, so it cannot represent an off-centre trim
offset — and in a real animated sheet the per-frame trim offsets ARE the animation (a
symbol that scales 171px→111px→171px stays anchored only because each frame carries its
own offset). Round-tripping through the editor would silently drop them and the animation
would jitter. An editable import is a separate, lossy choice the author opts into.

## The two conversions that are easy to get wrong

1. **Rotation.** `textureRect` stores the sprite's UNROTATED `w,h` even when
   `textureRotated` is true; the footprint on the page is then `h x w`. This matches what
   `editorRegions.ts` already expects of TexturePacker JSON, so rotated frames need no
   special-casing downstream — but the page-bounds check here must use the swapped
   footprint or a rotated frame near an edge looks out of bounds.

2. **Trim offset origin.** cocos `spriteOffset` is measured from the CENTRE of the
   untrimmed sprite, y-up. TexturePacker JSON's `spriteSourceSize` is a TOP-LEFT origin,
   y-down. They are not the same number and the Y sign flips:

       left = (sourceW - trimmedW) / 2 + offsetX
       top  = (sourceH - trimmedH) / 2 - offsetY

   Get the sign wrong and the art drifts the wrong way as it scales — which reads as bad
   art rather than a bad importer.
"""

from __future__ import annotations

import plistlib
import re
from pathlib import Path

# `{1,2}` and `{{1,2},{3,4}}` — cocos packs geometry as strings, not nested plist types.
_NUMS = re.compile(r"-?\d+")


def _ints(value: str) -> list[int]:
    return [int(n) for n in _NUMS.findall(value or "")]


def _pair(value: str) -> tuple[int, int]:
    n = _ints(value)
    return (n[0], n[1]) if len(n) >= 2 else (0, 0)


def _rect(value: str) -> tuple[int, int, int, int]:
    """`{{x,y},{w,h}}` -> (x, y, w, h). `w,h` are the UNROTATED sprite size."""
    n = _ints(value)
    return (n[0], n[1], n[2], n[3]) if len(n) >= 4 else (0, 0, 0, 0)


class PlistImportError(ValueError):
    """The file is not a usable cocos2d sprite-sheet plist."""


def parse_plist(path: Path) -> dict:
    """Parse a cocos2d plist into a normalized, LOSSLESS frame list.

    Returns `{image, width, height, format, frames: [...]}` where each frame carries both
    the packed rect and the full trim geometry:

        {name, x, y, w, h,            # packed rect; w/h UNROTATED
         rotated,
         trim_x, trim_y,              # TOP-LEFT origin offset within the source canvas
         source_w, source_h}          # the untrimmed size

    Raises `PlistImportError` on anything that isn't a frames+metadata sprite sheet.
    """
    try:
        with path.open("rb") as fh:
            data = plistlib.load(fh)
    except Exception as e:  # noqa: BLE001 — any malformed file is one error to the caller
        raise PlistImportError(f"not a readable plist ({e})") from e

    if not isinstance(data, dict):
        raise PlistImportError("plist root is not a dictionary")
    frames = data.get("frames")
    meta = data.get("metadata") or data.get("meta") or {}
    if not isinstance(frames, dict) or not frames:
        raise PlistImportError("plist has no 'frames' dictionary")
    if not isinstance(meta, dict):
        raise PlistImportError("plist has no 'metadata' dictionary")

    fmt = int(meta.get("format", 0) or 0)
    if fmt != 3:
        # Formats 0-2 use different keys (frame/offset/sourceSize, and format 0 stores x/y/
        # width/height as separate entries). Refuse rather than silently misreading rects.
        raise PlistImportError(
            f"unsupported plist format {fmt} — only TexturePacker's cocos2d format 3 is "
            f"supported (re-export with 'cocos2d' / format 3)"
        )

    page_w, page_h = _pair(str(meta.get("size", "")))
    image = str(meta.get("textureFileName") or meta.get("realTextureFileName") or "")

    out: list[dict] = []
    for key in sorted(frames.keys()):
        fr = frames[key]
        if not isinstance(fr, dict):
            continue
        x, y, w, h = _rect(str(fr.get("textureRect", "")))
        rotated = bool(fr.get("textureRotated", False))
        src_w, src_h = _pair(str(fr.get("spriteSourceSize", "")))
        off_x, off_y = _pair(str(fr.get("spriteOffset", "")))
        sw, sh = _pair(str(fr.get("spriteSize", "")))
        # `spriteSize` is authoritative for the trimmed size when present; textureRect's
        # w/h should agree, but a hand-edited plist may not.
        trim_w, trim_h = (sw or w), (sh or h)
        # cocos centre-origin (y-up) -> TexturePacker top-left origin (y-down).
        left = (src_w - trim_w) // 2 + off_x
        top = (src_h - trim_h) // 2 - off_y
        out.append(
            {
                "name": Path(str(key)).stem,
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "rotated": rotated,
                "trim_x": left,
                "trim_y": top,
                "source_w": src_w or trim_w,
                "source_h": src_h or trim_h,
            }
        )

    return {
        "image": image,
        "width": page_w,
        "height": page_h,
        "format": fmt,
        "frames": out,
    }


def to_texturepacker(parsed: dict) -> dict:
    """Emit a TexturePacker JSON-hash doc — the format `editorRegions.ts` already reads.

    Trim is preserved as `spriteSourceSize` + `sourceSize` + `trimmed`, so a consumer that
    honours trim (a flipbook whose frames scale) renders correctly, while one that ignores
    it degrades to today's behaviour rather than breaking.
    """
    frames: dict[str, dict] = {}
    for f in parsed["frames"]:
        trimmed = (
            f["w"] != f["source_w"] or f["h"] != f["source_h"] or f["trim_x"] or f["trim_y"]
        )
        frames[f"{f['name']}.png"] = {
            "frame": {"x": f["x"], "y": f["y"], "w": f["w"], "h": f["h"]},
            "rotated": f["rotated"],
            "trimmed": bool(trimmed),
            "spriteSourceSize": {
                "x": f["trim_x"],
                "y": f["trim_y"],
                "w": f["w"],
                "h": f["h"],
            },
            "sourceSize": {"w": f["source_w"], "h": f["source_h"]},
        }
    return {
        "frames": frames,
        "meta": {
            "app": "Invisible Sheet Maker (plist import)",
            "image": parsed["image"],
            "format": "RGBA8888",
            "size": {"w": parsed["width"], "h": parsed["height"]},
            "scale": "1",
        },
    }


def reorient_rotated_regions(page, frames: list[dict]):
    """Rotate every ROTATED region's on-page block 180° so cocos2d's packing matches ours.

    cocos2d and this pipeline rotate packed frames in OPPOSITE directions. A cocos frame is
    restored by rotating 90° CCW; every renderer here restores with 90° CW (`RegionThumb`, and
    the slicer's `PIL rotate(-90)`), so an imported rotated frame renders exactly 180° out.

    Measured on the real 49-frame sheet, both ways round:
      - slicing frame `_42` (rotated) against `_43` (not, same size, adjacent in the animation):
        mean abs pixel diff 72.5 restoring CW vs 6.2 restoring CCW;
      - vertical alpha centroid over all 49 frames — 33 unrotated frames average 0.411, rotated
        frames restore to 0.453 CCW but 0.544 CW, and 0.544 + 0.453 ≈ 1.0, the signature of a
        180° flip.

    Same fix, and same reasoning, as `reorientRotatedRegionsForSpine` in the launcher: 180°
    preserves the bounding box exactly, so this is an in-place pixel reversal that never
    disturbs a neighbouring region or any rect. Every coordinate the plist declares stays
    valid — which is what "reuse it as is" actually has to mean.

    Returns `(image, rotated_count)`. With nothing rotated the image is returned untouched so
    the caller can still write the original bytes byte-for-byte.
    """
    rotated = [f for f in frames if f.get("rotated")]
    if not rotated:
        return page, 0
    for f in rotated:
        # On-page footprint of a rotated frame is (h x w) — the swap `validate` proves correct.
        box = (f["x"], f["y"], f["x"] + f["h"], f["y"] + f["w"])
        page.paste(page.crop(box).rotate(180), box)
    return page, len(rotated)


def validate(parsed: dict) -> list[str]:
    """Sanity-check a parsed plist against its own page. Returns human-readable problems.

    Both checks exist to catch a MISREAD rect early, when the message can still say so —
    rather than shipping an atlas that renders as sliced-up garbage and reads as bad art.

    Overlap is the sharp one: a packer never emits overlapping rects, so any overlap means
    the geometry was decoded wrong. It is also what empirically confirms the rotation
    convention on a real file — reading a rotated frame's footprint as `w x h` instead of
    `h x w` produced 18 collisions on a 49-frame sheet that has 0 under the correct
    reading.
    """
    problems: list[str] = []
    page_w, page_h = parsed["width"], parsed["height"]
    rects: list[tuple[str, int, int, int, int]] = []
    for f in parsed["frames"]:
        fw, fh = (f["h"], f["w"]) if f["rotated"] else (f["w"], f["h"])
        if page_w and page_h and (f["x"] + fw > page_w or f["y"] + fh > page_h):
            problems.append(
                f"frame '{f['name']}' extends past the {page_w}x{page_h} page "
                f"(to {f['x'] + fw},{f['y'] + fh})"
            )
        rects.append((f["name"], f["x"], f["y"], fw, fh))

    overlaps = 0
    first: list[str] = []
    for i in range(len(rects)):
        an, ax, ay, aw, ah = rects[i]
        for j in range(i + 1, len(rects)):
            bn, bx, by, bw, bh = rects[j]
            if ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah:
                overlaps += 1
                if len(first) < 3:
                    first.append(f"{an} <-> {bn}")
    if overlaps:
        problems.append(
            f"{overlaps} overlapping frame pair(s) — a packed atlas should have none, so "
            f"the rects are probably being misread (e.g. {', '.join(first)})"
        )
    return problems


_SEQ = re.compile(r"^(?P<stem>.*?)[_-]?(?P<num>\d+)$")


def detect_sequences(names: list[str], min_len: int = 3) -> list[dict]:
    """Group frame names into CONSECUTIVELY-numbered runs — candidate flipbook clips.

    `anim-sym-pic1_00 … _48` is 49 frames of one animation; making the author click 49
    thumbnails to rebuild what the filenames already state is the wrong default.

    Ordering is numeric, not lexicographic, so `f2` precedes `f10` (the same bug fixed in
    `natural_key`). A run must be CONSECUTIVE — a gap splits it, because a gap usually
    means two animations packed on one sheet, not one animation with a hole.
    """
    groups: dict[str, list[tuple[int, str]]] = {}
    for name in names:
        m = _SEQ.match(name)
        if not m:
            continue
        groups.setdefault(m.group("stem"), []).append((int(m.group("num")), name))

    out: list[dict] = []
    for stem, items in groups.items():
        items.sort(key=lambda t: t[0])
        run: list[tuple[int, str]] = []
        for item in items:
            if run and item[0] != run[-1][0] + 1:
                if len(run) >= min_len:
                    out.append({"stem": stem, "frames": [n for _, n in run]})
                run = []
            run.append(item)
        if len(run) >= min_len:
            out.append({"stem": stem, "frames": [n for _, n in run]})
    out.sort(key=lambda g: (-len(g["frames"]), g["stem"]))
    return out
