"""The Casino stage: a red-and-gold gaming floor, the Hell Gate torn open in the roulette area.

`build_casino()` builds the room around a Gate at the origin and returns the positions a shot needs.
Everything is procedural; repeated props (slot machines, tables, stools, chandeliers) are built once,
fused into one mesh and instanced.
"""

from __future__ import annotations

import math

import bpy  # isort: skip
import bmesh
from mathutils import Matrix

import common as C
import gate as G

X0, X1, Y0, Y1, H = -15.0, 15.0, -13.0, 13.0, 7.0

CHIP_R, CHIP_H = 0.05, 0.016
SLOT_COLOURS = {
	'red': ((0.55, 0.02, 0.03), (1.0, 0.25, 0.05)),
	'purple': ((0.22, 0.03, 0.42), (0.85, 0.2, 1.0)),
	'blue': ((0.03, 0.12, 0.50), (0.15, 0.55, 1.0)),
	'teal': ((0.02, 0.32, 0.30), (0.1, 1.0, 0.75)),
	'gold': ((0.60, 0.33, 0.04), (1.0, 0.75, 0.15)),
}


# ---------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------


def fuse(parts, name):
	"""Join freshly built parts (modifiers applied) into one mesh object at the world origin."""
	bpy.context.view_layer.update()
	return C.join(parts, name)


def inst(ob, loc, rot_z=0.0, parent=None, scale=1.0):
	"""A linked copy of a fused prop."""
	cp = ob.copy()
	C.link(cp, parent)
	cp.location = loc
	cp.rotation_euler = (0, 0, math.radians(rot_z))
	cp.scale = (scale, scale, scale)
	cp.hide_render = False
	cp.hide_viewport = False
	return cp


def hide(ob):
	"""Keep a master prop out of the picture (its instances still render)."""
	ob.hide_render = True
	ob.hide_viewport = True
	return ob


def cyls(name, items, material, parent=None, segs=12):
	"""Many upright cylinders (x, y, z, r, h) as one mesh."""
	bm = bmesh.new()
	for x, y, z, r, h in items:
		bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=h, matrix=Matrix.Translation((x, y, z + h / 2)))
	return C.obj_from_bm(bm, name, material, parent)


def balls(name, items, material, parent=None, segs=12):
	"""Many spheres (x, y, z, r) as one mesh."""
	bm = bmesh.new()
	for x, y, z, r in items:
		bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2, radius=r, matrix=Matrix.Translation((x, y, z)))
	return C.obj_from_bm(bm, name, material, parent)


# ---------------------------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------------------------


def gold():
	return C.mat('cas_gold', (0.95, 0.58, 0.12), rough=0.3, metal=0.85, coat=0.2)


def gold_paint():
	return C.painted_mat('cas_gold_paint', (0.80, 0.47, 0.08), (0.50, 0.25, 0.03), rough=0.42, scale=7.0, bump=0.06, metal=0.45, coat=0.2)


def wall_red():
	return C.painted_mat('cas_wall', (0.30, 0.012, 0.022), (0.17, 0.004, 0.012), rough=0.75, scale=2.2, bump=0.05, sheen=0.3)


def panel_red():
	return C.painted_mat('cas_panel', (0.46, 0.022, 0.03), (0.30, 0.008, 0.018), rough=0.7, scale=9.0, bump=0.08, sheen=0.4)


def dark_wood():
	return C.wood_mat('cas_wood', (0.20, 0.055, 0.025), (0.09, 0.02, 0.01), rough=0.35, coat=0.4)


def felt():
	return C.painted_mat('cas_felt', (0.015, 0.34, 0.11), (0.008, 0.22, 0.07), rough=0.92, scale=22.0, bump=0.04, sheen=0.5)


def leather():
	return C.painted_mat('cas_leather', (0.38, 0.012, 0.02), (0.22, 0.006, 0.012), rough=0.38, scale=14.0, bump=0.06, coat=0.3)


def marble():
	return C.painted_mat('cas_marble', (0.80, 0.70, 0.56), (0.55, 0.42, 0.30), rough=0.18, scale=1.6, bump=0.02, coat=0.5)


def bulb(strength=2.5):
	return C.emit_mat(f'cas_bulb_{strength}', (1.0, 0.56, 0.20), strength)


def carpet_mat():
	"""A burgundy carpet with a gold diamond lattice and medallions, 2 m repeat."""
	if 'cas_carpet' in C._MATS:
		return C._MATS['cas_carpet']
	m, nt, p = C._new_mat('cas_carpet')
	tc = nt.nodes.new('ShaderNodeTexCoord')
	mp = nt.nodes.new('ShaderNodeMapping')
	mp.inputs['Scale'].default_value = (0.5, 0.5, 0.5)
	nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
	fr = nt.nodes.new('ShaderNodeVectorMath')
	fr.operation = 'FRACTION'
	nt.links.new(mp.outputs['Vector'], fr.inputs[0])
	sub = nt.nodes.new('ShaderNodeVectorMath')
	sub.operation = 'SUBTRACT'
	sub.inputs[1].default_value = (0.5, 0.5, 0.0)
	nt.links.new(fr.outputs['Vector'], sub.inputs[0])
	ab = nt.nodes.new('ShaderNodeVectorMath')
	ab.operation = 'ABSOLUTE'
	nt.links.new(sub.outputs['Vector'], ab.inputs[0])
	sep = nt.nodes.new('ShaderNodeSeparateXYZ')
	nt.links.new(ab.outputs['Vector'], sep.inputs[0])
	add = nt.nodes.new('ShaderNodeMath')
	add.operation = 'ADD'
	nt.links.new(sep.outputs['X'], add.inputs[0])
	nt.links.new(sep.outputs['Y'], add.inputs[1])
	ramp = nt.nodes.new('ShaderNodeValToRGB')
	ramp.color_ramp.interpolation = 'CONSTANT'
	g = (0.62, 0.34, 0.05, 1)
	stops = [
		(0.0, g),
		(0.075, (0.40, 0.008, 0.02, 1)),
		(0.19, g),
		(0.225, (0.20, 0.004, 0.012, 1)),
		(0.47, g),
		(0.525, (0.105, 0.002, 0.008, 1)),
		(0.80, (0.30, 0.006, 0.016, 1)),
		(0.93, g),
	]
	els = ramp.color_ramp.elements
	els[0].position, els[0].color = stops[0]
	els[1].position, els[1].color = stops[1]
	for pos, col in stops[2:]:
		e = els.new(pos)
		e.color = col
	nt.links.new(add.outputs[0], ramp.inputs['Fac'])
	noise = nt.nodes.new('ShaderNodeTexNoise')
	noise.inputs['Scale'].default_value = 1.3
	noise.inputs['Detail'].default_value = 4.0
	nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
	shade = nt.nodes.new('ShaderNodeMapRange')
	shade.inputs['To Min'].default_value = 0.65
	shade.inputs['To Max'].default_value = 1.2
	nt.links.new(noise.outputs['Fac'], shade.inputs['Value'])
	mul = nt.nodes.new('ShaderNodeVectorMath')
	mul.operation = 'SCALE'
	nt.links.new(ramp.outputs['Color'], mul.inputs[0])
	nt.links.new(shade.outputs['Result'], mul.inputs['Scale'])
	nt.links.new(mul.outputs['Vector'], p.inputs['Base Color'])
	fine = nt.nodes.new('ShaderNodeTexNoise')
	fine.inputs['Scale'].default_value = 60.0
	nt.links.new(tc.outputs['Object'], fine.inputs['Vector'])
	bmp = nt.nodes.new('ShaderNodeBump')
	bmp.inputs['Strength'].default_value = 0.25
	bmp.inputs['Distance'].default_value = 0.01
	nt.links.new(fine.outputs['Fac'], bmp.inputs['Height'])
	nt.links.new(bmp.outputs['Normal'], p.inputs['Normal'])
	p.inputs['Roughness'].default_value = 0.9
	p.inputs['Sheen Weight'].default_value = 0.4
	C._MATS['cas_carpet'] = m
	return m


def reel_mat(name, accent, strength=1.3):
	"""A slot screen: 3×3 reel symbols on cream reels, from the UV square."""
	if name in C._MATS:
		return C._MATS[name]
	m = bpy.data.materials.new(name)
	m.use_nodes = True
	nt = m.node_tree
	nt.nodes.clear()
	out = nt.nodes.new('ShaderNodeOutputMaterial')
	em = nt.nodes.new('ShaderNodeEmission')
	tc = nt.nodes.new('ShaderNodeTexCoord')
	mp = nt.nodes.new('ShaderNodeMapping')
	mp.inputs['Scale'].default_value = (3.0, 3.0, 1.0)
	nt.links.new(tc.outputs['UV'], mp.inputs['Vector'])
	fl = nt.nodes.new('ShaderNodeVectorMath')
	fl.operation = 'FLOOR'
	nt.links.new(mp.outputs['Vector'], fl.inputs[0])
	info = nt.nodes.new('ShaderNodeObjectInfo')
	seed = nt.nodes.new('ShaderNodeVectorMath')
	seed.operation = 'ADD'
	nt.links.new(fl.outputs['Vector'], seed.inputs[0])
	comb = nt.nodes.new('ShaderNodeCombineXYZ')
	nt.links.new(info.outputs['Random'], comb.inputs['Z'])
	nt.links.new(comb.outputs['Vector'], seed.inputs[1])
	wn = nt.nodes.new('ShaderNodeTexWhiteNoise')
	wn.noise_dimensions = '3D'
	nt.links.new(seed.outputs['Vector'], wn.inputs['Vector'])
	sym = nt.nodes.new('ShaderNodeValToRGB')
	sym.color_ramp.interpolation = 'CONSTANT'
	cols = [(0.0, (0.9, 0.03, 0.03, 1)), (0.22, (1.0, 0.6, 0.02, 1)), (0.42, (0.05, 0.6, 0.12, 1)), (0.6, (0.5, 0.05, 0.8, 1)), (0.78, (0.05, 0.3, 0.95, 1))]
	els = sym.color_ramp.elements
	els[0].position, els[0].color = cols[0]
	els[1].position, els[1].color = cols[1]
	for pos, col in cols[2:]:
		e = els.new(pos)
		e.color = col
	nt.links.new(wn.outputs['Value'], sym.inputs['Fac'])
	fr = nt.nodes.new('ShaderNodeVectorMath')
	fr.operation = 'FRACTION'
	nt.links.new(mp.outputs['Vector'], fr.inputs[0])
	ctr = nt.nodes.new('ShaderNodeVectorMath')
	ctr.operation = 'SUBTRACT'
	ctr.inputs[1].default_value = (0.5, 0.5, 0.0)
	nt.links.new(fr.outputs['Vector'], ctr.inputs[0])
	ln = nt.nodes.new('ShaderNodeVectorMath')
	ln.operation = 'LENGTH'
	nt.links.new(ctr.outputs['Vector'], ln.inputs[0])
	disc = nt.nodes.new('ShaderNodeMath')
	disc.operation = 'LESS_THAN'
	disc.inputs[1].default_value = 0.33
	nt.links.new(ln.outputs['Value'], disc.inputs[0])
	# dark gaps between the three reels
	sep = nt.nodes.new('ShaderNodeSeparateXYZ')
	nt.links.new(ctr.outputs['Vector'], sep.inputs[0])
	ax = nt.nodes.new('ShaderNodeMath')
	ax.operation = 'ABSOLUTE'
	nt.links.new(sep.outputs['X'], ax.inputs[0])
	gap = nt.nodes.new('ShaderNodeMath')
	gap.operation = 'LESS_THAN'
	gap.inputs[1].default_value = 0.455
	nt.links.new(ax.outputs[0], gap.inputs[0])
	mixc = nt.nodes.new('ShaderNodeMix')
	mixc.data_type = 'RGBA'
	mixc.inputs['A'].default_value = (0.85, 0.78, 0.6, 1)
	nt.links.new(disc.outputs[0], mixc.inputs['Factor'])
	nt.links.new(sym.outputs['Color'], mixc.inputs['B'])
	mix2 = nt.nodes.new('ShaderNodeMix')
	mix2.data_type = 'RGBA'
	mix2.inputs['A'].default_value = (*[c * 0.25 for c in accent], 1)
	nt.links.new(gap.outputs[0], mix2.inputs['Factor'])
	nt.links.new(mixc.outputs['Result'], mix2.inputs['B'])
	nt.links.new(mix2.outputs['Result'], em.inputs['Color'])
	em.inputs['Strength'].default_value = strength
	nt.links.new(em.outputs[0], out.inputs['Surface'])
	C._MATS[name] = m
	return m


def chip_mat():
	"""Chips: one colour per chip up a stack (and per object), white inserts round the edge."""
	if 'cas_chip' in C._MATS:
		return C._MATS['cas_chip']
	m, nt, p = C._new_mat('cas_chip')
	tc = nt.nodes.new('ShaderNodeTexCoord')
	sep = nt.nodes.new('ShaderNodeSeparateXYZ')
	nt.links.new(tc.outputs['Object'], sep.inputs[0])
	lvl = nt.nodes.new('ShaderNodeMath')
	lvl.operation = 'DIVIDE'
	lvl.inputs[1].default_value = CHIP_H
	nt.links.new(sep.outputs['Z'], lvl.inputs[0])
	nudge = nt.nodes.new('ShaderNodeMath')
	nudge.operation = 'SUBTRACT'
	nudge.inputs[1].default_value = 0.02
	nt.links.new(lvl.outputs[0], nudge.inputs[0])
	fl = nt.nodes.new('ShaderNodeMath')
	fl.operation = 'FLOOR'
	nt.links.new(nudge.outputs[0], fl.inputs[0])
	info = nt.nodes.new('ShaderNodeObjectInfo')
	rnd = nt.nodes.new('ShaderNodeMath')
	rnd.operation = 'MULTIPLY'
	rnd.inputs[1].default_value = 97.0
	nt.links.new(info.outputs['Random'], rnd.inputs[0])
	# stacks keep one colour for runs of chips, as a croupier builds them
	run = nt.nodes.new('ShaderNodeMath')
	run.operation = 'DIVIDE'
	run.inputs[1].default_value = 5.0
	nt.links.new(fl.outputs[0], run.inputs[0])
	runf = nt.nodes.new('ShaderNodeMath')
	runf.operation = 'FLOOR'
	nt.links.new(run.outputs[0], runf.inputs[0])
	sm = nt.nodes.new('ShaderNodeMath')
	sm.operation = 'ADD'
	nt.links.new(runf.outputs[0], sm.inputs[0])
	nt.links.new(rnd.outputs[0], sm.inputs[1])
	wn = nt.nodes.new('ShaderNodeTexWhiteNoise')
	wn.noise_dimensions = '1D'
	nt.links.new(sm.outputs[0], wn.inputs['W'])
	ramp = nt.nodes.new('ShaderNodeValToRGB')
	ramp.color_ramp.interpolation = 'CONSTANT'
	cols = [(0.0, (0.75, 0.02, 0.03, 1)), (0.28, (0.04, 0.16, 0.7, 1)), (0.48, (0.03, 0.42, 0.12, 1)), (0.66, (0.03, 0.03, 0.035, 1)), (0.8, (0.9, 0.62, 0.08, 1)), (0.92, (0.55, 0.06, 0.6, 1))]
	els = ramp.color_ramp.elements
	els[0].position, els[0].color = cols[0]
	els[1].position, els[1].color = cols[1]
	for pos, col in cols[2:]:
		e = els.new(pos)
		e.color = col
	nt.links.new(wn.outputs['Value'], ramp.inputs['Fac'])
	# white inserts by angle
	at = nt.nodes.new('ShaderNodeMath')
	at.operation = 'ARCTAN2'
	nt.links.new(sep.outputs['Y'], at.inputs[0])
	nt.links.new(sep.outputs['X'], at.inputs[1])
	am = nt.nodes.new('ShaderNodeMath')
	am.operation = 'MULTIPLY'
	am.inputs[1].default_value = 6 / (2 * math.pi)
	nt.links.new(at.outputs[0], am.inputs[0])
	af = nt.nodes.new('ShaderNodeMath')
	af.operation = 'FRACT'
	nt.links.new(am.outputs[0], af.inputs[0])
	ag = nt.nodes.new('ShaderNodeMath')
	ag.operation = 'GREATER_THAN'
	ag.inputs[1].default_value = 0.62
	nt.links.new(af.outputs[0], ag.inputs[0])
	rad = nt.nodes.new('ShaderNodeVectorMath')
	rad.operation = 'LENGTH'
	flat = nt.nodes.new('ShaderNodeCombineXYZ')
	nt.links.new(sep.outputs['X'], flat.inputs['X'])
	nt.links.new(sep.outputs['Y'], flat.inputs['Y'])
	nt.links.new(flat.outputs['Vector'], rad.inputs[0])
	edge = nt.nodes.new('ShaderNodeMath')
	edge.operation = 'GREATER_THAN'
	edge.inputs[1].default_value = CHIP_R * 0.72
	nt.links.new(rad.outputs['Value'], edge.inputs[0])
	both = nt.nodes.new('ShaderNodeMath')
	both.operation = 'MULTIPLY'
	nt.links.new(ag.outputs[0], both.inputs[0])
	nt.links.new(edge.outputs[0], both.inputs[1])
	mix = nt.nodes.new('ShaderNodeMix')
	mix.data_type = 'RGBA'
	mix.inputs['B'].default_value = (0.92, 0.9, 0.84, 1)
	nt.links.new(both.outputs[0], mix.inputs['Factor'])
	nt.links.new(ramp.outputs['Color'], mix.inputs['A'])
	nt.links.new(mix.outputs['Result'], p.inputs['Base Color'])
	p.inputs['Roughness'].default_value = 0.35
	p.inputs['Coat Weight'].default_value = 0.3
	C._MATS['cas_chip'] = m
	return m


def wheel_mat():
	"""Roulette pockets: red and black wedges by angle, one green."""
	if 'cas_wheel' in C._MATS:
		return C._MATS['cas_wheel']
	m, nt, p = C._new_mat('cas_wheel')
	tc = nt.nodes.new('ShaderNodeTexCoord')
	sep = nt.nodes.new('ShaderNodeSeparateXYZ')
	nt.links.new(tc.outputs['Object'], sep.inputs[0])
	at = nt.nodes.new('ShaderNodeMath')
	at.operation = 'ARCTAN2'
	nt.links.new(sep.outputs['Y'], at.inputs[0])
	nt.links.new(sep.outputs['X'], at.inputs[1])
	am = nt.nodes.new('ShaderNodeMapRange')
	am.inputs['From Min'].default_value = -math.pi
	am.inputs['From Max'].default_value = math.pi
	am.inputs['To Min'].default_value = 0.0
	am.inputs['To Max'].default_value = 12.0
	nt.links.new(at.outputs[0], am.inputs['Value'])
	fr = nt.nodes.new('ShaderNodeMath')
	fr.operation = 'FRACT'
	nt.links.new(am.outputs['Result'], fr.inputs[0])
	ramp = nt.nodes.new('ShaderNodeValToRGB')
	ramp.color_ramp.interpolation = 'CONSTANT'
	els = ramp.color_ramp.elements
	els[0].position, els[0].color = 0.0, (0.02, 0.02, 0.022, 1)
	els[1].position, els[1].color = 0.5, (0.75, 0.02, 0.025, 1)
	nt.links.new(fr.outputs[0], ramp.inputs['Fac'])
	green = nt.nodes.new('ShaderNodeMath')
	green.operation = 'LESS_THAN'
	green.inputs[1].default_value = 0.5
	nt.links.new(am.outputs['Result'], green.inputs[0])
	mix = nt.nodes.new('ShaderNodeMix')
	mix.data_type = 'RGBA'
	mix.inputs['B'].default_value = (0.02, 0.4, 0.1, 1)
	nt.links.new(green.outputs[0], mix.inputs['Factor'])
	nt.links.new(ramp.outputs['Color'], mix.inputs['A'])
	nt.links.new(mix.outputs['Result'], p.inputs['Base Color'])
	p.inputs['Roughness'].default_value = 0.25
	p.inputs['Coat Weight'].default_value = 0.5
	C._MATS['cas_wheel'] = m
	return m


def layout_mat():
	"""The roulette betting layout: a 12×3 grid of red and black boxes with gold lines, by UV."""
	if 'cas_layout' in C._MATS:
		return C._MATS['cas_layout']
	m, nt, p = C._new_mat('cas_layout')
	tc = nt.nodes.new('ShaderNodeTexCoord')
	mp = nt.nodes.new('ShaderNodeMapping')
	mp.inputs['Scale'].default_value = (12.0, 3.0, 1.0)
	nt.links.new(tc.outputs['UV'], mp.inputs['Vector'])
	chk = nt.nodes.new('ShaderNodeTexChecker')
	chk.inputs['Scale'].default_value = 1.0
	chk.inputs['Color1'].default_value = (0.72, 0.02, 0.025, 1)
	chk.inputs['Color2'].default_value = (0.03, 0.03, 0.035, 1)
	nt.links.new(mp.outputs['Vector'], chk.inputs['Vector'])
	fr = nt.nodes.new('ShaderNodeVectorMath')
	fr.operation = 'FRACTION'
	nt.links.new(mp.outputs['Vector'], fr.inputs[0])
	ctr = nt.nodes.new('ShaderNodeVectorMath')
	ctr.operation = 'SUBTRACT'
	ctr.inputs[1].default_value = (0.5, 0.5, 0.0)
	nt.links.new(fr.outputs['Vector'], ctr.inputs[0])
	ab = nt.nodes.new('ShaderNodeVectorMath')
	ab.operation = 'ABSOLUTE'
	nt.links.new(ctr.outputs['Vector'], ab.inputs[0])
	sep = nt.nodes.new('ShaderNodeSeparateXYZ')
	nt.links.new(ab.outputs['Vector'], sep.inputs[0])
	mx = nt.nodes.new('ShaderNodeMath')
	mx.operation = 'MAXIMUM'
	nt.links.new(sep.outputs['X'], mx.inputs[0])
	nt.links.new(sep.outputs['Y'], mx.inputs[1])
	line = nt.nodes.new('ShaderNodeMath')
	line.operation = 'GREATER_THAN'
	line.inputs[1].default_value = 0.44
	nt.links.new(mx.outputs[0], line.inputs[0])
	mix = nt.nodes.new('ShaderNodeMix')
	mix.data_type = 'RGBA'
	mix.inputs['B'].default_value = (0.85, 0.62, 0.15, 1)
	nt.links.new(line.outputs[0], mix.inputs['Factor'])
	nt.links.new(chk.outputs['Color'], mix.inputs['A'])
	nt.links.new(mix.outputs['Result'], p.inputs['Base Color'])
	p.inputs['Roughness'].default_value = 0.85
	C._MATS['cas_layout'] = m
	return m


# ---------------------------------------------------------------------------------------------
# props
# ---------------------------------------------------------------------------------------------


def chip_stack(n=12, parent=None, loc=(0, 0, 0), name='chips'):
	ob = C.cyl(name, CHIP_R, CHIP_H * n, loc, chip_mat(), parent, segs=20)
	return ob


def chip(parent=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
	ob = C.cyl('chip', CHIP_R, CHIP_H, loc, chip_mat(), parent, rot=rot, segs=20, bevel_w=0.003)
	ob.scale = (scale, scale, scale)
	return ob


def slot_machine(colour='red'):
	"""A chunky cabinet, 2.2 m tall, its front on -Y, its base centre at the origin. One fused mesh."""
	body_c, accent = SLOT_COLOURS[colour]
	body = C.painted_mat(f'slot_body_{colour}', body_c, tuple(c * 0.6 for c in body_c), rough=0.3, scale=5.0, bump=0.04, coat=0.6)
	dark = C.mat('slot_dark', (0.025, 0.02, 0.03), rough=0.35, coat=0.3)
	glow = C.emit_mat(f'slot_glow_{colour}', accent, 1.5)
	g = gold()
	lean = math.radians(-7)
	parts = [
		C.box('base', (0.82, 0.66, 0.78), (0, 0, 0.39), body, bevel_w=0.06),
		C.box('kick', (0.86, 0.70, 0.10), (0, 0, 0.05), g, bevel_w=0.03),
		C.plane('belly', 0.60, 0.42, (0, -0.332, 0.42), glow, rot=(math.pi / 2, 0, 0)),
		C.box('belly_frame', (0.68, 0.03, 0.50), (0, -0.322, 0.42), g, bevel_w=0.012),
		C.box('deck', (0.88, 0.46, 0.11), (0, -0.20, 0.83), dark, rot=(math.radians(8), 0, 0), bevel_w=0.035),
		C.box('deck_trim', (0.90, 0.05, 0.13), (0, -0.425, 0.80), g, rot=(math.radians(8), 0, 0), bevel_w=0.02),
		C.box('upper', (0.82, 0.52, 1.02), (0, 0.06, 1.36), body, rot=(lean, 0, 0), bevel_w=0.07),
		C.box('screen_frame', (0.72, 0.04, 0.72), (0, -0.212, 1.36), g, rot=(lean, 0, 0), bevel_w=0.015),
		C.plane('screen', 0.63, 0.63, (0, -0.236, 1.357), reel_mat('slot_reels', (0.2, 0.2, 0.2)), rot=(math.pi / 2 + lean, 0, 0)),
		C.box('brow', (0.86, 0.60, 0.10), (0, 0.10, 1.90), g, bevel_w=0.035),
		C.box('topper', (0.50, 0.17, 0.32), (0, 0.10, 2.10), glow, bevel_w=0.07),
		C.box('topper_back', (0.56, 0.12, 0.38), (0, 0.16, 2.10), g, bevel_w=0.05),
		C.cyl('lever', 0.022, 0.5, (0.45, -0.05, 0.95), g, rot=(math.radians(-20), 0, 0), segs=10),
		C.sphere('knob', 0.06, (0.45, 0.12, 1.42), C.mat('slot_knob', (0.8, 0.03, 0.03), rough=0.2, coat=0.6), segs=16, rings=8),
	]
	for i, x in enumerate((-0.24, 0.0, 0.24)):
		parts.append(C.cyl('btn', 0.05, 0.035, (x, -0.26, 0.895), C.emit_mat(f'slot_btn_{i}', ((1.0, 0.2, 0.05), (1.0, 0.8, 0.1), (0.1, 1.0, 0.4))[i], 1.6), rot=(math.radians(8), 0, 0), segs=14))
	return fuse(parts, f'slot_{colour}')


def stool(seat_c=None):
	"""A bar-height stool, fused."""
	parts = [
		C.cyl('seat', 0.21, 0.10, (0, 0, 0.62), seat_c or leather(), segs=24, bevel_w=0.03),
		C.cyl('stem', 0.035, 0.6, (0, 0, 0.03), gold(), segs=12),
		C.cyl('foot', 0.20, 0.04, (0, 0, 0.0), gold(), segs=24, bevel_w=0.012),
		C.torus('ring', 0.15, 0.014, (0, 0, 0.3), gold(), segs=24, rsegs=8),
	]
	return fuse(parts, 'stool')


def card_table():
	"""An oval card table: green felt in a padded red rim on a gold pedestal. Fused."""
	parts = [
		C.cyl('felt', 1.0, 0.06, (0, 0, 0.90), felt(), segs=48),
		C.torus('rim', 1.0, 0.09, (0, 0, 0.955), leather(), segs=48, rsegs=12),
		C.torus('rim_gold', 1.09, 0.025, (0, 0, 0.93), gold(), segs=48, rsegs=8),
		C.cyl('apron', 0.98, 0.14, (0, 0, 0.77), dark_wood(), segs=48, bevel_w=0.02),
		C.cyl('pedestal', 0.20, 0.72, (0, 0, 0.05), dark_wood(), segs=20, r2=0.13),
		C.cyl('ped_base', 0.50, 0.07, (0, 0, 0.0), gold(), segs=32, bevel_w=0.02),
		C.torus('ped_ring', 0.19, 0.03, (0, 0, 0.40), gold(), segs=24, rsegs=8),
	]
	for ob in parts[:4]:
		ob.scale = (1.3, 0.78, 1.0)
	# cards
	card = C.mat('cas_card', (0.92, 0.9, 0.85), rough=0.4)
	back = C.mat('cas_card_back', (0.55, 0.02, 0.05), rough=0.4)
	for i, (x, y, a) in enumerate(((-0.55, -0.2, 0.3), (-0.42, -0.24, -0.1), (0.1, -0.35, 0.2), (0.25, -0.33, -0.3), (0.7, -0.1, 0.5), (-0.05, 0.3, 1.4), (0.12, 0.32, 1.7))):
		parts.append(C.box('card', (0.13, 0.19, 0.006), (x, y, 0.966), back if i % 3 == 2 else card, rot=(0, 0, a), bevel_w=0.0))
	return fuse(parts, 'card_table')


def chandelier(drop=1.0):
	"""Three gold tiers of warm bulbs with crystal drops; hangs from the origin. Fused."""
	g = gold()
	crystal = C.mat('cas_crystal', (1.0, 0.9, 0.75), rough=0.05, emit=(1.0, 0.75, 0.45), emit_strength=0.9, coat=1.0)
	parts = [
		C.cyl('chain', 0.035, drop, (0, 0, -drop), g, segs=10),
		C.cyl('canopy', 0.28, 0.12, (0, 0, -0.12), g, segs=24, r2=0.12),
		C.cyl('column', 0.11, 1.5, (0, 0, -drop - 1.5), g, segs=16),
		C.sphere('knuckle', 0.2, (0, 0, -drop - 0.1), g, segs=20, rings=10),
		C.sphere('finial', 0.19, (0, 0, -drop - 1.55), g, segs=20, rings=10),
		C.cyl('drop', 0.14, 0.4, (0, 0, -drop - 2.05), crystal, segs=8, r2=0.0),
	]
	bulbs, cups, drops = [], [], []
	for R, z, n in ((1.55, -drop - 0.55, 14), (1.05, -drop - 0.95, 10), (0.58, -drop - 1.3, 6)):
		parts.append(C.torus('tier', R, 0.055, (0, 0, z), g, segs=48, rsegs=10))
		parts.append(C.torus('tier_in', R * 0.55, 0.03, (0, 0, z + 0.12), g, segs=32, rsegs=8))
		for k in range(n):
			a = 2 * math.pi * (k + 0.5 * (n % 4 == 2)) / n
			x, y = math.cos(a) * R, math.sin(a) * R
			bulbs.append((x, y, z + 0.21, 0.095))
			cups.append((x, y, z + 0.03, 0.06, 0.11))
			a2 = a + math.pi / n
			drops.append((math.cos(a2) * R, math.sin(a2) * R, z - 0.24, 0.035, 0.2))
			if k % 2 == 0:
				parts.append(C.tube('arm', [(0, 0, z + 0.35), (x * 0.5, y * 0.5, z + 0.18), (x, y, z)], 0.025, g, segs=8))
	parts.append(balls('bulbs', bulbs, bulb(2.6)))
	parts.append(cyls('cups', cups, g, segs=10))
	parts.append(cyls('drops', drops, crystal, segs=6))
	return fuse(parts, 'chandelier')


def sconce():
	"""A wall light; its back on +Y. Fused."""
	parts = [
		C.box('plate', (0.22, 0.05, 0.5), (0, -0.025, 0), gold(), bevel_w=0.02),
		C.tube('arm', [(0, -0.03, -0.1), (0, -0.2, -0.12), (0, -0.26, 0.0)], 0.022, gold(), segs=8),
		C.cyl('cup', 0.09, 0.07, (0, -0.26, 0.0), gold(), segs=14, r2=0.13),
		C.sphere('globe', 0.15, (0, -0.26, 0.19), bulb(1.8), segs=16, rings=10),
	]
	return fuse(parts, 'sconce')


def roulette_table(parent=None):
	"""The roulette table (not fused: the wheel shades by its own centre). Long axis X, wheel at -X."""
	root = C.empty('roulette', parent)
	C.box('top', (3.1, 1.55, 0.12), (0, 0, 0.86), felt(), root, bevel_w=0.03)
	C.box('rim', (3.3, 1.75, 0.16), (0, 0, 0.82), dark_wood(), root, bevel_w=0.06)
	C.box('rim_gold', (3.34, 1.79, 0.04), (0, 0, 0.76), gold(), root, bevel_w=0.015)
	C.box('apron', (2.9, 1.35, 0.2), (0, 0, 0.66), dark_wood(), root, bevel_w=0.03)
	for x in (-1.15, 1.15):
		for y in (-0.5, 0.5):
			C.cyl('leg', 0.10, 0.6, (x, y, 0.0), dark_wood(), root, segs=14, r2=0.14)
			C.cyl('leg_cap', 0.13, 0.06, (x, y, 0.0), gold(), root, segs=14)
	C.plane('layout', 1.75, 0.95, (0.55, 0, 0.922), layout_mat(), root)
	# wheel
	wx = -0.95
	C.cyl('bowl', 0.56, 0.12, (wx, 0, 0.90), dark_wood(), root, segs=40, bevel_w=0.03)
	C.torus('bowl_gold', 0.54, 0.03, (wx, 0, 1.02), gold(), root, segs=40, rsegs=8)
	C.cyl('pockets', 0.44, 0.03, (wx, 0, 1.0), wheel_mat(), root, segs=40)
	C.cyl('cone', 0.26, 0.10, (wx, 0, 1.02), gold(), root, segs=32, r2=0.06)
	C.cyl('spindle', 0.03, 0.2, (wx, 0, 1.08), gold(), root, segs=10)
	C.sphere('spindle_top', 0.05, (wx, 0, 1.30), gold(), root, segs=12, rings=8)
	for k in range(4):
		a = math.pi / 2 * k + 0.4
		C.tube('spoke', [(wx, 0, 1.2), (wx + math.cos(a) * 0.2, math.sin(a) * 0.2, 1.2)], 0.014, gold(), root, segs=8)
	C.sphere('ball', 0.03, (wx + 0.3, 0.2, 1.05), C.mat('cas_ball', (0.95, 0.95, 0.9), rough=0.1), root, segs=12, rings=8)
	return root


# ---------------------------------------------------------------------------------------------
# the room
# ---------------------------------------------------------------------------------------------


def _walls():
	wr, g, gp = wall_red(), gold(), gold_paint()
	root = C.empty('walls')
	C.box('wall_back', (X1 - X0 + 1, 0.4, H), (0, Y1 + 0.2, H / 2), wr, root, bevel_w=0)
	C.box('wall_front', (X1 - X0 + 1, 0.4, H), (0, Y0 - 0.2, H / 2), wr, root, bevel_w=0)
	C.box('wall_right', (0.4, Y1 - Y0 + 1, H), (X1 + 0.2, 0, H / 2), wr, root, bevel_w=0)
	C.box('wall_left', (0.4, Y1 - Y0 + 1, H), (X0 - 0.2, 0, H / 2), wr, root, bevel_w=0)
	sc = hide(sconce())

	def run(along, fixed, a0, a1, face):
		"""Wainscot, dado, cornice, pilasters and panels along one wall. `face` is the inward normal."""
		length = a1 - a0
		mid = (a0 + a1) / 2

		def at(a, depth, z):
			d = fixed + face * depth
			return (a, d, z) if along == 'x' else (d, a, z)

		def size(sa, sd, sz):
			return (sa, sd, sz) if along == 'x' else (sd, sa, sz)

		rz = {('x', -1): 0, ('x', 1): 180, ('y', -1): 90, ('y', 1): -90}[(along, face)]
		C.box('wainscot', size(length, 0.12, 1.15), at(mid, 0.06, 0.575), dark_wood(), root, bevel_w=0.02)
		C.box('dado', size(length, 0.2, 0.1), at(mid, 0.1, 1.2), g, root, bevel_w=0.03)
		C.box('skirting', size(length, 0.2, 0.16), at(mid, 0.1, 0.08), g, root, bevel_w=0.03)
		C.box('cornice', size(length, 0.5, 0.35), at(mid, 0.25, H - 0.55), gp, root, bevel_w=0.08)
		C.box('cornice2', size(length, 0.3, 0.2), at(mid, 0.15, H - 0.9), g, root, bevel_w=0.05)
		n = int(length // 3.0)
		step = length / n
		for i in range(n + 1):
			a = a0 + i * step
			C.box('pilaster', size(0.55, 0.26, H - 1.3), at(a, 0.13, (H - 1.3) / 2 + 0.1), gp, root, bevel_w=0.05)
			C.box('pil_base', size(0.75, 0.36, 0.5), at(a, 0.18, 0.25), g, root, bevel_w=0.06)
			C.box('pil_cap', size(0.85, 0.42, 0.4), at(a, 0.21, H - 1.25), g, root, bevel_w=0.08)
			inst(sc, at(a, 0.27, 3.3), rz, root)
			if i < n:
				am = a + step / 2
				C.box('frame', size(step - 1.1, 0.08, 3.6), at(am, 0.04, 3.4), g, root, bevel_w=0.03)
				C.box('panel', size(step - 1.35, 0.1, 3.35), at(am, 0.06, 3.4), panel_red(), root, bevel_w=0.03)

	run('x', Y1, X0, X1, -1)
	run('y', X1, Y0, Y1, -1)
	run('y', X0, Y0, Y1, 1)
	return root


def _ceiling():
	root = C.empty('ceiling')
	C.box('ceiling', (X1 - X0 + 1, Y1 - Y0 + 1, 0.3), (0, 0, H + 0.15), C.painted_mat('cas_ceiling', (0.20, 0.01, 0.018), (0.12, 0.004, 0.01), rough=0.8, scale=1.5, bump=0.03), root, bevel_w=0)
	gp = gold_paint()
	for x in range(-12, 13, 4):
		C.box('beam_y', (0.4, Y1 - Y0, 0.35), (x, 0, H - 0.17), gp, root, bevel_w=0.06)
	for y in range(-10, 11, 4):
		C.box('beam_x', (X1 - X0, 0.4, 0.4), (0, y, H - 0.2), gp, root, bevel_w=0.06)
	return root


def _slot_rows(masters, stool_m):
	"""Banks of machines on the right of the room, facing the camera side (-Y), with stools."""
	root = C.empty('slots')
	order = ('red', 'gold', 'purple', 'teal', 'blue')
	k = 0
	for y in (-4.6, 0.2, 5.0):
		for i in range(8):
			x = 6.6 + i * 0.98
			inst(masters[order[k % 5]], (x, y, 0), 0, root)
			inst(stool_m, (x, y - 0.95, 0), 0, root)
			k += 2
		# a carpeted plinth under each bank
		C.box('plinth', (8.4, 1.0, 0.06), (10.03, y, 0.03), gold(), root, bevel_w=0.02)
		k += 1
	# along the right wall, facing into the room (-X)
	for i in range(6):
		inst(masters[order[(i * 3) % 5]], (14.2, -9.5 + i * 0.98, 0), -90, root)
		inst(masters[order[(i * 3 + 1) % 5]], (14.2, 7.4 + i * 0.98, 0), -90, root)
	return root


def _tables(table_m, stool_m):
	root = C.empty('tables')
	spots = [(-8.6, -1.6, 35), (2.9, -5.3, 150), (-7.2, 2.6, 75), (5.0, 8.6, 10), (-3.2, 6.2, -20)]
	rr = C.rng(11)
	for x, y, rz in spots:
		inst(table_m, (x, y, 0), rz, root)
		ca, sa = math.cos(math.radians(rz)), math.sin(math.radians(rz))
		for k in range(5):
			a = math.pi * (1.0 + (k + 0.5) / 5)
			lx, ly = math.cos(a) * 1.75, math.sin(a) * 1.3
			inst(stool_m, (x + lx * ca - ly * sa, y + lx * sa + ly * ca, 0), 0, root, scale=0.95)
		# chips on the felt (separate objects: each stack picks its own colours)
		for _ in range(9):
			a = rr.random() * 2 * math.pi
			d = 0.25 + rr.random() * 0.6
			lx, ly = math.cos(a) * d * 1.2, math.sin(a) * d * 0.7
			chip_stack(int(4 + rr.random() * 14), root, (x + lx * ca - ly * sa, y + lx * sa + ly * ca, 0.962))
	return root


def _high_roller_pit(table_m, stool_m):
	"""A raised marble platform at the back, behind a gold balustrade, with its own chandelier."""
	root = C.empty('pit')
	x0, x1, y0 = -10.5, -1.8, 8.6
	hgt = 0.5
	C.box('platform', (x1 - x0, Y1 - y0, hgt), ((x0 + x1) / 2, (y0 + Y1) / 2, hgt / 2), marble(), root, bevel_w=0.04)
	C.box('platform_trim', (x1 - x0 + 0.1, Y1 - y0 + 0.1, 0.08), ((x0 + x1) / 2, (y0 + Y1) / 2, hgt - 0.02), gold(), root, bevel_w=0.03)
	C.box('pit_carpet', (x1 - x0 - 1.0, Y1 - y0 - 1.0, 0.03), ((x0 + x1) / 2, (y0 + Y1) / 2, hgt + 0.02), C.painted_mat('cas_pit_carpet', (0.12, 0.02, 0.25), (0.07, 0.01, 0.16), rough=0.9, scale=10, bump=0.05, sheen=0.4), root, bevel_w=0.01)
	# steps in the middle of the front edge
	sx = (x0 + x1) / 2
	for i in range(2):
		C.box('step', (2.6, 0.45, hgt * (2 - i) / 3), (sx, y0 - 0.22 - i * 0.45, hgt * (2 - i) / 6), marble(), root, bevel_w=0.03)
	bal, posts = [], []
	xs = [x0 + 0.15 + i * 0.3 for i in range(int((x1 - x0) / 0.3))]
	for x in xs:
		if abs(x - sx) > 1.35:
			bal.append((x, y0 + 0.15, hgt, 0.045, 0.85))
	ys = [y0 + 0.15 + i * 0.3 for i in range(int((Y1 - y0) / 0.3))]
	for y in ys:
		bal.append((x1 - 0.15, y, hgt, 0.045, 0.85))
		bal.append((x0 + 0.15, y, hgt, 0.045, 0.85))
	cyls('balusters', bal, gold(), root, segs=10)
	for xa, xb in ((x0, sx - 1.35), (sx + 1.35, x1)):
		C.box('rail', (xb - xa, 0.16, 0.1), ((xa + xb) / 2, y0 + 0.15, hgt + 0.9), gold(), root, bevel_w=0.04)
		posts += [(xa + 0.15 if xa == x0 else xa, y0 + 0.15, hgt, 0.09, 1.05), (xb if xb != x1 else xb - 0.15, y0 + 0.15, hgt, 0.09, 1.05)]
	C.box('rail_r', (0.16, Y1 - y0, 0.1), (x1 - 0.15, (y0 + Y1) / 2, hgt + 0.9), gold(), root, bevel_w=0.04)
	C.box('rail_l', (0.16, Y1 - y0, 0.1), (x0 + 0.15, (y0 + Y1) / 2, hgt + 0.9), gold(), root, bevel_w=0.04)
	cyls('posts', posts, gold_paint(), root, segs=14)
	balls('post_knobs', [(p[0], p[1], hgt + 1.12, 0.13) for p in posts], gold(), root, segs=14)
	for x, y, rz in ((-8.0, 10.9, 10), (-4.2, 10.9, -10)):
		inst(table_m, (x, y, hgt + 0.03), rz, root)
		for k in range(4):
			a = math.pi * (1.1 + k * 0.27)
			inst(stool_m, (x + math.cos(a) * 1.5, y + math.sin(a) * 1.2, hgt + 0.03), 0, root, scale=0.95)
		for k in range(6):
			chip_stack(6 + k * 3, root, (x - 0.5 + k * 0.2, y + 0.15 * math.sin(k * 2.1), hgt + 0.03 + 0.962))
	return root


def _cashier_cage():
	"""The cage on the back wall: a counter behind gold bars, an arched sign, the vault behind."""
	root = C.empty('cage', loc=(5.6, Y1 - 0.9, 0))
	g, gp = gold(), gold_paint()
	w = 7.0
	C.box('counter', (w, 0.9, 1.1), (0, 0, 0.55), dark_wood(), root, bevel_w=0.05)
	C.box('counter_top', (w + 0.2, 1.1, 0.1), (0, 0, 1.13), marble(), root, bevel_w=0.035)
	C.box('counter_trim', (w + 0.1, 0.96, 0.08), (0, 0, 0.35), g, root, bevel_w=0.03)
	bars = [(-w / 2 + 0.2 + i * 0.2, -0.3, 1.18, 0.028, 2.0) for i in range(int(w / 0.2) - 1) if (i % 9) not in (3, 4, 5)]
	cyls('bars', bars, g, root, segs=8)
	C.box('bar_top', (w + 0.2, 0.2, 0.16), (0, -0.3, 3.22), g, root, bevel_w=0.05)
	for x in (-w / 2, w / 2, -w / 6, w / 6):
		C.box('cage_post', (0.3, 0.3, 3.3), (x, -0.3, 1.65), gp, root, bevel_w=0.06)
	# the sign: a gold arch with a row of bulbs and a lit panel
	C.box('sign', (w * 0.72, 0.25, 0.95), (0, -0.3, 3.85), gp, root, bevel_w=0.12)
	C.box('sign_panel', (w * 0.62, 0.06, 0.6), (0, -0.44, 3.85), C.emit_mat('cas_sign', (1.0, 0.45, 0.08), 1.6), root, bevel_w=0.08)
	balls('sign_bulbs', [(-w * 0.34 + i * (w * 0.68 / 15), -0.46, 3.85 + s * 0.4, 0.06) for i in range(16) for s in (-1, 1)], bulb(2.2), root, segs=10)
	C.cyl('sign_crown', 0.6, 0.22, (0, -0.19, 4.3), g, root, rot=(math.pi / 2, 0, 0), segs=32)
	# gold bars stacked behind the counter
	rr = C.rng(5)
	for px in (-2.4, 0.2, 2.5):
		for lvl in range(4):
			for i in range(4 - lvl):
				C.box('ingot', (0.42, 0.2, 0.14), (px + (i - (3 - lvl) / 2) * 0.46, 0.55 + rr.random() * 0.03, 1.25 + lvl * 0.15), g, root, bevel_w=0.03)
	# vault door on the wall
	steel = C.mat('cas_steel', (0.55, 0.5, 0.42), rough=0.3, metal=0.9)
	C.cyl('vault', 1.25, 0.25, (0, 0.85, 2.35), steel, root, rot=(math.pi / 2, 0, 0), segs=48, bevel_w=0.04)
	C.torus('vault_ring', 1.3, 0.1, (0, 0.6, 2.35), g, root, rot=(math.pi / 2, 0, 0), segs=48)
	C.torus('vault_wheel', 0.42, 0.045, (0, 0.5, 2.35), g, root, rot=(math.pi / 2, 0, 0), segs=32)
	for k in range(3):
		a = math.pi * k / 3
		C.tube('vault_spoke', [(-math.cos(a) * 0.42, 0.5, 2.35 - math.sin(a) * 0.42), (math.cos(a) * 0.42, 0.5, 2.35 + math.sin(a) * 0.42)], 0.03, g, root, segs=8)
	balls('vault_bolts', [(math.cos(2 * math.pi * k / 12) * 1.05, 0.58, 2.35 + math.sin(2 * math.pi * k / 12) * 1.05, 0.07) for k in range(12)], g, root, segs=10)
	C.point_light((0, -1.6, 2.6), (1.0, 0.72, 0.4), 260, radius=0.5, parent=root, name='CageLight')
	return root


def build_casino(gate_radius=2.0, heat=1.0, chandeliers=True, chandelier_power=900.0):
	"""Build the whole room. Returns dict(outline, roulette, chandeliers=[(x, y, z)…], height)."""
	outline = G.Outline(gate_radius, seed=7, jag=0.17)
	G.floor_with_hole('carpet', X0, X1, Y0, Y1, outline, carpet_mat())
	slab = C.painted_mat('cas_slab', (0.26, 0.008, 0.018), (0.12, 0.003, 0.01), rough=0.85, scale=6.0, bump=0.1)
	G.build_gate(outline, slab_mat=slab, seed=5, heat=heat, flames=7)

	_walls()
	_ceiling()
	stool_m = hide(stool())
	slot_m = {c: hide(slot_machine(c)) for c in SLOT_COLOURS}
	table_m = hide(card_table())
	_slot_rows(slot_m, stool_m)
	_tables(table_m, stool_m)
	_high_roller_pit(table_m, stool_m)
	_cashier_cage()

	# the roulette table goes over the far edge of the Gate, wheel end first
	az = math.radians(104)
	rim = outline.at(az)
	tbl = roulette_table()
	tbl.location = (math.cos(az) * (rim - 0.25), math.sin(az) * (rim - 0.25), -0.50)
	tbl.rotation_euler = (math.radians(-14), math.radians(-31), az)

	spots = []
	if chandeliers:
		ch = hide(chandelier(1.0))
		for x, y in ((-5.5, -3.0), (4.5, -4.0), (3.0, 5.5), (-6.0, 10.8), (10.5, 2.5), (-12.0, 3.0), (10.0, -9.5)):
			inst(ch, (x, y, H), (x * 37) % 60)
			z = H - 2.0
			C.point_light((x, y, z - 0.9), (1.0, 0.66, 0.32), chandelier_power, radius=0.9, name='Chandelier')
			spots.append((x, y, z))
	return dict(outline=outline, roulette=tbl, chandeliers=spots, height=H, slot_masters=slot_m, stool=stool_m, table=table_m)

