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

	camera((0, -5.2, 0.72), (0, 0.06, 0.585), lens=128)
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


def _sheet(tiles, out, name, cols):
	from PIL import Image

	ims = [Image.open(p).convert('RGB') for p in tiles]
	w, h = ims[0].size
	rows = (len(ims) + cols - 1) // cols
	sheet = Image.new('RGB', (w * cols, h * rows), (20, 14, 18))
	for i, im in enumerate(ims):
		sheet.paste(im, ((i % cols) * w, (i // cols) * h))
	final = os.path.join(out, name + '.jpg')
	sheet.save(final, quality=90, subsampling=0)
	return final


def action_pose(rig, out, name='action_pose', size=(1600, 1200), samples=64):
	"""The reference's action pose, from the reference's side of the stage."""
	from PIL import Image

	import actions as AC

	AC.apply_action(rig, 'devil.action_pose')
	spin(rig, 0)
	camera((1.55, -3.05, 0.78), (0.02, -0.02, 0.47), lens=84)
	png = render(os.path.join(out, f'_{name}.png'), size[0], size[1], samples)
	AC.clear_action(rig)
	final = os.path.join(out, name + '.jpg')
	Image.open(png).convert('RGB').save(final, quality=92, subsampling=0)
	return final


def wireframe(ob, low, rig, out, name='wireframe', cell=800, samples=32):
	"""The topology: the all-quad full-detail mesh from three sides, and the decimated game mesh."""
	clay = C.mat('wire_clay', (0.50, 0.11, 0.08), rough=0.7)
	ink = C.mat('wire_ink', (0.012, 0.010, 0.010), rough=0.9)
	tiles = []
	views = [(ob, 0, 'full detail, quads'), (ob, 45, ''), (ob, 180, ''), (low, 45, 'game mesh')]
	for mesh, ang, _label in views:
		other = low if mesh is ob else ob
		keep = list(mesh.data.materials)
		mesh.data.materials.clear()
		mesh.data.materials.append(clay)
		mesh.data.materials.append(ink)
		md = mesh.modifiers.new('Wire', 'WIREFRAME')
		md.thickness = 0.0011
		md.use_replace = False
		md.material_offset = 1
		mesh.hide_render, other.hide_render = False, True
		spin(rig, ang)
		camera((0, -5.2, 0.72), (0, 0.06, 0.585), lens=128)
		tiles.append(render(os.path.join(out, f'_{name}_{len(tiles)}.png'), cell, cell, samples, exposure=0.6))
		mesh.modifiers.remove(md)
		mesh.data.materials.clear()
		for m in keep:
			mesh.data.materials.append(m)
	ob.hide_render, low.hide_render = False, True
	spin(rig, 0)
	return _sheet(tiles, out, name, 4)


def rig_sheet(ob, rig, out, name='rig', cell=800, samples=32):
	"""The skeleton and the animator's controls, seen through the body."""
	import controls as CT

	ghost = bpy.data.materials.new('rig_ghost')
	ghost.use_nodes = True
	p = ghost.node_tree.nodes['Principled BSDF']
	p.inputs['Base Color'].default_value = (0.30, 0.07, 0.06, 1)
	p.inputs['Roughness'].default_value = 0.8
	p.inputs['Alpha'].default_value = 0.22
	keep = list(ob.data.materials)
	ob.data.materials.clear()
	ob.data.materials.append(ghost)
	tiles = []
	for bones, controls, ang in ((True, False, 0), (True, True, 0), (True, True, 50), (True, True, 180)):
		spin(rig, 0)
		dbg = CT.debug_geometry(rig, bones=bones, controls=controls)
		for o in dbg:
			if o.parent is None:
				o.parent = rig
		spin(rig, ang)
		camera((0, -5.6, 0.72), (0, 0.06, 0.585), lens=128)
		tiles.append(render(os.path.join(out, f'_{name}_{len(tiles)}.png'), cell, cell, samples, exposure=0.4))
		for o in dbg:
			bpy.data.objects.remove(o, do_unlink=True)
	spin(rig, 0)
	ob.data.materials.clear()
	for m in keep:
		ob.data.materials.append(m)
	return _sheet(tiles, out, name, 4)


def expressions(ob, rig, out, name='expressions', cell=640, samples=40):
	"""The face keys, one at a time: rest, blink, open, snarl."""
	keys = ob.data.shape_keys.key_blocks
	tiles = []
	spin(rig, 25)
	camera((0.0, -1.6, 0.92), (0.0, -0.09, 0.875), 85)
	for key in (None, 'blink', 'open', 'snarl'):
		for k in keys[1:]:
			k.value = 1.0 if k.name == key else 0.0
		tiles.append(render(os.path.join(out, f'_{name}_{key or "rest"}.png'), cell, cell, samples))
	for k in keys[1:]:
		k.value = 0.0
	spin(rig, 0)
	return _sheet(tiles, out, name, 4)


def clips(rig, out, name='clips', cell=640, samples=40):
	"""Frames of the two loops: the fly-flap's down and up strokes, the idle's two ends."""
	import actions as AC

	tiles = []
	spin(rig, 35)
	camera((0, -5.2, 0.80), (0, 0.06, 0.62), lens=110)
	for clip, frame in (('devil.fly_flap', 1), ('devil.fly_flap', 7), ('devil.fly_flap', 13), ('devil.fly_flap', 19), ('devil.idle', 1), ('devil.idle', 37)):
		AC.apply_action(rig, clip, frame)
		tiles.append(render(os.path.join(out, f'_{name}_{len(tiles)}.png'), cell, cell, samples))
	AC.clear_action(rig)
	bpy.context.scene.frame_set(1)
	spin(rig, 0)
	return _sheet(tiles, out, name, 6)


def finals(ob, low, rig, out, draft=False):
	"""The four delivery renders plus the close-up sheet."""
	studio()
	s = 0.5 if draft else 1.0
	samples = 16 if draft else 64
	low.hide_render = True
	return [
		turnaround(rig, out, cell=(int(640 * s), int(640 * s)), samples=samples),
		closeups(rig, out, cell=int(640 * s), samples=samples),
		action_pose(rig, out, size=(int(1600 * s), int(1200 * s)), samples=samples),
		wireframe(ob, low, rig, out, cell=int(800 * s), samples=max(samples // 2, 12)),
		rig_sheet(ob, rig, out, cell=int(800 * s), samples=max(samples // 2, 12)),
		expressions(ob, rig, out, cell=int(640 * s), samples=max(samples * 2 // 3, 12)),
		clips(rig, out, cell=int(640 * s), samples=max(samples * 2 // 3, 12)),
	]


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
