"""Quick clay views of the cage while modelling: `python preview.py --out <dir> [--views 0,90] [--levels 2]`.

Writes `<out>/cage_<angle>.png` (orthographic, same framing every time) and prints the mesh checks.
"""

import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import bpy  # noqa: E402

import cage as CG  # noqa: E402
import common as C  # noqa: E402


def clay():
	return C.mat('clay', (0.62, 0.12, 0.09), rough=0.6, sss=0.15)


MM_PER_PX = 0.00112
REF = os.path.join(HERE, '..', '..', '..', '..', '..', 'docs', 'design', '3d', 'boty', 'devil-v2', 'refs', 'turnaround-8-views.webp')


def compare(render_path, ang, span, cz, out):
	"""Reference | reference with our outline | ours, at the same scale and ground line."""
	import numpy as np
	from PIL import Image, ImageFilter

	ref = Image.open(REF).convert('RGB')
	i = (ang // 45) % 8
	cw, ch = ref.width / 4, ref.height / 2
	cell = ref.crop((int((i % 4) * cw), int((i // 4) * ch), int((i % 4 + 1) * cw), int((i // 4 + 1) * ch) - 70))
	cell = cell.resize((cell.width * 3, cell.height * 3), Image.LANCZOS)
	mine = Image.open(render_path).convert('RGBA')
	half = mine.width / 2
	cx_ref = 655 if ang in (90, 270) else 675
	off = (round(cx_ref - half), round(1075 - (half + cz / MM_PER_PX)))
	layer = Image.new('RGBA', cell.size, (0, 0, 0, 0))
	layer.paste(mine, off)
	alpha = np.asarray(layer.getchannel('A')).astype(np.float32) / 255
	edge = np.asarray(layer.getchannel('A').filter(ImageFilter.FIND_EDGES)).astype(np.float32) / 255
	base = np.asarray(cell).astype(np.float32)
	over = base.copy()
	over[edge > 0.25] = (0, 255, 255)
	dark = Image.new('RGB', cell.size, (38, 38, 44))
	ours = Image.composite(layer.convert('RGB'), dark, layer.getchannel('A'))
	del alpha
	sheet = Image.new('RGB', (cell.width * 3, cell.height), (0, 0, 0))
	sheet.paste(cell, (0, 0))
	sheet.paste(Image.fromarray(over.astype(np.uint8)), (cell.width, 0))
	sheet.paste(ours, (cell.width * 2, 0))
	sheet = sheet.resize((sheet.width // 2, sheet.height // 2), Image.LANCZOS)
	sheet.save(out, quality=88)
	print('WROTE', out)


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument('--out', default='.')
	ap.add_argument('--views', default='0,45,90,180')
	ap.add_argument('--levels', type=int, default=2)
	ap.add_argument('--res', type=int, default=700)
	ap.add_argument('--zoom', default='')  # "x,z,span" in metres: a close-up window
	ap.add_argument('--wire', action='store_true')
	ap.add_argument('--compare', action='store_true', help='overlay each view on the reference turnaround')
	a = ap.parse_args(sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else sys.argv[1:])
	C.reset_scene()
	C.set_world((0.05, 0.05, 0.06), 1.0)
	d = CG.Devil().build()
	print('verts', len(d.m.co), 'quads', len(d.m.faces), 'open/nonmanifold edges', d.m.check(), 'symmetry error', round(d.symmetry_error(), 6))
	ob = d.m.to_object('cage')
	C.link(ob)
	ob.data.materials.append(clay())
	if a.levels:
		C.subsurf(ob, a.levels)
	if a.wire:
		w = ob.modifiers.new('Wire', 'WIREFRAME')
		w.thickness = 0.0012
		w.use_replace = False
		w.material_offset = 1
		ob.data.materials.append(C.mat('wire', (0.02, 0.02, 0.02), rough=0.8))
	scene = bpy.context.scene
	scene.cycles.samples = 24
	scene.view_settings.view_transform = 'Standard'
	scene.view_settings.look = 'None'
	scene.view_settings.exposure = 0
	os.makedirs(a.out, exist_ok=True)
	span, cx, cz = 1.6, 0.0, 0.58
	if a.zoom:
		cx, cz, span = (float(v) for v in a.zoom.split(','))
	for ang in (int(v) for v in a.views.split(',')):
		for o in [o for o in scene.objects if o.type in ('LIGHT', 'CAMERA')]:
			bpy.data.objects.remove(o, do_unlink=True)
		th = math.radians(ang)
		# the turntable turns the model clockwise from above; here the camera goes the other way
		pos = (math.sin(th) * 6, -math.cos(th) * 6, cz)
		right = (math.cos(th), math.sin(th), 0)
		cam = C.camera((pos[0] + right[0] * cx, pos[1] + right[1] * cx, cz), (right[0] * cx, right[1] * cx, cz), lens=50)
		cam.data.type = 'ORTHO'
		cam.data.ortho_scale = span
		for dx, dz, col, power in ((-3, 4, (1, 0.96, 0.9), 900), (4, 1, (0.7, 0.8, 1.0), 300), (0, 3, (1, 0.6, 0.5), 500)):
			lp = (pos[0] * 0.8 + right[0] * dx, pos[1] * 0.8 + right[1] * dx, cz + dz) if dx or dz != 3 else (-pos[0] * 0.6, -pos[1] * 0.6, cz + dz)
			C.area_light(lp, (0, 0, cz), col, power, size=3.0)
		scene.render.resolution_x = a.res
		scene.render.resolution_y = a.res
		scene.render.filepath = os.path.join(a.out, f'cage_{ang:03d}.png')
		if a.compare:
			# the reference cells, enlarged 3x, are 1.12 mm per pixel
			scene.render.resolution_x = scene.render.resolution_y = round(span / MM_PER_PX)
			scene.render.film_transparent = True
			scene.render.image_settings.color_mode = 'RGBA'
		bpy.ops.render.render(write_still=True)
		print('WROTE', scene.render.filepath)
		if a.compare:
			compare(scene.render.filepath, ang, span, cz, os.path.join(a.out, f'cmp_{ang:03d}.jpg'))


if __name__ == '__main__':
	main()
