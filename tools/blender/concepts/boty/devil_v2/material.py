"""Devil v2: the look. A procedural skin driven by per-vertex masks, then baked to image textures.

`paint_masks` writes two float attributes on `LOD0` (`m_light`: belly, chest and throat;
`m_dark`: the extremities). `procedural()` is the authoring material: matte red skin with tonal
variation and soft subsurface, near-black claws and brows, ivory teeth, yellow eyes. `bake()` renders
it to base colour, roughness and normal maps on the mesh's UVs; `baked()` is the game material that
uses only those three images (nothing else survives glTF).
"""

from __future__ import annotations

import bpy  # isort: skip  (bpy must load before bmesh and mathutils)
import numpy as np

import assemble as A

PROC = 'MAT_devil_procedural'
GAME = 'MAT_devil'
SKIN = (0.50, 0.022, 0.014)
SKIN_LIGHT = (0.66, 0.060, 0.026)
SKIN_DARK = (0.17, 0.006, 0.008)


def _ss(e0, e1, x):
	t = np.clip((x - e0) / (e1 - e0), 0, 1)
	return t * t * (3 - 2 * t)


def paint_masks(ob):
	me = ob.data
	n = len(me.vertices)
	co = np.empty(n * 3, np.float32)
	me.vertices.foreach_get('co', co)
	co = co.reshape(-1, 3)
	no = np.empty(n * 3, np.float32)
	me.vertices.foreach_get('normal', no)
	no = no.reshape(-1, 3)
	x, y, z = np.abs(co[:, 0]), co[:, 1], co[:, 2]
	p = {name: A.attr(ob, 'm_p_' + name) for name in ('trunk', 'head', 'nose', 'ear', 'arm', 'hand', 'finger', 'leg', 'foot', 'toe', 'tail', 'crest', 'wing_bone', 'wing_membrane', 'mouth')}

	front = _ss(0.15, -0.75, no[:, 1])
	light = p['trunk'] * front * _ss(0.345, 0.42, z) * (1 - _ss(0.66, 0.73, z)) * (1 - _ss(0.07, 0.13, x) * 0.7)
	light = np.maximum(light, p['head'] * _ss(0.3, -0.6, no[:, 2]) * _ss(-0.02, -0.12, y) * 0.8)  # under the jaw
	light = np.maximum(light, p['leg'] * _ss(0.0, 0.8, -np.sign(co[:, 0]) * no[:, 0]) * _ss(0.24, 0.33, z) * 0.5)  # inner thighs

	dark = np.zeros(n, np.float32)
	dark = np.maximum(dark, (p['hand'] + p['finger']) * _ss(0.47, 0.62, x))
	dark = np.maximum(dark, (p['foot'] + p['toe']) * _ss(-0.02, -0.19, y) * 0.9)
	dark = np.maximum(dark, p['ear'] * _ss(0.99, 1.12, z) * 0.75)
	dark = np.maximum(dark, p['nose'] * _ss(-0.27, -0.37, y) * 0.55)
	dark = np.maximum(dark, p['crest'] * _ss(0.0, 0.05, np.linalg.norm(co - np.array((0, 0.02, 0.92), np.float32), axis=1) - 0.125) * 0.8)
	tail_tip = np.array((0.33, 0.12, 0.33), np.float32)
	dark = np.maximum(dark, p['tail'] * _ss(0.16, 0.03, np.linalg.norm(co * np.array((np.sign(co[:, 0]).mean() or 1, 1, 1)) - tail_tip, axis=1)) * 0.6)
	dark = np.maximum(dark, p['wing_bone'] * 0.35)
	dark = np.maximum(dark, p['wing_membrane'] * 0.12)
	dark = np.maximum(dark, (p['arm'] * _ss(0.012, 0.0, np.abs(x - 0.276)) + p['leg'] * _ss(0.012, 0.0, np.abs(z - 0.246))) * 0.25)  # elbows, knees
	for name, vals in (('m_light', light), ('m_dark', dark)):
		at = me.attributes.get(name) or me.attributes.new(name, 'FLOAT', 'POINT')
		at.data.foreach_set('value', np.clip(vals, 0, 1).astype(np.float32))


def procedural():
	if PROC in bpy.data.materials:
		return bpy.data.materials[PROC]
	m = bpy.data.materials.new(PROC)
	m.use_nodes = True
	m.use_fake_user = True
	nt = m.node_tree
	p = nt.nodes['Principled BSDF']
	N = nt.nodes.new
	L = nt.links.new

	def attr(name):
		a = N('ShaderNodeAttribute')
		a.attribute_name = name
		return a.outputs['Fac']

	def mix(fac, a, b):
		n = N('ShaderNodeMix')
		n.data_type = 'RGBA'
		for sock, val in ((n.inputs['Factor'], fac), (n.inputs['A'], a), (n.inputs['B'], b)):
			if hasattr(val, 'links'):
				L(val, sock)
			elif isinstance(val, (int, float)):
				sock.default_value = val
			else:
				sock.default_value = (*val, 1)
		return n.outputs['Result']

	def mixf(fac, a, b):
		n = N('ShaderNodeMix')
		n.data_type = 'FLOAT'
		for sock, val in ((n.inputs['Factor'], fac), (n.inputs['A'], a), (n.inputs['B'], b)):
			if hasattr(val, 'links'):
				L(val, sock)
			else:
				sock.default_value = val
		return n.outputs['Result']

	def math(op, a, b=None):
		n = N('ShaderNodeMath')
		n.operation = op
		for sock, val in ((n.inputs[0], a), (n.inputs[1], b)):
			if val is None:
				continue
			if hasattr(val, 'links'):
				L(val, sock)
			else:
				sock.default_value = val
		return n.outputs[0]

	tc = N('ShaderNodeTexCoord')
	# skin: red with a soft mottle, lighter belly, darker extremities
	big = N('ShaderNodeTexNoise')
	big.inputs['Scale'].default_value = 9.0
	big.inputs['Detail'].default_value = 3.0
	big.inputs['Roughness'].default_value = 0.6
	L(tc.outputs['Object'], big.inputs['Vector'])
	fine = N('ShaderNodeTexNoise')
	fine.inputs['Scale'].default_value = 140.0
	fine.inputs['Detail'].default_value = 2.0
	L(tc.outputs['Object'], fine.inputs['Vector'])
	ramp = N('ShaderNodeValToRGB')
	ramp.color_ramp.elements[0].position = 0.28
	ramp.color_ramp.elements[0].color = (SKIN[0] * 0.78, SKIN[1] * 0.6, SKIN[2] * 0.7, 1)
	ramp.color_ramp.elements[1].position = 0.72
	ramp.color_ramp.elements[1].color = (min(SKIN[0] * 1.14, 1), SKIN[1] * 1.5, SKIN[2] * 1.2, 1)
	L(big.outputs['Fac'], ramp.inputs['Fac'])
	speck = N('ShaderNodeMapRange')
	speck.inputs['From Min'].default_value = 0.35
	speck.inputs['From Max'].default_value = 0.65
	speck.inputs['To Min'].default_value = 0.92
	speck.inputs['To Max'].default_value = 1.06
	L(fine.outputs['Fac'], speck.inputs['Value'])
	skin = N('ShaderNodeMixRGB')
	skin.blend_type = 'MULTIPLY'
	skin.inputs['Fac'].default_value = 1.0
	L(ramp.outputs['Color'], skin.inputs['Color1'])
	L(speck.outputs['Result'], skin.inputs['Color2'])
	col = mix(math('MULTIPLY', attr('m_light'), 0.85), skin.outputs['Color'], SKIN_LIGHT)
	col = mix(attr('m_dark'), col, SKIN_DARK)
	col = mix(attr('m_p_wing_membrane'), col, mix(attr('m_dark'), (0.50, 0.022, 0.016), (0.30, 0.010, 0.010)))
	col = mix(attr('m_p_mouth'), col, (0.16, 0.012, 0.018))
	col = mix(attr('m_p_tongue'), col, (0.55, 0.08, 0.09))
	col = mix(attr('m_p_tooth'), col, (0.86, 0.80, 0.60))
	horn = math('ADD', math('ADD', attr('m_p_claw'), attr('m_p_wing_claw')), 0.0)
	col = mix(horn, col, (0.022, 0.016, 0.016))
	hair = math('ADD', attr('m_p_brow'), attr('m_p_tuft'))
	col = mix(hair, col, (0.010, 0.008, 0.008))
	# eyes: a yellow iris with an orange rim and a dark pupil, drawn from the eyeball's own axes
	ex = math('SUBTRACT', math('MULTIPLY', attr('m_eye_x'), 2.0), 1.0)
	ey = math('SUBTRACT', math('MULTIPLY', attr('m_eye_y'), 2.0), 1.0)
	ez = math('SUBTRACT', math('MULTIPLY', attr('m_eye_z'), 2.0), 1.0)
	rad = math('SQRT', math('ADD', math('MULTIPLY', ex, ex), math('MULTIPLY', ey, ey)))

	def step(edge, width, value):
		mr = N('ShaderNodeMapRange')
		mr.interpolation_type = 'SMOOTHSTEP'
		mr.inputs['From Min'].default_value = edge - width
		mr.inputs['From Max'].default_value = edge + width
		L(value, mr.inputs['Value'])
		return mr.outputs['Result']

	iris = mix(step(0.50, 0.10, rad), (1.0, 0.50, 0.02), (1.0, 0.74, 0.12))  # iris, then the yellow of the eye
	iris = mix(step(0.50, 0.030, rad), iris, mix(step(0.56, 0.030, rad), (0.30, 0.07, 0.01), iris))  # the iris's rim
	iris = mix(step(0.19, 0.02, rad), (0.008, 0.004, 0.004), iris)  # pupil
	iris = mix(step(0.93, 0.05, rad), iris, (0.30, 0.04, 0.02))
	eye = mix(step(0.0, 0.05, ez), (0.30, 0.04, 0.02), iris)
	col = mix(attr('m_p_eye'), col, eye)
	L(col, p.inputs['Base Color'])

	# roughness: matte skin, glossy claws, teeth and eyes
	rough = mixf(fine.outputs['Fac'], 0.58, 0.72)
	rough = mixf(horn, rough, 0.28)
	rough = mixf(attr('m_p_tooth'), rough, 0.32)
	rough = mixf(attr('m_p_eye'), rough, 0.10)
	rough = mixf(attr('m_p_tongue'), rough, 0.35)
	rough = mixf(hair, rough, 0.85)
	L(rough, p.inputs['Roughness'])
	# soft subsurface on the skin only
	hard = math('MINIMUM', math('ADD', math('ADD', horn, attr('m_p_tooth')), math('ADD', attr('m_p_eye'), hair)), 1.0)
	L(mixf(hard, 0.22, 0.0), p.inputs['Subsurface Weight'])
	p.inputs['Subsurface Radius'].default_value = (0.09, 0.012, 0.008)
	p.inputs['Subsurface Scale'].default_value = 0.2
	p.inputs['Sheen Weight'].default_value = 0.15
	p.inputs['Sheen Tint'].default_value = (1.0, 0.25, 0.12, 1)
	# bump: pores and a leathery wrinkle, off on the hard parts
	vor = N('ShaderNodeTexVoronoi')
	vor.feature = 'DISTANCE_TO_EDGE'
	vor.inputs['Scale'].default_value = 110.0
	L(tc.outputs['Object'], vor.inputs['Vector'])
	wr = N('ShaderNodeMapRange')
	wr.inputs['From Min'].default_value = 0.0
	wr.inputs['From Max'].default_value = 0.25
	L(vor.outputs['Distance'], wr.inputs['Value'])
	height = math('ADD', math('MULTIPLY', wr.outputs['Result'], 0.5), math('MULTIPLY', fine.outputs['Fac'], 0.5))
	bump = N('ShaderNodeBump')
	bump.inputs['Distance'].default_value = 0.0012
	L(mixf(hard, 0.22, 0.0), bump.inputs['Strength'])
	L(height, bump.inputs['Height'])
	L(bump.outputs['Normal'], p.inputs['Normal'])
	return m


def bake(ob, size=2048, samples=8, margin=8):
	"""Bake the procedural material to three packed images on the mesh's UV map. Returns them."""
	scene = bpy.context.scene
	mat = procedural()
	me = ob.data
	me.materials.clear()
	me.materials.append(mat)
	nt = mat.node_tree
	tex = nt.nodes.new('ShaderNodeTexImage')
	nt.nodes.active = tex
	for o in bpy.context.view_layer.objects:
		o.select_set(False)
	ob.select_set(True)
	bpy.context.view_layer.objects.active = ob
	scene.render.engine = 'CYCLES'
	scene.cycles.samples = samples
	scene.cycles.use_denoising = False
	scene.render.bake.margin = margin
	scene.render.bake.use_clear = True
	images = {}
	for key, kind, cs, flt in (('basecolor', 'DIFFUSE', 'sRGB', {'COLOR'}), ('roughness', 'ROUGHNESS', 'Non-Color', None), ('normal', 'NORMAL', 'Non-Color', None)):
		img = bpy.data.images.new(f'T_devil_{key}', size, size, alpha=False)
		img.colorspace_settings.name = cs
		tex.image = img
		if flt:
			bpy.ops.object.bake(type=kind, pass_filter=flt)
		else:
			bpy.ops.object.bake(type=kind)
		img.pack()
		images[key] = img
	nt.nodes.remove(tex)
	return images


def baked(images):
	"""The game material: Principled BSDF fed by the three baked maps, plus the toon parameters."""
	m = bpy.data.materials.get(GAME) or bpy.data.materials.new(GAME)
	m.use_nodes = True
	nt = m.node_tree
	nt.nodes.clear()
	out = nt.nodes.new('ShaderNodeOutputMaterial')
	p = nt.nodes.new('ShaderNodeBsdfPrincipled')
	nt.links.new(p.outputs['BSDF'], out.inputs['Surface'])
	base = nt.nodes.new('ShaderNodeTexImage')
	base.image = images['basecolor']
	nt.links.new(base.outputs['Color'], p.inputs['Base Color'])
	rough = nt.nodes.new('ShaderNodeTexImage')
	rough.image = images['roughness']
	nt.links.new(rough.outputs['Color'], p.inputs['Roughness'])
	nrm = nt.nodes.new('ShaderNodeTexImage')
	nrm.image = images['normal']
	nm = nt.nodes.new('ShaderNodeNormalMap')
	nt.links.new(nrm.outputs['Color'], nm.inputs['Color'])
	nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
	p.inputs['Subsurface Weight'].default_value = 0.15
	p.inputs['Subsurface Radius'].default_value = (0.09, 0.012, 0.008)
	p.inputs['Subsurface Scale'].default_value = 0.2
	m['toon'] = {'outline': 0.0, 'rim': 0.6, 'rim_color': [1.0, 0.35, 0.2]}
	return m
