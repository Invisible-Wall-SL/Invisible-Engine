"""Devil v2: the stored poses and test clips, keyed on the controls and the FK bones.

- `devil.rest`: the T-pose of the turnaround (one frame).
- `devil.action_pose`: the crouching snarl of the action-pose reference (a held pose).
- `devil.fly_flap`: a wing-flap loop, legs tucked, body bobbing.
- `devil.idle`: a standing loop: breathing, a weight shift, ears, tail, arms hanging.

Clip rules (docs/conventions/blender-3d-assets.md): 30 fps, `<set>.<clip>` names, fake users,
`root` never keyed, no scale keys, a loop's last frame equals its first. Every clip keys the same
set of bones, so switching clips never leaves a stale channel behind. The loops are keyed on every
frame with linear interpolation: they are made by formula, and that keeps the loop point exact.

A rotation is given as (axis, degrees) about an axis of the armature **as the bone lies at rest**:
X to the character's left, Y to its back, Z up. `side()` mirrors it for the right-hand bone.
"""

from __future__ import annotations

import math

import bpy  # isort: skip  (bpy must load before bmesh and mathutils)
from mathutils import Matrix, Quaternion, Vector

FPS = 30
TAIL = [f'tail_{i:02d}' for i in range(1, 6)]
FINGERS = ['finger1', 'finger2', 'finger3', 'finger4']


class Poser:
	def __init__(self, rig):
		self.rig = rig
		self.pose = rig.pose.bones
		self.last: dict[str, Quaternion] = {}
		ctl = [b.name for b in self.pose if b.name.startswith('ctl_')]
		fk = [b.name for b in self.pose if b.bone.use_deform and b.name != 'pelvis' and not b.name.startswith('eye_')]
		self.ctl, self.fk = ctl, fk
		self.props = [(n, k) for n in ctl for k in ('ik', 'roll') if k in self.pose[n]]

	def reset(self):
		for pb in self.pose:
			pb.location = (0, 0, 0)
			pb.scale = (1, 1, 1)
			if pb.rotation_mode == 'QUATERNION':
				pb.rotation_quaternion = (1, 0, 0, 0)
		for n, k in self.props:
			self.pose[n][k] = 1.0 if k == 'ik' else 0.0
		return self

	def rot(self, name, axis, deg):
		pb = self.pose[name]
		local = pb.bone.matrix_local.to_3x3().inverted() @ Vector(axis)
		pb.rotation_quaternion = Quaternion(local, math.radians(deg)) @ pb.rotation_quaternion

	def side(self, base, axis, deg, right=None):
		"""Both sides: the right bone gets the mirrored rotation (or `right` degrees of it)."""
		self.rot(base + '_l', axis, deg)
		self.rot(base + '_r', (axis[0], -axis[1], -axis[2]), deg if right is None else right)

	def loc(self, name, offset):
		pb = self.pose[name]
		pb.location = Vector(pb.location) + pb.bone.matrix_local.to_3x3().inverted() @ Vector(offset)

	def locs(self, base, offset):
		self.loc(base + '_l', offset)
		self.loc(base + '_r', (-offset[0], offset[1], offset[2]))

	def aim(self, name, direction):
		"""Point a bone along a direction of the armature, whatever its parents are doing.

		It reads the evaluated pose, so the parents must be posed first (it updates the scene).
		"""
		bpy.context.view_layer.update()
		pb = self.pose[name]
		turn = pb.y_axis.rotation_difference(Vector(direction).normalized()).to_matrix().to_4x4()
		head = Matrix.Translation(pb.head)
		pb.matrix = head @ turn @ head.inverted() @ pb.matrix
		bpy.context.view_layer.update()

	def prop(self, name, key, value):
		self.pose[name][key] = float(value)

	def key(self, frame):
		for name in self.ctl + self.fk:
			pb = self.pose[name]
			q = pb.rotation_quaternion.copy()
			prev = self.last.get(name)
			if prev is not None and prev.dot(q) < 0:
				q.negate()
				pb.rotation_quaternion = q
			self.last[name] = q
			pb.keyframe_insert('rotation_quaternion', frame=frame)
			if name in self.ctl:
				pb.keyframe_insert('location', frame=frame)
		for n, k in self.props:
			self.pose[n].keyframe_insert(f'["{k}"]', frame=frame)


# ---------------------------------------------------------------------------------------------
# poses
# ---------------------------------------------------------------------------------------------


def fingers(p, curl1, curl2, spread=0.0, thumb=0.0, sides=('_l', '_r')):
	for sfx in sides:
		sg = 1.0 if sfx == '_l' else -1.0
		for i, f in enumerate(FINGERS):
			p.rot(f'{f}_01{sfx}', (0, sg, 0), curl1)
			p.rot(f'{f}_02{sfx}', (0, sg, 0), curl2)
			p.rot(f'{f}_01{sfx}', (0, 0, sg), (1 - i) * spread)
		p.rot('thumb_01' + sfx, (0, 0, sg), -thumb)
		p.rot('thumb_02' + sfx, (0, 0, sg), -thumb * 1.2)
		p.rot('thumb_01' + sfx, (0, sg, 0), thumb * 0.5)


def wings_fold(p, amount):
	"""0 = spread as at rest, 1 = folded down against the back."""
	p.side('wing_01', (0, 1, 0), 26 * amount)
	p.side('wing_01', (0, 0, 1), 12 * amount)
	p.side('wing_02', (0, 1, 0), -34 * amount)
	p.side('wing_f1_01', (0, 1, 0), 46 * amount)
	p.side('wing_f1_02', (0, 1, 0), 18 * amount)
	p.side('wing_f2', (0, 1, 0), 34 * amount)
	p.side('wing_f3', (0, 1, 0), 20 * amount)


def pose_rest(p, _phase=0.0):
	p.reset()


def pose_action(p, _phase=0.0):
	"""The crouching snarl: low and wide, torso thrown forward, claws out, wings up, tail looped."""
	p.reset()
	# hips: down, forward, tipped; a little turn so the left shoulder leads
	p.loc('ctl_cog', (0.015, -0.050, -0.165))
	p.rot('ctl_cog', (1, 0, 0), 32)
	p.rot('ctl_cog', (0, 0, 1), -6)
	# feet: a wide stance, toes out, knees out
	p.loc('ctl_foot_l', (0.135, -0.090, 0.0))
	p.rot('ctl_foot_l', (0, 0, 1), 30)
	p.loc('ctl_foot_r', (-0.165, 0.070, 0.0))
	p.rot('ctl_foot_r', (0, 0, 1), -34)
	p.loc('ctl_knee_l', (0.26, -0.05, 0.0))
	p.loc('ctl_knee_r', (-0.30, 0.05, 0.0))
	# spine curls forward; the neck lifts the head back up and thrusts it out
	p.rot('spine_01', (1, 0, 0), 12)
	p.rot('spine_02', (1, 0, 0), 14)
	p.rot('spine_03', (1, 0, 0), 12)
	p.rot('spine_02', (0, 0, 1), -8)
	p.rot('neck_01', (1, 0, 0), -22)
	p.rot('head', (1, 0, 0), -26)
	p.rot('head', (0, 0, 1), -10)
	p.rot('head', (0, 1, 0), -8)
	p.rot('jaw', (1, 0, 0), 13)
	p.side('ear', (0, 1, 0), 14)
	p.side('ear', (1, 0, 0), -12)
	# arms: IK, out in front, elbows wide, hands hanging like claws
	p.side('clavicle', (0, 0, 1), -12)
	p.loc('ctl_hand_l', (-0.135, -0.330, -0.355))
	p.rot('ctl_hand_l', (0, 0, 1), -62)
	p.rot('ctl_hand_l', (1, 0, 0), 38)
	p.rot('ctl_hand_l', (0, 1, 0), 18)
	p.loc('ctl_hand_r', (0.060, -0.300, -0.300))
	p.rot('ctl_hand_r', (0, 0, 1), 70)
	p.rot('ctl_hand_r', (1, 0, 0), 46)
	p.rot('ctl_hand_r', (0, 1, 0), -20)
	p.loc('ctl_elbow_l', (0.22, -0.10, 0.02))
	p.loc('ctl_elbow_r', (-0.26, -0.06, 0.02))
	fingers(p, 28, 46, spread=16, thumb=14)
	# wings: thrown up and back, half spread
	p.side('wing_01', (1, 0, 0), -42)
	p.side('wing_01', (0, 1, 0), -24)
	p.side('wing_02', (0, 1, 0), -8)
	p.side('wing_f1_01', (0, 1, 0), 8)
	p.side('wing_f2', (0, 1, 0), 10)
	p.side('wing_f3', (0, 1, 0), 16)
	# tail: up behind and round in a loop, a little to the left
	for name, deg in zip(TAIL, (5, 42, 98, 158, 218, 278)):
		a = math.radians(deg)
		p.aim(name, (0.55, math.cos(a), math.sin(a)))
	p.loc('ctl_eyes', (-0.05, 0.0, -0.02))


def pose_fly(p, phase):
	"""One wing beat, phase 0..2π: the body rises on the down-stroke, legs tucked, tail trailing."""
	s = math.sin
	p.reset()
	for sfx in ('_l', '_r'):
		p.prop('ctl_hand' + sfx, 'ik', 0)
		p.prop('ctl_foot' + sfx, 'ik', 0)
	p.loc('ctl_cog', (0, 0, 0.18 + 0.030 * s(phase - 1.9)))
	p.rot('ctl_cog', (1, 0, 0), 24 + 3.0 * s(phase - 1.2))
	p.rot('spine_02', (1, 0, 0), 6 + 2.5 * s(phase - 0.6))
	p.rot('spine_03', (1, 0, 0), 4 + 2.5 * s(phase - 0.2))
	p.rot('neck_01', (1, 0, 0), -14 - 2.0 * s(phase - 0.4))
	p.rot('head', (1, 0, 0), -16 - 2.5 * s(phase))
	p.rot('jaw', (1, 0, 0), 5)
	p.side('ear', (0, 1, 0), 10 + 7 * s(phase - 0.8))
	p.side('ear', (1, 0, 0), -10)
	# legs tucked up, trailing a beat behind the body
	p.side('thigh', (1, 0, 0), 38 + 5 * s(phase - 2.2))
	p.side('thigh', (0, 1, 0), -8)
	p.side('calf', (1, 0, 0), -74 - 6 * s(phase - 2.6))
	p.side('foot', (1, 0, 0), -34 - 5 * s(phase - 3.0))
	p.side('ball', (1, 0, 0), -18)
	# arms hanging forward, loose
	p.side('upperarm', (0, 1, 0), 46 + 4 * s(phase - 1.5))
	p.side('upperarm', (0, 0, 1), -26)
	p.side('lowerarm', (0, 0, 1), -52 - 5 * s(phase - 2.0))
	p.side('hand', (0, 1, 0), 14 + 5 * s(phase - 2.4))
	fingers(p, 22, 34, spread=10, thumb=10)
	# the beat: the arm leads, the fingers and the membrane lag behind it
	a = s(phase)
	p.side('wing_01', (1, 0, 0), -22)
	p.side('wing_01', (0, 1, 0), -6 - 40 * a)
	p.side('wing_02', (0, 1, 0), -24 * s(phase - 0.55))
	p.side('wing_f1_01', (0, 1, 0), -18 * s(phase - 0.95))
	p.side('wing_f1_02', (0, 1, 0), -16 * s(phase - 1.30))
	p.side('wing_f2', (0, 1, 0), -15 * s(phase - 1.05))
	p.side('wing_f3', (0, 1, 0), -10 * s(phase - 0.90))
	# on the up-stroke the wing half folds to slip through the air
	fold = 0.5 - 0.5 * math.cos(phase - 2.6)
	p.side('wing_f1_01', (0, 0, 1), 12 * fold)
	p.side('wing_f2', (0, 0, 1), 9 * fold)
	p.side('wing_f3', (0, 0, 1), 6 * fold)
	for i, name in enumerate(TAIL):
		p.rot(name, (1, 0, 0), -9 + 7 * s(phase - 1.4 - i * 0.55))
		p.rot(name, (0, 0, 1), 3 * s(phase - i * 0.4))


def _bump(phase, at, width=0.5):
	"""A single soft twitch per loop."""
	d = math.atan2(math.sin(phase - at), math.cos(phase - at))
	return math.exp(-(d / width) ** 2)


def pose_idle(p, phase):
	"""Standing, arms hanging: breathing (twice a loop), one slow weight shift, ears and tail alive."""
	s = math.sin
	p.reset()
	for sfx in ('_l', '_r'):
		p.prop('ctl_hand' + sfx, 'ik', 0)
	breath = s(2 * phase)
	sway = s(phase)
	p.loc('ctl_cog', (0.012 * sway, 0.0, -0.006 - 0.003 * breath - 0.004 * abs(sway)))
	p.rot('ctl_cog', (0, 1, 0), 2.2 * sway)
	p.rot('ctl_cog', (0, 0, 1), 1.5 * s(phase - 0.8))
	p.rot('spine_01', (0, 1, 0), -1.4 * sway)
	p.rot('spine_02', (1, 0, 0), 3.0 + 1.3 * breath)
	p.rot('spine_03', (1, 0, 0), 2.0 + 1.6 * breath)
	p.rot('spine_03', (0, 1, 0), -1.2 * sway)
	p.rot('neck_01', (1, 0, 0), -4.0 - 1.4 * breath)
	p.rot('head', (1, 0, 0), -2.0 - 1.0 * s(2 * phase - 0.6))
	p.rot('head', (0, 0, 1), 7.0 * s(phase - 0.5))
	p.rot('head', (0, 1, 0), 2.5 * s(phase - 1.1))
	p.rot('jaw', (1, 0, 0), 1.5 + 1.2 * breath)
	p.rot('ear_l', (0, 1, 0), 4 + 16 * _bump(phase, 1.3, 0.35) + 2 * breath)
	p.rot('ear_r', (0, -1, 0), 4 + 16 * _bump(phase, 4.1, 0.35) + 2 * breath)
	# arms hang, a little forward of the belly, and swing with the shift
	p.side('clavicle', (0, 1, 0), 6 + 1.5 * breath)
	p.rot('upperarm_l', (0, 1, 0), 66 + 1.5 * breath - 2.0 * sway)
	p.rot('upperarm_r', (0, -1, 0), 66 + 1.5 * breath + 2.0 * sway)
	p.side('upperarm', (0, 0, 1), -10)
	p.rot('lowerarm_l', (0, 0, 1), -16 - 3 * s(phase - 0.9))
	p.rot('lowerarm_r', (0, 0, -1), -16 + 3 * s(phase - 0.9))
	p.side('lowerarm', (1, 0, 0), 24)
	p.side('hand', (0, 1, 0), 10 + 3 * s(2 * phase - 1.2))
	fingers(p, 16 + 4 * s(2 * phase - 1.5), 26 + 5 * s(2 * phase - 1.9), spread=6, thumb=8)
	# the knees give with the shift (the feet stay planted: IK)
	p.loc('ctl_knee_l', (0.05, 0, 0))
	p.loc('ctl_knee_r', (-0.05, 0, 0))
	# wings rest half folded and breathe
	wings_fold(p, 0.55 + 0.03 * breath)
	p.side('wing_01', (0, 1, 0), 1.5 * s(2 * phase - 0.7))
	# the tail sways from the root to the tip
	for i, name in enumerate(TAIL):
		p.rot(name, (0, 0, 1), (2.5 + i * 1.3) * s(phase - 0.5 - i * 0.55))
		p.rot(name, (1, 0, 0), 2.0 * s(2 * phase - i * 0.6))
	p.loc('ctl_eyes', (0.035 * s(phase - 0.2), 0.0, 0.0))


CLIPS = [
	# name, pose function, frames in the loop (0 = a held pose), frames held
	('devil.rest', pose_rest, 0, 1),
	('devil.action_pose', pose_action, 0, 2),
	('devil.fly_flap', pose_fly, 24, 0),
	('devil.idle', pose_idle, 72, 0),
]


# ---------------------------------------------------------------------------------------------
# keying
# ---------------------------------------------------------------------------------------------


def _fcurves(action):
	for layer in getattr(action, 'layers', []):
		for strip in layer.strips:
			for bag in getattr(strip, 'channelbags', []):
				yield from bag.fcurves
	yield from getattr(action, 'fcurves', []) if not getattr(action, 'layers', None) else []


def build_actions(rig, ob=None, ctl=None):
	"""Make the four clips on the rig. Returns the actions; the rig ends in rest pose, unassigned."""
	del ob, ctl
	scene = bpy.context.scene
	scene.render.fps = FPS
	scene.render.fps_base = 1.0
	rig.animation_data_create()
	out = []
	for name, fn, loop, hold in CLIPS:
		old = bpy.data.actions.get(name)
		if old is not None:
			bpy.data.actions.remove(old)
		act = bpy.data.actions.new(name)
		act.use_fake_user = True
		rig.animation_data.action = act
		p = Poser(rig)
		if loop:
			for f in range(loop + 1):
				fn(p, 2 * math.pi * (f % loop) / loop)
				p.key(1 + f)
		else:
			for f in range(hold):
				fn(p, 0.0)
				p.key(1 + f)
		for fc in _fcurves(act):
			for k in fc.keyframe_points:
				k.interpolation = 'LINEAR'
			fc.update()
		if loop:
			act.use_frame_range = True
			act.frame_start, act.frame_end = 1, loop + 1
			act.use_cyclic = True
		out.append(act)
	rig.animation_data.action = None
	Poser(rig).reset()
	bpy.context.view_layer.update()
	return out


def apply_action(rig, action, frame=1):
	"""Pose the rig with a stored clip at a frame (None, or the rest clip, puts it back to rest)."""
	scene = bpy.context.scene
	Poser(rig).reset()
	rig.animation_data_create()
	if action is None:
		rig.animation_data.action = None
	else:
		if isinstance(action, str):
			action = bpy.data.actions[action]
		rig.animation_data.action = action
		slots = getattr(action, 'slots', None)
		if slots is not None and len(slots) and getattr(rig.animation_data, 'action_slot', None) is None:
			rig.animation_data.action_slot = slots[0]
	scene.frame_set(int(frame))
	bpy.context.view_layer.update()
	return action


def clear_action(rig):
	"""Back to the rest pose with no clip assigned (how the asset file is saved)."""
	apply_action(rig, None, bpy.context.scene.frame_current)
