/**
 * Invisible Flow v2 — the committed REFERENCE book-of flow for apps/lines (the v1→v2 migration
 * artifact). The v2 analogue of v1's `LINES_FLOW_DOC` (`flowDoc.ts`): a REAL authored flow, held in
 * the repo so v2 can drive the WHOLE game WITHOUT authoring online first — loaded via the
 * `window.__IE_FLOW_V2_LINES__` dev global (mirroring v1's `__IE_FLOW_LINES__`) or shipped through
 * the baked bundle (`bakedFlowV2Doc()`).
 *
 * It authors EVERY book event as a FAITHFUL translation of v1's per-event choreographies (which were
 * themselves read straight off `bookEventHandlerMap.ts`), so when v2 OWNS an event (event ownership,
 * `game/utils.ts`) it drives it with NO behaviour change — the incremental "make it work like it is
 * now" migration. The mapping is 1:1 with the v1 choreographies:
 *   - `broadcast`      → `fireCue`            (fire-and-forget)
 *   - `broadcastAwait` → `fireCue { await }`  (blocks on subscribers, like `broadcastAsync`)
 *   - `effect`         → `action`
 *   - `forEach`        → `forEach`
 *   - `trigger('x')`/`context('x')`/`item('x')`/`lit(v)` → the matching v2 accessors / literal
 *
 * `createBonusSnapshot` is the ONE event left to its coded handler (as v1 also did): it re-dispatches
 * reserved events through the play path (resume orchestration, not presentation) — not owned here, so
 * it falls through. When every OTHER event is owned + verified, the coded `bookEventHandlerMap` + v1
 * become dead code — the full-flow-driven end state.
 */

import type {
	DataEdge,
	DataSource,
	ExecEdge,
	FlowDoc as FlowDocV2,
	FunctionLibraryDoc,
	Node,
} from 'engine-flow-v2';

// ---------------------------------------------------------------------------
// DataSource helpers (mirror v1's `trigger`/`context`/`item`/`lit`).
// ---------------------------------------------------------------------------

/** `$trigger` (whole event payload) or `$trigger.member` (a field). */
const trig = (member?: string): DataSource => ({
	kind: 'accessor',
	path: member === undefined ? { on: 'trigger' } : { on: 'trigger', member },
});
/** `$context.member` — the dispatch context (e.g. the surrounding `bookEvents` list). */
const ctxA = (member: string): DataSource => ({
	kind: 'accessor',
	path: { on: 'context', member },
});
/** `$item.member` — a forEach element's field. */
const itemA = (member: string): DataSource => ({ kind: 'accessor', path: { on: 'item', member } });
/** A string literal (`lit('sfx_…')`). */
const str = (value: string): DataSource => ({ kind: 'literal', type: { t: 'string' }, value });

// ---------------------------------------------------------------------------
// A tiny graph builder — each event is a linear exec chain of steps; nodes auto-positioned + wired.
// ---------------------------------------------------------------------------

type Inputs = Record<string, DataSource>;
type Step =
	| { k: 'action'; ref: string; inputs?: Inputs }
	| { k: 'cue'; ref: string; wait?: boolean; inputs?: Inputs };

const nodes: Node[] = [];
const exec: ExecEdge[] = [];
const data: DataEdge[] = [];
let row = 0; // one row of the canvas per event, for readable positions.

const pos = (col: number) => ({ x: col * 220, y: row * 160 });

/** Author one event as a LINEAR chain: an `event` node → each step in order. `tail` (optional)
 *  lets the caller append a non-linear node (a forEach) after the linear steps, returning the id
 *  the chain currently ends at so the caller can wire the branch. */
const authorEvent = (ref: string, steps: Step[]): string => {
	const id = (i: number) => `${ref}_${i}`;
	const eventId = id(0);
	nodes.push({ id: eventId, kind: 'event', pos: pos(0), ref });
	let prev = eventId;
	let prevPin = 'exec';
	steps.forEach((step, i) => {
		const nid = id(i + 1);
		if (step.k === 'action') {
			nodes.push({
				id: nid,
				kind: 'action',
				pos: pos(i + 1),
				ref: step.ref,
				inputs: step.inputs ?? {},
			});
		} else {
			nodes.push({
				id: nid,
				kind: 'fireCue',
				pos: pos(i + 1),
				ref: step.ref,
				...(step.wait ? { await: true } : {}),
				inputs: step.inputs ?? {},
			});
		}
		exec.push({ from: { node: prev, pin: prevPin }, to: { node: nid, pin: 'exec' } });
		prev = nid;
		prevPin = 'exec';
	});
	row++;
	return prev; // the last node id (so a caller can extend, e.g. winInfo's forEach).
};

// ---------------------------------------------------------------------------
// The events — 1:1 with v1's per-event choreographies (`flowDoc.ts`), in handler order.
// ---------------------------------------------------------------------------

// `reveal` — bonus record + awaited board spin (the mechanic effect, fed the WHOLE event + context),
// then clear the scatter-counter sound. `revealBoard` reads `{ bookEvent, bookEvents }`.
authorEvent('reveal', [
	{
		k: 'action',
		ref: 'revealBoard',
		inputs: { bookEvent: trig(), bookEvents: ctxA('bookEvents') },
	},
	{ k: 'cue', ref: 'soundScatterCounterClear' },
]);

// `winInfo` — a win-level sfx, then a serial forEach over `$trigger.wins`, each animating its
// positions (boardShow + awaited boardWithAnimateSymbols). Built with an explicit forEach body.
{
	const sfx = authorEvent('winInfo', [
		{ k: 'cue', ref: 'soundOnce', inputs: { name: str('sfx_winlevel_small') } },
	]);
	const each = 'winInfo_each';
	const show = 'winInfo_body_show';
	const anim = 'winInfo_body_anim';
	nodes.push({
		id: each,
		kind: 'forEach',
		pos: pos(2),
		mode: 'sequence',
		inputs: { in: trig('wins') },
	});
	nodes.push({
		id: show,
		kind: 'fireCue',
		pos: { x: 660, y: (row - 1) * 160 + 70 },
		ref: 'boardShow',
		inputs: {},
	});
	nodes.push({
		id: anim,
		kind: 'fireCue',
		pos: { x: 880, y: (row - 1) * 160 + 70 },
		ref: 'boardWithAnimateSymbols',
		await: true,
		inputs: { symbolPositions: itemA('positions') },
	});
	exec.push({ from: { node: sfx, pin: 'exec' }, to: { node: each, pin: 'exec' } });
	exec.push({ from: { node: each, pin: 'body' }, to: { node: show, pin: 'exec' } });
	exec.push({ from: { node: show, pin: 'exec' }, to: { node: anim, pin: 'exec' } });
	// `done` ends the event (nothing after the loop).
}

// `setTotalWin` — set the win-meter amount.
authorEvent('setTotalWin', [
	{ k: 'action', ref: 'setWinBookEventAmount', inputs: { amount: trig('amount') } },
]);

// `setExpandingSymbol` — set the special symbol, then await the reveal spine.
authorEvent('setExpandingSymbol', [
	{ k: 'action', ref: 'setSpecialSymbol', inputs: { symbol: trig('symbol') } },
	{ k: 'cue', ref: 'specialBookReveal', wait: true, inputs: { symbol: trig('symbol') } },
]);

// `expandBookColumns` — the scatter sfx, then the awaited per-cell column morph (effect).
authorEvent('expandBookColumns', [
	{ k: 'cue', ref: 'soundOnce', inputs: { name: str('sfx_scatter_win_v2') } },
	{
		k: 'action',
		ref: 'expandBookColumns',
		inputs: { symbol: trig('symbol'), reels: trig('reels') },
	},
]);

// `freeSpinTrigger` — scatter animation, the intro show + count set, then the counter show.
authorEvent('freeSpinTrigger', [
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
	{ k: 'cue', ref: 'freeSpinIntroUpdate', wait: true, inputs: { totalFreeSpins: trig('totalFs') } },
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
]);

// `updateFreeSpin` — show the counter + update its current/total.
authorEvent('updateFreeSpin', [
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
]);

// `freeSpinEnd` — the outro count-up with its win-level sound bookends, then the cleanup.
authorEvent('freeSpinEnd', [
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
]);

// `setWin` — the win panel show + awaited count-up with win-level sound bookends, then hide.
authorEvent('setWin', [
	{ k: 'cue', ref: 'winShow' },
	{ k: 'action', ref: 'winShow', inputs: { winLevel: trig('winLevel') } },
	{ k: 'action', ref: 'winLevelSoundsPlay', inputs: { winLevel: trig('winLevel') } },
	{ k: 'action', ref: 'winUpdate', inputs: { amount: trig('amount'), winLevel: trig('winLevel') } },
	{ k: 'action', ref: 'winLevelSoundsStop' },
	{ k: 'cue', ref: 'winHide' },
	{ k: 'action', ref: 'winHide' },
]);

// `finalWin` is a no-op in the coded handler — left UN-authored so it falls through (its coded no-op),
// exactly as v1 did (proves the fall-through stays live). `createBonusSnapshot` (resume) stays coded.

/** The committed reference v2 book-of flow — every presentation event, 1:1 with the v1
 *  choreographies. Validates 0 issues vs `BOOK_OF_VOCAB`. */
export const LINES_FLOW_V2_DOC: FlowDocV2 = {
	version: 2,
	templateId: 'bookOf',
	graph: { nodes, exec, data },
	// The basegame scene persists under everything; overlays (specialBook / win / free-spin intro /
	// counter / outro) are coded-mounted + feed-driven (gated by `visibleSource`), exactly as v1 —
	// the flow fires their cues, it does not mount them as containers.
	containers: [{ id: 'basegame', sceneId: 'basegame', z: 0 }],
};

/** The committed reference v2 function library (empty — the events are linear/forEach chains). */
export const LINES_FLOW_V2_LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };
