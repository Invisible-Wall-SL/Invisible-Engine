// @ts-nocheck — a Node script inside a browser package's `include: ["."]`; its tsconfig has no Node
// types or top-level await, so checking it only adds noise to the package's svelte-check.
// Verify the respin cell tiles' skinning (Hold and Win Phase 12c): the Cell Tile holds its tile and a
// held overlay inside its `Cell` part, the overlay shown only while the board's `held` is 1; it is
// still by default and stands for no part; the Respin Cell Tiles' `tile` param picks a component the
// tile declares every fed param for, and is blank by default (the `tileImage` stamping, parity); a
// copy saved before it gets the param back by id; and a tile named there ships with the game.
//
//   node scripts/test-cell-tile.mjs
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
			CELL_TILE_DEF,
			HOLD_AND_WIN_COMPONENTS,
			LETTER_TILE_DEF,
			RESPIN_CELLS_DEF,
			boundComponentSkin,
			evaluateBinding,
			mergeBuiltinCodedParams,
			partStandIn,
			resolveComponentClosure,
			resolveComponentParams,
		} from '../src/lib/index.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-cell-tile.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `cell-tile-test-${process.pid}.mjs`);
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
const tile = mod.CELL_TILE_DEF;
const cells = mod.RESPIN_CELLS_DEF;

console.info('the cell tile');
const [part, ...rest] = tile.root.children;
assert(rest.length === 0, 'the root holds only the Cell part');
assert(part.kind === 'container' && part.bind?.component === 'CellTilePart', 'a coded part');
const [base, held] = part.children;
assert(
	same(
		part.children.map((n) => n.id),
		['cellTile-tile', 'cellTile-held'],
	),
	'the tile, then the held overlay, inside it',
);
assert(
	base.paramBindings?.region === 'tileImage' && base.paramBindings?.tint === 'tileTint',
	'the tile reads tileImage / tileTint',
);
assert(!base.valueBindings, 'the tile always shows');
const shownBy = held.valueBindings?.find((b) => b.target === 'visible');
assert(
	held.paramBindings?.region === 'heldImage' && shownBy?.param === 'held',
	'the overlay reads heldImage, shown by the held param',
);
assert(
	mod.evaluateBinding(shownBy, 1) === 1 && mod.evaluateBinding(shownBy, 0) === 0,
	'shown while held is 1, hidden at 0',
);
assert(
	tile.params.find((p) => p.key === 'held')?.engineProvided === true,
	'held is fed by the board (engine-provided)',
);
const params = mod.resolveComponentParams(tile, {});
assert(params.landPulseScale === 1, 'still by default, as the coded tiles are');
assert(params.reel === 0 && params.row === 0, 'a sample cell by default');
assert(
	[base, held].every((n) => n.width === 120 && n.height === 120),
	'authored on one cell’s box (120 square)',
);
assert(tile.standsFor === undefined && mod.partStandIn(tile) === undefined, 'stands for no part');
assert(same(mod.boundComponentSkin('CellTilePart'), { layers: [] }), 'skinnable in the editors');
assert(
	mod.HOLD_AND_WIN_COMPONENTS.includes(tile) && tile.capability === 'holdAndWin',
	'a Hold and Win built-in',
);

console.info('the respin cell tiles');
const tileParam = cells.params.find((p) => p.key === 'tile');
assert(tileParam?.kind === 'component', 'its tile is picked from the components');
assert(same(tileParam?.fedParams, ['reel', 'row', 'held']), 'fed each cell’s reel, row and held');
const declares = (def) => tileParam.fedParams.every((key) => def.params.some((p) => p.key === key));
assert(declares(tile), 'the picker offers the Cell Tile');
assert(!declares(mod.LETTER_TILE_DEF), '…and not a Letter Tile');
const cellParams = mod.resolveComponentParams(cells, {});
assert(cellParams.tile === '', 'blank by default: tileImage stamps as before (parity)');
assert(cellParams.gap === 0, 'the gap default is unchanged');

console.info('a respin cell tiles saved before the tile');
const saved = { ...cells, params: cells.params.filter((p) => p.key !== 'tile') };
const merged = mod.mergeBuiltinCodedParams(saved);
assert(
	merged.params.some((p) => p.key === 'tile' && p.kind === 'component'),
	'gets the tile param back by id',
);

console.info('shipping');
const myTile = { ...tile, id: 'myCellTile', scope: 'project' };
const library = { respinCells: cells, myCellTile: myTile };
const doc = [
	{
		id: 'cells',
		kind: 'componentInstance',
		componentId: 'respinCells',
		x: 0,
		y: 0,
		params: { tile: 'myCellTile' },
	},
];
const shipped = await mod.resolveComponentClosure(doc, async (id) => library[id] ?? null);
assert(
	same(Object.keys(shipped), ['respinCells', 'myCellTile']),
	'a Cell Tile named on the placed tiles ships with them',
);

if (failures > 0) {
	console.error(`\n${failures} assertion(s) failed`);
	process.exit(1);
}
console.info('\nall cell-tile assertions passed');
