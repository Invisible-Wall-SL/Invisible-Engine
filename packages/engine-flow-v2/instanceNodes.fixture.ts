/**
 * Offline fixture for placed component INSTANCE nodes (schema §6.3, Rive plan §6.2 — Phase 7a).
 * Run with tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/engine-flow-v2/instanceNodes.fixture.ts
 * (The package's `tsconfig.json` excludes this file alone: its top-level `await` and `process` do
 * not compile under the package's module target; `containerScenes.fixture.ts` stays type-checked.)
 *
 * A `componentInstance` node names a placed instance on a screen; its pins are DERIVED from that
 * instance's pinned component interface (`PinContext.instances`), never stored. SEVEN claims:
 *
 *  1. PINS FOLLOW THE INTERFACE. A trigger is an exec-in `fire:<id>`, a bool / number / text input
 *     an optional data-in `in:<id>` (bool / float / string), an event an exec-out `event:<id>` with a
 *     data-out per payload field, a state layer a string data-out `value:<layer>.state`; plus `set`
 *     and `exec`. No decl, a missing def, or a decl on another screen ⇒ the base pins only.
 *  2. EVENTS HAVE THEIR OWN PIN FORM. `event:confirm` is never `containerEventDeclId`'s
 *     `<id>.onConfirm`, and the id helpers round-trip (an event id may carry a `.`).
 *  3. THE VALIDATOR JUDGES EVERY WIRE against the interface: a stale exec wire, data wire or stored
 *     source is `instance-pin-missing`; an unplaced instance, a lost def or version is
 *     `instance-missing`; a wait on a missing layer / unknown state; a text literal that is not a
 *     key; an event payload data-out wired off its own chain (`signal-cross-event`). A clean doc
 *     has no error, and its unfed inputs raise no `unfilled-data-in`.
 *  4. NEVER GUESS. Without a projection (`instances` absent) none of the instance checks run.
 *  5. THE RUNTIME reaches the env: `set` applies the fed inputs, `fire:<t>` applies them then fires,
 *     a value data-out reads the env, a wait awaits it, a raised event walks from its pin with the
 *     payload on `$trigger`, ownership is a pure read (global and mode graphs), and a recorder env
 *     without the hooks neither crashes nor hangs.
 *  6. THE PREVIEW records each instance op with a virtual-clock stamp.
 *  7. PARITY. For every registered starter flow — none places an instance — the derived pins and
 *     the validation verdict are byte-identical with and without the projection, and
 *     `collectInstanceTextKeys` collects every literal key once and skips what is not a key.
 */

import {
	collectInstanceTextKeys,
	deriveInstancePins,
	docNamesInstance,
	instanceEventFieldOf,
	instanceEventFieldPin,
	instanceEventOf,
	instanceEventPin,
	instanceInputOf,
	instanceInputPin,
	instanceNodeRef,
	instanceTriggerOf,
	instanceTriggerPin,
	instanceValuePin,
	isLocalizationKey,
	parseInstanceNodeRef,
} from './src/instanceNodes.ts';
import { containerEventDeclId } from './src/containerEvents.ts';
import { derivePins, type PinContext } from './src/pins.ts';
import { deriveGraphPins } from './src/scope.ts';
import { validateFlowDoc } from './src/validate.ts';
import {
	flowOwnsInstanceEvent,
	runFlowEvent,
	runFlowInstanceEvent,
	type FlowV2Env,
	type RunContext,
} from './src/runtime.ts';
import { createFlowV2Env } from './src/env.ts';
import { collapseToFunction } from './src/collapse.ts';
import { createContainerMountModel } from './src/mount.ts';
import { previewFlowEvent } from './src/preview.ts';
import { DRIVEN_SEEDS, BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS } from './src/reference/drivenSeed.ts';
import { templateVocabulary } from './src/reference/registry.ts';
import type {
	FlowDoc,
	FlowInstanceDecl,
	FunctionLibraryDoc,
	Graph,
	Node,
	Pin,
	TemplateVocabulary,
} from './src/types.ts';

let failures = 0;
let passes = 0;
const eq = (name: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passes++;
		return;
	}
	failures++;
	console.error(`✗ ${name}\n    expected ${e}\n    got      ${a}`);
};

// ---- fixtures ----------------------------------------------------------------------------------

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };
const VOCAB: TemplateVocabulary = {
	templateId: 'fixture',
	structs: [],
	enums: [],
	events: [{ name: 'winInfo', payload: [{ name: 'amount', type: { t: 'float' } }] }],
	actions: [
		{ name: 'celebrate', params: [{ name: 'amount', type: { t: 'float' } }], category: 'effect' },
		{ name: 'ping', params: [], category: 'effect' },
	],
	cues: [],
	collections: [],
	values: [],
};

/** A win banner: a `win` trigger, a `lit` bool, an `amount` number, a `title` text; events
 *  `pressed` and `done(amount, title)`; one state layer `main` (idle, win). */
const BANNER: FlowInstanceDecl = {
	container: 'basegame',
	instance: 'c_banner',
	name: 'winBanner',
	componentId: 'banner',
	version: 3,
	interface: {
		inputs: [
			{ id: 'win', kind: 'trigger' },
			{ id: 'lit', kind: 'bool' },
			{ id: 'amount', kind: 'number' },
			{ id: 'title', kind: 'text' },
		],
		events: [
			{ id: 'pressed' },
			{
				id: 'done',
				payload: [
					{ name: 'amount', type: { t: 'float' } },
					{ name: 'title', type: { t: 'string' } },
				],
			},
		],
		values: [{ id: 'main.state', layer: 'main', states: ['idle', 'win', 'exit'] }],
	},
};
const INSTANCES: Record<string, FlowInstanceDecl> = { c_banner: BANNER };
const at = { x: 0, y: 0 };
const CONTAINERS = [{ id: 'basegame', sceneId: 'basegame', z: 10 }];

const doc = (graph: Graph, modes?: FlowDoc['modes']): FlowDoc => ({
	version: 2,
	templateId: VOCAB.templateId,
	graph,
	containers: CONTAINERS,
	...(modes ? { modes } : {}),
});

const pinIds = (pins: Pin[]): string[] => pins.map((p) => `${p.dir}:${p.kind}:${p.id}`);

// ---- 1. pins -----------------------------------------------------------------------------------
{
	const pins = deriveInstancePins(BANNER);
	eq('1. the pins follow the interface, in order', pinIds(pins), [
		'in:exec:set',
		'in:exec:fire:win',
		'in:data:in:lit',
		'in:data:in:amount',
		'in:data:in:title',
		'out:exec:exec',
		'out:exec:event:pressed',
		'out:exec:event:done',
		'out:data:event:done:amount',
		'out:data:event:done:title',
		'out:data:value:main.state',
	]);
	eq(
		'1. data-in types and optionality',
		pins
			.filter((p) => p.dir === 'in' && p.kind === 'data')
			.map((p) => [p.id, p.dataType?.t, p.optional]),
		[
			['in:lit', 'bool', true],
			['in:amount', 'float', true],
			['in:title', 'string', true],
		],
	);
	eq(
		'1. event and value data-out types',
		pins.filter((p) => p.dir === 'out' && p.kind === 'data').map((p) => [p.id, p.dataType?.t]),
		[
			['event:done:amount', 'float'],
			['event:done:title', 'string'],
			['value:main.state', 'string'],
		],
	);
	eq(
		'1. the event exec-out is labelled on<Event>',
		pins.find((p) => p.id === 'event:pressed')?.label,
		'onPressed',
	);
	eq(
		'1. an event id or a payload field carrying ":" (the pin separator) mints no pin',
		pinIds(
			deriveInstancePins({
				...BANNER,
				interface: {
					inputs: [],
					events: [{ id: 'a:b' }, { id: 'ok', payload: [{ name: 'x:y', type: { t: 'float' } }] }],
					values: [],
				},
			}),
		),
		['in:exec:set', 'out:exec:exec', 'out:exec:event:ok'],
	);
	eq('1. no decl ⇒ base pins', pinIds(deriveInstancePins(undefined)), [
		'in:exec:set',
		'out:exec:exec',
	]);
	eq('1. a missing def ⇒ base pins', pinIds(deriveInstancePins({ ...BANNER, missing: 'def' })), [
		'in:exec:set',
		'out:exec:exec',
	]);
	const ctx: PinContext = { vocab: VOCAB, library: LIBRARY, instances: INSTANCES };
	const node: Node = {
		id: 'n1',
		kind: 'componentInstance',
		pos: at,
		container: 'basegame',
		instance: 'c_banner',
	};
	eq('1. derivePins reads the projection by instance id', derivePins(node, ctx).length, 11);
	eq(
		'1. a decl on another screen is not this node’s ⇒ base pins',
		derivePins({ ...node, container: 'hud' }, ctx).length,
		2,
	);
	eq(
		'1. no projection ⇒ base pins (never guess)',
		derivePins(node, { vocab: VOCAB, library: LIBRARY }).length,
		2,
	);
	eq(
		'1. waitForState has exec in/out only',
		pinIds(
			derivePins(
				{
					id: 'w',
					kind: 'waitForState',
					pos: at,
					container: 'basegame',
					instance: 'c_banner',
					layer: 'main',
					state: 'idle',
				},
				ctx,
			),
		),
		['in:exec:exec', 'out:exec:exec'],
	);
}

// ---- 2. pin ids --------------------------------------------------------------------------------
{
	eq(
		'2. an event pin is never a press pin',
		instanceEventPin('confirm') === containerEventDeclId('c_dlg', 'confirm'),
		false,
	);
	eq(
		'2. helpers round-trip',
		[
			instanceTriggerOf(instanceTriggerPin('win')),
			instanceInputOf(instanceInputPin('amount')),
			instanceEventOf(instanceEventPin('big.win')),
			instanceEventFieldOf(instanceEventFieldPin('big.win', 'win.amount')),
			instanceEventOf(instanceEventFieldPin('done', 'amount')),
			instanceTriggerOf('in:win'),
			instanceInputOf('fire:win'),
			instanceEventFieldOf('event:win'),
			instanceEventFieldOf('event:win:'),
			instanceValuePin('main.state'),
		],
		[
			'win',
			'amount',
			'big.win',
			{ event: 'big.win', field: 'win.amount' },
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			'value:main.state',
		],
	);
	eq(
		'2. event "a.b" and field "b" of event "a" never share a pin',
		instanceEventPin('a.b') === instanceEventFieldPin('a', 'b'),
		false,
	);
	eq(
		'2. docNamesInstance sees a component node or a wait, in a group body or a mode, and nothing else',
		[
			docNamesInstance(doc({ nodes: [], exec: [], data: [] })),
			docNamesInstance(
				doc({ nodes: [{ id: 'ev', kind: 'event', pos: at, ref: 'winInfo' }], exec: [], data: [] }),
			),
			docNamesInstance(
				doc({
					nodes: [
						{
							id: 'w',
							kind: 'waitForState',
							pos: at,
							container: 'basegame',
							instance: 'c_banner',
							layer: 'main',
							state: 'idle',
						},
					],
					exec: [],
					data: [],
				}),
			),
			docNamesInstance(
				doc({
					nodes: [
						{
							id: 'g',
							kind: 'group',
							pos: at,
							label: 'g',
							body: {
								nodes: [
									{
										id: 'n1',
										kind: 'componentInstance',
										pos: at,
										container: 'basegame',
										instance: 'c_banner',
									},
								],
								exec: [],
								data: [],
							},
							boundary: [],
						},
					],
					exec: [],
					data: [],
				}),
			),
			docNamesInstance(
				doc(
					{ nodes: [], exec: [], data: [] },
					{
						bonus: {
							graph: {
								nodes: [
									{
										id: 'm1',
										kind: 'componentInstance',
										pos: at,
										container: 'basegame',
										instance: 'c_banner',
									},
								],
								exec: [],
								data: [],
							},
						},
					},
				),
			),
		],
		[false, false, true, true, true],
	);
	eq('2. the palette ref round-trips', parseInstanceNodeRef(instanceNodeRef('hud_1', 'c_2')), {
		container: 'hud_1',
		instance: 'c_2',
	});
	eq('2. a bare ref is an instance with no screen', parseInstanceNodeRef('c_2'), {
		container: '',
		instance: 'c_2',
	});
	eq('2. a localization key has a letter', ['Win!', '12', '', 'ü', 5].map(isLocalizationKey), [
		true,
		false,
		false,
		true,
		false,
	]);
}

// ---- 3 + 4. validation -------------------------------------------------------------------------
const banner = (id = 'n1', extra: Partial<Node> = {}): Node =>
	({
		id,
		kind: 'componentInstance',
		pos: at,
		container: 'basegame',
		instance: 'c_banner',
		...extra,
	}) as Node;
const errorsOf = (
	d: FlowDoc,
	instances: Record<string, FlowInstanceDecl> | undefined = INSTANCES,
) =>
	validateFlowDoc(d, VOCAB, LIBRARY, undefined, undefined, undefined, instances)
		.filter((i) => i.severity === 'error')
		.map((i) => i.code)
		.sort();
{
	const CLEAN: Graph = {
		nodes: [
			{ id: 'ev', kind: 'event', pos: at, ref: 'winInfo' },
			banner('n1', {
				inputs: { 'in:title': { kind: 'literal', type: { t: 'string' }, value: 'Big win' } },
			}),
			{ id: 'cel', kind: 'action', pos: at, ref: 'celebrate' },
			{ id: 'ping', kind: 'action', pos: at, ref: 'ping' },
			{
				id: 'w',
				kind: 'waitForState',
				pos: at,
				container: 'basegame',
				instance: 'c_banner',
				layer: 'main',
				state: 'idle',
			},
			{
				id: 'br',
				kind: 'branch',
				pos: at,
				guard: {
					all: [
						{
							left: { kind: 'wire' },
							op: 'eq',
							right: { kind: 'literal', type: { t: 'string' }, value: 'win' },
						},
					],
				},
			},
		],
		exec: [
			{ from: { node: 'ev', pin: 'exec' }, to: { node: 'n1', pin: 'fire:win' } },
			{ from: { node: 'n1', pin: 'exec' }, to: { node: 'w', pin: 'exec' } },
			{ from: { node: 'w', pin: 'exec' }, to: { node: 'br', pin: 'exec' } },
			{ from: { node: 'n1', pin: 'event:done' }, to: { node: 'cel', pin: 'exec' } },
			{ from: { node: 'n1', pin: 'event:pressed' }, to: { node: 'ping', pin: 'exec' } },
		],
		data: [
			{ from: { node: 'ev', pin: 'amount' }, to: { node: 'n1', pin: 'in:amount' } },
			{ from: { node: 'n1', pin: 'event:done:amount' }, to: { node: 'cel', pin: 'amount' } },
			{ from: { node: 'n1', pin: 'value:main.state' }, to: { node: 'br', pin: 'all.0.left' } },
		],
	};
	eq('3. a clean doc has no error', errorsOf(doc(CLEAN)), []);
	const warningsOf = (d: FlowDoc) =>
		validateFlowDoc(d, VOCAB, LIBRARY, undefined, undefined, undefined, INSTANCES)
			.filter((i) => i.severity === 'warning')
			.map((i) => i.code);
	eq(
		'3. a text input wired from a game-signal value warns instance-text-wire; from an event payload field it does not',
		[
			warningsOf(
				doc({
					...CLEAN,
					nodes: CLEAN.nodes.map((n) => (n.id === 'n1' ? banner('n1') : n)),
					data: [
						...CLEAN.data,
						{ from: { node: 'ev', pin: 'amount' }, to: { node: 'n1', pin: 'in:title' } },
					],
				}),
			),
			warningsOf(
				doc({
					nodes: [banner('n1'), banner('n2')],
					exec: [{ from: { node: 'n1', pin: 'event:done' }, to: { node: 'n2', pin: 'set' } }],
					data: [
						{ from: { node: 'n1', pin: 'event:done:title' }, to: { node: 'n2', pin: 'in:title' } },
					],
				}),
			),
		],
		[['instance-text-wire'], []],
	);
	eq(
		'3. collapse to function refuses a component node whose event pin is wired, and takes one whose pins are not',
		[
			'error' in
				collapseToFunction(
					{
						doc: doc(CLEAN),
						library: LIBRARY,
						selection: ['n1', 'w'],
						functionId: 'fn_1',
						functionName: 'fn',
					},
					{ vocab: VOCAB, library: LIBRARY, instances: INSTANCES },
				),
			'error' in
				collapseToFunction(
					{
						doc: doc({
							nodes: [
								{ id: 'ev', kind: 'event', pos: at, ref: 'winInfo' },
								banner('n1'),
								{ id: 'ping', kind: 'action', pos: at, ref: 'ping' },
							],
							exec: [
								{ from: { node: 'ev', pin: 'exec' }, to: { node: 'n1', pin: 'fire:win' } },
								{ from: { node: 'n1', pin: 'exec' }, to: { node: 'ping', pin: 'exec' } },
							],
							data: [],
						}),
						library: LIBRARY,
						selection: ['n1', 'ping'],
						functionId: 'fn_1',
						functionName: 'fn',
					},
					{ vocab: VOCAB, library: LIBRARY, instances: INSTANCES },
				),
		],
		[true, false],
	);
	eq(
		'3. …and its unfed inputs raise no unfilled-data-in',
		validateFlowDoc(doc(CLEAN), VOCAB, LIBRARY, undefined, undefined, undefined, INSTANCES).map(
			(i) => i.code,
		),
		[],
	);

	const stale: Graph = {
		nodes: [
			banner('n1', {
				inputs: {
					'in:gone': { kind: 'literal', type: { t: 'float' }, value: 1 },
					'in:amount': { kind: 'literal', type: { t: 'float' }, value: 1 },
				},
			}),
			{ id: 'ping', kind: 'action', pos: at, ref: 'ping' },
			{ id: 'ev', kind: 'event', pos: at, ref: 'winInfo' },
		],
		exec: [
			{ from: { node: 'n1', pin: 'event:gone' }, to: { node: 'ping', pin: 'exec' } },
			{ from: { node: 'ev', pin: 'exec' }, to: { node: 'n1', pin: 'fire:gone' } },
		],
		data: [{ from: { node: 'ev', pin: 'amount' }, to: { node: 'n1', pin: 'in:gone' } }],
	};
	eq(
		'3. a stale event wire, trigger wire, input wire and stored source are each instance-pin-missing',
		errorsOf(doc(stale)),
		[
			'instance-pin-missing',
			'instance-pin-missing',
			'instance-pin-missing',
			'instance-pin-missing',
		],
	);
	eq(
		'3. the stale-pin message names the pin',
		validateFlowDoc(doc(stale), VOCAB, LIBRARY, undefined, undefined, undefined, INSTANCES)
			.filter((i) => i.at.on === 'execEdge')
			.map((i) => i.message.includes("'event:gone'") || i.message.includes("'fire:gone'")),
		[true, true],
	);

	const unplaced: Graph = {
		nodes: [banner('n1', { instance: 'c_nobody' }), banner('n2', { container: 'hud' })],
		exec: [],
		data: [],
	};
	eq('3. an unplaced instance, on any screen, is instance-missing', errorsOf(doc(unplaced)), [
		'instance-missing',
		'instance-missing',
	]);
	eq(
		'3. a lost def is instance-missing (and no pin check piles on)',
		errorsOf(
			doc({
				nodes: [
					banner('n1', {
						inputs: { 'in:amount': { kind: 'literal', type: { t: 'float' }, value: 1 } },
					}),
				],
				exec: [],
				data: [],
			}),
			{ c_banner: { ...BANNER, missing: 'def' } },
		),
		['instance-missing'],
	);
	eq(
		'3. a lost pinned version is instance-missing and says so',
		validateFlowDoc(
			doc({ nodes: [banner()], exec: [], data: [] }),
			VOCAB,
			LIBRARY,
			undefined,
			undefined,
			undefined,
			{ c_banner: { ...BANNER, missing: 'version' } },
		).map((i) => [i.code, i.message.includes('version 3')]),
		[['instance-missing', true]],
	);
	const wait = (layer: string, state: string): Graph => ({
		nodes: [
			{
				id: 'w',
				kind: 'waitForState',
				pos: at,
				container: 'basegame',
				instance: 'c_banner',
				layer,
				state,
			},
		],
		exec: [],
		data: [],
	});
	eq('3. a wait on a missing layer', errorsOf(doc(wait('other', 'idle'))), [
		'instance-pin-missing',
	]);
	eq('3. a wait for an unknown state', errorsOf(doc(wait('main', 'gone'))), [
		'instance-state-unknown',
	]);
	eq('3. a wait on exit is fine', errorsOf(doc(wait('main', 'exit'))), []);
	const text = (value: unknown): Graph => ({
		nodes: [
			banner('n1', { inputs: { 'in:title': { kind: 'literal', type: { t: 'string' }, value } } }),
		],
		exec: [],
		data: [],
	});
	eq(
		'3. a text literal must be a key',
		[errorsOf(doc(text('123'))), errorsOf(doc(text('Big win')))],
		[['instance-text-key'], []],
	);
	eq(
		'3. an event payload data-out wired off its own chain is signal-cross-event',
		errorsOf(
			doc({
				nodes: [
					{ id: 'ev', kind: 'event', pos: at, ref: 'winInfo' },
					banner(),
					{ id: 'cel', kind: 'action', pos: at, ref: 'celebrate' },
				],
				exec: [
					{ from: { node: 'ev', pin: 'exec' }, to: { node: 'n1', pin: 'set' } },
					{ from: { node: 'n1', pin: 'exec' }, to: { node: 'cel', pin: 'exec' } },
				],
				data: [
					{ from: { node: 'n1', pin: 'event:done:amount' }, to: { node: 'cel', pin: 'amount' } },
				],
			}),
		),
		['signal-cross-event'],
	);
	eq(
		'3. a second node wiring the same event of one instance is instance-event-duplicate (the first runs)',
		errorsOf(
			doc({
				nodes: [
					banner('n1'),
					banner('n2'),
					{ id: 'ping', kind: 'action', pos: at, ref: 'ping' },
					{ id: 'cel', kind: 'action', pos: at, ref: 'celebrate' },
				],
				exec: [
					{ from: { node: 'n1', pin: 'event:pressed' }, to: { node: 'ping', pin: 'exec' } },
					{ from: { node: 'n2', pin: 'event:pressed' }, to: { node: 'cel', pin: 'exec' } },
				],
				data: [
					{ from: { node: 'n2', pin: 'event:done:amount' }, to: { node: 'cel', pin: 'amount' } },
				],
			}),
		),
		['instance-event-duplicate', 'signal-cross-event'],
	);
	eq(
		'3. a bad endpoint on a base pin, or a deleted node, stays a plain edge-endpoint',
		errorsOf(
			doc({
				nodes: [banner('n1'), { id: 'ping', kind: 'action', pos: at, ref: 'ping' }],
				exec: [
					{ from: { node: 'n1', pin: 'exec' }, to: { node: 'ghost', pin: 'exec' } },
					{ from: { node: 'ping', pin: 'exec' }, to: { node: 'n1', pin: 'exec' } },
				],
				data: [{ from: { node: 'n1', pin: 'value:main.state' }, to: { node: 'ghost', pin: 'x' } }],
			}),
		),
		['edge-endpoint', 'edge-endpoint', 'edge-endpoint'],
	);
	eq(
		'3. two placements raising the same event own separate chains',
		errorsOf(
			doc({
				nodes: [
					banner('n1'),
					banner('n2'),
					{ id: 'cel', kind: 'action', pos: at, ref: 'celebrate' },
				],
				exec: [{ from: { node: 'n2', pin: 'event:done' }, to: { node: 'cel', pin: 'exec' } }],
				data: [
					{ from: { node: 'n1', pin: 'event:done:amount' }, to: { node: 'cel', pin: 'amount' } },
				],
			}),
		),
		['signal-cross-event'],
	);
	const unprojected = (d: FlowDoc) =>
		validateFlowDoc(d, VOCAB, LIBRARY)
			.filter((i) => i.severity === 'error')
			.map((i) => i.code)
			.sort();
	eq(
		'4. without a projection no instance check runs (a stale wire is a plain bad endpoint)',
		unprojected(doc(stale)),
		['edge-endpoint', 'edge-endpoint', 'edge-endpoint'],
	);
	eq('4. …and an unplaced instance reports nothing', unprojected(doc(unplaced)), []);
}

// ---- 5. runtime --------------------------------------------------------------------------------
const recorder = () => {
	const log: string[] = [];
	const state = { 'main.state': 'win' };
	const env = createFlowV2Env({
		mount: createContainerMountModel(CONTAINERS),
		effect: (name) => (payload) => {
			log.push(`effect ${name} ${JSON.stringify(payload)}`);
		},
		broadcast: () => undefined,
		waitForTimeout: () => Promise.resolve(),
		timeScale: () => 1,
		engineRead: () => undefined,
		setInstanceInput: (ref, input, value) =>
			log.push(`set ${ref.container}/${ref.instance} ${input}=${JSON.stringify(value)}`),
		fireInstanceTrigger: (ref, trigger) => {
			log.push(`fire ${ref.container}/${ref.instance} ${trigger}`);
		},
		readInstanceValue: (ref, value) => {
			log.push(`read ${ref.instance} ${value}`);
			return state[value as keyof typeof state];
		},
		awaitInstanceState: async (ref, layer, st) => {
			log.push(`wait ${ref.instance} ${layer}=${st}`);
		},
	});
	const ctx: RunContext = { vocab: VOCAB, library: LIBRARY, env };
	return { log, ctx };
};
{
	const graph: Graph = {
		nodes: [
			{ id: 'ev', kind: 'event', pos: at, ref: 'winInfo' },
			banner('n1', {
				inputs: {
					'in:title': { kind: 'literal', type: { t: 'string' }, value: 'Big win' },
					'in:lit': { kind: 'literal', type: { t: 'bool' }, value: true },
				},
			}),
			{
				id: 'w',
				kind: 'waitForState',
				pos: at,
				container: 'basegame',
				instance: 'c_banner',
				layer: 'main',
				state: 'idle',
			},
			{
				id: 'br',
				kind: 'branch',
				pos: at,
				guard: {
					all: [
						{
							left: { kind: 'wire' },
							op: 'eq',
							right: { kind: 'literal', type: { t: 'string' }, value: 'win' },
						},
					],
				},
			},
			{ id: 'cel', kind: 'action', pos: at, ref: 'celebrate' },
			{ id: 'ping', kind: 'action', pos: at, ref: 'ping' },
		],
		exec: [
			{ from: { node: 'ev', pin: 'exec' }, to: { node: 'n1', pin: 'fire:win' } },
			{ from: { node: 'n1', pin: 'exec' }, to: { node: 'w', pin: 'exec' } },
			{ from: { node: 'w', pin: 'exec' }, to: { node: 'br', pin: 'exec' } },
			{ from: { node: 'br', pin: 'then' }, to: { node: 'ping', pin: 'exec' } },
			{ from: { node: 'n1', pin: 'event:done' }, to: { node: 'cel', pin: 'exec' } },
		],
		data: [
			{ from: { node: 'ev', pin: 'amount' }, to: { node: 'n1', pin: 'in:amount' } },
			{ from: { node: 'n1', pin: 'event:done:amount' }, to: { node: 'cel', pin: 'amount' } },
			{ from: { node: 'n1', pin: 'value:main.state' }, to: { node: 'br', pin: 'all.0.left' } },
		],
	};
	const d = doc(graph);
	{
		const { log, ctx } = recorder();
		await runFlowEvent(d, ctx, 'winInfo', { amount: 250 });
		eq('5. fire:win applies the wired and stored inputs, fires, waits, then reads the value', log, [
			'set basegame/c_banner title="Big win"',
			'set basegame/c_banner lit=true',
			'set basegame/c_banner amount=250',
			'fire basegame/c_banner win',
			'wait c_banner main=idle',
			'read c_banner main.state',
			'effect ping {}',
		]);
	}
	{
		const { log, ctx } = recorder();
		await runFlowInstanceEvent(d, ctx, 'c_banner', 'done', { amount: 99, title: 'Big win' });
		eq('5. a raised event walks from its pin with the payload on $trigger', log, [
			'effect celebrate {"amount":99}',
		]);
		await runFlowInstanceEvent(d, ctx, 'c_banner', 'pressed');
		await runFlowInstanceEvent(d, ctx, 'c_other', 'done', { amount: 1 });
		eq('5. an unwired event, or another instance’s, is a no-op', log.length, 1);
	}
	eq(
		'5. ownership is a pure read',
		[
			flowOwnsInstanceEvent(d, 'c_banner', 'done'),
			flowOwnsInstanceEvent(d, 'c_banner', 'pressed'),
			flowOwnsInstanceEvent(d, 'c_other', 'done'),
		],
		[true, false, false],
	);
	const inGroup = doc({
		nodes: [
			{
				id: 'g',
				kind: 'group',
				pos: at,
				label: 'g',
				body: {
					nodes: [banner('n1'), { id: 'cel', kind: 'action', pos: at, ref: 'ping' }],
					exec: [{ from: { node: 'n1', pin: 'event:pressed' }, to: { node: 'cel', pin: 'exec' } }],
					data: [],
				},
				boundary: [],
			},
		],
		exec: [],
		data: [],
	});
	eq(
		'5. a wire inside a group still owns',
		flowOwnsInstanceEvent(inGroup, 'c_banner', 'pressed'),
		true,
	);
	{
		const { log, ctx } = recorder();
		await runFlowInstanceEvent(inGroup, ctx, 'c_banner', 'pressed');
		eq('5. …and runs', log, ['effect ping {}']);
	}
	// A wire that CROSSES the group's boundary: stored on the outer graph from the group's `out_0`
	// pin, whose `boundary[].inner` names the instance node's event pin (`collapseToGroup`'s shape).
	const crossing = doc({
		nodes: [
			{
				id: 'g',
				kind: 'group',
				pos: at,
				label: 'g',
				body: { nodes: [banner('n1')], exec: [], data: [] },
				boundary: [
					{
						id: 'out_0',
						dir: 'out',
						kind: 'exec',
						label: 'onDone',
						inner: { node: 'n1', pin: 'event:done' },
					},
				],
			},
			{ id: 'ping', kind: 'action', pos: at, ref: 'ping' },
		],
		exec: [{ from: { node: 'g', pin: 'out_0' }, to: { node: 'ping', pin: 'exec' } }],
		data: [],
	});
	eq(
		'5. a wire crossing a group boundary owns (the stored doc keeps its groups)',
		[
			flowOwnsInstanceEvent(crossing, 'c_banner', 'done'),
			flowOwnsInstanceEvent(crossing, 'c_banner', 'pressed'),
		],
		[true, false],
	);
	{
		const { log, ctx } = recorder();
		await runFlowInstanceEvent(crossing, ctx, 'c_banner', 'done', { amount: 4 });
		eq('5. …and runs through the flattened graph', log, ['effect ping {}']);
	}
	// Two groups deep: the node inside B inside A; B's `out_0` bridges to the node's event pin, A's
	// `out_0` bridges to B's `out_0`, and the wire is stored on the outer graph from A's pin.
	const nested = doc({
		nodes: [
			{
				id: 'A',
				kind: 'group',
				pos: at,
				label: 'A',
				body: {
					nodes: [
						{
							id: 'B',
							kind: 'group',
							pos: at,
							label: 'B',
							body: { nodes: [banner('n1')], exec: [], data: [] },
							boundary: [
								{
									id: 'out_0',
									dir: 'out',
									kind: 'exec',
									label: 'onDone',
									inner: { node: 'n1', pin: 'event:done' },
								},
							],
						},
					],
					exec: [],
					data: [],
				},
				boundary: [
					{
						id: 'out_0',
						dir: 'out',
						kind: 'exec',
						label: 'onDone',
						inner: { node: 'B', pin: 'out_0' },
					},
				],
			},
			{ id: 'ping', kind: 'action', pos: at, ref: 'ping' },
		],
		exec: [{ from: { node: 'A', pin: 'out_0' }, to: { node: 'ping', pin: 'exec' } }],
		data: [],
	});
	eq(
		'5. a wire crossing two nested group boundaries owns',
		[
			flowOwnsInstanceEvent(nested, 'c_banner', 'done'),
			flowOwnsInstanceEvent(nested, 'c_banner', 'pressed'),
		],
		[true, false],
	);
	{
		const { log, ctx } = recorder();
		await runFlowInstanceEvent(nested, ctx, 'c_banner', 'done');
		eq('5. …and runs', log, ['effect ping {}']);
	}
	const modeDoc = doc(
		{ nodes: [], exec: [], data: [] },
		{
			bonus: {
				graph: {
					nodes: [banner('m1'), { id: 'cel', kind: 'action', pos: at, ref: 'ping' }],
					exec: [{ from: { node: 'm1', pin: 'event:pressed' }, to: { node: 'cel', pin: 'exec' } }],
					data: [],
				},
			},
		},
	);
	eq(
		'5. a mode graph owns only while its mode is active',
		[
			flowOwnsInstanceEvent(modeDoc, 'c_banner', 'pressed'),
			flowOwnsInstanceEvent(modeDoc, 'c_banner', 'pressed', 'bonus'),
		],
		[false, true],
	);
	{
		const { log, ctx } = recorder();
		await runFlowInstanceEvent(
			modeDoc,
			{ ...ctx, activeMode: () => 'bonus' },
			'c_banner',
			'pressed',
		);
		await runFlowInstanceEvent(modeDoc, ctx, 'c_banner', 'pressed');
		eq('5. …and runs only then', log, ['effect ping {}']);
	}
	{
		// A recorder env without the hooks: nothing set or fired, the value reads undefined (the branch
		// takes else), the wait resolves — no crash, no hang.
		const log: string[] = [];
		const env: FlowV2Env = {
			effect: (name) => {
				log.push(name);
			},
			broadcast: () => undefined,
			waitForTimeout: () => Promise.resolve(),
			timeScale: () => 1,
			showContainer: () => undefined,
			hideContainer: () => undefined,
			engineRead: () => undefined,
		};
		await runFlowEvent(d, { vocab: VOCAB, library: LIBRARY, env }, 'winInfo', { amount: 1 });
		eq('5. an env without the hooks runs the chain through (value undefined ⇒ else)', log, []);
	}
	// 6. preview
	const preview = await previewFlowEvent(d, { vocab: VOCAB, library: LIBRARY }, 'winInfo', {
		payload: { amount: 7 },
	});
	eq(
		'6. the preview records each instance op',
		preview.timeline.map((e) => (e.kind === 'instance' ? [e.op, e.name, e.value] : e.kind)),
		[
			['set', 'title', 'Big win'],
			['set', 'lit', true],
			['set', 'amount', 7],
			['fire', 'win', undefined],
			['wait', 'main.state', 'idle'],
		],
	);
}

// ---- 7. parity + the text harvest --------------------------------------------------------------
{
	for (const [id, seed] of Object.entries(DRIVEN_SEEDS)) {
		const vocab = templateVocabulary(seed.templateId);
		const without = validateFlowDoc(seed, vocab, LIBRARY, BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS);
		const withMap = validateFlowDoc(
			seed,
			vocab,
			LIBRARY,
			BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
			undefined,
			undefined,
			INSTANCES,
		);
		eq(`7. ${id}: the verdict is byte-identical with the projection`, withMap, without);
		const base: PinContext = {
			vocab,
			library: LIBRARY,
			containerEvents: BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
		};
		const a = [...deriveGraphPins(seed.graph, base).pins.entries()];
		const b = [...deriveGraphPins(seed.graph, { ...base, instances: INSTANCES }).pins.entries()];
		eq(`7. ${id}: every node’s pins are byte-identical with the projection`, b, a);
		eq(
			`7. ${id}: the seed places no instance node`,
			seed.graph.nodes.some((n) => n.kind === 'componentInstance'),
			false,
		);
	}
	const keyed = doc(
		{
			nodes: [
				banner('n1', {
					inputs: {
						'in:title': { kind: 'literal', type: { t: 'string' }, value: 'Big win' },
						'in:amount': { kind: 'literal', type: { t: 'float' }, value: 5 },
					},
				}),
				{
					id: 'g',
					kind: 'group',
					pos: at,
					label: 'g',
					body: {
						nodes: [
							banner('n2', {
								inputs: {
									'in:title': { kind: 'literal', type: { t: 'string' }, value: 'Big win' },
								},
							}),
						],
						exec: [],
						data: [],
					},
					boundary: [],
				},
				banner('n3', {
					inputs: { 'in:title': { kind: 'literal', type: { t: 'string' }, value: '42' } },
				}),
				banner('n5', {
					container: 'hud',
					inputs: { 'in:title': { kind: 'literal', type: { t: 'string' }, value: 'Elsewhere' } },
				}),
			],
			exec: [],
			data: [],
		},
		{
			bonus: {
				graph: {
					nodes: [
						banner('n4', {
							inputs: { 'in:title': { kind: 'literal', type: { t: 'string' }, value: ' Bonus ' } },
						}),
					],
					exec: [],
					data: [],
				},
			},
		},
	);
	eq(
		'7. the harvest collects every literal key once, exact, from groups and modes; skips a non-key, a number input and an unplaced node',
		collectInstanceTextKeys(keyed, INSTANCES),
		[
			{ key: 'Big win', source: 'Big win', label: 'winBanner — title' },
			{ key: ' Bonus ', source: ' Bonus ', label: 'winBanner — title' },
		],
	);
	eq('7. no projection ⇒ nothing harvested', collectInstanceTextKeys(keyed, undefined), []);
}

console.log(`instanceNodes fixture: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
