"""stage_library.jpg: the Library, the Gate in the reading-room floor, Devils carrying off a globe and books."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
import devil as D  # noqa: E402
import stage_library as L  # noqa: E402


def facing(frm, to):
	"""The yaw (degrees) that turns a Devil at `frm` to face `to` (a Devil faces -Y at yaw 0)."""
	return math.degrees(math.atan2(to[0] - frm[0], -(to[1] - frm[1])))


def devils(cam):
	# the hero: a globe hugged against its belly, hovering over the Gate's edge
	p = (4.02, -4.2, 2.3)
	d = D.build_devil('carry', loc=p, rot=(-10, 4, facing(p, cam) - 24), origin='center', look=(0.006, 0.0), name='DevilGlobe', wing=(0, -34, 8), hand_l=(0.195, -0.29, 0.37), hand_r=(-0.195, -0.29, 0.37))
	L.globe('carried_globe', 0.19, (0, -0.31, 0.36 - 0.45), (0.5, 0.2, 0.4), d, stand=False)

	# a stack of books, coming in from the far side
	p = (-2.9, 1.3, 2.75)
	d2 = D.build_devil('carry', loc=p, rot=(-16, -6, facing(p, cam) + 14), origin='center', look=(-0.006, -0.004), name='DevilBooks')
	L.book_stack('carried_books', 5, 11, (0, -0.30, 0.30 - 0.45), (0.25, 0, 0.3), d2, size=(0.26, 0.34, 0.06))

	# a chair dangling from both hands, high up
	p = (-0.9, 3.9, 4.7)
	d3 = D.build_devil('hang', loc=p, rot=(-8, 0, facing(p, cam) + 6), origin='center', name='DevilChair')
	L.chair('carried_chair', (0.0, -0.12, 0.26 - 0.45 - 0.99), (0.12, 0.1, 0.5), d3)

	# one climbing out over the rim, toward the camera
	a = math.radians(-58)
	p = (math.cos(a) * 1.55, math.sin(a) * 1.55, -0.34)
	D.build_devil('climb', loc=p, rot=(-14, 0, facing(p, cam) + 8), look=(0.004, 0.006), name='DevilClimb')

	# one bursting out of the middle
	p = (-0.7, 0.9, 3.05)
	D.build_devil('burst', loc=p, rot=(-18, 6, facing(p, cam) - 12), origin='center', mood='wide', name='DevilBurst')

	# far ones: up at the mezzanine shelves
	p = (4.6, 5.2, 6.0)
	d6 = D.build_devil('carry', loc=p, rot=(-12, 0, facing(p, (0, 0, 0)) - 20), origin='center', name='DevilFar', mood='wide')
	L.book_stack('carried_books', 3, 4, (0, -0.30, 0.30 - 0.45), (0.2, 0, 0.2), d6, size=(0.26, 0.34, 0.06))
	p = (-6.2, 5.6, 6.3)
	d7 = D.build_devil('fly', loc=p, rot=(-25, 0, facing(p, (0, 0, 0)) + 10), origin='center', name='DevilFar2')
	L.book('carried_book', (0.24, 0.32, 0.06), 6, (0.24, -0.30, 0.60 - 0.45), (0.9, 0.2, 0.3), d7)

	# books and pages thrown at the Gate
	r = C.rng(5)
	for i in range(9):
		a = r.random() * 6.28
		dd = r.random() * 1.4
		L.book('thrown', (0.22, 0.3, 0.05 + r.random() * 0.03), int(r.integers(0, 10)), (math.cos(a) * dd, math.sin(a) * dd, 0.3 + r.random() * 2.6), tuple(r.random(3) * 6))
	L.open_book('thrown_open', (0.9, -0.9, 1.25), (0.9, 0.5, 0.3), None, 3, 1.25)
	L.open_book('thrown_open', (-1.0, -0.3, 0.9), (2.2, 0.3, 1.3), None, 0, 1.25)
	L.loose_pages((0, 0, 0), 30, 9, 2.4, 0.3, 4.6)


def main():
	args = C.parse_args('stage_library')
	C.reset_scene()
	L.build_library()
	L.lights()
	cam = (4.7, -6.5, 2.75)
	devils(cam)
	# a soft front fill so the Devils' faces read against the windows
	C.area_light((3.2, -7.4, 2.8), (1.5, -2.0, 1.8), (1.0, 0.92, 0.82), 320, size=3.5, name='FaceFill')
	C.point_light((0.0, 0.0, 0.6), (1.0, 0.06, 0.02), 1300, radius=0.8, name='GateRed')
	C.camera(cam, (-0.35, 0.9, 2.45), lens=18.5)
	C.render(args, 1920, 1080, 88, exposure=-0.5)


if __name__ == '__main__':
	main()
