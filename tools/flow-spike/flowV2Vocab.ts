/**
 * Invisible Flow v2 — Phase 4c VOCABULARY harness.
 *
 *   pnpm --filter flow-spike run v2vocab
 *
 * Proves the reference `book-of` template vocabulary (`BOOK_OF_VOCAB`, shipped from
 * `engine-flow-v2`) is:
 *   1. INTERNALLY CONSISTENT — every struct/enum a payload/param/collection type names is declared;
 *      no duplicate declaration names; a shared function's `requires` (StaggerStop) is satisfiable.
 *   2. AUTHORABLE-AGAINST — a representative reference flow (the book-of reveal: stagger the reels
 *      off `$engine.reels`, set the special symbol from the event, fire the reveal cue) + the shared
 *      `StaggerStop` function both `validate*` with ZERO issues against the real vocab.
 *
 * This is the editor's + game's single-source-of-truth contract with the game replaced by nothing —
 * a pure data + validation check. It does NOT assert the game IMPLEMENTS each action/cue (that is
 * `flowEffects.ts` / the emitter, verified game-side); it asserts the CONTRACT is well-formed.
 *
 * Prints PASS/FAIL per assertion + a final `V2 VOCAB HARNESS: PASSED`.
 */

import {
	BOOK_OF_VOCAB,
	validateFlowDoc,
	validateFunctionDef,
	type FlowDoc,
	type FunctionDef,
	type FunctionLibraryDoc,
	type TemplateVocabulary,
	type TypeRef,
} from 'engine-flow-v2';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

// ---------------------------------------------------------------------------
// 1. Internal consistency.
// ---------------------------------------------------------------------------

/** Every struct/enum name a `TypeRef` (recursively) names. */
const nominalNames = (t: TypeRef, out: { structs: Set<string>; enums: Set<string> }): void => {
	if (t.t === 'list') nominalNames(t.of, out);
	else if (t.t === 'struct') out.structs.add(t.name);
	else if (t.t === 'enum') out.enums.add(t.name);
};

const collectReferenced = (v: TemplateVocabulary) => {
	const out = { structs: new Set<string>(), enums: new Set<string>() };
	for (const s of v.structs) for (const f of s.fields) nominalNames(f.type, out);
	for (const e of v.events) for (const p of e.payload) nominalNames(p.type, out);
	for (const a of v.actions) for (const p of a.params) nominalNames(p.type, out);
	for (const c of v.cues) for (const p of c.payload) nominalNames(p.type, out);
	for (const c of v.collections) nominalNames(c.of, out);
	return out;
};

const dupes = (names: string[]): string[] => {
	const seen = new Set<string>();
	const dup = new Set<string>();
	for (const n of names) (seen.has(n) ? dup : seen).add(n);
	return [...dup];
};

// ---------------------------------------------------------------------------
// 2. A representative reference flow + the shared StaggerStop function.
// ---------------------------------------------------------------------------

const REEL: TypeRef = { t: 'struct', name: 'Reel' };
const LIST_REEL: TypeRef = { t: 'list', of: REEL };

// StaggerStop(reels, step): forEach reels → delay($index × step) → stopReel($item.index).
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
			{ id: 'entry', kind: 'functionEntry', pos: { x: -200, y: 0 }, ref: 'fn.staggerStop' },
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
				pos: { x: 200, y: 120 },
				compute: {
					op: 'mul',
					a: { kind: 'accessor', path: { on: 'index' } },
					b: { kind: 'accessor', path: { on: 'input', name: 'step' } },
				},
			},
			{ id: 'wait', kind: 'delay', pos: { x: 200, y: 0 }, inputs: { ms: { kind: 'wire' } } },
			{
				id: 'stop',
				kind: 'action',
				pos: { x: 400, y: 0 },
				ref: 'stopReel',
				inputs: { index: { kind: 'accessor', path: { on: 'item', member: 'index' } } },
			},
			{ id: 'result', kind: 'functionResult', pos: { x: 600, y: 0 }, ref: 'fn.staggerStop' },
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

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [STAGGER_STOP] };

// event setExpandingSymbol(symbol) → StaggerStop(reels ← $engine.reels, step=120)
//   → setSpecialSymbol(symbol ← event.symbol) → fireCue specialBookReveal(symbol ← event.symbol).
const REVEAL_DOC: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			{ id: 'onExpand', kind: 'event', pos: { x: 0, y: 0 }, ref: 'setExpandingSymbol' },
			{
				id: 'stagger',
				kind: 'functionCall',
				pos: { x: 300, y: 0 },
				ref: 'fn.staggerStop',
				inputs: {
					reels: { kind: 'accessor', path: { on: 'engine', key: 'reels' } },
					step: { kind: 'literal', type: { t: 'ms' }, value: 120 },
				},
			},
			{
				id: 'setSpecial',
				kind: 'action',
				pos: { x: 600, y: 0 },
				ref: 'setSpecialSymbol',
				inputs: { symbol: { kind: 'wire' } },
			},
			{ id: 'cue', kind: 'fireCue', pos: { x: 900, y: 0 }, ref: 'specialBookReveal' },
		],
		exec: [
			{ from: { node: 'onExpand', pin: 'exec' }, to: { node: 'stagger', pin: 'exec' } },
			{ from: { node: 'stagger', pin: 'exec' }, to: { node: 'setSpecial', pin: 'exec' } },
			{ from: { node: 'setSpecial', pin: 'exec' }, to: { node: 'cue', pin: 'exec' } },
		],
		data: [
			{ from: { node: 'onExpand', pin: 'symbol' }, to: { node: 'setSpecial', pin: 'symbol' } },
			{ from: { node: 'onExpand', pin: 'symbol' }, to: { node: 'cue', pin: 'symbol' } },
		],
	},
	containers: [{ id: 'base', sceneId: 'basegame', z: 0 }],
};

// ---------------------------------------------------------------------------

const main = () => {
	console.log('Invisible Flow v2 — Phase 4c vocabulary harness\n');

	console.log('1. BOOK_OF_VOCAB internal consistency:');
	{
		const declaredStructs = new Set(BOOK_OF_VOCAB.structs.map((s) => s.name));
		const declaredEnums = new Set(BOOK_OF_VOCAB.enums.map((e) => e.name));
		const ref = collectReferenced(BOOK_OF_VOCAB);
		const missingStructs = [...ref.structs].filter((n) => !declaredStructs.has(n));
		const missingEnums = [...ref.enums].filter((n) => !declaredEnums.has(n));
		assert(
			'every referenced struct is declared',
			missingStructs.length === 0,
			missingStructs.join(','),
		);
		assert('every referenced enum is declared', missingEnums.length === 0, missingEnums.join(','));

		const dupNames = [
			...dupes(BOOK_OF_VOCAB.structs.map((s) => s.name)),
			...dupes(BOOK_OF_VOCAB.enums.map((e) => e.name)),
			...dupes(BOOK_OF_VOCAB.events.map((e) => e.name)),
			...dupes(BOOK_OF_VOCAB.actions.map((a) => a.name)),
			...dupes(BOOK_OF_VOCAB.cues.map((c) => c.name)),
			...dupes(BOOK_OF_VOCAB.collections.map((c) => c.name)),
		];
		assert('no duplicate declaration names', dupNames.length === 0, dupNames.join(','));

		// The shared StaggerStop is offered only where its `requires` is satisfied — assert book-of does.
		const req = STAGGER_STOP.requires;
		const actionNames = new Set(BOOK_OF_VOCAB.actions.map((a) => a.name));
		const collNames = new Set(BOOK_OF_VOCAB.collections.map((c) => c.name));
		const satisfied =
			(req.actions ?? []).every((a) => actionNames.has(a)) &&
			(req.structs ?? []).every((s) => declaredStructs.has(s)) &&
			(req.collections ?? []).every((c) => collNames.has(c));
		assert('StaggerStop.requires (stopReel / Reel / reels) satisfied by book-of', satisfied);
	}

	console.log('\n2. a representative reference flow validates clean against the real vocab:');
	{
		const fnIssues = validateFunctionDef(STAGGER_STOP, BOOK_OF_VOCAB, LIBRARY);
		assert(
			'StaggerStop body validates with 0 issues',
			fnIssues.length === 0,
			fnIssues.map((i) => `${i.code}:${i.message}`).join(' | '),
		);

		const docIssues = validateFlowDoc(REVEAL_DOC, BOOK_OF_VOCAB, LIBRARY);
		assert(
			'the book-of reveal flow validates with 0 issues',
			docIssues.length === 0,
			docIssues.map((i) => `${i.code}:${i.message}`).join(' | '),
		);
	}

	console.log(`\n${failed ? 'V2 VOCAB HARNESS: FAILED' : 'V2 VOCAB HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

main();
