"""Export each asset in the open scene as one GLB master, after validating it.

Headless:   blender -b <file.blend> -P tools/blender/ie_export.py -- --out <dir> [--lods] [--asset PR_crate] [--force]
Blender MCP (execute_blender_code):
    import sys; sys.path.insert(0, r'<repo>/tools/blender'); import ie_export
    ie_export.export_all(r'<dir>', generate=True)

Per asset (every `CH_|WP_|PR_|TL_|FX_` id): applies unapplied rotation/scale on unskinned meshes,
optionally generates the missing `_LOD<n>` levels with Decimate (class proportions, marked
`ie_lod_source = "generated"`), and writes `<out>/<id>.glb` holding its LOD meshes, its `SK_`
sockets and (heroes) the armature. Custom properties travel as glTF `extras`; the scene's
`extras.ie` carries the class, the LOD table and the `_COL` boxes (collision is data, not a mesh).
No compression: the launcher optimises and derives the tiers. Clips export with ie_humanoid.py.

The .blend on disk is never saved; the changes live in this Blender session only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ie_conventions as conv  # noqa: E402
import ie_glb  # noqa: E402
import ie_validate  # noqa: E402

DECIMATE_AIMS = (0.98, 0.9, 0.75, 0.5)
WELD_DISTANCE = 1e-4


def _select_only(objs) -> None:
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def asset_objects(asset_id: str) -> dict:
    meshes, collision = [], []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        parsed = conv.parse_name(obj.name)
        if not parsed or parsed['id'] != asset_id:
            continue
        (collision if parsed['suffix'] == 'COL' else meshes).append(obj)
    rigs = {ie_validate._skin_armature(m) for m in meshes} - {None}
    owners = {o.name for o in meshes} | {r.name for r in rigs}
    sockets = [
        o for o in bpy.context.scene.objects
        if o.type == 'EMPTY' and o.name.startswith('SK_') and o.parent and o.parent.name in owners
    ]
    return {'meshes': meshes, 'collision': collision, 'rigs': sorted(rigs, key=lambda r: r.name), 'sockets': sockets}


def apply_transforms(objs) -> list[str]:
    """Apply rotation and scale on unskinned, unparented meshes; returns what changed."""
    fixed = []
    for obj in objs:
        identity = all(abs(v) < conv.TRANSFORM_TOLERANCE for v in obj.rotation_euler) and all(
            abs(v - 1) < conv.TRANSFORM_TOLERANCE for v in obj.scale
        )
        if obj.type != 'MESH' or identity or obj.parent or ie_validate._skin_armature(obj):
            continue
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        _select_only([obj])
        with bpy.context.temp_override(active_object=obj, selected_editable_objects=[obj]):
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        fixed.append(obj.name)
    return fixed


def tri_count(obj) -> int:
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    try:
        return sum(len(p.vertices) - 2 for p in me.polygons)
    finally:
        ev.to_mesh_clear()


def decimated_copy(src, name: str, target_tris: int):
    """A new object holding `src` decimated to about `target_tris` (vertex groups kept)."""
    obj = src.copy()
    obj.data = src.data.copy()
    obj.name = name
    obj.data.name = name
    for coll in src.users_collection:
        coll.objects.link(obj)
    paused = [m for m in obj.modifiers if m.show_viewport]
    for m in paused:
        m.show_viewport = False
    # Collapse keeps open borders, and image-to-3D meshes are split along every UV seam: weld
    # first (UVs are per corner, so they survive). It still stops short of the ratio where seams
    # resist, so re-pass on the result, aiming lower each time, until it lands under the target.
    for aim in DECIMATE_AIMS:
        current = tri_count(obj)
        if current <= target_tris:
            break
        weld = obj.modifiers.new('ie_weld', 'WELD')
        weld.merge_threshold = WELD_DISTANCE
        dec = obj.modifiers.new('ie_decimate', 'DECIMATE')
        dec.decimate_type = 'COLLAPSE'
        dec.ratio = target_tris * aim / current
        dg = bpy.context.evaluated_depsgraph_get()
        dg.update()
        mesh = bpy.data.meshes.new_from_object(
            obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg
        )
        obj.modifiers.remove(dec)
        obj.modifiers.remove(weld)
        old = obj.data
        obj.data = mesh
        mesh.name = name
        bpy.data.meshes.remove(old)
    for m in paused:
        m.show_viewport = True
    obj['ie_lod_source'] = 'generated'
    return obj


def generate_lods(asset_id: str, cls: str) -> list[dict]:
    """Decimate the missing LOD levels from LOD0. Authored levels are never replaced."""
    objs = asset_objects(asset_id)['meshes']
    by_level = {conv.lod_level(conv.parse_name(o.name)['suffix']): o for o in objs}
    base = by_level.get('LOD0')
    if base is None:
        return []
    made = []
    budgets = conv.CLASSES[cls]['lods']
    for level, target in conv.lod_targets(cls, tri_count(base)).items():
        if level in by_level:
            continue
        obj = decimated_copy(base, f'{asset_id}_{level}', target)
        tris = tri_count(obj)
        entry = {'level': level, 'object': obj.name, 'target': target, 'tris': tris}
        if tris > budgets[level]:
            # Collapse refuses edges whose removal flips a face, so thin or folded shapes floor
            # above the budget. Leave the level to the launcher's simplify (plan §5.4).
            mesh = obj.data
            bpy.data.objects.remove(obj)
            bpy.data.meshes.remove(mesh)
            entry['object'] = None
            entry['skipped'] = (
                f'Collapse stalled at {tris} tris (budget {budgets[level]}); the launcher '
                'generates this level at export'
            )
        made.append(entry)
    return made


def _gltf_vec(v) -> list[float]:
    """Blender Z-up to glTF Y-up (the exporter's +Y Up conversion)."""
    return [round(v[0], 5), round(v[2], 5), round(-v[1], 5)]


def _collision_boxes(objs) -> list[dict]:
    boxes = []
    for obj in objs:
        corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        gl = [_gltf_vec(c) for c in corners]
        boxes.append({
            'name': obj.name,
            'min': [min(c[i] for c in gl) for i in range(3)],
            'max': [max(c[i] for c in gl) for i in range(3)],
        })
    return boxes


def export_asset(asset_id: str, out_dir: str, report: dict) -> dict:
    asset = next(a for a in report['assets'] if a['id'] == asset_id)
    objs = asset_objects(asset_id)
    selected = objs['meshes'] + objs['sockets'] + objs['rigs']
    scene = bpy.context.scene
    scene['ie'] = {
        'class': asset['class'],
        'id': asset_id,
        'lods': [
            {
                'level': conv.lod_level(conv.parse_name(o.name)['suffix']),
                'node': o.name,
                'tris': tri_count(o),
                'source': o.get('ie_lod_source', 'authored'),
            }
            for o in sorted(objs['meshes'], key=lambda o: o.name)
        ],
        'collision': _collision_boxes(objs['collision']),
        'validator': {'errors': report['errors'], 'warnings': report['warnings']},
    }
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f'{asset_id}.glb')
    _select_only(selected)
    try:
        bpy.ops.export_scene.gltf(filepath=path, **conv.ASSET_EXPORT_SETTINGS)
    finally:
        del scene['ie']
    return {'id': asset_id, 'glb': path, 'bytes': os.path.getsize(path), 'contents': ie_glb.describe(path)}


def export_all(
    out_dir: str, generate: bool = False, only: str | None = None, force: bool = False
) -> dict:
    started = time.monotonic()
    applied = apply_transforms(list(bpy.context.scene.objects))
    report = ie_validate.validate('asset')
    generated = []
    if generate:
        for asset in report['assets']:
            if only and asset['id'] != only:
                continue
            generated += generate_lods(asset['id'], asset['class'])
        report = ie_validate.validate('asset')
    result = {
        'applied': applied,
        'generated': generated,
        'report': report,
        'exported': [],
        'seconds': 0.0,
    }
    if not report['ok'] and not force:
        result['seconds'] = round(time.monotonic() - started, 2)
        return result
    for asset in report['assets']:
        if only and asset['id'] != only:
            continue
        result['exported'].append(export_asset(asset['id'], out_dir, report))
    result['seconds'] = round(time.monotonic() - started, 2)
    return result


def main() -> int:
    ap = argparse.ArgumentParser(prog='ie_export.py')
    ap.add_argument('--out', required=True, help='directory for <id>.glb and export.json')
    ap.add_argument('--lods', action='store_true', help='generate the missing LOD levels')
    ap.add_argument('--asset', help='export only this asset id')
    ap.add_argument('--force', action='store_true', help='export even when validation fails')
    args = ap.parse_args(ie_validate.script_args(sys.argv))
    result = export_all(args.out, args.lods, args.asset, args.force)
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, 'export.json'), 'w', encoding='utf-8') as fh:
        json.dump(result, fh, indent=2)
    print(ie_validate.summary(result['report']))
    for e in result['exported']:
        print(f"  exported {e['glb']} ({e['bytes']} bytes)")
    if not result['exported']:
        print('  nothing exported (fix the errors, or --force)')
    return 0 if result['exported'] else 1


if __name__ == '__main__':
    sys.exit(main())
