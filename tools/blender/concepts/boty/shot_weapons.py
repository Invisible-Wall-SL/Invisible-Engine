"""weapons_lineup.jpg: the six stage weapons on plinths, in the deck's order, no text.

Encyclopedia, Hardbacks (Library) · Mic stand, Vinyl records (Club) · Croupier's rake, Poker chips (Casino)
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402  (loads bpy before mathutils)
import weapons as W  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

SPACING = 1.0
PLINTH_H = 0.30
PLINTH_R = 0.34
# hero sized, not to scale: (scale, yaw in degrees, lean in degrees)
DISPLAY = {
	'encyclopedia': (1.78, 0, 0),
	'hardbacks': (2.0, -18, 0),
	'mic_stand': (0.99, 20, 0),
	'vinyl_records': (1.75, 0, 0),
	'croupier_rake': (1.15, 0, 0),
	'poker_chips': (2.15, 0, 0),
}


def build():
	C.reset_scene()
	C.set_world((0.012, 0.012, 0.018), 1.0)
	sweep = C.painted_mat('sweep', (0.035, 0.035, 0.045), (0.02, 0.02, 0.028), rough=0.5, scale=1.5, bump=0.0)
	C.plane('floor', 60, 40, (0, 8, 0), sweep)
	# the sweep: a quarter pipe from the floor into the back wall
	pts = [(0, 3.2 + 2.6 * math.sin(a), 2.6 - 2.6 * math.cos(a)) for a in [math.radians(4.5 * i) for i in range(21)]] + [(0, 5.8, 14)]
	import bmesh

	bm = bmesh.new()
	rows = [[bm.verts.new((x, p[1], p[2])) for x in (-30, 30)] for p in pts]
	for i in range(len(rows) - 1):
		bm.faces.new((rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]))
	C.obj_from_bm(bm, 'sweep', sweep, smooth=True)

	plinth = C.painted_mat('plinth', (0.06, 0.06, 0.075), (0.035, 0.035, 0.05), rough=0.3, scale=5.0, bump=0.05, coat=0.5)
	trim = C.mat('plinth_trim', (0.95, 0.60, 0.16), rough=0.3, metal=1.0)
	n = len(W.ORDER)
	for i, (key, fn) in enumerate(W.ORDER):
		x = (i - (n - 1) / 2) * SPACING
		C.cyl('plinth', PLINTH_R, PLINTH_H, (x, 0, 0), plinth, segs=64, bevel_w=0.02)
		C.cyl('plinth_foot', PLINTH_R + 0.03, 0.05, (x, 0, 0), plinth, segs=64, bevel_w=0.012)
		C.torus('plinth_trim', PLINTH_R - 0.008, 0.008, (x, 0, PLINTH_H - 0.035), trim, segs=64, rsegs=8)
		s, yaw, lean = DISPLAY[key]
		ob = fn()
		ob.scale = (s, s, s)
		if key == 'croupier_rake':
			# resting on its paddle, the handle rising across the plinth, raking a few chips
			h = Vector((0.6, 0.8, 0)).normalized()
			d = h * math.cos(math.radians(57)) + Vector((0, 0, math.sin(math.radians(57))))
			zax = -d
			xax = Vector((0, 0, 1)).cross(d).normalized()
			rot = Matrix((xax, zax.cross(xax), zax)).transposed()
			ob.rotation_euler = rot.to_euler()
			contact = Vector((x - 0.15, -0.14, PLINTH_H + 0.004))
			ob.location = contact - rot @ Vector((0, 0, 1.15 * s))
			for k, (cx, cy, cz, col) in enumerate(((0.02, -0.11, 0, (0.72, 0.02, 0.03)), (0.025, -0.105, 0.017, (0.03, 0.03, 0.04)), (0.16, -0.06, 0, (0.02, 0.36, 0.12)), (-0.09, -0.19, 0, (0.03, 0.16, 0.62)))):
				chip = W._chip(None, col, f'raked{k}', r=0.058, h=0.017)
				chip.location = (x + cx, cy, PLINTH_H + cz)
		else:
			ob.location = (x, 0, PLINTH_H)
			ob.rotation_euler = (0, math.radians(lean), math.radians(yaw))
		# a soft pool of light on each one
		C.spot_light((x - 0.35, -2.6, 3.3), (x, 0, PLINTH_H + 0.45), (1.0, 0.95, 0.88), 240, angle=22, blend=0.7, radius=0.35, name='Pool')

	span = SPACING * (n - 1)
	C.area_light((0, -5.0, 3.6), (0, 0, 0.8), (1.0, 0.96, 0.92), 620, size=span + 3, size_y=2.5, name='Key')
	C.area_light((-span / 2 - 2.6, 2.6, 2.0), (0, 0, 0.9), (1.0, 0.06, 0.04), 2600, size=3.0, size_y=2.2, name='RimRed')
	C.area_light((span / 2 + 2.6, 2.6, 2.0), (0, 0, 0.9), (0.0, 0.75, 1.0), 2600, size=3.0, size_y=2.2, name='RimCyan')
	# rims from behind, so every prop gets a red edge on one side and a cyan edge on the other
	for i in range(n):
		x = (i - (n - 1) / 2) * SPACING
		C.area_light((x - 0.75, 1.5, 1.5), (x, 0, PLINTH_H + 0.5), (1.0, 0.05, 0.03), 130, size=0.5, size_y=1.6, name='EdgeRed')
		C.area_light((x + 0.75, 1.5, 1.5), (x, 0, PLINTH_H + 0.5), (0.0, 0.7, 1.0), 130, size=0.5, size_y=1.6, name='EdgeCyan')
	C.camera((0, -17.6, 1.42), (0, 0, 0.93), lens=100)


if __name__ == '__main__':
	a = C.parse_args('weapons_lineup')
	build()
	C.render(a, 1800, 620, 96, exposure=-0.3)
