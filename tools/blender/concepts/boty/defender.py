"""The Defender: three stylised human proposals in the Devil's style (design Q 14 is still open).

Slightly big-headed (the head is ~27 % of 1.8 m), chunky and friendly. Local space: feet on z = 0,
facing -Y. Like the Devil, each one is posed as it is built: primitives fused by a voxel remesh, one
mesh per material (skin, top, trousers, shoes, hair), and a painted face card on the head.

    build_defender('librarian' | 'bouncer' | 'guard')
    fp_arms(parent, sleeve_mat, skin_mat)      first-person forearms gripping a pole
"""

from __future__ import annotations

import math

import bpy  # isort: skip
import bmesh
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import common as C
from devil import Blob, _ss, ik

GOLD = (0.95, 0.60, 0.16)

# ---------------------------------------------------------------------------------------------
# the three proposals
# ---------------------------------------------------------------------------------------------

SPECS = {
	# the everyman: soft, narrow shoulders, cardigan and bow tie, a book under the arm
	'librarian': dict(
		scale=0.95, sw=0.185, chest=(0.185, 0.14, 0.19), belly=(0.20, 0.16, 0.18), hips=(0.185, 0.15, 0.13),
		arm=(0.064, 0.055, 0.05), leg=(0.09, 0.072, 0.064), stance=0.115, hand=1.15, neck=0.062, jaw=(0.198, 0.19, 0.16),
		skin=(0.80, 0.46, 0.32), blush=(1.0, 0.42, 0.38), iris=(0.10, 0.42, 0.30), hair=(0.36, 0.10, 0.03),
		lid=(0.046, -0.10), brow=(0.082, 0.072, 0.014, 0.0055), mouth=('open', 0.045, 1.418, 0.028, 0.0),
		pose=dict(
			hand_l=(0.235, -0.275, 0.94), fwd_l=(-0.8, -0.05, 0.45), palm_l=(0.1, 0.98, 0.1), curl_l=0.55, pole_l=(0.8, 0.5, -0.6),
			hand_r=(-0.315, -0.17, 1.235), fwd_r=(-0.12, -0.12, 1.0), palm_r=(0.75, -0.65, 0.0), curl_r=1.25, pole_r=(0.6, 0.3, -1.0),
			curls_r=(0.0, 1.0, 1.05, 1.1),
			head=(0, -4, 6),
		),
	),
	# the club bouncer: a wall of chest on small legs, black tee, beard, hands on hips
	'bouncer': dict(
		scale=1.05, sw=0.30, chest=(0.315, 0.195, 0.235), belly=(0.245, 0.175, 0.18), hips=(0.20, 0.155, 0.13),
		arm=(0.108, 0.092, 0.078), leg=(0.105, 0.084, 0.072), stance=0.20, hand=1.42, neck=0.09, jaw=(0.212, 0.195, 0.168),
		skin=(0.30, 0.135, 0.07), blush=(0.62, 0.16, 0.10), iris=(0.20, 0.10, 0.03), hair=(0.018, 0.014, 0.014),
		lid=(0.021, 0.0), brow=(0.053, 0.072, 0.004, 0.011), mouth=('closed', 0.042, 1.428, 0.016, 0.006),
		pose=dict(
			hand_l=(0.325, -0.06, 0.90), fwd_l=(-0.42, -0.5, -0.76), palm_l=(-0.9, 0.35, 0.2), curl_l=1.2, pole_l=(1.0, 0.5, 0.1),
			hand_r=(-0.325, -0.06, 0.90), fwd_r=(0.42, -0.5, -0.76), palm_r=(0.9, 0.35, 0.2), curl_r=1.2, pole_r=(1.0, 0.5, 0.1),
			head=(0, 0, -5),
		),
	),
	# casino security: stocky and proud, burgundy blazer with gold trim, peaked cap, 'halt' hand
	'guard': dict(
		scale=1.0, sw=0.228, chest=(0.235, 0.165, 0.20), belly=(0.245, 0.19, 0.185), hips=(0.205, 0.16, 0.13),
		arm=(0.078, 0.066, 0.058), leg=(0.098, 0.078, 0.068), stance=0.145, hand=1.25, neck=0.07, jaw=(0.205, 0.192, 0.162),
		skin=(0.60, 0.33, 0.19), blush=(0.95, 0.36, 0.28), iris=(0.24, 0.13, 0.04), hair=(0.03, 0.022, 0.02),
		lid=(0.040, 0.04), brow=(0.076, 0.074, 0.011, 0.0085), mouth=('open', 0.04, 1.414, 0.022, 0.0),
		pose=dict(
			hand_l=(0.315, -0.03, 0.80), fwd_l=(0.05, -0.2, -1.0), palm_l=(-1.0, 0.1, 0.0), curl_l=0.7, pole_l=(0.6, 0.9, 0.0),
			hand_r=(-0.34, -0.33, 1.25), fwd_r=(0.0, -0.2, 1.0), palm_r=(0.0, -1.0, -0.2), curl_r=0.05, pole_r=(0.7, 0.4, -0.8),
			head=(0, 0, 4),
		),
	),
}

# the face card: x is the distance along the skull's surface, z the height
FACE_X = 0.22
FACE_Z0, FACE_Z1 = 1.37, 1.69
FACE_WRAP_R = 0.20
EYE = (0.078, 1.545)


def _srgb(c):
	return tuple(1.055 * (v ** (1 / 2.4)) - 0.055 if v > 0.0031308 else 12.92 * v for v in c)


def face_texture(kind, width=1536):
	"""The painted face: friendly round eyes, brows, cheeks and a small smile."""
	key = f'defender_face_{kind}'
	if key in bpy.data.images:
		return bpy.data.images[key]
	sp = SPECS[kind]
	height = int(width * (FACE_Z1 - FACE_Z0) / (2 * FACE_X))
	xs = np.linspace(-FACE_X, FACE_X, width, dtype=np.float32)
	zs = np.linspace(FACE_Z1, FACE_Z0, height, dtype=np.float32)
	X, Z = np.meshgrid(xs, zs)
	rgb = np.zeros((height, width, 3), np.float32)
	alpha = np.zeros((height, width), np.float32)
	px = 0.0006
	line = np.array(_srgb(tuple(c * 0.25 for c in sp['skin'])), np.float32)
	hair = np.array(_srgb(tuple(min(c * 0.8, 1) for c in sp['hair'])), np.float32)
	iris_c = np.array(_srgb(sp['iris']), np.float32)

	def over(col, a):
		nonlocal rgb, alpha
		a = np.clip(a, 0, 1)
		rgb = rgb * (1 - a[..., None]) + np.asarray(col, np.float32) * a[..., None]
		alpha = alpha + a * (1 - alpha)

	lid0, lid1 = sp['lid']
	for side in (-1, 1):
		# cheeks
		bx, bz = X - side * 0.128, Z - 1.452
		over(_srgb(sp['blush']), 0.30 * _ss(0.045, 0.012, np.sqrt(bx * bx + (bz * 1.25) ** 2)))
		u = X * side - EYE[0]
		v = Z - EYE[1]
		a, b = 0.041, 0.052
		d_e = (np.sqrt((u / a) ** 2 + (v / b) ** 2) - 1.0) * a
		d_l = v - (lid0 + lid1 * u)
		d = np.maximum(d_e, d_l)
		inside = _ss(px, -px, d)
		shade = _ss(-0.03, -0.004, d_l)
		scl = np.array((0.98, 0.97, 0.95), np.float32) * (1 - shade[..., None] * 0.3) + np.array((0.55, 0.50, 0.58), np.float32) * (shade[..., None] * 0.3)
		rgb = rgb * (1 - inside[..., None]) + scl * inside[..., None]
		alpha = alpha + inside * (1 - alpha)
		iu, iv = u + 0.004, v + 0.005
		r = np.sqrt(iu * iu + iv * iv)
		R = 0.031
		t = np.clip(r / R, 0, 1)[..., None]
		iris = iris_c * (1.25 - 0.75 * t**2) * (1.0 + 0.5 * np.clip(-iv / R, 0, 1)[..., None])
		ia = _ss(R + px, R - px, r) * inside
		rgb = rgb * (1 - ia[..., None]) + np.clip(iris, 0, 1) * ia[..., None]
		over(iris_c * 0.3, _ss(0.0028, 0.001, np.abs(r - R)) * inside * 0.9)
		over((0.02, 0.015, 0.02), _ss(0.0148 + px, 0.0148 - px, r) * inside)
		hx = X - (side * EYE[0] - 0.004 * side) - 0.011
		hz = Z - (EYE[1] - 0.005) - 0.014
		over((1, 1, 1), _ss(0.0098 + px, 0.0098 - px, np.sqrt(hx * hx + hz * hz)) * inside)
		hx2, hz2 = hx + 0.02, hz + 0.024
		over((1, 1, 1), _ss(0.0035 + px, 0.0035 - px, np.sqrt(hx2 * hx2 + hz2 * hz2)) * inside * 0.8)
		# outline: thin below, a heavier upper lid with a small flick
		ol = np.maximum(_ss(-0.0026, -0.0014, d_e), _ss(-0.0058, -0.0044, d_l))
		upper = (v > -0.012) | (d_l > -0.006)
		over(line, ol * inside * np.where(upper, 1.0, 0.55))
		over(line, _ss(-0.0058, -0.0044, d_l) * _ss(px, -px, d_l) * _ss(0.008, 0.0, d_e) * (u > 0) * (d_e > -0.001))
		# brow
		b_in, b_out, arch, half0 = sp['brow']
		a0 = np.array((0.026, b_in))
		a1 = np.array((0.136, b_out))
		bu = X * side
		ab = a1 - a0
		tt = np.clip(((bu - a0[0]) * ab[0] + (v - a0[1]) * ab[1]) / (ab @ ab), 0, 1)
		nrm = np.array((-ab[1], ab[0])) / np.linalg.norm(ab)
		bend = arch * 4 * tt * (1 - tt)
		dist = np.sqrt((bu - (a0[0] + ab[0] * tt + nrm[0] * bend)) ** 2 + (v - (a0[1] + ab[1] * tt + nrm[1] * bend)) ** 2)
		half = half0 * (1 - 0.55 * tt) + 0.0012
		over(hair, _ss(half + px, half - px, dist))

	kind_m, mw, mz, mc, tilt = sp['mouth']
	xm = np.clip(X / mw, -1, 1)
	edge = _ss(mw + px, mw - px, np.abs(X))
	lip = np.array(_srgb(tuple(c * 0.32 for c in sp['skin'])), np.float32)
	if kind_m == 'closed':
		zc = mz - mc * (1 - xm**2) + tilt * xm
		t_half = 0.0042
		dist = np.where(np.abs(X) <= mw, np.abs(Z - zc), np.sqrt((np.abs(X) - mw) ** 2 + (Z - (mz + tilt * np.sign(X))) ** 2))
		over(lip, _ss(t_half + px, t_half - px, dist))
	else:
		top = mz - 0.18 * mc * (1 - xm**2)
		bot = mz - mc * (1 - xm**2) ** 0.8
		inside = _ss(-px, px, top - Z) * _ss(-px, px, Z - bot) * edge
		over((0.38, 0.05, 0.05), inside)
		over((0.92, 0.38, 0.36), inside * _ss(bot + mc * 0.45, bot + mc * 0.2, Z))
		over((0.97, 0.96, 0.93), inside * _ss(top - mc * 0.42, top - mc * 0.34, Z))
		dd = np.minimum(np.abs(Z - top), np.abs(Z - bot))
		over(lip, _ss(0.0034 + px, 0.0034 - px, dd) * _ss(mw + 0.004, mw + 0.002, np.abs(X)) * (Z < top + 0.004) * (Z > bot - 0.004))
	arr = np.dstack([np.clip(rgb, 0, 1), np.clip(alpha, 0, 1)])
	return C.image_from_array(key, arr)


# ---------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------


def _bvh(ob):
	bpy.context.view_layer.update()
	return BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())


def _front(bvh, x, z, default=-0.15):
	"""The point on the front (-Y side) of a mesh at (x, z), and its normal."""
	hit = bvh.ray_cast(Vector((x, -2.0, z)), Vector((0, 1, 0)))
	if hit[0] is None:
		return Vector((x, default, z)), Vector((0, -1, 0))
	return hit[0], hit[1]


def wrap_card(target, name, material, x_half, z0, z1, parent, cyl_r=None, x_center=0.0, nx=120, nz=80, offset=0.0016):
	"""A UV-mapped card laid on `target`: wrapped round the Z axis (cyl_r) or projected from the front."""
	bvh = _bvh(target)
	bm = bmesh.new()
	uvl = bm.loops.layers.uv.new('UVMap')
	grid = {}
	for i in range(nx + 1):
		x = x_half * (2 * i / nx - 1)
		for j in range(nz + 1):
			z = z0 + (z1 - z0) * j / nz
			if cyl_r:
				th = x / cyl_r
				dirn = Vector((math.sin(th), -math.cos(th), 0.0))
				hit = bvh.ray_cast(Vector((0, 0, z)) + dirn * 0.8, -dirn)
			else:
				dirn = Vector((0, -1, 0))
				hit = bvh.ray_cast(Vector((x + x_center, -2.0, z)), Vector((0, 1, 0)))
			if hit[0] is not None:
				grid[i, j] = (bm.verts.new(hit[0] + hit[1] * offset * 0.6 + dirn * offset * 0.4), (i / nx, j / nz))
	for i in range(nx):
		for j in range(nz):
			q = [grid.get(k) for k in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))]
			if all(q):
				f = bm.faces.new([v[0] for v in q])
				for lp, v in zip(f.loops, q):
					lp[uvl].uv = v[1]
	card = C.obj_from_bm(bm, name, material, parent)
	card.visible_shadow = False
	return card


def _cloth(name, color, dark=None, rough=0.7, scale=45.0, bump=0.35, sheen=0.4):
	return C.painted_mat(name, color, dark or tuple(c * 0.74 for c in color), rough=rough, scale=scale, bump=bump, sheen=sheen)


def _skin(kind):
	c = SPECS[kind]['skin']
	return C.mat(f'defender_skin_{kind}', c, rough=0.5, sss=0.25, sheen=0.2)


def _hand(blob, wrist, fwd, palm, side, curl, s=1.0, spread=1.0, curls=None):
	"""A chunky hand: palm, four fingers and a thumb. `fwd` is where the fingers point, `palm` the
	palm's normal; the fingers curl toward the palm (`curls`: a factor per finger, index first).
	Returns the palm centre."""
	f = Vector(fwd).normalized()
	n = Vector(palm)
	n = (n - f * n.dot(f)).normalized()
	sd = f.cross(n).normalized() * side  # toward the little finger
	w = Vector(wrist)
	pc = w + f * 0.05 * s
	rot = Matrix((sd, f, n)).transposed()
	blob.ball(pc, (0.05 * s, 0.056 * s, 0.028 * s), rot.to_quaternion())
	blob.capsule(w - f * 0.035 * s, w + f * 0.01 * s, 0.036 * s, 0.04 * s)
	axis = sd * side
	for fi, (off, ln) in enumerate(((-0.037, 0.92), (-0.0125, 1.06), (0.0125, 1.0), (0.037, 0.82))):
		cf = curl * (curls[fi] if curls else 1.0)
		d0 = (Matrix.Rotation(-off * 4.5 * spread * side, 3, n) @ f).normalized()
		p = pc + f * 0.042 * s + sd * off * s
		pts, radii = [p.copy()], [0.0178 * s]
		for ang, seg, rr in ((0.35, 0.042, 0.0168), (0.95, 0.031, 0.0155), (1.6, 0.026, 0.014)):
			dk = Matrix.Rotation(cf * ang, 3, axis) @ d0
			p = p + dk * seg * s * ln
			pts.append(p.copy())
			radii.append(rr * s)
		blob.tube(pts, radii, segs=10)
		for q, rr in zip(pts[1:], radii[1:]):
			blob.ball(q, rr * 1.03, segs=12)
	td = (-sd * 0.72 + f * 0.6 + n * 0.32).normalized()
	tb = pc - sd * 0.043 * s - f * 0.012 * s
	t_axis = td.cross(n).normalized()
	p1 = tb + td * 0.045 * s
	d2 = Matrix.Rotation(-curl * 0.7, 3, t_axis) @ td
	p2 = p1 + d2 * 0.034 * s
	blob.tube([tb, p1, p2], [0.022 * s, 0.02 * s, 0.017 * s], segs=10)
	blob.ball(p1, 0.0205 * s, segs=12)
	blob.ball(p2, 0.0172 * s, segs=12)
	return pc


def _joints(sp):
	"""Shoulders, elbows, wrists, hips, knees and ankles for a spec's pose."""
	P = sp['pose']
	J = {}
	sh_z = 1.235
	for s, k in ((1, 'l'), (-1, 'r')):
		sh = Vector((sp['sw'] * s, 0.0, sh_z))
		pole = Vector(P['pole_' + k])
		pole.x *= s
		el, wr = ik(sh, P['hand_' + k], 0.27, 0.25, pole)
		hip = Vector((0.10 * s, 0.0, 0.78))
		kn, an = ik(hip, (sp['stance'] * s, 0.0, 0.09), 0.36, 0.36, (0.25 * s, -1.0, 0.0))
		J[k] = dict(sh=sh, el=el, wr=wr, hip=hip, kn=kn, an=an, s=s)
	return J


def _coil(parent, a, b, material, turns=7, r=0.008, wire=0.0028):
	"""An earpiece's coiled lead from a to b."""
	a, b = Vector(a), Vector(b)
	d = b - a
	t = d.normalized()
	nrm = t.cross(Vector((0, 0, 1))).normalized()
	bn = t.cross(nrm)
	n = turns * 10
	pts = [a + d * (i / n) + (nrm * math.cos(2 * math.pi * turns * i / n) + bn * math.sin(2 * math.pi * turns * i / n)) * r for i in range(n + 1)]
	return C.tube('coil', pts, wire, material, parent, segs=6)


# ---------------------------------------------------------------------------------------------
# the body
# ---------------------------------------------------------------------------------------------


def _head(kind, sp, geo):
	"""The skull (with ears, nose and neck) under its own empty, and the face card."""
	P = sp['pose']
	head = C.empty('head', geo, loc=(0, 0.01, 1.34), rot=[math.radians(a) for a in P['head']])
	hp = C.empty('head_geo', head, loc=(0, -0.01, -1.34))
	b = Blob()
	b.ball((0, 0.0, 1.572), (0.212, 0.205, 0.213), segs=40)
	b.ball((0, -0.008, 1.49), sp['jaw'], segs=40)
	b.ball((0, -0.105, 1.378), (0.075, 0.062, 0.048))
	for s in (-1, 1):
		b.ball((0.10 * s, -0.10, 1.452), (0.076, 0.07, 0.066))
		b.ball((0.207 * s, 0.022, 1.515), (0.03, 0.046, 0.062))
	b.ball((0, -0.203, 1.482), (0.031, 0.034, 0.028), segs=14)
	b.capsule((0, 0.02, 1.22), (0, 0.012, 1.37), sp['neck'], sp['neck'] * 1.05)
	skull = b.finish('skull', _skin(kind), voxel=0.007, smooth=7, parent=hp)
	img = face_texture(kind)
	wrap_card(skull, 'face', C.image_mat('mat_' + img.name, img, rough=0.35), FACE_X, FACE_Z0, FACE_Z1, hp, cyl_r=FACE_WRAP_R, nx=140, nz=96)
	return hp, skull


def _trousers(sp, J, geo, material):
	b = Blob()
	b.ball((0, 0.0, 0.80), sp['hips'])
	t0, t1, t2 = sp['leg']
	for k in ('l', 'r'):
		j = J[k]
		b.capsule(j['hip'], j['kn'], t0, t1)
		b.capsule(j['kn'], j['an'] + Vector((0, 0, 0.02)), t1, t2)
	return b.finish('trousers', material, voxel=0.009, smooth=7, parent=geo)


def _shoes(sp, J, geo, material, sole, chunky=1.0):
	for k in ('l', 'r'):
		j = J[k]
		yaw = math.radians(13) * j['s']
		rot = Matrix.Rotation(yaw, 3, 'Z')
		a = j['an']
		b = Blob()
		b.ball(a + rot @ Vector((0, -0.065, -0.022)), (0.08 * chunky, 0.135 * chunky, 0.064 * chunky), rot.to_quaternion())
		b.ball(a + rot @ Vector((0, -0.135 * chunky, -0.03)), (0.076 * chunky, 0.07 * chunky, 0.058 * chunky), rot.to_quaternion())
		b.ball(a + rot @ Vector((0, 0.03, -0.02)), 0.066 * chunky)
		b.finish('shoe', material, voxel=0.007, smooth=5, parent=geo)
		c = a + rot @ Vector((0, -0.06 * chunky, 0))
		so = C.cyl('sole', 0.5, 0.026, (c.x, c.y - 0.012 * chunky, 0.0), sole, geo, rot=(0, 0, yaw), segs=40, bevel_w=0.009)
		so.scale = (0.158 * chunky, 0.30 * chunky, 1.0)


def _top(sp, J, geo, material, sleeves='long', grow=0.0):
	"""The upper garment: chest, belly, shoulders and sleeves, as one fused mesh."""
	b = Blob()
	cx, cy, cz = sp['chest']
	bx, by, bz = sp['belly']
	b.ball((0, 0.0, 1.10), (cx + grow, cy + grow, cz + grow), segs=32)
	b.ball((0, -0.012, 0.925), (bx + grow, by + grow, bz), segs=32)
	b.capsule((0, 0.015, 1.2), (0, 0.012, 1.285), sp['neck'] * 1.25 + grow, sp['neck'] * 1.12 + grow)
	a0, a1, a2 = (r + 0.012 + grow for r in sp['arm'])
	for k in ('l', 'r'):
		j = J[k]
		b.ball(j['sh'], a0 * 1.08)
		if sleeves == 'long':
			b.capsule(j['sh'], j['el'], a0, a1)
			end = j['wr'] + (j['el'] - j['wr']).normalized() * 0.035
			b.capsule(j['el'], end, a1, a2 * 1.05)
		else:
			b.capsule(j['sh'], j['sh'] + (j['el'] - j['sh']) * 0.6, a0, a0 * 0.98)
	return b.finish('top', material, voxel=0.009, smooth=7, parent=geo)


def _hands(kind, sp, J, geo, bare_arms=False):
	P = sp['pose']
	sockets = {}
	for k in ('l', 'r'):
		j = J[k]
		b = Blob()
		pc = _hand(b, j['wr'], P['fwd_' + k], P['palm_' + k], j['s'], P['curl_' + k], sp['hand'], curls=P.get('curls_' + k))
		b.finish('hand', _skin(kind), voxel=0.0055, smooth=4, parent=geo)
		sockets[k] = tuple(pc)
		if bare_arms:
			a0, a1, a2 = sp['arm']
			ab = Blob()
			ab.capsule(j['sh'], j['el'], a0, a1)
			ab.capsule(j['el'], j['wr'], a1, a2)
			ab.finish('arm', _skin(kind), voxel=0.008, smooth=6, parent=geo)
	return sockets


def _cuff(geo, j, radius, material, width=0.045, back=0.03):
	d = (j['el'] - j['wr']).normalized()
	a = j['wr'] + d * back
	return C.tube('cuff', [a, a + d * width], radius, material, geo, segs=20)


# ---------------------------------------------------------------------------------------------
# the three wardrobes
# ---------------------------------------------------------------------------------------------


def _paint_card(key, x_half, z0, z1, fn, width=1024):
	if key in bpy.data.images:
		return bpy.data.images[key]
	height = int(width * (z1 - z0) / (2 * x_half))
	X, Z = np.meshgrid(np.linspace(-x_half, x_half, width, dtype=np.float32), np.linspace(z1, z0, height, dtype=np.float32))
	rgb = np.zeros((height, width, 3), np.float32)
	alpha = np.zeros((height, width), np.float32)

	def over(col, a):
		nonlocal rgb, alpha
		a = np.clip(a, 0, 1)
		rgb = rgb * (1 - a[..., None]) + np.asarray(col, np.float32) * a[..., None]
		alpha = alpha + a * (1 - alpha)

	fn(X, Z, over)
	return C.image_from_array(key, np.dstack([np.clip(rgb, 0, 1), np.clip(alpha, 0, 1)]))


def _dress_librarian(sp, J, geo, hp, skull):
	knit = _cloth('lib_cardigan', (0.78, 0.40, 0.035), (0.55, 0.24, 0.02), scale=70.0, bump=0.6)
	top = _top(sp, J, geo, knit)
	_trousers(sp, J, geo, _cloth('lib_trousers', (0.17, 0.115, 0.085), scale=90.0, bump=0.07))
	_shoes(sp, J, geo, C.painted_mat('lib_shoes', (0.24, 0.085, 0.03), (0.13, 0.04, 0.015), rough=0.4, scale=20.0, coat=0.3), C.mat('lib_sole', (0.75, 0.68, 0.55), rough=0.6))
	rib = _cloth('lib_rib', (0.50, 0.22, 0.02), (0.36, 0.14, 0.012), scale=90.0, bump=0.7)
	for k in ('l', 'r'):
		_cuff(geo, J[k], sp['arm'][2] + 0.021, rib, 0.05, 0.018)
	C.torus('hem', 0.2, 0.028, (0, -0.012, 0.775), rib, geo, scale=(1.0, 0.82, 1.0), segs=48)

	# the shirt in the cardigan's V, and the cardigan's ribbed edge
	def paint(X, Z, over):
		px = 0.0008
		zt, zb = 1.30, 1.02
		half = 0.085 * np.clip((Z - zb) / (zt - zb), 0, 1) ** 0.85
		v = _ss(px, -px, np.abs(X) - half) * (Z > zb) * (Z < zt + 0.03)
		over((0.96, 0.93, 0.84), v)
		# faint shirt stripes
		over((0.72, 0.80, 0.86), v * 0.35 * (np.mod(X * 60, 1.0) < 0.3))
		band = _ss(0.014 + px, 0.014 - px, np.abs(np.abs(X) - half - 0.010)) * (Z > zb - 0.012) * (Z < zt + 0.03)
		over((0.74, 0.50, 0.14), band)
		over((0.74, 0.50, 0.14), _ss(0.014 + px, 0.014 - px, np.abs(X)) * (Z <= zb) * (Z > 0.74))

	img = _paint_card('lib_front', 0.14, 0.72, 1.34, paint)
	wrap_card(top, 'front', C.image_mat('mat_lib_front', img, rough=0.75), 0.14, 0.72, 1.34, geo, nx=60, nz=130, offset=0.002)
	bv = _bvh(top)
	wood = C.mat('lib_button', (0.30, 0.13, 0.04), rough=0.4, coat=0.3)
	for z in (0.98, 0.89, 0.80):
		p, n = _front(bv, 0.0, z)
		C.sphere('button', 0.017, p + n * 0.004, wood, geo, scale=(1, 0.5, 1), rot=(0, 0, 0), segs=16, rings=8)
	# collar and bow tie
	teal = _cloth('lib_bow', (0.02, 0.42, 0.40), (0.01, 0.26, 0.27), scale=80.0, bump=0.3)
	p, _n = _front(bv, 0.0, 1.292)
	white = C.mat('lib_collar', (0.93, 0.90, 0.80), rough=0.7)
	for s in (-1, 1):
		C.box('collar', (0.085, 0.022, 0.05), (0.052 * s, p.y + 0.012, 1.318), white, geo, rot=(math.radians(-18), math.radians(28 * s), math.radians(-24 * s)), bevel_w=0.008)
		w = C.cyl('bow', 0.012, 0.075, (0.008 * s, p.y - 0.022, 1.288), teal, geo, rot=(0, math.radians(90 * s), 0), segs=20, r2=0.042, bevel_w=0.008)
		w.scale = (1.0, 0.55, 1.0)
	C.sphere('knot', 0.02, (0, p.y - 0.024, 1.288), teal, geo, scale=(1, 0.8, 1), segs=16, rings=8)

	# hair: a side-parted mop
	hair = _cloth('lib_hair', sp['hair'], tuple(c * 0.55 for c in sp['hair']), rough=0.5, scale=26.0, bump=0.7, sheen=0.3)
	b = Blob()
	b.ball((0, 0.035, 1.625), (0.226, 0.222, 0.19), segs=32)
	b.ball((0, 0.11, 1.52), (0.195, 0.135, 0.15))
	for c, r in (((-0.085, -0.135, 1.735), (0.115, 0.085, 0.062)), ((0.075, -0.15, 1.725), (0.10, 0.075, 0.058)), ((0.165, -0.085, 1.69), (0.065, 0.08, 0.07)), ((-0.175, -0.07, 1.68), (0.06, 0.08, 0.075)), ((0.02, -0.03, 1.775), (0.13, 0.13, 0.05)), ((-0.03, -0.185, 1.705), (0.07, 0.05, 0.04))):
		b.ball(c, r)
	b.finish('hair', hair, voxel=0.008, smooth=5, parent=hp)

	# round glasses
	frame = C.mat('lib_glasses', (0.10, 0.045, 0.02), rough=0.3, coat=0.5)
	lens = C.mat('lib_lens', (0.75, 0.9, 1.0), rough=0.05, alpha=0.12, coat=1.0)
	sb = _bvh(skull)
	rim = []
	for s in (-1, 1):
		th = (EYE[0] * s) / FACE_WRAP_R
		dirn = Vector((math.sin(th), -math.cos(th), 0.0))
		hit = sb.ray_cast(Vector((0, 0, EYE[1])) + dirn * 0.8, -dirn)
		c = hit[0] + dirn * 0.03
		rot = (math.pi / 2, 0, th)
		C.torus('rim', 0.058, 0.0075, c, frame, hp, rot=rot, segs=40, rsegs=10)
		ln = C.cyl('lens', 0.056, 0.002, c, lens, hp, rot=rot, segs=40)
		ln.visible_shadow = False
		rim.append((c, dirn, th))
		side = Vector((math.cos(th), math.sin(th), 0)) * s
		C.tube('temple', [c + side * 0.058, Vector((0.214 * s, 0.0, EYE[1] + 0.008)), Vector((0.218 * s, 0.05, EYE[1] - 0.005))], 0.0055, frame, hp, segs=8)
	a = rim[0][0] + Vector((math.cos(rim[0][2]), math.sin(rim[0][2]), 0)) * 0.055
	c2 = rim[1][0] - Vector((math.cos(rim[1][2]), math.sin(rim[1][2]), 0)) * 0.055
	C.tube('bridge', C.catmull([a, (a + c2) / 2 + Vector((0, -0.012, 0.01)), c2], 4), 0.006, frame, hp, segs=8)

	# the book under the left arm
	import weapons as W

	book = W._book(geo, 0.23, 0.055, 0.31, C.painted_mat('lib_book', (0.02, 0.36, 0.42), (0.01, 0.2, 0.26), rough=0.5, scale=14.0, bump=0.3), bands=2)
	book.location = (0.10, -0.215, 0.84)
	book.rotation_euler = (math.radians(-9), math.radians(-10), math.radians(-10))


def _dress_bouncer(sp, J, geo, hp, skull):
	tee = _cloth('bnc_tee', (0.032, 0.034, 0.042), (0.018, 0.019, 0.025), rough=0.75, scale=90.0, bump=0.06, sheen=0.6)
	top = _top(sp, J, geo, tee, sleeves='short')
	_trousers(sp, J, geo, _cloth('bnc_trousers', (0.075, 0.085, 0.11), (0.045, 0.05, 0.07), scale=90.0, bump=0.07))
	_shoes(sp, J, geo, C.painted_mat('bnc_boots', (0.035, 0.035, 0.04), (0.02, 0.02, 0.022), rough=0.35, scale=20.0, coat=0.3), C.mat('bnc_sole', (0.015, 0.015, 0.017), rough=0.6), chunky=1.14)
	cyan = C.emit_mat('bnc_cyan', (0.0, 0.8, 1.0), 1.4)
	a0 = sp['arm'][0] + 0.012
	for k in ('l', 'r'):
		j = J[k]
		d = (j['el'] - j['sh']).normalized()
		e = j['sh'] + (j['el'] - j['sh']) * 0.6
		C.tube('sleeve_hem', [e + d * 0.008, e + d * 0.05], a0 * 1.03, tee, geo, segs=24)
	_cuff(geo, J['l'], sp['arm'][2] + 0.008, cyan, 0.03, 0.035)
	C.torus('neckline', sp['neck'] * 1.22, 0.014, (0, 0.012, 1.292), tee, geo, rot=(math.radians(-8), 0, 0), segs=32)
	belt = C.mat('bnc_belt', (0.02, 0.02, 0.022), rough=0.4, coat=0.3)
	C.torus('belt', 0.212, 0.024, (0, -0.008, 0.80), belt, geo, scale=(1.0, 0.8, 1.2), segs=48)
	bv = _bvh(top)
	C.box('buckle', (0.085, 0.02, 0.06), (0, -0.182, 0.80), C.mat('bnc_buckle', (0.75, 0.78, 0.82), rough=0.25, metal=1.0), geo, bevel_w=0.012)

	# a staff emblem on the chest: a glowing shield, no text
	def paint(X, Z, over):
		px = 0.0006
		x, z = X, Z - 1.165
		sh = np.maximum(np.abs(x) - 0.034, np.maximum(z - 0.032, -z - 0.05 + np.abs(x) * 1.15))
		over((0.0, 0.85, 1.0), _ss(px, -px, sh))
		over((0.02, 0.02, 0.03), _ss(px, -px, sh + 0.007))
		star = np.abs(x) * 1.3 + np.abs(z + 0.004) * 1.3 - 0.022
		over((0.0, 0.85, 1.0), _ss(px, -px, star))

	img = _paint_card('bnc_emblem', 0.06, 1.09, 1.22, paint, width=512)
	wrap_card(top, 'emblem', C.image_mat('mat_bnc_emblem', img, rough=0.6, emit=0.9), 0.06, 1.09, 1.22, geo, x_center=0.15, nx=30, nz=34, offset=0.002)
	del bv

	# beard and moustache
	hair = _cloth('bnc_beard', sp['hair'], (0.008, 0.006, 0.006), rough=0.6, scale=60.0, bump=0.8, sheen=0.3)
	b = Blob()
	for i in range(15):
		ph = math.radians(-105 + 210 * i / 14)
		up = (abs(ph) / math.radians(105)) ** 1.6
		b.ball((0.186 * math.sin(ph), -0.172 * math.cos(ph) + 0.01, 1.372 + 0.125 * up), (0.052, 0.052, 0.05 - 0.012 * up), segs=14)
	b.ball((0, -0.125, 1.345), (0.085, 0.07, 0.045))
	for s in (-1, 1):
		b.ball((0.03 * s, -0.196, 1.452), (0.036, 0.022, 0.014), segs=12)
		b.ball((0.062 * s, -0.182, 1.44), (0.024, 0.02, 0.022), segs=12)
	b.finish('beard', hair, voxel=0.006, smooth=4, parent=hp)
	# earpiece
	wire = C.mat('earpiece', (0.75, 0.78, 0.8), rough=0.3, alpha=1.0)
	C.sphere('earbud', 0.02, (-0.232, 0.01, 1.52), C.mat('earbud', (0.03, 0.03, 0.035), rough=0.4), hp, segs=12, rings=8)
	_coil(hp, (-0.232, 0.03, 1.50), (-0.14, 0.075, 1.30), wire)


def _dress_guard(sp, J, geo, hp, skull):
	wine = _cloth('grd_blazer', (0.30, 0.012, 0.045), (0.17, 0.006, 0.03), rough=0.6, scale=90.0, bump=0.07, sheen=0.5)
	gold = C.mat('grd_gold', GOLD, rough=0.28, metal=1.0)
	top = _top(sp, J, geo, wine, grow=0.006)
	_trousers(sp, J, geo, _cloth('grd_trousers', (0.03, 0.03, 0.04), (0.018, 0.018, 0.024), scale=90.0, bump=0.06))
	_shoes(sp, J, geo, C.mat('grd_shoes', (0.02, 0.02, 0.022), rough=0.2, coat=0.6), C.mat('grd_sole', (0.012, 0.012, 0.014), rough=0.5))
	for k in ('l', 'r'):
		_cuff(geo, J[k], sp['arm'][2] + 0.021, gold, 0.014, 0.02)
		_cuff(geo, J[k], sp['arm'][2] + 0.021, gold, 0.014, 0.05)
		_cuff(geo, J[k], sp['arm'][2] + 0.008, C.mat('grd_shirt', (0.93, 0.92, 0.88), rough=0.6), 0.03, -0.012)
		j = J[k]
		C.box('epaulette', (0.105, 0.06, 0.02), (j['sh'].x * 0.84, 0.0, j['sh'].z + sp['arm'][0] + 0.022), gold, geo, rot=(0, math.radians(-16 * j['s']), 0), bevel_w=0.008)

	# shirt V, lapels with gold piping, the blazer's front edge
	def paint(X, Z, over):
		px = 0.0008
		zt, zb = 1.31, 1.03
		half = 0.095 * np.clip((Z - zb) / (zt - zb), 0, 1) ** 0.8
		v = _ss(px, -px, np.abs(X) - half) * (Z > zb) * (Z < zt + 0.03)
		over((0.95, 0.94, 0.90), v)
		d = np.abs(X) - half
		lap = _ss(px, -px, d - 0.05) * _ss(-px, px, d) * (Z > zb - 0.02) * (Z < zt + 0.03)
		over((0.34, 0.012, 0.05), lap)
		over((1.0, 0.72, 0.22), _ss(0.0042 + px, 0.0042 - px, np.abs(d - 0.05)) * (Z > zb - 0.02) * (Z < zt + 0.03))
		over((0.20, 0.004, 0.025), _ss(0.003 + px, 0.003 - px, np.abs(X - 0.004)) * (Z <= zb) * (Z > 0.74))

	img = _paint_card('grd_front', 0.17, 0.72, 1.35, paint)
	wrap_card(top, 'front', C.image_mat('mat_grd_front', img, rough=0.7), 0.17, 0.72, 1.35, geo, nx=70, nz=130, offset=0.002)
	bv = _bvh(top)
	for z in (0.97, 0.87):
		p, n = _front(bv, 0.03, z)
		C.sphere('button', 0.02, p + n * 0.004, gold, geo, scale=(1, 0.5, 1), segs=16, rings=8)
	# tie
	navy = _cloth('grd_tie', (0.02, 0.03, 0.10), (0.012, 0.018, 0.06), scale=90.0, bump=0.3)
	pts = [_front(bv, 0.0, z)[0] + Vector((0, -0.008, 0)) for z in (1.27, 1.2, 1.12, 1.045)]
	C.tube('tie', pts, [0.022, 0.03, 0.036, 0.012], navy, geo, segs=12, flat=0.35)
	p, _n = _front(bv, 0.0, 1.292)
	C.sphere('tie_knot', 0.026, (0, p.y - 0.008, 1.288), navy, geo, scale=(1, 0.7, 0.85), segs=16, rings=8)
	white = C.mat('grd_collar', (0.95, 0.94, 0.90), rough=0.6)
	for s in (-1, 1):
		C.box('collar', (0.09, 0.022, 0.052), (0.056 * s, p.y + 0.012, 1.322), white, geo, rot=(math.radians(-18), math.radians(28 * s), math.radians(-24 * s)), bevel_w=0.008)
	# badge on the left chest
	p, n = _front(bv, 0.135, 1.14)
	yaw = math.atan2(-n.x, -n.y)
	bd = C.cyl('badge', 0.042, 0.012, p + n * 0.002, gold, geo, rot=(math.pi / 2, 0, -yaw), segs=6, bevel_w=0.004)
	bd.scale = (1.0, 1.0, 1.0)
	C.sphere('badge_gem', 0.016, p + n * 0.012, C.mat('grd_gem', (0.5, 0.0, 0.03), rough=0.15, coat=1.0), geo, scale=(1, 0.6, 1), rot=(0, 0, -yaw), segs=16, rings=8)

	# neat hair under a peaked cap, and a moustache
	hair = _cloth('grd_hair', sp['hair'], (0.012, 0.01, 0.01), rough=0.5, scale=50.0, bump=0.6, sheen=0.3)
	b = Blob()
	b.ball((0, 0.045, 1.60), (0.221, 0.212, 0.17), segs=32)
	b.ball((0, 0.11, 1.52), (0.185, 0.125, 0.13))
	for s in (-1, 1):
		b.ball((0.195 * s, -0.01, 1.60), (0.03, 0.06, 0.07))
	b.finish('hair', hair, voxel=0.007, smooth=4, parent=hp)
	b = Blob()
	for s in (-1, 1):
		b.ball((0.028 * s, -0.197, 1.45), (0.036, 0.022, 0.016), Matrix.Rotation(math.radians(-12 * s), 3, 'Y').to_quaternion(), segs=12)
		b.ball((0.066 * s, -0.184, 1.44), (0.022, 0.018, 0.013), Matrix.Rotation(math.radians(-25 * s), 3, 'Y').to_quaternion(), segs=12)
	b.finish('moustache', hair, voxel=0.004, smooth=3, parent=hp)

	cap = C.empty('cap', hp, loc=(0, 0.0, 1.69), rot=(math.radians(-7), 0, 0))
	C.cyl('cap_band', 0.218, 0.065, (0, 0.01, 0), C.mat('grd_capband', (0.03, 0.03, 0.035), rough=0.35, coat=0.3), cap, segs=48, bevel_w=0.008).scale = (1.0, 0.985, 1.0)
	C.cyl('cap_crown', 0.22, 0.085, (0, 0.01, 0.06), wine, cap, segs=48, r2=0.272, bevel_w=0.012)
	C.cyl('cap_top', 0.272, 0.03, (0, 0.01, 0.142), wine, cap, segs=48, bevel_w=0.014)
	C.torus('cap_piping', 0.22, 0.0075, (0, 0.01, 0.063), gold, cap, segs=48)
	visor = C.cyl('visor', 0.21, 0.016, (0, -0.105, 0.004), C.mat('grd_visor', (0.015, 0.015, 0.018), rough=0.12, coat=0.8), cap, rot=(math.radians(14), 0, 0), segs=48, bevel_w=0.006)
	visor.scale = (0.98, 0.8, 1.0)
	cb = C.cyl('cap_badge', 0.04, 0.014, (0, -0.228, 0.095), gold, cap, rot=(math.radians(100), 0, 0), segs=8, bevel_w=0.004)
	cb.scale = (1.0, 1.0, 1.0)
	# earpiece
	wire = C.mat('earpiece', (0.75, 0.78, 0.8), rough=0.3)
	C.sphere('earbud', 0.02, (0.232, 0.01, 1.52), C.mat('earbud', (0.03, 0.03, 0.035), rough=0.4), hp, segs=12, rings=8)
	_coil(hp, (0.232, 0.03, 1.50), (0.12, 0.085, 1.30), wire)


_DRESS = {'librarian': _dress_librarian, 'bouncer': _dress_bouncer, 'guard': _dress_guard}


def build_defender(kind='librarian', parent=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0, name=None):
	"""Build one Defender proposal under a new empty: kind is 'librarian', 'bouncer' or 'guard'.

	`rot` is in degrees. The empty's `sockets` custom property holds the palms' local positions.
	"""
	sp = SPECS[kind]
	s = scale * sp['scale']
	root = C.empty(name or f'Defender_{kind}', parent, loc, [math.radians(a) for a in rot], s)
	geo = C.empty('geo', root)
	J = _joints(sp)
	hp, skull = _head(kind, sp, geo)
	_DRESS[kind](sp, J, geo, hp, skull)
	root['sockets'] = _hands(kind, sp, J, geo, bare_arms=(kind == 'bouncer'))
	return root


# ---------------------------------------------------------------------------------------------
# first person
# ---------------------------------------------------------------------------------------------


def fp_arms(parent=None, sleeve_mat=None, skin_mat=None, pole_r=0.015, left_z=0.2, hand_scale=1.3):
	"""Two first-person forearms whose hands grip a vertical pole.

	Grip: the pole runs along local +Z through the origin (x = y = 0) and is ~3 cm across. The right
	hand's palm is centred on z = 0, the left hand's on z = `left_z` (0.2). The viewer stands on +Y
	and looks toward -Y: the elbows are at about (-0.30, 0.50, -0.30) and (0.30, 0.50, -0.10), so a
	camera near (0, 0.55, 0.25) sees the backs of both hands with the forearms entering from the
	bottom corners. Put the weapon's pole on the empty's Z axis (e.g. `mic_stand()` at z = -0.9).
	The empty's `grip` custom property repeats the two grip points.
	"""
	sleeve_mat = sleeve_mat or _cloth('fp_sleeve', (0.032, 0.034, 0.042), rough=0.75, scale=60.0, bump=0.2, sheen=0.6)
	skin_mat = skin_mat or _skin('librarian')
	root = C.empty('FpArms', parent)
	s = hand_scale
	for side, z in ((-1, 0.0), (1, left_z)):
		# the palm faces the pole; the fingers start pointing away from the viewer and wrap round
		pc = Vector((side * (pole_r + 0.03 * s), 0.004, z))
		f = Vector((0.12 * -side, -1, 0)).normalized()
		n = Vector((-side, 0, 0))
		wrist = pc - f * 0.05 * s
		elbow = Vector((side * 0.30, 0.50, z - 0.30))
		d = (wrist - elbow).normalized()
		b = Blob()
		_hand(b, wrist, f, n, side, 1.5, s, spread=0.2)
		b.capsule(wrist - d * 0.10, wrist - d * 0.01, 0.04 * s, 0.037 * s)
		b.finish('fp_hand', skin_mat, voxel=0.005, smooth=4, parent=root)
		sb = Blob()
		sb.capsule(elbow - d * 0.25, wrist - d * 0.075, 0.075, 0.058)
		sb.finish('fp_sleeve', sleeve_mat, voxel=0.008, smooth=5, parent=root)
		C.tube('fp_cuff', [wrist - d * 0.10, wrist - d * 0.062], 0.064, sleeve_mat, root, segs=20)
	root['grip'] = {'right': (0.0, 0.0, 0.0), 'left': (0.0, 0.0, left_z)}
	return root
