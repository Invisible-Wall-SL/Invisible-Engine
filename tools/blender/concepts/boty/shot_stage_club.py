"""stage_club.jpg: the whole Dance Club from above the bar; the mirror balls are the Devils' loot."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
import devil as D  # noqa: E402
import stage_club as SC  # noqa: E402


def build():
	C.reset_scene()
	C.set_world((0.004, 0.006, 0.014), 1.0)
	club = SC.build_club(heat=1.1, meter=0.45, led_strength=0.9, hot_floor=3.4, lasers=False, gate_kw=dict(flames=10, flame_strength=1.4, embers=140))

	devils = []
	# two Devils at the mirror balls, where no Defender can follow
	balls = sorted(club['balls'], key=lambda b: (b[0] + 1.5) ** 2 + (b[1] + 1.5) ** 2)
	bx, by, bz, br = balls[0]
	devils.append(D.build_devil('hang', loc=(bx, by + 0.12, bz + br + 0.22), rot=(-5, 0, -30), origin='center', name='AtBall'))
	thief = D.build_devil('hang', loc=(3.3, -5.4, 3.3), rot=(-14, 6, 55), origin='center', name='BallThief')
	devils.append(thief)
	SC.mirror_ball(0.42, thief, (0.0, -0.16, -0.62))
	# two share a speaker, on their way to the Gate
	sp = C.empty('speaker_team', loc=(3.6, -0.8, 2.6), rot=(0, 0, 2.2))
	devils.append(D.build_devil('hang', parent=sp, loc=(-0.42, 0, 0), rot=(-8, 0, 20), origin='center', name='TeamA'))
	devils.append(D.build_devil('hang', parent=sp, loc=(0.42, 0, 0), rot=(-8, 0, -20), origin='center', name='TeamB'))
	SC.speaker(sp, (0, 0.1, -1.42), (0, 0, 0.2), (1.0, 0.7, 1.15))
	# a stool from the bar and a crate of bottles
	st = D.build_devil('carry', loc=(-5.0, -3.4, 1.9), rot=(-18, 0, -115), origin='center', name='StoolThief')
	devils.append(st)
	stool = SC.bar_stool(st, (0, -0.42, -0.42))
	stool.rotation_euler = (1.2, 0.2, 0.0)
	cr = D.build_devil('carry', loc=(-3.1, -5.6, 1.5), rot=(-16, 0, -150), origin='center', name='CrateThief')
	devils.append(cr)
	SC.bottle_crate(cr, (0, -0.36, -0.22), (0.25, 0, 0))
	# one has just fed the Gate
	devils.append(D.build_devil('burst', loc=(0.9, 0.5, 2.9), rot=(-12, 0, -150), origin='center', name='Cheer'))
	fall = SC.bar_stool(None, (0.3, 0.1, 0.9))
	fall.rotation_euler = (2.2, 0.5, 0.4)
	devils.append(D.build_devil('climb', loc=(-1.2, -1.75, -0.14), rot=(-12, 0, -150), name='Climber'))

	lights = [
		C.area_light((6.0, -12.0, 6.0), (0, -1.0, 2.5), (1.0, 0.85, 0.75), 3600, size=6.0, name='Fill'),
		C.spot_light((-6.0, 5.0, 7.0), (0, -1.0, 2.5), (0.2, 0.8, 1.0), 9000, angle=70, blend=0.7, radius=0.6, name='RimCyan'),
	]
	C.light_only(lights, devils)
	C.camera((6.6, -9.4, 2.9), (-1.2, 1.2, 2.9), lens=19)
	return club


if __name__ == '__main__':
	a = C.parse_args('stage_club')
	build()
	C.render(a, 1920, 1080, 72, exposure=-0.4)
