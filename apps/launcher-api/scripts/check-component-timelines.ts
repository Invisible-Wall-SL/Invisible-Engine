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
 *  4. reuse binds by node NAME only (never an id), and validation flags a component that lacks it;
 *     a timeline never restarts itself from its own `signal:` cue;
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
const halfCues: { cue: string; timeline: string }[] = [];
for (let i = 0; i < 5; i++) halfCues.push(...player.advance(0.1).cues);
eq('half way', player.sample('n_coin'), { y: -50, alpha: 0.5 });
eq('a crossed cue is reported once, with its timeline', halfCues, [
	{ cue: 'signal:landed', timeline: 'pop' },
]);
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
const byId = timeline('byid', { playOn: 'enter', target: 'g1' });
eq(
	'a component timeline never binds a node by its id',
	N.resolveNodeActors(byId, { id: 'gem', name: 'Gem', nodes: gemNodes }).size,
	0,
);
eq(
	'...and validation says so',
	N.validateNodeActors(byId, { id: 'gem', name: 'Gem', nodes: gemNodes }).map((i) => i.code),
	['node-missing'],
);
eq(
	'a screen timeline keeps its id fallback (unchanged)',
	[
		...N.resolveNodeActors(
			{ ...byId, host: { kind: 'screen', sceneId: 'base' } },
			{ id: 'base', name: 'Base', nodes: gemNodes },
		).keys(),
	],
	['g1'],
);
// A timeline that cues the very signal it plays on: its own cue must not restart it.
const echo = {
	...timeline('echo', { playOn: 'landed' }),
} as CinematicDoc;
const echoed = new L.ComponentTimelinePlayer(
	[echo, timeline('follow', { playOn: 'landed', target: 'Glow' })],
	coinNodes,
);
echoed.trigger('landed');
let echoCue: { cue: string; timeline: string } | undefined;
for (let i = 0; i < 6 && !echoCue; i++) echoCue = echoed.advance(0.1).cues[0];
eq('the echo timeline crosses its own signal:landed cue', echoCue, {
	cue: 'signal:landed',
	timeline: 'echo',
});
echoed.trigger('landed', echoCue?.timeline);
eq(
	'routing that cue restarts the OTHER timeline on that signal, never the one that crossed it',
	[echoed.timeOf('follow'), Number(echoed.timeOf('echo')?.toFixed(2))],
	[0, 0.5],
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

// ---- 6. animation strips on a rig node, and cue holds (Rive plan Phase 8a) ----------------------

const H = await import('../../../packages/engine-layout/src/lib/cueHolds.ts');
const B = await import('../../../packages/engine-layout/src/lib/builtinTimelines.ts');
const rigNodes: LayoutNode[] = [
	{ id: 'r_wipe', kind: 'spine', label: 'wipe', x: 0, y: 0, assetKey: 'transition' } as LayoutNode,
	{ id: 'r_glow', kind: 'sprite', label: 'Glow', x: 0, y: 0 } as LayoutNode,
];
const stripTimeline = (id: string, extra: Partial<CinematicDoc> = {}): CinematicDoc =>
	({
		...S.newComponentTimeline({ id, name: id, componentId: 'wipe', playOn: 'transition' }),
		duration: 2,
		stage: { sceneId: null, cast: [{ actorId: 'a', kind: 'node', target: 'wipe', place: {} }] },
		tracks: [
			{
				id: 'anim',
				kind: 'animation',
				actorId: 'a',
				strips: [
					{
						id: 's1',
						clip: { src: 'rig', name: 'animation' },
						start: 0.5,
						length: 1,
						clipIn: 0.25,
					},
				],
			},
		],
		...extra,
	}) as unknown as CinematicDoc;
{
	const doc = stripTimeline('strip');
	eq(
		'an animation strip keys the animTime channel on a rig node',
		[...N.keyedNodeChannels(doc.tracks as never)],
		['animTime'],
	);
	eq(
		'...which a rig node takes and a sprite does not',
		[
			N.validateNodeActors(doc, { id: '', name: '', nodes: rigNodes }).map((i) => i.code),
			N.validateNodeActors(
				stripTimeline('x', {
					stage: {
						sceneId: null,
						cast: [{ actorId: 'a', kind: 'node', target: 'Glow', place: {} }],
					},
				} as never),
				{ id: '', name: '', nodes: rigNodes },
			).map((i) => i.code),
		],
		[[], ['channel-unsupported']],
	);
	const p = new L.ComponentTimelinePlayer([doc], rigNodes);
	p.trigger('transition');
	eq('before the strip the rig holds no clip', p.sample('r_wipe'), {});
	p.advance(0.5);
	eq('at the strip start the clip is at its clip-in, in seconds', p.sample('r_wipe'), {
		animTime: { animation: 'animation', time: 0.25 },
	});
	p.advance(0.75);
	eq('mid-strip the clip time advances with the playhead', p.sample('r_wipe'), {
		animTime: { animation: 'animation', time: 1 },
	});
	p.advance(1);
	eq('past the strip the clip holds its last strip time', p.sample('r_wipe'), {
		animTime: { animation: 'animation', time: 1.25 },
	});
	const propertyOnly = timeline('pop', { playOn: 'enter' });
	const q = new L.ComponentTimelinePlayer([propertyOnly], coinNodes);
	q.trigger('enter');
	q.advance(0.5);
	eq(
		'a property-only timeline samples no animTime (every timeline before 8a is unchanged)',
		Object.keys(q.sample('n_coin') ?? {}).sort(),
		['alpha', 'y'],
	);
}
{
	const silent = stripTimeline('silent');
	const holding = stripTimeline('holding', { holdsCue: true });
	const empty = stripTimeline('empty', { holdsCue: true, duration: 0 });
	const p = new L.ComponentTimelinePlayer([silent, holding, empty], rigNodes);
	eq(
		'only a holdsCue timeline with a length holds its cue',
		[p.holdsOn('transition'), p.holdsOn('enter')],
		[['holding'], []],
	);
	let settled = false;
	const until = new Promise<void>((resolve) => {
		let frames = 0;
		p.trigger('transition');
		const tick = (): void => {
			frames++;
			const step = p.advance(1 / 60);
			if (step.completed.includes('holding')) {
				eq(
					'the hold ends on the frame the timeline reaches its end (2 s at 60 fps)',
					Math.abs(frames / 60 - 2) <= 1 / 60,
					true,
				);
				resolve();
				return;
			}
			if (frames > 1000) throw new Error('the holding timeline never completed');
			tick();
		};
		tick();
	}).then(() => {
		settled = true;
	});
	H.holdCue('transition', until);
	eq(
		'a registered hold is listed on its cue only',
		[H.cueHolds('transition').length, H.cueHolds('uiHide').length],
		[1, 0],
	);
	await until;
	await Promise.resolve();
	eq(
		'...and dropped once it settles',
		[settled, H.cueHolds('transition').length, H.pendingCueHolds()],
		[true, 0, []],
	);
}
{
	const wipe = B.TRANSITION_WIPE_TIMELINE;
	const def = (await import('../../../packages/engine-layout/src/lib/builtinComponents.ts'))
		.TRANSITION_WIPE_DEF;
	eq(
		"the built-in wipe timeline binds the built-in def's rig node with no issue",
		N.validateNodeActors(wipe, { id: '', name: '', nodes: def.root.children }),
		[],
	);
	L.registerComponentTimelines([...B.BUILTIN_TIMELINES, timeline('project', { playOn: 'enter' })]);
	eq(
		'a built-in timeline registers on its def like a baked one',
		L.componentTimelinesFor('transitionWipe').map((d) => d.id),
		[wipe.id],
	);
	const shadow = { ...wipe, name: 'project copy', holdsCue: false } as CinematicDoc;
	L.registerComponentTimelines([...B.BUILTIN_TIMELINES, shadow]);
	eq(
		'...and a project timeline of the same id shadows it',
		L.componentTimelinesFor('transitionWipe').map((d) => d.name),
		['project copy'],
	);
	L.registerComponentTimelines([]);
}

// ---- 7. the generated win timelines and the play rate (Rive plan Phase 8b) -------------------------
{
	const C = await import('../../../packages/engine-layout/src/lib/builtinComponents.ts');
	const tiers = [
		{ alias: 'big', intro: 'big_win_intro', idle: 'big_win_idle', outro: 'big_win_exit' },
		{ alias: 'mega', intro: 'mega_win_intro', idle: 'mega_win_idle', caption: 'MEGA WIN' },
	];
	const clipMs = {
		big_win_intro: 1333.3,
		big_win_idle: 12000,
		big_win_exit: 466.7,
		mega_win_intro: 1366.7,
		mega_win_idle: 12000,
	};
	const generated = B.winTierTimelines(tiers, clipMs);
	eq(
		'the generated list: rest, plain, hide, then walk + loop (+ outro only for a tier with an exit)',
		generated.map((d) => d.id),
		[
			'c_winpresentation_rest',
			'c_winpresentation_plain',
			'c_winpresentation_fade_hidden',
			'c_winpresentation_fade_shown',
			'c_winpresentation_hide',
			'c_winpresentation_big_walk',
			'c_winpresentation_big_loop',
			'c_winpresentation_big_outro',
			'c_winpresentation_mega_walk',
			'c_winpresentation_mega_loop',
		],
	);
	eq(
		'same inputs ⇒ identical docs (deterministic generation)',
		JSON.stringify(B.winTierTimelines(tiers, clipMs)),
		JSON.stringify(generated),
	);
	const def = C.winPresentationDef(
		tiers.map((t) => ({ alias: t.alias, name: t.alias, caption: t.caption })),
	);
	eq(
		"every generated timeline binds the generated def's nodes with no issue",
		generated.flatMap((d) =>
			N.validateNodeActors(d, { id: '', name: '', nodes: def.root.children }).map(
				(i) => `${d.id}:${i.code}`,
			),
		),
		[],
	);
	const walk = generated.find((d) => d.id === 'c_winpresentation_big_walk')!;
	eq(
		'a walk holds its cue for intro + one idle, in seconds off the measured clips',
		[walk.holdsCue, walk.playOn, Math.round(walk.duration * 1000)],
		[true, 'winTier.big', 13333],
	);
	eq(
		'an outro holds for the exit; a loop and the plain number hold nothing',
		generated
			.filter((d) => d.id.endsWith('_outro') || d.id.endsWith('_loop') || d.id.endsWith('_plain'))
			.map((d) => [d.playOn, d.holdsCue === true]),
		[
			['winPlain', false],
			['winTierLoop.big', false],
			['winTierOutro.big', true],
			['winTierLoop.mega', false],
		],
	);
	L.registerGameTimelines([], generated);
	eq(
		'registerGameTimelines registers the generated docs on the def after the built-ins',
		L.componentTimelinesFor('winPresentation').length,
		generated.filter((d) => d.playOn).length,
	);
	const shadow = { ...walk, name: 'project copy' } as CinematicDoc;
	L.registerGameTimelines([shadow], generated);
	eq(
		'...and a project timeline of a generated id shadows it',
		L.componentTimelinesFor('winPresentation').find((d) => d.id === walk.id)?.name,
		'project copy',
	);
	// The play rate: `advance(dt)` moves by dt × playRate (the hold-to-speed-up ramp on the art).
	const p = new L.ComponentTimelinePlayer([walk], def.root.children);
	p.trigger('winTier.big');
	p.playRate = 2;
	p.advance(1);
	eq('a play rate of 2 advances twice the step', p.timeOf(walk.id), 2);
	{
		// A 1.3667 s intro is 82.002 frames: the coded track completes it on frame 83 and starts the
		// idle at 0 there, so the walk is 83 + 720 = 803 frames; the player must report its end on
		// frame 803 exactly (803 steps of 1/60 sum a hair under 803/60 — the float snap), as the
		// coded idle completes there. A 1.3333 s intro (80 frames) walks 800.
		const superwin = B.winTierTimelines(
			[{ alias: 'superwin', intro: 'super_win_intro', idle: 'super_win_idle' }],
			{ super_win_intro: 1366.7, super_win_idle: 12000 },
		).find((d) => d.id === 'c_winpresentation_superwin_walk')!;
		const q = new L.ComponentTimelinePlayer([superwin], def.root.children);
		q.trigger('winTier.superwin');
		let completedAt = 0;
		for (let frame = 1; frame <= 803 && !completedAt; frame++) {
			if (q.advance(1 / 60).completed.includes(superwin.id)) completedAt = frame;
		}
		eq(
			'a 1.3667 s intro + 12 s idle walk ends on frame 803 (the coded boundary)',
			completedAt,
			803,
		);
		eq(
			'...its idle strip starts on frame 83, where the coded track starts the idle at 0',
			(superwin.tracks.find((t) => t.kind === 'animation') as { strips: { start: number }[] })
				.strips[1].start,
			83 / 60,
		);
		const big = generated.find((d) => d.id === 'c_winpresentation_big_walk')!;
		const b = new L.ComponentTimelinePlayer([big], def.root.children);
		b.trigger('winTier.big');
		let bigAt = 0;
		for (let frame = 1; frame <= 801 && !bigAt; frame++) {
			if (b.advance(1 / 60).completed.includes(big.id)) bigAt = frame;
		}
		eq('a 1.3333 s intro (80 frames) + 12 s idle walk ends on frame 800', bigAt, 800);
	}
	p.playRate = 1;
	p.advance(1);
	eq('...and 1 the plain step', p.timeOf(walk.id), 3);
	// The coded `FadeContainer`'s tween as the def's state machine: the `fade` node sits at alpha 0
	// (entry), blends 0 → 1 over 400 ms linear on `winFade` (every win, the first included — the coded
	// container fades in on its mount too), and on `winHide` blends to 0 FROM THE POSE ON SCREEN
	// (a hide 100 ms into the fade-in leaves from 0.25, as the coded tween does). No walk, plain,
	// loop, outro, rest or hide timeline keys alpha.
	const SM = await import('../../../packages/engine-layout/src/lib/stateMachine.ts');
	const I = await import('../../../packages/engine-layout/src/lib/componentInterface.ts');
	const f = new L.ComponentTimelinePlayer(generated, def.root.children);
	const fadeId = def.root.children[0].id;
	const visualId = (def.root.children[0] as { children: LayoutNode[] }).children[0].id;
	const { durations } = L.stateMachineTimelines(def.stateMachine);
	const runner = new SM.ComponentStateMachineRunner(
		def.stateMachine!,
		I.componentInputs(def),
		durations,
	);
	const drive = (): void => {
		runner.plays().forEach((play, index) => f.drive(play.layer, index, play));
	};
	// As the instance fires a trigger: the transition is taken at the fire (a zero-length step), so
	// the blend's first rendered frame is at `dt` — the `playOn` player's and the coded tween's rule.
	const fire = (trigger: string): void => {
		runner.fire(trigger);
		runner.advance(0);
		drive();
	};
	const tick = (frames: number): void => {
		for (let k = 0; k < frames; k++) {
			runner.advance(1 / 60);
			drive();
			f.advance(1 / 60);
		}
	};
	drive();
	eq('at rest the fade node is at alpha 0 (the layer entry)', f.sample(fadeId)?.alpha, 0);
	eq(
		'no walk, plain, loop, outro, rest or hide timeline keys alpha',
		generated
			.filter((d) => /_(walk|loop|outro|plain|rest|hide)$/.test(d.id))
			.flatMap((d) => d.tracks.filter((t) => t.kind === 'property')),
		[],
	);
	fire('winFade');
	f.trigger('winTier.big');
	tick(6);
	const r6 = (v: number | undefined): number | undefined =>
		v === undefined ? v : Math.round(v * 1e6) / 1e6;
	eq(
		'100 ms into the fade-in the fade node is at 0.25 (linear)',
		r6(f.sample(fadeId)?.alpha),
		0.25,
	);
	fire('winHide');
	f.trigger('winHide');
	tick(12);
	eq(
		'a hide 100 ms into the fade-in leaves from 0.25: 0.125 at its half (linear from the pose on screen)',
		r6(f.sample(fadeId)?.alpha),
		0.125,
	);
	tick(12);
	eq(
		'...and 0 at its end, where the hide timeline also cuts the visual',
		[r6(f.sample(fadeId)?.alpha), f.sample(visualId)?.visible],
		[0, false],
	);
	fire('winFade');
	tick(24);
	eq('a later win fades in from 0 over the full 400 ms', r6(f.sample(fadeId)?.alpha), 1);
	// `releaseCueHolds` (8b): a hold settles on its timeline's end OR on an explicit release, and
	// the map forgets it either way.
	{
		let ended = (): void => {};
		H.holdCue('winTier.big', new Promise<void>((resolve) => (ended = resolve)));
		let settled = false;
		void H.cueHolds('winTier.big')[0].then(() => {
			settled = true;
		});
		H.releaseCueHolds('winTier.big');
		await Promise.resolve();
		await Promise.resolve();
		eq(
			'a released hold settles its awaiter and leaves the map',
			[settled, H.cueHolds('winTier.big').length, H.pendingCueHolds()],
			[true, 0, []],
		);
		ended();
		H.releaseCueHolds('nothing-held');
		eq('releasing a cue nothing holds is a no-op', H.pendingCueHolds(), []);
	}
	eq(
		'every generated doc casts exactly the actors it keys (a walk never takes the fade node)',
		generated.map((d) => [
			d.id,
			d
				.stage!.cast.map((c) => c.actorId)
				.sort()
				.join(','),
		]),
		[
			['c_winpresentation_rest', 'visual'],
			['c_winpresentation_plain', 'countPlain,tier,visual'],
			['c_winpresentation_fade_hidden', 'fade'],
			['c_winpresentation_fade_shown', 'fade'],
			['c_winpresentation_hide', 'visual'],
			['c_winpresentation_big_walk', 'countPlain,tier,visual'],
			['c_winpresentation_big_loop', 'tier'],
			['c_winpresentation_big_outro', 'tier'],
			['c_winpresentation_mega_walk', 'caption,countPlain,tier,visual'],
			['c_winpresentation_mega_loop', 'tier'],
		],
	);
	L.registerComponentTimelines([]);
}

console.log(
	`\n${failures === 0 ? '✅' : '❌'} component timelines: ${passes} passed, ${failures} failed`,
);
if (failures) process.exit(1);
