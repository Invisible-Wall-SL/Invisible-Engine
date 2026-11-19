/**
 * check:game-config-3d — a 3D game's `arcade.world3d` and `models` blocks travel the launcher.
 *
 * `game-config` ships in every runtime and does not know either block, so its normalizer drops
 * them; `gameConfig3d.ts` carries them past it. Over an in-memory R2, through the real
 * `saveGameConfigDoc`, `loadGameConfigDoc` and `buildRuntimeBundle`:
 *
 *   1. a 2D config (the arcade seed) stores, loads and bundles exactly what the normalizer makes;
 *   2. the seed plus `world3d` and `models` keeps both through save → load → a second save (what
 *      Invisible Game Config does) → the bundle's `config`, `world3d` as authored and `models` as
 *      the model export resolves it;
 *   3. a `world3d` the 3D room would refuse is refused by the save, by path, and nothing is
 *      written.
 *
 *   pnpm --filter launcher-api check:game-config-3d
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { world3dOf } from 'engine-mechanics/src/online3d.js';
import { normalizeGameConfigDoc } from 'game-config';
import { MODEL_CLASSES } from 'constants-shared/modelTiers';

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

/** Fake a module: the given implementations, and a loud failure for every other export. */
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
fake('lib/server/r2.ts', {
	ConflictError,
	precondition: (base: string | null | undefined) =>
		base === undefined ? undefined : base === null ? { ifNoneMatch: '*' } : { ifMatch: base },
	getObjectText: async (key: string) => R2.get(key)?.body ?? null,
	getObjectTextWithEtag: async (key: string) => {
		const o = R2.get(key);
		return o ? { text: o.body, etag: o.etag } : null;
	},
	getObjectBytes: async (key: string) => {
		const o = R2.get(key);
		return o ? { body: new TextEncoder().encode(o.body), etag: o.etag, contentType: '' } : null;
	},
	putObjectText: async (key: string, text: string, _type: string, cond?: Cond) =>
		put(key, text, cond),
	putObjectBytes: async (key: string, body: Uint8Array, _type: string, cond?: Cond) =>
		put(key, new TextDecoder().decode(body), cond),
	deleteObject: async (key: string) => void R2.delete(key),
	deleteObjects: async (keys: string[]) => keys.forEach((key) => R2.delete(key)),
	listAllKeys: async (prefix: string) => keysUnder(prefix),
	listFolder: async (prefix: string) => {
		const folders = new Set<string>();
		const files: { key: string; size: number; lastModified: null }[] = [];
		for (const key of keysUnder(prefix)) {
			const slash = key.indexOf('/', prefix.length);
			if (slash >= 0) folders.add(key.slice(0, slash + 1));
			else files.push({ key, size: R2.get(key)!.body.length, lastModified: null });
		}
		return { files, folders: [...folders].sort() };
	},
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
	copyObject: async (from: string, to: string, _type?: string, sourceEtag?: string) => {
		const o = R2.get(from);
		if (!o || (sourceEtag && o.etag !== sourceEtag)) return false;
		R2.set(to, { ...o });
		return true;
	},
	listAllObjects: async (prefix: string) =>
		keysUnder(prefix).map((key) => ({ key, size: R2.get(key)!.body.length, lastModified: 1 })),
});

const CLIENT = 'acme';
fake('lib/server/projects.ts', {
	DEFAULT_PROJECT_KEY: 'cloud',
	projectClientKey: async () => CLIENT,
	projectName: async () => 'Arena',
	projectAllowsRead: async () => true,
});
fake('lib/server/appSettings.ts', {
	getDeployToken: async () => 'deploy-token',
	getAppSetting: async () => undefined,
});
fake('lib/server/runtimeBundleCache.ts', {
	withDeployWrite: async <T>(_project: string, run: () => Promise<T>) => run(),
});

const storage = await import('../src/lib/server/gameConfigStorage.ts');
const { gameConfigDocKey } = await import('../src/lib/server/projectPaths.ts');
const { buildRuntimeBundle } = await import('../src/lib/server/runtimeBundle.ts');
const { resolveLodScreenSize, resolveModelProfile } =
	await import('../src/lib/server/modelStorage.ts');
const { withGameConfig3dBlocks } = await import('../src/lib/server/gameConfig3d.ts');

const seed: Record<string, unknown> = JSON.parse(
	readFileSync(
		fileURLToPath(new URL('../src/lib/data/gameConfig/arcade.rules.json', import.meta.url)),
		'utf8',
	),
);
const stored = (project: string): Record<string, unknown> =>
	JSON.parse(R2.get(gameConfigDocKey(CLIENT, project))!.body);
/** Key order aside: a load puts the blocks back after the stamp. */
const canon = (v: unknown): unknown =>
	Array.isArray(v)
		? v.map(canon)
		: v && typeof v === 'object'
			? Object.fromEntries(
					Object.keys(v)
						.sort()
						.map((k) => [k, canon((v as Record<string, unknown>)[k])]),
				)
			: v;
const withoutStamp = ({ updatedAt: _at, ...rest }: Record<string, unknown>) => rest;
const bundleConfig = async (project: string): Promise<Record<string, unknown>> => {
	const quiet = [console.info, console.log, console.warn];
	console.info = console.log = console.warn = () => {};
	try {
		const bundle = (await buildRuntimeBundle(project)) as { config?: Record<string, unknown> };
		return bundle.config ?? {};
	} finally {
		[console.info, console.log, console.warn] = quiet;
	}
};

// ── 1. A 2D config ─────────────────────────────────────────────────────────────────────────────
{
	const project = 'flat';
	const normalized = normalizeGameConfigDoc(structuredClone(seed));
	if (!normalized) throw new Error('fixture: the arcade seed does not normalize');
	check(
		'1. no 3D blocks: the doc itself comes back',
		withGameConfig3dBlocks(normalized, {}) === normalized,
		true,
	);
	await storage.saveGameConfigDoc(CLIENT, project, structuredClone(seed));
	check('1. a 2D save stores what the normalizer makes', withoutStamp(stored(project)), normalized);
	const loaded = await storage.loadGameConfigDoc(CLIENT, project);
	check('1. a 2D load is the stored doc', loaded, stored(project));
	const config = await bundleConfig(project);
	const { partnerPaytable: _p, ...shipped } = stored(project);
	check('1. the bundle ships the stored doc', config, shipped);
	check(
		'1. …with no world3d and no models',
		[(config.arcade as Record<string, unknown> | undefined)?.world3d, config.models],
		[undefined, undefined],
	);
}

// ── 2. The arcade seed plus world3d and models ─────────────────────────────────────────────────
const box = (
	minX: number,
	minY: number,
	minZ: number,
	maxX: number,
	maxY: number,
	maxZ: number,
) => ({
	kind: 'box',
	minX,
	minY,
	minZ,
	maxX,
	maxY,
	maxZ,
});
const WORLD3D = {
	level: {
		colliders: [
			box(-20, -1, -20, 20, 0, 20),
			{ kind: 'ramp', facing: '-x', minX: -5, minY: 0, minZ: -12, maxX: 3, maxY: 3, maxZ: -8 },
		],
		zones: [
			{
				kind: 'trampoline',
				minX: 0,
				minY: -0.1,
				minZ: 10,
				maxX: 2,
				maxY: 0.1,
				maxZ: 12,
				height: 4,
			},
		],
		killY: -10,
	},
	spawns: [
		{ x: 0, z: 0 },
		{ x: 3.3, z: -3 },
	],
};
const MODELS_AUTHORED = {
	profiles: {
		hero: { quarter: { maps: { baseColor: 256, normal: 'drop' }, lods: [1, 3] }, eighth: {} },
		tile: { half: { encoding: { baseColor: 'etc1s' } } },
		spaceship: { full: { lods: [0, 1] } },
	},
	lodScreenSize: { prop: { levels: [0.5, 0.2], cullBelow: 0.01 }, nope: { levels: [1] } },
};
const MODELS_KEPT = {
	profiles: {
		hero: { quarter: { lods: [1, 3], maps: { baseColor: 256, normal: 'drop' } } },
		tile: { half: { encoding: { baseColor: 'etc1s' } } },
	},
	lodScreenSize: { prop: { levels: [0.5, 0.2], cullBelow: 0.01 } },
};
{
	const project = 'arena';
	const authored = {
		...structuredClone(seed),
		arcade: { ...(seed.arcade as object), world3d: structuredClone(WORLD3D) },
		models: structuredClone(MODELS_AUTHORED),
	};
	const { doc: saved } = await storage.saveGameConfigDoc(CLIENT, project, authored, null);
	const first = stored(project);
	check(
		'2. the save stores world3d as authored',
		(first.arcade as Record<string, unknown>).world3d,
		WORLD3D,
	);
	check('2. …and models as the model export reads it', first.models, MODELS_KEPT);
	check(
		'2. …and everything else as the normalizer makes it',
		withoutStamp({
			...first,
			arcade: { ...(first.arcade as object), world3d: undefined },
			models: undefined,
		}),
		normalizeGameConfigDoc(structuredClone(seed)),
	);
	check('2. the save answers what it stored', saved, first);

	const { doc: loaded, etag } = await storage.loadGameConfigDocWithEtag(CLIENT, project);
	check('2. the load keeps both blocks', canon(loaded), canon(first));
	await storage.saveGameConfigDoc(CLIENT, project, structuredClone(loaded), etag);
	check(
		'2. a second save (Invisible Game Config) keeps both blocks',
		canon(withoutStamp(stored(project))),
		canon(withoutStamp(first)),
	);

	const config = await bundleConfig(project);
	const shipped = (config.arcade as Record<string, unknown> | undefined)?.world3d;
	check('2. the bundle ships world3d as authored', shipped, WORLD3D);
	check('2. …which world3dOf reads', world3dOf(shipped)?.spawns.length, 2);
	check('2. the bundle ships models', config.models, MODELS_KEPT);
	for (const cls of MODEL_CLASSES) {
		check(
			`2. models resolve the same for ${cls}, authored or kept`,
			[
				resolveModelProfile(cls, null, config.models),
				resolveLodScreenSize(cls, null, config.models),
			],
			[
				resolveModelProfile(cls, null, MODELS_AUTHORED),
				resolveLodScreenSize(cls, null, MODELS_AUTHORED),
			],
		);
	}
}

// ── 3. A world3d the room would refuse ─────────────────────────────────────────────────────────
{
	const project = 'arena';
	const before = R2.get(gameConfigDocKey(CLIENT, project))!.body;
	const bad = {
		...structuredClone(seed),
		arcade: {
			...(seed.arcade as object),
			world3d: { level: { colliders: [{ ...box(0, 0, 0, 1, 1, 1), kind: 'ramp', facing: 'up' }] } },
		},
	};
	let issues: { path: string }[] = [];
	try {
		await storage.saveGameConfigDoc(CLIENT, project, bad);
	} catch (error) {
		if (error instanceof storage.InvalidGameConfigError) issues = error.issues;
		else throw error;
	}
	check(
		'3. the save is refused at arcade.world3d',
		issues.map((i) => i.path),
		['arcade.world3d'],
	);
	check('3. …and nothing is written', R2.get(gameConfigDocKey(CLIENT, project))!.body, before);
}

console.log(
	failures
		? `check:game-config-3d — ${failures} of ${checks} checks FAILED`
		: `check:game-config-3d — all ${checks} checks pass`,
);
process.exit(failures ? 1 : 0);
