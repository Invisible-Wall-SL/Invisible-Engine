/**
 * check:model-viewer — the Invisible Model Viewer (`/models`, `docs/design/3d-games.md` §6 Phase 4)
 * over an in-memory R2, on Node-built masters (`scripts/lib/modelFixtures.ts`):
 *
 *   pnpm --filter launcher-api check:model-viewer
 *
 *  1. THE REGISTRY (rule 9). The tool, its roles, its stage, its guide and README row; only an
 *     arcade project is offered it; every `/api/models` route gates on the tool itself.
 *  2. FACTS. A registered master keeps what it holds (levels, textures, sockets) in `model.json`,
 *     and a model from before facts were kept gets them read off its master when it is opened.
 *     THE ID is the master's file name, exactly (prefix and case kept), and the upload dialog
 *     refuses one with the function the register step refuses it with.
 *  3. THE PROFILE THE PAGE SHOWS IS THE EXPORT'S. `effectiveProfile` over the inherited layer equals
 *     `resolveModelProfile` for every class; each value names its source (this model, Game Config,
 *     default); every override edit leaves exactly what a save stores.
 *  4. THE REPORT. Budgets, the LOD chain, textures, names and sockets and the tier windows, from the
 *     facts alone; a stored issue no row recomputes is still listed.
 *  5. SAVE is a compare-and-swap on the ETag the author loaded: a stale one is a 409 that changes
 *     nothing, and so is a doc someone else writes between this save's read and its write; a save
 *     keeps the master, the facts and the report; a class change re-runs the validator on the
 *     master, and the model's own screen sizes are refitted to the new class's levels.
 *  6. THE VIEWER'S DERIVE derives every tier of one model and keeps what each comes to in
 *     `models/<id>/viewer-tiers.json`: the numbers only, no tier file (a tier equal to `full` is
 *     listed as such). It leaves `deploy/`, `model.json` and the export's own
 *     `models/<id>/derived/` cache alone, says which `model.json` it read, goes stale when the
 *     settings, the master, the class or the Game Config's block for its class change (and for
 *     nothing else), and warms the export's texture cache, whose bytes its numbers equal. One
 *     derive of a model at a time; a failed one keeps the last numbers, and neither a failed nor a
 *     throwing one holds up the next. Two masters in memory at most: a third derive waits, and so
 *     do the other two readers of a master (a model stored before facts were kept being opened, a
 *     class change being checked).
 *  7. THE ROUTES, called as SvelteKit calls them, every one of them: refused without the tool and
 *     outside the project BEFORE anything is read or written, and so is an id that is no model id;
 *     `baseEtag` is required and never empty on save and register; a lost save answers 409
 *     `{ error: 'conflict', message }`; a derive answers with the index and the doc version it read.
 *  8. THE PROJECT'S DEFAULTS: the Game Config's `models` block, as the "Game Config defaults" card
 *     edits it (`projectDefaults.ts`). A class's tiers and screen sizes are set and cleared in one
 *     canonical form, which is what the Game Config save keeps; `withModelsBlock` swaps that one key
 *     of the loaded doc and every other key, `arcade.world3d` included, is the loaded doc's own.
 *     PARITY: the layer the page shows for a block is `resolveModelProfile`'s and
 *     `resolveLodScreenSize`'s, for every class. (§6 writes such a block into the stored Game
 *     Config: that class then inherits it and its derive is out of date; another class's is not.)
 *  9. THE EDIT SESSION of those defaults (`projectDefaultsEdit.svelte.ts`, the REAL class with the
 *     real `LeaseState` and `SaveState`, compiled as the app compiles them, against a fake
 *     launcher). The Game Config lease is asked for only when an edit opens and given back when it
 *     closes, also when the page leaves while it is still being asked for; a save is one PUT of the
 *     loaded Game Config with only its `models` key replaced, against the ETag it loaded and never
 *     forced; a refused save keeps the draft and offers the two ways out; with no Game Config, or
 *     without the lease, nothing is written.
 */
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';
import {
	MODEL_CLASSES,
	MODEL_CLASS_DEFAULTS,
	type ModelLodScreenSize,
	type ModelTierId,
} from 'constants-shared/modelTiers';
import { GAME_FAMILIES } from 'constants-shared/gameKinds';
import {
	FAMILY_TOOLS,
	ROLE_TOOLS,
	TOOL_BAR_ORDER,
	TOOL_STAGES,
	TOOLS,
	familyUsesTool,
	toolDocPath,
} from '../src/lib/roles.ts';
import { leaseEntitlingTool } from '../src/lib/accessRules.ts';
import {
	effectiveProfile,
	encodingSource,
	fitScreenSize,
	lodsSource,
	mapSource,
	overrideCount,
	screenSizeSource,
	setEncodingOverride,
	setLodsOverride,
	setMapOverride,
	type TierOverrides,
} from '../src/lib/models/modelProfile.ts';
import * as modelId from '../src/lib/models/modelId.ts';
import { buildModelReport, reportCounts } from '../src/lib/models/modelReport.ts';
import {
	canonicalModelsBlock,
	classDefaultsOf,
	inheritedFromBlock,
	inheritedLayers,
	modelsBlockOf,
	rebaseModelsBlock,
	setClassScreenSize,
	setClassTiers,
	withModelsBlock,
} from '../src/lib/models/projectDefaults.ts';
import { normalizeGameConfigModels, type GameConfigModels } from '../src/lib/server/modelConfig.ts';
import { modelIdFromFile } from '../src/routes/(app)/models/models.client.ts';
import type { ProjectDefaultsEdit as ProjectDefaultsEditClass } from '../src/routes/(app)/models/projectDefaultsEdit.svelte.ts';
import { buildMasterGlb } from './lib/modelFixtures';

let failures = 0;
let passes = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) passes += 1;
	else failures += 1;
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};
const same = (label: string, actual: unknown, expected: unknown): void =>
	check(
		label,
		JSON.stringify(actual) === JSON.stringify(expected),
		`expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`,
	);

// ── In-memory R2 ────────────────────────────────────────────────────────────────────────────────
const R2 = new Map<string, Uint8Array>();
const etagOf = (b: Uint8Array) => `"${createHash('md5').update(b).digest('hex')}"`;
const enc = (t: string) => new TextEncoder().encode(t);
/** While set, every binary READ whose key matches waits for `gate`; `parked` counts them. */
let hold: { match: (key: string) => boolean; gate: Promise<void>; parked: number } | null = null;
/** How often each key was read with its ETag: a model.json read is a save or a derive starting. */
const reads = new Map<string, number>();
/** One shot: runs right after the next read of that key (someone writing between a read and a write). */
const afterRead = new Map<string, () => void>();
/** One shot: the next binary read of this key answers bytes that are no GLB. */
let garbleReadOf: string | null = null;
/** One shot: the next read of this key throws. */
let failReadOf: string | null = null;
/** How often each key was asked for as bytes: a master read is something holding it in memory. */
const byteReads = new Map<string, number>();
/** Every call into the fake R2, read or write: a request refused at a route's gate makes none. */
let r2Calls = 0;
const counted = <T extends Record<string, (...args: never[]) => unknown>>(fakes: T): T => {
	const out: Record<string, unknown> = {};
	for (const [name, fake] of Object.entries(fakes))
		out[name] = (...args: never[]) => {
			r2Calls += 1;
			return fake(...args);
		};
	return out as T;
};
const r2Url = new URL('../src/lib/server/r2.ts', import.meta.url).href;
const r2 = await import(r2Url);
const write = (
	key: string,
	body: Uint8Array,
	cond?: { ifMatch?: string; ifNoneMatch?: string },
) => {
	const cur = R2.get(key);
	if (cond?.ifNoneMatch && cur) throw new r2.ConflictError(key);
	if (cond?.ifMatch && (!cur || etagOf(cur) !== cond.ifMatch)) throw new r2.ConflictError(key);
	R2.set(key, body);
	return etagOf(body);
};
mock.module(r2Url, {
	namedExports: {
		...r2,
		...counted({
			getObjectBytes: async (key: string) => {
				byteReads.set(key, (byteReads.get(key) ?? 0) + 1);
				const held = hold;
				if (held?.match(key)) {
					held.parked += 1;
					await held.gate;
				}
				if (garbleReadOf === key) {
					garbleReadOf = null;
					return { body: new Uint8Array([1, 2, 3]), etag: '"garbled"', contentType: '' };
				}
				const b = R2.get(key);
				return b ? { body: b, etag: etagOf(b), contentType: '' } : null;
			},
			// Register reads the staged upload this way (a Range read pinned to the HEAD's ETag).
			getObjectBytesBounded: async (key: string, max: number, ifMatch?: string) => {
				byteReads.set(key, (byteReads.get(key) ?? 0) + 1);
				const b = R2.get(key);
				if (!b) return null;
				if (ifMatch && etagOf(b) !== ifMatch) return 'changed';
				return b.byteLength > max ? 'large' : b;
			},
			getObjectText: async (key: string) => {
				const b = R2.get(key);
				return b ? new TextDecoder().decode(b) : null;
			},
			getObjectTextWithEtag: async (key: string) => {
				if (failReadOf === key) {
					failReadOf = null;
					throw new Error('fixture: R2 is down');
				}
				reads.set(key, (reads.get(key) ?? 0) + 1);
				const b = R2.get(key);
				const out = b ? { text: new TextDecoder().decode(b), etag: etagOf(b) } : null;
				const then = afterRead.get(key);
				afterRead.delete(key);
				then?.();
				return out;
			},
			putObjectText: async (key: string, text: string, _ct?: string, cond?: object) =>
				write(key, enc(text), cond),
			putObjectBytes: async (key: string, body: Uint8Array, _ct?: string, cond?: object) => {
				return write(key, body, cond);
			},
			headObject: async (key: string) => {
				const b = R2.get(key);
				return b ? { etag: etagOf(b), size: b.byteLength, lastModified: 0 } : null;
			},
			listAllKeys: async (prefix: string) =>
				[...R2.keys()].filter((k) => k.startsWith(prefix)).sort(),
			// Model ids are listed one folder deep, then each `model.json` checked.
			listFolder: async (prefix: string) => {
				const folders = new Set<string>();
				const files: { key: string; size: number; lastModified: null }[] = [];
				for (const [k, b] of R2) {
					if (!k.startsWith(prefix)) continue;
					const rest = k.slice(prefix.length);
					const slash = rest.indexOf('/');
					if (slash >= 0) folders.add(prefix + rest.slice(0, slash + 1));
					else files.push({ key: k, size: b.byteLength, lastModified: null });
				}
				return { files, folders: [...folders].sort() };
			},
			objectExists: async (key: string) => R2.has(key),
			copyObject: async (from: string, to: string, _ct?: string, sourceEtag?: string) => {
				const b = R2.get(from);
				if (!b || (sourceEtag && etagOf(b) !== sourceEtag)) return false;
				R2.set(to, b);
				return true;
			},
			deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
			deleteObject: async (key: string) => void R2.delete(key),
			presignPut: async (key: string) => `https://r2.invalid/${key}?sig`,
		}),
	},
});

const src = (rel: string) => new URL(`../src/lib/server/${rel}`, import.meta.url).href;
const storage = (await import(
	src('modelStorage.ts')
)) as typeof import('../src/lib/server/modelStorage');
const viewer = (await import(
	src('modelViewer.ts')
)) as typeof import('../src/lib/server/modelViewer');
const exporter = (await import(
	src('modelExport.ts')
)) as typeof import('../src/lib/server/modelExport');
const paths = (await import(
	src('projectPaths.ts')
)) as typeof import('../src/lib/server/projectPaths');

const C = 'acme';
const P = 'arena';
const under = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();
const text = (key: string) => new TextDecoder().decode(R2.get(key));

// ── 1. The registry ─────────────────────────────────────────────────────────────────────────────
console.log('1. the registry');
{
	const tool = TOOLS.models;
	same(
		'the tool',
		[tool?.name, tool?.url, tool?.kind],
		['Invisible Model Viewer', '/models', 'online'],
	);
	check(
		'placed in a stage, so in the tool bar',
		TOOL_STAGES.some((s) => s.tools.includes('models')) && TOOL_BAR_ORDER.includes('models'),
	);
	for (const [role, ids] of Object.entries(ROLE_TOOLS)) {
		if (role === 'admin') continue;
		if (ids.includes('characters'))
			check(`${role}: holds Characters, so holds the Model Viewer`, ids.includes('models'));
	}
	same(
		'only an arcade project is offered it (a 3D game is an arcade game)',
		GAME_FAMILIES.filter((f) => familyUsesTool(f, 'models')),
		['arcade'],
	);
	check(
		'every id FAMILY_TOOLS names is a tool',
		Object.values(FAMILY_TOOLS).every((ids) => ids.every((id) => Object.hasOwn(TOOLS, id))),
	);
	same('its lease is entitled by the tool itself', leaseEntitlingTool('models'), 'models');
	same('the guide slug', toolDocPath('models'), 'docs/models');
	const docs = fileURLToPath(new URL('../../../docs/tools/', import.meta.url));
	check('docs/tools/models.md exists', existsSync(`${docs}models.md`));
	check(
		'its row in docs/tools/README.md',
		readFileSync(`${docs}README.md`, 'utf8').includes('(models.md)'),
	);

	const apiRoot = fileURLToPath(new URL('../src/routes/api/models/', import.meta.url));
	const routes: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const full = `${dir}${name}`;
			if (statSync(full).isDirectory()) walk(`${full}/`);
			else if (name === '+server.ts') routes.push(full);
		}
	};
	walk(apiRoot);
	check('the API has its five routes', routes.length >= 5, routes.join(', '));
	for (const file of routes) {
		const body = readFileSync(file, 'utf8');
		const handlers = body.match(/export const (GET|POST|PUT|DELETE)/g)?.length ?? 0;
		const gated = body.match(/await requireModelAccess\(locals\)/g)?.length ?? 0;
		const scoped = body.match(/await requireProjectScope\(/g)?.length ?? 0;
		check(
			`${file.slice(apiRoot.length)}: every handler gates on the tool and checks the project`,
			handlers > 0 && gated === handlers && scoped === handlers,
		);
	}
	const access = readFileSync(
		fileURLToPath(new URL('../src/lib/server/modelAccess.ts', import.meta.url)),
		'utf8',
	);
	check(
		'the gate is the models tool alone',
		access.includes("MODELS_TOOL = 'models'") &&
			access.includes('requireTool(locals, MODELS_TOOL') &&
			!access.includes("'editor'"),
	);
}

// ── 2. Facts ────────────────────────────────────────────────────────────────────────────────────
console.log('2. facts');
const stage = async (id: string, bytes: Uint8Array) => {
	const { upload } = await storage.presignModelUpload(C, P, id, 60);
	R2.set(paths.modelUploadKey(C, P, id, upload), bytes);
	return upload;
};
const orbMaster = await buildMasterGlb({
	id: 'PR_orb',
	textureSide: 256,
	normal: true,
	orm: true,
	levels: [
		{ level: 0, segments: 76 },
		{ level: 1, segments: 30 },
	],
});
const registered = await storage.registerModelUpload(
	C,
	P,
	'orb',
	await stage('orb', orbMaster),
	'prop',
	null,
);
check('a new model registers', registered.ok, JSON.stringify(registered));
const orbDoc = registered.ok ? registered.doc : null;
same(
	'model.json keeps the master levels',
	orbDoc?.facts?.levels.map((l) => [l.base, l.level]),
	[
		['PR_orb', 0],
		['PR_orb', 1],
	],
);
check(
	'…with their triangle counts',
	!!orbDoc?.facts && orbDoc.facts.levels.every((l) => l.tris > 0),
	JSON.stringify(orbDoc?.facts?.levels),
);
same(
	'…its textures',
	orbDoc?.facts?.textures.map((t) => [t.name, t.w, t.h]),
	[
		['PR_orb_base', 256, 256],
		['PR_orb_normal', 256, 256],
		['PR_orb_orm', 256, 256],
	],
);
same('…and its sockets', orbDoc?.facts?.sockets, ['top']);
{
	const listed = await viewer.listModels(C, P);
	same(
		'the list carries the doc and its ETag',
		listed.map((m) => [
			m.id,
			m.doc?.class,
			m.etag === etagOf(R2.get(paths.modelDocKey(C, P, 'orb'))!),
		]),
		[['orb', 'prop', true]],
	);
	// A model.json from before facts were kept.
	const legacy = { ...orbDoc, facts: undefined };
	R2.set(paths.modelDocKey(C, P, 'old'), enc(JSON.stringify(legacy)));
	R2.set(paths.modelSourceKey(C, P, 'old', orbDoc!.source.file), orbMaster);
	const opened = await viewer.loadModelDetail(C, P, 'old');
	same('a model without stored facts gets them when opened', opened?.doc?.facts, orbDoc?.facts);
	check('…without writing its model.json', !JSON.parse(text(paths.modelDocKey(C, P, 'old'))).facts);
	same('an unknown model opens as null', await viewer.loadModelDetail(C, P, 'nope'), null);
	R2.delete(paths.modelDocKey(C, P, 'old'));
	R2.delete(paths.modelSourceKey(C, P, 'old', orbDoc!.source.file));
}
{
	same(
		'the id is the file name, exactly: prefix and case kept',
		modelIdFromFile('PR_crate_small.glb'),
		{ id: 'PR_crate_small', cls: 'prop' },
	);
	same(
		'…for every class prefix',
		['CH_Brawler.GLB', 'wp_sword.glb', 'TL_floor.glb', 'FX_ring.glb'].map((name) => {
			const read = modelIdFromFile(name);
			return [read.id, read.cls];
		}),
		[
			['CH_Brawler', 'hero'],
			['wp_sword', 'weapon'],
			['TL_floor', 'tile'],
			['FX_ring', 'fx'],
		],
	);
	same('a name with no class prefix reads no class', modelIdFromFile('sword.glb'), {
		id: 'sword',
		cls: null,
	});
	same(
		'a name that is no id is left as it is, for the rule to refuse',
		[modelIdFromFile('My Model (2).glb').id, modelId.modelIdRefusal('My Model (2)', []) !== null],
		['My Model (2)', true],
	);
	check(
		'the page and the server share one id rule',
		storage.modelIdRefusal === modelId.modelIdRefusal &&
			storage.isModelId === modelId.isModelId &&
			storage.MODEL_ID === modelId.MODEL_ID &&
			storage.MODEL_ID_RULE === modelId.MODEL_ID_RULE,
	);
	check(
		'a case-only twin of a model is refused before anything uploads',
		!!modelId.modelIdRefusal('ORB', ['orb']) && modelId.modelIdRefusal('orb2', ['orb']) === null,
	);
	const dialog = readFileSync(
		fileURLToPath(new URL('../src/routes/(app)/models/UploadDialog.svelte', import.meta.url)),
		'utf8',
	);
	check(
		'the upload dialog refuses an id with that function',
		dialog.includes("from '$lib/models/modelId'") && dialog.includes('modelIdRefusal(id, taken)'),
	);
}

// ── 3. The profile ──────────────────────────────────────────────────────────────────────────────
console.log("3. the profile the page shows is the export's");
const configModels = {
	profiles: {
		prop: { half: { maps: { baseColor: 512 }, encoding: { normal: 'etc1s' } } },
		hero: { quarter: { lods: [1, 3] } },
	},
	lodScreenSize: { prop: { levels: [0.3, 0.1, 0.05, 0.01], cullBelow: 0.004 } },
};
R2.set(
	paths.editorDocKey(C, P),
	enc(JSON.stringify({ scenes: [], resolutionTiers: ['half', 'quarter'] })),
);
R2.set(
	paths.gameConfigDocKey(C, P),
	enc(JSON.stringify({ arcade: { world3d: { level: {} } }, models: configModels })),
);
const context = await viewer.loadModelProjectContext(C, P);
same('published tiers: full and what the layout names', context.publishedTiers, [
	'full',
	'half',
	'quarter',
]);
same('no doc names a model yet', context.reached, []);
check('the config has a 3D world', context.world3d);
{
	const overrides: TierOverrides = {
		half: { maps: { baseColor: 256, orm: 'drop' } },
		quarter: { lods: [1, 2], encoding: { baseColor: 'uastc' } },
	};
	for (const cls of MODEL_CLASSES) {
		for (const own of [undefined, overrides]) {
			same(
				`${cls}${own ? ' with overrides' : ''}: the page's profile is resolveModelProfile's`,
				effectiveProfile(context.inherited[cls].tiers, own),
				storage.resolveModelProfile(cls, own ? { overrides: own } : null, configModels),
			);
		}
		same(
			`${cls}: the inherited screen sizes are resolveLodScreenSize's`,
			context.inherited[cls].lodScreenSize,
			storage.resolveLodScreenSize(cls, null, configModels),
		);
	}
	const prop = context.inherited.prop;
	same(
		'sources: this model, then the Game Config, then the default',
		[
			mapSource('prop', 'half', 'baseColor', prop, overrides),
			mapSource('prop', 'half', 'baseColor', prop, undefined),
			mapSource('prop', 'half', 'normal', prop, undefined),
			encodingSource('prop', 'half', 'normal', prop, undefined),
			encodingSource('prop', 'quarter', 'baseColor', prop, overrides),
			lodsSource('prop', 'quarter', prop, overrides),
			lodsSource('prop', 'full', prop, overrides),
			lodsSource('hero', 'quarter', context.inherited.hero, undefined),
			screenSizeSource('prop', prop, undefined),
			screenSizeSource('hero', context.inherited.hero, undefined),
			screenSizeSource('hero', context.inherited.hero, { levels: [0.2], cullBelow: 0 }),
		],
		[
			'model',
			'project',
			'default',
			'project',
			'model',
			'model',
			'default',
			'project',
			'project',
			'default',
			'model',
		],
	);

	// Every edit leaves what a save stores.
	const stored = (o: TierOverrides | undefined) =>
		storage.normalizeModelDoc({ ...orbDoc, overrides: o })?.overrides;
	let edited: TierOverrides | undefined;
	const step = (label: string, next: TierOverrides | undefined) => {
		edited = next;
		same(`edit: ${label} is what a save stores`, edited, stored(edited));
	};
	step('a LOD window', setLodsOverride(edited, 'half', [0, 2]));
	step('a map size', setMapOverride(edited, 'half', 'baseColor', 512));
	step('a dropped map', setMapOverride(edited, 'quarter', 'emissive', 'drop'));
	step('an encoding', setEncodingOverride(edited, 'full', 'baseColor', 'png'));
	same('four values are overridden', overrideCount(edited), 4);
	step('the window reset', setLodsOverride(edited, 'half', null));
	step('the map reset', setMapOverride(edited, 'half', 'baseColor', null));
	check('a tier left empty is dropped', !!edited && !('half' in edited));
	step('the dropped map reset', setMapOverride(edited, 'quarter', 'emissive', null));
	step('the encoding reset', setEncodingOverride(edited, 'full', 'baseColor', null));
	same('every override reset leaves none', edited, undefined);
}

same(
	"a hero's own screen sizes on a tile: one per tile level, and no LODU size",
	fitScreenSize(
		{ levels: [0.4, 0.2, 0.1, 0.05], ultra: 0.6, cullBelow: 0.02 },
		'tile',
		MODEL_CLASS_DEFAULTS.tile.lodScreenSize,
	),
	{ levels: [0.4, 0.2], cullBelow: 0.02 },
);
same(
	"a tile's own screen sizes on a hero: the levels it lacks and LODU are the inherited ones",
	fitScreenSize({ levels: [0.4, 0.2], cullBelow: 0.02 }, 'hero', {
		levels: [0.3, 0.12, 0.05, 0.02],
		ultra: 0.55,
		cullBelow: 0.01,
	}),
	{ levels: [0.4, 0.2, 0.05, 0.02], ultra: 0.55, cullBelow: 0.02 },
);

// ── 4. The report ───────────────────────────────────────────────────────────────────────────────
console.log('4. the report');
{
	const profile = effectiveProfile(context.inherited.prop.tiers, undefined);
	const report = (over: Partial<Parameters<typeof buildModelReport>[0]> = {}) =>
		buildModelReport({
			cls: 'prop',
			facts: orbDoc!.facts!,
			issues: [],
			profile,
			publishedTiers: context.publishedTiers,
			...over,
		});
	const row = (sections: ReturnType<typeof report>, id: string, label: string) =>
		sections.find((s) => s.id === id)?.rows.find((r) => r.label === label);
	const clean = report();
	same(
		'sections',
		clean.map((s) => s.id),
		['budgets', 'lods', 'textures', 'names', 'tiers'],
	);
	same('a master within its class has no error or warning', reportCounts(clean), {
		errors: 0,
		warnings: 0,
	});
	same(
		'LOD chain: authored levels, the rest generated, no LODU',
		clean.find((s) => s.id === 'lods')?.rows.map((r) => [r.label, r.value.split(' ·')[0], r.state]),
		[
			['PR_orb LODU', 'None', 'info'],
			['PR_orb LOD0', 'Authored', 'ok'],
			['PR_orb LOD1', 'Authored', 'ok'],
			['PR_orb LOD2', 'Generated at export', 'info'],
			['PR_orb LOD3', 'Generated at export', 'info'],
		],
	);
	same(
		'a 256² map is below the full tier, noted not flagged',
		[row(clean, 'textures', 'PR_orb_base')?.state, row(clean, 'textures', 'PR_orb_base')?.code],
		['info', 'TEXTURE_BELOW_FULL'],
	);
	same(
		'tier windows: full 0–2, half 1–3, quarter 2–3, ultra unpublished from LOD0',
		clean.find((s) => s.id === 'tiers')?.rows.map((r) => [r.label, r.value]),
		[
			['Ultra (not published)', 'LOD0–2'],
			['Full', 'LOD0–2'],
			['Half', 'LOD1–3'],
			['Quarter', 'LOD2–3'],
		],
	);

	const heavy = report({
		facts: {
			levels: [
				{ base: 'PR_orb', level: 0, tris: 9000 },
				{ base: 'WP_axe', level: 1, tris: 100 },
				{ base: 'Cube.001', level: 0, tris: 12 },
			],
			textures: [
				{ name: 'a', w: 1000, h: 1000 },
				{ name: 'b', w: 4096, h: 4096 },
				{ name: 'c', w: 2, h: 2 },
				{ name: 'd', w: 16384, h: 16 },
				{ name: 'crate_palette', w: 64, h: 64 },
			],
			clips: ['idle', 'locomotion.run'],
			sockets: ['hand_r', 'Hand L'],
		},
	});
	same(
		'budgets: 9,000 tris is over a prop LOD0',
		[row(heavy, 'budgets', 'PR_orb LOD0')?.state, row(heavy, 'budgets', 'PR_orb LOD0')?.code],
		['warning', 'TRIS_OVER_BUDGET'],
	);
	same(
		'textures: not a power of two, over the class, not ÷4, over the limit, a palette is exempt',
		['a', 'b', 'c', 'd', 'crate_palette'].map((n) => row(heavy, 'textures', n)?.code ?? 'ok'),
		['TEXTURE_NOT_POW2', 'TEXTURE_OVER_CLASS', 'TEXTURE_NOT_DIV4', 'TEXTURE_TOO_LARGE', 'ok'],
	);
	same(
		'names: another class, a Blender copy, a socket not in snake case, a clip without its set',
		[
			row(heavy, 'names', 'PR_orb')?.state,
			row(heavy, 'names', 'WP_axe')?.code,
			row(heavy, 'names', 'Cube.001')?.code,
			row(heavy, 'names', 'SK_hand_r')?.state,
			row(heavy, 'names', 'SK_Hand L')?.code,
			row(heavy, 'names', 'Clips')?.code,
		],
		['ok', 'NAME_UNKNOWN', 'NAME_DUPLICATE_SUFFIX', 'ok', 'SOCKET_NAME', 'ACTION_NAME'],
	);
	same(
		'a mesh with lower levels but no LOD0 is flagged',
		row(heavy, 'lods', 'WP_axe LOD0')?.code,
		'LOD_MISSING_BASE',
	);
	const noMesh = report({ facts: { levels: [], textures: [], clips: [], sockets: [] } });
	same('no mesh at all is an error', row(noMesh, 'lods', 'LOD0')?.state, 'error');

	const stored = report({
		issues: [
			{ level: 'warning', code: 'TRIS_OVER_BUDGET', message: 'stored copy of a recomputed rule' },
			{ level: 'error', code: 'SOCKET_EYE_MISSING', message: 'a viewmodel needs SK_eye' },
			{ level: 'warning', code: 'SOMETHING_NEW', message: 'a rule added later' },
		],
	});
	check(
		'a stored issue the rows recompute is not listed twice',
		!stored.some((s) => s.rows.some((r) => r.value.includes('stored copy'))),
	);
	same(
		'a stored issue no row recomputes is listed, by its code',
		[
			row(stored, 'names', 'SOCKET_EYE_MISSING')?.state,
			row(stored, 'other', 'SOMETHING_NEW')?.state,
		],
		['error', 'warning'],
	);
	const legacy = report({
		facts: null,
		issues: [{ level: 'warning', code: 'TRIS_OVER_BUDGET', message: 'as stored' }],
	});
	same(
		'without facts the stored issues are the report',
		legacy.map((s) => [s.id, s.rows.length]),
		[['other', 1]],
	);
	const weapon = report({
		cls: 'weapon',
		profile: effectiveProfile(context.inherited.weapon.tiers, { half: { lods: [2, 5] } }),
	});
	same('a window past the class chain is flagged', row(weapon, 'tiers', 'Half')?.state, 'warning');
}

// ── 5. Save ─────────────────────────────────────────────────────────────────────────────────────
console.log('5. save');
const docKey = paths.modelDocKey(C, P, 'orb');
let etag = etagOf(R2.get(docKey)!);
{
	const before = text(docKey);
	const stale = await viewer.saveModelSettings(
		C,
		P,
		'orb',
		{ class: 'prop', overrides: { half: { maps: { baseColor: 128 } } }, lodScreenSize: null },
		'"stale"',
	);
	check('a stale ETag is a 409', !stale.ok && stale.status === 409, JSON.stringify(stale));
	check('…and model.json is unchanged', text(docKey) === before);
	const gone = await viewer.saveModelSettings(
		C,
		P,
		'ghost',
		{ class: 'prop', overrides: null, lodScreenSize: null },
		etag,
	);
	check('an unknown model is a 404', !gone.ok && gone.status === 404);

	const saved = await viewer.saveModelSettings(
		C,
		P,
		'orb',
		{
			class: 'prop',
			overrides: { half: { maps: { baseColor: 128, bogus: 7 }, lods: [0, 1] }, nope: {} },
			lodScreenSize: { levels: [0.3, 0.1], cullBelow: 0.01 },
		},
		etag,
	);
	check('a save against the loaded ETag is stored', saved.ok, JSON.stringify(saved));
	if (saved.ok) {
		same(
			'only what model.json holds is stored',
			[saved.doc.overrides, saved.doc.lodScreenSize],
			[
				{ half: { lods: [0, 1], maps: { baseColor: 128 } } },
				{ levels: [0.3, 0.1], cullBelow: 0.01 },
			],
		);
		same(
			'the master, the facts and the report are kept',
			[saved.doc.source, saved.doc.facts, saved.doc.validator],
			[orbDoc?.source, orbDoc?.facts, orbDoc?.validator],
		);
		check('the answer carries the new ETag', saved.etag === etagOf(R2.get(docKey)!));
		const again = await viewer.saveModelSettings(
			C,
			P,
			'orb',
			{ class: 'prop', overrides: null, lodScreenSize: null },
			etag,
		);
		check('the ETag from before that save is now stale (409)', !again.ok && again.status === 409);
		etag = saved.etag!;
	}

	const reclassed = await viewer.saveModelSettings(
		C,
		P,
		'orb',
		{ class: 'fx', overrides: null, lodScreenSize: null },
		etag,
	);
	check('a class change is stored', reclassed.ok, JSON.stringify(reclassed));
	if (reclassed.ok) {
		check(
			'…with the validator re-run for the new class (an fx mesh is 500 tris)',
			reclassed.doc.class === 'fx' &&
				reclassed.doc.validator.issues.some((i) => i.code === 'TRIS_OVER_BUDGET'),
			JSON.stringify(reclassed.doc.validator),
		);
		same('…and the overrides cleared as asked', reclassed.doc.overrides, undefined);
		etag = reclassed.etag!;
	}
	const back = await viewer.saveModelSettings(
		C,
		P,
		'orb',
		{ class: 'prop', overrides: null, lodScreenSize: null },
		etag,
	);
	if (back.ok) etag = back.etag!;
	check(
		'back to a prop: no warning left',
		back.ok && back.doc.validator.warnings === 0,
		JSON.stringify(back),
	);

	// Someone else writes between this save's read and its write. The ETag compare in the function
	// has already passed by then: only the conditional PUT can refuse it.
	const theirs = JSON.stringify({ ...JSON.parse(text(docKey)), updatedAt: '2026-01-01T00:00:00Z' });
	afterRead.set(docKey, () => void R2.set(docKey, enc(theirs)));
	const raced = await viewer.saveModelSettings(
		C,
		P,
		'orb',
		{ class: 'prop', overrides: { full: { lods: [0, 1] } }, lodScreenSize: null },
		etag,
	);
	check(
		'a doc written between the read and the write is a 409',
		!raced.ok && raced.status === 409,
		JSON.stringify(raced),
	);
	check('…and their write is kept', text(docKey) === theirs);
	etag = etagOf(R2.get(docKey)!);
}

// ── 6. The Viewer's derive ──────────────────────────────────────────────────────────────────────
console.log('6. the derive');
{
	const tiersKey = paths.modelViewerTiersKey(C, P, 'orb');
	const cachePrefix = `${paths.SUB.models(C, P)}/_cache/`;
	// The export's derived-tier cache of this model: another writer's folder.
	const exportCache = `${paths.SUB.models(C, P)}/orb/derived/`;
	const theirs = `${exportCache}0123456789abcdef/tier.json`;
	R2.set(theirs, enc('{}'));
	const deployPrefix = `${paths.SUB.deploy(C, P)}/`;
	const before = await viewer.loadModelDetail(C, P, 'orb');
	check('never derived: no numbers', before?.derived === null && !!before.deriveInputs);

	const docBefore = text(docKey);
	const keysBefore = new Set(R2.keys());
	const first = await viewer.deriveModelForViewer(C, P, 'orb');
	check('the derive answers', first.ok, JSON.stringify(first));
	if (!first.ok) throw new Error('the derive failed; the rest of the fixture needs it');
	same(
		'every tier is derived, published or not; ultra equals full on a 256² master with no LODU',
		[Object.keys(first.derived.tiers).sort(), first.derived.sameAsFull],
		[['full', 'half', 'quarter'], ['ultra']],
	);
	same(
		'a tier is named as a publish names its file',
		(['full', 'half', 'quarter'] as ModelTierId[]).map((t) => first.derived.tiers[t]?.glb),
		['orb.glb', 'orb@half.glb', 'orb@quarter.glb'],
	);
	check(
		'every tier carries tris, bytes and VRAM',
		Object.values(first.derived.tiers).every(
			(t) => t.bytes > 0 && t.vramBytes > 0 && t.lods.length > 0 && t.lods.every((l) => l.tris > 0),
		),
	);
	const wrote = [...R2.keys()].filter((k) => !keysBefore.has(k));
	check(
		'it keeps the numbers and no tier file: one JSON, and textures in the shared cache',
		wrote.includes(tiersKey) && wrote.every((k) => k === tiersKey || k.startsWith(cachePrefix)),
		wrote.join(' '),
	);
	same(
		"the export's derived-tier cache of the model is left exactly as it was",
		under(exportCache),
		[theirs],
	);
	check('deploy/ is untouched', under(deployPrefix).length === 0, under(deployPrefix).join(' '));
	check('model.json is untouched', text(docKey) === docBefore);
	const opened = await viewer.loadModelDetail(C, P, 'orb');
	check(
		'opened again: the numbers are there and current',
		!!opened?.derived && opened.derived.inputs === opened.deriveInputs,
	);

	// The export after it encodes nothing these tiers share, and ships the bytes the Viewer showed.
	R2.set(
		paths.editorDocKey(C, P),
		enc(
			JSON.stringify({
				resolutionTiers: ['half', 'quarter'],
				scenes: [{ id: 'a', nodes: [{ id: 'n', props: { modelId: 'orb' } }] }],
			}),
		),
	);
	const cached = under(cachePrefix).length;
	const index = await exporter.exportModels(C, P, { warn: () => undefined });
	check('the export after it encodes nothing new', under(cachePrefix).length === cached);
	const shipped = index.models.find((m) => m.id === 'orb');
	same(
		'…and ships the bytes the Viewer showed, tier by tier',
		(['full', 'half', 'quarter'] as ModelTierId[]).map((t) => shipped?.tiers[t]?.bytes),
		(['full', 'half', 'quarter'] as ModelTierId[]).map((t) => first.derived.tiers[t]?.bytes),
	);
	same('the game now reaches it', (await viewer.loadModelProjectContext(C, P)).reached, ['orb']);

	// Settings change → stale → the next derive replaces the numbers.
	const tuned = await viewer.saveModelSettings(
		C,
		P,
		'orb',
		{ class: 'prop', overrides: { half: { maps: { normal: 'drop' } } }, lodScreenSize: null },
		etag,
	);
	check('an override is saved', tuned.ok, JSON.stringify(tuned));
	const stale = await viewer.loadModelDetail(C, P, 'orb');
	check(
		'the stored numbers are now out of date',
		!!stale?.derived && stale.derived.inputs !== stale.deriveInputs,
	);
	check('…and the save said so', tuned.ok && tuned.deriveInputs === stale?.deriveInputs);
	const deployed = under(deployPrefix).length;
	const exportCacheBefore = under(exportCache);
	const second = await viewer.deriveModelForViewer(C, P, 'orb');
	check('the next derive answers', second.ok, JSON.stringify(second));
	if (!second.ok) throw new Error('the second derive failed; the rest of the fixture needs it');
	check('half now drops its normal map', second.derived.tiers.half?.maps.normal === 'dropped');
	const now = await viewer.loadModelDetail(C, P, 'orb');
	check(
		'it is current for the stored model, and says which model.json it read',
		second.derived.inputs === now?.deriveInputs && second.docEtag === now?.etag,
		JSON.stringify([second.derived.inputs, now?.deriveInputs, second.docEtag, now?.etag]),
	);
	same('the numbers kept are the ones it answered', now?.derived, second.derived);
	check('deploy/ is still untouched by a derive', under(deployPrefix).length === deployed);
	same("…and so is the export's derived-tier cache", under(exportCache), exportCacheBefore);

	// Out of date for everything a publish would derive differently, and for nothing else.
	{
		const configKey = paths.gameConfigDocKey(C, P);
		const configBefore = text(configKey);
		const loaded = JSON.parse(configBefore) as Record<string, unknown>;
		const block = modelsBlockOf(loaded);
		/** Store the Game Config as the Viewer's card saves it: the loaded doc, its block swapped. */
		const storeBlock = (next: GameConfigModels | undefined) =>
			R2.set(configKey, enc(JSON.stringify(withModelsBlock(loaded, next))));
		const inheritedNow = async () => (await viewer.loadModelProjectContext(C, P)).inherited;
		const isCurrent = async () => {
			const d = await viewer.loadModelDetail(C, P, 'orb');
			return !!d?.derived && d.derived.inputs === d.deriveInputs;
		};
		const was = await inheritedNow();

		storeBlock(block);
		check('the block stored again in its canonical form leaves it current', await isCurrent());
		same('…and every class inheriting what it did', await inheritedNow(), was);

		const heroBlock = setClassTiers(block, 'hero', { half: { lods: [1, 2] } });
		storeBlock(heroBlock);
		const withHero = await inheritedNow();
		same(
			"another class's block, stored as the card stores it, is what that class inherits",
			withHero.hero,
			inheritedFromBlock('hero', heroBlock),
		);
		check(
			'…which is not what it inherited before',
			JSON.stringify(withHero.hero) !== JSON.stringify(was.hero),
		);
		same("…while the model's own class inherits what it did", withHero.prop, was.prop);
		check("another class's Game Config block leaves it current", await isCurrent());

		const propBlock = setClassTiers(block, 'prop', { half: { maps: { baseColor: 64 } } });
		storeBlock(propBlock);
		const withProp = await inheritedNow();
		same(
			"its own class's block is what its class inherits",
			withProp.prop,
			inheritedFromBlock('prop', propBlock),
		);
		check(
			'…which is not what it inherited before',
			JSON.stringify(withProp.prop) !== JSON.stringify(was.prop),
		);
		same('…while the other class inherits what it did', withProp.hero, was.hero);
		check("its own class's Game Config block makes it out of date", !(await isCurrent()));

		const sizes: ModelLodScreenSize = { levels: [0.5, 0.2, 0.1, 0.05], cullBelow: 0.02 };
		storeBlock(setClassScreenSize(block, 'prop', sizes));
		same(
			"its class's screen sizes in the block are the ones it inherits",
			(await inheritedNow()).prop.lodScreenSize,
			sizes,
		);
		check('…and leave it current: screen sizes change no derived byte', await isCurrent());

		storeBlock(undefined);
		const emptied = JSON.parse(text(configKey)) as Record<string, unknown>;
		check('the block emptied: the stored Game Config has no models key', !('models' in emptied));
		same('…and still has its 3D world', emptied.arcade, loaded.arcade);
		same(
			'…every class inherits the code defaults',
			await inheritedNow(),
			inheritedLayers(undefined),
		);
		check('…and it is out of date: its class had a block', !(await isCurrent()));

		R2.set(configKey, enc(configBefore));
		check('…and current again once the block is put back', await isCurrent());

		const stored = (await storage.loadModelDoc(C, P, 'orb'))?.doc;
		if (!stored) throw new Error('the fixture lost its model.json');
		const key = viewer.deriveInputsOf(stored, configModels);
		check(
			'a new master makes it out of date',
			viewer.deriveInputsOf(
				{ ...stored, source: { ...stored.source, sha256: 'f'.repeat(64) } },
				configModels,
			) !== key,
		);
		check(
			'a new class makes it out of date',
			viewer.deriveInputsOf({ ...stored, class: 'tile' }, configModels) !== key,
		);
		check(
			'its screen sizes do not: they change no derived byte',
			viewer.deriveInputsOf(
				{ ...stored, lodScreenSize: { levels: [0.9, 0.5], cullBelow: 0.2 } },
				configModels,
			) === key,
		);
	}

	// The queue. A derive's first act is to read its model.json, so that read is "it started"; it
	// is held at its next one, the master.
	const docOf = (id: string) => paths.modelDocKey(C, P, id);
	const sourceOf = (id: string) => paths.modelSourceKey(C, P, id, orbDoc!.source.file);
	const turn = () => new Promise((r) => setTimeout(r, 0));
	const turns = async (n: number) => {
		for (let i = 0; i < n; i += 1) await turn();
	};
	const within = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
		Promise.race([promise, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
	const parkedAt = async (n: number) => {
		for (let i = 0; i < 6000 && (hold?.parked ?? 0) < n; i += 1) await turn();
		return (hold?.parked ?? 0) >= n;
	};
	for (const id of ['spare', 'third']) {
		const made = await storage.registerModelUpload(
			C,
			P,
			id,
			await stage(id, orbMaster),
			'prop',
			null,
		);
		check(`${id} registers`, made.ok);
	}

	// One at a time per model.
	let open!: () => void;
	hold = {
		match: (key) => key === sourceOf('orb'),
		gate: new Promise<void>((r) => (open = r)),
		parked: 0,
	};
	reads.clear();
	const a = viewer.deriveModelForViewer(C, P, 'orb');
	check('a derive is held at its master', await parkedAt(1));
	const b = viewer.deriveModelForViewer(C, P, 'orb');
	await turns(5);
	same('a second derive of the same model has not started', reads.get(docOf('orb')), 1);
	const spare = await within(viewer.deriveModelForViewer(C, P, 'spare'), 120_000);
	check('another model derives to its end meanwhile', !!spare?.ok, JSON.stringify(spare));
	same('…and the second is still waiting', reads.get(docOf('orb')), 1);
	open();
	hold = null;
	const [first2, second2] = await Promise.all([a, b]);
	check('…then both answer', first2.ok && second2.ok);
	same('…the second having run after the first', reads.get(docOf('orb')), 2);

	// Two at once at most: with two held, a third model's derive does not start.
	hold = {
		match: (key) => key === sourceOf('orb') || key === sourceOf('spare'),
		gate: new Promise<void>((r) => (open = r)),
		parked: 0,
	};
	reads.clear();
	const two = [
		viewer.deriveModelForViewer(C, P, 'orb'),
		viewer.deriveModelForViewer(C, P, 'spare'),
	];
	check('two derives are held at their masters', await parkedAt(2));
	const third = viewer.deriveModelForViewer(C, P, 'third');
	await turns(5);
	same('a third derive waits for a slot', reads.get(docOf('third')), undefined);
	open();
	hold = null;
	const all = await Promise.all([...two, third]);
	check(
		'…and runs once one is free',
		all.every((r) => r.ok),
	);

	// Every master read takes a slot, not only a derive's: with both taken, a model stored before
	// facts were kept does not read its master to open, nor a class change to check it.
	{
		const thirdKey = docOf('third');
		const legacyDoc = JSON.parse(text(thirdKey)) as Record<string, unknown>;
		delete legacyDoc.facts;
		R2.set(thirdKey, enc(JSON.stringify(legacyDoc)));
		hold = {
			match: (key) => key === sourceOf('orb') || key === sourceOf('spare'),
			gate: new Promise<void>((r) => (open = r)),
			parked: 0,
		};
		const holders = [
			viewer.deriveModelForViewer(C, P, 'orb'),
			viewer.deriveModelForViewer(C, P, 'spare'),
		];
		check('two derives hold both slots', await parkedAt(2));
		byteReads.clear();
		const legacy = viewer.loadModelDetail(C, P, 'third');
		await turns(5);
		same(
			'opening a model stored before facts were kept waits for a slot to read its master',
			byteReads.get(sourceOf('third')),
			undefined,
		);
		const reclassed = viewer.saveModelSettings(
			C,
			P,
			'third',
			{ class: 'tile', overrides: null, lodScreenSize: null },
			etagOf(R2.get(thirdKey)!),
		);
		await turns(5);
		same(
			'…and so does a class change, to check the master against the class',
			byteReads.get(sourceOf('third')),
			undefined,
		);
		open();
		hold = null;
		const [openedLegacy, savedClass] = await Promise.all([legacy, reclassed]);
		await Promise.all(holders);
		check(
			'…then the model opens with its facts',
			(openedLegacy?.doc?.facts?.levels.length ?? 0) > 0,
		);
		check(
			'…and the class change is saved',
			savedClass.ok && savedClass.doc.class === 'tile',
			JSON.stringify(savedClass).slice(0, 300),
		);
	}

	// Failures. A master that will not read: a 422, and the last numbers stay.
	const kept = text(tiersKey);
	garbleReadOf = sourceOf('orb');
	const failed = await viewer.deriveModelForViewer(C, P, 'orb');
	check(
		'a derive that cannot read its master answers 422',
		!failed.ok && failed.status === 422,
		JSON.stringify(failed),
	);
	check('…and the last numbers are kept as they were', text(tiersKey) === kept);
	failReadOf = docOf('orb');
	same(
		'a derive that throws rejects',
		await viewer.deriveModelForViewer(C, P, 'orb').then(
			() => 'answered',
			() => 'threw',
		),
		'threw',
	);
	const after = await viewer.deriveModelForViewer(C, P, 'orb');
	check('…and the next derive of that model still runs', after.ok);

	const missing = await viewer.deriveModelForViewer(C, P, 'ghost');
	check('an unknown model is a 404', !missing.ok && missing.status === 404);
	R2.delete(sourceOf('spare'));
	const noMaster = await viewer.deriveModelForViewer(C, P, 'spare');
	check('a model whose master is gone is a 404', !noMaster.ok && noMaster.status === 404);
}

// ── 7. The routes ───────────────────────────────────────────────────────────────────────────────
console.log('7. the routes');
{
	/** What the mocked gates answer; a refusal is thrown as SvelteKit's `error()` throws it. */
	const gate = { access: true, scope: true };
	const refuse = (message: string) =>
		Object.assign(new Error(message), { status: 403, body: { message } });
	mock.module(src('modelAccess.ts'), {
		namedExports: {
			MODELS_TOOL: 'models',
			requireModelAccess: async () => {
				if (!gate.access) throw refuse('fixture: not your tool');
				return { id: 'u', role: 'artist' };
			},
		},
	});
	mock.module(src('toolScope.ts'), {
		namedExports: {
			requireProjectScope: async () => {
				if (!gate.scope) throw refuse('fixture: not your project');
				return { clientKey: C, projectKey: P };
			},
		},
	});
	type Input = Record<string, unknown>;
	const routesRoot = new URL('../src/routes/api/models/', import.meta.url);
	/** Call a route's real handler: a GET's input is its query, a POST's its JSON body. A thrown
	 *  `error()` is its status and body. */
	const call = async (
		name: string,
		method: 'GET' | 'POST',
		input: Input,
	): Promise<{ status: number; body: Input }> => {
		const handlers = (await import(
			new URL(`${name ? `${name}/` : ''}+server.ts`, routesRoot).href
		)) as Record<string, (event: unknown) => Promise<Response>>;
		const url = new URL(`https://app.invalid/api/models/${name}?project=${P}`);
		if (method === 'GET')
			for (const [key, value] of Object.entries(input)) url.searchParams.set(key, String(value));
		try {
			const res = await handlers[method]({
				request: new Request(
					url,
					method === 'GET'
						? {}
						: {
								method,
								headers: { 'content-type': 'application/json' },
								body: JSON.stringify(input),
							},
				),
				url,
				locals: {},
			});
			return { status: res.status, body: (await res.json()) as Input };
		} catch (e) {
			const thrown = e as { status?: unknown; body?: Input };
			if (typeof thrown.status !== 'number') throw e;
			return { status: thrown.status, body: thrown.body ?? {} };
		}
	};
	const post = (name: string, body: Input) => call(name, 'POST', body);
	const settings = { id: 'orb', class: 'prop', overrides: null, lodScreenSize: null };
	const upload = { id: 'orb', upload: '00000000-0000-4000-8000-000000000000', class: 'prop' };
	const live = etagOf(R2.get(docKey)!);
	const before = text(docKey);

	/** Every route, with a request nothing is wrong with. */
	const ROUTES: { name: string; method: 'GET' | 'POST'; input: Input; takesId: boolean }[] = [
		{ name: '', method: 'GET', input: {}, takesId: false },
		{ name: 'detail', method: 'GET', input: { id: 'orb' }, takesId: true },
		{ name: 'save', method: 'POST', input: { ...settings, baseEtag: live }, takesId: true },
		{ name: 'derive', method: 'POST', input: { id: 'orb' }, takesId: true },
		{ name: 'register', method: 'POST', input: { ...upload, baseEtag: live }, takesId: true },
		{ name: 'upload', method: 'POST', input: { id: 'orb', bytes: 1024 }, takesId: true },
	];
	same(
		'this fixture calls every route there is',
		ROUTES.length,
		readdirSync(fileURLToPath(routesRoot), { recursive: true }).filter((file) =>
			String(file).endsWith('+server.ts'),
		).length,
	);
	for (const denied of ['access', 'scope'] as const) {
		gate[denied] = false;
		for (const route of ROUTES) {
			const calls = r2Calls;
			const answer = await call(route.name, route.method, route.input);
			check(
				`${route.name || 'list'}: ${denied === 'access' ? 'without the tool' : 'outside the project'} it is refused before anything is read or written`,
				answer.status === 403 && r2Calls === calls,
				`${answer.status}, ${r2Calls - calls} R2 call(s)`,
			);
		}
		gate[denied] = true;
	}
	for (const route of ROUTES.filter((r) => r.takesId))
		for (const id of ['../orb', 'orb/x', '']) {
			const calls = r2Calls;
			const answer = await call(route.name, route.method, { ...route.input, id });
			check(
				`${route.name}: the id ${JSON.stringify(id)} is a 400 before anything is read or written`,
				answer.status === 400 && r2Calls === calls,
				`${answer.status}, ${r2Calls - calls} R2 call(s)`,
			);
		}
	check('none of them wrote', text(docKey) === before);

	const listed = await call('', 'GET', {});
	check(
		'the list answers every model with the ETag a write must match',
		listed.status === 200 &&
			Array.isArray(listed.body.models) &&
			(listed.body.models as { id: string; etag: string }[]).some(
				(m) => m.id === 'orb' && m.etag === live,
			),
		JSON.stringify(listed).slice(0, 300),
	);
	const opened = await call('detail', 'GET', { id: 'orb' });
	same(
		'detail answers the doc, its ETag, the last derive and the key a current one carries',
		[
			opened.status,
			typeof opened.body.doc,
			opened.body.etag,
			typeof opened.body.derived,
			typeof opened.body.deriveInputs,
		],
		[200, 'object', live, 'object', 'string'],
	);
	same(
		'detail of a model the project lacks is a 404',
		(await call('detail', 'GET', { id: 'ghost' })).status,
		404,
	);

	same('save without a baseEtag is a 400', (await post('save', settings)).status, 400);
	same(
		'save with an empty baseEtag is a 400',
		(await post('save', { ...settings, baseEtag: '' })).status,
		400,
	);
	const lost = await post('save', { ...settings, baseEtag: '"stale"' });
	same(
		'a lost save is a 409 { error: "conflict", message }',
		[lost.status, lost.body.error, typeof lost.body.message],
		[409, 'conflict', 'string'],
	);
	check('none of those wrote either', text(docKey) === before);
	const saved = await post('save', { ...settings, baseEtag: live });
	same(
		'a save against the live ETag answers the doc, its ETag and the derive key',
		[saved.status, typeof saved.body.doc, saved.body.etag, typeof saved.body.deriveInputs],
		[200, 'object', etagOf(R2.get(docKey)!), 'string'],
	);

	same('register without a baseEtag is a 400', (await post('register', upload)).status, 400);
	same(
		'register with an empty baseEtag is a 400 (it would reach R2 as no precondition)',
		(await post('register', { ...upload, baseEtag: '' })).status,
		400,
	);

	const derived = await post('derive', { id: 'orb' });
	same(
		'derive answers the index, its key and the model.json it read',
		[
			derived.status,
			typeof derived.body.derived,
			typeof derived.body.deriveInputs,
			derived.body.docEtag,
		],
		[200, 'object', 'string', etagOf(R2.get(docKey)!)],
	);
}

// ── 8. The project's defaults ───────────────────────────────────────────────────────────────────
console.log("8. the project's defaults");
{
	// The block in its canonical key order: classes, tiers, then `lods` / `maps` / `encoding`.
	const propTiers: TierOverrides = {
		half: { maps: { baseColor: 512, orm: 'drop' } },
		quarter: { lods: [1, 2], encoding: { baseColor: 'png' } },
	};
	const tileTiers: TierOverrides = { full: { lods: [0, 0] } };
	const heroSizes: ModelLodScreenSize = {
		levels: [0.3, 0.1, 0.05, 0.02],
		ultra: 0.6,
		cullBelow: 0.01,
	};
	const expected = {
		profiles: { prop: propTiers, tile: tileTiers },
		lodScreenSize: { hero: heroSizes },
	};
	// Set class by class, in another order and with the keys in another order.
	const built = setClassScreenSize(
		setClassTiers(setClassTiers(undefined, 'tile', tileTiers), 'prop', {
			quarter: { encoding: { baseColor: 'png' }, lods: [1, 2] },
			half: { maps: { orm: 'drop', baseColor: 512 } },
		}),
		'hero',
		{ cullBelow: 0.01, ultra: 0.6, levels: [0.3, 0.1, 0.05, 0.02] },
	);
	same('set: each class keeps what it was given, in one key order', built, expected);
	same(
		'the same defaults set in another order read the same',
		setClassTiers(
			setClassTiers(setClassScreenSize(undefined, 'hero', heroSizes), 'prop', propTiers),
			'tile',
			tileTiers,
		),
		built,
	);
	same(
		"read: a class's entry, and nothing for a class the block does not name",
		[classDefaultsOf(built, 'prop'), classDefaultsOf(built, 'hero'), classDefaultsOf(built, 'fx')],
		[{ tiers: propTiers }, { lodScreenSize: heroSizes }, {}],
	);
	same('canonical: a canonical block comes back as it is', canonicalModelsBlock(built), built);
	same(
		'canonical: an empty class, tier or part beside a set one is dropped',
		canonicalModelsBlock({
			profiles: { fx: {}, prop: { full: { maps: {} }, half: { maps: { baseColor: 512 } } } },
			lodScreenSize: {},
		}),
		{ profiles: { prop: { half: { maps: { baseColor: 512 } } } } },
	);
	same(
		'canonical: nothing set is no block',
		canonicalModelsBlock({ profiles: { hero: { half: {} }, prop: {} }, lodScreenSize: {} }),
		undefined,
	);
	same(
		'what the helpers build is what the Game Config save keeps, key for key',
		normalizeGameConfigModels(built),
		built,
	);
	same(
		'a value the save drops is not in the block the page adopts from its answer',
		modelsBlockOf({
			models: normalizeGameConfigModels(
				setClassTiers(built, 'fx', { full: { maps: { baseColor: 300 } } }),
			),
		}),
		built,
	);

	// Clear.
	const noTile = setClassTiers(built, 'tile', undefined);
	same("clear: a class's tiers go and the rest stays", noTile, {
		profiles: { prop: propTiers },
		lodScreenSize: { hero: heroSizes },
	});
	same('…and the block it was cleared from is not changed', built, expected);
	const noSizes = setClassScreenSize(noTile, 'hero', undefined);
	same('clear: the last screen sizes gone, their key goes too', noSizes, {
		profiles: { prop: propTiers },
	});
	same(
		'clear: the last entry gone leaves no block',
		setClassTiers(noSizes, 'prop', undefined),
		undefined,
	);
	const oneEdit = setClassTiers(
		undefined,
		'weapon',
		setMapOverride(undefined, 'half', 'baseColor', 256),
	);
	same(
		'a grid edit taken back leaves no block',
		setClassTiers(
			oneEdit,
			'weapon',
			setMapOverride(classDefaultsOf(oneEdit, 'weapon').tiers, 'half', 'baseColor', null),
		),
		undefined,
	);

	// The one key of the Game Config this tool writes.
	const world3d = {
		level: { cellSize: 1, zones: [{ id: 'gate', x: 2, z: 3 }] },
		spawns: [[0, 0, 0]],
	};
	const doc = {
		name: 'Arena',
		arcade: { world3d, characters: [{ id: 'runner', component: 'c1' }] },
		models: { profiles: { fx: { full: { lods: [0, 0] } } } },
		numReels: 5,
		updatedAt: '2026-11-18T00:00:00.000Z',
	};
	const docBefore = JSON.stringify(doc);
	const swapped = withModelsBlock(doc, built);
	same('withModelsBlock: the models key is the block', swapped.models, built);
	check(
		"…every other key is the loaded doc's own value, arcade.world3d included",
		swapped.name === doc.name &&
			swapped.arcade === doc.arcade &&
			swapped.arcade.world3d === world3d &&
			swapped.numReels === doc.numReels &&
			swapped.updatedAt === doc.updatedAt,
	);
	same('…in the key order it was loaded in', Object.keys(swapped), Object.keys(doc));
	check('…and the loaded doc is not changed', JSON.stringify(doc) === docBefore);
	const emptied = withModelsBlock(doc, undefined);
	check('withModelsBlock: an emptied block removes the models key', !('models' in emptied));
	same('…and leaves every other key exactly as it was', emptied, {
		name: doc.name,
		arcade: doc.arcade,
		numReels: doc.numReels,
		updatedAt: doc.updatedAt,
	});
	check('…arcade.world3d being the same object still', emptied.arcade.world3d === world3d);
	check(
		'withModelsBlock: a block that sets nothing removes the key too',
		!('models' in withModelsBlock(doc, { profiles: { prop: {} }, lodScreenSize: {} })),
	);
	const bare = { name: 'Arena', arcade: { world3d } };
	same('withModelsBlock: a doc with no block gets one', withModelsBlock(bare, built), {
		...bare,
		models: built,
	});
	same('…and is sent back as it was with nothing to set', withModelsBlock(bare, undefined), bare);
	same(
		'withModelsBlock: a doc saved with the block it was loaded with is sent back as it was',
		withModelsBlock(swapped, modelsBlockOf(swapped)),
		swapped,
	);

	// PARITY: what the page shows for a block is what the export resolves from it.
	let every: GameConfigModels | undefined;
	for (const [i, cls] of MODEL_CLASSES.entries()) {
		const base: ModelLodScreenSize = MODEL_CLASS_DEFAULTS[cls].lodScreenSize;
		every = setClassTiers(every, cls, {
			full: { encoding: { emissive: 'png' } },
			half: { maps: { baseColor: 64 << i, orm: 'drop' }, encoding: { normal: 'etc1s' } },
			quarter: { lods: [0, 0], maps: { normal: 128 } },
		});
		every = setClassScreenSize(every, cls, {
			levels: base.levels.map((size) => size / (i + 2)),
			...(base.ultra === undefined ? {} : { ultra: 0.9 - i / 10 }),
			cullBelow: 0.001 * (i + 1),
		});
	}
	for (const cls of MODEL_CLASSES) {
		const layer = inheritedFromBlock(cls, every);
		same(
			`${cls}: the layer the page shows for a block is resolveModelProfile's`,
			layer.tiers,
			storage.resolveModelProfile(cls, null, every),
		);
		same(
			`${cls}: …and its screen sizes are resolveLodScreenSize's`,
			layer.lodScreenSize,
			storage.resolveLodScreenSize(cls, null, every),
		);
		check(
			`${cls}: …neither being the code default`,
			JSON.stringify(layer.tiers) !== JSON.stringify(MODEL_CLASS_DEFAULTS[cls].tiers) &&
				JSON.stringify(layer.lodScreenSize) !==
					JSON.stringify(MODEL_CLASS_DEFAULTS[cls].lodScreenSize),
		);
		same(
			`${cls}: …and it is that class's entry of every layer`,
			inheritedLayers(every)[cls],
			layer,
		);
	}
	same(
		"a block for some classes: the layers the page computes are the server context's",
		inheritedLayers(modelsBlockOf({ models: configModels })),
		context.inherited,
	);
	same(
		'no block: every class inherits the code defaults',
		inheritedLayers(undefined),
		Object.fromEntries(
			MODEL_CLASSES.map((cls) => [
				cls,
				{
					tiers: MODEL_CLASS_DEFAULTS[cls].tiers,
					lodScreenSize: MODEL_CLASS_DEFAULTS[cls].lodScreenSize,
				},
			]),
		),
	);
}
{
	// "Keep my defaults": an unsaved block carried onto someone else's newer one.
	const base: GameConfigModels = {
		profiles: { prop: { half: { maps: { baseColor: 512 } } }, tile: { half: { lods: [1, 1] } } },
		lodScreenSize: { prop: { levels: [0.3, 0.1, 0.05, 0.01], cullBelow: 0.004 } },
	};
	const propMine = { half: { maps: { baseColor: 512 } }, quarter: { maps: { orm: 'drop' } } };
	const mine = setClassTiers(base, 'prop', propMine as TierOverrides);
	const theirs: GameConfigModels = {
		profiles: {
			hero: { quarter: { lods: [2, 3] } },
			prop: { half: { maps: { baseColor: 256 } } },
		},
		lodScreenSize: { prop: { levels: [0.5, 0.2, 0.1, 0.02], cullBelow: 0.01 } },
	};
	const kept = rebaseModelsBlock(base, mine, theirs);
	same('the class this author changed keeps their tiers', kept?.profiles?.prop, propMine);
	same(
		'…a class they left alone is the other author’s: added, or cleared',
		[kept?.profiles?.hero, kept?.profiles?.tile],
		[{ quarter: { lods: [2, 3] } }, undefined],
	);
	same(
		'…and so is a part of their own class they left alone (its screen sizes)',
		kept?.lodScreenSize?.prop,
		theirs.lodScreenSize?.prop,
	);
	same(
		'a class this author cleared stays cleared over the other author’s entry',
		rebaseModelsBlock(base, setClassTiers(base, 'prop', undefined), theirs)?.profiles?.prop,
		undefined,
	);
	same(
		'an author who changed nothing gets the other author’s block as it is',
		rebaseModelsBlock(base, base, theirs),
		canonicalModelsBlock(theirs),
	);
	same('…or none, when they cleared it', rebaseModelsBlock(base, base, undefined), undefined);
}

// ── 9. The edit session ─────────────────────────────────────────────────────────────────────────
console.log("9. the edit session of the project's defaults");
{
	// The real rune modules, compiled for the client as the app compiles them.
	const internalClient = import.meta.resolve('svelte/internal/client');
	const dir = mkdtempSync(join(tmpdir(), 'model-defaults-'));
	process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
	const sourceUrl = (rel: string) => new URL(`../src/${rel}`, import.meta.url);
	/** Compile `rel` and answer its file URL; `imports` re-points what it imports. */
	const runeModule = (rel: string, name: string, imports: Record<string, string> = {}): string => {
		const js = ts.transpileModule(readFileSync(sourceUrl(rel), 'utf8'), {
			compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
		}).outputText;
		let out = compileModule(js, { filename: `${name}.svelte.js`, generate: 'client' }).js.code;
		const points = { 'svelte/internal/client': internalClient, ...imports };
		for (const [from, to] of Object.entries(points))
			out = out.replaceAll(`'${from}'`, `'${to}'`).replaceAll(`"${from}"`, `"${to}"`);
		const file = join(dir, `${name}.mjs`);
		writeFileSync(file, out);
		return pathToFileURL(file).href;
	};
	const { ProjectDefaultsEdit } = (await import(
		runeModule('routes/(app)/models/projectDefaultsEdit.svelte.ts', 'projectDefaultsEdit', {
			'$lib/leaseState.svelte': runeModule('lib/leaseState.svelte.ts', 'leaseState'),
			'$lib/saveState.svelte': runeModule('lib/saveState.svelte.ts', 'saveState'),
			'$lib/models/projectDefaults': sourceUrl('lib/models/projectDefaults.ts').href,
			'./models.client': sourceUrl('routes/(app)/models/models.client.ts').href,
		})
	)) as { ProjectDefaultsEdit: typeof ProjectDefaultsEditClass };

	// A fake launcher: the lease table and the stored Game Config, answering as the routes do.
	type Doc = Record<string, unknown>;
	const calls: string[] = [];
	const puts: { doc: Doc; baseEtag?: unknown; force?: unknown }[] = [];
	let putCount = 0;
	let holder: 'me' | 'other' | null = null;
	let config: { doc: Doc; etag: string } | null = null;
	let version = 0;
	let unreadable = false;
	let leaseGate: Promise<void> | null = null;
	const answer = (status: number, body: unknown) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' },
		});
	const store = (doc: Doc) => (config = { doc, etag: `"v${++version}"` });
	const stored = () => {
		if (!config) throw new Error('fixture: no Game Config is stored');
		return config;
	};
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input), 'https://app.invalid');
		const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Doc;
		if (url.pathname === '/api/lease') {
			const action = String(body.action);
			calls.push(`lease ${action} ${String(body.toolId)}/${String(body.docKey)}`);
			if (action === 'release') {
				if (holder === 'me') holder = null;
				return answer(200, { released: true });
			}
			if (action === 'acquire' && leaseGate) await leaseGate;
			if (action === 'acquire' && holder === 'other') {
				const at = new Date().toISOString();
				return answer(200, {
					held: false,
					heldBy: {
						userId: 'u2',
						name: 'Bo',
						email: 'bo@example.com',
						mine: false,
						acquiredAt: at,
						heartbeatAt: at,
						expiresAt: at,
					},
					activeAgoMs: 1000,
				});
			}
			if (action === 'acquire' || action === 'takeover') holder = 'me';
			return answer(200, { held: holder === 'me', heartbeatMs: 10_000, ttlMs: 30_000 });
		}
		if (url.pathname === '/api/game-config' && url.searchParams.get('project') === P) {
			if ((init?.method ?? 'GET') === 'GET') {
				calls.push('config GET');
				if (unreadable) return answer(502, { message: 'Failed to load the game-config document.' });
				return answer(200, {
					clientKey: C,
					projectKey: P,
					doc: config?.doc ?? null,
					etag: config?.etag ?? null,
				});
			}
			calls.push('config PUT');
			const sent = body as { doc: Doc; baseEtag?: unknown; force?: unknown };
			puts.push(sent);
			putCount += 1;
			if (!config || sent.baseEtag !== config.etag)
				return answer(409, {
					ok: false,
					error: 'conflict',
					message: 'Someone else saved this config while you were editing.',
				});
			// As the save does: the block as the server reads it, put back last, and a new stamp.
			const kept = { ...sent.doc };
			delete kept.models;
			const models = normalizeGameConfigModels(sent.doc.models);
			const saved = store({
				...kept,
				updatedAt: `saved ${version + 1}`,
				...(models ? { models } : {}),
			});
			return answer(200, { clientKey: C, projectKey: P, ...saved, warnings: [] });
		}
		throw new Error(`fixture: unexpected request ${url.pathname}${url.search}`);
	}) as typeof fetch;

	const ACQUIRE = 'lease acquire gameConfig/gameConfig';
	const RELEASE = 'lease release gameConfig/gameConfig';
	const seed = (): Doc => ({
		name: 'Arena',
		arcade: { world3d: { level: { cellSize: 1 } }, characters: [{ id: 'runner' }] },
		numReels: 5,
		updatedAt: 'seed',
		models: modelsBlockOf({ models: configModels }),
	});
	const followed: { block: GameConfigModels | undefined; saved: boolean }[] = [];
	const sessions: ProjectDefaultsEditClass[] = [];
	const open = (enabled = true) => {
		const made = new ProjectDefaultsEdit({
			clientKey: C,
			projectKey: P,
			enabled,
			onStored: async (block, saved) => void followed.push({ block, saved }),
		});
		sessions.push(made);
		return made;
	};
	const fresh = (doc: Doc | null) => {
		calls.length = 0;
		puts.length = 0;
		followed.length = 0;
		holder = null;
		unreadable = false;
		config = null;
		if (doc) store(doc);
	};
	/** `doc` without its `models` key: what a save must send back exactly as it was loaded. */
	const rest = (doc: Doc) => withModelsBlock(doc, undefined);
	/** The save just made, or an empty one when none was: its checks then fail instead of throwing. */
	const firstPut = (): (typeof puts)[number] => puts[0] ?? { doc: {} };

	// Without the tool, and before an edit opens.
	fresh(seed());
	const denied = open(false);
	await denied.begin('prop');
	same(
		'without Invisible Game Config, Edit asks for no lease and reads nothing',
		[denied.editing, calls],
		[false, []],
	);
	const session = open();
	same(
		'a page that only shows models holds no Game Config lease',
		[session.editing, calls, holder],
		[false, [], null],
	);

	// Edit.
	await session.begin('prop');
	same('Edit takes the Game Config lease, then reads the Game Config', calls, [
		ACQUIRE,
		'config GET',
	]);
	same(
		'…and opens on the class asked for, clean, its draft the stored block, the lease held',
		[session.editing, session.cls, session.dirty, session.canEdit, session.draft, holder],
		[true, 'prop', false, true, modelsBlockOf(stored().doc), 'me'],
	);
	same('…telling the page what the store holds', followed, [
		{ block: modelsBlockOf(stored().doc), saved: false },
	]);
	same(
		'the layer it shows is the stored one, and its entry for the class',
		[session.layer, session.own],
		[context.inherited.prop, classDefaultsOf(modelsBlockOf(stored().doc), 'prop')],
	);

	session.cls = 'tile';
	session.setScreenSize({ levels: [0.1, 0.02], cullBelow: 0.004 });
	same(
		'screen sizes alone make the draft unsaved and put no derive out of date',
		[session.dirty, session.changesDeriveOf('tile')],
		[true, false],
	);
	session.cls = 'prop';
	session.setTiers(setMapOverride(session.own.tiers, 'half', 'baseColor', 256));
	session.cls = 'fx';
	session.setTiers({ full: { maps: { baseColor: 300 } } });
	same(
		'tiers put the derive of the classes they change out of date, and of no other',
		[
			session.changesDeriveOf('prop'),
			session.changesDeriveOf('fx'),
			session.changesDeriveOf('hero'),
		],
		[true, true, false],
	);

	// Save.
	const loaded = stored();
	const draft = session.draft;
	calls.length = 0;
	followed.length = 0;
	await session.save();
	same('Save is one PUT', calls, ['config PUT']);
	same(
		'…of the Game Config as it was loaded, with only its models block replaced by the draft',
		[rest(firstPut().doc), firstPut().doc.models],
		[rest(loaded.doc), draft],
	);
	same(
		'…against the ETag it loaded, never forced',
		[firstPut().baseEtag, 'force' in firstPut()],
		[loaded.etag, false],
	);
	same(
		'after it the draft is the block the server kept, clean',
		[session.dirty, session.saveState.status, session.draft],
		[false, 'saved', modelsBlockOf(stored().doc)],
	);
	check(
		'…so a value the server dropped (a 300² map) is gone from it',
		JSON.stringify(draft).includes('300') && !JSON.stringify(session.draft).includes('300'),
	);
	same('…the page is told a save landed', followed, [{ block: session.draft, saved: true }]);
	same('…and the session stays open, the lease held', [session.editing, holder], [true, 'me']);

	// A save over a Game Config someone else saved since (a forced save, an expired lease).
	const theirs = store({
		...stored().doc,
		name: 'Arena II',
		models: { profiles: { hero: { full: { lods: [0, 1] } } } },
	});
	session.cls = 'prop';
	session.setTiers(setLodsOverride(session.own.tiers, 'quarter', [1, 1]));
	const mine = session.draft;
	puts.length = 0;
	followed.length = 0;
	await session.save();
	same(
		'a save over a Game Config saved since is refused: nothing stored, the draft kept',
		[session.saveState.status, stored() === theirs, session.dirty, session.draft, followed],
		['conflict', true, true, mine, []],
	);
	await session.save();
	same('…and Save writes nothing more until a way out is picked', puts.length, 1);
	await session.reload(true);
	const kept = session.draft;
	same(
		'"Keep my defaults": their Game Config is read and what this author changed stays on it, unsaved',
		[session.saveState.status, session.dirty, classDefaultsOf(kept, 'prop').tiers],
		['idle', true, classDefaultsOf(mine, 'prop').tiers],
	);
	same(
		'…with the class the other author changed as they left it',
		classDefaultsOf(kept, 'hero').tiers,
		{ full: { lods: [0, 1] } },
	);
	puts.length = 0;
	await session.save();
	same(
		'…so the next save sends THEIR Game Config with only the models block replaced',
		[rest(firstPut().doc), firstPut().doc.models, firstPut().baseEtag, 'force' in firstPut()],
		[rest(theirs.doc), kept, theirs.etag, false],
	);
	same('…which is stored', [session.dirty, stored().doc.name], [false, 'Arena II']);

	const again = store({
		...stored().doc,
		models: { profiles: { tile: { half: { lods: [1, 1] } } } },
	});
	session.setTiers(undefined);
	await session.save();
	check('refused again', session.saveState.status === 'conflict' && session.dirty);
	await session.reload(false);
	same(
		'"Load theirs": the draft is their block, with nothing unsaved',
		[session.saveState.status, session.dirty, session.draft],
		['idle', false, modelsBlockOf(again.doc)],
	);

	// Done.
	calls.length = 0;
	await session.end();
	same(
		'Done gives the lease back and closes the session',
		[calls, session.editing, session.dirty, holder],
		[[RELEASE], false, false, null],
	);

	// Someone else holds the Game Config.
	fresh(seed());
	holder = 'other';
	const observer = open();
	await observer.begin('hero');
	same(
		'with someone else editing the Game Config the session opens read-only, naming them',
		[observer.editing, observer.readOnly, observer.canEdit, observer.lease.heldBy?.name],
		[true, true, false, 'Bo'],
	);
	observer.setTiers({ full: { lods: [0, 0] } });
	await observer.save();
	same('…where an edit and a save do nothing', [observer.dirty, puts.length], [false, 0]);
	await observer.lease.takeover();
	same('…until Take over', [observer.readOnly, observer.canEdit, holder], [false, true, 'me']);
	await observer.end();
	same('…and Done gives that lease back too', holder, null);

	// No Game Config, and one that cannot be read.
	fresh(null);
	const none = open();
	await none.begin('prop');
	same(
		'no Game Config: no session opens, the lease is given back and nothing is written',
		[none.editing, none.missing, calls, holder],
		[false, true, [ACQUIRE, 'config GET', RELEASE], null],
	);
	fresh(seed());
	unreadable = true;
	const failed = open();
	await failed.begin('prop');
	same(
		'a Game Config that cannot be read: no session, the lease given back, the reason shown',
		[failed.editing, holder, failed.error],
		[false, null, 'The Game Config could not be read (Failed to load the game-config document.).'],
	);
	unreadable = false;
	await failed.begin('prop');
	same('…and Edit opens once it can', [failed.editing, failed.error, holder], [true, '', 'me']);
	failed.setTiers({ full: { lods: [0, 0] } });
	const unsaved = failed.draft;
	const configWas = config;
	config = null;
	await failed.reload(true);
	same(
		'a Game Config gone while a session is open: the session stays, with its draft, the lease and the reason',
		[failed.editing, failed.missing, failed.draft, failed.error !== '', holder],
		[true, false, unsaved, true, 'me'],
	);
	config = configWas;
	await failed.reload(false);
	same('…and reads again once it is back', [failed.error, failed.dirty], ['', false]);
	await failed.end();

	// The lease is asked for once, and never outlives the page.
	fresh(seed());
	const twice = open();
	await Promise.all([twice.begin('prop'), twice.begin('hero')]);
	same(
		'Edit pressed twice asks for the lease once',
		[calls.filter((c) => c === ACQUIRE).length, twice.cls],
		[1, 'prop'],
	);
	await twice.end();

	fresh(seed());
	let openGate!: () => void;
	leaseGate = new Promise<void>((done) => (openGate = done));
	const gone = open();
	const opening = gone.begin('prop');
	check('Edit and Done are off while the lease is asked for', gone.busy && !gone.editing);
	gone.dispose();
	openGate();
	leaseGate = null;
	await opening;
	same(
		'a page that leaves while the lease is asked for gives it back when it lands, reading nothing',
		[gone.editing, holder, calls],
		[false, null, [ACQUIRE, RELEASE]],
	);

	same('in all, the only writes asked for were those four saves', putCount, 4);
	for (const made of sessions) made.dispose();
	globalThis.fetch = realFetch;
}

console.log(`check:model-viewer — ${passes}/${passes + failures} passed`);
if (failures) process.exit(1);
