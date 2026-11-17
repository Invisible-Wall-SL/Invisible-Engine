"""Migrate an FBX (BattleOTtheYear's image-to-3D props and tiles, or an outside artist's file) into
a validated GLB master.

    blender -b --factory-startup -P tools/blender/fbx_to_glb.py -- <in.fbx> --class weapon --name sword --out <dir>
        [--texture-size 1024 | --no-textures] [--lods] [--save <file.blend>]

Steps: import → join the meshes → apply rotation and scale (fixes the +90° X of Y-up sources) →
decimate to the class's LOD0 budget → set the origin by the class rule (a weapon gets bottom
centre: move it to the grip by hand) → rename to `<PREFIX>_<name>_LOD0` → downscale the maps to
the class maximum (or drop them) → validate → export through ie_export. Writes `<out>/<PREFIX>_<name>.glb` and `<PREFIX>_<name>.migrate.json`
(tris, bytes and map sizes before and after, timings, the validation report).

The textures are only resized, not rebaked: an image-to-3D model's maps are a reference for the
retexture, not something to ship.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ie_conventions as conv  # noqa: E402
import ie_export  # noqa: E402
import ie_validate  # noqa: E402


def _images_of(objs) -> list:
    seen = {}
    for obj in objs:
        for slot in obj.material_slots:
            for name in ie_validate._material_images(slot.material):
                seen[name] = bpy.data.images[name]
    return list(seen.values())


def _image_facts(images) -> list[dict]:
    return [{'name': i.name, 'w': int(i.size[0]), 'h': int(i.size[1])} for i in images]


def _apply(obj, location: bool) -> None:
    ie_export._select_only([obj])
    with bpy.context.temp_override(active_object=obj, selected_editable_objects=[obj]):
        bpy.ops.object.transform_apply(location=location, rotation=True, scale=True)


def _set_origin(obj, rule: str) -> list[float]:
    vs = [v.co for v in obj.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    pivot = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mx.z if rule == 'top' else mn.z))
    obj.data.transform(Matrix.Translation(-pivot))
    obj.location = (0, 0, 0)
    return [round(v, 4) for v in pivot]


def migrate(src: str, cls: str, name: str, out_dir: str, texture_size: int | None,
            drop_textures: bool, lods: bool) -> dict:
    timings = {}
    t = time.monotonic()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = conv.CLIP_FPS
    bpy.ops.import_scene.fbx(filepath=src)
    timings['import'] = round(time.monotonic() - t, 2)

    imported = list(bpy.context.scene.objects)
    meshes = [o for o in imported if o.type == 'MESH']
    if not meshes:
        raise SystemExit(f'{src}: no mesh to migrate')
    before = {
        'fbxBytes': os.path.getsize(src),
        'objects': [
            {
                'name': o.name,
                'type': o.type,
                'rotationDeg': [round(v * 57.29578, 2) for v in o.matrix_world.to_euler()],
                'scale': [round(v, 5) for v in o.matrix_world.to_scale()],
            }
            for o in imported
        ],
        'tris': sum(ie_export.tri_count(o) for o in meshes),
        'images': _image_facts(_images_of(meshes)),
        'dimensions': None,
    }

    for o in meshes:
        world = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = world
    for o in imported:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    if len(meshes) > 1:
        ie_export._select_only(meshes)
        with bpy.context.temp_override(active_object=meshes[0], selected_editable_objects=meshes):
            bpy.ops.object.join()
    obj = meshes[0]
    _apply(obj, location=True)
    before['dimensions'] = [round(v, 4) for v in obj.dimensions]

    asset_id = f"{conv.CLASSES[cls]['prefix']}_{name}"
    obj.name = obj.data.name = f'{asset_id}_LOD0'

    t = time.monotonic()
    budget = conv.CLASSES[cls]['lods']['LOD0']
    if before['tris'] > budget:
        reduced = ie_export.decimated_copy(obj, obj.name + '_tmp', budget)
        old = obj.data
        obj.data = reduced.data
        bpy.data.objects.remove(reduced)
        bpy.data.meshes.remove(old)
        obj.data.name = obj.name
    timings['decimate'] = round(time.monotonic() - t, 2)
    pivot = _set_origin(obj, conv.CLASSES[cls]['origin'])

    t = time.monotonic()
    images = _images_of([obj])
    if drop_textures:
        for slot in obj.material_slots:
            tree = slot.material.node_tree if slot.material else None
            for node in list(tree.nodes) if tree else []:
                if node.type == 'TEX_IMAGE':
                    tree.nodes.remove(node)
    else:
        cap = texture_size or conv.CLASSES[cls]['tex_max']
        for img in images:
            w, h = img.size
            if max(w, h) > cap:
                k = cap / max(w, h)
                img.scale(max(4, int(w * k)), max(4, int(h * k)))
    timings['textures'] = round(time.monotonic() - t, 2)

    t = time.monotonic()
    result = ie_export.export_all(out_dir, generate=lods, only=asset_id)
    timings['validateExport'] = round(time.monotonic() - t, 2)
    report = result['report']
    exported = result['exported'][0] if result['exported'] else None
    after = {
        'lods': next((a['lods'] for a in report['assets'] if a['id'] == asset_id), []),
        'dimensions': [round(v, 4) for v in obj.dimensions],
        'originMovedBy': pivot,
        'images': _image_facts(_images_of([obj])),
        'glb': exported['glb'] if exported else None,
        'glbBytes': exported['bytes'] if exported else None,
    }
    return {
        'source': src,
        'class': cls,
        'id': asset_id,
        'before': before,
        'after': after,
        'seconds': timings,
        'generatedLods': result['generated'],
        'validation': {
            'ok': report['ok'],
            'errors': report['errors'],
            'warnings': report['warnings'],
            'issues': report['issues'],
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser(prog='fbx_to_glb.py')
    ap.add_argument('fbx')
    ap.add_argument('--class', dest='cls', required=True, choices=sorted(conv.CLASSES))
    ap.add_argument('--name', required=True, help='lower snake case, e.g. sword → WP_sword')
    ap.add_argument('--out', required=True)
    tex = ap.add_mutually_exclusive_group()
    tex.add_argument('--texture-size', type=int, help='largest map side (default: the class max)')
    tex.add_argument('--no-textures', action='store_true', help='drop the image maps')
    ap.add_argument('--lods', action='store_true', help='also generate the lower LOD levels')
    ap.add_argument('--save', help='save the migrated scene as this .blend')
    args = ap.parse_args(ie_validate.script_args(sys.argv))

    started = time.monotonic()
    summary = migrate(os.path.abspath(args.fbx), args.cls, args.name, os.path.abspath(args.out),
                      args.texture_size, args.no_textures, args.lods)
    summary['seconds']['total'] = round(time.monotonic() - started, 2)
    if args.save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save))
    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, f"{summary['id']}.migrate.json")
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(summary, fh, indent=2)
    b, a = summary['before'], summary['after']
    print(f"fbx_to_glb {summary['id']}: {b['tris']} tris / {b['fbxBytes']} B FBX → "
          f"{[(lv['level'], lv['tris']) for lv in a['lods']]} / {a['glbBytes']} B GLB "
          f"in {summary['seconds']['total']} s; validation "
          f"{'OK' if summary['validation']['ok'] else 'FAILED'} "
          f"({summary['validation']['errors']} errors, {summary['validation']['warnings']} warnings)")
    for g in summary['generatedLods']:
        if g.get('skipped'):
            print(f"  {g['level']} not generated: {g['skipped']}")
    for i in summary['validation']['issues']:
        print(f"  {i['severity']:7} {i['code']} [{i['object']}]: {i['message']}")
    return 0 if summary['validation']['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
