/**
 * Component listeners and events (Rive plan Phase 6):
 *   pnpm --filter launcher-api check:component-listeners-events
 *
 *  1. the interface lists a def's events (deduped), and a def without them reports none;
 *  2. every pointer event runs every action kind on the instance's own state machine runner: fire
 *     a trigger (on the instance bus, which the runner hears), set a bool, set a number, toggle a
 *     bool, raise an event — and an unknown input, a wrong kind or an undeclared event does nothing;
 *  3. two instances of one def stay independent;
 *  4. real Pixi hit-testing (`EventBoundary`, headless) over the wrapper `LayoutNodeView` renders:
 *     each pointer event reaches it, a passive art child is its hit area, and a `pressAction`
 *     container inside it still fires — both fire, nothing existing changes;
 *  5. events raised from a listener, from state entry (the entry state at start and every state a
 *     transition enters, chains included) and from an `event:` timeline cue all arrive on the Flow
 *     press road tagged with the instance's node id, the event id and `kind: 'event'`; nobody
 *     listening is a no-op; payloads carry numbers, bools and localization keys only;
 *  6. validation: every issue the editor will show;
 *  7. the normalizer keeps `events`, node `on` and state `onEnter`, and drops malformed rows whole
 *     (fail-closed), passing every other node field through;
 *  8. parity: a def with no listeners and no events creates nothing new (no dispatcher, no context,
 *     no wrapper — source-scanned in the Svelte wiring, which this gate cannot mount), and Flow's
 *     container-event projection and the press resolver's existing callers are unchanged;
 *  9. the ship chain (rule 8): no new asset class — the new fields ride the def through the
 *     normalizer the bundle loads with, and the runtime registry hands them back.
 */
import 'pixi.js/events';
import { readFileSync } from 'node:fs';
import { Container, EventBoundary, FederatedPointerEvent, Graphics } from 'pixi.js';
import type {
	CinematicDoc,
	ComponentDef,
	LayoutNode,
	NodeListener,
	NodeListenerEvent,
} from 'engine-layout';

const E = await import('../../../packages/engine-layout/src/lib/componentEvents.ts');
const I = await import('../../../packages/engine-layout/src/lib/componentInterface.ts');
const M = await import('../../../packages/engine-layout/src/lib/stateMachine.ts');
const L = await import('../../../packages/engine-layout/src/lib/componentTimelines.ts');
const F = await import('../../../packages/engine-layout/src/lib/registerFlowPress.ts');
const R = await import('../../../packages/engine-layout/src/lib/registerComponents.ts');
const { BUILTIN_COMPONENTS, CONFIRM_DIALOG_DEF } =
	await import('../../../packages/engine-layout/src/lib/builtinComponents.ts');
const { componentSignalConfiguredEvents, deriveContainerEvents } =
	await import('../../../packages/engine-flow-v2/src/containerEvents.ts');
const { normalizeComponent } = await import('../src/lib/server/componentStorage.ts');
const { harvestSceneText } = await import('../src/lib/server/localizationHarvest.ts');
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
const source = (path: string): string =>
	readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

// ---- fixtures ----------------------------------------------------------------------------------

const POINTER: NodeListenerEvent[] = ['down', 'up', 'enter', 'leave', 'click'];

/** A coin: a `win` trigger, a `lit` bool, an `amount` number; two events; a two-state machine. */
function coinDef(over: Partial<ComponentDef> = {}): ComponentDef {
	return {
		id: 'coin',
		name: 'Coin',
		version: 1,
		scope: 'project',
		category: 'ui',
		root: {
			id: 'root',
			kind: 'container',
			x: 0,
			y: 0,
			children: [{ id: 'n_coin', kind: 'sprite', label: 'Coin', x: 0, y: 0 } as LayoutNode],
		},
		inputs: [
			{ id: 'win', kind: 'trigger' },
			{ id: 'lit', kind: 'bool' },
			{ id: 'amount', kind: 'number', default: 3 },
		],
		events: [
			{
				id: 'pressed',
				payload: [
					{ name: 'amount', type: { t: 'float' } },
					{ name: 'lit', type: { t: 'bool' }, optional: true },
					{ name: 'label', type: { t: 'string' }, optional: true },
				],
			},
			{ id: 'winShown' },
		],
		stateMachine: {
			layers: [
				{
					id: 'main',
					entry: 'idle',
					states: [
						{ id: 'idle', timeline: 't_idle', loop: true },
						{
							id: 'win',
							timeline: 't_win',
							onEnter: [{ id: 'e1', kind: 'raise', event: 'winShown' }],
						},
						{
							id: 'flash',
							timeline: 't_win',
							onEnter: [{ id: 'e1', kind: 'raise', event: 'winShown', payload: { level: 2 } }],
						},
					],
					transitions: [
						{ id: 't1', from: 'idle', to: 'win', conditions: [{ input: 'win', op: 'fired' }] },
						{ id: 't2', from: 'win', to: 'idle', exitTime: 1 },
						{
							id: 't3',
							from: 'any',
							to: 'flash',
							conditions: [{ input: 'lit', op: '==', value: true }],
						},
					],
				},
			],
		},
		...over,
	};
}
const durations = new Map([
	['t_idle', 1],
	['t_win', 1],
]);

/** One placed instance: a runner, a bus (trigger fires), and the raises it sent. */
function instance(id: string, def = coinDef()) {
	const runner = new M.ComponentStateMachineRunner(
		def.stateMachine!,
		I.componentInputs(def),
		durations,
	);
	const bus: string[] = [];
	const raised: ReturnType<typeof strip>[] = [];
	const dispatcher = new E.ComponentEventDispatcher(def, {
		instanceId: id,
		fireTrigger: (trigger) => {
			bus.push(trigger);
			runner.fire(trigger);
		},
		input: (input) => runner.input(input),
		setInput: (input, value) => void runner.setInput(input, value),
		raise: (r) => raised.push(strip(r)),
	});
	return { runner, bus, raised, dispatcher };
}
const strip = (r: { instanceId: string; event: string; payload: unknown; origin: string }) => ({
	instanceId: r.instanceId,
	event: r.event,
	payload: r.payload,
	origin: r.origin,
});
/** The def's own sprite carrying `listeners`. */
const coinNode = (...listeners: NodeListener[]): Pick<LayoutNode, 'id' | 'on'> => ({
	id: 'n_coin',
	on: listeners,
});
const listener = (
	id: string,
	event: NodeListenerEvent,
	action: NodeListener['action'],
): NodeListener => ({ id, event, action });

// ---- 1. the interface --------------------------------------------------------------------------

eq(
	'the interface lists the def’s events, first of each id',
	I.componentInterface(
		coinDef({ events: [{ id: 'pressed' }, { id: 'pressed', note: 'dup' }, { id: 'winShown' }] }),
	).events,
	[{ id: 'pressed' }, { id: 'winShown' }],
);
eq('a def with no events reports none (parity)', I.componentInterface({}).events, []);

// ---- 2. every pointer event × every action kind ------------------------------------------------

for (const event of POINTER) {
	const other = POINTER.find((e) => e !== event)!;
	{
		const { runner, bus, dispatcher } = instance('i');
		dispatcher.pointer(coinNode(listener('l', event, { kind: 'fire', input: 'win' })), other);
		eq(`${event} → fire: another pointer event does nothing`, bus, []);
		dispatcher.pointer(coinNode(listener('l', event, { kind: 'fire', input: 'win' })), event);
		eq(`${event} → fire: the trigger is fired on the instance bus`, bus, ['win']);
		runner.advance(0.1);
		eq(`${event} → fire: the instance's state machine hears it`, runner.stateOf('main'), 'win');
	}
	{
		const { runner, dispatcher } = instance('i');
		dispatcher.pointer(
			coinNode(listener('l', event, { kind: 'set', input: 'lit', value: true })),
			event,
		);
		eq(`${event} → set bool`, runner.input('lit'), true);
		dispatcher.pointer(
			coinNode(listener('l', event, { kind: 'set', input: 'amount', value: 9 })),
			event,
		);
		eq(`${event} → set number`, runner.input('amount'), 9);
		dispatcher.pointer(coinNode(listener('l', event, { kind: 'toggle', input: 'lit' })), event);
		eq(`${event} → toggle bool (true → false)`, runner.input('lit'), false);
		dispatcher.pointer(coinNode(listener('l', event, { kind: 'toggle', input: 'lit' })), event);
		eq(`${event} → toggle bool (false → true)`, runner.input('lit'), true);
	}
	{
		const { raised, dispatcher } = instance('coin_1');
		dispatcher.pointer(
			coinNode(
				listener('l', event, {
					kind: 'raise',
					event: 'pressed',
					payload: { amount: { input: 'amount' }, lit: false, label: { key: 'coin.pressed' } },
				}),
			),
			event,
		);
		eq(`${event} → raise: the event leaves tagged with the instance`, raised, [
			{
				instanceId: 'coin_1',
				event: 'pressed',
				payload: { amount: 3, lit: false, label: 'coin.pressed' },
				origin: 'listener',
			},
		]);
	}
}
{
	const { runner, bus, raised, dispatcher } = instance('i');
	dispatcher.pointer(
		coinNode(
			listener('a', 'click', { kind: 'fire', input: 'lit' }),
			listener('b', 'click', { kind: 'fire', input: 'nope' }),
			listener('c', 'click', { kind: 'set', input: 'lit', value: 4 }),
			listener('d', 'click', { kind: 'set', input: 'amount', value: true }),
			listener('e', 'click', { kind: 'toggle', input: 'amount' }),
			listener('f', 'click', { kind: 'raise', event: 'undeclared' }),
		),
		'click',
	);
	eq(
		'a wrong kind, an unknown input, a mistyped value or an undeclared event does nothing',
		[bus, runner.input('lit'), runner.input('amount'), raised],
		[[], false, 3, []],
	);
	dispatcher.pointer(
		coinNode(
			listener('a', 'down', { kind: 'set', input: 'amount', value: 1 }),
			listener('b', 'down', { kind: 'set', input: 'amount', value: 2 }),
		),
		'down',
	);
	eq('several listeners on one event run in authored order', runner.input('amount'), 2);
}

// ---- 3. two instances --------------------------------------------------------------------------

{
	const a = instance('coin_a');
	const b = instance('coin_b');
	a.dispatcher.pointer(coinNode(listener('l', 'click', { kind: 'fire', input: 'win' })), 'click');
	a.dispatcher.pointer(
		coinNode(listener('l', 'click', { kind: 'set', input: 'amount', value: 7 })),
		'click',
	);
	a.runner.advance(0.1);
	b.runner.advance(0.1);
	eq(
		'a listener acts on its own instance only',
		[a.bus, a.runner.stateOf('main'), a.runner.input('amount')],
		[['win'], 'win', 7],
	);
	eq(
		'…the other instance is untouched',
		[b.bus, b.runner.stateOf('main'), b.runner.input('amount')],
		[[], 'idle', 3],
	);
	a.dispatcher.pointer(coinNode(listener('l', 'up', { kind: 'raise', event: 'winShown' })), 'up');
	eq(
		'…and raises carry their own instance id',
		[a.raised.map((r) => r.instanceId), b.raised],
		[['coin_a'], []],
	);
}

// ---- 4. real Pixi hit-testing: the wrapper, a press target inside it ---------------------------

{
	const root = new Container();
	// `LayoutNodeView`'s listener wrapper (`eventMode="static"`), its node a `pressAction` container
	// (`eventMode="static"`, `onpointerup` press), its art a plain (passive) graphic.
	const wrapper = new Container({ eventMode: 'static' });
	const pressTarget = new Container({ eventMode: 'static' });
	pressTarget.addChild(new Graphics().rect(0, 0, 100, 100).fill(0xff0000));
	wrapper.addChild(pressTarget);
	// A listener node next to it whose art is passive: the wrapper alone makes it a hit surface.
	const artWrapper = new Container({ eventMode: 'static' });
	artWrapper.addChild(new Graphics().rect(200, 0, 100, 100).fill(0x00ff00));
	// A node with no listeners: no wrapper, default event mode.
	const bare = new Container();
	bare.addChild(new Graphics().rect(400, 0, 100, 100).fill(0x0000ff));
	root.addChild(wrapper, artWrapper, bare);

	const log: string[] = [];
	const def = coinDef();
	const raised: string[] = [];
	const dispatcher = new E.ComponentEventDispatcher(def, {
		instanceId: 'i',
		fireTrigger: (t) => log.push(`trigger:${t}`),
		raise: (r) => raised.push(r.event),
	});
	const listeners = POINTER.map((e) =>
		listener(e, e, { kind: 'raise', event: e === 'click' ? 'pressed' : 'winShown' }),
	);
	const wire = (target: Container, name: string): void => {
		// The exact event → listener map `LayoutNodeView` binds.
		const map: [string, NodeListenerEvent][] = [
			['pointerdown', 'down'],
			['pointerup', 'up'],
			['pointerenter', 'enter'],
			['pointerleave', 'leave'],
			['pointertap', 'click'],
		];
		for (const [pixi, ours] of map) {
			target.on(pixi, () => {
				log.push(`${name}:${ours}`);
				dispatcher.pointer({ id: 'n_coin', on: listeners }, ours);
			});
		}
	};
	wire(wrapper, 'wrapper');
	wire(artWrapper, 'art');
	pressTarget.on('pointerup', () => log.push('press'));
	bare.on('pointerup', () => log.push('bare'));

	const boundary = new EventBoundary(root);
	const send = (type: string, x: number): void => {
		const e = new FederatedPointerEvent(boundary);
		e.type = type;
		e.pointerId = 1;
		e.pointerType = 'mouse';
		e.button = 0;
		e.buttons = type === 'pointerdown' ? 1 : 0;
		e.global.set(x, 50);
		e.screen.set(x, 50);
		boundary.mapEvent(e);
	};
	const click = (x: number): void => {
		send('pointermove', x);
		send('pointerdown', x);
		send('pointerup', x);
	};
	click(50);
	send('pointermove', 900);
	eq('a press target inside a listener node: the press AND every listener event fire', log, [
		'wrapper:enter',
		'wrapper:down',
		'press',
		'wrapper:up',
		'wrapper:click',
		'wrapper:leave',
	]);
	eq('…each raising through the dispatcher', raised, [
		'winShown',
		'winShown',
		'winShown',
		'pressed',
		'winShown',
	]);
	log.length = 0;
	click(250);
	send('pointermove', 900);
	eq('a listener node whose art is passive is still the hit surface', log, [
		'art:enter',
		'art:down',
		'art:up',
		'art:click',
		'art:leave',
	]);
	log.length = 0;
	click(450);
	eq('a node with no listeners gets no wrapper and hears nothing (parity)', log, []);
}
{
	// Wiring guards: the Svelte markup this gate cannot mount binds the map above.
	const view = source('packages/engine-layout/src/lib/LayoutNodeView.svelte');
	eq(
		'LayoutNodeView binds each Pixi pointer event to its listener event (the map above)',
		[
			'onpointerdown={(e) => gesture!.down(e.pointerId, pointerLocal(e), e.global)}',
			'onpointerup={(e) => gesture!.release(e.pointerId, pointerLocal(e), e.global, true)}',
			"onpointerenter={(e) => gesture!.plain('enter', pointerLocal(e), e.global)}",
			"onpointerleave={(e) => gesture!.plain('leave', pointerLocal(e), e.global)}",
			"onpointertap={(e) => gesture!.plain('click', pointerLocal(e), e.global)}",
			// The gesture sends each as the listener event of that name (`check:component-pointer-drag`
			// proves down → down, a release over the node → up, and the plain three as they are).
			'new PointerGesture((event, at) => listen.listen(node, event, at))',
		].every((binding) => view.includes(binding)),
		true,
	);
	eq(
		'…and wraps a node only when it listens AND its instance owns it',
		view.includes(
			'const listen = componentListen?.owns(untrack(() => node.id)) ? componentListen : undefined;',
		),
		true,
	);
}

// ---- 5. the runtime road -----------------------------------------------------------------------

{
	const road: unknown[] = [];
	const ran: string[] = [];
	F.registerFlowPress((instanceId, action, payload, kind) => {
		road.push({ instanceId, action, payload, kind });
		return action === 'pressed' ? () => ran.push(`${instanceId}.${action}`) : undefined;
	});
	const def = coinDef();
	const runner = new M.ComponentStateMachineRunner(
		def.stateMachine!,
		I.componentInputs(def),
		durations,
	);
	const dispatcher = new E.ComponentEventDispatcher(def, {
		instanceId: 'coin_7',
		fireTrigger: (t) => runner.fire(t),
		input: (id) => runner.input(id),
		setInput: (id, v) => void runner.setInput(id, v),
	});
	const seen: string[] = [];
	const unobserve = E.observeComponentEvents((r) => seen.push(`${r.origin}:${r.event}`));

	dispatcher.pointer(
		coinNode(
			listener('l', 'click', {
				kind: 'raise',
				event: 'pressed',
				payload: { amount: 2.5, lit: { input: 'lit' } },
			}),
		),
		'click',
	);
	eq('a listener’s raise takes the press road with the instance tag and kind "event"', road, [
		{
			instanceId: 'coin_7',
			action: 'pressed',
			payload: { amount: 2.5, lit: false },
			kind: 'event',
		},
	]);
	eq('…and runs the handler the road returns (Flow owns it)', ran, ['coin_7.pressed']);
	road.length = 0;
	dispatcher.pointer(
		coinNode(
			listener('l', 'click', {
				kind: 'raise',
				event: 'pressed',
				payload: {
					amount: { key: 'not.a.number' },
					lit: 1,
					label: { key: '500' },
					extra: 4,
				},
			}),
		),
		'click',
	);
	{
		const whole = coinDef({
			events: [
				{
					id: 'counted',
					payload: [
						{ name: 'n', type: { t: 'int' } },
						{ name: 'ms', type: { t: 'ms' } },
						{ name: 'f', type: { t: 'float' } },
					],
				},
			],
		});
		const got: unknown[] = [];
		new E.ComponentEventDispatcher(whole, {
			instanceId: 'w',
			fireTrigger: () => undefined,
			raise: (r) => got.push(r.payload),
		}).pointer(
			coinNode(
				listener('l', 'click', {
					kind: 'raise',
					event: 'counted',
					payload: { n: 2.5, ms: 120, f: 2.5 },
				}),
			),
			'click',
		);
		eq('an int / ms field drops a value that is not a whole number; a float keeps it', got, [
			{ ms: 120, f: 2.5 },
		]);
	}
	eq(
		'a value that does not fit its field, a key with no letter and an undeclared field never leave',
		road,
		[{ instanceId: 'coin_7', action: 'pressed', payload: undefined, kind: 'event' }],
	);
	road.length = 0;
	dispatcher.started(runner.plays());
	eq('the machine starting enters the entry state (no onEnter there ⇒ nothing)', road, []);
	runner.fire('win');
	dispatcher.transitions(runner.advance(0.1).fired);
	eq('a transition into a state raises its onEnter, payload-less', road, [
		{ instanceId: 'coin_7', action: 'winShown', payload: undefined, kind: 'event' },
	]);
	eq('…nobody owns it: the road returns nothing, nothing runs', ran, [
		'coin_7.pressed',
		'coin_7.pressed',
	]);

	road.length = 0;
	runner.setInput('lit', true);
	const step = runner.advance(0.1);
	dispatcher.transitions(step.fired);
	eq(
		'an `any` transition into a state raises its onEnter; a field the event does not declare never leaves',
		[step.fired.map((f) => f.to), road],
		[['flash'], [{ instanceId: 'coin_7', action: 'winShown', payload: undefined, kind: 'event' }]],
	);

	const entered = coinDef();
	entered.stateMachine!.layers[0].states[0].onEnter = [
		{ id: 'e1', kind: 'raise', event: 'winShown' },
	];
	road.length = 0;
	const r2 = new M.ComponentStateMachineRunner(
		entered.stateMachine!,
		I.componentInputs(entered),
		durations,
	);
	new E.ComponentEventDispatcher(entered, {
		instanceId: 'coin_8',
		fireTrigger: () => undefined,
	}).started(r2.plays());
	eq('the entry state’s onEnter is raised when the machine starts', road, [
		{ instanceId: 'coin_8', action: 'winShown', payload: undefined, kind: 'event' },
	]);

	// A chain through a state in one tick still raises its onEnter.
	const chain = coinDef();
	chain.stateMachine!.layers[0].transitions = [
		{ id: 'a', from: 'idle', to: 'win', conditions: [{ input: 'win', op: 'fired' }] },
		{ id: 'b', from: 'win', to: 'flash' },
	];
	road.length = 0;
	const r3 = new M.ComponentStateMachineRunner(
		chain.stateMachine!,
		I.componentInputs(chain),
		durations,
	);
	const d3 = new E.ComponentEventDispatcher(chain, {
		instanceId: 'c',
		fireTrigger: () => undefined,
	});
	r3.fire('win');
	d3.transitions(r3.advance(0.1).fired);
	eq(
		'a same-tick chain raises every state it passes through, in order',
		road.map((r) => (r as { payload?: unknown }).payload ?? null),
		[null, null],
	);

	// A timeline cue: the real player crosses `event:winShown` and the dispatcher raises it.
	road.length = 0;
	const cueTimeline = {
		...S.newComponentTimeline({ id: 't_cue', name: 't_cue', componentId: 'coin', playOn: 'go' }),
		duration: 1,
		stage: { sceneId: null, cast: [] },
		tracks: [
			{
				id: 'c',
				kind: 'cue',
				actorId: '',
				keys: [
					{ time: 0.25, cue: 'event:winShown' },
					{ time: 0.5, cue: 'event:nope' },
				],
			},
		],
	} as unknown as CinematicDoc;
	const player = new L.ComponentTimelinePlayer([cueTimeline], def.root.children);
	player.trigger('go');
	const cues: string[] = [];
	for (let i = 0; i < 6; i++) cues.push(...player.advance(0.1).cues.map((c) => c.cue));
	eq('the player crosses both event cues', cues, ['event:winShown', 'event:nope']);
	eq(
		'…on a def that declares events every `event:` cue is the dispatcher’s',
		cues.map((c) => E.routeComponentCue(c, true).kind),
		['event', 'event'],
	);
	for (const c of cues) dispatcher.cue(c);
	eq('…which raises the declared one on the road', road, [
		{ instanceId: 'coin_7', action: 'winShown', payload: undefined, kind: 'event' },
	]);
	eq(
		'cue routing: a def with no events broadcasts `event:` as before (parity); signal, fx, sounds, a bare name',
		[
			E.routeComponentCue('event:winShown', false),
			E.routeComponentCue('signal:x', true),
			E.routeComponentCue('fx:spark', true),
			E.routeComponentCue('sfx:pop', true),
			E.routeComponentCue('music:bed', true),
			E.routeComponentCue('bare', true),
			E.routeComponentCue('signal:', true),
		],
		[
			{ kind: 'broadcast', name: 'winShown' },
			{ kind: 'signal', name: 'x' },
			{ kind: 'broadcast', name: 'spark' },
			{ kind: 'sound', channel: 'once', name: 'pop' },
			{ kind: 'sound', channel: 'music', name: 'bed' },
			{ kind: 'broadcast', name: 'bare' },
			{ kind: 'drop' },
		],
	);
	eq('the observer saw every raise with its origin', seen, [
		'listener:pressed',
		'listener:pressed',
		...Array(5).fill('state:winShown'),
		'cue:winShown',
	]);
	unobserve();

	F.clearFlowPress();
	let threw = false;
	try {
		E.raiseComponentEvent({
			instanceId: 'x',
			componentId: 'coin',
			event: 'pressed',
			payload: {},
			origin: 'listener',
		});
	} catch {
		threw = true;
	}
	eq('nobody listening (no resolver registered) is a harmless no-op', threw, false);
}

{
	// ONE queue, drained in order after the current work; nothing once destroyed.
	const ordered = coinDef({
		events: [{ id: 'enteredIdle' }, { id: 'enteredIntro' }, { id: 'pressed' }],
	});
	ordered.stateMachine = {
		layers: [
			{
				id: 'main',
				entry: 'idle',
				states: [
					{
						id: 'idle',
						timeline: 't_idle',
						onEnter: [{ id: 'a', kind: 'raise', event: 'enteredIdle' }],
					},
					{
						id: 'intro',
						timeline: 't_win',
						onEnter: [{ id: 'a', kind: 'raise', event: 'enteredIntro' }],
					},
				],
				transitions: [{ id: 't', from: 'idle', to: 'intro' }],
			},
		],
	};
	const make = (order: string[], tasks: (() => void)[]) => {
		const runner = new M.ComponentStateMachineRunner(
			ordered.stateMachine!,
			I.componentInputs(ordered),
			durations,
		);
		const d = new E.ComponentEventDispatcher(ordered, {
			instanceId: 'i',
			fireTrigger: () => undefined,
			raise: (r) => order.push(r.event),
			schedule: (drain) => tasks.push(drain),
		});
		return { runner, d };
	};
	const run = (tasks: (() => void)[]): void => tasks.splice(0).forEach((t) => t());
	const press = coinNode(listener('l', 'click', { kind: 'raise', event: 'pressed' }));

	let order: string[] = [];
	let tasks: (() => void)[] = [];
	let { runner, d } = make(order, tasks);
	// The machine starts from the ticker and the same tick advances into `intro`.
	d.started(runner.plays());
	d.transitions(runner.advance(0.1).fired);
	eq(
		'a tick’s raises wait for the scheduled drain (never mid-mount)',
		[order, tasks.length],
		[[], 1],
	);
	run(tasks);
	eq('…then leave in the order they happened: the entry, then the state entered', order, [
		'enteredIdle',
		'enteredIntro',
	]);

	order = [];
	tasks = [];
	({ runner, d } = make(order, tasks));
	d.started(runner.plays());
	d.pointer(press, 'click');
	run(tasks);
	eq('a pointer raise leaves at once, after what was already queued, and nothing twice', order, [
		'enteredIdle',
		'pressed',
	]);

	order = [];
	tasks = [];
	({ runner, d } = make(order, tasks));
	d.started(runner.plays());
	d.destroy();
	run(tasks);
	d.pointer(press, 'click');
	d.transitions(runner.advance(0.1).fired);
	d.cue('event:pressed');
	run(tasks);
	eq('a destroyed instance raises nothing — not what it had queued, nor anything after', order, []);

	{
		// Re-entry: a handler that causes a raise queues it BEHIND what was already waiting, and a
		// destroy mid-drain stops the rest (Phase 7 runs Flow from these handlers).
		const sent: string[] = [];
		const later: (() => void)[] = [];
		const reentrant = new E.ComponentEventDispatcher(ordered, {
			instanceId: 'i',
			fireTrigger: () => undefined,
			schedule: (drain) => later.push(drain),
			raise: (r) => {
				sent.push(r.event);
				if (r.event === 'enteredIdle') reentrant.pointer(press, 'click');
			},
		});
		const r = new M.ComponentStateMachineRunner(
			ordered.stateMachine!,
			I.componentInputs(ordered),
			durations,
		);
		reentrant.started(r.plays());
		reentrant.transitions(r.advance(0.1).fired);
		run(later);
		eq('a raise a handler causes joins the END of the queue', sent, [
			'enteredIdle',
			'enteredIntro',
			'pressed',
		]);

		const stopped: string[] = [];
		const later2: (() => void)[] = [];
		const dying = new E.ComponentEventDispatcher(ordered, {
			instanceId: 'i',
			fireTrigger: () => undefined,
			schedule: (drain) => later2.push(drain),
			raise: (raised) => {
				stopped.push(raised.event);
				dying.destroy();
			},
		});
		const r2 = new M.ComponentStateMachineRunner(
			ordered.stateMachine!,
			I.componentInputs(ordered),
			durations,
		);
		dying.started(r2.plays());
		dying.transitions(r2.advance(0.1).fired);
		run(later2);
		eq('a destroy mid-drain stops the rest', stopped, ['enteredIdle']);
	}

	order = [];
	({ d } = make(order, []));
	eq(
		'a dispatcher owns its def’s nodes only',
		[d.owns('root'), d.owns('n_coin'), d.owns('n_foreign')],
		[true, true, false],
	);
	d.pointer({ id: 'n_foreign', on: press.on }, 'click');
	eq('…and ignores a node it does not own (a coded part’s own tree)', order, []);
}

{
	// Events have their own namespace on the Flow road (the game's real resolver, a fake handle).
	const H = await import('../../lines/src/game/flowV2InterpreterHolder.ts');
	const dispatched: string[] = [];
	H.setFlowV2({
		ownsContainerEvent: (id: string, action: string) => id === 'dlg' && action === 'confirm',
		ownsInstanceEvent: () => false,
		dispatchContainerEvent: async (id: string, action: string) => {
			dispatched.push(`${id}.${action}`);
		},
	} as unknown as Parameters<typeof H.setFlowV2>[0]);
	F.registerFlowPress(H.resolveFlowV2Press);
	F.getFlowPress()?.('dlg', 'confirm')?.();
	E.raiseComponentEvent({
		instanceId: 'dlg',
		componentId: 'confirmDialog',
		event: 'confirm',
		payload: {},
		origin: 'listener',
	});
	eq(
		'a press `confirm` runs its chain once; a raised event `confirm` never runs the press’s (it resolves against event pins only — Phase 7)',
		dispatched,
		['dlg.confirm'],
	);
	eq(
		'…the resolver never matches an event against a press or action pin',
		H.resolveFlowV2Press('dlg', 'confirm', undefined, 'event'),
		undefined,
	);
	H.setFlowV2(undefined);
	F.clearFlowPress();
}

{
	// Wiring guards: the instance's Svelte script this gate cannot mount.
	const instanceSvelte = source('packages/engine-layout/src/lib/ComponentInstance.svelte');
	eq(
		'ComponentInstance drains raises after the current work, stops them on destroy, routes cues through routeComponentCue, and plays a fired trigger’s rig cues',
		[
			instanceSvelte.includes('schedule: (drain) => queueMicrotask(drain),'),
			instanceSvelte.includes('onDestroy(() => eventDispatcher?.destroy());'),
			instanceSvelte.includes('routeComponentCue(cue, !!def?.events?.length)'),
			instanceSvelte.includes("type: route.channel === 'music' ? 'soundMusic' : 'soundOnce',"),
			/const fireTrigger = \(id: string\): void => \{\s*const targets = signalToTargets\.get\(id\);\s*if \(targets\) fireCue\(targets\);\s*fireComponentSignal\(id\);/.test(
				instanceSvelte,
			) && instanceSvelte.includes('\t\t\t\t\tfireTrigger,\n'),
		],
		[true, true, true, true, true],
	);
	eq(
		'the game hands the raise’s kind to the resolver',
		source('apps/lines/src/components/Game.svelte').includes(
			'resolveFlowV2Press(componentId, action, payload, kind)',
		),
		true,
	);
}

{
	// The harvest collects the localization keys a def's raises carry (source-as-key, plan §8).
	const def = coinDef({
		events: [
			{ id: 'pressed', payload: [{ name: 'label', type: { t: 'string' } }] },
			{ id: 'winShown', payload: [{ name: 'title', type: { t: 'string' } }] },
		],
	});
	(def.root.children[0] as LayoutNode).on = [
		listener('l', 'click', {
			kind: 'raise',
			event: 'pressed',
			payload: { label: { key: 'Tap to win' } },
		}),
	];
	def.stateMachine!.layers[0].states[1].onEnter = [
		{ id: 'e1', kind: 'raise', event: 'winShown', payload: { title: { key: 'BIG WIN' } } },
	];
	eq('raisedPayloadKeys lists every key the def raises, with its event', E.raisedPayloadKeys(def), [
		{ key: 'Tap to win', event: 'pressed' },
		{ key: 'BIG WIN', event: 'winShown' },
	]);
	const sections = await harvestSceneText(
		{
			scenes: [
				{
					id: 's',
					name: 'Base',
					nodes: [{ id: 'i1', kind: 'componentInstance', componentId: 'coin', x: 0, y: 0 }],
				},
			],
		} as unknown as Parameters<typeof harvestSceneText>[0],
		async () => def,
	);
	eq(
		'…and the localization harvest collects them with the def’s text',
		sections.flatMap((section) => section.items.map((item) => [item.key, item.label])),
		[
			['Tap to win', 'coin — event pressed'],
			['BIG WIN', 'coin — event winShown'],
		],
	);
}

// ---- 6. validation -----------------------------------------------------------------------------

{
	const codes = (def: ComponentDef, timelines: CinematicDoc[] = []): string[] =>
		E.validateComponentEvents(def, timelines).map((i) => `${i.level}:${i.code}`);
	eq(
		'a raise filling a field its event does not declare is flagged',
		codes(coinDef({ events: [{ id: 'pressed' }, { id: 'winShown' }] })),
		['error:raise-payload-unknown'],
	);
	const clean = coinDef({ events: [{ id: 'pressed' }, { id: 'winShown', payload: [] }] });
	clean.stateMachine!.layers[0].states[2].onEnter = [
		{ id: 'e1', kind: 'raise', event: 'winShown' },
	];
	eq('a well-formed def has no issues', codes(clean), []);

	const def = coinDef({
		events: [
			{ id: 'pressed', payload: [{ name: 'n', type: { t: 'int' } }] },
			{ id: 'pressed' },
			{ id: 'win' },
			{
				id: 'bad',
				payload: [
					{ name: 'r', type: { t: 'list', of: { t: 'int' } } },
					{ name: 'r', type: { t: 'int' } },
				],
			},
			{ id: 'winShown' },
		],
	});
	def.stateMachine!.layers[0].states[2].onEnter = [{ id: 'e1', kind: 'raise', event: 'ghost' }];
	(def.root.children[0] as LayoutNode).on = [
		listener('a', 'click', { kind: 'fire', input: 'nope' }),
		listener('a', 'click', { kind: 'fire', input: 'lit' }),
		listener('b', 'down', { kind: 'toggle', input: 'amount' }),
		listener('c', 'up', { kind: 'set', input: 'lit', value: 1 }),
		listener('d', 'enter', { kind: 'raise', event: 'ghost' }),
		listener('e', 'leave', { kind: 'raise', event: 'pressed', payload: { x: 1 } }),
		listener('f', 'leave', { kind: 'raise', event: 'pressed', payload: { n: true } }),
		listener('g', 'leave', { kind: 'raise', event: 'pressed', payload: { n: { input: 'win' } } }),
		listener('h', 'leave', { kind: 'raise', event: 'pressed', payload: { n: { key: '42' } } }),
		listener('i', 'leave', { kind: 'raise', event: 'pressed', payload: { n: 2.5 } }),
	];
	const cue = {
		id: 't',
		name: 'Pop',
		tracks: [{ kind: 'cue', keys: [{ time: 0, cue: 'event:missing' }] }],
	} as unknown as CinematicDoc;
	eq(
		'every issue the editor shows',
		codes(def, [cue]).sort((a, b) => a.localeCompare(b)),
		[
			'error:event-duplicate',
			'warning:event-input-collision',
			'error:event-payload-type',
			'error:event-payload-duplicate',
			'error:listener-input-unknown',
			'error:listener-duplicate',
			'error:listener-input-kind',
			'error:listener-input-kind',
			'error:listener-value-kind',
			'error:raise-event-unknown',
			'error:raise-payload-unknown',
			'warning:raise-payload-missing',
			'error:raise-payload-type',
			'error:raise-payload-type',
			'error:raise-payload-input',
			'error:raise-payload-key',
			'error:raise-event-unknown',
			'error:raise-event-unknown',
		].sort((a, b) => a.localeCompare(b)),
	);
	const issues = E.validateComponentEvents(def, [cue]);
	eq(
		'an issue names where it is (node + listener, state, timeline)',
		issues
			.filter((i) => i.code === 'raise-event-unknown')
			.map((i) => [i.node ?? null, i.listener ?? null, i.state ?? null, i.timeline ?? null]),
		[
			['Coin', 'd', null, null],
			[null, null, 'flash', null],
			[null, null, null, 'Pop'],
		],
	);
	eq(
		'an event sharing an input’s id is allowed, flagged as a warning (documented decision)',
		issues.find((i) => i.code === 'event-input-collision' && i.event === 'win')?.level,
		'warning',
	);
}

// ---- 7. the normalizer -------------------------------------------------------------------------

{
	const raw = coinDef() as unknown as Record<string, unknown> & ComponentDef;
	raw.events = [
		{ id: 'pressed', payload: [{ name: 'n', type: { t: 'int' }, description: 'how many' }] },
		{ id: 'pressed', note: 'dup' },
		{ id: '' },
		{
			id: 'mixed',
			payload: [
				{ name: 'a', type: { t: 'enum', name: 'SymbolName' } },
				{ name: 'b', type: { t: 'bool' }, optional: true },
				{ name: 'b', type: { t: 'int' } },
				{ name: 'c' },
			],
		},
	] as unknown as ComponentDef['events'];
	const kept = { id: 'kept', kind: 'sprite', x: 0, y: 0, tint: 1 } as LayoutNode;
	const child = {
		id: 'n_btn',
		kind: 'container',
		x: 0,
		y: 0,
		pressAction: 'confirm',
		future: { kept: true },
		on: [
			{ id: 'ok1', event: 'click', action: { kind: 'fire', input: 'win' } },
			{ id: 'ok2', event: 'down', action: { kind: 'set', input: 'amount', value: 2 } },
			{ id: 'ok3', event: 'up', action: { kind: 'toggle', input: 'lit' } },
			{
				id: 'ok4',
				event: 'enter',
				action: {
					kind: 'raise',
					event: 'pressed',
					payload: { n: 1, b: true, i: { input: 'amount' }, k: { key: 'a.b' } },
				},
			},
			{ id: 'ok1', event: 'up', action: { kind: 'fire', input: 'win' } },
			{ id: 'x1', event: 'hover', action: { kind: 'fire', input: 'win' } },
			{ id: 'x2', event: 'click', action: { kind: 'goto', state: 'win' } },
			{ id: 'x3', event: 'click', action: { kind: 'set', input: 'amount', value: 'big' } },
			{
				id: 'x4',
				event: 'click',
				action: { kind: 'raise', event: 'pressed', payload: { t: 'Free text!' } },
			},
			{ id: 'x5', event: 'click', action: { kind: 'raise', event: 'pressed', payload: { t: {} } } },
			{
				id: 'x8',
				event: 'click',
				action: { kind: 'raise', event: 'pressed', payload: { t: { key: '500' } } },
			},
			{ id: 'x6', event: 'click', action: { kind: 'fire' } },
			{ event: 'click', action: { kind: 'fire', input: 'win' } },
			{ id: 'x7', event: 'click' },
		],
		children: [kept, { id: 'empty', kind: 'sprite', x: 0, y: 0, on: [{ id: 'bad', event: 'x' }] }],
	};
	(raw.root.children as unknown[]).push(child);
	raw.stateMachine!.layers[0].states[1].onEnter = [
		{ id: 'a', kind: 'raise', event: 'winShown' },
		{ id: 'a', kind: 'raise', event: 'pressed' },
		{ kind: 'raise', event: 'winShown' },
		{ id: 'b', kind: 'fire', input: 'win' },
		{ id: 'c', kind: 'raise', event: 'pressed', payload: { t: 'text' } },
		{ id: 'd', kind: 'raise' },
	] as unknown as NonNullable<ComponentDef['stateMachine']>['layers'][0]['states'][0]['onEnter'];
	const out = normalizeComponent(raw);
	const btn = out.root.children[1] as LayoutNode & { future?: unknown; children: LayoutNode[] };
	eq(
		'events: kept, a duplicate or empty id dropped',
		out.events?.map((e) => e.id),
		['pressed', 'mixed'],
	);
	eq(
		'…a payload field Flow cannot carry, a duplicate name or a missing type is dropped',
		out.events?.map((e) => e.payload ?? null),
		[
			[{ name: 'n', type: { t: 'int' }, description: 'how many' }],
			[{ name: 'b', type: { t: 'bool' }, optional: true }],
		],
	);
	eq(
		'listeners: the readable ones kept as authored',
		btn.on?.map((l) => l.id),
		['ok1', 'ok2', 'ok3', 'ok4'],
	);
	eq('…a raise’s payload keeps numbers, bools, inputs and localization keys', btn.on?.[3].action, {
		kind: 'raise',
		event: 'pressed',
		payload: { n: 1, b: true, i: { input: 'amount' }, k: { key: 'a.b' } },
	});
	eq(
		'…every other node field passes through (press target, unknown fields, children)',
		[btn.pressAction, btn.future, btn.children[0] === kept],
		['confirm', { kept: true }, true],
	);
	eq('…a node whose listeners are all unreadable loses the key', 'on' in btn.children[1], false);
	const untouched = coinDef();
	eq(
		'…and a root with no listeners keeps its children array',
		normalizeComponent(untouched).root.children === untouched.root.children,
		true,
	);
	eq(
		'state onEnter: only readable raises with an id are kept, the first of each id',
		out.stateMachine?.layers[0].states[1].onEnter,
		[{ id: 'a', kind: 'raise', event: 'winShown' }],
	);
	eq(
		'a def with none of the new fields normalizes without them (parity)',
		Object.keys(normalizeComponent(coinDef({ events: undefined }))).includes('events'),
		false,
	);
}

// ---- 8. parity ---------------------------------------------------------------------------------

{
	eq('a def with no listeners reports none', E.hasNodeListeners(coinDef()), false);
	eq(
		'…no built-in def has listeners or events',
		Object.values(BUILTIN_COMPONENTS)
			.filter((d) => E.hasNodeListeners(d) || d.events?.length)
			.map((d) => d.id),
		[],
	);
	const instanceSvelte = source('packages/engine-layout/src/lib/ComponentInstance.svelte');
	eq(
		'ComponentInstance builds a dispatcher only for a def with listeners or events, and provides the listener context only when a node listens',
		[
			instanceSvelte.includes('allowed && def && (listened || !!def.events?.length)'),
			instanceSvelte.includes('if (eventDispatcher && listened) {'),
		],
		[true, true],
	);
	eq(
		'Flow’s container-event projection is unchanged: events are not projected yet (Phase 7)',
		deriveContainerEvents(
			componentSignalConfiguredEvents(
				'dlg',
				(CONFIRM_DIALOG_DEF.signals ?? []).map((s) => s.key),
			),
		).map((d) => d.id),
		['dlg.onConfirm', 'dlg.onCancel'],
	);
	eq(
		'the button press still calls the resolver without a kind (a press)',
		[
			instanceSvelte.includes('getFlowPress()?.(node.id, action)'),
			instanceSvelte.includes('getFlowPress()?.(node.id, name)'),
		],
		[true, true],
	);
}

// ---- 9. the ship chain (rule 8) ----------------------------------------------------------------

{
	const def = coinDef();
	(def.root.children[0] as LayoutNode).on = [
		listener('l', 'click', { kind: 'raise', event: 'pressed', payload: { amount: 1 } }),
	];
	const shipped = JSON.parse(JSON.stringify(normalizeComponent(def))) as ComponentDef;
	R.registerComponents({ [shipped.id]: shipped });
	const resolved = R.resolveComponent('coin').def;
	eq(
		'no new asset class: events, listeners and onEnter ride the def to the runtime registry',
		[
			resolved?.events?.map((e) => e.id),
			(resolved?.root.children[0] as LayoutNode).on?.[0].action,
			resolved?.stateMachine?.layers[0].states[1].onEnter,
		],
		[
			['pressed', 'winShown'],
			{ kind: 'raise', event: 'pressed', payload: { amount: 1 } },
			[{ id: 'e1', kind: 'raise', event: 'winShown' }],
		],
	);
}

console.log(
	`\n${failures === 0 ? '✅' : '❌'} component listeners + events: ${passes} passed, ${failures} failed`,
);
process.exit(failures ? 1 : 0);
