"""Shared helpers for the Battle of the Year concept renders (Blender 5.2, Cycles on CPU).

Everything here is procedural: no downloaded models or textures. Run a shot with the `bpy` wheel:

    python shot_key_art.py --out <dir> [--draft]
"""

from __future__ import annotations

import argparse
import math
import os
import sys

import bpy  # isort: skip  (bpy must load before bmesh and mathutils)
import bmesh
import numpy as np
from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------------------------
# scene / render
# ---------------------------------------------------------------------------------------------


def parse_args(default_name: str):
	ap = argparse.ArgumentParser()
	ap.add_argument('--out', default='.')
	ap.add_argument('--draft', action='store_true', help='small and noisy, to check a composition')
	ap.add_argument('--scale', type=float, default=None, help='resolution scale override (0..1)')
	ap.add_argument('--samples', type=int, default=None)
	ap.add_argument('--name', default=default_name)
	argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else sys.argv[1:]
	return ap.parse_args(argv)


def reset_scene():
	bpy.ops.wm.read_factory_settings(use_empty=True)
	import addon_utils

	addon_utils.enable('cycles', default_set=True)
	scene = bpy.context.scene
	scene.render.engine = 'CYCLES'
	scene.cycles.device = 'CPU'
	scene.cycles.use_denoising = True
	scene.cycles.denoiser = 'OPENIMAGEDENOISE'
	scene.cycles.sample_clamp_indirect = 6.0
	scene.cycles.caustics_reflective = False
	scene.cycles.caustics_refractive = False
	scene.cycles.max_bounces = 6
	scene.cycles.diffuse_bounces = 3
	scene.cycles.glossy_bounces = 3
	scene.cycles.transmission_bounces = 4
	scene.cycles.transparent_max_bounces = 16
	scene.render.threads_mode = 'AUTO'
	scene.view_settings.view_transform = 'AgX'
	scene.view_settings.look = 'AgX - Punchy'
	scene.view_settings.exposure = -0.4
	scene.render.film_transparent = False
	world = bpy.data.worlds.new('World')
	world.use_nodes = True
	scene.world = world
	set_world((0.0, 0.0, 0.0), 0.0)
	return scene


def set_world(color, strength=1.0):
	world = bpy.context.scene.world
	bg = world.node_tree.nodes['Background']
	bg.inputs['Color'].default_value = (*color, 1.0)
	bg.inputs['Strength'].default_value = strength


def set_world_gradient(top, bottom, strength=1.0):
	"""A vertical two-colour sky, for soft studio fill."""
	world = bpy.context.scene.world
	nt = world.node_tree
	bg = nt.nodes['Background']
	tc = nt.nodes.new('ShaderNodeTexCoord')
	sep = nt.nodes.new('ShaderNodeSeparateXYZ')
	ramp = nt.nodes.new('ShaderNodeValToRGB')
	mp = nt.nodes.new('ShaderNodeMapRange')
	mp.inputs['From Min'].default_value = -1.0
	mp.inputs['From Max'].default_value = 1.0
	ramp.color_ramp.elements[0].color = (*bottom, 1)
	ramp.color_ramp.elements[1].color = (*top, 1)
	nt.links.new(tc.outputs['Generated'], sep.inputs[0])
	nt.links.new(sep.outputs['Z'], mp.inputs['Value'])
	nt.links.new(mp.outputs['Result'], ramp.inputs['Fac'])
	nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
	bg.inputs['Strength'].default_value = strength


def camera(loc, target, lens=35.0, dof=None, fstop=2.8, name='Cam'):
	cam = bpy.data.cameras.new(name)
	cam.lens = lens
	cam.clip_start = 0.02
	cam.clip_end = 500
	ob = bpy.data.objects.new(name, cam)
	bpy.context.scene.collection.objects.link(ob)
	ob.location = loc
	look_at(ob, target)
	if dof is not None:
		cam.dof.use_dof = True
		cam.dof.focus_distance = dof
		cam.dof.aperture_fstop = fstop
	bpy.context.scene.camera = ob
	return ob


def look_at(ob, target, roll=0.0):
	d = Vector(target) - Vector(ob.location)
	q = d.to_track_quat('-Z', 'Y')
	ob.rotation_euler = (q.to_matrix().to_4x4() @ Matrix.Rotation(roll, 4, 'Z')).to_euler()


def render(args, width, height, samples, exposure=None, fmt='JPEG', transparent=False, post=True):
	"""Render to <out>/<name>.png (raw) and write the graded final next to it."""
	scene = bpy.context.scene
	scale = args.scale if args.scale else (0.34 if args.draft else 1.0)
	scene.render.resolution_x = int(width * scale)
	scene.render.resolution_y = int(height * scale)
	scene.render.resolution_percentage = 100
	scene.cycles.samples = args.samples if args.samples else (14 if args.draft else samples)
	if exposure is not None:
		scene.view_settings.exposure = exposure
	scene.render.film_transparent = transparent
	scene.render.image_settings.file_format = 'PNG'
	scene.render.image_settings.color_mode = 'RGBA' if transparent else 'RGB'
	os.makedirs(args.out, exist_ok=True)
	raw = os.path.join(args.out, args.name + ('_draft' if args.draft else '') + '_raw.png')
	scene.render.filepath = raw
	bpy.ops.render.render(write_still=True)
	if not post:
		return raw
	import post as post_mod

	ext = 'png' if fmt == 'PNG' else 'jpg'
	final = os.path.join(args.out, args.name + ('_draft' if args.draft else '') + '.' + ext)
	post_mod.grade(raw, final, transparent=transparent)
	print('WROTE', final)
	return final


# ---------------------------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------------------------

_MATS: dict[str, bpy.types.Material] = {}


def _new_mat(name):
	m = bpy.data.materials.new(name)
	m.use_nodes = True
	return m, m.node_tree, m.node_tree.nodes['Principled BSDF']


def mat(
	name,
	color,
	rough=0.5,
	metal=0.0,
	emit=None,
	emit_strength=0.0,
	coat=0.0,
	sss=0.0,
	sheen=0.0,
	alpha=1.0,
	transmission=0.0,
	ior=1.45,
):
	"""A cached Principled material. `color` is linear RGB."""
	if name in _MATS:
		return _MATS[name]
	m, nt, p = _new_mat(name)
	p.inputs['Base Color'].default_value = (*color, 1)
	p.inputs['Roughness'].default_value = rough
	p.inputs['Metallic'].default_value = metal
	p.inputs['Coat Weight'].default_value = coat
	p.inputs['Coat Roughness'].default_value = 0.15
	p.inputs['Sheen Weight'].default_value = sheen
	p.inputs['Transmission Weight'].default_value = transmission
	p.inputs['IOR'].default_value = ior
	p.inputs['Alpha'].default_value = alpha
	if sss > 0:
		p.inputs['Subsurface Weight'].default_value = sss
		p.inputs['Subsurface Radius'].default_value = (0.08, 0.02, 0.012)
		p.inputs['Subsurface Scale'].default_value = 0.35
	if emit is not None:
		p.inputs['Emission Color'].default_value = (*emit, 1)
		p.inputs['Emission Strength'].default_value = emit_strength
	_MATS[name] = m
	return m


def emit_mat(name, color, strength=1.0):
	if name in _MATS:
		return _MATS[name]
	m = bpy.data.materials.new(name)
	m.use_nodes = True
	nt = m.node_tree
	nt.nodes.clear()
	out = nt.nodes.new('ShaderNodeOutputMaterial')
	em = nt.nodes.new('ShaderNodeEmission')
	em.inputs['Color'].default_value = (*color, 1)
	em.inputs['Strength'].default_value = strength
	nt.links.new(em.outputs[0], out.inputs['Surface'])
	_MATS[name] = m
	return m


def painted_mat(name, color, color2=None, rough=0.55, scale=6.0, bump=0.15, coat=0.0, metal=0.0, sheen=0.0):
	"""Principled with a soft noise-driven colour variation and bump: the 'painted' feel."""
	if name in _MATS:
		return _MATS[name]
	m, nt, p = _new_mat(name)
	color2 = color2 or tuple(c * 0.72 for c in color)
	tc = nt.nodes.new('ShaderNodeTexCoord')
	noise = nt.nodes.new('ShaderNodeTexNoise')
	noise.inputs['Scale'].default_value = scale
	noise.inputs['Detail'].default_value = 3.0
	noise.inputs['Roughness'].default_value = 0.55
	ramp = nt.nodes.new('ShaderNodeValToRGB')
	ramp.color_ramp.elements[0].position = 0.3
	ramp.color_ramp.elements[0].color = (*color2, 1)
	ramp.color_ramp.elements[1].position = 0.7
	ramp.color_ramp.elements[1].color = (*color, 1)
	nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
	nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
	nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
	bmp = nt.nodes.new('ShaderNodeBump')
	bmp.inputs['Strength'].default_value = bump
	bmp.inputs['Distance'].default_value = 0.02
	nt.links.new(noise.outputs['Fac'], bmp.inputs['Height'])
	nt.links.new(bmp.outputs['Normal'], p.inputs['Normal'])
	p.inputs['Roughness'].default_value = rough
	p.inputs['Metallic'].default_value = metal
	p.inputs['Coat Weight'].default_value = coat
	p.inputs['Sheen Weight'].default_value = sheen
	_MATS[name] = m
	return m


def wood_mat(name, color, color2=None, rough=0.45, scale=1.0, axis='X', coat=0.15):
	"""Stylised wood: stretched noise bands along one object axis."""
	if name in _MATS:
		return _MATS[name]
	m, nt, p = _new_mat(name)
	color2 = color2 or tuple(c * 0.62 for c in color)
	tc = nt.nodes.new('ShaderNodeTexCoord')
	mp = nt.nodes.new('ShaderNodeMapping')
	s = {'X': (0.6, 9.0, 9.0), 'Y': (9.0, 0.6, 9.0), 'Z': (9.0, 9.0, 0.6)}[axis]
	mp.inputs['Scale'].default_value = tuple(v * scale for v in s)
	noise = nt.nodes.new('ShaderNodeTexNoise')
	noise.inputs['Scale'].default_value = 2.2
	noise.inputs['Detail'].default_value = 4.0
	noise.inputs['Distortion'].default_value = 0.6
	ramp = nt.nodes.new('ShaderNodeValToRGB')
	ramp.color_ramp.elements[0].position = 0.32
	ramp.color_ramp.elements[0].color = (*color2, 1)
	ramp.color_ramp.elements[1].position = 0.68
	ramp.color_ramp.elements[1].color = (*color, 1)
	nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
	nt.links.new(mp.outputs['Vector'], noise.inputs['Vector'])
	nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
	nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
	bmp = nt.nodes.new('ShaderNodeBump')
	bmp.inputs['Strength'].default_value = 0.12
	bmp.inputs['Distance'].default_value = 0.01
	nt.links.new(noise.outputs['Fac'], bmp.inputs['Height'])
	nt.links.new(bmp.outputs['Normal'], p.inputs['Normal'])
	p.inputs['Roughness'].default_value = rough
	p.inputs['Coat Weight'].default_value = coat
	_MATS[name] = m
	return m


def checker_emit_mat(name, col_a, col_b, scale, strength=0.5, rough=0.15, grout=0.06, base=(0.01, 0.01, 0.012), hot=None):
	"""An LED tile floor: emissive tiles (two colours mixed by per-tile noise) with dark gaps, glossy."""
	if name in _MATS:
		return _MATS[name]
	m, nt, p = _new_mat(name)
	tc = nt.nodes.new('ShaderNodeTexCoord')
	mp = nt.nodes.new('ShaderNodeMapping')
	mp.inputs['Scale'].default_value = (scale, scale, scale)
	nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
	# per-tile random value
	vor = nt.nodes.new('ShaderNodeTexWhiteNoise')
	vor.noise_dimensions = '2D'
	fl = nt.nodes.new('ShaderNodeVectorMath')
	fl.operation = 'FLOOR'
	nt.links.new(mp.outputs['Vector'], fl.inputs[0])
	nt.links.new(fl.outputs['Vector'], vor.inputs['Vector'])
	# tile mask from fract
	fr = nt.nodes.new('ShaderNodeVectorMath')
	fr.operation = 'FRACTION'
	nt.links.new(mp.outputs['Vector'], fr.inputs[0])
	sep = nt.nodes.new('ShaderNodeSeparateXYZ')
	nt.links.new(fr.outputs['Vector'], sep.inputs[0])

	def edge(sock):
		a = nt.nodes.new('ShaderNodeMath')
		a.operation = 'SUBTRACT'
		a.inputs[1].default_value = 0.5
		nt.links.new(sock, a.inputs[0])
		b = nt.nodes.new('ShaderNodeMath')
		b.operation = 'ABSOLUTE'
		nt.links.new(a.outputs[0], b.inputs[0])
		return b.outputs[0]

	mx = nt.nodes.new('ShaderNodeMath')
	mx.operation = 'MAXIMUM'
	nt.links.new(edge(sep.outputs['X']), mx.inputs[0])
	nt.links.new(edge(sep.outputs['Y']), mx.inputs[1])
	# mask: 1 inside tile, 0 in the gap; plus an inner 'infinity mirror' falloff
	inner = nt.nodes.new('ShaderNodeMapRange')
	inner.inputs['From Min'].default_value = 0.5 - grout
	inner.inputs['From Max'].default_value = 0.5 - grout - 0.02
	nt.links.new(mx.outputs[0], inner.inputs['Value'])
	depth = nt.nodes.new('ShaderNodeMapRange')
	depth.inputs['From Min'].default_value = 0.0
	depth.inputs['From Max'].default_value = 0.5
	depth.inputs['To Min'].default_value = 0.25
	depth.inputs['To Max'].default_value = 1.0
	nt.links.new(mx.outputs[0], depth.inputs['Value'])
	# rings: the infinity-mirror look
	ring = nt.nodes.new('ShaderNodeMath')
	ring.operation = 'MULTIPLY'
	ring.inputs[1].default_value = 8.0
	nt.links.new(mx.outputs[0], ring.inputs[0])
	rf = nt.nodes.new('ShaderNodeMath')
	rf.operation = 'FRACT'
	nt.links.new(ring.outputs[0], rf.inputs[0])
	rr = nt.nodes.new('ShaderNodeMapRange')
	rr.inputs['From Min'].default_value = 0.35
	rr.inputs['From Max'].default_value = 0.65
	rr.inputs['To Min'].default_value = 0.55
	rr.inputs['To Max'].default_value = 1.0
	nt.links.new(rf.outputs[0], rr.inputs['Value'])
	mixc = nt.nodes.new('ShaderNodeMix')
	mixc.data_type = 'RGBA'
	mixc.inputs['A'].default_value = (*col_a, 1)
	mixc.inputs['B'].default_value = (*col_b, 1)
	nt.links.new(vor.outputs['Value'], mixc.inputs['Factor'])
	col_out = mixc.outputs['Result']
	if hot is not None:
		# tiles near the object's origin (the Gate) turn to the hot colour: hot = (radius, colour)
		ln = nt.nodes.new('ShaderNodeVectorMath')
		ln.operation = 'LENGTH'
		nt.links.new(tc.outputs['Object'], ln.inputs[0])
		hr = nt.nodes.new('ShaderNodeMapRange')
		hr.inputs['From Min'].default_value = hot[0] * 0.45
		hr.inputs['From Max'].default_value = hot[0]
		nt.links.new(ln.outputs['Value'], hr.inputs['Value'])
		hmix = nt.nodes.new('ShaderNodeMix')
		hmix.data_type = 'RGBA'
		hmix.inputs['A'].default_value = (*hot[1], 1)
		nt.links.new(hr.outputs['Result'], hmix.inputs['Factor'])
		nt.links.new(mixc.outputs['Result'], hmix.inputs['B'])
		col_out = hmix.outputs['Result']
	m1 = nt.nodes.new('ShaderNodeMath')
	m1.operation = 'MULTIPLY'
	nt.links.new(inner.outputs['Result'], m1.inputs[0])
	nt.links.new(depth.outputs['Result'], m1.inputs[1])
	m2 = nt.nodes.new('ShaderNodeMath')
	m2.operation = 'MULTIPLY'
	nt.links.new(m1.outputs[0], m2.inputs[0])
	nt.links.new(rr.outputs['Result'], m2.inputs[1])
	m3 = nt.nodes.new('ShaderNodeMath')
	m3.operation = 'MULTIPLY'
	m3.inputs[1].default_value = strength
	nt.links.new(m2.outputs[0], m3.inputs[0])
	p.inputs['Base Color'].default_value = (*base, 1)
	p.inputs['Roughness'].default_value = rough
	p.inputs['Coat Weight'].default_value = 0.3
	p.inputs['Coat Roughness'].default_value = 0.08
	nt.links.new(col_out, p.inputs['Emission Color'])
	nt.links.new(m3.outputs[0], p.inputs['Emission Strength'])
	m['led_nodes'] = True
	_MATS[name] = m
	return m


def beam_mat(name, color, strength=0.2):
	"""Transparent + emission that fades along the cone's length (UV v) and toward its rim."""
	if name in _MATS:
		return _MATS[name]
	m = bpy.data.materials.new(name)
	m.use_nodes = True
	nt = m.node_tree
	nt.nodes.clear()
	out = nt.nodes.new('ShaderNodeOutputMaterial')
	tr = nt.nodes.new('ShaderNodeBsdfTransparent')
	em = nt.nodes.new('ShaderNodeEmission')
	em.inputs['Color'].default_value = (*color, 1)
	add = nt.nodes.new('ShaderNodeAddShader')
	tc = nt.nodes.new('ShaderNodeTexCoord')
	sep = nt.nodes.new('ShaderNodeSeparateXYZ')
	nt.links.new(tc.outputs['UV'], sep.inputs[0])
	fade = nt.nodes.new('ShaderNodeMapRange')
	fade.inputs['From Min'].default_value = 0.0
	fade.inputs['From Max'].default_value = 1.0
	fade.inputs['To Min'].default_value = 1.0
	fade.inputs['To Max'].default_value = 0.0
	nt.links.new(sep.outputs['Y'], fade.inputs['Value'])
	pw = nt.nodes.new('ShaderNodeMath')
	pw.operation = 'POWER'
	pw.inputs[1].default_value = 1.6
	nt.links.new(fade.outputs['Result'], pw.inputs[0])
	# facing: brighter where the cone surface is seen edge-on is wrong for a volume; use the opposite
	lw = nt.nodes.new('ShaderNodeLayerWeight')
	lw.inputs['Blend'].default_value = 0.55
	inv = nt.nodes.new('ShaderNodeMath')
	inv.operation = 'SUBTRACT'
	inv.inputs[0].default_value = 1.0
	nt.links.new(lw.outputs['Facing'], inv.inputs[1])
	mul = nt.nodes.new('ShaderNodeMath')
	mul.operation = 'MULTIPLY'
	nt.links.new(pw.outputs[0], mul.inputs[0])
	nt.links.new(inv.outputs[0], mul.inputs[1])
	st = nt.nodes.new('ShaderNodeMath')
	st.operation = 'MULTIPLY'
	st.inputs[1].default_value = strength
	nt.links.new(mul.outputs[0], st.inputs[0])
	nt.links.new(st.outputs[0], em.inputs['Strength'])
	nt.links.new(tr.outputs[0], add.inputs[0])
	nt.links.new(em.outputs[0], add.inputs[1])
	nt.links.new(add.outputs[0], out.inputs['Surface'])
	_MATS[name] = m
	return m


def lava_mat(name='lava', strength=4.0, scale=1.6):
	if name in _MATS:
		return _MATS[name]
	m = bpy.data.materials.new(name)
	m.use_nodes = True
	nt = m.node_tree
	nt.nodes.clear()
	out = nt.nodes.new('ShaderNodeOutputMaterial')
	em = nt.nodes.new('ShaderNodeEmission')
	tc = nt.nodes.new('ShaderNodeTexCoord')
	noise = nt.nodes.new('ShaderNodeTexNoise')
	noise.inputs['Scale'].default_value = scale
	noise.inputs['Detail'].default_value = 5.0
	noise.inputs['Distortion'].default_value = 1.2
	vor = nt.nodes.new('ShaderNodeTexVoronoi')
	vor.feature = 'DISTANCE_TO_EDGE'
	vor.inputs['Scale'].default_value = scale * 1.7
	nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
	wv = nt.nodes.new('ShaderNodeVectorMath')
	wv.operation = 'ADD'
	nt.links.new(tc.outputs['Object'], wv.inputs[0])
	nt.links.new(noise.outputs['Color'], wv.inputs[1])
	nt.links.new(wv.outputs['Vector'], vor.inputs['Vector'])
	mixv = nt.nodes.new('ShaderNodeMath')
	mixv.operation = 'MULTIPLY'
	nt.links.new(noise.outputs['Fac'], mixv.inputs[0])
	crk = nt.nodes.new('ShaderNodeMapRange')
	crk.inputs['From Min'].default_value = 0.0
	crk.inputs['From Max'].default_value = 0.25
	crk.inputs['To Min'].default_value = 2.0
	crk.inputs['To Max'].default_value = 0.6
	nt.links.new(vor.outputs['Distance'], crk.inputs['Value'])
	nt.links.new(crk.outputs['Result'], mixv.inputs[1])
	ramp = nt.nodes.new('ShaderNodeValToRGB')
	els = ramp.color_ramp.elements
	els[0].position = 0.18
	els[0].color = (0.10, 0.0, 0.0, 1)
	els[1].position = 0.95
	els[1].color = (1.0, 0.75, 0.12, 1)
	e = els.new(0.45)
	e.color = (0.75, 0.03, 0.0, 1)
	e = els.new(0.7)
	e.color = (1.0, 0.25, 0.0, 1)
	nt.links.new(mixv.outputs[0], ramp.inputs['Fac'])
	nt.links.new(ramp.outputs['Color'], em.inputs['Color'])
	em.inputs['Strength'].default_value = strength
	nt.links.new(em.outputs[0], out.inputs['Surface'])
	_MATS[name] = m
	return m


def image_from_array(name, arr):
	"""arr: float32 HxWx4 in sRGB display values (top row first). Returns a packed bpy image."""
	h, w = arr.shape[:2]
	img = bpy.data.images.new(name, w, h, alpha=True)
	img.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).astype(np.float32).ravel())
	img.pack()
	return img


def image_mat(name, img, rough=0.4, emit=0.0, coat=0.0, alpha=True, interpolation='Linear', extension='CLIP'):
	"""Principled with an image as base colour (and optional emission), using the UV map."""
	if name in _MATS:
		return _MATS[name]
	m, nt, p = _new_mat(name)
	tex = nt.nodes.new('ShaderNodeTexImage')
	tex.image = img
	tex.interpolation = interpolation
	tex.extension = extension
	nt.links.new(tex.outputs['Color'], p.inputs['Base Color'])
	if alpha:
		nt.links.new(tex.outputs['Alpha'], p.inputs['Alpha'])
	p.inputs['Roughness'].default_value = rough
	p.inputs['Coat Weight'].default_value = coat
	p.inputs['Coat Roughness'].default_value = 0.05
	if emit > 0:
		nt.links.new(tex.outputs['Color'], p.inputs['Emission Color'])
		p.inputs['Emission Strength'].default_value = emit
	_MATS[name] = m
	return m


# ---------------------------------------------------------------------------------------------
# mesh helpers
# ---------------------------------------------------------------------------------------------


def link(ob, parent=None, coll=None):
	(coll or bpy.context.scene.collection).objects.link(ob)
	if parent is not None:
		ob.parent = parent
	return ob


def empty(name='Root', parent=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
	ob = bpy.data.objects.new(name, None)
	link(ob, parent)
	ob.location = loc
	ob.rotation_euler = rot
	ob.scale = (scale, scale, scale) if isinstance(scale, (int, float)) else scale
	return ob


def obj_from_bm(bm, name, material=None, parent=None, smooth=True):
	me = bpy.data.meshes.new(name)
	bm.to_mesh(me)
	bm.free()
	if smooth:
		me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
	ob = bpy.data.objects.new(name, me)
	link(ob, parent)
	if material is not None:
		me.materials.append(material)
	return ob


def set_transform(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
	ob.location = loc
	ob.rotation_euler = rot
	ob.scale = (scale, scale, scale) if isinstance(scale, (int, float)) else scale
	return ob


def bevel(ob, width=0.02, segments=3):
	md = ob.modifiers.new('Bevel', 'BEVEL')
	md.width = width
	md.segments = segments
	md.limit_method = 'ANGLE'
	md.angle_limit = math.radians(40)
	md.harden_normals = False
	return ob


def subsurf(ob, levels=2):
	md = ob.modifiers.new('Subsurf', 'SUBSURF')
	md.levels = levels
	md.render_levels = levels
	return ob


def box(name, size, loc=(0, 0, 0), material=None, parent=None, rot=(0, 0, 0), bevel_w=0.02, segs=3):
	"""A box of full `size`, centred on `loc`, with a rounded bevel."""
	bm = bmesh.new()
	bmesh.ops.create_cube(bm, size=1.0)
	for v in bm.verts:
		v.co.x *= size[0]
		v.co.y *= size[1]
		v.co.z *= size[2]
	ob = obj_from_bm(bm, name, material, parent, smooth=False)
	set_transform(ob, loc, rot)
	if bevel_w > 0:
		bevel(ob, min(bevel_w, min(size) * 0.45), segs)
		ob.data.polygons.foreach_set('use_smooth', [True] * len(ob.data.polygons))
		_auto_smooth(ob)
	return ob


def _auto_smooth(ob, angle=40):
	md = ob.modifiers.new('WN', 'WEIGHTED_NORMAL')
	md.keep_sharp = True
	return ob


def cyl(name, r, h, loc=(0, 0, 0), material=None, parent=None, rot=(0, 0, 0), segs=32, r2=None, bevel_w=0.0, cap=True):
	"""A cylinder / cone along Z, base centre at `loc` (not the middle)."""
	bm = bmesh.new()
	bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=h)
	bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, h / 2))
	ob = obj_from_bm(bm, name, material, parent, smooth=True)
	set_transform(ob, loc, rot)
	if bevel_w > 0:
		bevel(ob, bevel_w, 3)
	_auto_smooth(ob)
	return ob


def sphere(name, r, loc=(0, 0, 0), material=None, parent=None, scale=(1, 1, 1), segs=32, rings=16, rot=(0, 0, 0), smooth=True):
	bm = bmesh.new()
	bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
	ob = obj_from_bm(bm, name, material, parent, smooth=smooth)
	set_transform(ob, loc, rot, scale)
	return ob


def torus(name, R, r, loc=(0, 0, 0), material=None, parent=None, rot=(0, 0, 0), segs=48, rsegs=12, scale=(1, 1, 1)):
	bm = bmesh.new()
	for i in range(segs):
		a = 2 * math.pi * i / segs
		for j in range(rsegs):
			b = 2 * math.pi * j / rsegs
			bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
	bm.verts.ensure_lookup_table()
	for i in range(segs):
		for j in range(rsegs):
			a = i * rsegs + j
			b = ((i + 1) % segs) * rsegs + j
			c = ((i + 1) % segs) * rsegs + (j + 1) % rsegs
			d = i * rsegs + (j + 1) % rsegs
			bm.faces.new((bm.verts[a], bm.verts[b], bm.verts[c], bm.verts[d]))
	ob = obj_from_bm(bm, name, material, parent)
	set_transform(ob, loc, rot, scale)
	return ob


def plane(name, sx, sy, loc=(0, 0, 0), material=None, parent=None, rot=(0, 0, 0), sub=1):
	bm = bmesh.new()
	bmesh.ops.create_grid(bm, x_segments=sub, y_segments=sub, size=0.5)
	for v in bm.verts:
		v.co.x *= sx
		v.co.y *= sy
	uv = bm.loops.layers.uv.new('UVMap')
	for f in bm.faces:
		for lp in f.loops:
			lp[uv].uv = (lp.vert.co.x / sx + 0.5, lp.vert.co.y / sy + 0.5)
	ob = obj_from_bm(bm, name, material, parent, smooth=False)
	set_transform(ob, loc, rot)
	return ob


def _frames(pts):
	"""Parallel-transport frames along a polyline."""
	pts = [Vector(p) for p in pts]
	n = len(pts)
	tans = []
	for i in range(n):
		a = pts[max(i - 1, 0)]
		b = pts[min(i + 1, n - 1)]
		t = b - a
		tans.append(t.normalized() if t.length > 1e-9 else Vector((0, 0, 1)))
	up = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
	nrm = tans[0].cross(up).normalized()
	out = []
	for i in range(n):
		t = tans[i]
		nrm = (nrm - t * nrm.dot(t)).normalized()
		out.append((pts[i], t, nrm, t.cross(nrm).normalized()))
	return out


def tube(name, pts, radii, material=None, parent=None, segs=16, cap=True, flat=1.0, uv=True):
	"""A tube swept along `pts` with a radius per point. `flat` squashes the profile on one axis."""
	if isinstance(radii, (int, float)):
		radii = [radii] * len(pts)
	bm = bmesh.new()
	uvl = bm.loops.layers.uv.new('UVMap') if uv else None
	rings = []
	fr = _frames(pts)
	for (p, _t, nrm, bn), r in zip(fr, radii):
		ring = []
		for j in range(segs):
			a = 2 * math.pi * j / segs
			ring.append(bm.verts.new(p + nrm * (math.cos(a) * r) + bn * (math.sin(a) * r * flat)))
		rings.append(ring)
	n = len(rings)
	for i in range(n - 1):
		for j in range(segs):
			f = bm.faces.new((rings[i][j], rings[i][(j + 1) % segs], rings[i + 1][(j + 1) % segs], rings[i + 1][j]))
			if uvl:
				us = [j / segs, (j + 1) / segs, (j + 1) / segs, j / segs]
				vs = [i / (n - 1), i / (n - 1), (i + 1) / (n - 1), (i + 1) / (n - 1)]
				for lp, u, v in zip(f.loops, us, vs):
					lp[uvl].uv = (u, v)
	if cap:
		bm.faces.new(list(reversed(rings[0])))
		bm.faces.new(rings[-1])
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	return obj_from_bm(bm, name, material, parent)


def bezier(p0, p1, p2, p3, n=16):
	p0, p1, p2, p3 = (Vector(p) for p in (p0, p1, p2, p3))
	out = []
	for i in range(n + 1):
		t = i / n
		u = 1 - t
		out.append(u**3 * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t**3 * p3)
	return out


def catmull(points, n=8):
	"""A smooth open curve through `points`."""
	pts = [Vector(p) for p in points]
	if len(pts) < 3:
		return pts
	ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
	out = []
	for i in range(1, len(ext) - 2):
		p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
		for k in range(n):
			t = k / n
			out.append(
				0.5
				* (
					(2 * p1)
					+ (-p0 + p2) * t
					+ (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
					+ (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
				)
			)
	out.append(pts[-1])
	return out


def open_cone(name, r_top, r_bottom, length, material=None, parent=None, segs=24):
	"""An uncapped cone pointing down -Z from its origin, UV v = 0 at the top and 1 at the far end."""
	bm = bmesh.new()
	uvl = bm.loops.layers.uv.new('UVMap')
	top, bot = [], []
	for j in range(segs):
		a = 2 * math.pi * j / segs
		top.append(bm.verts.new((math.cos(a) * r_top, math.sin(a) * r_top, 0)))
		bot.append(bm.verts.new((math.cos(a) * r_bottom, math.sin(a) * r_bottom, -length)))
	for j in range(segs):
		f = bm.faces.new((top[j], top[(j + 1) % segs], bot[(j + 1) % segs], bot[j]))
		for lp, v in zip(f.loops, (0, 0, 1, 1)):
			lp[uvl].uv = (j / segs, v)
	ob = obj_from_bm(bm, name, material, parent)
	ob.visible_shadow = False
	return ob


def aim(ob, loc, target, axis='-Z'):
	ob.location = loc
	d = Vector(target) - Vector(loc)
	ob.rotation_euler = d.to_track_quat(axis, 'Y').to_euler()
	return ob


def join(objs, name=None):
	"""Join mesh objects (modifiers applied) into the first one."""
	deps = bpy.context.evaluated_depsgraph_get()
	bm = bmesh.new()
	mats = []
	for ob in objs:
		ev = ob.evaluated_get(deps)
		me = bpy.data.meshes.new_from_object(ev)
		me.transform(ob.matrix_world)
		remap = []
		for mt in me.materials:
			if mt not in mats:
				mats.append(mt)
			remap.append(mats.index(mt))
		tmp = bmesh.new()
		tmp.from_mesh(me)
		for f in tmp.faces:
			f.material_index = remap[f.material_index] if remap else 0
		tmp.to_mesh(me)
		tmp.free()
		bm.from_mesh(me)
		bpy.data.meshes.remove(me)
	me = bpy.data.meshes.new(name or objs[0].name)
	bm.to_mesh(me)
	bm.free()
	for mt in mats:
		me.materials.append(mt)
	out = bpy.data.objects.new(name or objs[0].name, me)
	link(out)
	for ob in objs:
		bpy.data.objects.remove(ob, do_unlink=True)
	return out


def point_light(loc, color, power, radius=0.2, parent=None, name='Pt'):
	li = bpy.data.lights.new(name, 'POINT')
	li.color = color
	li.energy = power
	li.shadow_soft_size = radius
	ob = bpy.data.objects.new(name, li)
	link(ob, parent)
	ob.location = loc
	return ob


def spot_light(loc, target, color, power, angle=40, blend=0.5, radius=0.1, parent=None, name='Spot'):
	li = bpy.data.lights.new(name, 'SPOT')
	li.color = color
	li.energy = power
	li.spot_size = math.radians(angle)
	li.spot_blend = blend
	li.shadow_soft_size = radius
	ob = bpy.data.objects.new(name, li)
	link(ob, parent)
	ob.location = loc
	look_at(ob, target)
	return ob


def area_light(loc, target, color, power, size=1.0, size_y=None, parent=None, name='Area'):
	li = bpy.data.lights.new(name, 'AREA')
	li.color = color
	li.energy = power
	li.size = size
	if size_y:
		li.shape = 'RECTANGLE'
		li.size_y = size_y
	ob = bpy.data.objects.new(name, li)
	link(ob, parent)
	ob.location = loc
	look_at(ob, target)
	return ob


def sun_light(direction_from, color, strength, angle=3.0, name='Sun'):
	li = bpy.data.lights.new(name, 'SUN')
	li.color = color
	li.energy = strength
	li.angle = math.radians(angle)
	ob = bpy.data.objects.new(name, li)
	link(ob)
	ob.location = direction_from
	look_at(ob, (0, 0, 0))
	return ob


def light_only(lights, roots):
	"""Light linking: make `lights` shine only on the meshes under `roots` (e.g. the Devils).

	Character key and rim lights would otherwise leave bright reflections on glossy floors.
	"""
	coll = bpy.data.collections.new('receivers')

	def rec(ob):
		if ob.type == 'MESH' and ob.name not in coll.objects:
			coll.objects.link(ob)
		for ch in ob.children:
			rec(ch)

	for root in roots:
		rec(root)
	for li in lights:
		li.light_linking.receiver_collection = coll
	return coll


def rng(seed):
	return np.random.default_rng(seed)
