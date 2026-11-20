#!/usr/bin/env python3
"""Turn generated character stills into game sprites: cut out, one scale, feet on one line.

    python3 scripts/salmons/normalise-facing-stills.py \\
        --src stills/ --pattern 'pass2_{character}_{facing}_101.png' --out sprites/

For each character (bear, fisherman) it reads one still per drawn facing (n, ne, e, se, s), each a
figure on a plain light background, and writes `<character>_idle_<facing>.png`: transparent, all on
one canvas, the body the same height in every facing, the feet at the bottom centre on one line.
It prints what it measured before and after and the one Bounds box per character to type into
Invisible Flipbook's Characters mode (`docs/guides/salmons-character-sprites.md`). It also writes a
preview per character: all eight directions as the game draws them (the west three mirrored), at
game size and three times that, with the ground line.

No model is used. The cutout is a flood fill of the background from the picture's edge, so light
areas inside the outline stay; a thin part against a light background can come out rough. The
"body" is the silhouette without its thin parts (a fishing rod, claws): height and foot centre
are measured on that, so a rod does not change the scale.

Needs Pillow and numpy.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

FACINGS = ("n", "ne", "e", "se", "s")
# The eight directions in the order of a compass walk, and the drawn facing each one shows.
DIRECTIONS = (
    ("n", "n", False), ("ne", "ne", False), ("e", "e", False), ("se", "se", False),
    ("s", "s", False), ("sw", "se", True), ("w", "e", True), ("nw", "ne", True),
)
# Width the game draws a character's Bounds box at (SpawnLayer), and the box we author it at.
GAME_WIDTH = {"bear": 92, "fisherman": 56}
BOX_WIDTH = {"bear": 320, "fisherman": 196}
BODY_FILL = 0.92      # the widest body view's share of the box width
HEADROOM = 1.04       # box height over body height
CANVAS = 512          # one square canvas for every sprite
FOOT_Y = 480          # the ground line on that canvas
THIN = 0.045          # parts thinner than this share of the still's width are not "body"
BG_NEAR, BG_FAR = 26.0, 58.0  # colour distance from the background: fully out .. fully in


def background_model(rgb: np.ndarray, outside: np.ndarray) -> np.ndarray:
    """A plane per channel fitted to the known background, so a faint gradient is followed."""
    ys, xs = np.nonzero(outside)
    design = np.c_[xs, ys, np.ones(len(xs))]
    yy, xx = np.mgrid[0:rgb.shape[0], 0:rgb.shape[1]]
    planes = []
    for channel in range(3):
        coef, *_ = np.linalg.lstsq(design, rgb[ys, xs, channel], rcond=None)
        planes.append(coef[0] * xx + coef[1] * yy + coef[2])
    return np.stack(planes, axis=-1)


def flood_from_edge(candidate: np.ndarray) -> np.ndarray:
    """The part of `candidate` connected to the picture's edge."""
    grid = np.pad(candidate, 1, constant_values=True).astype(np.uint8) * 255
    padded = Image.fromarray(grid).copy()  # a copy: fromarray's image can be read-only
    ImageDraw.floodfill(padded, (0, 0), 128)
    return np.asarray(padded)[1:-1, 1:-1] == 128


def cut_out(still: Image.Image) -> Image.Image:
    rgb = np.asarray(still.convert("RGB")).astype(float)
    border = np.zeros(rgb.shape[:2], dtype=bool)
    border[:12, :] = border[-12:, :] = border[:, :12] = border[:, -12:] = True
    outside = border
    for _ in range(2):
        distance = np.abs(rgb - background_model(rgb, outside)).sum(axis=2)
        outside = flood_from_edge(distance < BG_FAR)
    # Soft edge: inside the flooded region alpha follows the colour distance, elsewhere it is 1.
    ramp = np.clip((distance - BG_NEAR) / (BG_FAR - BG_NEAR), 0.0, 1.0)
    alpha = np.where(outside, ramp, 1.0)
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def body_mask(alpha: Image.Image) -> np.ndarray:
    """The silhouette with parts thinner than THIN of the width removed (an opening)."""
    size = int(alpha.width * THIN) | 1
    solid = alpha.point(lambda v: 255 if v > 128 else 0)
    opened = solid.filter(ImageFilter.MinFilter(size)).filter(ImageFilter.MaxFilter(size))
    return np.asarray(ImageChops.darker(opened, solid)) > 0


def measure(cut: Image.Image) -> dict:
    body = body_mask(cut.getchannel("A"))
    ys, xs = np.nonzero(body)
    top, bottom = int(ys.min()), int(ys.max())
    height = bottom - top + 1
    feet = body[bottom - int(height * 0.06):bottom + 1]
    foot_xs = np.nonzero(feet.any(axis=0))[0]
    return {
        "top": top, "bottom": bottom, "height": height,
        "width": int(xs.max() - xs.min() + 1),
        "foot_x": (int(foot_xs.min()) + int(foot_xs.max())) / 2,
    }


def place(cut: Image.Image, m: dict, scale: float) -> tuple[Image.Image, bool]:
    size = (round(cut.width * scale), round(cut.height * scale))
    small = cut.resize(size, Image.LANCZOS)
    left = round(CANVAS / 2 - m["foot_x"] * scale)
    top = round(FOOT_Y - (m["bottom"] + 1) * scale)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(small, (left, top))
    box = small.getchannel("A").getbbox() or (0, 0, 0, 0)
    clipped = left + box[0] < 0 or top + box[1] < 0 or left + box[2] > CANVAS or top + box[3] > CANVAS
    return canvas, clipped


def preview(character: str, sprites: dict, box: tuple[int, int, int, int]) -> Image.Image:
    """Eight directions at game size (top row) and three times that (bottom row)."""
    bx, by, bw, bh = box
    rows = []
    for factor in (1, 3):
        k = GAME_WIDTH[character] * factor / bw
        cell_w, cell_h = round(CANVAS * k) + 8, round(CANVAS * k) + 8
        row = Image.new("RGBA", (cell_w * len(DIRECTIONS), cell_h), (74, 148, 190, 255))
        draw = ImageDraw.Draw(row)
        for i, (_, facing, mirror) in enumerate(DIRECTIONS):
            sprite = sprites[facing]
            if mirror:
                sprite = sprite.transpose(Image.FLIP_LEFT_RIGHT)
            small = sprite.resize((round(CANVAS * k), round(CANVAS * k)), Image.LANCZOS)
            row.alpha_composite(small, (i * cell_w + 4, 4))
        ground = 4 + round(FOOT_Y * k)
        draw.line((0, ground, row.width, ground), fill=(255, 220, 0, 255), width=1)
        rows.append(row)
    sheet = Image.new("RGBA", (max(r.width for r in rows), sum(r.height for r in rows) + 6),
                      (255, 255, 255, 255))
    y = 0
    for row in rows:
        sheet.alpha_composite(row, (0, y))
        y += row.height + 6
    return sheet


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--src", type=Path, required=True)
    parser.add_argument("--pattern", default="{character}_{facing}.png")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--state", default="idle")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    for character in GAME_WIDTH:
        cuts, before = {}, {}
        for facing in FACINGS:
            path = args.src / args.pattern.format(character=character, facing=facing)
            cuts[facing] = cut_out(Image.open(path))
            before[facing] = measure(cuts[facing])
        # One body height for all five; sized so the widest body view fills the box.
        widest = max(m["width"] / m["height"] for m in before.values())
        body_h = BOX_WIDTH[character] * BODY_FILL / widest
        box_h = round(body_h * HEADROOM)
        box = (CANVAS // 2 - BOX_WIDTH[character] // 2, FOOT_Y - box_h, BOX_WIDTH[character], box_h)

        print(f"\n{character}: body height {body_h:.0f} px on a {CANVAS} x {CANVAS} canvas, "
              f"ground line y = {FOOT_Y}")
        print(f"  Bounds box (x / y / w / h): {box[0]} / {box[1]} / {box[2]} / {box[3]}")
        sprites = {}
        for facing in FACINGS:
            m = before[facing]
            scale = body_h / m["height"]
            sprites[facing], clipped = place(cuts[facing], m, scale)
            sprites[facing].save(args.out / f"{character}_{args.state}_{facing}.png")
            after = measure(sprites[facing])
            print(f"  {facing:>2}: before height {m['height']:4d} feet y {m['bottom']:4d} "
                  f"foot x {m['foot_x']:6.1f} width {m['width']:4d} | scale {scale:.3f} | "
                  f"after height {after['height']:3d} feet y {after['bottom'] + 1:3d} "
                  f"foot x {after['foot_x']:5.1f} width {after['width']:3d}"
                  f"{'  CLIPPED by the canvas' if clipped else ''}")
        preview(character, sprites, box).save(args.out / f"preview_{character}.png")


if __name__ == "__main__":
    main()
