"""The one TexturePacker JSON-hash writer — in the two dialects the tools emit.

Region dicts use the normalized shape both packers produce:
    {name, x, y, w, h, rotated, off_x, off_y, orig_w, orig_h}
where `w/h` is the UPRIGHT (display) size even for a rotated region, whose
footprint on the page is then `h x w`.

The tools disagree on ONE field — what a rotated frame's `frame.w/h` holds —
and each output is relied on as it is, so the disagreement is a parameter, not
a fix:

  * ``UPRIGHT`` (the Atlas Maker's deploy + the Flipbook video sheets):
    `frame.w/h` == the upright size, never swapped. This is TexturePacker's own
    convention and what PixiJS's `Spritesheet` (the game runtime) expects — it
    swaps a rotated frame's w/h itself to find the page rect. The vendored game
    sheets agree (`apps/lines/static/assets/sprites/symbolsStatic/symbolsStatic.json`:
    the rotated `explodedW.png` has frame.w/h == spriteSourceSize.w/h), as does
    the launcher's direct reader (`apps/launcher-api/scripts/lib/tpRegions.mjs`,
    `editorRegions.ts::texturePackerToInvisible`).
  * ``FOOTPRINT`` (the Sheet Maker's export): a rotated frame's `frame.w/h` are
    swapped to the on-page footprint. The launcher's
    `editorRegions.ts::backfillMissingGeometry` reads a manifest's
    `atlas.texturepacker_json` this way (`uprightWH` un-swaps it).

Unrotated frames are identical in both dialects; so is everything but
`frame.w/h` and `meta.app`.
"""
from __future__ import annotations

import json
from pathlib import Path

UPRIGHT = "upright"
FOOTPRINT = "footprint"
DIALECTS = (UPRIGHT, FOOTPRINT)


def texturepacker_doc(image_name: str, width: int, height: int, regions: list[dict], *,
                      app: str, dialect: str) -> dict:
    """The JSON-hash document. `image_name` MUST be the actual page filename
    (`meta.image` resolves the sibling page).

    Frame keys are labels the engine looks up, independent of the page image
    format: a name that already carries an extension is kept verbatim
    (`explodedW.png`, `s.png`); a bare one falls back to `.png` — the engine's
    symbolsStatic frames are labelled `.png` (the source-sprite filenames) even
    though the packed page is `.webp`."""
    if dialect not in DIALECTS:
        raise ValueError(f"unknown TexturePacker dialect {dialect!r} (one of {DIALECTS})")
    frames: dict[str, dict] = {}
    for r in regions:
        dw, dh = int(r["w"]), int(r["h"])
        rotated = bool(r.get("rotated"))
        fw, fh = (dh, dw) if rotated and dialect == FOOTPRINT else (dw, dh)
        key = r["name"] if "." in r["name"] else f"{r['name']}.png"
        frames[key] = {
            "frame": {"x": int(r["x"]), "y": int(r["y"]), "w": fw, "h": fh},
            "rotated": rotated,
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
                             regions: list[dict], *, app: str, dialect: str) -> None:
    """Write `texturepacker_doc(...)` to `path` (indent 2, UTF-8)."""
    doc = texturepacker_doc(image_name, width, height, regions, app=app, dialect=dialect)
    Path(path).write_text(json.dumps(doc, indent=2), encoding="utf-8")
