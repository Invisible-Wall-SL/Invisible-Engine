"""Validate the open Blender scene against the 3D asset conventions; writes a JSON report.

Headless:   blender -b <file.blend> -P tools/blender/ie_validate.py -- [--out report.json] [--kind asset|clips]
Blender MCP (execute_blender_code):
    import sys; sys.path.insert(0, r'<repo>/tools/blender'); import ie_validate
    ie_validate.validate()          # -> the report dict

Exit code 1 when the report has errors. The rules live in ie_conventions.py (no bpy) and the page
for artists is docs/conventions/blender-3d-assets.md.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ie_conventions as conv  # noqa: E402

POSE_PATH = re.compile(r'^pose\.bones\["(?P<bone>(?:[^"\\]|\\.)*)"\]\.(?P<prop>\w+)$')
REST_VALUE = {'location': 0.0, 'rotation_euler': 0.0, 'scale': 1.0}


def _plain(value):
    if hasattr(value, 'to_dict'):
        return {k: _plain(v) for k, v in value.to_dict().items()}
    if hasattr(value, 'to_list'):
        return value.to_list()
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    return value


def custom_props(idblock) -> dict:
    return {k: _plain(idblock[k]) for k in idblock.keys() if not k.startswith('_')}


def action_fcurves(action):
    """Every F-curve of an action, slotted (Blender 4.4+, the only kind in 5.x) or legacy."""
    layers = getattr(action, 'layers', None)
    if layers is not None and len(layers):
        for layer in layers:
            for strip in layer.strips:
                for bag in getattr(strip, 'channelbags', []):
                    yield from bag.fcurves
        return
    yield from getattr(action, 'fcurves', [])


def _channel(fc) -> dict:
    m = POSE_PATH.match(fc.data_path)
    bone, prop = (m['bone'], m['prop']) if m else (None, fc.data_path)
    values = [k.co[1] for k in fc.keyframe_points]
    varies = bool(values) and (max(values) - min(values)) > 1e-5
    if prop == 'rotation_quaternion':
        rest = 1.0 if fc.array_index == 0 else 0.0
    else:
        rest = REST_VALUE.get(prop, 0.0)
    at_rest = all(abs(v - rest) <= 1e-4 for v in values)
    return {'bone': bone, 'prop': prop, 'index': fc.array_index, 'varies': varies, 'at_rest': at_rest}


def _material_images(mat) -> list[str]:
    found: set[str] = set()

    def walk(tree, depth=0):
        if tree is None or depth > 8:
            return
        for node in tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image is not None:
                found.add(node.image.name)
            elif node.type == 'GROUP':
                walk(node.node_tree, depth + 1)

    if mat is not None:
        walk(mat.node_tree)
    return sorted(found)


def _skin_armature(obj):
    for mod in obj.modifiers:
        if mod.type == 'ARMATURE' and mod.object is not None:
            return mod.object
    if obj.parent is not None and obj.parent.type == 'ARMATURE' and obj.parent_type == 'OBJECT':
        return obj.parent if obj.vertex_groups else None
    return None


def _mesh_facts(obj, depsgraph) -> dict:
    ev = obj.evaluated_get(depsgraph)
    me = ev.to_mesh()
    try:
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        ngons = sum(1 for p in me.polygons if len(p.vertices) > 4)
        used_verts = {v for p in me.polygons for v in p.vertices}
        edge_in_face = {k for p in me.polygons for k in p.edge_keys}
        loose_verts = sum(1 for v in me.vertices if v.index not in used_verts)
        loose_edges = sum(1 for e in me.edges if tuple(sorted(e.vertices)) not in edge_in_face)
        if len(me.vertices):
            xs, ys, zs = zip(*(v.co[:] for v in me.vertices))
            bbox_min, bbox_max = [min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]
        else:
            bbox_min = bbox_max = [0.0, 0.0, 0.0]
        uv_layers = len(me.uv_layers)
    finally:
        ev.to_mesh_clear()

    facts = {
        'tris': tris,
        'ngons': ngons,
        'loose_verts': loose_verts,
        'loose_edges': loose_edges,
        'uv_layers': uv_layers,
        'bbox_min': bbox_min,
        'bbox_max': bbox_max,
        'materials': [s.material.name for s in obj.material_slots if s.material is not None],
        'vertex_groups': [g.name for g in obj.vertex_groups],
        'armature': None,
        'max_influences': 0,
        'over_influence_verts': 0,
        'unnormalised_verts': 0,
        'unweighted_verts': 0,
    }
    rig = _skin_armature(obj)
    if rig is None:
        return facts
    facts['armature'] = rig.name
    deform = {b.name for b in rig.data.bones if b.use_deform}
    group_bone = {g.index: g.name in deform for g in obj.vertex_groups}
    for v in obj.data.vertices:
        weights = [g.weight for g in v.groups if group_bone.get(g.group) and g.weight > 1e-6]
        n = len(weights)
        facts['max_influences'] = max(facts['max_influences'], n)
        if n > conv.MAX_INFLUENCES:
            facts['over_influence_verts'] += 1
        if n == 0:
            facts['unweighted_verts'] += 1
        elif abs(sum(weights) - 1.0) > conv.WEIGHT_TOLERANCE:
            facts['unnormalised_verts'] += 1
    return facts


def collect_facts() -> dict:
    scene = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()
    objects, materials, images = [], {}, {}
    for obj in scene.objects:
        rot = obj.matrix_basis.to_euler('XYZ')
        o = {
            'name': obj.name,
            'type': obj.type,
            'parent': obj.parent.name if obj.parent else None,
            'parent_bone': obj.parent_bone if obj.parent_type == 'BONE' else None,
            'location': list(obj.location),
            'rotation': [rot.x, rot.y, rot.z],
            'scale': list(obj.scale),
            'custom': custom_props(obj),
        }
        if obj.type == 'MESH':
            o['mesh'] = _mesh_facts(obj, depsgraph)
            for slot in obj.material_slots:
                mat = slot.material
                if mat is None or mat.name in materials:
                    continue
                imgs = _material_images(mat)
                materials[mat.name] = {'name': mat.name, 'images': imgs, 'custom': custom_props(mat)}
                for name in imgs:
                    img = bpy.data.images[name]
                    images[name] = {'name': name, 'w': int(img.size[0]), 'h': int(img.size[1])}
        objects.append(o)

    armatures = []
    for obj in scene.objects:
        if obj.type != 'ARMATURE':
            continue
        armatures.append({
            'object': obj.name,
            'skeleton': obj.get('ie_skeleton'),
            'bones': [
                {
                    'name': b.name,
                    'parent': b.parent.name if b.parent else None,
                    'deform': b.use_deform,
                    'head': list(b.head_local),
                    'tail': list(b.tail_local),
                }
                for b in obj.data.bones
            ],
        })

    actions = []
    for act in bpy.data.actions:
        if act.users == 0:
            continue
        start, end = act.frame_range
        actions.append({
            'name': act.name,
            'frame_range': [float(start), float(end)],
            'channels': [_channel(fc) for fc in action_fcurves(act)],
        })

    units = scene.unit_settings
    return {
        'blender': bpy.app.version_string,
        'file': bpy.data.filepath or None,
        'unit': {'system': units.system, 'scale': units.scale_length},
        'fps': round(scene.render.fps / scene.render.fps_base, 3),
        'objects': objects,
        'armatures': armatures,
        'materials': sorted(materials.values(), key=lambda m: m['name']),
        'images': sorted(images.values(), key=lambda i: i['name']),
        'actions': actions,
    }


def validate(kind: str = 'auto') -> dict:
    return conv.check_facts(collect_facts(), kind)


def summary(report: dict) -> str:
    head = (
        f"ie_validate: {'OK' if report['ok'] else 'FAILED'} — {report['errors']} errors, "
        f"{report['warnings']} warnings ({report['kind']})"
    )
    lines = [head]
    for i in report['issues']:
        where = f" [{i['object']}]" if i['object'] else ''
        lines.append(f"  {i['severity']:7} {i['code']}{where}: {i['message']}")
    return '\n'.join(lines)


def script_args(argv: list[str]) -> list[str]:
    return argv[argv.index('--') + 1:] if '--' in argv else []


def main() -> int:
    ap = argparse.ArgumentParser(prog='ie_validate.py')
    ap.add_argument('--out', help='write the JSON report here')
    ap.add_argument('--kind', choices=['auto', 'asset', 'clips'], default='auto')
    args = ap.parse_args(script_args(sys.argv))
    report = validate(args.kind)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as fh:
            json.dump(report, fh, indent=2)
    print(summary(report))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
