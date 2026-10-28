/**
 * Flow tick, timers and keys run on the virtual clock (`docs/design/game-families.md` §3.2, §7.2):
 *   pnpm --filter launcher-api check:flow-time-events
 *
 *  1. THE STORE'S CLOCK (`createFlowState().advance`): a timer fires when it runs out, in time order
 *     within a step; a repeating one each period; a stopped one never; a paused one holds; a tick with
 *     `every` fires each period with `dt = every`, one without fires each step.
 *  2. THE PREVIEW'S EVENT QUEUE (`previewFlowEvent` on a doc that uses state): timers fire at their
 *     exact virtual times, a Delay inside a timer chain resumes on the queue, a tick drives a counter,
 *     a scripted key runs its `onInput` entry, pause / resume shifts a timer, a Delay shorter than a
 *     frame never sends the clock back, the horizon is defaulted and capped, and two runs of the same
 *     doc give the same timeline. Writes go out with the next frame, as in game.
 *  3. A DOC WITH NO STATE previews exactly as before P10.3: the single-chain clock, every entry kind
 *     and stamp unchanged.
 *  4. VALIDATION: `tick-async` refuses a Delay, an awaited cue, an awaited cinematic, a held Show, a
 *     Wait for state and a function that holds one on a tick chain — not on a timer chain; `tick-fast`
 *     warns under 100 ms and on every frame; a wire into an entry is refused; `input-unknown` warns.
 *  5. THE GAME'S FRAME (the real `tickFlowV2State` over a stand-in handle): the last frame's writes go
 *     out first, once, then what came due — a chain's write after an await waits for the next frame,
 *     exactly as in the preview; `Game.svelte` adds its ticker callback only when the flow has a
 *     store (source-scanned: it is a component).
 */
import { readFileSync } from 'node:fs';
import type {
	DataSource,
	FlowDoc,
	FunctionLibraryDoc,
	Graph,
	Node,
	TemplateVocabulary,
} from 'engine-flow-v2';

const F = await import('../../../packages/engine-flow-v2/index.ts');

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

const at = { x: 0, y: 0 };
const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };
const VOCAB: TemplateVocabulary = {
	templateId: 'fixture',
	structs: [],
	enums: [],
	events: [{ name: 'go', payload: [] }],
	actions: [{ name: 'beat', params: [], category: 'effect' }],
	cues: [{ name: 'pop', payload: [] }],
	collections: [],
	values: [],
};
const ms = (value: number): DataSource => ({ kind: 'literal', type: { t: 'ms' }, value });
const int = (value: number): DataSource => ({ kind: 'literal', type: { t: 'int' }, value });
const ex = (from: string, to: string, pin = 'exec', toPin = 'exec') => ({
	from: { node: from, pin },
	to: { node: to, pin: toPin },
});
const doc = (graph: Graph, extra: Partial<FlowDoc> = {}): FlowDoc => ({
	version: 2,
	templateId: 'fixture',
	containers: [],
	graph,
	...extra,
});
const codes = (d: FlowDoc, library = LIBRARY) =>
	F.validateFlowDoc(d, VOCAB, library)
		.map((i) => `${i.severity} ${i.code}${i.at.on === 'node' ? ` @${i.at.node}` : ''}`)
		.sort();

// ---- 1. the store's clock ----------------------------------------------------------------------

{
	const tick = (every?: number): Node => ({
		id: `t${every ?? ''}`,
		kind: 'onTick',
		pos: at,
		every,
	});
	const state = F.createFlowState(doc({ nodes: [tick(500), tick()], exec: [], data: [] }));
	state.startTimer('a', 300, false);
	state.startTimer('b', 100, true);
	eq('step 1: b at 100 and 200, the every-frame tick at the end', state.advance(250), [
		{ kind: 'timer', at: 100, timer: 'b' },
		{ kind: 'timer', at: 200, timer: 'b' },
		{ kind: 'tick', at: 250, node: 't', dt: 250 },
	]);
	eq(
		'step 2: a (one-shot) at 50 in, b at 50, 150 and 250, the 500 ms tick at 250',
		state.advance(250),
		[
			{ kind: 'timer', at: 50, timer: 'a' },
			{ kind: 'timer', at: 50, timer: 'b' },
			{ kind: 'timer', at: 150, timer: 'b' },
			{ kind: 'timer', at: 250, timer: 'b' },
			{ kind: 'tick', at: 250, node: 't500', dt: 500 },
			{ kind: 'tick', at: 250, node: 't', dt: 250 },
		],
	);
	eq('a one-shot timer is spent once it fired', state.timerRunning('a'), false);
	state.stopTimer('b');
	eq(
		'a stopped timer never fires',
		state.advance(250).filter((d) => d.kind === 'timer'),
		[],
	);
	state.startTimer('c', 100, false);
	state.advance(40);
	state.pauseTimer('c', true);
	eq(
		'a paused timer holds',
		state.advance(500).filter((d) => d.kind === 'timer'),
		[],
	);
	state.pauseTimer('c', false);
	eq(
		'resumed, it fires after the 60 ms it had left',
		state.advance(100).filter((d) => d.kind === 'timer'),
		[{ kind: 'timer', at: 60, timer: 'c' }],
	);
	const zero = F.createFlowState(doc({ nodes: [], exec: [], data: [] }));
	zero.startTimer('z', 0, true);
	eq('a 0 ms repeat is held to 1 ms, never forever', zero.advance(5).length, 5);
	eq('a state with no tick and no timer is not live', zero.live(), true);
	zero.stopTimer('z');
	eq('…and once the timer stops, it is not', zero.live(), false);
}

// ---- 2. the preview's event queue --------------------------------------------------------------

const counterDoc = (): FlowDoc =>
	doc(
		{
			nodes: [
				{ id: 'go', kind: 'event', pos: at, ref: 'go' },
				{
					id: 'start',
					kind: 'startTimer',
					pos: at,
					timer: 'spawn',
					repeat: true,
					inputs: { ms: ms(800) },
				},
				{ id: 'onSpawn', kind: 'onTimer', pos: at, timer: 'spawn' },
				{ id: 'inc', kind: 'changeVariable', pos: at, variable: 'spawned', op: 'add' },
				{ id: 'wait', kind: 'delay', pos: at, inputs: { ms: ms(100) } },
				{ id: 'beat', kind: 'action', pos: at, ref: 'beat' },
			],
			exec: [ex('go', 'start'), ex('onSpawn', 'inc'), ex('inc', 'wait'), ex('wait', 'beat')],
			data: [],
		},
		{ variables: [{ id: 'spawned', type: 'int', initial: 0, scope: 'game' }] },
	);

{
	const result = await F.previewFlowEvent(counterDoc(), { vocab: VOCAB, library: LIBRARY }, 'go', {
		horizonMs: 2500,
	});
	const line = result.timeline.map((e) =>
		e.kind === 'timer'
			? `${e.at} timer ${e.timer}`
			: e.kind === 'var'
				? `${e.at} var ${e.id}=${String(e.value)}`
				: e.kind === 'effect'
					? `${e.at} effect ${e.name}`
					: `${e.at} ${e.kind}`,
	);
	eq(
		'a repeating 800 ms timer fires at 800, 1600, 2400; its Delay resumes on the queue; each write goes out with the next frame',
		line,
		[
			'800 timer spawn',
			'800 delay',
			'816.666667 var spawned=1',
			'900 effect beat',
			'1600 timer spawn',
			'1600 delay',
			'1616.666667 var spawned=2',
			'1700 effect beat',
			'2400 timer spawn',
			'2400 delay',
			'2416.666667 var spawned=3',
			'2500 effect beat',
		],
	);
	eq('the preview runs up to and including its horizon', result.durationMs, 2500);
	const again = await F.previewFlowEvent(counterDoc(), { vocab: VOCAB, library: LIBRARY }, 'go', {
		horizonMs: 2500,
	});
	eq('the same doc gives the same timeline', again, result);
	const turbo = await F.previewFlowEvent(counterDoc(), { vocab: VOCAB, library: LIBRARY }, 'go', {
		horizonMs: 900,
		speed: 2,
	});
	eq(
		'speed scales a Delay, not a timer',
		turbo.timeline.filter((e) => e.kind === 'effect').map((e) => e.at),
		[850],
	);
}

{
	const tickDoc = doc(
		{
			nodes: [
				{ id: 'tick', kind: 'onTick', pos: at, every: 250 },
				{
					id: 'inc',
					kind: 'changeVariable',
					pos: at,
					variable: 'n',
					op: 'add',
					inputs: { by: int(2) },
				},
				{ id: 'key', kind: 'onInput', pos: at, action: 'jump' },
				{ id: 'stop', kind: 'setVariable', pos: at, variable: 'n', inputs: { value: int(100) } },
			],
			exec: [ex('tick', 'inc'), ex('key', 'stop')],
			data: [],
		},
		{
			variables: [{ id: 'n', type: 'int', initial: 0, scope: 'game' }],
			inputs: [{ action: 'jump', keys: [' '] }],
		},
	);
	const result = await F.previewFlowEvent(tickDoc, { vocab: VOCAB, library: LIBRARY }, '', {
		horizonMs: 1000,
		inputs: [{ at: 600, action: 'jump' }],
	});
	eq(
		'a 250 ms tick adds 2 each period; the key at 600 sets 100; writes go out a frame later',
		result.timeline
			.filter((e) => e.kind === 'var' || e.kind === 'input')
			.map((e) => (e.kind === 'var' ? `${Math.round(e.at)} n=${String(e.value)}` : `${e.at} key`)),
		['267 n=2', '517 n=4', '600 key', '617 n=100', '767 n=102'],
	);
}

{
	const pauseDoc = doc(
		{
			nodes: [
				{ id: 'go', kind: 'event', pos: at, ref: 'go' },
				{ id: 'start', kind: 'startTimer', pos: at, timer: 'bomb', inputs: { ms: ms(500) } },
				{ id: 'hold', kind: 'pauseTimer', pos: at, timer: 'bomb' },
				{ id: 'wait', kind: 'delay', pos: at, inputs: { ms: ms(300) } },
				{ id: 'again', kind: 'pauseTimer', pos: at, timer: 'bomb' },
				{ id: 'boom', kind: 'onTimer', pos: at, timer: 'bomb' },
				{ id: 'beat', kind: 'action', pos: at, ref: 'beat' },
			],
			exec: [
				ex('go', 'start'),
				ex('start', 'hold', 'exec', 'pause'),
				ex('hold', 'wait'),
				ex('wait', 'again', 'exec', 'resume'),
				ex('boom', 'beat'),
			],
			data: [],
		},
		{ variables: [] },
	);
	const result = await F.previewFlowEvent(pauseDoc, { vocab: VOCAB, library: LIBRARY }, 'go');
	eq(
		'a timer paused for 300 ms runs out 300 ms late',
		result.timeline
			.filter((e) => e.kind === 'timer' || e.kind === 'effect')
			.map((e) => Math.round(e.at)),
		[800, 800],
	);
	eq('…and the preview ends once nothing can fire', Math.round(result.durationMs) <= 900, true);
}

{
	// A Delay shorter than a frame inside a timer chain, beside an every-frame tick: the clock never
	// runs back, and the Delay ends at its own time, between frames.
	const subFrame = doc(
		{
			nodes: [
				{ id: 'go', kind: 'event', pos: at, ref: 'go' },
				{ id: 'start', kind: 'startTimer', pos: at, timer: 't', inputs: { ms: ms(125) } },
				{ id: 'fire', kind: 'onTimer', pos: at, timer: 't' },
				{ id: 'wait', kind: 'delay', pos: at, inputs: { ms: ms(5) } },
				{ id: 'beat', kind: 'action', pos: at, ref: 'beat' },
				{ id: 'tick', kind: 'onTick', pos: at },
				{ id: 'pop', kind: 'fireCue', pos: at, ref: 'pop' },
			],
			exec: [ex('go', 'start'), ex('fire', 'wait'), ex('wait', 'beat'), ex('tick', 'pop')],
			data: [],
		},
		{ variables: [] },
	);
	const result = await F.previewFlowEvent(subFrame, { vocab: VOCAB, library: LIBRARY }, 'go', {
		horizonMs: 200,
	});
	const stamps = result.timeline.map((e) => e.at);
	eq(
		'the clock never runs back',
		stamps.every((t, i) => i === 0 || t >= stamps[i - 1]),
		true,
	);
	eq(
		'the timer runs at the frame it came due in (133.33), its 5 ms Delay ends at 138.33',
		result.timeline
			.filter((e) => e.kind === 'timer' || e.kind === 'effect')
			.map((e) => Math.round(e.at * 100) / 100),
		[133.33, 138.33],
	);
	eq(
		'a horizon left blank or out of range is the default or the cap',
		[
			(
				await F.previewFlowEvent(subFrame, { vocab: VOCAB, library: LIBRARY }, 'go', {
					horizonMs: null as unknown as number,
				})
			).durationMs,
			(
				await F.previewFlowEvent(subFrame, { vocab: VOCAB, library: LIBRARY }, 'go', {
					horizonMs: 10 ** 9,
				})
			).durationMs,
		],
		[F.PREVIEW_HORIZON_MS, F.PREVIEW_MAX_HORIZON_MS],
	);
}

{
	// A scripted key at no real time is dropped, never left at the head of the queue for good.
	const keyDoc = doc(
		{ nodes: [{ id: 'k', kind: 'onInput', pos: at, action: 'a' }], exec: [], data: [] },
		{ inputs: [{ action: 'a', keys: ['a'] }] },
	);
	const result = await F.previewFlowEvent(keyDoc, { vocab: VOCAB, library: LIBRARY }, '', {
		inputs: [
			{ action: 'a', at: Number.NaN },
			{ action: 'a', at: 50 },
		],
	});
	eq(
		'a key at NaN is dropped; the one at 50 runs and the preview ends',
		result.timeline.map((e) => `${e.kind}@${e.at}`),
		['input@50'],
	);
}

// ---- 3. a doc with no state previews as before -------------------------------------------------

{
	const plain = doc({
		nodes: [
			{ id: 'go', kind: 'event', pos: at, ref: 'go' },
			{ id: 'par', kind: 'parallel', pos: at, count: 2 },
			{ id: 'w1', kind: 'delay', pos: at, inputs: { ms: ms(200) } },
			{ id: 'w2', kind: 'delay', pos: at, inputs: { ms: ms(300) } },
			{ id: 'b1', kind: 'action', pos: at, ref: 'beat' },
			{ id: 'c2', kind: 'fireCue', pos: at, ref: 'pop' },
		],
		exec: [
			ex('go', 'par'),
			ex('par', 'w1', 'then[0]'),
			ex('par', 'w2', 'then[1]'),
			ex('w1', 'b1'),
			ex('w2', 'c2'),
		],
		data: [],
	});
	eq('a doc with no variables, timers or ticks uses no state', F.flowUsesState(plain), false);
	const result = await F.previewFlowEvent(plain, { vocab: VOCAB, library: LIBRARY }, 'go');
	eq('it keeps the single-chain clock (delays add up, as before P10.3)', result, {
		timeline: [
			{ kind: 'delay', at: 0, ms: 200 },
			{ kind: 'delay', at: 200, ms: 300 },
			{ kind: 'effect', at: 500, name: 'beat' },
			{ kind: 'cue', at: 500, name: 'pop' },
		],
		durationMs: 500,
		speed: 1,
	});
	eq(
		'no slot seed flow uses state (only the match-3, arcade and card starters keep any)',
		Object.entries(F.DRIVEN_SEEDS)
			.filter(([, seed]) => F.flowUsesState(seed))
			.map(([id]) => id),
		['match3', 'arcade', 'card'],
	);
}

// ---- 4. validation -----------------------------------------------------------------------------

{
	const holdLib: FunctionLibraryDoc = {
		version: 2,
		functions: [
			{
				id: 'fn_wait',
				name: 'Pause',
				inputs: [{ id: 'exec', dir: 'in', kind: 'exec' }],
				outputs: [{ id: 'exec', dir: 'out', kind: 'exec' }],
				requires: {},
				body: {
					nodes: [
						{ id: 'e', kind: 'functionEntry', pos: at, ref: 'fn_wait' },
						{ id: 'd', kind: 'delay', pos: at, inputs: { ms: ms(10) } },
						{ id: 'r', kind: 'functionResult', pos: at, ref: 'fn_wait' },
					],
					exec: [ex('e', 'd'), ex('d', 'r')],
					data: [],
				},
			},
		],
	};
	const tickChain = doc({
		nodes: [
			{ id: 'tick', kind: 'onTick', pos: at, every: 800 },
			{ id: 'seq', kind: 'sequence', pos: at, count: 5 },
			{ id: 'd', kind: 'delay', pos: at, inputs: { ms: ms(10) } },
			{ id: 'cue', kind: 'fireCue', pos: at, ref: 'pop', await: true },
			{ id: 'cin', kind: 'playCinematic', pos: at, ref: 'intro', awaitComplete: true },
			{
				id: 'wait',
				kind: 'waitForState',
				pos: at,
				container: 'c',
				instance: 'i',
				layer: 'l',
				state: 's',
			},
			{ id: 'call', kind: 'functionCall', pos: at, ref: 'fn_wait' },
			{ id: 'free', kind: 'fireCue', pos: at, ref: 'pop' },
		],
		exec: [
			ex('tick', 'seq'),
			ex('seq', 'd', 'then[0]'),
			ex('seq', 'cue', 'then[1]'),
			ex('seq', 'cin', 'then[2]', 'play'),
			ex('seq', 'wait', 'then[3]'),
			ex('seq', 'call', 'then[4]'),
			ex('call', 'free'),
		],
		data: [],
	});
	eq(
		'tick-async on every wait a tick chain reaches, a fire-and-forget cue allowed',
		codes(tickChain, holdLib).filter((c) => c.includes('tick-')),
		[
			'error tick-async @call',
			'error tick-async @cin',
			'error tick-async @cue',
			'error tick-async @d',
			'error tick-async @wait',
		],
	);
	const timerChain = doc({
		nodes: [
			{ id: 'timer', kind: 'onTimer', pos: at, timer: 't' },
			{ id: 'd', kind: 'delay', pos: at, inputs: { ms: ms(10) } },
		],
		exec: [ex('timer', 'd')],
		data: [],
	});
	eq('a timer chain may wait', codes(timerChain), []);
	const fast = doc({
		nodes: [
			{ id: 'frame', kind: 'onTick', pos: at },
			{ id: 'fast', kind: 'onTick', pos: at, every: 50 },
			{ id: 'ok', kind: 'onTick', pos: at, every: 100 },
		],
		exec: [],
		data: [],
	});
	eq('tick-fast warns under 100 ms and on every frame', codes(fast), [
		'warning tick-fast @fast',
		'warning tick-fast @frame',
	]);
	const wiredEntry = doc({
		nodes: [
			{ id: 'go', kind: 'event', pos: at, ref: 'go' },
			{ id: 'timer', kind: 'onTimer', pos: at, timer: 't' },
		],
		exec: [ex('go', 'timer')],
		data: [],
	});
	eq('an onTimer has no exec-in, so a wire into it is refused', codes(wiredEntry), [
		'error edge-endpoint',
	]);
	const keyed = (inputs: FlowDoc['inputs']) =>
		codes(
			doc(
				{ nodes: [{ id: 'k', kind: 'onInput', pos: at, action: 'left' }], exec: [], data: [] },
				{ inputs },
			),
		);
	eq('input-unknown warns on an action no key maps', keyed(undefined), [
		'warning input-unknown @k',
	]);
	eq('a mapped action is fine', keyed([{ action: 'left', keys: ['ArrowLeft'] }]), []);
}

// ---- 5. the game's frame -----------------------------------------------------------------------

{
	// The real holder, with a stand-in handle: one call is one frame, and it must run the same
	// `stepFlowState` the preview runs — the last frame's writes out first, then what came due.
	const holder = await import('../../lines/src/game/flowV2InterpreterHolder.ts');
	const frameDoc = doc(
		{ nodes: [{ id: 'tick', kind: 'onTick', pos: at, every: 100 }], exec: [], data: [] },
		{ variables: [{ id: 'n', type: 'int', initial: 0, scope: 'round' }] },
	);
	const state = F.createFlowState(frameDoc);
	const ran: string[] = [];
	const heard: unknown[] = [];
	state.subscribe('n', (value) => heard.push(value));
	holder.setFlowV2({
		state,
		runStateEntry: async (entry: { kind: string; batch?: { value: unknown }[] }) => {
			ran.push(entry.kind === 'variables' ? `variables ${entry.batch?.length}` : entry.kind);
			// A chain that writes after its first await, as any real chain does.
			await Promise.resolve();
			if (entry.kind === 'tick') state.change('n', 'add', 1, {});
		},
	} as unknown as Parameters<typeof holder.setFlowV2>[0]);
	holder.tickFlowV2State(100);
	await Promise.resolve();
	await Promise.resolve();
	eq('frame 1: the tick runs; its write (after an await) waits', [ran, heard], [['tick'], [0]]);
	holder.tickFlowV2State(100);
	await Promise.resolve();
	await Promise.resolve();
	eq(
		'frame 2: the write goes out first, once, then the next tick',
		[ran, heard],
		[
			['tick', 'variables 1', 'tick'],
			[0, 1],
		],
	);
	state.write('n', 9);
	holder.resetFlowV2Round();
	holder.tickFlowV2State(50);
	eq('a round reset is delivered like any write', heard.at(-1), 0);
	holder.setFlowV2(undefined);
	holder.tickFlowV2State(100);
	eq('no flow: a frame does nothing', ran.length, 4);
	const game = source('apps/lines/src/components/Game.svelte');
	eq(
		'Game.svelte adds the ticker callback only when the flow has a store, and again once loaded',
		[
			'void stateApp.loaded;',
			'const ticker = flowV2Handle?.state ? stateApp.pixiApplication?.ticker : undefined;',
			'const tick = () => tickFlowV2State(ticker.deltaMS);',
		].map((l) => game.includes(l)),
		[true, true, true],
	);
	const runtime = source('apps/lines/src/game/flowV2Runtime.svelte.ts');
	eq(
		'the handle builds a store only for a doc that uses one, and reports a failing chain once',
		[
			'const state = flowUsesState(doc) ? createFlowState(doc) : undefined;',
			'runFlowStateEntry(doc, ctx, entry).catch((e: unknown) => {',
		].map((l) => runtime.includes(l)),
		[true, true],
	);
}

if (failures > 0) {
	console.error(`\nflow time events: ${failures} failed, ${passes} passed`);
	process.exit(1);
}
console.log(`flow time events: all ${passes} checks passed`);
