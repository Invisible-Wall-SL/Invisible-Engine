/**
 * Contract check for the /comfyui volume model manager:
 *   pnpm --filter launcher-api check:volume-models
 *
 * Runs the real `src/lib/volumeModels.ts` and the manifest mutators in
 * `src/lib/server/modelManifest.ts`. Pinned: only real model files under `ComfyUI/models/<folder>/`
 * are listed (no S3 staging parts, no folder markers, no root files); a blueprint's uses come from
 * both `models[]` and its graph, matched on the in-folder path whatever folder alias it names; a
 * delete is refused until EVERY using blueprint is named and a Keep is acknowledged; upload
 * targets cannot escape the models tree; the manifest entry for a mirror key has the seeder's
 * `dir`/`name` split, and the `volume: false` flag round-trips.
 */
import {
	blueprintModelNames,
	deleteRefusal,
	groupByFolder,
	mirrorKey,
	monthlyUsd,
	toVolumeFile,
	uploadTargetError,
	usesOf,
	type ModelRow,
} from '../src/lib/volumeModels';
import {
	entryFor,
	removeEntry,
	setOnVolume,
	upsertEntry,
	type ManifestEntry,
} from '../src/lib/server/modelManifest';

let checks = 0;
let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	process.stderr.write(`FAIL ${name}\n  expected ${e}\n  actual   ${a}\n`);
}

const obj = (key: string, size = 10) => ({ key, size, modified: null });

check('a lora is listed', toVolumeFile(obj('ComfyUI/models/loras/a.safetensors')), {
	key: 'ComfyUI/models/loras/a.safetensors',
	size: 10,
	modified: null,
	folder: 'loras',
	path: 'a.safetensors',
});
check(
	'a nested path keeps its subfolder',
	toVolumeFile(obj('ComfyUI/models/checkpoints/sdxl/b.ckpt'))?.path,
	'sdxl/b.ckpt',
);
check('a folder marker is not a file', toVolumeFile(obj('ComfyUI/models/loras/')), null);
check(
	'S3 upload staging is not a model',
	toVolumeFile(obj('ComfyUI/models/loras/.s3compat_uploads/x/1.safetensors')),
	null,
);
check('a file at the models root has no folder', toVolumeFile(obj('ComfyUI/models/x.pt')), null);
check('a README is not a model', toVolumeFile(obj('ComfyUI/models/loras/README.md')), null);
check('custom_nodes is outside the tree', toVolumeFile(obj('ComfyUI/custom_nodes/a.pt')), null);
check(
	'mirror key follows the seeder layout',
	mirrorKey({ folder: 'loras', path: 'sub/a.safetensors' }),
	'comfyui-models/loras/sub/a.safetensors',
);

const names = blueprintModelNames(
	{ name: 'X', models: [{ filename: 'flux1-dev-fp8.safetensors', save_path: 'unet' }] },
	{
		'1': { class_type: 'LoraLoader', inputs: { lora_name: 'styles\\comic.safetensors' } },
		'2': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['1', 1] } },
		'3': { class_type: 'SaveImage', inputs: { filename_prefix: 'out' } },
	},
);
check('names from models[] and the graph', [...names].sort(), [
	'flux1-dev-fp8.safetensors',
	'styles/comic.safetensors',
]);
const bps = [{ use: { id: 'bp1', name: 'Comic', kind: 'image' }, names }];
check(
	'matched under a folder alias the graph never names',
	usesOf({ path: 'flux1-dev-fp8.safetensors' }, bps).map((b) => b.id),
	['bp1'],
);
check(
	'matched on a nested in-folder path',
	usesOf({ path: 'styles/comic.safetensors' }, bps).length,
	1,
);
check('an unrelated file is unused', usesOf({ path: 'other.safetensors' }, bps).length, 0);

const used = {
	usedBy: [
		{ id: 'a', name: 'A', kind: 'image' },
		{ id: 'b', name: 'B', kind: 'video' },
	],
	keep: null,
};
check(
	'a used file needs every blueprint named',
	deleteRefusal(used, { blueprints: ['a'], keep: false })?.includes('B'),
	true,
);
check(
	'naming all of them passes',
	deleteRefusal(used, { blueprints: ['b', 'a'], keep: false }),
	null,
);
const kept = { usedBy: [], keep: { key: 'k', note: 'trial' } };
check(
	'a Keep needs acknowledging',
	deleteRefusal(kept, { blueprints: [], keep: false }) !== null,
	true,
);
check('acknowledged Keep passes', deleteRefusal(kept, { blueprints: [], keep: true }), null);
check(
	'an unused file needs nothing',
	deleteRefusal({ usedBy: [], keep: null }, { blueprints: [], keep: false }),
	null,
);

check('a plain target is fine', uploadTargetError('loras', 'my-style.safetensors'), null);
check('dot-dot is refused', uploadTargetError('loras', '../x.safetensors') !== null, true);
check('a hidden file is refused', uploadTargetError('loras', '.x.safetensors') !== null, true);
check('a backslash is refused', uploadTargetError('loras', 'a\\b.safetensors') !== null, true);
check('a bad folder is refused', uploadTargetError('../etc', 'a.safetensors') !== null, true);
check('a non-model is refused', uploadTargetError('loras', 'a.txt') !== null, true);

const row = (folder: string, path: string, size: number): ModelRow => ({
	key: `ComfyUI/models/${folder}/${path}`,
	size,
	modified: null,
	folder,
	path,
	usedBy: [],
	keep: null,
	mirror: null,
});
const groups = groupByFolder([
	row('loras', 'a', 1),
	row('checkpoints', 'b', 9),
	row('loras', 'c', 5),
]);
check(
	'biggest folder first',
	groups.map((g) => [g.folder, g.bytes]),
	[
		['checkpoints', 9],
		['loras', 6],
	],
);
check(
	'biggest file first',
	groups[1].files.map((f) => f.path),
	['c', 'a'],
);
check('400 GB at $0.07', monthlyUsd(400e9).toFixed(2), '28.00');

check('entry splits dir and name', entryFor('comfyui-models/loras/sub/a.safetensors', 5, 'h'), {
	key: 'comfyui-models/loras/sub/a.safetensors',
	dir: 'loras/sub',
	name: 'a.safetensors',
	size: 5,
	sha256: 'h',
});
const models: ManifestEntry[] = [entryFor('comfyui-models/loras/a.safetensors', 1, 'x')];
check('mark off the volume', setOnVolume(models[0].key, false)(models) && models[0].volume, false);
check(
	'back on the volume drops the flag',
	setOnVolume(models[0].key, true)(models) && 'volume' in models[0],
	false,
);
check('an unknown key writes nothing', setOnVolume('comfyui-models/x', false)(models), false);
upsertEntry({ ...models[0], sha256: 'y' })(models);
check('upsert replaces in place', [models.length, models[0].sha256], [1, 'y']);
check('remove', removeEntry(models[0].key)(models) && models.length, 0);

process.stdout.write(`${checks - failures}/${checks} volume-models checks passed\n`);
if (failures) process.exit(1);
