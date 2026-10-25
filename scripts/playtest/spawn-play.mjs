// Plays spawning (game-families §3.3, P10.7) on the shared runtime, in the headless shell: the
// match-3 rules sample (`cg-match3`'s three seeds) with a Spawn layer added to its board screen and
// a few chains added to its starter flow. Two test components are baked beside the scene set:
// `spawnCoin` (a trigger `pop` → state `popped`, whose On enter raises the event `popped`) and
// `spawnRock` (no interface). The added chains:
//
//   - every 300 ms: Spawn a coin, then fire `pop` on it through an Instance ref;
//   - the coin's `popped` event (an Instance ref's event pin): Despawn the raiser, count `popped`;
//   - every 500 ms: Spawn a rock (never popped, so the layer fills to its cap of 4);
//   - `popped` reaching 6: `forEach` over `$live.field`, Despawn each.
//
// It reads the flow's trace (`?flowlog=1`) and checks what the game did: every spawn mounted and
// registered (its `pop` fire was not dropped), every coin's event ran its chain and despawned it,
// the cap refused spawns once full and never let more than 4 live, the sweep emptied the layer, and
// the page logged no error. It builds its own snapshot, so the current-games harness is not touched.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/spawn-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>]
//
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import { match3ReferenceLayout } from '../../packages/engine-layout/src/lib/referenceLayouts/index.ts';
import { MATCH3_DRIVEN_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/match3Seed.ts';
import { normalizeGameConfigDoc } from '../../packages/game-config/index.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/spawn-play') },
		seed: { type: 'string', default: '7' },
		chrome: { type: 'string' },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'spawn-sample';
const CAP = 4;

const rect = (id, color) => ({ id, kind: 'rect', x: 0, y: 0, width: 60, height: 60, color });
const def = (id, color, extra = {}) => ({
	id,
	name: id,
	version: 1,
	scope: 'project',
	category: 'ui',
	params: [],
	root: { id: 'root', kind: 'container', x: 0, y: 0, children: [rect(`${id}_face`, color)] },
	...extra,
});
const COIN = def('spawnCoin', 0xf5c542, {
	inputs: [{ id: 'pop', kind: 'trigger' }],
	events: [{ id: 'popped' }],
	stateMachine: {
		layers: [
			{
				id: 'main',
				entry: 'idle',
				states: [
					{ id: 'idle' },
					{ id: 'popped', onEnter: [{ id: 'raise', kind: 'raise', event: 'popped' }] },
				],
				transitions: [
					{ id: 't', from: 'idle', to: 'popped', conditions: [{ input: 'pop', op: 'fired' }] },
				],
			},
		],
	},
});
const ROCK = def('spawnRock', 0x7a8899);

const doc = match3ReferenceLayout();
const board = doc.scenes.find((s) => s.role === 'basegame');
board.nodes.push({
	id: 'field',
	kind: 'spawnLayer',
	label: 'Field',
	x: 120,
	y: 120,
	spawnable: [COIN.id, ROCK.id],
	placement: 'free',
	cap: CAP,
});

const at = { x: 0, y: 0 };
const lit = (value, t = 'float') => ({ kind: 'literal', type: { t }, value });
const wire = (from, fromPin, to, toPin) => ({
	from: { node: from, pin: fromPin },
	to: { node: to, pin: toPin },
});
const flow = JSON.parse(JSON.stringify(MATCH3_DRIVEN_SEED_DOC));
flow.variables = [
	...(flow.variables ?? []),
	{ id: 'popped', type: 'int', initial: 0, scope: 'game' },
];
flow.graph.nodes.push(
	{ id: 'sp_tickCoin', kind: 'onTick', every: 300, pos: at },
	{
		id: 'sp_coin',
		kind: 'spawn',
		layer: 'field',
		componentId: COIN.id,
		pos: at,
		inputs: { x: lit(0), y: lit(0) },
	},
	{ id: 'sp_popRef', kind: 'instanceRef', componentId: COIN.id, pos: at },
	{ id: 'sp_onPopped', kind: 'instanceRef', componentId: COIN.id, pos: at },
	{ id: 'sp_gone', kind: 'despawn', pos: at },
	{ id: 'sp_count', kind: 'changeVariable', variable: 'popped', op: 'add', pos: at },
	{ id: 'sp_tickRock', kind: 'onTick', every: 500, pos: at },
	{
		id: 'sp_rock',
		kind: 'spawn',
		layer: 'field',
		componentId: ROCK.id,
		pos: at,
		inputs: { x: lit(80), y: lit(0) },
	},
	{
		id: 'sp_six',
		kind: 'onVariable',
		variable: 'popped',
		on: 'crosses',
		threshold: 6,
		direction: 'up',
		pos: at,
	},
	{
		id: 'sp_sweep',
		kind: 'forEach',
		mode: 'sequence',
		pos: at,
		inputs: { in: { kind: 'accessor', path: { on: 'live', layer: 'field' } } },
	},
	{
		id: 'sp_sweepGone',
		kind: 'despawn',
		pos: at,
		inputs: { instance: { kind: 'accessor', path: { on: 'item' } } },
	},
);
flow.graph.exec.push(
	wire('sp_tickCoin', 'exec', 'sp_coin', 'exec'),
	wire('sp_coin', 'exec', 'sp_popRef', 'fire:pop'),
	wire('sp_onPopped', 'event:popped', 'sp_gone', 'exec'),
	wire('sp_gone', 'exec', 'sp_count', 'exec'),
	wire('sp_tickRock', 'exec', 'sp_rock', 'exec'),
	wire('sp_six', 'exec', 'sp_sweep', 'exec'),
	wire('sp_sweep', 'body', 'sp_sweepGone', 'exec'),
);
flow.graph.data.push(
	wire('sp_coin', 'instance', 'sp_popRef', 'instance'),
	wire('sp_onPopped', 'handle', 'sp_gone', 'instance'),
);

const builtins = Object.fromEntries(BUILTIN_COMPONENTS.map((d) => [d.id, d]));
const library = { ...builtins, [COIN.id]: COIN, [ROCK.id]: ROCK };
const work = mkdtempSync(join(tmpdir(), 'spawn-play-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);
writeFileSync(
	join(snapshot, 'runtime.json'),
	JSON.stringify({
		doc,
		componentDefs,
		componentDefaults: {},
		config: normalizeGameConfigDoc(
			JSON.parse(
				readFileSync(
					join(ROOT, 'apps/launcher-api/src/lib/data/gameConfig/match3.rules.json'),
					'utf8',
				),
			),
		),
		flowV2: flow,
	}),
);

const result = { shots: [], verdicts: [], trace: [] };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
verdict(
	'the bake ships both spawnables (placed nowhere; listed by the layer)',
	[COIN.id, ROCK.id].every((id) => id in componentDefs),
	Object.keys(componentDefs).filter((id) => id.startsWith('spawn')),
);

const ERRORS_HOOK = `(() => {
	const errors = (window.__SPAWN_ERRORS__ = []);
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
})();`;

const tree = testServerTree(join(work, 'tree'), resolve(opt.runtime), KEY, {
	protocol: 'lines',
	name: 'Spawn sample',
	projectKey: KEY,
});
const server = await startTestServer(tree, { SEED: opt.seed });
const snap = await serveSnapshot({
	dir: snapshot,
	name: 'Spawn sample',
	snapshotId: 'sample',
	assetBase: `${server.origin}/${KEY}/`,
});
const page = await openPage(headlessShell(opt.chrome), join(work, 'profile'));
await page.page('Page.addScriptToEvaluateOnNewDocument', { source: ERRORS_HOOK });

const params = new URLSearchParams({
	runtime: '1',
	project: KEY,
	k: 'spawn-play',
	editorDocBase: snap.origin,
	rgs_url: `${server.origin}/api/${KEY}/authoring`.replace(/^http:\/\//, ''),
	sessionID: `spawn-${opt.seed}`,
	lang: 'en',
	currency: 'USD',
	device: 'desktop',
	ie_determinism: opt.seed,
	m3seed: 'sample-8',
	flowlog: '1',
});
const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
const trace = async () =>
	((await page.evaluate('window.__IE_FLOW_V2_TRACE__ ?? []')) ?? []).filter((l) =>
		/^(spawn|despawn|instance|instanceEvent) /.test(l),
	);
let shots = 0;
const shot = async (label) => {
	await api(`step(1, { draw: 'last' })`);
	const file = `${String(++shots).padStart(2, '0')}-${label}.png`;
	writeFileSync(join(out, file), await page.screenshot());
	result.shots.push(file);
};
const play = (steps) =>
	playScenario({ steps }, { page, draw: 'last', capture: async (screen) => shot(screen) });

/** The live set after each trace line, replayed: `spawn … → id` adds, `despawn id` removes. */
const replay = (lines) => {
	const live = new Set();
	let most = 0;
	for (const line of lines) {
		const spawned = /^spawn \S+ \+ \S+ → (\S+)/.exec(line);
		const gone = /^despawn (\S+)/.exec(line);
		if (spawned) live.add(spawned[1]);
		if (gone) live.delete(gone[1]);
		most = Math.max(most, live.size);
	}
	return { live: [...live], most };
};

try {
	await page.navigate(`${server.origin}/${KEY}/?${params}`);
	for (let i = 0; i < 300; i++) {
		if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	await play([
		{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 },
		{ op: 'tapToStart' },
		{ op: 'waitFor', until: { playerIn: true, boardBusy: false } },
		// About 1.2 s: coins come and go, rocks pile up.
		{ op: 'step', frames: 70 },
		{ op: 'capture', screen: 'spawning' },
	]);
	const early = await trace();
	const coins = early.filter((l) => /^spawn field \+ spawnCoin → /.test(l)).length;
	const fired = early.filter((l) => /^instance field#\d+ ▸ pop$/.test(l)).length;
	const raised = early.filter((l) => /^instanceEvent ▶ field#\d+ onpopped$/.test(l)).length;
	verdict('coins spawn on the 300 ms tick', coins >= 3, early);
	verdict(
		'each spawned coin mounted and registered: its `pop` reached it (never dropped)',
		fired === coins && !early.some((l) => /dropped/.test(l)),
		{ coins, fired },
	);
	verdict(
		'each popped coin raised `popped`, whose Instance-ref chain despawned it',
		raised >= coins - 1 && early.filter((l) => /^despawn field#\d+$/.test(l)).length >= raised,
		{ raised },
	);

	await play([
		{ op: 'step', frames: 160 },
		{ op: 'capture', screen: 'full' },
	]);
	const mid = await trace();
	const capRefusals = mid.filter((l) => /refused \(cap\)/.test(l)).length;
	verdict('the cap refuses spawns once the layer is full', capRefusals > 0, capRefusals);
	verdict(`never more than ${CAP} live at once`, replay(mid).most <= CAP, replay(mid));

	// The sixth pop crosses the threshold: the sweep despawns every live instance.
	const swept = mid.findIndex((l, i) => {
		// After the 6th `instanceEvent`, a run of despawns with no spawn between empties the set.
		const popsBefore = mid.slice(0, i).filter((x) => x.startsWith('instanceEvent')).length;
		return popsBefore >= 6 && replay(mid.slice(0, i + 1)).live.length === 0;
	});
	verdict('the `popped` ≥ 6 sweep (forEach over $live, Despawn) empties the layer', swept >= 0, {
		at: swept,
	});

	const errors = await page.evaluate('window.__SPAWN_ERRORS__');
	verdict('no page error', errors.length === 0, errors);
	result.trace = mid;
} finally {
	await page.close();
	await server.close?.();
	await snap.close?.();
	rmSync(work, { recursive: true, force: true });
}

writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
for (const v of result.verdicts) console.log(`${v.ok ? '  ok ' : 'FAIL '} ${v.name}`);
const failed = result.verdicts.filter((v) => !v.ok).length;
console.log(failed ? `\nspawn play: ${failed} FAILED` : '\nspawn play: OK');
process.exit(failed ? 1 : 0);
