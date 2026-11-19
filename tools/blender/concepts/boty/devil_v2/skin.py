"""Devil v2: skin weights worked out from the cage's tags, not painted.

Every cage vertex knows its part, its chain and its parameter `t` along that chain, so a weight is
a smooth window over the bones of the chain, plus a blend into the parent at each limb's root.
The cage is weighted, then subdivided: the modifier interpolates the weights onto `LOD0`.
"""

from __future__ import annotations

import math

from mathutils import Vector

import meshkit as MK
import spec as S

SPINE = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head']
PARTS = ['trunk', 'head', 'nose', 'eyelid', 'mouth', 'crest', 'ear', 'arm', 'hand', 'finger', 'leg', 'foot', 'toe', 'tail']


def chain(names, t, b=0.3):
	"""Bone k owns [k, k+1]; neighbours cross-fade over 2b round each joint."""
	out = {}
	n = len(names)
	for k, name in enumerate(names):
		lo = 1.0 if k == 0 else MK.smooth(k - b, k + b, t)
		hi = 0.0 if k == n - 1 else MK.smooth(k + 1 - b, k + 1 + b, t)
		if lo - hi > 1e-4:
			out[name] = lo - hi
	return out


def blend(w, other, f):
	"""w * (1 - f) + other * f, for weight dicts."""
	out = {k: v * (1 - f) for k, v in w.items()}
	for k, v in other.items():
		out[k] = out.get(k, 0.0) + v * f
	return {k: v for k, v in out.items() if v > 1e-4}


def jaw_share(tags):
	col = abs(tags.get('col', 99))
	ring = tags.get('ring')
	if tags.get('part') == 'mouth':
		return tags.get('jawf', 0.0) * (1 - MK.smooth(4.5, 6.5, col))
	if ring == 'throat':
		return 0.55 * (1 - MK.smooth(4.0, 7.0, col))
	if ring in ('jaw', 'chin'):
		return 1 - MK.smooth(5.0, 7.5, col)
	if ring == 'lip_lo':
		return 1 - MK.smooth(4.5, 6.5, col)
	return 0.0


def vertex_weights(tags, p):
	part, ch, t = tags['part'], tags.get('chain'), tags.get('t', 0.0)
	side = tags.get('side', 'c')
	sfx = '_r' if side == 'r' else '_l'
	sx = -1.0 if side == 'r' else 1.0

	def J(name):
		j = S.J[name]
		return Vector((j[0] * sx, j[1], j[2]))

	if ch == 'spine':
		# the belly hangs far from the spine: a short cross-fade would crease it, so the fade
		# widens with the distance from the spine's axis (the back keeps the tight one)
		reach = math.hypot(p.x, p.y - 0.02) if part == 'trunk' else 0.0
		w = chain(SPINE, t, min(0.35 + 3.2 * max(reach - 0.07, 0.0), 0.9))
		if part in ('head', 'mouth'):
			f = jaw_share(tags)
			if f > 0:
				w = blend(w, {'jaw': 1.0}, f * w.get('head', 0.0) / max(sum(w.values()), 1e-6))
		if part == 'trunk':
			if side != 'c' and p.z > 0.58:
				f = 1 - MK.smooth(0.035, 0.105, (p - J('upperarm')).length)
				w = blend(w, {'clavicle' + sfx: 1.0}, f * 0.85)
			if side != 'c' and p.z < 0.46:
				f = 1 - MK.smooth(0.030, 0.085, (p - J('thigh')).length)
				w = blend(w, {'thigh' + sfx: 1.0}, f * 0.6)
			f = 1 - MK.smooth(0.030, 0.075, (p - Vector(S.TAIL[0])).length)
			if f > 0:
				w = blend(w, {'tail_01': 1.0}, f * 0.5)
		return w
	if ch == 'ear':
		return blend({'head': 1.0}, {'ear' + sfx: 1.0}, MK.smooth(0.0, 0.3, t))
	if ch == 'arm':
		w = chain(['upperarm' + sfx, 'lowerarm' + sfx, 'hand' + sfx], t, 0.22)
		return blend(w, {'clavicle' + sfx: 1.0}, (1 - MK.smooth(0.0, 0.45, t)) * 0.5)
	if ch in ('finger1', 'finger2', 'finger3', 'finger4', 'thumb'):
		return chain(['hand' + sfx, f'{ch}_01{sfx}', f'{ch}_02{sfx}'], t + 1.0, 0.28)
	if ch == 'leg':
		w = chain(['thigh' + sfx, 'calf' + sfx, 'foot' + sfx, 'ball' + sfx], t, 0.2)
		return blend(w, {'pelvis': 1.0}, (1 - MK.smooth(0.0, 0.45, t)) * 0.5)
	if ch == 'toe':
		return {'ball' + sfx: 1.0}
	if ch == 'tail':
		w = chain([f'tail_{i + 1:02d}' for i in range(S.TAIL_BONES)], t, 0.3)
		return blend(w, {'pelvis': 1.0}, (1 - MK.smooth(0.0, 0.35, t)) * 0.5)
	raise ValueError(f'no weights for {tags}')


def cage_weights(devil):
	"""Per-vertex bone weights and the masks (part membership, eyelids) for the whole cage."""
	m = devil.m
	weights = [vertex_weights(t, p) for t, p in zip(m.tags, m.co)]
	masks: dict[str, dict[int, float]] = {f'_p_{p}': {} for p in PARTS}
	for name in ('_lid_up_l', '_lid_lo_l', '_lid_up_r', '_lid_lo_r', '_claw_tip'):
		masks[name] = {}
	eye = devil.eyes[0]
	for i, (tags, p) in enumerate(zip(m.tags, m.co)):
		masks['_p_' + tags['part']][i] = 1.0
		lid = tags.get('lid')
		if lid in ('rim', 'edge', 'in'):
			side = tags['side']
			sx = -1.0 if side == 'r' else 1.0
			c = Vector((eye['centre'].x * sx, eye['centre'].y, eye['centre'].z))
			v = Vector((eye['v'].x * sx, eye['v'].y, eye['v'].z))
			h = (p - c).dot(v) / eye['hh']
			amount = {'rim': 0.3, 'edge': 1.0, 'in': 1.0}[lid] * MK.smooth(0.0, 0.45, abs(h))
			if amount > 0:
				masks[f"_lid_{'up' if h > 0 else 'lo'}_{side}"][i] = amount
	return weights, masks
