"""Devil v2: the small separate parts, at final density: eyeballs, teeth, tongue, claws, brows, tuft.

They live in the same mesh object as the body (one skinned mesh, one material), as closed shells of
their own. Each vertex carries its part and its bone weights directly.
"""

from __future__ import annotations

import math

from mathutils import Matrix, Vector

import meshkit as MK
import spec as S


class Extras:
	def __init__(self):
		self.m = MK.Cage()

	# -- primitives -----------------------------------------------------------------------
	def spike(self, base, d, r, length, n=6, bend_axis=None, bend=0.0, steps=3, flat=1.0, taper=0.9, u_hint=None, **tags):
		"""A closed cone that can curl: claws, teeth, hair."""
		m = self.m
		d = Vector(d).normalized()
		u = Vector(u_hint) if u_hint is not None else d.orthogonal()
		u = (u - d * u.dot(d)).normalized()
		v = d.cross(u).normalized()
		base = Vector(base)
		ring0 = [m.vert(base + u * (math.cos(2 * math.pi * j / n) * r) + v * (math.sin(2 * math.pi * j / n) * r * flat), **tags) for j in range(n)]
		m.cap(list(reversed(ring0)), **tags)
		m.seam(ring0, closed=True)
		secs = []
		p = base.copy()
		for k in range(1, steps + 1):
			f = k / steps
			rot = Matrix.Rotation(bend * (k - 0.5) / steps, 3, Vector(bend_axis).normalized()) if bend_axis is not None and bend else Matrix.Identity(3)
			dk = (rot @ d).normalized()
			p = p + dk * (length / steps)
			rk = max(r * (1 - f) ** taper, r * 0.07)
			secs.append(dict(c=p.copy(), u=rot @ u, v=rot @ v, ra=rk, rb=rk * flat))
		rings = m.tube(ring0, secs, **tags)
		m.cap(rings[-1], **tags)
		m.seam([ring[0] for ring in rings])
		return rings

	def ball(self, centre, radius, n=3, scale=(1, 1, 1), rot=None, **tags):
		"""A quad sphere (a cube blown up), optionally squashed."""
		m = self.m
		centre = Vector(centre)
		rot = rot or Matrix.Identity(3)
		cache = {}

		def vert(c):
			key = tuple(round(x * n) for x in c)
			if key not in cache:
				p = Vector(c).normalized()
				p = rot @ Vector((p.x * scale[0], p.y * scale[1], p.z * scale[2]))
				cache[key] = m.vert(centre + p * radius, local=tuple(Vector(c).normalized()), **tags)
			return cache[key]

		for axis in range(3):
			for sign in (-1, 1):
				for i in range(n):
					for j in range(n):
						quad = []
						for a, b in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
							c = [0.0, 0.0, 0.0]
							c[axis] = float(sign)
							c[(axis + 1) % 3] = -1 + 2 * a / n
							c[(axis + 2) % 3] = -1 + 2 * b / n
							quad.append(vert(c))
						if sign < 0:
							quad.reverse()
						m.quad(*quad)

	def strand(self, points, radii, up, n=6, **tags):
		"""A closed tapered tube through points: a brow."""
		m = self.m
		fr = MK.frames(points, up)
		t0, u0, v0 = fr[0]
		r0 = radii[0]
		ring0 = [m.vert(Vector(points[0]) + u0 * (math.cos(2 * math.pi * j / n) * r0[0]) + v0 * (math.sin(2 * math.pi * j / n) * r0[1]), **tags) for j in range(n)]
		m.cap(list(reversed(ring0)), bulge=-t0 * r0[0] * 0.6, **tags)
		secs = [dict(c=Vector(p), u=f[1], v=f[2], ra=r[0], rb=r[1]) for p, r, f in zip(points[1:], radii[1:], fr[1:])]
		rings = m.tube(ring0, secs, **tags)
		m.cap(rings[-1], bulge=fr[-1][0] * radii[-1][0] * 0.6, **tags)
		m.seam([ring[0] for ring in rings])

	def mirror_left(self):
		"""Copy every left-side part to the right."""
		m = self.m
		n = len(m.co)
		is_left = [t.get('side') == 'l' for t in m.tags]
		mir = {}
		for i in range(n):
			if not is_left[i]:
				continue
			p = m.co[i]
			tags = dict(m.tags[i])
			tags['side'] = 'r'
			tags['w'] = {(k[:-2] + '_r' if k.endswith('_l') else k): v for k, v in tags['w'].items()}
			if 'local' in tags:
				tags['local'] = (-tags['local'][0], tags['local'][1], tags['local'][2])
			mir[i] = m.vert((-p.x, p.y, p.z), **tags)
		for f in list(m.faces):
			if all(i in mir for i in f):
				m.faces.append(tuple(mir[i] for i in reversed(f)))
		for s in list(m.seams):
			a, b = tuple(s)
			if a in mir and b in mir:
				m.seams.add(frozenset((mir[a], mir[b])))


def build(devil, snap):
	"""All the extras. `snap(p)` returns the nearest point and normal on the finished body."""
	ex = Extras()
	cm = devil.m

	# claws: one per finger, thumb and toe
	for site in devil.claws:
		bone = site['bone'] + '_l'
		ex.spike(site['tip'], site['dir'], site['r'], site['length'], n=6, bend_axis=site['curl_axis'], bend=-1.3 if site['curl'] < 0 else 1.3, steps=4, taper=0.6, flat=0.85, u_hint=site['curl_axis'], part='claw', side='l', w={bone: 1.0})

	# eyeballs
	for eye in devil.eyes:
		n = eye['normal']
		rot = Matrix((eye['u'], eye['v'], n)).transposed()
		ex.ball(eye['centre'], eye['radius'], n=3, rot=rot, part='eye', side='l', w={'eye_l': 1.0})

	# teeth: the grin is shut and small teeth stitch across it, an upper then a lower, at an even
	# pitch along the whole mouth line, each lying on the outside of the lips
	outer, lip, _l2, _l3 = devil.info['mouth_rings']
	half = len(lip) // 2
	lower = [cm.co[i] for i in lip[:half]]  # columns -6..6
	lo_out = [cm.co[i] for i in outer[:half]]
	up_out = [cm.co[i] for i in reversed(outer[half:])]
	line = [(a + b) / 2 for a, b in zip(lo_out, up_out)]
	lengths = [0.0]
	for a, b in zip(line, line[1:]):
		lengths.append(lengths[-1] + (b - a).length)
	pitch = 0.0115
	count = int((lengths[-1] - 0.020) / pitch)
	first = (lengths[-1] - (count - 1) * pitch) / 2
	for k in range(count):
		sd = first + k * pitch
		j = max(i for i in range(len(line) - 1) if lengths[i] <= sd)
		f = (sd - lengths[j]) / max(lengths[j + 1] - lengths[j], 1e-9)
		mid = line[j].lerp(line[j + 1], f)
		along = (line[j + 1] - line[j]).normalized()
		gap = (up_out[j].lerp(up_out[j + 1], f) - lo_out[j].lerp(lo_out[j + 1], f)).length
		out = Vector((mid.x, mid.y + 0.030, 0)).normalized()
		down = along.cross(out)
		down = (down if down.z < 0 else -down).normalized()
		upper = k % 2 == 0
		away = -down if upper else down
		target = mid + away * (gap * 0.5 + 0.002) + out * 0.004
		p, n = snap(target)
		if (p - target).length > 0.007:
			continue  # under the nose: the nearest skin is not the lip
		fang = 0.030 < abs(mid.x) < 0.050
		size = (1.25 if fang else 1.0) * (1.0 - 0.3 * MK.smooth(0.070, 0.105, abs(mid.x)))
		ex.spike(p + n * 0.0012 + away * 0.001, -away + n * 0.06, 0.0056 * size, (min(gap, 0.004) + 0.0105) * size, n=4, steps=2, taper=0.75, flat=0.55, u_hint=n, part='tooth', side='c', w={'head' if upper else 'jaw': 1.0})

	# tongue, on the floor of the mouth
	back = [cm.co[i] for i in devil.info['mouth_back'][:half]]
	floor = sum(back, Vector((0, 0, 0))) / len(back)
	front = lower[half // 2]
	mid = front * 0.45 + floor * 0.55
	ex.ball((0, mid.y, mid.z + 0.004), 1.0, n=3, scale=(0.026, 0.050, 0.008), rot=Matrix.Rotation(math.radians(-18), 3, 'X'), part='tongue', side='c', w={'jaw': 1.0})

	# brows: a heavy black wedge low over the eye, thick by the nose and swept out to a point,
	# with a ragged top edge
	pts = []
	for x, z in ((0.020, 0.911), (0.040, 0.926), (0.062, 0.938), (0.084, 0.943), (0.101, 0.940), (0.114, 0.934)):
		p, n = snap(Vector((x, -0.20, z)))
		pts.append((p + n * 0.0035, n))
	radii = [(0.0085, 0.0060), (0.0125, 0.0080), (0.0125, 0.0080), (0.0100, 0.0070), (0.0065, 0.0050), (0.0025, 0.0020)]
	ex.strand([p for p, _ in pts], radii, (0, 0, 1), n=6, part='brow', side='l', w={'head': 1.0})
	for f, ln in ((0.16, 0.012), (0.34, 0.014), (0.52, 0.014), (0.70, 0.013)):
		t = f * (len(pts) - 1)
		k = min(int(t), len(pts) - 2)
		p = pts[k][0].lerp(pts[k + 1][0], t - k)
		nrm = pts[k][1].lerp(pts[k + 1][1], t - k).normalized()
		along = (pts[k + 1][0] - pts[k][0]).normalized()
		ex.spike(p + Vector((0, 0, 0.004)), along * 1.0 + Vector((0, 0, 0.45)) + nrm * 0.15, 0.0050, ln, n=4, steps=2, taper=0.7, flat=0.7, u_hint=nrm, part='brow', side='l', w={'head': 1.0})

	# the tuft below the belly
	for x, dz, ln in ((0.0, 0.0, 0.050), (0.016, 0.004, 0.040), (-0.016, 0.004, 0.040)):
		p, n = snap(Vector((x, -0.12, 0.372 + dz)))
		ex.spike(p - n * 0.004, n * 0.35 + Vector((x * 2.5, -0.25, -1.0)), 0.0085, ln, n=4, steps=2, part='tuft', side='c', w={'pelvis': 1.0})

	ex.mirror_left()
	return ex


PARTS = ['claw', 'eye', 'tooth', 'tongue', 'brow', 'tuft']
JOINTS = S.J
