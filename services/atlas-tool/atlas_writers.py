"""
TexturePacker JSON-hash emitter for the Invisible Atlas Maker deploy path.

Ported from the Invisible Sheet Maker's
`services/sheet-tool/atlas_writers.py::write_texturepacker_json` so the
field-mapping math lives in one conceptual place — the Atlas Maker's deploy
re-uses the same proven `frames`+`meta` shape the game engine loads.

ONE deliberate deviation from the Sheet Maker writer (documented below): the
on-sheet rotated `frame` w/h are NOT swapped. The Sheet Maker writer swaps
them (`fw, fh = (dh, dw) if rotated`), which is one valid TexturePacker
dialect. But the game's baked spritesheets — and the editor's inverse reader
`apps/launcher-api/scripts/seed-game-editor.mjs::tpToRegion` — treat
`frame.w/h` as the UNROTATED display size (verified against
`apps/lines/static/assets/sprites/symbolsStatic/symbolsStatic.json`, where the
rotated `explodedW.png` has frame.w/h == spriteSourceSize.w/h). The atlas-tool
geometry already stores `w/h` as the unrotated size for rotated regions (see
`atlas_format.write_atlas` / `batch_atlas.fit_to_region`: art is fit to (w,h)
upright then rotated +90 to land as the (h x w) packed footprint). To stay the
exact inverse of `tpToRegion` and match the baked game files, we keep frame.w/h
== w/h for rotated regions.

Region dicts use the normalized shape from `atlas_format.parse_atlas`:
    {name, x, y, w, h, rotated, off_x, off_y, orig_w, orig_h}
"""

from __future__ import annotations

import json
from pathlib import Path


def write_texturepacker_json(path: str | Path, image_name: str,
                             width: int, height: int, regions: list[dict]) -> None:
    """Emit a TexturePacker JSON-hash file in the exact shape the game engine
    loads. `image_name` MUST be the actual deployed page filename (e.g.
    `symbolsStatic.webp`) so `meta.image` resolves the sibling page.

    Frame keys keep their extension when the region name already carries one
    (`h1.webp`, `explodedW.png`); a bare name inherits the page image's
    extension (`image_name` — e.g. `.webp`), so a `.webp` sheet yields `h1.webp`
    keys matching how the engine references them.
    """
    frames: dict[str, dict] = {}
    # A bare region name inherits the atlas PAGE's format — a frame of a
    # `symbolsStatic.webp` sheet is `<name>.webp`, which is how the engine
    # references these symbols (`h1.webp`). Region names that already carry an
    # extension are kept verbatim (`explodedW.png`, `s.png`), so a mixed-format
    # sheet still round-trips its original per-frame keys.
    page_ext = Path(image_name).suffix or ".png"
    for r in regions:
        dw, dh = int(r["w"]), int(r["h"])
        rotated = bool(r.get("rotated"))
        # NO swap on rotation — see module docstring. frame.w/h == display size.
        key = r["name"] if "." in r["name"] else f"{r['name']}{page_ext}"
        frames[key] = {
            "frame": {"x": int(r["x"]), "y": int(r["y"]), "w": dw, "h": dh},
            "rotated": rotated,
            "trimmed": False,
            "spriteSourceSize": {"x": int(r.get("off_x", 0)), "y": int(r.get("off_y", 0)),
                                 "w": dw, "h": dh},
            "sourceSize": {"w": int(r.get("orig_w", dw)), "h": int(r.get("orig_h", dh))},
        }
    doc = {
        "frames": frames,
        "meta": {
            "app": "Invisible Atlas Maker",
            "version": "1.0",
            "image": image_name,
            "format": "RGBA8888",
            "size": {"w": int(width), "h": int(height)},
            "scale": "1",
        },
    }
    Path(path).write_text(json.dumps(doc, indent=2), encoding="utf-8")
