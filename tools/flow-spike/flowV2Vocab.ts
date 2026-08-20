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
	WAYS_VOCAB,
	templateVocabulary,
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

	console.log('1. internal consistency, per registered template:');
	for (const vocab of [BOOK_OF_VOCAB, WAYS_VOCAB]) {
		const id = vocab.templateId;
		const declaredStructs = new Set(vocab.structs.map((s) => s.name));
		const declaredEnums = new Set(vocab.enums.map((e) => e.name));
		const ref = collectReferenced(vocab);
		const missingStructs = [...ref.structs].filter((n) => !declaredStructs.has(n));
		const missingEnums = [...ref.enums].filter((n) => !declaredEnums.has(n));
		assert(
			`${id}: every referenced struct is declared`,
			missingStructs.length === 0,
			missingStructs.join(','),
		);
		assert(
			`${id}: every referenced enum is declared`,
			missingEnums.length === 0,
			missingEnums.join(','),
		);

		const dupNames = [
			...dupes(vocab.structs.map((s) => s.name)),
			...dupes(vocab.enums.map((e) => e.name)),
			...dupes(vocab.events.map((e) => e.name)),
			...dupes(vocab.actions.map((a) => a.name)),
			...dupes(vocab.cues.map((c) => c.name)),
			...dupes(vocab.collections.map((c) => c.name)),
		];
		assert(`${id}: no duplicate declaration names`, dupNames.length === 0, dupNames.join(','));

		// The shared StaggerStop is offered only where its `requires` is satisfied — assert both are.
		const req = STAGGER_STOP.requires;
		const actionNames = new Set(vocab.actions.map((a) => a.name));
		const collNames = new Set(vocab.collections.map((c) => c.name));
		const satisfied =
			(req.actions ?? []).every((a) => actionNames.has(a)) &&
			(req.structs ?? []).every((s) => declaredStructs.has(s)) &&
			(req.collections ?? []).every((c) => collNames.has(c));
		assert(`${id}: StaggerStop.requires (stopReel / Reel / reels) satisfied`, satisfied);
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

	console.log('\n3. WAYS_VOCAB is the standard palette, and the registry actually serves it:');
	{
		// Ways adds no mechanic: it must be the standard set MINUS the six book-of surfaces, and
		// nothing else. Asserted in both directions so neither list can quietly grow.
		const names = <T extends { name: string }>(l: T[]) => l.map((x) => x.name);
		const only = <T extends { name: string }>(a: T[], b: T[]) =>
			names(a).filter((n) => !names(b).includes(n));

		assert(
			'ways offers no event book-of does not',
			only(WAYS_VOCAB.events, BOOK_OF_VOCAB.events).length === 0,
		);
		assert(
			'ways offers no action book-of does not',
			only(WAYS_VOCAB.actions, BOOK_OF_VOCAB.actions).length === 0,
		);
		assert(
			'ways offers no cue book-of does not',
			only(WAYS_VOCAB.cues, BOOK_OF_VOCAB.cues).length === 0,
		);

		const bookOnly = [
			...only(BOOK_OF_VOCAB.events, WAYS_VOCAB.events),
			...only(BOOK_OF_VOCAB.actions, WAYS_VOCAB.actions),
			...only(BOOK_OF_VOCAB.cues, WAYS_VOCAB.cues),
		].sort();
		assert(
			'the whole difference is the six book-mechanic surfaces',
			JSON.stringify(bookOnly) ===
				JSON.stringify(
					[
						'expandBookColumns',
						'expandBookColumns',
						'setExpandingSymbol',
						'setSpecialSymbol',
						'specialBookHide',
						'specialBookReveal',
					].sort(),
				),
			bookOnly.join(','),
		);

		// The symbol dropdown is the one per-type value: ways ships H5 and no L5.
		const symbols = (v: TemplateVocabulary) =>
			v.enums.find((e) => e.name === 'SymbolName')?.values ?? [];
		assert(
			'ways declares its OWN symbol set (H5, no L5)',
			symbols(WAYS_VOCAB).includes('H5') && !symbols(WAYS_VOCAB).includes('L5'),
			symbols(WAYS_VOCAB).join(','),
		);

		// The reason this vocabulary had to exist: an unregistered id silently rides the book-of
		// fallback, so a ways project was offered a palette its runtime never fires.
		assert(
			"templateVocabulary('ways') resolves to the ways vocab, not the fallback",
			templateVocabulary('ways').templateId === 'ways',
		);
		assert(
			'an unknown id still falls back to book-of (parity)',
			templateVocabulary('no-such-template').templateId === 'bookOf',
		);

		// And the palette genuinely CONSTRAINS: the book-of reveal flow must NOT validate against ways.
		const waysIssues = validateFlowDoc(REVEAL_DOC, WAYS_VOCAB, LIBRARY);
		assert(
			'the book-of reveal flow is REJECTED against the ways vocab',
			waysIssues.length > 0,
			'validated clean — the ways palette is not constraining anything',
		);
	}

	console.log(`\n${failed ? 'V2 VOCAB HARNESS: FAILED' : 'V2 VOCAB HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

main();
