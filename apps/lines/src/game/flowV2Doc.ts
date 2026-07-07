/**
 * Invisible Flow v2 — the committed REFERENCE book-of flow for apps/lines (Phase 5 migration
 * artifact). The v2 analogue of v1's `LINES_FLOW_DOC` (`flowDoc.ts`): a REAL authored flow, held in
 * the repo so v2 can drive a real game end-to-end WITHOUT authoring online first — loaded via the
 * `window.__IE_FLOW_V2_LINES__` dev global (mirroring v1's `__IE_FLOW_LINES__`) or shipped through
 * the baked bundle (`bakedFlowV2Doc()`).
 *
 * It authors the canonical book-of REVEAL against the real `BOOK_OF_VOCAB`: when the round's special
 * symbol is set, mount the special-book overlay, set the special symbol, fire the reveal cue, hold,
 * then fire the hide cue and unmount:
 *
 *   event setExpandingSymbol(symbol)
 *     → action  setSpecialSymbol(symbol ← event.symbol)
 *     → show    specialBook
 *     → fireCue specialBookReveal(symbol ← event.symbol)
 *     → delay   900ms
 *     → fireCue specialBookHide
 *     → hide    specialBook
 *
 * NOTE (coexistence, decided 2026-07-07 "ship-ready v2, keep v1"): v2 dispatch is ADDITIVE over the
 * coded/v1 path (Phase 4b), so with this doc loaded the coded `SpecialBook` reveal ALSO runs — the
 * doc is a reference + end-to-end verification fixture, not yet the sole production flow. The eventual
 * v1→v2 cutover (removing the coded reveal) is deliberately deferred; until then this drives the
 * container mount + cues on top of the coded mechanic.
 */

import type { FlowDoc as FlowDocV2, FunctionLibraryDoc } from 'engine-flow-v2';

/** The committed reference v2 book-of flow (the reveal). Validates 0 issues vs `BOOK_OF_VOCAB`. */
export const LINES_FLOW_V2_DOC: FlowDocV2 = {
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			{ id: 'onExpand', kind: 'event', pos: { x: 0, y: 160 }, ref: 'setExpandingSymbol' },
			{
				id: 'setSpecial',
				kind: 'action',
				pos: { x: 300, y: 160 },
				ref: 'setSpecialSymbol',
				inputs: { symbol: { kind: 'wire' } },
			},
			{ id: 'showBook', kind: 'showContainer', pos: { x: 600, y: 160 }, ref: 'specialBook' },
			{
				id: 'revealCue',
				kind: 'fireCue',
				pos: { x: 900, y: 160 },
				ref: 'specialBookReveal',
				inputs: { symbol: { kind: 'wire' } },
			},
			{
				id: 'hold',
				kind: 'delay',
				pos: { x: 1200, y: 160 },
				inputs: { ms: { kind: 'literal', type: { t: 'ms' }, value: 900 } },
			},
			{ id: 'hideCue', kind: 'fireCue', pos: { x: 1500, y: 160 }, ref: 'specialBookHide' },
			{ id: 'hideBook', kind: 'hideContainer', pos: { x: 1800, y: 160 }, ref: 'specialBook' },
		],
		exec: [
			{ from: { node: 'onExpand', pin: 'exec' }, to: { node: 'setSpecial', pin: 'exec' } },
			{ from: { node: 'setSpecial', pin: 'exec' }, to: { node: 'showBook', pin: 'exec' } },
			{ from: { node: 'showBook', pin: 'exec' }, to: { node: 'revealCue', pin: 'exec' } },
			{ from: { node: 'revealCue', pin: 'exec' }, to: { node: 'hold', pin: 'exec' } },
			{ from: { node: 'hold', pin: 'exec' }, to: { node: 'hideCue', pin: 'exec' } },
			{ from: { node: 'hideCue', pin: 'exec' }, to: { node: 'hideBook', pin: 'exec' } },
		],
		data: [
			// The event's `symbol` data-out feeds both the effect and the reveal cue.
			{ from: { node: 'onExpand', pin: 'symbol' }, to: { node: 'setSpecial', pin: 'symbol' } },
			{ from: { node: 'onExpand', pin: 'symbol' }, to: { node: 'revealCue', pin: 'symbol' } },
		],
	},
	containers: [
		{ id: 'basegame', sceneId: 'basegame', z: 0 },
		{ id: 'specialBook', sceneId: 'specialBook', z: 500 },
	],
};

/** The committed reference v2 function library (empty — the reveal is a linear chain). */
export const LINES_FLOW_V2_LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };
