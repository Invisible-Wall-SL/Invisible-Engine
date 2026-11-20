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
 *      written;
 *   4. Invisible Game Config's three whole-doc replacements (`config/pageDoc.ts`: Raw JSON's Apply,
 *      Reset to template default, Reset to preset), each followed by the save, keep both blocks:
 *      Apply stores the PASTED ones, so a block removed from the text is removed, and a reset
 *      stores the live doc's beside the template or preset; a 2D config gains neither.
 *   5. the Invisible Model Viewer's save of the project's model defaults: the config as loaded with
 *      ONLY its `models` key swapped (`$lib/models/projectDefaults` `withModelsBlock`), under the
 *      ETag it loaded. The store then differs in `models` and the stamp alone, an emptied block
 *      removes the key and keeps the world, and a stale ETag is refused with nothing written.
 *   6. CHARACTER SHEETS ride the same carry (`game-config` `characterSheet.ts`: a character's
 *      `view`, `source`, `draw` and `actions`, an online class's `sheet`; the pure cases are in
 *      `check:game-config-family` §5): a sheet is kept through save → load → a second save → the
 *      bundle's `config`, beside `world3d`, and the second save stores the first's bytes but for
 *      the stamp.
 *
 *   pnpm --filter launcher-api check:game-config-3d
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { world3dOf } from 'engine-mechanics/src/online3d.js';
import { normalizeGameConfigDoc, type GameConfigDoc } from 'game-config';
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

// ── 4. Invisible Game Config's whole-doc replacements ──────────────────────────────────────────
const page = await import('../src/routes/(app)/config/pageDoc.ts');
const { gameConfigDefaultFor, gameConfigPresetsFor } =
	await import('../src/lib/server/gameConfigDefaults.ts');

type Json = Record<string, unknown>;
/** A doc's `arcade.world3d` and `models`, `'absent'` for a block it does not hold. */
const blocks3d = (doc: unknown): unknown[] => {
	const { arcade, ...top } = doc as Json;
	const inArcade = (arcade ?? {}) as Json;
	return [
		'world3d' in inArcade ? inArcade.world3d : 'absent',
		'models' in top ? top.models : 'absent',
	];
};
/** A doc without its 3D blocks and its stamp, key order aside. */
const others = (doc: unknown): unknown => {
	const { models: _models, updatedAt: _at, arcade, ...top } = doc as Json;
	const { world3d: _world, ...flat } = (arcade ?? {}) as Json;
	return canon(Object.keys(flat).length ? { ...top, arcade: flat } : top);
};
const liveDoc = async (project: string): Promise<GameConfigDoc> => {
	const { doc } = await storage.loadGameConfigDocWithEtag(CLIENT, project);
	if (!doc) throw new Error(`fixture: ${project} has no stored config`);
	return page.openDoc(doc);
};
/** What the page stores after one whole-doc replacement: it opens the stored doc, replaces the
 *  live one and Saves the body under the ETag it loaded. */
async function replaceAndSave(
	project: string,
	replace: (live: GameConfigDoc) => GameConfigDoc | undefined,
): Promise<Json> {
	const { etag } = await storage.loadGameConfigDocWithEtag(CLIENT, project);
	const next = replace(await liveDoc(project));
	if (!next) throw new Error(`fixture: the replacement of ${project} was refused`);
	await storage.saveGameConfigDoc(CLIENT, project, JSON.parse(json(page.bodyFor(next))), etag);
	return stored(project);
}
/** Raw JSON: the text the page prints, edited, then Apply. */
const rawApply =
	(edit: (text: Json) => void = () => {}) =>
	(live: GameConfigDoc): GameConfigDoc | undefined => {
		const text: Json = JSON.parse(JSON.stringify(live, null, 2));
		edit(text);
		return page.applyPasted(text);
	};
{
	const template = gameConfigDefaultFor('arcade');
	const preset = gameConfigPresetsFor('lines')[0];
	if (!template || !preset) throw new Error('fixture: no arcade template or no lines preset');
	const asSaved = (doc: GameConfigDoc) => others(normalizeGameConfigDoc(structuredClone(doc)));
	/** A project with both blocks and a name of its own; answers what its save stored. */
	const world = async (project: string): Promise<Json> => {
		const authored = {
			...structuredClone(seed),
			gameName: 'Arena',
			arcade: { ...(seed.arcade as object), world3d: structuredClone(WORLD3D) },
			models: structuredClone(MODELS_AUTHORED),
		};
		await storage.saveGameConfigDoc(CLIENT, project, authored, null);
		return stored(project);
	};
	const arcadeOf = (text: Json) => text.arcade as Json;
	const KEPT = [WORLD3D, MODELS_KEPT];
	const pastedWorld = { ...WORLD3D, spawns: [{ x: 7, z: 7 }] };

	const before = await world('raw');
	if (json(others(before)) === json(asSaved(template)))
		throw new Error('fixture: the project must differ from its template');
	check(
		'4. (control) the normalizer Apply runs drops both blocks',
		blocks3d(normalizeGameConfigDoc(structuredClone(before))),
		['absent', 'absent'],
	);
	check(
		'4. the page sees the blocks of the doc it opens',
		page.holds3dBlocks(await liveDoc('raw')),
		true,
	);

	const same = await replaceAndSave('raw', rawApply());
	check('4. Raw JSON Apply, text untouched: the save keeps both blocks', blocks3d(same), KEPT);
	check('4. …and stores the config it had', canon(withoutStamp(same)), canon(withoutStamp(before)));
	check(
		'4. Raw JSON Apply, world3d edited in the text: the pasted world is saved',
		blocks3d(
			await replaceAndSave(
				'raw',
				rawApply((text) => {
					arcadeOf(text).world3d = pastedWorld;
				}),
			),
		),
		[pastedWorld, MODELS_KEPT],
	);
	check(
		'4. Raw JSON Apply, models removed from the text: it is removed, the world stays',
		blocks3d(
			await replaceAndSave(
				'raw',
				rawApply((text) => {
					delete text.models;
				}),
			),
		),
		[pastedWorld, 'absent'],
	);
	check(
		'4. Raw JSON Apply, world3d removed from the text and models pasted back',
		blocks3d(
			await replaceAndSave(
				'raw',
				rawApply((text) => {
					delete arcadeOf(text).world3d;
					text.models = structuredClone(MODELS_AUTHORED);
				}),
			),
		),
		['absent', MODELS_KEPT],
	);

	await world('template');
	const reset = await replaceAndSave('template', (live) => page.resetTo(template, live));
	check('4. Reset to template default: the save keeps both blocks', blocks3d(reset), KEPT);
	check('4. …and everything else is the template', others(reset), asSaved(template));

	await world('preset');
	const swapped = await replaceAndSave('preset', (live) => page.resetTo(preset.doc, live));
	check(
		`4. Reset to preset (${preset.label}): the save keeps both blocks`,
		blocks3d(swapped),
		KEPT,
	);
	check('4. …and everything else is the preset', others(swapped), asSaved(preset.doc));

	const onlyWorld = page.carry3dBlocks(
		{ arcade: { world3d: pastedWorld } },
		await liveDoc('preset'),
	);
	check(
		'4. carrying one block leaves the other, and every other key, as it was',
		[blocks3d(onlyWorld), others(onlyWorld)],
		[[pastedWorld, MODELS_KEPT], others(swapped)],
	);

	const flat = stored('flat');
	const flatLive = await liveDoc('flat');
	check('4. a 2D doc holds no 3D block', page.holds3dBlocks(flatLive), false);
	check(
		'4. …so a reset of it is the template itself',
		page.carry3dBlocks(flatLive, template) === template,
		true,
	);
	const applied = await replaceAndSave('flat', rawApply());
	check(
		'4. a 2D config applied from Raw JSON and saved is the config it had',
		canon(withoutStamp(applied)),
		canon(withoutStamp(flat)),
	);
	check('4. …with no world3d and no models', blocks3d(applied), ['absent', 'absent']);
}

// ── 5. The Model Viewer's save: one key swapped ──────────────────────────────────────────────────
{
	const { withModelsBlock } = await import('../src/lib/models/projectDefaults.ts');
	const project = 'viewer-save';
	await storage.saveGameConfigDoc(
		CLIENT,
		project,
		{ ...structuredClone(seed), arcade: { world3d: WORLD3D }, models: MODELS_AUTHORED },
		null,
	);
	const before = stored(project);
	const { doc: loaded, etag } = await storage.loadGameConfigDocWithEtag(CLIENT, project);
	if (!loaded) throw new Error('fixture: the Model Viewer project has no stored config');
	const defaults = { profiles: { hero: { quarter: { lods: [2, 3] as [number, number] } } } };
	await storage.saveGameConfigDoc(CLIENT, project, withModelsBlock(loaded, defaults), etag);
	const after = stored(project);
	check('5. the save stores the swapped models block', after.models, defaults);
	const { models: _was, ...restBefore } = withoutStamp(before);
	const { models: _now, ...restAfter } = withoutStamp(after);
	check(
		'5. …and every other key as it was, the world included',
		canon(restAfter),
		canon(restBefore),
	);

	let refused = '';
	try {
		await storage.saveGameConfigDoc(
			CLIENT,
			project,
			withModelsBlock(loaded, { profiles: { prop: { half: { maps: { normal: 'drop' } } } } }),
			etag,
		);
	} catch (e) {
		refused = (e as Error).name;
	}
	check('5. a save on the ETag loaded before that one is refused', refused, 'ConflictError');
	check('5. …and writes nothing', canon(stored(project)), canon(after));

	const fresh = await storage.loadGameConfigDocWithEtag(CLIENT, project);
	if (!fresh.doc) throw new Error('fixture: the Model Viewer project lost its config');
	await storage.saveGameConfigDoc(
		CLIENT,
		project,
		withModelsBlock(fresh.doc, undefined),
		fresh.etag,
	);
	const emptied = stored(project);
	check(
		'5. an emptied block removes the models key and keeps the world',
		['models' in emptied, (emptied.arcade as Record<string, unknown> | undefined)?.world3d],
		[false, WORLD3D],
	);
}

// ── 6. Character sheets ────────────────────────────────────────────────────────────────────────
{
	const project = 'sheets';
	const SHEET = {
		view: { kind: 'isometric', facings: 8 },
		source: { kind: 'clips', prefix: 'bear', variants: { marked: 'bear_gold' } },
		draw: { width: 92, points: { hand: { x: 0.75, y: 0.4 } } },
		actions: [
			{ id: 'idle', when: { motion: 'still' } },
			{ id: 'walk', when: { motion: 'moving' }, fallback: 'idle' },
			{ id: 'grab', when: { event: 'caught' }, anim: { e: { clip: 'bear_grab_side' } } },
		],
	};
	const character = { id: 'bearLook', component: 'arcadeBear', ...SHEET };
	const cls = { id: 'bear', body: 'arcadeBear', speed: 190, sheet: 'bearLook' };
	const authored = {
		...structuredClone(seed),
		arcade: {
			...(seed.arcade as object),
			field: { w: 2000, h: 1200 },
			characters: [character],
			online: { characters: [cls] },
			world3d: structuredClone(WORLD3D),
		},
	};
	const sheetsOf = (doc: Record<string, unknown> | null) => {
		const arcade = (doc?.arcade ?? {}) as {
			characters?: unknown[];
			online?: { characters?: unknown[] };
			world3d?: unknown;
		};
		return [arcade.characters?.[0], arcade.online?.characters?.[0], arcade.world3d];
	};
	await storage.saveGameConfigDoc(CLIENT, project, authored, null);
	const first = stored(project);
	check('6. the save stores the sheet, the class’s sheet and the world', sheetsOf(first), [
		character,
		cls,
		WORLD3D,
	]);
	const loaded = await storage.loadGameConfigDocWithEtag(CLIENT, project);
	check('6. the load is the stored doc', canon(loaded.doc), canon(first));
	await storage.saveGameConfigDoc(CLIENT, project, loaded.doc, loaded.etag);
	check(
		'6. a second save stores the same bytes but for the stamp',
		json(withoutStamp(stored(project))),
		json(withoutStamp(first)),
	);
	check('6. the bundle ships all three', sheetsOf(await bundleConfig(project)), [
		character,
		cls,
		WORLD3D,
	]);
}

console.log(
	failures
		? `check:game-config-3d — ${failures} of ${checks} checks FAILED`
		: `check:game-config-3d — all ${checks} checks pass`,
);
process.exit(failures ? 1 : 0);
