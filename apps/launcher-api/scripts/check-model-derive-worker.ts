/**
 * The model derive runs OFF the event loop (asset review #4; `src/lib/server/modelDeriveRunner.ts`):
 *
 *   1. the worker bundle builds (`vite.model-worker.config.ts` → `build/model-derive-worker.mjs`);
 *   2. a derive through the worker gives the same GLB and textures, byte for byte, as in-process;
 *   3. while the worker derives, the main thread keeps its timers: the longest gap stays under
 *      250 ms (in-process, one KTX2 encode alone holds the thread for seconds — printed for scale);
 *   4. the texture cache crosses the thread boundary: a second derive encodes nothing;
 *   5. a derive that fails in the worker rejects with its reason, and the next derive still works;
 *   6. the derived-tier cache key follows the built derive code: a changed worker bundle is a new key
 *      (a launcher deploy that changes a derive's output never serves an older build's tiers);
 *   7. a derive past its timeout is stopped (its worker terminated) and the next derive works.
 *
 *   pnpm --filter launcher-api check:model-derive-worker
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { MODEL_CLASS_DEFAULTS } from 'constants-shared/modelTiers';
import { deriveModelTier, type ModelDeriveOptions } from '../src/lib/server/modelOptimize';
import { derivedTierKey } from '../src/lib/server/modelDerivedCache';
import { deriveModelTierOffThread } from '../src/lib/server/modelDeriveRunner';
import { buildMasterGlb } from './lib/modelFixtures';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (!ok) failures += 1;
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

const root = resolve(import.meta.dirname, '..');
const bundle = resolve(root, 'build/model-derive-worker.mjs');
console.log('1. the worker bundle');
const built = spawnSync('pnpm -s build:model-worker', {
	cwd: root,
	shell: true,
	encoding: 'utf8',
});
check(
	'vite builds build/model-derive-worker.mjs',
	built.status === 0 && existsSync(bundle),
	built.stderr,
);

/** Run `fn` while sampling the event loop every 10 ms; returns its result and the longest gap. */
async function withLag<T>(fn: () => Promise<T>): Promise<{ value: T; lagMs: number }> {
	let last = performance.now();
	let lagMs = 0;
	const timer = setInterval(() => {
		const now = performance.now();
		lagMs = Math.max(lagMs, now - last - 10);
		last = now;
	}, 10);
	try {
		return { value: await fn(), lagMs };
	} finally {
		clearInterval(timer);
	}
}

const master = await buildMasterGlb({
	id: 'PR_worker',
	textureSide: 1024,
	normal: true,
	orm: true,
	levels: [{ level: 0, segments: 60 }],
});
const opts = (cache?: ModelDeriveOptions['cache']): ModelDeriveOptions => ({
	tier: 'full',
	profile: MODEL_CLASS_DEFAULTS.prop.tiers,
	lodGenerate: MODEL_CLASS_DEFAULTS.prop.lodGenerate,
	...(cache ? { cache } : {}),
});
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

console.log('2–3. in-process vs the worker');
delete process.env.MODEL_DERIVE_WORKER;
const inline = await withLag(() => deriveModelTier(master, opts()));
console.log(`      in-process: longest event-loop gap ${Math.round(inline.lagMs)} ms`);
process.env.MODEL_DERIVE_WORKER = bundle;
const off = await withLag(() => deriveModelTierOffThread(master, opts()));
console.log(`      worker:     longest event-loop gap ${Math.round(off.lagMs)} ms`);
check(
	'the worker derives the same GLB and textures, byte for byte',
	same(off.value.glb, inline.value.glb) &&
		off.value.textures.length === inline.value.textures.length &&
		off.value.textures.every(
			(t, i) =>
				t.uri === inline.value.textures[i].uri && same(t.bytes, inline.value.textures[i].bytes),
		),
);
check(
	'while the worker derives, the main thread never stalls 250 ms',
	off.lagMs < 250,
	`${Math.round(off.lagMs)} ms`,
);

console.log('4. the texture cache across the thread boundary');
const store = new Map<string, Uint8Array>();
let puts = 0;
const cache = {
	get: async (k: string) => store.get(k) ?? null,
	put: async (k: string, b: Uint8Array) => {
		puts += 1;
		store.set(k, b);
	},
};
const first = await deriveModelTierOffThread(master, opts(cache));
const putsAfterFirst = puts;
const second = await deriveModelTierOffThread(master, opts(cache));
check(
	'the first derive fills the cache through the worker',
	putsAfterFirst > 0,
	`${putsAfterFirst} puts`,
);
check(
	'the second derive encodes nothing and gives the same bytes',
	puts === putsAfterFirst && same(first.glb, second.glb),
	`${puts - putsAfterFirst} new puts`,
);

console.log('5. a failing derive');
const corrupt = await buildMasterGlb({
	id: 'PR_bad',
	textureSide: 256,
	corruptBase: true,
	levels: [{ level: 0, segments: 20 }],
});
let reason = '';
try {
	await deriveModelTierOffThread(corrupt, opts());
} catch (e) {
	reason = (e as Error).message;
}
check(
	'it rejects with the derive’s own reason',
	reason.length > 0 && !reason.includes('exited'),
	reason,
);
const after = await deriveModelTierOffThread(master, opts());
check('the next derive still works', same(after.glb, inline.value.glb));

console.log('6. the cache key follows the derive code');
const keyNow = () =>
	derivedTierKey({
		sourceSha256: 'a'.repeat(64),
		tier: 'half',
		profile: MODEL_CLASS_DEFAULTS.prop.tiers,
		lodGenerate: MODEL_CLASS_DEFAULTS.prop.lodGenerate,
	});
const k1 = keyNow();
const changed = resolve(mkdtempSync(resolve(tmpdir(), 'model-worker-')), 'model-derive-worker.mjs');
copyFileSync(bundle, changed);
appendFileSync(changed, '\n// another build\n');
process.env.MODEL_DERIVE_WORKER = changed;
const k2 = keyNow();
process.env.MODEL_DERIVE_WORKER = bundle;
check('a changed worker bundle gives the tier a new cache key', k1 !== k2 && keyNow() === k1);

console.log('7. a derive past its timeout');
process.env.MODEL_DERIVE_TIMEOUT_MS = '50';
let timedOut = '';
try {
	await deriveModelTierOffThread(master, opts());
} catch (e) {
	timedOut = (e as Error).message;
}
delete process.env.MODEL_DERIVE_TIMEOUT_MS;
check(
	'it is stopped and rejects, naming the timeout',
	timedOut.includes('did not finish'),
	timedOut,
);
const recovered = await deriveModelTierOffThread(master, opts());
check('the next derive gets a fresh worker and works', same(recovered.glb, inline.value.glb));

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall model-derive-worker checks passed');
process.exit(failures ? 1 : 0);
