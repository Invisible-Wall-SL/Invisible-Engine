"""key_art.jpg: Devils burst out of the Hell Gate in the middle of the Dance Club's LED floor."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
import devil as D  # noqa: E402
import stage_club as SC  # noqa: E402


def build():
	C.reset_scene()
	C.set_world((0.004, 0.006, 0.014), 1.0)
	club = SC.build_club(heat=1.25, meter=0.6, lasers=False, led_strength=1.0, hot_floor=3.2, gate_kw=dict(flames=13, flame_strength=1.5, flame_size=1.15, embers=180))

	# the hero: bursting up and out toward the camera
	devils = []
	# (Devil v2 is lankier with a smaller head than the chibi one, so its hero comes closer to read)
	hx, hy, hz = (0.0, -4.1, 1.85) if C.DEVIL == 'v1' else (0.5, -5.15, 1.72)
	devils.append(D.build_devil('burst', loc=(hx, hy, hz), rot=(-9, 8, 18), origin='center', look=(0.004, -0.01), head=(13, 0, -6), name='Hero'))
	# climbing over the rim, front right; another just surfacing
	devils.append(D.build_devil('climb', loc=(1.95, -1.7, -0.14), rot=(-14, 0, 24), look=(-0.012, 0.004), name='Climber'))
	devils.append(D.build_devil('climb', loc=(-1.75, -0.95, -0.62), rot=(-8, 0, -30), look=(0.012, 0.01), name='Surfacing'))
	# two more on the way up behind
	devils.append(D.build_devil('fly', loc=(-4.5, 0.8, 1.55), rot=(-25, -12, -40), origin='center', look=(0.01, 0.0), name='FlyL'))
	devils.append(D.build_devil('burst', loc=(2.5, 1.0, 3.7), rot=(-18, 10, 26), origin='center', name='FlyR'))
	# one already tearing a mirror ball away, top left
	thief = D.build_devil('hang', loc=(-0.4, 3.6, 5.9), rot=(-6, 8, 8), origin='center', name='Thief')
	devils.append(thief)
	SC.mirror_ball(0.42, thief, (0.0, -0.16, -0.62))
	# one flying off with a speaker, right
	carrier = D.build_devil('hang', loc=(4.7, 0.6, 3.0), rot=(-10, -6, 48), origin='center', name='Carrier')
	devils.append(carrier)
	SC.speaker(carrier, (0.0, -0.05, -1.0), (0.2, 0.1, 0.3), (0.5, 0.42, 0.72))

	lights = []
	# so the faces read: a soft warm key from the camera side, cool rims from the club
	lights.append(C.spot_light((-2.2, -7.5, 3.6), (hx, hy, hz + 0.15), (1.0, 0.82, 0.7), 1700, angle=40, blend=0.8, radius=0.8, name='HeroKey'))
	lights.append(C.spot_light((5.5, 3.5, 6.5), (0, -3.5, 2.0), (0.2, 0.8, 1.0), 6500, angle=50, blend=0.7, radius=0.5, name='RimCyan'))
	lights.append(C.spot_light((-6.0, 3.0, 6.0), (0, -3.5, 2.0), (0.75, 0.2, 1.0), 4200, angle=50, blend=0.7, radius=0.5, name='RimViolet'))
	lights.append(C.spot_light((-1.6, -1.2, 4.6), (hx, hy, hz + 0.5), (0.3, 0.85, 1.0), 5200, angle=30, blend=0.6, radius=0.3, name='HeroRim'))
	lights.append(C.spot_light((2.6, -1.6, 4.2), (hx, hy, hz + 0.5), (1.0, 0.35, 0.8), 1500, angle=30, blend=0.6, radius=0.3, name='HeroKick'))
	C.light_only(lights, devils)
	C.camera((1.7, -6.9, 1.15), (0.25, 0.3, 2.45), lens=21)
	return club


if __name__ == '__main__':
	a = C.parse_args('key_art')
	build()
	C.render(a, 1920, 1080, 72, exposure=-0.3)
