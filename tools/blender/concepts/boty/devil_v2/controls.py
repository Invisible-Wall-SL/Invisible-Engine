"""Devil v2: the animator's controls, on top of the deform skeleton `rig.py` builds.

Every control is a non-deform bone in the same armature. The deform hierarchy is not touched: a
deform bone is still parented only to a deform bone or to `root`, and `root` never moves. Controls
drive deform bones through constraints, so a sampled export of the deform bones is the game clip.

- `ctl_root`: moves the whole character (root itself stays put).
- `ctl_cog`: the hips; `pelvis` copies it.
- `ctl_hand_l/r` + `ctl_elbow_l/r`: IK arms. `ctl_foot_l/r` + `ctl_knee_l/r` + `ctl_toe_l/r`: IK
  legs, with a `roll` property (heel lift round the ball). Each IK control has an `ik` property
  (1 = IK, 0 = FK: pose the deform limb bones directly).
- `ctl_eyes` (+ `ctl_eye_l/r`): what the eyes look at.
- Spine, neck, head, jaw, ears, clavicles, fingers, tail and wings are FK on the deform bones.
"""

from __future__ import annotations

import math

import bpy  # isort: skip  (bpy must load before bmesh and mathutils)
import bmesh
from mathutils import Matrix, Vector

SIDES = (('_l', 1.0), ('_r', -1.0))
# theme colours: left, right, centre, IK, face
COL = {'l': 'THEME04', 'r': 'THEME01', 'c': 'THEME09', 'ik_l': 'THEME03', 'ik_r': 'THEME02', 'face': 'THEME06', 'root': 'THEME10'}
FK_CENTRE = ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'jaw'] + [f'tail_{i:02d}' for i in range(1, 6)]
FK_SIDE = [
	'ear', 'clavicle', 'upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot', 'ball',
	'thumb_01', 'thumb_02', 'finger1_01', 'finger1_02', 'finger2_01', 'finger2_02', 'finger3_01', 'finger3_02', 'finger4_01', 'finger4_02',
	'wing_01', 'wing_02', 'wing_f1_01', 'wing_f1_02', 'wing_f2', 'wing_f3',
]


# ---------------------------------------------------------------------------------------------
# widgets: wire meshes that live only in bpy.data (never linked to a scene)
# ---------------------------------------------------------------------------------------------


def _widget(name, verts, edges):
	full = 'WGT_devil_' + name
	ob = bpy.data.objects.get(full)
	if ob is not None:
		return ob
	me = bpy.data.meshes.new(full)
	me.from_pydata(verts, edges, [])
	ob = bpy.data.objects.new(full, me)
	ob.use_fake_user = True
	return ob


def _circle(n=24, axis='y'):
	verts = []
	for i in range(n):
		a = 2 * math.pi * i / n
		c, s = math.cos(a), math.sin(a)
		verts.append({'y': (c, 0, s), 'x': (0, c, s), 'z': (c, s, 0)}[axis])
	return verts, [(i, (i + 1) % n) for i in range(n)]


def widgets():
	cv, ce = _circle()
	sv, se = [], []
	for axis in 'xyz':
		v, e = _circle(16, axis)
		se += [(a + len(sv), b + len(sv)) for a, b in e]
		sv += v
	box = [(x, y, z) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
	box_e = [(a, b) for a in range(8) for b in range(a + 1, 8) if sum(1 for k in range(3) if box[a][k] != box[b][k]) == 1]
	arrows = [(0, 0, 0), (1, 0, 0), (0.8, 0, 0.12), (0.8, 0, -0.12), (-1, 0, 0), (-0.8, 0, 0.12), (-0.8, 0, -0.12), (0, 0, 1), (0.12, 0, 0.8), (-0.12, 0, 0.8), (0, 0, -1), (0.12, 0, -0.8), (-0.12, 0, -0.8)]
	arrows_e = [(0, 1), (1, 2), (1, 3), (0, 4), (4, 5), (4, 6), (0, 7), (7, 8), (7, 9), (0, 10), (10, 11), (10, 12)]
	return {
		'circle': _widget('circle', cv, ce),
		'sphere': _widget('sphere', sv, se),
		'box': _widget('box', box, box_e),
		'root': _widget('root', cv + arrows, ce + [(a + len(cv), b + len(cv)) for a, b in arrows_e]),
	}


# ---------------------------------------------------------------------------------------------
# building
# ---------------------------------------------------------------------------------------------


def _pole_angle(base, ik, pole):
	"""The IK pole angle that leaves the chain where it is (the usual formula)."""
	pole_normal = (ik.tail_local - base.head_local).cross(pole - base.head_local)
	projected = pole_normal.cross(base.tail_local - base.head_local)
	x_axis = base.matrix_local.to_3x3() @ Vector((1, 0, 0))
	ang = x_axis.angle(projected) if projected.length > 1e-9 else 0.0
	if x_axis.cross(projected).angle(base.tail_local - base.head_local) < 1.0:
		ang = -ang
	return ang


def _rest_error(rig, names):
	bpy.context.view_layer.update()
	worst = 0.0
	for n in names:
		pb = rig.pose.bones[n]
		worst = max(worst, (pb.tail - pb.bone.tail_local).length, (pb.head - pb.bone.head_local).length)
	return worst


def _drive(rig, con, bone, prop, expression=None):
	fc = con.driver_add('influence')
	drv = fc.driver
	drv.type = 'SCRIPTED' if expression else 'AVERAGE'
	var = drv.variables.new()
	var.name = 'v'
	var.type = 'SINGLE_PROP'
	var.targets[0].id = rig
	var.targets[0].data_path = f'pose.bones["{bone}"]["{prop}"]'
	if expression:
		drv.expression = expression


def _prop(pb, name, value, lo=0.0, hi=1.0, description=''):
	pb[name] = value
	ui = pb.id_properties_ui(name)
	ui.update(min=lo, max=hi, soft_min=lo, soft_max=hi, description=description)
	pb.property_overridable_library_set(f'["{name}"]', True)


def add_controls(rig, devil=None, info=None):
	"""Add the control bones, constraints, properties, colours, shapes and bone collections.

	Returns {'controls': [...], 'mechanism': [...], 'fk': [...], 'widgets': [...], 'rest_error': m}.
	`devil` and `info` are not needed: everything is read off the armature's own bones.
	"""
	del devil, info
	data = rig.data
	for o in bpy.context.view_layer.objects:
		o.select_set(False)
	rig.select_set(True)
	bpy.context.view_layer.objects.active = rig
	bpy.ops.object.mode_set(mode='EDIT')
	eb = data.edit_bones
	ctl, mch = [], []

	def new(name, head, tail, parent, roll=0.0, like=None, group=ctl):
		b = eb.new(name)
		if like is not None:
			b.head, b.tail, b.roll = like.head.copy(), like.tail.copy(), like.roll
		else:
			b.head, b.tail, b.roll = Vector(head), Vector(tail), roll
		b.use_deform = False
		b.parent = eb[parent] if parent else None
		b.use_connect = False
		group.append(name)
		return b

	new('ctl_root', (0, 0, 0), (0, 0.22, 0), 'root')
	new('ctl_cog', None, None, 'ctl_root', like=eb['pelvis'])
	poles = {}
	for sfx, sx in SIDES:
		hand, lower, upper = eb['hand' + sfx], eb['lowerarm' + sfx], eb['upperarm' + sfx]
		new('ctl_hand' + sfx, None, None, 'ctl_root', like=hand)
		arm_len = (upper.tail - upper.head).length + (lower.tail - lower.head).length
		# the elbow points back, the knee forward: put each pole on its side of the joint
		back = (lower.head - (upper.head + lower.tail) / 2)
		back = back.normalized() if back.length > 1e-4 else Vector((0, 1, 0))
		p = lower.head + back * arm_len * 0.9
		new('ctl_elbow' + sfx, p, p + Vector((0, 0.05, 0)), 'ctl_root')
		poles['arm' + sfx] = p.copy()

		thigh, calf, foot, ball = eb['thigh' + sfx], eb['calf' + sfx], eb['foot' + sfx], eb['ball' + sfx]
		new('ctl_foot' + sfx, None, None, 'ctl_root', like=foot)
		new('mch_roll' + sfx, ball.head, ball.head + Vector((0, 0, 0.06)), 'ctl_foot' + sfx, group=mch)
		new('mch_foot' + sfx, None, None, 'mch_roll' + sfx, like=foot, group=mch)
		new('ctl_toe' + sfx, None, None, 'ctl_foot' + sfx, like=ball)
		leg_len = (thigh.tail - thigh.head).length + (calf.tail - calf.head).length
		fwd = (calf.head - (thigh.head + calf.tail) / 2)
		fwd = fwd.normalized() if fwd.length > 1e-4 else Vector((0, -1, 0))
		p = calf.head + fwd * leg_len * 1.1
		new('ctl_knee' + sfx, p, p + Vector((0, -0.05, 0)), 'ctl_root')
		poles['leg' + sfx] = p.copy()

		eye = eb['eye' + sfx]
		d = (eye.tail - eye.head).normalized()
		p = eye.head + d * 0.45
		new('ctl_eye' + sfx, p, p + Vector((0, 0, 0.025)), None)
	mid = (eb['ctl_eye_l'].head + eb['ctl_eye_r'].head) / 2
	new('ctl_eyes', mid, mid + Vector((0, 0, 0.05)), 'head')
	for sfx, _sx in SIDES:
		eb['ctl_eye' + sfx].parent = eb['ctl_eyes']
	bpy.ops.object.mode_set(mode='OBJECT')

	pose = rig.pose.bones
	bones = data.bones
	for name in ctl + mch:
		pose[name].rotation_mode = 'QUATERNION'

	# hips
	con = pose['pelvis'].constraints.new('COPY_TRANSFORMS')
	con.name = 'cog'
	con.target, con.subtarget = rig, 'ctl_cog'

	limb_bones = []
	for sfx, _sx in SIDES:
		# arms
		hand_ctl = pose['ctl_hand' + sfx]
		_prop(hand_ctl, 'ik', 1.0, description='1 = IK arm, 0 = FK (pose upperarm, lowerarm and hand)')
		ik = pose['lowerarm' + sfx].constraints.new('IK')
		ik.name = 'ik'
		ik.target, ik.subtarget = rig, 'ctl_hand' + sfx
		ik.pole_target, ik.pole_subtarget = rig, 'ctl_elbow' + sfx
		ik.chain_count = 2
		ik.use_stretch = False
		ik.pole_angle = _pole_angle(bones['upperarm' + sfx], bones['lowerarm' + sfx], poles['arm' + sfx])
		_drive(rig, ik, 'ctl_hand' + sfx, 'ik')
		cr = pose['hand' + sfx].constraints.new('COPY_ROTATION')
		cr.name = 'ik_hand'
		cr.target, cr.subtarget = rig, 'ctl_hand' + sfx
		_drive(rig, cr, 'ctl_hand' + sfx, 'ik')
		# legs
		foot_ctl = pose['ctl_foot' + sfx]
		_prop(foot_ctl, 'ik', 1.0, description='1 = IK leg, 0 = FK (pose thigh, calf, foot and ball)')
		_prop(foot_ctl, 'roll', 0.0, -1.0, 1.5, 'heel lift, in radians, round the ball of the foot')
		roll = pose['mch_roll' + sfx]
		roll.rotation_mode = 'XYZ'
		fc = roll.driver_add('rotation_euler', 0)
		fc.driver.type = 'SCRIPTED'
		var = fc.driver.variables.new()
		var.name = 'roll'
		var.type = 'SINGLE_PROP'
		var.targets[0].id = rig
		var.targets[0].data_path = f'pose.bones["ctl_foot{sfx}"]["roll"]'
		fc.driver.expression = 'roll'
		ik = pose['calf' + sfx].constraints.new('IK')
		ik.name = 'ik'
		ik.target, ik.subtarget = rig, 'mch_foot' + sfx
		ik.pole_target, ik.pole_subtarget = rig, 'ctl_knee' + sfx
		ik.chain_count = 2
		ik.use_stretch = False
		ik.pole_angle = _pole_angle(bones['thigh' + sfx], bones['calf' + sfx], poles['leg' + sfx])
		_drive(rig, ik, 'ctl_foot' + sfx, 'ik')
		cr = pose['foot' + sfx].constraints.new('COPY_ROTATION')
		cr.name = 'ik_foot'
		cr.target, cr.subtarget = rig, 'mch_foot' + sfx
		_drive(rig, cr, 'ctl_foot' + sfx, 'ik')
		cr = pose['ball' + sfx].constraints.new('COPY_ROTATION')
		cr.name = 'ik_toe'
		cr.target, cr.subtarget = rig, 'ctl_toe' + sfx
		_drive(rig, cr, 'ctl_foot' + sfx, 'ik')
		# eyes
		dt = pose['eye' + sfx].constraints.new('DAMPED_TRACK')
		dt.name = 'look'
		dt.target, dt.subtarget = rig, 'ctl_eye' + sfx
		dt.track_axis = 'TRACK_Y'
		limb_bones += [n + sfx for n in ('upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot', 'ball')]

	# the pole angle formula can come out a half turn off: keep whichever leaves the rest pose alone
	for sfx, _sx in SIDES:
		for chain, mid_bone in ((('upperarm', 'lowerarm'), 'lowerarm'), (('thigh', 'calf'), 'calf')):
			con = pose[mid_bone + sfx].constraints['ik']
			names = [n + sfx for n in chain]
			base = con.pole_angle
			best = (_rest_error(rig, names), base)
			if best[0] > 1e-4:
				for k in range(1, 72):
					con.pole_angle = base + math.radians(5 * k)
					err = _rest_error(rig, names)
					if err < best[0]:
						best = (err, con.pole_angle)
				con.pole_angle = best[1]
				for step in (math.radians(1.0), math.radians(0.2), math.radians(0.04)):
					for sign in (1, -1):
						while True:
							con.pole_angle = best[1] + sign * step
							err = _rest_error(rig, names)
							if err < best[0] - 1e-9:
								best = (err, con.pole_angle)
							else:
								break
				con.pole_angle = best[1]
	# the heel must lift with a positive roll
	for sfx, _sx in SIDES:
		pose['ctl_foot' + sfx]['roll'] = 0.3
	bpy.context.view_layer.update()
	rig.update_tag()
	bpy.context.view_layer.update()
	for sfx, _sx in SIDES:
		lifted = pose['mch_foot' + sfx].head.z - bones['mch_foot' + sfx].head_local.z
		if lifted < 0:
			pose['mch_roll' + sfx].driver_remove('rotation_euler', 0)
			fc = pose['mch_roll' + sfx].driver_add('rotation_euler', 0)
			fc.driver.type = 'SCRIPTED'
			var = fc.driver.variables.new()
			var.name = 'roll'
			var.type = 'SINGLE_PROP'
			var.targets[0].id = rig
			var.targets[0].data_path = f'pose.bones["ctl_foot{sfx}"]["roll"]'
			fc.driver.expression = '-roll'
		pose['ctl_foot' + sfx]['roll'] = 0.0
	rig.update_tag()
	error = _rest_error(rig, limb_bones + ['pelvis', 'eye_l', 'eye_r'])

	# shapes, colours, collections
	wg = widgets()

	def shape(name, widget, scale, colour, offset=(0, 0, 0), rot=(0, 0, 0)):
		pb = pose[name]
		pb.custom_shape = wg[widget]
		ln = max(pb.bone.length, 1e-4)
		pb.custom_shape_scale_xyz = (scale / ln,) * 3 if isinstance(scale, (int, float)) else tuple(v / ln for v in scale)
		pb.custom_shape_translation = offset
		pb.custom_shape_rotation_euler = rot
		pb.use_custom_shape_bone_size = True
		pb.color.palette = COL[colour]
		pb.bone.color.palette = COL[colour]
		pb.bone.show_wire = True

	shape('ctl_root', 'root', 0.30, 'root', rot=(math.pi / 2, 0, 0))
	shape('ctl_cog', 'circle', 0.20, 'c')
	shape('ctl_eyes', 'box', (0.09, 0.012, 0.03), 'face')
	for sfx, _sx in SIDES:
		side = sfx[1]
		shape('ctl_hand' + sfx, 'box', (0.035, 0.05, 0.035), 'ik_' + side, offset=(0, pose['ctl_hand' + sfx].bone.length * 0.5, 0))
		shape('ctl_foot' + sfx, 'box', (0.05, 0.085, 0.03), 'ik_' + side, offset=(0, pose['ctl_foot' + sfx].bone.length * 0.5, 0))
		shape('ctl_toe' + sfx, 'circle', 0.05, 'ik_' + side, offset=(0, pose['ctl_toe' + sfx].bone.length * 0.5, 0))
		shape('ctl_elbow' + sfx, 'sphere', 0.022, 'ik_' + side)
		shape('ctl_knee' + sfx, 'sphere', 0.022, 'ik_' + side)
		shape('ctl_eye' + sfx, 'circle', 0.018, 'face', rot=(math.pi / 2, 0, 0))
	fk = []
	radius = {'spine_01': 0.17, 'spine_02': 0.16, 'spine_03': 0.13, 'neck_01': 0.06, 'head': 0.15, 'jaw': 0.07}
	for name in FK_CENTRE:
		if name in pose:
			shape(name, 'circle', radius.get(name, 0.05), 'c' if name != 'jaw' else 'face')
			fk.append(name)
	side_radius = {'clavicle': 0.05, 'upperarm': 0.045, 'lowerarm': 0.045, 'hand': 0.04, 'thigh': 0.06, 'calf': 0.05, 'foot': 0.05, 'ball': 0.045, 'ear': 0.05, 'wing_01': 0.04, 'wing_02': 0.035}
	for base in FK_SIDE:
		for sfx, _sx in SIDES:
			name = base + sfx
			if name in pose:
				shape(name, 'circle', side_radius.get(base, 0.02), sfx[1], offset=(0, pose[name].bone.length * 0.5, 0))
				fk.append(name)

	cols = {}
	for cname in ('DEF', 'CTL', 'CTL_FK', 'MCH'):
		cols[cname] = data.collections.get(cname) or data.collections.new(cname)
	for b in data.bones:
		if b.name in mch:
			cols['MCH'].assign(b)
		elif b.name in ctl:
			cols['CTL'].assign(b)
		elif b.use_deform or b.name == 'root':
			cols['DEF'].assign(b)
		if b.name in fk:
			cols['CTL_FK'].assign(b)
	cols['MCH'].is_visible = False
	for name in mch:
		pose[name].lock_location = (True, True, True)
	rig['ie_controls'] = 'ctl_* = controls, mch_* = mechanism; ik and roll are properties on ctl_hand_* / ctl_foot_*'
	return {'controls': ctl, 'mechanism': mch, 'fk': fk, 'widgets': [w.name for w in wg.values()], 'rest_error': error}


def set_ik(rig, value, arms=True, legs=True):
	"""Switch the limbs between IK (1) and FK (0)."""
	for sfx, _sx in SIDES:
		if arms:
			rig.pose.bones['ctl_hand' + sfx]['ik'] = float(value)
		if legs:
			rig.pose.bones['ctl_foot' + sfx]['ik'] = float(value)
	rig.update_tag()


# ---------------------------------------------------------------------------------------------
# a renderable picture of the rig (armatures do not render in Cycles)
# ---------------------------------------------------------------------------------------------


def _emit(name, colour, strength=1.0):
	m = bpy.data.materials.get(name)
	if m is None:
		m = bpy.data.materials.new(name)
		m.use_nodes = True
		nt = m.node_tree
		nt.nodes.clear()
		out = nt.nodes.new('ShaderNodeOutputMaterial')
		em = nt.nodes.new('ShaderNodeEmission')
		em.inputs['Color'].default_value = (*colour, 1)
		em.inputs['Strength'].default_value = strength
		nt.links.new(em.outputs[0], out.inputs['Surface'])
	return m


def _octa(bm, head, tail, x_axis, z_axis, mat_index):
	d = tail - head
	ln = d.length
	if ln < 1e-6:
		return
	w = min(max(ln * 0.1, 0.0025), 0.012)
	mid = head + d * 0.12
	ring = [bm.verts.new(mid + x_axis * w), bm.verts.new(mid + z_axis * w), bm.verts.new(mid - x_axis * w), bm.verts.new(mid - z_axis * w)]
	a, b = bm.verts.new(head), bm.verts.new(tail)
	for i in range(4):
		for f in (bm.faces.new((a, ring[(i + 1) % 4], ring[i])), bm.faces.new((b, ring[i], ring[(i + 1) % 4]))):
			f.material_index = mat_index


def _tube_ring(bm, centre, u, v, radius, thickness, mat_index, n=28, m=6):
	"""A thin torus: a control drawn as a ring."""
	nrm = u.cross(v).normalized()
	rings = []
	for i in range(n):
		a = 2 * math.pi * i / n
		out = u * math.cos(a) + v * math.sin(a)
		c = centre + out * radius
		rings.append([bm.verts.new(c + (out * math.cos(2 * math.pi * j / m) + nrm * math.sin(2 * math.pi * j / m)) * thickness) for j in range(m)])
	for i in range(n):
		for j in range(m):
			f = bm.faces.new((rings[i][j], rings[(i + 1) % n][j], rings[(i + 1) % n][(j + 1) % m], rings[i][(j + 1) % m]))
			f.material_index = mat_index


def _box(bm, mat, size, mat_index, thickness):
	"""A wire box: twelve thin struts."""
	corners = [Vector((x * size[0], y * size[1], z * size[2])) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
	for a in range(8):
		for b in range(a + 1, 8):
			if sum(1 for k in range(3) if corners[a][k] != corners[b][k]) == 1:
				_stick(bm, mat @ corners[a], mat @ corners[b], thickness, mat_index)


def _stick(bm, a, b, thickness, mat_index, n=5):
	d = b - a
	if d.length < 1e-6:
		return
	u = d.orthogonal().normalized()
	v = d.normalized().cross(u)
	ra = [bm.verts.new(a + (u * math.cos(2 * math.pi * j / n) + v * math.sin(2 * math.pi * j / n)) * thickness) for j in range(n)]
	rb = [bm.verts.new(b + (u * math.cos(2 * math.pi * j / n) + v * math.sin(2 * math.pi * j / n)) * thickness) for j in range(n)]
	for j in range(n):
		f = bm.faces.new((ra[j], ra[(j + 1) % n], rb[(j + 1) % n], rb[j]))
		f.material_index = mat_index


def _ball(bm, centre, radius, mat_index):
	geom = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius, matrix=Matrix.Translation(centre))
	for f in {f for v in geom['verts'] for f in v.link_faces}:
		f.material_index = mat_index


def debug_geometry(rig, bones=True, controls=True, fk_rings=False):
	"""Mesh stand-ins for the armature in its current pose, in world space, with emission materials.

	Deform bones are white octahedra; controls are coloured (left blue, right red, centre yellow,
	IK brighter, face green): boxes for the IK hands and feet, balls and a guide line for the poles,
	rings for the rest. Returns the new objects (linked to the scene's collection); delete them
	after the render.
	"""
	bpy.context.view_layer.update()
	mw = rig.matrix_world
	rot = mw.to_3x3()
	pose = rig.pose.bones
	mats = [
		_emit('DBG_bone', (0.85, 0.85, 0.80), 1.0),
		_emit('DBG_left', (0.05, 0.35, 1.0), 2.0),
		_emit('DBG_right', (1.0, 0.08, 0.05), 2.0),
		_emit('DBG_centre', (1.0, 0.75, 0.05), 2.0),
		_emit('DBG_face', (0.1, 1.0, 0.3), 2.0),
		_emit('DBG_guide', (0.5, 0.5, 0.5), 0.6),
	]

	def colour(name):
		if 'eye' in name or name == 'jaw':
			return 4
		return 1 if name.endswith('_l') else 2 if name.endswith('_r') else 3

	out = []
	if bones:
		bm = bmesh.new()
		for pb in pose:
			if pb.bone.use_deform:
				_octa(bm, mw @ pb.head, mw @ pb.tail, (rot @ pb.x_axis).normalized(), (rot @ pb.z_axis).normalized(), 0)
		me = bpy.data.meshes.new('DBG_bones')
		bm.to_mesh(me)
		bm.free()
		me.materials.append(mats[0])
		ob = bpy.data.objects.new('DBG_bones', me)
		bpy.context.scene.collection.objects.link(ob)
		ob.visible_shadow = False
		out.append(ob)
	if controls:
		bm = bmesh.new()
		for pb in pose:
			name = pb.name
			if not name.startswith('ctl_'):
				continue
			ci = colour(name)
			m = mw @ pb.matrix
			head, tail = mw @ pb.head, mw @ pb.tail
			x, y, z = (rot @ pb.x_axis).normalized(), (rot @ pb.y_axis).normalized(), (rot @ pb.z_axis).normalized()
			ln = pb.bone.length
			if name == 'ctl_root':
				_tube_ring(bm, head, x, y, 0.30, 0.004, ci, n=48)
				for d in (x, -x, y, -y):
					_stick(bm, head + d * 0.30, head + d * 0.36, 0.004, ci)
			elif name == 'ctl_cog':
				_tube_ring(bm, head, x, z, 0.20, 0.004, ci, n=40)
			elif name.startswith('ctl_hand'):
				_box(bm, m @ Matrix.Translation((0, ln * 0.5, 0)), (0.035, 0.05, 0.035), ci, 0.0022)
			elif name.startswith('ctl_foot'):
				_box(bm, m @ Matrix.Translation((0, ln * 0.5, 0)), (0.05, 0.085, 0.03), ci, 0.0022)
			elif name.startswith('ctl_toe'):
				_tube_ring(bm, (head + tail) / 2, x, z, 0.05, 0.002, ci)
			elif name.startswith(('ctl_elbow', 'ctl_knee')):
				_ball(bm, head, 0.016, ci)
				joint = pose[('lowerarm' if 'elbow' in name else 'calf') + name[-2:]]
				_stick(bm, head, mw @ joint.head, 0.0012, 5)
			elif name == 'ctl_eyes':
				_box(bm, m, (0.09, 0.012, 0.03), ci, 0.0018)
			elif name.startswith('ctl_eye'):
				_tube_ring(bm, head, x, y, 0.018, 0.0016, ci, n=20)
				_stick(bm, head, mw @ pose['eye' + name[-2:]].head, 0.0008, 5)
		if fk_rings:
			for pb in pose:
				if pb.custom_shape is None or pb.name.startswith('ctl_') or not pb.bone.use_deform:
					continue
				x, z = (rot @ pb.x_axis).normalized(), (rot @ pb.z_axis).normalized()
				r = pb.custom_shape_scale_xyz[0] * pb.bone.length
				_tube_ring(bm, mw @ (pb.head + (pb.tail - pb.head) * (0.0 if pb.name in FK_CENTRE else 0.5)), x, z, r, 0.0013, colour(pb.name), n=24, m=4)
		me = bpy.data.meshes.new('DBG_controls')
		bm.to_mesh(me)
		bm.free()
		for mt in mats:
			me.materials.append(mt)
		ob = bpy.data.objects.new('DBG_controls', me)
		bpy.context.scene.collection.objects.link(ob)
		ob.visible_shadow = False
		out.append(ob)
	return out
