"""The Devil, modelled from the owner's concept (docs/design/3d/boty/devil-concept.webp).

Chibi: the head is ~40 % of the height. Local space: feet on z = 0, facing -Y, ~1.1 m to the skull.
The body is a set of overlapping primitives fused with a voxel remesh, so every pose is built
directly (no rig): `build_devil(pose='stand' | 'fly' | 'carry' | 'hang' | 'burst' | 'climb')`.
"""

from __future__ import annotations

import math

import bpy  # isort: skip  (bpy must load before bmesh and mathutils)
import bmesh
import numpy as np
from mathutils import Euler, Matrix, Vector

import common as C

SKIN = (0.70, 0.010, 0.010)
BELLY = (0.95, 0.085, 0.035)
DARK = (0.035, 0.022, 0.03)

# ---------------------------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------------------------


def skin_mat():
	if 'devil_skin' in C._MATS:
		return C._MATS['devil_skin']
	m, nt, p = C._new_mat('devil_skin')
	attr = nt.nodes.new('ShaderNodeAttribute')
	attr.attribute_name = 'belly'
	mix = nt.nodes.new('ShaderNodeMix')
	mix.data_type = 'RGBA'
	mix.inputs['A'].default_value = (*SKIN, 1)
	mix.inputs['B'].default_value = (*BELLY, 1)
	nt.links.new(attr.outputs['Fac'], mix.inputs['Factor'])
	nt.links.new(mix.outputs['Result'], p.inputs['Base Color'])
	p.inputs['Roughness'].default_value = 0.48
	p.inputs['Subsurface Weight'].default_value = 0.35
	p.inputs['Subsurface Radius'].default_value = (0.10, 0.012, 0.008)
	p.inputs['Subsurface Scale'].default_value = 0.25
	p.inputs['Sheen Weight'].default_value = 0.25
	p.inputs['Sheen Roughness'].default_value = 0.4
	p.inputs['Sheen Tint'].default_value = (1.0, 0.18, 0.08, 1)
	p.inputs['Coat Weight'].default_value = 0.08
	C._MATS['devil_skin'] = m
	return m


def horn_mat():
	return C.mat('devil_horn', DARK, rough=0.22, coat=0.7)


def membrane_mat():
	if 'devil_membrane' in C._MATS:
		return C._MATS['devil_membrane']
	m = bpy.data.materials.new('devil_membrane')
	m.use_nodes = True
	nt = m.node_tree
	p = nt.nodes['Principled BSDF']
	out = nt.nodes['Material Output']
	# darker toward the ribs and the rim, as in the concept: UV v runs from the wrist to the edge
	tc = nt.nodes.new('ShaderNodeTexCoord')
	sep = nt.nodes.new('ShaderNodeSeparateXYZ')
	nt.links.new(tc.outputs['UV'], sep.inputs[0])
	ramp = nt.nodes.new('ShaderNodeValToRGB')
	els = ramp.color_ramp.elements
	els[0].position = 0.0
	els[0].color = (0.28, 0.0, 0.01, 1)
	els[1].position = 1.0
	els[1].color = (0.42, 0.005, 0.01, 1)
	e = els.new(0.55)
	e.color = (0.86, 0.035, 0.02, 1)
	nt.links.new(sep.outputs['Y'], ramp.inputs['Fac'])
	nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
	p.inputs['Roughness'].default_value = 0.5
	p.inputs['Sheen Weight'].default_value = 0.3
	tl = nt.nodes.new('ShaderNodeBsdfTranslucent')
	nt.links.new(ramp.outputs['Color'], tl.inputs['Color'])
	mx = nt.nodes.new('ShaderNodeMixShader')
	mx.inputs['Fac'].default_value = 0.4
	nt.links.new(p.outputs['BSDF'], mx.inputs[1])
	nt.links.new(tl.outputs['BSDF'], mx.inputs[2])
	nt.links.new(mx.outputs['Shader'], out.inputs['Surface'])
	C._MATS['devil_membrane'] = m
	return m


# ---------------------------------------------------------------------------------------------
# the face texture (eyes + brows), painted with numpy: the swappable face of the design doc
# ---------------------------------------------------------------------------------------------

FACE_X = 0.27  # half width of the face card (m, along the skull's surface)
FACE_WRAP_R = 0.235  # the card wraps round the skull as a cylinder of this radius
FACE_Z0, FACE_Z1 = 0.675, 0.915
EYE_C = (0.122, 0.772)


def _ss(e0, e1, x):
	t = np.clip((x - e0) / (e1 - e0), 0, 1)
	return t * t * (3 - 2 * t)


def face_texture(look=(0.0, 0.0), mood='grin', width=2048):
	"""RGBA float array of the face card. `look` shifts the irises (m); `mood` picks the lids."""
	key = f'devil_face_{mood}_{look[0]:.3f}_{look[1]:.3f}'
	if key in bpy.data.images:
		return bpy.data.images[key]
	height = int(width * (FACE_Z1 - FACE_Z0) / (2 * FACE_X))
	xs = np.linspace(-FACE_X, FACE_X, width, dtype=np.float32)
	zs = np.linspace(FACE_Z1, FACE_Z0, height, dtype=np.float32)
	X, Z = np.meshgrid(xs, zs)
	rgb = np.zeros((height, width, 3), np.float32)
	alpha = np.zeros((height, width), np.float32)

	def over(col, a):
		nonlocal rgb, alpha
		a = np.clip(a, 0, 1)
		rgb = rgb * (1 - a[..., None]) + np.array(col, np.float32) * a[..., None]
		alpha = alpha + a * (1 - alpha)

	lid = {'grin': (0.030, 0.46, -1.0), 'wide': (0.058, 0.10, -2.0), 'strain': (0.004, 0.30, 1.5), 'dizzy': (0.05, 0.0, -2.0)}[mood]
	for side in (-1, 1):
		u = (X * side) - EYE_C[0]
		v = Z - EYE_C[1]
		a, b = 0.098, 0.080
		d_e = (np.sqrt((u / a) ** 2 + (v / b) ** 2) - 1.0) * b
		lidv = lid[0] + lid[1] * u + lid[2] * u * u
		d_l = (v - lidv) * math.cos(math.atan(lid[1]))
		d = np.maximum(d_e, d_l)
		px = 0.0007
		# soft dark socket around the eye
		over((0.30, 0.0, 0.01), 0.42 * _ss(0.026, 0.0, d) * (d > -0.002))
		inside = _ss(px, -px, d)
		# sclera, shaded under the lid
		shade = _ss(-0.05, -0.008, d_l)
		scl = np.array((1.0, 0.86, 0.76), np.float32) * (1 - shade[..., None] * 0.42) + np.array((0.55, 0.12, 0.10), np.float32) * (shade[..., None] * 0.42)
		rgb = rgb * (1 - inside[..., None]) + scl * inside[..., None]
		alpha = alpha + inside * (1 - alpha)
		# iris
		iu = u + 0.012 - look[0] * side
		iv = v - 0.004 - look[1]
		r = np.sqrt(iu * iu + iv * iv)
		R = 0.058
		t = np.clip(r / R, 0, 1)[..., None]
		c_in = np.array((1.0, 0.62, 0.05), np.float32)
		c_mid = np.array((0.95, 0.16, 0.02), np.float32)
		c_out = np.array((0.42, 0.0, 0.0), np.float32)
		iris = np.where(t < 0.62, c_in + (c_mid - c_in) * (t / 0.62) ** 1.3, c_mid + (c_out - c_mid) * ((t - 0.62) / 0.38))
		# brighter lower half: the light caught in the iris
		iris = iris * (1.0 + 0.25 * np.clip(-iv / R, 0, 1)[..., None])
		ia = _ss(R + px, R - px, r) * inside
		rgb = rgb * (1 - ia[..., None]) + iris * ia[..., None]
		over((0.16, 0.0, 0.0), _ss(0.0035, 0.0015, np.abs(r - R)) * inside * 0.9)
		over((0.03, 0.0, 0.0), _ss(0.025 + px, 0.025 - px, r) * inside)
		# highlights: the same side on both eyes
		hx = X - (side * EYE_C[0] + (-0.012 * side + look[0])) - 0.019
		hz = Z - (EYE_C[1] + 0.004 + look[1]) - 0.019
		over((1, 1, 1), _ss(0.0135 + px, 0.0135 - px, np.sqrt(hx * hx + hz * hz)) * inside)
		hx2, hz2 = hx + 0.036, hz + 0.039
		over((1, 0.95, 0.9), _ss(0.0048 + px, 0.0048 - px, np.sqrt(hx2 * hx2 + hz2 * hz2)) * inside * 0.85)
		# outline: thin round the bottom, heavy along the lid, with a flick past the outer corner
		ol = np.maximum(_ss(-0.0055, -0.0040, d_e), _ss(-0.0125, -0.0105, d_l))
		over((0.09, 0.0, 0.005), ol * inside)
		flick = _ss(-0.0125, -0.0105, d_l) * _ss(px, -px, d_l) * _ss(0.02, 0.0, d_e) * (u > 0) * (d_e > -0.002)
		over((0.09, 0.0, 0.005), flick)
		# brow: a tapered stroke, low at the nose and high outside
		a0 = np.array((0.026, 0.014 + lid[0] * 0.3))
		a1 = np.array((0.218, 0.110 + lid[0] * 0.3))
		bu, bv = u + EYE_C[0], v
		ab = a1 - a0
		tt = np.clip(((bu - a0[0]) * ab[0] + (bv - a0[1]) * ab[1]) / (ab @ ab), 0, 1)
		nrm = np.array((-ab[1], ab[0])) / np.linalg.norm(ab)
		bend = 0.013 * 4 * tt * (1 - tt)
		cx = a0[0] + ab[0] * tt + nrm[0] * bend
		cz = a0[1] + ab[1] * tt + nrm[1] * bend
		dist = np.sqrt((bu - cx) ** 2 + (bv - cz) ** 2)
		half = 0.0105 * np.sin(np.pi * np.clip(tt * 0.85 + 0.12, 0, 1)) ** 0.8 * (1 - tt * 0.45) + 0.0022
		over((0.07, 0.0, 0.005), _ss(half + px, half - px, dist))
	arr = np.dstack([np.clip(rgb, 0, 1), np.clip(alpha, 0, 1)])
	img = C.image_from_array(key, arr)
	return img


def face_mat(look, mood):
	img = face_texture(look, mood)
	return C.image_mat('mat_' + img.name, img, rough=0.22, emit=0.35, coat=0.0)


# ---------------------------------------------------------------------------------------------
# blobs: primitives fused by a voxel remesh
# ---------------------------------------------------------------------------------------------


class Blob:
	def __init__(self):
		self.bm = bmesh.new()

	def ball(self, c, r, rot=None, segs=24):
		r = (r, r, r) if isinstance(r, (int, float)) else r
		mat = Matrix.Translation(Vector(c))
		if rot is not None:
			mat = mat @ rot.to_matrix().to_4x4()
		mat = mat @ Matrix.Diagonal((*r, 1.0))
		bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=segs // 2, radius=1.0, matrix=mat)
		return self

	def tube(self, pts, radii, flat=1.0, segs=14):
		if isinstance(radii, (int, float)):
			radii = [radii] * len(pts)
		rings = []
		for (p, _t, nrm, bn), r in zip(C._frames(pts), radii):
			rings.append([self.bm.verts.new(p + nrm * (math.cos(2 * math.pi * j / segs) * r) + bn * (math.sin(2 * math.pi * j / segs) * r * flat)) for j in range(segs)])
		for i in range(len(rings) - 1):
			for j in range(segs):
				self.bm.faces.new((rings[i][j], rings[i][(j + 1) % segs], rings[i + 1][(j + 1) % segs], rings[i + 1][j]))
		self.bm.faces.new(list(reversed(rings[0])))
		self.bm.faces.new(rings[-1])
		return self

	def capsule(self, p0, p1, r0, r1=None):
		r1 = r0 if r1 is None else r1
		self.tube([p0, p1], [r0, r1])
		self.ball(p0, r0, segs=16)
		self.ball(p1, r1, segs=16)
		return self

	def finish(self, name, material, voxel=0.008, smooth=8, parent=None):
		bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
		ob = C.obj_from_bm(self.bm, name, material, None)
		md = ob.modifiers.new('Remesh', 'REMESH')
		md.mode = 'VOXEL'
		md.voxel_size = voxel
		md.use_smooth_shade = True
		if smooth:
			sm = ob.modifiers.new('Smooth', 'SMOOTH')
			sm.factor = 0.5
			sm.iterations = smooth
		bake(ob)
		if parent is not None:
			ob.parent = parent
		return ob


def bake(ob):
	"""Apply the object's modifiers into its mesh."""
	bpy.context.view_layer.update()
	deps = bpy.context.evaluated_depsgraph_get()
	me = bpy.data.meshes.new_from_object(ob.evaluated_get(deps))
	old = ob.data
	ob.modifiers.clear()
	ob.data = me
	bpy.data.meshes.remove(old)
	me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
	return ob


def paint(ob, name, fn):
	"""A per-vertex float attribute from fn(co Nx3) -> N."""
	me = ob.data
	co = np.empty(len(me.vertices) * 3, np.float32)
	me.vertices.foreach_get('co', co)
	vals = np.clip(fn(co.reshape(-1, 3)), 0, 1).astype(np.float32)
	at = me.attributes.new(name, 'FLOAT', 'POINT')
	at.data.foreach_set('value', vals)


def ik(a, c, l1, l2, pole):
	a, c, pole = Vector(a), Vector(c), Vector(pole)
	d = c - a
	dist = min(max(d.length, 1e-4), (l1 + l2) * 0.999)
	dirn = d.normalized()
	c = a + dirn * dist
	x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
	h = math.sqrt(max(l1 * l1 - x * x, 0.0))
	pp = pole - dirn * pole.dot(dirn)
	pp = pp.normalized() if pp.length > 1e-6 else Vector((0, 0, 1))
	return a + dirn * x + pp * h, c


def claw(parent, base, direction, curl_axis, length=0.05, r=0.016, curl=0.9, name='claw'):
	direction = Vector(direction).normalized()
	pts, radii = [], []
	p = Vector(base)
	n = 6
	for i in range(n + 1):
		t = i / n
		pts.append(p.copy())
		radii.append(max(r * (1 - t) ** 0.85, 0.0006))
		d = Matrix.Rotation(curl * t, 3, Vector(curl_axis)) @ direction
		p = p + d * (length / n)
	return C.tube(name, pts, radii, horn_mat(), parent, segs=10)


# ---------------------------------------------------------------------------------------------
# poses
# ---------------------------------------------------------------------------------------------

POSES = {
	# the concept: wide stance, arms out, claws ready
	'stand': dict(
		hand_l=(0.315, -0.15, 0.455), hand_r=(-0.315, -0.15, 0.455),
		hand_fwd_l=(0.38, -0.45, 0.80), hand_fwd_r=(-0.38, -0.45, 0.80),
		palm_l=(-0.2, -0.85, -0.45), palm_r=(0.2, -0.85, -0.45),
		curl=0.62, elbow_pole=(0.9, 0.5, -0.2),
		foot_l=(0.20, -0.02, 0.055), foot_r=(-0.20, -0.02, 0.055),
		foot_yaw=28, foot_pitch=0, knee_pole=(0.7, -1.0, 0.1),
		head=(0, 0, 0), wing=(0, 0, 0), wing_scale=1.0, tail='stand',
	),
	# free flight: arms reach forward, legs trail, wings up
	'fly': dict(
		hand_l=(0.24, -0.22, 0.58), hand_r=(-0.24, -0.22, 0.58),
		hand_fwd_l=(0.2, -0.8, 0.5), hand_fwd_r=(-0.2, -0.8, 0.5),
		palm_l=(-0.1, -0.5, -0.85), palm_r=(0.1, -0.5, -0.85),
		curl=0.7, elbow_pole=(0.9, 0.4, -0.3),
		foot_l=(0.15, 0.14, 0.10), foot_r=(-0.13, 0.05, 0.06),
		foot_yaw=18, foot_pitch=-55, knee_pole=(0.5, -1.0, 0.0),
		head=(0, 0, 0), wing=(0, -22, 0), wing_scale=1.2, tail='fly',
	),
	# carrying a prop against the belly, flying
	'carry': dict(
		hand_l=(0.20, -0.25, 0.36), hand_r=(-0.20, -0.25, 0.36),
		hand_fwd_l=(-0.15, -0.55, -0.82), hand_fwd_r=(0.15, -0.55, -0.82),
		palm_l=(-0.95, -0.2, 0.1), palm_r=(0.95, -0.2, 0.1),
		curl=0.55, elbow_pole=(0.9, 0.3, 0.2),
		foot_l=(0.17, 0.10, 0.09), foot_r=(-0.17, 0.12, 0.07),
		foot_yaw=20, foot_pitch=-50, knee_pole=(0.6, -1.0, 0.0),
		head=(0, 0, 0), wing=(0, -28, 0), wing_scale=1.25, tail='fly',
	),
	# a heavy prop hanging below from both hands
	'hang': dict(
		hand_l=(0.17, -0.10, 0.26), hand_r=(-0.17, -0.10, 0.26),
		hand_fwd_l=(-0.1, -0.1, -1.0), hand_fwd_r=(0.1, -0.1, -1.0),
		palm_l=(-1.0, 0.0, 0.1), palm_r=(1.0, 0.0, 0.1),
		curl=1.1, elbow_pole=(0.9, 0.2, 0.3),
		foot_l=(0.22, 0.16, 0.14), foot_r=(-0.22, 0.16, 0.14),
		foot_yaw=30, foot_pitch=-45, knee_pole=(0.9, -0.6, 0.2),
		head=(0, 0, 0), wing=(0, -38, 0), wing_scale=1.3, tail='fly',
	),
	# bursting out of the Gate: arms thrown wide, legs trailing
	'burst': dict(
		hand_l=(0.36, -0.10, 0.66), hand_r=(-0.36, -0.10, 0.66),
		hand_fwd_l=(0.55, -0.35, 0.75), hand_fwd_r=(-0.55, -0.35, 0.75),
		palm_l=(0.1, -0.95, -0.2), palm_r=(-0.1, -0.95, -0.2),
		curl=0.45, elbow_pole=(0.6, 0.6, -0.5),
		foot_l=(0.16, 0.08, 0.04), foot_r=(-0.12, -0.04, 0.10),
		foot_yaw=22, foot_pitch=-50, knee_pole=(0.5, -1.0, 0.0),
		head=(0, 0, 0), wing=(0, -35, 0), wing_scale=1.3, tail='burst',
	),
	# climbing out over an edge: both hands down in front
	'climb': dict(
		hand_l=(0.22, -0.26, 0.42), hand_r=(-0.20, -0.24, 0.50),
		hand_fwd_l=(0.1, -0.9, -0.3), hand_fwd_r=(-0.1, -0.9, -0.2),
		palm_l=(0.0, -0.3, -0.95), palm_r=(0.0, -0.3, -0.95),
		curl=0.9, elbow_pole=(0.9, 0.4, 0.3),
		foot_l=(0.18, 0.0, 0.055), foot_r=(-0.18, 0.0, 0.055),
		foot_yaw=25, foot_pitch=0, knee_pole=(0.7, -1.0, 0.1),
		head=(0, 0, 0), wing=(0, -15, 0), wing_scale=1.1, tail='stand',
	),
}

TAILS = {
	'stand': [(0, 0.10, 0.30), (0.10, 0.22, 0.22), (0.26, 0.24, 0.14), (0.40, 0.16, 0.17), (0.43, 0.10, 0.28)],
	'fly': [(0, 0.10, 0.30), (0.05, 0.24, 0.24), (0.02, 0.38, 0.12), (-0.10, 0.46, 0.04), (-0.20, 0.44, 0.12)],
	'burst': [(0, 0.10, 0.30), (0.06, 0.20, 0.18), (0.16, 0.22, 0.02), (0.14, 0.18, -0.14), (0.04, 0.16, -0.24)],
}


# ---------------------------------------------------------------------------------------------
# parts
# ---------------------------------------------------------------------------------------------


def _hand(blob, claws_parent, wrist, fwd, palm, side, curl, s=1.0):
	"""Palm, three fingers and a thumb in a frame: `fwd` (fingers), `palm` (the palm's normal)."""
	f = Vector(fwd).normalized()
	n = Vector(palm)
	n = (n - f * n.dot(f)).normalized()
	sd = f.cross(n).normalized() * side  # toward the little-finger side... thumb is on -sd
	w = Vector(wrist)
	pc = w + f * 0.05 * s
	rot = Matrix((sd, f, n)).transposed()
	blob.ball(pc, (0.062 * s, 0.058 * s, 0.036 * s), rot.to_quaternion())
	for k, off in enumerate((-0.043, 0.0, 0.043)):
		splay = Matrix.Rotation(off * 7.5, 3, n)
		d0 = splay @ f
		axis = (splay @ sd).normalized() * side
		base = pc + d0 * 0.04 * s + sd * off * s
		d1 = Matrix.Rotation(curl * 0.55, 3, axis) @ d0
		p1 = base + d1 * 0.062 * s
		d2 = Matrix.Rotation(curl * 1.25, 3, axis) @ d0
		p2 = p1 + d2 * 0.052 * s
		blob.tube([base, p1, p2], [0.027 * s, 0.024 * s, 0.019 * s], segs=10)
		blob.ball(p1, 0.0245 * s, segs=12)
		blob.ball(p2, 0.019 * s, segs=12)
		claw(claws_parent, p2 - d2 * 0.004, Matrix.Rotation(curl * 1.5, 3, axis) @ d0, axis, 0.062 * s, 0.017 * s, 0.8)
	# thumb
	td = (-sd * 0.75 + f * 0.45 + n * 0.45).normalized()
	tb = pc - sd * 0.045 * s - f * 0.012 * s
	axis = td.cross(n).normalized()
	p1 = tb + td * 0.05 * s
	d2 = Matrix.Rotation(-curl * 0.7, 3, axis) @ td
	p2 = p1 + d2 * 0.035 * s
	blob.tube([tb, p1, p2], [0.027 * s, 0.023 * s, 0.018 * s], segs=10)
	blob.ball(p2, 0.018 * s, segs=12)
	claw(claws_parent, p2 - d2 * 0.004, Matrix.Rotation(-curl * 0.9, 3, axis) @ td, -axis, 0.052 * s, 0.016 * s, 0.7)
	return pc


def _foot(blob, claws_parent, ankle, yaw, pitch, side):
	a = Vector(ankle)
	rot = Euler((math.radians(pitch), 0, math.radians(yaw) * side), 'XYZ').to_matrix()
	f = rot @ Vector((0, -1, 0))
	u = rot @ Vector((0, 0, 1))
	s = rot @ Vector((1, 0, 0))
	fc = a + f * 0.065 - u * 0.012
	blob.ball(fc, (0.07, 0.105, 0.05), rot.to_quaternion())
	blob.ball(a - f * 0.02 - u * 0.01, 0.052)
	for off in (-0.05, 0.0, 0.05):
		tp = a + f * (0.155 if off == 0 else 0.14) + s * off - u * 0.022
		blob.ball(tp, (0.036, 0.045, 0.034), rot.to_quaternion(), segs=14)
		claw(claws_parent, tp + f * 0.028 + u * 0.004, f + u * 0.15, s, 0.062, 0.02, 0.85)


def _wing(parent, side, scale):
	"""One wing in its own space (x outward, y back, z up) under an empty at the shoulder blade."""
	root = C.empty('wing', parent)
	W = Vector((0.33, 0.06, 0.27))
	E = Vector((0.16, 0.07, 0.09))
	R = Vector((0.0, 0.0, 0.0))
	T1 = Vector((0.56, 0.16, -0.22))
	T2 = Vector((0.36, 0.13, -0.16))
	T3 = Vector((0.18, 0.09, -0.15))
	B = Vector((0.015, 0.01, -0.15))

	def quad(a, b, bulge):
		mid = (a + b) / 2 + Vector(bulge)
		return lambda v: (1 - v) ** 2 * a + 2 * v * (1 - v) * mid + v * v * b

	curves = [
		quad(W, T1, (0.085, 0.0, 0.045)),
		quad(W, T2, (0.03, 0.0, 0.0)),
		quad(W, T3, (0.0, 0.0, 0.0)),
		quad(W, B, (-0.03, 0.0, 0.0)),
		quad(W, R, (-0.02, 0.0, 0.03)),
	]
	sags = [0.20, 0.20, 0.15, 0.0]
	bm = bmesh.new()
	uvl = bm.loops.layers.uv.new('UVMap')
	nu, nv = 10, 8
	for k in range(4):
		grid = []
		for i in range(nu + 1):
			u = i / nu
			row = []
			for j in range(nv + 1):
				v = j / nv
				vv = v * (1 - sags[k] * 4 * u * (1 - u) * v)
				p = curves[k](vv) * (1 - u) + curves[k + 1](vv) * u
				p.y += 0.035 * math.sin(math.pi * u) * v
				row.append((bm.verts.new(p), (0.5 + 0.5 * math.cos(2 * math.pi * u)) * 0.0 + abs(2 * u - 1), v))
			grid.append(row)
		for i in range(nu):
			for j in range(nv):
				quad_v = (grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1])
				try:
					f = bm.faces.new([q[0] for q in quad_v])
				except ValueError:
					continue
				for lp, q in zip(f.loops, quad_v):
					# u: 1 on a rib, 0 between ribs; v: 0 at the wrist, 1 on the trailing edge
					lp[uvl].uv = (q[1], max(q[2] * 0.9, q[1] ** 3))
	bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0015)
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	mem = C.obj_from_bm(bm, 'membrane', membrane_mat(), root)
	sol = mem.modifiers.new('Solid', 'SOLIDIFY')
	sol.thickness = 0.006
	C.subsurf(mem, 1)
	rib = horn_mat()
	n = 10
	for k, (r0, r1) in enumerate(((0.019, 0.004), (0.014, 0.003), (0.013, 0.003))):
		pts = [curves[k](i / n) + Vector((0, -0.003, 0)) for i in range(n + 1)]
		C.tube('rib', pts, [r0 + (r1 - r0) * (i / n) for i in range(n + 1)], rib, root, segs=10)
	arm = C.catmull([R + Vector((-0.03, -0.03, -0.03)), E, W], 8)
	C.tube('wing_arm', arm, [0.026 - 0.008 * (i / (len(arm) - 1)) for i in range(len(arm))], rib, root, segs=12)
	C.sphere('wing_wrist', 0.023, W, rib, root, segs=16, rings=8)
	claw(root, W, (-0.15, -0.1, 1.0), (0, 1, 0), 0.085, 0.017, -0.7, 'wing_claw')
	root.scale = (side * scale, scale, scale)
	return root


def _horn(parent, side):
	pts = C.bezier((0.165 * side, 0.0, 0.985), (0.335 * side, 0.01, 1.02), (0.325 * side, 0.0, 1.20), (0.19 * side, -0.015, 1.285), 40)
	radii = []
	for i in range(len(pts)):
		t = i / (len(pts) - 1)
		r = 0.077 * (1 - t) ** 0.8 + 0.002
		ridge = 0.5 + 0.5 * math.cos(2 * math.pi * (t * 6.0))
		r *= 1.0 + 0.12 * (ridge**3) * (1 - t * 0.5) * (t > 0.06)
		radii.append(r)
	ob = C.tube('horn', pts, radii, horn_mat(), parent, segs=24)
	C.subsurf(ob, 1)
	return ob


def _head(parent, pose, look, mood):
	"""Skull, cheeks, ears, hair tuft; then the mouth is cut and the face card is wrapped on."""
	head = C.empty('head', parent, loc=(0, 0.01, 0.62))
	head.rotation_euler = [math.radians(a) for a in pose['head']]
	hp = C.empty('head_geo', head, loc=(0, -0.01, -0.62))
	b = Blob()
	b.ball((0, 0.0, 0.86), (0.25, 0.235, 0.225), segs=40)
	b.ball((0, -0.01, 0.775), (0.232, 0.212, 0.165), segs=40)
	b.ball((0, -0.125, 0.648), (0.082, 0.075, 0.06))
	for s in (-1, 1):
		b.ball((0.135 * s, -0.115, 0.715), (0.095, 0.085, 0.08))
		# brow ridge
		b.ball((0.11 * s, -0.185, 0.845), (0.105, 0.05, 0.035), Euler((0, math.radians(-22 * s), math.radians(-14 * s))))
		# ear: a leaf, fused at its root
		ear = C.catmull([(0.20 * s, 0.03, 0.78), (0.28 * s, 0.05, 0.83), (0.35 * s, 0.07, 0.90), (0.40 * s, 0.08, 0.975)], 6)
		prof = [0.05, 0.08, 0.098, 0.105, 0.102, 0.094, 0.084, 0.073, 0.062, 0.052, 0.043, 0.035, 0.028, 0.022, 0.016, 0.012, 0.008, 0.005, 0.003]
		b.tube(ear, prof[: len(ear)], flat=0.5, segs=16)
	b.ball((0, -0.232, 0.712), (0.022, 0.02, 0.017), segs=12)
	# hair tuft: flame-like spikes swept to one side
	for base, tip, r in (
		((-0.02, -0.07, 1.04), (0.03, -0.10, 1.215), 0.05),
		((0.05, -0.05, 1.05), (0.115, -0.07, 1.175), 0.042),
		((-0.08, -0.05, 1.04), (-0.085, -0.075, 1.155), 0.04),
		((0.0, 0.0, 1.06), (0.065, 0.0, 1.18), 0.045),
		((-0.03, -0.11, 1.0), (-0.01, -0.175, 1.09), 0.035),
	):
		bb, tt = Vector(base), Vector(tip)
		mid = (bb + tt) / 2 + Vector((-0.03, 0.0, 0.015))
		pts = C.catmull([bb, mid, tt], 6)
		b.tube(pts, [max(r * (1 - i / (len(pts) - 1)) ** 0.9, 0.003) for i in range(len(pts))], segs=12)
	skull = b.finish('skull', skin_mat(), voxel=0.006, smooth=7, parent=hp)
	paint(skull, 'belly', lambda co: 0.32 * _ss(1.25, 0.35, np.sqrt(((co[:, 0]) / 0.20) ** 2 + ((co[:, 1] + 0.22) / 0.15) ** 2 + ((co[:, 2] - 0.70) / 0.15) ** 2)))

	# inner ears
	for s in (-1, 1):
		ear = C.catmull([(0.235 * s, 0.012, 0.80), (0.29 * s, 0.03, 0.845), (0.345 * s, 0.05, 0.905), (0.38 * s, 0.062, 0.95)], 5)
		C.tube('ear_in', ear, [max(0.052 * math.sin(math.pi * (0.12 + 0.88 * i / (len(ear) - 1))) ** 0.8, 0.002) for i in range(len(ear))], C.mat('devil_ear_in', (0.38, 0.0, 0.01), rough=0.6, sss=0.2), hp, segs=12, flat=0.3)

	# mouth: cut a grin out of the skull
	from mathutils.bvhtree import BVHTree

	bvh = BVHTree.FromObject(skull, bpy.context.evaluated_depsgraph_get())

	def surf_y(x, z):
		hit = bvh.ray_cast(Vector((x, -1.0, z)), Vector((0, 1, 0)))
		return hit[0].y if hit[0] is not None else -0.2

	mw = 0.108
	mx0 = 0.012

	def lip_top(x):
		t = (x - mx0) / mw
		return 0.670 + 0.030 * t * t + 0.005 * t

	def lip_bot(x):
		t = (x - mx0) / mw
		return (0.610 if mood != 'dizzy' else 0.64) + (lip_top(mx0 + mw) - 0.610) * abs(t) ** 2.4

	n = 28
	top = [(mx0 + mw * (2 * i / n - 1), lip_top(mx0 + mw * (2 * i / n - 1))) for i in range(n + 1)]
	bot = [(mx0 + mw * (2 * i / n - 1), lip_bot(mx0 + mw * (2 * i / n - 1))) for i in range(n, -1, -1)]
	outline = top + bot[1:-1]
	bm = bmesh.new()
	front = [bm.verts.new((x, -0.5, z)) for x, z in outline]
	back = [bm.verts.new((x * 0.92, -0.135, z)) for x, z in outline]
	bm.faces.new(front)
	bm.faces.new(list(reversed(back)))
	for i in range(len(outline)):
		j = (i + 1) % len(outline)
		bm.faces.new((front[i], back[i], back[j], front[j]))
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	cutter = C.obj_from_bm(bm, 'mouth_cut', C.mat('devil_mouth', (0.10, 0.0, 0.005), rough=0.6), hp, smooth=False)
	skull.data.materials.append(cutter.data.materials[0])
	bo = skull.modifiers.new('Mouth', 'BOOLEAN')
	bo.object = cutter
	bo.operation = 'DIFFERENCE'
	bo.solver = 'EXACT'
	bo.material_mode = 'TRANSFER'
	bake(skull)
	skull.parent = hp
	bpy.data.objects.remove(cutter, do_unlink=True)

	# teeth: a row under the upper lip with two fangs; tongue
	tooth = C.mat('devil_tooth', (0.95, 0.93, 0.86), rough=0.3, coat=0.3)
	nt = 7
	for i in range(nt):
		x = mx0 + mw * 0.80 * (2 * i / (nt - 1) - 1)
		z = lip_top(x) + 0.003
		y = surf_y(x, z + 0.012) + 0.012
		yaw = math.atan2(surf_y(x + 0.01, z + 0.012) - surf_y(x - 0.01, z + 0.012), 0.02)
		fang = i in (1, nt - 2)
		if fang:
			ob = C.cyl('fang', 0.0135, 0.046, (x, y, z), tooth, hp, rot=(math.pi, 0, 0), segs=14, r2=0.001)
			ob.scale = (1, 0.8, 1)
		else:
			ob = C.box('tooth', (mw * 1.6 / (nt - 1) * 0.94, 0.012, 0.019), (x, y, z - 0.007), tooth, hp, rot=(0, 0, yaw), bevel_w=0.005)
	C.sphere('tongue', 1.0, (mx0, surf_y(mx0, 0.70) + 0.075, 0.628), C.mat('devil_tongue', (0.85, 0.16, 0.13), rough=0.35, sss=0.3), hp, scale=(0.055, 0.05, 0.02), segs=20, rings=10)

	# the face card: eyes and brows projected onto the skull from the front
	bvh = BVHTree.FromObject(skull, bpy.context.evaluated_depsgraph_get())
	bm = bmesh.new()
	uvl = bm.loops.layers.uv.new('UVMap')
	nx, nz = 150, 66
	grid = {}
	for i in range(nx + 1):
		x = FACE_X * (2 * i / nx - 1)
		th = x / FACE_WRAP_R
		dirn = Vector((math.sin(th), -math.cos(th), 0.0))
		for j in range(nz + 1):
			z = FACE_Z0 + (FACE_Z1 - FACE_Z0) * j / nz
			hit = bvh.ray_cast(Vector((0, 0, z)) + dirn * 0.6, -dirn)
			if hit[0] is not None:
				grid[i, j] = (bm.verts.new(hit[0] + dirn * 0.0016), (i / nx, j / nz))
	for i in range(nx):
		for j in range(nz):
			q = [grid.get(k) for k in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))]
			if all(q):
				f = bm.faces.new([v[0] for v in q])
				for lp, v in zip(f.loops, q):
					lp[uvl].uv = v[1]
	card = C.obj_from_bm(bm, 'face', face_mat(look, mood), hp)
	card.visible_shadow = False

	for s in (-1, 1):
		_horn(hp, s)
	return head


# ---------------------------------------------------------------------------------------------
# the Devil
# ---------------------------------------------------------------------------------------------


def build_devil(pose='stand', parent=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0, look=(0.0, 0.0), mood='grin', origin='feet', name='Devil', **over):
	"""Build one posed Devil under a new empty. `rot` is in degrees. `over` overrides pose keys.

	The root's `sockets` custom property holds the hands' local positions (for props).
	"""
	P = dict(POSES[pose])
	P.update(over)
	root = C.empty(name, parent, loc, [math.radians(a) for a in rot], scale)
	geo = C.empty('geo', root, loc=(0, 0, -0.45 if origin == 'center' else 0.0))

	# torso, legs and arms
	b = Blob()
	b.ball((0, 0.0, 0.505), (0.118, 0.10, 0.11))
	b.ball((0, -0.012, 0.395), (0.148, 0.128, 0.135))
	b.ball((0, 0.008, 0.315), (0.14, 0.115, 0.095))
	b.capsule((0, 0.01, 0.55), (0, 0.005, 0.66), 0.07, 0.075)
	claws = C.empty('claws', geo)
	for s, hk, fk, pk in ((1, 'hand_l', 'hand_fwd_l', 'palm_l'), (-1, 'hand_r', 'hand_fwd_r', 'palm_r')):
		sh = Vector((0.118 * s, 0.0, 0.552))
		pole = Vector(P['elbow_pole'])
		pole.x *= s
		el, wr = ik(sh, P[hk], 0.155, 0.155, pole)
		b.capsule(sh, el, 0.056, 0.048)
		b.capsule(el, wr, 0.048, 0.052)
		b.ball(sh, 0.062)
		hip = Vector((0.082 * s, 0.005, 0.30))
		fk_ = 'foot_l' if s == 1 else 'foot_r'
		pole = Vector(P['knee_pole'])
		pole.x *= s
		kn, an = ik(hip, P[fk_], 0.165, 0.165, pole)
		b.capsule(hip, kn, 0.082, 0.064)
		b.capsule(kn, an, 0.064, 0.054)
		_foot(b, claws, an, P['foot_yaw'], P['foot_pitch'], s)
	body = b.finish('body', skin_mat(), voxel=0.007, smooth=9, parent=geo)
	paint(body, 'belly', lambda co: 0.75 * _ss(1.1, 0.4, np.sqrt((co[:, 0] / 0.115) ** 2 + ((co[:, 1] + 0.13) / 0.085) ** 2 + ((co[:, 2] - 0.405) / 0.155) ** 2)))

	# hands: finer, so the fingers stay crisp
	sockets = {}
	for s, hk, fk, pk in ((1, 'hand_l', 'hand_fwd_l', 'palm_l'), (-1, 'hand_r', 'hand_fwd_r', 'palm_r')):
		hb = Blob()
		sh = Vector((0.118 * s, 0.0, 0.552))
		pole = Vector(P['elbow_pole'])
		pole.x *= s
		_el, wr = ik(sh, P[hk], 0.155, 0.155, pole)
		pc = _hand(hb, claws, wr, P[fk], P[pk], s, P['curl'], 1.32)
		hand = hb.finish('hand', skin_mat(), voxel=0.0045, smooth=4, parent=geo)
		paint(hand, 'belly', lambda co: np.zeros(len(co)))
		sockets['l' if s == 1 else 'r'] = tuple(pc + Vector((0, 0, geo.location.z)))
	root['sockets'] = sockets

	# tail
	tp = C.catmull(TAILS[P['tail']], 8)
	tr = [0.040 * (1 - i / (len(tp) - 1)) ** 0.6 + 0.012 for i in range(len(tp))]
	tail = C.tube('tail', tp, tr, skin_mat(), geo, segs=14)
	paint(tail, 'belly', lambda co: np.zeros(len(co)))
	d = (tp[-1] - tp[-3]).normalized()
	tip = C.cyl('tail_tip', 0.078, 0.15, tp[-1] - d * 0.02, C.mat('devil_tailtip', (0.62, 0.012, 0.012), rough=0.45, sss=0.2, sheen=0.4), geo, segs=28, r2=0.002, bevel_w=0.012)
	tip.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
	tip.scale = (1.0, 0.42, 1.0)

	# wings
	for s in (1, -1):
		w = _wing(geo, s, P['wing_scale'])
		w.location = (0.055 * s, 0.085, 0.545)
		wr = P['wing']
		w.rotation_euler = (math.radians(wr[0]), math.radians(wr[1]) * s, math.radians(wr[2]) * s)

	_head(geo, P, look, mood)
	return root


def duplicate(root, loc=None, rot=None, scale=None, parent=None):
	"""A linked copy of a built Devil (shares the meshes)."""

	def rec(ob, par):
		cp = ob.copy()
		C.link(cp)
		cp.parent = par
		for ch in ob.children:
			rec(ch, cp)
		return cp

	cp = rec(root, parent if parent is not None else root.parent)
	if loc is not None:
		cp.location = loc
	if rot is not None:
		cp.rotation_euler = [math.radians(a) for a in rot]
	if scale is not None:
		cp.scale = (scale, scale, scale)
	return cp
