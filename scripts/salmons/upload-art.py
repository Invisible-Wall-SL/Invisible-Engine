#!/usr/bin/env python3
"""Put Salmons' built-in art into the Salmons project as ordinary sheets (run once, by hand).

    python3 scripts/salmons/upload-art.py            # dry run: what it would write, and what is there
    python3 scripts/salmons/upload-art.py --apply    # writes

docs/status/salmons.md "Original art as project art". The plan is `scripts/salmons/project-art.mjs`
(the built-in pages and frames, region names unchanged). Each sheet is written as the Sheet Maker's
verbatim `.plist` import writes one, with the tools' own writers (`atlas_writers.build_manifest`,
`plist_import.to_texturepacker`) and storage (`iw_common.storage`, R2_* env):

  <client>/<project>/manifests/atlas_manifest_<sheet>.json   the manifest, locked
  <client>/<project>/sheets/<sheet>/<sheet>.webp             the built-in page, byte for byte
  <client>/<project>/sheets/<sheet>/<sheet>.json             its TexturePacker JSON

It writes nothing else: a key outside those is refused. Every write is create-only
(`If-None-Match: *`), the manifest first, as the import does. It is idempotent: an object already
there with the same content (a manifest's `saved_by` aside) is skipped. One with other content stops
the run before anything is written, and is reported; it is never overwritten.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'services' / '_shared'), str(ROOT / 'services' / 'sheet-tool')]

import atlas_writers  # noqa: E402
import plist_import  # noqa: E402
from iw_common import docsave, storage  # noqa: E402
from iw_common.context import r2_slug  # noqa: E402

SHEET_RE = re.compile(r'^salmons_[a-z_]+$')
ME = SimpleNamespace(uid='', sub='scripts/salmons/upload-art.py', name='Salmons art upload')


def load_plan() -> list[dict]:
    out = subprocess.run(
        ['node', '--experimental-strip-types', '--no-warnings', '--import',
         './scripts/ts-loader.mjs', 'scripts/salmons/project-art.mjs'],
        cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def objects(entry: dict, prefix: str) -> list[tuple[str, bytes, str]]:
    """(key, body, kind) for one sheet: the manifest first, then the page and its JSON."""
    sheet = entry['sheet']
    if not SHEET_RE.match(sheet):
        raise SystemExit(f'refused: "{sheet}" is not a Salmons project sheet')
    page = Path(entry['page']).read_bytes()
    folder = f'{prefix}/sheets/{sheet}'
    page_key, json_key = f"{folder}/{entry['image']}", f'{folder}/{sheet}.json'
    frames = [{**f, 'rotated': False, 'trim_x': 0, 'trim_y': 0,
               'source_w': f['w'], 'source_h': f['h']} for f in entry['frames']]
    tp = plist_import.to_texturepacker(
        {'frames': frames, 'image': entry['image'], 'width': entry['width'], 'height': entry['height']})
    tp['meta']['app'] = 'Invisible Engine (Salmons built-in art)'
    manifest = atlas_writers.build_manifest(
        sheet_image=entry['image'], width=entry['width'], height=entry['height'],
        regions=[{'name': f['name'], 'x': f['x'], 'y': f['y'], 'w': f['w'], 'h': f['h'],
                  'rotated': False, 'off_x': 0, 'off_y': 0,
                  'orig_w': f['w'], 'orig_h': f['h']} for f in entry['frames']],
        deploy_basename=sheet, export_prefix=folder,
        source_image_path=page_key, texturepacker_json=json_key)
    manifest['locked'] = True
    manifest['import'] = {'kind': 'salmons-builtin', 'verbatim': True,
                          'source': f"engine-layout salmonsArt/sheets/{Path(entry['page']).name}"}
    manifest['sequences'] = []
    docsave.stamp(manifest, ME, 'script')
    return [
        (objects_manifest_key(entry, prefix),
         json.dumps(manifest, indent=2).encode(), 'manifest'),
        (page_key, page, 'page'),
        (json_key, json.dumps(tp, indent=2).encode(), 'json'),
    ]


def objects_manifest_key(entry: dict, prefix: str) -> str:
    return f"{prefix}/manifests/atlas_manifest_{entry['sheet']}.json"


def same(kind: str, there: bytes, ours: bytes) -> bool:
    if kind != 'manifest':
        return there == ours
    try:
        a, b = json.loads(there), json.loads(ours)
    except ValueError:
        return False
    a.pop(docsave.SAVED_BY, None)
    b.pop(docsave.SAVED_BY, None)
    return a == b


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--client', default='invisible_wall')
    ap.add_argument('--project', default='salmons')
    ap.add_argument('--apply', action='store_true', help='write (default: a dry run)')
    ap.add_argument('--sheet', action='append', default=[],
                    help='only this sheet (repeatable; default: every sheet in the plan)')
    args = ap.parse_args()
    if not storage.configured():
        print('R2 is not configured: set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET')
        return 2
    prefix = f'{r2_slug(args.client)}/{r2_slug(args.project)}'
    allowed = re.compile(
        rf'^{re.escape(prefix)}/(manifests/atlas_manifest_salmons_[a-z_]+\.json'
        rf'|sheets/(salmons_[a-z_]+)/\2\.(webp|json))$')

    todo, conflicts = [], []
    plan = load_plan()
    unknown = set(args.sheet) - {e['sheet'] for e in plan}
    if unknown:
        raise SystemExit(f"refused: {', '.join(sorted(unknown))} is not in the plan")
    for entry in plan:
        if args.sheet and entry['sheet'] not in args.sheet:
            continue
        sheet = []
        for key, body, kind in objects(entry, prefix):
            if not allowed.match(key):
                raise SystemExit(f'refused: {key} is outside the Salmons art prefixes')
            found = storage.get_with_etag(key)
            if found is None:
                sheet.append((key, body))
                print(f'  write   {key} ({len(body)} B)')
            elif same(kind, found[0], body):
                print(f'  same    {key}')
            else:
                conflicts.append(key)
                print(f'  OTHER   {key} holds other content ({len(found[0])} B)')
        manifest_key = objects_manifest_key(entry, prefix)
        todo.append((manifest_key, sheet))
    if conflicts:
        print(f'\nStopped: {len(conflicts)} key(s) already hold other content. Nothing was written.')
        return 1
    count = sum(len(sheet) for _, sheet in todo)
    if not args.apply:
        print(f'\nDry run: {count} object(s) to write. Re-run with --apply to write them.')
        return 0
    for manifest_key, sheet in todo:
        for key, body in sheet:
            try:
                storage.put(key, body, if_none_match='*')
            except storage.Conflict:
                print(f'Stopped: {key} was created by someone else meanwhile. Re-run to compare.')
                return 1
            except Exception as error:  # noqa: BLE001 - reported, then the run stops
                print(f'Stopped: {key} did not write ({error}). Partially written: re-run to finish.')
                return 1
            print(f'  wrote   {key}')
        # A sheet deleted or renamed in the tools while its page was written would leave the page
        # without a manifest: say so (an unconditional delete could take someone's file).
        if sheet and storage.head(manifest_key) is None:
            print(f'Warning: {manifest_key} is gone after its sheet was written (deleted or renamed '
                  'meanwhile?). Its page and JSON may be left without a manifest.')
    print(f'\nDone: {count} object(s) written.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
