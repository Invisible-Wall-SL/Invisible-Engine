"""The shared IE Humanoid armature, and the clip-library export.

Headless:
    blender -b -P tools/blender/ie_humanoid.py -- --save <file.blend> [--demo-clip] [--export-clips <set>.glb]
    blender -b <library.blend> -P tools/blender/ie_humanoid.py -- --export-clips anim/ie_humanoid/<set>.glb
Blender MCP (execute_blender_code):
    import sys; sys.path.insert(0, r'<repo>/tools/blender'); import ie_humanoid
    rig = ie_humanoid.create_armature()            # RIG_ie_humanoid at the world origin
    ie_humanoid.export_clip_library(r'<dir>/locomotion.glb')

The bone list, parents and rest directions are `HUMANOID_BONES` in ie_conventions.py; the export
settings are `CLIP_EXPORT_SETTINGS`, also committed as presets/ie_clip_library.py for the export
dialog. Every clip is an action named `<set>.<clip>` with a fake user, 30 fps, in place.
"""

from __future__ import annotations

import argparse
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ie_conventions as conv  # noqa: E402
import ie_glb  # noqa: E402
import ie_validate  # noqa: E402

RIG_NAME = f'RIG_{conv.HUMANOID_SKELETON}'


def create_armature(name: str = RIG_NAME, collection=None):
    data = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, data)
    (collection or bpy.context.scene.collection).objects.link(rig)
    rig['ie_skeleton'] = conv.HUMANOID_SKELETON
    data.display_type = 'STICK'
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    bones = {}
    for bname, parent, head, tail, deform, _required in conv.HUMANOID_BONES:
        eb = data.edit_bones.new(bname)
        eb.head, eb.tail, eb.roll = head, tail, 0.0
        eb.use_deform = deform
        if parent:
            eb.parent = bones[parent]
            eb.use_connect = tuple(bones[parent].tail) == tuple(eb.head) and parent != conv.ROOT_BONE
        bones[bname] = eb
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return rig


def new_clip(rig, name: str):
    """An empty clip on the rig: an action with a fake user, so it survives while unassigned."""
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = act
    return act


def add_demo_clip(rig, name: str = 'locomotion.idle', frames: int = 30):
    """A breathing idle, in place: rotations plus a small hips bob; root never keyed; loops."""
    act = new_clip(rig, name)
    pose = rig.pose.bones

    def rot(bone, frame, angle_x):
        pb = pose[bone]
        pb.rotation_quaternion = (math.cos(angle_x / 2), math.sin(angle_x / 2), 0.0, 0.0)
        pb.keyframe_insert('rotation_quaternion', frame=frame)

    for frame, phase in ((1, 0.0), (1 + frames // 2, 1.0), (1 + frames, 0.0)):
        rot('spine_01', frame, math.radians(3 * phase))
        rot('head', frame, math.radians(-4 * phase))
        rot('upperarm_l', frame, math.radians(2 * phase))
        rot('upperarm_r', frame, math.radians(2 * phase))
        pose['pelvis'].location = (0.0, 0.0, -0.01 * phase)
        pose['pelvis'].keyframe_insert('location', frame=frame)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 1 + frames
    return act


def export_clip_library(path: str, rig=None) -> dict:
    """Write every action on the rig as `anim/<skeleton>/<set>.glb`: armature only, sampled at the
    scene fps, scale channels stripped (clips never key bone scale)."""
    rig = rig or bpy.data.objects[RIG_NAME]
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, **conv.CLIP_EXPORT_SETTINGS)
    gltf, binary = ie_glb.read_glb(path)
    stripped = ie_glb.strip_scale_channels(gltf)
    ie_glb.write_glb(path, gltf, binary)
    return {
        'glb': path,
        'bytes': os.path.getsize(path),
        'scaleChannelsStripped': stripped,
        'contents': ie_glb.describe(path),
    }


def main() -> int:
    ap = argparse.ArgumentParser(prog='ie_humanoid.py')
    ap.add_argument('--save', help='create the armature in an empty scene and save the .blend here')
    ap.add_argument('--demo-clip', action='store_true', help='add the locomotion.idle test clip')
    ap.add_argument('--export-clips', help='export the clip library GLB here')
    args = ap.parse_args(ie_validate.script_args(sys.argv))
    if args.save:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.render.fps = conv.CLIP_FPS
        rig = create_armature()
        if args.demo_clip:
            add_demo_clip(rig)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save))
    report = ie_validate.validate('clips')
    print(ie_validate.summary(report))
    if args.export_clips:
        if not report['ok']:
            print('  not exported: fix the errors first')
            return 1
        result = export_clip_library(args.export_clips)
        names = [a['name'] for a in result['contents']['animations']]
        print(f"  exported {result['glb']} ({result['bytes']} bytes): {names}")
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
