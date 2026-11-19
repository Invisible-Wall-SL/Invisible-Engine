"""Devil v2: `RIG_ie_devil`, the deform skeleton.

Its own skeleton (the IE Humanoid's names and directions where the body is humanoid, plus jaw,
ears, eyes, fingers, wings and tail): 64 deform bones under a `root` that never moves. T-pose,
facing -Y, left on +X, every roll 0, quaternion rotations, as `ie_humanoid.py` builds its own.
The animator's controls are added on top by `controls.py`.
"""

from __future__ import annotations

import bpy  # isort: skip  (bpy must load before bmesh and mathutils)
from mathutils import Vector

import meshkit as MK
import spec as S

RIG = 'RIG_ie_devil'
SKELETON = 'ie_devil'


def default_wing():
	tips = [Vector(t) for t in S.WING_TIPS]
	wrist = Vector(S.J['wing_wrist'])
	return {
		'wing_01': Vector(S.J['wing_01']),
		'wing_02': Vector(S.J['wing_02']),
		'wing_wrist': wrist,
		'wing_f1_mid': (wrist + tips[0]) / 2,
		'wing_f1_tip': tips[0],
		'wing_f2_tip': tips[1],
		'wing_f3_tip': tips[2],
	}


def bone_table(devil, wing=None):
	"""(name, parent, head, tail, deform). Left-side bones end in `_l`; the right side is mirrored."""
	J = {k: Vector(v) for k, v in S.J.items()}
	wing = {k: Vector(v) for k, v in (wing or default_wing()).items()}
	t = [('root', None, Vector((0, 0, 0)), Vector((0, 0, 0.15)), False)]

	def add(name, parent, head, tail, deform=True):
		t.append((name, parent, Vector(head), Vector(tail), deform))

	add('pelvis', 'root', J['pelvis'], J['spine_01'])
	add('spine_01', 'pelvis', J['spine_01'], J['spine_02'])
	add('spine_02', 'spine_01', J['spine_02'], J['spine_03'])
	add('spine_03', 'spine_02', J['spine_03'], J['neck_01'])
	add('neck_01', 'spine_03', J['neck_01'], J['head'])
	add('head', 'neck_01', J['head'], J['head_end'])
	add('jaw', 'head', J['jaw'], J['jaw_end'])
	span = len(S.TAIL) - 1
	tail = MK.sample(S.TAIL, [i / S.TAIL_BONES * span for i in range(S.TAIL_BONES + 1)])
	for i in range(S.TAIL_BONES):
		add(f'tail_{i + 1:02d}', 'pelvis' if i == 0 else f'tail_{i:02d}', tail[i], tail[i + 1])
	# left side
	add('ear_l', 'head', J['ear'], J['ear_end'])
	add('eye_l', 'head', devil.eyes[0]['centre'], devil.eyes[0]['centre'] + devil.eyes[0]['normal'] * 0.035)
	add('clavicle_l', 'spine_03', J['clavicle'], J['upperarm'])
	add('upperarm_l', 'clavicle_l', J['upperarm'], J['lowerarm'])
	add('lowerarm_l', 'upperarm_l', J['lowerarm'], J['hand'])
	add('hand_l', 'lowerarm_l', J['hand'], J['hand_end'])
	digits = devil.info['digits']
	for chain in ('thumb', 'finger1', 'finger2', 'finger3', 'finger4'):
		j = digits[chain][0]
		add(f'{chain}_01_l', 'hand_l', j[0], j[1])
		add(f'{chain}_02_l', f'{chain}_01_l', j[1], j[2] + (j[3] - j[2]) * 0.6)
	add('thigh_l', 'pelvis', J['thigh'], J['calf'])
	add('calf_l', 'thigh_l', J['calf'], J['foot'])
	add('foot_l', 'calf_l', J['foot'], J['ball'])
	add('ball_l', 'foot_l', J['ball'], J['ball_end'])
	add('wing_01_l', 'spine_03', wing['wing_01'], wing['wing_02'])
	add('wing_02_l', 'wing_01_l', wing['wing_02'], wing['wing_wrist'])
	add('wing_f1_01_l', 'wing_02_l', wing['wing_wrist'], wing['wing_f1_mid'])
	add('wing_f1_02_l', 'wing_f1_01_l', wing['wing_f1_mid'], wing['wing_f1_tip'])
	add('wing_f2_l', 'wing_02_l', wing['wing_wrist'], wing['wing_f2_tip'])
	add('wing_f3_l', 'wing_02_l', wing['wing_wrist'], wing['wing_f3_tip'])
	out = list(t)
	for name, parent, head, tail_, deform in t:
		if name.endswith('_l'):
			par = parent[:-2] + '_r' if parent.endswith('_l') else parent
			out.append((name[:-2] + '_r', par, Vector((-head.x, head.y, head.z)), Vector((-tail_.x, tail_.y, tail_.z)), deform))
	return out


def build_armature(devil, wing=None):
	data = bpy.data.armatures.new(RIG)
	rig = bpy.data.objects.new(RIG, data)
	bpy.context.scene.collection.objects.link(rig)
	rig['ie_skeleton'] = SKELETON
	data.display_type = 'OCTAHEDRAL'
	for o in bpy.context.view_layer.objects:
		o.select_set(False)
	rig.select_set(True)
	bpy.context.view_layer.objects.active = rig
	bpy.ops.object.mode_set(mode='EDIT')
	bones = {}
	for name, parent, head, tail, deform in bone_table(devil, wing):
		eb = data.edit_bones.new(name)
		eb.head, eb.tail, eb.roll = head, tail, 0.0
		eb.use_deform = deform
		if parent:
			eb.parent = bones[parent]
			eb.use_connect = (bones[parent].tail - eb.head).length < 1e-6 and parent != 'root'
		bones[name] = eb
	bpy.ops.object.mode_set(mode='OBJECT')
	for pb in rig.pose.bones:
		pb.rotation_mode = 'QUATERNION'
	return rig


def bind(ob, rig):
	"""Skin the mesh to the rig: an Armature modifier, the object parented to the armature."""
	ob.parent = rig
	md = ob.modifiers.new('Armature', 'ARMATURE')
	md.object = rig
	md.use_deform_preserve_volume = False
	return md


def deform_names(rig):
	return {b.name for b in rig.data.bones if b.use_deform}
