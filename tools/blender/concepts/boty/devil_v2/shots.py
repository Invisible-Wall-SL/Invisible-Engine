"""Devil v2: the studio and the renders (turnaround, close-ups, action pose, wireframe, rig).

`python shots.py --out <dir> --shot look|turnaround|closeups [--draft]` builds the model in memory
with the procedural material; `--blend <CH_devil.blend>` renders the saved file instead.
"""

from __future__ import annotations

import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import common as C  # noqa: E402

ANGLES = (0, 45, 90, 135, 180, 225, 270, 315)
LABELS = ('0° (FRONT)', '45°', '90° (RIGHT)', '135°', '180° (BACK)', '225°', '270° (LEFT)', '315°')


def studio():
	"""The reference's look: a dark warm backdrop, a soft key, two rims, a red glow on the floor."""
	C.set_world((0.012, 0.008, 0.012), 1.0)
	floor = C.plane('floor', 30, 30, (0, 0, -0.001), C.mat('studio_floor', (0.016, 0.009, 0.011), rough=0.75))
	wall = C.plane('wall', 30, 14, (0, 7, 7), C.mat('studio_wall', (0.020, 0.012, 0.017), rough=0.95), rot=(math.pi / 2, 0, 0))
	lights = [
		C.area_light((-2.2, -3.6, 2.6), (0, 0, 0.62), (1.0, 0.94, 0.88), 300, size=2.6, name='Key'),
		C.area_light((3.0, -2.4, 1.0), (0, 0, 0.6), (1.0, 0.72, 0.62), 70, size=3.0, name='Fill'),
		C.area_light((2.4, 2.6, 2.2), (0, 0, 0.7), (1.0, 0.55, 0.40), 420, size=1.6, name='RimWarm'),
		C.area_light((-2.6, 2.4, 1.8), (0, 0, 0.7), (1.0, 0.62, 0.55), 340, size=1.6, name='RimLeft'),
		C.spot_light((0, -0.4, 3.0), (0, 0.1, 0.0), (1.0, 0.22, 0.10), 160, angle=38, blend=1.0, radius=0.4, name='FloorGlow'),
	]
	return [floor, wall] + lights


def camera(pos, target, lens=70):
	for o in [o for o in bpy.context.scene.objects if o.type == 'CAMERA']:
		bpy.data.objects.remove(o, do_unlink=True)
	return C.camera(pos, target, lens=lens)


def render(path, width, height, samples, exposure=-0.2):
	scene = bpy.context.scene
	scene.render.resolution_x, scene.render.resolution_y = width, height
	scene.cycles.samples = samples
	scene.view_settings.view_transform = 'AgX'
	scene.view_settings.look = 'AgX - Punchy'
	scene.view_settings.exposure = exposure
	scene.render.image_settings.file_format = 'PNG'
	scene.render.filepath = path
	bpy.ops.render.render(write_still=True)
	return path


def spin(root, angle):
	"""Turn the model as the reference turntable does: the 90° view shows it facing image-left."""
	root.rotation_euler = (0, 0, -math.radians(angle))
	bpy.context.view_layer.update()


def turnaround(root, out, name='turnaround', cell=(640, 640), samples=48, labels=True):
	from PIL import Image, ImageDraw

	camera((0, -5.2, 0.74), (0, 0.06, 0.60), lens=100)
	tiles = []
	for ang in ANGLES:
		spin(root, ang)
		tiles.append(render(os.path.join(out, f'_{name}_{ang:03d}.png'), cell[0], cell[1], samples))
	spin(root, 0)
	pad = 44 if labels else 0
	sheet = Image.new('RGB', (cell[0] * 4, (cell[1] + pad) * 2), (20, 14, 18))
	draw = ImageDraw.Draw(sheet)
	for i, p in enumerate(tiles):
		x, y = (i % 4) * cell[0], (i // 4) * (cell[1] + pad)
		sheet.paste(Image.open(p).convert('RGB'), (x, y))
		if labels:
			draw.text((x + cell[0] // 2, y + cell[1] + pad // 2), LABELS[i], fill=(225, 215, 215), anchor='mm', font_size=24)
	final = os.path.join(out, name + '.jpg')
	sheet.save(final, quality=90, subsampling=0)
	return final


def closeups(root, out, name='closeups', cell=640, samples=40):
	"""Face, hand, backside, foot: the places the owner asked to match."""
	from PIL import Image

	views = [
		('face', 0, (0.0, -1.55, 0.92), (0.0, -0.1, 0.885), 85),
		('face34', 40, (0.0, -1.6, 0.93), (0.0, -0.08, 0.885), 85),
		('profile', 90, (0.0, -1.9, 0.90), (0.0, -0.02, 0.87), 85),
		('hand_top', 0, (0.56, -0.9, 1.25), (0.545, 0.0, 0.66), 85),
		('hand_palm', 0, (0.62, -0.75, 0.20), (0.545, 0.0, 0.66), 85),
		('back', 180, (0.0, -1.5, 0.52), (0.0, 0.0, 0.46), 85),
		('back34', 135, (0.0, -1.5, 0.55), (0.0, 0.0, 0.46), 85),
		('foot', 35, (0.0, -1.1, 0.42), (0.0, -0.02, 0.07), 85),
	]
	tiles = []
	for key, ang, pos, target, lens in views:
		spin(root, ang)
		if key.startswith('hand') or key == 'foot':
			# these aim at a point on the model, which moves with the turntable
			a = -math.radians(ang)
			t = Vector((target[0] * math.cos(a) - target[1] * math.sin(a), target[0] * math.sin(a) + target[1] * math.cos(a), target[2]))
			off = Vector(pos) - Vector(target)
			camera(tuple(t + off), tuple(t), lens)
		else:
			camera(pos, target, lens)
		tiles.append(render(os.path.join(out, f'_{name}_{key}.png'), cell, cell, samples))
	spin(root, 0)
	sheet = Image.new('RGB', (cell * 4, cell * 2), (20, 14, 18))
	for i, p in enumerate(tiles):
		sheet.paste(Image.open(p).convert('RGB'), ((i % 4) * cell, (i // 4) * cell))
	final = os.path.join(out, name + '.jpg')
	sheet.save(final, quality=90, subsampling=0)
	return final


def build_in_memory(wings=True):
	import assemble as A
	import material as M
	import rig as R

	ob, d, info = A.build(wings=wings)
	rig = R.build_armature(d, info.get('wing'))
	R.bind(ob, rig)
	A.clean_weights(ob, R.deform_names(rig))
	try:
		import shapekeys as SKEY

		SKEY.add(ob, d, rig)
	except ImportError:
		pass
	M.paint_masks(ob)
	ob.data.materials.clear()
	ob.data.materials.append(M.procedural())
	return ob, rig, d, info


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument('--out', default='.')
	ap.add_argument('--shot', default='look')
	ap.add_argument('--draft', action='store_true')
	ap.add_argument('--blend', default='')
	a = ap.parse_args(sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else sys.argv[1:])
	os.makedirs(a.out, exist_ok=True)
	C.reset_scene()
	if a.blend:
		with bpy.data.libraries.load(a.blend) as (src, dst):
			dst.objects = [n for n in src.objects if n.startswith(('CH_devil_LODU', 'RIG_'))]
		for o in dst.objects:
			bpy.context.scene.collection.objects.link(o)
		rig = next(o for o in dst.objects if o.type == 'ARMATURE')
	else:
		_ob, rig, _d, _info = build_in_memory()
	studio()
	s = 0.5 if a.draft else 1.0
	samples = 16 if a.draft else 56
	if a.shot in ('look', 'turnaround'):
		print('WROTE', turnaround(rig, a.out, cell=(int(640 * s), int(640 * s)), samples=samples))
	if a.shot in ('look', 'closeups'):
		print('WROTE', closeups(rig, a.out, cell=int(640 * s), samples=samples))


if __name__ == '__main__':
	main()
