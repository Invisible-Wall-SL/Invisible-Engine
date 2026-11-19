"""defender_concepts.jpg: three Defender proposals side by side (design question 14).

Left to right: the librarian-type everyman, the club bouncer, the casino security guard.
`--name defender_<kind>` renders one of them alone, to check a wardrobe.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
import defender as F  # noqa: E402

LINEUP = (('librarian', -1.2, 10, (1.0, 0.45, 0.10)), ('bouncer', 0.0, 0, (0.0, 0.65, 1.0)), ('guard', 1.2, -10, (1.0, 0.10, 0.08)))


def studio():
	C.reset_scene()
	C.set_world_gradient((0.09, 0.08, 0.11), (0.03, 0.025, 0.035), 1.0)
	C.plane('floor', 40, 40, (0, 0, 0), C.painted_mat('studio_floor', (0.05, 0.04, 0.055), (0.03, 0.025, 0.035), rough=0.45, scale=1.2, bump=0.0))
	C.plane('wall', 40, 14, (0, 5.5, 7), C.painted_mat('studio_wall', (0.07, 0.06, 0.08), (0.045, 0.038, 0.055), rough=0.9, scale=0.5, bump=0.0), rot=(math.pi / 2, 0, 0))


def lights(width=3.2):
	t = (0, 0, 1.0)
	C.area_light((-2.4, -4.2, 3.4), t, (1.0, 0.94, 0.88), 950, size=width + 1.5, name='Key')
	C.area_light((3.6, -3.0, 1.2), t, (0.78, 0.85, 1.0), 260, size=4.0, name='Fill')
	C.area_light((3.4, 2.8, 2.6), t, (1.0, 0.55, 0.30), 1500, size=3.0, name='RimWarm')
	C.area_light((-3.4, 2.8, 2.4), t, (0.35, 0.75, 1.0), 1300, size=3.0, name='RimCool')
	# a soft glow on the backdrop behind them, so the silhouettes read
	C.area_light((0, 3.0, 0.4), (0, 5.5, 2.2), (0.45, 0.35, 0.75), 25, size=width + 3, name='Backdrop')


def lineup(args):
	studio()
	for kind, x, yaw, glow in LINEUP:
		F.build_defender(kind, loc=(x, 0, 0), rot=(0, 0, yaw))
		# each one's stage colour on the backdrop behind them: library, club, casino
		C.spot_light((x * 1.25, 1.2, 0.3), (x * 1.3, 5.5, 1.5), glow, 4200, angle=58, blend=1.0, radius=0.6, name='Stage')
	lights()
	C.camera((0, -10.7, 0.86), (0, 0, 0.965), lens=90)
	C.render(args, 1920, 1080, 88, exposure=-0.35)


def single(args, kind):
	studio()
	F.build_defender(kind, rot=(0, 0, 12))
	lights(1.5)
	C.camera((0, -6.2, 0.9), (0, 0, 0.95), lens=70)
	C.render(args, 900, 1200, 64, exposure=-0.35)


if __name__ == '__main__':
	a = C.parse_args('defender_concepts')
	if a.name.startswith('defender_') and a.name[9:] in F.SPECS:
		single(a, a.name[9:])
	else:
		lineup(a)
