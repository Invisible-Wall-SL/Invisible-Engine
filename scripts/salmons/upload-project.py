#!/usr/bin/env python3
"""Put Salmons' exported game documents into the Salmons project, with a backup (run from CI).

    python3 scripts/salmons/upload-project.py --diff-dir <dir>            # dry run
    python3 scripts/salmons/upload-project.py --diff-dir <dir> --apply    # back up, then write

`scripts/salmons/export.mjs` writes the documents (config, river layout, flow, character
components) at the R2 keys the launcher reads; this puts them there. Every write is conditional:
a key that is new is created only if still absent (`If-None-Match: *`), a key that changed is
first copied to `_backups/salmons-project/<UTC stamp>/<key>` and then replaced only if it is still
the version this run read (`If-Match`). A key someone saved meanwhile stops the run. Keys outside
the Salmons documents are refused. The dry run writes a unified diff per changed key to
`--diff-dir` and prints a summary; it writes nothing to R2.

    python3 scripts/salmons/upload-project.py --diff-dir <dir> \
        --fields arcade.online.levels.river,arcade.online.levels.waterfalls [--apply]

WITHOUT `--fields` EVERY DOCUMENT IS REPLACED WHOLE, the config included: what the owner authored
in the tools since the last upload (a character's sheet and its link, a tuned number) is not in
the export and is deleted. With `--fields` only the config is touched, and of it only the named
fields (dotted paths, `merge_fields.py`): the live config keeps everything else as it is. A field
the export does not have is taken out of the live config. There must be a live config to merge
into.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'services' / '_shared'), str(Path(__file__).resolve().parent)]

from iw_common import docsave, storage  # noqa: E402
from merge_fields import parse_fields, with_fields  # noqa: E402

ME = SimpleNamespace(uid='', sub='scripts/salmons/upload-project.py', name='Salmons project upload')
ALLOWED = re.compile(
    r'^(invisible_wall/salmons/(config/config\.json|editor/scenes\.json|editor/flow-v2\.json)'
    r'|editor/salmons/components/[a-z0-9_-]+\.json)$')
BACKUP_ROOT = '_backups/salmons-project'
CONFIG_KEY = 'invisible_wall/salmons/config/config.json'


def export(out: Path) -> list[tuple[str, dict]]:
    subprocess.run(
        ['node', '--experimental-strip-types', '--no-warnings', '--import',
         './scripts/ts-loader.mjs', 'scripts/salmons/export.mjs', '--out', str(out)],
        cwd=ROOT, check=True)
    docs = []
    for path in sorted(p for p in out.rglob('*.json') if p.is_file()):
        key = path.relative_to(out).as_posix()
        if not ALLOWED.match(key):
            raise SystemExit(f'refused: {key} is not a Salmons project document')
        docs.append((key, json.loads(path.read_text('utf-8'))))
    if not docs:
        raise SystemExit('the export wrote nothing')
    return docs


def comparable(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k not in (docsave.SAVED_BY, 'rev')}


def pretty(doc: dict) -> list[str]:
    return json.dumps(comparable(doc), indent=2, sort_keys=True).splitlines(keepends=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--apply', action='store_true', help='back up and write (default: dry run)')
    ap.add_argument('--diff-dir', required=True, help='where the per-key diffs are written')
    ap.add_argument('--fields', default='',
                    help='only these fields of the config (dotted paths, comma separated); '
                         'every other document and field is left as it is')
    args = ap.parse_args()
    try:
        fields = parse_fields(args.fields)
    except ValueError as error:
        print(f'--fields: {error}')
        return 2
    if not storage.configured():
        print('R2 is not configured: set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET')
        return 2

    diff_dir = Path(args.diff_dir)
    diff_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        docs = export(Path(tmp))
    if fields:
        docs = [(key, doc) for key, doc in docs if key == CONFIG_KEY]
        print(f'Only {", ".join(fields)} of {CONFIG_KEY}; everything else is left as it is.')

    plan = []
    for key, doc in docs:
        found = storage.get_with_etag(key)
        if fields:
            try:
                live = json.loads(found[0]) if found else None
            except ValueError:
                live = None
            if not isinstance(live, dict):
                print(f'Stopped: no live {key} to take fields into; run without --fields first.')
                return 1
            try:
                doc = with_fields(live, doc, fields)
            except ValueError as error:
                print(f'Stopped: {error}.')
                return 1
        if found is None:
            plan.append(('new', key, doc, None, None))
            print(f'  new      {key}')
            continue
        body, etag = found
        try:
            there = json.loads(body)
        except ValueError:
            there = None
        if isinstance(there, dict) and comparable(there) == comparable(doc):
            print(f'  same     {key}')
            continue
        before = pretty(there) if isinstance(there, dict) else body.decode('utf-8', 'replace').splitlines(True)
        diff = list(difflib.unified_diff(before, pretty(doc), f'r2/{key}', f'export/{key}'))
        name = key.replace('/', '__') + '.diff'
        (diff_dir / name).write_text(''.join(diff), 'utf-8')
        added = sum(1 for l in diff if l.startswith('+') and not l.startswith('+++'))
        removed = sum(1 for l in diff if l.startswith('-') and not l.startswith('---'))
        print(f'  changed  {key}  (+{added} -{removed} lines, diff: {name})')
        plan.append(('changed', key, doc, body, etag))

    if not plan:
        print('\nNothing to do: the project already holds the exported documents.')
        return 0
    if not args.apply:
        print(f'\nDry run: {len(plan)} document(s) would be written; diffs in {diff_dir}. '
              'Re-run with apply to back up and write.')
        return 0

    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    for kind, key, doc, old_body, etag in plan:
        docsave.stamp(doc, ME, 'script')
        body = f'{json.dumps(doc, indent=2)}\n'.encode('utf-8')
        try:
            if kind == 'new':
                storage.put(key, body, if_none_match='*')
            else:
                backup = f'{BACKUP_ROOT}/{stamp}/{key}'
                storage.put(backup, old_body, if_none_match='*')
                print(f'  backup   {backup}')
                storage.put(key, body, if_match=etag)
        except storage.Conflict:
            print(f'Stopped: {key} was saved by someone else since this run read it. '
                  'Nothing after it was written; re-run the dry run to compare.')
            return 1
        print(f'  wrote    {key}')
    print(f'\nDone: {len(plan)} document(s) written; backups under {BACKUP_ROOT}/{stamp}/.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
