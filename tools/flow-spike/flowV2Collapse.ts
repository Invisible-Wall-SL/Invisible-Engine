/**
 * Invisible Flow v2 — 2c-core COLLAPSE harness (design `invisible-flow-v2-schema.md` §5).
 *
 *   pnpm --filter flow-spike run v2collapse
 *
 * Proves, HEADLESSLY, the pure "Collapse to Function" transform against the REAL
 * `engine-flow-v2` `collapseToFunction` + `derivePins` + `validateFlowDoc` +
 * `validateFunctionDef` — no editor, no UI. It hand-encodes a BOOK-OF FlowDoc:
 *
 *     event reveal ─(exec)→ forEach(reels) ─body→ delay ─→ stopReel($item.index)
 *                                 └─────────────done→ fireCue(specialBookReveal)
 *
 * selects the INNER `{ forEach, delay, stopReel }`, and collapses them into a function.
 *
 * The crossings for that selection:
 *   crossIn  exec  : reveal.exec → each.exec            → function INPUT  exec
 *   crossIn  data  : reveal.reels(list<Reel>) → each.in → function INPUT  reels: list<Reel>
 *   crossOut exec  : each.done → cue.exec               → function OUTPUT exec
 *   internal       : each.body → wait.exec, wait.exec → stop.exec
 *
 * Then asserts:
 *  1. the returned `library` now holds the new function (with `body`, entry+result).
 *  2. `validateFlowDoc(newDoc, vocab, newLibrary)` = 0 issues (main graph valid; the
 *     functionCall is wired to the SAME external endpoints — reveal on the in side, cue on out).
 *  3. `validateFunctionDef(theFn, vocab, newLibrary)` = 0 issues (entry/result present + wired).
 *  4. the function's inputs/outputs match the crossing pins (count + types): inputs = exec +
 *     `reels: list<Reel>`; outputs = exec only.
 *  5. a deliberately BAD selection (includes the `event` entry point) returns `{ error }`.
 *
 * Prints PASS/FAIL per assertion + a final `V2 COLLAPSE HARNESS: PASSED`.
 */

import {
	collapseToFunction,
	derivePins,
	validateFlowDoc,
	validateFunctionDef,
	type FlowDoc,
	type FunctionLibraryDoc,
	type Node,
	type PinContext,
	type TemplateVocabulary,
	type TypeRef,
} from 'engine-flow-v2';

// ---------------------------------------------------------------------------
// 1. The book-of TemplateVocabulary (mirrors flowV2Schema.ts).
// ---------------------------------------------------------------------------

const REEL: TypeRef = { t: 'struct', name: 'Reel' };
const LIST_REEL: TypeRef = { t: 'list', of: REEL };

const BOOK_OF_VOCAB: TemplateVocabulary = {
	templateId: 'book-of',
	structs: [{ name: 'Reel', fields: [{ name: 'index', type: { t: 'int' } }] }],
	enums: [{ name: 'SymbolName', values: ['H1', 'H2', 'H3', 'L1', 'L2', 'S'] }],
	events: [{ name: 'reveal', payload: [{ name: 'reels', type: LIST_REEL }] }],
	actions: [
		{ name: 'stopReel', params: [{ name: 'index', type: { t: 'int' } }], category: 'command' },
	],
	cues: [{ name: 'specialBookReveal', payload: [] }],
	collections: [{ name: 'reels', of: REEL }],
};

const EMPTY_LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

// ---------------------------------------------------------------------------
// 2. The source FlowDoc: reveal → forEach(reels) → delay → stopReel; forEach.done → fireCue.
// ---------------------------------------------------------------------------

const sourceDoc = (): FlowDoc => ({
	version: 2,
	templateId: 'book-of',
	graph: {
		nodes: [
			{ id: 'onReveal', kind: 'event', pos: { x: 0, y: 0 }, ref: 'reveal' },
			{
				id: 'each',
				kind: 'forEach',
				pos: { x: 200, y: 0 },
				mode: 'sequence',
				inputs: { in: { kind: 'wire' } },
			},
			{
				id: 'wait',
				kind: 'delay',
				pos: { x: 400, y: 0 },
				inputs: { ms: { kind: 'literal', type: { t: 'ms' }, value: 120 } },
			},
			{
				id: 'stop',
				kind: 'action',
				pos: { x: 600, y: 0 },
				ref: 'stopReel',
				inputs: { index: { kind: 'accessor', path: { on: 'item', member: 'index' } } },
			},
			{ id: 'cue', kind: 'fireCue', pos: { x: 800, y: 0 }, ref: 'specialBookReveal' },
		],
		exec: [
			{ from: { node: 'onReveal', pin: 'exec' }, to: { node: 'each', pin: 'exec' } },
			{ from: { node: 'each', pin: 'body' }, to: { node: 'wait', pin: 'exec' } },
			{ from: { node: 'wait', pin: 'exec' }, to: { node: 'stop', pin: 'exec' } },
			{ from: { node: 'each', pin: 'done' }, to: { node: 'cue', pin: 'exec' } },
		],
		data: [{ from: { node: 'onReveal', pin: 'reels' }, to: { node: 'each', pin: 'in' } }],
	},
	containers: [{ id: 'base', sceneId: 'basegame', z: 0 }],
});

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

const ctx: PinContext = { vocab: BOOK_OF_VOCAB, library: EMPTY_LIBRARY };
const typeEq = (a: TypeRef | undefined, b: TypeRef) => JSON.stringify(a) === JSON.stringify(b);
const issueList = (issues: { code: string; message: string }[]) =>
	issues.map((i) => `${i.code}:${i.message}`).join(' | ');

const main = () => {
	console.log('Invisible Flow v2 — 2c-core collapse harness\n');

	// --- run the collapse over the inner {each, wait, stop} ---
	const outcome = collapseToFunction(
		{
			doc: sourceDoc(),
			library: EMPTY_LIBRARY,
			selection: ['each', 'wait', 'stop'],
			functionId: 'fn.staggerStop',
			functionName: 'StaggerStop',
		},
		ctx,
	);

	if ('error' in outcome) {
		console.error(`  FAIL  collapse returned an error: ${outcome.error}`);
		console.log('\nV2 COLLAPSE HARNESS: FAILED');
		process.exit(1);
	}

	const { doc: newDoc, library: newLibrary, functionId } = outcome;
	const theFn = newLibrary.functions.find((f) => f.id === functionId)!;

	// --- 1. the library holds the new function ---
	console.log('1. the returned library holds the new function:');
	assert('library has fn.staggerStop', !!theFn);
	assert(
		'its body has an entry + a result node',
		!!theFn &&
			theFn.body.nodes.some((n) => n.kind === 'functionEntry' && n.ref === functionId) &&
			theFn.body.nodes.some((n) => n.kind === 'functionResult' && n.ref === functionId),
	);
	assert(
		'its body kept the 3 selected nodes (each/wait/stop)',
		!!theFn && ['each', 'wait', 'stop'].every((id) => theFn.body.nodes.some((n) => n.id === id)),
	);

	// --- 2. the new MAIN graph validates clean ---
	console.log('\n2. validateFlowDoc — new main graph:');
	{
		const issues = validateFlowDoc(newDoc, BOOK_OF_VOCAB, newLibrary);
		assert('new main graph has ZERO issues', issues.length === 0, issueList(issues));

		// the call node is present, the selected nodes are gone, and it's wired to reveal + cue.
		const callNode = newDoc.graph.nodes.find((n) => n.kind === 'functionCall');
		assert('a functionCall node replaced the selection', !!callNode);
		assert(
			'the selected nodes were removed from the main graph',
			!['each', 'wait', 'stop'].some((id) => newDoc.graph.nodes.some((n) => n.id === id)),
		);
		const callId = callNode?.id;
		assert(
			'reveal.exec now feeds the call exec-in (external in-side preserved)',
			newDoc.graph.exec.some(
				(e) => e.from.node === 'onReveal' && e.to.node === callId && e.to.pin === 'exec',
			),
		);
		assert(
			'reveal.reels now feeds a call data-in (external in-side preserved)',
			newDoc.graph.data.some((e) => e.from.node === 'onReveal' && e.to.node === callId),
		);
		assert(
			'the call exec-out now feeds cue.exec (external out-side preserved)',
			newDoc.graph.exec.some(
				(e) => e.from.node === callId && e.from.pin === 'exec' && e.to.node === 'cue',
			),
		);
	}

	// --- 3. the function BODY validates clean on its own ---
	console.log('\n3. validateFunctionDef — the new function body:');
	{
		const issues = validateFunctionDef(theFn, BOOK_OF_VOCAB, newLibrary);
		assert(
			'function body has ZERO issues (entry/result present + wired)',
			issues.length === 0,
			issueList(issues),
		);
	}

	// --- 4. inputs/outputs match the crossing pins ---
	console.log('\n4. the function inputs/outputs match the crossings:');
	{
		const inData = theFn.inputs.filter((p) => p.kind === 'data');
		const outData = theFn.outputs.filter((p) => p.kind === 'data');
		assert(
			'inputs = exec-in + exactly one data-in',
			theFn.inputs.length === 2 && inData.length === 1,
		);
		assert(
			'the one data input is `list<Reel>` (from reveal.reels → each.in)',
			typeEq(inData[0]?.dataType, LIST_REEL),
		);
		assert(
			'outputs = exec-out only (each.done → cue was an exec crossing)',
			theFn.outputs.length === 1 && outData.length === 0,
		);
		assert(
			'the call node derives the SAME pins (exec-in/out + reels data-in)',
			(() => {
				const callNode = newDoc.graph.nodes.find((n) => n.kind === 'functionCall') as Node;
				const pins = derivePins(callNode, { vocab: BOOK_OF_VOCAB, library: newLibrary });
				const dataIns = pins.filter((p) => p.dir === 'in' && p.kind === 'data');
				return (
					pins.some((p) => p.id === 'exec' && p.dir === 'in') &&
					pins.some((p) => p.id === 'exec' && p.dir === 'out') &&
					dataIns.length === 1 &&
					typeEq(dataIns[0]?.dataType, LIST_REEL)
				);
			})(),
		);
		assert(
			'requires captured stopReel (action) + Reel (struct, via the list<Reel> input)',
			theFn.requires.actions?.includes('stopReel') === true &&
				theFn.requires.structs?.includes('Reel') === true,
			JSON.stringify(theFn.requires),
		);
	}

	// --- 5. a bad selection (includes the event entry point) is rejected ---
	console.log('\n5. a bad selection is rejected:');
	{
		const bad = collapseToFunction(
			{
				doc: sourceDoc(),
				library: EMPTY_LIBRARY,
				selection: ['onReveal', 'each', 'wait', 'stop'],
				functionId: 'fn.bad',
				functionName: 'Bad',
			},
			ctx,
		);
		assert(
			'selection containing the `event` node returns {error}',
			'error' in bad,
			JSON.stringify(bad),
		);

		const empty = collapseToFunction(
			{
				doc: sourceDoc(),
				library: EMPTY_LIBRARY,
				selection: [],
				functionId: 'fn.e',
				functionName: 'E',
			},
			ctx,
		);
		assert('an empty selection returns {error}', 'error' in empty);

		const missing = collapseToFunction(
			{
				doc: sourceDoc(),
				library: EMPTY_LIBRARY,
				selection: ['nope'],
				functionId: 'fn.m',
				functionName: 'M',
			},
			ctx,
		);
		assert('a selection id not in the graph returns {error}', 'error' in missing);
	}

	// --- 6. purity: the source doc/library were not mutated ---
	console.log('\n6. purity — inputs are untouched:');
	{
		const src = sourceDoc();
		const before = JSON.stringify(src);
		const lib = EMPTY_LIBRARY;
		const libBefore = JSON.stringify(lib);
		collapseToFunction(
			{
				doc: src,
				library: lib,
				selection: ['each', 'wait', 'stop'],
				functionId: 'fn.x',
				functionName: 'X',
			},
			ctx,
		);
		assert('the input doc was not mutated', JSON.stringify(src) === before);
		assert('the input library was not mutated', JSON.stringify(lib) === libBefore);
	}

	console.log(`\n${failed ? 'V2 COLLAPSE HARNESS: FAILED' : 'V2 COLLAPSE HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

main();
