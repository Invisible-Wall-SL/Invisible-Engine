"""The test character: a skinned stand-in hero on IE Humanoid and the clip libraries it plays.

    blender -b --factory-startup -P tools/blender/ie_test_character.py -- --out <dir>

Writes, validated and exported with this folder's own scripts (the conventions in
docs/conventions/blender-3d-assets.md):

  <dir>/testhero.blend, <dir>/export/CH_testhero.glb       the hero: LOD0 only (the launcher
        generates LOD1-3 from its ~12k tris), one material with a 256² skin and toon extras, sockets SK_hand_r and
        SK_head_top, every level bound to RIG_ie_humanoid
  <dir>/testhero_vm.blend, <dir>/export/CH_testhero_vm.glb   the hero's first-person VIEWMODEL:
        its arms only (clavicles to hands) on the same RIG_ie_humanoid, one LOD, SK_eye on the head
        (where the camera sits) and SK_hand_r
  <dir>/testsword.blend, <dir>/export/WP_testsword.glb   a blade to hang on SK_hand_r (origin
        at the grip, pointing along the hand: −y in Blender, the socket's own axes)
  <dir>/anim_<set>.blend, <dir>/export/anim/ie_humanoid/<set>.glb   the clip libraries:
        locomotion  idle, walk_fwd, walk_bwd, run_fwd, strafe_l, strafe_r, jump, fall
        combat      attack
        reactions   hit
        viewmodel   idle, walk_bob, attack, hit, carry (arms in front of the eye)

It is the fixture that proves the characters track (docs/design/3d-games.md Phase 2): pushed
through the launcher's model export, loaded and drawn by engine-3d. The motion is procedural and
deliberately plain (rotations about armature axes, hips bob only), in place, 30 fps: stand-in
art, never shipped in a game.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ie_conventions as conv  # noqa: E402
import ie_export  # noqa: E402
import ie_humanoid  # noqa: E402
import ie_validate  # noqa: E402

HERO = 'CH_testhero'
SKIN = 'testhero_skin'
SKIN_SIDE = 256
FPS = conv.CLIP_FPS

# Skin cells (a 4×4 grid of flat colours): a part of the body is UV-mapped to its cell's centre.
CELLS = {
    'skin': (0.94, 0.76, 0.62),
    'shirt': (0.20, 0.45, 0.80),
    'pants': (0.22, 0.24, 0.30),
    'boots': (0.35, 0.22, 0.14),
    'hair': (0.30, 0.18, 0.10),
    'belt': (0.85, 0.65, 0.20),
}
PART_CELL = {
    'pelvis': 'belt', 'spine_01': 'shirt', 'spine_02': 'shirt', 'spine_03': 'shirt',
    'neck_01': 'skin', 'head': 'skin',
    'clavicle_l': 'shirt', 'upperarm_l': 'shirt', 'lowerarm_l': 'skin', 'hand_l': 'skin',
    'clavicle_r': 'shirt', 'upperarm_r': 'shirt', 'lowerarm_r': 'skin', 'hand_r': 'skin',
    'thigh_l': 'pants', 'calf_l': 'pants', 'foot_l': 'boots', 'ball_l': 'boots',
    'thigh_r': 'pants', 'calf_r': 'pants', 'foot_r': 'boots', 'ball_r': 'boots',
}
# Radius of each part's limb (metres); the torso and head are wider.
THICK = {
    'pelvis': 0.15, 'spine_01': 0.15, 'spine_02': 0.16, 'spine_03': 0.17, 'neck_01': 0.05,
    'head': 0.11, 'clavicle_l': 0.05, 'clavicle_r': 0.05, 'upperarm_l': 0.05, 'upperarm_r': 0.05,
    'lowerarm_l': 0.045, 'lowerarm_r': 0.045, 'hand_l': 0.04, 'hand_r': 0.04, 'thigh_l': 0.075,
    'thigh_r': 0.075, 'calf_l': 0.06, 'calf_r': 0.06, 'foot_l': 0.05, 'foot_r': 0.05,
    'ball_l': 0.045, 'ball_r': 0.045,
}


def cell_uv(name: str) -> tuple[float, float]:
    i = list(CELLS).index(name)
    return ((i % 4) + 0.5) / 4, 1 - ((i // 4) + 0.5) / 4


def fresh() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS


def skin_image():
    img = bpy.data.images.new(SKIN, SKIN_SIDE, SKIN_SIDE)
    px = [0.0] * (SKIN_SIDE * SKIN_SIDE * 4)
    cell = SKIN_SIDE // 4
    for y in range(SKIN_SIDE):
        for x in range(SKIN_SIDE):
            i = (3 - y // cell) * 4 + x // cell
            color = list(CELLS.values())[i] if i < len(CELLS) else (0.5, 0.5, 0.5)
            o = (y * SKIN_SIDE + x) * 4
            px[o:o + 4] = [*color, 1.0]
    img.pixels = px
    img.pack()
    return img


def toon_material():
    mat = bpy.data.materials.new('M_testhero')
    if mat.node_tree is None:
        mat.use_nodes = True
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = skin_image()
    node.interpolation = 'Closest'
    bsdf = mat.node_tree.nodes['Principled BSDF']
    mat.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
    mat['toon'] = {
        'outline': 0.012,
        'outline_color': [0.06, 0.05, 0.08],
        'rim': 0.35,
        'rim_color': [1.0, 0.95, 0.85],
    }
    return mat


ARM_PARTS = {'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
             'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r'}


def body_mesh(rig, name: str = HERO, parts: set[str] | None = None):
    """One closed limb per deform bone (an 8-sided cylinder; a sphere for the head), smooth
    shaded, skinned to the nearest deform bone, UVs on the part's skin cell. `parts` keeps only
    those bones' limbs (the viewmodel's arms)."""
    me = bpy.data.meshes.new(f'{name}_LOD0')
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    bones = {b[0]: b for b in conv.HUMANOID_BONES}
    for _key, (_n, _p, head, tail, deform, _r) in bones.items():
        if not deform or (parts is not None and _n not in parts):
            continue
        h, t = Vector(head), Vector(tail)
        r = THICK[_n]
        before = set(bm.verts)
        if _n == 'head':
            geom = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=r)
            bmesh.ops.translate(bm, verts=geom['verts'], vec=(h + t) / 2)
        else:
            length = max((t - h).length, 0.04)
            geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=r, radius2=r * 0.85,
                                         depth=length)
            rot = (t - h).normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
            bmesh.ops.transform(bm, matrix=rot, verts=geom['verts'])
            bmesh.ops.translate(bm, verts=geom['verts'], vec=(h + t) / 2)
        u, w = cell_uv(PART_CELL[_n])
        for f in {f for v in set(bm.verts) - before for f in v.link_faces}:
            f.smooth = True
            for loop in f.loops:
                loop[uv].uv = (u, w)
    # Dense enough (about 12k tris) that the launcher's generated LOD1-3 really differ.
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(f'{name}_LOD0', me)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(toon_material())
    # Skin: each vertex fully on the nearest deform bone segment (a rigid, valid skin).
    deform = [b for b in rig.data.bones if b.use_deform and (parts is None or b.name in parts)]
    groups = {b.name: obj.vertex_groups.new(name=b.name) for b in deform}
    for v in obj.data.vertices:
        p = v.co

        def dist(b, p=p):
            a, c = b.head_local, b.tail_local
            ab = c - a
            k = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
            return (a + ab * k - p).length

        groups[min(deform, key=dist).name].add([v.index], 1.0, 'REPLACE')
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    obj.parent = rig
    return obj


def sword() -> None:
    """WP_testsword: a grip, a guard and a blade along −Y from the origin (the grip), toon outline."""
    me = bpy.data.meshes.new('WP_testsword_LOD0')
    bm = bmesh.new()
    bm.loops.layers.uv.new('UVMap')
    for size, centre in (((0.03, 0.12, 0.03), (0, 0.0, 0)), ((0.16, 0.025, 0.03), (0, -0.07, 0)),
                         ((0.05, 0.75, 0.012), (0, -0.46, 0))):
        geom = bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True)
        bmesh.ops.scale(bm, vec=size, verts=geom['verts'])
        bmesh.ops.translate(bm, verts=geom['verts'], vec=centre)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new('WP_testsword_LOD0', me)
    bpy.context.scene.collection.objects.link(obj)
    mat = bpy.data.materials.new('M_testsword')
    if mat.node_tree is None:
        mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.75, 0.78, 0.82, 1)
    mat['toon'] = {'outline': 0.006, 'outline_color': [0.05, 0.05, 0.08], 'rim': 0.5}
    obj.data.materials.append(mat)


def socket(name: str, rig, bone: str, offset=(0, 0, 0)):
    emp = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(emp)
    emp.parent = rig
    emp.parent_type = 'BONE'
    emp.parent_bone = bone
    emp.location = offset
    return emp


# ── Clips ─────────────────────────────────────────────────────────────────────────────────────────
# A pose is {bone: [(axis, degrees), …]}: rotations about ARMATURE axes (Blender: +X the character's
# left, −Y its front, +Z up), applied in order, turned into each bone's local rotation. Children
# inherit their parent's, as in any rig. Plus an optional hips offset (metres, armature axes).

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
ARMS_DOWN = {'upperarm_l': [(Y, 72)], 'upperarm_r': [(Y, -72)]}


def local_quat(rig, bone: str, rotations) -> Quaternion:
    rest = rig.data.bones[bone].matrix_local.to_quaternion()
    q = Quaternion()
    for axis, deg in rotations:
        q = Quaternion(axis, math.radians(deg)) @ q
    return rest.inverted() @ q @ rest


def key_pose(rig, frame: int, pose: dict, hips=(0.0, 0.0, 0.0)) -> None:
    for pb in rig.pose.bones:
        if pb.name == conv.ROOT_BONE:
            continue
        pb.rotation_quaternion = local_quat(rig, pb.name, pose.get(pb.name, []))
        pb.keyframe_insert('rotation_quaternion', frame=frame)
    hb = rig.pose.bones[conv.HIPS_BONE]
    rest = rig.data.bones[conv.HIPS_BONE].matrix_local.to_3x3()
    hb.location = rest.inverted() @ Vector(hips)
    hb.keyframe_insert('location', frame=frame)


def merge(*poses: dict) -> dict:
    out: dict = {}
    for p in poses:
        for bone, rots in p.items():
            out[bone] = out.get(bone, []) + list(rots)
    return out


def cycle(rig, name: str, seconds: float, pose_at, samples: int = 8) -> None:
    """A looping clip: `pose_at(phase 0..1) -> (pose, hips)`, keyed `samples` times plus a closing
    key equal to the first."""
    ie_humanoid.new_clip(rig, name)
    frames = round(seconds * FPS)
    for i in range(samples + 1):
        phase = (i % samples) / samples
        pose, hips = pose_at(phase)
        key_pose(rig, 1 + round(i * frames / samples), pose, hips)


def once(rig, name: str, keys: list[tuple[float, dict, tuple]]) -> None:
    """A one-shot clip keyed at the given seconds."""
    ie_humanoid.new_clip(rig, name)
    for at, pose, hips in keys:
        key_pose(rig, 1 + round(at * FPS), pose, hips)


def gait(swing: float, knee: float, arm: float, lean: float, bob: float, back: bool = False):
    sign = -1 if back else 1

    def at(phase: float):
        s = math.sin(phase * 2 * math.pi)
        c = math.cos(phase * 2 * math.pi)
        # Legs swing about X (a negative angle carries a leg forward); the knee bends on the way
        # forward; arms swing opposite the legs.
        pose = merge(ARMS_DOWN, {
            'thigh_l': [(X, -sign * swing * s)], 'thigh_r': [(X, sign * swing * s)],
            'calf_l': [(X, knee * max(0.0, c))], 'calf_r': [(X, knee * max(0.0, -c))],
            'spine_01': [(X, lean)],
            'upperarm_l': [(X, sign * arm * s)], 'upperarm_r': [(X, -sign * arm * s)],
            'lowerarm_l': [(X, -arm * 0.6)], 'lowerarm_r': [(X, -arm * 0.6)],
        })
        return pose, (0.0, 0.0, -bob * abs(c))
    return at


def strafe(direction: int):
    def at(phase: float):
        s = math.sin(phase * 2 * math.pi)
        pose = merge(ARMS_DOWN, {
            'thigh_l': [(Y, -14 * max(0.0, direction * s))], 'thigh_r': [(Y, -14 * max(0.0, -direction * s))],
            'calf_l': [(X, 10 * max(0.0, s))], 'calf_r': [(X, 10 * max(0.0, -s))],
            'spine_01': [(Y, 4 * direction)],
        })
        return pose, (0.04 * direction * s, 0.0, -0.02 * abs(s))
    return at


def build_clips(rig) -> dict[str, list[str]]:
    sets = {'locomotion': [], 'combat': [], 'reactions': [], 'viewmodel': []}

    def idle(phase):
        b = math.sin(phase * 2 * math.pi)
        return merge(ARMS_DOWN, {'spine_01': [(X, 2 * b)], 'head': [(X, -2 * b)],
                                 'upperarm_l': [(Y, -3 * b)], 'upperarm_r': [(Y, 3 * b)]}), (0, 0, -0.008 * b)

    cycle(rig, 'locomotion.idle', 2.0, idle)
    cycle(rig, 'locomotion.walk_fwd', 1.0, gait(25, 35, 18, 3, 0.03))
    cycle(rig, 'locomotion.walk_bwd', 1.0, gait(20, 30, 12, -2, 0.025, back=True))
    cycle(rig, 'locomotion.run_fwd', 0.6, gait(45, 70, 40, 12, 0.06))
    cycle(rig, 'locomotion.strafe_l', 0.8, strafe(1))
    cycle(rig, 'locomotion.strafe_r', 0.8, strafe(-1))
    crouch = merge(ARMS_DOWN, {'thigh_l': [(X, -40)], 'thigh_r': [(X, -40)], 'calf_l': [(X, 70)],
                               'calf_r': [(X, 70)], 'spine_01': [(X, 15)]})
    reach = {'upperarm_l': [(Y, 20)], 'upperarm_r': [(Y, -20)], 'spine_01': [(X, -5)]}
    once(rig, 'locomotion.jump', [(0.0, crouch, (0, 0, -0.18)), (0.15, reach, (0, 0, 0.02)),
                                  (0.4, merge(reach, {'calf_l': [(X, 30)], 'calf_r': [(X, 30)]}), (0, 0, 0))])
    tuck = merge({'upperarm_l': [(Y, 35)], 'upperarm_r': [(Y, -35)]},
                 {'thigh_l': [(X, -25)], 'thigh_r': [(X, -10)], 'calf_l': [(X, 50)], 'calf_r': [(X, 30)]})

    def fall(phase):
        s = math.sin(phase * 2 * math.pi)
        return merge(tuck, {'upperarm_l': [(X, 8 * s)], 'upperarm_r': [(X, -8 * s)]}), (0, 0, 0)

    cycle(rig, 'locomotion.fall', 0.5, fall, samples=4)
    # A right-hand overhead slash: wind up, strike down and across, recover. Upper body only.
    wind = merge(ARMS_DOWN, {'upperarm_r': [(Y, 130), (X, 20)], 'lowerarm_r': [(X, -40)],
                             'spine_02': [(Z, -25)], 'spine_01': [(X, -6)]})
    strike = merge(ARMS_DOWN, {'upperarm_r': [(Y, 40), (X, -70)], 'lowerarm_r': [(X, -10)],
                               'spine_02': [(Z, 30)], 'spine_01': [(X, 14)]})
    once(rig, 'combat.attack', [(0.0, ARMS_DOWN, (0, 0, 0)), (0.18, wind, (0, 0, 0)),
                                (0.32, strike, (0, 0, -0.03)), (0.6, ARMS_DOWN, (0, 0, 0))])
    # A flinch, authored as a pose against the rest pose (played additively over anything).
    jolt = {'spine_01': [(X, -14)], 'spine_02': [(X, -8)], 'head': [(X, -18)],
            'upperarm_l': [(Y, 12)], 'upperarm_r': [(Y, -12)]}
    once(rig, 'reactions.hit', [(0.0, {}, (0, 0, 0)), (0.08, jolt, (0, 0.05, 0)), (0.4, {}, (0, 0, 0))])
    viewmodel_clips(rig)
    for action in bpy.data.actions:
        sets[action.name.split('.')[0]].append(action.name)
    return sets


# The viewmodel's hold: both arms forward and a little down from the shoulders, elbows bent in,
# so the hands sit low in front of the eye (SK_eye), the sword hand to the right.
VM_HOLD = {
    'upperarm_l': [(Z, -80), (X, 25)], 'lowerarm_l': [(Z, -25)],
    'upperarm_r': [(Z, 80), (X, 25)], 'lowerarm_r': [(Z, 25)],
}


def viewmodel_clips(rig) -> None:
    """`viewmodel.<clip>`: arm-chain keys only (the camera, not the body, moves the view)."""
    def idle(phase):
        b = math.sin(phase * 2 * math.pi)
        return merge(VM_HOLD, {'upperarm_l': [(X, 1.5 * b)], 'upperarm_r': [(X, 1.5 * b)]}), (0, 0, 0)

    def bob(phase):
        s2 = math.sin(phase * 4 * math.pi)
        side = math.sin(phase * 2 * math.pi)
        return merge(VM_HOLD, {'upperarm_l': [(X, 4 * s2), (Z, 3 * side)],
                               'upperarm_r': [(X, 4 * s2), (Z, 3 * side)]}), (0, 0, 0)

    cycle(rig, 'viewmodel.idle', 2.0, idle)
    cycle(rig, 'viewmodel.walk_bob', 0.8, bob)
    wind = merge(VM_HOLD, {'upperarm_r': [(Y, -40), (X, -30)], 'lowerarm_r': [(Z, 50)]})
    strike = merge(VM_HOLD, {'upperarm_r': [(Z, -60), (X, 40)], 'lowerarm_r': [(Z, -10)]})
    once(rig, 'viewmodel.attack', [(0.0, VM_HOLD, (0, 0, 0)), (0.15, wind, (0, 0, 0)),
                                   (0.3, strike, (0, 0, 0)), (0.6, VM_HOLD, (0, 0, 0))])
    jolt = merge(VM_HOLD, {'upperarm_l': [(X, -15)], 'upperarm_r': [(X, -15)]})
    once(rig, 'viewmodel.hit', [(0.0, VM_HOLD, (0, 0, 0)), (0.08, jolt, (0, 0, 0)), (0.4, VM_HOLD, (0, 0, 0))])
    carry = {'upperarm_l': [(Z, -75), (X, -10)], 'lowerarm_l': [(Z, -60)],
             'upperarm_r': [(Z, 75), (X, -10)], 'lowerarm_r': [(Z, 60)]}
    cycle(rig, 'viewmodel.carry', 2.0, lambda phase: (carry, (0, 0, 0)), samples=2)


def export_library(rig, out: str, set_name: str) -> dict:
    """Keep only the set's actions on the rig, validate, export `anim/ie_humanoid/<set>.glb`."""
    keep = [a for a in bpy.data.actions if a.name.startswith(f'{set_name}.')]
    for a in list(bpy.data.actions):
        if a not in keep:
            bpy.data.actions.remove(a)
    rig.animation_data.action = keep[0]
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, f'anim_{set_name}.blend'))
    report = ie_validate.validate('clips')
    if not report['ok']:
        raise SystemExit(f'{set_name}: {ie_validate.summary(report)}')
    path = os.path.join(out, 'export', 'anim', conv.HUMANOID_SKELETON, f'{set_name}.glb')
    return ie_humanoid.export_clip_library(path, rig)


def main() -> int:
    ap = argparse.ArgumentParser(prog='ie_test_character.py')
    ap.add_argument('--out', required=True)
    args = ap.parse_args(ie_validate.script_args(sys.argv))
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    result: dict = {}

    fresh()
    rig = ie_humanoid.create_armature()
    body_mesh(rig)
    socket('SK_hand_r', rig, 'hand_r', (0.0, 0.05, 0.0))
    socket('SK_head_top', rig, 'head', (0.0, 0.25, 0.0))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'testhero.blend'))
    report = ie_validate.validate()
    if not report['ok']:
        print(ie_validate.summary(report))
        return 1
    result['hero'] = ie_export.export_all(os.path.join(out, 'export'), generate=False)
    result['heroWarnings'] = report['warnings']

    fresh()
    rig = ie_humanoid.create_armature()
    body_mesh(rig, f'{HERO}_vm', ARM_PARTS)
    socket('SK_hand_r', rig, 'hand_r', (0.0, 0.05, 0.0))
    # The eye: in the head's bone space (y along the bone, z toward the character's front).
    socket('SK_eye', rig, 'head', (0.0, 0.12, 0.09))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'testhero_vm.blend'))
    report = ie_validate.validate()
    if not report['ok']:
        print(ie_validate.summary(report))
        return 1
    result['viewmodel_model'] = ie_export.export_all(os.path.join(out, 'export'), generate=False)

    fresh()
    sword()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'testsword.blend'))
    report = ie_validate.validate()
    if not report['ok']:
        print(ie_validate.summary(report))
        return 1
    result['sword'] = ie_export.export_all(os.path.join(out, 'export'), generate=False)

    clip_sets: dict[str, list[str]] = {}
    for set_name in ('locomotion', 'combat', 'reactions', 'viewmodel'):
        fresh()
        rig = ie_humanoid.create_armature()
        sets = build_clips(rig)
        clip_sets[set_name] = sets[set_name]
        result[set_name] = export_library(rig, out, set_name)
    result['clips'] = clip_sets
    with open(os.path.join(out, 'test_character.json'), 'w', encoding='utf-8') as fh:
        json.dump(result, fh, indent=2, default=str)
    names = {k: [a['name'] for a in v['contents']['animations']] for k, v in result.items()
             if isinstance(v, dict) and 'contents' in v}
    models = result['hero']['exported'] + result['viewmodel_model']['exported'] + result['sword']['exported']
    print(f'models: {[e["glb"] for e in models]}')
    print(f'clips: {names}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
