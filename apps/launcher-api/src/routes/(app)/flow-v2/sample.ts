/**
 * Invisible Flow v2 — the DEV route `/flow-v2` shared-library fallback.
 *
 * The template VOCABULARY is the SHARED, single-source-of-truth `BOOK_OF_VOCAB` shipped from
 * `engine-flow-v2` (Phase 4c) — the SAME contract the apps/lines runtime BACKS — re-exported here so
 * the page's import path is unchanged. `LIBRARY` is the FALLBACK used when the GLOBAL function library
 * has no saved doc yet; it validates clean (0 issues) against the real `BOOK_OF_VOCAB`.
 *
 * (The project FlowDoc no longer has a client-side sample fallback: a fresh project is SEEDED
 * server-side with the canonical reference flow — see `flowV2Storage.loadFlowV2DocForEditor`.)
 *
 * The `StaggerStop` body is the per-reel stagger:
 *   Entry → ForEach(reels) →(body) compute($index × step) → Delay(ms ← compute) → stopReel($item.index)
 */

import { BOOK_OF_VOCAB } from 'engine-flow-v2';
import type { FunctionDef, FunctionLibraryDoc, TypeRef } from 'engine-flow-v2';

// Re-export the shared template vocabulary so the page keeps importing it from `./sample`.
export { BOOK_OF_VOCAB };

const REEL: TypeRef = { t: 'struct', name: 'Reel' };
const LIST_REEL: TypeRef = { t: 'list', of: REEL };

// ---------------------------------------------------------------------------
// StaggerStop(reels, step) — the reusable reel-stagger function (§5). Body:
//   Entry → ForEach(reels) →(body) compute($index × step) → Delay(ms) → stopReel($item.index)
// `$index × step` is a pure `compute` mul node (§9.2); the delay's `ms` is wired from it.
// ---------------------------------------------------------------------------

const STAGGER_STOP: FunctionDef = {
	id: 'fn.staggerStop',
	name: 'StaggerStop',
	inputs: [
		{ id: 'exec', dir: 'in', kind: 'exec' },
		{ id: 'reels', dir: 'in', kind: 'data', dataType: LIST_REEL, label: 'reels' },
		{ id: 'step', dir: 'in', kind: 'data', dataType: { t: 'ms' }, label: 'step' },
	],
	outputs: [{ id: 'exec', dir: 'out', kind: 'exec' }],
	body: {
		nodes: [
			{ id: 'entry', kind: 'functionEntry', pos: { x: -240, y: 0 }, ref: 'fn.staggerStop' },
			{
				id: 'each',
				kind: 'forEach',
				pos: { x: 0, y: 0 },
				mode: 'sequence',
				inputs: { in: { kind: 'accessor', path: { on: 'input', name: 'reels' } } },
			},
			{
				id: 'mul',
				kind: 'compute',
				pos: { x: 240, y: 120 },
				compute: {
					op: 'mul',
					a: { kind: 'accessor', path: { on: 'index' } },
					b: { kind: 'accessor', path: { on: 'input', name: 'step' } },
				},
			},
			{ id: 'wait', kind: 'delay', pos: { x: 240, y: 0 }, inputs: { ms: { kind: 'wire' } } },
			{
				id: 'stop',
				kind: 'action',
				pos: { x: 480, y: 0 },
				ref: 'stopReel',
				inputs: { index: { kind: 'accessor', path: { on: 'item', member: 'index' } } },
			},
			{ id: 'result', kind: 'functionResult', pos: { x: 720, y: 0 }, ref: 'fn.staggerStop' },
		],
		exec: [
			{ from: { node: 'entry', pin: 'exec' }, to: { node: 'each', pin: 'exec' } },
			{ from: { node: 'each', pin: 'body' }, to: { node: 'wait', pin: 'exec' } },
			{ from: { node: 'wait', pin: 'exec' }, to: { node: 'stop', pin: 'exec' } },
			{ from: { node: 'each', pin: 'done' }, to: { node: 'result', pin: 'exec' } },
		],
		data: [{ from: { node: 'mul', pin: 'out' }, to: { node: 'wait', pin: 'ms' } }],
	},
	requires: { actions: ['stopReel'], structs: ['Reel'], collections: ['reels'] },
};

export const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [STAGGER_STOP] };
