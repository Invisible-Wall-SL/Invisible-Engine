"""The Blender toolchain's rules, without Blender: CI runs this through scripts/check-python.py.

Run: python test_ie_conventions.py   (from tools/blender)

Covers what can be proven with no `bpy`: every rule in ie_conventions.check_facts() on synthetic
facts (a clean prop, a clean hero + clip library, and one of every mistake), the report against
report.schema.json, the committed export presets against the settings the scripts use, the GLB
rewrite that strips scale channels, and that every Blender script at least compiles. The same
scripts in a real Blender are proven by selftest.py (needs Blender; see tools/blender/README.md).
"""

from __future__ import annotations

import json
import os
import py_compile
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ie_conventions as conv  # noqa: E402
import ie_glb  # noqa: E402

FAILED: list[str] = []


def check(cond: bool, what: str) -> None:
    print(f"{'ok  ' if cond else 'FAIL'} {what}")
    if not cond:
        FAILED.append(what)


def mesh(tris=100, uv=1, bbox=((-0.5, -0.5, 0.0), (0.5, 0.5, 1.0)), materials=('M_a',), **skin):
    return {
        'tris': tris, 'ngons': 0, 'loose_verts': 0, 'loose_edges': 0, 'uv_layers': uv,
        'bbox_min': list(bbox[0]), 'bbox_max': list(bbox[1]), 'materials': list(materials),
        'vertex_groups': skin.get('groups', []), 'armature': skin.get('armature'),
        'max_influences': skin.get('max_influences', 0), 'over_influence_verts': 0,
        'unnormalised_verts': skin.get('unnormalised', 0), 'unweighted_verts': 0,
    }


def obj(name, type_='MESH', parent=None, rotation=(0, 0, 0), scale=(1, 1, 1), m=None):
    o = {
        'name': name, 'type': type_, 'parent': parent, 'parent_bone': None,
        'location': [0, 0, 0], 'rotation': list(rotation), 'scale': list(scale), 'custom': {},
    }
    if type_ == 'MESH':
        o['mesh'] = m or mesh()
    return o


def humanoid(name='RIG_ie_humanoid', edit=None):
    bones = [
        {'name': n, 'parent': p, 'deform': d, 'head': list(h), 'tail': list(t)}
        for n, p, h, t, d, _r in conv.HUMANOID_BONES
    ]
    if edit:
        edit(bones)
    return {'object': name, 'skeleton': 'ie_humanoid', 'bones': bones}


def channel(bone, prop, varies=True, at_rest=False):
    return {'bone': bone, 'prop': prop, 'index': 0, 'varies': varies, 'at_rest': at_rest}


def facts(objects=(), armatures=(), materials=(), images=(), actions=(), fps=30, scale=1.0):
    return {
        'blender': '5.2.2 LTS', 'file': None, 'unit': {'system': 'METRIC', 'scale': scale},
        'fps': fps, 'objects': list(objects), 'armatures': list(armatures),
        'materials': list(materials), 'images': list(images), 'actions': list(actions),
    }


def codes(report):
    return {i['code'] for i in report['issues']}


with open(os.path.join(HERE, 'report.schema.json'), encoding='utf-8') as fh:
    SCHEMA = json.load(fh)


def test_clean_prop():
    f = facts(
        objects=[
            obj('PR_crate_LOD0', m=mesh(5000)),
            obj('PR_crate_LOD1', m=mesh(2000)),
            obj('PR_crate_COL', m=mesh(12)),
            obj('SK_top', 'EMPTY', parent='PR_crate_LOD0'),
        ],
        materials=[{'name': 'M_a', 'images': ['crate_palette'], 'custom': {'toon': {'ramp': 'r', 'outline': 0.02}}}],
        images=[{'name': 'crate_palette', 'w': 256, 'h': 256}],
    )
    r = conv.check_facts(f)
    check(r['ok'] and not r['issues'], f'a clean prop has no issues ({codes(r)})')
    a = r['assets'][0]
    check(a['class'] == 'prop' and [lv['level'] for lv in a['lods']] == ['LOD0', 'LOD1'], 'prop LODs read')
    check(a['collision'] == ['PR_crate_COL'] and a['sockets'] == ['SK_top'], 'collision and sockets read')
    check(not conv.schema_errors(r, SCHEMA), 'clean report matches the schema')


def test_clean_hero_and_clips():
    skin = {'armature': 'RIG_ie_humanoid', 'groups': ['pelvis', 'head'], 'max_influences': 2}
    hero = facts(
        objects=[
            obj('RIG_ie_humanoid', 'ARMATURE'),
            obj('CH_brawler_LOD0', parent='RIG_ie_humanoid', m=mesh(18000, materials=('M_a', 'M_b'), **skin)),
            obj('SK_hand_r', 'EMPTY', parent='RIG_ie_humanoid'),
        ],
        armatures=[humanoid()],
    )
    r = conv.check_facts(hero)
    check(r['ok'] and not r['issues'], f'a clean hero has no issues ({codes(r)})')
    check(r['armatures'][0]['deformBones'] == 22, 'the IE Humanoid has 22 deform bones')
    clips = facts(
        objects=[obj('RIG_ie_humanoid', 'ARMATURE')],
        armatures=[humanoid()],
        actions=[{
            'name': 'locomotion.run_fwd', 'frame_range': [1, 21],
            'channels': [channel('spine_01', 'rotation_quaternion'), channel('pelvis', 'location'),
                         channel('root', 'location', varies=False, at_rest=True)],
        }],
    )
    r = conv.check_facts(clips)
    check(r['kind'] == 'clips' and r['ok'] and not r['issues'], f'a clean clip library ({codes(r)})')


def test_viewmodel():
    skin = {'armature': 'RIG_ie_humanoid', 'groups': ['upperarm_l', 'hand_r'], 'max_influences': 1}
    arms = mesh(4000, bbox=((-0.8, -0.3, 1.3), (0.8, 0.2, 1.5)), **skin)

    def vm(with_eye):
        objects = [
            obj('RIG_ie_humanoid', 'ARMATURE'),
            obj('CH_brawler_vm_LOD0', parent='RIG_ie_humanoid', m=arms),
        ]
        if with_eye:
            objects.append(obj('SK_eye', 'EMPTY', parent='RIG_ie_humanoid'))
        return conv.check_facts(facts(objects=objects, armatures=[humanoid()]))

    r = vm(True)
    check(r['ok'] and not r['issues'], f'a viewmodel floats at arm height with no ORIGIN issue ({codes(r)})')
    r = vm(False)
    check(codes(r) == {'VIEWMODEL_NO_EYE'}, f'a viewmodel without SK_eye is refused ({codes(r)})')


def test_every_mistake():
    def break_bones(bones):
        by = {b['name']: b for b in bones}
        by['spine_02']['name'] = 'Spine2'
        by['head']['parent'] = 'pelvis'
        by['hand_l']['tail'] = [0.70, 0, 1.6]

    f = facts(
        scale=0.01,
        fps=24,
        objects=[
            obj('PR_rot_LOD0', rotation=(1.5708, 0, 0)),
            obj('crate'),
            obj('PR_copy.001'),
            obj('PR_heavy_LOD0', m=mesh(9000, uv=0)),
            obj('PR_sunk_LOD0', m=mesh(bbox=((-0.5, -0.5, -0.5), (0.5, 0.5, 0.5)))),
            obj('TL_floor_LOD0', m=mesh(bbox=((0, 0, 0), (2, 2, 0.2)))),
            obj('WP_blade_LODU'),
            obj('PR_gap_LOD0'),
            obj('PR_gap_LOD2', m=mesh(500)),
            obj('PR_only_LOD1', m=mesh(500)),
            obj('PR_dupe'),
            obj('PR_dupe_LOD0'),
            obj('SK_Bad-Name', 'EMPTY'),
            obj('Camera', 'CAMERA'),
            obj('CH_bad_LOD0', m=mesh(1000, armature='Armature', groups=['nope'], max_influences=6, unnormalised=3)),
            obj('CH_loose_LOD0'),
        ],
        armatures=[humanoid('Armature', break_bones)],
        materials=[{'name': 'M_a', 'images': ['big', 'odd'], 'custom': {'toon': {'outline': 'x', 'glow': 1, 'rim_color': [1]}}}],
        images=[{'name': 'big', 'w': 4096, 'h': 4096}, {'name': 'odd', 'w': 6, 'h': 6}],
        actions=[{'name': 'Run', 'frame_range': [1, 10], 'channels': [
            channel('root', 'location'), channel('calf_l', 'scale'), channel('hand_l', 'location'),
        ]}],
    )
    r = conv.check_facts(f)
    expected = {
        'UNIT_SCALE', 'CLIP_FPS', 'TRANSFORM_NOT_APPLIED', 'NAME_UNKNOWN', 'NAME_DUPLICATE_SUFFIX',
        'TRIS_OVER_BUDGET', 'NO_UV', 'ORIGIN', 'ORIGIN_TILE', 'LOD_LEVEL_INVALID', 'LOD_GAP',
        'LOD_MISSING_BASE', 'LOD_DUPLICATE', 'SOCKET_NAME', 'SOCKET_UNPARENTED', 'OBJECT_IGNORED',
        'HERO_NOT_SKINNED', 'VERTEX_GROUP_NO_BONE', 'INFLUENCES_OVER', 'WEIGHTS_NOT_NORMALISED',
        'RIG_NAME', 'SKELETON_UNKNOWN_BONE', 'SKELETON_MISSING_BONE', 'SKELETON_WRONG_PARENT',
        'BONE_DIRECTION', 'TEXTURE_OVER_MAX', 'TEXTURE_NOT_POW2', 'TEXTURE_NOT_DIV4',
        'TEXTURE_BELOW_FULL', 'TOON_PROPERTY', 'TOON_UNKNOWN_KEY', 'ACTION_NAME',
        'BONE_SCALE_KEYS', 'ROOT_MOTION', 'BONE_LOCATION_KEYS', 'ACTIONS_IN_ASSET',
    }
    got = codes(r)
    check(not r['ok'], 'a broken scene fails')
    check(expected <= got, f'every mistake is reported; missing {sorted(expected - got)}')
    check(set(got) <= set(conv.ISSUES), 'every reported code is declared')
    check(all(i['severity'] == conv.ISSUES[i['code']] for i in r['issues']), 'severities match ISSUES')
    check(not conv.schema_errors(r, SCHEMA), 'broken report matches the schema')

    clips = facts(objects=[obj('RIG_ie_humanoid', 'ARMATURE'), obj('PR_x')], armatures=[humanoid()],
                  actions=[{'name': 'a.b', 'frame_range': [1, 2], 'channels': [channel(None, 'location')]}])
    r = conv.check_facts(clips, 'clips')
    check({'CLIPS_HAVE_MESH', 'OBJECT_ACTION_IN_CLIPS'} <= codes(r), f'clip library rules ({codes(r)})')


def test_tables():
    for cls, spec in conv.CLASSES.items():
        levels = [lv for lv in spec['lods'] if lv != 'LODU']
        budgets = [spec['lods'][lv] for lv in levels]
        check(levels[0] == 'LOD0' and budgets == sorted(budgets, reverse=True), f'{cls} LOD chain shrinks')
        check(conv.is_pow2(spec['tex_max']) and spec['tex_full'] <= spec['tex_max'], f'{cls} texture sizes')
    names = [b[0] for b in conv.HUMANOID_BONES]
    check(len(names) == len(set(names)), 'humanoid bone names are unique')
    check(all(p is None or p in names[:i] for i, (_n, p, *_r) in enumerate(conv.HUMANOID_BONES)),
          'every humanoid parent comes before its child')
    check(sum(b[4] for b in conv.HUMANOID_BONES) <= conv.MAX_DEFORM_BONES, 'humanoid deform bones <= 64')
    check(conv.parse_name('PR_well_walls_LOD1') == {'class': 'prop', 'id': 'PR_well_walls', 'suffix': 'LOD1'},
          'names with underscores parse')
    check(conv.lod_targets('hero', 20000) == {'LOD1': 10000, 'LOD2': 5000, 'LOD3': 2500}, 'hero LOD targets')
    check(conv.lod_targets('prop', 1200)['LOD1'] == 600, 'LOD targets follow the class proportions')


def test_presets_in_sync():
    for name, settings in conv.PRESETS.items():
        with open(os.path.join(HERE, 'presets', name), encoding='utf-8') as fh:
            check(fh.read() == conv.operator_preset(settings),
                  f'presets/{name} matches the scripts (regenerate: python ie_conventions.py)')
    for settings in conv.PRESETS.values():
        check(not settings['export_draco_mesh_compression_enable'] and not settings['export_meshopt_compression_enable'],
              'no compression in Blender (the launcher compresses)')


def test_glb_scale_strip():
    gltf = {
        'asset': {'version': '2.0'},
        'animations': [{
            'name': 'locomotion.idle',
            'samplers': [{'input': 0, 'output': 1}, {'input': 0, 'output': 2}, {'input': 0, 'output': 3}],
            'channels': [
                {'sampler': 0, 'target': {'node': 0, 'path': 'rotation'}},
                {'sampler': 1, 'target': {'node': 0, 'path': 'scale'}},
                {'sampler': 2, 'target': {'node': 1, 'path': 'translation'}},
            ],
        }],
    }
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 'clip.glb')
        ie_glb.write_glb(path, gltf, b'\x01\x02\x03')
        back, binary = ie_glb.read_glb(path)
        check(back == gltf and binary.startswith(b'\x01\x02\x03'), 'GLB write/read round-trips')
        removed = ie_glb.strip_scale_channels(back)
        anim = back['animations'][0]
        check(removed == 1 and [c['target']['path'] for c in anim['channels']] == ['rotation', 'translation'],
              'scale channels are dropped')
        check([c['sampler'] for c in anim['channels']] == [0, 1] and anim['samplers'][1]['output'] == 3,
              'samplers are re-indexed')


def test_scripts_compile():
    with tempfile.TemporaryDirectory() as tmp:
        for name in sorted(os.listdir(HERE)):
            if not name.endswith('.py'):
                continue
            try:
                py_compile.compile(os.path.join(HERE, name), cfile=os.path.join(tmp, name + 'c'), doraise=True)
                ok = True
            except py_compile.PyCompileError as exc:
                ok = False
                print(exc)
            check(ok, f'{name} compiles')


if __name__ == '__main__':
    for test in (test_clean_prop, test_clean_hero_and_clips, test_viewmodel, test_every_mistake, test_tables,
                 test_presets_in_sync, test_glb_scale_strip, test_scripts_compile):
        print(f'-- {test.__name__}')
        test()
    print(f"\n{'FAILED' if FAILED else 'passed'}: {len(FAILED)} failures")
    sys.exit(1 if FAILED else 0)
