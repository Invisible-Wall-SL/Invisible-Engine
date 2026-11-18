#!/usr/bin/env python3
"""Write Salmons' built-in art as `.plist` + `.webp` pairs, for the Sheet Maker's Import (no R2 key).

    python3 scripts/salmons/plist-export.py --out <dir>

The keyless twin of `upload-art.py` (docs/status/salmons.md "Original art as project art"): the same
plan (`scripts/salmons/project-art.mjs`), as cocos2d format-3 plists the Sheet Maker's verbatim
import reads (`services/sheet-tool/plist_import.py`). Import each pair in the Sheet Maker (Import
tab, sheet name left blank): the sheet takes the plist's name (`salmons_terrain`, …), each region
its frame's name (`grass_c`, …), and the page is stored byte for byte, locked. The tool writes R2
itself, under the person's own login and its own conditional writes.
"""

from __future__ import annotations

import argparse
import json
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'services' / 'sheet-tool'))

import plist_import  # noqa: E402


def load_plan() -> list[dict]:
    out = subprocess.run(
        ['node', '--experimental-strip-types', '--no-warnings', '--import',
         './scripts/ts-loader.mjs', 'scripts/salmons/project-art.mjs'],
        cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def to_plist(entry: dict) -> dict:
    frames = {}
    for f in entry['frames']:
        size = f"{{{f['w']},{f['h']}}}"
        frames[f"{f['name']}.png"] = {
            'aliases': [],
            'spriteOffset': '{0,0}',
            'spriteSize': size,
            'spriteSourceSize': size,
            'textureRect': f"{{{{{f['x']},{f['y']}}},{size}}}",
            'textureRotated': False,
        }
    return {
        'frames': frames,
        'metadata': {
            'format': 3,
            'pixelFormat': 'RGBA8888',
            'premultiplyAlpha': False,
            'realTextureFileName': entry['image'],
            'size': f"{{{entry['width']},{entry['height']}}}",
            'textureFileName': entry['image'],
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', required=True, type=Path)
    out = ap.parse_args().out
    out.mkdir(parents=True, exist_ok=True)
    for entry in load_plan():
        plist_path = out / f"{entry['sheet']}.plist"
        with plist_path.open('wb') as fh:
            plistlib.dump(to_plist(entry), fh)
        shutil.copyfile(entry['page'], out / entry['image'])
        parsed = plist_import.parse_plist(plist_path)
        names = [f['name'] for f in parsed['frames']]
        problems = plist_import.validate(parsed)
        if problems or sorted(names) != sorted(f['name'] for f in entry['frames']):
            print(f'{plist_path.name}: does not read back as planned: {problems or names}')
            return 1
        print(f"  {plist_path.name} + {entry['image']}: {len(names)} regions")
    print(f'\nImport each pair in the Sheet Maker (Import tab, sheet name blank) from {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
