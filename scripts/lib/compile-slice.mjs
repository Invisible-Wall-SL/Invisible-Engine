// THE SLICE-COMPILES GUARD — for every offline fixture that slices shipped source and evaluates it
// with `new Function`.
//
// WHY IT EXISTS. These fixtures cannot import what they test (Svelte components, runes modules,
// `$lib`-aliased server code), so they cut a function out of the real file by brace balance and
// compile the text. That text is TypeScript, and it has to become JavaScript first. Two things then
// go wrong, and neither announces itself as what it is:
//
//  1. THE SLICE'S SHAPE MOVES. A fixture that strips types with its own regexes only knows the
//     annotation shapes someone happened to write. #734 turned `(node: LayoutNode): void =>` into
//     `(node: LayoutNode, ownerDef?: ComponentDef): void =>`; `verify-board-tiles.mjs`'s
//     single-parameter regex left the annotation in place and the file died on
//     `SyntaxError: Unexpected token ':'` at `<anonymous_script>:54` — a line number inside a string
//     nobody can open, naming no fixture, no source file and no function. It sat red on `main` for
//     a week with parts 1-4 passing and part 5 asserting nothing.
//  2. THE COMPILE FAILS AT ALL. Even with a correct stripper, an anchor that drifts mid-function
//     hands `new Function` an unbalanced fragment. Same bare `SyntaxError`, same anonymous frame.
//
// This is the same family as `stub-set-guard.mjs` — "a guard that throws guards nothing" — but one
// step EARLIER, and the two do not overlap. The stub-set guard type-checks the body as TypeScript,
// so leftover TypeScript passes it cleanly; the text then reaches `new Function` and throws. A
// SyntaxError is not a missing name and will never appear in `tsc`'s undefined-name codes. Wiring
// one does not cover the other.
//
// WHAT IT DOES. `stripSliceTypes` uses Node's OWN TypeScript stripper instead of hand-written
// regexes, so a shape nobody anticipated is not a shape it can miss — case 1 stops being a class of
// bug rather than being repaired one annotation at a time. `compileSlice` wraps `new Function` so
// case 2 reports the fixture, the slice, the parser's complaint and the offending LINE OF SOURCE,
// which is the difference between "someone renamed this" and "`<anonymous_script>:54`".

import { stripTypeScriptTypes } from 'node:module';
import { compileFunction } from 'node:vm';

// `stripTypeScriptTypes` is flagged experimental, and the warning would be the loudest line in a
// passing run. Silenced narrowly — anything else Node has to say still gets through.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
	const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
	if (type === 'ExperimentalWarning' && String(warning).includes('stripTypeScriptTypes')) return;
	emitWarning(warning, ...rest);
};

/**
 * A TypeScript source slice, as the JavaScript a fixture can evaluate.
 *
 * `mode: 'strip'` blanks annotations in place rather than re-emitting, so every line and column in
 * a later parse error still points at the real source. It refuses `enum`/`namespace`/parameter
 * properties — deliberately: those need a real transform, and a fixture that silently got one
 * would be asserting against code the shipped file does not contain.
 *
 * @param {string} what   The slice, for the message — e.g. `editorArtExport.ts#collectArtRefs`.
 * @param {string} source The sliced TypeScript.
 */
export const stripSliceTypes = (what, source) => {
	try {
		return stripTypeScriptTypes(source, { mode: 'strip' });
	} catch (error) {
		throw new Error(
			`${what}: the slice is not strippable TypeScript — ${error.message}\n` +
				'    The slice is not a complete, self-contained declaration any more: an anchor drifted\n' +
				'    mid-function, or the source grew syntax `mode: "strip"` refuses (enum, namespace, a\n' +
				'    constructor parameter property). Re-cut the slice.\n' +
				'    See scripts/lib/compile-slice.mjs.',
		);
	}
};

/**
 * Compile a fixture body with `new Function`, reporting a parse failure as the fixture's own,
 * attributed error instead of a bare `SyntaxError` from `<anonymous_script>`.
 *
 * @param {object} options
 * @param {string} options.what      The fixture + slice, for the message.
 * @param {string[]} options.names   The parameter names the body is compiled with (the stub set).
 * @param {string} options.body      The exact text handed to `new Function`.
 * @returns {Function} The compiled function, ready to be called with the stub values.
 */
export const compileSlice = ({ what, names, body }) => {
	try {
		return new Function(...names, body);
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error;
		throw new Error(
			`${what}: the compiled slice does not parse as JavaScript — ${error.message}\n` +
				`${codeFrame(what, names, body)}` +
				'    Either the type stripping did not remove everything (an annotation shape it does not\n' +
				"    know about — use `stripSliceTypes`, which is Node's own stripper), or a slice anchor\n" +
				'    drifted and the text is an unbalanced fragment. Until this compiles, every check that\n' +
				'    follows asserts NOTHING.\n' +
				'    See scripts/lib/compile-slice.mjs.',
		);
	}
};

/**
 * The parser's own code frame — `<name>:<line>`, the source line and the caret under the token.
 *
 * `new Function` will not give it up: its SyntaxError carries `at new Function (<anonymous>)` and
 * no position at all, and the `<anonymous_script>:54` V8 prints for an UNCAUGHT one goes straight
 * to stderr without ever reaching `error.stack`. So the same text is recompiled through
 * `vm.compileFunction`, whose SyntaxError does put the frame in `stack` — and under a `filename`
 * naming the slice, so the reader gets `editorArtExport.ts#collectArtRefs:54` where the bare
 * failure gave them a line inside a string they cannot open.
 *
 * Diagnosis only: the compile that RUNS is still `new Function`, unchanged. A recompile that
 * somehow succeeds means the frame is unavailable, never that the slice is fine.
 */
const codeFrame = (what, names, body) => {
	try {
		compileFunction(body, names, { filename: what });
	} catch (error) {
		const frame = String(error.stack ?? '')
			.split('\n')
			.slice(0, 3)
			.filter((line) => line.trim());
		if (frame.length === 3) return frame.map((line) => `    ${line}`).join('\n') + '\n';
	}
	return '';
};
