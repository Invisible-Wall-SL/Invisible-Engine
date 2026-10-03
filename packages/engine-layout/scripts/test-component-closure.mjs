// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
// Verify the component closure the doc bake, the runtime bundle and the art export share
// (`resolveComponentClosure`): a component a `component`-kind param names (the Letters Strip's
// `tile`) ships like a nested instance, whether the name is on a placed instance, a per-ratio
// override, the def's own default or the project's defaults; a doc that names none resolves in the
// same order as the plain instance walk; and the project's defaults are read only for a def that
// has such a param.
//
//   node scripts/test-component-closure.mjs
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
			JACKPOT_BAR_DEF,
			JACKPOT_TILE_DEF,
			LETTERS_STRIP_DEF,
			LETTER_TILE_DEF,
			collectComponentIds,
			resolveComponentClosure,
		} from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-component-closure.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `component-closure-test-${process.pid}.mjs`);
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

const myTile = { ...mod.LETTER_TILE_DEF, id: 'myTile', scope: 'project' };
const LIBRARY = {
	lettersStrip: mod.LETTERS_STRIP_DEF,
	letterTile: mod.LETTER_TILE_DEF,
	myTile,
	jackpotBar: mod.JACKPOT_BAR_DEF,
	jackpotTile: mod.JACKPOT_TILE_DEF,
};
const loaded = [];
const load = async (id) => {
	loaded.push(id);
	return LIBRARY[id] ?? null;
};
const strip = (extra = {}) => ({
	id: 'strip',
	kind: 'componentInstance',
	componentId: 'lettersStrip',
	x: 0,
	y: 0,
	...extra,
});
const resolve = async (nodes, options) => {
	loaded.length = 0;
	return Object.keys(await mod.resolveComponentClosure(nodes, load, options));
};

console.info('a tile named on the placed strip');
assert(
	same(await resolve([strip({ params: { tile: 'myTile' } })]), ['lettersStrip', 'myTile']),
	'ships the strip and the tile it names',
);
assert(
	same(await resolve([strip({ overrides: { portrait: { params: { tile: 'myTile' } } } })]), [
		'lettersStrip',
		'myTile',
	]),
	'…named only in a per-ratio override',
);
assert(
	same(await resolve([strip({ params: { tile: 'noSuchTile' } })]), ['lettersStrip']),
	'a tile with no def is skipped',
);
assert(
	same(await resolve([strip({ params: { tile: 'lettersStrip' } })]), ['lettersStrip']),
	'a strip naming itself loads once',
);

console.info('a tile named by a default');
const asked = [];
const defaultsFor = (id) => {
	asked.push(id);
	return id === 'lettersStrip' ? { tile: 'myTile' } : undefined;
};
assert(
	same(await resolve([strip()], { defaultsFor }), ['lettersStrip', 'myTile']),
	"…by the project's defaults for the strip",
);
assert(same(asked, ['lettersStrip']), 'defaults read only for a def with a component param');
const stripCopy = {
	...mod.LETTERS_STRIP_DEF,
	id: 'myStrip',
	params: mod.LETTERS_STRIP_DEF.params.map((p) =>
		p.key === 'tile' ? { ...p, default: 'myTile' } : p,
	),
};
LIBRARY.myStrip = stripCopy;
assert(
	same(await resolve([strip({ componentId: 'myStrip' })]), ['myStrip', 'myTile']),
	"…by a strip copy's own default",
);
assert(
	same(
		await resolve([
			{
				id: 'holder',
				kind: 'container',
				x: 0,
				y: 0,
				children: [strip({ params: { tile: 'myTile' } })],
			},
		]),
		['lettersStrip', 'myTile'],
	),
	'…on a strip inside a container',
);

console.info('parity');
const doc = [
	{ id: 'bar', kind: 'componentInstance', componentId: 'jackpotBar', x: 0, y: 0 },
	strip(),
];
const plain = mod.collectComponentIds(doc);
assert(
	same(await resolve(doc), ['jackpotBar', 'lettersStrip', 'jackpotTile']),
	'a doc naming no component through a param: instances, then their nested defs',
);
assert(same(loaded, [...plain, 'jackpotTile']), 'loaded in the plain walk’s order, each once');
assert(
	same(await resolve([], { extraSeedIds: ['jackpotTile', 'nope'] }), ['jackpotTile']),
	'extra seeds still resolve, a missing one skipped',
);

if (failures > 0) {
	console.error(`\n${failures} assertion(s) failed`);
	process.exit(1);
}
console.info('\nall component-closure assertions passed');
