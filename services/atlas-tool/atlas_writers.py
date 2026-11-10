"""
TexturePacker JSON-hash emitter for the Invisible Atlas Maker deploy path.

The writer lives in `iw_common.texturepacker`, shared with the Invisible Sheet
Maker. The Atlas Maker writes its UPRIGHT dialect: a rotated region's `frame`
w/h are NOT swapped, so they stay the unrotated display size — the convention
the game runtime's PixiJS `Spritesheet` loads and the baked game sheets use
(see that module). The atlas-tool geometry already stores `w/h` as the
unrotated size for rotated regions (`atlas_format.write_atlas` /
`batch_atlas.fit_to_region`: art is fit to (w,h) upright then rotated +90 to
land as the (h x w) packed footprint), so the frame is that size verbatim.

Region dicts use the normalized shape from `atlas_format.parse_atlas`:
    {name, x, y, w, h, rotated, off_x, off_y, orig_w, orig_h}
"""

from __future__ import annotations

from pathlib import Path

from iw_common import texturepacker


def write_texturepacker_json(path: str | Path, image_name: str,
                             width: int, height: int, regions: list[dict]) -> None:
    """Emit a TexturePacker JSON-hash file in the exact shape the game engine
    loads. `image_name` MUST be the actual deployed page filename (e.g.
    `symbolsStatic.webp`) so `meta.image` resolves the sibling page."""
    texturepacker.write_texturepacker_json(
        path, image_name, width, height, regions,
        app="Invisible Atlas Maker", dialect=texturepacker.UPRIGHT)
