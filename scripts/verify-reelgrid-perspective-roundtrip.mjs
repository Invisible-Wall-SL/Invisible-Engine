// Does a `reelGrid` node's PERSPECTIVE block survive a save?
//
//   node scripts/verify-reelgrid-perspective-roundtrip.mjs
//
// WHY THIS EXISTS. The editor's save path normalizes what it stores, and it does so with TWO
// different policies that are easy to confuse:
//
//   * `normalizeScene` is a strict WHITELIST — it rebuilds the scene field by field, so a field it
//     has never heard of is silently dropped on save. That is a bug this repo has shipped more than
//     once: `Scene.role` first, then `alwaysOnTop`, `behindReels`, `zoomWithAnticipation`. Each of
//     those now has a line in the whitelist and a comment saying why.
//   * `normalizeNode` is PASS-THROUGH — it validates `kind` against `NODE_KINDS` and a non-empty
//     `id`, then returns the node whole, deliberately, "to preserve forward-compatible fields".
//
// That pass-through is also why the tail of this file asserts what is NOT on the block: the board's
// BEHAVIOUR moved to the game config (`reelBehaviour`), and pass-through would happily carry a
// stale `swapInPlace` back out of an old doc forever.
//
// So a new field on `ReelGridNode` should survive where the same field on `Scene` would not. That
// is a claim about code we did not write, standing between an author's input and the runtime, and
// "should" is not good enough for a field the whole perspective feature is switched on by — an
// author would set `farScale`, save, reload, and find a flat board with nothing to blame. So assert
// it, and assert it against the REAL normalizer rather than a description of it.
//
// The normalizer is sliced out of the shipped source (it is TypeScript, and not exported), so this
// fails loudly if the function is renamed or its policy changes — which is exactly when someone
// needs to be told.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'apps/launcher-api/src/lib/server/editorStorage.ts');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const source = readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');

/** Slice one top-level `function name(...) { ... }` out of the source, by brace balance. */
const sliceFunction = (name) => {
	const start = source.indexOf(`function ${name}(`);
	if (start < 0) throw new Error(`editorStorage.ts no longer defines ${name}()`);
	let depth = 0;
	for (let i = source.indexOf('{', start); i < source.length; i += 1) {
		if (source[i] === '{') depth += 1;
		else if (source[i] === '}') {
			depth -= 1;
			if (depth === 0) return source.slice(start, i + 1);
		}
	}
	throw new Error(`could not find the end of ${name}() in editorStorage.ts`);
};

const kindsMatch = source.match(
	/const NODE_KINDS = new Set<LayoutNode\['kind'\]>\(\[([\s\S]*?)\]\)/,
);
if (!kindsMatch) throw new Error('editorStorage.ts no longer declares NODE_KINDS');
const NODE_KINDS = new Set(
	kindsMatch[1]
		.split(',')
		.map((entry) => entry.trim().replace(/^'|'$/g, ''))
		.filter(Boolean),
);

// Strip the TS type annotations the two functions carry, then evaluate them together.
const strip = (fn) =>
	fn
		// The signature's return type, between the closing paren and the body's brace.
		.replace(/\)\s*:\s*[^{]+\{/, ') {')
		// Parameter annotations (`input: unknown`, `v: unknown`).
		.replace(/([(,]\s*\w+)\s*:\s*unknown\b/g, '$1')
		.replace(/ as unknown as LayoutNode/g, '')
		.replace(/ as LayoutNode\['kind'\]/g, '');

const normalizeNode = new Function(
	'NODE_KINDS',
	`${strip(sliceFunction('isRecord'))}\n${strip(sliceFunction('normalizeNode'))}\nreturn normalizeNode;`,
)(NODE_KINDS);

let failures = 0;
let checks = 0;
const check = (label, actual, expected) => {
	checks += 1;
	if (!Object.is(actual, expected)) {
		failures += 1;
		console.log(`FAIL  ${label}  got=${JSON.stringify(actual)}  want=${JSON.stringify(expected)}`);
	}
};

if (!NODE_KINDS.has('reelGrid')) {
	failures += 1;
	console.log("FAIL  'reelGrid' is not in NODE_KINDS — every reel-grid node is dropped on save");
}

// A reel-grid node carrying a full perspective block, alongside the lattice fields it already has,
// so a regression that dropped `perspective` while keeping `cellSize` is still caught.
const node = {
	kind: 'reelGrid',
	id: 'grid-1',
	x: 100,
	y: 200,
	cellSize: 120,
	cellWidth: 150,
	cellHeight: 90,
	gapX: 4,
	gapY: 6,
	reelPadding: 0.53,
	rowPadding: 0.5,
	perspective: { farScale: 0.6, vanishX: 320 },
};

const saved = normalizeNode(structuredClone(node));

check('the node survives normalization at all', saved !== null && saved !== undefined, true);
check('perspective block survives', typeof saved?.perspective, 'object');
check('farScale survives', saved?.perspective?.farScale, 0.6);
check('vanishX survives', saved?.perspective?.vanishX, 320);
// The lattice fields alongside it, so this fails for the right reason if the policy ever changes.
check('cellSize survives', saved?.cellSize, 120);
check('gapY survives', saved?.gapY, 6);

// A perspective-only node (no lattice extras) — the shape a first-time author saves.
const minimal = normalizeNode({ kind: 'reelGrid', id: 'g2', perspective: { farScale: 0.5 } });
check('minimal node survives', minimal?.perspective?.farScale, 0.5);

// The board's BEHAVIOUR is NOT here. `swapInPlace` lived on this block while the mode was first
// built and has moved to the game config's `reelBehaviour`, because a `reelGrid` node is authored
// PER layoutType and the schema therefore allowed a board that rolled in portrait and swapped in
// landscape. Asserted rather than assumed, because `normalizeNode` is PASS-THROUGH: it would carry
// a stale `swapInPlace` from an old doc straight back out, and a reader still looking for it there
// would keep working on exactly the docs where it is wrong.
const layoutTypes = read('packages/engine-layout/src/lib/types.ts');
const layoutResolver = read('packages/engine-layout/src/lib/reelGrid.ts');
check(
	'ReelGridPerspective no longer declares swapInPlace',
	layoutTypes.includes('swapInPlace'),
	false,
);
check(
	'and resolveReelGridPerspective no longer reads it',
	layoutResolver.includes('swapInPlace'),
	false,
);

// And the guards still reject what they always rejected, so this is not just "returns its input".
check('unknown kind is rejected', normalizeNode({ kind: 'nope', id: 'x' }), null);
check('missing id is rejected', normalizeNode({ kind: 'reelGrid' }), null);
check('empty id is rejected', normalizeNode({ kind: 'reelGrid', id: '' }), null);
check('a non-object is rejected', normalizeNode('reelGrid'), null);

console.log('');
if (failures) {
	console.log(`${failures} FAILED of ${checks} checks`);
	process.exit(1);
}
console.log(
	`${checks} checks — a reelGrid node's perspective block survives the editor save path intact, and
` + `carries SHAPE only: the board's behaviour lives in the game config.`,
);
