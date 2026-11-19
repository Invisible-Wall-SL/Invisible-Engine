"""Devil v2 in the concept scenes: a drop-in for `devil.build_devil`.

Each call appends the rigged model from `CH_devil.blend`, parents it under a new empty placed as
the old chibi Devil was, and poses it with the rig's own controls. The old pose names keep their
meaning (`stand`, `fly`, `carry`, `hang`, `burst`, `climb`; `action` is the stored action pose), and hand targets given by a scene stay
where they were, so the props the scenes hang on a Devil are still in its hands.
"""

from __future__ import annotations

import math
import os

import bpy  # isort: skip  (bpy must load before mathutils)
from mathutils import Vector

import actions as AC
import common as C
import spec as S

HERE = os.path.dirname(os.path.abspath(__file__))
BLEND = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..', '..', 'docs', 'design', '3d', 'boty', 'devil-v2', 'CH_devil.blend'))
MESH, RIG = 'CH_devil_LODU', 'RIG_ie_devil'

# The old Devil's measures, which the scenes' numbers were written against.
OLD_CENTRE = 0.45
OLD_SHOULDER = Vector((0.118, 0.0, 0.552))
REACH = 1.2  # v2's arm against the old one
PHASES = (0.7, 2.3, 3.9, 5.3, 1.5, 4.5, 3.0, 0.2)
_state = {'material': None, 'count': 0}

# Old pose tables' hand positions (devil.POSES), for the poses a scene does not override.
OLD_HANDS = {
	'stand': ((0.315, -0.15, 0.455), (-0.315, -0.15, 0.455)),
	'fly': ((0.24, -0.22, 0.58), (-0.24, -0.22, 0.58)),
	'carry': ((0.20, -0.25, 0.36), (-0.20, -0.25, 0.36)),
	'hang': ((0.17, -0.10, 0.26), (-0.17, -0.10, 0.26)),
	'burst': ((0.36, -0.10, 0.66), (-0.36, -0.10, 0.66)),
	'climb': ((0.22, -0.26, 0.42), (-0.20, -0.24, 0.50)),
}
# Where the rig sits under the root: (y, z) for origin 'center' and for origin 'feet'.
OFFSET = {
	'stand': ((0.0, -0.56), (0.0, 0.0)),
	'fly': ((0.0, -0.56), (0.0, 0.0)),
	'carry': ((0.07, -0.56), (0.07, 0.0)),
	'hang': ((0.02, -0.42), (0.0, 0.0)),
	'burst': ((0.0, -0.56), (0.0, 0.0)),
	'climb': ((0.0, -0.56), (0.04, -0.10)),
}


def _append():
	with bpy.data.libraries.load(BLEND, link=False) as (src, dst):
		dst.objects = [n for n in (MESH, RIG) if n in src.objects]
	mesh = next(o for o in dst.objects if o.type == 'MESH')
	rig = next(o for o in dst.objects if o.type == 'ARMATURE')
	for o in (rig, mesh):
		bpy.context.scene.collection.objects.link(o)
	# one material and one set of images for every Devil in the scene
	if _state['material'] is None or _state['material'].name not in bpy.data.materials:
		_state['material'] = mesh.data.materials[0]
	else:
		new = mesh.data.materials[0]
		mesh.data.materials[0] = _state['material']
		if new.users == 0:
			images = [n.image for n in new.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]
			bpy.data.materials.remove(new)
			for img in images:
				if img.users == 0:
					bpy.data.images.remove(img)
	return mesh, rig


def _hands(p, rig_offset, targets, scaled):
	"""Put the IK hands on their targets (old-Devil coordinates under the root)."""
	for sfx, sx, t in (('_l', 1.0, targets[0]), ('_r', -1.0, targets[1])):
		t = Vector(t)
		if scaled:
			# a pose of the body, not a grip on a prop: keep its shape at v2's reach
			old_sh = Vector((OLD_SHOULDER.x * sx, OLD_SHOULDER.y, OLD_SHOULDER.z))
			new_sh = Vector((S.J['upperarm'][0] * sx, S.J['upperarm'][1], S.J['upperarm'][2]))
			goal = new_sh + (t - old_sh) * REACH
		else:
			goal = t - rig_offset
		rest = Vector((S.J['hand'][0] * sx, S.J['hand'][1], S.J['hand'][2]))
		for name in ('ctl_hand' + sfx, 'ctl_elbow' + sfx):
			pb = p.pose[name]
			pb.location = (0, 0, 0)
			pb.rotation_quaternion = (1, 0, 0, 0)
		p.prop('ctl_hand' + sfx, 'ik', 1)
		p.loc('ctl_hand' + sfx, goal - rest)


def _flying(p, phase):
	AC.pose_fly(p, phase)
	cog = p.pose['ctl_cog']
	cog.location = (0, 0, 0)
	cog.rotation_quaternion = (1, 0, 0, 0)
	p.rot('ctl_cog', (1, 0, 0), 8)
	# upright here, not flying flat: the head comes back down to look where it is going
	for name in ('neck_01', 'head'):
		p.pose[name].rotation_quaternion = (1, 0, 0, 0)
	p.rot('head', (1, 0, 0), 6)


def _pose(p, pose, phase, rig_offset, over, centre):
	if pose == 'action':
		AC.pose_action(p)
		return
	old_z = Vector((0, 0, -OLD_CENTRE if centre else 0.0))
	given = 'hand_l' in over or 'hand_r' in over
	left = Vector(over.get('hand_l', OLD_HANDS[pose][0])) + old_z
	right = Vector(over.get('hand_r', OLD_HANDS[pose][1])) + old_z
	grip = given or pose in ('carry', 'hang', 'climb')
	targets = (left, right) if grip else (left - old_z, right - old_z)
	if pose == 'stand':
		AC.pose_idle(p, phase)
		_hands(p, rig_offset, targets, scaled=True)
		p.side('ctl_hand', (0, 0, 1), -62)
		p.side('ctl_hand', (0, 1, 0), -18)
		p.locs('ctl_elbow', (0.20, 0.10, -0.05))
		AC.fingers(p, 30, 44, spread=16, thumb=14)
		p.rot('jaw', (1, 0, 0), 6)
		return
	if pose == 'climb':
		p.reset()
		# hauling itself over an edge: leaning in, both hands flat on it, wings half open
		p.rot('ctl_cog', (1, 0, 0), 22)
		p.rot('spine_02', (1, 0, 0), 10)
		p.rot('spine_03', (1, 0, 0), 8)
		p.rot('neck_01', (1, 0, 0), -18)
		p.rot('head', (1, 0, 0), -20)
		p.rot('jaw', (1, 0, 0), 8)
		_hands(p, rig_offset, targets, scaled=False)
		p.side('ctl_hand', (0, 0, 1), -78)
		p.locs('ctl_elbow', (0.24, 0.12, 0.10))
		AC.fingers(p, 26, 40, spread=18, thumb=16)
		AC.wings_fold(p, 0.25)
		p.side('wing_01', (1, 0, 0), -24)
		return
	_flying(p, phase)
	if pose == 'fly':
		_hands(p, rig_offset, targets, scaled=True)
		p.side('ctl_hand', (0, 0, 1), -70)
		p.side('ctl_hand', (1, 0, 0), 16)
		p.locs('ctl_elbow', (0.20, 0.06, -0.10))
		AC.fingers(p, 24, 38, spread=14, thumb=12)
	elif pose == 'burst':
		_hands(p, rig_offset, targets, scaled=True)
		p.side('ctl_hand', (1, 0, 0), -90)
		p.side('ctl_hand', (0, 1, 0), -52)
		p.locs('ctl_elbow', (0.16, 0.16, -0.16))
		AC.fingers(p, 30, 46, spread=20, thumb=16)
		p.rot('jaw', (1, 0, 0), 12)
	elif pose == 'carry':
		_hands(p, rig_offset, targets, scaled=False)
		p.side('ctl_hand', (0, 0, 1), -90)
		p.side('ctl_hand', (0, 1, 0), 78)
		p.side('ctl_hand', (1, 0, 0), 28)
		p.locs('ctl_elbow', (0.26, 0.10, 0.02))
		AC.fingers(p, 34, 40, spread=10, thumb=6)
	elif pose == 'hang':
		_hands(p, rig_offset, targets, scaled=False)
		p.side('ctl_hand', (0, 1, 0), 84)
		p.locs('ctl_elbow', (0.24, 0.06, 0.10))
		AC.fingers(p, 44, 56, spread=6, thumb=8)
		p.rot('neck_01', (1, 0, 0), 8)


def build_devil(pose='stand', parent=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0, look=(0.0, 0.0), mood='grin', origin='feet', name='Devil', **over):
	"""Same call as `devil.build_devil`; returns the root empty."""
	root = C.empty(name, parent, loc, [math.radians(a) for a in rot], scale)
	mesh, rig = _append()
	rig.name, mesh.name = name + '_rig', name + '_mesh'
	centre = origin == 'center'
	y, z = OFFSET.get(pose, ((0.0, -0.56), (0.0, 0.0)))[0 if centre else 1]
	rig.parent = root
	rig.location = (0, y, z)
	i = _state['count']
	_state['count'] += 1
	p = AC.Poser(rig)
	_pose(p, pose, PHASES[i % len(PHASES)], Vector(rig.location), over, centre)
	head = over.get('head')
	if head:
		for axis, deg in zip(((1, 0, 0), (0, 1, 0), (0, 0, 1)), head):
			p.rot('neck_01', axis, deg * 0.4)
			p.rot('head', axis, deg * 0.6)
	p.loc('ctl_eyes', (look[0] * 8.0, 0.0, look[1] * 8.0))
	keys = mesh.data.shape_keys.key_blocks if mesh.data.shape_keys else {}
	if mood == 'wide':
		p.rot('jaw', (1, 0, 0), 16)
	elif mood == 'strain':
		p.rot('jaw', (1, 0, 0), 7)
		if 'snarl' in keys:
			keys['snarl'].value = 1.0
	bpy.context.view_layer.update()
	return root
