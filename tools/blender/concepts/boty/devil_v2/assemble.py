"""Devil v2: cage → `CH_devil_LOD0`.

The body cage is weighted, subdivided once and joined with the extras (eyes, teeth, claws, brows)
and the wings into one mesh object. Helper masks ride along as vertex groups named `_…` and end up
as float attributes `m_…` for the procedural material and the shape keys; they are removed once the
textures are baked.
"""

from __future__ import annotations

import bpy  # isort: skip  (bpy must load before bmesh and mathutils)
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import cage as CG
import extras as EX
import skin as SK

LOD0 = 'CH_devil_LOD0'


def _groups(ob, weights, masks):
	groups = {}

	def group(name):
		if name not in groups:
			groups[name] = ob.vertex_groups.new(name=name)
		return groups[name]

	for i, w in enumerate(weights):
		for bone, v in w.items():
			group(bone).add([i], v, 'REPLACE')
	for name, m in masks.items():
		g = group(name)
		for i, v in m.items():
			g.add([i], v, 'REPLACE')


def _bake(ob):
	bpy.context.view_layer.update()
	deps = bpy.context.evaluated_depsgraph_get()
	me = bpy.data.meshes.new_from_object(ob.evaluated_get(deps), preserve_all_data_layers=True, depsgraph=deps)
	old = ob.data
	ob.modifiers.clear()
	ob.data = me
	bpy.data.meshes.remove(old)
	return ob


def _tag_object(cage_mesh, name, parts):
	"""An object from a tagged Cage whose vertices carry `w` and `part` (extras, wings)."""
	ob = cage_mesh.to_object(name)
	bpy.context.scene.collection.objects.link(ob)
	weights = [t['w'] for t in cage_mesh.tags]
	masks: dict[str, dict[int, float]] = {f'_p_{p}': {} for p in parts}
	for axis in 'xyz':
		masks[f'_eye_{axis}'] = {}
	for i, t in enumerate(cage_mesh.tags):
		masks['_p_' + t['part']][i] = 1.0
		if t['part'] == 'eye':
			for axis, v in zip('xyz', t['local']):
				masks[f'_eye_{axis}'][i] = v * 0.5 + 0.5
	_groups(ob, weights, masks)
	return ob


def join(objs, name):
	for o in bpy.context.view_layer.objects:
		o.select_set(False)
	for o in objs:
		o.select_set(True)
	bpy.context.view_layer.objects.active = objs[0]
	bpy.ops.object.join()
	ob = bpy.context.view_layer.objects.active
	ob.name = name
	ob.data.name = name
	return ob


def clean_weights(ob, bones, limit=4):
	"""Keep the strongest `limit` bone weights per vertex and normalise them."""
	idx = {g.index: g.name for g in ob.vertex_groups}
	bone_idx = {i for i, n in idx.items() if n in bones}
	groups = {g.name: g for g in ob.vertex_groups}
	worst = 0
	for v in ob.data.vertices:
		ws = sorted(((g.weight, g.group) for g in v.groups if g.group in bone_idx and g.weight > 1e-4), reverse=True)
		worst = max(worst, len(ws))
		keep = ws[:limit]
		total = sum(w for w, _ in keep)
		for g in [g.group for g in v.groups if g.group in bone_idx]:
			groups[idx[g]].remove([v.index])
		if total <= 0:
			raise ValueError(f'vertex {v.index} has no bone weight')
		for w, g in keep:
			groups[idx[g]].add([v.index], w / total, 'REPLACE')
	return worst


def masks_to_attributes(ob):
	"""Vertex groups `_name` → float attributes `m_name`; the groups are removed."""
	me = ob.data
	n = len(me.vertices)
	for g in [g for g in ob.vertex_groups if g.name.startswith('_')]:
		vals = np.zeros(n, np.float32)
		gi = g.index
		for v in me.vertices:
			for e in v.groups:
				if e.group == gi:
					vals[v.index] = e.weight
		at = me.attributes.new('m' + g.name, 'FLOAT', 'POINT')
		at.data.foreach_set('value', vals)
	for g in [g for g in ob.vertex_groups if g.name.startswith('_')]:
		ob.vertex_groups.remove(g)


def attr(ob, name):
	a = ob.data.attributes.get(name)
	out = np.zeros(len(ob.data.vertices), np.float32)
	if a is not None:
		a.data.foreach_get('value', out)
	return out


def build(wings=True, levels=1, on_cage=None):
	"""Returns (object, devil, info). info['wing'] holds the wing joints when the wings are in.
	`on_cage(devil)` runs on the finished cage before it becomes a mesh (the UV seams go on there)."""
	d = CG.Devil().build()
	info_cage = on_cage(d) if on_cage else None
	weights, masks = SK.cage_weights(d)
	body = d.m.to_object('body')
	bpy.context.scene.collection.objects.link(body)
	_groups(body, weights, masks)
	md = body.modifiers.new('Subsurf', 'SUBSURF')
	md.levels = md.render_levels = levels
	md.boundary_smooth = 'PRESERVE_CORNERS'
	md.uv_smooth = 'PRESERVE_BOUNDARIES'
	_bake(body)

	deps = bpy.context.evaluated_depsgraph_get()
	bvh = BVHTree.FromObject(body, deps)

	def snap(p):
		# from the front: brows and tuft are placed by a ray toward +Y, else the nearest point
		hit = bvh.ray_cast(Vector((p.x, -1.0, p.z)), Vector((0, 1, 0)))
		if hit[0] is None:
			hit = bvh.find_nearest(p)
		return hit[0], hit[1]

	ex = EX.build(d, snap)
	objs = [body, _tag_object(ex.m, 'extras', EX.PARTS)]
	info = {'extras_check': ex.m.check(), 'on_cage': info_cage}
	if wings:
		import wings as WG

		wm, joints = WG.build_wing()
		info['wing'] = joints
		ex2 = EX.Extras()
		ex2.m = wm
		ex2.mirror_left()
		objs.append(_tag_object(wm, 'wings', ['wing_bone', 'wing_membrane', 'wing_claw']))
		info['wing_check'] = wm.check()
	ob = join(objs, LOD0)
	masks_to_attributes(ob)
	ob.data.polygons.foreach_set('use_smooth', [True] * len(ob.data.polygons))
	return ob, d, info
