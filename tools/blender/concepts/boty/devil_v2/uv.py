"""Devil v2: UV0. Seams are chosen on the cage, the unwrap and the pack run on the final mesh.

`mark_cage(devil)` cuts the body where a tailor would: front and back of the trunk along the
sides, the head opened down the back (the crest already slits it), the nose slit underneath, and
every limb, digit, ear and spike as a tube with one lengthwise cut on its hidden side. It reads the
cage's own bookkeeping (rings, loops, patches, tags), never a vertex number. The extras and the
wings bring their own seams. `unwrap(ob)` then flattens, evens out the texel density, enlarges the
head and the hands, and packs with real padding; `layout_image` draws the result.
"""

from __future__ import annotations

import math

import bpy  # isort: skip  (bpy must load before bmesh and mathutils)
import numpy as np

import spec as S

UVMAP = 'UVMap'
# texel density of an island, by the part most of it belongs to, relative to the trunk
DENSITY = {
	'head': 1.35, 'nose': 1.35, 'ear': 1.2, 'hand': 1.45, 'finger': 1.45, 'eye': 1.6, 'tooth': 1.2, 'brow': 1.1,
	'eyelid': 0.45, 'mouth': 0.5, 'tongue': 0.6, 'wing_membrane': 0.9,
}  # fmt: skip
COLOURS = {
	'trunk': (214, 86, 70), 'head': (236, 160, 60), 'nose': (236, 160, 60), 'eyelid': (150, 120, 90), 'mouth': (140, 60, 90),
	'crest': (120, 90, 160), 'ear': (240, 205, 80), 'arm': (90, 170, 220), 'hand': (60, 120, 230), 'finger': (130, 110, 240),
	'leg': (90, 190, 130), 'foot': (50, 150, 100), 'toe': (120, 200, 90), 'tail': (200, 110, 190), 'claw': (90, 90, 100),
	'eye': (250, 240, 120), 'tooth': (235, 230, 205), 'tongue': (230, 120, 140), 'brow': (70, 60, 60), 'tuft': (100, 80, 70),
	'wing_bone': (160, 70, 60), 'wing_membrane': (200, 130, 120), 'wing_claw': (110, 100, 110),
}  # fmt: skip


# -- seams on the cage --------------------------------------------------------------------------
def _edges(m):
	out = set()
	for f in m.faces:
		for j in range(len(f)):
			out.add(frozenset((f[j], f[(j + 1) % len(f)])))
	return out


def _neighbours(m):
	nb: dict[int, set] = {}
	for f in m.faces:
		for j in range(len(f)):
			a, b = f[j], f[(j + 1) % len(f)]
			nb.setdefault(a, set()).add(b)
			nb.setdefault(b, set()).add(a)
	return nb


def _spike_column(m, nb, loop):
	"""A lengthwise run of vertices up a spike grown from `loop`, by ring level: base, then one
	vertex per ring. Works from the tags alone (the spike's own vertices are `crest`)."""
	base = set(loop)
	crest = lambda i: m.tags[i].get('part') == 'crest' and i not in base  # noqa: E731
	n = len(loop)
	for j in range(n):
		a, b = loop[j], loop[(j + 1) % n]
		# the spike's side of this base edge: a quad a, b, b', a' with a' and b' on the spike
		ups = [i for i in nb[a] if crest(i) and any(crest(k) and k in nb[b] for k in nb[i])]
		if len(ups) != 1:
			continue  # an edge two spikes share
		comp, todo = {ups[0]}, [ups[0]]
		while todo:
			for k in nb[todo.pop()]:
				if crest(k) and k not in comp:
					comp.add(k)
					todo.append(k)
		level = {i: 1 for i in comp if nb[i] & base}
		todo = list(level)
		while todo:
			nxt = []
			for i in todo:
				for k in nb[i]:
					if k in comp and k not in level:
						level[k] = level[i] + 1
						nxt.append(k)
			todo = nxt
		run, cur = [a, ups[0]], ups[0]
		while True:
			higher = [k for k in nb[cur] if level.get(k, 0) == level[cur] + 1]
			if not higher:
				return run
			cur = higher[0]
			run.append(cur)
	return []


def mark_cage(devil):
	"""Mark the body's UV seams on the cage (`devil.m.seams`). Returns what was cut, for the log."""
	m = devil.m
	R, N = S.RING, S.N
	edges = _edges(m)
	nb = _neighbours(m)
	mir = devil.mir
	seams: set[frozenset] = set()
	log: dict[str, int] = {}

	def cut(name, run, closed=False):
		n = len(run)
		for j in range(n if closed else n - 1):
			a, b = run[j], run[(j + 1) % n]
			key = frozenset((a, b))
			if a < 0 or b < 0 or key not in edges:
				continue  # inside an opening (an arm hole, the crest): nothing to cut
			for k in (key, frozenset((mir.get(a, a), mir.get(b, b)))):
				if k in edges and k not in seams:
					seams.add(k)
					log[name] = log.get(name, 0) + 1

	def z(i):
		return m.co[i].z

	def first_ring(rings, part):
		return next(k for k, ring in enumerate(rings) if m.tags[ring[0]].get('part') == part)

	def tube(name, rings, col, root=True):
		if root:
			cut(name + ' root', rings[0], closed=True)
		cut(name, [ring[col] for ring in rings])

	def digit(name, rings):
		# cut underneath; the tip's cap hangs on by one edge so it lies flat
		mid = rings[len(rings) // 2]
		col = min(range(len(mid)), key=lambda j: z(mid[j]))
		tube(name, rings, col)
		tip, n = rings[-1], len(rings[-1])
		cut(name, [tip[(col + k) % n] for k in range(-1, n - 2)])

	side = N // 4
	neck = R['throat'] - 1
	cut('neck', devil.rings[neck], closed=True)
	cut('trunk side', [devil.v(r, side) for r in range(neck + 1)])
	cut('head back', [devil.v(r, N // 2) for r in range(neck, len(devil.rings))])
	# between the legs, on the grid row the side seams come down to
	hip = devil.v(0, side)
	row = next(row for row in devil.bottom if hip in row)
	cut('crotch', row)

	# arm, hand, fingers
	rings = devil.loops['arm']
	armpit = min((i for i in rings[0] if m.tags[i].get('col') == side), key=z)
	wrist = first_ring(rings, 'hand') - 1
	tube('arm', rings[: wrist + 1], rings[0].index(armpit))
	cut('wrist', rings[wrist], closed=True)
	palm = rings[min(wrist + 2, len(rings) - 1)]
	tube('hand', rings[wrist:], max(range(len(palm)), key=lambda j: m.co[palm[j]].y), root=False)
	for chain in ('thumb', 'finger1', 'finger2', 'finger3', 'finger4'):
		for t in devil.loops.get(chain, []):
			digit('finger', t)

	# leg, foot, toes
	rings = devil.loops['leg']
	inner = min((i for i in rings[0] if i in row), key=lambda i: abs(m.co[i].x))
	ankle = first_ring(rings, 'foot') - 1
	tube('leg', rings[: ankle + 1], rings[0].index(inner))
	cut('ankle', rings[ankle], closed=True)
	sole = rings[min(ankle + 3, len(rings) - 1)]
	tube('foot', rings[ankle:], min(range(len(sole)), key=lambda j: z(sole[j])), root=False)
	for t in devil.loops.get('toe', []):
		digit('toe', t)

	# tail: cut underneath, from the midline vertex of its root nearest the ground
	rings = devil.loops['tail']
	under = min((i for i in rings[0] if abs(m.tags[i].get('col', 0)) == N // 2), key=z)
	tube('tail', rings, rings[0].index(under))

	# nose: a cone slit underneath (left on the face it would get a fifth of its texels); the
	# mouth's inside is its own island, cut where the lips meet
	rings = devil.loops['nose']
	tube('nose', rings, rings[0].index(devil.v(R['lip_up'], 0)))
	cut('lips', devil.info['mouth_rings'][1], closed=True)

	# ears: cut down the back
	rings = devil.loops['ear']
	back = [sum(m.co[ring[j]].y - m.centre(ring).y for ring in rings[2:-1]) for j in range(len(rings[0]))]
	tube('ear', rings, max(range(len(back)), key=back.__getitem__))

	# eye sockets: what the eyeball hides leaves the face's island
	rings = devil.loops['eye']
	inside = next((ring for ring in rings if m.tags[ring[0]].get('lid') == 'in'), rings[-1])
	cut('eye socket', inside, closed=True)

	# crest and spikes: each its own cone
	spikes = [loop for loop, _size in devil.patch['crest']] + list(devil.patch['spikes'])
	for loop in spikes:
		loop = [devil.remap[i] for i in loop]
		cut('crest root', loop, closed=True)
		cut('crest', _spike_column(m, nb, loop))

	m.seams |= seams
	return log


def _write_seams(me, seams):
	keys = me.edge_keys
	flags = np.zeros(len(keys), bool)
	me.edges.foreach_get('use_seam', flags)
	for i, k in enumerate(keys):
		if frozenset(k) in seams:
			flags[i] = True
	me.edges.foreach_set('use_seam', flags)


# -- the final mesh -----------------------------------------------------------------------------
def _attr(me, name):
	out = np.zeros(len(me.vertices), np.float32)
	a = me.attributes.get(name)
	if a is not None and a.domain == 'POINT':
		a.data.foreach_get('value', out)
	return out


def vertex_parts(ob):
	"""(names, share of each part per vertex) from the `m_p_*` masks."""
	me = ob.data
	names = sorted(a.name[4:] for a in me.attributes if a.name.startswith('m_p_'))
	if not names:
		return ['mesh'], np.ones((1, len(me.vertices)), np.float32)
	return names, np.stack([_attr(me, 'm_p_' + n) for n in names])


def _edit(ob, select=None):
	"""Enter edit mode with `select` (a bool per face, or everything) selected."""
	for o in bpy.context.view_layer.objects:
		o.select_set(False)
	ob.select_set(True)
	bpy.context.view_layer.objects.active = ob
	me = ob.data
	n = len(me.polygons)
	sel = np.ones(n, bool) if select is None else np.asarray(select, bool)
	me.polygons.foreach_set('select', sel)
	me.polygons.foreach_set('hide', np.zeros(n, bool))
	vsel = np.zeros(len(me.vertices), bool)
	esel = np.zeros(len(me.edges), bool)
	lv = np.empty(len(me.loops), np.int32)
	le = np.empty(len(me.loops), np.int32)
	me.loops.foreach_get('vertex_index', lv)
	me.loops.foreach_get('edge_index', le)
	on = np.repeat(sel, _poly_sizes(me))
	vsel[lv[on]] = True
	esel[le[on]] = True
	me.vertices.foreach_set('select', vsel)
	me.edges.foreach_set('select', esel)
	bpy.ops.object.mode_set(mode='EDIT')
	bpy.context.tool_settings.mesh_select_mode = (False, False, True)


def _poly_sizes(me):
	out = np.empty(len(me.polygons), np.int32)
	me.polygons.foreach_get('loop_total', out)
	return out


def _mesh(ob):
	"""Arrays of the mesh: per-loop vertex and uv, per-polygon loop start and size."""
	me = ob.data
	lv = np.empty(len(me.loops), np.int32)
	me.loops.foreach_get('vertex_index', lv)
	uv = np.empty(len(me.loops) * 2, np.float64)
	me.uv_layers[UVMAP].data.foreach_get('uv', uv)
	start = np.empty(len(me.polygons), np.int32)
	me.polygons.foreach_get('loop_start', start)
	return lv, uv.reshape(-1, 2), start, _poly_sizes(me)


def islands(ob):
	"""Island index per polygon: polygons that meet along an edge with the same UVs."""
	me = ob.data
	lv, uv, start, size = _mesh(ob)
	parent = np.arange(len(me.polygons))

	def find(i):
		while parent[i] != i:
			parent[i] = parent[parent[i]]
			i = parent[i]
		return i

	seen: dict[tuple, tuple] = {}
	q = np.round(uv * 1e6).astype(np.int64)
	for p in range(len(me.polygons)):
		s, n = start[p], size[p]
		for j in range(n):
			a, b = s + j, s + (j + 1) % n
			va, vb = int(lv[a]), int(lv[b])
			key = (va, vb) if va < vb else (vb, va)
			mine = (tuple(q[a]), tuple(q[b])) if va < vb else (tuple(q[b]), tuple(q[a]))
			if key in seen:
				other, theirs = seen[key]
				if theirs == mine:
					ra, rb = find(p), find(other)
					if ra != rb:
						parent[ra] = rb
			else:
				seen[key] = (p, mine)
	roots = np.array([find(i) for i in range(len(parent))])
	_u, out = np.unique(roots, return_inverse=True)
	return out


def _areas(ob):
	"""Per polygon: area on the surface, signed area in UV."""
	me = ob.data
	lv, uv, start, size = _mesh(ob)
	co = np.empty(len(me.vertices) * 3, np.float64)
	me.vertices.foreach_get('co', co)
	co = co.reshape(-1, 3)
	area = np.empty(len(me.polygons), np.float64)
	me.polygons.foreach_get('area', area)
	uva = np.zeros(len(me.polygons))
	for k in range(int(size.max())):
		on = size > k
		a = uv[start[on] + k]
		b = uv[start[on] + (k + 1) % size[on]]
		uva[on] += (a[:, 0] * b[:, 1] - b[:, 0] * a[:, 1]) / 2
	return area, uva


def mark_final(ob):
	"""Seams only the final mesh can tell: round each eyeball's front, so the iris is one clean island."""
	me = ob.data
	names, part = vertex_parts(ob)
	if 'eye' not in names:
		return 0
	eye = part[names.index('eye')] > 0.5
	x, y, zc = (_attr(me, 'm_eye_' + a) * 2 - 1 for a in 'xyz')
	rim = eye & (zc > 0) & (np.abs(zc - np.maximum(np.abs(x), np.abs(y))) < 1e-3)
	ev = np.empty(len(me.edges) * 2, np.int32)
	me.edges.foreach_get('vertices', ev)
	ev = ev.reshape(-1, 2)
	flags = np.zeros(len(me.edges), bool)
	me.edges.foreach_get('use_seam', flags)
	new = rim[ev[:, 0]] & rim[ev[:, 1]]
	me.edges.foreach_set('use_seam', flags | new)
	return int(new.sum())


def _seamless_shells(ob):
	"""Faces of closed shells with no seam on them: an unwrap would fold them flat."""
	me = ob.data
	ev = np.empty(len(me.edges) * 2, np.int32)
	me.edges.foreach_get('vertices', ev)
	ev = ev.reshape(-1, 2)
	seam = np.zeros(len(me.edges), bool)
	me.edges.foreach_get('use_seam', seam)
	parent = np.arange(len(me.vertices))

	def find(i):
		while parent[i] != i:
			parent[i] = parent[parent[i]]
			i = parent[i]
		return i

	for a, b in ev:
		ra, rb = find(int(a)), find(int(b))
		if ra != rb:
			parent[ra] = rb
	root = np.array([find(i) for i in range(len(parent))])
	le = np.empty(len(me.loops), np.int32)
	me.loops.foreach_get('edge_index', le)
	open_edge = np.bincount(le, minlength=len(me.edges)) < 2
	cut = set(root[ev[seam | open_edge, 0]].tolist())
	lv, _uv, start, _size = _mesh(ob)
	return np.array([int(root[lv[s]]) not in cut for s in start])


def unwrap(ob, size=2048, padding=8, method='MINIMUM_STRETCH'):
	"""Unwrap along the seams, even out the texel density, bias it, and pack. Returns a report."""
	me = ob.data
	while me.uv_layers:
		me.uv_layers.remove(me.uv_layers[0])
	me.uv_layers.new(name=UVMAP)
	eye_seams = mark_final(ob)
	loose = _seamless_shells(ob)

	_edit(ob)
	try:
		bpy.ops.uv.unwrap(method=method, margin=0.0)
	except TypeError:
		method = 'ANGLE_BASED'
		bpy.ops.uv.unwrap(method=method, margin=0.0)
	bpy.ops.object.mode_set(mode='OBJECT')
	if loose.any():
		_edit(ob, loose)
		bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, correct_aspect=True, scale_to_bounds=False)
		bpy.ops.object.mode_set(mode='OBJECT')
	_edit(ob)
	bpy.ops.uv.average_islands_scale()
	bpy.ops.object.mode_set(mode='OBJECT')

	# density bias: scale each island about its centre by the factor of its main part
	names, part = vertex_parts(ob)
	isl = islands(ob)
	lv, uv, start, psize = _mesh(ob)
	area, _uva = _areas(ob)
	loop_isl = np.repeat(isl, psize)
	main = island_parts(ob, isl, names, part, area)
	for i, name in enumerate(main):
		f = DENSITY.get(name, 1.0)
		if f != 1.0:
			on = loop_isl == i
			c = uv[on].mean(axis=0)
			uv[on] = c + (uv[on] - c) * f
	me.uv_layers[UVMAP].data.foreach_set('uv', uv.ravel())

	# the packer's margin is not a pixel count: ask for a little more until the measured gap is there
	for margin in (0.65, 0.8, 1.0, 1.3, 1.7):
		_edit(ob)
		bpy.ops.uv.pack_islands(rotate=True, scale=True, merge_overlap=False, margin_method='FRACTION', margin=padding * margin / size, shape_method='CONCAVE')
		bpy.ops.object.mode_set(mode='OBJECT')
		out = report(ob, size)
		if out['padding_pixels'] >= padding:
			break
	out.update(method=method, eye_seams=eye_seams, seamless_shell_faces=int(loose.sum()))
	return out


def island_parts(ob, isl, names, part, area):
	"""The part that owns most of each island's surface."""
	lv, _uv, start, size = _mesh(ob)
	share = np.add.reduceat(part[:, lv], start, axis=1) / size  # part x polygon
	score = np.zeros((int(isl.max()) + 1, len(names)))
	np.add.at(score, isl, (share * area).T)
	return [names[k] for k in score.argmax(axis=1)]


def _raster(ob, isl, size):
	"""Island number + 1 per pixel (0 = empty), and how many pixels two islands both cover."""
	from PIL import Image, ImageDraw

	_lv, uv, start, psize = _mesh(ob)
	img = Image.new('I', (size, size), 0)
	draw = ImageDraw.Draw(img)
	px = uv * size
	px[:, 1] = size - px[:, 1]
	order = np.argsort(isl, kind='stable')
	clash = 0
	prev = np.zeros((size, size), np.int32)
	last = -1
	for p in order:
		if isl[p] != last:
			# pixels of the islands so far, to count what the next one lands on
			now = np.asarray(img, np.int32)
			if last >= 0:
				mine = now == last + 1
				clash += int((mine & (prev > 0) & (prev != last + 1)).sum())
			prev = now.copy()
			last = isl[p]
		s, n = start[p], psize[p]
		draw.polygon([tuple(q) for q in px[s : s + n]], fill=int(isl[p]) + 1)
	now = np.asarray(img, np.int32)
	clash += int(((now == last + 1) & (prev > 0) & (prev != last + 1)).sum())
	return now, clash


def _clear_radius(ids, limit=12):
	"""The largest r (pixels, up to `limit`) with no two islands inside any (2r+1)² window."""
	big = np.int32(1 << 30)
	hi = ids.copy()
	lo = np.where(ids > 0, ids, big)
	for r in range(1, limit + 1):
		for axis in (0, 1):
			h0, l0 = hi.copy(), lo.copy()
			for sl_a, sl_b in ((slice(1, None), slice(None, -1)), (slice(None, -1), slice(1, None))):
				a = (sl_a, slice(None)) if axis == 0 else (slice(None), sl_a)
				b = (sl_b, slice(None)) if axis == 0 else (slice(None), sl_b)
				hi[a] = np.maximum(hi[a], h0[b])
				lo[a] = np.minimum(lo[a], l0[b])
		if ((hi > 0) & (lo < big) & (hi != lo)).any():
			return r - 1
	return limit


def report(ob, size=2048):
	"""Numbers to judge the layout by: islands, coverage, overlap, padding, flips, texel density."""
	names, part = vertex_parts(ob)
	isl = islands(ob)
	area, uva = _areas(ob)
	main = island_parts(ob, isl, names, part, area)
	ids, clash = _raster(ob, isl, size)
	_lv, uv, _start, _psize = _mesh(ob)
	n = int(isl.max()) + 1
	sign = np.zeros(n)
	np.add.at(sign, isl, uva)
	flipped = int(((uva * sign[isl]) < 0).sum())
	density: dict[str, list[float]] = {}
	for i, name in enumerate(main):
		on = isl == i
		d = density.setdefault(name, [0.0, 0.0])
		d[0] += abs(uva[on]).sum()
		d[1] += area[on].sum()
	clear = _clear_radius(ids)
	return {
		'size': size,
		'islands': n,
		'islands_by_part': {k: main.count(k) for k in sorted(set(main))},
		'coverage': round(float(np.abs(uva).sum()), 4),
		'overlap_pixels': clash,
		'padding_pixels': 2 * clear + 1,
		'flipped_faces': flipped,
		'outside_unit_square': int(((uv < 0) | (uv > 1)).any(axis=1).sum()),
		'pixels_per_metre': {k: round(float(math.sqrt(v[0] / v[1]) * size)) for k, v in sorted(density.items()) if v[1] > 0},
	}


def layout_image(ob, path, size=2048):
	"""Draw the UV layout: islands tinted by part, every edge, seams and borders darker."""
	from PIL import Image, ImageDraw

	names, part = vertex_parts(ob)
	isl = islands(ob)
	area, _uva = _areas(ob)
	main = island_parts(ob, isl, names, part, area)
	lv, uv, start, psize = _mesh(ob)
	k = 2  # supersampling
	img = Image.new('RGB', (size * k, size * k), (24, 24, 28))
	draw = ImageDraw.Draw(img)
	px = uv * size * k
	px[:, 1] = size * k - px[:, 1]
	border: dict[tuple, int] = {}
	for p in range(len(start)):
		s, n = start[p], psize[p]
		pts = [tuple(q) for q in px[s : s + n]]
		c = COLOURS.get(main[isl[p]], (150, 150, 150))
		draw.polygon(pts, fill=c)
		for j in range(n):
			a, b = pts[j], pts[(j + 1) % n]
			key = (a, b) if a < b else (b, a)
			border[key] = border.get(key, 0) + 1
	for (a, b), count in border.items():
		if count > 1:
			draw.line([a, b], fill=(40, 30, 30), width=1)
	for (a, b), count in border.items():
		if count == 1:
			draw.line([a, b], fill=(255, 255, 255), width=3)
	img = img.resize((size, size), Image.LANCZOS)
	draw = ImageDraw.Draw(img)
	used = [n for n in COLOURS if n in set(main)]
	for i, name in enumerate(used):
		draw.rectangle([8, 8 + i * 22, 24, 24 + i * 22], fill=COLOURS[name], outline=(255, 255, 255))
		draw.text((30, 10 + i * 22), name, fill=(255, 255, 255))
	img.save(path)
	return path
