"""The one TexturePacker JSON-hash writer — the Atlas Maker's and the Sheet Maker's.

Region dicts use the normalized shape both packers produce:
    {name, x, y, w, h, rotated, off_x, off_y, orig_w, orig_h}
where `w/h` is the UPRIGHT (display) size even for a rotated region, whose
footprint on the page is then `h x w`.

A rotated frame's `frame.w/h` is that UPRIGHT size, never swapped — TexturePacker's
own convention, and what every reader expects: PixiJS's `Spritesheet` (the game
runtime, which swaps a rotated frame's w/h itself to find the page rect), the
vendored game sheets (`apps/lines/static/assets/sprites/symbolsStatic/symbolsStatic.json`:
the rotated `explodedW.png` has frame.w/h == spriteSourceSize.w/h) and the
launcher's readers (`editorRegions.ts::texturePackerToInvisible`,
`apps/launcher-api/scripts/lib/tpRegions.mjs`).

Sheet Maker exports before 2026-11-10 swapped a rotated frame's `frame.w/h` to the
on-page footprint. Those files are still in R2; the launcher recognises one (its
`frame` is exactly its `spriteSourceSize` transposed) and reads it upright, so
nothing here writes that form again. `services/_shared/fixtures/texturepacker-rotated.json`
is this writer's output, pinned by `test_iw_texturepacker.py`; the launcher's
`check-texturepacker-rotation.ts` reads it through the real reader and PixiJS.
"""
from __future__ import annotations

import json
from pathlib import Path


def texturepacker_doc(image_name: str, width: int, height: int, regions: list[dict], *,
                      app: str) -> dict:
    """The JSON-hash document. `image_name` MUST be the actual page filename
    (`meta.image` resolves the sibling page).

    Frame keys are labels the engine looks up, independent of the page image
    format: a name that already carries an extension is kept verbatim
    (`explodedW.png`, `s.png`); a bare one falls back to `.png` — the engine's
    symbolsStatic frames are labelled `.png` (the source-sprite filenames) even
    though the packed page is `.webp`."""
    frames: dict[str, dict] = {}
    for r in regions:
        dw, dh = int(r["w"]), int(r["h"])
        key = r["name"] if "." in r["name"] else f"{r['name']}.png"
        frames[key] = {
            "frame": {"x": int(r["x"]), "y": int(r["y"]), "w": dw, "h": dh},
            "rotated": bool(r.get("rotated")),
            "trimmed": False,
            "spriteSourceSize": {"x": int(r.get("off_x", 0)), "y": int(r.get("off_y", 0)),
                                 "w": dw, "h": dh},
            "sourceSize": {"w": int(r.get("orig_w", dw)), "h": int(r.get("orig_h", dh))},
        }
    return {
        "frames": frames,
        "meta": {
            "app": app,
            "version": "1.0",
            "image": image_name,
            "format": "RGBA8888",
            "size": {"w": int(width), "h": int(height)},
            "scale": "1",
        },
    }


def write_texturepacker_json(path: str | Path, image_name: str, width: int, height: int,
                             regions: list[dict], *, app: str) -> None:
    """Write `texturepacker_doc(...)` to `path` (indent 2, UTF-8)."""
    doc = texturepacker_doc(image_name, width, height, regions, app=app)
    Path(path).write_text(json.dumps(doc, indent=2), encoding="utf-8")
