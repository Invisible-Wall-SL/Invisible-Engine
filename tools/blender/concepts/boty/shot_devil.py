"""devil_3d.png (transparent hero render) and devil_turnaround.jpg (front, three-quarter, back)."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
import devil as D  # noqa: E402


def studio(transparent):
	C.reset_scene()
	C.set_world_gradient((0.10, 0.07, 0.09), (0.035, 0.02, 0.03), 1.0)
	if not transparent:
		floor = C.plane('floor', 40, 40, (0, 0, 0), C.mat('studio_floor', (0.045, 0.03, 0.04), rough=0.55))
		floor.is_shadow_catcher = False
		bm_wall = C.plane('wall', 40, 12, (0, 6, 6), C.mat('studio_wall', (0.05, 0.03, 0.045), rough=0.9), rot=(math.pi / 2, 0, 0))
		del bm_wall


def lights(target=(0, 0, 0.7)):
	C.area_light((-1.6, -2.6, 2.3), target, (1.0, 0.93, 0.86), 230, size=2.2, name='Key')
	C.area_light((2.6, -1.6, 1.0), target, (0.80, 0.86, 1.0), 60, size=2.5, name='Fill')
	C.area_light((1.9, 2.2, 2.0), target, (1.0, 0.55, 0.35), 380, size=1.2, name='RimWarm')
	C.area_light((-2.2, 2.0, 1.6), target, (0.45, 0.75, 1.0), 300, size=1.2, name='RimCool')
	C.area_light((0, -1.0, -0.6), target, (1.0, 0.35, 0.25), 60, size=2.0, name='Bounce')


def hero(args):
	studio(True)
	D.build_devil('stand', rot=(0, 0, -8))
	lights()
	C.camera((0.15, -2.42, 0.74), (0.0, 0, 0.635), lens=52)
	C.render(args, 1400, 1600, 96, exposure=-0.15, fmt='PNG', transparent=True)


def turnaround(args):
	studio(False)
	for x, yaw in ((-1.42, 0), (0.0, -42), (1.42, 180)):
		D.build_devil('stand', loc=(x, 0, 0), rot=(0, 0, yaw))
	C.area_light((-2.0, -3.4, 2.6), (0, 0, 0.7), (1.0, 0.93, 0.86), 560, size=4.5, name='Key')
	C.area_light((3.4, -2.4, 1.0), (0, 0, 0.7), (0.80, 0.86, 1.0), 150, size=4.0, name='Fill')
	C.area_light((3.0, 2.6, 2.2), (0, 0, 0.7), (1.0, 0.55, 0.35), 1300, size=3.0, name='RimWarm')
	C.area_light((-3.0, 2.6, 2.0), (0, 0, 0.7), (0.45, 0.75, 1.0), 1100, size=3.0, name='RimCool')
	C.camera((0, -11.5, 0.9), (0, 0, 0.68), lens=95)
	C.render(args, 1920, 1080, 80, exposure=-0.15)


if __name__ == '__main__':
	a = C.parse_args('devil_3d')
	if a.name == 'devil_turnaround':
		turnaround(a)
	else:
		hero(a)
