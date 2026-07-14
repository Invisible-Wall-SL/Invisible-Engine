/**
 * Invisible Flow v2 — the book-of TEMPLATE's canonical per-event PRESENTATION choreographies.
 *
 * These are the real book-event choreographies (`freeSpinTrigger`, `setExpandingSymbol`, `setWin`,
 * the `winInfo` forEach, …), transcribed 1:1 from the reference game's coded `bookEventHandlerMap`
 * and authored against {@link BOOK_OF_VOCAB}. They live HERE — in the package, template-owned — so
 * they are a reusable artifact both consumers share:
 *   - `apps/lines` builds its committed reference flow (`LINES_FLOW_V2_DOC`) from them; and
 *   - the v1→v2 TRANSLATOR (`engine-flow-migrate`) INJECTS a book event's choreography when the
 *     game's authored v1 flow only declared a screen transition for it (no presentation) — so a
 *     translated game gets the template's faithful presentation, not an empty screen swap.
 *
 * The DSL is deliberately tiny — a linear list of `action` / `cue` steps, plus a `forEach` step for
 * the one non-linear case (`winInfo`). {@link buildChoreo} turns a step list into a v2 exec/data
 * subgraph; a caller wires the subgraph's `entry` off its `event` node and appends after its `tails`.
 */

import type { DataEdge, DataSource, ExecEdge, Node, PinPath } from '../types';

// ---------------------------------------------------------------------------
// DataSource helpers (the accessors an author reads a payload off — `$trigger`, `$context`, `$item`).
// ---------------------------------------------------------------------------

/** `$trigger` (the whole event payload) or `$trigger.member` (a field). */
export const trig = (member?: string): DataSource => ({
	kind: 'accessor',
	path: member === undefined ? { on: 'trigger' } : { on: 'trigger', member },
});
/** `$context.member` — the dispatch context (e.g. the surrounding `bookEvents` list). */
export const ctxA = (member: string): DataSource => ({
	kind: 'accessor',
	path: { on: 'context', member },
});
/** `$item.member` — a `forEach` element's field. */
export const itemA = (member: string): DataSource => ({
	kind: 'accessor',
	path: { on: 'item', member },
});
/** A string literal (`str('sfx_…')`). */
export const str = (value: string): DataSource => ({
	kind: 'literal',
	type: { t: 'string' },
	value,
});

// ---------------------------------------------------------------------------
// The step DSL + the v2-subgraph builder.
// ---------------------------------------------------------------------------

export type ChoreoInputs = Record<string, DataSource>;

/** One presentation step: fire a state/awaited `action`, broadcast a `cue` (optionally awaited), or
 *  loop a `forEach` over a list running its `body` per element. */
export type ChoreoStep =
	| { k: 'action'; ref: string; inputs?: ChoreoInputs }
	| { k: 'cue'; ref: string; wait?: boolean; inputs?: ChoreoInputs }
	| { k: 'forEach'; list: DataSource; mode: 'sequence' | 'parallel'; body: ChoreoStep[] };

/** A wired fragment: its nodes/edges + the pin an incoming edge attaches to (`entry`) and the pins a
 *  following step chains off (`tails`). Matches the translator's internal `SubGraph` shape. */
export interface ChoreoSubgraph {
	nodes: Node[];
	exec: ExecEdge[];
	data: DataEdge[];
	entry: string | null;
	tails: PinPath[];
}

/** A per-build unique-id generator (no module state — callers pass their own so the output is pure
 *  and collision-free across many injected choreographies). */
export type ChoreoUid = (prefix: string) => string;

/** Make a standalone {@link ChoreoUid} — `ref_0`, `ref_1`, … Callers translating a whole doc pass a
 *  single shared generator instead so ids never collide across events. */
export const makeChoreoUid = (): ChoreoUid => {
	let n = 0;
	return (prefix) => `${prefix}_${n++}`;
};

/** Build one step into a wired subgraph (nodes auto-positioned at origin — layout is cosmetic). */
const buildStep = (step: ChoreoStep, uid: ChoreoUid): ChoreoSubgraph => {
	if (step.k === 'action') {
		const id = uid('act');
		return {
			nodes: [
				{ id, kind: 'action', pos: { x: 0, y: 0 }, ref: step.ref, inputs: step.inputs ?? {} },
			],
			exec: [],
			data: [],
			entry: id,
			tails: [{ node: id, pin: 'exec' }],
		};
	}
	if (step.k === 'cue') {
		const id = uid('cue');
		return {
			nodes: [
				{
					id,
					kind: 'fireCue',
					pos: { x: 0, y: 0 },
					ref: step.ref,
					...(step.wait ? { await: true } : {}),
					inputs: step.inputs ?? {},
				},
			],
			exec: [],
			data: [],
			entry: id,
			tails: [{ node: id, pin: 'exec' }],
		};
	}
	// forEach — a loop node whose `body` pin runs the chained body per element; `done` is the tail.
	const id = uid('each');
	const body = buildChoreo(step.body, uid);
	const nodes: Node[] = [
		{ id, kind: 'forEach', pos: { x: 0, y: 0 }, mode: step.mode, inputs: { in: step.list } },
		...body.nodes,
	];
	const exec = [...body.exec];
	if (body.entry)
		exec.push({ from: { node: id, pin: 'body' }, to: { node: body.entry, pin: 'exec' } });
	return { nodes, exec, data: [...body.data], entry: id, tails: [{ node: id, pin: 'done' }] };
};

/** Chain a step list into one subgraph: each step's `tails` wire to the next step's `entry`. */
export const buildChoreo = (steps: ChoreoStep[], uid: ChoreoUid): ChoreoSubgraph => {
	const nodes: Node[] = [];
	const exec: ExecEdge[] = [];
	const data: DataEdge[] = [];
	let entry: string | null = null;
	let tails: PinPath[] = [];
	for (const step of steps) {
		const part = buildStep(step, uid);
		nodes.push(...part.nodes);
		exec.push(...part.exec);
		data.push(...part.data);
		if (!part.entry) continue;
		if (!entry) entry = part.entry;
		for (const t of tails) exec.push({ from: t, to: { node: part.entry, pin: 'exec' } });
		tails = part.tails;
	}
	return { nodes, exec, data, entry, tails };
};

// ---------------------------------------------------------------------------
// The canonical book-of choreographies — 1:1 with `apps/lines` `bookEventHandlerMap`, in handler
// order. An event ABSENT here (e.g. `finalWin` no-op, `createBonusSnapshot` resume orchestration)
// has no presentation and stays on its coded handler / falls through (parity).
// ---------------------------------------------------------------------------

export const BOOK_OF_CHOREO: Record<string, ChoreoStep[]> = {
	// `reveal` — the awaited board spin (fed the WHOLE event + context), then clear the scatter sound.
	reveal: [
		{
			k: 'action',
			ref: 'revealBoard',
			inputs: { bookEvent: trig(), bookEvents: ctxA('bookEvents') },
		},
		{ k: 'cue', ref: 'soundScatterCounterClear' },
	],

	// `winInfo` — a win-level sfx, then a serial forEach over `$trigger.wins`, each animating its
	// cells and showing a transient "Win $X — N of a kind" toast for that win (the generic
	// `showMessage` effect; text assembled game-side from the win's `win`/`kind`).
	winInfo: [
		{ k: 'cue', ref: 'soundOnce', inputs: { name: str('sfx_winlevel_small') } },
		{
			k: 'forEach',
			list: trig('wins'),
			mode: 'sequence',
			body: [
				{ k: 'cue', ref: 'boardShow' },
				{
					k: 'cue',
					ref: 'boardWithAnimateSymbols',
					wait: true,
					inputs: { symbolPositions: itemA('positions') },
				},
				{
					k: 'action',
					ref: 'showMessage',
					inputs: { amount: itemA('win'), kind: itemA('kind'), messageKind: str('win') },
				},
			],
		},
	],

	// `setTotalWin` — set the win-meter amount.
	setTotalWin: [{ k: 'action', ref: 'setWinBookEventAmount', inputs: { amount: trig('amount') } }],

	// `setExpandingSymbol` — set the special symbol, then await the reveal spine.
	setExpandingSymbol: [
		{ k: 'action', ref: 'setSpecialSymbol', inputs: { symbol: trig('symbol') } },
		{ k: 'cue', ref: 'specialBookReveal', wait: true, inputs: { symbol: trig('symbol') } },
	],

	// `expandBookColumns` — the scatter sfx, then the awaited per-cell column morph.
	expandBookColumns: [
		{ k: 'cue', ref: 'soundOnce', inputs: { name: str('sfx_scatter_win_v2') } },
		{
			k: 'action',
			ref: 'expandBookColumns',
			inputs: { symbol: trig('symbol'), reels: trig('reels') },
		},
	],

	// `freeSpinTrigger` — scatter animation, the intro show + count set, then the counter show.
	freeSpinTrigger: [
		{ k: 'cue', ref: 'soundOnce', inputs: { name: str('sfx_scatter_win_v2') } },
		{ k: 'cue', ref: 'boardShow' },
		{
			k: 'cue',
			ref: 'boardWithAnimateSymbols',
			wait: true,
			inputs: { symbolPositions: trig('positions') },
		},
		{ k: 'cue', ref: 'soundOnce', inputs: { name: str('sfx_superfreespin') } },
		{ k: 'cue', ref: 'uiHide', wait: true },
		{ k: 'cue', ref: 'transition', wait: true },
		{ k: 'action', ref: 'setFreeSpinCounterTotal', inputs: { total: trig('totalFs') } },
		{ k: 'cue', ref: 'freeSpinIntroShow' },
		{ k: 'action', ref: 'freeSpinIntroShow' },
		{ k: 'cue', ref: 'soundOnce', inputs: { name: str('jng_intro_fs') } },
		{ k: 'cue', ref: 'soundMusic', inputs: { name: str('bgm_freespin') } },
		{
			k: 'cue',
			ref: 'freeSpinIntroUpdate',
			wait: true,
			inputs: { totalFreeSpins: trig('totalFs') },
		},
		{ k: 'action', ref: 'setFreeGameType' },
		{ k: 'cue', ref: 'freeSpinIntroHide' },
		{ k: 'action', ref: 'freeSpinIntroHide' },
		{ k: 'cue', ref: 'boardFrameGlowShow' },
		{ k: 'cue', ref: 'freeSpinCounterShow' },
		{ k: 'action', ref: 'freeSpinCounterShow' },
		{ k: 'cue', ref: 'freeSpinCounterUpdate', inputs: { total: trig('totalFs') } },
		{ k: 'action', ref: 'setFreeSpinCounterTotalOnly', inputs: { total: trig('totalFs') } },
		{ k: 'cue', ref: 'uiShow', wait: true },
		{ k: 'cue', ref: 'drawerButtonShow', wait: true },
		{ k: 'cue', ref: 'drawerFold' },
	],

	// `updateFreeSpin` — show the counter + update its current/total.
	updateFreeSpin: [
		{ k: 'cue', ref: 'freeSpinCounterShow' },
		{ k: 'action', ref: 'freeSpinCounterShow' },
		{
			k: 'action',
			ref: 'freeSpinCounterUpdate',
			inputs: { amount: trig('amount'), total: trig('total') },
		},
		{
			k: 'action',
			ref: 'updateFreeSpinCounter',
			inputs: { amount: trig('amount'), total: trig('total') },
		},
	],

	// `freeSpinEnd` — the outro count-up with its win-level sound bookends, then the cleanup.
	freeSpinEnd: [
		{ k: 'cue', ref: 'uiHide', wait: true },
		{ k: 'action', ref: 'enterFreeSpinOutro' },
		{ k: 'cue', ref: 'boardFrameGlowHide' },
		{ k: 'cue', ref: 'freeSpinOutroShow' },
		{ k: 'cue', ref: 'soundOnce', inputs: { name: str('sfx_youwon_panel') } },
		{ k: 'action', ref: 'winLevelSoundsPlay', inputs: { winLevel: trig('winLevel') } },
		{
			k: 'action',
			ref: 'freeSpinOutroCountUp',
			inputs: { amount: trig('amount'), winLevel: trig('winLevel') },
		},
		{ k: 'action', ref: 'winLevelSoundsStop' },
		{ k: 'cue', ref: 'freeSpinOutroHide' },
		{ k: 'cue', ref: 'freeSpinCounterHide' },
		{ k: 'cue', ref: 'specialBookHide' },
		{ k: 'action', ref: 'exitFreeSpinOutro' },
		{ k: 'cue', ref: 'transition', wait: true },
		{ k: 'cue', ref: 'uiShow', wait: true },
		{ k: 'cue', ref: 'drawerUnfold', wait: true },
		{ k: 'cue', ref: 'drawerButtonHide' },
	],

	// `setWin` — the win panel show + awaited count-up with win-level sound bookends, then hide.
	setWin: [
		{ k: 'cue', ref: 'winShow' },
		{ k: 'action', ref: 'winShow', inputs: { winLevel: trig('winLevel') } },
		{ k: 'action', ref: 'winLevelSoundsPlay', inputs: { winLevel: trig('winLevel') } },
		{
			k: 'action',
			ref: 'winUpdate',
			inputs: { amount: trig('amount'), winLevel: trig('winLevel') },
		},
		{ k: 'action', ref: 'winLevelSoundsStop' },
		{ k: 'cue', ref: 'winHide' },
		{ k: 'action', ref: 'winHide' },
	],
};
