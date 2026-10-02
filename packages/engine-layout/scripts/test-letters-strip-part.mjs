// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
// Verify the Letters Strip's skinning (Hold and Win Phase 12c): the Letter Tile's dim and lit nodes
// sit inside its `Letter` part, each shown in one state by a `letter.{reel}.lit` binding and drawn
// as the coded letter draws it; the tile is scoped by its reel and pulses as the coded letter does;
// the strip's `tile` param picks a component and is blank by default (the coded letters, parity);
// the strip stands for its part and counts in under one name, so a copy of any id steps the coded
// row aside; and a strip saved before all this gets the param and the stand-in back by id.
//
//   node scripts/test-letters-strip-part.mjs
//
// Same esbuild-bundle trick as test-pot-skin.mjs: bundle the real modules and assert against them.
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: `export {
			COMPONENT_PARAM_KINDS,
			HOLD_AND_WIN_COMPONENTS,
			LETTERS_STRIP_DEF,
			LETTERS_STRIP_MOUNT,
			LETTER_TILE_DEF,
			VALUE_BINDING_SOURCE_CATALOG,
			boundComponentSkin,
			expandSourceTemplate,
			mergeBuiltinCodedParams,
			partStandIn,
			resolveComponentParams,
		} from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-letters-strip-part.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `letters-strip-part-test-${process.pid}.mjs`);
await writeFile(tmp, bundled.outputFiles[0].text, 'utf8');
let mod;
try {
	mod = await import(pathToFileURL(tmp).href);
} finally {
	await rm(tmp, { force: true });
}

let failures = 0;
const assert = (cond, msg) => {
	if (cond) {
		console.info(`  ✓ ${msg}`);
	} else {
		console.error(`  ✗ ${msg}`);
		failures += 1;
	}
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tile = mod.LETTER_TILE_DEF;
const strip = mod.LETTERS_STRIP_DEF;

console.info('the letter tile');
const [part, ...rest] = tile.root.children;
assert(rest.length === 0, 'the root holds only the Letter part');
assert(part.kind === 'container' && part.bind?.component === 'LetterTilePart', 'a coded part');
const byId = Object.fromEntries(part.children.map((n) => [n.id, n]));
assert(
	same(Object.keys(byId), [
		'letterTile-art',
		'letterTile-litArt',
		'letterTile-dim',
		'letterTile-lit',
	]),
	'the dim and lit art, then the dim and lit letter, inside it',
);
const shownBy = (node) => node.valueBindings?.find((b) => b.target === 'visible');
for (const id of ['letterTile-art', 'letterTile-dim']) {
	const binding = shownBy(byId[id]);
	assert(
		binding?.source === 'letter.{reel}.lit' && binding.below === true,
		`${id} shows while its letter is dim`,
	);
}
for (const id of ['letterTile-litArt', 'letterTile-lit']) {
	const binding = shownBy(byId[id]);
	assert(
		binding?.source === 'letter.{reel}.lit' && !binding.below,
		`${id} shows once its letter is lit`,
	);
}
assert(
	byId['letterTile-dim'].paramBindings?.text === 'letter' &&
		byId['letterTile-lit'].paramBindings?.text === 'letter',
	'both letters read the letter param',
);
assert(
	byId['letterTile-art'].paramBindings?.region === 'tileImage' &&
		byId['letterTile-litArt'].paramBindings?.region === 'litTileImage',
	'the art reads tileImage / litTileImage',
);
const dim = byId['letterTile-dim'];
const lit = byId['letterTile-lit'];
assert(
	dim.alpha === 0.45 &&
		dim.style.fill === 0x6b6b6b &&
		same(dim.style.stroke, { color: 0x000000, width: 6 }),
	'dim, as the coded letter draws it',
);
assert(
	lit.alpha === undefined &&
		lit.style.fill === 0xffd24a &&
		same(lit.style.stroke, { color: 0x7a3d00, width: 6 }),
	'lit, as the coded letter draws it',
);
assert(
	[dim, lit].every(
		(n) =>
			n.style.fontFamily === 'Arial' && n.style.fontWeight === 'bold' && n.style.fontSize === 43.2,
	),
	"the coded letter's font: Arial bold, 0.36 of a 120 px cell",
);
assert(
	tile.signalScope === 'reel' && tile.signalScopeKind === 'reel',
	'scoped by its reel, so a Letter lit cue plays on its own letter (12a)',
);
const tileParams = mod.resolveComponentParams(tile, {});
assert(tileParams.pulseScale === 1.6, 'pulses as the coded letter does (1.6)');
assert(tileParams.reel === 0 && tileParams.letter === 'G', 'a sample reel and letter by default');
assert(tile.standsFor === undefined && mod.partStandIn(tile) === undefined, 'stands for no part');
assert(same(mod.boundComponentSkin('LetterTilePart'), { layers: [] }), 'skinnable in the editors');
assert(
	mod.expandSourceTemplate('letter.{reel}.lit', { reel: 0 }) === 'letter.0.lit' &&
		mod.expandSourceTemplate('letter.{reel}.lit', { reel: 3 }) === 'letter.3.lit',
	'each tile reads its own column (reel 0 included)',
);
assert(
	mod.VALUE_BINDING_SOURCE_CATALOG.some(
		(e) => e.key === 'letter.{reel}.lit' && e.needsParam === 'reel',
	),
	'the source picker offers it inside a tile',
);
assert(
	mod.HOLD_AND_WIN_COMPONENTS.includes(tile) && tile.capability === 'holdAndWin',
	'a Hold and Win built-in',
);

console.info('the strip');
const tileParam = strip.params.find((p) => p.key === 'tile');
assert(tileParam?.kind === 'component', 'its tile is picked from the components');
assert(mod.COMPONENT_PARAM_KINDS.includes('component'), 'a kind saved copies keep');
const stripParams = mod.resolveComponentParams(strip, {});
assert(stripParams.tile === '', 'blank by default: the coded letters (parity)');
assert(stripParams.spacing === 120, 'the spacing default is unchanged');
assert(
	same(
		strip.root.children.map((n) => n.bind?.component),
		['LettersStrip'],
	),
	'still the one coded part',
);
assert(strip.standsFor === 'LettersStrip', 'it stands for its part');
assert(mod.partStandIn(strip) === undefined, 'the built-in binds it: no stand-in');
assert(
	mod.LETTERS_STRIP_MOUNT === strip.id,
	'the part counts in under the built-in id, so the coded row steps aside for any copy',
);

console.info('a strip saved before the tile');
const saved = { ...strip, params: strip.params.filter((p) => p.key !== 'tile') };
delete saved.standsFor;
const merged = mod.mergeBuiltinCodedParams(saved);
assert(
	merged.params.some((p) => p.key === 'tile' && p.kind === 'component'),
	'gets the tile param back by id',
);
assert(merged.standsFor === 'LettersStrip', 'gets standsFor back by id');
assert(mod.resolveComponentParams(merged, {}).tile === '', 'and still draws the coded letters');
const flat = { ...merged, root: { ...merged.root, children: [] } };
assert(mod.partStandIn(flat) === 'LettersStrip', 'with its part deleted, the part stands in');

if (failures > 0) {
	console.error(`\n${failures} assertion(s) failed`);
	process.exit(1);
}
console.info('\nall letters-strip-part assertions passed');
