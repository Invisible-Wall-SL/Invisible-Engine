/**
 * A game ships only the library sounds it can play (`soundReachability.ts`, `soundExport.ts`):
 *   pnpm --filter launcher-api check:sound-reachability
 *
 * The export copied every library entry into `deploy/sounds/`, and the game preloads every
 * catalogued sound at boot, so an unused take cost every player its download. Claims, each over
 * the rule, so a planted mutant can fail them (a guard that can't fail proves nothing):
 *
 *  1. Every sound the game can play ships, from each place a name can sit: the `/sound` choices
 *     (slots, a symbol's states, a pots token's moments, a coin's collect, the anticipation pair, a
 *     win tier), the legacy config and symbols docs, a mode's music, the layout (a screen
 *     timeline's cue, a `win` instance's `<alias>Sfx`, a reel grid's anticipation sound), a
 *     component def's timeline, a version the layout PINS, a per-project param default, the flow
 *     (its graph, a mode's graph, a group's body), the shared function library, and a cinematic
 *     (a `sfx:` / `music:` / `stop:` cue and a `pick` alternate). A sound named after a shipped
 *     audiosprite region ships with no doc naming it: the engine's own code plays it.
 *  2. A sound nothing names does not ship.
 *  3. Uncertainty keeps: a flow sound cue fed by a wire, an accessor or a data edge, in the flow or
 *     a library function, ships every sound.
 *  4. Through the REAL `exportProjectSounds` over mocked storage: `deploy/sounds/` and the catalog
 *     hold exactly the played sounds, a previously exported unplayed file is pruned, the pinned
 *     version is read by its number, the runtime pass's cinematics are used rather than re-read, an
 *     unreadable source or a partly read cinematic list ships everything, and a library of
 *     engine-named sounds only reads nothing else.
 *  5. The rule's two "not a source" claims still hold in the code: no FX effect plays a sound, and
 *     no runtime code reads a rig event's `audio`. Every shipped audiosprite region and every slot
 *     default is an engine name.
 */
import { mock } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

process.env.SOUND_TRANSCODE = '0';

// ── Mocked storage for claim 4 — registered before ANY server module loads, or the real
// loaders would already be in the module graph ──────────────────────────────────────────
const CLIENT = 'invisible_wall';
const PROJECT = 'remake';
const R2 = new Map<string, string>();
const keysUnder = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();
const reads: string[] = [];
let failSource: string | null = null;
let partialCinematics = false;
const read =
	<T>(label: string, value: () => T) =>
	async (...args: unknown[]): Promise<T> => {
		reads.push(args.length ? `${label}(${args.join(',')})` : label);
		if (failSource === label) throw new Error(`${label} unreadable`);
		return value();
	};
let library: { name: string; file: string }[] = [];
const server = (rel: string) => new URL(`../src/lib/server/${rel}`, import.meta.url).href;

mock.module(server('r2.ts'), {
	namedExports: {
		copyObject: async (from: string, to: string) => {
			const body = R2.get(from);
			if (body === undefined) return false;
			R2.set(to, body);
			return true;
		},
		putObjectText: async (key: string, text: string) => void R2.set(key, text),
		putObjectBytes: async (key: string, bytes: Uint8Array) => void R2.set(key, String(bytes)),
		getObjectText: async (key: string) => R2.get(key) ?? null,
		getObjectBytes: async () => null,
		headObject: async () => null,
		objectExists: async (key: string) => R2.has(key),
		listAllKeys: async (prefix: string) => keysUnder(prefix),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
	},
});
mock.module(server('soundsStorage.ts'), {
	namedExports: {
		loadSoundsDoc: async () => ({
			version: 1,
			entries: library.map((e, i) => ({ id: `s${i}`, kind: 'sfx', status: 'draft', origin: 'library', durationMs: 500, ...e })), // prettier-ignore
			bindings: SOURCES.bindings,
		}),
	},
});
mock.module(server('gameConfigStorage.ts'), {
	namedExports: {
		loadGameConfigDoc: read('config', () => SOURCES.config),
		loadGameConfigDocWithEtag: async () => ({ doc: SOURCES.config, etag: null }),
	},
});
mock.module(server('symbolsStorage.ts'), {
	namedExports: {
		loadSymbolsDoc: read('symbols', () => SOURCES.symbols),
		loadSymbolsDocWithEtag: async () => ({ doc: SOURCES.symbols, etag: null }),
	},
});
mock.module(server('editorStorage.ts'), {
	namedExports: { loadDoc: read('layout', () => SOURCES.layout) },
});
mock.module(server('componentStorage.ts'), {
	namedExports: {
		listComponents: read('componentDefs', () => [SOURCES.componentDefs?.[0]]),
		loadComponentForGame: read('pinned', () => SOURCES.componentDefs?.[1]),
	},
});
mock.module(server('componentDefaultsStorage.ts'), {
	namedExports: {
		listComponentDefaults: read('componentDefaults', () => SOURCES.componentDefaults),
	},
});
mock.module(server('flowV2Storage.ts'), {
	namedExports: { loadFlowV2Doc: read('flow', () => SOURCES.flow) },
});
mock.module(server('flowV2LibraryStorage.ts'), {
	namedExports: { loadFlowV2Library: read('flowLibrary', () => SOURCES.flowLibrary) },
});
const cinematics = () => Object.assign([...(SOURCES.cinematics ?? [])], partialCinematics ? { partial: true } : {}); // prettier-ignore
mock.module(server('cinematicExport.ts'), {
	namedExports: { loadAuthoredCinematics: read('cinematics', cinematics) },
});

const {
	ENGINE_SOUND_NAMES,
	collectSoundNames,
	namesSoundAtRunTime,
	playedSoundNames,
	shippedSoundEntries,
} = await import('../src/lib/server/soundReachability.ts');
type SoundSources = Parameters<typeof playedSoundNames>[0];

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
}

// ── The fixture project ─────────────────────────────────────────────────────────
const lit = (type: string, value: string) => ({ kind: 'literal', type: { t: 'enum', name: type }, value }); // prettier-ignore
const cueNode = (id: string, ref: string, name: unknown) => ({
	id,
	kind: 'fireCue',
	ref,
	inputs: { name },
});
const graph = (nodes: unknown[], data: unknown[] = []) => ({ nodes, exec: [], data });
const timeline = (keys: unknown[]) => ({ id: 'tl', tracks: [{ id: 'cues', kind: 'cue', keys }] });

/** Where each played sound is named — the claim's own label. */
const PLAYED: Record<string, string> = {
	slot_bed: 'a /sound slot',
	sym_land: "a symbol's state",
	token_fly: "a pots token's take-off",
	token_pot: "a pots token's arrival",
	coin_total: "a coin's collect into the total",
	tease_loop: 'the anticipation loop',
	tier_bed: "a win tier's bed",
	legacy_slot: "the legacy config's slot",
	legacy_tier: "the legacy config's win level",
	legacy_symbol: "the legacy symbols doc's per-symbol cue",
	legacy_tease: "the legacy symbols doc's anticipation",
	mode_bed: "a game mode's music",
	screen_cue: "a screen timeline's music cue",
	win_param: "a win instance's <alias>Sfx param",
	grid_tease: "a reel grid's anticipation sound",
	def_cue: "a component def's timeline cue",
	pinned_cue: 'a pinned component version only',
	default_param: 'a per-project component param default',
	flow_once: 'a flow cue',
	mode_flow: "a flow mode's graph",
	group_flow: "a flow group's body",
	lib_flow: 'a shared library function',
	cine_hit: "a cinematic's sfx cue",
	cine_pick: "a cinematic cue's pick alternate",
	cine_stop: "a cinematic's stop cue",
	sfx_btn_spin: 'nothing — the engine plays it',
};
const UNPLAYED = ['unused_take', 'draft_unused'];
const LIBRARY = [...Object.keys(PLAYED), ...UNPLAYED].map((name) => ({ name }));

const SOURCES: SoundSources = {
	bindings: {
		slots: { baseMusic: { names: ['slot_bed'] } },
		symbols: {
			H1: { land: 'sym_land' },
			POT_RED: { flyToMeter: 'token_fly', potArrive: 'token_pot' },
			COIN: { collectToTotal: 'coin_total' },
		},
		anticipation: { loop: 'tease_loop' },
		winTiers: { big: { bgm: 'tier_bed' } },
	},
	config: {
		sounds: { reelStop: { names: ['legacy_slot'] } },
		winLevels: [{ alias: 'mega', sound: { sfx: 'legacy_tier' } }],
		modes: [{ id: 'bonus', music: 'mode_bed' }],
	},
	symbols: {
		symbolSounds: { H2: { land: 'legacy_symbol' } },
		anticipation: { activationSound: 'legacy_tease' },
	},
	layout: {
		scenes: [
			{
				id: 'game',
				timelines: [timeline([{ time: 0, cue: 'music:screen_cue' }])],
				nodes: [
					{ kind: 'componentInstance', componentId: 'win', params: { bigSfx: 'win_param' } },
					{ kind: 'reelGrid', anticipation: { sound: 'grid_tease' } },
					{ kind: 'componentInstance', componentId: 'banner', componentVersion: 3 },
				],
			},
		],
	},
	componentDefs: [
		{ id: 'banner', version: 4, timelines: [timeline([{ time: 0, cue: 'sfx:def_cue' }])] },
		{ id: 'banner', version: 3, timelines: [timeline([{ time: 0, cue: 'sfx:pinned_cue' }])] },
	],
	componentDefaults: { win: { megaBgm: 'default_param' } },
	flow: {
		version: 2,
		graph: graph([
			cueNode('c1', 'soundOnce', lit('SoundEffectName', 'flow_once')),
			{ id: 'g1', kind: 'group', body: graph([cueNode('c2', 'soundOnce', lit('SoundEffectName', 'group_flow'))]) }, // prettier-ignore
		]),
		modes: { holdAndWin: { graph: graph([cueNode('c3', 'soundMusic', lit('MusicName', 'mode_flow'))]) } }, // prettier-ignore
	},
	flowLibrary: {
		version: 2,
		functions: [{ id: 'f1', body: graph([cueNode('c4', 'soundOnce', lit('SoundEffectName', 'lib_flow'))]) }], // prettier-ignore
	},
	cinematics: [
		{
			id: 'fired',
			tracks: [
				{
					kind: 'cue',
					keys: [
						{ time: 0, cue: 'sfx:cine_hit', sound: { pick: ['cine_pick'] } },
						{ time: 1, cue: 'stop:music:cine_stop' },
					],
				},
			],
		},
	],
};

/** A flow whose sound cue name is not a literal: wired, read by an accessor, or fed by an edge. */
const DYNAMIC: Record<string, Partial<SoundSources>> = {
	'a wired cue name': { flow: { graph: graph([cueNode('d', 'soundOnce', { kind: 'wire' })]) } },
	'a cue name read from the trigger': {
		flow: { graph: graph([cueNode('d', 'soundMusic', { kind: 'accessor', path: { on: 'trigger', member: 'name' } })]) }, // prettier-ignore
	},
	'a data edge into the cue name': {
		flow: {
			graph: graph(
				[cueNode('d', 'soundStop', undefined)],
				[{ from: { node: 'v', pin: 'out' }, to: { node: 'd', pin: 'name' } }],
			),
		},
	},
	"a library function's cue fed by its input": {
		flowLibrary: { functions: [{ body: graph([cueNode('d', 'soundLoop', { kind: 'accessor', path: { on: 'input', name: 'snd' } })]) }] }, // prettier-ignore
	},
};

type Rule = (entries: { name: string }[], sources: SoundSources) => string[];

/** The claims over a rule; returns the labels that failed. */
function claims(rule: Rule): string[] {
	const failed: string[] = [];
	const shipped = new Set(rule(LIBRARY, SOURCES));
	for (const [name, where] of Object.entries(PLAYED)) {
		if (!shipped.has(name)) failed.push(`1. ${name} ships (${where})`);
	}
	for (const name of UNPLAYED) if (shipped.has(name)) failed.push(`2. ${name} does not ship`);
	for (const [label, over] of Object.entries(DYNAMIC)) {
		const all = rule(LIBRARY, { ...SOURCES, ...over });
		if (all.length !== LIBRARY.length) failed.push(`3. ${label} ships every sound`);
	}
	return failed;
}

const real: Rule = (entries, sources) =>
	shippedSoundEntries(entries, playedSoundNames(sources)).map((e) => e.name);

// ── 1–3 on the real rule ─────────────────────────────────────────────────────────
check('claims: the real rule passes every claim', claims(real), []);

// ── …and each fails on a planted mutant ──────────────────────────────────────────
const without =
	(...keys: (keyof SoundSources)[]): Rule =>
	(entries, sources) =>
		real(entries, Object.fromEntries(Object.entries(sources).filter(([k]) => !keys.includes(k as keyof SoundSources)))); // prettier-ignore
const exactStrings = (value: unknown, into: Set<string>): void => {
	if (typeof value === 'string') into.add(value);
	else if (Array.isArray(value)) value.forEach((v) => exactStrings(v, into));
	else if (value && typeof value === 'object') Object.values(value).forEach((v) => exactStrings(v, into)); // prettier-ignore
};
const MUTANTS: Record<string, Rule> = {
	'ships everything (the old export)': (entries) => entries.map((e) => e.name),
	'exact strings only (a cue string is not parsed)': (entries, sources) => {
		if (namesSoundAtRunTime(sources.flow) || namesSoundAtRunTime(sources.flowLibrary))
			return entries.map((e) => e.name);
		const names = new Set(ENGINE_SOUND_NAMES);
		exactStrings(Object.values(sources), names);
		return entries.filter((e) => names.has(e.name)).map((e) => e.name);
	},
	'no engine names': (entries, sources) => {
		if (namesSoundAtRunTime(sources.flow) || namesSoundAtRunTime(sources.flowLibrary))
			return entries.map((e) => e.name);
		const names = new Set<string>();
		collectSoundNames(Object.values(sources), names);
		return entries.filter((e) => names.has(e.name)).map((e) => e.name);
	},
	'the /sound choices only': (entries, sources) => real(entries, { bindings: sources.bindings }),
	'without the legacy config and symbols docs': without('config', 'symbols'),
	'without the layout': without('layout'),
	'without the component defs': without('componentDefs'),
	'latest component defs only (no pinned version)': (entries, sources) =>
		real(entries, { ...sources, componentDefs: [sources.componentDefs?.[0]] }),
	'without the component param defaults': without('componentDefaults'),
	'without the flow': without('flow'),
	"the flow's top-level graph only": (entries, sources) => {
		const flow = sources.flow as { graph: { nodes: { kind: string }[] } };
		const flat = { graph: { ...flow.graph, nodes: flow.graph.nodes.filter((n) => n.kind !== 'group') } }; // prettier-ignore
		return real(entries, { ...sources, flow: flat });
	},
	'without the flow library': without('flowLibrary'),
	'without the cinematics': without('cinematics'),
	'never decides a name is built at run time': (entries, sources) => {
		const names = new Set(ENGINE_SOUND_NAMES);
		collectSoundNames(Object.values(sources), names);
		return entries.filter((e) => names.has(e.name)).map((e) => e.name);
	},
};
for (const [name, mutant] of Object.entries(MUTANTS)) {
	const failed = claims(mutant);
	check(`mutant "${name}" is caught`, failed.length > 0, true);
	if (failed.length) console.log(`  mutant "${name}" caught by: ${failed[0]}`);
}

// ── 4. Through the real export, over the mocked storage ─────────────────────────
const { exportProjectSounds } = await import('../src/lib/server/soundExport.ts');
const SRC = `${CLIENT}/${PROJECT}/sounds/files/`;
const OUT = `${CLIENT}/${PROJECT}/deploy/sounds/`;
const fileOf = (name: string) => `snd_${name}.mp3`;
const useLibrary = (names: string[]) => {
	library = names.map((name) => ({ name, file: fileOf(name) }));
	for (const name of names) R2.set(`${SRC}${fileOf(name)}`, `audio of ${name}`);
};
const exportNow = async (preloaded?: Parameters<typeof exportProjectSounds>[2]) => {
	reads.length = 0;
	const { catalog } = await exportProjectSounds(CLIENT, PROJECT, preloaded);
	return {
		catalog: catalog.sounds.map((s) => s.name).sort(),
		files: keysUnder(OUT).map((k) => k.slice(OUT.length)),
	};
};
const ALL = LIBRARY.map((e) => e.name);
const PLAYED_NAMES = Object.keys(PLAYED);

useLibrary(ALL);
R2.set(`${OUT}${fileOf('unused_take')}`, 'exported by an older export');
{
	const out = await exportNow();
	check(
		'export: the catalog lists exactly the played sounds',
		out.catalog,
		[...PLAYED_NAMES].sort(),
	);
	check(
		'export: deploy/sounds/ holds exactly their files and the index (an unplayed one is pruned)',
		out.files,
		[...PLAYED_NAMES.map(fileOf), 'index.json'].sort(),
	);
	check(
		'export: the index written is the catalog returned',
		(JSON.parse(R2.get(`${OUT}index.json`) ?? '{}').sounds as { name: string }[]).map((s) => s.name).sort(), // prettier-ignore
		[...PLAYED_NAMES].sort(),
	);
	check('export: the pinned version is read by its number', reads.includes(`pinned(banner,${PROJECT},3)`), true); // prettier-ignore
	check('export: a route call reads the cinematics itself', reads.includes(`cinematics(${CLIENT},${PROJECT})`), true); // prettier-ignore
}
{
	const preloaded = Promise.resolve(cinematics());
	const out = await exportNow({ cinematics: preloaded });
	check('export: the runtime pass hands its cinematics over', reads.some((r) => r.startsWith('cinematics')), false); // prettier-ignore
	check('export: …and a cinematic-only sound still ships', out.catalog.includes('cine_hit'), true);
}
for (const source of ['layout', 'componentDefs', 'pinned', 'flow', 'cinematics', 'config']) {
	failSource = source;
	const out = await exportNow();
	failSource = null;
	check(`export: an unreadable ${source} ships every sound`, out.catalog, [...ALL].sort());
}
{
	partialCinematics = true;
	const out = await exportNow();
	partialCinematics = false;
	check('export: a cinematic the listing could not read ships every sound', out.catalog, [...ALL].sort()); // prettier-ignore
}
{
	useLibrary(['sfx_btn_spin', 'bgm_main']);
	const out = await exportNow();
	check('export: engine-named sounds only ship whole', out.catalog, ['bgm_main', 'sfx_btn_spin']);
	check('export: …without reading a single other doc', reads, []);
}
{
	useLibrary([]);
	const out = await exportNow();
	check('export: an empty library reads nothing and ships nothing', [reads, out.catalog], [[], []]);
	check('export: …and prunes what an older export left', out.files, ['index.json']);
}

// ── 5. The "not a source" claims, held to the code ───────────────────────────────
const ROOT = new URL('../../../', import.meta.url).pathname;
function filesUnder(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(join(ROOT, dir))) {
		const rel = join(dir, entry);
		if (entry === 'node_modules' || entry.includes('fixture')) continue;
		if (statSync(join(ROOT, rel)).isDirectory()) out.push(...filesUnder(rel));
		else if (/\.(ts|svelte)$/.test(entry)) out.push(rel);
	}
	return out;
}
const PLAYS_SOUND = /playCueSound|registerCueSound|'sound(Once|Music|Loop)'|\.players\./;
check(
	'code: no FX effect plays a sound (effects are not a source)',
	filesUnder('packages/engine-fx/src').filter((f) => PLAYS_SOUND.test(readFileSync(join(ROOT, f), 'utf8'))), // prettier-ignore
	[],
);
check(
	"code: no runtime code reads a rig event's audio (rigs are not a source)",
	['apps/lines/src', 'packages/engine-layout/src', 'packages/engine-game/src']
		.flatMap(filesUnder)
		.filter((f) => /\baudioPath\b/.test(readFileSync(join(ROOT, f), 'utf8'))),
	[],
);
const sprite = JSON.parse(readFileSync(join(ROOT, 'apps/lines/static/assets/audio/sounds.json'), 'utf8')); // prettier-ignore
check(
	'code: every shipped audiosprite region is an engine name',
	Object.keys(sprite.sprite).filter((n) => !ENGINE_SOUND_NAMES.has(n)),
	[],
);
for (const ref of ['soundOnce', 'soundMusic', 'soundLoop', 'soundStop']) {
	check(
		`code: the vocabulary marks ${ref}'s name as a sound`,
		namesSoundAtRunTime({ nodes: [cueNode('x', ref, { kind: 'wire' })] }),
		true,
	);
}

console.log(`${checks - failures}/${checks} sound reachability claims hold.`);
if (failures) process.exit(1);
