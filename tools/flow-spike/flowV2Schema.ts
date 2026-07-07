/**
 * Invisible Flow v2 — Phase 1 SCHEMA harness (design docs `invisible-flow-v2.md` +
 * `invisible-flow-v2-schema.md`).
 *
 *   pnpm --filter flow-spike run v2schema
 *
 * Proves, HEADLESSLY, the v2 data model end-to-end against the REAL `engine-flow-v2`
 * types + `derivePins` + `assignable` + `validateFlowDoc` — no editor, no runtime. It
 * hand-encodes:
 *
 *  1. a BOOK-OF `TemplateVocabulary` — struct `Reel { index:int }`, enum `SymbolName`,
 *     event `reveal → { reels: list<Reel> }`, actions `setSpecialSymbol(symbol)` (effect)
 *     + `stopReel(index:int)` (command), a `reels: list<Reel>` collection, and cues
 *     incl. `specialBookReveal`;
 *  2. the `StaggerStop(reels, step)` FunctionDef whose body IS the reel-stagger:
 *       ForEach reels → Delay(compute: $index × step) → stopReel($item.index)
 *     (note the `compute` node computing `$index × step` — the §9.2 pure-value path);
 *  3. a FlowDoc that calls `StaggerStop` from the `reveal` event, wiring `reveal.reels`
 *     into the call's `reels` input.
 *
 * Then asserts, per the schema's connect-time contract:
 *  A. `derivePins` follows the ANTI-DRIFT rule (event data-outs = payload, action data-ins =
 *     params, forEach exposes body/item/index/done, functionCall mirrors the FunctionDef).
 *  B. `assignable` honors STRICT structural equality + the one `ms`↔`int` widening (§9.1).
 *  C. the GOOD FlowDoc validates with ZERO errors.
 *  D. a deliberately BROKEN copy — wiring the `reels: list<Reel>` payload straight into
 *     `stopReel`'s `index:int` pin — produces the expected typed `type-mismatch` error.
 *
 * Prints PASS/FAIL per assertion and a final `V2 SCHEMA HARNESS: PASSED`.
 */

import {
	assignable,
	derivePins,
	validateFlowDoc,
	type FlowDoc,
	type FunctionDef,
	type FunctionLibraryDoc,
	type Graph,
	type Node,
	type Pin,
	type PinContext,
	type TemplateVocabulary,
	type TypeRef,
} from 'engine-flow-v2';

// ---------------------------------------------------------------------------
// 1. The book-of TemplateVocabulary (the contract the flow is authored against).
// ---------------------------------------------------------------------------

const REEL: TypeRef = { t: 'struct', name: 'Reel' };
const LIST_REEL: TypeRef = { t: 'list', of: REEL };

const BOOK_OF_VOCAB: TemplateVocabulary = {
	templateId: 'book-of',
	structs: [{ name: 'Reel', fields: [{ name: 'index', type: { t: 'int' } }] }],
	enums: [{ name: 'SymbolName', values: ['H1', 'H2', 'H3', 'L1', 'L2', 'S'] }],
	events: [{ name: 'reveal', payload: [{ name: 'reels', type: LIST_REEL }] }],
	actions: [
		{
			name: 'setSpecialSymbol',
			params: [{ name: 'symbol', type: { t: 'enum', name: 'SymbolName' } }],
			category: 'effect',
		},
		{ name: 'stopReel', params: [{ name: 'index', type: { t: 'int' } }], category: 'command' },
	],
	cues: [
		{ name: 'specialBookReveal', payload: [] },
		{ name: 'specialBookHide', payload: [] },
	],
	collections: [{ name: 'reels', of: REEL }],
};

// ---------------------------------------------------------------------------
// 2. StaggerStop(reels, step) — the reel-stagger function. Body:
//      Entry → ForEach(reels) →(body) Delay(ms = $index × step) → stopReel($item.index)
//    with `$index × step` authored as a `compute` mul node (§9.2). The delay's `ms` pin is
//    wired FROM the compute `out`; stopReel's `index` reads `$item.index` via accessor.
// ---------------------------------------------------------------------------

const STAGGER_STOP: FunctionDef = {
	id: 'fn.staggerStop',
	name: 'StaggerStop',
	// The call node's exposed pins: exec-in + `reels: list<Reel>` + `step: ms`; exec-out.
	inputs: [
		{ id: 'exec', dir: 'in', kind: 'exec' },
		{ id: 'reels', dir: 'in', kind: 'data', dataType: LIST_REEL, label: 'reels' },
		{ id: 'step', dir: 'in', kind: 'data', dataType: { t: 'ms' }, label: 'step' },
	],
	outputs: [{ id: 'exec', dir: 'out', kind: 'exec' }],
	body: {
		nodes: [
			// The forEach over the `reels` input (read via `$input.reels`).
			{
				id: 'each',
				kind: 'forEach',
				pos: { x: 0, y: 0 },
				mode: 'sequence',
				inputs: { in: { kind: 'accessor', path: { on: 'input', name: 'reels' } } },
			},
			// $index × step (step read via $input.step). A pure compute mul → out:int.
			{
				id: 'mul',
				kind: 'compute',
				pos: { x: 200, y: 0 },
				compute: {
					op: 'mul',
					a: { kind: 'accessor', path: { on: 'index' } },
					b: { kind: 'accessor', path: { on: 'input', name: 'step' } },
				},
			},
			// Delay ms ← the compute out (a wired data-in).
			{ id: 'wait', kind: 'delay', pos: { x: 400, y: 0 }, inputs: { ms: { kind: 'wire' } } },
			// stopReel(index ← $item.index).
			{
				id: 'stop',
				kind: 'action',
				pos: { x: 600, y: 0 },
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

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [STAGGER_STOP] };

// ---------------------------------------------------------------------------
// 3. A FlowDoc calling StaggerStop from the `reveal` event.
//      reveal →(exec) StaggerStop;  reveal.reels →(data) StaggerStop.reels;
//      StaggerStop.step ← literal 120ms.
// ---------------------------------------------------------------------------

const goodGraph = (): Graph => ({
	nodes: [
		{ id: 'onReveal', kind: 'event', pos: { x: 0, y: 0 }, ref: 'reveal' },
		{
			id: 'stagger',
			kind: 'functionCall',
			pos: { x: 300, y: 0 },
			ref: 'fn.staggerStop',
			inputs: { reels: { kind: 'wire' }, step: { kind: 'literal', type: { t: 'ms' }, value: 120 } },
		},
	],
	exec: [{ from: { node: 'onReveal', pin: 'exec' }, to: { node: 'stagger', pin: 'exec' } }],
	data: [{ from: { node: 'onReveal', pin: 'reels' }, to: { node: 'stagger', pin: 'reels' } }],
});

const GOOD_DOC: FlowDoc = {
	version: 2,
	templateId: 'book-of',
	graph: goodGraph(),
	containers: [{ id: 'base', sceneId: 'basegame', z: 0 }],
};

// The BROKEN copy: an inline `stopReel` action wired DIRECTLY from `reveal.reels`
// (list<Reel>) into its `index:int` pin — the canonical typed mismatch.
const BROKEN_DOC: FlowDoc = {
	version: 2,
	templateId: 'book-of',
	graph: {
		nodes: [
			{ id: 'onReveal', kind: 'event', pos: { x: 0, y: 0 }, ref: 'reveal' },
			{ id: 'stopBad', kind: 'action', pos: { x: 300, y: 0 }, ref: 'stopReel', inputs: {} },
		],
		exec: [{ from: { node: 'onReveal', pin: 'exec' }, to: { node: 'stopBad', pin: 'exec' } }],
		// list<Reel> → int : must be a `type-mismatch`.
		data: [{ from: { node: 'onReveal', pin: 'reels' }, to: { node: 'stopBad', pin: 'index' } }],
	},
	containers: [{ id: 'base', sceneId: 'basegame', z: 0 }],
};

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

const ctx: PinContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY };
const pin = (pins: Pin[], id: string): Pin | undefined => pins.find((p) => p.id === id);
const typeEq = (a: TypeRef | undefined, b: TypeRef) => JSON.stringify(a) === JSON.stringify(b);

const main = () => {
	console.log('Invisible Flow v2 — Phase 1 schema harness\n');

	// --- A. ANTI-DRIFT pin derivation ---
	console.log('A. derivePins — pins are DERIVED from ref + vocabulary/library:');
	{
		const evt: Node = { id: 'e', kind: 'event', pos: { x: 0, y: 0 }, ref: 'reveal' };
		const evtPins = derivePins(evt, ctx);
		assert(
			'event: NO exec-in, an exec-out, and a `reels: list<Reel>` data-out',
			!evtPins.some((p) => p.dir === 'in' && p.kind === 'exec') &&
				evtPins.some((p) => p.dir === 'out' && p.kind === 'exec') &&
				typeEq(pin(evtPins, 'reels')?.dataType, LIST_REEL),
		);

		const act: Node = { id: 'a', kind: 'action', pos: { x: 0, y: 0 }, ref: 'stopReel', inputs: {} };
		const actPins = derivePins(act, ctx);
		assert(
			'action stopReel: exec-in + exec-out + `index: int` data-in',
			actPins.some((p) => p.id === 'exec' && p.dir === 'in') &&
				actPins.some((p) => p.id === 'exec' && p.dir === 'out') &&
				typeEq(pin(actPins, 'index')?.dataType, { t: 'int' }),
		);

		const each: Node = {
			id: 'l',
			kind: 'forEach',
			pos: { x: 0, y: 0 },
			mode: 'sequence',
			inputs: { in: { kind: 'accessor', path: { on: 'engine', key: 'reels' } } },
		};
		const eachPins = derivePins(each, ctx);
		assert(
			'forEach: exposes body/item/index/done, item typed to Reel (element of $engine.reels)',
			['body', 'item', 'index', 'done'].every((id) => pin(eachPins, id)) &&
				typeEq(pin(eachPins, 'item')?.dataType, REEL) &&
				typeEq(pin(eachPins, 'index')?.dataType, { t: 'int' }),
		);

		const call: Node = {
			id: 'c',
			kind: 'functionCall',
			pos: { x: 0, y: 0 },
			ref: 'fn.staggerStop',
			inputs: {},
		};
		const callPins = derivePins(call, ctx);
		assert(
			'functionCall: pins MIRROR the FunctionDef inputs/outputs (reels, step, execs)',
			typeEq(pin(callPins, 'reels')?.dataType, LIST_REEL) &&
				typeEq(pin(callPins, 'step')?.dataType, { t: 'ms' }) &&
				callPins.filter((p) => p.kind === 'exec').length === 2,
		);

		const mul: Node = {
			id: 'm',
			kind: 'compute',
			pos: { x: 0, y: 0 },
			compute: {
				op: 'mul',
				a: { kind: 'accessor', path: { on: 'index' } },
				b: { kind: 'literal', type: { t: 'ms' }, value: 120 },
			},
		};
		const mulPins = derivePins(mul, ctx);
		assert(
			'compute mul: NO exec pins, a single `out: int` data-out',
			mulPins.length === 1 && typeEq(pin(mulPins, 'out')?.dataType, { t: 'int' }),
		);
	}

	// --- B. strict assignable + the one ms↔int widening ---
	console.log('\nB. assignable — strict structural equality + the ms↔int widening (§9.1):');
	{
		assert('int → int', assignable({ t: 'int' }, { t: 'int' }));
		assert('ms → int (widening allowed)', assignable({ t: 'ms' }, { t: 'int' }));
		assert('int → ms (widening allowed)', assignable({ t: 'int' }, { t: 'ms' }));
		assert(
			'int → float REJECTED (needs a compute cast)',
			!assignable({ t: 'int' }, { t: 'float' }),
		);
		assert('list<Reel> → int REJECTED', !assignable(LIST_REEL, { t: 'int' }));
		assert('list<Reel> → list<Reel>', assignable(LIST_REEL, LIST_REEL));
		assert(
			'enum SymbolName → enum SymbolName',
			assignable({ t: 'enum', name: 'SymbolName' }, { t: 'enum', name: 'SymbolName' }),
		);
		assert(
			'enum SymbolName → enum Other REJECTED',
			!assignable({ t: 'enum', name: 'SymbolName' }, { t: 'enum', name: 'Other' }),
		);
	}

	// --- C. the GOOD FlowDoc validates with ZERO errors ---
	console.log('\nC. validateFlowDoc — good fixture:');
	{
		const issues = validateFlowDoc(GOOD_DOC, BOOK_OF_VOCAB, LIBRARY);
		assert(
			'good FlowDoc has ZERO issues',
			issues.length === 0,
			issues.map((i) => `${i.code}:${i.message}`).join(' | '),
		);

		// The StaggerStop function BODY also validates clean against the same vocab/library
		// (proves the compute/forEach/accessor wiring inside a function body is legal).
		const bodyDoc: FlowDoc = {
			version: 2,
			templateId: 'book-of',
			graph: STAGGER_STOP.body,
			containers: [],
		};
		const bodyIssues = validateFlowDoc(bodyDoc, BOOK_OF_VOCAB, LIBRARY);
		assert(
			'StaggerStop body validates clean (compute→delay→stopReel wiring is legal)',
			bodyIssues.length === 0,
			bodyIssues.map((i) => `${i.code}:${i.message}`).join(' | '),
		);
	}

	// --- D. the BROKEN copy raises the expected typed mismatch ---
	console.log('\nD. validateFlowDoc — broken fixture (list<Reel> wired into index:int):');
	{
		const issues = validateFlowDoc(BROKEN_DOC, BOOK_OF_VOCAB, LIBRARY);
		const mismatch = issues.find((i) => i.code === 'type-mismatch');
		assert('broken FlowDoc produces a `type-mismatch` error', !!mismatch);
		assert(
			'the mismatch is located on the bad data edge → stopBad.index',
			mismatch?.at.on === 'dataEdge' &&
				mismatch.at.to.node === 'stopBad' &&
				mismatch.at.to.pin === 'index',
			JSON.stringify(mismatch?.at),
		);
		assert(
			'the mismatch is the ONLY error (no spurious issues)',
			issues.filter((i) => i.severity === 'error').length === 1,
			issues.map((i) => i.code).join(','),
		);
	}

	console.log(`\n${failed ? 'V2 SCHEMA HARNESS: FAILED' : 'V2 SCHEMA HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

main();
