"""fpv_defender.jpg: first person on the dance floor. The Defender's hands hold the mic stand on
the right; a Devil makes off with a mirror ball ahead. The screen centre stays clear for a crosshair.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import common as C  # noqa: E402
import defender as DF  # noqa: E402
import devil as D  # noqa: E402
import stage_club as SC  # noqa: E402
import weapons as W  # noqa: E402


def build():
	C.reset_scene()
	C.set_world((0.004, 0.006, 0.014), 1.0)
	SC.build_club(heat=1.1, meter=0.7, led_strength=1.0, hot_floor=3.2, lasers=False, gate_kw=dict(flames=11, flame_strength=1.5, embers=150))

	# the eye: local -Y is the view direction, +Z is up (the frame defender.fp_arms is built in)
	eye = Vector((3.4, -5.6, 1.62))
	target = Vector((-0.6, 1.5, 2.25))
	view = C.empty('view', loc=eye)
	view.rotation_euler = (target - eye).to_track_quat('-Y', 'Z').to_euler()
	cam_data = bpy.data.cameras.new('Cam')
	cam_data.lens = 19
	cam_data.clip_start = 0.02
	cam_data.clip_end = 300
	cam_data.dof.use_dof = True
	cam_data.dof.focus_distance = 5.0
	cam_data.dof.aperture_fstop = 4.0
	cam = bpy.data.objects.new('Cam', cam_data)
	C.link(cam, view)
	cam.rotation_euler = (math.pi / 2, 0, math.pi)
	bpy.context.scene.camera = cam

	# hands and weapon: low on the right, the stand leaning away, so the centre is free
	rig = C.empty('rig', view, loc=(-0.37, -0.58, -0.31), rot=(math.radians(20), math.radians(-12), math.radians(8)))
	arms = DF.fp_arms(rig, pole_r=0.018, left_z=0.19)
	stand = W.mic_stand(rig)
	stand.location = (0, 0, -0.93)

	# the thief: across the view, left of centre, glancing back
	devils = []
	thief = D.build_devil('hang', loc=(-0.2, -1.5, 2.75), rot=(-10, 6, 12), origin='center', look=(0.012, -0.008), head=(8, 0, 14), name='Thief')
	SC.mirror_ball(0.44, thief, (0.0, -0.16, -0.64))
	devils.append(thief)
	devils.append(D.build_devil('carry', loc=(-3.2, 1.2, 3.4), rot=(-16, 0, -100), origin='center', name='Far'))
	SC.bar_stool(devils[-1], (0, -0.42, -0.42)).rotation_euler = (1.2, 0.2, 0)
	devils.append(D.build_devil('climb', loc=(1.2, -1.85, -0.14), rot=(-12, 0, 35), name='Climber'))
	devils.append(D.build_devil('burst', loc=(1.9, 3.0, 4.2), rot=(-15, 0, 20), origin='center', name='High'))

	lights = [
		C.spot_light((4.5, -7.5, 4.5), (-0.2, -1.5, 2.6), (1.0, 0.85, 0.75), 1900, angle=45, blend=0.8, radius=0.8, name='Key'),
		C.spot_light((-5.5, 4.5, 6.5), (0, -1.5, 2.6), (0.2, 0.8, 1.0), 6000, angle=50, blend=0.7, radius=0.5, name='RimCyan'),
	]
	C.light_only(lights, devils)
	# the player's own hands: lit by a soft light that travels with the view
	hand_lights = [
		C.area_light(eye + Vector((0.3, -0.6, 0.7)), eye + Vector((-0.4, 0.5, -0.2)), (1.0, 0.86, 0.78), 14, size=0.8, name='HandKey'),
		C.area_light(eye + Vector((-1.2, 1.0, 0.2)), eye + Vector((-0.2, 0.4, -0.2)), (1.0, 0.25, 0.1), 22, size=0.8, name='HandGateRim'),
	]
	C.light_only(hand_lights, [rig])
	del arms


if __name__ == '__main__':
	a = C.parse_args('fpv_defender')
	build()
	C.render(a, 1920, 1080, 72, exposure=-0.4)
