/**
 * Invisible Flow v2 — OPTIONAL PARAM harness.
 *
 *   pnpm --filter flow-spike run v2optional
 *
 * The vocabulary had no way to say "this param may be left unfed", so `unfilled-data-in` errored on
 * EVERY declared param. That flagged the author for doing exactly what the param's own help invites
 * — `cameraEffect.durationMs` ("leave unset for the kind's default") and
 * `enableSequentialReelStop.gaps` ("leave both unset ⇒ the coded constants") both reported an error
 * for being left alone. `ParamDecl.optional` closes that, and `Pin.optional` carries it from the
 * vocabulary to the validator + the inspector (§2 anti-drift: derived, never stored on the node).
 *
 * The risk in a fix like this is that it becomes a blanket mute — so the CONTROLS matter more than
 * the passes: a REQUIRED param must still error, on the very same node.
 *
 * Asserts:
 *   1. `optional` reaches the derived pin (the editor + validator read it from one place), and each
 *      param's `description` reaches `Pin.doc` — the tooltip the decl's own docstring promises.
 *   2. A bare `cameraEffect` (nothing stored — the state after dropping the node) reports EXACTLY
 *      one `unfilled-data-in`, for the required `kind`. CONTROL: it still errors.
 *   3. Storing `kind` alone clears the node — the three optional params stay unfed.
 *   4. A bare `enableSequentialReelStop` is clean (the pre-existing case of the same bug).
 *   5. CONTROL — a bare `setWinBookEventAmount` (required `amount`, no `optional`) STILL errors, so
 *      assertion 2/4's "clean" is a real result and not the check being blind.
 *   6. CONTROL — an optional pin fed a WRONG-TYPE literal still reports `literal-type`. Optional
 *      means "may be absent", never "unchecked when present".
 *
 * Prints PASS/FAIL per assertion + a final `V2 OPTIONAL PARAM HARNESS: PASSED`.
 */

import {
	BOOK_OF_VOCAB,
	derivePins,
	validateFlowDoc,
	type FlowDoc,
	type FunctionLibraryDoc,
	type Node,
	type Pin,
} from 'engine-flow-v2';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

/** A doc holding one bare action node — the state the editor leaves after dropping it. */
const docWith = (node: Node): FlowDoc => ({
	version: 2,
	templateId: 'bookOf',
	containers: [],
	graph: { nodes: [node], exec: [], data: [] },
});

const actionNode = (id: string, ref: string, inputs?: Node['inputs']): Node =>
	({ id, kind: 'action', ref, pos: { x: 0, y: 0 }, ...(inputs ? { inputs } : {}) }) as Node;

const issuesFor = (doc: FlowDoc) => validateFlowDoc(doc, BOOK_OF_VOCAB, LIBRARY);
const unfilled = (doc: FlowDoc) => issuesFor(doc).filter((i) => i.code === 'unfilled-data-in');

const main = () => {
	console.log('1. `optional` + `description` reach the DERIVED pin (one source: the vocabulary):');
	{
		const pins = derivePins(actionNode('a', 'cameraEffect'), {
			vocab: BOOK_OF_VOCAB,
			library: LIBRARY,
		});
		const dataIns = pins.filter((p: Pin) => p.dir === 'in' && p.kind === 'data');
		const byId = new Map(dataIns.map((p: Pin) => [p.id, p]));

		assert('cameraEffect derives 4 data-ins', dataIns.length === 4, `got ${dataIns.length}`);
		assert('`kind` is REQUIRED', byId.get('kind')?.optional !== true);
		for (const id of ['durationMs', 'intensity', 'blocking']) {
			assert(`\`${id}\` is optional`, byId.get(id)?.optional === true);
		}
		assert(
			'every param description reaches Pin.doc (the promised tooltip)',
			dataIns.every((p: Pin) => typeof p.doc === 'string' && p.doc.length > 0),
			dataIns
				.filter((p: Pin) => !p.doc)
				.map((p: Pin) => p.id)
				.join(', ') || undefined,
		);
	}

	console.log('\n2. a BARE cameraEffect errors ONLY for the required `kind`:');
	{
		const found = unfilled(docWith(actionNode('action-17', 'cameraEffect')));
		assert('exactly 1 unfilled-data-in', found.length === 1, `got ${found.length}`);
		assert(
			'…and it is `kind`',
			found[0]?.at.on === 'pin' && found[0].at.pin === 'kind',
			found.map((i) => (i.at.on === 'pin' ? i.at.pin : '?')).join(', '),
		);
	}

	console.log('\n3. storing `kind` alone clears the node (optionals stay unfed):');
	{
		const node = actionNode('action-17', 'cameraEffect', {
			kind: { kind: 'literal', type: { t: 'enum', name: 'CameraEffectKind' }, value: 'shake' },
		});
		const found = issuesFor(docWith(node));
		assert('0 issues', found.length === 0, found.map((i) => `${i.code}:${i.message}`).join(' | '));
	}

	console.log('\n4. a BARE enableSequentialReelStop is clean (same bug, pre-existing):');
	{
		const found = issuesFor(docWith(actionNode('a1', 'enableSequentialReelStop')));
		assert('0 issues', found.length === 0, found.map((i) => i.code).join(', '));
	}

	console.log('\n5. CONTROL — a required param on another action STILL errors:');
	{
		const found = unfilled(docWith(actionNode('a2', 'setWinBookEventAmount')));
		assert(
			'bare setWinBookEventAmount reports unfilled `amount`',
			found.length === 1 && found[0].at.on === 'pin' && found[0].at.pin === 'amount',
			`got ${found.length}`,
		);
	}

	console.log('\n6. CONTROL — optional means "may be absent", NOT "unchecked when present":');
	{
		const node = actionNode('a3', 'cameraEffect', {
			kind: { kind: 'literal', type: { t: 'enum', name: 'CameraEffectKind' }, value: 'shake' },
			// `intensity` is a float; hand it a string.
			intensity: { kind: 'literal', type: { t: 'string' }, value: 'hard' },
		});
		const found = issuesFor(docWith(node));
		assert(
			'a wrong-typed optional literal reports literal-type/type-mismatch',
			found.some((i) => i.code === 'literal-type' || i.code === 'type-mismatch'),
			found.length ? found.map((i) => i.code).join(', ') : 'no issues reported',
		);
	}

	console.log(
		`\n${failed ? 'V2 OPTIONAL PARAM HARNESS: FAILED' : 'V2 OPTIONAL PARAM HARNESS: PASSED'}`,
	);
	process.exit(failed ? 1 : 0);
};

main();
