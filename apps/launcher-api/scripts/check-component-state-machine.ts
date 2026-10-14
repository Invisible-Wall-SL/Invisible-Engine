/**
 * Component state machines (Rive plan Phase 5) — inputs, values and the interpreter:
 *   pnpm --filter launcher-api check:component-state-machine
 *
 *  1. the signal → trigger FOLD (plan §12 #4): a def with only `signals` yields the same trigger
 *     inputs as one declaring them, every reader goes through `componentInputs`/`componentTriggers`,
 *     and the interface lists each layer's state as a value;
 *  2. the interpreter's semantics: entry on construction, triggers consumed once per evaluation,
 *     `any` first, `exitTime` on a held and on a looping state, bool/number conditions, blends,
 *     `exit`, the per-tick transition cap, a missing timeline that holds and is listed once;
 *  3. the player: a layer's slot placed by `drive`, cues at 0 and across a loop wrap, a later
 *     layer winning a node property, a `playOn` timeline and a layer coexisting (the most recently
 *     started wins the node), two instances independent, triggers scoped exactly as signals are;
 *  4. validation: every message the editor shows;
 *  5. parity: a def with no inputs and no state machine creates nothing new (source-scanned in
 *     `ComponentInstance.svelte` too);
 *  6. what saves: the normalizer keeps the new blocks and drops malformed rows;
 *  7. the ship chain (rule 8): a state machine's timeline that no Flow node and no `playOn` names
 *     is still exported and embedded, and the runtime registry resolves it by id;
 *  8. a pot built from pieces: a number condition compares against each placement's own param
 *     (`{lightAt}`), so one firecracker def lights bottom → top as the pot's share rises, fires on
 *     `potActivate` and goes dark once drained; `<=` / `>=`; the editor's light order.
 *
 * What it cannot prove: the Svelte wiring in `ComponentInstance.svelte` (ticker, bus, context) —
 * that is the owner's browser check.
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import type {
	CinematicDoc,
	ComponentDef,
	ComponentStateMachine,
	LayoutNode,
	SmLayer,
} from 'engine-layout';
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
		// `componentStorage` reaches these through modules it imports; none runs in this gate.
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

const L = await import('../../../packages/engine-layout/src/lib/componentTimelines.ts');
const I = await import('../../../packages/engine-layout/src/lib/componentInterface.ts');
const M = await import('../../../packages/engine-layout/src/lib/stateMachine.ts');
const { CONFIRM_DIALOG_DEF } =
	await import('../../../packages/engine-layout/src/lib/builtinComponents.ts');
const { cinematicKey } = await import('../src/lib/server/cinematicStorage.ts');
const { exportCinematics, loadAuthoredCinematics } =
	await import('../src/lib/server/cinematicExport.ts');
const { normalizeComponent } = await import('../src/lib/server/componentStorage.ts');
const S = await import('../src/lib/timeline/screenTimeline.ts');
const PP = await import('../../../packages/engine-layout/src/lib/potPieces.ts');

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
const r2 = (n: number | undefined): number | undefined =>
	n === undefined ? undefined : Math.round(n * 100) / 100;

// ---- fixtures ----------------------------------------------------------------------------------

const nodes: LayoutNode[] = [
	{ id: 'n_coin', kind: 'sprite', label: 'Coin', x: 0, y: 0 } as LayoutNode,
	{ id: 'n_glow', kind: 'sprite', label: 'Glow', x: 0, y: 0 } as LayoutNode,
];

/** A one-second component timeline on `Coin`: `y` -100→0 and `alpha` 0→1, a cue at 0.5. */
function timeline(
	id: string,
	opts: {
		playOn?: string;
		target?: string;
		channels?: Record<string, { time: number; value: number }[]>;
		cues?: { time: number; cue: string }[];
		duration?: number;
	} = {},
): CinematicDoc {
	return {
		...S.newComponentTimeline({ id, name: id, componentId: 'coin', playOn: opts.playOn }),
		duration: opts.duration ?? 1,
		stage: {
			sceneId: null,
			cast: [{ actorId: 'a', kind: 'node', target: opts.target ?? 'Coin', place: {} }],
		},
		tracks: [
			{
				id: 'p',
				kind: 'property',
				actorId: 'a',
				channels: opts.channels ?? {
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
			{ id: 'c', kind: 'cue', actorId: '', keys: opts.cues ?? [{ time: 0.5, cue: 'signal:half' }] },
		],
	} as unknown as CinematicDoc;
}

const idle = timeline('c_coin_idle', { channels: { alpha: [{ time: 0, value: 0.5 }] } });
const win = timeline('c_coin_win');
const glow = timeline('c_coin_glow', {
	target: 'Glow',
	channels: { x: [{ time: 0, value: 7 }] },
	cues: [{ time: 0, cue: 'fx:spark' }],
});
const durations = new Map([
	['c_coin_idle', 1],
	['c_coin_win', 1],
	['c_coin_glow', 1],
]);

const layer = (over: Partial<SmLayer> = {}): SmLayer => ({
	id: 'main',
	entry: 'idle',
	states: [
		{ id: 'idle', timeline: 'c_coin_idle', loop: true },
		{ id: 'win', timeline: 'c_coin_win' },
	],
	transitions: [
		{ id: 't_win', from: 'idle', to: 'win', conditions: [{ input: 'win', op: 'fired' }] },
		{ id: 't_back', from: 'win', to: 'idle', exitTime: 1 },
	],
	...over,
});
const machine = (...layers: SmLayer[]): ComponentStateMachine => ({ layers });
const inputs: ComponentDef['inputs'] = [
	{ id: 'win', kind: 'trigger' },
	{ id: 'big', kind: 'bool' },
	{ id: 'amount', kind: 'number', default: 0 },
];

// ---- 1. the fold -------------------------------------------------------------------------------

const legacy = { signals: [{ key: 'potWin', note: 'the pot pays' }, { key: 'enter' }] };
const declared = {
	inputs: [
		{ id: 'potWin', kind: 'trigger', note: 'the pot pays' },
		{ id: 'enter', kind: 'trigger' },
	],
} as Pick<ComponentDef, 'inputs'>;
eq(
	'a def with only signals reads as the same trigger inputs as one declaring them',
	I.componentInputs(legacy),
	I.componentInputs(declared),
);
eq('its triggers are the signal keys, in order', I.componentTriggers(legacy), ['potWin', 'enter']);
eq(
	'explicit inputs come first and a signal an input already names adds nothing',
	I.componentInputs({
		inputs: [
			{ id: 'amount', kind: 'number' },
			{ id: 'potWin', kind: 'trigger' },
		],
		signals: [{ key: 'potWin', note: 'dup' }, { key: 'late' }],
	}).map((i) => `${i.id}:${i.kind}`),
	['amount:number', 'potWin:trigger', 'late:trigger'],
);
eq('no inputs and no signals ⇒ an empty interface (parity)', I.componentInputs({}), []);
eq(
	'Animate offers enter, the triggers (signals folded in), then rig complete signals',
	S.componentTimelineSignals({
		inputs: [{ id: 'land', kind: 'trigger' }],
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
	['enter', 'land', 'potWin', 'introDone'],
);
eq(
	"Flow's projection of a built-in def's signals is unchanged by the fold",
	I.componentTriggers(CONFIRM_DIALOG_DEF),
	(CONFIRM_DIALOG_DEF.signals ?? []).map((s) => s.key),
);
eq(
	'the interface lists each layer’s state as a value, exit last',
	I.componentInterface({ signals: [{ key: 'win' }], stateMachine: machine(layer()) }),
	{
		inputs: [{ id: 'win', kind: 'trigger' }],
		events: [],
		values: [{ id: 'main.state', kind: 'state', layer: 'main', states: ['idle', 'win', 'exit'] }],
	},
);

// ---- 2. the interpreter ------------------------------------------------------------------------

{
	const r = new M.ComponentStateMachineRunner(machine(layer()), inputs, durations);
	eq('the entry state plays from the first frame', r.plays()[0], {
		layer: 'main',
		state: 'idle',
		time: 0,
		prevTime: 0,
		wrapped: false,
		entered: true,
		timeline: 'c_coin_idle',
	});
	eq('values report the state per layer', r.values(), { 'main.state': 'idle' });
	eq('it needs a first tick', r.needsTick(), true);
	r.advance(0.25);
	eq('a looping state keeps playing', [r.isPlaying(), r2(r.plays()[0].time)], [true, 0.25]);
	eq('an unknown trigger is ignored', r.fire('nope'), false);
	eq('a declared trigger is accepted', r.fire('win'), true);
	const step = r.advance(0.1);
	eq('the next evaluation takes the transition', step.fired, [
		{ layer: 'main', transition: 't_win', from: 'idle', to: 'win' },
	]);
	eq(
		'the new state starts at 0, entered',
		[r.plays()[0].state, r.plays()[0].time, r.plays()[0].entered],
		['win', 0, true],
	);
	eq('the trigger was consumed: it does not fire twice', r.advance(0.1).fired, []);
	eq('…and the step after entry is no longer "entered"', r.plays()[0].entered, false);
	let last = r.advance(0.1);
	for (let i = 0; i < 8; i++) last = r.advance(0.1);
	eq(
		'ten frames of 0.1 land on the end (float error snapped) and fire the exitTime-1 transition',
		last.fired.map((f) => f.transition),
		['t_back'],
	);
	eq('exitTime 1 is reached ⇒ back to idle', r.values(), { 'main.state': 'idle' });
	eq('and nothing is pending once it loops idle', r.needsTick(), true);
}
{
	// Exit time on a LOOPING state fires when the loop crosses the point, once per lap.
	const r = new M.ComponentStateMachineRunner(
		machine(
			layer({
				transitions: [
					{
						id: 't',
						from: 'idle',
						to: 'win',
						exitTime: 0.5,
						conditions: [{ input: 'big', op: '==', value: true }],
					},
				],
			}),
		),
		inputs,
		durations,
	);
	r.setInput('big', true);
	eq(
		'before the exit point the gate holds it',
		[r.advance(0.3).fired.length, r.stateOf('main')],
		[0, 'idle'],
	);
	eq(
		'crossing the exit point lets it go',
		[r.advance(0.3).fired.length, r.stateOf('main')],
		[1, 'win'],
	);
}
{
	// A loop that wraps reports it, and the exit point is crossed on the wrap too.
	const r = new M.ComponentStateMachineRunner(
		machine(
			layer({
				transitions: [
					{
						id: 't',
						from: 'idle',
						to: 'win',
						exitTime: 1,
						conditions: [{ input: 'big', op: '==' }],
					},
				],
			}),
		),
		inputs,
		durations,
	);
	for (let i = 0; i < 9; i++) r.advance(0.1);
	r.setInput('big', true);
	const before = r.plays()[0];
	eq(
		'a bool == with no value means true; not yet at the end',
		[before.state, r2(before.time)],
		['idle', 0.9],
	);
	r.advance(0.2);
	eq('the wrap crosses exitTime 1 and the transition fires', r.stateOf('main'), 'win');
}
{
	const r = new M.ComponentStateMachineRunner(
		machine(
			layer({ states: [{ id: 'idle', timeline: 'c_coin_idle', loop: true }], transitions: [] }),
		),
		inputs,
		durations,
	);
	for (let i = 0; i < 12; i++) r.advance(0.1);
	const play = r.plays()[0];
	eq(
		'a looping state wraps its time and says so',
		[r2(play.time), r2(play.prevTime), play.wrapped],
		[0.2, 0.1, false],
	);
	const wrapTick = new M.ComponentStateMachineRunner(
		machine(
			layer({ states: [{ id: 'idle', timeline: 'c_coin_idle', loop: true }], transitions: [] }),
		),
		inputs,
		durations,
	);
	for (let i = 0; i < 9; i++) wrapTick.advance(0.1);
	wrapTick.advance(0.2);
	const wrapped = wrapTick.plays()[0];
	eq(
		'…on the tick it wraps',
		[r2(wrapped.time), r2(wrapped.prevTime), wrapped.wrapped],
		[0.1, 0.9, true],
	);
}
{
	// Number conditions, `any` first, the per-tick cap, `exit`.
	const chain = layer({
		entry: 'idle',
		states: [
			{ id: 'idle', timeline: 'c_coin_idle' },
			{ id: 'a', timeline: 'c_coin_win' },
			{ id: 'b', timeline: 'c_coin_win' },
			{ id: 'c', timeline: 'c_coin_win' },
		],
		transitions: [
			{ id: 'any_c', from: 'any', to: 'c', conditions: [{ input: 'amount', op: '>', value: 100 }] },
			{ id: 'i_a', from: 'idle', to: 'a', conditions: [{ input: 'amount', op: '>', value: 0 }] },
			{ id: 'a_b', from: 'a', to: 'b' },
			{ id: 'b_a', from: 'b', to: 'a' },
			{ id: 'c_x', from: 'c', to: 'exit', conditions: [{ input: 'big', op: '!=', value: true }] },
		],
	});
	const r = new M.ComponentStateMachineRunner(machine(chain), inputs, durations);
	eq('a number input starts at its default', r.input('amount'), 0);
	r.setInput('amount', 5);
	const step = r.advance(0.1);
	eq(
		'an a⇄b ping-pong is capped per tick, so one tick never loops forever',
		step.fired.length,
		M.SM_MAX_TRANSITIONS_PER_TICK,
	);
	eq(
		'…and the chain the cap cut continues next tick',
		[r.needsTick(), r.advance(0.1).fired.length],
		[true, M.SM_MAX_TRANSITIONS_PER_TICK],
	);
	r.setInput('amount', 500);
	r.setInput('big', true);
	eq(
		'an any-state transition is checked before the current state’s',
		r.advance(0.1).fired.map((f) => f.transition),
		['any_c'],
	);
	eq('…and never re-enters the state the layer is in', r.advance(0.1).fired, []);
	r.setInput('big', false);
	eq(
		'a bool != against a value',
		r.advance(0.1).fired.map((f) => f.transition),
		['c_x'],
	);
	eq(
		'exit ends the layer: it drives nothing (the stretch it left is still reported once)',
		r.plays()[0],
		{
			layer: 'main',
			state: 'exit',
			time: 0,
			prevTime: 0,
			wrapped: false,
			entered: false,
			left: [{ timeline: 'c_coin_win', prevTime: 0.1, time: 0.2, wrapped: false, entered: false }],
		},
	);
	eq(
		'…takes no transition and needs no tick',
		[r.advance(0.1).fired.length, r.needsTick()],
		[0, false],
	);
	r.reset();
	eq(
		'reset re-enters the entry with the inputs kept',
		[r.stateOf('main'), r.input('amount')],
		['idle', 500],
	);
}
{
	// "Finish the loop, then play win": a trigger a transition leaving the current state reads
	// is held until that transition's exit time lets it go; one nothing reads is dropped.
	const r = new M.ComponentStateMachineRunner(
		machine(
			layer({
				transitions: [
					{
						id: 't',
						from: 'idle',
						to: 'win',
						exitTime: 1,
						conditions: [{ input: 'win', op: 'fired' }],
					},
					{ id: 'back', from: 'win', to: 'idle', exitTime: 1 },
				],
			}),
		),
		[...(inputs ?? []), { id: 'unread', kind: 'trigger' }],
		durations,
	);
	r.advance(0.3);
	r.fire('win');
	r.fire('unread');
	r.advance(0.1);
	eq(
		'the trigger waits on the exit time instead of being lost',
		[r.stateOf('main'), r.needsTick()],
		['idle', true],
	);
	for (let i = 0; i < 6; i++) r.advance(0.1);
	eq('…and fires when the loop wraps', r.stateOf('main'), 'win');
	eq('a held trigger is consumed by the transition that took it', r.advance(0.1).fired, []);
	r.fire('win');
	for (let i = 0; i < 12; i++) r.advance(0.1);
	eq(
		'a trigger no transition leaving the current state reads is dropped, not queued',
		r.stateOf('main'),
		'idle',
	);
}
{
	// The hold is narrow: only while a transition is blocked by its exit time ALONE.
	const held = (
		transitions: ReturnType<typeof layer>['transitions'],
		extra: ReturnType<typeof layer>['states'] = [],
	) =>
		new M.ComponentStateMachineRunner(
			machine(layer({ states: [...layer().states, ...extra], transitions })),
			[
				...(inputs ?? []),
				{ id: 'go', kind: 'trigger' },
				{ id: 'armed', kind: 'bool' },
				{ id: 'b', kind: 'trigger' },
			],
			durations,
		);
	const gated = held([
		{
			id: 't',
			from: 'idle',
			to: 'win',
			exitTime: 1,
			conditions: [
				{ input: 'go', op: 'fired' },
				{ input: 'armed', op: '==', value: true },
			],
		},
	]);
	gated.fire('go');
	for (let i = 0; i < 100; i++) gated.advance(0.1);
	gated.setInput('armed', true);
	for (let i = 0; i < 12; i++) gated.advance(0.1);
	eq(
		'a trigger blocked by another condition is not held: arming later does not fire it',
		gated.stateOf('main'),
		'idle',
	);
	const pair = held([
		{
			id: 't',
			from: 'idle',
			to: 'win',
			exitTime: 1,
			conditions: [
				{ input: 'go', op: 'fired' },
				{ input: 'b', op: 'fired' },
			],
		},
	]);
	pair.fire('go');
	for (let i = 0; i < 100; i++) pair.advance(0.1);
	pair.fire('b');
	for (let i = 0; i < 12; i++) pair.advance(0.1);
	eq(
		'two triggers must arrive in the same evaluation: the first is not kept for the second',
		pair.stateOf('main'),
		'idle',
	);
	const moved = held(
		[
			{
				id: 'aw',
				from: 'idle',
				to: 'win',
				exitTime: 1,
				conditions: [{ input: 'win', op: 'fired' }],
			},
			{ id: 'ab', from: 'idle', to: 'b', conditions: [{ input: 'armed', op: '==', value: true }] },
			{ id: 'by', from: 'b', to: 'win', conditions: [{ input: 'win', op: 'fired' }] },
		],
		[{ id: 'b', timeline: 'c_coin_win', loop: true }],
	);
	moved.fire('win');
	moved.advance(0.1);
	moved.setInput('armed', true);
	moved.advance(0.1);
	eq(
		'a state change drops what was held: the trigger kept for A does not fire B’s transition',
		moved.stateOf('main'),
		'b',
	);
	moved.advance(0.1);
	eq('…nor later', moved.stateOf('main'), 'b');
	const atRest = new M.ComponentStateMachineRunner(
		machine(
			layer({
				states: [
					{ id: 'idle', timeline: 'c_coin_idle', speed: 0 },
					{ id: 'win', timeline: 'c_coin_win' },
				],
				transitions: [
					{
						id: 't',
						from: 'idle',
						to: 'win',
						exitTime: 1,
						conditions: [{ input: 'go', op: 'fired' }],
					},
				],
			}),
		),
		[{ id: 'go', kind: 'trigger' }],
		durations,
	);
	atRest.fire('go');
	atRest.advance(0.1);
	eq(
		'a resting state holds nothing, so it needs no tick',
		[atRest.stateOf('main'), atRest.needsTick()],
		['idle', false],
	);
	// A held trigger satisfies only the transition it is held for.
	const sibling = held(
		[
			{
				id: 'w',
				from: 'idle',
				to: 'win',
				exitTime: 1,
				conditions: [{ input: 'win', op: 'fired' }],
			},
			{
				id: 'bw',
				from: 'idle',
				to: 'b',
				conditions: [
					{ input: 'win', op: 'fired' },
					{ input: 'armed', op: '==', value: true },
				],
			},
		],
		[{ id: 'b', timeline: 'c_coin_win' }],
	);
	sibling.fire('win');
	sibling.advance(0.1);
	for (let i = 0; i < 4; i++) sibling.advance(0.1);
	sibling.setInput('armed', true);
	sibling.advance(0.1);
	eq(
		'a win held for idle → win does not fire the sibling fired win && big when big arrives later',
		sibling.stateOf('main'),
		'idle',
	);
	for (let i = 0; i < 6; i++) sibling.advance(0.1);
	eq('…it fires its own transition when the loop ends', sibling.stateOf('main'), 'win');
	const ab = held(
		[
			{ id: 'w', from: 'idle', to: 'win', exitTime: 1, conditions: [{ input: 'go', op: 'fired' }] },
			{
				id: 'x',
				from: 'idle',
				to: 'b',
				conditions: [
					{ input: 'go', op: 'fired' },
					{ input: 'b', op: 'fired' },
				],
			},
		],
		[{ id: 'b', timeline: 'c_coin_win' }],
	);
	ab.fire('go');
	ab.advance(0.1);
	for (let i = 0; i < 7; i++) ab.advance(0.1);
	ab.fire('b');
	ab.advance(0.1);
	eq(
		'a go held for idle → win does not pair with a b that arrives 0.8 s later',
		ab.stateOf('main'),
		'idle',
	);
}
{
	// A missing timeline never throws: the state holds, its exit gate is open, listed once.
	const r = new M.ComponentStateMachineRunner(
		machine(
			layer({
				states: [
					{ id: 'idle', timeline: 'c_coin_idle', loop: true },
					{ id: 'win', timeline: 'c_coin_gone' },
				],
				transitions: [
					{ id: 't', from: 'idle', to: 'win', conditions: [{ input: 'win', op: 'fired' }] },
					{ id: 'back', from: 'win', to: 'idle', exitTime: 1 },
				],
			}),
		),
		inputs,
		durations,
	);
	eq('the missing timeline is listed once', r.missingTimelines, ['c_coin_gone']);
	r.fire('win');
	eq(
		'the state is entered, and its exit-time gate is open, so the layer moves on at once',
		r.advance(0.1).fired.map((f) => f.transition),
		['t', 'back'],
	);
	const held = new M.ComponentStateMachineRunner(
		machine(
			layer({
				entry: 'win',
				states: [{ id: 'win', timeline: 'c_coin_gone' }],
				transitions: [],
			}),
		),
		inputs,
		durations,
	);
	eq(
		'a held state plays nothing and needs no tick',
		[held.plays()[0].state, held.plays()[0].timeline, held.isPlaying()],
		['win', undefined, false],
	);
}
{
	// Blends.
	const r = new M.ComponentStateMachineRunner(
		machine(
			layer({
				transitions: [
					{
						id: 't',
						from: 'idle',
						to: 'win',
						conditions: [{ input: 'win', op: 'fired' }],
						blend: 200,
					},
				],
			}),
		),
		inputs,
		durations,
	);
	r.advance(0.4);
	r.fire('win');
	r.advance(0.1);
	eq('entering with a blend remembers the pose left, frozen', r.plays()[0].from, {
		time: 0.5,
		progress: 0,
		timeline: 'c_coin_idle',
	});
	r.advance(0.1);
	eq('the blend progresses by wall time', r2(r.plays()[0].from?.progress), 0.5);
	r.advance(0.1);
	eq('…and is gone once complete', r.plays()[0].from, undefined);
	eq(
		'blendNodeSamples: offsets from 0, factors from 1, steps at half way',
		M.blendNodeSamples({ x: 10, alpha: 0, frame: 1 }, { y: 4, scaleX: 2, frame: 3 }, 0.5),
		{ x: 5, y: 2, scaleX: 1.5, alpha: 0.5, frame: 3 },
	);
	eq(
		'tint eases per colour channel',
		M.blendNodeSamples({ tint: 0x000000 }, { tint: 0xff00ff }, 0.5).tint,
		0x800080,
	);
}

// ---- 3. the player -----------------------------------------------------------------------------

{
	const player = new L.ComponentTimelinePlayer([idle, win, glow], nodes);
	eq('the player binds every timeline’s nodes', [...player.drivenNodes().keys()].sort(), [
		'n_coin',
		'n_glow',
	]);
	const r = new M.ComponentStateMachineRunner(machine(layer()), inputs, durations);
	const apply = (): { cue: string; timeline: string }[] =>
		r.plays().flatMap((play, i) => player.drive(play.layer, i, play));
	apply();
	eq('the entry state drives its node from the first frame', player.sample('n_coin'), {
		alpha: 0.5,
	});
	eq(
		'a node no layer keys samples nothing (renders as authored)',
		player.sample('n_glow'),
		undefined,
	);
	r.fire('win');
	r.advance(0.1);
	apply();
	eq('a transition restarts the slot on the new timeline', player.drivenSlot('main'), {
		timeline: 'c_coin_win',
		time: 0,
	});
	eq('…and the node follows it', player.sample('n_coin'), { y: -100, alpha: 0 });
	let cues: { cue: string; timeline: string }[] = [];
	for (let i = 0; i < 5; i++) {
		r.advance(0.1);
		cues.push(...apply());
	}
	eq('cues a layer’s timeline crosses are reported once, with the timeline', cues, [
		{ cue: 'signal:half', timeline: 'c_coin_win' },
	]);
	eq('the layer’s playhead advanced', r2(player.drivenSlot('main')?.time), 0.5);
}
{
	// Cues at 0 fire on entry; a loop wrap fires the end and then the start.
	const player = new L.ComponentTimelinePlayer([glow], nodes);
	const looping = machine({
		id: 'fx',
		entry: 'g',
		states: [{ id: 'g', timeline: 'c_coin_glow', loop: true }],
		transitions: [],
	});
	const r = new M.ComponentStateMachineRunner(looping, [], durations);
	eq('a cue at 0 fires when the state is entered', player.drive('fx', 0, r.plays()[0]), [
		{ cue: 'fx:spark', timeline: 'c_coin_glow' },
	]);
	for (let i = 0; i < 9; i++) {
		r.advance(0.1);
		player.drive('fx', 0, r.plays()[0]);
	}
	r.advance(0.2);
	eq('…and again when the loop wraps', player.drive('fx', 0, r.plays()[0]), [
		{ cue: 'fx:spark', timeline: 'c_coin_glow' },
	]);
	r.advance(0.1);
	eq('but not on an ordinary step', player.drive('fx', 0, r.plays()[0]), []);
	player.drive('fx', 0, { ...r.plays()[0], state: 'exit', timeline: undefined });
	eq('an exited layer’s slot drives nothing', player.sample('n_glow'), undefined);
}
{
	// Two layers on one node: the later layer wins each property both key; a property only the
	// first keys stays.
	const alphaOnly = timeline('c_coin_alpha', { channels: { alpha: [{ time: 0, value: 0.25 }] } });
	const yOnly = timeline('c_coin_y', {
		channels: { y: [{ time: 0, value: 9 }], alpha: [{ time: 0, value: 1 }] },
	});
	const player = new L.ComponentTimelinePlayer([alphaOnly, yOnly], nodes);
	const two = machine(
		{ id: 'l1', entry: 's', states: [{ id: 's', timeline: 'c_coin_y' }], transitions: [] },
		{ id: 'l2', entry: 's', states: [{ id: 's', timeline: 'c_coin_alpha' }], transitions: [] },
	);
	const r = new M.ComponentStateMachineRunner(
		two,
		[],
		new Map([
			['c_coin_alpha', 1],
			['c_coin_y', 1],
		]),
	);
	r.plays().forEach((play, i) => player.drive(play.layer, i, play));
	eq('layers merge per property, the later layer winning', player.sample('n_coin'), {
		y: 9,
		alpha: 0.25,
	});
}
{
	// A `playOn` timeline and a layer on one node: the most recently started wins the node.
	const player = new L.ComponentTimelinePlayer(
		[idle, timeline('c_coin_pop', { playOn: 'enter' })],
		nodes,
	);
	const r = new M.ComponentStateMachineRunner(
		machine(
			layer({
				states: [
					{ id: 'idle', timeline: 'c_coin_idle', loop: true },
					{ id: 'win', timeline: 'c_coin_idle' },
				],
			}),
		),
		inputs,
		durations,
	);
	const apply = (): void => void r.plays().forEach((play, i) => player.drive(play.layer, i, play));
	apply();
	eq('the machine’s idle shows', player.sample('n_coin'), { alpha: 0.5 });
	player.trigger('enter');
	eq('a playOn timeline started after it wins the node', player.sample('n_coin'), {
		y: -100,
		alpha: 0,
	});
	r.advance(0.1);
	apply();
	eq('…and keeps it while the layer merely advances', player.sample('n_coin')?.y, -100);
	r.fire('win');
	r.advance(0.1);
	apply();
	eq('the machine’s next state change takes the node back', player.sample('n_coin'), {
		alpha: 0.5,
	});
	eq('the playOn timeline still plays on its own clock', player.isPlaying(), true);
	player.trigger('enter');
	eq('started again, it wins again', player.sample('n_coin')?.y, -100);
	player.advance(1);
	eq(
		'once it has ended, the idle layer takes the node back (pop-in, then idle)',
		[player.isPlaying(), player.sample('n_coin')],
		[false, { alpha: 0.5 }],
	);
	{
		const alone = new L.ComponentTimelinePlayer(
			[timeline('c_coin_pop', { playOn: 'enter', target: 'Glow' })],
			nodes,
		);
		alone.trigger('enter');
		alone.advance(1);
		eq(
			'a node no layer drives keeps holding the finished pop-in (4b)',
			[alone.drivenNodes().has('n_glow'), alone.sample('n_glow')],
			[true, { y: 0, alpha: 1 }],
		);
	}
}
{
	// A blend from the pose left: half way between idle's alpha 0.5 and win's first frame.
	const player = new L.ComponentTimelinePlayer([idle, win], nodes);
	const r = new M.ComponentStateMachineRunner(
		machine(
			layer({
				transitions: [
					{
						id: 't',
						from: 'idle',
						to: 'win',
						conditions: [{ input: 'win', op: 'fired' }],
						blend: 200,
					},
				],
			}),
		),
		inputs,
		durations,
	);
	const apply = (): void => void r.plays().forEach((play, i) => player.drive(play.layer, i, play));
	apply();
	r.fire('win');
	r.advance(0.1);
	r.advance(0.1);
	apply();
	const s = player.sample('n_coin');
	eq(
		'a blending layer mixes the pose it left into the new timeline',
		[r2(s?.alpha), r2(s?.y)],
		[0.3, -45],
	);
}
{
	// Two instances run independently, and triggers are scoped exactly as signals are: an instance
	// fires its runner only for a fire its scope hears (the `scopeMatches` rule `ComponentInstance`
	// applies to every signal).
	const instance = (scopeValue: string) => {
		const scope = scopeOf('pot', scopeValue);
		const r = new M.ComponentStateMachineRunner(machine(layer()), inputs, durations);
		return {
			runner: r,
			fire: (signal: string, firedScope?: string) => {
				if (scopeMatches(scope, firedScope)) r.fire(signal);
			},
		};
	};
	const red = instance('red');
	const blue = instance('blue');
	red.fire('win', scopeOf('pot', 'red'));
	blue.fire('win', scopeOf('pot', 'red'));
	red.runner.advance(0.1);
	blue.runner.advance(0.1);
	eq('the red instance heard its own fire and moved', red.runner.stateOf('main'), 'win');
	eq('the blue instance did not hear red and stays', blue.runner.stateOf('main'), 'idle');
	red.runner.advance(0.1);
	blue.fire('win');
	blue.runner.advance(0.1);
	eq('an unscoped fire reaches blue too', blue.runner.stateOf('main'), 'win');
	eq('…without touching red’s playhead', r2(red.runner.plays()[0].time), 0.1);
}

{
	// The cues a leaving state crossed on the tick it was left still fire: a one-shot whose
	// `signal:done` sits at its very end, left by a "back to idle" transition on that frame.
	const done = timeline('c_coin_done', { cues: [{ time: 1, cue: 'signal:done' }] });
	const player = new L.ComponentTimelinePlayer([idle, done], nodes);
	const r = new M.ComponentStateMachineRunner(
		machine(
			layer({
				states: [
					{ id: 'idle', timeline: 'c_coin_idle', loop: true },
					{ id: 'win', timeline: 'c_coin_done' },
				],
				transitions: [
					{ id: 't', from: 'idle', to: 'win', conditions: [{ input: 'win', op: 'fired' }] },
					{ id: 'back', from: 'win', to: 'idle', exitTime: 1 },
				],
			}),
		),
		inputs,
		new Map([...durations, ['c_coin_done', 1]]),
	);
	const apply = (): { cue: string; timeline: string }[] =>
		r.plays().flatMap((play, i) => player.drive(play.layer, i, play));
	apply();
	r.fire('win');
	r.advance(0.1);
	apply();
	const cues: { cue: string; timeline: string }[] = [];
	for (let i = 0; i < 12; i++) {
		r.advance(0.1);
		cues.push(...apply());
	}
	eq(
		'…the cue at the end fires on the frame the transition leaves the state',
		[cues, r.stateOf('main')],
		[[{ cue: 'signal:done', timeline: 'c_coin_done' }], 'idle'],
	);
	// The same cue at the end of a one-shot left for Exit, and for a state whose timeline is missing.
	for (const [name, to, extra] of [
		['exit', 'exit', []],
		['a missing timeline', 'gone', [{ id: 'gone', timeline: 'c_coin_gone' }]],
	] as const) {
		const rr = new M.ComponentStateMachineRunner(
			machine(
				layer({
					entry: 'win',
					states: [{ id: 'win', timeline: 'c_coin_done' }, ...extra],
					transitions: [{ id: 'out', from: 'win', to, exitTime: 1 }],
				}),
			),
			inputs,
			new Map([...durations, ['c_coin_done', 1]]),
		);
		const pl = new L.ComponentTimelinePlayer([done], nodes);
		const fired: string[] = [];
		pl.drive('main', 0, rr.plays()[0]);
		for (let i = 0; i < 12; i++) {
			rr.advance(0.1);
			fired.push(...pl.drive('main', 0, rr.plays()[0]).map((x) => x.cue));
		}
		eq(
			`…and once when the state is left for ${name}`,
			[fired, rr.stateOf('main'), pl.drivenSlot('main')],
			[['signal:done'], to, undefined],
		);
	}
	// A fast state: the slot never seeks, so a big step still crosses its cues.
	const fast = new M.ComponentStateMachineRunner(
		machine(
			layer({
				entry: 'win',
				states: [{ id: 'win', timeline: 'c_coin_win', speed: 3 }],
				transitions: [],
			}),
		),
		inputs,
		durations,
	);
	const fastPlayer = new L.ComponentTimelinePlayer([win], nodes);
	fastPlayer.drive('main', 0, fast.plays()[0]);
	fast.advance(0.1);
	fast.advance(0.1);
	eq(
		'a speed-3 state at a 100 ms frame still fires the cue it crossed',
		fastPlayer.drive('main', 0, fast.plays()[0]),
		[{ cue: 'signal:half', timeline: 'c_coin_win' }],
	);
}
{
	// At rest: speed 0, a negative speed, a zero-duration timeline, NaN or negative dt.
	const rest = (over: Partial<ReturnType<typeof layer>['states'][number]>, dur = 1) =>
		new M.ComponentStateMachineRunner(
			machine(
				layer({
					entry: 'win',
					states: [{ id: 'win', timeline: 'c_coin_win', ...over }],
					transitions: [],
				}),
			),
			inputs,
			new Map([['c_coin_win', dur]]),
		);
	for (const [name, r] of [
		['speed 0', rest({ speed: 0 })],
		['a negative speed', rest({ speed: -1, loop: true })],
		['a zero-duration loop', rest({ loop: true }, 0)],
	] as const) {
		r.advance(0.1);
		eq(
			`${name} is at rest: nothing plays, no tick is needed`,
			[r.isPlaying(), r.needsTick(), r.plays()[0].time],
			[false, false, 0],
		);
	}
	const r = rest({});
	r.advance(Number.NaN);
	r.advance(-1);
	eq('a NaN or negative dt moves nothing', r.plays()[0].time, 0);
}
{
	// Interrupting a blend leaves from the pose on screen, not from the previous timeline alone.
	const a = timeline('c_coin_a', { channels: { alpha: [{ time: 0, value: 0 }] } });
	const b = timeline('c_coin_b', { channels: { alpha: [{ time: 0, value: 1 }] } });
	const c = timeline('c_coin_c', { channels: { alpha: [{ time: 0, value: 1 }] } });
	const player = new L.ComponentTimelinePlayer([a, b, c], nodes);
	const r = new M.ComponentStateMachineRunner(
		machine(
			layer({
				entry: 'a',
				states: [
					{ id: 'a', timeline: 'c_coin_a' },
					{ id: 'b', timeline: 'c_coin_b' },
					{ id: 'c', timeline: 'c_coin_c' },
				],
				transitions: [
					{ id: 'ab', from: 'a', to: 'b', conditions: [{ input: 'win', op: 'fired' }], blend: 200 },
					{ id: 'bc', from: 'b', to: 'c', conditions: [{ input: 'big', op: '==' }], blend: 1000 },
				],
			}),
		),
		inputs,
		new Map([
			['c_coin_a', 1],
			['c_coin_b', 1],
			['c_coin_c', 1],
		]),
	);
	const apply = (): void => void r.plays().forEach((play, i) => player.drive(play.layer, i, play));
	apply();
	r.fire('win');
	r.advance(0.1);
	apply();
	r.advance(0.1);
	apply();
	eq('half way through a → b the pose is the mix', r2(player.sample('n_coin')?.alpha), 0.5);
	r.setInput('big', true);
	r.advance(0.001);
	apply();
	eq(
		'interrupted by b → c, the first frame leaves from that mix (no jump to 1)',
		r2(player.sample('n_coin')?.alpha),
		0.5,
	);
	for (let i = 0; i < 10; i++) r.advance(0.1);
	apply();
	eq('…and arrives at c', player.sample('n_coin')?.alpha, 1);
	// A same-tick chain a → b → c with a blend on the last hop leaves from a's pose, not b's 0.
	const chain = new M.ComponentStateMachineRunner(
		machine(
			layer({
				entry: 'a',
				states: [
					{ id: 'a', timeline: 'c_coin_a' },
					{ id: 'b', timeline: 'c_coin_b' },
					{ id: 'c', timeline: 'c_coin_c' },
				],
				transitions: [
					{ id: 'ab', from: 'a', to: 'b', conditions: [{ input: 'win', op: 'fired' }] },
					{ id: 'bc', from: 'b', to: 'c', blend: 1000 },
				],
			}),
		),
		inputs,
		new Map([
			['c_coin_a', 1],
			['c_coin_b', 1],
			['c_coin_c', 1],
		]),
	);
	const a6 = timeline('c_coin_a', { channels: { alpha: [{ time: 0, value: 0.6 }] } });
	const chainPlayer = new L.ComponentTimelinePlayer([a6, b, c], nodes);
	const applyChain = (): void =>
		void chain.plays().forEach((play, i) => chainPlayer.drive(play.layer, i, play));
	applyChain();
	chain.fire('win');
	chain.advance(0.1);
	applyChain();
	eq(
		'a → b → c in one tick: the blend leaves from a’s on-screen pose (0.6), not b’s first frame',
		[chain.stateOf('main'), r2(chainPlayer.sample('n_coin')?.alpha)],
		['c', 0.6],
	);
	// Ten thousand interruptions: the frozen pose is flat, so nothing nests or overflows.
	const flip = new M.ComponentStateMachineRunner(
		machine(
			layer({
				entry: 'a',
				states: [
					{ id: 'a', timeline: 'c_coin_a', loop: true },
					{ id: 'b', timeline: 'c_coin_b', loop: true },
				],
				transitions: [
					{
						id: 'ab',
						from: 'a',
						to: 'b',
						conditions: [{ input: 'win', op: 'fired' }],
						blend: 1000,
					},
					{
						id: 'ba',
						from: 'b',
						to: 'a',
						conditions: [{ input: 'win', op: 'fired' }],
						blend: 1000,
					},
				],
			}),
		),
		inputs,
		new Map([
			['c_coin_a', 1],
			['c_coin_b', 1],
		]),
	);
	const flipPlayer = new L.ComponentTimelinePlayer([a, b], nodes);
	for (let i = 0; i < 10_000; i++) {
		flip.fire('win');
		flip.advance(0.01);
		flip.plays().forEach((play, n) => flipPlayer.drive(play.layer, n, play));
	}
	const after = flipPlayer.sample('n_coin')?.alpha;
	eq(
		'10,000 interrupted blends still sample (no nesting, no stack overflow)',
		typeof after === 'number' && after >= 0 && after <= 1,
		true,
	);
}
{
	// A state timeline reused from another component keeps its playOn there, not here.
	const foreign = {
		...timeline('c_gem_pop', { playOn: 'enter' }),
		host: { kind: 'component', componentId: 'gem' },
	} as CinematicDoc;
	L.registerComponentTimelines([timeline('c_coin_pop', { playOn: 'enter' }), idle, foreign]);
	const bound = L.instanceTimelineDocs(
		'coin',
		machine(
			layer({
				states: [
					{ id: 'idle', timeline: 'c_coin_idle' },
					{ id: 'win', timeline: 'c_gem_pop' },
				],
			}),
		),
	);
	eq(
		'an instance binds its playOn timelines, then the state timelines it lacks — the foreign one without its playOn',
		bound.docs.map((d) => [d.id, d.playOn ?? null]),
		[
			['c_coin_pop', 'enter'],
			['c_coin_idle', null],
			['c_gem_pop', null],
		],
	);
	eq(
		'…so the player never plays it as a free timeline on that signal',
		new L.ComponentTimelinePlayer(bound.docs, nodes).signals(),
		['enter'],
	);
	eq(
		'…and the runner gets every state timeline’s duration',
		[...bound.durations.keys()],
		['c_coin_idle', 'c_gem_pop'],
	);
	L.registerComponentTimelines([]);
}

// ---- 4. validation -----------------------------------------------------------------------------

{
	const codes = (
		def: Pick<ComponentDef, 'inputs' | 'signals' | 'stateMachine'>,
		ids = ['c_coin_idle', 'c_coin_win'],
	) => M.validateStateMachine(def, ids).map((i) => `${i.level}:${i.code}`);
	eq('a sound machine validates clean', codes({ inputs, stateMachine: machine(layer()) }), []);
	eq(
		'a state naming a missing timeline',
		codes({ inputs, stateMachine: machine(layer()) }, ['c_coin_idle']),
		['error:state-timeline-missing'],
	);
	eq('a layer with no entry', codes({ inputs, stateMachine: machine(layer({ entry: '' })) }), [
		'error:layer-no-entry',
	]);
	eq(
		'an entry that is not a state',
		codes({ inputs, stateMachine: machine(layer({ entry: 'nope' })) }),
		['error:layer-entry-unknown'],
	);
	eq(
		'a transition to or from an unknown state',
		codes({
			inputs,
			stateMachine: machine(layer({ transitions: [{ id: 'x', from: 'ghost', to: 'spirit' }] })),
		}),
		['error:transition-from-unknown', 'error:transition-to-unknown', 'warning:state-unreachable'],
	);
	eq(
		'a condition on an unknown input, and an op the kind cannot take',
		codes({
			inputs,
			stateMachine: machine(
				layer({
					transitions: [
						{
							id: 'x',
							from: 'idle',
							to: 'win',
							conditions: [
								{ input: 'nope', op: 'fired' },
								{ input: 'big', op: '<', value: 1 },
								{ input: 'win', op: '==' },
							],
						},
					],
				}),
			),
		}),
		['error:condition-input-unknown', 'error:condition-op-mismatch', 'error:condition-op-mismatch'],
	);
	eq(
		'an unreachable exit (and state) warns',
		codes({
			inputs,
			stateMachine: machine(
				layer({
					states: [...layer().states, { id: 'lost', timeline: 'c_coin_win' }],
					transitions: [...layer().transitions, { id: 'x', from: 'lost', to: 'exit' }],
				}),
			),
		}),
		['warning:state-unreachable', 'warning:state-unreachable'],
	);
	eq(
		'an any transition reaches its target',
		codes({
			inputs,
			stateMachine: machine(
				layer({
					transitions: [
						{ id: 'x', from: 'any', to: 'win', conditions: [{ input: 'win', op: 'fired' }] },
					],
				}),
			),
		}),
		[],
	);
	eq(
		'a duplicate layer id and a speed that is not above 0',
		codes({
			inputs,
			stateMachine: machine(
				layer(),
				layer({ states: [{ id: 'idle', timeline: 'c_coin_idle', speed: 0 }], transitions: [] }),
			),
		}),
		['error:layer-duplicate', 'error:state-speed-invalid'],
	);
	eq(
		'a signal-only def is a valid input source for conditions',
		codes({ signals: [{ key: 'win' }], stateMachine: machine(layer()) }),
		[],
	);
	eq(
		'reserved ids, duplicates, a state with no timeline, an exit time out of range',
		codes({
			inputs: [...(inputs ?? []), { id: 'win', kind: 'bool' }],
			stateMachine: machine(
				layer({
					states: [
						{ id: 'idle', timeline: 'c_coin_idle' },
						{ id: 'idle', timeline: '' },
						{ id: 'any', timeline: 'c_coin_win' },
					],
					transitions: [{ id: 't', from: 'idle', to: 'nowhere', exitTime: 2 }],
				}),
			),
		}),
		[
			'error:input-duplicate',
			'error:state-duplicate',
			'error:state-no-timeline',
			'error:state-reserved-id',
			'error:transition-to-unknown',
			'warning:exit-time-out-of-range',
			'warning:state-unreachable',
		],
	);
}

// ---- 5. parity ---------------------------------------------------------------------------------

L.registerComponentTimelines([timeline('c_coin_pop', { playOn: 'enter' }), idle]);
eq(
	'the registry still lists only playOn timelines per component',
	L.componentTimelinesFor('coin').map((d) => d.id),
	['c_coin_pop'],
);
eq('no state machine ⇒ no timelines to bind', L.stateMachineTimelines(undefined), {
	docs: [],
	durations: new Map(),
});
eq(
	'a state machine resolves its timelines by id, missing ones absent',
	L.stateMachineTimelines(machine(layer())).docs.map((d) => d.id),
	['c_coin_idle'],
);
{
	const src = readFileSync(
		new URL('../../../packages/engine-layout/src/lib/ComponentInstance.svelte', import.meta.url),
		'utf8',
	);
	eq(
		'the instance builds a runner only for a def with a state machine',
		/const stateMachine =\s*allowed && def\?\.stateMachine\?\.layers\?\.length/.test(src),
		true,
	);
	eq(
		'…takes the ticker only with a player or a runner',
		/timelinePlayer \|\| stateMachineRunner\s*\? getContextApp\(\)\.stateApp\.pixiApplication\?\.ticker/.test(
			src,
		),
		true,
	);
	eq(
		'…ignores every trigger until the instance is visible, and a fire on that first visible frame starts the machine',
		/if \(!stateMachineStarted\) \{\s*if \(!selfVisible\) return;\s*startStateMachine\(\);/.test(
			src,
		),
		true,
	);
	eq(
		'…and feeds triggers off the same per-instance bus every signal records on',
		/firedSignals\[signal\][\s\S]*stateMachineRunner\.fire\(signal\)/.test(src),
		true,
	);
}

// ---- 6. what saves -----------------------------------------------------------------------------

{
	const saved = normalizeComponent({
		id: 'coin',
		name: 'Coin',
		version: 1,
		scope: 'project',
		category: 'ui',
		root: { id: 'root', kind: 'container', x: 0, y: 0, children: [] },
		signals: [{ key: 'potWin' }],
		inputs: [
			{ id: 'win', kind: 'trigger' },
			{ id: 'amount', kind: 'number', default: 3, source: 'winAmount' },
			{ id: 'big', kind: 'bool', default: true },
			{ id: 'later', kind: 'colour' },
			{ id: '', kind: 'bool' },
		],
		stateMachine: machine(
			layer({
				transitions: [
					...layer().transitions,
					{
						id: 'bad',
						from: 'idle',
						to: 'win',
						conditions: [
							{ input: 'win', op: 'fired' },
							{ input: 'x', op: '~' },
						],
					} as never,
				],
			}),
		),
	} as unknown as ComponentDef);
	eq('signals stay as they were (nothing migrated)', saved.signals, [{ key: 'potWin' }]);
	eq(
		'inputs keep their kind, default and source; an unknown kind or empty id is dropped',
		saved.inputs,
		[
			{ id: 'win', kind: 'trigger' },
			{ id: 'amount', kind: 'number', default: 3, source: 'winAmount' },
			{ id: 'big', kind: 'bool', default: true },
		],
	);
	eq(
		'the state machine keeps its layers, states and transitions',
		saved.stateMachine?.layers[0].states,
		layer().states,
	);
	eq(
		'…dropping a transition WHOLE when one of its conditions is malformed (never widening it)',
		saved.stateMachine?.layers[0].transitions.map((t) => t.id),
		['t_win', 't_back'],
	);
	{
		const twice = normalizeComponent({
			id: 'c',
			name: 'c',
			version: 1,
			scope: 'project',
			category: 'ui',
			root: { id: 'r', kind: 'container', x: 0, y: 0, children: [] },
			stateMachine: machine(
				layer({
					states: [
						{ id: 'idle', timeline: 'c_coin_idle', speed: 0 },
						{ id: 'win', timeline: 'c_coin_win', speed: 2 },
					],
					transitions: [{ id: 'x', from: 'idle', to: 'exit', blend: 100 }],
				}),
				layer(),
			),
		} as unknown as ComponentDef).stateMachine;
		eq('a second layer with the same id is dropped', twice?.layers.length, 1);
		eq(
			'a speed not above 0 is dropped, a valid one kept',
			twice?.layers[0].states.map((st) => st.speed ?? null),
			[null, 2],
		);
		eq('a blend on a transition to exit is dropped', twice?.layers[0].transitions[0], {
			id: 'x',
			from: 'idle',
			to: 'exit',
		});
	}
	eq(
		'a < or > with no value is malformed (the transition is dropped)',
		normalizeComponent({
			id: 'c',
			name: 'c',
			version: 1,
			scope: 'project',
			category: 'ui',
			root: { id: 'r', kind: 'container', x: 0, y: 0, children: [] },
			inputs,
			stateMachine: machine(
				layer({
					transitions: [
						{ id: 'x', from: 'idle', to: 'win', conditions: [{ input: 'amount', op: '>' }] },
					],
				}),
			),
		} as unknown as ComponentDef).stateMachine?.layers[0].transitions,
		[],
	);
	eq(
		'…and a number == with none is kept but flagged by validation',
		M.validateStateMachine(
			{
				inputs,
				stateMachine: machine(
					layer({
						transitions: [
							{ id: 'x', from: 'idle', to: 'win', conditions: [{ input: 'amount', op: '==' }] },
						],
					}),
				),
			},
			['c_coin_idle', 'c_coin_win'],
		).map((i) => i.code),
		['condition-value-missing'],
	);
	eq(
		'a condition with no value is kept (the runtime reads a bool == as true)',
		normalizeComponent({
			id: 'c',
			name: 'c',
			version: 1,
			scope: 'project',
			category: 'ui',
			root: { id: 'r', kind: 'container', x: 0, y: 0, children: [] },
			inputs,
			stateMachine: machine(
				layer({
					transitions: [
						{ id: 'x', from: 'idle', to: 'win', conditions: [{ input: 'big', op: '==' }] },
					],
				}),
			),
		} as unknown as ComponentDef).stateMachine?.layers[0].transitions[0].conditions,
		[{ input: 'big', op: '==' }],
	);
	eq(
		'a value of the wrong type is malformed too',
		normalizeComponent({
			id: 'c',
			name: 'c',
			version: 1,
			scope: 'project',
			category: 'ui',
			root: { id: 'r', kind: 'container', x: 0, y: 0, children: [] },
			inputs,
			stateMachine: machine(
				layer({
					transitions: [
						{
							id: 'x',
							from: 'idle',
							to: 'win',
							conditions: [{ input: 'amount', op: '>', value: '100' }],
						} as never,
					],
				}),
			),
		} as unknown as ComponentDef).stateMachine?.layers[0].transitions,
		[],
	);
	eq(
		'a def without them saves without them',
		(() => {
			const d = normalizeComponent({
				id: 'c',
				name: 'c',
				version: 1,
				scope: 'project',
				category: 'ui',
				root: { id: 'r', kind: 'container', x: 0, y: 0, children: [] },
			} as unknown as ComponentDef);
			return ['inputs' in d, 'stateMachine' in d];
		})(),
		[false, false],
	);
}

// ---- 7. ship chain -----------------------------------------------------------------------------

const C = 'acme';
const P = 'borut';
bucket.set(cinematicKey(C, P, 'c_coin_idle'), JSON.stringify(idle));
const authored = await loadAuthoredCinematics(C, P);
eq(
	'a state timeline with no playOn and no Flow node naming it is authored',
	authored.map((d) => d.id),
	['c_coin_idle'],
);
const index = await exportCinematics(C, P, authored);
eq(
	'…exported to deploy/ and embedded for the game (rule 8)',
	[
		index.cinematics?.map((d) => d.id),
		[...bucket.keys()].filter((k) => k.includes('/deploy/cinematics/')),
	],
	[['c_coin_idle'], [`${C}/${P}/deploy/cinematics/c_coin_idle.json`]],
);
L.registerComponentTimelines(index.cinematics ?? []);
eq(
	'…and the runtime registry resolves it for the state machine by id',
	L.stateMachineTimelines(machine(layer())).docs.map((d) => d.id),
	['c_coin_idle'],
);

// ---- 8. a pot built from pieces ----------------------------------------------------------------

{
	const pieceDurations = new Map([
		['c_cracker_off', 0],
		['c_cracker_lit', 1],
		['c_cracker_fired', 1],
	]);
	const pieceInputs: ComponentDef['inputs'] = [
		{ id: 'share', kind: 'number', source: 'meter.{meter}.share' },
		{ id: 'potActivate', kind: 'trigger' },
	];
	const cracker = machine({
		id: 'main',
		entry: 'off',
		states: [
			{ id: 'off', timeline: 'c_cracker_off' },
			{ id: 'lit', timeline: 'c_cracker_lit', loop: true },
			{ id: 'fired', timeline: 'c_cracker_fired' },
		],
		transitions: [
			{
				id: 't_light',
				from: 'off',
				to: 'lit',
				conditions: [{ input: 'share', op: '>=', param: 'lightAt' }],
			},
			{
				id: 't_fire',
				from: 'lit',
				to: 'fired',
				conditions: [{ input: 'potActivate', op: 'fired' }],
			},
			{
				id: 't_dark',
				from: 'any',
				to: 'off',
				conditions: [{ input: 'share', op: '<', param: 'lightAt' }],
				exitTime: 1,
			},
		],
	});
	const piece = (lightAt: unknown) =>
		new M.ComponentStateMachineRunner(cracker, pieceInputs, pieceDurations, (key) =>
			key === 'lightAt' ? lightAt : undefined,
		);
	const bottom = piece(0.5);
	const head = piece(1);
	const states = () => [bottom.stateOf('main'), head.stateOf('main')];
	const step = (share: number, dt = 0.1) => {
		for (const r of [bottom, head]) {
			r.setInput('share', share);
			r.advance(dt);
		}
	};
	step(0.25);
	eq('below every threshold every piece stays off', states(), ['off', 'off']);
	step(0.5);
	eq('the bottom piece lights at its own threshold, the head does not', states(), ['lit', 'off']);
	step(1);
	eq('a full pot lights the head too', states(), ['lit', 'lit']);
	for (const r of [bottom, head]) r.fire('potActivate');
	step(1);
	eq('potActivate fires every lit piece', states(), ['fired', 'fired']);
	step(0, 0.5);
	eq('drained mid-fire: the fired piece finishes its timeline first', states(), ['fired', 'fired']);
	step(0, 0.6);
	eq('…then goes dark', states(), ['off', 'off']);
	const unset = piece(undefined);
	unset.setInput('share', 1);
	unset.advance(0.1);
	eq(
		'a placement without the param never lights (the condition fails)',
		unset.stateOf('main'),
		'off',
	);
	eq(
		'validation: `>=` is a number op and a param stands in for the value',
		M.validateStateMachine({ inputs: pieceInputs, stateMachine: cracker }, pieceDurations.keys()),
		[],
	);
	const saved = normalizeComponent({
		id: 'cracker',
		name: 'Firecracker',
		version: 1,
		scope: 'project',
		category: 'ui',
		root: { id: 'root', kind: 'container', x: 0, y: 0, children: [] },
		inputs: pieceInputs,
		stateMachine: machine({
			...cracker.layers[0],
			transitions: [
				...cracker.layers[0].transitions,
				{ id: 'bad', from: 'off', to: 'lit', conditions: [{ input: 'share', op: '>=' }] },
			],
		}),
	} as unknown as ComponentDef);
	eq(
		'what saves: a param condition and the new ops are kept; an ordering op with neither value nor param is dropped',
		saved.stateMachine?.layers[0].transitions,
		cracker.layers[0].transitions,
	);
	eq(
		'light order: the lowest lights first, pieces at one height together, the top at a full pot',
		PP.lightOrderThresholds([100, 0, 50, 50, -80]),
		[0.25, 0.75, 0.5, 0.5, 1],
	);
	const inst = (id: string, componentId: string, y: number): LayoutNode =>
		({ id, kind: 'componentInstance', componentId, x: 0, y, params: {} }) as LayoutNode;
	const body = {
		id: 'pot',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			inst('head', 'coinHead', -200),
			{ id: 'g', kind: 'container', x: 0, y: 100, children: [inst('a', 'cracker', 50)] },
			inst('b', 'cracker', 40),
			inst('art', 'other', 300),
		],
	} as LayoutNode;
	eq(
		'pieces are found through groups, their y summed, other instances skipped',
		PP.potPieces(body, (id) => id !== 'other').map((p) => [p.node.id, p.y]),
		[
			['head', -200],
			['a', 150],
			['b', 40],
		],
	);
}

console.log(
	`\n${failures === 0 ? '✅' : '❌'} component state machine: ${passes} passed, ${failures} failed`,
);
if (failures) process.exit(1);
