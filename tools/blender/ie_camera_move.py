"""Authored 3D camera moves: a camera object animated per move, exported as `anim/cameras/<arena>.glb`.

Headless:
    blender -b <arena_cameras.blend> -P tools/blender/ie_camera_move.py -- --out anim/cameras/<arena>.glb
    blender -b --factory-startup -P tools/blender/ie_camera_move.py -- --sample --out <dir>/sample.glb [--save <file.blend>]
Blender MCP (execute_blender_code):
    import sys; sys.path.insert(0, r'<repo>/tools/blender'); import ie_camera_move
    ie_camera_move.export_moves(r'<dir>/<arena>.glb')

A file holds ONE camera, `CAM_<arena>`, and one NLA track per move, named after the move (`intro`,
`roundEnd`), its strip the move's action (fake user): the glTF exporter writes a camera's
animations from its NLA tracks only (`ACTIONS` mode exports none for a camera in Blender 5.2). The game plays a move as a temporary top-priority rig
(`engine-3d` `cameraPlayMove`), sampling the camera node's world pose; its FOV is the camera's
and stays constant per move (glTF FOV animation needs KHR_animation_pointer). Animate location
and rotation only — a scale key or a lens key is refused. Coordinates: the game's metres with
y up; Blender's Z-up scene is turned by the exporter (`export_yup`), so a Blender point
(x, y, z) is the game's (x, z, -y).

`--sample` builds the fixture for the placeholder arena (`engine-3d` `sampleArena3d`): `intro`,
a 4 s sweep from high over the far corner down to behind the spawn, ending near the follow rig's
place, and `roundEnd`, a 3 s orbit round the origin for a target-relative move.
"""

from __future__ import annotations

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ie_conventions as conv  # noqa: E402
import ie_glb  # noqa: E402
import ie_validate  # noqa: E402

FPS = conv.CLIP_FPS


def to_blender(x: float, y: float, z: float) -> Vector:
    """A point in the game's space (y up) → Blender's (z up)."""
    return Vector((x, -z, y))


def fcurves(act) -> list:
    """An action's F-curves: on its layered channelbags (Blender 4.4+), else the legacy list."""
    curves = []
    for layer in getattr(act, 'layers', []):
        for strip in layer.strips:
            for bag in getattr(strip, 'channelbags', []):
                curves.extend(bag.fcurves)
    return curves or list(getattr(act, 'fcurves', []) or [])


def new_camera(name: str, fov_deg: float):
    data = bpy.data.cameras.new(name)
    data.lens_unit = 'FOV'
    data.sensor_fit = 'VERTICAL'
    data.angle_y = math.radians(fov_deg)
    cam = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(cam)
    cam.rotation_mode = 'QUATERNION'
    return cam


def key_move(cam, name: str, frames: int, path) -> object:
    """One action: `path(t)` (t 0..1) gives (eye, look-at) in game space; keyed every frame."""
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    cam.animation_data_create()
    cam.animation_data.action = act
    for f in range(frames + 1):
        eye, look = path(f / frames)
        e = to_blender(*eye)
        cam.location = e
        cam.rotation_quaternion = (to_blender(*look) - e).to_track_quat('-Z', 'Y')
        cam.keyframe_insert('location', frame=1 + f)
        cam.keyframe_insert('rotation_quaternion', frame=1 + f)
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    # The exporter writes a camera's moves from its NLA tracks, one animation per track.
    cam.animation_data.action = None
    track = cam.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, act)
    return act


def smooth(t: float) -> float:
    return t * t * (3 - 2 * t)


def build_sample() -> object:
    """The placeholder arena's moves (`sampleArena3d`: spawn (-3, 0, 12), a 32 m floor)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    cam = new_camera('CAM_sample', 45)
    pivot = (-3.0, 1.0, 12.0)
    # Where the default follow rig sits for the spawn: pitch 38°, distance 14 behind on +z.
    end = (-3.0, 1.0 + 14 * math.sin(math.radians(38)), 12.0 + 14 * math.cos(math.radians(38)))

    def intro(t: float):
        k = smooth(t)
        # From high over the far (−z) corner, round the west side, down to behind the spawn.
        angle = math.radians(-135 + 225 * k)
        radius = 30 - 13 * k
        eye = (
            math.sin(angle) * radius * (1 - k) + end[0] * k,
            24 - (24 - end[1]) * k,
            math.cos(angle) * radius * (1 - k) + end[2] * k,
        )
        look = (pivot[0] * k, pivot[1] * k, pivot[2] * k)
        return eye, look

    def round_end(t: float):
        angle = math.radians(360 * t)
        return (math.sin(angle) * 6, 3.5, math.cos(angle) * 6), (0.0, 1.0, 0.0)

    key_move(cam, 'intro', 4 * FPS, intro)
    key_move(cam, 'roundEnd', 3 * FPS, round_end)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 1 + 4 * FPS
    return cam


def check_moves(cam) -> list[str]:
    """What the game would refuse: not one camera, a move with scale or lens keys."""
    problems = []
    cams = [o for o in bpy.context.scene.objects if o.type == 'CAMERA']
    if len(cams) != 1:
        problems.append(f'one camera per moves file (found {len(cams)})')
    tracks = list(cam.animation_data.nla_tracks) if cam.animation_data else []
    if not tracks:
        problems.append('no move: one NLA track per move on the camera')
    for track in tracks:
        if len(track.strips) != 1:
            problems.append(f'{track.name}: one strip (the move) per track')
            continue
        act = track.strips[0].action
        paths = {fc.data_path for fc in fcurves(act)}
        for bad in ('scale', 'lens', 'angle', 'angle_y'):
            if bad in paths:
                problems.append(f'{act.name}: keys {bad} (location and rotation only)')
    return problems


def export_moves(path: str, cam=None) -> dict:
    cam = cam or next(o for o in bpy.context.scene.objects if o.type == 'CAMERA')
    problems = check_moves(cam)
    if problems:
        raise SystemExit('ie_camera_move: ' + '; '.join(problems))
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    cam.select_set(True)
    bpy.context.view_layer.objects.active = cam
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, **conv.CAMERA_EXPORT_SETTINGS)
    gltf, binary = ie_glb.read_glb(path)
    stripped = ie_glb.strip_scale_channels(gltf)
    ie_glb.write_glb(path, gltf, binary)
    return {'glb': path, 'bytes': os.path.getsize(path), 'scaleChannelsStripped': stripped, 'contents': ie_glb.describe(path)}


def main() -> int:
    ap = argparse.ArgumentParser(prog='ie_camera_move.py')
    ap.add_argument('--sample', action='store_true', help="build the placeholder arena's moves")
    ap.add_argument('--save', help='save the .blend here')
    ap.add_argument('--out', required=True, help='the moves GLB')
    args = ap.parse_args(ie_validate.script_args(sys.argv))
    cam = build_sample() if args.sample else None
    if args.save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save))
    result = export_moves(args.out, cam)
    anims = [a['name'] for a in result['contents']['animations']]
    print(f'ie_camera_move: wrote {result["glb"]} ({result["bytes"]} B), moves {anims}')
    return 0 if anims else 1


if __name__ == '__main__':
    sys.exit(main())
