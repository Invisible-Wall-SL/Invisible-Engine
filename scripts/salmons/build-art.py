#!/usr/bin/env python3
"""Build Salmons' original art into the engine (committed, shipped with the runtime).

    python3 scripts/salmons/build-art.py --src ../salmon-/art/source/legacy

A port of `GuiltyForever/Salmon-` `scripts/build-sheets.py` + `art/sheets.json`, sized for the
engine's isometric river (a 48 world-px cell, drawn as a 96 x 48 diamond) at about three times the
drawn size. Reads the old game's untouched images and writes, into
`packages/engine-layout/src/lib/salmonsArt/sheets/`:

  <sheet>.webp                  one page per sheet (terrain, props, characters)
  frames.ts                     each page's frames, TexturePacker JSON-hash with bare region names
                                (a module, not a .json: the workspace compiles without
                                `resolveJsonModule`), formatted with the repo's Prettier
  waterfall_face.webp           the tile the waterfalls scroll (a TilingSprite, kept out of sheets)

The bridges are not built: the engine's river has none. The cliff is not built: the engine draws
the waterfalls flat, with no elevation. Needs Pillow (with WebP) and numpy. The output is
deterministic for one Pillow / libwebp: re-running it on the same sources rewrites the same bytes.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'packages' / 'engine-layout' / 'src' / 'lib' / 'salmonsArt' / 'sheets'

RIVER = np.array([14, 165, 233], dtype=np.int32)
BACKGROUND_DIST_SQ = 40 * 40
BACKGROUND_MAX_BRIGHTNESS = 40
PAGE_W = 2048
PADDING = 2
WEBP = {'quality': 86, 'method': 6, 'exact': False}

COMPASS = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se']

# grid [cols, rows]; key hard | soft (the old background cut); size [w, h] or [w] (aspect kept);
# trim: crop each region to its opaque content (art that is placed by its own box, not a cell's).
SHEETS: dict[str, list[dict]] = {
    'terrain': [
        {'source': 'grass.png', 'grid': [3, 3], 'key': 'hard', 'size': [192, 192],
         'names': [f'grass_{d}' for d in COMPASS]},
        {'source': 'sand.png', 'grid': [3, 3], 'key': 'hard', 'size': [192, 192],
         'names': [f'sand_{d}' for d in COMPASS]},
    ],
    'props': [
        {'source': 'rocks.jpg', 'grid': [3, 3], 'key': 'hard', 'trim': True, 'size': [224],
         'names': [f'rock_{i}' for i in range(9)]},
        {'source': 'whirlpool.jpg', 'grid': [2, 2], 'key': 'soft', 'size': [320, 320],
         'names': [f'whirlpool_{i}' for i in range(4)]},
        {'source': 'trees.png', 'grid': [3, 2], 'trim': True, 'size': [288],
         'names': [f'tree_{i}' for i in range(6)]},
        {'source': 'waterfall_splash.png', 'grid': [2, 2],
         'names': [f'waterfall_splash_{i}' for i in range(4)]},
        {'source': 'waterfall_lip.png', 'grid': [2, 2],
         'names': [f'waterfall_lip_{i}' for i in range(4)]},
    ],
    'characters': [
        {'source': 'salmon_pink.png', 'trim': True, 'size': [256], 'flip': True,
         'names': ['salmon_pink']},
        {'source': 'salmon_golden.png', 'trim': True, 'size': [256], 'flip': True,
         'names': ['salmon_golden']},
        {'source': 'bear_sprite.png', 'trim': True, 'size': [256], 'names': ['bear']},
    ],
}
TILES = ['waterfall_face.png']


def edge_connected(mask: np.ndarray) -> np.ndarray:
    """The part of `mask` reachable from the image's edge through 4-connected `mask` pixels."""
    reached = np.zeros_like(mask)
    reached[0, :], reached[-1, :] = mask[0, :], mask[-1, :]
    reached[:, 0], reached[:, -1] = mask[:, 0], mask[:, -1]
    while True:
        grown = reached.copy()
        grown[1:, :] |= reached[:-1, :]
        grown[:-1, :] |= reached[1:, :]
        grown[:, 1:] |= reached[:, :-1]
        grown[:, :-1] |= reached[:, 1:]
        grown &= mask
        if np.array_equal(grown, reached):
            return reached
        reached = grown


def key_background(img: Image.Image, soft: bool) -> Image.Image:
    """River blue or near-black goes transparent (`hard`: only where it reaches the edge); the
    rest is opaque or, `soft`, ramps in with its distance from blue."""
    rgb = np.asarray(img.convert('RGB'), dtype=np.int32)
    dist_sq = ((rgb - RIVER) ** 2).sum(axis=2)
    background = (dist_sq < BACKGROUND_DIST_SQ) | (rgb.mean(axis=2) < BACKGROUND_MAX_BRIGHTNESS)
    if soft:
        alpha = np.clip((np.sqrt(dist_sq) - 35) * 3, 0, 255)
    else:
        background = edge_connected(background)
        alpha = np.full(dist_sq.shape, 255.0)
    alpha[background] = 0
    rgba = np.dstack([rgb, alpha.astype(np.int32)]).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


def cut_grid(img: Image.Image, cols: int, rows: int) -> list[Image.Image]:
    w, h = img.size
    return [
        img.crop((round(col * w / cols), round(row * h / rows),
                  round((col + 1) * w / cols), round((row + 1) * h / rows)))
        for row in range(rows) for col in range(cols)
    ]


def trim(img: Image.Image) -> Image.Image:
    """Crop to the rows and columns that hold real content: a speck of a neighbouring cell's art
    (a few px in a column) does not widen the box."""
    solid = np.asarray(img.getchannel('A')) > 8
    cols = np.nonzero(solid.sum(axis=0) > solid.shape[0] * 0.02)[0]
    rows = np.nonzero(solid.sum(axis=1) > solid.shape[1] * 0.02)[0]
    if not len(cols) or not len(rows):
        return img
    return img.crop((int(cols.min()), int(rows.min()), int(cols.max()) + 1, int(rows.max()) + 1))


def resample(img: Image.Image, size: list[int]) -> Image.Image:
    if len(size) == 1:
        target = (size[0], max(1, round(img.height * size[0] / img.width)))
    else:
        target = (size[0], size[1])
    if target == img.size:
        return img
    # Premultiplied, so transparent pixels never bleed their colour into the edges.
    return img.convert('RGBa').resize(target, Image.LANCZOS).convert('RGBA')


def regions_for(src: Path, entry: dict) -> list[tuple[str, Image.Image]]:
    img = Image.open(src / entry['source'])
    if entry.get('key') == 'soft':
        img = key_background(img, soft=True)
    img = img.convert('RGBA')
    cells = cut_grid(img, *entry['grid']) if 'grid' in entry else [img]
    if entry.get('key') == 'hard':
        cells = [key_background(cell, soft=False) for cell in cells]
    if len(cells) != len(entry['names']):
        sys.exit(f"build-art: {entry['source']} has {len(cells)} cells but "
                 f"{len(entry['names'])} names")
    out = []
    for name, cell in zip(entry['names'], cells):
        if entry.get('trim'):
            cell = trim(cell)
        if 'size' in entry:
            cell = resample(cell, entry['size'])
        if entry.get('flip'):
            cell = cell.transpose(Image.FLIP_LEFT_RIGHT)
        out.append((name, cell))
    return out


def shelf_pack(sizes: list[tuple[str, int, int]]) -> tuple[int, int, dict[str, tuple[int, int]]]:
    """Tallest first, left to right in rows: a page `PAGE_W` wide at most, as tall as it needs."""
    places: dict[str, tuple[int, int]] = {}
    x = y = shelf = used_w = 0
    for name, w, h in sorted(sizes, key=lambda s: (-s[2], -s[1], s[0])):
        if x and x + w > PAGE_W:
            x, y, shelf = 0, y + shelf + PADDING, 0
        places[name] = (x, y)
        x += w + PADDING
        shelf = max(shelf, h)
        used_w = max(used_w, x - PADDING)
    return used_w, y + shelf, places


def build_sheet(src: Path, name: str, entries: list[dict]) -> tuple[dict, int]:
    images: dict[str, Image.Image] = {}
    for entry in entries:
        for region, img in regions_for(src, entry):
            if region in images:
                sys.exit(f'build-art: region {region!r} appears twice in sheet {name!r}')
            images[region] = img
    width, height, places = shelf_pack([(n, i.width, i.height) for n, i in images.items()])
    if height > PAGE_W:
        sys.exit(f'build-art: sheet {name!r} is {width}x{height}, over {PAGE_W}px')
    page = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    frames = {}
    for region in sorted(images):
        img = images[region]
        x, y = places[region]
        page.paste(img, (x, y))
        frames[region] = {
            'frame': {'x': x, 'y': y, 'w': img.width, 'h': img.height},
            'rotated': False,
            'trimmed': False,
            'spriteSourceSize': {'x': 0, 'y': 0, 'w': img.width, 'h': img.height},
            'sourceSize': {'w': img.width, 'h': img.height},
        }
    image = f'{name}.webp'
    page.save(OUT / image, 'WEBP', **WEBP)
    doc = {
        'frames': frames,
        'meta': {'image': image, 'format': 'RGBA8888', 'size': {'w': width, 'h': height},
                 'scale': '1'},
    }
    size = (OUT / image).stat().st_size
    print(f'  {name}: {len(images)} regions on {width}x{height}, {size} B')
    return doc, size


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--src', type=Path, required=True,
                        help="the old game's art/source/legacy folder")
    args = parser.parse_args()
    src = args.src.resolve()
    if not (src / 'salmon_pink.png').is_file():
        sys.exit(f'build-art: no Salmons legacy art in {src}')
    OUT.mkdir(parents=True, exist_ok=True)
    for stale in OUT.iterdir():
        stale.unlink()
    sizes: dict[str, int] = {}
    docs: dict[str, dict] = {}
    for name, entries in SHEETS.items():
        docs[name], sizes[f'{name}.webp'] = build_sheet(src, name, entries)
    frames = OUT / 'frames.ts'
    frames.write_text(
        '// Made by scripts/salmons/build-art.py from the sheets beside it: do not edit.\n\n'
        f'export const SALMONS_SHEETS = {json.dumps(docs, indent=chr(9))};\n', encoding='utf-8')
    prettier = ROOT / 'node_modules' / '.bin' / 'prettier'
    if prettier.is_file():
        subprocess.run([str(prettier), '--write', str(frames)], check=True, capture_output=True)
    for tile in TILES:
        target = OUT / f'{Path(tile).stem}.webp'
        Image.open(src / tile).convert('RGBA').save(target, 'WEBP', **WEBP)
        sizes[target.name] = target.stat().st_size
        print(f'  {target.name}: {sizes[target.name]} B')
    print(f'  total {sum(sizes.values())} B')


if __name__ == '__main__':
    main()
