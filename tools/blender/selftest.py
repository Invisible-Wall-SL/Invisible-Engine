"""Prove the toolchain on generated fixtures in a real Blender (not run by CI: it needs Blender).

    blender -b --factory-startup -P tools/blender/selftest.py -- --out <scratch dir>

Builds and saves four fixtures, then checks:
  good_prop.blend   PR_crate: authored LOD0 + LOD1, an SK_ socket, a _COL box, toon extras →
                    validates clean, exports with generated LOD2/LOD3, GLB holds what it should
  hero.blend        RIG_ie_humanoid + a skinned CH_dummy + a bone socket → clean, exports skinned
  clips.blend       RIG_ie_humanoid + locomotion.idle (in place) → clean, clip library GLB
  broken.blend      one of everything the validator must catch → each expected code is reported,
                    and the export refuses
Exit code 1 on any failed expectation; the reports and GLBs stay in --out.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ie_conventions as conv  # noqa: E402
import ie_export  # noqa: E402
import ie_humanoid  # noqa: E402
import ie_validate  # noqa: E402

FAILURES: list[str] = []


def expect(cond: bool, what: str) -> None:
    print(f"  {'ok  ' if cond else 'FAIL'} {what}")
    if not cond:
        FAILURES.append(what)


def fresh() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = conv.CLIP_FPS


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_object(name: str, build, location=(0, 0, 0), uvs: bool = True):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    if uvs:
        bm.loops.layers.uv.new('UVMap')
    build(bm)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    obj.location = location
    return obj


def sphere(segments: int, rings: int, radius: float = 0.5):
    def build(bm):
        bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius, calc_uvs=True)
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, radius))
    return build


def box(size=(1, 1, 1), lift: float = 0.5):
    def build(bm):
        bmesh.ops.create_cube(bm, size=1.0, calc_uvs=bool(bm.loops.layers.uv))
        bmesh.ops.scale(bm, vec=size, verts=bm.verts)
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, size[2] * lift))
    return build


def material(name: str, image: tuple | None = None, toon: dict | None = None):
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    if image:
        img = bpy.data.images.new(image[0], image[1], image[2])
        node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = img
        bsdf = mat.node_tree.nodes['Principled BSDF']
        mat.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
    if toon is not None:
        mat['toon'] = toon
    return mat


def socket(name: str, parent, bone: str | None = None, location=(0, 0, 0)):
    emp = link(bpy.data.objects.new(name, None))
    emp.parent = parent
    if bone:
        emp.parent_type = 'BONE'
        emp.parent_bone = bone
    emp.location = location
    return emp


def skin_to_nearest_bone(obj, rig) -> None:
    """One full weight per vertex, on the nearest deform bone segment: a clean, valid skin."""
    bones = [b for b in rig.data.bones if b.use_deform]
    groups = {b.name: obj.vertex_groups.new(name=b.name) for b in bones}
    for v in obj.data.vertices:
        p = obj.matrix_world @ v.co

        def dist(b, p=p):
            a, c = b.head_local, b.tail_local
            ab = c - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
            return (a + ab * t - p).length

        groups[min(bones, key=dist).name].add([v.index], 1.0, 'REPLACE')
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    obj.parent = rig


def dummy_body(name: str):
    """A blocky figure: one box per deform bone, so the mesh follows the skeleton."""
    def build(bm):
        for bname, _p, head, tail, deform, _r in conv.HUMANOID_BONES:
            if not deform:
                continue
            h, t = Vector(head), Vector(tail)
            length = (t - h).length
            geom = bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True)
            verts = geom['verts']
            axis = (t - h).normalized()
            thick = 0.12 if bname.startswith(('pelvis', 'spine', 'head')) else 0.07
            rot = axis.to_track_quat('Z', 'Y').to_matrix().to_4x4()
            bmesh.ops.scale(bm, vec=(thick, thick, length), verts=verts)
            bmesh.ops.transform(bm, matrix=rot, verts=verts)
            bmesh.ops.translate(bm, verts=verts, vec=(h + t) / 2)
    return mesh_object(name, build)


def save(out: str, name: str) -> str:
    path = os.path.join(out, name)
    bpy.ops.wm.save_as_mainfile(filepath=path)
    return path


def write(out: str, name: str, data) -> None:
    with open(os.path.join(out, name), 'w', encoding='utf-8') as fh:
        json.dump(data, fh, indent=2)


def codes(report: dict) -> set[str]:
    return {i['code'] for i in report['issues']}


def check_schema(report: dict, what: str) -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, 'report.schema.json'), encoding='utf-8') as fh:
        schema = json.load(fh)
    errors = conv.schema_errors(report, schema)
    expect(not errors, f'{what} report matches report.schema.json {errors[:3]}')


def good_prop(out: str) -> None:
    print('good_prop:')
    fresh()
    pal = material('M_crate', image=('crate_palette', 256, 256), toon={
        'ramp': 'ramp_default', 'outline': 0.02, 'outline_color': [0, 0, 0], 'rim': 0.3,
    })
    lod0 = mesh_object('PR_crate_LOD0', sphere(32, 16))
    lod1 = mesh_object('PR_crate_LOD1', sphere(16, 8))
    for o in (lod0, lod1):
        o.data.materials.append(pal)
    socket('SK_top', lod0, location=(0, 0, 1.0))
    mesh_object('PR_crate_COL', box((1, 1, 1)))
    lod0['ie_note'] = 'fixture'
    save(out, 'good_prop.blend')

    report = ie_validate.validate()
    write(out, 'good_prop.report.json', report)
    check_schema(report, 'good_prop')
    expect(report['ok'] and report['warnings'] == 0, f'good_prop validates clean ({sorted(codes(report))})')
    result = ie_export.export_all(os.path.join(out, 'export'), generate=True)
    write(out, 'good_prop.export.json', result)
    expect(len(result['exported']) == 1, 'good_prop exports one GLB')
    if not result['exported']:
        return
    c = result['exported'][0]['contents']
    names = {n['name']: n for n in c['nodes']}
    expect({'PR_crate_LOD0', 'PR_crate_LOD1', 'PR_crate_LOD2', 'PR_crate_LOD3'} <= set(names),
           f'GLB has LOD0..3 ({sorted(names)})')
    expect('SK_top' in names, 'GLB has the SK_top socket node')
    expect('PR_crate_COL' not in names, 'the _COL mesh is not exported as geometry')
    tris = {k: v.get('tris') for k, v in names.items()}
    expect(tris['PR_crate_LOD2'] <= 1000 and tris['PR_crate_LOD3'] < tris['PR_crate_LOD2'],
           f'generated LODs shrink ({tris})')
    ie = (c['sceneExtras'] or {}).get('ie', {})
    expect(ie.get('class') == 'prop' and len(ie.get('collision', [])) == 1,
           f"scene extras carry class + one collision box ({ie.get('collision')})")
    toon = next((m['extras'] or {}).get('toon') for m in c['materials'] if m['name'] == 'M_crate')
    expect(toon and toon.get('outline') == 0.02, f'material extras carry toon ({toon})')
    expect(names['PR_crate_LOD0'].get('extras', {}).get('ie_note') == 'fixture', 'node extras travel')
    expect(not c['extensionsUsed'] or not any('draco' in e or 'meshopt' in e for e in c['extensionsUsed']),
           f"no compression extension ({c['extensionsUsed']})")


def hero(out: str) -> None:
    print('hero:')
    fresh()
    rig = ie_humanoid.create_armature()
    body = dummy_body('CH_dummy_LOD0')
    skin_to_nearest_bone(body, rig)
    socket('SK_hand_r', rig, bone='hand_r')
    save(out, 'hero.blend')
    report = ie_validate.validate()
    write(out, 'hero.report.json', report)
    check_schema(report, 'hero')
    expect(report['ok'] and report['warnings'] == 0, f'hero validates clean ({sorted(codes(report))})')
    result = ie_export.export_all(os.path.join(out, 'export'), generate=True)
    write(out, 'hero.export.json', result)
    expect(len(result['exported']) == 1, 'hero exports one GLB')
    if result['exported']:
        c = result['exported'][0]['contents']
        names = {n['name']: n for n in c['nodes']}
        lods = [f'CH_dummy_LOD{i}' for i in range(4)]
        expect(all(names.get(n, {}).get('skinned') for n in lods), f'LOD0..3 all skinned ({sorted(names)})')
        expect(len(c['skins']) == 1 and c['skins'][0]['joints'] == len(conv.HUMANOID_BONES),
               f"every LOD binds one skin with every humanoid bone ({c['skins']})")
        expect('SK_hand_r' in names, 'the bone socket is a node')
        expect(not c['animations'], 'an asset GLB carries no clips')


def clips(out: str) -> None:
    print('clips:')
    fresh()
    rig = ie_humanoid.create_armature()
    ie_humanoid.add_demo_clip(rig)
    save(out, 'clips.blend')
    report = ie_validate.validate()
    write(out, 'clips.report.json', report)
    check_schema(report, 'clips')
    expect(report['kind'] == 'clips', 'an armature-only file is a clip library')
    expect(report['ok'] and report['warnings'] == 0, f'clips validate clean ({sorted(codes(report))})')
    result = ie_humanoid.export_clip_library(os.path.join(out, 'export', 'anim', 'ie_humanoid', 'locomotion.glb'))
    write(out, 'clips.export.json', result)
    anims = result['contents']['animations']
    expect([a['name'] for a in anims] == ['locomotion.idle'], f'GLB animation names ({anims})')
    expect(all('scale' not in a['paths'] for a in anims), 'no scale channels')
    expect(not result['contents']['materials'], 'no materials or meshes in a clip library')


def broken(out: str) -> None:
    print('broken:')
    fresh()
    scene = bpy.context.scene
    scene.unit_settings.scale_length = 0.01

    rotated = mesh_object('PR_rotated_LOD0', box())
    scene.render.fps = 24
    rotated.rotation_euler = (math.radians(90), 0, 0)
    mesh_object('crate', box())
    mesh_object('PR_copy.001', box())
    heavy = mesh_object('PR_heavy_LOD0', sphere(128, 64))
    heavy.data.materials.append(material('M_heavy', image=('heavy_base', 4096, 4096)))
    odd = mesh_object('PR_odd_LOD0', box())
    odd.data.materials.append(material('M_odd', image=('odd_base', 1000, 1000)))
    odd.data.materials.append(material('M_odd2', image=('odd_tiny', 6, 6), toon={'outline': 'thick', 'glow': 1}))

    def ngon(bm):
        bmesh.ops.create_circle(bm, cap_ends=True, segments=8, radius=0.5)
    mesh_object('PR_flat_LOD0', ngon, uvs=False)
    mesh_object('PR_sunk_LOD0', box(lift=0.0))
    mesh_object('WP_blade_LODU', box((0.1, 0.1, 1)))
    socket('SK_Bad-Name', None)

    rig = ie_humanoid.create_armature('Armature')
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones
    eb['spine_02'].name = 'Spine2'
    eb['head'].use_connect = False
    eb['head'].parent = eb['pelvis']
    eb['hand_l'].tail = eb['hand_l'].head + Vector((0, 0, 0.1))
    bpy.ops.object.mode_set(mode='OBJECT')

    body = dummy_body('CH_bad_LOD0')
    skin_to_nearest_bone(body, rig)
    names = [b.name for b in rig.data.bones if b.use_deform][:5]
    v0 = body.data.vertices[0].index
    for n in names:
        body.vertex_groups[n].add([v0], 0.5, 'REPLACE')
    for g in body.vertex_groups:
        g.remove([body.data.vertices[1].index])

    act = ie_humanoid.new_clip(rig, 'Run')
    pb = rig.pose.bones
    for frame, x in ((1, 0.0), (10, 0.5)):
        pb['root'].location = (0, x, 0)
        pb['root'].keyframe_insert('location', frame=frame)
        pb['calf_l'].scale = (1, 1 + x, 1)
        pb['calf_l'].keyframe_insert('scale', frame=frame)
    act.use_fake_user = True
    save(out, 'broken.blend')

    report = ie_validate.validate()
    write(out, 'broken.report.json', report)
    check_schema(report, 'broken')
    expected = {
        'UNIT_SCALE', 'TRANSFORM_NOT_APPLIED', 'NAME_UNKNOWN', 'NAME_DUPLICATE_SUFFIX',
        'TRIS_OVER_BUDGET', 'TEXTURE_OVER_MAX', 'TEXTURE_NOT_POW2', 'TEXTURE_NOT_DIV4',
        'TOON_PROPERTY', 'TOON_UNKNOWN_KEY', 'NGONS', 'NO_UV', 'ORIGIN', 'LOD_LEVEL_INVALID',
        'SOCKET_NAME', 'SOCKET_UNPARENTED', 'RIG_NAME', 'SKELETON_UNKNOWN_BONE',
        'SKELETON_MISSING_BONE', 'SKELETON_WRONG_PARENT', 'BONE_DIRECTION', 'INFLUENCES_OVER',
        'WEIGHTS_NOT_NORMALISED', 'UNWEIGHTED_VERTICES', 'ACTION_NAME', 'CLIP_FPS',
        'BONE_SCALE_KEYS', 'ROOT_MOTION', 'ACTIONS_IN_ASSET', 'MATERIALS_OVER',
    }
    got = codes(report)
    expect(not report['ok'], f"broken fails ({report['errors']} errors)")
    expect(expected <= got, f'every expected code reported; missing {sorted(expected - got)}')
    print(ie_validate.summary(report))
    result = ie_export.export_all(os.path.join(out, 'export-broken'))
    expect(not result['exported'], 'the export refuses a failing scene')


def main() -> int:
    ap = argparse.ArgumentParser(prog='selftest.py')
    ap.add_argument('--out', required=True)
    args = ap.parse_args(ie_validate.script_args(sys.argv))
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    for step in (good_prop, hero, clips, broken):
        step(out)
    print(f"\nselftest: {'PASSED' if not FAILURES else 'FAILED'} ({len(FAILURES)} failures) — {out}")
    return 1 if FAILURES else 0


if __name__ == '__main__':
    sys.exit(main())
