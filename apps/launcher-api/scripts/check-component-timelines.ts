/**
 * Component timelines (Rive plan Phase 4b) — authored on a component, played by its instances:
 *   pnpm --filter launcher-api check:component-timelines
 *
 *  1. the registry keeps exactly the component-hosted timelines with a `playOn`, under the host and
 *     every `playOnComponents` id;
 *  2. a per-instance player starts on its signal, holds its last frame, reports its cues, and lets
 *     the most recently started timeline win a node two of them drive;
 *  3. TWO instances play independently: a fire heard through one instance's signal scope moves only
 *     that instance's playhead (the same `scopeMatches` rule `ComponentInstance` applies);
 *  4. reuse binds by node name, and validation flags a reused-on component that lacks a name;
 *  5. the ship chain: a component timeline no Flow node names is still exported to `deploy/` and
 *     embedded for the game (rule 8), and it seeds no rig the export would then miss.
 *
 * Runs the real `engine-layout` player and the real `cinematicExport` / `cinematicStorage` over an
 * in-memory R2. What it cannot prove: the Svelte wiring in `ComponentInstance.svelte` (ticker,
 * context) — that is the owner's browser check.
 */
import { mock } from 'node:test';
import type { CinematicDoc, LayoutNode } from 'engine-layout';
import { scopeMatches, scopeOf } from '../../../packages/utils-event-emitter/src/scope.ts';

const bucket = new Map<string, string>();
const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('r2.ts'), {
	namedExports: {
		ConflictError: class extends Error {},
		precondition: () => undefined,
		getObjectTextWithEtag: async (key: string) => {
			const text = bucket.get(key);
			return text === undefined ? null : { text, etag: '"e"' };
		},
		putObjectText: async (key: string, text: string) => {
			bucket.set(key, text);
			return '"e"';
		},
		deleteObject: async (key: string) => void bucket.delete(key),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => bucket.delete(k)),
		listAllObjects: async (prefix: string) =>
			[...bucket.keys()]
				.filter((key) => key.startsWith(prefix))
				.map((key) => ({ key, size: 0, lastModified: 0 })),
	},
});

const L = await import('../../../packages/engine-layout/src/lib/componentTimelines.ts');
const N = await import('../../../packages/engine-layout/src/lib/cinematicNodes.ts');
const { cinematicKey } = await import('../src/lib/server/cinematicStorage.ts');
const { cinematicRigNames, exportCinematics, loadAuthoredCinematics } =
	await import('../src/lib/server/cinematicExport.ts');
const S = await import('../src/lib/timeline/screenTimeline.ts');

let failures = 0;
let passes = 0;
function eq(name: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passes++;
		return;
	}
	failures++;
	console.error(`✗ ${name}\n    expected ${e}\n    got      ${a}`);
}

// ---- fixtures ----------------------------------------------------------------------------------

const coinNodes: LayoutNode[] = [
	{ id: 'n_glow', kind: 'sprite', label: 'Glow', x: 0, y: 0 } as LayoutNode,
	{
		id: 'n_box',
		kind: 'container',
		label: 'Box',
		x: 0,
		y: 0,
		children: [{ id: 'n_coin', kind: 'sprite', label: 'Coin', x: 0, y: 0 } as LayoutNode],
	} as LayoutNode,
];
const gemNodes: LayoutNode[] = [
	{ id: 'g1', kind: 'sprite', label: 'Coin', x: 0, y: 0 } as LayoutNode,
];

function timeline(
	id: string,
	opts: { playOn?: string; target?: string; also?: string[]; host?: CinematicDoc['host'] } = {},
): CinematicDoc {
	const target = opts.target ?? 'Coin';
	return {
		...S.newComponentTimeline({ id, name: id, componentId: 'coin', playOn: opts.playOn }),
		...(opts.host ? { host: opts.host } : {}),
		...(opts.also ? { playOnComponents: opts.also } : {}),
		duration: 1,
		stage: { sceneId: null, cast: [{ actorId: 'a', kind: 'node', target, place: {} }] },
		tracks: [
			{
				id: 'p',
				kind: 'property',
				actorId: 'a',
				channels: {
					y: [
						{ time: 0, value: -100 },
						{ time: 1, value: 0 },
					],
					alpha: [
						{ time: 0, value: 0 },
						{ time: 1, value: 1 },
					],
				},
			},
			{
				id: 'c',
				kind: 'cue',
				actorId: '',
				keys: [{ time: 0.5, cue: 'signal:landed' }],
			},
		],
	} as unknown as CinematicDoc;
}

// ---- 1. registry -------------------------------------------------------------------------------

L.registerComponentTimelines([
	timeline('pop', { playOn: 'enter', also: ['gem'] }),
	timeline('silent'),
	timeline('screen', { playOn: 'enter', host: { kind: 'screen', sceneId: 'base' } }),
]);
eq(
	'a component timeline with playOn is registered on its host',
	L.componentTimelinesFor('coin').map((d) => d.id),
	['pop'],
);
eq(
	'...and on every playOnComponents id',
	L.componentTimelinesFor('gem').map((d) => d.id),
	['pop'],
);
eq(
	'no playOn ⇒ nothing plays it; a screen timeline is not a component one',
	L.componentTimelinesFor('base'),
	[],
);
L.registerComponentTimelines([]);
eq('re-registering replaces the set (parity when none)', L.componentTimelinesFor('coin'), []);

// ---- 2. one player -----------------------------------------------------------------------------

const pop = timeline('pop', { playOn: 'enter' });
const player = new L.ComponentTimelinePlayer([pop], coinNodes);
eq('the player lists its signals', player.signals(), ['enter']);
eq(
	'it drives the named node, nested or not, by its id',
	[...player.drivenNodes().keys()],
	['n_coin'],
);
eq('before any signal the node renders as authored', player.sample('n_coin'), undefined);
eq('another signal starts nothing', player.trigger('win'), false);
eq('its own signal starts it', player.trigger('enter'), true);
eq('at 0 it samples the first key', player.sample('n_coin'), { y: -100, alpha: 0 });
// Frame-sized steps: a step over `cuesCrossed`'s seek limit fires no cue, as in the player.
const halfCues: string[] = [];
for (let i = 0; i < 5; i++) halfCues.push(...player.advance(0.1).cues);
eq('half way', player.sample('n_coin'), { y: -50, alpha: 0.5 });
eq('a crossed cue is reported once', halfCues, ['signal:landed']);
const end = player.advance(0.6);
eq('the end is reported once', end.completed, ['pop']);
eq('...and the last frame HOLDS', player.sample('n_coin'), { y: 0, alpha: 1 });
eq('a finished timeline is no longer playing', player.isPlaying(), false);
eq('a held timeline does not complete again', player.advance(0.1).completed, []);
player.trigger('enter');
eq('a second fire restarts it from 0', player.timeOf('pop'), 0);

const fade = {
	...timeline('fade', { playOn: 'win' }),
	tracks: [
		{
			id: 'p2',
			kind: 'property',
			actorId: 'a',
			channels: { alpha: [{ time: 0, value: 0.25 }] },
		},
	],
} as unknown as CinematicDoc;
const both = new L.ComponentTimelinePlayer([pop, fade], coinNodes);
eq(
	'channels on a node driven by two timelines are their union',
	[...(both.drivenNodes().get('n_coin') ?? [])].sort(),
	['alpha', 'y'],
);
both.trigger('enter');
both.advance(0.5);
both.trigger('win');
eq('the most recently started timeline wins the node', both.sample('n_coin'), { alpha: 0.25 });

// ---- 3. two instances --------------------------------------------------------------------------

/** What `ComponentInstance` does with a fire: hear it through the instance scope, then trigger. */
function instance(scopeValue: string) {
	const scope = scopeOf('pot', scopeValue);
	const p = new L.ComponentTimelinePlayer([timeline('win', { playOn: 'potWin' })], coinNodes);
	return {
		player: p,
		fire: (signal: string, firedScope?: string) => {
			if (scopeMatches(scope, firedScope)) p.trigger(signal);
		},
	};
}
const red = instance('red');
const blue = instance('blue');
red.fire('potWin', scopeOf('pot', 'red'));
blue.fire('potWin', scopeOf('pot', 'red'));
red.player.advance(0.25);
blue.player.advance(0.25);
eq('the red instance heard its own fire and plays', red.player.timeOf('win'), 0.25);
eq('the blue instance did not hear red and stays put', blue.player.timeOf('win'), undefined);
blue.fire('potWin', scopeOf('pot', 'blue'));
blue.player.advance(0.5);
eq('blue starts on its own fire, from 0', blue.player.timeOf('win'), 0.5);
eq('...without moving red', red.player.timeOf('win'), 0.25);
red.fire('potWin');
blue.fire('potWin');
eq(
	'an unscoped fire reaches both (every instance hears it)',
	[red.player.timeOf('win'), blue.player.timeOf('win')],
	[0, 0],
);

// ---- 4. reuse by name --------------------------------------------------------------------------

const reused = timeline('pop', { playOn: 'enter', also: ['gem'] });
const onGem = new L.ComponentTimelinePlayer([reused], gemNodes);
onGem.trigger('enter');
eq(
	'reused on another component, it drives that one’s node of the same name',
	[...onGem.drivenNodes().keys()],
	['g1'],
);
const glowOnly = timeline('glow', { playOn: 'enter', target: 'Glow' });
eq(
	'validation flags a reused-on component that lacks the name',
	N.validateNodeActors(glowOnly, { id: 'gem', name: 'Gem', nodes: gemNodes }).map((i) => i.code),
	['node-missing'],
);
eq(
	'a component timeline binds on a screen with the same names too',
	[...N.resolveNodeActors(reused, { id: 'base', name: 'Base', nodes: gemNodes }).keys()],
	['g1'],
);
eq(
	'a screen timeline still binds only on its own screen',
	N.resolveNodeActors(
		{ ...reused, host: { kind: 'screen', sceneId: 'other' } },
		{ id: 'base', name: 'Base', nodes: gemNodes },
	).size,
	0,
);
eq(
	'Animate offers enter, the declared signals, then rig complete signals',
	S.componentTimelineSignals({
		signals: [{ key: 'potWin' }],
		root: {
			id: 'r',
			kind: 'container',
			x: 0,
			y: 0,
			children: [
				{
					id: 's',
					kind: 'spine',
					x: 0,
					y: 0,
					cues: [{ signal: 'x', completeSignal: 'introDone' }],
				},
			],
		} as unknown as LayoutNode,
	}),
	['enter', 'potWin', 'introDone'],
);

// ---- 5. ship chain -----------------------------------------------------------------------------

const C = 'acme';
const P = 'borut';
bucket.set(
	cinematicKey(C, P, 'c_coin_pop'),
	JSON.stringify(timeline('c_coin_pop', { playOn: 'enter' })),
);
bucket.set(
	cinematicKey(C, P, 'empty'),
	JSON.stringify({ ...timeline('empty'), stage: { sceneId: null, cast: [] } }),
);
const authored = await loadAuthoredCinematics(C, P);
eq(
	'a component timeline is authored (its node actors count), an empty shell is not',
	authored.map((d) => d.id),
	['c_coin_pop'],
);
const index = await exportCinematics(C, P, authored);
eq(
	'it is embedded for the game though no Flow node names it',
	index.cinematics?.map((d) => d.id),
	['c_coin_pop'],
);
eq(
	'...and written under deploy/cinematics/',
	[...bucket.keys()].filter((k) => k.includes('/deploy/cinematics/')),
	[`${C}/${P}/deploy/cinematics/c_coin_pop.json`],
);
eq(
	'the shipped doc keeps its playOn and host',
	(() => {
		const doc = index.cinematics?.[0];
		return [doc?.playOn, doc?.host];
	})(),
	['enter', { kind: 'component', componentId: 'coin' }],
);
eq(
	'node actors seed no rig bundle (their art ships with the component)',
	[...cinematicRigNames(authored)],
	[],
);

console.log(
	`\n${failures === 0 ? '✅' : '❌'} component timelines: ${passes} passed, ${failures} failed`,
);
if (failures) process.exit(1);
