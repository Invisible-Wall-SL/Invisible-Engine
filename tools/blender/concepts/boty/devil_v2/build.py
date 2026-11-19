"""Devil v2: build everything and save `CH_devil.blend`.

`python build.py --out <dir> [--size 2048] [--no-bake] [--renders] [--draft]`

Cage → one subdivision → extras and wings → `RIG_ie_devil` → weights → UVs → procedural skin baked to
three packed images → shape keys → `CH_devil_LODU` (all quads, full detail) and a decimated
`CH_devil_LOD0` inside the hero budget → sockets → controls → actions → validator report → GLB.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
for p in (HERE, os.path.dirname(HERE), TOOLS):
	if p not in sys.path:
		sys.path.insert(0, p)

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import actions as AC  # noqa: E402
import assemble as A  # noqa: E402
import common as C  # noqa: E402
import controls as CT  # noqa: E402
import material as M  # noqa: E402
import rig as R  # noqa: E402
import shapekeys as SKEY  # noqa: E402
import uv as UV  # noqa: E402

LODU, LOD0 = 'CH_devil_LODU', 'CH_devil_LOD0'
LOD0_TRIS = 19400
SOCKETS = {
	# name: (bone, where it sits in the rest pose)
	'SK_hand_l': ('hand_l', (0.520, -0.004, 0.650)),
	'SK_hand_r': ('hand_r', (-0.520, -0.004, 0.650)),
	'SK_carry': ('spine_03', (0.0, 0.105, 0.640)),
	'SK_head': ('head', (0.0, -0.010, 1.010)),
}


def tris(ob):
	return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def socket(name, rig, bone, world):
	"""An empty parented to a bone; a bone-parented object sits relative to the bone's TAIL."""
	emp = bpy.data.objects.new(name, None)
	bpy.context.scene.collection.objects.link(emp)
	emp.empty_display_type = 'ARROWS'
	emp.empty_display_size = 0.04
	emp.parent = rig
	emp.parent_type = 'BONE'
	emp.parent_bone = bone
	b = rig.data.bones[bone]
	frame = b.matrix_local @ Matrix.Translation((0, b.length, 0))
	emp.location = frame.inverted() @ Vector(world)
	return emp


def lod0(src, deform):
	"""The game mesh: the full-detail mesh decimated into the hero budget, weights re-limited."""
	import ie_export

	ob = ie_export.decimated_copy(src, LOD0, LOD0_TRIS)
	ob.data.name = LOD0
	if ob.data.shape_keys:
		ob.shape_key_clear()
	A.clean_weights(ob, deform)
	for name in [a.name for a in ob.data.attributes if a.name.startswith('m_')]:
		ob.data.attributes.remove(ob.data.attributes[name])
	return ob


def build(size=2048, bake=True, log=print):
	t0 = time.monotonic()
	C.reset_scene()
	scene = bpy.context.scene
	scene.render.fps = AC.FPS
	ob, d, info = A.build(on_cage=UV.mark_cage)
	ob.name = ob.data.name = LODU
	rig = R.build_armature(d, info.get('wing'))
	R.bind(ob, rig)
	deform = R.deform_names(rig)
	worst = A.clean_weights(ob, deform)
	M.paint_masks(ob)
	report = {'tris': {LODU: tris(ob)}, 'deform_bones': len(deform), 'influences_before_limit': worst, 'cage': {'extras': info.get('extras_check'), 'wings': info.get('wing_check')}}
	log(f'mesh {tris(ob)} tris, {len(deform)} deform bones  [{time.monotonic() - t0:.0f}s]')

	report['uv'] = UV.unwrap(ob, size)
	log(f"uv {report['uv']['islands']} islands, coverage {report['uv']['coverage']}, padding {report['uv']['padding_pixels']} px  [{time.monotonic() - t0:.0f}s]")
	if bake:
		images = M.bake(ob, size)
		ob.data.materials.clear()
		ob.data.materials.append(M.baked(images))
		log(f'baked 3 x {size}px  [{time.monotonic() - t0:.0f}s]')
	else:
		ob.data.materials.clear()
		ob.data.materials.append(M.procedural())

	low = lod0(ob, deform)
	report['tris'][LOD0] = tris(low)
	report['shape_keys'] = SKEY.add(ob, d, rig)
	for name, (bone, world) in SOCKETS.items():
		socket(name, rig, bone, world)
	ctl = CT.add_controls(rig, d, info)
	report['actions'] = [a.name for a in AC.build_actions(rig, ob, ctl) or []] or [a.name for a in bpy.data.actions]
	AC.clear_action(rig)
	log(f"LOD0 {report['tris'][LOD0]} tris, keys {report['shape_keys']}, actions {report['actions']}  [{time.monotonic() - t0:.0f}s]")
	return ob, low, rig, d, info, report


def save(path):
	for img in bpy.data.images:
		if img.name.startswith('T_devil') and not img.packed_file:
			img.pack()
	bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path), compress=True)
	return os.path.getsize(path)


def validate(out):
	import ie_validate

	rep = ie_validate.validate('asset')
	with open(os.path.join(out, 'validate.json'), 'w', encoding='utf-8') as fh:
		json.dump(rep, fh, indent=2)
	return rep


def export(out, report):
	import ie_export

	result = ie_export.export_all(out, generate=False, only='CH_devil', force=False)
	with open(os.path.join(out, 'export.json'), 'w', encoding='utf-8') as fh:
		json.dump({k: v for k, v in result.items() if k != 'report'}, fh, indent=2)
	return result


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument('--out', default='.')
	ap.add_argument('--size', type=int, default=2048)
	ap.add_argument('--no-bake', action='store_true')
	ap.add_argument('--renders', action='store_true')
	ap.add_argument('--draft', action='store_true')
	a = ap.parse_args(sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else sys.argv[1:])
	os.makedirs(a.out, exist_ok=True)
	ob, low, rig, _d, _info, report = build(a.size, not a.no_bake)
	rep = validate(a.out)
	import ie_validate

	print(ie_validate.summary(rep))
	report['validator_ok'] = rep.get('ok')
	blend = os.path.join(a.out, 'CH_devil.blend')
	report['blend_bytes'] = save(blend)
	result = export(a.out, rep)
	report['glb'] = [{'glb': os.path.basename(e['glb']), 'bytes': e['bytes']} for e in result['exported']]
	with open(os.path.join(a.out, 'build.json'), 'w', encoding='utf-8') as fh:
		json.dump(report, fh, indent=2, default=str)
	print('BUILD', json.dumps({k: report[k] for k in ('tris', 'deform_bones', 'validator_ok', 'blend_bytes', 'glb')}, default=str))
	if a.renders:
		import shots

		low.hide_render = True
		for path in shots.finals(ob, low, rig, a.out, draft=a.draft):
			print('WROTE', path)


if __name__ == '__main__':
	main()
