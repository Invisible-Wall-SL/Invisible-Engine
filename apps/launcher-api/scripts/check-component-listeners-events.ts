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
const { CONFIRM_DIALOG_DEF } =
	await import('../../../packages/engine-layout/src/lib/builtinComponents.ts');
const { componentSignalConfiguredEvents, deriveContainerEvents } =
	await import('../../../packages/engine-flow-v2/src/containerEvents.ts');
const { normalizeComponent } = await import('../src/lib/server/componentStorage.ts');
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
						{ id: 'win', timeline: 't_win', onEnter: [{ kind: 'raise', event: 'winShown' }] },
						{
							id: 'flash',
							timeline: 't_win',
							onEnter: [{ kind: 'raise', event: 'winShown', payload: { level: 2 } }],
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
		dispatcher.pointer([listener('l', event, { kind: 'fire', input: 'win' })], other);
		eq(`${event} → fire: another pointer event does nothing`, bus, []);
		dispatcher.pointer([listener('l', event, { kind: 'fire', input: 'win' })], event);
		eq(`${event} → fire: the trigger is fired on the instance bus`, bus, ['win']);
		runner.advance(0.1);
		eq(`${event} → fire: the instance's state machine hears it`, runner.stateOf('main'), 'win');
	}
	{
		const { runner, dispatcher } = instance('i');
		dispatcher.pointer([listener('l', event, { kind: 'set', input: 'lit', value: true })], event);
		eq(`${event} → set bool`, runner.input('lit'), true);
		dispatcher.pointer([listener('l', event, { kind: 'set', input: 'amount', value: 9 })], event);
		eq(`${event} → set number`, runner.input('amount'), 9);
		dispatcher.pointer([listener('l', event, { kind: 'toggle', input: 'lit' })], event);
		eq(`${event} → toggle bool (true → false)`, runner.input('lit'), false);
		dispatcher.pointer([listener('l', event, { kind: 'toggle', input: 'lit' })], event);
		eq(`${event} → toggle bool (false → true)`, runner.input('lit'), true);
	}
	{
		const { raised, dispatcher } = instance('coin_1');
		dispatcher.pointer(
			[
				listener('l', event, {
					kind: 'raise',
					event: 'pressed',
					payload: { amount: { input: 'amount' }, lit: false, label: { key: 'coin.pressed' } },
				}),
			],
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
		[
			listener('a', 'click', { kind: 'fire', input: 'lit' }),
			listener('b', 'click', { kind: 'fire', input: 'nope' }),
			listener('c', 'click', { kind: 'set', input: 'lit', value: 4 }),
			listener('d', 'click', { kind: 'set', input: 'amount', value: true }),
			listener('e', 'click', { kind: 'toggle', input: 'amount' }),
			listener('f', 'click', { kind: 'raise', event: 'undeclared' }),
		],
		'click',
	);
	eq(
		'a wrong kind, an unknown input, a mistyped value or an undeclared event does nothing',
		[bus, runner.input('lit'), runner.input('amount'), raised],
		[[], false, 3, []],
	);
	dispatcher.pointer(
		[
			listener('a', 'down', { kind: 'set', input: 'amount', value: 1 }),
			listener('b', 'down', { kind: 'set', input: 'amount', value: 2 }),
		],
		'down',
	);
	eq('several listeners on one event run in authored order', runner.input('amount'), 2);
}

// ---- 3. two instances --------------------------------------------------------------------------

{
	const a = instance('coin_a');
	const b = instance('coin_b');
	a.dispatcher.pointer([listener('l', 'click', { kind: 'fire', input: 'win' })], 'click');
	a.dispatcher.pointer(
		[listener('l', 'click', { kind: 'set', input: 'amount', value: 7 })],
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
	a.dispatcher.pointer([listener('l', 'up', { kind: 'raise', event: 'winShown' })], 'up');
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
				dispatcher.pointer(listeners, ours);
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
	const view = source('packages/engine-layout/src/lib/LayoutNodeView.svelte');
	for (const [pixi, ours] of [
		['onpointerdown', 'down'],
		['onpointerup', 'up'],
		['onpointerenter', 'enter'],
		['onpointerleave', 'leave'],
		['onpointertap', 'click'],
	]) {
		eq(
			`LayoutNodeView binds ${pixi} to the "${ours}" listeners (the map above)`,
			view.includes(`${pixi}={() => listen(listeners, '${ours}')}`),
			true,
		);
	}
	eq(
		'LayoutNodeView wraps only a listening node, static, sorted by its zIndex',
		[
			/\{#if listen && node\.on\}\s*\{@const listeners = node\.on\}\s*<Container\s+eventMode="static"\s+cursor=\{listenerCursor\}\s+zIndex=\{transform\.zIndex\}/.test(
				view,
			),
			/\{:else\}\s*\{@render nodeBody\(\)\}\s*\{\/if\}\s*$/.test(view),
		],
		[true, true],
	);
	eq(
		'…and reads the listener context only for a node that carries `on`',
		view.includes('const listen = node.on?.length ? getComponentListen() : undefined;'),
		true,
	);
	eq(
		'…a hover-only node keeps the default cursor',
		view.includes("node.on?.some((l) => l.event !== 'enter' && l.event !== 'leave')"),
		true,
	);
	eq(
		'the press target path is untouched (pressAction container, its own handlers)',
		[
			view.includes("eventMode={isPressTarget ? 'static' : undefined}"),
			view.includes('onpointerup={isPressTarget ? onNodePress : undefined}'),
		],
		[true, true],
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
		[
			listener('l', 'click', {
				kind: 'raise',
				event: 'pressed',
				payload: { amount: 2.5, lit: { input: 'lit' } },
			}),
		],
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
	dispatcher.started(runner.plays());
	eq('the machine starting enters the entry state (no onEnter there ⇒ nothing)', road, []);
	runner.fire('win');
	dispatcher.transitions(runner.advance(0.1).fired);
	eq('a transition into a state raises its onEnter, payload-less', road, [
		{ instanceId: 'coin_7', action: 'winShown', payload: undefined, kind: 'event' },
	]);
	eq('…nobody owns it: the road returns nothing, nothing runs', ran, ['coin_7.pressed']);

	road.length = 0;
	runner.setInput('lit', true);
	const step = runner.advance(0.1);
	dispatcher.transitions(step.fired);
	eq(
		'an `any` transition into a state raises its onEnter, payload as authored',
		[step.fired.map((f) => f.to), road],
		[
			['flash'],
			[{ instanceId: 'coin_7', action: 'winShown', payload: { level: 2 }, kind: 'event' }],
		],
	);

	const entered = coinDef();
	entered.stateMachine!.layers[0].states[0].onEnter = [{ kind: 'raise', event: 'winShown' }];
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
		[null, { level: 2 }],
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
		'…the dispatcher handles every `event:` cue (never broadcast)',
		cues.map((c) => dispatcher.cue(c)),
		[true, true],
	);
	eq('…and raises the declared one on the road', road, [
		{ instanceId: 'coin_7', action: 'winShown', payload: undefined, kind: 'event' },
	]);
	eq(
		'…any other cue is not its business',
		['signal:x', 'fx:spark', 'sfx:pop'].map((c) => dispatcher.cue(c)),
		[false, false, false],
	);
	eq('the observer saw every raise with its origin', seen, [
		'listener:pressed',
		...Array(5).fill('state:winShown'),
		'cue:winShown',
	]);
	unobserve();

	const instanceSvelte = source('packages/engine-layout/src/lib/ComponentInstance.svelte');
	eq(
		'ComponentInstance routes `event:` cues to the dispatcher before any broadcast',
		/if \(ns === 'event'\) \{\s*eventDispatcher\?\.cue\(cue\);\s*return;\s*\}\s*if \(!name \|\| ns === 'sfx'/.test(
			instanceSvelte,
		),
		true,
	);
	eq(
		'…raises the entry states’ onEnter as the machine starts, and every state a tick enters',
		[
			instanceSvelte.includes(
				'if (stateMachineRunner) eventDispatcher?.started(stateMachineRunner.plays());',
			),
			/const step = stateMachineRunner\.advance\(dt\);\s*applyStateMachine\(\);\s*eventDispatcher\?\.transitions\(step\.fired\);/.test(
				instanceSvelte,
			),
		],
		[true, true],
	);
	eq(
		'…and fires a listener’s trigger on its own bus, tagged with the instance’s node id',
		[
			instanceSvelte.includes('instanceId: node.id,'),
			instanceSvelte.includes('fireTrigger: (id) => fireComponentSignal(id),'),
		],
		[true, true],
	);

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

	const game = source('apps/lines/src/components/Game.svelte');
	eq(
		'the game’s press resolver plays no press sound for a raised event',
		/registerFlowPress\(\(componentId, action, payload, kind\) => \{[\s\S]*?if \(!routed\) return undefined;\s*\/\/[^\n]*\n\s*if \(kind === 'event'\) return routed;/.test(
			game,
		),
		true,
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
	clean.stateMachine!.layers[0].states[2].onEnter = [{ kind: 'raise', event: 'winShown' }];
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
	def.stateMachine!.layers[0].states[2].onEnter = [{ kind: 'raise', event: 'ghost' }];
	(def.root.children[0] as LayoutNode).on = [
		listener('a', 'click', { kind: 'fire', input: 'nope' }),
		listener('a', 'click', { kind: 'fire', input: 'lit' }),
		listener('b', 'down', { kind: 'toggle', input: 'amount' }),
		listener('c', 'up', { kind: 'set', input: 'lit', value: 1 }),
		listener('d', 'enter', { kind: 'raise', event: 'ghost' }),
		listener('e', 'leave', { kind: 'raise', event: 'pressed', payload: { x: 1 } }),
		listener('f', 'leave', { kind: 'raise', event: 'pressed', payload: { n: true } }),
		listener('g', 'leave', { kind: 'raise', event: 'pressed', payload: { n: { input: 'win' } } }),
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
			'error:raise-payload-input',
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
			{ id: 'x6', event: 'click', action: { kind: 'fire' } },
			{ event: 'click', action: { kind: 'fire', input: 'win' } },
			{ id: 'x7', event: 'click' },
		],
		children: [kept, { id: 'empty', kind: 'sprite', x: 0, y: 0, on: [{ id: 'bad', event: 'x' }] }],
	};
	(raw.root.children as unknown[]).push(child);
	raw.stateMachine!.layers[0].states[1].onEnter = [
		{ kind: 'raise', event: 'winShown' },
		{ kind: 'fire', input: 'win' },
		{ kind: 'raise', event: 'pressed', payload: { t: 'text' } },
		{ kind: 'raise' },
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
		'state onEnter: only readable raises are kept',
		out.stateMachine?.layers[0].states[1].onEnter,
		[{ kind: 'raise', event: 'winShown' }],
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
	eq('…every built-in def has none', E.hasNodeListeners(CONFIRM_DIALOG_DEF), false);
	const instanceSvelte = source('packages/engine-layout/src/lib/ComponentInstance.svelte');
	eq(
		'ComponentInstance builds a dispatcher only for a def with listeners or events',
		instanceSvelte.includes(
			'allowed && def && (listened || !!def.events?.length)\n\t\t\t? new ComponentEventDispatcher(',
		),
		true,
	);
	eq(
		'…and provides the listener context only when a node listens',
		instanceSvelte.includes(
			'if (eventDispatcher && listened) {\n\t\tsetComponentListen((listeners, event) => eventDispatcher.pointer(listeners, event));',
		),
		true,
	);
	eq(
		'…every other use is optional-chained (no dispatcher ⇒ nothing runs)',
		(instanceSvelte.match(/eventDispatcher\./g) ?? []).length,
		1,
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
	const press = source('packages/engine-layout/src/lib/ComponentInstance.svelte');
	eq(
		'the button press still calls the resolver with three arguments (kind absent ⇒ a press)',
		[
			press.includes('getFlowPress()?.(node.id, action)'),
			press.includes('getFlowPress()?.(node.id, name)'),
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
			[{ kind: 'raise', event: 'winShown' }],
		],
	);
}

console.log(
	`\n${failures === 0 ? '✅' : '❌'} component listeners + events: ${passes} passed, ${failures} failed`,
);
process.exit(failures ? 1 : 0);
