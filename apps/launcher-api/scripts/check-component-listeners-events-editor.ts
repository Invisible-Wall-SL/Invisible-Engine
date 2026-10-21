/**
 * The Listeners and Events editor (Rive plan Phase 6b):
 *   pnpm --filter launcher-api check:component-listeners-events-editor
 *
 *  1. ids: a new listener or on-enter row gets a minted id no id of the draft or of the last-saved
 *     component uses (the save keeps a row this build cannot read by id, and the client never sees
 *     it — so the suffix is random, and checked against both);
 *  2. listeners: add (the first action the def can do), retarget, change kind (a fitting target
 *     kept), a `set` taking its input's kind of value, payloads filled and cleared, remove;
 *  3. events: add (a taken id refused), rename (the listeners and on-enter raises follow; refused
 *     when taken), remove (the raises STAY, flagged by validation), what raises one (listeners,
 *     states, a timeline's `event:` cue), payload fields;
 *  4. on enter: add / remove rows on a state;
 *  5. the stage preview's pointer: the listening chain (deepest first), enter / leave as the
 *     pointer moves, down / up / click, a release off the node, leave on exit — driving the GAME's
 *     dispatcher, with a timeline's `event:` cue reaching it through `placeLayers` while it runs;
 *  6. what saves: everything the editor writes survives `normalizeComponent` (the load and save
 *     path) unchanged, inside the def — no new write;
 *  7. wiring guards over the Svelte this gate cannot mount: hidden panels hear no pointer, the
 *     stage reports the pointer in Animate only, edits are off while Inspecting.
 */
import { readFileSync } from 'node:fs';
import type { CinematicDoc, ComponentDef, LayoutNode, NodeListenerEvent } from 'engine-layout';

const L = await import('../src/lib/timeline/listenerEdit.ts');
const LP = await import('../src/lib/timeline/listenerPreview.ts');
const P = await import('../src/lib/timeline/stateMachinePreview.ts');
const S = await import('../src/lib/timeline/screenTimeline.ts');
const EV = await import('../../../packages/engine-layout/src/lib/componentEvents.ts');
const I = await import('../../../packages/engine-layout/src/lib/componentInterface.ts');
const M = await import('../../../packages/engine-layout/src/lib/stateMachine.ts');
const SME = await import('../src/lib/timeline/stateMachineEdit.ts');
const { normalizeComponent } = await import('../src/lib/server/componentStorage.ts');

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
	readFileSync(new URL(`../src/routes/(app)/editor/${path}`, import.meta.url), 'utf8');

// ---- fixtures ----------------------------------------------------------------------------------

function def(): ComponentDef {
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
			children: [
				{
					id: 'n_box',
					kind: 'container',
					label: 'Box',
					x: 0,
					y: 0,
					children: [{ id: 'n_btn', kind: 'sprite', label: 'Button', x: 0, y: 0 } as LayoutNode],
				},
				{ id: 'n_glow', kind: 'sprite', label: 'Glow', x: 0, y: 0 } as LayoutNode,
			],
		},
		inputs: [
			{ id: 'win', kind: 'trigger' },
			{ id: 'lit', kind: 'bool' },
			{ id: 'amount', kind: 'number' },
		],
	};
}
const node = (d: ComponentDef, id: string): LayoutNode =>
	L.defNodes(d).find((n) => n.id === id) as LayoutNode;

// ---- 1. ids ------------------------------------------------------------------------------------

{
	// A random source that first repeats a taken id, then gives a fresh one.
	const seq = [...Array(6).fill(0), ...Array(6).fill(0.5)];
	let i = 0;
	const random = (): number => seq[i++ % seq.length];
	eq('mintId skips a taken id', L.mintId('l', ['l_aaaaaa'], random), 'l_ssssss');
	const d = def();
	const saved = def();
	node(saved, 'n_btn').on = [
		{ id: 'l_gone', event: 'click', action: { kind: 'fire', input: 'win' } },
	];
	const reserved = L.rowIds(saved);
	const ids = new Set<string>();
	for (let n = 0; n < 50; n++) ids.add(L.addListener(node(d, 'n_btn'), d, reserved).id);
	eq(
		'fifty new listeners: fifty distinct ids, none the saved component used',
		[ids.size, ids.has('l_gone'), [...ids].every((id) => /^l_[a-z0-9]{6}$/.test(id))],
		[50, false, true],
	);
	eq('rowIds lists listeners and on-enter rows', [...L.rowIds(saved)], ['l_gone']);
	// The minter's first pick IS a saved row's id: addListener must skip it.
	const real = Math.random;
	let k = 0;
	const picks = [...Array(6).fill(0), ...Array(6).fill(0.5)];
	Math.random = () => picks[k++ % picks.length];
	try {
		const fresh = def();
		eq(
			'a new listener never takes the id of a row the last-saved component had',
			L.addListener(node(fresh, 'n_btn'), fresh, ['l_aaaaaa']).id,
			'l_ssssss',
		);
		k = 6; // the first pick is now the draft's own l_ssssss
		eq('…nor of one the draft has', L.addListener(node(fresh, 'n_glow'), fresh, []).id, 'l_aaaaaa');
	} finally {
		Math.random = real;
	}
}

// ---- 2. listeners ------------------------------------------------------------------------------

{
	const d = def();
	const btn = node(d, 'n_btn');
	const l = L.addListener(btn, d, []);
	eq(
		'a new listener: on click, fire the first trigger',
		[l.event, l.action],
		['click', { kind: 'fire', input: 'win' }],
	);
	L.setListenerKind(d, l, 'set');
	eq('→ set: the first bool or number input, a bool value', l.action, {
		kind: 'set',
		input: 'lit',
		value: true,
	});
	L.setActionTarget(d, l.action, 'amount');
	eq('retargeted to a number input, a set takes a number', l.action, {
		kind: 'set',
		input: 'amount',
		value: 0,
	});
	L.setListenerKind(d, l, 'toggle');
	eq('→ toggle: the bool input (amount does not fit)', l.action, { kind: 'toggle', input: 'lit' });
	L.setListenerKind(d, l, 'set');
	eq('→ set again keeps the input that still fits', l.action, {
		kind: 'set',
		input: 'lit',
		value: true,
	});
	L.setListenerKind(d, l, 'raise');
	eq('→ raise with no event yet: an empty target (validation flags it)', l.action, {
		kind: 'raise',
		event: '',
	});
	eq(
		'…which the save drops (fail-closed), never widening it',
		normalizeComponent(structuredClone(d)).root.children[0].kind === 'container' &&
			'on' in
				(normalizeComponent(structuredClone(d)).root.children[0] as { children: LayoutNode[] })
					.children[0],
		false,
	);
	L.removeListener(btn, l.id);
	eq('removing the last listener removes `on`', 'on' in btn, false);
	const empty: ComponentDef = { ...def(), inputs: undefined };
	eq(
		'a component with no input and no event: a new listener’s action has nothing to act on',
		L.addListener(node(empty, 'n_glow'), empty, []).action,
		{ kind: 'fire', input: '' },
	);
}

// ---- 3. events ---------------------------------------------------------------------------------

{
	const d = def();
	eq('add an event', L.addEvent(d, ' pressed ')?.id, 'pressed');
	eq(
		'a taken or empty id adds nothing',
		[L.addEvent(d, 'pressed'), L.addEvent(d, '  ')],
		[undefined, undefined],
	);
	const pressed = d.events![0];
	eq(
		'payload fields: add, a taken name refused, a name carrying ":" (the pin separator) refused',
		[
			L.addPayloadField(pressed, 'amount'),
			L.addPayloadField(pressed, 'amount'),
			L.addPayloadField(pressed, 'label', 'string'),
			L.addPayloadField(pressed, 'win:amount'),
		],
		[true, false, true, false],
	);
	L.setPayloadFieldType(pressed, 'amount', 'int');
	L.setPayloadFieldOptional(pressed, 'label', true);
	eq('…type and optional set', pressed.payload, [
		{ name: 'amount', type: { t: 'int' } },
		{ name: 'label', type: { t: 'string' }, optional: true },
	]);
	const l = L.addListener(node(d, 'n_btn'), d, [], 'down');
	L.setListenerKind(d, l, 'raise');
	eq('a raise picks the first event', l.action, { kind: 'raise', event: 'pressed' });
	if (l.action.kind === 'raise') {
		L.setRaisePayload(l.action, 'amount', { input: 'amount' });
		L.setRaisePayload(l.action, 'label', { key: 'Tap to win' });
		L.setRaisePayload(l.action, 'label', undefined);
	}
	eq('payload values set and cleared', l.action, {
		kind: 'raise',
		event: 'pressed',
		payload: { amount: { input: 'amount' } },
	});

	d.stateMachine = {
		layers: [
			{
				id: 'main',
				name: 'Main',
				entry: 'idle',
				states: [{ id: 'idle', timeline: 't' }],
				transitions: [],
			},
		],
	};
	const idle = d.stateMachine.layers[0].states[0];
	const row = L.addEnterAction(idle, d, ['e_saved1']);
	eq(
		'on enter: a minted id, raising the first event',
		[/^e_[a-z0-9]{6}$/.test(row.id), row.event],
		[true, 'pressed'],
	);
	eq('what raises "pressed": the listener and the state', L.eventUsage(d, 'pressed'), {
		listeners: [{ node: 'Button', listener: l.id }],
		states: [{ layer: 'Main', state: 'idle' }],
	});
	const timelines = [
		{ id: 'c1', name: 'Pop', tracks: [{ kind: 'cue', keys: [{ time: 0, cue: 'event:pressed' }] }] },
		{
			id: 'c2',
			name: 'Idle',
			tracks: [{ kind: 'cue', keys: [{ time: 0, cue: 'signal:pressed' }] }],
		},
	] as unknown as CinematicDoc[];
	eq('…and the timelines whose `event:` cue raises it', L.timelinesRaising(timelines, 'pressed'), [
		'Pop',
	]);
	eq(
		'rename: refused when taken or empty',
		[L.renameEvent(d, 'pressed', 'pressed'), L.renameEvent(d, 'pressed', '')],
		[false, false],
	);
	eq(
		'rename: the event, the listener and the on-enter row follow',
		[
			L.renameEvent(d, 'pressed', 'tapped'),
			d.events!.map((e) => e.id),
			l.action.kind === 'raise' && l.action.event,
			idle.onEnter![0].event,
		],
		[true, ['tapped'], 'tapped', 'tapped'],
	);
	const used = L.removeEvent(d, 'tapped');
	eq(
		'remove: reports what raised it, and drops the empty list',
		[used.listeners.length, used.states.length, 'events' in d],
		[1, 1, false],
	);
	eq(
		'…the raises STAY (never dropped silently) and validation flags them',
		[
			l.action.kind === 'raise' && l.action.event,
			idle.onEnter![0].event,
			EV.validateComponentEvents(d).filter((i) => i.code === 'raise-event-unknown').length,
		],
		['tapped', 'tapped', 2],
	);
	L.removeEnterAction(idle, row.id);
	eq('on enter: removing the last row removes `onEnter`', 'onEnter' in idle, false);
	L.removePayloadField(pressed, 'amount');
	L.removePayloadField(pressed, 'label');
	eq('removing the last payload field removes `payload`', 'payload' in pressed, false);
}

// ---- 4. inputs the listeners read --------------------------------------------------------------

{
	const d = def();
	d.events = [{ id: 'paid', payload: [{ name: 'amount', type: { t: 'int' } }] }];
	node(d, 'n_btn').on = [
		{ id: 'l_set', event: 'click', action: { kind: 'set', input: 'lit', value: true } },
		{
			id: 'l_raise',
			event: 'up',
			action: { kind: 'raise', event: 'paid', payload: { amount: { input: 'amount' } } },
		},
	];
	d.stateMachine = {
		layers: [
			{
				id: 'main',
				entry: 'idle',
				states: [
					{
						id: 'idle',
						name: 'Idle',
						timeline: 't_idle',
						onEnter: [
							{ id: 'e1', kind: 'raise', event: 'paid', payload: { amount: { input: 'amount' } } },
						],
					},
				],
				transitions: [],
			},
		],
	};
	eq(
		'inputReads names the listeners and on-enter rows that read an input',
		[L.inputReads(d, 'lit'), L.inputReads(d, 'amount'), L.inputReads(d, 'win')],
		[['a listener on "Button"'], ['a listener on "Button"', 'On enter of "Idle"'], []],
	);
	SME.renameInput(d, 'amount', 'stake');
	SME.renameInput(d, 'lit', 'glow');
	const [set, raise] = node(d, 'n_btn').on!;
	eq(
		'renaming an input: the listeners and raise payloads that read it follow',
		[
			set.action,
			raise.action.kind === 'raise' ? raise.action.payload : null,
			d.stateMachine.layers[0].states[0].onEnter![0].payload,
			L.inputReads(d, 'amount'),
		],
		[
			{ kind: 'set', input: 'glow', value: true },
			{ amount: { input: 'stake' } },
			{ amount: { input: 'stake' } },
			[],
		],
	);
	eq(
		'an event id a cue can name: no spaces, no ":"',
		[L.isEventId('paid'), L.isEventId('a b'), L.isEventId('a:b'), L.isEventId('')],
		[true, false, false, false],
	);
	eq(
		'add / rename refuse an id a cue cannot name',
		[!!L.addEvent(d, 'two words'), L.renameEvent(d, 'paid', 'x:y'), d.events.map((e) => e.id)],
		[false, false, ['paid']],
	);
}

// ---- 5. the stage preview's pointer -----------------------------------------------------------

{
	const d = def();
	d.events = [{ id: 'pressed' }, { id: 'hovered' }, { id: 'shown' }];
	const box = node(d, 'n_box');
	const btn = node(d, 'n_btn');
	box.on = [
		{ id: 'b_in', event: 'enter', action: { kind: 'raise', event: 'hovered' } },
		{ id: 'b_up', event: 'up', action: { kind: 'set', input: 'lit', value: true } },
	];
	btn.on = [
		{ id: 'n_dn', event: 'down', action: { kind: 'fire', input: 'win' } },
		{ id: 'n_ck', event: 'click', action: { kind: 'raise', event: 'pressed' } },
		{ id: 'n_out', event: 'leave', action: { kind: 'set', input: 'amount', value: 3 } },
	];
	eq(
		'nodePath: root … the hit node',
		LP.nodePath(d.root, 'n_btn').map((n) => n.id),
		['root', 'n_box', 'n_btn'],
	);
	eq(
		'the listening chain, deepest first',
		LP.listeningChain(d.root, 'n_btn').map((n) => n.id),
		['n_btn', 'n_box'],
	);
	eq('a node with no listener on its path: none', LP.listeningChain(d.root, 'n_glow'), []);

	// The panel's wiring: the game's dispatcher, its host on the preview runner, the log.
	d.stateMachine = {
		layers: [
			{
				id: 'main',
				entry: 'idle',
				states: [
					{
						id: 'idle',
						timeline: 't_idle',
						onEnter: [{ id: 'e1', kind: 'raise', event: 'shown' }],
					},
					{ id: 'won', timeline: 't_idle' },
				],
				transitions: [
					{ id: 't', from: 'idle', to: 'won', conditions: [{ input: 'win', op: 'fired' }] },
				],
			},
		],
	};
	const runner = new M.ComponentStateMachineRunner(
		d.stateMachine,
		I.componentInputs(d),
		new Map([['t_idle', 1]]),
	);
	const log: string[] = [];
	const dispatcher = new EV.ComponentEventDispatcher(d, {
		instanceId: 'preview',
		fireTrigger: (id) => runner.fire(id),
		input: (id) => runner.input(id),
		setInput: (id, v) => void runner.setInput(id, v),
		raise: (r) => log.push(`${r.origin}:${r.event}`),
	});
	const sent: string[] = [];
	const pointer = new LP.StagePointer((n, event: NodeListenerEvent) => {
		sent.push(`${n.id}:${event}`);
		dispatcher.pointer(n, event);
	});
	dispatcher.started(runner.plays());
	pointer.move(LP.listeningChain(d.root, 'n_glow'));
	pointer.move(LP.listeningChain(d.root, 'n_btn'));
	pointer.down(LP.listeningChain(d.root, 'n_btn'));
	pointer.up(LP.listeningChain(d.root, 'n_btn'));
	pointer.move(LP.listeningChain(d.root, 'n_glow'));
	eq('enter, down, up, click and leave reach the chain, deepest first', sent, [
		'n_btn:enter',
		'n_box:enter',
		'n_btn:down',
		'n_box:down',
		'n_btn:up',
		'n_box:up',
		'n_btn:click',
		'n_box:click',
		'n_btn:leave',
		'n_box:leave',
	]);
	dispatcher.transitions(runner.advance(0.1).fired);
	eq(
		'…and act on the preview runner: the trigger fired, the bool set, the number set on leave',
		[runner.stateOf('main'), runner.input('lit'), runner.input('amount')],
		['won', true, 3],
	);
	eq('the Events log: the entry state, the hover, the click — with their origin', log, [
		'state:shown',
		'listener:hovered',
		'listener:pressed',
	]);
	sent.length = 0;
	pointer.move(LP.listeningChain(d.root, 'n_btn'));
	pointer.down(LP.listeningChain(d.root, 'n_btn'));
	pointer.up([]);
	pointer.leave();
	eq('a release off the node is no up and no click; leaving the stage leaves', sent, [
		'n_btn:enter',
		'n_box:enter',
		'n_btn:down',
		'n_box:down',
		'n_btn:leave',
		'n_box:leave',
	]);

	// A timeline's `event:` cue reaches the dispatcher through `placeLayers` — while running only.
	const cueDoc = {
		...S.newComponentTimeline({ id: 't_idle', name: 'Idle', componentId: 'coin' }),
		duration: 1,
		stage: { sceneId: null, cast: [] },
		tracks: [{ id: 'c', kind: 'cue', actorId: '', keys: [{ time: 0, cue: 'event:shown' }] }],
	} as unknown as CinematicDoc;
	log.length = 0;
	const r2 = new M.ComponentStateMachineRunner(
		d.stateMachine,
		I.componentInputs(d),
		new Map([['t_idle', 1]]),
	);
	P.placeLayers(r2, P.previewPlayer([cueDoc], d.root.children));
	eq('not running: the entry cue raises nothing', log, []);
	P.placeLayers(r2, P.previewPlayer([cueDoc], d.root.children), {
		dispatcher,
		declaresEvents: true,
	});
	eq('running: the `event:` cue at 0 is raised', log, ['cue:shown']);

	// ▶ Run after the entry pose was placed while stopped: the game's startStateMachine order.
	log.length = 0;
	const r3 = new M.ComponentStateMachineRunner(
		d.stateMachine,
		I.componentInputs(d),
		new Map([['t_idle', 1]]),
	);
	P.placeLayers(r3, P.previewPlayer([cueDoc], d.root.children));
	P.startLayers(r3, P.previewPlayer([cueDoc], d.root.children), {
		dispatcher,
		declaresEvents: true,
	});
	eq('the first Run re-crosses 0: the entry cue, then the entry state’s On enter', log, [
		'cue:shown',
		'state:shown',
	]);
}

// ---- 6. what saves -----------------------------------------------------------------------------

{
	const d = def();
	L.addEvent(d, 'pressed');
	L.addPayloadField(d.events![0], 'amount', 'int');
	const l = L.addListener(node(d, 'n_btn'), d, []);
	L.setListenerKind(d, l, 'raise');
	if (l.action.kind === 'raise') L.setRaisePayload(l.action, 'amount', 2);
	d.stateMachine = {
		layers: [
			{ id: 'main', entry: 'idle', states: [{ id: 'idle', timeline: 't' }], transitions: [] },
		],
	};
	L.addEnterAction(d.stateMachine.layers[0].states[0], d, []);
	const saved = normalizeComponent(structuredClone(d));
	eq(
		'everything the editor writes survives the save path unchanged',
		[saved.events, node(saved, 'n_btn').on, saved.stateMachine?.layers[0].states[0].onEnter],
		[d.events, node(d, 'n_btn').on, d.stateMachine.layers[0].states[0].onEnter],
	);
}

// ---- 6b. what the editor refuses ---------------------------------------------------------------

{
	const cue = (event: string, name = 'Reveal'): CinematicDoc =>
		({
			id: `t_${name}`,
			name,
			tracks: [{ id: 'c', kind: 'cue', actorId: '', keys: [{ time: 0, cue: `event:${event}` }] }],
		}) as unknown as CinematicDoc;
	const d = def();
	L.addEvent(d, 'revealDone');
	L.addEvent(d, 'pressed');
	eq(
		'removing an event that is not the last: allowed',
		L.removeEventRefusal(d, 'pressed', [cue('revealDone')]),
		null,
	);
	L.removeEvent(d, 'pressed');
	const refused = L.removeEventRefusal(d, 'revealDone', [cue('revealDone')]);
	eq(
		'removing the LAST event while a timeline has an event: cue is refused, naming the cue',
		[refused !== null, !!refused?.includes('event:revealDone in "Reveal"')],
		[true, true],
	);
	eq(
		'…so the cue still routes as an event, never a screen-wide broadcast',
		EV.routeComponentCue('event:revealDone', !!d.events?.length).kind,
		'event',
	);
	eq(
		'the last event with no cue anywhere: allowed',
		L.removeEventRefusal(d, 'revealDone', []),
		null,
	);
	const shared = { ...structuredClone(d), scope: 'shared' as const };
	eq(
		'a SHARED def keeps its last event even with no cue in this project (others may raise it)',
		[
			!!L.removeEventRefusal(shared, 'revealDone', [])?.includes('Shared components keep'),
			L.removeEventRefusal({ ...shared, events: [...shared.events!, { id: 'x' }] }, 'x', []),
		],
		[true, null],
	);
	const bare = def();
	eq(
		'the first event re-routes the cues: listed; once one is declared, nothing is',
		[L.firstEventCues(bare, [cue('revealDone')]), L.firstEventCues(d, [cue('revealDone')])],
		[[{ timeline: 'Reveal', event: 'revealDone' }], []],
	);

	const e = def();
	L.addEvent(e, 'a');
	L.addEvent(e, 'b');
	const l = L.addListener(node(e, 'n_btn'), e, []);
	L.setListenerKind(e, l, 'raise');
	L.setActionTarget(e, l.action, 'a');
	L.removeEvent(e, 'a');
	eq(
		'renaming OR adding onto a removed event its rows still raise is refused (no silent reconnect)',
		[
			L.eventNameRefusal(e, 'a') !== null,
			L.renameEvent(e, 'b', 'a'),
			!!L.addEvent(e, 'a'),
			e.events!.map((x) => x.id),
		],
		[true, false, false, ['b']],
	);
	eq(
		'a name only a timeline cue uses is free — declaring it is how a cue typo is fixed',
		[L.eventNameRefusal(e, 'revealDone'), L.renameEvent(e, 'b', 'revealDone')],
		[null, true],
	);

	const ok = def();
	L.addEvent(ok, 'paid');
	L.addPayloadField(ok.events![0], 'amount', 'int');
	L.addPayloadField(ok.events![0], 'label', 'string');
	const pay = L.addListener(node(ok, 'n_btn'), ok, []);
	L.setListenerKind(ok, pay, 'raise');
	if (pay.action.kind === 'raise') {
		L.setRaisePayload(pay.action, 'amount', 5);
		L.setRaisePayload(pay.action, 'label', { key: 'You win' });
	}
	eq('a valid draft: nothing unsavable', L.unsavableRows(ok), []);
	const saved = normalizeComponent(structuredClone(ok));
	eq(
		'…and it saves byte-identically',
		JSON.stringify([saved.events, node(saved, 'n_btn').on]),
		JSON.stringify([ok.events, node(ok, 'n_btn').on]),
	);
	const bad = structuredClone(ok);
	const raise = node(bad, 'n_btn').on![0].action;
	if (raise.kind === 'raise') raise.payload = { amount: 1.5, label: { key: '100' } };
	node(bad, 'n_glow').on = [{ id: 'l_x', event: 'click', action: { kind: 'fire', input: '' } }];
	bad.stateMachine = {
		layers: [
			{
				id: 'main',
				entry: 'idle',
				states: [
					{
						id: 'idle',
						name: 'Idle',
						timeline: 't',
						onEnter: [{ id: 'e_x', kind: 'raise', event: '' }],
					},
				],
				transitions: [],
			},
		],
	};
	eq(
		'unsavable: a non-key text, a fractional int, an empty target — each row named',
		L.unsavableRows(bad),
		['a listener on "Button"', 'a listener on "Glow"', 'On enter of "Idle"'],
	);
	const dropped = normalizeComponent(structuredClone(bad));
	eq(
		'…which are exactly the rows the server would drop (but the fractional int it keeps)',
		[
			node(dropped, 'n_glow').on,
			dropped.stateMachine?.layers[0].states[0].onEnter,
			node(dropped, 'n_btn').on,
		],
		[undefined, undefined, undefined],
	);
	const workspace = source('ComponentWorkspace.svelte');
	eq(
		'adding a shared def’s first event always confirms (other projects’ cues are out of sight)',
		/const shared = componentDraft\.scope !== 'project';\s*if \(cues\.length \|\| shared\)/.test(
			workspace,
		),
		true,
	);
	eq(
		'Save and Promote both refuse an unsavable draft',
		(workspace.match(/const unsavable = unsavableRowsMessage\(componentDraft\);/g) ?? []).length,
		2,
	);
}

// ---- 6c. the stage hit-test --------------------------------------------------------------------

{
	const box = (id: string, extra: Partial<LayoutNode> = {}): LayoutNode =>
		({ id, kind: 'sprite', x: 0, y: 0, ...extra }) as LayoutNode;
	const group = (id: string, children: LayoutNode[]): LayoutNode =>
		({ id, kind: 'container', x: 0, y: 0, children }) as unknown as LayoutNode;
	interface T {
		x: number;
		y: number;
		rotation?: number;
		scale?: { x: number; y: number };
		visible: boolean;
	}
	const place: Record<string, Partial<T>> = {
		n_d: {},
		n_a: { x: 100, rotation: Math.PI / 2, scale: { x: 2, y: 2 } },
		n_b: { x: 10 },
		n_b_hidden: { x: 10, visible: false },
		n_c: { visible: false },
		n_z: { scale: { x: 0, y: 1 } },
		n_zz: {},
	};
	const size: Record<string, number> = { n_d: 50, n_b: 5, n_b_hidden: 5, n_c: 1000, n_zz: 1000 };
	const transform = (n: LayoutNode): T => ({ x: 0, y: 0, visible: true, ...place[n.id] });
	const inBox = (n: LayoutNode, t: T, p: { x: number; y: number }): boolean => {
		const l = LP.toLocal(p, t);
		const s = size[n.id] ?? 0;
		return !!l && l.x >= 0 && l.x <= s && l.y >= 0 && l.y <= s;
	};
	const stage = [
		box('n_d'),
		group('n_a', [box('n_b'), box('n_b_hidden')]),
		box('n_c'),
		group('n_z', [box('n_zz')]),
	];
	const hit = (x: number, y: number): string | null =>
		LP.deepHit(stage, { x, y }, transform, inBox);
	// n_b's local (2, 2): in n_a's space (12, 2), scaled (24, 4), turned 90° (-4, 24), moved (96, 24).
	eq(
		'deepHit: into a moved, turned, scaled container, past hidden nodes and a collapsed one',
		[hit(96, 24), hit(5, 5), hit(500, 500), hit(80, 24)],
		['n_b', 'n_d', null, null],
	);
}

// ---- 7. wiring guards --------------------------------------------------------------------------

{
	const panel = source('EditorStateMachinePanel.svelte');
	const canvas = source('EditorCanvas.svelte');
	const workspace = source('ComponentWorkspace.svelte');
	const listeners = source('EditorListeners.svelte');
	const events = source('EditorEvents.svelte');
	eq(
		'a hidden State Machine panel hears no pointer, and forgets it when hidden',
		[
			panel.includes('if (!active || !def) return;'),
			/if \(!on\) \{\s*stop\(\);[\s\S]{0,200}pointer = new StagePointer/.test(panel),
			panel.includes("deleteKey={active ? ['Delete', 'Backspace'] : []}"),
		],
		[true, true, true],
	);
	eq(
		'the stage reports the pointer in Animate only, and only to the State machine tab',
		[
			canvas.includes("if (animate) onStagePointer?.('down', deepHitId(world));"),
			canvas.includes('if (animate && onStagePointer && canvas && e.button === 0)'),
			/onStagePointer=\{animating && animateTab === 'stateMachine'/.test(workspace),
		],
		[true, true, true],
	);
	eq(
		'Inspecting: listeners and events are read-only, and the page’s event edits refuse',
		[
			workspace.includes('componentReadOnly={isInspecting}'),
			(listeners.match(/disabled=\{readOnly/g) ?? []).length >= 6,
			(events.match(/disabled=\{readOnly/g) ?? []).length >= 6,
			(workspace.match(/if \(!componentDraft \|\| isInspecting\) return;/g) ?? []).length >= 2,
		],
		[true, true, true, true],
	);
	eq(
		'the canvas hit-tests the stage through deepHit, read off the drawn pose',
		[canvas.includes('return deepHit('), canvas.includes(': poseTransform(node),')],
		[true, true],
	);
	eq(
		'no new write: the new editor files fetch nothing but the timeline reads',
		[listeners, events, source('EditorRaisePayload.svelte')].some((s) => s.includes('fetch(')),
		false,
	);
}

console.log(
	`\n${failures === 0 ? '✅' : '❌'} component listeners + events editor: ${passes} passed, ${failures} failed`,
);
process.exit(failures ? 1 : 0);
