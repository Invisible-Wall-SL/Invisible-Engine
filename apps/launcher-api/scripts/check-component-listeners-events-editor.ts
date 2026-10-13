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
		'payload fields: add, a taken name refused',
		[
			L.addPayloadField(pressed, 'amount'),
			L.addPayloadField(pressed, 'amount'),
			L.addPayloadField(pressed, 'label', 'string'),
		],
		[true, false, true],
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
			/onStagePointer=\{animating && animateTab === 'stateMachine'/.test(workspace),
		],
		[true, true],
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
		'no new write: the new editor files fetch nothing but the timeline reads',
		[listeners, events, source('EditorRaisePayload.svelte')].some((s) => s.includes('fetch(')),
		false,
	);
}

console.log(
	`\n${failures === 0 ? '✅' : '❌'} component listeners + events editor: ${passes} passed, ${failures} failed`,
);
process.exit(failures ? 1 : 0);
