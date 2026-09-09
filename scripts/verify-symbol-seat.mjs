// Offline fixture for the board SEAT contract (docs/design/perspective-board-mode.md, phases 0+1).
//
//   node scripts/verify-symbol-seat.mjs
//
// WHAT IT PROVES. `getSymbolSeat(reel, row)` is the one place that answers "where does this cell sit
// and how big is it". It has two jobs and this fixture holds it to both:
//
//   1. WITHOUT an authored perspective it is FLAT, and flat is byte-identical to the expressions it
//      replaced — every call site that used to compose `getSymbolX(reel)` / `getSymbolY(row)` gets
//      back the IDENTICAL float. Not "within an epsilon" — identical, asserted with `Object.is`.
//      Nothing authors a perspective yet, so a single moved bit here is a board that silently
//      shifted, on every online game (apps/lines IS the shared runtime bundle), with no authored
//      change to blame it on. "Flat" includes every unusable perspective block: absent, empty, a
//      `farScale` of exactly 1, a non-finite / zero / negative / non-numeric `farScale`, and a
//      `vanishX` with no `farScale` to switch the mode on.
//   2. WITH one it implements the design's model — `scale(row) = farScale + (1-farScale)*t`, columns
//      contracted toward `vanishX` by their row's scale, and a y that is the running SUM of the
//      compressed pitches. That sum is written closed-form in the engine (it has to answer for
//      negative and fractional rows), so it is checked here against a LITERAL loop-sum, which is the
//      assertion that proves the closed form is the design's Σ and not a lookalike.
//
// WHY IT RUNS THE REAL SOURCE. The getters live in a `.svelte.ts` module full of runes, so it cannot
// be imported from Node. Instead the whole `boardGeometry` … `getSymbolSeat` block is SLICED OUT of
// `packages/engine-game/src/game/gameState.svelte.ts` verbatim and evaluated with its handful of
// free names supplied (`SYMBOL_SIZE`, `REEL_PADDING`, stubbed resolvers returning the fixture's grid
// + perspective, and the board dimensions). So this checks the shipped expressions, not a copy of
// them that can rot — the slice fails loudly if the block is renamed or reordered.
//
// The `resolveReelGridPerspective` stub hands the RAW authored block through unfiltered on purpose:
// the parity cases above must be rejected by the seat function's OWN guard, not merely by the layout
// resolver upstream of it. That resolver's filtering is covered by
// `scripts/verify-perspective-schema.mjs`, which also proves the block survives a save.
//
// A hand-written closed form of the same algebra is checked alongside, so a change that rewrote BOTH
// the seat and the getter in the same wrong way still fails.
//
// The matrix covers what the lattice actually has knobs for: square + non-square cells, gaps,
// off-centre reel/row lead, per-cell seat alignment, the whole-board nudge, 3x3 / 5x4 / 10x10, and
// row indices that are negative or non-integer — the cascade seats its falling replacements at
// `symbolIndex - 1 - addingReel.length`, well above row 0 — and it runs the whole matrix under BOTH
// a flat and a perspective board.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveGrid } from '../packages/game-config/src/grid.ts';

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
 * The block is contiguous by design (the seat function sits with the getters and the perspective
 * helpers it composes); if that stops being true this throws rather than silently testing less.
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
// The only TypeScript in the slice is the parameter annotations — `number` and the perspective model
// type declared just above the factory. A new annotation shape would make the Function below throw a
// SyntaxError, which is the loud failure we want rather than a silently skipped check.
const block = source
	.slice(blockStart, blockEnd + '\n\t};\n'.length)
	.replace(/: number/g, '')
	.replace(/: BoardPerspective/g, '');

const buildGetters = new Function(
	'SYMBOL_SIZE',
	'REEL_PADDING',
	'resolveReelGridFromNode',
	'resolveReelGridPerspective',
	'boardOverride',
	'deps',
	`${block}
return {
	boardGeometry,
	getSymbolX,
	getSymbolY,
	getSymbolLead,
	getSymbolSeat,
	boardPerspective,
	boardWindowHeight,
	boardWindowForReel,
	boardMaskColumns,
	rowSeatIndex,
};`,
);

/**
 * @param grid a resolved `ReelGridLayout` (or null = "no doc", the coded constants)
 * @param dims `{ reels, rows }` — only the perspective path reads them
 * @param perspective the RAW authored block, handed to the seat unfiltered (see the header)
 */
const gettersFor = (grid, dims = { reels: 5, rows: 3 }, perspective = undefined, rowsPerReel) =>
	buildGetters(
		SYMBOL_SIZE,
		REEL_PADDING,
		() => grid,
		(node) => node?.perspective,
		{ node: grid || perspective ? { perspective } : null },
		{
			layout: { layoutType: () => 'desktop' },
			boardDimensions: () => ({ x: dims.reels, y: dims.rows }),
			// The REAL `resolveGrid`, not a stub of it — the parity claim below is only worth
			// something if `stepped` is decided by the shipped code. Absent `rowsPerReel` ⇒ a uniform
			// board, which is every case in the matrix above.
			activeGrid: () =>
				resolveGrid({
					numReels: dims.reels,
					numRows: rowsPerReel?.rows ?? Array.from({ length: dims.reels }, () => dims.rows),
					gridAlign: rowsPerReel?.align,
				}),
		},
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

/**
 * Every authored `perspective` block that must leave the board FLAT. The first is "no block at all"
 * (today's every board); the rest are the ways an author, or a half-written editor field, can
 * produce one that says nothing usable. All of them have to reach the seat's early return — NOT the
 * perspective algebra with a scale that happens to be 1, which rounds differently.
 */
const FLAT_PERSPECTIVES = [
	['no perspective block', undefined],
	['empty perspective block', {}],
	['farScale exactly 1', { farScale: 1 }],
	['farScale explicitly undefined', { farScale: undefined }],
	['vanishX with no farScale', { vanishX: 123 }],
	['farScale NaN', { farScale: NaN }],
	['farScale 0 (would collapse the board)', { farScale: 0 }],
	['farScale negative (would mirror the board)', { farScale: -0.5 }],
	['farScale a string', { farScale: '0.5' }],
	['swapInPlace only (phase 2 field, no shape)', { swapInPlace: true }],
	['farScale 1 + an authored vanishX', { farScale: 1, vanishX: -40 }],
];

/** The back-row scales the perspective half of the matrix runs under. */
const FAR_SCALES = [0.5, 0.75, 0.3];

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
/**
 * Approximate equality, for the PERSPECTIVE model only: those checks compare the engine's
 * expression against the design's formula written a different way (a lerp vs a slope, a closed form
 * vs a loop), and the two associate differently in floating point. It is NOT a looser version of the
 * parity assertion above — parity is `same`, exact, forever. Do not "fix" a failing parity check by
 * reaching for this one.
 */
const near = (label, got, want, epsilon = 1e-9) => {
	checks += 1;
	if (!Number.isFinite(got) || !Number.isFinite(want) || Math.abs(got - want) > epsilon) {
		fail(`${label}  got=${got}  want=${want}`);
	}
};
const ok = (label, condition) => {
	checks += 1;
	if (!condition) fail(label);
};

// ---------------------------------------------------------------------------------------------
// 1. PARITY — every grid x board size x flat-perspective variant seats byte-identically to the two
//    expressions the seat function replaced.
// ---------------------------------------------------------------------------------------------
for (const [gridLabel, grid] of GRIDS) {
	for (const [flatLabel, perspective] of FLAT_PERSPECTIVES) {
		for (const [reels, rows] of DIMS) {
			const g = gettersFor(grid, { reels, rows }, perspective);
			const { getSymbolX, getSymbolY, getSymbolSeat, boardPerspective, boardWindowHeight } = g;
			const where0 = `${gridLabel} | ${flatLabel} | ${reels}x${rows}`;
			// The mode is OFF: there is no model at all, so every caller takes its early return.
			same(`${where0} :: boardPerspective() is undefined`, boardPerspective(), undefined);
			// The mask window is exactly the expression BoardMask/SymbolWrap computed before it moved
			// into the engine.
			same(
				`${where0} :: boardWindowHeight() === rows * rowPitchLocal`,
				boardWindowHeight(),
				rows * g.boardGeometry().rowPitchLocal,
			);
			for (let reelIndex = 0; reelIndex < reels; reelIndex += 1) {
				for (const rowIndex of rowsFor(rows)) {
					const where = `${where0} | cell (${reelIndex}, ${rowIndex})`;
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

// ---------------------------------------------------------------------------------------------
// 2. THE MODEL — perspective ON, over the same grid x board-size matrix.
// ---------------------------------------------------------------------------------------------
for (const [gridLabel, grid] of GRIDS) {
	for (const farScale of FAR_SCALES) {
		for (const [reels, rows] of DIMS) {
			const g = gettersFor(grid, { reels, rows }, { farScale });
			const { getSymbolX, getSymbolSeat, getSymbolLead, boardPerspective, boardWindowHeight } = g;
			const { rowPitchLocal } = g.boardGeometry();
			const frontRow = rows - 1;
			const lastReel = reels - 1;
			const where0 = `${gridLabel} | farScale ${farScale} | ${reels}x${rows}`;
			ok(`${where0} :: the mode is ON`, !!boardPerspective());

			const scaleAt = (rowIndex) => getSymbolSeat(0, rowIndex).scale;

			// -- scale(row) is the design's lerp across the depth ------------------------------------
			for (let row = 0; row <= frontRow; row += 1) {
				const t = frontRow > 0 ? row / frontRow : 0;
				near(
					`${where0} :: scale(${row}) === farScale + (1-farScale)*t`,
					scaleAt(row),
					farScale + (1 - farScale) * t,
				);
			}
			same(`${where0} :: scale(back row) === farScale exactly`, scaleAt(0), farScale);
			near(`${where0} :: scale(front row) === 1`, scaleAt(frontRow), 1);
			// Off-board rows are CLAMPED, not extrapolated: a replacement queued above the board waits
			// at the BACK row's depth. Extrapolated, its scale would cross zero into mirrored art and
			// its summed y would turn back on itself, so it would "fall" upwards.
			same(`${where0} :: scale(-1) === farScale (clamped)`, scaleAt(-1), farScale);
			same(`${where0} :: scale(-1 - rows) === farScale (clamped)`, scaleAt(-1 - rows), farScale);
			same(
				`${where0} :: scale(rows) === scale(front row) (clamped)`,
				scaleAt(rows),
				scaleAt(frontRow),
			);

			// -- x converges toward the vanishing point ----------------------------------------------
			const spreadAt = (row) => getSymbolSeat(lastReel, row).x - getSymbolSeat(0, row).x;
			near(
				`${where0} :: the back row's spread is farScale x the front row's`,
				spreadAt(0),
				farScale * spreadAt(frontRow),
			);
			// The DEFAULT vanishing point is the lattice centre, so a symmetric pair of columns closes
			// symmetrically: their midpoint is the same on every row.
			const midAt = (row) => (getSymbolSeat(0, row).x + getSymbolSeat(lastReel, row).x) / 2;
			for (let row = 0; row <= frontRow; row += 1) {
				near(
					`${where0} :: the column pair's midpoint is row-independent (row ${row})`,
					midAt(row),
					midAt(frontRow),
				);
			}
			// An AUTHORED vanishing point is a FIXED POINT: a column sitting exactly on it never moves,
			// on any row — exactly, not approximately.
			{
				const onVanish = gettersFor(grid, { reels, rows }, { farScale, vanishX: getSymbolX(1) });
				for (const row of rowsFor(rows)) {
					same(
						`${where0} :: a column AT vanishX does not move (row ${row})`,
						onVanish.getSymbolSeat(1, row).x,
						getSymbolX(1),
					);
				}
			}

			// -- y is the running sum of the COMPRESSED pitches ---------------------------------------
			// The check that matters: the engine's closed form equals a LITERAL loop-sum over the same
			// per-row scales, which is the design's Σ. A lookalike closed form fails here.
			for (let row = 0; row <= rows; row += 1) {
				let sum = 0;
				for (let k = 0; k < row; k += 1) sum += rowPitchLocal * scaleAt(k);
				near(
					`${where0} :: y(${row}) === Σ_{k<row} pitch*scale(k) + pitch*scale(row)*lead`,
					getSymbolSeat(0, row).y,
					sum + rowPitchLocal * scaleAt(row) * getSymbolLead(),
					1e-8,
				);
			}
			// Monotonic in the row across the WHOLE domain, off-board and fractional rows included…
			const rowList = [...rowsFor(rows)].sort((a, b) => a - b);
			for (let i = 1; i < rowList.length; i += 1) {
				ok(
					`${where0} :: y increases from row ${rowList[i - 1]} to ${rowList[i]}`,
					getSymbolSeat(0, rowList[i]).y > getSymbolSeat(0, rowList[i - 1]).y,
				);
			}
			// …and the row-to-row pitch COMPRESSES with depth: every gap is smaller than the one in
			// front of it.
			for (let row = 1; row < frontRow; row += 1) {
				const behind = getSymbolSeat(0, row).y - getSymbolSeat(0, row - 1).y;
				const ahead = getSymbolSeat(0, row + 1).y - getSymbolSeat(0, row).y;
				ok(
					`${where0} :: the gap ahead of row ${row} is wider than the gap behind it`,
					ahead > behind,
				);
			}

			// -- the mask window is that same sum -----------------------------------------------------
			{
				let sum = 0;
				for (let k = 0; k < rows; k += 1) sum += rowPitchLocal * scaleAt(k);
				near(
					`${where0} :: boardWindowHeight() === Σ_{k<rows} pitch*scale(k)`,
					boardWindowHeight(),
					sum,
					1e-8,
				);
				ok(
					`${where0} :: the perspective window is shorter than the flat one`,
					boardWindowHeight() < rows * rowPitchLocal,
				);
			}
		}
	}
}

// ---------------------------------------------------------------------------------------------
// 3. CONTINUITY across the flat boundary — as farScale approaches 1 the seats approach the flat
//    ones. This is a LIMIT check, so an epsilon is the correct question HERE, and only here. The
//    parity block above is exact and stays exact; do not copy this epsilon up there.
// ---------------------------------------------------------------------------------------------
for (const [gridLabel, grid] of GRIDS) {
	const [reels, rows] = [5, 4];
	const flat = gettersFor(grid, { reels, rows });
	for (const farScale of [1 - 1e-9, 1 - 1e-12]) {
		const near1 = gettersFor(grid, { reels, rows }, { farScale });
		for (let reelIndex = 0; reelIndex < reels; reelIndex += 1) {
			for (const rowIndex of rowsFor(rows)) {
				const a = near1.getSymbolSeat(reelIndex, rowIndex);
				const b = flat.getSymbolSeat(reelIndex, rowIndex);
				const where = `${gridLabel} | farScale ${farScale} | (${reelIndex}, ${rowIndex})`;
				near(`${where} :: x → the flat seat`, a.x, b.x, 1e-3);
				near(`${where} :: y → the flat seat`, a.y, b.y, 1e-3);
				near(`${where} :: scale → 1`, a.scale, 1, 1e-6);
			}
		}
		near(
			`${gridLabel} | farScale ${farScale} :: the window height → the flat one`,
			near1.boardWindowHeight(),
			flat.boardWindowHeight(),
			1e-3,
		);
	}
}

// ---------------------------------------------------------------------------
// THE BOARD MUST FIT INSIDE ITS OWN MASK.
//
// `BoardMask` is sized from `boardWindowHeight()`, which is built from the SEATS. So every visible
// row's cell has to sit inside it — otherwise the bottom row is clipped, which is exactly what was
// reported from a live 8x8 board at `farScale` 0.9: "the board gets cut at the bottom".
//
// The cause was not the mask. It was that `ReelSymbol` drew a resting symbol at the REEL's y rather
// than the seat's, and `createReelForSpinning` steps by a UNIFORM pitch — the flat lattice — while
// the seat's y is a running sum of pitches that SHRINK with depth. The two agree on a flat board by
// construction and diverge under perspective, accumulating downward: on that board the last row
// landed 48 board-local units below its seat, past a mask sized to the seats.
//
// So this asserts the invariant the mask depends on (every row fits), and separately asserts that
// the reel's own uniform-pitch expression DIVERGES from the seat under perspective — because that
// divergence is the reason `ReelSymbol` has to branch, and a future change that quietly made them
// agree again would make the branch dead code rather than wrong code.
// ---------------------------------------------------------------------------
for (const [gridLabel, grid] of GRIDS) {
	for (const [reels, rows] of DIMS) {
		for (const farScale of [undefined, ...FAR_SCALES]) {
			const perspective = farScale === undefined ? undefined : { farScale };
			const g = gettersFor(grid, { reels, rows }, perspective);
			const geometry = g.boardGeometry();
			const label = `${gridLabel} | ${farScale === undefined ? 'flat' : `farScale ${farScale}`} | ${reels}x${rows}`;
			const windowHeight = g.boardWindowHeight();

			// ONLY for CENTRED seating. The containment is `pitch * (1 - lead) - 0.5 * cellHeight`, and
			// `lead` folds `rowPadding` and `symbolAlignY` — so a board that deliberately seats its art
			// LOW in the cell (`symbolAlignY` → 1, the "feet on the tile" convention this design
			// recommends for perspective) pushes the bottom row's art past the window on purpose. That
			// is pre-existing and true on a FLAT board too — asserting it here as a universal invariant
			// was tried first and it failed the flat `symbolAlignY != 0.5` grids, which are correct
			// code. The mask is a WINDOW; art seated below its cell leaves it. Recorded as its own
			// assertion below rather than smoothed over, because it is a real trap for that convention.
			const centred = geometry.rowLead === 0.5 && geometry.symbolAlignY === 0.5;
			for (let row = 0; row < rows && centred; row += 1) {
				const seat = g.getSymbolSeat(0, row);
				const halfCell = 0.5 * geometry.cellHeightLocal * seat.scale;
				// `<=` with a hair of slack for float association: the LAST row is flush with the
				// window bottom by construction, so an exact `<` would be wrong, not stricter.
				const fits = seat.y + halfCell <= windowHeight + 1e-9;
				same(`${label} | row ${row} :: the cell sits inside the mask window`, fits, true);
			}
			// Off-centre seating is deliberately NOT asserted either way. It moves the art within its
			// cell by design, so whether the bottom row overflows the window or falls short of it
			// depends on WHICH way the author moved it — there is no invariant to pin, only the
			// consequence to know about. (Asserting "it overflows" was tried too, and fails the grids
			// that seat art HIGH.)

			// The reel's own resting expression, verbatim from `createReelForSpinning`:
			// `reelY.current + (symbolIndex + getSymbolLead()) * getSymbolHeight()` with the reel homed
			// at `-getSymbolHeight()`, i.e. strip index `i` rests at `pitch * (i - 1 + lead)`.
			const reelRestY = (row) => geometry.rowPitchLocal * (row + g.getSymbolLead());
			const lastRow = rows - 1;
			const seatY = g.getSymbolSeat(0, lastRow).y;
			if (farScale === undefined) {
				same(`${label} :: flat — the reel and the seat agree exactly`, reelRestY(lastRow), seatY);
			} else {
				same(
					`${label} :: perspective — the reel's uniform pitch DIVERGES from the seat`,
					reelRestY(lastRow) > seatY,
					true,
				);
			}
		}
	}
}

const readSrc = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
// ---------------------------------------------------------------------------
// AND `ReelSymbol` MUST TAKE THE RESTING y FROM THE SEAT.
//
// The containment above is a property of the SEATS. It only reaches the screen if the component
// that draws a resting symbol actually uses them. It did not: `y` came from the reel's live
// `symbolY()`, which steps by a uniform pitch, so under perspective the board hung below a mask
// sized to the seats and the bottom row was clipped.
//
// A Node fixture cannot mount the component, so this is asserted on its source — the same standing
// as the pre-spin guard in `verify-swap-in-place-mode.mjs`.
// ---------------------------------------------------------------------------
{
	const reelSymbol = readSrc('apps/lines/src/components/ReelSymbol.svelte');
	same(
		'ReelSymbol branches its y on an authored perspective',
		/boardPerspective\(\)\s*&&\s*!spinning\s*\?\s*seat\.y/.test(reelSymbol),
		true,
	);
	same(
		'...and falls back to the live reel y otherwise (flat parity, and mid-roll)',
		/:\s*props\.reelSymbol\.symbolY\(\)/.test(reelSymbol),
		true,
	);
	same(
		'...and reads the reel MOTION rather than guessing at rest',
		/reelState\.motion === 'spinning'/.test(reelSymbol),
		true,
	);
	same('...and binds that y, not the raw live one', /\n\t\t\{y\}\n/.test(reelSymbol), true);
}

// ---------------------------------------------------------------------------
// STEPPED GRIDS (docs/design/stepped-grid.md) — a non-uniform `numRows`.
//
// Two claims, and the second is the one that actually bites:
//
//  1. Each column is displaced by its share of the bounding box's slack, per the authored
//     alignment. A 3/4/5/4/3 board centred in a 5-row box offsets by 1 / 0.5 / 0 / 0.5 / 1.
//  2. THE ROLLING Y AND THE RESTING SEAT AGREE. `ReelSymbol` picks between them every frame
//     (the seat at rest under perspective, the live reel y otherwise), so if the two are offset
//     by different amounts a stepped column JUMPS the instant it settles. The reel places a
//     symbol at `reelY + (symbolIndex + lead) * pitch` and comes to rest at `reelY = -pitch`, so
//     the resting live y of visible row r is `pitch * (r + lead + offset)`, which is
//     `getSymbolY(r + offset)`.
//
//     Checked to a TOLERANCE, deliberately, unlike every other assertion in this file. The two
//     expressions associate their multiply and add differently and so have never been bit-equal —
//     a UNIFORM board already drifts ~2.8e-14 between them today, so demanding `Object.is` here
//     would be asserting a property the shipped code never had. The tolerance is not slack: the
//     failure this guards is an offset reaching one path and not the other, which misplaces a
//     column by at least half a row (~45 board units on a default pitch) — fifteen orders of
//     magnitude above the float noise, so 1e-9 separates them with room to spare.
// ---------------------------------------------------------------------------
{
	const STEPPED = [
		['diamond 3/4/5/4/3', [3, 4, 5, 4, 3], 'center', [1, 0.5, 0, 0.5, 1]],
		['diamond, top-aligned', [3, 4, 5, 4, 3], 'top', [0, 0, 0, 0, 0]],
		['diamond, bottom-aligned', [3, 4, 5, 4, 3], 'bottom', [2, 1, 0, 1, 2]],
		['ramp 2/3/4/5/6', [2, 3, 4, 5, 6], 'center', [2, 1.5, 1, 0.5, 0]],
		['single short reel', [4, 4, 2, 4, 4], 'bottom', [0, 0, 2, 0, 0]],
	];
	for (const [gridLabel, grid] of GRIDS) {
		for (const [label, rows, align, expected] of STEPPED) {
			const resolved = resolveGrid({ numReels: rows.length, numRows: rows, gridAlign: align });
			const g = gettersFor(grid, { reels: rows.length, rows: Math.max(...rows) }, undefined, {
				rows,
				align,
			});
			// The stub must actually be driving a stepped grid, or everything below is vacuous.
			same(`${gridLabel} | ${label} :: grid.stepped`, resolved.stepped, true);
			const { rowPitchLocal } = g.boardGeometry();
			for (let reel = 0; reel < rows.length; reel += 1) {
				const where = `${gridLabel} | ${label} | reel ${reel}`;
				const offset = resolved.rowOffsetForReel(reel);
				// 1. the authored alignment placed the column where the design says
				same(`${where} :: row offset`, offset, expected[reel]);
				same(`${where} :: rowSeatIndex folds the offset in`, g.rowSeatIndex(reel, 0), offset);
				// 2. the window this column masks + culls at
				const win = g.boardWindowForReel(reel);
				same(`${where} :: window top`, win.top, offset * rowPitchLocal);
				same(`${where} :: window height`, win.height, rows[reel] * rowPitchLocal);
				// the column's window must sit INSIDE the bounding box, or the mask leaks
				if (win.top < 0 || win.top + win.height > g.boardWindowHeight() + 1e-9)
					fail(`${where} :: column window escapes the board window`);
				checks += 1;
				for (let r = 0; r < rows[reel]; r += 1) {
					const seat = g.getSymbolSeat(reel, r);
					// THE INVARIANT: resting live y === seat y, exactly.
					const lead = g.getSymbolLead() + g.rowSeatIndex(reel, 0);
					const restingLiveY = -rowPitchLocal + (r + 1 + lead) * rowPitchLocal;
					if (Math.abs(restingLiveY - seat.y) > 1e-9)
						fail(
							`${where} | row ${r} :: rolling y vs resting seat y  live=${restingLiveY} seat=${seat.y}`,
						);
					checks += 1;
					same(
						`${where} | row ${r} :: seat.y === getSymbolY(r + offset)`,
						seat.y,
						g.getSymbolY(r + offset),
					);
					// a stepped board is still FLAT, so x and scale are untouched by the offset
					same(`${where} | row ${r} :: seat.x unmoved`, seat.x, g.getSymbolX(reel));
					same(`${where} | row ${r} :: seat.scale === 1`, seat.scale, 1);
				}
			}
		}
	}
	// A UNIFORM grid must take the pass-through: the same call, not an equivalent one.
	for (const [gridLabel, grid] of GRIDS) {
		const g = gettersFor(grid, { reels: 5, rows: 3 }, undefined, { rows: [3, 3, 3, 3, 3] });
		for (let reel = 0; reel < 5; reel += 1) {
			same(`${gridLabel} | uniform :: rowSeatIndex is identity`, g.rowSeatIndex(reel, -1), -1);
			const win = g.boardWindowForReel(reel);
			same(`${gridLabel} | uniform :: window top is 0`, win.top, 0);
			same(
				`${gridLabel} | uniform :: window height is the board window`,
				win.height,
				g.boardWindowHeight(),
			);
		}
	}
}

console.log(
	`\n${checks} assertions across ${GRIDS.length} grids x ${DIMS.length} board sizes x ` +
		`${FLAT_PERSPECTIVES.length} flat variants + ${FAR_SCALES.length} perspectives`,
);

// ---------------------------------------------------------------------------
// THE COMPOUND MASK covers the board and nothing else.
//
// A stepped board is clipped by ONE mask whose geometry is the union of the per-column windows,
// rather than by a container per column. That choice is what lets a stepped board ALSO be a
// perspective board — grouping the children by column forces a column-major scene graph, and
// perspective needs a row-major one so a front-row character paints over the row behind it.
//
// So the shape has to be right, and "right" is exactly two claims, both tested here by asking
// whether a point is inside the union (ray casting) rather than by comparing edge coordinates:
//
//   1. EVERY VISIBLE CELL IS COVERED. A seat the board draws must be inside the mask, or a real
//      symbol is clipped away.
//   2. EVERY NOTCH IS NOT. The space beside a short column — inside the bounding box, outside that
//      column's window — must be OUTSIDE the union, or a symbol scrolling through the short column
//      is drawn in a place the board does not exist. This is the failure a single board-wide
//      rectangle has, and the whole reason the shape is compound.
//
// Run under BOTH a flat and a perspective board, because the second is the case the shape exists to
// make possible.
// ---------------------------------------------------------------------------
{
	/** Ray casting: is `(x, y)` inside this polygon? */
	const inside = (polygon, x, y) => {
		let hit = false;
		for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
			const a = polygon[i];
			const b = polygon[j];
			if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
		}
		return hit;
	};
	const inUnion = (columns, x, y) => columns.some((column) => inside(column, x, y));

	const SHAPES = [
		['diamond 3/4/5/4/3', [3, 4, 5, 4, 3], 'center'],
		['diamond, bottom', [3, 4, 5, 4, 3], 'bottom'],
		['diamond, top', [3, 4, 5, 4, 3], 'top'],
		['ramp 2/3/4/5/6', [2, 3, 4, 5, 6], 'center'],
	];
	const BOARDS = [
		['flat', undefined],
		['perspective 0.7', { farScale: 0.7 }],
		['perspective 0.45 + vanishX', { farScale: 0.45, vanishX: 120 }],
	];

	for (const [gridLabel, grid] of GRIDS) {
		for (const [boardLabel, perspective] of BOARDS) {
			for (const [shapeLabel, rows, align] of SHAPES) {
				const where = `${gridLabel} | ${boardLabel} | ${shapeLabel}`;
				const g = gettersFor(grid, { reels: rows.length, rows: Math.max(...rows) }, perspective, {
					rows,
					align,
				});
				const columns = g.boardMaskColumns();
				checks += 1;
				if (!columns || columns.length !== rows.length) {
					fail(`${where} :: expected one mask polygon per column`);
					continue;
				}
				for (let reel = 0; reel < rows.length; reel += 1) {
					const rowsHere = rows[reel];
					const owners = (x, y) => columns.filter((column) => inside(column, x, y)).length;

					// EVERY PROBE COMES FROM THE SEAT PATH, never from the polygon's own vertices. That is
					// the whole point: a probe derived from the ring would follow any error in the ring
					// and report success — the first version of this test did exactly that, and a
					// deliberate one-pitch shift of every interior boundary sailed through it.
					//
					// The point probed is the MIDPOINT BETWEEN TWO ADJACENT CELLS' seats. A seat is an
					// anchor, and an authored `symbolAlignY` of 0 or 1 (feet on the tile) puts it exactly
					// ON a cell edge, where point-in-polygon is a coin flip; a midpoint of two of them is
					// strictly interior for any alignment.
					for (let k = 0; k + 1 < rowsHere; k += 1) {
						const a = g.getSymbolSeat(reel, k);
						const b = g.getSymbolSeat(reel, k + 1);
						const x = (a.x + b.x) / 2;
						const y = (a.y + b.y) / 2;
						checks += 1;
						const n = owners(x, y);
						// EXACTLY ONE, not "at least one". Overlapping columns are how a tall neighbour's
						// polygon swallows the notch beside a short column — and a symbol scrolling through
						// that notch would then be drawn where the board does not exist.
						if (n !== 1)
							fail(
								`${where} :: reel ${reel} between cells ${k}/${k + 1} is in ${n} columns, want 1`,
							);
					}

					// THE NOTCH — the region beside a short column, inside the bounding box but outside
					// the board — is not probed directly, on purpose. Every point that names it has to be
					// built from a SEAT, and a seat is an anchor: an authored `symbolAlignY` of 1 (feet on
					// the tile) or a shifted `rowLead` moves it off its cell's centre by design, so a
					// probe "one row above the window" lands somewhere between the notch and the window
					// edge depending on the grid. That measures the probe, not the mask.
					//
					// It follows from two things that ARE tested independently:
					//
					//   · this column's polygon spans exactly its own window in y — asserted just below
					//     against `boardWindowForReel`, which is a different function computed a
					//     different way (and is itself checked against the row pitch in the stepped
					//     section above);
					//   · the columns do not overlap in x — the `want 1` assertion above, probed from the
					//     seat path rather than from the polygon's own vertices.
					//
					// A notch can only be covered by some column's polygon. It is not this column's (its
					// polygon stops at its window), and it is not a neighbour's (their polygons do not
					// reach this column's x). So nothing covers it.
					const ring = columns[reel];
					const window = g.boardWindowForReel(reel);
					const ringTop = Math.min(...ring.map((point) => point.y));
					const ringBottom = Math.max(...ring.map((point) => point.y));
					checks += 1;
					if (Math.abs(ringTop - window.top) > 1e-9)
						fail(`${where} :: reel ${reel} polygon starts at ${ringTop}, window at ${window.top}`);
					checks += 1;
					if (Math.abs(ringBottom - (window.top + window.height)) > 1e-9)
						fail(
							`${where} :: reel ${reel} polygon ends at ${ringBottom}, window at ${window.top + window.height}`,
						);
				}
				// Every polygon must be a quad, and finite — a NaN corner silently masks nothing.
				for (const column of columns) {
					checks += 1;
					if (
						column.length < 4 ||
						column.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
					)
						fail(`${where} :: a mask polygon is not a finite ring`);
				}

				// THE TILING ITSELF — no HOLE along a shared boundary.
				//
				// This is the invariant the compound mask rests on ("the columns tile, they do not
				// overlap") and the one nothing above asserts. Every probe so far sits at a CELL
				// CENTRE, half a cell from the place two columns actually meet, so a sliver opened
				// between two neighbours' facing edges is invisible to all of them — and that sliver
				// is a hole in the MASK: the background paints through it, on top of the symbols.
				//
				// Not hypothetical. Under perspective a boundary is a CURVE (x contracts with the row,
				// y is the quadratic sum of compressed pitches) and a polyline only reproduces a curve
				// at the knots it is sampled at, while `rowOffsetForReel` returns `slack / 2` — so a
				// column whose slack is ODD inscribes that shared curve half a row out of phase with
				// its neighbour and the two describe different edges. Measured on a live 3/4/4/4/4
				// perspective board: a 0.86px hole down the first cell's right edge, which is exactly
				// what a player reported seeing.
				//
				// Read by SCANLINE rather than by the seat-derived probes used above, and the
				// difference is deliberate: this is a claim about two rings AGREEING WITH EACH OTHER,
				// so comparing them directly is the measurement — a probe that followed one ring would
				// have nothing to say about the other. An OVERLAP is not a failure (it masks more, not
				// less); only a gap is.
				const spanAt = (polygon, y) => {
					const xs = [];
					for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
						const p = polygon[i];
						const q = polygon[j];
						if (p.y > y !== q.y > y) xs.push(((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x);
					}
					return xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : null;
				};
				// Both with and WITHOUT the symbol overflow: spending it moves each column's outer
				// corner, and neighbours widen from different rows, so it is its own way to split a
				// shared edge. 50 is the order of magnitude a real board authors (`test6` uses it).
				for (const overflowY of [0, 50]) {
					const rings = g.boardMaskColumns(0, overflowY);
					for (let reel = 0; reel + 1 < rows.length; reel += 1) {
						const yOf = (ring) => ring.map((point) => point.y);
						const top = Math.max(Math.min(...yOf(rings[reel])), Math.min(...yOf(rings[reel + 1])));
						const bottom = Math.min(
							Math.max(...yOf(rings[reel])),
							Math.max(...yOf(rings[reel + 1])),
						);
						if (!(bottom - top > 1e-9)) continue;
						let worst = 0;
						let worstY = 0;
						for (let step = 1; step < 400; step += 1) {
							const y = top + ((bottom - top) * step) / 400;
							const leftColumn = spanAt(rings[reel], y);
							const rightColumn = spanAt(rings[reel + 1], y);
							if (!leftColumn || !rightColumn) continue;
							const gap = rightColumn.min - leftColumn.max;
							if (gap > worst) {
								worst = gap;
								worstY = y;
							}
						}
						checks += 1;
						if (worst > 1e-9)
							fail(
								`${where} | overflowY ${overflowY} :: HOLE between columns ${reel}/${reel + 1} — ` +
									`${worst.toFixed(4)}px wide at y=${worstY.toFixed(1)}`,
							);
					}
				}
			}
		}
		// A UNIFORM board must answer `undefined` — the single `Rectangle` mask, unchanged.
		const flat = gettersFor(grid, { reels: 5, rows: 3 }, undefined, { rows: [3, 3, 3, 3, 3] });
		same(`${gridLabel} | uniform :: no compound mask`, flat.boardMaskColumns(), undefined);
	}
}

if (failures) {
	console.log(`${failures} FAILED — the seat contract is broken.`);
	process.exit(1);
}
console.log(
	'PASS — a flat seat is byte-identical to getSymbolX(reel) / getSymbolY(row) at scale 1, and an ' +
		"authored perspective seats the design's model.",
);
