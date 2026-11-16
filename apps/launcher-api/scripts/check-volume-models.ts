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
 * `dir`/`name` split, and the `volume: false` flag round-trips. The delete guards fail CLOSED
 * (no key or an unreadable pod → 503; no endpoint → needs an explicit confirmation); a delete or
 * Keep target cannot carry `..`; Add-from-URL pins the checked address at connect time, refuses
 * the 6to4 / Teredo ranges, caps its size, and times out on silence, not on total duration.
 */
import {
	MAX_TRANSFER_BYTES,
	actionTarget,
	blueprintModelNames,
	deleteRefusal,
	fleetSettingError,
	healthJobs,
	podGuardRefusal,
	renderGuardRefusal,
	transferCeiling,
	transferSizeError,
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
import { isPrivateComfyHost } from '../src/lib/server/comfyRegister';
import {
	openPublicDownload,
	pinnedLookup,
	publicUrlError,
	withIdleTimeout,
} from '../src/lib/server/publicDownload';
import type { LookupAddress } from 'node:dns';

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
	actionable: true,
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

// --- Delete / Keep targets: no traversal -------------------------------------------------
check(
	'a real but unsafe name is listed, not actionable',
	[
		!!toVolumeFile(obj('ComfyUI/models/loras/[fp8] x.safetensors')),
		actionTarget('ComfyUI/models/loras/[fp8] x.safetensors'),
	],
	[true, null],
);
check(
	'a plain file is an action target',
	actionTarget('ComfyUI/models/loras/a.safetensors')?.path,
	'a.safetensors',
);
check(
	'dot-dot is not an action target (it would dodge the used-by check)',
	actionTarget('ComfyUI/models/loras/../../../x.safetensors'),
	null,
);
check(
	'a single dot-dot is refused too',
	actionTarget('ComfyUI/models/loras/../a.safetensors'),
	null,
);
check('a dot segment is refused', actionTarget('ComfyUI/models/loras/./a.safetensors'), null);
check('a hidden file is refused', actionTarget('ComfyUI/models/loras/.a.safetensors'), null);
check('an empty segment is refused', actionTarget('ComfyUI/models/loras//a.safetensors'), null);
check('a backslash is refused', actionTarget('ComfyUI/models/loras/..\\a.safetensors'), null);

// --- Pod guard fails closed --------------------------------------------------------------
const pod = (label: string, status: string) => ({ label, status });
check('no API key → 503', podGuardRefusal([pod('A', 'stopped')], false)?.status, 503);
check('no API key and no fleet → still 503', podGuardRefusal([], false)?.status, 503);
check(
	'a pod reading unknown → 503',
	podGuardRefusal([pod('A', 'stopped'), pod('B', 'unknown')], true)?.status,
	503,
);
check(
	'and it names the pod',
	podGuardRefusal([pod('B', 'unknown')], true)?.message.includes('B'),
	true,
);
check(
	'unknown wins over running',
	podGuardRefusal([pod('A', 'running'), pod('B', 'unknown')], true)?.status,
	503,
);
check('a running pod → 409', podGuardRefusal([pod('A', 'running')], true)?.status, 409);
check('a starting pod → 409', podGuardRefusal([pod('A', 'starting')], true)?.status, 409);
check(
	'every pod stopped passes',
	podGuardRefusal([pod('A', 'stopped'), pod('B', 'stopped')], true),
	null,
);

// --- Render guard ------------------------------------------------------------------------
check('a /health with no jobs could not tell', healthJobs({ workers: {} }), null);
check('a non-object /health could not tell', healthJobs(null), null);
check('jobs are summed', healthJobs({ jobs: { inQueue: 2, inProgress: 1 } }), 3);
check('an idle endpoint reads 0', healthJobs({ jobs: { inQueue: 0, inProgress: 0 } }), 0);
check('a garbled count could not tell', healthJobs({ jobs: { inQueue: 'x' } }), null);
check('an empty jobs object could not tell', healthJobs({ jobs: {} }), null);
check('renamed fields could not tell', healthJobs({ jobs: { in_queue: 3 } }), null);
check('one known field is enough', healthJobs({ jobs: { inProgress: 2 } }), 2);

check('no fleet setting is fine (legacy / none)', fleetSettingError(undefined), null);
check('an empty fleet list is fine', fleetSettingError('[]'), null);
check('a fleet list is fine', fleetSettingError('[{"id":"p1"}]'), null);
check('a garbled fleet setting refuses', fleetSettingError('{oops') !== null, true);
check('a non-array fleet setting refuses', fleetSettingError('{"id":"p1"}') !== null, true);
check(
	'unconfigured endpoint refuses without confirmation',
	renderGuardRefusal({ endpointConfigured: false, jobs: null, confirmNoRenderCheck: false })
		?.status,
	409,
);
check(
	'unconfigured endpoint passes once confirmed',
	renderGuardRefusal({ endpointConfigured: false, jobs: null, confirmNoRenderCheck: true }),
	null,
);
check(
	'a configured endpoint that cannot tell → 503, confirmation or not',
	renderGuardRefusal({ endpointConfigured: true, jobs: null, confirmNoRenderCheck: true })?.status,
	503,
);
check(
	'jobs in flight → 409',
	renderGuardRefusal({ endpointConfigured: true, jobs: 1, confirmNoRenderCheck: true })?.status,
	409,
);
check(
	'an idle endpoint passes',
	renderGuardRefusal({ endpointConfigured: true, jobs: 0, confirmNoRenderCheck: false }),
	null,
);

// --- Transfer size cap -------------------------------------------------------------------
check('unknown free space → the ceiling', transferCeiling(null), MAX_TRANSFER_BYTES);
check('free space below the ceiling caps it', transferCeiling(5e9), 5e9);
check('free space above the ceiling is capped', transferCeiling(1e15), MAX_TRANSFER_BYTES);
check('a full volume caps at 0', transferCeiling(-3), 0);
check('under the cap passes', transferSizeError(4e9, 5e9), null);
check('over the cap is refused', transferSizeError(5e9 + 1, 5e9) !== null, true);

// --- SSRF ---------------------------------------------------------------------------------
for (const host of ['[2002:a00:1::]', '[2001:0:a00:1::1]', '[::ffff:10.0.0.1]', '[fd00::1]']) {
	check(`${host} is private`, isPrivateComfyHost(host), true);
}
check('a public IPv6 is not', isPrivateComfyHost('[2606:4700::1111]'), false);
check(
	'a public 2001: address outside Teredo is not',
	isPrivateComfyHost('[2001:4860::8888]'),
	false,
);
check('http is refused', publicUrlError('http://example.com/a.safetensors') !== null, true);
check('credentials are refused', publicUrlError('https://u:p@example.com/a') !== null, true);
check('a private literal is refused', publicUrlError('https://127.0.0.1/a') !== null, true);
check('a 6to4 literal is refused', publicUrlError('https://[2002:7f00:1::]/a') !== null, true);
check('a public URL passes', publicUrlError('https://huggingface.co/a.safetensors'), null);

const fakeDns =
	(addrs: LookupAddress[]) =>
	(_h: string, cb: (e: NodeJS.ErrnoException | null, a: LookupAddress[]) => void) =>
		cb(null, addrs);
function runLookup(
	addrs: LookupAddress[],
	all: boolean,
): Promise<{ err: string | null; out: unknown }> {
	return new Promise((resolve) => {
		pinnedLookup(fakeDns(addrs))('host.example', { all }, (err, address, family) =>
			resolve({ err: err ? err.message : null, out: all ? address : [address, family] }),
		);
	});
}

// --- Async checks (the lookup pin and the idle timeout) ----------------------------------
async function asyncChecks(): Promise<void> {
	const pub = { address: '93.184.216.34', family: 4 };
	const priv = { address: '10.0.0.5', family: 4 };
	check('a public address connects', (await runLookup([pub], false)).out, ['93.184.216.34', 4]);
	check('all: true gets the list', (await runLookup([pub], true)).out, [pub]);
	check(
		'a rebinding answer (private) is refused at connect time',
		(await runLookup([priv], false)).err?.includes('private'),
		true,
	);
	check(
		'one private address among public ones refuses',
		(await runLookup([pub, priv], true)).err !== null,
		true,
	);
	check(
		'a 6to4 address is refused at connect time',
		(await runLookup([{ address: '2002:a00:1::', family: 6 }], false)).err !== null,
		true,
	);

	// The pin is the request's own lookup: a host that resolves private never gets a socket.
	let pinned = '';
	try {
		await openPublicDownload('https://models.example/x.safetensors', {
			lookup: pinnedLookup(fakeDns([priv])),
			headersMs: 2_000,
		});
	} catch (e) {
		pinned = e instanceof Error ? e.message : String(e);
	}
	check('a real request refuses a host resolving private', pinned.includes('private'), true);

	const chunk = new Uint8Array(4);
	const steady = (n: number, everyMs: number) =>
		new ReadableStream<Uint8Array>({
			async pull(c) {
				if (n-- <= 0) return c.close();
				await new Promise((r) => setTimeout(r, everyMs));
				c.enqueue(chunk);
			},
		});
	// 12 chunks 20 ms apart = 240 ms total, far past the 60 ms idle limit — and still fine.
	let read = 0;
	const r1 = withIdleTimeout(steady(12, 20), 60).getReader();
	for (;;) {
		const { done } = await r1.read();
		if (done) break;
		read++;
	}
	check('a long download that keeps sending is not cut off', read, 12);

	// A slow consumer is not a stall: the timer runs only while a read waits on the source.
	const r2 = withIdleTimeout(steady(3, 1), 30).getReader();
	let slow = 0;
	let slowErr: unknown = null;
	try {
		for (;;) {
			const { done } = await r2.read();
			if (done) break;
			slow++;
			await new Promise((r) => setTimeout(r, 80));
		}
	} catch (e) {
		slowErr = e;
	}
	check('a slow consumer does not trip the idle timeout', [slow, slowErr], [3, null]);

	const stalled = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
	let stallErr = '';
	try {
		await withIdleTimeout(stalled, 30).getReader().read();
	} catch (e) {
		stallErr = e instanceof Error ? e.message : String(e);
	}
	check('a stalled source errors after the idle timeout', stallErr.includes('stalled'), true);
}

await asyncChecks();

process.stdout.write(`${checks - failures}/${checks} volume-models checks passed\n`);
if (failures) process.exit(1);
