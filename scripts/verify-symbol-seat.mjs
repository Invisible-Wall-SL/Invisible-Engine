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
};`,
);

/**
 * @param grid a resolved `ReelGridLayout` (or null = "no doc", the coded constants)
 * @param dims `{ reels, rows }` — only the perspective path reads them
 * @param perspective the RAW authored block, handed to the seat unfiltered (see the header)
 */
const gettersFor = (grid, dims = { reels: 5, rows: 3 }, perspective = undefined) =>
	buildGetters(
		SYMBOL_SIZE,
		REEL_PADDING,
		() => grid,
		(node) => node?.perspective,
		{ node: grid || perspective ? { perspective } : null },
		{
			layout: { layoutType: () => 'desktop' },
			boardDimensions: () => ({ x: dims.reels, y: dims.rows }),
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

console.log(
	`\n${checks} assertions across ${GRIDS.length} grids x ${DIMS.length} board sizes x ` +
		`${FLAT_PERSPECTIVES.length} flat variants + ${FAR_SCALES.length} perspectives`,
);
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

if (failures) {
	console.log(`${failures} FAILED — the seat contract is broken.`);
	process.exit(1);
}
console.log(
	'PASS — a flat seat is byte-identical to getSymbolX(reel) / getSymbolY(row) at scale 1, and an ' +
		"authored perspective seats the design's model.",
);
