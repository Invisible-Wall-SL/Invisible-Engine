/**
 * Contract check for BAKED effects' server chain (`docs/design/invisible-fx.md` §"Baked effects"):
 *
 *   1. THE UPLOAD — `/api/fx/bake/upload-url` is `fx`-gated, refuses an unsaved effect, a malformed
 *      hash and a tab on another project, and signs a PUT for the page at
 *      `fx-bakes/<id>/fxbake_<id>_<hash>.png`.
 *   2. THE SHEET — `/api/fx/bake` refuses a layout that does not fit and a page that never arrived,
 *      writes the TexturePacker JSON beside the page, and that JSON reads back through the REAL
 *      `loadRegionSet` (the reader the editor-art export ships every effect atlas through) as one
 *      region per frame, on that page.
 *   3. SAVE AND DELETE — Save prunes every bake of the effect but the one the saved doc names; Delete
 *      drops them all.
 *   4. THE EXPORT — the real `exportEffects` ships a current, enabled bake (and lists its sheet in
 *      `referencedAssetKeys`, the bake's dangling-art guard), strips a stale one (named in
 *      `staleBakes`) and a disabled one, and leaves an effect without a bake byte-identical.
 *
 * `r2.ts` is an in-memory bucket; the tool gate is stubbed. Run:
 *
 *   pnpm --filter launcher-api check:fx-bake
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { effectBakeHash, normalizeEffectDoc, type EffectDoc } from 'engine-fx';

let failures = 0;
let checks = 0;
const json = (value: unknown): string => JSON.stringify(value);
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	if (json(actual) === json(expected)) return;
	failures += 1;
	console.log(
		`FAIL  ${label}\n        expected ${json(expected)}\n        actual   ${json(actual)}`,
	);
};

const src = (rel: string): string => new URL(`../src/${rel}`, import.meta.url).href;

function exportNames(rel: string): string[] {
	const text = readFileSync(fileURLToPath(src(rel)), 'utf8');
	const names = new Set<string>();
	for (const m of text.matchAll(/^export (?:async )?(?:function\*?|class|const|let) (\w+)/gm)) {
		names.add(m[1]);
	}
	return [...names];
}

function fake(rel: string, impl: Record<string, unknown>): void {
	const namedExports: Record<string, unknown> = {};
	for (const name of exportNames(rel)) {
		namedExports[name] =
			name in impl
				? impl[name]
				: () => {
						throw new Error(`fixture: ${rel} ${name} is not faked`);
					};
	}
	for (const name of Object.keys(impl)) {
		if (!(name in namedExports)) throw new Error(`fixture: ${rel} has no export ${name}`);
	}
	mock.module(src(rel), { namedExports });
}

// ── In-memory R2 ───────────────────────────────────────────────────────────────────────────────
type Obj = { body: string; etag: string };
const R2 = new Map<string, Obj>();
let etagSeq = 0;
const keysUnder = (prefix: string): string[] =>
	[...R2.keys()].filter((key) => key.startsWith(prefix)).sort();
class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`Conditional write failed for ${key}`);
		this.name = 'ConflictError';
	}
}
type Cond = { ifMatch?: string; ifNoneMatch?: string };
function put(key: string, body: string, cond?: Cond): string {
	const current = R2.get(key);
	if (cond?.ifNoneMatch && current) throw new ConflictError(key);
	if (cond?.ifMatch && current?.etag !== cond.ifMatch) throw new ConflictError(key);
	const etag = `"e${++etagSeq}"`;
	R2.set(key, { body, etag });
	return etag;
}
const signed: string[] = [];
fake('lib/server/r2.ts', {
	ConflictError,
	precondition: (base: string | null | undefined) =>
		base === undefined ? undefined : base === null ? { ifNoneMatch: '*' } : { ifMatch: base },
	jsonBaseEtag: (v: unknown) => (v === null ? null : typeof v === 'string' ? v : undefined),
	getObjectText: async (key: string) => R2.get(key)?.body ?? null,
	getObjectTextWithEtag: async (key: string) => {
		const o = R2.get(key);
		return o ? { text: o.body, etag: o.etag } : null;
	},
	putObjectText: async (key: string, text: string, _type: string, cond?: Cond) =>
		put(key, text, cond),
	deleteObject: async (key: string) => void R2.delete(key),
	deleteObjects: async (keys: string[]) => keys.forEach((key) => R2.delete(key)),
	listAllKeys: async (prefix: string) => keysUnder(prefix),
	objectExists: async (key: string) => R2.has(key),
	listObjects: async (prefix: string) => {
		const keys: string[] = [];
		const prefixes = new Set<string>();
		for (const key of keysUnder(prefix)) {
			const slash = key.indexOf('/', prefix.length);
			if (slash < 0) keys.push(key);
			else prefixes.add(key.slice(0, slash + 1));
		}
		return { keys, prefixes: [...prefixes] };
	},
	headObject: async (key: string) =>
		R2.has(key)
			? { etag: R2.get(key)!.etag, size: R2.get(key)!.body.length, lastModified: 1 }
			: null,
	listAllObjects: async (prefix: string) =>
		keysUnder(prefix).map((key) => ({ key, size: R2.get(key)!.body.length, lastModified: 1 })),
	presignPut: async (key: string, contentType: string) => {
		signed.push(`${key} ${contentType}`);
		return `https://r2.test/${key}?signed`;
	},
});

const CLIENT = 'acme';
const PROJECT = 'pots';
const gates: string[] = [];
let sessionProject = PROJECT;
fake('lib/server/toolScope.ts', {
	gate: async (_locals: unknown, _cookies: unknown, opts: { tool: string }) => {
		gates.push(opts.tool);
		return {
			clientKey: CLIENT,
			projectKey: sessionProject,
			prefixes: [`${CLIENT}/${sessionProject}/`],
		};
	},
	assertAllowed: (key: string, prefixes: string[]) => {
		if (!prefixes.some((p) => key.startsWith(p))) throw Object.assign(new Error(), { status: 403 });
	},
});

const { fxDocKey, fxBakePrefix, SUB } = await import('../src/lib/server/projectPaths.ts');
const { saveEffect, deleteEffect } = await import('../src/lib/server/fxStorage.ts');
const { exportEffects } = await import('../src/lib/server/effectExport.ts');
const { loadRegionSet } = await import('../src/lib/server/editorRegions.ts');
const uploadRoute = await import('../src/routes/api/fx/bake/upload-url/+server.ts');
const bakeRoute = await import('../src/routes/api/fx/bake/+server.ts');

type Handler = (event: never) => Promise<Response>;
const call = async (handler: unknown, body: unknown) => {
	const url = new URL('https://launcher.test/api/fx/bake');
	const request = new Request(url, { method: 'POST', body: JSON.stringify(body) });
	try {
		const res = await (handler as Handler)({ url, request, locals: {}, cookies: {} } as never);
		return { status: res.status, body: (await res.json()) as Record<string, unknown> };
	} catch (e) {
		const status = (e as { status?: number }).status;
		if (typeof status === 'number') return { status, body: {} };
		throw e;
	}
};

const layer = (frequency = 0.008) => ({
	key: 'spark',
	config: {
		lifetime: { min: 0.4, max: 1.2 },
		frequency,
		emitterLifetime: -1,
		maxParticles: 1000,
		pos: { x: 0, y: 0 },
		addAtBack: false,
		behaviors: [{ type: 'blendMode', config: { blendMode: 'add' } }],
	},
	art: { assetKey: `${CLIENT}/${PROJECT}/manifests/fx.json`, frames: ['Spark_Mini'] },
	placement: { space: 'free' },
	particleKind: 'sprite',
});
const BAKE = { enabled: true, fps: 24, loopSeconds: 2, scale: 0.5, seam: 'crossfade' };
const HASH_A = '0000000a';
const HASH_B = '0000000b';
const PLAN = { cellW: 60, cellH: 70, gap: 2, cols: 2, rows: 2, width: 122, height: 142 };
const bakeDir = fxBakePrefix(CLIENT, PROJECT, 'firecracker');

// ── 1. The upload ──────────────────────────────────────────────────────────────────────────────
console.log('1. the upload');
{
	const ok = await call(uploadRoute.POST, { effectId: 'firecracker', hash: HASH_A });
	check('the upload is fx-gated', gates.at(-1), 'fx');
	check('it answers 200', ok.status, 200);
	check(
		'it signs the page under fx-bakes/<id>/',
		ok.body.key,
		`${bakeDir}fxbake_firecracker_${HASH_A}.png`,
	);
	check('as a PNG', signed.at(-1), `${bakeDir}fxbake_firecracker_${HASH_A}.png image/png`);
	check(
		'an unsaved effect is refused',
		(await call(uploadRoute.POST, { effectId: 'untitled-effect', hash: HASH_A })).status,
		400,
	);
	check(
		'a malformed hash is refused',
		(await call(uploadRoute.POST, { effectId: 'firecracker', hash: '../x' })).status,
		400,
	);
	const other = await call(uploadRoute.POST, {
		effectId: 'firecracker',
		hash: HASH_A,
		projectKey: 'elsewhere',
	});
	check(
		'a tab on another project is refused',
		[other.status, other.body.error],
		[409, 'scope-mismatch'],
	);
}

// ── 2. The sheet ───────────────────────────────────────────────────────────────────────────────
console.log('2. the sheet');
{
	const body = { effectId: 'firecracker', hash: HASH_A, frames: 4, plan: PLAN };
	check('a page that never arrived is refused', (await call(bakeRoute.POST, body)).status, 409);
	put(`${bakeDir}fxbake_firecracker_${HASH_A}.png`, 'PNG');
	check(
		'a layout that does not fit its page is refused',
		(await call(bakeRoute.POST, { ...body, plan: { ...PLAN, width: 100 } })).status,
		400,
	);
	check(
		'more frames than cells are refused',
		(await call(bakeRoute.POST, { ...body, frames: 5 })).status,
		400,
	);
	const res = await call(bakeRoute.POST, body);
	check('the bake answers 200', res.status, 200);
	const assetKey = `${bakeDir}fxbake_firecracker_${HASH_A}.json`;
	check('it names the sheet by its JSON key', res.body.assetKey, assetKey);
	check('and its frames, named by the bake', res.body.frames, [
		`bake_${HASH_A}_000`,
		`bake_${HASH_A}_001`,
		`bake_${HASH_A}_002`,
		`bake_${HASH_A}_003`,
	]);
	const set = await loadRegionSet(assetKey);
	check(
		'the sheet reads back through loadRegionSet, one region per frame',
		set.regions.map((r) => [r.name, r.x, r.y, r.w, r.h]),
		[
			[`bake_${HASH_A}_000`, 0, 0, 60, 70],
			[`bake_${HASH_A}_001`, 62, 0, 60, 70],
			[`bake_${HASH_A}_002`, 0, 72, 60, 70],
			[`bake_${HASH_A}_003`, 62, 72, 60, 70],
		],
	);
	check('on its own page', set.pageKey, `${bakeDir}fxbake_firecracker_${HASH_A}.png`);
	check('at the page size', [set.pageWidth, set.pageHeight], [122, 142]);
}

// ── 3. Save and delete ─────────────────────────────────────────────────────────────────────────
console.log('3. save and delete');
const result = (hash: string, id = 'firecracker') => ({
	assetKey: `${fxBakePrefix(CLIENT, PROJECT, id)}fxbake_${id}_${hash}.json`,
	frames: [0, 1, 2, 3].map((i) => `bake_${hash}_00${i}`),
	fps: 24,
	bounds: { x: -60, y: -70, w: 120, h: 140 },
	blendMode: 'add',
	hash,
	sheet: { w: 122, h: 142 },
});
{
	put(`${bakeDir}fxbake_firecracker_${HASH_B}.png`, 'PNG');
	put(`${bakeDir}fxbake_firecracker_${HASH_B}.json`, '{}');
	await saveEffect(
		CLIENT,
		PROJECT,
		{
			id: 'firecracker',
			name: 'Firecracker',
			layers: [layer()],
			bake: { ...BAKE, result: result(HASH_B) },
		},
		{},
		null,
	);
	check('save keeps only the bake the doc names', keysUnder(bakeDir), [
		`${bakeDir}fxbake_firecracker_${HASH_B}.json`,
		`${bakeDir}fxbake_firecracker_${HASH_B}.png`,
	]);
	const stored = JSON.parse(R2.get(fxDocKey(CLIENT, PROJECT, 'firecracker'))!.body) as EffectDoc;
	check('the saved doc keeps its bake', stored.bake?.result?.hash, HASH_B);
	await deleteEffect(CLIENT, PROJECT, 'firecracker');
	check('delete drops every bake of the effect', keysUnder(bakeDir), []);
}

// ── 4. The export ──────────────────────────────────────────────────────────────────────────────
console.log('4. the export');
{
	const store = (id: string, doc: Record<string, unknown>) =>
		put(fxDocKey(CLIENT, PROJECT, id), JSON.stringify({ id, name: id, ...doc }));
	/** A doc whose result carries its own current hash. */
	const current = (id: string, enabled = true): Record<string, unknown> => {
		const draft = normalizeEffectDoc({
			id,
			name: id,
			layers: [layer()],
			bake: { ...BAKE, enabled },
		});
		return {
			layers: [layer()],
			bake: { ...BAKE, enabled, result: result(effectBakeHash(draft), id) },
		};
	};
	store('baked', current('baked'));
	store('off', current('off', false));
	const stale = current('stale');
	store('stale', { ...stale, layers: [layer(0.02)] });
	store('plain', { layers: [layer()] });

	const index = await exportEffects(CLIENT, PROJECT);
	const byId = Object.fromEntries(index.effects.map((e) => [e.id, e]));
	check('a current, enabled bake ships', !!byId.baked.bake?.result, true);
	check('a disabled bake is stripped', 'bake' in byId.off, false);
	check('a stale bake is stripped', 'bake' in byId.stale, false);
	check('and named as not shipped', index.staleBakes, ['stale']);
	check(
		'an effect without a bake exports exactly as before',
		byId.plain,
		normalizeEffectDoc({ id: 'plain', name: 'plain', layers: [layer()] }),
	);
	check(
		'the shipped sheet is a referenced asset (the dangling-art guard covers it)',
		index.referencedAssetKeys.includes((byId.baked.bake?.result?.assetKey as string) ?? ''),
		true,
	);
	check(
		'a stripped bake references nothing',
		index.referencedAssetKeys.some(
			(k) => k.includes('fx-bakes/stale/') || k.includes('fx-bakes/off/'),
		),
		false,
	);
	const deployed = JSON.parse(
		R2.get(`${SUB.deploy(CLIENT, PROJECT)}/effects/baked.json`)!.body,
	) as EffectDoc;
	check('deploy/effects carries the shipped bake', deployed.bake?.enabled, true);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
