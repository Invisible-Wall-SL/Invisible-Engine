"""The Library stage: a tall reading hall with a mezzanine ring of bookshelves and arched windows.

Warm: orange wood, cream walls, teal accents. The Hell Gate tears open the middle of the reading
room's plank floor. `build_library()` returns the Gate outline and the positions a shot needs.
"""

from __future__ import annotations

import math

import bpy  # noqa: F401  isort: skip  (bpy must load before bmesh and mathutils)
import bmesh
from mathutils import Matrix, Vector

import common as C
import gate as G

HX, HY, H = 11.0, 9.0, 10.5  # half width, half depth, height of the hall
MEZ_Z = 4.0  # top of the mezzanine floor
MEZ_D = 2.0  # how far the mezzanine reaches into the room
SUN_DIR = Vector((0.40, -0.50, -0.77)).normalized()  # the way the light travels

WOOD = (0.58, 0.215, 0.065)
WOOD_DARK = (0.30, 0.095, 0.035)
CREAM = (0.82, 0.68, 0.44)
TEAL = (0.02, 0.36, 0.34)
BOOK_COLOURS = [
	(0.62, 0.045, 0.04),
	(0.02, 0.36, 0.34),
	(0.78, 0.46, 0.05),
	(0.04, 0.09, 0.32),
	(0.07, 0.30, 0.10),
	(0.26, 0.06, 0.30),
	(0.82, 0.24, 0.03),
	(0.80, 0.68, 0.46),
	(0.78, 0.22, 0.28),
	(0.16, 0.46, 0.72),
]


# ---------------------------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------------------------


def wood(axis='X'):
	return C.wood_mat('lib_wood_' + axis, WOOD, (0.40, 0.13, 0.04), rough=0.42, axis=axis)


def wood_dark(axis='X'):
	return C.wood_mat('lib_wood_dark_' + axis, WOOD_DARK, (0.17, 0.05, 0.02), rough=0.4, axis=axis)


def cream():
	return C.painted_mat('lib_cream', CREAM, (0.72, 0.56, 0.33), rough=0.8, scale=1.5, bump=0.05)


def teal():
	return C.painted_mat('lib_teal', TEAL, (0.012, 0.25, 0.25), rough=0.7, scale=14.0, bump=0.25, sheen=0.4)


def brass():
	return C.mat('lib_brass', (0.85, 0.55, 0.18), rough=0.28, metal=1.0)


def marble():
	return C.painted_mat('lib_marble', (0.82, 0.78, 0.70), (0.62, 0.58, 0.52), rough=0.35, scale=3.0, bump=0.03, coat=0.3)


def book_mats():
	return [C.painted_mat(f'lib_book_{i}', c, tuple(v * 0.8 for v in c), rough=0.6, scale=9.0, bump=0.1) for i, c in enumerate(BOOK_COLOURS)]


def paper():
	return C.mat('lib_paper', (0.86, 0.80, 0.64), rough=0.8)


def plank_mat():
	"""A varnished plank floor: a brick pattern in three wood tones."""
	if 'lib_planks' in C._MATS:
		return C._MATS['lib_planks']
	m, nt, p = C._new_mat('lib_planks')
	tc = nt.nodes.new('ShaderNodeTexCoord')
	mp = nt.nodes.new('ShaderNodeMapping')
	mp.inputs['Rotation'].default_value = (0, 0, math.radians(90))
	nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
	br = nt.nodes.new('ShaderNodeTexBrick')
	br.offset = 0.5
	br.inputs['Color1'].default_value = (0.66, 0.26, 0.075, 1)
	br.inputs['Color2'].default_value = (0.50, 0.165, 0.045, 1)
	br.inputs['Mortar'].default_value = (0.16, 0.045, 0.015, 1)
	br.inputs['Scale'].default_value = 1.0
	br.inputs['Mortar Size'].default_value = 0.006
	br.inputs['Mortar Smooth'].default_value = 0.3
	br.inputs['Bias'].default_value = 0.0
	br.inputs['Brick Width'].default_value = 1.7
	br.inputs['Row Height'].default_value = 0.22
	nt.links.new(mp.outputs['Vector'], br.inputs['Vector'])
	grain = nt.nodes.new('ShaderNodeTexNoise')
	gm = nt.nodes.new('ShaderNodeMapping')
	gm.inputs['Scale'].default_value = (22.0, 1.2, 1.0)
	nt.links.new(tc.outputs['Object'], gm.inputs['Vector'])
	nt.links.new(gm.outputs['Vector'], grain.inputs['Vector'])
	grain.inputs['Scale'].default_value = 1.5
	grain.inputs['Detail'].default_value = 3.0
	mix = nt.nodes.new('ShaderNodeMix')
	mix.data_type = 'RGBA'
	mix.blend_type = 'MULTIPLY'
	mix.inputs['Factor'].default_value = 0.55
	gr = nt.nodes.new('ShaderNodeMapRange')
	gr.inputs['To Min'].default_value = 0.55
	gr.inputs['To Max'].default_value = 1.25
	nt.links.new(grain.outputs['Fac'], gr.inputs['Value'])
	nt.links.new(br.outputs['Color'], mix.inputs['A'])
	nt.links.new(gr.outputs['Result'], mix.inputs['B'])
	nt.links.new(mix.outputs['Result'], p.inputs['Base Color'])
	bmp = nt.nodes.new('ShaderNodeBump')
	bmp.inputs['Strength'].default_value = 0.25
	bmp.inputs['Distance'].default_value = 0.01
	nt.links.new(br.outputs['Fac'], bmp.inputs['Height'])
	bmp.invert = True
	nt.links.new(bmp.outputs['Normal'], p.inputs['Normal'])
	p.inputs['Roughness'].default_value = 0.3
	p.inputs['Coat Weight'].default_value = 0.25
	p.inputs['Coat Roughness'].default_value = 0.12
	C._MATS['lib_planks'] = m
	return m


def globe_mat():
	"""A painted globe: teal seas, mustard and green land from noise."""
	if 'lib_globe' in C._MATS:
		return C._MATS['lib_globe']
	m, nt, p = C._new_mat('lib_globe')
	tc = nt.nodes.new('ShaderNodeTexCoord')
	noise = nt.nodes.new('ShaderNodeTexNoise')
	noise.inputs['Scale'].default_value = 2.3
	noise.inputs['Detail'].default_value = 5.0
	noise.inputs['Roughness'].default_value = 0.6
	nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
	ramp = nt.nodes.new('ShaderNodeValToRGB')
	ramp.color_ramp.interpolation = 'CONSTANT'
	els = ramp.color_ramp.elements
	els[0].position = 0.0
	els[0].color = (0.02, 0.30, 0.42, 1)
	els[1].position = 0.52
	els[1].color = (0.80, 0.60, 0.22, 1)
	e = els.new(0.47)
	e.color = (0.05, 0.50, 0.55, 1)
	e = els.new(0.60)
	e.color = (0.25, 0.48, 0.12, 1)
	e = els.new(0.70)
	e.color = (0.70, 0.36, 0.10, 1)
	nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
	nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
	p.inputs['Roughness'].default_value = 0.3
	p.inputs['Coat Weight'].default_value = 0.4
	C._MATS['lib_globe'] = m
	return m


def lamp_glass():
	"""The banker's lamp shade: green glass that glows."""
	return C.mat('lib_lamp_glass', (0.02, 0.45, 0.14), rough=0.2, emit=(0.03, 0.75, 0.22), emit_strength=1.3, coat=0.6)


# ---------------------------------------------------------------------------------------------
# small props (also used by the shot, in the Devils' hands)
# ---------------------------------------------------------------------------------------------


def book(name, size=(0.22, 0.30, 0.05), colour=0, loc=(0, 0, 0), rot=(0, 0, 0), parent=None):
	"""A closed hardback lying flat: w (spine to fore-edge), h (along the spine), t (thickness)."""
	w, h, t = size
	root = C.empty(name, parent, loc, rot)
	mats = book_mats()
	C.box('cover', (w, h, t), (0, 0, 0), mats[colour % len(mats)], root, bevel_w=0.008)
	C.box('pages', (w * 0.94, h * 1.02, t * 0.72), (w * 0.035, 0, 0), paper(), root, bevel_w=0.003)
	C.box('band', (w * 0.02, h * 0.9, t * 1.03), (-w * 0.3, 0, 0), brass(), root, bevel_w=0.0)
	return root


def book_stack(name, n=4, seed=1, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, size=(0.24, 0.32, 0.055)):
	r = C.rng(seed)
	root = C.empty(name, parent, loc, rot)
	z = 0.0
	for i in range(n):
		t = size[2] * (0.75 + r.random() * 0.7)
		s = 0.85 + r.random() * 0.25
		book('b', (size[0] * s, size[1] * s, t), int(r.integers(0, 10)), (0, 0, z + t / 2), (0, 0, (r.random() - 0.5) * 0.7), root)
		z += t
	return root


def open_book(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, colour=0, s=1.0):
	root = C.empty(name, parent, loc, rot, s)
	mats = book_mats()
	for side in (-1, 1):
		C.box('cover', (0.2, 0.3, 0.012), (side * 0.098, 0, 0.012), mats[colour % len(mats)], root, rot=(0, -side * 0.16, 0), bevel_w=0.004)
		C.box('pages', (0.19, 0.285, 0.03), (side * 0.096, 0, 0.034), paper(), root, rot=(0, -side * 0.12, 0), bevel_w=0.012)
	return root


def globe(name, r=0.34, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, stand=True):
	"""A globe with a brass meridian; on a wooden floor stand when `stand` is set."""
	root = C.empty(name, parent, loc, rot)
	zc = 1.0 if stand else 0.0
	ball = C.sphere('globe_ball', r, (0, 0, zc), globe_mat(), root, rot=(0.4, 0, 0), segs=40, rings=20)
	C.torus('meridian', r * 1.08, r * 0.045, (0, 0, zc), brass(), root, rot=(math.pi / 2, 0, 0.3), rsegs=10)
	for dz in (-1, 1):
		C.sphere('pin', r * 0.07, (0, 0, zc + dz * r * 1.08), brass(), root, segs=12, rings=6)
	if stand:
		C.torus('horizon', r * 1.22, r * 0.07, (0, 0, zc), wood_dark('X'), root, rsegs=8, scale=(1, 1, 0.5))
		for k in range(4):
			a = k * math.pi / 2 + math.pi / 4
			top = Vector((math.cos(a) * r * 1.2, math.sin(a) * r * 1.2, zc))
			bot = Vector((math.cos(a) * r * 1.35, math.sin(a) * r * 1.35, 0.03))
			C.tube('leg', [top, (top + bot) / 2 * 0.55 + Vector((0, 0, 0.42)), bot], [0.03, 0.045, 0.035], wood_dark('Z'), root, segs=10)
		C.cyl('hub', 0.11, 0.07, (0, 0, 0.42), wood_dark('X'), root, segs=20, bevel_w=0.015)
	return root, ball


def banker_lamp(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, light=True, s=1.0):
	root = C.empty(name, parent, loc, rot, s)
	C.cyl('base', 0.11, 0.03, (0, 0, 0), brass(), root, segs=24, bevel_w=0.01)
	C.tube('stem', [(0, 0.05, 0.02), (0, 0.07, 0.2), (0, 0.03, 0.31)], [0.016, 0.014, 0.014], brass(), root, segs=10)
	shade = C.cyl('shade', 0.085, 0.3, (-0.15, 0, 0.33), lamp_glass(), root, rot=(0, math.pi / 2, 0), segs=24, bevel_w=0.02)
	shade.scale = (0.75, 1.0, 1.0)
	if light:
		C.point_light((0, -0.02, 0.22), (1.0, 0.8, 0.5), 22, radius=0.05, parent=root, name='LampGlow')
	return root


def bust(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, pedestal=True):
	root = C.empty(name, parent, loc, rot)
	z = 0.0
	if pedestal:
		C.box('ped_base', (0.6, 0.6, 0.14), (0, 0, 0.07), wood_dark('X'), root, bevel_w=0.03)
		C.box('ped', (0.44, 0.44, 0.95), (0, 0, 0.60), wood('Z'), root, bevel_w=0.03)
		C.box('ped_top', (0.58, 0.58, 0.1), (0, 0, 1.12), wood_dark('X'), root, bevel_w=0.03)
		z = 1.17
	mb = marble()
	C.cyl('bust_foot', 0.14, 0.09, (0, 0, z), mb, root, segs=20, bevel_w=0.02)
	C.sphere('bust_chest', 1.0, (0, 0, z + 0.26), mb, root, scale=(0.25, 0.15, 0.2))
	C.cyl('bust_neck', 0.07, 0.16, (0, 0, z + 0.38), mb, root, segs=16)
	C.sphere('bust_head', 1.0, (0, -0.01, z + 0.62), mb, root, scale=(0.135, 0.15, 0.165))
	C.sphere('bust_nose', 0.03, (0, -0.155, z + 0.61), mb, root, scale=(0.8, 1, 1.5), segs=12, rings=6)
	C.sphere('bust_hair', 1.0, (0, 0.02, z + 0.68), mb, root, scale=(0.15, 0.155, 0.13))
	return root


def chair(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None):
	root = C.empty(name, parent, loc, rot)
	wd = wood('Z')
	for sx in (-1, 1):
		C.box('leg_f', (0.065, 0.065, 0.46), (sx * 0.2, -0.2, 0.23), wd, root, bevel_w=0.015)
		C.box('leg_b', (0.065, 0.065, 1.02), (sx * 0.2, 0.2, 0.51), wd, root, rot=(-0.07, 0, 0), bevel_w=0.015)
	C.box('seat', (0.5, 0.5, 0.07), (0, 0, 0.47), wood('X'), root, bevel_w=0.02)
	C.box('cushion', (0.44, 0.44, 0.08), (0, 0, 0.53), teal(), root, bevel_w=0.035, segs=4)
	C.box('back_top', (0.5, 0.06, 0.16), (0, 0.235, 0.98), wood('X'), root, rot=(-0.07, 0, 0), bevel_w=0.025)
	for sx in (-0.12, 0, 0.12):
		C.box('slat', (0.06, 0.03, 0.4), (sx, 0.22, 0.72), wd, root, rot=(-0.07, 0, 0), bevel_w=0.01)
	return root


def table(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, size=(2.6, 1.1), lamps=True, dress=True, seed=1, chairs=True):
	"""A reading table with green lamps, books and chairs."""
	r = C.rng(seed)
	root = C.empty(name, parent, loc, rot)
	sx, sy = size
	C.box('top', (sx, sy, 0.1), (0, 0, 0.78), wood('X'), root, bevel_w=0.03)
	C.box('apron', (sx - 0.3, sy - 0.25, 0.12), (0, 0, 0.68), wood_dark('X'), root, bevel_w=0.01)
	for ax in (-1, 1):
		for ay in (-1, 1):
			C.box('leg', (0.13, 0.13, 0.72), (ax * (sx / 2 - 0.15), ay * (sy / 2 - 0.13), 0.36), wood('Z'), root, bevel_w=0.03)
		C.box('stretcher', (0.08, sy - 0.3, 0.07), (ax * (sx / 2 - 0.15), 0, 0.18), wood_dark('Y'), root, bevel_w=0.015)
	top = 0.83
	if lamps:
		for ax in (-1, 1):
			banker_lamp('lamp', (ax * sx * 0.25, 0.0, top), (0, 0, math.pi / 2 + (r.random() - 0.5) * 0.3), root)
	if dress:
		open_book('open', (sx * 0.02 + (r.random() - 0.5) * 0.2, -sy * 0.22, top), (0, 0, (r.random() - 0.5) * 0.6), root, int(r.integers(0, 10)))
		book_stack('stack', int(r.integers(2, 5)), int(r.integers(0, 999)), (-sx * 0.4, sy * 0.18, top), (0, 0, r.random()), root)
		book_stack('stack', int(r.integers(1, 4)), int(r.integers(0, 999)), (sx * 0.38, -sy * 0.2, top), (0, 0, r.random()), root)
		open_book('open', (-sx * 0.2, sy * 0.24, top), (0, 0, math.pi + (r.random() - 0.5) * 0.5), root, int(r.integers(0, 10)))
	if chairs:
		for ax in (-0.55, 0.55):
			for ay, ang in ((-1, 0.0), (1, math.pi)):
				chair('chair', (ax * sx / 2 + (r.random() - 0.5) * 0.15, ay * (sy / 2 + 0.28 + r.random() * 0.2), 0), (0, 0, ang + math.pi + (r.random() - 0.5) * 0.5), root)
	return root


def book_cart(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, seed=2):
	r = C.rng(seed)
	root = C.empty(name, parent, loc, rot)
	wd = wood('X')
	for z in (0.22, 0.62, 1.0):
		C.box('tray', (1.0, 0.5, 0.06), (0, 0, z), wd, root, bevel_w=0.02)
	for ax in (-1, 1):
		C.box('end', (0.07, 0.52, 1.0), (ax * 0.5, 0, 0.6), wood_dark('Z'), root, bevel_w=0.02)
		for ay in (-1, 1):
			C.cyl('wheel', 0.085, 0.05, (ax * 0.42, ay * 0.2 - 0.025, 0.085), C.mat('lib_rubber', (0.03, 0.03, 0.03), rough=0.7), root, rot=(math.pi / 2, 0, 0), segs=20, bevel_w=0.01)
	mats = book_mats()
	for z in (0.25, 0.65):
		x = -0.42
		while x < 0.4:
			t = 0.045 + r.random() * 0.04
			h = 0.22 + r.random() * 0.1
			C.box('cb', (t, 0.24, h), (x + t / 2, 0, z + 0.03 + h / 2), mats[int(r.integers(0, 10))], root, rot=(0, (r.random() - 0.5) * 0.12, 0), bevel_w=0.008)
			x += t + 0.004
	return root


def bookshelf(name, width, height, loc, yaw=0.0, parent=None, seed=1, depth=0.45, rows=5, lean=0.0, fill=0.93):
	"""A chunky shelf unit, its back against local +Y, filled with books (one mesh)."""
	r = C.rng(seed)
	root = C.empty(name, parent, loc, (lean, 0, yaw))
	side_t = 0.1
	C.box('side_l', (side_t, depth, height), (-width / 2 + side_t / 2, 0, height / 2), wood('Z'), root, bevel_w=0.02)
	C.box('side_r', (side_t, depth, height), (width / 2 - side_t / 2, 0, height / 2), wood('Z'), root, bevel_w=0.02)
	C.box('back', (width - 0.05, 0.04, height - 0.1), (0, depth / 2 - 0.03, height / 2), wood_dark('Z'), root, bevel_w=0.0)
	C.box('plinth', (width + 0.04, depth + 0.04, 0.22), (0, 0, 0.11), wood_dark('X'), root, bevel_w=0.025)
	C.box('cornice', (width + 0.16, depth + 0.14, 0.2), (0, -0.03, height - 0.04), wood_dark('X'), root, bevel_w=0.05)
	C.box('cornice_b', (width + 0.07, depth + 0.07, 0.08), (0, -0.015, height - 0.18), wood('X'), root, bevel_w=0.02)
	inner_h = height - 0.22 - 0.24
	bay = inner_h / rows
	bm = bmesh.new()
	for k in range(rows):
		z0 = 0.22 + k * bay
		C.box('board', (width - side_t * 2 + 0.02, depth - 0.04, 0.06), (0, 0, z0 + 0.03), wood('X'), root, bevel_w=0.012)
		x = -width / 2 + side_t + 0.02
		x1 = width / 2 - side_t - 0.02
		zb = z0 + 0.06
		clear = bay - 0.1
		while x < x1 - 0.05:
			roll = r.random()
			if roll > fill:
				x += 0.1 + r.random() * 0.2
				continue
			t = 0.04 + r.random() * 0.055
			if x + t > x1:
				break
			hgt = clear * (0.62 + r.random() * 0.36)
			d = depth * (0.5 + r.random() * 0.2)
			tilt = 0.0
			if roll < 0.07 and x + t + 0.12 < x1:
				tilt = 0.22 + r.random() * 0.12
			mat = Matrix.Translation((x + t / 2 + (math.sin(tilt) * hgt / 2), -depth / 2 + 0.05 + d / 2 + r.random() * 0.03, zb + hgt / 2 * math.cos(tilt))) @ Matrix.Rotation(tilt, 4, 'Y') @ Matrix.Diagonal((t, d, hgt, 1.0))
			geom = bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
			ci = int(r.integers(0, len(BOOK_COLOURS)))
			for v in geom['verts']:
				for f in v.link_faces:
					f.material_index = ci
			x += t + 0.003 + math.sin(tilt) * hgt
	books = C.obj_from_bm(bm, 'books', None, root, smooth=False)
	for mt in book_mats():
		books.data.materials.append(mt)
	md = books.modifiers.new('Bevel', 'BEVEL')
	md.width = 0.009
	md.segments = 2
	return root


def ladder(name, loc, yaw, height=3.4, parent=None):
	"""A rolling library ladder leaning on a shelf (its top toward local +Y)."""
	root = C.empty(name, parent, loc, (0, 0, yaw))
	leanv = 0.9
	n = 9
	for sx in (-0.26, 0.26):
		C.tube('rail', [(sx, -leanv, 0.08), (sx, 0.0, height)], 0.035, wood('Z'), root, segs=10)
		C.cyl('wheel', 0.07, 0.04, (sx - 0.02, -leanv, 0.07), brass(), root, rot=(0, math.pi / 2, 0), segs=16)
	for i in range(1, n):
		t = i / n
		C.tube('rung', [(-0.26, -leanv * (1 - t), 0.08 + (height - 0.08) * t), (0.26, -leanv * (1 - t), 0.08 + (height - 0.08) * t)], 0.024, wood_dark('X'), root, segs=8)
	C.tube('hook', [(-0.3, 0.0, height), (0.3, 0.0, height)], 0.02, brass(), root, segs=8)
	return root


def spiral_stairs(name, loc, parent=None, radius=1.15, height=MEZ_Z, steps=20, turns=1.0, start=0.0):
	root = C.empty(name, parent, loc)
	C.cyl('pole', 0.11, height + 1.15, (0, 0, 0), wood_dark('Z'), root, segs=20)
	C.sphere('finial', 0.16, (0, 0, height + 1.2), brass(), root, segs=20, rings=10)
	rail = []
	for i in range(steps):
		a = start + turns * 2 * math.pi * i / steps
		z = height * (i + 1) / steps
		st = C.box('step', (radius, 0.42, 0.07), (math.cos(a) * radius / 2, math.sin(a) * radius / 2, z - 0.035), wood('X'), root, rot=(0, 0, a), bevel_w=0.02)
		del st
		p = Vector((math.cos(a) * (radius - 0.06), math.sin(a) * (radius - 0.06), z))
		C.tube('bal', [p, p + Vector((0, 0, 0.95))], 0.022, C.mat('lib_iron', (0.02, 0.09, 0.09), rough=0.4, metal=0.6), root, segs=8)
		rail.append(p + Vector((0, 0, 0.97)))
	C.tube('handrail', C.catmull(rail, 4), 0.04, wood_dark('X'), root, segs=10)
	return root


def card_catalogue(name, loc, yaw=0.0, parent=None):
	root = C.empty(name, parent, loc, (0, 0, yaw))
	C.box('body', (1.7, 0.55, 1.25), (0, 0, 0.72), wood('X'), root, bevel_w=0.03)
	C.box('top', (1.82, 0.63, 0.08), (0, 0, 1.38), wood_dark('X'), root, bevel_w=0.03)
	for ax in (-1, 1):
		C.box('foot', (0.14, 0.5, 0.12), (ax * 0.72, 0, 0.06), wood_dark('X'), root, bevel_w=0.02)
	for i in range(6):
		for j in range(4):
			x = -0.7 + i * 0.28
			z = 0.27 + j * 0.3
			C.box('drawer', (0.24, 0.04, 0.25), (x, -0.285, z), wood_dark('X'), root, bevel_w=0.015)
			C.sphere('knob', 0.022, (x, -0.315, z - 0.04), brass(), root, segs=10, rings=5)
			C.box('label', (0.11, 0.01, 0.06), (x, -0.308, z + 0.05), paper(), root, bevel_w=0.0)
	return root


def chandelier(name, loc, parent=None, drop=2.2, power=180):
	root = C.empty(name, parent, loc)
	C.cyl('rod', 0.03, drop, (0, 0, 0), brass(), root, segs=10)
	C.torus('ring', 0.85, 0.045, (0, 0, 0), brass(), root, rsegs=10)
	C.torus('ring2', 0.5, 0.035, (0, 0, 0.35), brass(), root, rsegs=10)
	glow = C.mat('lib_bulb', (1.0, 0.85, 0.6), rough=0.4, emit=(1.0, 0.72, 0.38), emit_strength=6.0)
	for k in range(8):
		a = 2 * math.pi * k / 8
		C.tube('arm', [(math.cos(a) * 0.5, math.sin(a) * 0.5, 0.35), (math.cos(a) * 0.85, math.sin(a) * 0.85, 0.0)], 0.018, brass(), root, segs=8)
		C.sphere('bulb', 0.085, (math.cos(a) * 0.85, math.sin(a) * 0.85, 0.12), glow, root, scale=(1, 1, 1.25), segs=14, rings=8)
	C.point_light((0, 0, -0.25), (1.0, 0.78, 0.5), power, radius=0.5, parent=root, name='ChandelierLight')
	return root


# ---------------------------------------------------------------------------------------------
# the shell: walls with arched windows, mezzanine, ceiling
# ---------------------------------------------------------------------------------------------


def _arch_points(c, w, zs, n=14):
	"""The arch over a window, from its right spring point round to its left one (exclusive)."""
	r = w / 2
	return [(c + r * math.cos(math.pi * i / n), zs + r * math.sin(math.pi * i / n)) for i in range(1, n)]


def wall(name, length, height, windows, origin, yaw, material, thickness=0.5, parent=None):
	"""A wall along local +X from `origin`, facing local -Y, with arched openings (c, w, z0, zs)."""
	bm = bmesh.new()

	def face(pts):
		bm.faces.new([bm.verts.new((u, 0, z)) for u, z in pts])

	cur = 0.0
	for c, w, z0, zs in sorted(windows):
		a, b = c - w / 2, c + w / 2
		face([(cur, 0), (a, 0), (a, height), (cur, height)])
		face([(a, 0), (b, 0), (b, z0), (a, z0)])
		face([(a, zs), (a, height), (b, height), (b, zs)] + _arch_points(c, w, zs))
		cur = b
	face([(cur, 0), (length, 0), (length, height), (cur, height)])
	bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	ob = C.obj_from_bm(bm, name, material, parent, smooth=False)
	sol = ob.modifiers.new('Solid', 'SOLIDIFY')
	sol.thickness = thickness
	sol.offset = 0.0
	ob.location = origin
	ob.rotation_euler = (0, 0, yaw)
	return ob


def window_dress(name, c_world, right, w, z0, zs, parent=None, shaft=True, shaft_len=13.0, shaft_strength=1.7):
	"""Frame, mullions and sill for one arched window, and the shaft of light that falls from it.

	`c_world` is the window's centre on the wall's inner face at z = 0; `right` its unit width axis.
	"""
	root = C.empty(name, parent)
	right = Vector(right).normalized()
	inward = Vector((0, 0, 1)).cross(right) * -1.0
	base = Vector(c_world)

	def P(u, z, d=0.0):
		return base + right * u + Vector((0, 0, z)) + inward * d

	r = w / 2
	outline = [(-r, z0), (-r, zs)] + _arch_points(0.0, w, zs)[::-1] + [(r, zs), (r, z0)]
	wd = wood_dark('Z')
	C.tube('frame', [P(u, z, 0.04) for u, z in outline], 0.09, wd, root, segs=8, cap=True)
	C.tube('mullion', [P(0, z0, 0.02), P(0, zs + r, 0.02)], 0.05, wd, root, segs=8)
	for zz in (z0 + (zs - z0) * 0.36, z0 + (zs - z0) * 0.72, zs):
		C.tube('transom', [P(-r, zz, 0.02), P(r, zz, 0.02)], 0.045, wd, root, segs=8)
	sill = C.box('sill', (w + 0.5, 0.5, 0.16), P(0, z0 - 0.06, 0.1), wood('X'), root, bevel_w=0.04)
	sill.rotation_euler = (0, 0, math.atan2(right.y, right.x))
	if shaft:
		# nested prisms, so the shaft is brightest in its core and soft at its edge
		layers = (1.0, 0.84, 0.68, 0.52, 0.36)
		bm = bmesh.new()
		uvl = bm.loops.layers.uv.new('UVMap')
		zc = (z0 + zs + r) / 2
		for k in layers:
			near = [bm.verts.new(P(u * 0.92 * k, zc + (z - zc) * 0.94 * k, 0.15)) for u, z in outline]
			far = [bm.verts.new(v.co + SUN_DIR * shaft_len) for v in near]
			n = len(near)
			for i in range(n):
				j = (i + 1) % n
				f = bm.faces.new((near[i], near[j], far[j], far[i]))
				for lp, v in zip(f.loops, (0, 0, 1, 1)):
					lp[uvl].uv = (i / n, v)
		sh = C.obj_from_bm(bm, 'shaft', C.beam_mat('lib_shaft', (1.0, 0.78, 0.46), shaft_strength / len(layers)), root, smooth=False)
		sh.visible_shadow = False
		sh.visible_diffuse = False
		sh.visible_glossy = False
	return root


def balustrade(name, a, b, parent=None, z=MEZ_Z, height=1.0, step=0.36):
	"""Turned balusters under a thick rail from a to b (xy)."""
	a, b = Vector((*a, z)), Vector((*b, z))
	d = b - a
	n = max(int(d.length / step), 1)
	yaw = math.atan2(d.y, d.x)
	prof = [(0.0, 0.055), (0.08, 0.06), (0.16, 0.035), (0.34, 0.07), (0.5, 0.05), (0.72, 0.03), (0.86, 0.05), (height - 0.06, 0.045)]
	bm = bmesh.new()
	segs = 10
	for i in range(n + 1):
		p = a + d * (i / n)
		rings = []
		for zz, rr in prof:
			rings.append([bm.verts.new((p.x + math.cos(2 * math.pi * k / segs) * rr, p.y + math.sin(2 * math.pi * k / segs) * rr, p.z + zz)) for k in range(segs)])
		for q in range(len(rings) - 1):
			for k in range(segs):
				bm.faces.new((rings[q][k], rings[q][(k + 1) % segs], rings[q + 1][(k + 1) % segs], rings[q + 1][k]))
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	C.obj_from_bm(bm, name + '_balusters', C.mat('lib_baluster', (0.80, 0.66, 0.42), rough=0.5), parent)
	mid = (a + b) / 2
	C.box(name + '_rail', (d.length + 0.1, 0.2, 0.12), (mid.x, mid.y, z + height), wood_dark('X'), parent, rot=(0, 0, yaw), bevel_w=0.04)
	C.box(name + '_foot', (d.length + 0.1, 0.18, 0.06), (mid.x, mid.y, z + 0.03), wood_dark('X'), parent, rot=(0, 0, yaw), bevel_w=0.015)
	for t in (0.0, 1.0):
		p = a + d * t
		C.box(name + '_newel', (0.22, 0.22, height + 0.18), (p.x, p.y, z + (height + 0.18) / 2), wood('Z'), parent, bevel_w=0.04)
		C.sphere(name + '_ball', 0.13, (p.x, p.y, z + height + 0.26), wood_dark('X'), parent, segs=16, rings=8)


def column(name, x, y, parent=None, height=MEZ_Z - 0.3):
	C.box(name + '_base', (0.6, 0.6, 0.3), (x, y, 0.15), wood_dark('X'), parent, bevel_w=0.05)
	C.cyl(name, 0.2, height - 0.55, (x, y, 0.3), wood('Z'), parent, segs=24, r2=0.17)
	C.box(name + '_cap', (0.62, 0.62, 0.26), (x, y, height - 0.13), wood_dark('X'), parent, bevel_w=0.07)


def build_library(gate_radius=1.75, gate_seed=7, heat=2.6, shafts=True):
	"""Build the hall. Returns dict(outline, gate, tables, ...) for the shot."""
	root = C.empty('Library')
	wl = cream()

	# floor with the Gate in the middle
	outline = G.Outline(gate_radius, seed=gate_seed)
	G.floor_with_hole('lib_floor', -HX, HX, -HY, HY, outline, plank_mat(), parent=root)
	gate = G.build_gate(outline, slab_mat=plank_mat(), seed=5, heat=heat, crack_len=(1.2, 2.8))

	# walls. Windows: (centre along the wall, width, sill z, spring z)
	back_w = [(HX - 6.0, 2.5, 4.9, 8.2), (HX, 2.5, 4.9, 8.2), (HX + 6.0, 2.5, 4.9, 8.2)]
	left_w = [(HY - 3.5, 2.5, 4.9, 8.2), (HY + 3.0, 2.5, 4.9, 8.2)]
	wall('wall_back', 2 * HX, H, back_w, (-HX, HY + 0.25, 0), 0.0, wl, parent=root)
	wall('wall_left', 2 * HY, H, left_w, (-HX - 0.25, -HY, 0), math.pi / 2, wl, parent=root)
	wall('wall_right', 2 * HY, H, [], (HX + 0.25, -HY, 0), math.pi / 2, wl, parent=root)
	wall('wall_front', 2 * HX, H, [], (-HX, -HY - 0.25, 0), 0.0, wl, parent=root)
	for c, w, z0, zs in back_w:
		window_dress('win_back', (c - HX, HY, 0), (1, 0, 0), w, z0, zs, root, shaft=shafts)
	for c, w, z0, zs in left_w:
		window_dress('win_left', (-HX, c - HY, 0), (0, 1, 0), w, z0, zs, root, shaft=shafts)

	# ceiling: cream, with dark beams and a wooden cornice
	C.box('ceiling', (2 * HX + 1, 2 * HY + 1, 0.4), (0, 0, H + 0.2), wl, root, bevel_w=0.0)
	for x in (-7.3, -3.65, 0, 3.65, 7.3):
		C.box('beam', (0.36, 2 * HY, 0.42), (x, 0, H - 0.2), wood_dark('Y'), root, bevel_w=0.05)
	for y in (-4.5, 0, 4.5):
		C.box('beam', (2 * HX, 0.3, 0.3), (0, y, H - 0.14), wood_dark('X'), root, bevel_w=0.05)
	C.box('cornice_b', (2 * HX, 0.3, 0.45), (0, HY - 0.15, H - 0.6), wood('X'), root, bevel_w=0.08)
	C.box('cornice_l', (0.3, 2 * HY, 0.45), (-HX + 0.15, 0, H - 0.6), wood('Y'), root, bevel_w=0.08)
	C.box('cornice_r', (0.3, 2 * HY, 0.45), (HX - 0.15, 0, H - 0.6), wood('Y'), root, bevel_w=0.08)

	# mezzanine ring: back, left, right
	ex, ey = HX - MEZ_D, HY - MEZ_D
	C.box('mez_back', (2 * HX, MEZ_D, 0.28), (0, HY - MEZ_D / 2, MEZ_Z - 0.14), wood('X'), root, bevel_w=0.03)
	C.box('mez_left', (MEZ_D, 2 * HY - MEZ_D, 0.28), (-HX + MEZ_D / 2, -MEZ_D / 2, MEZ_Z - 0.14), wood('Y'), root, bevel_w=0.03)
	C.box('mez_right', (MEZ_D, 2 * HY - MEZ_D, 0.28), (HX - MEZ_D / 2, -MEZ_D / 2, MEZ_Z - 0.14), wood('Y'), root, bevel_w=0.03)
	# fascia with a teal band
	C.box('fascia_back', (2 * ex + 0.1, 0.14, 0.5), (0, ey, MEZ_Z - 0.25), wood_dark('X'), root, bevel_w=0.04)
	C.box('fascia_left', (0.14, HY + ey, 0.5), (-ex, (ey - HY) / 2, MEZ_Z - 0.25), wood_dark('Y'), root, bevel_w=0.04)
	C.box('fascia_right', (0.14, HY + ey, 0.5), (ex, (ey - HY) / 2, MEZ_Z - 0.25), wood_dark('Y'), root, bevel_w=0.04)
	C.box('band_back', (2 * ex, 0.16, 0.14), (0, ey - 0.01, MEZ_Z - 0.25), teal(), root, bevel_w=0.03)
	C.box('band_left', (0.16, HY + ey, 0.14), (-ex + 0.01, (ey - HY) / 2, MEZ_Z - 0.25), teal(), root, bevel_w=0.03)
	C.box('band_right', (0.16, HY + ey, 0.14), (ex - 0.01, (ey - HY) / 2, MEZ_Z - 0.25), teal(), root, bevel_w=0.03)
	balustrade('bal_back', (-ex + 0.1, ey + 0.1), (ex - 0.1, ey + 0.1), root)
	balustrade('bal_left', (-ex + 0.1, -HY + 0.3), (-ex + 0.1, ey + 0.1), root)
	balustrade('bal_right', (ex - 0.1, -HY + 0.3), (ex - 0.1, ey + 0.1), root)
	for x in (-ex, -4.5, 0.0, 4.5, ex):
		column('col_back', x, ey, root)
	for y in (-6.5, -2.0, 2.5):
		column('col_left', -ex, y, root)
		column('col_right', ex, y, root)

	# ground-floor shelves under the mezzanine (a double door in the middle of the back wall)
	seed = 10
	unit = 2.1
	gh = 3.42
	for i in range(10):
		x = -HX + 0.55 + unit / 2 + i * (unit + 0.0)
		if abs(x) < 1.6 or x > HX - 0.6:
			continue
		seed += 1
		bookshelf('shelf_gb', unit, gh, (x, HY - 0.26, 0), 0.0, root, seed, lean=(C.rng(seed).random() - 0.5) * 0.03)
	for i in range(8):
		y = -HY + 0.4 + unit / 2 + i * unit
		if y > HY - 1.0:
			continue
		seed += 1
		bookshelf('shelf_gl', unit, gh, (-HX + 0.26, y, 0), math.pi / 2, root, seed)
		seed += 1
		bookshelf('shelf_gr', unit, gh, (HX - 0.26, y, 0), -math.pi / 2, root, seed)
	# the door
	C.box('door_frame', (2.9, 0.3, 3.5), (0, HY - 0.1, 1.75), wood_dark('Z'), root, bevel_w=0.06)
	for sx in (-1, 1):
		C.box('door', (1.2, 0.1, 3.05), (sx * 0.62, HY - 0.28, 1.55), wood('Z'), root, bevel_w=0.03)
		C.box('door_panel', (0.8, 0.05, 1.1), (sx * 0.62, HY - 0.34, 2.25), teal(), root, bevel_w=0.03)
		C.box('door_panel', (0.8, 0.05, 1.1), (sx * 0.62, HY - 0.34, 0.9), teal(), root, bevel_w=0.03)
		C.sphere('door_knob', 0.06, (sx * 0.12, HY - 0.38, 1.45), brass(), root, segs=14, rings=8)

	# mezzanine shelves between the windows
	mh = 3.0
	for x0, x1 in ((-HX + 0.3, -7.45), (-4.55, -1.45), (1.45, 4.55), (7.45, HX - 0.3)):
		n = max(round((x1 - x0) / 1.6), 1)
		wdt = (x1 - x0) / n
		for i in range(n):
			seed += 1
			bookshelf('shelf_mb', wdt, mh, (x0 + wdt * (i + 0.5), HY - 0.24, MEZ_Z), 0.0, root, seed, depth=0.4, rows=4)
	for y0, y1 in ((-HY + 0.3, -4.95), (-2.05, 1.55), (4.45, HY - 0.75)):
		n = max(round((y1 - y0) / 1.6), 1)
		wdt = (y1 - y0) / n
		for i in range(n):
			seed += 1
			bookshelf('shelf_ml', wdt, mh, (-HX + 0.24, y0 + wdt * (i + 0.5), MEZ_Z), math.pi / 2, root, seed, depth=0.4, rows=4)
	n = 9
	wdt = (2 * HY - 1.3) / n
	for i in range(n):
		seed += 1
		bookshelf('shelf_mr', wdt, mh + 0.6, (HX - 0.24, -HY + 0.3 + wdt * (i + 0.5), MEZ_Z), -math.pi / 2, root, seed, depth=0.4, rows=5)

	# ladders, stairs
	ladder('ladder_r', (HX - 0.55, -1.2, 0), -math.pi / 2, 3.3, root)
	ladder('ladder_b', (-6.4, HY - 0.55, 0), 0.0, 3.3, root)
	ladder('ladder_m', (5.9, HY - 0.5, MEZ_Z), 0.0, 2.9, root)
	spiral_stairs('stairs', (-ex + 1.25, ey - 1.3, 0), root, start=math.radians(200), turns=1.05)

	# rugs
	rug = C.painted_mat('lib_rug', (0.03, 0.34, 0.33), (0.02, 0.22, 0.24), rough=0.9, scale=30.0, bump=0.4, sheen=0.5)
	rug2 = C.painted_mat('lib_rug_cream', (0.82, 0.62, 0.34), (0.7, 0.48, 0.24), rough=0.9, scale=30.0, bump=0.4, sheen=0.5)
	for x, y, a in ((-5.6, -1.0, 0.03), (5.6, 1.2, -0.04)):
		C.box('rug', (3.6, 6.6, 0.03), (x, y, 0.015), rug, root, rot=(0, 0, a), bevel_w=0.01)
		C.box('rug_in', (3.0, 6.0, 0.035), (x, y, 0.017), rug2, root, rot=(0, 0, a), bevel_w=0.01)
		C.box('rug_in2', (2.5, 5.5, 0.04), (x, y, 0.019), rug, root, rot=(0, 0, a), bevel_w=0.01)

	# reading tables; the two by the Gate are being dragged in
	tables = []
	tables.append(table('table_l1', (-5.6, -3.1, 0), (0, 0, 0.04), root, seed=1))
	tables.append(table('table_l2', (-5.7, 1.4, 0), (0, 0, -0.05), root, seed=2))
	tables.append(table('table_r1', (5.6, 3.0, 0), (0, 0, 0.06), root, seed=3))
	tables.append(table('table_r2', (5.5, -1.4, 0), (0, 0, -0.03), root, seed=4))
	tables.append(table('table_b', (0.6, 4.9, 0), (0, 0, 0.1), root, seed=5))
	tip = table('table_tip', (-2.75, -0.15, 0.2), (0.0, 0.42, 3.3), root, seed=6, lamps=False, dress=False, chairs=False)
	tables.append(tip)

	# set dressing
	globe('globe_a', 0.42, (-8.1, -6.2, 0), (0, 0, 0.5), root)
	globe('globe_b', 0.36, (8.0, 5.7, 0), (0, 0, 2.0), root)
	bust('bust_a', (-ex + 0.9, -7.6, 0), (0, 0, -1.2), root)
	bust('bust_b', (ex - 0.9, 5.2, 0), (0, 0, 2.2), root)
	bust('bust_c', (2.4, ey - 0.75, 0), (0, 0, 0.1), root)
	bust('bust_m1', (-3.0, HY - 0.9, MEZ_Z), (0, 0, 0.0), root)
	bust('bust_m2', (3.0, HY - 0.9, MEZ_Z), (0, 0, 0.0), root)
	card_catalogue('cards', (-2.6, ey - 0.75, 0), 0.0, root)
	card_catalogue('cards2', (ex - 0.8, -4.6, 0), -math.pi / 2, root)
	book_cart('cart_a', (-8.2, 4.2, 0), (0, 0, 0.5), root, 3)
	# a cart knocked over on the way to the Gate
	book_cart('cart_b', (-1.5, -3.5, 0.27), (-math.pi / 2, 0, 0.45), root, 8)
	for i, (x, y, a) in enumerate(((-0.7, -3.9, 0.3), (-1.0, -4.4, 1.2), (-0.3, -3.3, 2.0), (-1.9, -4.5, 0.7))):
		book('spilled', (0.22, 0.3, 0.06), i + 2, (x, y, 0.035), (0, 0, a), root)
	chandelier('chand_a', (-4.6, -1.0, 7.4), root, drop=H - 7.4)
	chandelier('chand_b', (4.6, 1.0, 7.4), root, drop=H - 7.4)
	chandelier('chand_c', (0.0, 5.2, 7.9), root, drop=H - 7.9, power=120)

	# books sliding toward the Gate and falling in
	r = C.rng(42)
	for _ in range(34):
		a = r.random() * 2 * math.pi
		d = outline.at(a) * (1.08 + r.random() ** 1.5 * 1.3)
		book('floor_book', (0.2 + r.random() * 0.08, 0.28 + r.random() * 0.08, 0.04 + r.random() * 0.04), int(r.integers(0, 10)), (math.cos(a) * d, math.sin(a) * d, 0.035 + r.random() * 0.02), (r.random() * 0.25, r.random() * 0.25, r.random() * 6), root)

	return dict(outline=outline, gate=gate, root=root, tables=tables, mez=(ex, ey))


def lights(sun=9.0, sky=2.6, fill=1.0):
	"""The sun through the windows, a pale sky outside and a soft warm fill inside."""
	C.set_world((0.62, 0.78, 1.0), sky)
	C.sun_light(tuple(-SUN_DIR * 60), (1.0, 0.86, 0.66), sun, angle=1.6)
	C.area_light((0, -1.0, H - 0.7), (0, -1.0, 0), (1.0, 0.86, 0.68), 1100 * fill, size=14.0, size_y=10.0, name='CeilingFill')
	C.area_light((0, -HY + 0.6, 4.5), (0, 2.0, 2.0), (1.0, 0.9, 0.78), 420 * fill, size=12.0, size_y=5.0, name='FrontFill')


def loose_pages(center, n=40, seed=9, spread=2.2, z0=0.4, z1=4.5, parent=None):
	"""Loose pages whirling over the Gate."""
	r = C.rng(seed)
	bm = bmesh.new()
	for _ in range(n):
		a = r.random() * 2 * math.pi
		d = spread * math.sqrt(r.random())
		p = Vector((center[0] + math.cos(a) * d, center[1] + math.sin(a) * d, z0 + r.random() * (z1 - z0)))
		mat = Matrix.Translation(p) @ Matrix.Rotation(r.random() * 6, 4, 'Z') @ Matrix.Rotation(r.random() * 6, 4, 'X') @ Matrix.Rotation(r.random() * 6, 4, 'Y')
		geom = bmesh.ops.create_grid(bm, x_segments=3, y_segments=1, size=0.5, matrix=mat @ Matrix.Diagonal((0.21, 0.29, 1, 1)))
		bend = r.random() * 0.06
		inv = mat.inverted()
		for v in geom['verts']:
			lc = inv @ v.co
			lc.z += bend * math.cos(lc.x / 0.105 * math.pi / 2)
			v.co = mat @ lc
	ob = C.obj_from_bm(bm, 'loose_pages', paper(), parent)
	return ob

