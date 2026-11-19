"""storyboard_1..3.jpg: the match intro. `--name storyboard_2` picks the frame.

1. An establishing flight over the club.  2. The floor cracks.  3. The Devils burst out.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
import devil as D  # noqa: E402
import stage_club as SC  # noqa: E402


def frame_1():
	"""The camera glides in under the mirror balls; the floor is still whole and green."""
	SC.build_club(gate=False, led_strength=1.0, meter=0.0)
	cam = C.camera((7.4, -11.4, 6.3), (-1.2, 2.5, 1.6), lens=19)
	C.look_at(cam, (-1.2, 2.5, 1.6), roll=math.radians(-7))
	return 0.1


def frame_2():
	"""The middle of the dance floor splits: the first glow of the Gate."""
	SC.build_club(
		heat=0.9, meter=0.0, gate_radius=0.75, gate_seed=9, hot_floor=3.0, led_strength=1.0, lasers=False,
		gate_kw=dict(flames=3, flame_strength=1.4, flame_size=0.9, cracks=13, crack_len=(5.0, 11.0), slabs=11, embers=60, pillar=True),
	)
	cam = C.camera((2.6, -4.6, 0.95), (-0.2, 0.2, 0.75), lens=24)
	C.look_at(cam, (-0.2, 0.2, 0.75), roll=math.radians(5))
	return -0.4


def frame_3():
	"""Seen from above the rim: the lava pit, and the Devils coming up out of it at the camera."""
	SC.build_club(heat=0.8, meter=0.0, led_strength=1.0, hot_floor=3.4, lasers=False, gate_kw=dict(flames=9, flame_strength=1.9, embers=200))
	D.build_devil('burst', loc=(-1.25, -1.9, 2.5), rot=(-52, 8, -32), origin='center', look=(0.0, 0.012), name='A')
	D.build_devil('fly', loc=(0.6, -0.9, 1.5), rot=(-58, -8, -20), origin='center', look=(0.0, 0.012), name='B')
	D.build_devil('burst', loc=(0.9, 0.9, 2.9), rot=(-45, 10, -55), origin='center', name='C')
	D.build_devil('fly', loc=(-1.0, 0.7, 0.9), rot=(-60, 0, -40), origin='center', name='D')
	D.build_devil('burst', loc=(1.9, -0.6, 0.5), rot=(-50, 0, -10), origin='center', name='E')
	D.build_devil('climb', loc=(-1.75, 0.95, -0.15), rot=(-10, 0, -120), name='F')
	C.spot_light((-5.0, -6.0, 7.0), (0, -0.5, 2.0), (1.0, 0.85, 0.75), 4200, angle=40, blend=0.8, radius=0.8, name='Key')
	C.spot_light((5.5, 4.5, 6.5), (0, 0, 2.2), (0.2, 0.8, 1.0), 6000, angle=50, blend=0.7, radius=0.5, name='RimCyan')
	cam = C.camera((-3.3, -4.6, 5.3), (0.25, 0.1, 0.95), lens=20)
	C.look_at(cam, (0.25, 0.1, 0.95), roll=math.radians(-8))
	return -0.45


if __name__ == '__main__':
	a = C.parse_args('storyboard_1')
	C.reset_scene()
	C.set_world((0.004, 0.006, 0.014), 1.0)
	exposure = {'1': frame_1, '2': frame_2, '3': frame_3}[a.name.split('_')[1][0]]()
	C.render(a, 1280, 720, 64, exposure=exposure)
