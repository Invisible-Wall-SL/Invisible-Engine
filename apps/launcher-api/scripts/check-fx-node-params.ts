/**
 * Invisible FX Step 2 — exposed effect parameters DRIVEN FROM THE NODE
 * (`docs/design/invisible-fx.md` §"Direction (2026-10-15)", the four steps, row 2):
 *   pnpm --filter launcher-api check:fx-node-params
 *
 *  1. what is offered: `fxParam` in `bindingTargetsForKind('effect')`, one `fx:<id>` per number or
 *     bool parameter in `nodeActorChannelsForKind('effect', params)` (never a colour), every other
 *     kind unchanged; the editor's Animate rows are the same list;
 *  2. mapping: a number binding maps onto the parameter's own range by default, authored ends win,
 *     and the value is clamped by `effectParamValue`;
 *  3. bool: on by `threshold` / `below`, as `visible`; a keyed 0 / 1 channel reads on from 0.5;
 *  4. precedence: the node's own bindings, then the timeline's, the last value winning (the rule
 *     `withNodeActorOutputs` already gives `fill` and `frame`);
 *  5. an unknown, stale or colour id is inert and reported (`fxParamBindingIssue`,
 *     `validateNodeActors`), and the applier ignores a value no parameter declares;
 *  6. the evaluator samples `fx:` channels (the package and the static `/rigger` copy alike);
 *  7. a component state machine: a state's timeline keys `fx:intensity`, the runner + player drive
 *     it, a transition blend mixes it (both sides keyed, and one side from the default), a bool
 *     steps, and the values move a REAL emitter through the shared applier with no reset;
 *  8. bindings from a component param and from an engine source, through the real reactive
 *     `createBoundValues` + `createFxParamValues` (compiled with Svelte's own compiler);
 *  9. ship: save → normalize (layout doc, component def, cinematic) → export → the runtime
 *     bundle's JSON → the game's registries keep the binding and the channel;
 * 10. parity: an undriven effect node mounts `<EffectPlayer>` with no getter and runs no fold;
 *     a blend with no rest leaves `fx:` alone; a player whose timelines key no `fx:` channel holds
 *     no rest; the editor's wiring (source-scanned).
 *
 * What it cannot prove: the Svelte wiring in `LayoutNodeView.svelte` and the editor panels in a
 * browser — that is the owner's pass (`docs/status/fx.md`).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Emitter, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import { bindEffectParams, normalizeEffectDoc, type EffectDoc, type EffectParam } from 'engine-fx';
import type {
	CinematicDoc,
	ComponentDef,
	ComponentStateMachine,
	LayoutNode,
	Scene,
	ValueBinding,
} from 'engine-layout';
import { Container } from 'pixi.js';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';

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
		copyObject: async () => undefined,
		getObjectBytes: async () => null,
		getObjectText: async () => null,
		headObject: async () => null,
		objectExists: async () => false,
		listAllKeys: async () => [],
		listFolder: async () => ({ folders: [], files: [] }),
		listObjects: async () => ({ objects: [], folders: [] }),
		putObjectBytes: async () => '"e"',
		jsonBaseEtag: () => undefined,
		formBaseEtag: () => undefined,
		presignGet: async () => '',
		presignPut: async () => '',
		presignManifestEntries: async (entries: unknown) => entries,
		getObjectStream: async () => null,
	},
});

const LIB = new URL('../../../packages/engine-layout/src/lib/', import.meta.url);
const lib = (file: string): string => new URL(file, LIB).href;
const V = await import('../../../packages/engine-layout/src/lib/valueBindings.ts');
const N = await import('../../../packages/engine-layout/src/lib/cinematicNodes.ts');
const F = await import('../../../packages/engine-layout/src/lib/fxNodeParams.ts');
const FV = await import('../../../packages/engine-layout/src/lib/fxParamValues.svelte.ts');
const M = await import('../../../packages/engine-layout/src/lib/stateMachine.ts');
const L = await import('../../../packages/engine-layout/src/lib/componentTimelines.ts');
const R = await import('../../../packages/engine-layout/src/lib/registerEffects.ts');
const CV = await import('../../../packages/engine-layout/src/lib/registerComponentValues.ts');
const EV = await import('../../../packages/engine-cinematic/index.ts');
const S = await import('../src/lib/timeline/screenTimeline.ts');
const { normalizeDoc: normalizeLayoutDoc } = await import('../src/lib/server/editorStorage.ts');
const { normalizeComponent } = await import('../src/lib/server/componentStorage.ts');
const { loadCinematic, saveCinematic } = await import('../src/lib/server/cinematicStorage.ts');
const { exportCinematics, loadAuthoredCinematics } =
	await import('../src/lib/server/cinematicExport.ts');

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
const ok = (name: string, cond: boolean): void => eq(name, cond, true);
const r3 = (n: unknown): unknown => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n);
const round = (values: Record<string, unknown> | undefined): Record<string, unknown> | undefined =>
	values && Object.fromEntries(Object.entries(values).map(([k, v]) => [k, r3(v)]));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---- fixtures ----------------------------------------------------------------------------------

const emitterConfig = (): EmitterConfigV3 =>
	({
		lifetime: { min: 4, max: 4 },
		frequency: 0.05,
		emitterLifetime: -1,
		maxParticles: 500,
		particlesPerWave: 1,
		pos: { x: 0, y: 0 },
		addAtBack: false,
		behaviors: [
			{
				type: 'alpha',
				config: {
					alpha: {
						list: [
							{ time: 0, value: 1 },
							{ time: 1, value: 0 },
						],
					},
				},
			},
			{ type: 'moveSpeedStatic', config: { min: 50, max: 50 } },
			{ type: 'spawnShape', config: { type: 'torus', data: { x: 0, y: 0, radius: 4 } } },
		],
	}) as EmitterConfigV3;

/** `intensity` sets the rate (0..1), `heat` the cap (0..10), `burst` the wave size (on/off), and
 *  `hue` is a colour — a parameter no node drives in Step 2. */
const authoredEffect: EffectDoc = {
	version: 1,
	id: 'glow',
	name: 'Glow',
	layers: [
		{
			key: 'main',
			config: emitterConfig(),
			art: { assetKey: '', frames: [] },
			placement: { space: 'free' },
			particleKind: 'sprite',
		},
	],
	params: [
		{
			id: 'intensity',
			kind: 'number',
			default: 0.5,
			min: 0,
			max: 1,
			drives: [{ id: 'd1', layer: 'main', path: 'emitter.frequency', from: 0.2, to: 0.02 }],
		},
		{
			id: 'heat',
			kind: 'number',
			default: 2,
			min: 0,
			max: 10,
			drives: [{ id: 'd2', layer: 'main', path: 'emitter.maxParticles', from: 10, to: 1010 }],
		},
		{
			id: 'burst',
			kind: 'bool',
			default: false,
			drives: [{ id: 'd3', layer: 'main', path: 'emitter.particlesPerWave', from: 1, to: 6 }],
		},
		{ id: 'hue', kind: 'color', default: '#ff0000', drives: [{ id: 'd4', path: 'effect.tint' }] },
	],
};
const effect = normalizeEffectDoc(clone(authoredEffect));
const params = effect.params as EffectParam[];
const param = (id: string): EffectParam => params.find((p) => p.id === id) as EffectParam;

const glowNode = (valueBindings?: ValueBinding[]): LayoutNode =>
	({
		id: 'n_glow',
		kind: 'effect',
		label: 'Glow',
		x: 0,
		y: 0,
		effectId: 'glow',
		...(valueBindings ? { valueBindings } : {}),
	}) as LayoutNode;
const coinNode = { id: 'n_coin', kind: 'sprite', label: 'Coin', x: 0, y: 0 } as LayoutNode;
const TRANSFORM = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'alpha', 'visible'];

type Keys = { time: number; value: number; ease?: string }[];
/** A one-second component timeline on `banner` keying `channels` on node `target`. */
function timeline(id: string, target: string, channels: Record<string, Keys>): CinematicDoc {
	return {
		...S.newComponentTimeline({ id, name: id, componentId: 'banner' }),
		duration: 1,
		stage: {
			sceneId: null,
			cast: [{ actorId: 'a', kind: 'node', target, place: {} }],
		},
		tracks: [{ id: 'p', kind: 'property', actorId: 'a', channels }],
	} as unknown as CinematicDoc;
}

// ---- 1. what is offered ------------------------------------------------------------------------

eq('the binding targets: `fxParam` is a target, as a VALUE', V.bindingTargetsForKind('effect'), [
	...TRANSFORM,
	'fxParam',
]);
eq(
	'…on an effect node only',
	(['sprite', 'rect', 'flipbook', 'spine', 'text', 'container', 'componentInstance'] as const).map(
		(k) => V.bindingTargetsForKind(k).includes('fxParam'),
	),
	[false, false, false, false, false, false, false],
);
eq(
	'the timeline channels: one `fx:<id>` per number or bool parameter, never a colour',
	N.nodeActorChannelsForKind('effect', params),
	[...TRANSFORM, 'fx:intensity', 'fx:heat', 'fx:burst'],
);
eq(
	'…none while the effect is not known, and none on another kind',
	[N.nodeActorChannelsForKind('effect'), N.nodeActorChannelsForKind('sprite', params)],
	[TRANSFORM, [...TRANSFORM, 'tint', 'fill']],
);
eq(
	"the editor's Animate rows are the same list",
	S.keyableFxChannels(glowNode(), params).map((row) => row.channel),
	['fx:intensity', 'fx:heat', 'fx:burst'],
);
eq('…and offer nothing on a sprite', S.keyableFxChannels(coinNode, params), []);
eq(
	'one prefix: the evaluator, engine-layout and the drivable kinds',
	[EV.FX_PARAM_CHANNEL_PREFIX, F.FX_PARAM_CHANNEL_PREFIX, [...F.FX_NODE_PARAM_KINDS]],
	['fx:', 'fx:', ['number', 'bool']],
);
ok(
	'the fixed channels stay one exported list (no `fx:` in it)',
	N.NODE_ACTOR_CHANNELS.every((c: string) => F.fxParamOfChannel(c) === undefined) &&
		N.NODE_ACTOR_CHANNELS.includes('animTime'),
);
eq(
	'a channel name reads back to its parameter; anything else is not one',
	[F.fxParamOfChannel('fx:intensity'), F.fxParamOfChannel('fx:'), F.fxParamOfChannel('alpha')],
	['intensity', undefined, undefined],
);

// ---- 2. mapping ---------------------------------------------------------------------------------

const heat: ValueBinding = { target: 'fxParam', fxParam: 'heat', param: 'level', inMax: 100 };
eq(
	"a number binding's default out range is the parameter's own",
	[
		V.defaultBindingOutRange({ target: 'fxParam' }, param('heat')),
		V.defaultBindingOutRange({ target: 'fxParam' }),
	],
	[
		[0, 10],
		[0, 1],
	],
);
eq(
	'…so level 25 of 100 is heat 2.5; authored ends and the curve still win',
	[
		V.evaluateBinding(heat, 25, undefined, param('heat')),
		V.evaluateBinding({ ...heat, outMin: 4, outMax: 6 }, 50, undefined, param('heat')),
		r3(V.evaluateBinding({ ...heat, ease: 'easeIn' }, 50, undefined, param('heat'))),
	],
	[2.5, 5, 1.25],
);
eq(
	'the value goes through `effectParamValue`: clamped into the range',
	[
		F.boundFxParamValues([heat], [15], params),
		F.boundFxParamValues([heat], [-3], params),
		F.boundFxParamValues([heat], [7], params),
	],
	[{ heat: 10 }, { heat: 0 }, { heat: 7 }],
);
eq(
	'nothing with a value ⇒ no values at all (the effect draws its defaults)',
	[F.boundFxParamValues([heat], [undefined], params), F.boundFxParamValues([], [], params)],
	[undefined, undefined],
);

// ---- 3. bool ------------------------------------------------------------------------------------

const burstOn: ValueBinding = { target: 'fxParam', fxParam: 'burst', source: 'winAmount' };
eq(
	'a bool binding switches by threshold / below, like `visible`',
	[
		V.evaluateBinding({ ...burstOn, threshold: 2 }, 1, undefined, param('burst')),
		V.evaluateBinding({ ...burstOn, threshold: 2 }, 2, undefined, param('burst')),
		V.evaluateBinding({ ...burstOn, threshold: 2, below: true }, 1, undefined, param('burst')),
		V.evaluateBinding(burstOn, 0.99, undefined, param('burst')),
	],
	[0, 1, 1, 0],
);
eq(
	'…it is a switch, a number binding is not (and neither smooths)',
	[
		V.isSwitchBinding(burstOn, param('burst')),
		V.isSwitchBinding(heat, param('heat')),
		V.isSwitchBinding({ target: 'visible' }),
	],
	[true, false, true],
);
eq(
	'its value is a boolean: on from 0.5, so a stepped channel switches on its key',
	[0, 0.49, 0.5, 1].map((out) => F.boundFxParamValues([burstOn], [out], params)?.burst),
	[false, false, true, true],
);

// ---- 4. precedence ------------------------------------------------------------------------------

{
	const own = [heat];
	const actor = N.nodeActorBindings(new Set(['x', 'fx:heat']));
	eq('a keyed `fx:` channel stands for an `fxParam` binding, after the transform ones', actor, [
		{ target: 'x' },
		{ target: 'fxParam', fxParam: 'heat' },
	]);
	const fold = (ownOut: number | undefined, sample: Record<string, number>) => {
		const all = [...own, ...actor];
		const outs = N.withNodeActorOutputs(own, [ownOut], actor, sample);
		return F.boundFxParamValues(all, outs, params);
	};
	eq(
		'a binding and a timeline on one parameter: the timeline (after) wins, as for fill / frame',
		fold(3, { 'fx:heat': 7 }),
		{ heat: 7 },
	);
	eq('…the binding holds it while the timeline has no value', fold(3, {}), { heat: 3 });
	eq(
		'two bindings on one parameter: the later wins',
		F.boundFxParamValues([heat, { ...heat, param: 'other' }], [1, 4], params),
		{ heat: 4 },
	);
	const t = { x: 10, y: 0, visible: true };
	eq(
		'the transform fold ignores the parameter bindings',
		V.foldBoundTransform(t, [...own, ...actor], [3, 5, 7]),
		V.foldBoundTransform(t, [{ target: 'x' }], [5]),
	);
}

// ---- 5. unknown, stale and colour ids -----------------------------------------------------------

{
	const gone: ValueBinding = { target: 'fxParam', fxParam: 'gone', param: 'level' };
	const hue: ValueBinding = { target: 'fxParam', fxParam: 'hue', param: 'level' };
	eq(
		'an id the effect does not declare, or a colour one, is inert',
		[
			F.boundFxParamValues([gone], [1], params),
			F.boundFxParamValues([hue], [1], params),
			N.nodeActorOutputs([{ target: 'fxParam' }], { 'fx:heat': 1 }),
		],
		[undefined, undefined, [undefined]],
	);
	eq(
		'…and reported where the binding is edited',
		[
			F.fxParamBindingIssue({ target: 'fxParam', param: 'level' }, effect)?.code,
			F.fxParamBindingIssue(gone, effect)?.code,
			F.fxParamBindingIssue(hue, effect)?.code,
			F.fxParamBindingIssue(heat, effect),
			F.fxParamBindingIssue(gone, undefined),
			V.isLiveBinding({ target: 'fxParam', param: 'level' }),
		],
		['fx-param-missing', 'fx-param-unknown', 'fx-param-colour', undefined, undefined, false],
	);
	const keyed = timeline('t_keys', 'Glow', {
		'fx:intensity': [{ time: 0, value: 1 }],
		'fx:gone': [{ time: 0, value: 1 }],
		'fx:hue': [{ time: 0, value: 1 }],
	});
	const host = { id: 'banner', name: 'Banner', nodes: [glowNode()] } as Scene;
	const codes = (effects?: (id: string) => EffectDoc | undefined) =>
		N.validateNodeActors(keyed, host, effects).map((i: { code: string }) => i.code);
	eq(
		'a timeline keying a parameter the effect lacks (or a colour) is reported, once each',
		codes(() => effect),
		['fx-param-unknown', 'fx-param-unknown'],
	);
	eq(
		'…unchecked while the effect is not known here',
		codes(() => undefined),
		[],
	);
	R.clearEffects();
	R.registerEffects([effect]);
	eq('…checked against the game registry by default', codes(), [
		'fx-param-unknown',
		'fx-param-unknown',
	]);
	const onSprite = timeline('t_sprite', 'Coin', { 'fx:intensity': [{ time: 0, value: 1 }] });
	eq(
		'an `fx:` channel on any other kind is a channel it cannot take',
		N.validateNodeActors(onSprite, { ...host, nodes: [coinNode] }).map(
			(i: { code: string }) => i.code,
		),
		['channel-unsupported'],
	);
	eq(
		'the Timeline still lists a stale `fx:` channel, so its keys can be removed',
		S.staleFxChannels(keyed, 'a', params),
		['fx:gone', 'fx:hue'],
	);
	const em = new Emitter(new Container(), clone(effect.layers[0].config));
	const before = [em.frequency, em.maxParticles, em.particlesPerWave];
	const applier = bindEffectParams({ params, layer: effect.layers[0], emitter: em });
	applier?.apply({ gone: 1 } as never);
	eq(
		'the applier ignores a value no parameter declares',
		[em.frequency, em.maxParticles, em.particlesPerWave],
		before,
	);
}

// ---- 6. the evaluator ---------------------------------------------------------------------------

{
	const tracks = [
		{
			kind: 'property',
			channels: {
				x: [
					{ time: 0, value: 0 },
					{ time: 1, value: 10 },
				],
				'fx:intensity': [
					{ time: 0, value: 0.2 },
					{ time: 1, value: 1 },
				],
				'fx:burst': [
					{ time: 0, value: 0, ease: 'hold' },
					{ time: 0.5, value: 1, ease: 'hold' },
				],
			},
		},
	];
	const at = (t: number) => EV.sampleNodeActor(tracks as never, t) as Record<string, number>;
	eq(
		'an `fx:` channel samples under its own name: a number interpolates',
		[r3(at(0.5)['fx:intensity']), at(0.5).x],
		[0.6, 5],
	);
	eq(
		'…a bool keyed on `hold` keys steps on its key',
		[at(0.49)['fx:burst'], at(0.5)['fx:burst']],
		[0, 1],
	);
	eq(
		'a node keying no `fx:` channel samples exactly its channels',
		Object.keys(
			EV.sampleNodeActor(
				[{ kind: 'property', channels: { x: [{ time: 0, value: 1 }] } }] as never,
				0,
			),
		),
		['x'],
	);
	const staticEval = (await import(
		pathToFileURL(fileURLToPath(new URL('../static/shared/cinematicEval.mjs', import.meta.url)))
			.href
	)) as typeof EV;
	eq(
		'the static copy `/rigger` loads samples the same',
		staticEval.sampleNodeActor(tracks as never, 0.5),
		EV.sampleNodeActor(tracks as never, 0.5),
	);
	eq(
		'the keyed channels of a node include its `fx:` ones',
		[...N.keyedNodeChannels(tracks as never)],
		['x', 'fx:intensity', 'fx:burst'],
	);
}

// ---- 7. a component state machine drives the effect --------------------------------------------

const tIdle = timeline('t_idle', 'Glow', { 'fx:intensity': [{ time: 0, value: 0.2 }] });
const tWin = timeline('t_win', 'Glow', {
	'fx:intensity': [{ time: 0, value: 1 }],
	'fx:burst': [
		{ time: 0, value: 0, ease: 'hold' },
		{ time: 0.5, value: 1, ease: 'hold' },
	],
});
const tCalm = timeline('t_calm', 'Coin', { alpha: [{ time: 0, value: 0.5 }] });
const machine: ComponentStateMachine = {
	layers: [
		{
			id: 'main',
			entry: 'idle',
			states: [
				{ id: 'idle', timeline: 't_idle', loop: true },
				{ id: 'win', timeline: 't_win', loop: true },
				{ id: 'calm', timeline: 't_calm', loop: true },
			],
			transitions: [
				{
					id: 'to_win',
					from: 'idle',
					to: 'win',
					conditions: [{ input: 'win', op: 'fired' }],
					blend: 200,
				},
				{
					id: 'to_calm',
					from: 'win',
					to: 'calm',
					conditions: [{ input: 'calm', op: 'fired' }],
					blend: 200,
				},
				{
					id: 'back',
					from: 'calm',
					to: 'win',
					conditions: [{ input: 'win', op: 'fired' }],
					blend: 200,
				},
			],
		},
	],
};
const smInputs: ComponentDef['inputs'] = [
	{ id: 'win', kind: 'trigger' },
	{ id: 'calm', kind: 'trigger' },
];
const durations = new Map([
	['t_idle', 1],
	['t_win', 1],
	['t_calm', 1],
]);

/**
 * One placed instance as the game runs it: `ComponentInstance` binds the player on the def's
 * nodes and places each layer (`drive`); `LayoutNodeView` folds the node's own bindings, then the
 * channels the player samples, and hands the values to `<EffectPlayer params>`.
 */
function instance(docs: CinematicDoc[], nodes: LayoutNode[], machineDef = machine) {
	const player = new L.ComponentTimelinePlayer(docs, nodes);
	const runner = new M.ComponentStateMachineRunner(machineDef, smInputs, durations);
	const place = (): void => void runner.plays().forEach((p, i) => player.drive(p.layer, i, p));
	place();
	const node = nodes.find((n) => n.id === 'n_glow') as LayoutNode;
	const actor = N.nodeActorBindings(player.drivenNodes().get('n_glow') ?? new Set());
	const own = node.valueBindings;
	const values = (ownOutputs: (number | undefined)[] = []) => {
		const sample = player.sample('n_glow') ?? {};
		const all = [...(own ?? []), ...actor];
		return F.boundFxParamValues(
			all,
			N.withNodeActorOutputs(own, ownOutputs, actor, sample),
			params,
		);
	};
	return {
		player,
		runner,
		values,
		step: (dt: number) => {
			runner.advance(dt);
			place();
		},
	};
}

R.clearEffects();
R.registerEffects([effect]);
{
	const game = instance([tIdle, tWin, tCalm], [glowNode(), coinNode]);
	eq('the entry state keys the parameter', round(game.values()), { intensity: 0.2 });
	game.runner.fire('win');
	game.step(0.1);
	game.step(0.1);
	eq(
		'a 200 ms blend half way: idle 0.2 → win 1 mixes to 0.6; a bool neither keys at 0.1 s stays off',
		round(game.values()),
		{ intensity: 0.6, burst: false },
	);
	game.step(0.1);
	eq('the blend done, the win state holds the parameter', round(game.values()), {
		intensity: 1,
		burst: false,
	});
	game.step(0.4);
	eq('the bool steps on at its key (0.5 s)', round(game.values()), { intensity: 1, burst: true });
	game.runner.fire('calm');
	game.step(0.1);
	game.step(0.05);
	eq(
		'one side keys it: the blend mixes towards the default (1 → 0.5 at a quarter: 0.875)',
		round(game.values()),
		{ intensity: 0.875, burst: true },
	);
	game.step(0.1);
	eq('…three quarters: 0.625, and the bool (1 → off) has stepped over', round(game.values()), {
		intensity: 0.625,
		burst: false,
	});
	game.step(0.1);
	eq('the blend done, a state that keys nothing leaves the defaults', game.values(), undefined);
	game.runner.fire('win');
	game.step(0.1);
	game.step(0.05);
	eq('…and leaving it mixes FROM the default (0.5 → 1 at a quarter: 0.625)', round(game.values()), {
		intensity: 0.625,
		burst: false,
	});
}
{
	// The values reach a REAL emitter through the shared applier, every frame, with no reset.
	const game = instance([tIdle, tWin, tCalm], [glowNode(), coinNode]);
	const layer = effect.layers[0];
	const em = new Emitter(new Container(), clone(layer.config));
	em.emit = true;
	const applier = bindEffectParams({ params, layer, emitter: em, values: game.values() });
	for (let i = 0; i < 60; i++) em.update(1 / 60);
	const alive = em.particleCount;
	const frame = (dt: number) => {
		game.step(dt);
		applier?.apply(game.values());
		em.update(dt);
	};
	eq('idle: intensity 0.2 sets the rate', r3(em.frequency), r3(0.2 * 0.8 + 0.02 * 0.2));
	game.runner.fire('win');
	frame(0.1);
	frame(0.1);
	eq('mid-blend (0.6): the rate follows', r3(em.frequency), r3(0.2 * 0.4 + 0.02 * 0.6));
	for (let i = 0; i < 5; i++) frame(0.1);
	eq(
		'win: full intensity and the burst on, the defaults elsewhere',
		[r3(em.frequency), em.particlesPerWave, em.maxParticles],
		[0.02, 6, 210],
	);
	ok('no reset: the particles in flight carried on', alive > 0 && em.particleCount >= alive);
}
{
	// With no rest known (the effect is not registered), a one-sided channel steps at half way.
	R.clearEffects();
	const game = instance([tWin, tCalm], [glowNode(), coinNode], {
		layers: [{ ...machine.layers[0], entry: 'win' }],
	});
	game.runner.fire('calm');
	game.step(0.1);
	game.step(0.05);
	const quarter = game.values();
	game.step(0.1);
	eq(
		'an unknown effect: the channel holds, then is gone, at half way',
		[quarter?.intensity, game.values()?.intensity],
		[1, undefined],
	);
	R.registerEffects([effect]);
}

// ---- 8. bindings from a param and from an engine source (the real reactive modules) ------------

{
	const svelteManifest = import.meta.resolve('svelte/package.json');
	const svelteExports = (
		JSON.parse(readFileSync(new URL(svelteManifest), 'utf8')) as {
			exports: { '.': { browser: string } };
		}
	).exports['.'];
	const svelteClient = new URL(svelteExports.browser, svelteManifest).href;
	const internalClient = import.meta.resolve('svelte/internal/client');
	const dir = mkdtempSync(join(tmpdir(), 'fx-node-params-'));
	process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
	const write = (name: string, source: string, typescript: boolean): string => {
		const js = typescript
			? ts.transpileModule(source, {
					compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
				}).outputText
			: source;
		const out = compileModule(js, { filename: `${name}.svelte.js`, generate: 'client' })
			.js.code.replaceAll(`'svelte/internal/client'`, `'${internalClient}'`)
			.replaceAll(`from 'svelte'`, `from '${svelteClient}'`)
			.replace(/from '\.\/([A-Za-z.]+)'/g, (_, f: string) =>
				f.endsWith('.svelte') ? `from './${f}.mjs'` : `from '${lib(`${f}.ts`)}'`,
			);
		const file = join(dir, `${name}.mjs`);
		writeFileSync(file, out);
		return pathToFileURL(file).href;
	};
	const source = (file: string): string => readFileSync(new URL(file, LIB), 'utf8');
	write('boundValues.svelte', source('boundValues.svelte.ts'), true);
	write('fxParamValues.svelte', source('fxParamValues.svelte.ts'), true);
	const entry = write(
		'entry',
		`import { createBoundValues } from './boundValues.svelte';
import { createFxParamValues } from './fxParamValues.svelte';
export function mount(bindings, params, fxParams) {
	let read;
	const stop = $effect.root(() => {
		const bound = createBoundValues(bindings, () => params, () => undefined, fxParams);
		read = createFxParamValues(bindings, () => bound.outputs, fxParams);
	});
	return { read: () => read(), stop };
}`,
		false,
	);
	const { mount } = (await import(entry)) as {
		mount: (
			b: ValueBinding[],
			p: Record<string, unknown>,
			f: readonly EffectParam[],
		) => { read: () => Record<string, unknown> | undefined; stop: () => void };
	};
	const { flushSync } = (await import(svelteClient)) as { flushSync: () => void };
	// A smoothed output glides on a frame clock Node does not have: a frame that never comes keeps a
	// glide where it started, so a bool that wrongly glided would still read its old value below.
	(globalThis as { requestAnimationFrame?: () => number }).requestAnimationFrame = () => 1;
	let win = 12;
	const listeners = new Set<(v: number) => void>();
	CV.registerComponentValues({
		winAmount: {
			subscribe(run: (v: number) => void) {
				listeners.add(run);
				run(win);
				return () => listeners.delete(run);
			},
		},
	});
	const instanceParams = { level: 50 };
	const live = mount(
		[
			{ target: 'fxParam', fxParam: 'heat', param: 'level', inMax: 100 },
			{ target: 'fxParam', fxParam: 'burst', source: 'winAmount', threshold: 10, smooth: 1 },
		],
		instanceParams,
		params,
	);
	flushSync();
	eq(
		'a component param (level 50 of 100) drives heat 5; an engine source (win 12 ≥ 10) the burst',
		live.read(),
		{ heat: 5, burst: true },
	);
	win = 5;
	for (const run of listeners) run(win);
	flushSync();
	eq(
		'the source drops below the threshold: the burst switches off at once (a switch never glides)',
		live.read(),
		{ heat: 5, burst: false },
	);
	live.stop();
	CV.clearComponentValues();
}

// ---- 9. ship: save → normalize → export → bake --------------------------------------------------

{
	const binding: ValueBinding = { target: 'fxParam', fxParam: 'heat', param: 'level', inMax: 100 };
	const placed = glowNode([binding]);
	const layout = normalizeLayoutDoc(
		{
			version: 2,
			projectKey: 'demo',
			scenes: [{ id: 'basegame', name: 'Base game', nodes: [clone(placed)] }],
		},
		'demo',
	) as { scenes: { nodes: LayoutNode[] }[] };
	eq(
		'the layout doc keeps an effect node’s `fxParam` binding verbatim',
		layout.scenes[0].nodes[0].valueBindings,
		[binding],
	);
	const def = {
		id: 'banner',
		name: 'Banner',
		version: 1,
		scope: 'project',
		category: 'overlay',
		root: { id: 'root', kind: 'container', x: 0, y: 0, children: [clone(placed), coinNode] },
		params: [{ key: 'level', kind: 'number', default: 50 }],
		inputs: smInputs,
		stateMachine: machine,
	} as unknown as ComponentDef;
	const savedDef = normalizeComponent(clone(def));
	eq(
		'the component def keeps it (its root children pass through) and its state machine',
		[savedDef.root.children[0].valueBindings, savedDef.stateMachine],
		[[binding], machine],
	);
	const C = 'acme';
	const P = 'demo';
	for (const doc of [tIdle, tWin, tCalm]) await saveCinematic(C, P, clone(doc), null);
	const loaded = (await loadCinematic(C, P, 't_win')).doc;
	eq('the cinematic store keeps the `fx:` channels, keys and eases', loaded?.tracks, tWin.tracks);
	const authored = await loadAuthoredCinematics(C, P);
	const index = await exportCinematics(C, P, authored);
	const deployed = JSON.parse(bucket.get(`${C}/${P}/deploy/cinematics/t_win.json`) ?? 'null');
	eq('…the export writes them to deploy/', deployed?.tracks, tWin.tracks);
	// The runtime bundle embeds these as JSON (`runtimeBundle.ts`); the game registers from it.
	const bundle = JSON.parse(
		JSON.stringify({ cinematics: index.cinematics, components: [savedDef], effects: [effect] }),
	) as { cinematics: CinematicDoc[]; components: ComponentDef[]; effects: EffectDoc[] };
	L.registerComponentTimelines(bundle.cinematics);
	R.clearEffects();
	R.registerEffects(bundle.effects);
	const baked = bundle.components[0];
	const { docs } = L.instanceTimelineDocs(baked.id, baked.stateMachine);
	eq('…the game resolves the state timelines by id', docs.map((d: CinematicDoc) => d.id).sort(), [
		't_calm',
		't_idle',
		't_win',
	]);
	const game = instance(docs, baked.root.children);
	eq(
		'…and the baked instance folds its own binding and the baked channel',
		round(game.values([5])),
		{ heat: 5, intensity: 0.2 },
	);
}

// ---- 10. parity ---------------------------------------------------------------------------------

{
	R.clearEffects();
	R.registerEffects([effect]);
	eq(
		'an effect nothing drives runs no fold (no params ⇒ no getter, no derivation)',
		[
			FV.fxParamsDriven(coinNode, [{ target: 'x', param: 'level' }], []),
			FV.fxParamsDriven(glowNode([{ target: 'alpha', param: 'level' }]), undefined, []),
			FV.fxParamsDriven(glowNode(), undefined, [{ target: 'x' }]),
		],
		[undefined, undefined, undefined],
	);
	ok(
		'…a driven one does, through the registry the game resolves effects with',
		FV.fxParamsDriven(glowNode([heat]), [heat], []) === effect.params &&
			FV.fxParamsDriven(glowNode(), undefined, [{ target: 'fxParam', fxParam: 'heat' }]) ===
				effect.params,
	);
	R.clearEffects();
	eq(
		'…and an effect the game never registered runs none',
		FV.fxParamsDriven(glowNode([heat]), [heat], []),
		undefined,
	);
	R.registerEffects([effect]);
	eq(
		'a blend with no rest (any node but an effect) leaves `fx:` channels out, the rest as before',
		[0.25, 0.75].map((t) => M.blendNodeSamples({ x: 10, 'fx:heat': 4 }, { 'fx:heat': 2 }, t)),
		[{ x: 7.5 }, { x: 2.5 }],
	);
	const plain = new L.ComponentTimelinePlayer(
		[timeline('t_plain', 'Glow', { x: [{ time: 0, value: 1 }] })],
		[glowNode()],
	);
	eq(
		'a player whose timelines key no `fx:` channel holds no rest',
		(plain as unknown as { fxRests: Map<string, unknown> }).fxRests.size,
		0,
	);
	const view = readFileSync(new URL('LayoutNodeView.svelte', LIB), 'utf8');
	ok(
		'LayoutNodeView: the placed effect takes the getter, which exists only for a driven effect',
		view.includes('<EffectPlayer doc={effectDoc} scope={signalScope} params={fxParamValues} />') &&
			/const fxParamValues = fxParams\s*\?\s*createFxParamValues\(allBindings, \(\) => allOutputs, fxParams\)\s*:\s*undefined;/.test(
				view,
			) &&
			view.includes('const fxParams = fxParamsDriven(node, bindings, timelineBindings);'),
	);
	ok(
		'…a bone-hosted effect nothing drives mounts the bare player, as before',
		/\{:else if fxDoc\}\s*<EffectPlayer doc=\{fxDoc\} scope=\{signalScope\} \/>/.test(view) &&
			view.includes(
				'<DrivenEffectPlayer node={fx} doc={fxDoc} drive={fxDrive} scope={signalScope} />',
			),
	);
	const editor = (file: string): string =>
		readFileSync(new URL(`../src/routes/(app)/editor/${file}`, import.meta.url), 'utf8');
	const canvas = editor('EditorCanvas.svelte');
	ok(
		'the editor: every live particle overlay previews the parameters through the same fold',
		(canvas.match(/effectParamValues=\{effectPreviewValues\}/g) ?? []).length ===
			(canvas.match(/<EditorEffectLayer/g) ?? []).length &&
			canvas.includes('previewEffectParamValues(node, doc.params)') &&
			editor('valuePreview.client.svelte.ts').includes(
				'boundFxParamValues(bindings, previewOutputs(node, undefined, params), params)',
			) &&
			editor('EditorEffectLayer.svelte').includes('notePlacedEffect(doc);'),
	);
}

console.log(
	failures
		? `\n❌ fx node params: ${passes} passed, ${failures} failed`
		: `\n✅ fx node params: ${passes} passed, 0 failed`,
);
if (failures) process.exit(1);
