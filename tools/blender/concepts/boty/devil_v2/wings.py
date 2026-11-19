"""Devil v2: the wings. Built at final density (they are not subdivided with the body).

One wing is five closed quad shells: the arm (humerus and forearm, with the wrist knob), three
finger ribs, the hooked thumb claw on the wrist, and the membrane. The membrane is a front and a
back sheet welded round the rim, a few millimetres apart, so it shades from both sides without a
double-sided material; the ribs poke through both faces. Every vertex carries its bone weights
(`w`), so the rig needs no painting: a rib follows its own bone, the membrane blends between the
ribs either side of it and holds on to the spine where it meets the back.

Measured off the owner's turnaround (back, 90° and 135° views): metres, feet on z = 0, facing -Y,
the left wing on +X. `build_wing()` makes the left one; `mirrored()` gives the right.
"""

from __future__ import annotations

import math

import bpy  # noqa: F401  isort: skip  (bpy must load before bmesh and mathutils)
from mathutils import Vector

import meshkit as MK

# -- joints -------------------------------------------------------------------------------------
ROOT = Vector((0.052, 0.046, 0.694))  # on the shoulder blade, just under the skin
ELBOW = Vector((0.178, 0.132, 0.722))
WRIST = Vector((0.241, 0.176, 0.934))
# The leading finger bows outward: wrist, three knuckles, the outer tip.
F1 = [WRIST, Vector((0.362, 0.268, 0.862)), Vector((0.446, 0.334, 0.756)), Vector((0.503, 0.381, 0.650)), Vector((0.535, 0.410, 0.540)), Vector((0.540, 0.420, 0.432))]
F1_MID = 2.45  # the leading finger's second bone starts here (a parameter along F1)
F2_TIP = Vector((0.360, 0.284, 0.513))
F3_TIP = Vector((0.230, 0.186, 0.536))
BODY = Vector((0.080, 0.012, 0.592))  # where the trailing edge meets the back, at the waist
BODY_TOP = Vector((0.050, 0.040, 0.672))  # the membrane's edge runs up the back to here

# The wing's plane is swept back ~37°; FRONT is the normal of its forward face.
FRONT = Vector((0.749, -1.0, -0.044)).normalized()
THICK = 0.0028  # half the membrane's thickness, away from the rim
BILLOW = 0.016  # how far the membrane cups back between two ribs
SAG = (0.15, 0.12, 0.10, 0.0)  # how far each trailing scallop pulls in toward the wrist
ACROSS = (7, 6, 5, 4)  # membrane quads across each sector: f1-f2, f2-f3, f3-body edge, body edge-arm
ROWS = 10  # membrane quads from the wrist to the trailing edge; the last one is the thin rim
RIM_V = 0.972  # where that rim row starts, so the weld's soft shading stays a centimetre wide
V0 = 0.045  # the membrane starts this far from the wrist (hidden inside the ribs' roots)
COLS = 6  # columns round a rib

L = {k: k + '_l' for k in ('wing_01', 'wing_02', 'wing_f1_01', 'wing_f1_02', 'wing_f2', 'wing_f3')}
SPINE_LOW = {'spine_02': 0.7, 'spine_03': 0.3}
SPINE_HIGH = {'spine_03': 1.0}


# -- weights ------------------------------------------------------------------------------------
def _mix(a, b, t):
	out: dict[str, float] = {}
	for k, v in a.items():
		out[k] = out.get(k, 0.0) + v * (1 - t)
	for k, v in b.items():
		out[k] = out.get(k, 0.0) + v * t
	return out


def _clean(w):
	"""At most four bones, nothing below 2 %, summing to 1."""
	top = sorted(((v, k) for k, v in w.items() if v > 0.02), reverse=True)[:4]
	total = sum(v for v, _k in top)
	return {k: v / total for v, k in top}


def _w_f1(t):
	"""Along the leading finger, t in 0..1: its first bone, then its second."""
	mid = F1_MID / (len(F1) - 1)
	return _mix({L['wing_f1_01']: 1.0}, {L['wing_f1_02']: 1.0}, MK.smooth(mid - 0.14, mid + 0.14, t))


def _w_arm(t, t_elbow):
	"""Along the arm from the wrist (t = 0) to the root (t = 1): forearm, then humerus."""
	return _mix({L['wing_02']: 1.0}, {L['wing_01']: 1.0}, MK.smooth(t_elbow - 0.10, t_elbow + 0.10, t))


# -- curves -------------------------------------------------------------------------------------
class _Poly:
	"""A polyline (optionally smoothed) sampled by its arc-length fraction."""

	def __init__(self, points, smooth=True):
		self.pts = MK.catmull(points, 12) if smooth and len(points) > 2 else [Vector(p) for p in points]
		self.acc = [0.0]
		for a, b in zip(self.pts, self.pts[1:]):
			self.acc.append(self.acc[-1] + (b - a).length)
		self.length = self.acc[-1]

	def at(self, t):
		d = min(max(t, 0.0), 1.0) * self.length
		for i in range(len(self.pts) - 1):
			if d <= self.acc[i + 1] or i == len(self.pts) - 2:
				seg = self.acc[i + 1] - self.acc[i]
				f = (d - self.acc[i]) / seg if seg > 1e-9 else 0.0
				return self.pts[i].lerp(self.pts[i + 1], f)
		return self.pts[-1].copy()

	def fraction_of(self, point):
		best, where = 1e9, 0.0
		for i in range(101):
			d = (self.at(i / 100) - Vector(point)).length
			if d < best:
				best, where = d, i / 100
		return where


def _curves():
	"""The five curves that fan out of the wrist, leading edge first, and the weights along each."""
	f1 = _Poly(F1)
	f2 = _Poly([WRIST, WRIST.lerp(F2_TIP, 0.5) + Vector((0.006, 0.004, -0.004)), F2_TIP])
	f3 = _Poly([WRIST, WRIST.lerp(F3_TIP, 0.5) + Vector((0.004, 0.003, -0.002)), F3_TIP])
	edge = _Poly([WRIST, WRIST.lerp(BODY, 0.5) + Vector((-0.012, 0.016, 0.0)), BODY])
	arm = _Poly([WRIST, ELBOW, BODY_TOP], smooth=False)
	t_elbow = arm.fraction_of(ELBOW)

	def w_edge(t):
		return _mix({L['wing_02']: 0.6, L['wing_f3']: 0.4}, SPINE_LOW, MK.smooth(0.12, 0.92, t))

	def w_arm_edge(t):
		return _mix(_w_arm(t, t_elbow), SPINE_HIGH, 0.65 * MK.smooth(0.80, 1.0, t))

	return [
		(f1, _w_f1),
		(f2, lambda t: {L['wing_f2']: 1.0}),
		(f3, lambda t: {L['wing_f3']: 1.0}),
		(edge, w_edge),
		(arm, w_arm_edge),
	]


# -- parts --------------------------------------------------------------------------------------
def _rib(m, centres, radii, weights, part='wing_bone', cols=COLS, up=None, flat=1.0):
	"""A closed tube through `centres`, capped at both ends, with a seam down its back."""
	fr = MK.frames(centres, up or -FRONT)
	secs = [dict(c=Vector(c), u=f[1], v=f[2], ra=r, rb=r * flat, tags=dict(w=_clean(w))) for c, r, f, w in zip(centres, radii, fr, weights)]
	first = secs[0]
	ring0 = m.ring(
		[first['c'] + first['u'] * (first['ra'] * math.cos(2 * math.pi * j / cols)) + first['v'] * (first['rb'] * math.sin(2 * math.pi * j / cols)) for j in range(cols)],
		part=part, side='l', w=first['tags']['w'],
	)
	rings = m.tube(ring0, secs[1:], part=part, side='l')
	t0 = (Vector(centres[0]) - Vector(centres[1])).normalized()
	t1 = (Vector(centres[-1]) - Vector(centres[-2])).normalized()
	m.cap(list(reversed(ring0)), bulge=t0 * radii[0] * 0.5, part=part, side='l', w=first['tags']['w'])
	m.cap(rings[-1], bulge=t1 * radii[-1] * 0.5, part=part, side='l', w=secs[-1]['tags']['w'])
	# seams: the column that faces the back of the wing, and both end loops
	m.seam([ring[0] for ring in rings])
	m.seam(rings[0], closed=True)
	m.seam(rings[-1], closed=True)
	return rings


def _arm(m):
	"""Humerus and forearm in one tube, with a knob at the elbow and at the wrist."""
	path = _Poly([ROOT + (ROOT - ELBOW).normalized() * 0.022, ROOT, ELBOW, WRIST, WRIST + (WRIST - ELBOW).normalized() * 0.016], smooth=False)
	t_root, t_elbow, t_wrist = path.fraction_of(ROOT), path.fraction_of(ELBOW), path.fraction_of(WRIST)
	stops = [
		(0.0, 0.019), (t_root, 0.021), ((t_root + t_elbow) / 2, 0.0165), (t_elbow - 0.05, 0.0185), (t_elbow, 0.0215), (t_elbow + 0.05, 0.0175),
		(t_elbow + (t_wrist - t_elbow) * 0.35, 0.0145), (t_elbow + (t_wrist - t_elbow) * 0.7, 0.0135), (t_wrist - 0.04, 0.016), (t_wrist, 0.021), (1.0, 0.014),
	]
	centres = [path.at(t) for t, _r in stops]
	# round the elbow: pull its ring toward the corner's inside
	centres[4] = centres[4].lerp((centres[3] + centres[5]) / 2, 0.35)
	weights = []
	for t, _r in stops:
		w = _mix({L['wing_01']: 1.0}, {L['wing_02']: 1.0}, MK.smooth(t_elbow - 0.07, t_elbow + 0.07, t))
		weights.append(_mix(w, SPINE_HIGH, 0.35 * (1 - MK.smooth(0.0, t_root + 0.04, t))))
	return _rib(m, centres, [r for _t, r in stops], weights)


def _fingers(m, curves):
	f1, f2, f3 = curves[0][0], curves[1][0], curves[2][0]
	# the leading finger: thick, with knuckles, tapering to the outer tip
	ts = [0.0, 0.07, 0.17, 0.225, 0.29, 0.40, 0.455, 0.52, 0.64, 0.69, 0.76, 0.88, 0.97, 1.0]
	knuckle = {0.225: 1.16, 0.455: 1.16, 0.69: 1.14}
	radii = [(0.0158 - 0.0098 * t**0.9) * knuckle.get(t, 1.0) for t in ts]
	radii[-1] = 0.0028
	_rib(m, [f1.at(t) for t in ts], radii, [_w_f1(t) for t in ts])
	for curve, bone, r0 in ((f2, L['wing_f2'], 0.0110), (f3, L['wing_f3'], 0.0104)):
		ts = [0.02, 0.12, 0.30, 0.50, 0.70, 0.88, 0.975, 1.0]
		radii = [r0 * (1 - 0.62 * t) for t in ts]
		radii[-1] = 0.0022
		_rib(m, [curve.at(t) for t in ts], radii, [{bone: 1.0}] * len(ts))


def _claw(m):
	"""The thumb: a flat-topped hook across the wrist, its point toward the head."""
	inward = Vector((-1.0, -0.749, 0.0)).normalized()
	up = Vector((0, 0, 1))
	c = [
		WRIST - inward * 0.040 + up * 0.016,
		WRIST - inward * 0.019 + up * 0.030,
		WRIST + inward * 0.004 + up * 0.036,
		WRIST + inward * 0.034 + up * 0.036,
		WRIST + inward * 0.064 + up * 0.028,
		WRIST + inward * 0.086 + up * 0.011,
	]
	r = [0.0040, 0.0125, 0.0180, 0.0150, 0.0095, 0.0025]
	_rib(m, c, r, [{L['wing_02']: 1.0}] * len(c), part='wing_claw', up=up, flat=0.82)


def _membrane(m, curves):
	n_lines = sum(ACROSS) + 1
	back = -FRONT
	# every column line: (sector, u)
	lines = []
	for s, n in enumerate(ACROSS):
		for i in range(n):
			lines.append((s, i / n))
	lines.append((len(ACROSS) - 1, 1.0))
	vs = [V0 + (RIM_V - V0) * (j / (ROWS - 1)) for j in range(ROWS)] + [1.0]

	def point(s, u, v):
		a, wa = curves[s]
		b, wb = curves[s + 1]
		vv = v * (1 - SAG[s] * 4 * u * (1 - u) * v)
		p = a.at(vv).lerp(b.at(vv), u)
		# the membrane cups back between the ribs, and its last sector lies flatter on the back
		bulge = BILLOW * math.sin(math.pi * u) * v ** 0.8 * (0.45 if s == 3 else 1.0)
		w = _clean(_mix(wa(vv), wb(vv), u))
		return p + back * bulge, w

	front, rear = {}, {}
	for i, (s, u) in enumerate(lines):
		for j, v in enumerate(vs):
			p, w = point(s, u, v)
			rim = i in (0, n_lines - 1) or j in (0, ROWS)
			if rim:
				front[i, j] = rear[i, j] = m.vert(p, part='wing_membrane', side='l', w=w, rim=1)
			else:
				front[i, j] = m.vert(p + FRONT * THICK, part='wing_membrane', side='l', w=w, face='front')
				rear[i, j] = m.vert(p - FRONT * THICK, part='wing_membrane', side='l', w=w, face='back')
	for i in range(n_lines - 1):
		for j in range(ROWS):
			m.quad(front[i, j], front[i + 1, j], front[i + 1, j + 1], front[i, j + 1])
			m.quad(rear[i, j], rear[i, j + 1], rear[i + 1, j + 1], rear[i + 1, j])
	rim = [front[i, 0] for i in range(n_lines)]
	rim += [front[n_lines - 1, j] for j in range(1, ROWS + 1)]
	rim += [front[i, ROWS] for i in range(n_lines - 2, -1, -1)]
	rim += [front[0, j] for j in range(ROWS - 1, 0, -1)]
	m.seam(rim, closed=True)


# -- the wing -----------------------------------------------------------------------------------
def joints() -> dict:
	f1 = _Poly(F1)
	return {
		'wing_01': tuple(ROOT),
		'wing_02': tuple(ELBOW),
		'wing_wrist': tuple(WRIST),
		'wing_f1_mid': tuple(f1.at(F1_MID / (len(F1) - 1))),
		'wing_f1_tip': tuple(F1[-1]),
		'wing_f2_tip': tuple(F2_TIP),
		'wing_f3_tip': tuple(F3_TIP),
		'body_anchor': tuple(BODY),
		'body_top': tuple(BODY_TOP),
	}


def build_wing() -> tuple[MK.Cage, dict]:
	"""The LEFT wing (+X side) at final density (it is NOT subdivided later)."""
	m = MK.Cage()
	curves = _curves()
	_membrane(m, curves)
	_arm(m)
	_fingers(m, curves)
	_claw(m)
	return m, joints()


def mirrored(cage: MK.Cage) -> MK.Cage:
	"""The right wing from the left one: x negated, faces turned, `_l` bones and tags become `_r`."""
	out = MK.Cage()
	for p, tags in zip(cage.co, cage.tags):
		t = dict(tags)
		t['side'] = 'r'
		t['w'] = {(k[:-2] + '_r' if k.endswith('_l') else k): v for k, v in tags['w'].items()}
		out.vert((-p.x, p.y, p.z), **t)
	out.faces = [tuple(reversed(f)) for f in cage.faces]
	out.seams = set(cage.seams)
	return out


def stats(cage: MK.Cage) -> dict:
	used = {i for f in cage.faces for i in f}
	return {
		'verts': len(cage.co),
		'quads': len(cage.faces),
		'tris': 2 * len(cage.faces),
		'non_quads': sum(1 for f in cage.faces if len(f) != 4),
		'loose_verts': len(cage.co) - len(used),
		'open_edges, over_shared_edges': cage.check(),
		'max_influences': max(len(t['w']) for t in cage.tags),
		'worst_weight_sum_error': max(abs(sum(t['w'].values()) - 1) for t in cage.tags),
	}
