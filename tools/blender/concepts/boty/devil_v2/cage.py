"""Devil v2: the body cage. One closed quad mesh, box-modelled by code.

Trunk and head are one loft of 24-column rings; arms, tail, nose, ears, eye sockets and the mouth
are cut out of it as patches and extruded; legs come out of the bottom cap; fingers and toes out of
the palms' and feet's end caps. Subdividing the cage once gives `CH_devil_LOD0`.
"""

from __future__ import annotations

import math

from mathutils import Vector

import meshkit as MK
import spec as S

N = S.N
R8 = [(-1, -1), (-1 / 3, -1), (1 / 3, -1), (1, -1), (1, 1), (1 / 3, 1), (-1 / 3, 1), (-1, 1)]
# Ten columns as a rounded slab, four across: palms, soles and ears.
R10 = [(-0.93, -0.78), (-0.5, -1), (0, -1), (0.5, -1), (0.93, -0.78), (0.93, 0.78), (0.5, 1), (0, 1), (-0.5, 1), (-0.93, 0.78)]


def col_angles(t):
	half = [(1 - t) * u + t * f for u, f in zip(S.UNIFORM, S.FACE)]
	return half + [360.0 - a for a in half[11:0:-1]]


def spine_t(z):
	"""Parameter along the spine chain: 0 pelvis, 1 spine_01 ... 4 neck_01, 5 head."""
	zs = [S.J[k][2] for k in ('pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head')]
	if z <= zs[0]:
		return 0.0
	for i in range(5):
		if z <= zs[i + 1]:
			return i + (z - zs[i]) / (zs[i + 1] - zs[i])
	return 5.0


class Devil:
	def __init__(self):
		self.m = MK.Cage()
		self.mir: dict[int, int] = {}
		self.rings: list[list[int]] = []
		self.claws: list[dict] = []  # where the claws go: tip, direction, up, bone
		self.eyes: list[dict] = []
		self.info: dict = {}
		self.loops: dict[str, list] = {}  # name -> rings of a tube, root first (left side where mirrored)

	# -- helpers --------------------------------------------------------------------------
	def v(self, r, k):
		return self.rings[r][k % N]

	def patch_loop(self, r0, r1, k0, k1):
		loop = [self.v(r0, k) for k in range(k0, k1 + 1)]
		loop += [self.v(r, k1) for r in range(r0 + 1, r1 + 1)]
		loop += [self.v(r1, k) for k in range(k1 - 1, k0 - 1, -1)]
		loop += [self.v(r, k0) for r in range(r1 - 1, r0, -1)]
		return loop

	def sections(self, centres, radii, up, ts=None, twists=None, pts=None, tags=None):
		fr = MK.frames(centres, up)
		out = []
		for i, (c, (_t, u, v)) in enumerate(zip(centres, fr)):
			r = radii[i]
			ra, rb = (r, r) if isinstance(r, (int, float)) else r
			s = dict(c=c, u=u, v=v, ra=ra, rb=rb)
			if ts is not None:
				s['tags'] = dict(t=ts[i])
				if tags and tags[i]:
					s['tags'].update(tags[i])
			if twists is not None:
				s['twist'] = twists[i]
			if pts is not None and pts[i] is not None:
				s['pts'] = pts[i]
			out.append(s)
		return out

	def mirror_new(self, v0, f0, flip_tags=True):
		"""Mirror every vertex and face made since (v0, f0) to the other side."""
		m = self.m
		for i in range(v0, len(m.co)):
			p = m.co[i]
			tags = dict(m.tags[i])
			if flip_tags and tags.get('side') == 'l':
				tags['side'] = 'r'
			j = m.vert((-p.x, p.y, p.z), **tags)
			self.mir[i] = j
			self.mir[j] = i
		for f in list(m.faces[f0:]):
			m.faces.append(tuple(self.mir[i] for i in reversed(f)))
		for s in list(m.seams):
			a, b = tuple(s)
			if a >= v0 or b >= v0:
				m.seams.add(frozenset((self.mir.get(a, a), self.mir.get(b, b))))

	# -- trunk and head -------------------------------------------------------------------
	def trunk(self):
		m = self.m
		head0 = S.RING['throat']
		for ri, row in enumerate(S.TRUNK):
			name, zf, zs, zb, a, bf, bb, yc, t = row
			ring = []
			for k, ang in enumerate(col_angles(t)):
				ph = math.radians(ang)
				c, s = math.cos(ph), math.sin(ph)
				e = 2.0 / S.SHAPE.get(name, 2.0) if c > 0 else 1.0
				x = a * math.copysign(abs(s) ** e, s)
				y = yc - (bf * abs(c) ** e if c >= 0 else bb * c)
				z = zs + (zf - zs) * max(c, 0) ** S.Z_POWER.get(name, 2.0) + (zb - zs) * max(-c, 0) ** 2
				if k in (0, 12):
					x = 0.0
				t_spine = spine_t(z) if ri < head0 else (5.0 if ri == head0 else 5.5)
				ring.append(m.vert((x, y, z), part='head' if ri >= head0 else 'trunk', ring=name, col=k if k <= 12 else k - N, chain='spine', t=t_spine, side='c' if k in (0, 12) else ('l' if k < 12 else 'r')))
			self.rings.append(ring)
			for k in range(N):
				self.mir[ring[k]] = ring[(N - k) % N]

		R = S.RING
		skip: dict[int, set] = {i: set() for i in range(len(S.TRUNK))}

		def hole(r0, r1, k0, k1):
			for r in range(r0, r1):
				for k in range(k0, k1):
					skip[r].add(k % N)

		self.patch = {}
		hole(R['chest'], R['shoulder'], 5, 7)
		hole(R['chest'], R['shoulder'], 17, 19)
		self.patch['arm'] = self.patch_loop(R['chest'], R['shoulder'], 5, 7)
		hole(R['sacrum'], R['belly2'], 11, 13)
		self.patch['tail'] = self.patch_loop(R['sacrum'], R['belly2'], 11, 13)
		hole(R['lip_up'], R['eye'], -1, 1)
		self.patch['nose'] = self.patch_loop(R['lip_up'], R['eye'], -1, 1)
		hole(R['eye_lo'], R['eye_up'], 2, 4)
		hole(R['eye_lo'], R['eye_up'], 20, 22)
		self.patch['eye'] = self.patch_loop(R['eye_lo'], R['eye_up'], 2, 4)
		hole(R['eye_lo'], R['brow'], 7, 9)
		hole(R['eye_lo'], R['brow'], 15, 17)
		self.patch['ear'] = self.patch_loop(R['eye_lo'], R['brow'], 7, 9)
		hole(R['lip_lo'], R['lip_up'], -6, 6)
		self.patch['mouth'] = [self.v(R['lip_lo'], k) for k in range(-6, 7)] + [self.v(R['lip_up'], k) for k in range(6, -7, -1)]
		# crest: a row of spikes down the back of the head, smaller ones either side
		self.patch['crest'] = []
		for r in range(R['muzzle'], R['crown1']):
			hole(r, r + 1, 11, 13)
			self.patch['crest'].append((self.patch_loop(r, r + 1, 11, 13), 0.9 if r > R['eye'] else 0.6))
		self.patch['spikes'] = []
		for r, k in ((R['crown0'], 9), (R['brow'], 10), (R['eye_up'], 10), (R['muzzle'], 10)):
			for kk in (k, N - k - 1):
				hole(r, r + 1, kk, kk + 1)
				self.patch['spikes'].append(self.patch_loop(r, r + 1, kk, kk + 1))

		for r in range(len(self.rings) - 1):
			m.bridge(self.rings[r], self.rings[r + 1], skip[r])

		# bottom cap (the crotch), with the two leg openings
		loop = [self.v(0, 15 - k) for k in range(N)]
		g = m.cap_grid(loop, 6, 6, bulge=(0, 0.004, -0.030), part='trunk', chain='spine', t=0.0, side='c')
		for j in range(7):
			for i in range(7):
				self.mir[g[j][i]] = g[j][6 - i]
				if i != 3:
					m.tags[g[j][i]]['side'] = 'l' if i > 3 else 'r'
		m.fill_grid(g, skip={(i, j) for i in (4, 5, 0, 1) for j in (1, 2, 3)})
		# the cleft: a fold down the back's midline and under
		m.crease([self.v(r, 12) for r in range(R['sacrum'], R['hip'] - 1, -1)] + [g[1][3]], 0.55)
		self.patch['leg'] = [g[1][4], g[1][5], g[1][6], g[2][6], g[3][6], g[4][6], g[4][5], g[4][4], g[3][4], g[2][4]]
		self.bottom = g

		# top cap (the crown), with the crest's openings
		top = len(self.rings) - 1
		loop = [self.v(top, 21 + k) for k in range(N)]
		g = m.cap_grid(loop, 6, 6, bulge=(0, 0.0, 0.016), part='head', chain='spine', t=5.5, side='c')
		for j in range(7):
			for i in range(7):
				self.mir[g[j][i]] = g[j][6 - i]
				if i != 3:
					m.tags[g[j][i]]['side'] = 'l' if i > 3 else 'r'
		cells = set()
		for j in range(0, 6):
			cells |= {(2, j), (3, j)}
			self.patch['crest'].append(([g[j][2], g[j][3], g[j][4], g[j + 1][4], g[j + 1][3], g[j + 1][2]], (0.5, 0.75, 0.95, 1.0, 1.0, 0.95)[j]))
		m.fill_grid(g, skip=cells)
		self.top = g

	# -- limbs ----------------------------------------------------------------------------
	def arm(self):
		m = self.m
		v0, f0 = len(m.co), len(m.faces)
		tag = dict(part='arm', chain='arm', side='l')
		c = [(0.108, 0.000, 0.684), (0.150, 0.002, 0.681), (0.205, 0.004, 0.679), (0.252, 0.006, 0.678), (0.276, 0.008, 0.677), (0.300, 0.006, 0.677), (0.345, 0.003, 0.678), (0.408, 0.000, 0.676), (0.455, 0.000, 0.674), (0.492, 0.000, 0.671), (0.530, -0.002, 0.667), (0.562, -0.002, 0.662)]
		r = [(0.047, 0.048), (0.038, 0.037), 0.033, 0.032, (0.037, 0.036), 0.035, (0.044, 0.041), (0.036, 0.032), (0.037, 0.028), (0.052, 0.034), (0.066, 0.034), (0.071, 0.027)]
		ts = [0.05, 0.3, 0.62, 0.88, 1.0, 1.13, 1.4, 1.75, 2.0, 2.3, 2.7, 3.0]
		pts = [None] * 9 + [R10, R10, R10]
		secs = self.sections(c, r, (0, -1, 0), ts, None, pts)
		for s in secs[9:]:
			s['tags']['part'] = 'hand'
		rings = m.tube(self.patch['arm'], secs, **tag)
		palm0, palm1, knuckle = rings[10], rings[11], rings[12]
		self.loops['arm'] = rings
		n = len(knuckle)
		# the thumb grows from the palm's front side face, between the two palm rings
		a, b = sorted(sorted(range(n), key=lambda j: m.co[palm1[j]].y)[:2])
		if (a, b) == (0, n - 1):
			a, b = n - 1, 0
		quad = (palm0[a], palm0[b], palm1[b], palm1[a])
		m.faces.remove(quad)
		self._digit(list(quad), base_dir=Vector((0.58, -0.78, -0.22)), lengths=(0.040, 0.032, 0.022), r0=0.0260, chain='thumb', bones=('thumb_01', 'thumb_02'), curl_axis=Vector((0.6, 0.3, -0.75)), curl=0.25, tag=tag)
		# four fingers from the knuckle cap: four quads in a row
		start = None
		for st in range(n):
			zs = [m.co[knuckle[(st + j) % n]].z for j in range(n)]
			if max(zs[: n // 2]) < min(zs[n // 2 :]) or min(zs[: n // 2]) > max(zs[n // 2 :]):
				start = st
				break
		assert start is not None, 'knuckle ring is not a 5 + 5 layout'
		g = m.cap_grid(knuckle, 4, 1, start=start)
		cells = [[g[0][i], g[0][i + 1], g[1][i + 1], g[1][i]] for i in range(4)]
		cells.sort(key=lambda lp: m.centre(lp).y)  # index finger first (the thumb's side)
		spec = (((0.040, 0.031, 0.022), 0.0245), ((0.045, 0.034, 0.023), 0.0250), ((0.042, 0.032, 0.022), 0.0240), ((0.034, 0.026, 0.020), 0.0215))
		for i, loop in enumerate(cells):
			yc = m.centre(loop).y + 0.002
			self._digit(loop, base_dir=Vector((1.0, yc * 3.0, -0.10)), lengths=spec[i][0], r0=spec[i][1], chain=f'finger{i + 1}', bones=(f'finger{i + 1}_01', f'finger{i + 1}_02'), curl_axis=Vector((0, -1, 0)), curl=-0.24, tag=tag)
		self.mirror_new(v0, f0)

	def _digit(self, loop, base_dir, lengths, r0, chain, bones, curl_axis, curl, tag, claw=1.0, part='finger', t0=0.0):
		"""A finger, thumb or toe: a fat four-column tube with two knuckles and a round tip for the claw."""
		from mathutils import Matrix

		m = self.m
		c0 = m.centre(loop)
		d = base_dir.normalized()
		rot = Matrix.Rotation(curl, 3, curl_axis.normalized())
		joints = [c0]
		dirs = [d.copy()]
		p = c0.copy()
		for ln in lengths:
			p = p + d * ln
			joints.append(p.copy())
			d = (rot @ d).normalized()
			dirs.append(d.copy())
		l1, l2, l3 = lengths
		# rings: at the root (close, so the junction stays round), mid 1, knuckle, mid 2, knuckle, tip
		cs = [c0 + dirs[0] * (l1 * 0.20), c0 + dirs[0] * (l1 * 0.62), joints[1], joints[1] + dirs[1] * (l2 * 0.5), joints[2], joints[2] + dirs[2] * (l3 * 0.6)]
		rs = [r0 * 1.04, r0 * 1.05, r0 * 0.95, r0 * 1.03, r0 * 0.94, r0 * 0.90]
		ts = [t0 + 0.2, t0 + 0.62, t0 + 1.0, t0 + 1.5, t0 + 2.0, t0 + 2.4]
		n = MK.Cage.normal(m, loop)
		up = n.cross(dirs[0])
		if up.length < 1e-5:
			up = Vector((0, 0, 1))
		secs = self.sections(cs, rs, up, ts)
		t = dict(tag)
		t.update(part=part, chain=chain)
		rings = m.tube(loop, secs, **t)
		self.loops.setdefault(chain, []).append(rings)
		m.cap(rings[-1], bulge=dirs[2] * (r0 * 0.6), **dict(t, t=t0 + 2.5))
		# the claw grows out of the top of the fingertip and hooks the way the digit curls
		top = dirs[1] - dirs[2]
		top = top.normalized() if top.length > 1e-5 else Vector((0, 0, 1))
		self.claws.append(dict(tip=joints[2] + dirs[2] * (l3 * 0.30) + top * (r0 * 0.20), dir=(dirs[2] + top * 0.30).normalized(), curl_axis=curl_axis.normalized().copy(), curl=curl, bone=bones[1] if bones else None, r=r0 * 0.60, length=r0 * 2.5 * claw, side='l', chain=chain))
		self.info.setdefault('digits', {}).setdefault(chain, []).append([j.copy() for j in joints])
		return joints

	def leg(self):
		m = self.m
		v0, f0 = len(m.co), len(m.faces)
		tag = dict(part='leg', chain='leg', side='l')
		c = [
			(0.062, 0.000, 0.330), (0.062, -0.004, 0.298), (0.062, -0.014, 0.268), (0.063, -0.020, 0.246), (0.063, -0.014, 0.222),
			(0.063, -0.002, 0.175), (0.063, 0.010, 0.125), (0.063, 0.016, 0.092),
			(0.063, 0.020, 0.064), (0.064, 0.008, 0.042), (0.066, -0.032, 0.037), (0.071, -0.080, 0.031), (0.077, -0.122, 0.026),
		]
		r = [(0.058, 0.056), (0.050, 0.052), (0.039, 0.043), (0.042, 0.046), (0.037, 0.040), 0.034, 0.030, (0.034, 0.040), (0.036, 0.048), (0.041, 0.053), (0.049, 0.041), (0.062, 0.035), (0.080, 0.028)]
		ts = [0.12, 0.45, 0.8, 1.0, 1.15, 1.45, 1.8, 2.0, 2.15, 2.3, 2.5, 2.75, 3.0]
		pts = [None] * 10 + [R10, R10, R10]
		secs = self.sections(c, r, (1, 0, 0), ts, None, pts)
		for s in secs[8:]:
			s['tags']['part'] = 'foot'
		rings = m.tube(self.patch['leg'], secs, **tag)
		self.loops['leg'] = rings
		end = rings[-1]
		n = len(end)
		start = None
		for st in range(n):
			zs = [m.co[end[(st + j) % n]].z for j in range(n)]
			if max(zs[: n // 2]) < min(zs[n // 2 :]) or min(zs[: n // 2]) > max(zs[n // 2 :]):
				start = st
				break
		assert start is not None, 'toe ring is not a 5 + 5 layout'
		g = m.cap_grid(end, 4, 1, start=start)
		cells = [[g[0][i], g[0][i + 1], g[1][i + 1], g[1][i]] for i in range(4)]
		cells.sort(key=lambda lp: m.centre(lp).x)  # the inner toe first, the small outer toe last
		spec = (((0.040, 0.032, 0.024), 0.0290), ((0.046, 0.036, 0.025), 0.0300), ((0.040, 0.032, 0.024), 0.0290), ((0.030, 0.024, 0.021), 0.0250))
		for i, loop in enumerate(cells):
			self._digit(loop, base_dir=Vector(((i - 1.3) * 0.22, -1.0, -0.02)), lengths=spec[i][0], r0=spec[i][1], chain='toe', bones=('ball', 'ball'), curl_axis=Vector((-1, 0, 0)), curl=-0.10, tag=tag, claw=1.1, part='toe', t0=3.0)
		self.mirror_new(v0, f0)

	def tail(self):
		m = self.m
		nb = S.TAIL_BONES
		ts = [t * nb / 6.0 for t in (0.25, 0.7, 1.3, 2.0, 2.7, 3.4, 4.1, 4.8, 5.4, 5.85)]
		span = len(S.TAIL) - 1
		c = MK.sample(S.TAIL, [t / nb * span for t in ts])
		r = [0.026 - 0.011 * (i / (len(ts) - 1)) ** 0.75 for i in range(len(ts))]
		secs = self.sections(c, r, (0, 1, 0), ts)
		rings = m.tube(self.patch['tail'], secs, part='tail', chain='tail', side='c')
		# arrow-head: barbs flare back past the last ring, then a flat blade to the point
		p0 = Vector(S.TAIL[-1])
		d = Vector(S.TAIL_ARROW).normalized()
		u = Vector((0, 1, 0))
		u = (u - d * u.dot(d)).normalized()
		v = d.cross(u).normalized()
		ln = S.TAIL_ARROW_LENGTH
		head = [
			dict(c=p0 - d * 0.014, u=u, v=v, ra=0.015, rb=0.056, tags=dict(t=nb - 0.05)),
			dict(c=p0 + d * 0.018, u=u, v=v, ra=0.017, rb=0.044, tags=dict(t=float(nb))),
			dict(c=p0 + d * ln * 0.55, u=u, v=v, ra=0.013, rb=0.024, tags=dict(t=float(nb))),
			dict(c=p0 + d * ln * 0.93, u=u, v=v, ra=0.005, rb=0.007, tags=dict(t=float(nb))),
		]
		rings2 = m.tube(rings[-1], head, part='tail', chain='tail', side='c', tip=1)
		self.loops['tail'] = rings + rings2[1:]
		m.cap(rings2[-1], bulge=d * 0.008, part='tail', chain='tail', side='c', t=float(nb), tip=1)

	def nose(self):
		m = self.m
		ts = [0.02, 0.2, 0.4, 0.6, 0.8, 0.95]
		c = MK.sample(S.NOSE, [t * (len(S.NOSE) - 1) for t in ts])
		r = [(0.047, 0.031), (0.044, 0.034), (0.036, 0.030), (0.026, 0.022), (0.015, 0.013), (0.006, 0.005)]
		secs = self.sections(c, r, (0, 0, 1))
		rings = m.tube(self.patch['nose'], secs, part='nose', chain='spine', t=5.5, side='c')
		self.loops['nose'] = rings
		tip = Vector(S.NOSE[-1])
		m.cap(rings[-1], bulge=(tip - c[-1]) * 0.9, part='nose', chain='spine', t=5.5, side='c')
		for ring in rings[1:]:
			n = len(ring)
			for j in range(n):
				p = m.co[ring[j]]
				if abs(p.x) < 1e-5:
					m.co[ring[j]].x = 0.0

	def ear(self):
		m = self.m
		v0, f0 = len(m.co), len(m.faces)
		base, tip = Vector(S.J['ear']), Vector(S.J['ear_end'])
		axis = (tip - base).normalized()
		wide = Vector((0.72, -0.69, 0.0))
		wide = (wide - axis * wide.dot(axis)).normalized()
		thick = axis.cross(wide).normalized()
		front = thick if thick.y < 0 else -thick
		ts = [0.05, 0.18, 0.34, 0.50, 0.66, 0.82, 0.94]
		ln = (tip - base).length
		c = [base + axis * (ln * t) + wide * (0.006 * math.sin(math.pi * t)) for t in ts]
		r = [(0.050, 0.022), (0.064, 0.018), (0.060, 0.015), (0.049, 0.012), (0.036, 0.010), (0.021, 0.008), (0.009, 0.006)]
		secs = [dict(c=cc, u=wide, v=thick, ra=rr[0], rb=rr[1], pts=R10, tags=dict(t=t)) for cc, rr, t in zip(c, r, ts)]
		rings = m.tube(self.patch['ear'], secs, part='ear', chain='ear', side='l')
		self.loops['ear'] = rings
		m.cap(rings[-1], bulge=axis * 0.030, part='ear', chain='ear', side='l', t=1.0)
		# the bowl: the front face sinks between a thick rim; deepest low down, where the canal is
		depth = [0.016, 0.034, 0.032, 0.024, 0.015, 0.007, 0.002]
		for ri, ring in enumerate(rings[1:]):
			cc = m.centre(ring)
			for i in ring:
				p = m.co[i] - cc
				across = p.dot(wide) / secs[ri]['ra']
				if p.dot(front) > 0 and abs(across) < 0.75:
					m.co[i] = m.co[i] - front * (depth[ri] * (1.0 if abs(across) < 0.25 else 0.62))
				elif p.dot(front) > 0:
					m.co[i] = m.co[i] + front * 0.004  # the rim rolls forward
		self.mirror_new(v0, f0)

	def eye(self):
		m = self.m
		v0, f0 = len(m.co), len(m.faces)
		loop = self.patch['eye']
		c0 = m.centre(loop)
		n = m.normal(loop)
		u = Vector((0, 0, 1)).cross(n).normalized()
		v = n.cross(u).normalized()
		hw = max(abs((m.co[i] - c0).dot(u)) for i in loop)
		hh = max(abs((m.co[i] - c0).dot(v)) for i in loop)
		# the opening leans: outer corner up, inner corner down (the scowl)
		lean = math.radians(-16)
		ur = u * math.cos(lean) + v * math.sin(lean)
		vr = v * math.cos(lean) - u * math.sin(lean)
		secs = [
			dict(c=c0 + n * 0.0050, u=ur, v=vr, ra=hw * 1.00, rb=hh * 0.82, tags=dict(lid='rim')),
			dict(c=c0 + n * 0.0045, u=ur, v=vr, ra=hw * 0.90, rb=hh * 0.58, tags=dict(lid='edge')),
			dict(c=c0 - n * 0.0040, u=ur, v=vr, ra=hw * 0.94, rb=hh * 0.64, tags=dict(lid='in')),
			dict(c=c0 - n * 0.0300, u=ur, v=vr, ra=hw * 0.98, rb=hh * 0.90, tags=dict(lid='socket')),
		]
		rings = m.tube(loop, secs, part='eyelid', chain='spine', t=5.5, side='l')
		self.loops['eye'] = rings
		m.cap(rings[-1], bulge=-n * 0.010, part='eyelid', chain='spine', t=5.5, side='l', lid='socket')
		self.eyes.append(dict(centre=c0 - n * 0.0185, normal=n.copy(), u=ur.copy(), v=vr.copy(), radius=0.0240, side='l', hw=hw * 0.90, hh=hh * 0.58))
		self.mirror_new(v0, f0)

	def mouth(self):
		m = self.m
		loop = self.patch['mouth']
		n = len(loop)
		half = n // 2
		axis_y = -0.030

		def ring(inset, dz, **tags):
			out = []
			for j, i in enumerate(loop):
				p = m.co[i]
				lower = j < half
				d = Vector((-p.x, axis_y - p.y, 0))
				ln = d.length
				d = d / ln if ln > 1e-6 else Vector((0, 1, 0))
				step = min(inset, ln * 0.75)
				q = p + d * step + Vector((0, 0, dz if lower else -dz))
				if abs(p.x) < 1e-6:
					q.x = 0.0
				out.append(m.vert(q, part='mouth', chain='spine', t=5.5, col=(j - 6) if lower else (6 - (j - half)), jawf=1.0 if lower else 0.0, side='c' if abs(p.x) < 1e-6 else ('l' if p.x > 0 else 'r'), **tags))
			return out

		l1 = ring(0.005, 0.0020, lip=1)
		l2 = ring(0.014, -0.004)
		l3 = ring(0.050, -0.012)
		m.bridge(loop, l1)
		m.bridge(l1, l2)
		m.bridge(l2, l3)
		g = m.cap_grid(l3, half - 1, 1)
		self.info['mouth_back'] = l3
		m.fill_grid(g)
		for ringv in (l1, l2, l3):
			for j in range(n):
				# lower row j ↔ lower row mirrored; the loop runs -6..6 then 6..-6
				self.mir[ringv[j]] = ringv[half - 1 - j] if j < half else ringv[n - 1 - (j - half)]
		self.info['mouth_rings'] = (loop, l1, l2, l3)

	def crest(self):
		m = self.m
		for loop, size in self.patch['crest']:
			c0 = m.centre(loop)
			n = m.normal(loop)
			lean = (n + Vector((0, 0.55, 0.25))).normalized()
			h = 0.058 * size
			u = Vector((1, 0, 0))
			v = lean.cross(u).normalized()
			span = max((m.co[i] - c0).length for i in loop)
			secs = [
				dict(c=c0 + lean * h * 0.32, u=u, v=v, ra=span * 0.50, rb=span * 0.42),
				dict(c=c0 + lean * h * 0.72 + Vector((0, 0.006, 0)), u=u, v=v, ra=span * 0.24, rb=span * 0.20),
				dict(c=c0 + lean * h + Vector((0, 0.014, 0)), u=u, v=v, ra=span * 0.06, rb=span * 0.06),
			]
			rings = m.tube(loop, secs, part='crest', chain='spine', t=5.5, side='c')
			m.cap(rings[-1], bulge=lean * 0.004, part='crest', chain='spine', t=5.5, side='c')
			for ring in rings[1:]:
				for i in ring:
					if abs(m.co[i].x) < 2e-4:
						m.co[i].x = 0.0
		for loop in self.patch['spikes']:
			c0 = m.centre(loop)
			n = m.normal(loop)
			lean = (n + Vector((0, 0.5, -0.1))).normalized()
			h = 0.034
			u = lean.orthogonal().normalized()
			v = lean.cross(u).normalized()
			span = max((m.co[i] - c0).length for i in loop)
			secs = [
				dict(c=c0 + lean * h * 0.4, u=u, v=v, ra=span * 0.42, rb=span * 0.42),
				dict(c=c0 + lean * h, u=u, v=v, ra=span * 0.07, rb=span * 0.07),
			]
			rings = m.tube(loop, secs, part='crest', chain='spine', t=5.5, side='l' if c0.x > 0 else 'r')
			m.cap(rings[-1], bulge=lean * 0.003, part='crest', chain='spine', t=5.5, side='l' if c0.x > 0 else 'r')

	# -- sculpt ---------------------------------------------------------------------------
	def sculpt(self):
		g = self.m.grab

		def trunk(t):
			return t.get('part') == 'trunk'

		def head(t):
			return t.get('part') in ('head', 'eyelid')

		# torso
		g((0.046, -0.090, 0.652), 0.045, (0.004, -0.014, -0.002), trunk)  # pecs
		g((0.0, -0.095, 0.655), 0.022, (0, 0.006, 0), trunk, mirror=False)  # sternum
		g((0.0, -0.214, 0.447), 0.020, (0, 0.010, 0), trunk, mirror=False)  # navel
		g((0.0, 0.058, 0.58), 0.035, (0, -0.008, 0), trunk, mirror=False)  # spine groove
		g((0.050, 0.060, 0.655), 0.04, (0.004, 0.008, 0), trunk)  # shoulder blades
		ringed = lambda t: t.get('part') == 'trunk' and 'ring' in t  # noqa: E731
		# the potbelly is a ball
		self.m.inflate(S.BELLY, S.BELLY_RADIUS, ringed, mirror=False, skip_midline=False, soft=0.3)
		# buttocks: two round cheeks with a deep cleft between them
		self.m.bulge(S.BUTTOCK, S.BUTTOCK_RADIUS, (0.12, 1.0, 0.0), lambda t: ringed(t) and abs(t.get('col', 0)) >= 7, soft=0.3)
		for r in range(S.RING['rump0'], S.RING['sacrum'] + 1):
			i = self.rings[r][12]
			self.m.co[i].y = min(self.m.co[i].y, S.BUTTOCK[1] + S.BUTTOCK_RADIUS * 0.45)
		g((0.0, 0.085, 0.345), 0.030, (0, -0.024, 0.016), trunk, mirror=False)  # the cleft runs under
		g((0.0, 0.080, 0.545), 0.045, (0, -0.012, 0), trunk, mirror=False)  # the small of the back
		g((0.075, 0.060, 0.530), 0.040, (-0.006, -0.006, 0), trunk)  # the waist, seen from behind
		g((0.085, 0.0, 0.715), 0.04, (0.006, 0, 0.004), trunk)  # shoulder caps
		g((0.035, -0.045, 0.725), 0.03, (0, -0.006, 0.003), trunk)  # collarbones
		# head
		g((0.058, -0.150, 0.940), 0.045, (0.0, -0.014, -0.006), head)  # brow ridge
		g((0.0, -0.150, 0.935), 0.03, (0, -0.006, -0.004), head, mirror=False)  # glabella
		g((0.110, -0.085, 0.892), 0.045, (0.008, -0.004, 0.0), head)  # cheekbones
		g((0.085, -0.120, 0.862), 0.035, (0.006, -0.008, 0.004), head)  # the grin's cheeks
		g((0.0, -0.228, 0.752), 0.035, (0, -0.012, -0.006), head, mirror=False)  # chin
		g((0.0, 0.118, 0.905), 0.07, (0, 0.006, 0.0), head, mirror=False)  # occiput
		g((0.0, -0.120, 0.965), 0.05, (0, 0.006, -0.002), head, mirror=False)  # sloping forehead

	def sculpt_limbs(self):
		"""Hands and feet: palm pads, knuckles, heel and ankle. Mirrored through the cage's own map."""
		m = self.m

		def hand(t):
			return t.get('part') in ('hand', 'arm')

		def foot(t):
			return t.get('part') in ('foot', 'leg')

		m.bulge((0.498, -0.034, 0.666), 0.034, (0, -0.2, -1), hand, soft=0.5)  # the ball of the thumb
		m.bulge((0.502, 0.034, 0.666), 0.030, (0, 0.2, -1), hand, soft=0.5)  # the heel of the hand
		m.bulge((0.546, 0.000, 0.664), 0.030, (0, 0, -1), hand, soft=0.5)  # the pad under the knuckles
		for y in (-0.050, -0.017, 0.016, 0.048):
			m.grab((0.556, y, 0.690), 0.020, (0.0, 0.0, 0.004), hand)  # knuckles
		m.grab((0.458, 0.030, 0.690), 0.024, (0, 0.003, 0.004), hand)  # the wrist bone
		m.bulge((0.063, 0.030, 0.044), 0.042, (0, 1.0, -0.35), foot, soft=0.4)  # the heel
		m.grab((0.094, 0.020, 0.090), 0.026, (0.008, 0.0, 0.0), foot)  # the ankle bone
		m.grab((0.034, 0.016, 0.086), 0.022, (-0.005, 0.0, 0.0), foot)
		m.bulge((0.072, -0.090, 0.040), 0.040, (0, 0, -1), foot, soft=0.5)  # the ball of the foot

	# -- build ----------------------------------------------------------------------------
	def build(self):
		self.trunk()
		self.arm()
		self.leg()
		self.tail()
		self.nose()
		self.ear()
		self.eye()
		self.mouth()
		self.crest()
		self.sculpt()
		self.sculpt_limbs()
		self.compact()
		return self

	def compact(self):
		"""Drop the vertices left inside removed patches and renumber."""
		m = self.m
		used = sorted({i for f in m.faces for i in f})
		remap = {old: new for new, old in enumerate(used)}
		m.co = [m.co[i] for i in used]
		m.tags = [m.tags[i] for i in used]
		m.faces = [tuple(remap[i] for i in f) for f in m.faces]
		m.seams = {frozenset(remap[i] for i in s) for s in m.seams if all(i in remap for i in s)}
		m.creases = {frozenset(remap[i] for i in k): v for k, v in m.creases.items() if all(i in remap for i in k)}
		self.mir = {remap[a]: remap[b] for a, b in self.mir.items() if a in remap and b in remap}
		self.rings = [[remap.get(i, -1) for i in ring] for ring in self.rings]
		self.remap = remap

		def re(x):
			return [re(y) for y in x] if isinstance(x, list) else remap[x]

		self.loops = {k: re(v) for k, v in self.loops.items()}
		self.bottom = [[remap.get(i, -1) for i in row] for row in self.bottom]
		self.top = [[remap.get(i, -1) for i in row] for row in self.top]
		if 'mouth_rings' in self.info:
			self.info['mouth_rings'] = tuple([remap[i] for i in ring] for ring in self.info['mouth_rings'])
			self.info['mouth_back'] = [remap[i] for i in self.info['mouth_back']]

	def symmetry_error(self):
		m = self.m
		worst = 0.0
		for a, b in self.mir.items():
			p, q = m.co[a], m.co[b]
			worst = max(worst, (Vector((-p.x, p.y, p.z)) - q).length)
		return worst
