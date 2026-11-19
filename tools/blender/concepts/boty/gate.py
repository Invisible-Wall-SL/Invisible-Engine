"""The Hell Gate: a jagged pit torn into a stage's floor, lava below, glowing cracks around.

The pit is open by construction: the stage floor is built by `floor_with_hole`, and the pit wall
is an uncapped strip, so nothing lids the lava.
"""

from __future__ import annotations

import math

import bpy  # isort: skip
import bmesh
import numpy as np
from mathutils import Vector

import common as C


class Outline:
	"""A jagged closed outline r(theta) around a centre."""

	def __init__(self, radius=2.0, seed=1, jag=0.16, squash=1.0, n=40):
		r = C.rng(seed)
		self.radius = radius
		self.squash = squash
		self.n = n
		base = 1.0 + jag * (r.random(n) - 0.5) * 2
		# a few deep notches, where the cracks start
		for k in r.choice(n, size=5, replace=False):
			base[k] += jag * 1.6
		self.r = base * radius

	def at(self, theta):
		t = (theta % (2 * math.pi)) / (2 * math.pi) * self.n
		i = int(t) % self.n
		f = t - int(t)
		return self.r[i] * (1 - f) + self.r[(i + 1) % self.n] * f

	def point(self, theta, scale=1.0, z=0.0):
		r = self.at(theta) * scale
		return Vector((math.cos(theta) * r, math.sin(theta) * r * self.squash, z))

	def angles(self):
		return [2 * math.pi * i / self.n for i in range(self.n)]


def floor_with_hole(name, x0, x1, y0, y1, outline, material, center=(0, 0), z=0.0, parent=None):
	"""A flat floor rectangle with the Gate's outline cut out of it."""
	cx, cy = center
	corners = [math.atan2(y - cy, x - cx) % (2 * math.pi) for x in (x0, x1) for y in (y0, y1)]
	angs = sorted(set(outline.angles() + corners))

	def outer(th):
		dx, dy = math.cos(th), math.sin(th)
		ts = []
		if dx > 1e-9:
			ts.append((x1 - cx) / dx)
		if dx < -1e-9:
			ts.append((x0 - cx) / dx)
		if dy > 1e-9:
			ts.append((y1 - cy) / dy)
		if dy < -1e-9:
			ts.append((y0 - cy) / dy)
		t = min(ts)
		return Vector((cx + dx * t, cy + dy * t, z))

	bm = bmesh.new()
	inner = [bm.verts.new(outline.point(a, z=z) + Vector((cx, cy, 0))) for a in angs]
	outer_v = [bm.verts.new(outer(a)) for a in angs]
	n = len(angs)
	for i in range(n):
		j = (i + 1) % n
		bm.faces.new((inner[i], inner[j], outer_v[j], outer_v[i]))
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	for f in bm.faces:
		if f.normal.z < 0:
			f.normal_flip()
	return C.obj_from_bm(bm, name, material, parent, smooth=False)


def _crack_mat(strength):
	return C.emit_mat(f'gate_crack_{strength}', (1.0, 0.22, 0.02), strength)


def _glow_mat(name, color, strength):
	"""A radial glow card: emission that falls off from the centre of the UV square."""
	if name in C._MATS:
		return C._MATS[name]
	m = bpy.data.materials.new(name)
	m.use_nodes = True
	nt = m.node_tree
	nt.nodes.clear()
	out = nt.nodes.new('ShaderNodeOutputMaterial')
	tr = nt.nodes.new('ShaderNodeBsdfTransparent')
	em = nt.nodes.new('ShaderNodeEmission')
	em.inputs['Color'].default_value = (*color, 1)
	add = nt.nodes.new('ShaderNodeAddShader')
	tc = nt.nodes.new('ShaderNodeTexCoord')
	grad = nt.nodes.new('ShaderNodeTexGradient')
	grad.gradient_type = 'SPHERICAL'
	mp = nt.nodes.new('ShaderNodeMapping')
	mp.inputs['Location'].default_value = (-1.0, -1.0, 0)
	mp.inputs['Scale'].default_value = (2.0, 2.0, 1.0)
	nt.links.new(tc.outputs['UV'], mp.inputs['Vector'])
	nt.links.new(mp.outputs['Vector'], grad.inputs['Vector'])
	pw = nt.nodes.new('ShaderNodeMath')
	pw.operation = 'POWER'
	pw.inputs[1].default_value = 2.0
	nt.links.new(grad.outputs['Fac'], pw.inputs[0])
	st = nt.nodes.new('ShaderNodeMath')
	st.operation = 'MULTIPLY'
	st.inputs[1].default_value = strength
	nt.links.new(pw.outputs[0], st.inputs[0])
	nt.links.new(st.outputs[0], em.inputs['Strength'])
	nt.links.new(tr.outputs[0], add.inputs[0])
	nt.links.new(em.outputs[0], add.inputs[1])
	nt.links.new(add.outputs[0], out.inputs['Surface'])
	C._MATS[name] = m
	return m


def flame_mat(name='gate_flame', strength=2.2, core=False):
	"""Fire tongues: emission that goes yellow → orange → red → nothing up the cone."""
	if name in C._MATS:
		return C._MATS[name]
	m = bpy.data.materials.new(name)
	m.use_nodes = True
	nt = m.node_tree
	nt.nodes.clear()
	out = nt.nodes.new('ShaderNodeOutputMaterial')
	tr = nt.nodes.new('ShaderNodeBsdfTransparent')
	em = nt.nodes.new('ShaderNodeEmission')
	add = nt.nodes.new('ShaderNodeAddShader')
	tc = nt.nodes.new('ShaderNodeTexCoord')
	sep = nt.nodes.new('ShaderNodeSeparateXYZ')
	nt.links.new(tc.outputs['UV'], sep.inputs[0])
	noise = nt.nodes.new('ShaderNodeTexNoise')
	noise.inputs['Scale'].default_value = 3.0
	noise.inputs['Detail'].default_value = 3.0
	nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
	ramp = nt.nodes.new('ShaderNodeValToRGB')
	els = ramp.color_ramp.elements
	els[0].position = 0.0
	els[0].color = (1.0, 0.62, 0.10, 1) if core else (1.0, 0.36, 0.02, 1)
	els[1].position = 1.0
	els[1].color = (0.9, 0.08, 0.0, 1) if core else (0.4, 0.0, 0.0, 1)
	e = els.new(0.3)
	e.color = (1.0, 0.36, 0.02, 1) if core else (1.0, 0.09, 0.0, 1)
	nt.links.new(sep.outputs['Y'], ramp.inputs['Fac'])
	nt.links.new(ramp.outputs['Color'], em.inputs['Color'])
	fade = nt.nodes.new('ShaderNodeMapRange')
	fade.inputs['From Min'].default_value = 0.0
	fade.inputs['From Max'].default_value = 1.0
	fade.inputs['To Min'].default_value = 1.0
	fade.inputs['To Max'].default_value = 0.0
	nt.links.new(sep.outputs['Y'], fade.inputs['Value'])
	pw = nt.nodes.new('ShaderNodeMath')
	pw.operation = 'POWER'
	pw.inputs[1].default_value = 1.4
	nt.links.new(fade.outputs['Result'], pw.inputs[0])
	lw = nt.nodes.new('ShaderNodeLayerWeight')
	lw.inputs['Blend'].default_value = 0.3
	inv = nt.nodes.new('ShaderNodeMath')
	inv.operation = 'SUBTRACT'
	inv.inputs[0].default_value = 1.0
	nt.links.new(lw.outputs['Facing'], inv.inputs[1])
	m1 = nt.nodes.new('ShaderNodeMath')
	m1.operation = 'MULTIPLY'
	nt.links.new(pw.outputs[0], m1.inputs[0])
	nt.links.new(inv.outputs[0], m1.inputs[1])
	m2 = nt.nodes.new('ShaderNodeMath')
	m2.operation = 'MULTIPLY'
	nt.links.new(m1.outputs[0], m2.inputs[0])
	nz = nt.nodes.new('ShaderNodeMapRange')
	nz.inputs['To Min'].default_value = 0.5
	nz.inputs['To Max'].default_value = 1.3
	nt.links.new(noise.outputs['Fac'], nz.inputs['Value'])
	nt.links.new(nz.outputs['Result'], m2.inputs[1])
	m3 = nt.nodes.new('ShaderNodeMath')
	m3.operation = 'MULTIPLY'
	m3.inputs[1].default_value = strength
	nt.links.new(m2.outputs[0], m3.inputs[0])
	nt.links.new(m3.outputs[0], em.inputs['Strength'])
	nt.links.new(tr.outputs[0], add.inputs[0])
	nt.links.new(em.outputs[0], add.inputs[1])
	nt.links.new(add.outputs[0], out.inputs['Surface'])
	C._MATS[name] = m
	return m


def build_gate(
	outline,
	loc=(0, 0, 0),
	slab_mat=None,
	seed=3,
	heat=1.0,
	depth=2.6,
	lava_depth=0.85,
	cracks=11,
	crack_len=(1.2, 3.2),
	slabs=14,
	flames=9,
	embers=110,
	light=True,
	pillar=True,
	flame_strength=1.1,
	flame_size=1.0,
):
	"""The pit, lava, broken slabs, cracks, flames, embers and its red light. `heat` scales the glow."""
	r = C.rng(seed)
	root = C.empty('Gate', loc=loc)
	R = outline.radius
	rock = C.painted_mat('gate_rock', (0.06, 0.022, 0.018), (0.02, 0.008, 0.008), rough=0.85, scale=3.0, bump=0.6)
	slab_mat = slab_mat or C.mat('gate_slab', (0.03, 0.03, 0.035), rough=0.4)

	# pit wall: open at both ends
	bm = bmesh.new()
	levels = [(0.0, 1.0), (-0.12, 1.0), (-0.35, 0.93), (-lava_depth, 0.86), (-depth, 0.7)]
	rings = []
	angs = outline.angles()
	for z, s in levels:
		rings.append([bm.verts.new(outline.point(a, s * (1 + 0.04 * (r.random() - 0.5)), z)) for a in angs])
	for i in range(len(rings) - 1):
		for j in range(len(angs)):
			k = (j + 1) % len(angs)
			bm.faces.new((rings[i][j], rings[i + 1][j], rings[i + 1][k], rings[i][k]))
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	for f in bm.faces:
		c = f.calc_center_median()
		if f.normal.dot(Vector((c.x, c.y, 0))) > 0:
			f.normal_flip()
	wall = C.obj_from_bm(bm, 'gate_wall', rock, root, smooth=False)
	wall.visible_shadow = True

	# lava
	bm = bmesh.new()
	ring = [bm.verts.new(outline.point(a, 0.9, -lava_depth)) for a in angs]
	bm.faces.new(ring)
	bmesh.ops.triangulate(bm, faces=bm.faces)
	C.obj_from_bm(bm, 'gate_lava', C.lava_mat('lava', 4.0 * heat, 1.4 / max(R / 2, 0.5)), root, smooth=False)

	# broken slabs tilted up around the rim, a few fallen in
	for i in range(slabs):
		a = 2 * math.pi * (i + r.random() * 0.6) / slabs
		rr = outline.at(a)
		fallen = r.random() < 0.3
		d = rr * (0.82 if fallen else 1.04 + r.random() * 0.08)
		sx, sy = 0.35 + r.random() * 0.5, 0.3 + r.random() * 0.45
		z = -0.25 - r.random() * 0.4 if fallen else 0.03 + r.random() * 0.07
		tilt = (0.5 + r.random() * 0.5) if fallen else (0.12 + r.random() * 0.3)
		ob = C.box('slab', (sx * R / 2, sy * R / 2, 0.09), (math.cos(a) * d, math.sin(a) * d * outline.squash, z), slab_mat, root, bevel_w=0.012)
		ob.rotation_euler = (0, -tilt, a)
		ob.rotation_euler.rotate_axis('Z', (r.random() - 0.5) * 0.8)
	# rubble
	for i in range(26):
		a = r.random() * 2 * math.pi
		d = outline.at(a) * (1.02 + r.random() * 0.35)
		s = 0.05 + r.random() * 0.1
		ob = C.box('rubble', (s * 1.4, s, s * 0.7), (math.cos(a) * d, math.sin(a) * d * outline.squash, s * 0.3), slab_mat, root, rot=tuple(r.random(3) * 3), bevel_w=0.01)

	# cracks: jagged, branching strips that glow
	cm = _crack_mat(3.0 * heat)
	bm = bmesh.new()

	def strip(pts, w0, w1):
		n = len(pts)
		left, right = [], []
		for i, p in enumerate(pts):
			a = pts[max(i - 1, 0)]
			b = pts[min(i + 1, n - 1)]
			t = (b - a).normalized()
			nrm = Vector((-t.y, t.x, 0))
			w = w0 + (w1 - w0) * (i / (n - 1))
			left.append(bm.verts.new(p + nrm * w))
			right.append(bm.verts.new(p - nrm * w))
		for i in range(n - 1):
			bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))

	def crack(a, start, length, w, depth_left=1):
		pts = [start.copy()]
		ang = a
		seg = length / 7
		p = start.copy()
		for _ in range(7):
			ang += (r.random() - 0.5) * 1.1
			ang = a + (ang - a) * 0.8
			p = p + Vector((math.cos(ang), math.sin(ang), 0)) * seg * (0.6 + r.random() * 0.8)
			pts.append(p.copy())
		strip(pts, w, 0.004)
		if depth_left > 0:
			for k in (2, 4):
				if r.random() < 0.7:
					crack(a + (1 if r.random() < 0.5 else -1) * (0.5 + r.random() * 0.5), pts[k], length * 0.4, w * 0.5, depth_left - 1)

	for i in range(cracks):
		a = 2 * math.pi * (i + r.random() * 0.7) / cracks
		start = outline.point(a, 0.98, 0.006)
		crack(a, start, R * (crack_len[0] + r.random() * (crack_len[1] - crack_len[0])) / 2, 0.035 + r.random() * 0.03)
	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	ck = C.obj_from_bm(bm, 'gate_cracks', cm, root, smooth=False)
	ck.visible_shadow = False

	# the soft red pool of light on the floor around it
	glow = C.plane('gate_glow', R * 5.2, R * 5.2 * outline.squash, (0, 0, 0.004), _glow_mat('gate_floor_glow', (1.0, 0.10, 0.02), 0.55 * heat), root)
	glow.visible_shadow = False

	# flames licking up from the rim, and a soft pillar of heat
	fm = flame_mat(f'gate_flame_{flame_strength}', flame_strength * heat)
	fc = flame_mat(f'gate_flame_core_{flame_strength}', flame_strength * heat * 1.5, core=True)
	for i in range(flames):
		a = 2 * math.pi * (i + r.random() * 0.8) / max(flames, 1)
		d = outline.at(a) * (0.5 + r.random() * 0.42)
		h = R * (0.55 + r.random() * 0.85) * flame_size
		w = R * (0.10 + r.random() * 0.10) * flame_size**0.5
		base = Vector((math.cos(a) * d, math.sin(a) * d * outline.squash, -0.6))
		sway = Vector((r.random() - 0.5, r.random() - 0.5, 0)) * h * 0.35
		ph = r.random() * 6
		n = 14
		pts = [base + Vector((0, 0, h * t / n)) + sway * math.sin(ph + 2.6 * t / n) * (t / n) for t in range(n + 1)]
		# a teardrop: fat low down, a long licking tip
		radii = [max(w * math.sin(math.pi * (t / n) ** 0.55) ** 0.9 * (1 - 0.35 * t / n), 0.002) for t in range(n + 1)]
		radii[0] = w * 0.5
		fl = C.tube('flame', pts, radii, fm, root, segs=14, cap=False)
		fl.visible_shadow = False
		# a hotter core inside each tongue
		core_pts = [base + (q - base) * 0.62 for q in pts]
		fl = C.tube('flame_core', core_pts, [q * 0.5 for q in radii], fc, root, segs=12, cap=False)
		fl.visible_shadow = False
	if pillar:
		pil = C.open_cone('gate_pillar', R * 0.85, R * 1.25, R * 3.4, C.beam_mat('gate_pillar', (1.0, 0.10, 0.02), 0.09 * heat), root, segs=40)
		pil.location = (0, 0, -0.6)
		pil.rotation_euler = (math.pi, 0, 0)
		pil.scale = (1, outline.squash, 1)

	# embers
	em = C.emit_mat('gate_ember', (1.0, 0.45, 0.05), 9.0 * heat)
	bm = bmesh.new()
	for _ in range(embers):
		a = r.random() * 2 * math.pi
		d = R * math.sqrt(r.random()) * 1.15
		z = -0.4 + r.random() ** 1.5 * R * 3.0
		s = 0.006 + r.random() * 0.014
		mat = np.eye(4)
		mat[0][3], mat[1][3], mat[2][3] = math.cos(a) * d, math.sin(a) * d * outline.squash, z
		from mathutils import Matrix

		bmesh.ops.create_icosphere(bm, subdivisions=1, radius=s, matrix=Matrix(mat.tolist()))
	eo = C.obj_from_bm(bm, 'gate_embers', em, root)
	eo.visible_shadow = False

	if light:
		for z, power, rad in ((-0.35, 2600, 0.6), (0.9, 520, 0.5)):
			li = C.point_light((0, 0, z), (1.0, 0.18, 0.04), power * heat * (R / 2) ** 2, radius=R * rad, parent=root, name='GateLight')
			li.visible_glossy = False
	return root
