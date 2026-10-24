/**
 * Pointer move / drag / swipe and Align Target (game-families §3.2, §7.2, P10.4):
 *   pnpm --filter launcher-api check:component-pointer-drag
 *
 *  1. the gesture (`componentPointer.ts`): a press is `down`; it is a drag only past the slop
 *     (`dragStart` once, then `drag` on every move of its own pointer, anywhere); its release ends
 *     the drag and offers a `swipe`; a release over the node is `up` as it always was, pressed there
 *     or not; `move` over the node; every reading carries x / y in the instance's space and dx / dy
 *     from the press;
 *  2. the swipe filter: the threshold (default 40), the dominant direction, a tie reads horizontal;
 *  3. the dispatcher: the new events run listeners like the old five; a `{ pointer }` payload value
 *     carries the reading (rounded into a whole-number field) and is empty where no pointer ran it;
 *     a swipe listener runs only when its filter answers; Align Target places its node on the
 *     pointer in the node's parent space, keeps the press's offset with `preserveOffset`, moves one
 *     axis with `axis`, and does nothing with no target or no pointer;
 *  4. real Pixi (`EventBoundary`, headless) over the wrapper `LayoutNodeView` renders: a drag that
 *     leaves the node keeps tracking (`globalpointermove`) and ends off it (`pointerupoutside`); the
 *     markup binds what this section wires;
 *  5. validation: `raise-payload-pointer`, `listener-align-target`, `listener-swipe`;
 *  6. the normalizer reads the new rows and drops a malformed one whole (the save keeps it); the
 *     editor's edits and save guard;
 *  7. the board cell hit-test (`getCellAt`, sliced from the real `gameState.svelte.ts`) is the
 *     inverse of `getSymbolSeat` over flat, gapped, non-square, led, aligned, stepped and
 *     perspective lattices: every seat is in its own cell, the pitch boxes tile a flat board, and
 *     off the board is no cell;
 *  8. parity: no built-in def uses the new events or Align Target, and a node that does not listen
 *     for them gets no new Pixi handler (source-scanned in the Svelte wiring this gate cannot mount).
 */
import 'pixi.js/events';
import { readFileSync } from 'node:fs';
import { Container, EventBoundary, FederatedPointerEvent, Graphics } from 'pixi.js';
import type {
	ComponentDef,
	LayoutNode,
	ListenerAction,
	NodeListener,
	NodeListenerEvent,
	PointerAt,
} from 'engine-layout';

const E = await import('../../../packages/engine-layout/src/lib/componentEvents.ts');
const P = await import('../../../packages/engine-layout/src/lib/componentPointer.ts');
const T = await import('../../../packages/engine-layout/src/lib/types.ts');
const { BUILTIN_COMPONENTS } =
	await import('../../../packages/engine-layout/src/lib/builtinComponents.ts');
const { normalizeComponent } = await import('../src/lib/server/componentStorage.ts');
const Rows = await import('../src/lib/componentEventRows.ts');
const Edit = await import('../src/lib/timeline/listenerEdit.ts');
const { compileSlice, stripSliceTypes } = await import('../../../scripts/lib/compile-slice.mjs');
const { resolveGrid } = await import('../../../packages/game-config/src/grid.ts');

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
	readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---- 1. the gesture ----------------------------------------------------------------------------

type Sent = [NodeListenerEvent, number, number, number, number];
const recorder = () => {
	const sent: Sent[] = [];
	const g = new P.PointerGesture((event, at) => sent.push([event, at.x, at.y, at.dx, at.dy]));
	return { sent, g };
};
const pt = (x: number, y: number) => ({ x, y });
{
	const { sent, g } = recorder();
	g.down(1, pt(10, 10), pt(110, 10));
	g.move(1, pt(12, 11), pt(112, 11));
	eq('a press is down; a move inside the slop is not a drag', sent, [['down', 10, 10, 0, 0]]);
	g.move(1, pt(20, 10), pt(120, 10));
	g.move(2, pt(90, 90), pt(190, 90));
	g.move(1, pt(40, 25), pt(140, 25));
	g.move(1, pt(40, 25), pt(140, 25));
	eq(
		'past the slop: dragStart once, then drag on each move of the press’s own pointer (a repeat is none)',
		sent.slice(1),
		[
			['dragStart', 20, 10, 10, 0],
			['drag', 20, 10, 10, 0],
			['drag', 40, 25, 30, 15],
		],
	);
	sent.length = 0;
	g.release(1, pt(60, 10), pt(160, 10), false);
	eq('released off the node: dragEnd and the swipe offer, no up', sent, [
		['dragEnd', 60, 10, 50, 0],
		['swipe', 60, 10, 50, 0],
	]);
	sent.length = 0;
	g.move(1, pt(70, 10), pt(170, 10));
	g.hover(pt(5, 6), pt(105, 6));
	eq('after the release nothing drags; a hover is move with no press (dx = dy = 0)', sent, [
		['move', 5, 6, 0, 0],
	]);
}
{
	const { sent, g } = recorder();
	g.release(1, pt(3, 4), pt(3, 4), true);
	eq('an up over the node that was pressed elsewhere is up, as it always was', sent, [
		['up', 3, 4, 0, 0],
	]);
	sent.length = 0;
	g.down(1, pt(0, 0), pt(0, 0));
	g.release(1, pt(1, 1), pt(1, 1), true);
	eq('a tap is down, up and the swipe offer (no drag)', sent, [
		['down', 0, 0, 0, 0],
		['up', 1, 1, 1, 1],
		['swipe', 1, 1, 1, 1],
	]);
	sent.length = 0;
	g.plain('click', pt(1, 1), pt(1, 1));
	g.plain('enter', pt(2, 2), pt(2, 2));
	g.plain('leave', pt(9, 9), pt(9, 9));
	eq('click, enter and leave pass through with their reading', sent, [
		['click', 1, 1, 0, 0],
		['enter', 2, 2, 0, 0],
		['leave', 9, 9, 0, 0],
	]);
	eq('the reading keeps the stage point, copied', g.at(pt(1, 2), pt(7, 8)).global, { x: 7, y: 8 });
}
{
	const { sent, g } = recorder();
	g.down(1, pt(0, 0), pt(0, 0));
	g.move(1, pt(20, 0), pt(20, 0));
	g.down(2, pt(5, 5), pt(5, 5));
	g.release(2, pt(5, 5), pt(5, 5), true);
	g.move(1, pt(30, 0), pt(30, 0));
	g.release(1, pt(30, 0), pt(30, 0), false);
	eq('a second pointer is a down and an up; the first press keeps its drag and still ends', sent, [
		['down', 0, 0, 0, 0],
		['dragStart', 20, 0, 20, 0],
		['drag', 20, 0, 20, 0],
		['down', 5, 5, 5, 5],
		['up', 5, 5, 5, 5],
		['drag', 30, 0, 30, 0],
		['dragEnd', 30, 0, 30, 0],
		['swipe', 30, 0, 30, 0],
	]);
	sent.length = 0;
	g.down(1, pt(0, 0), pt(0, 0));
	g.release(1, pt(50, 0), pt(50, 0), false);
	sent.length = 0;
	g.hover(pt(9, 9), pt(9, 9));
	eq('after a press released off the node, a hover reads dx = dy = 0 again', sent, [
		['move', 9, 9, 0, 0],
	]);
}

// ---- 2. the swipe filter -----------------------------------------------------------------------

eq('the default threshold is 40', T.DEFAULT_SWIPE_THRESHOLD, 40);
eq(
	'swipe filter: under / at the threshold, any direction',
	[P.swipeMatches(undefined, { dx: 39, dy: 0 }), P.swipeMatches(undefined, { dx: 0, dy: -40 })],
	[false, true],
);
eq(
	'swipe filter: the dominant axis decides; a tie is horizontal',
	[
		P.swipeMatches({ direction: 'right' }, { dx: 50, dy: 49 }),
		P.swipeMatches({ direction: 'down' }, { dx: 49, dy: 50 }),
		P.swipeMatches({ direction: 'left' }, { dx: -40, dy: 40 }),
		P.swipeMatches({ direction: 'up' }, { dx: -40, dy: 40 }),
		P.swipeMatches({ direction: 'up' }, { dx: 0, dy: -60 }),
	],
	[true, true, true, false, true],
);
eq(
	'swipe filter: an authored threshold, and 0 still needs some travel',
	[
		P.swipeMatches({ threshold: 10 }, { dx: 10, dy: 0 }),
		P.swipeMatches({ threshold: 0 }, { dx: 0, dy: 0 }),
	],
	[true, false],
);

// ---- 3. the dispatcher -------------------------------------------------------------------------

/** A slider: a `drag` event with x / dx and a whole-number `step`, a knob node, a `lit` bool. */
function sliderDef(): ComponentDef {
	return {
		id: 'slider',
		name: 'Slider',
		version: 1,
		scope: 'project',
		category: 'ui',
		root: {
			id: 'root',
			kind: 'container',
			x: 0,
			y: 0,
			children: [
				{ id: 'n_track', kind: 'sprite', x: 0, y: 0 } as LayoutNode,
				{ id: 'n_knob', kind: 'sprite', x: 5, y: 7 } as LayoutNode,
			],
		},
		inputs: [{ id: 'lit', kind: 'bool' }],
		events: [
			{
				id: 'moved',
				payload: [
					{ name: 'x', type: { t: 'float' }, optional: true },
					{ name: 'dx', type: { t: 'float' }, optional: true },
					{ name: 'step', type: { t: 'int' }, optional: true },
				],
			},
		],
	};
}
const at = (x: number, y: number, dx = 0, dy = 0, global = { x, y }): PointerAt => ({
	x,
	y,
	dx,
	dy,
	global,
});
const on = (...listeners: NodeListener[]) => ({ id: 'n_track', on: listeners });
const li = (id: string, event: NodeListenerEvent, action: ListenerAction, extra = {}) =>
	({ id, event, action, ...extra }) as NodeListener;
/** An instance whose knob lives in a parent offset by (100, 0) and scaled 2 on the stage. */
function instance() {
	const raised: { event: string; payload: Record<string, unknown> }[] = [];
	const inputs = new Map<string, number | boolean>();
	const placed: Partial<{ x: number; y: number }>[] = [];
	let knob = { x: 5, y: 7 };
	const dispatcher = new E.ComponentEventDispatcher(sliderDef(), {
		instanceId: 'i',
		fireTrigger: () => {},
		input: (id) => inputs.get(id),
		setInput: (id, v) => void inputs.set(id, v),
		raise: (r) => raised.push({ event: r.event, payload: r.payload }),
		alignTarget: (id) =>
			id === 'n_knob'
				? {
						toLocal: (g) => ({ x: (g.x - 100) / 2, y: g.y / 2 }),
						position: () => knob,
						place: (p) => {
							placed.push(p);
							knob = { ...knob, ...p };
						},
					}
				: undefined,
	});
	return { dispatcher, raised, inputs, placed, knob: () => knob };
}
for (const event of ['move', 'dragStart', 'drag', 'dragEnd'] as const) {
	const { dispatcher, inputs } = instance();
	dispatcher.pointer(
		on(li('l', event, { kind: 'set', input: 'lit', value: true })),
		'down',
		at(0, 0),
	);
	eq(`${event}: another event does not run it`, inputs.get('lit'), undefined);
	dispatcher.pointer(
		on(li('l', event, { kind: 'set', input: 'lit', value: true })),
		event,
		at(0, 0),
	);
	eq(`${event}: its listener runs like the old five`, inputs.get('lit'), true);
}
{
	const { dispatcher, raised } = instance();
	const raise: ListenerAction = {
		kind: 'raise',
		event: 'moved',
		payload: { x: { pointer: 'x' }, dx: { pointer: 'dx' }, step: { pointer: 'dx' } },
	};
	dispatcher.pointer(on(li('l', 'drag', raise)), 'drag', at(12.25, 3, 7.6, -1));
	eq('a pointer payload carries the reading; a whole-number field takes it rounded', raised, [
		{ event: 'moved', payload: { x: 12.25, dx: 7.6, step: 8 } },
	]);
	raised.length = 0;
	dispatcher.pointer(on(li('l', 'drag', raise)), 'drag');
	eq('with no pointer the pointer fields arrive empty', raised, [{ event: 'moved', payload: {} }]);
	raised.length = 0;
	dispatcher.run(raise, 'state');
	dispatcher.drain();
	eq('a raise no pointer runs (a state, a cue) leaves them empty', raised, [
		{ event: 'moved', payload: {} },
	]);
}
{
	const { dispatcher, raised } = instance();
	const raise = (id: string): ListenerAction => ({
		kind: 'raise',
		event: 'moved',
		payload: { step: id === 'l' ? 1 : 2 },
	});
	const node = on(
		li('l', 'swipe', raise('l'), { swipe: { direction: 'left' } }),
		li('r', 'swipe', raise('r'), { swipe: { direction: 'right', threshold: 10 } }),
	);
	dispatcher.pointer(node, 'swipe', at(0, 0, 20, 0));
	dispatcher.pointer(node, 'swipe', at(0, 0, -60, 10));
	dispatcher.pointer(node, 'swipe', at(0, 0, -5, 0));
	dispatcher.pointer(node, 'swipe');
	eq(
		'a swipe listener runs only when its filter answers (and never with no pointer)',
		raised.map((r) => r.payload.step),
		[2, 1],
	);
}
{
	const { dispatcher, placed, knob } = instance();
	const node = on(li('a', 'drag', { kind: 'align', target: 'n_knob' }));
	dispatcher.pointer(node, 'drag', at(0, 0, 0, 0, { x: 140, y: 30 }));
	eq('Align Target: the node sits on the pointer, in its parent’s space', knob(), { x: 20, y: 15 });
	const preserve = on(
		li('a', 'dragStart', { kind: 'align', target: 'n_knob', preserveOffset: true }),
	);
	const preserveDrag = { ...preserve, on: [{ ...preserve.on[0], event: 'drag' as const }] };
	preserveDrag.on[0].action = preserve.on[0].action;
	dispatcher.pointer(preserve, 'dragStart', at(0, 0, 0, 0, { x: 120, y: 40 }));
	eq('…preserveOffset: at the press it stays where it was', knob(), { x: 20, y: 15 });
	dispatcher.pointer(preserveDrag, 'drag', at(0, 0, 0, 0, { x: 130, y: 50 }));
	eq('…and then keeps that offset from the pointer', knob(), { x: 25, y: 20 });
	const dragOnly = on(li('d', 'drag', { kind: 'align', target: 'n_knob', preserveOffset: true }));
	const press = (gx: number, gy: number) =>
		dispatcher.pointer(on(), 'down', at(0, 0, 0, 0, { x: gx, y: gy }));
	press(0, 0);
	dispatcher.pointer(dragOnly, 'drag', at(0, 0, 0, 0, { x: 160, y: 40 }));
	eq('…a drag-only preserveOffset: the first drag of a press keeps the node where it is', knob(), {
		x: 25,
		y: 20,
	});
	dispatcher.pointer(dragOnly, 'drag', at(0, 0, 0, 0, { x: 170, y: 40 }));
	eq('…and follows from there', knob(), { x: 30, y: 20 });
	press(0, 0);
	dispatcher.pointer(dragOnly, 'drag', at(0, 0, 0, 0, { x: 100, y: 0 }));
	eq('…a new press takes a new offset (the node does not jump)', knob(), { x: 30, y: 20 });
	placed.length = 0;
	dispatcher.pointer(
		on(li('a', 'move', { kind: 'align', target: 'n_knob', axis: 'x' })),
		'move',
		at(0, 0, 0, 0, { x: 300, y: 300 }),
	);
	dispatcher.pointer(
		on(li('a', 'move', { kind: 'align', target: 'n_knob', axis: 'y' })),
		'move',
		at(0, 0, 0, 0, { x: 0, y: 8 }),
	);
	eq('…an axis moves only that axis', placed, [{ x: 100 }, { y: 4 }]);
	eq('…the other stays', knob(), { x: 100, y: 4 });
	placed.length = 0;
	dispatcher.pointer(on(li('a', 'drag', { kind: 'align', target: 'n_track' })), 'drag', at(0, 0));
	dispatcher.pointer(on(li('a', 'drag', { kind: 'align', target: 'n_knob' })), 'drag');
	dispatcher.run({ kind: 'align', target: 'n_knob' }, 'listener');
	eq(
		'…no target the instance hands over, no pointer, or no pointer event: nothing moves',
		placed,
		[],
	);
}
eq(
	'alignTargetIds lists each aligned node once',
	E.alignTargetIds({
		root: {
			...sliderDef().root,
			on: [li('a', 'drag', { kind: 'align', target: 'n_knob' })],
			children: [
				{
					id: 'n_track',
					kind: 'sprite',
					x: 0,
					y: 0,
					on: [li('b', 'move', { kind: 'align', target: 'n_knob' })],
				} as LayoutNode,
			],
		},
	}),
	['n_knob'],
);

// ---- 4. real Pixi: the drag keeps tracking off the node ----------------------------------------

{
	const stage = new Container();
	// The instance's space: offset and scaled, so the readings prove the mapping.
	const space = new Container({ x: 100, y: 0, scale: 2 });
	const wrapper = new Container({ eventMode: 'static' });
	wrapper.addChild(new Graphics().rect(0, 0, 50, 50).fill(0xff0000));
	space.addChild(wrapper);
	stage.addChild(space);
	const log: string[] = [];
	const gesture = new P.PointerGesture((event, a) =>
		log.push(`${event}@${a.x},${a.y}/${a.dx},${a.dy}`),
	);
	const local = (e: FederatedPointerEvent) => space.toLocal(e.global);
	// Exactly the handlers `LayoutNodeView` binds on a node that listens for a drag (or a swipe).
	wrapper.onpointerdown = (e) => gesture.down(e.pointerId, local(e), e.global);
	wrapper.onpointerup = (e) => gesture.release(e.pointerId, local(e), e.global, true);
	wrapper.onpointertap = (e) => gesture.plain('click', local(e), e.global);
	wrapper.onglobalpointermove = (e) => gesture.move(e.pointerId, local(e), e.global);
	wrapper.onpointerupoutside = (e) => gesture.release(e.pointerId, local(e), e.global, false);
	// Headless, nothing renders, so the world transforms the hit-test and `toLocal` read are
	// composed here, as a frame would.
	const settle = (parent: Container): void => {
		for (const child of parent.children) {
			child.updateLocalTransform();
			child.worldTransform.copyFrom(parent.worldTransform).append(child.localTransform);
			settle(child);
		}
	};
	settle(stage);
	const boundary = new EventBoundary(stage);
	const send = (type: string, x: number, y = 20): void => {
		const e = new FederatedPointerEvent(boundary);
		e.type = type;
		e.pointerId = 1;
		e.pointerType = 'mouse';
		e.button = 0;
		e.buttons = type === 'pointerdown' || type === 'pointermove' ? 1 : 0;
		e.global.set(x, y);
		e.screen.set(x, y);
		boundary.mapEvent(e);
	};
	send('pointermove', 120);
	send('pointerdown', 120);
	send('pointermove', 160);
	send('pointermove', 400, 100);
	send('pointerup', 400, 100);
	eq('a drag leaves the node, keeps tracking and ends off it (instance-space readings)', log, [
		'down@10,10/0,0',
		'dragStart@30,10/20,0',
		'drag@30,10/20,0',
		'drag@150,50/140,40',
		'dragEnd@150,50/140,40',
		'swipe@150,50/140,40',
	]);
	log.length = 0;
	send('pointermove', 400, 100);
	send('pointerdown', 120);
	send('pointerup', 121);
	eq('a tap on it is down, up, the swipe offer, then the click', log, [
		'down@10,10/0,0',
		'up@10.5,10/0.5,0',
		'swipe@10.5,10/0.5,0',
		'click@10.5,10/0,0',
	]);

	const view = source('packages/engine-layout/src/lib/LayoutNodeView.svelte');
	eq(
		'LayoutNodeView binds what this section wires (a move listener adds pointermove)',
		[
			'onpointerdown={(e) => gesture!.down(e.pointerId, pointerLocal(e), e.global)}',
			'onpointerup={(e) => gesture!.release(e.pointerId, pointerLocal(e), e.global, true)}',
			"onpointertap={(e) => gesture!.plain('click', pointerLocal(e), e.global)}",
			'onpointermove={hovers ? (e) => gesture!.hover(pointerLocal(e), e.global) : undefined}',
			'? (e) => gesture!.move(e.pointerId, pointerLocal(e), e.global)',
			'? (e) => gesture!.release(e.pointerId, pointerLocal(e), e.global, false)',
			'const pointerLocal = (e: FederatedPointerEvent) => listen!.local(e.global);',
		].every((binding) => view.includes(binding)),
		true,
	);
	eq(
		'…the new handlers only on a node listening for them; anything else gets today’s five (parity)',
		[
			"const hovers = !!listen && !!listeners?.some((l) => l.event === 'move');",
			"!!listeners?.some((l) => ['dragStart', 'drag', 'dragEnd', 'swipe'].includes(l.event));",
			'onglobalpointermove={tracks',
			'onpointerupoutside={releasesOff',
			'tracks ||\n\t\thovers ||',
		].every((binding) => view.includes(binding)),
		true,
	);
	eq(
		'…a node no Align Target moves keeps its own position (parity)',
		[
			'const alignParent = componentAlign?.targets(untrack(() => node.id))',
			'return at ? { x: at.x ?? anchored.x, y: at.y ?? anchored.y } : anchored;',
		].every((line) => view.includes(line)),
		true,
	);
	const instanceView = source('packages/engine-layout/src/lib/ComponentInstance.svelte');
	eq(
		'ComponentInstance maps the pointer into the instance’s space and provides Align Target only when it aligns (or hides an outer one)',
		[
			'local: (global) => instanceSpace.toLocal(global),',
			'const alignTargets = new Set(eventDispatcher && listened ? alignTargetIds(def) : []);',
			'} else if (getComponentAlign()) {',
		].every((line) => instanceView.includes(line)),
		true,
	);
}

// ---- 5. validation -----------------------------------------------------------------------------

const codes = (def: ComponentDef) =>
	E.validateComponentEvents(def).map((i) => `${i.code}:${i.level}`);
{
	const d = sliderDef();
	(d.root.children[0] as LayoutNode).on = [
		li('ok', 'drag', { kind: 'raise', event: 'moved', payload: { x: { pointer: 'x' } } }),
		li('bad', 'drag', {
			kind: 'raise',
			event: 'moved',
			payload: { x: { pointer: 'z' } } as unknown as Record<string, { pointer: 'x' }>,
		}),
		li('a1', 'drag', { kind: 'align', target: 'n_knob' }),
		li('a2', 'drag', { kind: 'align', target: 'nope' }),
		li('a3', 'drag', { kind: 'align', target: 'root' }),
		li(
			's1',
			'swipe',
			{ kind: 'set', input: 'lit', value: true },
			{ swipe: { direction: 'left', threshold: 5 } },
		),
		li(
			's2',
			'swipe',
			{ kind: 'set', input: 'lit', value: true },
			{
				swipe: { direction: 'diagonal', threshold: -1 },
			},
		),
	];
	d.stateMachine = {
		layers: [
			{
				id: 'L',
				entry: 's',
				states: [
					{
						id: 's',
						onEnter: [
							{ id: 'e', kind: 'raise', event: 'moved', payload: { dx: { pointer: 'dx' } } },
						],
					},
				],
				transitions: [],
			},
		],
	} as unknown as ComponentDef['stateMachine'];
	eq(
		'validation: a bad reading, a target outside the def or its root, a bad swipe, a pointer on a state',
		codes(d),
		[
			'raise-payload-pointer:error',
			'listener-align-target:error',
			'listener-align-target:error',
			'listener-swipe:error',
			'raise-payload-pointer:error',
		],
	);
}

// ---- 6. the normalizer and the editor ----------------------------------------------------------

{
	const stored = {
		...sliderDef(),
		root: {
			...sliderDef().root,
			children: [
				{
					id: 'n_track',
					kind: 'sprite',
					x: 0,
					y: 0,
					on: [
						{
							id: 'l1',
							event: 'drag',
							action: { kind: 'raise', event: 'moved', payload: { x: { pointer: 'x' } } },
						},
						{
							id: 'l2',
							event: 'dragStart',
							action: { kind: 'align', target: 'n_knob', preserveOffset: true, axis: 'x' },
						},
						{
							id: 'l3',
							event: 'swipe',
							swipe: { direction: 'up', threshold: 12 },
							action: { kind: 'set', input: 'lit', value: true },
						},
						{
							id: 'l4',
							event: 'click',
							swipe: { direction: 'up' },
							action: { kind: 'set', input: 'lit', value: true },
						},
						{ id: 'b1', event: 'drag', action: { kind: 'align', target: 'n_knob', axis: 'z' } },
						{ id: 'b2', event: 'drag', action: { kind: 'align', target: 'n_knob', snap: 4 } },
						{
							id: 'b3',
							event: 'drag',
							action: { kind: 'raise', event: 'moved', payload: { x: { pointer: 'speed' } } },
						},
						{
							id: 'b4',
							event: 'swipe',
							swipe: { direction: 'diagonal' },
							action: { kind: 'set', input: 'lit', value: true },
						},
						{
							id: 'b5',
							event: 'drag',
							action: { kind: 'align', target: 'n_knob', preserveOffset: false },
						},
					],
				},
				sliderDef().root.children[1],
			],
		},
	};
	const read = normalizeComponent(structuredClone(stored)).root.children[0] as LayoutNode;
	eq(
		'the normalizer reads the new events, pointer values, Align Target and the swipe filter',
		read.on,
		[
			{
				id: 'l1',
				event: 'drag',
				action: { kind: 'raise', event: 'moved', payload: { x: { pointer: 'x' } } },
			},
			{
				id: 'l2',
				event: 'dragStart',
				action: { kind: 'align', target: 'n_knob', preserveOffset: true, axis: 'x' },
			},
			{
				id: 'l3',
				event: 'swipe',
				action: { kind: 'set', input: 'lit', value: true },
				swipe: { direction: 'up', threshold: 12 },
			},
			{ id: 'l4', event: 'click', action: { kind: 'set', input: 'lit', value: true } },
		],
	);
	eq(
		'…a malformed one is unreadable whole, which the save puts back (keep-unknown)',
		(stored.root.children[0].on as unknown[])
			.filter(Rows.unreadable('id', Rows.readListener) as (r: unknown) => boolean)
			.map((r) => (r as { id: string }).id),
		['b1', 'b2', 'b3', 'b4', 'b5'],
	);
	eq(
		'the normalizer lists are the engine’s',
		[T.NODE_LISTENER_EVENTS.slice(5), T.LISTENER_ACTION_KINDS.at(-1), T.POINTER_PAYLOAD_FIELDS],
		[['move', 'dragStart', 'drag', 'dragEnd', 'swipe'], 'align', ['x', 'y', 'dx', 'dy']],
	);
}
{
	const d = sliderDef();
	const track = d.root.children[0] as LayoutNode;
	const l = Edit.addListener(track, d, [], 'swipe');
	Edit.setListenerKind(d, l, 'align', track.id);
	eq('editor: Align Target defaults to the listener’s own node', l.action, {
		kind: 'align',
		target: 'n_track',
	});
	Edit.setActionTarget(d, l.action, 'n_knob');
	if (l.action.kind === 'align') {
		Edit.setAlignOptions(l.action, { preserveOffset: true });
		Edit.setAlignOptions(l.action, { axis: 'y' });
	}
	eq('…retargeted, with its options', l.action, {
		kind: 'align',
		target: 'n_knob',
		preserveOffset: true,
		axis: 'y',
	});
	eq('…its label', Edit.actionLabel(l.action), 'align n_knob to the pointer');
	eq(
		'…targets: every node but the root',
		Edit.alignTargetsFor(d).map((n) => n.id),
		['n_track', 'n_knob'],
	);
	Edit.setSwipeFilter(l, { direction: 'left' });
	Edit.setSwipeFilter(l, { threshold: 25 });
	Edit.setSwipeFilter(l, { threshold: -3 });
	eq('…a swipe filter (a negative threshold clears it)', l.swipe, { direction: 'left' });
	eq('…which saves', Edit.unsavableRows(d), []);
	Edit.setListenerEvent(l, 'drag');
	eq('…and goes when the listener stops being a swipe', 'swipe' in l, false);
	eq(
		'…every event has a label',
		T.NODE_LISTENER_EVENTS.every((e) => !!Edit.EVENT_LABELS[e]),
		true,
	);
	const pointerRaise = Edit.addListener(track, d, [], 'drag');
	Edit.setListenerKind(d, pointerRaise, 'raise', track.id);
	if (pointerRaise.action.kind === 'raise')
		Edit.setRaisePayload(pointerRaise.action, 'x', { pointer: 'x' });
	eq('…a pointer payload saves', Edit.unsavableRows(d), []);
	(d.root.children[1] as LayoutNode).on = [li('x', 'drag', { kind: 'align', target: '' })];
	eq('…an Align Target with no node does not', Edit.unsavableRows(d), ['a listener on "n_knob"']);
}

// ---- 7. the board cell hit-test ----------------------------------------------------------------

const gameSource = source('packages/engine-game/src/game/gameState.svelte.ts');
const blockStart = gameSource.indexOf('\tconst boardGeometry = () => {');
const cellStart = gameSource.indexOf('\tconst getCellAt = (');
if (blockStart < 0 || cellStart < blockStart)
	throw new Error('could not locate the boardGeometry…getCellAt block in gameState.svelte.ts');
const blockEnd = gameSource.indexOf('\n\t};\n', cellStart);
const block = stripSliceTypes(
	'gameState.svelte.ts#boardGeometry…getCellAt',
	gameSource.slice(blockStart, blockEnd + '\n\t};\n'.length),
);
const constants = source('packages/engine-game/src/game/constants.ts');
const readConst = (name: string): number =>
	Number(new RegExp(`export const ${name} = ([\\d.]+);`).exec(constants)![1]);
const buildBoard = compileSlice({
	what: 'check-component-pointer-drag / gameState.svelte.ts#boardGeometry…getCellAt',
	names: [
		'SYMBOL_SIZE',
		'REEL_PADDING',
		'resolveReelGridFromNode',
		'resolveReelGridPerspective',
		'boardOverride',
		'deps',
	],
	body: `${block}\nreturn { getSymbolSeat, getCellAt, boardGeometry };`,
}) as (...args: unknown[]) => {
	getSymbolSeat(reel: number, row: number): { x: number; y: number; scale: number };
	getCellAt(x: number, y: number): { reel: number; row: number } | undefined;
	boardGeometry(): {
		columnExtraLocal: number;
		rowPitchLocal: number;
		cellWidthLocal: number;
		cellHeightLocal: number;
		symbolAlignX: number;
		symbolAlignY: number;
	};
};
const SYMBOL_SIZE = readConst('SYMBOL_SIZE');
const gridOf = (over: Record<string, number>) => ({
	x: 0,
	y: 0,
	cellSize: 120,
	cellWidth: 120,
	cellHeight: 120,
	gapX: 0,
	gapY: 0,
	reelPadding: 0.5,
	rowPadding: 0.5,
	symbolAlignX: 0.5,
	symbolAlignY: 0.5,
	boardNudgeX: 0,
	boardNudgeY: 0,
	overflowX: 0,
	overflowY: 0,
	...over,
});
const board = (
	grid: ReturnType<typeof gridOf> | null,
	reels: number,
	rows: number[],
	perspective?: { farScale: number; vanishX?: number },
) =>
	buildBoard(
		SYMBOL_SIZE,
		readConst('REEL_PADDING'),
		() => grid,
		(node: { perspective?: unknown } | null) => node?.perspective,
		{ node: grid || perspective ? { perspective } : null },
		{
			layout: { layoutType: () => 'desktop' },
			boardDimensions: () => ({ x: reels, y: Math.max(...rows) }),
			activeGrid: () => resolveGrid({ numReels: reels, numRows: rows }),
		},
	);
const LATTICES: [string, ReturnType<typeof board>, number[]][] = [];
const add = (
	name: string,
	grid: ReturnType<typeof gridOf> | null,
	reels: number,
	rows: number[],
	perspective?: { farScale: number; vanishX?: number },
) => LATTICES.push([name, board(grid, reels, rows, perspective), rows]);
add('no doc (the coded square lattice)', null, 5, [3, 3, 3, 3, 3]);
add(
	'gaps + non-square cells',
	gridOf({ cellWidth: 140, cellHeight: 100, gapX: 12, gapY: 6 }),
	6,
	[5, 5, 5, 5, 5, 5],
);
add(
	'off-centre leads + seat alignment',
	gridOf({ reelPadding: 0.3, rowPadding: 0.7, symbolAlignX: 0.2, symbolAlignY: 0.8 }),
	5,
	[4, 4, 4, 4, 4],
);
add(
	'a 7 × 6 match-3 board',
	gridOf({ cellSize: 96, cellWidth: 96, cellHeight: 96, gapX: 4, gapY: 4 }),
	7,
	[6, 6, 6, 6, 6, 6, 6],
);
add('stepped 3/4/5/4/3', gridOf({}), 5, [3, 4, 5, 4, 3]);
add('perspective', gridOf({ gapX: 8, gapY: 8 }), 5, [4, 4, 4, 4, 4], { farScale: 0.6 });
add(
	'perspective, aligned seats, a vanishing point',
	gridOf({ symbolAlignX: 0.35, symbolAlignY: 0.6 }),
	6,
	[5, 5, 5, 5, 5, 5],
	{ farScale: 0.75, vanishX: 200 },
);
for (const [name, b, rows] of LATTICES) {
	const misses: string[] = [];
	for (let reel = 0; reel < rows.length; reel++) {
		for (let row = 0; row < rows[reel]; row++) {
			const seat = b.getSymbolSeat(reel, row);
			const hit = b.getCellAt(seat.x, seat.y);
			if (hit?.reel !== reel || hit?.row !== row)
				misses.push(`${reel},${row}→${JSON.stringify(hit)}`);
		}
	}
	eq(`cell hit-test, ${name}: every seat is in its own cell`, misses, []);
	const first = b.getSymbolSeat(0, 0);
	const g = b.boardGeometry();
	eq(
		`cell hit-test, ${name}: off the board is no cell`,
		[
			b.getCellAt(first.x - (SYMBOL_SIZE + g.columnExtraLocal) * 4, first.y),
			b.getCellAt(first.x, first.y - g.rowPitchLocal * 6),
		],
		[undefined, undefined],
	);
}
{
	// A flat board's pitch boxes tile it: every point of a fine grid over the board hits exactly the
	// cell whose seat (alignment taken out) is nearest along each axis.
	const b = board(
		gridOf({ cellWidth: 130, cellHeight: 110, gapX: 10, gapY: 6, symbolAlignX: 0.3 }),
		5,
		[4, 4, 4, 4, 4],
	);
	const g = b.boardGeometry();
	const pitchX = SYMBOL_SIZE + g.columnExtraLocal;
	const c00 = b.getSymbolSeat(0, 0);
	const x0 = c00.x - (g.symbolAlignX - 0.5) * g.cellWidthLocal - pitchX / 2;
	const y0 = c00.y - (g.symbolAlignY - 0.5) * g.cellHeightLocal - g.rowPitchLocal / 2;
	const wrong: string[] = [];
	for (let fx = 0.01; fx < 5; fx += 0.07) {
		for (let fy = 0.01; fy < 4; fy += 0.07) {
			const hit = b.getCellAt(x0 + fx * pitchX, y0 + fy * g.rowPitchLocal);
			if (hit?.reel !== Math.floor(fx) || hit?.row !== Math.floor(fy))
				wrong.push(`${fx.toFixed(2)},${fy.toFixed(2)}`);
		}
	}
	eq(
		'cell hit-test: a flat board’s pitch boxes tile it (a gap belongs to the nearer cell)',
		wrong,
		[],
	);
}
{
	// Perspective: a point just inside the back row's narrower box is that cell, and the front row's
	// wider box reaches past where the back row's ends.
	const b = board(gridOf({}), 5, [4, 4, 4, 4, 4], { farScale: 0.5 });
	const back = b.getSymbolSeat(4, 0);
	const front = b.getSymbolSeat(4, 3);
	const half = (s: number) => (SYMBOL_SIZE * s) / 2;
	eq(
		'cell hit-test, perspective: the back row narrows with its seats, the front row does not',
		[
			b.getCellAt(back.x + half(back.scale) - 0.5, back.y),
			b.getCellAt(back.x + half(back.scale) + 0.5, back.y),
			b.getCellAt(front.x + half(front.scale) - 0.5, front.y),
		],
		[{ reel: 4, row: 0 }, undefined, { reel: 4, row: 3 }],
	);
}

// ---- 8. parity ---------------------------------------------------------------------------------

{
	const NEW = new Set(['move', 'dragStart', 'drag', 'dragEnd', 'swipe']);
	const offenders: string[] = [];
	const walk = (def: ComponentDef, n: LayoutNode): void => {
		for (const l of n.on ?? []) {
			if (NEW.has(l.event) || l.action.kind === 'align' || 'swipe' in l)
				offenders.push(`${def.id}/${n.id}`);
			if (
				l.action.kind === 'raise' &&
				Object.values(l.action.payload ?? {}).some((v) => typeof v === 'object' && 'pointer' in v)
			)
				offenders.push(`${def.id}/${n.id}`);
		}
		if (n.kind === 'container') n.children.forEach((c) => walk(def, c));
	};
	for (const def of BUILTIN_COMPONENTS) walk(def, def.root);
	eq('no built-in component uses the new events, pointer payloads or Align Target', offenders, []);
	eq(
		'the old five keep their place in the list (the editor’s picker order)',
		T.NODE_LISTENER_EVENTS.slice(0, 5),
		['down', 'up', 'enter', 'leave', 'click'],
	);
}

console.log(
	failures
		? `\n❌ component pointer drag: ${passes} passed, ${failures} failed`
		: `\n✅ component pointer drag: ${passes} passed, 0 failed`,
);
if (failures) process.exit(1);
