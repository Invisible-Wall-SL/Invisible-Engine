"""Run: python3 scripts/salmons/test_merge_fields.py (from the repo root). Exits non-zero on a failure.

`upload-project.py --fields`: only the named fields of the export reach the live config, and what
the owner authored in the tools (the bear's sheet and its link) is kept.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from merge_fields import MISSING, field_of, parse_fields, with_fields  # noqa: E402

LIVE = {
    'savedBy': {'name': 'owner'},
    'arcade': {
        'characters': [
            {'id': 'bearBot', 'view': {'kind': 'isometric', 'turn': {}}, 'rig': 'R_Bear'},
            {'id': 'salmonBot'},
        ],
        'online': {
            'generator': 'salmonsMap',
            'nearby': {'w': 3300, 'h': 3300, 'max': {'w': 6400, 'h': 6400}},
            'characters': [{'id': 'bear', 'sheet': 'bearBot', 'speed': 216}, {'id': 'salmon'}],
            'levels': {'seeds': [7]},
        },
    },
}
EXPORT = {
    'arcade': {
        'characters': [{'id': 'bearBot'}, {'id': 'salmonBot'}],
        'online': {
            'generator': 'salmonsMap',
            'nearby': {'w': 3300, 'h': 3300},
            'characters': [{'id': 'bear', 'speed': 216}, {'id': 'salmon'}],
            'levels': {
                'river': {'winding': 0.75, 'sharpestTurn': 140, 'sourceBias': 0.6},
                'waterfalls': {'count': 6, 'heightMin': 5, 'heightMax': 10},
            },
            'slide': {'corner': 168},
        },
    },
}

checks = 0


def check(name: str, ok: bool) -> None:
    global checks
    if not ok:
        print(f'  FAIL  {name}')
        sys.exit(1)
    checks += 1
    print(f'  ok  {name}')


live = copy.deepcopy(LIVE)
export = copy.deepcopy(EXPORT)
fields = parse_fields('arcade.online.levels.river, arcade.online.levels.waterfalls,arcade.online.slide')
out = with_fields(live, export, fields)
online = out['arcade']['online']

check('the named fields are the export\'s', online['levels']['river'] == EXPORT['arcade']['online']['levels']['river']
      and online['levels']['waterfalls'] == EXPORT['arcade']['online']['levels']['waterfalls']
      and online['slide'] == {'corner': 168})
check('a sibling of a named field is kept (the pinned seeds)', online['levels']['seeds'] == [7])
check('the bear keeps its sheet link and its sheet', online['characters'] == LIVE['arcade']['online']['characters']
      and out['arcade']['characters'] == LIVE['arcade']['characters'])
check('nothing else changes', {k: v for k, v in online.items() if k not in ('levels', 'slide')}
      == {k: v for k, v in LIVE['arcade']['online'].items() if k != 'levels'} and out['savedBy'] == LIVE['savedBy'])
check('neither document is changed', live == LIVE and export == EXPORT)
check('the whole export, by contrast, would drop the sheet',
      'sheet' not in EXPORT['arcade']['online']['characters'][0])

gone = with_fields(out, {'arcade': {'online': {}}}, ['arcade.online.slide', 'arcade.online.levels.river'])
check('a field the export no longer has is taken out', 'slide' not in gone['arcade']['online']
      and 'river' not in gone['arcade']['online']['levels']
      and gone['arcade']['online']['levels']['seeds'] == [7])
check('a field neither has is left alone', with_fields(LIVE, EXPORT, ['arcade.online.rules.zones']) == LIVE)
made = with_fields({'arcade': {}}, EXPORT, ['arcade.online.slide'])
check('a missing parent is made for a field the export has', made == {'arcade': {'online': {'slide': {'corner': 168}}}})
check('the same fields twice change nothing more', with_fields(out, export, fields) == out)

try:
    with_fields({'arcade': {'online': 'x'}}, EXPORT, ['arcade.online.slide'])
    refused = False
except ValueError:
    refused = True
check('a parent that is not an object is refused', refused)
for bad in ('arcade..levels', '.arcade', 'arcade.'):
    try:
        parse_fields(bad)
        refused = False
    except ValueError:
        refused = True
    check(f'"{bad}" is refused', refused)
check('no field named is no field', parse_fields(' , ') == [])
check('a missing field reads as missing', field_of(LIVE, 'arcade.online.slide') is MISSING
      and field_of(LIVE, 'arcade.online.levels.seeds') == [7])
check('the result is still JSON', json.loads(json.dumps(out)) == out)


# --- `upload-project.py --fields` whole, on a stand-in for R2: the real export, a live config that
# holds an authored sheet. Nothing here reaches a network.
import importlib.util  # noqa: E402
import io  # noqa: E402
import tempfile  # noqa: E402
import types  # noqa: E402
from contextlib import redirect_stdout  # noqa: E402


class Conflict(Exception):
    pass


store: dict[str, bytes] = {}
storage = types.ModuleType('iw_common.storage')
storage.Conflict = Conflict
storage.configured = lambda: True
storage.get_with_etag = lambda key: (store[key], f'etag-{len(store[key])}') if key in store else None


def put(key, body, if_none_match=None, if_match=None):
    if if_none_match == '*' and key in store:
        raise Conflict()
    if if_match is not None and (key not in store or if_match != f'etag-{len(store[key])}'):
        raise Conflict()
    store[key] = body


storage.put = put
docsave = types.ModuleType('iw_common.docsave')
docsave.SAVED_BY = 'savedBy'
docsave.stamp = lambda doc, me, how: doc.__setitem__('savedBy', {'name': me.name})
package = types.ModuleType('iw_common')
package.storage = storage
package.docsave = docsave
sys.modules.update({'iw_common': package, 'iw_common.storage': storage, 'iw_common.docsave': docsave})

spec = importlib.util.spec_from_file_location(
    'upload_project', Path(__file__).resolve().parent / 'upload-project.py')
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)

KEY = upload.CONFIG_KEY
FIELDS = 'arcade.online.levels.river,arcade.online.levels.waterfalls'


def run(*argv: str) -> tuple[int, str]:
    out = io.StringIO()
    sys.argv = ['upload-project.py', *argv]
    with redirect_stdout(out):
        code = upload.main()
    return code, out.getvalue()


with tempfile.TemporaryDirectory() as tmp:
    exported = dict(upload.export(Path(tmp) / 'export'))
    authored = copy.deepcopy(exported[KEY])
    authored['arcade']['online'].pop('levels', None)
    bear = next(c for c in authored['arcade']['online']['characters'] if c['id'] == 'bear')
    bear['sheet'] = 'bearBot'
    authored['arcade']['characters'][0]['rig'] = 'R_Bear'
    authored['arcade']['online']['nearby'] = {'w': 1234, 'h': 1234}
    before = json.dumps(authored, indent=2).encode('utf-8')
    store[KEY] = before
    store['invisible_wall/salmons/editor/scenes.json'] = b'{"authored": true}'

    code, said = run('--diff-dir', str(Path(tmp) / 'diff'), '--fields', FIELDS)
    diff = (Path(tmp) / 'diff' / (KEY.replace('/', '__') + '.diff')).read_text('utf-8')
    changed = [line for line in diff.splitlines()
               if line[:1] in '+-' and not line.startswith(('+++', '---'))]
    check('a dry run with fields plans the config alone and writes nothing',
          code == 0 and 'Dry run: 1 document(s)' in said and store[KEY] == before)
    check('its diff adds the river and the waterfalls and removes nothing',
          all(line.startswith('+') for line in changed)
          and any('"sharpestTurn": 140' in line for line in changed)
          and any('"heightMax": 10' in line for line in changed))
    check('its diff does not touch the sheet, the rig or the tuned number',
          not any(word in line for line in changed for word in ('bearBot', 'R_Bear', '1234')))

    code, said = run('--diff-dir', str(Path(tmp) / 'diff'), '--fields', FIELDS, '--apply')
    written = json.loads(store[KEY])
    online = written['arcade']['online']
    backups = [key for key in store if key.startswith(upload.BACKUP_ROOT) and key.endswith(KEY)]
    check('apply writes the fields', code == 0
          and online['levels'] == exported[KEY]['arcade']['online']['levels'])
    check('apply keeps the sheet link, the rig and the tuned number',
          next(c for c in online['characters'] if c['id'] == 'bear')['sheet'] == 'bearBot'
          and written['arcade']['characters'][0]['rig'] == 'R_Bear'
          and online['nearby'] == {'w': 1234, 'h': 1234})
    check('apply backs the old config up first', len(backups) == 1 and store[backups[0]] == before)
    check('apply leaves the other documents alone',
          store['invisible_wall/salmons/editor/scenes.json'] == b'{"authored": true}')
    code, said = run('--diff-dir', str(Path(tmp) / 'diff'), '--fields', FIELDS)
    check('a second run has nothing to do', code == 0 and 'Nothing to do' in said)

    store[KEY] = before
    code, said = run('--diff-dir', str(Path(tmp) / 'diff'))
    listed = (Path(tmp) / 'diff' / (KEY.replace('/', '__') + '.diff')).read_text('utf-8')
    check('with no --fields (as CI runs it) the fields are the committed list, and the sheet stays',
          code == 0 and 'arcade.online.slide' in said and 'everything else is left' in said
          and upload.file_fields().split(',') == ['arcade.online.slide', 'arcade.online.levels.river',
                                                   'arcade.online.levels.waterfalls']
          and not any(line.startswith('-') and not line.startswith('---') for line in listed.splitlines()))
    code, said = run('--diff-dir', str(Path(tmp) / 'diff'), '--fields', '')
    whole = (Path(tmp) / 'diff' / (KEY.replace('/', '__') + '.diff')).read_text('utf-8')
    check('with no field at all the dry run shows the sheet link going',
          code == 0 and any(line.startswith('-') and 'bearBot' in line for line in whole.splitlines()))
    del store[KEY]
    code, said = run('--diff-dir', str(Path(tmp) / 'diff'), '--fields', FIELDS)
    check('fields with no live config stops', code == 1 and 'no live' in said)
    code, said = run('--diff-dir', str(Path(tmp) / 'diff'), '--fields', 'arcade..levels')
    check('a bad path is refused before anything is read', code == 2)

print(f'test_merge_fields: {checks} checks passed')
