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
 *  3. THE PROFILE THE PAGE SHOWS IS THE EXPORT'S. `effectiveProfile` over the inherited layer equals
 *     `resolveModelProfile` for every class; each value names its source (this model, Game Config,
 *     default); every override edit leaves exactly what a save stores.
 *  4. THE REPORT. Budgets, the LOD chain, textures, names and sockets and the tier windows, from the
 *     facts alone; a stored issue no row recomputes is still listed.
 *  5. SAVE is a compare-and-swap on the ETag the author loaded: a stale one is a 409 that changes
 *     nothing, and so is a doc someone else writes between this save's read and its write; a save
 *     keeps the master, the facts and the report; a class change re-runs the validator on the
 *     master.
 *  6. THE VIEWER'S DERIVE writes every tier of one model under `models/<id>/derived/` (a tier equal
 *     to `full` is listed, not written), names only files that exist, leaves `deploy/` and
 *     `model.json` alone, says which `model.json` it read, goes stale when the settings change,
 *     replaces the folder whole on the next derive, and warms the export's texture cache. One
 *     derive of a model at a time and two at most at once; one that fails part-way reads as "not
 *     derived", and neither a failed nor a throwing one holds up the next.
 *  7. THE ROUTES, called as SvelteKit calls them: `baseEtag` is required and never empty on save
 *     and register; a lost save answers 409 `{ error: 'conflict', message }`; a derive answers with
 *     the index and the doc version it read.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	MODEL_CLASSES,
	MODEL_CLASS_DEFAULTS,
	MODEL_TIERS,
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
	lodsSource,
	mapSource,
	overrideCount,
	screenSizeSource,
	setEncodingOverride,
	setLodsOverride,
	setMapOverride,
	type TierOverrides,
} from '../src/lib/models/modelProfile.ts';
import { buildModelReport, reportCounts } from '../src/lib/models/modelReport.ts';
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
/** While set, every binary write whose key matches waits for `gate`; `parked` counts them. */
let hold: { match: (key: string) => boolean; gate: Promise<void>; parked: number } | null = null;
/** How often each key was read with its ETag: a model.json read is a save or a derive starting. */
const reads = new Map<string, number>();
/** One shot: runs right after the next read of that key (someone writing between a read and a write). */
const afterRead = new Map<string, () => void>();
/** One shot: the next binary write under this prefix fails. */
let failWriteUnder: string | null = null;
/** One shot: the next read of this key throws. */
let failReadOf: string | null = null;
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
		getObjectBytes: async (key: string) => {
			const b = R2.get(key);
			return b ? { body: b, etag: etagOf(b), contentType: '' } : null;
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
			if (failWriteUnder && key.startsWith(failWriteUnder)) {
				failWriteUnder = null;
				throw new Error('fixture: R2 refused the write');
			}
			const held = hold;
			if (held?.match(key)) {
				held.parked += 1;
				await held.gate;
			}
			return write(key, body, cond);
		},
		headObject: async (key: string) => {
			const b = R2.get(key);
			return b ? { etag: etagOf(b), size: b.byteLength, lastModified: 0 } : null;
		},
		listAllKeys: async (prefix: string) =>
			[...R2.keys()].filter((k) => k.startsWith(prefix)).sort(),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
		deleteObject: async (key: string) => void R2.delete(key),
		presignPut: async (key: string) => `https://r2.invalid/${key}?sig`,
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
	const derivedPrefix = paths.modelDerivedPrefix(C, P, 'orb');
	const deployPrefix = `${paths.SUB.deploy(C, P)}/`;
	const before = await viewer.loadModelDetail(C, P, 'orb');
	check('never derived: no index', before?.derived === null && !!before.deriveInputs);

	const docBefore = text(docKey);
	const first = await viewer.deriveModelForViewer(C, P, 'orb');
	check('the derive answers', first.ok, JSON.stringify(first));
	if (!first.ok) throw new Error('the derive failed; the rest of the fixture needs it');
	const filesOf = () => under(derivedPrefix).map((k) => k.slice(derivedPrefix.length));
	const tiersWritten = Object.keys(first.derived.tiers).sort();
	same(
		'every tier is derived, published or not; ultra equals full on a 256² master with no LODU',
		[tiersWritten, first.derived.sameAsFull],
		[['full', 'half', 'quarter'], ['ultra']],
	);
	check(
		'it writes the GLBs, index.json and _tex/ under models/orb/derived/',
		['orb.glb', 'orb@half.glb', 'orb@quarter.glb', 'index.json'].every((f) =>
			filesOf().includes(f),
		) &&
			filesOf().some((f) => f.startsWith('_tex/')) &&
			!filesOf().some((f) => f.includes('@ultra')),
		filesOf().join(' '),
	);
	const allNamed = (index: typeof first.derived) =>
		Object.values(index.tiers).every(
			(t) =>
				R2.has(derivedPrefix + t.glb) &&
				Object.values(t.maps).every((m) => m === 'dropped' || R2.has(derivedPrefix + m.file)),
		);
	check('every file the index names exists', allNamed(first.derived));
	check(
		'every tier carries tris, bytes and VRAM',
		Object.values(first.derived.tiers).every(
			(t) => t.bytes > 0 && t.vramBytes > 0 && t.lods.length > 0 && t.lods.every((l) => l.tris > 0),
		),
	);
	check('deploy/ is untouched', under(deployPrefix).length === 0, under(deployPrefix).join(' '));
	check('model.json is untouched', text(docKey) === docBefore);
	const opened = await viewer.loadModelDetail(C, P, 'orb');
	check(
		'opened again: the derive is current',
		!!opened?.derived && opened.derived.inputs === opened.deriveInputs,
	);

	// The export after it encodes nothing these tiers share.
	R2.set(
		paths.editorDocKey(C, P),
		enc(
			JSON.stringify({
				resolutionTiers: ['half', 'quarter'],
				scenes: [{ id: 'a', nodes: [{ id: 'n', props: { modelId: 'orb' } }] }],
			}),
		),
	);
	const cachePrefix = `${paths.SUB.models(C, P)}/_cache/`;
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

	// Settings change → stale → the next derive replaces the folder.
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
		'the stored derive is now out of date',
		!!stale?.derived && stale.derived.inputs !== stale.deriveInputs,
	);
	check('…and the save said so', tuned.ok && tuned.deriveInputs === stale?.deriveInputs);
	const oldFiles = filesOf();
	const deployed = under(deployPrefix).length;
	const second = await viewer.deriveModelForViewer(C, P, 'orb');
	check('the next derive answers', second.ok, JSON.stringify(second));
	if (second.ok) {
		check('half now drops its normal map', second.derived.tiers.half?.maps.normal === 'dropped');
		const now = await viewer.loadModelDetail(C, P, 'orb');
		check(
			'it is current for the stored model, and says which model.json it read',
			second.derived.inputs === now?.deriveInputs && second.docEtag === now?.etag,
			JSON.stringify([second.derived.inputs, now?.deriveInputs, second.docEtag, now?.etag]),
		);
		const named = new Set<string>(['index.json']);
		for (const t of Object.values(second.derived.tiers)) {
			named.add(t.glb);
			for (const m of Object.values(t.maps)) if (m !== 'dropped') named.add(m.file);
		}
		same('the folder holds exactly what the index names', filesOf(), [...named].sort());
		check(
			'a file only the old derive used is gone',
			oldFiles.some((f) => !filesOf().includes(f)),
		);
		check('deploy/ is still untouched by a derive', under(deployPrefix).length === deployed);
	}

	// The queue. A derive's first act is to read its model.json, so that read is "it started".
	const docOf = (id: string) => paths.modelDocKey(C, P, id);
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

	// One at a time per model: the first is held at its first write.
	let open!: () => void;
	hold = {
		match: (key) => key.startsWith(derivedPrefix),
		gate: new Promise<void>((r) => (open = r)),
		parked: 0,
	};
	reads.clear();
	const a = viewer.deriveModelForViewer(C, P, 'orb');
	check('a derive is held at its first write', await parkedAt(1));
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
	check('…and the folder is whole', second2.ok && allNamed(second2.derived));

	// Two at once at most: with two held, a third model's derive does not start.
	const modelsPrefix = `${paths.SUB.models(C, P)}/`;
	hold = {
		match: (key) =>
			key.startsWith(modelsPrefix) && key.includes('/derived/') && !key.includes('/third/'),
		gate: new Promise<void>((r) => (open = r)),
		parked: 0,
	};
	reads.clear();
	const two = [
		viewer.deriveModelForViewer(C, P, 'orb'),
		viewer.deriveModelForViewer(C, P, 'spare'),
	];
	check('two derives are held at their first write', await parkedAt(2));
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

	// Failures. Part-way: the answer is a 422 and the model reads as not derived.
	failWriteUnder = derivedPrefix;
	const failed = await viewer.deriveModelForViewer(C, P, 'orb');
	check(
		'a derive that fails part-way answers 422',
		!failed.ok && failed.status === 422,
		JSON.stringify(failed),
	);
	same(
		'…and reads as not derived, never as the last derive over other files',
		(await viewer.loadModelDetail(C, P, 'orb'))?.derived,
		null,
	);
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
	check('…and the next derive of that model still runs', after.ok && allNamed(after.derived));

	const missing = await viewer.deriveModelForViewer(C, P, 'ghost');
	check('an unknown model is a 404', !missing.ok && missing.status === 404);
	R2.delete(paths.modelSourceKey(C, P, 'spare', orbDoc!.source.file));
	const noMaster = await viewer.deriveModelForViewer(C, P, 'spare');
	check('a model whose master is gone is a 404', !noMaster.ok && noMaster.status === 404);
}

// ── 7. The routes ───────────────────────────────────────────────────────────────────────────────
console.log('7. the routes');
{
	mock.module(src('modelAccess.ts'), {
		namedExports: {
			MODELS_TOOL: 'models',
			requireModelAccess: async () => ({ id: 'u', role: 'artist' }),
		},
	});
	mock.module(src('toolScope.ts'), {
		namedExports: { requireProjectScope: async () => ({ clientKey: C, projectKey: P }) },
	});
	/** POST a JSON body to a route's real handler; a thrown `error()` is its status and body. */
	const post = async (
		name: string,
		body: unknown,
	): Promise<{ status: number; body: Record<string, unknown> }> => {
		const { POST } = (await import(
			new URL(`../src/routes/api/models/${name}/+server.ts`, import.meta.url).href
		)) as { POST: (event: unknown) => Promise<Response> };
		try {
			const res = await POST({
				request: new Request('https://app.invalid/', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body),
				}),
				url: new URL(`https://app.invalid/api/models/${name}?project=${P}`),
				locals: {},
			});
			return { status: res.status, body: (await res.json()) as Record<string, unknown> };
		} catch (e) {
			const thrown = e as { status?: unknown; body?: Record<string, unknown> };
			if (typeof thrown.status !== 'number') throw e;
			return { status: thrown.status, body: thrown.body ?? {} };
		}
	};
	const settings = { id: 'orb', class: 'prop', overrides: null, lodScreenSize: null };
	const live = etagOf(R2.get(docKey)!);
	const before = text(docKey);

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
	check('none of them wrote', text(docKey) === before);
	const saved = await post('save', { ...settings, baseEtag: live });
	same(
		'a save against the live ETag answers the doc, its ETag and the derive key',
		[saved.status, typeof saved.body.doc, saved.body.etag, typeof saved.body.deriveInputs],
		[200, 'object', etagOf(R2.get(docKey)!), 'string'],
	);

	const upload = { id: 'orb', upload: '00000000-0000-4000-8000-000000000000', class: 'prop' };
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

same(
	'the tier list the page shows is the model tiers',
	MODEL_TIERS,
	Object.keys(MODEL_CLASS_DEFAULTS.prop.tiers),
);

console.log(`check:model-viewer — ${passes}/${passes + failures} passed`);
if (failures) process.exit(1);
