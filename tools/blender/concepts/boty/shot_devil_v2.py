"""devil_v2_hero.png and devil_v2_turnaround.jpg: the rigged Devil v2 for the deck's Devil slides.

`--name devil_v2_turnaround` renders the three views; the default is the hero in the action pose on
a transparent background. Both use `docs/design/3d/boty/devil-v2/CH_devil.blend`.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
import devil as D  # noqa: E402
import shot_devil as SD  # noqa: E402


def hero(args):
	SD.studio(True)
	D.build_devil('action', rot=(0, 0, -24))
	SD.lights((0, -0.1, 0.5))
	C.camera((0.25, -3.9, 0.92), (0.03, -0.08, 0.52), lens=132)
	C.render(args, 1400, 1600, 96, exposure=-0.15, fmt='PNG', transparent=True)


def turnaround(args):
	SD.studio(False)
	for x, yaw in ((-1.55, 0), (0.0, -42), (1.55, 180)):
		D.build_devil('stand', loc=(x, 0, 0), rot=(0, 0, yaw))
	C.area_light((-2.0, -3.4, 2.6), (0, 0, 0.7), (1.0, 0.93, 0.86), 560, size=4.5, name='Key')
	C.area_light((3.4, -2.4, 1.0), (0, 0, 0.7), (1.0, 0.80, 0.70), 150, size=4.0, name='Fill')
	C.area_light((3.0, 2.6, 2.2), (0, 0, 0.7), (1.0, 0.55, 0.35), 1300, size=3.0, name='RimWarm')
	C.area_light((-3.0, 2.6, 2.0), (0, 0, 0.7), (0.45, 0.75, 1.0), 1100, size=3.0, name='RimCool')
	C.camera((0, -11.5, 0.9), (0, 0, 0.60), lens=95)
	C.render(args, 1920, 1080, 80, exposure=-0.15)


if __name__ == '__main__':
	a = C.parse_args('devil_v2_hero')
	C.DEVIL = 'v2'
	if a.name == 'devil_v2_turnaround':
		turnaround(a)
	else:
		hero(a)
