"""The six stage weapons of Battle of the Year, as hero props.

Every builder returns an empty with the model standing on z = 0, centred on the origin in XY, at
its natural size (a shot scales it). No text anywhere: the deck adds labels.

    Library  encyclopedia()   hardbacks()       melee / thrown
    Club     mic_stand()      vinyl_records()
    Casino   croupier_rake()  poker_chips()
"""

from __future__ import annotations

import math

import common as C

GOLD = (0.95, 0.60, 0.16)


def _gold():
	return C.mat('wpn_gold', GOLD, rough=0.28, metal=1.0)


def _chrome():
	return C.mat('wpn_chrome', (0.75, 0.78, 0.82), rough=0.18, metal=1.0)


def _paper():
	return C.painted_mat('wpn_paper', (0.93, 0.86, 0.68), (0.80, 0.70, 0.50), rough=0.7, scale=40.0, bump=0.25)


def _book(parent, w, d, h, cover, name='book', bands=3, emblem=True, ribbon=None):
	"""A hardback standing on its bottom edge: width on X, thickness on Y, spine on -X, front on -Y."""
	root = C.empty(name, parent)
	gold = _gold()
	C.box('pages', (w - 0.035, d - 0.03, h - 0.03), (0.012, 0, h / 2), _paper(), root, bevel_w=0.006)
	for s in (-1, 1):
		C.box('board', (w, 0.016, h), (0, s * (d / 2 - 0.008), h / 2), cover, root, bevel_w=0.007)
	spine = C.cyl('spine', d / 2, h, (-w / 2 + 0.012, 0, 0), cover, root, segs=28, bevel_w=0.006)
	spine.scale = (0.42, 1.0, 1.0)
	for k in range(bands):
		z = h * (0.16 + 0.68 * k / max(bands - 1, 1))
		b = C.cyl('band', d / 2 + 0.006, 0.02, (-w / 2 + 0.012, 0, z - 0.01), gold, root, segs=28, bevel_w=0.004)
		b.scale = (0.46, 1.0, 1.0)
	cs = min(w, h) * 0.17
	for sz in (0, 1):
		C.box('corner', (cs, 0.006, cs), (w / 2 - cs / 2 + 0.003, -d / 2 - 0.001, cs / 2 - 0.003 if sz == 0 else h - cs / 2 + 0.003), gold, root, bevel_w=0.003)
	if emblem:
		r = min(w, h) * 0.2
		C.torus('emblem', r, 0.008, (0.01, -d / 2 - 0.001, h / 2), gold, root, rot=(math.pi / 2, 0, 0), segs=40, rsegs=10)
		C.box('gem', (r * 0.75, 0.01, r * 0.75), (0.01, -d / 2 - 0.001, h / 2), gold, root, rot=(0, math.pi / 4, 0), bevel_w=0.004)
	if ribbon is not None:
		C.box('ribbon', (0.022, 0.004, 0.09), (w * 0.12, 0.0, 0.02), ribbon, root, rot=(0.25, 0, 0.1), bevel_w=0.0015)
	return root


def encyclopedia(parent=None):
	"""The Library's melee weapon: one huge, heavy tome. 0.36 x 0.13 x 0.47 m, standing."""
	root = C.empty('Encyclopedia', parent)
	cover = C.painted_mat('wpn_enc_cover', (0.42, 0.035, 0.05), (0.22, 0.012, 0.03), rough=0.5, scale=14.0, bump=0.3, coat=0.2)
	b = _book(root, 0.36, 0.13, 0.47, cover, bands=4, ribbon=C.mat('wpn_ribbon', (0.02, 0.45, 0.42), rough=0.5))
	b.rotation_euler = (0, 0, math.radians(-28))
	return root


def hardbacks(parent=None):
	"""The Library's thrown weapon: a stack of three hardbacks, lying flat and a little askew."""
	root = C.empty('Hardbacks', parent)
	covers = (
		C.painted_mat('wpn_hb_teal', (0.02, 0.42, 0.40), (0.01, 0.24, 0.26), rough=0.5, scale=14.0, bump=0.3, coat=0.15),
		C.painted_mat('wpn_hb_orange', (0.90, 0.30, 0.04), (0.60, 0.15, 0.02), rough=0.5, scale=14.0, bump=0.3, coat=0.15),
		C.painted_mat('wpn_hb_cream', (0.88, 0.72, 0.38), (0.62, 0.46, 0.2), rough=0.55, scale=14.0, bump=0.3, coat=0.1),
	)
	z = 0.0
	for i, (dims, yaw, off) in enumerate((((0.30, 0.075, 0.22), 8, (0, 0)), ((0.27, 0.065, 0.20), -14, (0.012, -0.008)), ((0.24, 0.055, 0.17), 20, (-0.01, 0.006)))):
		w, d, h = dims
		tilt = C.empty('lay', root, loc=(off[0], off[1], z), rot=(0, 0, math.radians(yaw)))
		b = _book(tilt, w, d, h, covers[i], bands=2, emblem=(i == 2))
		# lay it down: the front cover faces up, the book centred on the stack's axis
		b.rotation_euler = (math.radians(-90), 0, 0)
		b.location = (0, -h / 2, d / 2)
		z += d
	return root


def mic_stand(parent=None):
	"""The Club's melee weapon: a straight stand on a heavy round base, pole on +Z, 1.5 m tall."""
	root = C.empty('MicStand', parent)
	dark = C.mat('wpn_gunmetal', (0.045, 0.05, 0.06), rough=0.32, metal=0.9)
	chrome = _chrome()
	C.cyl('base', 0.21, 0.04, (0, 0, 0), dark, root, segs=48, bevel_w=0.016)
	C.sphere('dome', 0.14, (0, 0, 0.036), dark, root, scale=(1, 1, 0.32))
	C.cyl('pole_low', 0.026, 0.78, (0, 0, 0.04), chrome, root, segs=20)
	C.cyl('clutch', 0.042, 0.11, (0, 0, 0.78), dark, root, segs=24, bevel_w=0.012)
	C.torus('clutch_ring', 0.042, 0.008, (0, 0, 0.835), C.emit_mat('wpn_mic_ring', (1.0, 0.05, 0.55), 1.2), root, segs=28, rsegs=8)
	C.cyl('pole_high', 0.018, 0.46, (0, 0, 0.87), chrome, root, segs=16)
	clip = C.empty('clip', root, loc=(0, 0, 1.33), rot=(math.radians(52), 0, 0))
	C.cyl('holder', 0.04, 0.09, (0, 0, -0.015), dark, clip, segs=20, bevel_w=0.008)
	C.cyl('handle', 0.028, 0.22, (0, 0, -0.09), C.mat('wpn_mic_body', (0.10, 0.10, 0.12), rough=0.35, metal=0.6), clip, segs=20, r2=0.036, bevel_w=0.005)
	C.cyl('collar', 0.04, 0.028, (0, 0, 0.128), chrome, clip, segs=24, bevel_w=0.005)
	grille = _grille_mat()
	C.sphere('head', 0.07, (0, 0, 0.20), grille, clip, scale=(1, 1, 1.08))
	C.torus('head_band', 0.0705, 0.007, (0, 0, 0.20), chrome, clip, segs=32, rsegs=8)
	return root


def _grille_mat():
	if 'wpn_grille' in C._MATS:
		return C._MATS['wpn_grille']
	m, nt, p = C._new_mat('wpn_grille')
	tc = nt.nodes.new('ShaderNodeTexCoord')
	vor = nt.nodes.new('ShaderNodeTexVoronoi')
	vor.inputs['Scale'].default_value = 170.0
	nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
	bmp = nt.nodes.new('ShaderNodeBump')
	bmp.inputs['Strength'].default_value = 0.8
	bmp.inputs['Distance'].default_value = 0.002
	nt.links.new(vor.outputs['Distance'], bmp.inputs['Height'])
	nt.links.new(bmp.outputs['Normal'], p.inputs['Normal'])
	p.inputs['Base Color'].default_value = (0.62, 0.64, 0.68, 1)
	p.inputs['Metallic'].default_value = 1.0
	p.inputs['Roughness'].default_value = 0.3
	C._MATS['wpn_grille'] = m
	return m


def _vinyl_mat(name, color):
	if name in C._MATS:
		return C._MATS[name]
	m, nt, p = C._new_mat(name)
	tc = nt.nodes.new('ShaderNodeTexCoord')
	wave = nt.nodes.new('ShaderNodeTexWave')
	wave.wave_type = 'RINGS'
	wave.rings_direction = 'Z'
	wave.inputs['Scale'].default_value = 70.0
	wave.inputs['Distortion'].default_value = 0.0
	nt.links.new(tc.outputs['Object'], wave.inputs['Vector'])
	bmp = nt.nodes.new('ShaderNodeBump')
	bmp.inputs['Strength'].default_value = 0.4
	bmp.inputs['Distance'].default_value = 0.001
	nt.links.new(wave.outputs['Fac'], bmp.inputs['Height'])
	nt.links.new(bmp.outputs['Normal'], p.inputs['Normal'])
	ramp = nt.nodes.new('ShaderNodeValToRGB')
	ramp.color_ramp.elements[0].color = (*[c * 0.62 for c in color], 1)
	ramp.color_ramp.elements[1].color = (*color, 1)
	nt.links.new(wave.outputs['Fac'], ramp.inputs['Fac'])
	nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
	p.inputs['Roughness'].default_value = 0.36
	p.inputs['Coat Weight'].default_value = 0.12
	p.inputs['Coat Roughness'].default_value = 0.2
	C._MATS[name] = m
	return m


def vinyl_records(parent=None):
	"""The Club's thrown weapon: five coloured records standing on edge, fanned like a hand of cards."""
	root = C.empty('VinylRecords', parent)
	colors = ((0.17, 0.012, 0.52), (0.0, 0.27, 0.55), (0.02, 0.36, 0.05), (0.78, 0.22, 0.01), (0.66, 0.008, 0.19))
	r = 0.155
	label = C.mat('wpn_label', (0.93, 0.90, 0.82), rough=0.5)
	dark = C.mat('wpn_hole', (0.02, 0.02, 0.025), rough=0.5)
	for i in range(5):
		t = i - 2
		# back to front: each one steps forward and turns a little more
		disc = C.empty('record', root, loc=(t * 0.068, t * -0.03, r), rot=(math.radians(90 - 10), 0, math.radians(t * -9)))
		C.cyl('disc', r, 0.008, (0, 0, -0.004), _vinyl_mat(f'wpn_vinyl_{i}', colors[i]), disc, segs=72, bevel_w=0.0025)
		C.cyl('label', r * 0.40, 0.010, (0, 0, -0.005), label, disc, segs=40)
		C.cyl('label_ring', r * 0.30, 0.0108, (0, 0, -0.0054), dark, disc, segs=40)
		C.cyl('label_in', r * 0.24, 0.0114, (0, 0, -0.0057), label, disc, segs=40)
		C.cyl('hole', r * 0.045, 0.012, (0, 0, -0.006), dark, disc, segs=16)
	return root


def croupier_rake(parent=None):
	"""The Casino's melee weapon: a long handle on +Z with the flat paddle at the top, 1.15 m."""
	root = C.empty('CroupierRake', parent)
	wood = C.wood_mat('wpn_rake_wood', (0.50, 0.17, 0.05), (0.27, 0.07, 0.02), rough=0.38, axis='Z', coat=0.4)
	lacquer = C.painted_mat('wpn_rake_head', (0.34, 0.02, 0.035), (0.18, 0.008, 0.02), rough=0.3, scale=10.0, bump=0.1, coat=0.6)
	gold = _gold()
	C.sphere('pommel', 0.037, (0, 0, 0.03), gold, root)
	C.cyl('handle', 0.024, 0.96, (0, 0, 0.04), wood, root, segs=20, r2=0.019)
	C.cyl('grip', 0.029, 0.22, (0, 0, 0.06), C.painted_mat('wpn_rake_grip', (0.02, 0.24, 0.10), (0.01, 0.13, 0.05), rough=0.6, scale=60.0, bump=0.4), root, segs=20, bevel_w=0.006)
	C.cyl('ferrule', 0.026, 0.07, (0, 0, 0.96), gold, root, segs=20, bevel_w=0.005)
	head = C.empty('head', root, loc=(0, 0, 1.03), rot=(math.radians(-14), 0, 0))
	C.box('paddle', (0.40, 0.03, 0.125), (0, 0, 0.058), lacquer, head, bevel_w=0.02, segs=4)
	C.box('edge', (0.41, 0.036, 0.02), (0, 0, 0.12), gold, head, bevel_w=0.006)
	C.box('neck', (0.06, 0.03, 0.05), (0, 0, 0.0), gold, head, bevel_w=0.01)
	return root


def _chip(parent, color, name='chip', r=0.1, h=0.026):
	root = C.empty(name, parent)
	body = C.painted_mat(f'wpn_chip_{name}', color, tuple(c * 0.78 for c in color), rough=0.55, scale=18.0, bump=0.08)
	white = C.mat('wpn_chip_white', (0.86, 0.82, 0.72), rough=0.55)
	C.cyl('body', r, h, (0, 0, 0), body, root, segs=48, bevel_w=0.005)
	C.cyl('ring', r * 0.72, h + 0.0016, (0, 0, -0.0008), white, root, segs=48)
	C.cyl('face', r * 0.62, h + 0.003, (0, 0, -0.0015), body, root, segs=48)
	C.cyl('pip', r * 0.2, h + 0.0045, (0, 0, -0.00225), _gold(), root, segs=6)
	for k in range(6):
		a = 2 * math.pi * k / 6
		C.box('inlay', (0.03, r * 0.5, h * 0.72), (math.cos(a) * r * 0.775, math.sin(a) * r * 0.775, h / 2), white, root, rot=(0, 0, a + math.pi / 2), bevel_w=0.004)
	return root


def poker_chips(parent=None):
	"""The Casino's thrown weapon: a stack of eight chips, with a few more leaning against it."""
	root = C.empty('PokerChips', parent)
	cols = {'red': (0.72, 0.02, 0.03), 'green': (0.02, 0.36, 0.12), 'black': (0.03, 0.03, 0.04), 'blue': (0.03, 0.16, 0.62)}
	order = ('red', 'red', 'black', 'green', 'red', 'blue', 'black', 'red')
	r = C.rng(11)
	h = 0.026
	for i, c in enumerate(order):
		ch = _chip(root, cols[c], c)
		ch.location = ((r.random() - 0.5) * 0.01, (r.random() - 0.5) * 0.01, i * h)
		ch.rotation_euler = (0, 0, r.random() * 6)
	lean = _chip(root, cols['red'], 'red')
	lean.location = (0.135, -0.075, 0.068)
	lean.rotation_euler = (math.radians(70), 0, math.radians(62))
	lean2 = _chip(root, cols['blue'], 'blue')
	lean2.location = (-0.15, -0.06, 0.062)
	lean2.rotation_euler = (math.radians(72), 0, math.radians(-66))
	flat = _chip(root, cols['green'], 'green')
	flat.location = (0.02, -0.19, 0.0)
	flat.rotation_euler = (0, 0, 0.4)
	return root


ORDER = (
	('encyclopedia', encyclopedia),
	('hardbacks', hardbacks),
	('mic_stand', mic_stand),
	('vinyl_records', vinyl_records),
	('croupier_rake', croupier_rake),
	('poker_chips', poker_chips),
)

__all__ = ['ORDER', 'croupier_rake', 'encyclopedia', 'hardbacks', 'mic_stand', 'poker_chips', 'vinyl_records']
