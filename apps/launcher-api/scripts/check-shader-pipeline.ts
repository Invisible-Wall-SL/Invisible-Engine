/**
 * Contract check for the Invisible Shader Graph pipeline (`docs/design/invisible-shader-graph.md`
 * §8 step 4): a graph saved in the launcher reaches the game as a custom Element FX.
 *
 *   1. STORAGE — a graph is one file under the project's `shaders/`, beside the studio-shared
 *      `_shared/shaders/` it shadows; the id is a slug that always makes a valid `custom:<id>`; a
 *      save keeps a graph that does not compile and drops what is not part of the doc; a create on a
 *      taken id and a stale ETag are refused; the listing skips anything that is not a graph file.
 *   2. THE ROUTES — save and delete gate on the Scene Editor, the reads on the tools whose pickers
 *      list custom effects; a tab on another project is refused; a save without its precondition is
 *      a 400 and a conflict a 409.
 *   3. THE SHIP — the real export compiles the project's set into `deploy/editor-shaders/` (a file
 *      per effect and an index), names a graph that does not compile, prunes what an earlier export
 *      left, and the real export endpoint returns it; every exported effect is one the game's
 *      registry takes, so it plays as `custom:<id>`.
 *   4. THE WIRING — the bake and the runtime bundle both carry `shaderEffects`; the game registers
 *      them before its first render; the pull mirrors `editor-shaders/`; the Scene Editor and
 *      Symbols register the project's set and the Flow's kind dropdown lists it.
 *
 * `r2.ts` is an in-memory bucket honouring `If-Match` / `If-None-Match`; the tool gate, the deploy
 * token, the project lookup and the deploy lock are stubbed. Run:
 *
 *   pnpm --filter launcher-api check:shader-pipeline
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	customElementFxKind,
	isCustomElementFxKind,
	setCustomElementFx,
} from 'constants-shared/elementFx';
import { REFERENCE_GRAPHS, type ShaderGraphDoc } from 'engine-shadergraph';
import { readLF } from '../../../scripts/lib/read-lf.mjs';

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

/** Every runtime export a module declares, so a fake can stand in for all of them. */
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
});

const CLIENT = 'acme';
const PROJECT = 'shader-game';
const TOKEN = 'deploy-token';
/** The tool ids each gated call accepted, in order. */
const gates: string[][] = [];
let sessionProject = PROJECT;
fake('lib/server/toolScope.ts', {
	gate: async (
		_locals: unknown,
		_cookies: unknown,
		opts: { tool: string; altTools?: string[] },
	) => {
		gates.push([opts.tool, ...(opts.altTools ?? [])]);
		return { clientKey: CLIENT, projectKey: sessionProject, prefixes: [] };
	},
});
fake('lib/server/appSettings.ts', { getDeployToken: async () => TOKEN });
fake('lib/server/projects.ts', {
	DEFAULT_PROJECT_KEY: 'cloud',
	projectClientKey: async () => CLIENT,
});
fake('lib/server/runtimeBundleCache.ts', {
	withDeployWrite: async <T>(_project: string, run: () => Promise<T>) => run(),
});

const storage = await import('../src/lib/server/shaderStorage.ts');
const { exportShaders, shaderDeployPrefix } = await import('../src/lib/server/shaderExport.ts');
const { SHARED_SHADERS_PREFIX, SUB, shaderDocKey, shaderSlug, sharedShaderDocKey } =
	await import('../src/lib/server/projectPaths.ts');
const saveRoute = await import('../src/routes/api/shaders/save/+server.ts');
const deleteRoute = await import('../src/routes/api/shaders/delete/+server.ts');
const listRoute = await import('../src/routes/api/shaders/list/+server.ts');
const effectsRoute = await import('../src/routes/api/shaders/effects/+server.ts');
const docRoute = await import('../src/routes/api/shaders/doc/+server.ts');
const exportRoute = await import('../src/routes/api/editor/export-shaders/+server.ts');
const { composeFlowV2Vocab } = await import('../src/lib/flowV2Vocab.ts');
const { soundOptionsFor } = await import('../src/lib/soundOptions.ts');

const ref = (id: string): ShaderGraphDoc => {
	const doc = REFERENCE_GRAPHS.find((d) => d.id === id);
	if (!doc) throw new Error(`fixture: no reference graph ${id}`);
	return JSON.parse(JSON.stringify(doc)) as ShaderGraphDoc;
};
const projectDir = `${SUB.shaders(CLIENT, PROJECT)}/`;
const stored = (key: string): Record<string, unknown> =>
	JSON.parse(R2.get(key)?.body ?? 'null') as Record<string, unknown>;

type Handler = (event: never) => Promise<Response>;
const call = async (handler: unknown, init: { body?: unknown; query?: string }) => {
	const url = new URL(`https://launcher.test/api/x${init.query ?? ''}`);
	const request = new Request(url, {
		method: init.body === undefined ? 'GET' : 'POST',
		...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
	});
	try {
		const res = await (handler as Handler)({ url, request, locals: {}, cookies: {} } as never);
		return { status: res.status, body: (await res.json()) as Record<string, unknown> };
	} catch (e) {
		const status = (e as { status?: number }).status;
		if (typeof status === 'number') return { status, body: {} };
		throw e;
	}
};

// ── 1. Storage ─────────────────────────────────────────────────────────────────────────────────
console.log('1. storage');
for (const raw of ['Power Up!', '_hidden', '---', 'a'.repeat(80), 'Ünïcode glow', 'x/../../y']) {
	const slug = shaderSlug(raw);
	check(
		`the id ${json(raw)} makes a valid custom kind`,
		isCustomElementFxKind(customElementFxKind(slug)),
		true,
	);
}
check('a slug is its own slug', shaderSlug('power_up_'), 'power_up_');
check(
	'a project graph lives under shaders/',
	shaderDocKey(CLIENT, PROJECT, 'Pulse'),
	`${projectDir}pulse.json`,
);
check(
	'a shared graph lives under _shared/shaders/',
	sharedShaderDocKey('Pulse'),
	'_shared/shaders/pulse.json',
);

const pulse = { ...ref('pulseTint'), id: 'Pulse Tint', editorOnly: { zoom: 2 } };
const saved = await storage.saveShader(CLIENT, PROJECT, pulse, null);
check('a save slugs its id', saved.id, 'pulse_tint');
check(
	'the stored doc carries the slugged id',
	stored(`${projectDir}pulse_tint.json`).id,
	'pulse_tint',
);
check(
	'what is not part of the doc is dropped',
	'editorOnly' in stored(`${projectDir}pulse_tint.json`),
	false,
);
let conflict = '';
try {
	await storage.saveShader(CLIENT, PROJECT, pulse, null);
} catch (e) {
	conflict = e instanceof Error ? e.name : String(e);
}
check('a create on a taken id is refused', conflict, 'ConflictError');
conflict = '';
try {
	await storage.saveShader(CLIENT, PROJECT, pulse, '"stale"');
} catch (e) {
	conflict = e instanceof Error ? e.name : String(e);
}
check('a stale ETag is refused', conflict, 'ConflictError');
const resaved = await storage.saveShader(CLIENT, PROJECT, pulse, saved.etag);
check('the current ETag saves', typeof resaved.etag, 'string');

const broken = {
	...ref('ripple'),
	id: 'broken',
	name: 'Broken ripple',
	wires: [{ from: { node: 'nowhere', port: 'out' }, to: { node: 'out', port: 'color' } }],
};
await storage.saveShader(CLIENT, PROJECT, broken, null);
check(
	'a graph that does not compile is still saved, its wiring as written',
	(stored(`${projectDir}broken.json`).wires as unknown[]).length,
	1,
);

R2.set(`${SHARED_SHADERS_PREFIX}/power_up.json`, {
	body: JSON.stringify({ ...ref('powerUp'), id: 'power_up', name: 'Power-up (studio)' }),
	etag: '"s1"',
});
R2.set(`${SHARED_SHADERS_PREFIX}/pulse_tint.json`, {
	body: JSON.stringify({ ...ref('pulseTint'), id: 'pulse_tint', name: 'Studio pulse' }),
	etag: '"s2"',
});
R2.set(`${projectDir}backups/pulse_tint-1.json`, { body: '{}', etag: '"b"' });
R2.set(`${projectDir}Not A Slug.json`, { body: '{}', etag: '"n"' });
R2.set(`${projectDir}notes.txt`, { body: 'x', etag: '"t"' });
R2.set(`${projectDir}garbled.json`, { body: '{not json', etag: '"g"' });
const rows = await storage.listShaders(CLIENT, PROJECT);
check(
	'the list: the project graphs, then the shared ones it does not override, by name',
	rows.map((r) => [r.id, r.shared]),
	[
		['broken', false],
		['power_up', true],
		['pulse_tint', false],
	],
);
check(
	'a project graph shadows the shared one of its id',
	rows.find((r) => r.id === 'pulse_tint')?.name,
	pulse.name,
);
const sharedRead = await storage.loadShader(CLIENT, PROJECT, 'power_up', true);
check(
	'the shared library reads on its own',
	[sharedRead.exists, sharedRead.doc.name],
	[true, 'Power-up (studio)'],
);
const missing = await storage.loadShader(CLIENT, PROJECT, 'nothing');
check('a missing graph reads as a create', [missing.exists, missing.etag], [false, null]);

// ── 2. The routes ──────────────────────────────────────────────────────────────────────────────
console.log('2. the routes');
gates.length = 0;
const okSave = await call(saveRoute.POST, {
	body: { doc: { ...ref('frost'), id: 'Frost' }, baseEtag: null, projectKey: PROJECT },
});
check('save stores a new graph', [okSave.status, okSave.body.id], [200, 'frost']);
check('save gates on the Scene Editor alone', gates.at(-1), ['editor']);
check(
	'save without its precondition is a 400',
	(await call(saveRoute.POST, { body: { doc: ref('frost') } })).status,
	400,
);
const taken = await call(saveRoute.POST, {
	body: { doc: { ...ref('frost'), id: 'Frost' }, baseEtag: null },
});
check('save on a taken id is a 409 conflict', [taken.status, taken.body.error], [409, 'conflict']);
const elsewhere = await call(saveRoute.POST, {
	body: { doc: { ...ref('frost'), id: 'other' }, baseEtag: null, projectKey: 'another-game' },
});
check(
	'save from a tab on another project is refused',
	[elsewhere.status, elsewhere.body.error],
	[409, 'scope-mismatch'],
);
check('…and writes nothing', R2.has(`${projectDir}other.json`), false);
const listed = await call(listRoute.GET, { query: `?projectKey=${PROJECT}` });
check('list answers the set', (listed.body.shaders as unknown[]).length, 4);
check('the reads gate on the tools that pick Element FX', gates.at(-1), [
	'editor',
	'componentEditor',
	'symbols',
	'flow',
]);
check(
	'a read from a tab on another project is refused',
	(await call(listRoute.GET, { query: '?projectKey=another-game' })).status,
	409,
);
const read = await call(docRoute.GET, { query: '?id=frost' });
check(
	'doc answers the graph and its ETag',
	[read.body.exists, typeof read.body.etag],
	[true, 'string'],
);
const compiledForEditor = await call(effectsRoute.GET, {});
check(
	'effects answers the set compiled, and what did not compile',
	[
		(compiledForEditor.body.effects as unknown[]).length,
		(compiledForEditor.body.skipped as { id: string }[]).map((s) => s.id),
	],
	[3, ['broken']],
);
const deleted = await call(deleteRoute.POST, { body: { id: 'Pulse Tint', projectKey: PROJECT } });
check(
	'delete removes the project graph',
	[deleted.status, R2.has(`${projectDir}pulse_tint.json`)],
	[200, false],
);
check('…never the shared one', R2.has(`${SHARED_SHADERS_PREFIX}/pulse_tint.json`), true);
check(
	'…which now plays in its place',
	(await storage.listShaders(CLIENT, PROJECT)).find((r) => r.id === 'pulse_tint')?.shared,
	true,
);

// ── 3. The ship ────────────────────────────────────────────────────────────────────────────────
console.log('3. the ship');
const deployDir = shaderDeployPrefix(CLIENT, PROJECT);
R2.set(`${deployDir}stale.json`, { body: '{}', etag: '"x"' });
const exported = await exportShaders(CLIENT, PROJECT);
const kinds = exported.shaderEffects.map((e) => e.spec.kind);
check('the export compiles the set', kinds, [
	'custom:frost',
	'custom:power_up',
	'custom:pulse_tint',
]);
check(
	'…and names what does not compile',
	exported.skipped.map((s) => s.id),
	['broken'],
);
check('…with its errors', exported.skipped[0].errors.length > 0, true);
check(
	'deploy/editor-shaders/ holds a file per effect and an index, the stale one pruned',
	keysUnder(deployDir).map((k) => k.slice(deployDir.length)),
	['frost.json', 'index.json', 'power_up.json', 'pulse_tint.json'],
);
check(
	'a deployed file is the effect',
	stored(`${deployDir}frost.json`),
	JSON.parse(json(exported.shaderEffects[0])),
);
check(
	'the index lists the effects and the skipped',
	[
		(stored(`${deployDir}index.json`).effects as unknown[]).length,
		(stored(`${deployDir}index.json`).skipped as unknown[]).length,
	],
	[3, 1],
);
check(
	'every exported effect is one the game registers',
	setCustomElementFx(exported.shaderEffects).map((e) => e.spec.kind),
	kinds,
);
setCustomElementFx([]);
check(
	'the export endpoint refuses a bad token',
	(await call(exportRoute.POST, { query: `?project=${PROJECT}&k=nope`, body: {} })).status,
	401,
);
const endpoint = await call(exportRoute.POST, {
	query: `?project=${PROJECT}&k=${TOKEN}`,
	body: {},
});
check(
	'the export endpoint returns what the bake embeds',
	[
		endpoint.status,
		(endpoint.body.shaderEffects as unknown[]).length,
		(endpoint.body.skipped as unknown[]).length,
	],
	[200, 3, 1],
);
for (const key of keysUnder(projectDir)) R2.delete(key);
for (const key of keysUnder(`${SHARED_SHADERS_PREFIX}/`)) R2.delete(key);
const none = await exportShaders(CLIENT, PROJECT);
check(
	'a project with no graphs ships none',
	[none.shaderEffects.length, keysUnder(deployDir).map((k) => k.slice(deployDir.length))],
	[0, ['index.json']],
);

// ── 4. The wiring ──────────────────────────────────────────────────────────────────────────────
console.log('4. the wiring');
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = `${here}../../../`;
const bake = readLF(`${here}bake-editor-doc.mjs`);
check(
	'the bake calls the shader export',
	bake.includes('/api/editor/export-shaders?project='),
	true,
);
check(
	'…tolerates a launcher without it (404)',
	/else if \(res\.status !== 404\) \{\s*bail\(`Shader export failed/.test(bake),
	true,
);
check(
	'…and embeds what it returns',
	bake.includes('...(shaderEffects ? { shaderEffects } : {}),'),
	true,
);
const runtime = readLF(`${here}../src/lib/server/runtimeBundle.ts`);
check(
	'the runtime bundle runs the export',
	runtime.includes("step('shaders', timings, () => exportShaders(clientKey, projectKey)),"),
	true,
);
check(
	'…and carries it, absent when empty',
	runtime.includes(
		'...(shaderIndex.shaderEffects.length ? { shaderEffects: shaderIndex.shaderEffects } : {}),',
	),
	true,
);
const scenes = readLF(`${repo}apps/lines/src/editor-scenes.ts`);
check(
	'the game reads it off both bundles',
	scenes.includes('return source.shaderEffects ?? [];'),
	true,
);
check(
	'…and the stock-asset walk leaves it alone',
	/STOCK_DATA_READ_ELSEWHERE = new Set\(\[[^\]]*'shaderEffects'/.test(scenes),
	true,
);
const game = readLF(`${repo}apps/lines/src/components/Game.svelte`);
const registers = game.indexOf('setCustomElementFx(bakedShaderEffects());');
check('the game registers them at boot', registers > 0, true);
check('…before it renders', registers < game.indexOf('</script>'), true);
const reach = readLF(`${here}lib/assetReachability.mjs`);
check(
	'the pull mirrors editor-shaders/',
	/GENERATED_SUBTREES = \[[^\]]*'editor-shaders'/.test(reach),
	true,
);
const editorPage = readLF(`${here}../src/routes/(app)/editor/+page.svelte`);
check(
	'the Scene Editor registers the project set',
	editorPage.includes('registerCustomElementFx(untrack(() => data.customElementFx));'),
	true,
);
const symbolsPage = readLF(`${here}../src/routes/(app)/symbols/+page.svelte`);
check(
	'Symbols registers the project set',
	symbolsPage.includes('registerCustomElementFx(data.customElementFx)'),
	true,
);
const panel = readLF(`${here}../src/routes/(app)/editor/EditorElementFx.svelte`);
check(
	'the kind picker takes a registered custom kind',
	(panel.match(/if \(isPlayableElementFxKind\(kind\)\)/g) ?? []).length,
	2,
);
const flowPage = readLF(`${here}../src/routes/(app)/flow-v2/+page.svelte`);
check(
	'the Flow composes the project kinds',
	flowPage.includes('customFxKinds: data.customFxKinds ?? [],'),
	true,
);
const vocab = composeFlowV2Vocab(undefined, {
	sounds: soundOptionsFor(null),
	sceneCues: [],
	customFxKinds: ['custom:frost'],
});
const kindEnum = vocab.enums.find((e) => e.name === 'ElementFxKind')?.values ?? [];
check(
	'…and its kind dropdown lists them after the built-ins',
	[kindEnum.includes('shake'), kindEnum.at(-1)],
	[true, 'custom:frost'],
);

if (failures) {
	console.log(`\ncheck:shader-pipeline — ${failures} of ${checks} checks FAILED`);
	process.exit(1);
}
console.log(`\ncheck:shader-pipeline — all ${checks} checks passed`);
