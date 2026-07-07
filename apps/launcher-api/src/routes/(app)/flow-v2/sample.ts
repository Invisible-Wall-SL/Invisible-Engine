/**
 * Invisible Flow v2 — Phase 2a sample fixture (DEV route `/flow-v2`).
 *
 * A REAL, VALID `FlowDoc` for the `bookOf` template, consumed unchanged by the canvas.
 * It reuses the reel-stagger vocabulary/function/flow shape proven headlessly by the
 * Phase-1 schema spike (`tools/flow-spike/flowV2Schema.ts`), so this route renders the
 * same graph the validator already blesses:
 *
 *   event `reveal` (payload: reels: list<Reel>)
 *     →(exec) functionCall `StaggerStop`   (reels ← reveal.reels; step ← literal 120ms)
 *     →(exec) action `setSpecialSymbol`     (symbol ← literal SymbolName 'S')
 *     →(exec) fireCue `specialBookReveal`
 *
 * The `StaggerStop` FunctionDef body is the per-reel stagger:
 *   Entry → ForEach(reels) →(body) compute($index × step) → Delay(ms ← compute) → stopReel($item.index)
 *
 * It must pass `validateFlowDoc(SAMPLE_DOC, BOOK_OF_VOCAB, LIBRARY)` with ZERO issues.
 */

import type {
	FlowDoc,
	FunctionDef,
	FunctionLibraryDoc,
	TemplateVocabulary,
	TypeRef,
} from 'engine-flow-v2';

const REEL: TypeRef = { t: 'struct', name: 'Reel' };
const LIST_REEL: TypeRef = { t: 'list', of: REEL };
const SYMBOL_NAME: TypeRef = { t: 'enum', name: 'SymbolName' };

// ---------------------------------------------------------------------------
// The book-of TemplateVocabulary — the contract the flow is authored against
// (declared by the template, not the editor). §7 of the schema.
// ---------------------------------------------------------------------------

export const BOOK_OF_VOCAB: TemplateVocabulary = {
	templateId: 'bookOf',
	structs: [{ name: 'Reel', fields: [{ name: 'index', type: { t: 'int' } }] }],
	enums: [{ name: 'SymbolName', values: ['H1', 'H2', 'H3', 'L1', 'L2', 'S'] }],
	events: [{ name: 'reveal', payload: [{ name: 'reels', type: LIST_REEL }] }],
	actions: [
		{ name: 'setSpecialSymbol', params: [{ name: 'symbol', type: SYMBOL_NAME }], category: 'effect' },
		{ name: 'stopReel', params: [{ name: 'index', type: { t: 'int' } }], category: 'command' },
	],
	cues: [
		{ name: 'specialBookReveal', payload: [] },
		{ name: 'specialBookHide', payload: [] },
	],
	collections: [{ name: 'reels', of: REEL }],
};

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
		],
		exec: [
			{ from: { node: 'each', pin: 'body' }, to: { node: 'wait', pin: 'exec' } },
			{ from: { node: 'wait', pin: 'exec' }, to: { node: 'stop', pin: 'exec' } },
		],
		data: [{ from: { node: 'mul', pin: 'out' }, to: { node: 'wait', pin: 'ms' } }],
	},
	requires: { actions: ['stopReel'], structs: ['Reel'], collections: ['reels'] },
};

export const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [STAGGER_STOP] };

// ---------------------------------------------------------------------------
// The FlowDoc: reveal → StaggerStop → setSpecialSymbol → fireCue specialBookReveal.
// ---------------------------------------------------------------------------

export const SAMPLE_DOC: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			{ id: 'onReveal', kind: 'event', pos: { x: 40, y: 160 }, ref: 'reveal' },
			{
				id: 'stagger',
				kind: 'functionCall',
				pos: { x: 360, y: 120 },
				ref: 'fn.staggerStop',
				inputs: {
					reels: { kind: 'wire' },
					step: { kind: 'literal', type: { t: 'ms' }, value: 120 },
				},
			},
			{
				id: 'setSpecial',
				kind: 'action',
				pos: { x: 700, y: 120 },
				ref: 'setSpecialSymbol',
				inputs: { symbol: { kind: 'literal', type: SYMBOL_NAME, value: 'S' } },
			},
			{ id: 'revealCue', kind: 'fireCue', pos: { x: 1020, y: 120 }, ref: 'specialBookReveal' },
		],
		exec: [
			{ from: { node: 'onReveal', pin: 'exec' }, to: { node: 'stagger', pin: 'exec' } },
			{ from: { node: 'stagger', pin: 'exec' }, to: { node: 'setSpecial', pin: 'exec' } },
			{ from: { node: 'setSpecial', pin: 'exec' }, to: { node: 'revealCue', pin: 'exec' } },
		],
		data: [{ from: { node: 'onReveal', pin: 'reels' }, to: { node: 'stagger', pin: 'reels' } }],
	},
	containers: [{ id: 'base', sceneId: 'basegame', z: 0 }],
};
