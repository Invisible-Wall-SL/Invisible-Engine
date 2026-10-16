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
 *  8. the game's fold for real: `createNodeFold` (what `<LayoutNodeView>` and
 *     `<DrivenEffectPlayer>` both run), compiled with Svelte's own compiler, maps a component param
 *     and an engine source onto the parameters and merges a moving timeline; a bone-hosted effect's
 *     drive is asked once and holds;
 *  9. ship: save → normalize (layout doc, component def, cinematic) → export → the runtime
 *     bundle's JSON → the game's registries keep the binding and the channel;
 * 10. parity: an undriven effect node mounts `<EffectPlayer>` with no getter and runs no fold;
 *     a blend with no rest leaves `fx:` alone; a player whose timelines key no `fx:` channel holds
 *     no rest; the editor's wiring (source-scanned);
 * 11. a placement's own values (`EffectNode.params`) and the ones it takes from its component
 *     (`params.<id>`): every kind (a colour too), clamped, unknown and mistyped values skipped, a
 *     forward over the node's own, a binding over both, a blend resting on them; the editor's
 *     ⇡ expose / take / × edits, the orphan prune, and the save keeping them (§8 runs the fold,
 *     a forward following its param live).
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
const FV = await import('../../../packages/engine-layout/src/lib/nodeFold.svelte.ts');
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
const P = await import('../../../packages/engine-layout/src/lib/componentParams.ts');
const W = await import('../src/routes/(app)/editor/instanceParamForwarding.ts');

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
	'one prefix (the evaluator’s) builds every channel name; the drivable kinds',
	[EV.FX_PARAM_CHANNEL_PREFIX, F.fxParamChannel('heat'), [...F.FX_NODE_PARAM_KINDS]],
	['fx:', 'fx:heat', ['number', 'bool']],
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
	eq('…and unchecked by default: validation never reads the process-wide registry', codes(), []);
	const bare = { ...effect, params: undefined };
	eq(
		'an effect that declares no parameters: every keyed `fx:` channel is reported',
		codes(() => bare),
		['fx-param-unknown', 'fx-param-unknown', 'fx-param-unknown'],
	);
	const onSprite = timeline('t_sprite', 'Coin', { 'fx:intensity': [{ time: 0, value: 1 }] });
	eq(
		'an `fx:` channel on any other kind is a channel it cannot take',
		N.validateNodeActors(onSprite, { ...host, nodes: [coinNode] }).map(
			(i: { code: string }) => i.code,
		),
		['channel-unsupported'],
	);
	const rows = (doc: EffectDoc | undefined) =>
		S.fxTimelineRows(keyed, 'a', glowNode(), doc).map(
			(r: { channel: string; stale: boolean }) => `${r.stale ? '⚠' : '⚡'}${r.channel}`,
		);
	eq(
		'the Timeline lists the parameters, then each stale `fx:` channel, so its keys can be removed',
		rows(effect),
		['⚡fx:intensity', '⚡fx:heat', '⚡fx:burst', '⚠fx:gone', '⚠fx:hue'],
	);
	eq('…an effect whose last parameter was removed still shows its keys (all stale)', rows(bare), [
		'⚠fx:intensity',
		'⚠fx:gone',
		'⚠fx:hue',
	]);
	eq(
		'…while the effect is not loaded every keyed channel is listed as it is; never on a sprite',
		[rows(undefined), S.fxTimelineRows(keyed, 'a', coinNode, effect)],
		[['⚡fx:intensity', '⚡fx:gone', '⚡fx:hue'], []],
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
	// Every particle in flight, and its age: a reset would recycle them (`init` → `cleanup`), and a
	// recycled object respawned from the pool starts its age again.
	type Particle = { age: number; next: Particle | null };
	const flying = (): Particle[] => {
		const out: Particle[] = [];
		const first = (em as unknown as { _activeParticlesFirst: Particle | null })
			._activeParticlesFirst;
		for (let p = first; p; p = p.next) out.push(p);
		return out;
	};
	const before = flying();
	const ages = before.map((p) => p.age);
	let elapsed = 0;
	const frame = (dt: number) => {
		game.step(dt);
		applier?.apply(game.values());
		em.update(dt);
		elapsed += dt;
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
	const after = new Set(flying());
	ok(
		'no reset: every particle in flight before the drive is still flying, aged by every frame',
		before.length >= 5 &&
			before.every((p, i) => after.has(p) && Math.abs(p.age - (ages[i] + elapsed)) < 1e-6),
	);
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

// ---- 8. the game's fold, run for real: bindings from a param and a source, and a timeline ------

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
	// The rune modules compiled as SvelteKit compiles them; their plain imports stay the real files.
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
	write('nodeFold.svelte', source('nodeFold.svelte.ts'), true);
	// `createNodeFold` is what `<LayoutNodeView>` (every node) and `<DrivenEffectPlayer>` (a
	// bone-hosted effect) run; the drive stands in for a timeline whose playhead moves.
	const entry = write(
		'entry',
		`import { createNodeFold } from './nodeFold.svelte';
export function mount(node, params, channels) {
	const playhead = $state({ sample: {} });
	const drive = channels
		? { channels: new Set(channels), sample: () => playhead.sample }
		: undefined;
	let fold;
	const stop = $effect.root(() => {
		fold = createNodeFold(node, () => params, () => undefined, drive);
	});
	return { fold, seek: (sample) => (playhead.sample = sample), stop };
}
export function mountLive(node, initial) {
	const params = $state(initial);
	let fold;
	const stop = $effect.root(() => {
		fold = createNodeFold(node, () => params, () => undefined, undefined);
	});
	return { fold, params, stop };
}`,
		false,
	);
	type Fold = {
		allOutputs: readonly (number | undefined)[];
		fxParamValues: (() => Record<string, unknown> | undefined) | undefined;
	};
	const { mount, mountLive } = (await import(entry)) as {
		mount: (
			node: LayoutNode,
			p: Record<string, unknown>,
			channels?: string[],
		) => { fold: Fold; seek: (s: Record<string, number>) => void; stop: () => void };
		mountLive: (
			node: LayoutNode,
			p: Record<string, unknown>,
		) => { fold: Fold; params: Record<string, unknown>; stop: () => void };
	};
	const { flushSync } = (await import(svelteClient)) as { flushSync: () => void };
	// A smoothed output glides on a frame clock Node does not have: a frame that never comes keeps a
	// glide where it started, so a bool that wrongly glided would still read its old value below.
	(globalThis as { requestAnimationFrame?: () => number }).requestAnimationFrame = () => 1;
	R.clearEffects();
	R.registerEffects([effect]);
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
	const own: ValueBinding[] = [
		{ target: 'fxParam', fxParam: 'heat', param: 'level', inMax: 100 },
		{ target: 'fxParam', fxParam: 'burst', source: 'winAmount', threshold: 10, smooth: 1 },
	];
	const live = mount(glowNode(own), instanceParams, ['x', 'fx:heat']);
	flushSync();
	eq(
		'the fold maps onto the parameters: a param (level 50 of 100) is heat 5 on 0..10, a source (win 12 ≥ 10) switches the burst on',
		live.fold.fxParamValues?.(),
		{ heat: 5, burst: true },
	);
	win = 5;
	for (const run of listeners) run(win);
	flushSync();
	eq(
		'the source drops below the threshold: the burst switches off at once (a switch never glides)',
		live.fold.fxParamValues?.(),
		{ heat: 5, burst: false },
	);
	live.seek({ x: 3, 'fx:heat': 7 });
	eq(
		'the playhead keys heat: the timeline (after the bindings) wins it, the transform channel rides along',
		[live.fold.fxParamValues?.(), live.fold.allOutputs],
		[{ heat: 7, burst: false }, [5, 0, 3, 7]],
	);
	live.seek({});
	eq('…and gives it back when it no longer keys it', live.fold.fxParamValues?.(), {
		heat: 5,
		burst: false,
	});
	live.stop();
	const quiet = mount(glowNode([{ target: 'alpha', param: 'level', inMax: 100 }]), instanceParams);
	const sprite = mount({ ...coinNode, valueBindings: own } as LayoutNode, instanceParams);
	flushSync();
	eq(
		'an effect nothing drives, or another kind, gets no getter; its outputs are its bindings’',
		[typeof quiet.fold.fxParamValues, quiet.fold.allOutputs, typeof sprite.fold.fxParamValues],
		['undefined', [0.5], 'undefined'],
	);
	quiet.stop();
	sprite.stop();

	// A placement's own values are the base the fold drives over, and a colour one rides along.
	const set = mount(
		{
			...glowNode([{ target: 'fxParam', fxParam: 'heat', param: 'level', inMax: 100 }]),
			params: { heat: 9, intensity: 0.8, hue: '#00FF00' },
		} as LayoutNode,
		instanceParams,
	);
	flushSync();
	eq(
		'the node’s own values (a colour too) under its binding: the binding wins heat, the rest stand',
		set.fold.fxParamValues?.(),
		{ intensity: 0.8, heat: 5, hue: '#00ff00' },
	);
	set.stop();
	const colourOnly = mount({ ...glowNode(), params: { hue: '#123456' } } as LayoutNode, {});
	flushSync();
	eq('an effect only its own colour sets still gets a getter', colourOnly.fold.fxParamValues?.(), {
		hue: '#123456',
	});
	colourOnly.stop();
	const taken = mountLive(
		{
			...glowNode(),
			params: { heat: 1 },
			paramBindings: { 'params.heat': 'potHeat', 'params.hue': 'potColour' },
		} as LayoutNode,
		{ potHeat: 3, potColour: 0x0000ff },
	);
	flushSync();
	eq(
		'a value taken from the component: its params, read as the parameters',
		taken.fold.fxParamValues?.(),
		{ heat: 3, hue: '#0000ff' },
	);
	taken.params.potHeat = 8;
	taken.params.potColour = 0xff8800;
	flushSync();
	eq('…and followed live when the component’s param changes', taken.fold.fxParamValues?.(), {
		heat: 8,
		hue: '#ff8800',
	});
	delete taken.params.potHeat;
	flushSync();
	eq('…the component’s param gone, the node’s own value stands', taken.fold.fxParamValues?.(), {
		heat: 1,
		hue: '#ff8800',
	});
	taken.stop();
	CV.clearComponentValues();

	// A bone-hosted effect's drive is asked once per effect and never flips while the rig lives.
	let asked = 0;
	let answer: { channels: Set<string>; sample: () => object } | undefined = {
		channels: new Set(['fx:heat']),
		sample: () => ({}),
	};
	const driver = (id: string) => {
		asked++;
		return id === 'n_glow' ? answer : undefined;
	};
	const attached = FV.attachedEffectDrives(driver as never);
	const first = attached(glowNode() as never);
	answer = undefined;
	const again = attached(glowNode() as never);
	const other = { ...glowNode(), id: 'n_other' } as never;
	eq(
		'a bone-hosted effect: driven by its timeline, asked once, and the answer holds',
		[!!first?.drive, again === first, attached(other), attached(other), asked],
		[true, true, null, null, 2],
	);
	eq(
		'…its own binding drives it with no timeline at all',
		!!FV.attachedEffectDrives(undefined)(glowNode([heat]) as never),
		true,
	);
	eq(
		'…and so does a value of its own',
		FV.attachedEffectDrives(undefined)({ ...glowNode(), params: { heat: 4 } } as never),
		{},
	);
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
	const ownValues = { heat: 4, burst: true, hue: '#00ff00' };
	const forwards = { 'params.intensity': 'level' };
	const valued = normalizeLayoutDoc(
		{
			version: 2,
			projectKey: 'demo',
			scenes: [
				{
					id: 'basegame',
					name: 'Base game',
					nodes: [{ ...clone(placed), params: ownValues, paramBindings: forwards }],
				},
			],
		},
		'demo',
	) as { scenes: { nodes: { params?: unknown; paramBindings?: unknown }[] }[] };
	eq(
		'…and its own parameter values and forwards',
		[valued.scenes[0].nodes[0].params, valued.scenes[0].nodes[0].paramBindings],
		[ownValues, forwards],
	);
	const def = {
		id: 'banner',
		name: 'Banner',
		version: 1,
		scope: 'project',
		category: 'overlay',
		root: {
			id: 'root',
			kind: 'container',
			x: 0,
			y: 0,
			children: [{ ...clone(placed), params: ownValues, paramBindings: forwards }, coinNode],
		},
		params: [{ key: 'level', kind: 'number', default: 50 }],
		inputs: smInputs,
		stateMachine: machine,
	} as unknown as ComponentDef;
	const savedDef = normalizeComponent(clone(def));
	const savedEffect = savedDef.root.children[0] as LayoutNode & {
		params?: unknown;
		paramBindings?: unknown;
	};
	eq(
		'the component def keeps it (its root children pass through), its values, its forward and its state machine',
		[
			savedEffect.valueBindings,
			savedEffect.params,
			savedEffect.paramBindings,
			savedDef.stateMachine,
		],
		[[binding], ownValues, forwards, machine],
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
	// The two components cannot run here; what they run can (§8). These pin that they run it.
	const view = readFileSync(new URL('LayoutNodeView.svelte', LIB), 'utf8');
	const driven = readFileSync(new URL('DrivenEffectPlayer.svelte', LIB), 'utf8');
	ok(
		'LayoutNodeView runs the shared fold with its node and its timeline drive, and hands the placed effect its getter',
		/const fold = createNodeFold\(\s*node,\s*\(\) => bindingParams,[\s\S]{0,120}?timelineDrive,\s*\);/.test(
			view,
		) &&
			view.includes('const { bound, allBindings, fxParamValues } = fold;') &&
			view.includes(
				'<EffectPlayer doc={effectDoc} scope={signalScope} params={fxParamValues} />',
			) &&
			!/createBoundValues|withNodeActorOutputs/.test(view),
	);
	ok(
		'…DrivenEffectPlayer runs the same fold for a bone-hosted effect',
		/const fold = createNodeFold\(\s*node,\s*\(\) => bindingParams,\s*\(\) => undefined,\s*drive,\s*\);/.test(
			driven,
		) && driven.includes('<EffectPlayer {doc} {scope} params={fold.fxParamValues} />'),
	);
	ok(
		'…a bone-hosted effect is asked once (no per-render drive), and one nothing drives mounts the bare player',
		view.includes('const attachedDrive = attachedEffectDrives(nodeDriver);') &&
			/\{#if fxDoc && attachedDrive\(fx\)\}\s*<DrivenEffectPlayer[\s\S]{0,120}?drive=\{attachedDrive\(fx\)\?\.drive\}/.test(
				view,
			) &&
			/\{:else if fxDoc\}\s*<EffectPlayer doc=\{fxDoc\} scope=\{signalScope\} \/>/.test(view) &&
			!/\{@const fxDrive/.test(view),
	);
	const editor = (file: string): string =>
		readFileSync(new URL(`../src/routes/(app)/editor/${file}`, import.meta.url), 'utf8');
	const canvas = editor('EditorCanvas.svelte');
	ok(
		'the editor: every live particle overlay previews the parameters through the same fold',
		(canvas.match(/effectParamValues=\{effectPreviewValues\}/g) ?? []).length ===
			(canvas.match(/<EditorEffectLayer/g) ?? []).length &&
			canvas.includes('previewEffectParamValues(node, doc.params, params)') &&
			editor('valuePreview.client.svelte.ts').includes(
				'boundFxParamValues(bindings, previewOutputs(node, undefined, params), params)',
			) &&
			editor('valuePreview.client.svelte.ts').includes(
				'placedFxParamValues(node, componentParams, params)',
			) &&
			editor('EditorEffectLayer.svelte').includes('notePlacedEffect(doc);'),
	);
	const overlay = editor('EditorEffectLayer.svelte');
	ok(
		'…each live overlay knows the open component’s params, and every effect is asked with the params of the instance it sits in',
		(canvas.match(/\{componentParams\}\s*\{componentDefaults\}/g) ?? []).length >=
			(canvas.match(/<EditorEffectLayer/g) ?? []).length &&
			overlay.includes(
				'forwardInstanceParams(node, resolveLayoutInstanceParams(node, layoutType), outer)',
			) &&
			overlay.includes('effectParamValues?.(tg.node, doc, tg.params)') &&
			overlay.includes('effectParamValues(node.node, doc, node.params)') &&
			overlay.includes('effectParamValues(node.node, node.doc, node.params)') &&
			overlay.includes('void JSON.stringify(componentParams);'),
	);
	const props = editor('EditorProperties.svelte');
	ok(
		'the Effect panel lists the placed effect’s parameters with a value each, and in a component a ⇡ picker',
		props.includes('{@const fxDoc = placedEffect(node.effectId)}') &&
			props.includes('{#each fxDoc.params as p (p.id)}') &&
			props.includes('setEffectParamValue(n, param.id') &&
			props.includes('exposeEffectParam(parent, n, param)') &&
			props.includes('linkEffectParam(parent, n, param, pick)') &&
			props.includes('unlinkInstanceParam(n, param.id)'),
	);
	const panel = editor('EditorTimelinePanel.svelte');
	const issuesFn = panel.slice(
		panel.indexOf('function issues()'),
		panel.indexOf('async function leaveHost'),
	);
	ok(
		'the Timeline’s issues re-run when an effect loads, and check every host (Also on included) against the loaded effects',
		issuesFn.includes('void placedEffectsVersion();') &&
			issuesFn.includes('validateNodeActors(doc, scene, placedEffect)') &&
			issuesFn.includes('validateNodeActors(doc, host, placedEffect)'),
	);
	const loader = editor('placedEffects.client.svelte.ts');
	ok(
		'every editor read of an effect doc names the tab’s project; a failed read is retried later',
		/fetch\(\s*withEditorProject\(`\/api\/editor\/effect\?id=/.test(loader) &&
			/fetch\(\s*withEditorProject\(`\/api\/editor\/effect\?id=/.test(
				editor('EditorEffectLayer.svelte'),
			) &&
			loader.includes('setTimeout(() => pending.delete(effectId), RETRY_MS)'),
	);
	const route = readFileSync(
		new URL('../src/routes/api/editor/effect/+server.ts', import.meta.url),
		'utf8',
	);
	ok(
		'…and the effect route refuses a pinned project the session no longer holds',
		/const mismatch = scopeMismatch\(url\.searchParams\.get\('projectKey'\), projectKey\);\s*if \(mismatch\) return mismatch;/.test(
			route,
		),
	);
	const flowServer = readFileSync(
		new URL('../src/routes/(app)/flow-v2/+page.server.ts', import.meta.url),
		'utf8',
	);
	ok(
		'the server validates with an explicit resolver that knows no effect (no module registry)',
		flowServer.includes('validateNodeActors(doc, scene, () => undefined)') &&
			!readFileSync(new URL('cinematicNodes.ts', LIB), 'utf8').includes('resolveEffect'),
	);
}

// ---- 11. a placement's own values, and the ones it takes from its component ---------------------

{
	R.clearEffects();
	const bare = normalizeEffectDoc(clone({ ...authoredEffect, id: 'bare', params: undefined }));
	R.registerEffects([effect, bare]);
	const placedNode = (
		values?: Record<string, unknown>,
		forwards?: Record<string, string>,
	): LayoutNode =>
		({
			...glowNode(),
			...(values ? { params: values } : {}),
			...(forwards ? { paramBindings: forwards } : {}),
		}) as LayoutNode;
	eq(
		'a node sets a parameter with a value of its own or a forward; nothing else counts',
		[
			F.setsFxParams(glowNode()),
			F.setsFxParams(placedNode({})),
			F.setsFxParams(placedNode({ heat: 4 })),
			F.setsFxParams(placedNode(undefined, { 'params.hue': 'potColour' })),
			F.setsFxParams(placedNode(undefined, { region: 'art' })),
			F.setsFxParams({ ...coinNode, params: { heat: 4 } } as unknown as LayoutNode),
		],
		[false, false, true, true, false, false],
	);
	eq(
		'its own values: every kind, a number clamped to its range, a colour lower-cased',
		F.placedFxParamValues(
			placedNode({ hue: '#00FF00', burst: true, heat: 20, intensity: 0.25 }),
			{},
			params,
		),
		{ intensity: 0.25, heat: 10, burst: true, hue: '#00ff00' },
	);
	eq(
		'an id the effect does not declare, a value of the wrong kind, nothing set, no parameters, another kind: no values',
		[
			F.placedFxParamValues(placedNode({ glow: 1, heat: 'hot', burst: 1, hue: 'red' }), {}, params),
			F.placedFxParamValues(glowNode(), {}, params),
			F.placedFxParamValues(placedNode({ heat: 4 }), {}, undefined),
			F.placedFxParamValues(
				{ ...coinNode, params: { heat: 4 } } as unknown as LayoutNode,
				{},
				params,
			),
		],
		[undefined, undefined, undefined, undefined],
	);
	const forwarded = placedNode(
		{ heat: 4, hue: '#0000ff' },
		{ 'params.heat': 'potHeat', 'params.hue': 'potColour' },
	);
	eq(
		'a forward reads the component’s param (a colour param’s 0xrrggbb as #rrggbb) over the node’s own',
		F.placedFxParamValues(forwarded, { potHeat: 7, potColour: 0x00ff00 }, params),
		{ heat: 7, hue: '#00ff00' },
	);
	eq(
		'…while the component holds no value of the parameter’s kind, the node’s own stands',
		F.placedFxParamValues(forwarded, { potHeat: 'x' }, params),
		{ heat: 4, hue: '#0000ff' },
	);
	eq(
		'what the bindings and the timeline drive goes over the node’s values; either alone stands',
		[
			F.nodeFxParamValues({ heat: 4, hue: '#00ff00' }, { heat: 6 }),
			F.nodeFxParamValues({ heat: 4 }, undefined),
			F.nodeFxParamValues(undefined, { heat: 6 }),
			F.nodeFxParamValues(undefined, undefined),
		],
		[{ heat: 6, hue: '#00ff00' }, { heat: 4 }, { heat: 6 }, undefined],
	);
	ok(
		'a node that sets a parameter runs the fold, a colour-only one included',
		FV.fxParamsDriven(placedNode({ hue: '#00ff00' }), undefined, []) === effect.params &&
			FV.fxParamsDriven(placedNode(undefined, { 'params.heat': 'k' }), undefined, []) ===
				effect.params,
	);
	eq(
		'…an effect that declares none, or that the game never registered, runs none',
		[
			FV.fxParamsDriven(
				{ ...placedNode({ heat: 4 }), effectId: 'bare' } as LayoutNode,
				undefined,
				[],
			),
			FV.fxParamsDriven(
				{ ...placedNode({ heat: 4 }), effectId: 'gone' } as LayoutNode,
				undefined,
				[],
			),
		],
		[undefined, undefined],
	);
	eq(
		'a blend rests on the node’s own value (clamped; a bool as 1 / 0), else the default',
		[
			F.fxParamRest(params, 'fx:heat', { heat: 4 }),
			F.fxParamRest(params, 'fx:heat', { heat: 40 }),
			F.fxParamRest(params, 'fx:burst', { burst: true }),
			F.fxParamRest(params, 'fx:heat', { heat: 'hot' }),
			F.fxParamRest(params, 'fx:heat'),
		],
		[4, 10, 1, 2, 2],
	);
	const game = instance([tWin, tCalm], [placedNode({ intensity: 0.1 }), coinNode], {
		layers: [{ ...machine.layers[0], entry: 'win' }],
	});
	game.runner.fire('calm');
	game.step(0.1);
	game.step(0.05);
	eq(
		'…so a state machine leaving a keyed state mixes towards the placement’s value (1 → 0.1 at a quarter: 0.775)',
		r3(game.values()?.intensity),
		0.775,
	);
	{
		// The real applier takes the placement's values like any other: the colour reaches the tint.
		const layer = effect.layers[0];
		const em = new Emitter(new Container(), clone(layer.config));
		const values = F.placedFxParamValues(placedNode({ intensity: 1, heat: 10 }), {}, params);
		const applier = bindEffectParams({ params, layer, emitter: em, values });
		applier?.apply(values);
		eq('…and moves a real emitter', [r3(em.frequency), em.maxParticles], [0.02, 1010]);
	}

	// The editor's edits (pure, over the draft): ⇡ expose, take from, × and a value of its own.
	const parent = (): ComponentDef =>
		({
			id: 'pot',
			name: 'Pot',
			version: 1,
			scope: 'project',
			category: 'overlay',
			root: { id: 'root', kind: 'container', x: 0, y: 0, children: [] },
			params: [
				{ key: 'heat', kind: 'number', default: 1 },
				{ key: 'tint', kind: 'color', default: 0xffffff },
				{ key: 'on', kind: 'boolean', default: false },
			],
		}) as unknown as ComponentDef;
	const fxNode = (values?: Record<string, unknown>) =>
		placedNode(values) as Extract<LayoutNode, { kind: 'effect' }>;
	{
		const def = parent();
		const n = fxNode({ heat: 6 });
		const keys = [
			W.exposeEffectParam(def, n, param('heat')),
			W.exposeEffectParam(def, n, param('hue')),
			W.exposeEffectParam(def, n, param('burst')),
			W.exposeEffectParam(def, n, param('heat')),
		];
		eq(
			'⇡ expose: a param of the matching kind at the value shown now (a colour as 0xrrggbb), a free key, taken from',
			[keys, def.params?.slice(3), n.paramBindings],
			[
				['heat_2', 'hue', 'burst', null],
				[
					{ key: 'heat_2', kind: 'number', author: true, default: 6 },
					{ key: 'hue', kind: 'color', author: true, default: 0xff0000 },
					{ key: 'burst', kind: 'boolean', author: true, default: false },
				],
				{ 'params.heat': 'heat_2', 'params.hue': 'hue', 'params.burst': 'burst' },
			],
		);
		eq(
			'…and the placement then reads it from the component',
			F.placedFxParamValues(n, P.resolveComponentParams(def, { heat_2: 3 }), params),
			{ heat: 3, burst: false, hue: '#ff0000' },
		);
		def.params = def.params?.filter((p) => p.key !== 'hue');
		P.pruneOrphanParamBindings({ ...def, root: { ...def.root, children: [n] } } as ComponentDef);
		eq(
			'deleting the component’s param drops the forward; the node keeps its own value',
			[n.paramBindings, n.params],
			[{ 'params.heat': 'heat_2', 'params.burst': 'burst' }, { heat: 6 }],
		);
	}
	{
		const def = parent();
		const n = fxNode();
		eq(
			'take from: only a param of the matching kind; × stops taking it',
			[
				W.linkableEffectParentParams(def, param('heat')).map((p) => p.key),
				W.linkableEffectParentParams(def, param('hue')).map((p) => p.key),
				W.linkableEffectParentParams(def, param('burst')).map((p) => p.key),
				W.linkEffectParam(def, n, param('hue'), 'heat'),
				W.linkEffectParam(def, n, param('hue'), 'tint'),
				n.paramBindings,
				W.unlinkInstanceParam(n, 'hue'),
				n.paramBindings,
			],
			[['heat'], ['tint'], ['on'], false, true, { 'params.hue': 'tint' }, true, undefined],
		);
		W.setEffectParamValue(n, 'heat', 4);
		W.setEffectParamValue(n, 'hue', '#00ff00');
		const both = clone(n.params);
		W.setEffectParamValue(n, 'heat', undefined);
		W.setEffectParamValue(n, 'hue', undefined);
		eq(
			'a value of its own: set, then cleared back to none',
			[both, n.params],
			[{ heat: 4, hue: '#00ff00' }, undefined],
		);
	}
}

console.log(
	failures
		? `\n❌ fx node params: ${passes} passed, ${failures} failed`
		: `\n✅ fx node params: ${passes} passed, 0 failed`,
);
if (failures) process.exit(1);
