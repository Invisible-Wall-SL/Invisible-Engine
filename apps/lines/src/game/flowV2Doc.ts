/**
 * Invisible Flow v2 — the committed REFERENCE book-of flow for apps/lines (the v1→v2 migration
 * artifact). The v2 analogue of v1's `LINES_FLOW_DOC` (`flowDoc.ts`): a REAL authored flow, held in
 * the repo so v2 can drive a real game WITHOUT authoring online first — loaded via the
 * `window.__IE_FLOW_V2_LINES__` dev global (mirroring v1's `__IE_FLOW_LINES__`) or shipped through
 * the baked bundle (`bakedFlowV2Doc()`).
 *
 * It reproduces the coded `setExpandingSymbol` handler EXACTLY, so when v2 OWNS that event (event
 * ownership, `game/utils.ts`) the coded/v1 twin is suppressed and v2 drives it with NO behaviour
 * change — the incremental "make it work like it is now" migration, one event at a time. The coded
 * handler is:
 *
 *   stateGame.specialSymbol = symbol;                            → action setSpecialSymbol(symbol)
 *   await broadcastAsync({ type:'specialBookReveal', symbol });  → fireCue specialBookReveal(symbol)
 *
 * i.e. set the round's special symbol, then fire the reveal cue and WAIT for it (the always-mounted
 * `SpecialBook` component runs the shuffle→land→intro; the v2 env broadcasts AWAITED, so the flow
 * blocks until it finishes, matching the coded `broadcastAsync`). `SpecialBook` is mounted by the
 * coded scene, so the flow only fires the cue — it does NOT show a container (that would double it).
 *
 * As more events are migrated, add their `event` nodes here (each authored to reproduce its coded
 * handler); ownership then hands each to v2 automatically. When every event is owned + verified, the
 * coded `bookEventHandlerMap` becomes dead code — the full-flow-driven end state.
 */

import type { FlowDoc as FlowDocV2, FunctionLibraryDoc } from 'engine-flow-v2';

/** The committed reference v2 book-of flow. Validates 0 issues vs `BOOK_OF_VOCAB`. */
export const LINES_FLOW_V2_DOC: FlowDocV2 = {
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			{ id: 'onExpand', kind: 'event', pos: { x: 0, y: 160 }, ref: 'setExpandingSymbol' },
			{
				id: 'setSpecial',
				kind: 'action',
				pos: { x: 320, y: 160 },
				ref: 'setSpecialSymbol',
				inputs: { symbol: { kind: 'wire' } },
			},
			{
				id: 'revealCue',
				kind: 'fireCue',
				pos: { x: 640, y: 160 },
				ref: 'specialBookReveal',
				inputs: { symbol: { kind: 'wire' } },
			},
		],
		exec: [
			{ from: { node: 'onExpand', pin: 'exec' }, to: { node: 'setSpecial', pin: 'exec' } },
			{ from: { node: 'setSpecial', pin: 'exec' }, to: { node: 'revealCue', pin: 'exec' } },
		],
		data: [
			// The event's `symbol` data-out feeds both the effect and the reveal cue (as the coded
			// handler passes `bookEvent.symbol` to both the state set and the broadcast).
			{ from: { node: 'onExpand', pin: 'symbol' }, to: { node: 'setSpecial', pin: 'symbol' } },
			{ from: { node: 'onExpand', pin: 'symbol' }, to: { node: 'revealCue', pin: 'symbol' } },
		],
	},
	// The basegame scene persists under everything; `SpecialBook` is coded-mounted (the flow fires the
	// cue, it does not mount a container). Listed for completeness — the flow shows/hides none here.
	containers: [{ id: 'basegame', sceneId: 'basegame', z: 0 }],
};

/** The committed reference v2 function library (empty — the reveal is a linear chain). */
export const LINES_FLOW_V2_LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };
