"""stage_casino.jpg: the Casino, the roulette table going into the Hell Gate, Devils looting the floor."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
import devil as D  # noqa: E402
import stage_casino as S  # noqa: E402


def chip_rack(parent, loc):
	"""A croupier's chip tray, full."""
	root = C.empty('rack', parent, loc, (math.radians(12), 0, 0))
	C.box('tray', (0.62, 0.30, 0.05), (0, 0, 0), S.dark_wood(), root, bevel_w=0.015)
	C.box('tray_lip', (0.66, 0.34, 0.03), (0, 0, -0.02), S.gold(), root, bevel_w=0.01)
	for i in range(5):
		for j in range(2):
			S.chip_stack(7 + (i * 3 + j * 5) % 6, root, (-0.24 + i * 0.12, -0.07 + j * 0.14, 0.025))
	return root


def chip_armful(parent, loc, seed=1):
	"""A heap of loose chips hugged against the belly."""
	r = C.rng(seed)
	root = C.empty('armful', parent, loc)
	for _ in range(46):
		a = r.random() * 2 * math.pi
		d = r.random() ** 0.7 * 0.19
		z = (0.19 - d) * r.random() * 1.1
		S.chip(root, (math.cos(a) * d * 1.3, math.sin(a) * d * 0.8, z), tuple((r.random(3) - 0.5) * 1.6), 1.25)
	return root


def chip_trail(start, end, n, seed, spread=0.35, scale=1.3):
	"""Loose chips tumbling through the air between two points."""
	r = C.rng(seed)
	a, b = (C.Vector(start), C.Vector(end))
	for i in range(n):
		t = (i + r.random()) / n
		p = a.lerp(b, t)
		p.z -= 1.4 * t * t * 0.5 - 0.0
		off = (r.random(3) - 0.5) * spread * (0.4 + t)
		S.chip(None, (p.x + off[0], p.y + off[1], p.z + off[2]), tuple(r.random(3) * 6.2), scale)


def floor_chips(center, n, seed, radius=1.6, keep_out=None):
	"""Chips spilt on the carpet."""
	r = C.rng(seed)
	for _ in range(n):
		a = r.random() * 2 * math.pi
		d = math.sqrt(r.random()) * radius
		x, y = center[0] + math.cos(a) * d, center[1] + math.sin(a) * d
		if keep_out is not None and math.hypot(x, y) < keep_out(math.atan2(y, x)) + 0.12:
			continue
		if r.random() < 0.25:
			S.chip_stack(int(2 + r.random() * 5), None, (x, y, 0.0))
		else:
			S.chip(None, (x, y, 0.0), (0, 0, r.random() * 6), 1.2)


def scene():
	C.reset_scene()
	room = S.build_casino(gate_radius=2.3, heat=1.0)
	outline = room['outline']

	# --- the slot machine heist: one Devil hauls it by the topper, one shoves the base ---
	rig = C.empty('heist', loc=(3.5, -1.5, 1.85), rot=(0, 0, math.radians(-50)))
	tilt = math.radians(32)
	m = S.inst(room['slot_masters']['gold'], (0, 0, 0), 0, rig)
	m.rotation_euler = (math.radians(-10), tilt, 0)
	top = C.Vector((math.sin(tilt) * 2.12, 0.03, math.cos(tilt) * 2.12))
	D.build_devil('hang', rig, (top.x + 0.03, top.y + 0.02, top.z + 0.20), (0, 14, 0), origin='center', name='DevilHaul', look=(0.004, -0.006), hand_l=(0.265, -0.10, 0.30), hand_r=(-0.265, -0.10, 0.30), head=(12, 0, -10))
	D.build_devil('carry', rig, (-0.82, -0.25, 0.32), (0, -18, 62), origin='center', name='DevilShove', mood='strain', head=(-8, 0, -48), hand_l=(0.20, -0.27, 0.42), hand_r=(-0.20, -0.27, 0.30))
	
	# --- chip rack, flying in from the left toward the Gate ---
	rack = D.build_devil('carry', None, (-4.75, -3.9, 2.55), (-8, 0, 34), origin='center', name='DevilRack', look=(0.008, -0.004), head=(4, 0, 6))
	chip_rack(rack, (0, -0.33, -0.06))
	chip_trail((-5.0, -3.8, 2.4), (-5.6, -3.2, 1.6), 6, 4, 0.25)

	# --- an armful of chips, low over the near rim, about to drop them in ---
	arm = D.build_devil('carry', None, (1.25, -3.3, 1.55), (-16, 0, -22), origin='center', name='DevilArmful', head=(8, 0, 26), look=(-0.006, 0.0))
	chip_armful(arm, (0, -0.30, -0.14), 3)
	chip_trail((1.2, -3.1, 1.3), (0.5, -1.6, 0.9), 14, 8, 0.4)

	# --- climbing out of the Gate at the near rim ---
	az = math.radians(-118)
	rim = outline.at(az)
	D.build_devil('climb', None, (math.cos(az) * (rim - 0.33), math.sin(az) * (rim - 0.33), -0.47), (-14, 0, math.degrees(az) + 90 + 12), name='DevilClimb', head=(-10, 0, 8))

	# --- bursting out above the pit ---
	D.build_devil('burst', None, (0.55, -0.5, 3.05), (-18, 6, 30), origin='center', name='DevilBurst', mood='wide', head=(10, 0, -12))

	# chips spilt by the roulette table and round the pit
	floor_chips((-1.6, 3.0), 60, 2, 1.9, outline.at)
	floor_chips((-1.0, -2.6), 40, 6, 1.5, outline.at)
	chip_trail((-1.0, 2.5, 1.2), (-0.1, 0.5, 0.7), 16, 12, 0.7, 1.4)

	# the Gate's red wash over what stands near it
	C.point_light((0, 0, 1.7), (1.0, 0.16, 0.03), 1700, radius=1.2, name='GateWash')

	# light: a soft warm fill from the camera side so faces read, a cool rim to lift red off red
	C.area_light((-6.5, -9.0, 4.4), (0.0, -1.5, 2.0), (1.0, 0.86, 0.70), 750, size=4.0, name='Fill')
	C.area_light((9.0, 6.0, 5.6), (1.5, -1.0, 2.4), (0.45, 0.80, 1.0), 1500, size=3.0, name='RimCool')
	C.area_light((-9.5, 7.0, 5.2), (-1.5, 0.0, 2.6), (1.0, 0.72, 0.35), 900, size=3.0, name='RimWarm')

	C.camera((-5.6, -7.6, 2.9), (0.9, 0.5, 1.75), lens=23)


if __name__ == '__main__':
	args = C.parse_args('stage_casino')
	scene()
	C.render(args, 1920, 1080, 80, exposure=-0.4)
