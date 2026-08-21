// Offline fixture for the board SEAT contract (docs/design/perspective-board-mode.md, phase 0).
//
//   node scripts/verify-symbol-seat.mjs
//
// WHAT IT PROVES. `getSymbolSeat(reel, row)` is the one place that answers "where does this cell sit
// and how big is it", and phase 0 introduces it with NO behaviour change: every call site that used
// to compose `getSymbolX(reel)` / `getSymbolY(row)` now asks the seat instead, and must get back the
// IDENTICAL float. Not "within an epsilon" — identical, asserted with `Object.is`. Nothing authors a
// perspective yet, so a single moved bit here is a board that silently shifted, on every online game
// (apps/lines IS the shared runtime bundle), with no authored change to blame it on.
//
// WHY IT RUNS THE REAL SOURCE. The getters live in a `.svelte.ts` module full of runes, so it cannot
// be imported from Node. Instead the four functions are SLICED OUT of
// `packages/engine-game/src/game/gameState.svelte.ts` verbatim and evaluated with their handful of
// free names supplied (`SYMBOL_SIZE`, `REEL_PADDING`, a stubbed `resolveReelGridFromNode` returning
// the fixture's grid). So this checks the shipped expressions, not a copy of them that can rot — the
// slice fails loudly if the block is renamed or reordered.
//
// A hand-written closed form of the same algebra is checked alongside, so a change that rewrote BOTH
// the seat and the getter in the same wrong way still fails.
//
// The matrix covers what the lattice actually has knobs for: square + non-square cells, gaps,
// off-centre reel/row lead, per-cell seat alignment, the whole-board nudge, 3x3 / 5x4 / 10x10, and
// row indices that are negative or non-integer — the cascade seats its falling replacements at
// `symbolIndex - 1 - addingReel.length`, well above row 0.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'packages/engine-game/src/game/gameState.svelte.ts');

// Coded constants (packages/engine-game/src/game/constants.ts) — read from the file so a change to
// either one cannot leave the fixture asserting against a stale number.
const constantsSource = readFileSync(
	join(ROOT, 'packages/engine-game/src/game/constants.ts'),
	'utf8',
);
const readConst = (name) => {
	const match = constantsSource.match(new RegExp(`export const ${name} = ([\\d.]+);`));
	if (!match) throw new Error(`constants.ts no longer exports ${name}`);
	return Number(match[1]);
};
const SYMBOL_SIZE = readConst('SYMBOL_SIZE');
const REEL_PADDING = readConst('REEL_PADDING');

/**
 * Slice `boardGeometry` … `getSymbolSeat` out of the real module and evaluate them against one grid.
 * The block is contiguous by design (the seat function sits with the getters it composes); if that
 * stops being true this throws rather than silently testing less.
 */
// Normalized to LF: the repo checks out CRLF on Windows, and the slice markers below are written
// with `\n`.
const source = readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
const blockStart = source.indexOf('\tconst boardGeometry = () => {');
const seatStart = source.indexOf('\tconst getSymbolSeat = (');
if (blockStart < 0 || seatStart < blockStart) {
	throw new Error('could not locate the boardGeometry…getSymbolSeat block in gameState.svelte.ts');
}
const blockEnd = source.indexOf('\n\t};\n', seatStart);
if (blockEnd < 0) throw new Error('could not locate the end of getSymbolSeat');
// The only TypeScript in the slice is the parameter annotations.
const block = source.slice(blockStart, blockEnd + '\n\t};\n'.length).replace(/: number/g, '');

const buildGetters = new Function(
	'SYMBOL_SIZE',
	'REEL_PADDING',
	'resolveReelGridFromNode',
	'boardOverride',
	'deps',
	`${block}\nreturn { boardGeometry, getSymbolX, getSymbolY, getSymbolLead, getSymbolSeat };`,
);

const gettersFor = (grid) =>
	buildGetters(
		SYMBOL_SIZE,
		REEL_PADDING,
		() => grid,
		{ node: grid ? {} : null },
		{ layout: { layoutType: () => 'desktop' } },
	);

/**
 * The same algebra written out independently, straight from the current source's own documentation:
 * a resolved `reelGrid` is folded into board-LOCAL units by the container scale (`cellSize /
 * SYMBOL_SIZE`), the x is lead + column pitch + seat alignment, and the y is the row pitch times
 * `row + lead`. Written in the identical association order, because float equality is the assertion.
 */
const referenceSeat = (grid, reelIndex, rowIndex) => {
	let columnExtraLocal;
	let rowPitchLocal;
	let cellWidthLocal;
	let cellHeightLocal;
	let reelLead;
	let rowLead;
	let symbolAlignX;
	let symbolAlignY;
	if (!grid) {
		columnExtraLocal = 0;
		rowPitchLocal = SYMBOL_SIZE;
		cellWidthLocal = SYMBOL_SIZE;
		cellHeightLocal = SYMBOL_SIZE;
		reelLead = REEL_PADDING;
		rowLead = 0.5;
		symbolAlignX = 0.5;
		symbolAlignY = 0.5;
	} else {
		const scale = grid.cellSize / SYMBOL_SIZE;
		columnExtraLocal = (grid.cellWidth - grid.cellSize + grid.gapX) / scale;
		rowPitchLocal = (grid.cellHeight + grid.gapY) / scale;
		cellWidthLocal = grid.cellWidth / scale;
		cellHeightLocal = grid.cellHeight / scale;
		reelLead = grid.reelPadding;
		rowLead = grid.rowPadding;
		symbolAlignX = grid.symbolAlignX;
		symbolAlignY = grid.symbolAlignY;
	}
	const lead =
		0.5 +
		((rowLead - 0.5) * SYMBOL_SIZE) / rowPitchLocal +
		((symbolAlignY - 0.5) * cellHeightLocal) / rowPitchLocal;
	return {
		x:
			SYMBOL_SIZE * (reelIndex + reelLead) +
			reelIndex * columnExtraLocal +
			(symbolAlignX - 0.5) * cellWidthLocal,
		y: rowPitchLocal * (rowIndex + lead),
		scale: 1,
	};
};

/** A resolved `ReelGridLayout` (the shape `resolveReelGridFromNode` returns), with the defaults. */
const gridOf = (over) => ({
	x: 0,
	y: 0,
	cellSize: 120,
	cellWidth: 120,
	cellHeight: 120,
	gapX: 0,
	gapY: 0,
	reelPadding: 0.5,
	rowPadding: 0.5,
	symbolAlignX: 0.5,
	symbolAlignY: 0.5,
	boardNudgeX: 0,
	boardNudgeY: 0,
	...over,
});

const GRIDS = [
	['no reelGrid doc (coded constants)', null],
	['square flush cells', gridOf({})],
	['square, resized cell (130)', gridOf({ cellSize: 130, cellWidth: 130, cellHeight: 130 })],
	['non-square cells (150x90)', gridOf({ cellSize: 120, cellWidth: 150, cellHeight: 90 })],
	['gapX only', gridOf({ gapX: 14 })],
	['gapY only', gridOf({ gapY: 10 })],
	[
		'gapX + gapY on a non-square cell',
		gridOf({ cellWidth: 150, cellHeight: 90, gapX: 14, gapY: 10 }),
	],
	['off-centre reelPadding', gridOf({ reelPadding: 0.53 })],
	['off-centre rowPadding', gridOf({ rowPadding: 0.37 })],
	['off-centre lead on both axes', gridOf({ reelPadding: 0.8, rowPadding: 0.2 })],
	['symbolAlignX != 0.5', gridOf({ symbolAlignX: 0.25 })],
	['symbolAlignY != 0.5 (feet on the tile)', gridOf({ symbolAlignY: 1 })],
	['both alignments off-centre', gridOf({ symbolAlignX: 0.75, symbolAlignY: 0.1 })],
	['board nudge (must not reach the seat)', gridOf({ boardNudgeX: -17, boardNudgeY: 23.5 })],
	[
		'everything at once',
		gridOf({
			cellSize: 132,
			cellWidth: 151,
			cellHeight: 88.5,
			gapX: 7.5,
			gapY: 11,
			reelPadding: 0.53,
			rowPadding: 0.41,
			symbolAlignX: 0.3,
			symbolAlignY: 1,
			boardNudgeX: 12,
			boardNudgeY: -6,
		}),
	],
];

/** reels x rows, plus the off-board rows the cascade and the padded strip actually use. */
const DIMS = [
	[3, 3],
	[5, 4],
	[10, 10],
];

const rowsFor = (rows) => [
	-1 - rows, // a replacement queued above the whole board
	-2,
	-1, // the padding row above the board
	...Array.from({ length: rows }, (_v, i) => i),
	rows, // the padding row below
	-0.5,
	0.25,
	rows - 0.5, // mid-flight, between two seats
];

let checks = 0;
let failures = 0;
const fail = (message) => {
	failures += 1;
	console.log(`FAIL  ${message}`);
};
const same = (label, got, want) => {
	checks += 1;
	if (!Object.is(got, want)) fail(`${label}  got=${got}  want=${want}`);
};

for (const [gridLabel, grid] of GRIDS) {
	const { getSymbolX, getSymbolY, getSymbolSeat } = gettersFor(grid);
	for (const [reels, rows] of DIMS) {
		for (let reelIndex = 0; reelIndex < reels; reelIndex += 1) {
			for (const rowIndex of rowsFor(rows)) {
				const where = `${gridLabel} | ${reels}x${rows} | cell (${reelIndex}, ${rowIndex})`;
				const seat = getSymbolSeat(reelIndex, rowIndex);
				const reference = referenceSeat(grid, reelIndex, rowIndex);
				// 1. The seat IS the old expressions — the migrated call sites cannot move a pixel.
				same(`${where} :: seat.x === getSymbolX(reel)`, seat.x, getSymbolX(reelIndex));
				same(`${where} :: seat.y === getSymbolY(row)`, seat.y, getSymbolY(rowIndex));
				same(`${where} :: seat.scale === 1 (flat)`, seat.scale, 1);
				// 2. …and both still equal the algebra written out independently.
				same(`${where} :: seat.x === reference x`, seat.x, reference.x);
				same(`${where} :: seat.y === reference y`, seat.y, reference.y);
				// 3. Finite: a degenerate grid must not smuggle in a NaN/Infinity seat.
				if (!Number.isFinite(seat.x) || !Number.isFinite(seat.y))
					fail(`${where} :: non-finite seat`);
				checks += 1;
			}
		}
	}
}

// The board NUDGE is a whole-board offset applied by `boardLayout`, never by the seat. Prove it by
// showing the nudged grid seats identically to the un-nudged one it is otherwise equal to.
{
	const plain = gettersFor(gridOf({ cellWidth: 150, cellHeight: 90, gapX: 14, gapY: 10 }));
	const nudged = gettersFor(
		gridOf({
			cellWidth: 150,
			cellHeight: 90,
			gapX: 14,
			gapY: 10,
			boardNudgeX: -17,
			boardNudgeY: 23.5,
		}),
	);
	for (let reelIndex = 0; reelIndex < 5; reelIndex += 1) {
		for (const rowIndex of [-1, 0, 1, 2, 3, 4]) {
			const a = plain.getSymbolSeat(reelIndex, rowIndex);
			const b = nudged.getSymbolSeat(reelIndex, rowIndex);
			same(`board nudge does not move the seat x (${reelIndex}, ${rowIndex})`, b.x, a.x);
			same(`board nudge does not move the seat y (${reelIndex}, ${rowIndex})`, b.y, a.y);
		}
	}
}

console.log(`\n${checks} assertions across ${GRIDS.length} grids x ${DIMS.length} board sizes`);
if (failures) {
	console.log(
		`${failures} FAILED — the seat is NOT byte-identical to the expressions it replaced.`,
	);
	process.exit(1);
}
console.log('PASS — every seat is byte-identical to getSymbolX(reel) / getSymbolY(row), scale 1.');
