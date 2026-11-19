"""Devil v2: face shape keys on the full-detail mesh: `blink`, `open`, `snarl`.

They are worked out from the same masks and weights the build already wrote (eyelid masks, the
jaw's skin weight), so they follow any change to the cage. The jaw bone opens the mouth too; `open`
is there for a face that is driven by keys alone.
"""

from __future__ import annotations

import math

import bpy  # noqa: F401  isort: skip  (bpy must load before mathutils)
import numpy as np
from mathutils import Matrix, Vector

import assemble as A
import spec as S

KEYS = ('blink', 'open', 'snarl')


def _coords(ob):
	co = np.empty(len(ob.data.vertices) * 3, np.float32)
	ob.data.vertices.foreach_get('co', co)
	return co.reshape(-1, 3)


def _group(ob, name):
	out = np.zeros(len(ob.data.vertices), np.float32)
	g = ob.vertex_groups.get(name)
	if g is None:
		return out
	for v in ob.data.vertices:
		for e in v.groups:
			if e.group == g.index:
				out[v.index] = e.weight
	return out


def _falloff(co, centre, radius):
	d = np.linalg.norm(co - np.array(centre, np.float32), axis=1) / radius
	t = np.clip(1 - d, 0, 1)
	return t * t * (3 - 2 * t)


def add(ob, devil, rig=None):
	"""Add the keys to `ob`. Returns their names."""
	if ob.data.shape_keys is None:
		ob.shape_key_add(name='Basis', from_mix=False)
	co = _coords(ob)
	eye = devil.eyes[0]
	hh = eye['hh']

	# blink: the heavy upper lid comes down to meet the lower one, sliding over the eyeball
	blink = np.zeros_like(co)
	for side, sx in (('l', 1.0), ('r', -1.0)):
		v = np.array((eye['v'].x * sx, eye['v'].y, eye['v'].z), np.float32)
		n = np.array((eye['normal'].x * sx, eye['normal'].y, eye['normal'].z), np.float32)
		up = A.attr(ob, f'm_lid_up_{side}')[:, None]
		lo = A.attr(ob, f'm_lid_lo_{side}')[:, None]
		blink += up * (-v * hh * 0.85 + n * 0.0040) + lo * (v * hh * 0.70 + n * 0.0015)

	# open: what the jaw bone does at 24 degrees, as a key
	jaw = _group(ob, 'jaw')[:, None]
	pivot = np.array(S.J['jaw'], np.float32)
	rot = np.array(Matrix.Rotation(math.radians(24), 3, 'X'), np.float32)
	opened = ((co - pivot) @ rot.T + pivot - co) * jaw

	# snarl: the upper lip lifts off the fangs, the nose wrinkles, the brows come down
	upper = (1 - np.clip(jaw[:, 0] * 3, 0, 1)) * (1 - A.attr(ob, 'm_p_tooth'))
	snarl = np.zeros_like(co)
	for sx in (1.0, -1.0):
		lift = _falloff(co, (0.062 * sx, -0.135, 0.868), 0.050) * upper
		snarl += lift[:, None] * np.array((0.003 * sx, -0.004, 0.011), np.float32)
		wrinkle = _falloff(co, (0.030 * sx, -0.165, 0.890), 0.030) * upper
		snarl += wrinkle[:, None] * np.array((0.0, -0.003, 0.004), np.float32)
	inner = np.clip(1 - (np.abs(co[:, 0]) - 0.02) / 0.07, 0, 1)
	brow = np.maximum(A.attr(ob, 'm_p_brow'), _falloff(co, (0.0, -0.150, 0.925), 0.07) * A.attr(ob, 'm_p_head'))
	snarl += (brow * inner)[:, None] * np.array((0.0, -0.001, -0.005), np.float32)

	for name, delta in zip(KEYS, (blink, opened, snarl)):
		key = ob.shape_key_add(name=name, from_mix=False)
		key.data.foreach_set('co', (co + delta).ravel())
		key.value = 0.0
	return list(KEYS)


def reference_point():
	"""Where the snarl is centred, for a render's camera."""
	return Vector((0.0, -0.14, 0.87))
