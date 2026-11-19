"""A small quad-mesh builder for the Devil v2 cage.

The cage is box-modelled by code: lofted rings, patches cut out of a surface, loops extruded into
tubes, grid caps. Every face is a quad and every vertex carries tags (`part`, `chain`, `t`) that
the rig and the material read later, so weights and colour regions need no painting.
"""

from __future__ import annotations

import math

import bpy  # isort: skip  (bpy must load before bmesh and mathutils)
import bmesh
from mathutils import Vector


def smooth(e0, e1, x):
	if e0 == e1:
		return 1.0 if x >= e1 else 0.0
	t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
	return t * t * (3 - 2 * t)


class Cage:
	def __init__(self):
		self.co: list[Vector] = []
		self.tags: list[dict] = []
		self.faces: list[tuple[int, ...]] = []
		self.seams: set[frozenset] = set()
		self.creases: dict[frozenset, float] = {}

	# -- vertices and faces ---------------------------------------------------------------
	def vert(self, co, **tags):
		self.co.append(Vector(co))
		self.tags.append(dict(tags))
		return len(self.co) - 1

	def ring(self, points, **tags):
		return [self.vert(p, **tags) for p in points]

	def quad(self, a, b, c, d):
		self.faces.append((a, b, c, d))

	def bridge(self, lo, hi, skip=()):
		"""Quads between two closed loops of the same length. `skip` holds column indices to leave open."""
		n = len(lo)
		for j in range(n):
			if j in skip:
				continue
			k = (j + 1) % n
			self.quad(lo[j], lo[k], hi[k], hi[j])

	def seam(self, loop, closed=False):
		n = len(loop)
		for j in range(n if closed else n - 1):
			self.seams.add(frozenset((loop[j], loop[(j + 1) % n])))

	def crease(self, loop, value, closed=False):
		"""Subdivision crease along a run of vertices: a sharper fold (0 soft .. 1 hard)."""
		n = len(loop)
		for j in range(n if closed else n - 1):
			self.creases[frozenset((loop[j], loop[(j + 1) % n]))] = value

	def centre(self, loop):
		c = Vector((0, 0, 0))
		for i in loop:
			c += self.co[i]
		return c / len(loop)

	def normal(self, loop):
		"""Newell normal of a loop (points to the side the loop is counter-clockwise from)."""
		n = Vector((0, 0, 0))
		for j in range(len(loop)):
			a = self.co[loop[j]]
			b = self.co[loop[(j + 1) % len(loop)]]
			n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
		return n.normalized()

	# -- tubes ----------------------------------------------------------------------------
	def tube(self, loop, sections, skip=None, **tags):
		"""Extrude a closed loop through `sections` and return every ring (the loop first).

		A section is a dict: centre `c`, axes `u` and `v` (the cross-section's plane), radii
		`ra` / `rb`, optional `twist` (radians), optional `pts` (explicit unit 2D points,
		counter-clockwise, instead of an ellipse) and optional tag overrides `tags`.
		`skip` maps a section index to the columns left open between it and the ring before.
		"""
		n = len(loop)
		skip = skip or {}
		first = sections[0]
		u0, v0 = Vector(first['u']).normalized(), Vector(first['v']).normalized()
		c0 = self.centre(loop)
		ang = [math.atan2((self.co[i] - c0).dot(v0), (self.co[i] - c0).dot(u0)) for i in loop]
		# orientation of the loop in the (u, v) frame
		turn = sum(math.atan2(math.sin(ang[(j + 1) % n] - ang[j]), math.cos(ang[(j + 1) % n] - ang[j])) for j in range(n))
		sign = 1.0 if turn > 0 else -1.0
		rings = [list(loop)]
		for si, s in enumerate(sections):
			u, v = Vector(s['u']).normalized(), Vector(s['v']).normalized() * sign
			c = Vector(s['c'])
			pts = s.get('pts')
			tw = s.get('twist', 0.0)
			if pts is None:
				a0 = ang[0] * sign
				layout = [(math.cos(a0 + tw + 2 * math.pi * j / n), math.sin(a0 + tw + 2 * math.pi * j / n)) for j in range(n)]
			else:
				# best cyclic shift of the explicit layout onto the loop
				la = [math.atan2(p[1], p[0]) for p in pts]
				best, shift = 1e9, 0
				for r in range(n):
					err = sum(abs(math.atan2(math.sin(ang[j] * sign - la[(j + r) % n]), math.cos(ang[j] * sign - la[(j + r) % n]))) for j in range(n))
					if err < best:
						best, shift = err, r
				shift = s.get('shift', shift)
				layout = [pts[(j + shift) % n] for j in range(n)]
			t = dict(tags)
			t.update(s.get('tags', {}))
			ring = [self.vert(c + u * (p[0] * s['ra']) + v * (p[1] * s['rb']), **t) for p in layout]
			self.bridge(rings[-1], ring, skip.get(si, ()))
			rings.append(ring)
		return rings

	# -- caps -----------------------------------------------------------------------------
	def cap_grid(self, loop, nu, nv, bulge=(0, 0, 0), start=0, **tags):
		"""Close a loop of 2*(nu+nv) vertices with an nu x nv grid of quads.

		The loop runs: bottom row (nu edges), right column (nv), top row (nu, backwards), left
		column (nv, backwards), starting at `start`. Returns the grid as rows of vertex ids.
		"""
		n = len(loop)
		assert n == 2 * (nu + nv), (n, nu, nv)
		lp = [loop[(start + j) % n] for j in range(n)]
		grid = [[None] * (nu + 1) for _ in range(nv + 1)]
		for i in range(nu + 1):
			grid[0][i] = lp[i]
			grid[nv][i] = lp[2 * nu + nv - i]
		for j in range(nv + 1):
			grid[j][nu] = lp[nu + j]
			grid[j][0] = lp[(2 * nu + 2 * nv - j) % n]
		bulge = Vector(bulge)
		for j in range(1, nv):
			for i in range(1, nu):
				s, t = i / nu, j / nv
				# Coons patch through the four boundary curves
				p = (
					(1 - t) * self.co[grid[0][i]] + t * self.co[grid[nv][i]] + (1 - s) * self.co[grid[j][0]] + s * self.co[grid[j][nu]]
					- ((1 - s) * (1 - t) * self.co[grid[0][0]] + s * (1 - t) * self.co[grid[0][nu]] + (1 - s) * t * self.co[grid[nv][0]] + s * t * self.co[grid[nv][nu]])
				)
				w = math.sin(math.pi * s) * math.sin(math.pi * t)
				grid[j][i] = self.vert(p + bulge * w, **tags)
		return grid

	def fill_grid(self, grid, skip=()):
		"""Quads of a grid from cap_grid; `skip` holds (i, j) cells to leave open."""
		for j in range(len(grid) - 1):
			for i in range(len(grid[0]) - 1):
				if (i, j) in skip:
					continue
				self.quad(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i])

	def cap(self, loop, bulge=(0, 0, 0), start=0, **tags):
		"""Close a loop with the smallest grid that fits it (4 → 1 quad, 6 → 1x2, 8 → 2x2 ...)."""
		n = len(loop)
		nu = {4: 1, 6: 2, 8: 2, 10: 3, 12: 3}.get(n, n // 4)
		nv = n // 2 - nu
		grid = self.cap_grid(loop, nu, nv, bulge, start, **tags)
		self.fill_grid(grid)
		return grid

	# -- sculpting ------------------------------------------------------------------------
	def grab(self, centre, radius, move, where=None, mirror=True, power=1.0):
		"""Move vertices near `centre` by `move` with a smooth falloff (a grab brush), both sides."""
		for side in ((1, -1) if mirror and abs(centre[0]) > 1e-6 else (1,)):
			c = Vector((centre[0] * side, centre[1], centre[2]))
			m = Vector((move[0] * side, move[1], move[2]))
			for i, p in enumerate(self.co):
				if where is not None and not where(self.tags[i]):
					continue
				d = (p - c).length
				if d < radius:
					w = (1 - smooth(0, radius, d)) ** power
					self.co[i] = p + m * w

	def inflate(self, centre, radius, where=None, mirror=True, skip_midline=True, soft=0.0):
		"""Push vertices that lie inside a sphere out onto it: a round, well-defined bulge.

		`soft` (0..1) fades the push over the outer part of the sphere, so the bulge blends in.
		"""
		for side in ((1, -1) if mirror and abs(centre[0]) > 1e-6 else (1,)):
			c = Vector((centre[0] * side, centre[1], centre[2]))
			for i, p in enumerate(self.co):
				if where is not None and not where(self.tags[i]):
					continue
				if skip_midline and abs(p.x) < 1e-6:
					continue
				if abs(centre[0]) > 1e-6 and mirror and p.x * side < 0:
					continue  # each side's bulge moves only its own side
				d = p - c
				q = d.length / radius
				if 1e-6 < q < 1.0:
					w = 1.0 if soft <= 0 else smooth(1.0, 1.0 - soft, q)
					self.co[i] = p + (c + d.normalized() * radius - p) * w

	def bulge(self, centre, radius, direction, where=None, mirror=True, soft=0.25):
		"""A dome: move vertices along `direction` until they sit on a sphere (never back down).

		Unlike `inflate` it does not push radially, so it works when the surface passes close to
		the sphere's centre: buttocks, palm pads, a heel.
		"""
		for side in ((1, -1) if mirror and abs(centre[0]) > 1e-6 else (1,)):
			c = Vector((centre[0] * side, centre[1], centre[2]))
			n = Vector((direction[0] * side, direction[1], direction[2])).normalized()
			for i, p in enumerate(self.co):
				if where is not None and not where(self.tags[i]):
					continue
				if abs(centre[0]) > 1e-6 and mirror and p.x * side <= 1e-6:
					continue
				d = p - c
				along = d.dot(n)
				rho2 = (d - n * along).length_squared
				if rho2 >= radius * radius:
					continue
				top = math.sqrt(radius * radius - rho2)
				if along < top:
					w = smooth(1.0, 1.0 - soft, math.sqrt(rho2) / radius) if soft > 0 else 1.0
					self.co[i] = p + n * ((top - along) * w)

	# -- output ---------------------------------------------------------------------------
	def to_object(self, name):
		bm = bmesh.new()
		verts = [bm.verts.new(p) for p in self.co]
		bm.verts.ensure_lookup_table()
		for f in self.faces:
			try:
				bm.faces.new([verts[i] for i in f])
			except ValueError as err:
				raise ValueError(f'bad face {f}: {err}') from err
		bm.edges.ensure_lookup_table()
		crease = bm.edges.layers.float.new('crease_edge') if self.creases else None
		for e in bm.edges:
			key = frozenset((e.verts[0].index, e.verts[1].index))
			if key in self.seams:
				e.seam = True
			if crease is not None and key in self.creases:
				e[crease] = self.creases[key]
		me = bpy.data.meshes.new(name)
		bm.to_mesh(me)
		bm.free()
		me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
		ob = bpy.data.objects.new(name, me)
		return ob

	def check(self):
		"""Counts of open edges and edges with more than two faces (both should be zero)."""
		count: dict[frozenset, int] = {}
		for f in self.faces:
			for j in range(len(f)):
				k = frozenset((f[j], f[(j + 1) % len(f)]))
				count[k] = count.get(k, 0) + 1
		return sum(1 for c in count.values() if c == 1), sum(1 for c in count.values() if c > 2)


def frames(points, up=(0, 0, 1)):
	"""Tangent, u and v along a polyline (parallel transport). u starts as close to `up` as it can."""
	pts = [Vector(p) for p in points]
	n = len(pts)
	out = []
	u = Vector(up)
	for i in range(n):
		t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
		u = u - t * u.dot(t)
		if u.length < 1e-6:
			u = t.orthogonal()
		u.normalize()
		out.append((t, u.copy(), t.cross(u).normalized()))
	return out


def catmull(points, n=6):
	pts = [Vector(p) for p in points]
	ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
	out = []
	for i in range(1, len(ext) - 2):
		p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
		for k in range(n):
			t = k / n
			out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
	out.append(pts[-1])
	return out


def sample(points, ts):
	"""Points at parameters ts (0..len-1, fractional) on a Catmull-Rom curve through `points`."""
	dense = catmull(points, 16)
	out = []
	for t in ts:
		x = min(max(t, 0.0), len(points) - 1) * 16
		i = min(int(x), len(dense) - 2)
		f = x - i
		out.append(dense[i] * (1 - f) + dense[i + 1] * f)
	return out
