"""The Dance Club stage: a near-black hall lit by its own set.

The Gate is at the origin in the middle of the LED dance floor. +Y is the back (the stage with the
DJ booth and the screen wall), -X the bar, +X the raised lounge.
"""

from __future__ import annotations

import math

import bpy  # isort: skip
import bmesh
import numpy as np
from mathutils import Vector

import common as C
import gate as G

GREEN = (0.02, 1.0, 0.22)
CYAN = (0.0, 0.75, 1.0)
BLUE = (0.05, 0.22, 1.0)
MAGENTA = (1.0, 0.05, 0.62)
VIOLET = (0.5, 0.12, 1.0)

# ---------------------------------------------------------------------------------------------
# screen graphics (numpy paintings: no text, the deck adds labels)
# ---------------------------------------------------------------------------------------------


def _ss(e0, e1, x):
	t = np.clip((x - e0) / (e1 - e0), 0, 1)
	return t * t * (3 - 2 * t)


def screen_image(kind, seed=1, meter=0.6, w=1024, h=576):
	key = f'club_screen_{kind}_{seed}_{meter:.2f}'
	if key in bpy.data.images:
		return bpy.data.images[key]
	r = C.rng(seed)
	asp = w / h
	xs = np.linspace(-asp, asp, w, dtype=np.float32)
	ys = np.linspace(1, -1, h, dtype=np.float32)
	X, Y = np.meshgrid(xs, ys)
	rgb = np.zeros((h, w, 3), np.float32)

	def add(col, a):
		nonlocal rgb
		rgb = rgb + np.array(col, np.float32) * np.clip(a, 0, 1)[..., None]

	def mix(col, a):
		nonlocal rgb
		a = np.clip(a, 0, 1)[..., None]
		rgb = rgb * (1 - a) + np.array(col, np.float32) * a

	if kind == 'meter':
		# the Destruction meter: a horned head over a bar that fills red
		rgb[:] = np.array((0.10, 0.0, 0.16), np.float32)
		add((0.45, 0.0, 0.42), (1 - np.abs(Y)) * 0.6 * (0.6 + 0.4 * np.sin(Y * 90)))
		cy = 0.22
		head = np.sqrt(X**2 + ((Y - cy) * 1.05) ** 2) - 0.36
		horns = np.full_like(X, 9.0)
		for s in (-1, 1):
			a = np.sqrt((X - s * 0.40) ** 2 + (Y - cy - 0.36) ** 2) - 0.25
			b = np.sqrt((X - s * 0.27) ** 2 + (Y - cy - 0.50) ** 2) - 0.27
			horns = np.minimum(horns, np.maximum(a, -b))
		d = np.minimum(head, horns)
		add((1.0, 0.1, 0.55), np.exp(-np.abs(d) / 0.035) * 0.9)
		mix((1.0, 0.75, 0.9), _ss(0.012, 0.004, np.abs(d)))
		mix((0.30, 0.0, 0.18), _ss(0.0, -0.02, d) * 0.6)
		for s in (-1, 1):
			ex = (X - s * 0.15) * s
			ey = Y - cy - 0.02
			eye = np.maximum(np.sqrt((ex / 0.11) ** 2 + (ey / 0.075) ** 2) - 1, (ey - 0.02 - ex * 0.5) * 8)
			mix((1.0, 0.85, 0.2), _ss(0.05, -0.05, eye))
		grin = np.maximum(np.sqrt(X**2 + (Y - cy + 0.08) ** 2) - 0.2, -(np.sqrt(X**2 + (Y - cy + 0.0) ** 2) - 0.2))
		mix((1.0, 0.85, 0.2), _ss(0.01, -0.01, grin) * (Y < cy - 0.12))
		# the bar
		bx0, bx1, by0, by1 = -asp * 0.8, asp * 0.8, -0.78, -0.52
		inside = (X > bx0) & (X < bx1) & (Y > by0) & (Y < by1)
		frame = inside & ~((X > bx0 + 0.03) & (X < bx1 - 0.03) & (Y > by0 + 0.03) & (Y < by1 - 0.03))
		t = (X - bx0) / (bx1 - bx0)
		fill = inside & ~frame & (t < meter) & (np.mod(t * 24, 1.0) > 0.14)
		mix((0.05, 0.0, 0.08), inside.astype(np.float32))
		fillc = np.stack([np.ones_like(t), 0.75 * np.clip(1 - t / max(meter, 0.01), 0, 1) ** 1.5 * 0.9 + 0.05, 0.05 * np.ones_like(t)], axis=-1)
		rgb = np.where(fill[..., None], fillc, rgb)
		mix((0.6, 0.9, 1.0), frame.astype(np.float32))
	elif kind == 'viz':
		rgb[:] = np.array((0.04, 0.0, 0.10), np.float32)
		n = 22
		heights = 0.25 + 0.75 * r.random(n) * (0.5 + 0.5 * np.sin(np.linspace(0, math.pi, n)))
		u = (X / asp * 0.5 + 0.5) * n
		k = np.clip(u.astype(int), 0, n - 1)
		v = Y * 0.5 + 0.5
		on = (np.mod(u, 1.0) > 0.16) & (v < heights[k]) & (np.mod(v * 16, 1.0) > 0.2)
		col = np.stack([0.1 + 0.9 * v, 0.85 * (1 - v) + 0.05, np.ones_like(v)], axis=-1)
		rgb = np.where(on[..., None], col, rgb)
	else:  # rings
		d = np.sqrt(X**2 + Y**2)
		ang = np.arctan2(Y, X)
		band = 0.5 + 0.5 * np.sin(d * 22 - 1.0 + np.sin(ang * 6) * 0.6)
		rgb = np.stack([0.15 + 0.85 * band, 0.02 + 0.25 * (1 - band) * (d < 1.0), 0.45 + 0.55 * (1 - band)], axis=-1).astype(np.float32)
		rgb *= np.clip(1.25 - d * 0.5, 0.2, 1)[..., None]
	arr = np.dstack([np.clip(rgb, 0, 1), np.ones((h, w), np.float32)])
	return C.image_from_array(key, arr)


def screen_mat(kind, seed=1, meter=0.6, strength=1.5):
	img = screen_image(kind, seed, meter)
	return C.image_mat(f'mat_{img.name}_{strength}', img, rough=0.25, emit=strength, alpha=False, extension='EXTEND')


# ---------------------------------------------------------------------------------------------
# props
# ---------------------------------------------------------------------------------------------


def mirror_ball(r=0.4, parent=None, loc=(0, 0, 0), cable_to=None, name='mirror_ball'):
	root = C.empty(name, parent, loc)
	ball_mat = C.mat('mirror_ball', (0.92, 0.94, 1.0), rough=0.05, metal=1.0, emit=(0.45, 0.6, 1.0), emit_strength=0.1)
	ball = C.sphere('ball', r, (0, 0, 0), ball_mat, root, segs=30, rings=16, smooth=False)
	ball.rotation_euler = (0.1, 0.05, loc[0] * 1.7)
	C.cyl('ball_cap', r * 0.16, r * 0.12, (0, 0, r * 0.97), C.mat('chrome', (0.6, 0.6, 0.65), rough=0.2, metal=1.0), root, segs=16)
	if cable_to is not None:
		C.cyl('cable', 0.012, cable_to - loc[2] - r, (0, 0, r), C.mat('cable', (0.02, 0.02, 0.02), rough=0.6), root, segs=6)
	return root


def speaker(parent=None, loc=(0, 0, 0), rot=(0, 0, 0), size=(0.7, 0.6, 1.1), name='speaker'):
	root = C.empty(name, parent, loc, rot)
	sx, sy, sz = size
	C.box('cab', size, (0, 0, sz / 2), C.painted_mat('speaker_cab', (0.035, 0.035, 0.045), rough=0.6, scale=20, bump=0.2), root, bevel_w=0.035)
	cone_m = C.mat('speaker_cone', (0.015, 0.015, 0.02), rough=0.5)
	ring_m = C.mat('speaker_ring', CYAN, rough=0.3, emit=CYAN, emit_strength=1.6)
	for z, rr in ((sz * 0.34, min(sx, sz) * 0.36), (sz * 0.76, min(sx, sz) * 0.2)):
		C.cyl('cone', rr, 0.03, (0, -sy / 2 - 0.004, z), cone_m, root, rot=(math.pi / 2, 0, 0), segs=28, r2=rr * 0.9)
		C.torus('ring', rr, rr * 0.07, (0, -sy / 2 - 0.02, z), ring_m, root, rot=(math.pi / 2, 0, 0), segs=36, rsegs=8)
		C.sphere('dust', rr * 0.35, (0, -sy / 2 - 0.01, z), cone_m, root, scale=(1, 0.4, 1), segs=16, rings=8)
	return root


def bar_stool(parent=None, loc=(0, 0, 0), name='stool'):
	root = C.empty(name, parent, loc)
	white = C.mat('club_white', (0.85, 0.87, 0.9), rough=0.3, coat=0.4)
	chrome = C.mat('chrome', (0.6, 0.6, 0.65), rough=0.2, metal=1.0)
	C.cyl('base', 0.2, 0.03, (0, 0, 0), chrome, root, segs=24, bevel_w=0.01)
	C.cyl('stem', 0.028, 0.72, (0, 0, 0.03), chrome, root, segs=12)
	C.torus('foot', 0.15, 0.012, (0, 0, 0.3), chrome, root, segs=24, rsegs=6)
	C.sphere('seat', 0.2, (0, 0, 0.78), white, root, scale=(1, 1, 0.38), segs=24, rings=12)
	return root


def egg_chair(parent=None, loc=(0, 0, 0), rot_z=0.0, cushion=(0.0, 0.25, 0.9), name='egg_chair'):
	root = C.empty(name, parent, loc, (0, 0, rot_z))
	white = C.mat('club_white', (0.85, 0.87, 0.9), rough=0.3, coat=0.4)
	chrome = C.mat('chrome', (0.6, 0.6, 0.65), rough=0.2, metal=1.0)
	bm = bmesh.new()
	bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=1.0)
	# open the front: drop the cap facing -Y (tilted up a little)
	n = Vector((0, -0.92, 0.38)).normalized()
	bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.dot(n) > 0.42], context='VERTS')
	shell = C.obj_from_bm(bm, 'shell', white, root)
	shell.scale = (0.5, 0.5, 0.62)
	shell.location = (0, 0, 0.82)
	sol = shell.modifiers.new('Solid', 'SOLIDIFY')
	sol.thickness = 0.09
	sol.offset = -1
	C.subsurf(shell, 1)
	cm = C.painted_mat(f'cushion_{cushion}', cushion, rough=0.8, scale=30, bump=0.3, sheen=0.5)
	C.sphere('cushion', 1.0, (0, 0.0, 0.52), cm, root, scale=(0.36, 0.36, 0.12), segs=20, rings=10)
	C.sphere('cushion_back', 1.0, (0, 0.27, 0.86), cm, root, scale=(0.32, 0.1, 0.3), segs=20, rings=10)
	C.cyl('stem', 0.035, 0.22, (0, 0, 0.03), chrome, root, segs=12)
	C.cyl('base', 0.3, 0.03, (0, 0, 0), chrome, root, segs=28, bevel_w=0.01)
	return root


def round_table(parent=None, loc=(0, 0, 0), color=BLUE, name='table'):
	root = C.empty(name, parent, loc)
	white = C.mat('club_white', (0.85, 0.87, 0.9), rough=0.3, coat=0.4)
	C.cyl('top', 0.45, 0.06, (0, 0, 0.5), white, root, segs=32, bevel_w=0.02)
	C.torus('glow', 0.44, 0.014, (0, 0, 0.5), C.emit_mat(f'neon_{color}', color, 3.0), root, segs=40, rsegs=6)
	C.cyl('stem', 0.05, 0.5, (0, 0, 0), white, root, segs=16)
	C.cyl('base', 0.28, 0.03, (0, 0, 0), white, root, segs=28, bevel_w=0.01)
	return root


def bottle(parent, loc, color, h=0.3, name='bottle'):
	m = C.mat(f'bottle_{color}', color, rough=0.12, coat=0.6, emit=color, emit_strength=0.25)
	C.cyl(name, 0.04, h * 0.6, loc, m, parent, segs=10)
	C.cyl(name + '_n', 0.04, h * 0.18, (loc[0], loc[1], loc[2] + h * 0.6), m, parent, segs=10, r2=0.014)
	C.cyl(name + '_t', 0.014, h * 0.22, (loc[0], loc[1], loc[2] + h * 0.78), m, parent, segs=8)


def bottle_crate(parent=None, loc=(0, 0, 0), rot=(0, 0, 0), name='crate'):
	root = C.empty(name, parent, loc, rot)
	cm = C.painted_mat('crate', (0.02, 0.35, 0.75), rough=0.5, scale=14)
	C.box('crate_b', (0.5, 0.36, 0.05), (0, 0, 0.025), cm, root, bevel_w=0.012)
	for x, y, sx, sy in ((0, 0.165, 0.5, 0.03), (0, -0.165, 0.5, 0.03), (0.235, 0, 0.03, 0.36), (-0.235, 0, 0.03, 0.36)):
		C.box('crate_s', (sx, sy, 0.2), (x, y, 0.13), cm, root, bevel_w=0.01)
	cols = ((0.1, 0.6, 0.15), (0.75, 0.4, 0.05), (0.1, 0.5, 0.2))
	for i in range(4):
		for j in range(3):
			bottle(root, (-0.165 + i * 0.11, -0.11 + j * 0.11, 0.05), cols[(i + j) % 3], 0.3)
	return root


# ---------------------------------------------------------------------------------------------
# the room
# ---------------------------------------------------------------------------------------------

FLOOR_X, FLOOR_Y = 5.6, 5.0  # half size of the LED dance floor
ROOM = dict(x0=-13.0, x1=13.0, y0=-13.0, y1=12.5, h=8.2)


def neon(name, pts, color, strength=3.0, r=0.03, parent=None):
	ob = C.tube(name, pts, r, C.emit_mat(f'neon_{color}_{strength}', color, strength), parent, segs=8)
	ob.visible_shadow = False
	return ob


def build_club(heat=1.0, meter=0.6, gate_radius=1.9, gate_seed=4, hot_floor=4.6, beams=True, balls=True, gate=True, lasers=True, led_strength=0.5, gate_kw=None, floor_colors=(GREEN, (0.0, 0.85, 0.75))):
	"""Build the club. Returns dict(outline, balls=[(x, y, z, r)], root)."""
	root = C.empty('Club')
	r = C.rng(11)
	R = ROOM
	outline = G.Outline(gate_radius, seed=gate_seed)

	# floors
	hot = (hot_floor, (1.0, 0.07, 0.015)) if (gate and hot_floor) else None
	led = C.checker_emit_mat('club_led', floor_colors[0], floor_colors[1], 1 / 0.62, led_strength, hot=hot)
	dark = C.mat('club_floor', (0.012, 0.012, 0.018), rough=0.22, coat=0.3)
	if gate:
		G.floor_with_hole('led_floor', -FLOOR_X, FLOOR_X, -FLOOR_Y, FLOOR_Y, outline, led, parent=root)
	else:
		C.plane('led_floor', 2 * FLOOR_X, 2 * FLOOR_Y, (0, 0, 0), led, root)
	for x0, x1, y0, y1 in ((R['x0'], -FLOOR_X, R['y0'], R['y1']), (FLOOR_X, R['x1'], R['y0'], R['y1']), (-FLOOR_X, FLOOR_X, R['y0'], -FLOOR_Y), (-FLOOR_X, FLOOR_X, FLOOR_Y, R['y1'])):
		C.plane('floor', x1 - x0, y1 - y0, ((x0 + x1) / 2, (y0 + y1) / 2, 0), dark, root)
	e = 0.05
	neon('floor_edge', [(-FLOOR_X - e, -FLOOR_Y - e, 0.02), (FLOOR_X + e, -FLOOR_Y - e, 0.02), (FLOOR_X + e, FLOOR_Y + e, 0.02), (-FLOOR_X - e, FLOOR_Y + e, 0.02), (-FLOOR_X - e, -FLOOR_Y - e, 0.02)], CYAN, 2.5, 0.025, root)

	# walls and ceiling
	wall = C.painted_mat('club_wall', (0.018, 0.018, 0.035), (0.008, 0.008, 0.016), rough=0.7, scale=1.5, bump=0.2)
	H = R['h']
	C.plane('wall_back', R['x1'] - R['x0'], H, (0, R['y1'], H / 2), wall, root, rot=(math.pi / 2, 0, 0))
	C.plane('wall_front', R['x1'] - R['x0'], H, (0, R['y0'], H / 2), wall, root, rot=(-math.pi / 2, 0, 0))
	C.plane('wall_l', R['y1'] - R['y0'], H, (R['x0'], (R['y0'] + R['y1']) / 2, H / 2), wall, root, rot=(math.pi / 2, 0, -math.pi / 2))
	C.plane('wall_r', R['y1'] - R['y0'], H, (R['x1'], (R['y0'] + R['y1']) / 2, H / 2), wall, root, rot=(math.pi / 2, 0, math.pi / 2))
	C.plane('ceiling', R['x1'] - R['x0'], R['y1'] - R['y0'], (0, (R['y0'] + R['y1']) / 2, H), wall, root, rot=(math.pi, 0, 0))
	# neon lines along the side walls
	for z, col in ((2.6, CYAN), (2.9, BLUE), (5.4, VIOLET)):
		neon('wall_neon', [(R['x0'] + 0.05, R['y0'], z), (R['x0'] + 0.05, R['y1'], z)], col, 2.0, 0.035, root)
		neon('wall_neon', [(R['x1'] - 0.05, R['y0'], z), (R['x1'] - 0.05, R['y1'], z)], col, 2.0, 0.035, root)
	# wall panels: chunky padded squares behind the lounge and beside the stage
	pm = C.painted_mat('club_panel', (0.03, 0.03, 0.07), rough=0.5, scale=4, bump=0.3)
	for i in range(9):
		for j in range(2):
			C.box('panel', (0.12, 2.3, 1.9), (R['x1'] - 0.08, R['y0'] + 2.2 + i * 2.7, 3.9 + j * 2.4 - 2.6 * 0 if j else 1.3), pm, root, bevel_w=0.08)

	# the stage at the back
	sy0, sy1, sh, sx = 6.6, 10.6, 0.9, 7.2
	stage_m = C.painted_mat('club_stage', (0.03, 0.03, 0.05), rough=0.35, scale=5, coat=0.3)
	C.box('stage', (2 * sx, sy1 - sy0, sh), (0, (sy0 + sy1) / 2, sh / 2), stage_m, root, bevel_w=0.04)
	neon('stage_edge', [(-sx, sy0 - 0.03, sh - 0.04), (sx, sy0 - 0.03, sh - 0.04)], MAGENTA, 3.0, 0.035, root)
	neon('stage_edge2', [(-sx, sy0 - 0.03, 0.06), (sx, sy0 - 0.03, 0.06)], VIOLET, 2.0, 0.03, root)
	for i in range(3):
		C.box('step', (2.4, 0.4, sh * (3 - i) / 4), (0, sy0 - 0.2 - i * 0.4, sh * (3 - i) / 8), stage_m, root, bevel_w=0.03)
	# screen wall
	frame_m = C.mat('club_frame', (0.02, 0.02, 0.025), rough=0.4)
	ys = sy1 + 0.9

	def screen(name, w, h, loc, rot_z, kind, seed, strength=1.5):
		g = C.empty(name, root, loc, (0, 0, rot_z))
		C.box('frame', (w + 0.25, 0.18, h + 0.25), (0, 0.1, 0), frame_m, g, bevel_w=0.05)
		C.plane('img', w, h, (0, 0, 0), screen_mat(kind, seed, meter, strength), g, rot=(math.pi / 2, 0, 0))
		return g

	screen('screen_main', 6.6, 3.7, (0, ys, 4.0), 0, 'meter', 1, 1.5)
	screen('screen_l', 3.6, 3.0, (-6.4, ys - 0.5, 3.7), -0.38, 'viz', 2, 1.3)
	screen('screen_r', 3.6, 3.0, (6.4, ys - 0.5, 3.7), 0.38, 'viz', 3, 1.3)
	screen('screen_top', 11.0, 1.0, (0, ys - 0.2, 6.7), 0, 'rings', 4, 1.2)
	C.area_light((0, ys - 1.0, 4.0), (0, 0, 1.0), MAGENTA, 2600, size=6.0, size_y=3.4, parent=root, name='ScreenGlow').visible_glossy = False
	# curved LED columns framing the main screen
	col_m = screen_mat('rings', 5, meter, 1.4)
	for s in (-1, 1):
		pts = C.bezier((s * 3.75, ys - 0.3, sh), (s * 4.6, ys - 0.3, 3.0), (s * 3.3, ys - 0.5, 5.2), (s * 4.5, ys - 0.9, 7.6), 24)
		C.tube('led_column', pts, 0.42, col_m, root, segs=12, flat=0.35)

	# DJ booth
	booth = C.empty('dj_booth', root, (0, 8.6, sh))
	C.box('desk', (3.4, 0.95, 1.0), (0, 0, 0.5), stage_m, booth, bevel_w=0.06)
	C.plane('desk_front', 3.1, 0.75, (0, -0.48, 0.5), screen_mat('viz', 7, meter, 1.6), booth, rot=(math.pi / 2, 0, 0))
	C.box('desk_top', (3.6, 1.1, 0.07), (0, 0, 1.03), frame_m, booth, bevel_w=0.02)
	vinyl = C.mat('vinyl', (0.01, 0.01, 0.012), rough=0.25, coat=0.5)
	for x in (-1.0, 1.0):
		C.cyl('deck', 0.36, 0.06, (x, 0, 1.065), C.mat('deck', (0.2, 0.2, 0.22), rough=0.3, metal=0.8), booth, segs=28, bevel_w=0.01)
		C.cyl('record', 0.31, 0.012, (x, 0, 1.125), vinyl, booth, segs=32)
		C.cyl('label', 0.1, 0.004, (x, 0, 1.137), C.mat('label', MAGENTA, rough=0.5, emit=MAGENTA, emit_strength=0.6), booth, segs=20)
	C.box('mixer', (0.7, 0.6, 0.1), (0, 0, 1.11), frame_m, booth, bevel_w=0.02)
	for i in range(4):
		C.cyl('knob', 0.03, 0.04, (-0.22 + i * 0.15, 0.1, 1.16), C.emit_mat('knob', CYAN, 2.0), booth, segs=10)
	# the singer's mic stand, stage front
	chrome = C.mat('chrome', (0.6, 0.6, 0.65), rough=0.2, metal=1.0)
	C.cyl('mic_base', 0.2, 0.03, (-3.2, 7.2, sh), chrome, root, segs=20)
	C.cyl('mic_pole', 0.018, 1.45, (-3.2, 7.2, sh), chrome, root, segs=8)
	C.sphere('mic_head', 0.06, (-3.2, 7.17, sh + 1.5), C.mat('mic', (0.15, 0.15, 0.17), rough=0.4, metal=0.8), root, segs=12, rings=8)
	# speaker stacks
	for s in (-1, 1):
		speaker(root, (s * 6.1, 7.4, sh), (0, 0, -s * 0.25), (1.0, 0.8, 1.3))
		speaker(root, (s * 6.1, 7.4, sh + 1.3), (0, 0, -s * 0.25), (0.9, 0.7, 1.0))
		speaker(root, (s * 8.3, 6.2, 0), (0, 0, -s * 0.4), (1.1, 0.9, 1.5))

	# truss with moving heads
	truss_m = C.mat('truss', (0.05, 0.05, 0.06), rough=0.35, metal=0.9)
	tz = 6.9
	heads = []
	for y in (-3.0, 3.6):
		for dz in (0, 0.35):
			C.cyl('truss', 0.035, 15.0, (-7.5, y, tz + dz), truss_m, root, rot=(0, math.pi / 2, 0), segs=8)
		for i in range(22):
			x = -7.4 + i * 0.7
			C.tube('strut', [(x, y, tz), (x + 0.35, y, tz + 0.35), (x + 0.7, y, tz)], 0.015, truss_m, root, segs=6)
		for i in range(6):
			x = -6.2 + i * 2.5
			C.box('head_yoke', (0.3, 0.3, 0.2), (x, y, tz - 0.12), truss_m, root, bevel_w=0.03)
			C.sphere('head', 0.17, (x, y, tz - 0.33), truss_m, root, segs=16, rings=10)
			heads.append(Vector((x, y, tz - 0.4)))
	for x in (-7.5, 7.5):
		C.cyl('truss_x', 0.035, 6.6, (x, -3.0, tz), truss_m, root, rot=(-math.pi / 2, 0, 0), segs=8)

	if beams:
		cols = [GREEN, VIOLET, GREEN, CYAN, VIOLET, GREEN]
		for i, hp in enumerate(heads):
			col = cols[i % len(cols)]
			tx = hp.x * 0.3 + (r.random() - 0.5) * 9
			ty = (r.random() - 0.5) * 7 + (2.0 if hp.y < 0 else -2.0)
			target = Vector((tx, ty, 0))
			length = (target - hp).length * 1.05
			cone = C.open_cone('beam', 0.06, 0.55 + r.random() * 0.35, length, C.beam_mat(f'beam_{col}', col, 0.2), root, segs=20)
			C.aim(cone, hp, target)
			C.sphere('lens', 0.085, hp, C.emit_mat(f'lens_{col}', col, 6.0), root, segs=12, rings=8)
		# green laser fan from above the main screen
		lm = C.emit_mat('laser', GREEN, 2.5)
		src = Vector((0, ys - 0.6, 7.4))
		for i in range(9 if lasers else 0):
			a = (i - 4) * 0.2
			end = Vector((math.sin(a) * 13, -9.0, 2.0 + 1.4 * math.cos(a * 2.5)))
			lz = C.tube('laser', [src, end], 0.006, lm, root, segs=6)
			lz.visible_shadow = False

	# mirror balls over the floor, at several heights: only Devils reach them
	ball_list = []
	if balls:
		tries = 0
		ball_roots = []
		while len(ball_list) < 24 and tries < 400:
			tries += 1
			x = (r.random() - 0.5) * 2 * (FLOOR_X + 0.5)
			y = (r.random() - 0.5) * 2 * (FLOOR_Y + 0.5)
			rad = 0.26 + r.random() * 0.26
			z = 4.3 + r.random() * 2.2
			if math.hypot(x, y) < 1.4 and z < 5.2:
				continue
			if any(math.hypot(x - b[0], y - b[1]) < (rad + b[3]) * 1.5 for b in ball_list):
				continue
			ball_list.append((x, y, z, rad))
			ball_roots.append(mirror_ball(rad, root, (x, y, z), cable_to=H))
		# pin spots: small lights that only the balls see, so their facets glint
		pins = [C.point_light(p, c, 2200, radius=0.05, parent=root, name='PinSpot') for p, c in (((-5.5, -4.5, 3.4), (0.7, 0.9, 1.0)), ((5.5, -4.0, 3.6), (1.0, 0.6, 0.9)), ((0.0, 5.0, 3.2), (0.6, 1.0, 0.8)), ((-4.0, 4.0, 7.6), (1.0, 1.0, 1.0)), ((4.5, 1.0, 7.6), (0.8, 0.9, 1.0)))]
		C.light_only(pins, ball_roots)
		# the spots they throw on walls and ceiling
		sm = [C.emit_mat('spot_w', (0.8, 0.9, 1.0), 1.6), C.emit_mat('spot_c', CYAN, 1.6), C.emit_mat('spot_m', (1.0, 0.4, 0.8), 1.6)]
		bm = [bmesh.new() for _ in sm]
		from mathutils import Matrix

		for _ in range(260):
			k = int(r.integers(0, 3))
			s = 0.035 + r.random() * 0.05
			face = int(r.integers(0, 4))
			if face == 0:
				m = Matrix.Translation((R['x0'] + 0.02, R['y0'] + r.random() * (R['y1'] - R['y0']), 0.5 + r.random() * (H - 0.6))) @ Matrix.Rotation(math.pi / 2, 4, 'Y')
			elif face == 1:
				m = Matrix.Translation((R['x1'] - 0.14, R['y0'] + r.random() * (R['y1'] - R['y0']), 0.5 + r.random() * (H - 0.6))) @ Matrix.Rotation(-math.pi / 2, 4, 'Y')
			elif face == 2:
				m = Matrix.Translation((R['x0'] + r.random() * (R['x1'] - R['x0']), R['y1'] - 0.02, 0.5 + r.random() * (H - 0.6))) @ Matrix.Rotation(math.pi / 2, 4, 'X')
			else:
				m = Matrix.Translation((R['x0'] + r.random() * (R['x1'] - R['x0']), R['y0'] + r.random() * (R['y1'] - R['y0']), H - 0.02)) @ Matrix.Rotation(math.pi, 4, 'X')
			bmesh.ops.create_circle(bm[k], cap_ends=True, segments=8, radius=s, matrix=m)
		for k, b in enumerate(bm):
			ob = C.obj_from_bm(b, 'ball_spots', sm[k], root, smooth=False)
			ob.visible_shadow = False

	# the bar along -X: a glowing counter, a backlit bottle wall, stools
	bx = -9.3
	bar = C.empty('bar', root, (bx, -1.0, 0))
	bl = 13.0
	C.box('counter', (0.9, bl, 1.05), (0, 0, 0.525), C.mat('bar_body', (0.02, 0.02, 0.03), rough=0.3), bar, bevel_w=0.05)
	C.box('counter_glow', (0.06, bl - 0.3, 0.8), (0.46, 0, 0.5), C.emit_mat('bar_glow', (0.0, 0.7, 1.0), 1.25), bar, bevel_w=0.0)
	for i in range(26):
		C.box('slat', (0.05, 0.07, 0.86), (0.5, -bl / 2 + 0.35 + i * (bl - 0.7) / 25, 0.5), C.mat('bar_body', (0.02, 0.02, 0.03), rough=0.3), bar, bevel_w=0.01)
	C.box('counter_top', (1.15, bl + 0.2, 0.08), (0.05, 0, 1.09), C.mat('bar_top', (0.75, 0.9, 1.0), rough=0.15, coat=0.6, emit=(0.3, 0.8, 1.0), emit_strength=0.25), bar, bevel_w=0.03)
	wx = R['x0'] - bx + 0.4
	C.box('backbar', (0.5, bl, 3.6), (wx, 0, 1.8), C.mat('bar_body', (0.02, 0.02, 0.03), rough=0.3), bar, bevel_w=0.04)
	C.box('backlight', (0.04, bl - 0.6, 2.2), (wx + 0.27, 0, 2.2), C.emit_mat('bar_back', (0.02, 0.35, 1.0), 1.0), bar, bevel_w=0)
	bcols = ((0.05, 0.5, 0.2), (0.8, 0.45, 0.05), (0.6, 0.05, 0.1), (0.1, 0.3, 0.8), (0.75, 0.75, 0.8))
	for k, z in enumerate((1.3, 1.95, 2.6)):
		C.box('shelf', (0.3, bl - 0.6, 0.05), (wx + 0.4, 0, z), C.mat('bar_shelf', (0.7, 0.85, 1.0), rough=0.2, emit=(0.2, 0.7, 1.0), emit_strength=0.5), bar, bevel_w=0.01)
		for i in range(40):
			if r.random() < 0.12:
				continue
			bottle(bar, (wx + 0.4, -bl / 2 + 0.55 + i * (bl - 1.1) / 39, z + 0.025), bcols[int(r.integers(0, 5))], 0.26 + r.random() * 0.14)
	for i in range(9):
		bar_stool(bar, (1.15, -bl / 2 + 1.0 + i * (bl - 2.0) / 8, 0))
	neon('bar_cove', [(bx - 0.2, -1.0 - bl / 2, 4.4), (bx - 0.2, -1.0 + bl / 2, 4.4)], CYAN, 3.0, 0.05, root)
	neon('bar_foot', [(bx + 0.52, -1.0 - bl / 2, 0.04), (bx + 0.52, -1.0 + bl / 2, 0.04)], BLUE, 3.0, 0.03, root)
	C.area_light((bx + 1.2, -1.0, 2.2), (0, -1.0, 1.0), (0.1, 0.65, 1.0), 900, size=10.0, size_y=1.5, parent=root, name='BarGlow').visible_glossy = False

	# the raised lounge along +X
	lx0, ly0, ly1, lh = 7.9, -9.0, 5.2, 0.45
	lounge = C.empty('lounge', root, (0, 0, 0))
	C.box('lounge_floor', (R['x1'] - lx0, ly1 - ly0, lh), ((R['x1'] + lx0) / 2, (ly0 + ly1) / 2, lh / 2), C.mat('lounge_floor', (0.03, 0.03, 0.05), rough=0.3), lounge, bevel_w=0.03)
	neon('lounge_edge', [(lx0 - 0.03, ly0, lh - 0.03), (lx0 - 0.03, ly1, lh - 0.03)], BLUE, 3.5, 0.035, root)
	neon('lounge_edge2', [(lx0 - 0.03, ly0, 0.05), (lx0 - 0.03, ly1, 0.05)], CYAN, 2.5, 0.03, root)
	C.box('lounge_step', (0.5, 2.4, lh / 2), (lx0 - 0.25, -1.5, lh / 4), C.mat('lounge_floor', (0.03, 0.03, 0.05), rough=0.3), lounge, bevel_w=0.03)
	rug = C.painted_mat('lounge_rug', (0.05, 0.1, 0.5), (0.02, 0.03, 0.25), rough=0.9, scale=9, bump=0.4, sheen=0.5)
	for k, y in enumerate((-6.6, -2.2, 2.6)):
		C.cyl('rug', 1.9, 0.03, (10.2, y, lh), rug, lounge, segs=40)
		round_table(lounge, (10.2, y, lh + 0.03), BLUE if k != 1 else CYAN)
		egg_chair(lounge, (9.1, y - 0.9, lh + 0.03), -2.2, (0.0, 0.3, 0.95))
		egg_chair(lounge, (11.4, y - 0.5, lh + 0.03), 2.3, (0.9, 0.05, 0.45))
		egg_chair(lounge, (10.4, y + 1.25, lh + 0.03), 3.3, (0.0, 0.7, 0.8))
	# a long white sofa with a neon under-glow against the wall
	white = C.mat('club_white', (0.85, 0.87, 0.9), rough=0.3, coat=0.4)
	C.box('sofa', (0.9, 11.0, 0.42), (R['x1'] - 0.7, -2.0, lh + 0.3), white, lounge, bevel_w=0.12, segs=4)
	C.box('sofa_back', (0.3, 11.0, 0.9), (R['x1'] - 0.3, -2.0, lh + 0.75), white, lounge, bevel_w=0.12, segs=4)
	neon('sofa_neon', [(R['x1'] - 1.15, -7.5, lh + 0.06), (R['x1'] - 1.15, 3.5, lh + 0.06)], BLUE, 3.5, 0.03, root)
	C.area_light((10.4, -2.0, 4.2), (10.4, -2.0, 0), (0.15, 0.3, 1.0), 700, size=5.0, size_y=10.0, parent=root, name='LoungeGlow').visible_glossy = False

	# crates by the bar's end, for Devils to steal
	bottle_crate(root, (-7.6, -7.9, 0), (0, 0, 0.3))
	bottle_crate(root, (-7.9, -7.3, 0.36), (0, 0, -0.2))

	if gate:
		G.build_gate(outline, slab_mat=C.mat('club_slab', (0.015, 0.02, 0.022), rough=0.15, coat=0.6, emit=(0.0, 0.5, 0.2), emit_strength=0.12), heat=heat, **(gate_kw or {}))
	return dict(outline=outline, balls=ball_list, root=root, heads=heads)
