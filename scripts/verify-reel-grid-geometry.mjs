// Offline fixture for the EDITOR ↔ GAME seat contract (docs/design/perspective-board-mode.md,
// phase 3 — "Editor").
//
//   node scripts/verify-reel-grid-geometry.mjs
//
// WHAT IT PROVES. The Scene Editor previews the board from `reelGridGeometry()`
// (`apps/launcher-api/src/routes/(app)/editor/editorCanvas.helpers.ts`) — the ONE definition its 2D
// canvas and its WebGL spine layer both read. The game seats the same board from `getSymbolSeat()`
// (`packages/engine-game/src/game/gameState.svelte.ts`). If those two disagree, the author is
// positioning against a lie: a symbol placed in the editor lands somewhere else live. So this
// fixture holds the editor to two things:
//
//   1. FLAT PARITY. No authored perspective — or one that says nothing usable (`{}`, a `farScale`
//      of exactly 1, a non-finite / zero / negative / non-numeric one, a lone `vanishX`, a lone
//      `swapInPlace`) — must produce the geometry the editor produced BEFORE the perspective work,
//      float for float, asserted with `Object.is` against a verbatim transcription of the old code.
//      `apps/lines` is the shared runtime bundle every online game runs and nothing authors a
//      perspective yet, so a moved bit here is a board preview that silently drifted from the board
//      it previews, with no authored change to blame.
//   2. EQUIVALENCE. With or without a perspective, the editor's seat IS the engine's seat — through
//      the affine map below, and through nothing else.
//
// THE AFFINE MAP, AND WHY IT IS NOT ASSUMED. The two live in different spaces:
//
//   * The GAME seats in board-LOCAL units (`SYMBOL_SIZE`-based) inside `<BoardContainer>`
//     (`packages/engine-game/src/components/BoardContainer.svelte`), which is a Pixi `Container`
//     given ONLY `x`, `y`, `pivot` and `scale` from `boardLayout()` — no anchor, no width/height.
//     A Pixi container with a pivot maps a local point as `world = xy + scale * (local - pivot)`.
//   * The EDITOR seats in the node's own LAYOUT-px space, which the canvas has already translated
//     to the node's position — so its origin is the node position, and `left`/`top` fold the
//     anchor and `boardNudge*` on top of that.
//
// Therefore `editorLocal = (boardLayout().xy - nodePosition) + boardLayout().scale * (gameLocal -
// boardLayout().pivot)`. This fixture builds that map by CALLING the real `boardLayout()` sliced out
// of `gameState.svelte.ts` — the pivot term is never retyped here, precisely because the pivot is
// where a divergence would hide. `boardLayout()` recentres the pivot on the gap-extended cluster:
//
//     pivotX = boardSizes().width / 2  + ((reels - 1) / 2) * columnExtraLocal
//     pivotY = boardSizes().height / 2 + (rows / 2) * (rowPitchLocal - SYMBOL_SIZE)
//
// Folding those through the scale gives the closed form the editor's perspective block documents,
// and section 2 below ASSERTS that closed form against the map it derived, rather than trusting
// either:
//
//     X0 = left + (cellW - cellSize) / 2        Y0 = top - gapY / 2
//
// That `(cellW - cellSize) / 2` is the term that LOOKS like an editor/game divergence on non-square
// cells: the editor's seat carries `cellW / 2` where the game's carries `cellSize / 2`. It is not a
// divergence — it is exactly cancelled by the pivot's `((reels - 1) / 2) * columnExtraLocal`, which
// is the game recentring the cluster that its own cumulative column pitch pushed rightward. The
// same is true of `gapY / 2` on the Y axis: the game's row PITCH cell wraps the gap symmetrically
// around the drawn cell, so its board-local origin sits half a gap above the editor's cell box. If
// that reasoning were wrong the origin assertions would fail, and the seat equality would fail with
// them — the map cannot be tuned to hide it, because the map comes from `boardLayout()`.
//
// WHY IT RUNS THE REAL SOURCE. The engine getters live in a `.svelte.ts` full of runes and the
// editor helper lives in a SvelteKit route, so neither can be imported from Node. Both are SLICED
// OUT of their real files verbatim and evaluated with their free names supplied. So this checks the
// shipped expressions, not copies that can rot — the slices throw loudly if a block is renamed or
// reordered.
//
// The `resolveReelGridPerspective` stub hands the RAW authored block through unfiltered on purpose,
// exactly as `scripts/verify-symbol-seat.mjs` does: the unusable-perspective cases must be rejected
// by each side's OWN flat guard, not merely by the layout resolver upstream of them.
//
// The matrix is the one phases 0 and 1 used: square + non-square cells, gapX, gapY, off-centre
// reel/row lead, per-cell seat alignment, the whole-board nudge, and 3x3 / 5x4 / 10x10.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lfReaderFrom } from './lib/read-lf.mjs';
import { resolveGrid } from '../packages/game-config/src/grid.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The repo checks out CRLF on Windows and the slice markers below are written with `\n`.
const readLF = lfReaderFrom(ROOT);

const ENGINE_SRC = readLF('packages/engine-game/src/game/gameState.svelte.ts');
const EDITOR_SRC = readLF('apps/launcher-api/src/routes/(app)/editor/editorCanvas.helpers.ts');
const LAYOUT_SRC = readLF('packages/engine-layout/src/lib/reelGrid.ts');
const CONSTANTS_SRC = readLF('packages/engine-game/src/game/constants.ts');

const readConst = (src, name, where) => {
	const match = src.match(new RegExp(`const ${name} = ([\\d.]+);`));
	if (!match) throw new Error(`${where} no longer declares ${name}`);
	return Number(match[1]);
};
const SYMBOL_SIZE = readConst(CONSTANTS_SRC, 'SYMBOL_SIZE', 'constants.ts');
const REEL_PADDING = readConst(CONSTANTS_SRC, 'REEL_PADDING', 'constants.ts');
// The editor mirrors SYMBOL_SIZE as its own literal (it cannot depend on the runtime package).
// Read it back so the two cannot silently disagree.
const BOARD_LOCAL_CELL = readConst(EDITOR_SRC, 'BOARD_LOCAL_CELL', 'editorCanvas.helpers.ts');
if (BOARD_LOCAL_CELL !== SYMBOL_SIZE) {
	throw new Error(
		`the editor's BOARD_LOCAL_CELL (${BOARD_LOCAL_CELL}) is not the engine's SYMBOL_SIZE (${SYMBOL_SIZE})`,
	);
}

/** Slice `[start, end)` out of a source file, failing loudly rather than testing less. */
const sliceBlock = (src, startMarker, endMarker, what) => {
	const from = src.indexOf(startMarker);
	if (from < 0) throw new Error(`could not locate ${what}`);
	const to = src.indexOf(endMarker, from);
	if (to < 0) throw new Error(`could not locate the end of ${what}`);
	return src.slice(from, to + endMarker.length);
};

// ---------------------------------------------------------------------------------------------
// The ENGINE side: `boardGeometry` … `getSymbolSeat` (contiguous by design), plus `boardLayout`,
// which owns the board container's pivot and is therefore half of the affine map.
// ---------------------------------------------------------------------------------------------
const seatBlock = (() => {
	const start = ENGINE_SRC.indexOf('\tconst boardGeometry = () => {');
	const seat = ENGINE_SRC.indexOf('\tconst getSymbolSeat = (');
	if (start < 0 || seat < start) {
		throw new Error(
			'could not locate the boardGeometry…getSymbolSeat block in gameState.svelte.ts',
		);
	}
	const end = ENGINE_SRC.indexOf('\n\t};\n', seat);
	if (end < 0) throw new Error('could not locate the end of getSymbolSeat');
	return ENGINE_SRC.slice(start, end + '\n\t};\n'.length);
})();
const layoutBlock = sliceBlock(
	ENGINE_SRC,
	'\tconst boardLayout = () => {',
	'\n\t};\n',
	'boardLayout in gameState.svelte.ts',
);
const engineBlock = (seatBlock + layoutBlock)
	.replace(/: number/g, '')
	.replace(/: BoardPerspective/g, '');

const buildEngine = new Function(
	'SYMBOL_SIZE',
	'REEL_PADDING',
	'resolveReelGridFromNode',
	'resolveReelGridPerspective',
	'boardOverride',
	'deps',
	`${engineBlock}
return { boardGeometry, getSymbolX, getSymbolY, getSymbolLead, getSymbolSeat, boardLayout };`,
);

// ---------------------------------------------------------------------------------------------
// The LAYOUT side: the real `resolveReelGridFromNode`, so the node → resolved-grid step the game
// takes is not a copy either. Its only dependency is `resolveTransform`, which — for a node with no
// per-layoutType `overrides` — returns the node's own x/y/anchor/scale (see resolveTransform.ts);
// every node in this fixture is override-free, so the stub below is exact, not approximate.
// ---------------------------------------------------------------------------------------------
const resolveGridBlock = sliceBlock(
	LAYOUT_SRC,
	'export function resolveReelGridFromNode(',
	'\n}\n',
	'resolveReelGridFromNode in reelGrid.ts',
)
	.replace(
		/export function resolveReelGridFromNode\([\s\S]*?\): ReelGridLayout \| undefined \{/,
		'function resolveReelGridFromNode(node, layoutType) {',
	)
	.replace(/ as number/g, '')
	.replace(/: number/g, '');

const resolveReelGridFromNode = new Function(
	'resolveTransform',
	`${resolveGridBlock}
return resolveReelGridFromNode;`,
)((node) => ({ x: node.x, y: node.y, anchor: node.anchor, scale: node.scale }));

// ---------------------------------------------------------------------------------------------
// The EDITOR side: the real `reelGridGeometry`.
// ---------------------------------------------------------------------------------------------
const geometryBlock = sliceBlock(
	EDITOR_SRC,
	'export function reelGridGeometry(',
	'\n}\n',
	'reelGridGeometry in editorCanvas.helpers.ts',
)
	.replace(
		/export function reelGridGeometry\([\s\S]*?\): ReelGridGeometry \{/,
		'function reelGridGeometry(node, anchor, dims) {',
	)
	.replace(/ as number/g, '')
	.replace(/: ReelGridSeat\[\]/g, '')
	.replace(/: ReelGridGeometry/g, '')
	.replace(/: Vec2\[\]/g, '')
	.replace(/: number/g, '');

const reelGridGeometry = new Function(
	'BOARD_LOCAL_CELL',
	'resolveReelGridPerspective',
	`${geometryBlock}
return reelGridGeometry;`,
)(BOARD_LOCAL_CELL, (node) => node?.perspective);

// ---------------------------------------------------------------------------------------------
// Fixture inputs.
// ---------------------------------------------------------------------------------------------

/** A `reelGrid` NODE — what the author saves and what BOTH sides read. Non-zero x/y on purpose: the
 *  affine map has to subtract the node position, and a node at the origin would hide it if it
 *  didn't. */
const nodeOf = (over, perspective) => ({
	id: 'board',
	kind: 'reelGrid',
	x: 640,
	y: 360,
	reels: 5,
	rows: 3,
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
	...(perspective ? { perspective } : {}),
});

/** The same matrix phases 0 and 1 ran (`scripts/verify-symbol-seat.mjs`), minus its "no reelGrid
 *  doc" row: the editor only draws a board when a node exists, so there is no editor side to it. */
const GRIDS = [
	['square flush cells', {}],
	['square, resized cell (130)', { cellSize: 130, cellWidth: 130, cellHeight: 130 }],
	['non-square cells (150x90)', { cellSize: 120, cellWidth: 150, cellHeight: 90 }],
	['gapX only', { gapX: 14 }],
	['gapY only', { gapY: 10 }],
	['gapX + gapY on a non-square cell', { cellWidth: 150, cellHeight: 90, gapX: 14, gapY: 10 }],
	['off-centre reelPadding', { reelPadding: 0.53 }],
	['off-centre rowPadding', { rowPadding: 0.37 }],
	['off-centre lead on both axes', { reelPadding: 0.8, rowPadding: 0.2 }],
	['symbolAlignX != 0.5', { symbolAlignX: 0.25 }],
	['symbolAlignY != 0.5 (feet on the tile)', { symbolAlignY: 1 }],
	['both alignments off-centre', { symbolAlignX: 0.75, symbolAlignY: 0.1 }],
	['board nudge', { boardNudgeX: -17, boardNudgeY: 23.5 }],
	[
		'everything at once',
		{
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
		},
	],
];

/** Every authored block that must leave the board FLAT on BOTH sides. */
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
	['swapInPlace only (the mode, not the shape)', { swapInPlace: true }],
	['farScale 1 + an authored vanishX', { farScale: 1, vanishX: -40 }],
];

const FAR_SCALES = [0.5, 0.75, 0.3, 1.4];
const DIMS = [
	[3, 3],
	[5, 4],
	[10, 10],
];

/** The node's anchor, as the canvas resolves it. `reelGrid` nodes carry none, so both the canvas
 *  and the geometry fall back to 0.5 — and 0.5 is the only anchor the GAME can represent, since
 *  `<BoardContainer>` centres through the pivot and takes no anchor at all. */
const ANCHOR = { x: 0.5, y: 0.5 };

/** Build both sides for one node + board size. */
const sidesFor = (node, reels, rows) => {
	const grid = resolveReelGridFromNode(node, 'desktop');
	const engine = buildEngine(
		SYMBOL_SIZE,
		REEL_PADDING,
		() => grid,
		(n) => n?.perspective,
		{ node },
		{
			layout: { layoutType: () => 'desktop', mainLayout: () => ({ width: 1280, height: 720 }) },
			boardDimensions: () => ({ x: reels, y: rows }),
			// Uniform: these fixtures do not exercise stepped grids, so every seat below takes the
			// same pass-through it took before `activeGrid` existed.
			activeGrid: () =>
				resolveGrid({ numReels: reels, numRows: Array.from({ length: reels }, () => rows) }),
			// `boardSizes()` in gameConfig.ts — "the board's PIXEL footprint (gap-less),
			// SYMBOL_SIZE x the grid count".
			boardSizes: () => ({ width: SYMBOL_SIZE * reels, height: SYMBOL_SIZE * rows }),
		},
	);
	const geo = reelGridGeometry(node, ANCHOR, { reels, rows });
	// THE MAP, built from the real `boardLayout()`: board-local -> the node's own layout-px space.
	const bl = engine.boardLayout();
	const toEditor = (p) => ({
		x: bl.x - node.x + bl.scale * (p.x - bl.pivot.x),
		y: bl.y - node.y + bl.scale * (p.y - bl.pivot.y),
	});
	return { grid, engine, geo, bl, toEditor };
};

// ---------------------------------------------------------------------------------------------
// A verbatim transcription of the geometry the editor produced BEFORE perspective existed — the
// expressions, in their original order, so `Object.is` is a fair question. Parity is asserted
// against THIS, not against "the same function with the feature switched off".
// ---------------------------------------------------------------------------------------------
const geometryBeforePerspective = (node, anchor, dims) => {
	const reels = Math.max(1, Math.round(dims?.reels ?? node.reels));
	const rows = Math.max(1, Math.round(dims?.rows ?? node.rows));
	const cellW = node.cellWidth && node.cellWidth > 0 ? node.cellWidth : node.cellSize;
	const cellH = node.cellHeight && node.cellHeight > 0 ? node.cellHeight : node.cellSize;
	const gapX = Number.isFinite(node.gapX) ? node.gapX : 0;
	const gapY = Number.isFinite(node.gapY) ? node.gapY : 0;
	const pitchX = cellW + gapX;
	const pitchY = cellH + gapY;
	const width = reels * cellW + (reels - 1) * gapX;
	const height = rows * cellH + (rows - 1) * gapY;
	const nudgeX = Number.isFinite(node.boardNudgeX) ? node.boardNudgeX : 0;
	const nudgeY = Number.isFinite(node.boardNudgeY) ? node.boardNudgeY : 0;
	const left = -width * (anchor?.x ?? 0.5) + nudgeX;
	const top = -height * (anchor?.y ?? 0.5) + nudgeY;
	const leadX = Number.isFinite(node.reelPadding) ? node.reelPadding : 0.5;
	const leadY = Number.isFinite(node.rowPadding) ? node.rowPadding : 0.5;
	const alignX = Number.isFinite(node.symbolAlignX) ? node.symbolAlignX : 0.5;
	const alignY = Number.isFinite(node.symbolAlignY) ? node.symbolAlignY : 0.5;
	const seatDX = node.cellSize * (leadX - 0.5) + cellW * (alignX - 0.5);
	const seatDY = node.cellSize * (leadY - 0.5) + cellH * (alignY - 0.5);
	const seats = [];
	for (let i = 0; i < reels; i++) {
		for (let j = 0; j < rows; j++) {
			const x = left + i * pitchX;
			const y = top + j * pitchY;
			seats.push({ i, j, x, y, cx: x + cellW / 2 + seatDX, cy: y + cellH / 2 + seatDY });
		}
	}
	return { reels, rows, cellW, cellH, left, top, width, height, seats };
};

// ---------------------------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------------------------
let checks = 0;
let failures = 0;
let worstRelative = 0;
let worstRelativeLabel = '';
const fail = (message) => {
	failures += 1;
	console.log(`FAIL  ${message}`);
};
const same = (label, got, want) => {
	checks += 1;
	if (!Object.is(got, want)) fail(`${label}  got=${got}  want=${want}`);
};
/**
 * Equality after the affine map, and only there. The two sides compute the SAME quantity through
 * different expression trees — the editor contracts a layout-px lattice, the engine contracts a
 * board-local one and is then folded through a pivot and a scale — so they associate differently in
 * floating point and exact equality is not the honest question. It is a RELATIVE epsilon, and the
 * worst one observed is printed at the end so a drift that stays under it cannot hide.
 *
 * This is NOT a looser version of `same`. Flat parity is `same`, exact, forever. Do not "fix" a
 * failing parity check by reaching for this one, and do not widen it to make a seat check pass —
 * the mapping comes from the real `boardLayout()`, so a failure here is a real divergence.
 */
const maps = (label, got, want) => {
	checks += 1;
	if (!Number.isFinite(got) || !Number.isFinite(want)) {
		fail(`${label}  got=${got}  want=${want}`);
		return;
	}
	const scale = Math.max(1, Math.abs(want));
	const relative = Math.abs(got - want) / scale;
	if (relative > worstRelative) {
		worstRelative = relative;
		worstRelativeLabel = label;
	}
	if (relative > 1e-9) fail(`${label}  got=${got}  want=${want}  rel=${relative}`);
};
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
// 1. FLAT PARITY — every grid x board size x unusable-perspective variant produces byte-identically
//    the geometry the editor produced before the feature existed.
// ---------------------------------------------------------------------------------------------
for (const [gridLabel, over] of GRIDS) {
	for (const [flatLabel, perspective] of FLAT_PERSPECTIVES) {
		for (const [reels, rows] of DIMS) {
			const node = nodeOf(over, perspective);
			const geo = reelGridGeometry(node, ANCHOR, { reels, rows });
			const before = geometryBeforePerspective(node, ANCHOR, { reels, rows });
			const where0 = `${gridLabel} | ${flatLabel} | ${reels}x${rows}`;
			for (const key of ['reels', 'rows', 'cellW', 'cellH', 'left', 'top', 'width', 'height']) {
				same(`${where0} :: geo.${key}`, geo[key], before[key]);
			}
			// A flat board is not a trapezoid and does not clip to one: the caller must take its
			// original `fillRect` / `strokeRect` / `rect` path, not a path built from 4 corners.
			same(`${where0} :: no outline (flat)`, geo.outline, undefined);
			same(`${where0} :: no clip (flat)`, geo.clip, undefined);
			same(`${where0} :: seat count`, geo.seats.length, before.seats.length);
			for (let n = 0; n < before.seats.length; n += 1) {
				const got = geo.seats[n];
				const want = before.seats[n];
				const where = `${where0} | seat ${n} (${want.i}, ${want.j})`;
				same(`${where} :: i`, got.i, want.i);
				same(`${where} :: j`, got.j, want.j);
				same(`${where} :: x`, got.x, want.x);
				same(`${where} :: y`, got.y, want.y);
				same(`${where} :: cx`, got.cx, want.cx);
				same(`${where} :: cy`, got.cy, want.cy);
				// The new fields must be the flat literals, not products: `cellW * 1` is `cellW` for
				// every float, but a COMPUTED `scale` of 1 would mean the perspective algebra ran.
				same(`${where} :: w === cellW`, got.w, geo.cellW);
				same(`${where} :: h === cellH`, got.h, geo.cellH);
				same(`${where} :: scale === 1`, got.scale, 1);
			}
		}
	}
}

// ---------------------------------------------------------------------------------------------
// 2. THE STATED ORIGIN — the closed form the editor's perspective block documents really is the
//    map that `boardLayout()`'s pivot produces. Asserted, not assumed: if the `(cellW - cellSize)/2`
//    and `gapY/2` terms were a fudge rather than the pivot's cancellation, this fails first and
//    names the axis.
// ---------------------------------------------------------------------------------------------
for (const [gridLabel, over] of GRIDS) {
	for (const [reels, rows] of DIMS) {
		const node = nodeOf(over);
		const { geo, toEditor } = sidesFor(node, reels, rows);
		const origin = toEditor({ x: 0, y: 0 });
		const where = `${gridLabel} | ${reels}x${rows}`;
		maps(
			`${where} :: X0 === left + (cellW - cellSize)/2`,
			origin.x,
			geo.left + (geo.cellW - node.cellSize) / 2,
		);
		maps(`${where} :: Y0 === top - gapY/2`, origin.y, geo.top - node.gapY / 2);
		// …and the scale of the map is the board container's, `cellSize / SYMBOL_SIZE`.
		const unit = toEditor({ x: 1, y: 1 });
		maps(`${where} :: the map's x scale`, unit.x - origin.x, node.cellSize / SYMBOL_SIZE);
		maps(`${where} :: the map's y scale`, unit.y - origin.y, node.cellSize / SYMBOL_SIZE);
	}
}

// ---------------------------------------------------------------------------------------------
// 3. EQUIVALENCE — the editor's seat IS the engine's seat, flat AND under perspective.
// ---------------------------------------------------------------------------------------------
const PERSPECTIVES = [
	['flat', undefined],
	...FAR_SCALES.map((farScale) => [`farScale ${farScale}`, { farScale }]),
	['farScale 0.5 + vanishX 0', { farScale: 0.5, vanishX: 0 }],
	['farScale 0.5 + vanishX 800 (off-centre right)', { farScale: 0.5, vanishX: 800 }],
	['farScale 0.4 + vanishX -250 (off-centre left)', { farScale: 0.4, vanishX: -250 }],
];

for (const [gridLabel, over] of GRIDS) {
	for (const [pLabel, perspective] of PERSPECTIVES) {
		for (const [reels, rows] of DIMS) {
			const node = nodeOf(over, perspective);
			const { grid, engine, geo, toEditor } = sidesFor(node, reels, rows);
			const where0 = `${gridLabel} | ${pLabel} | ${reels}x${rows}`;
			const { cellWidthLocal, cellHeightLocal } = engine.boardGeometry();
			for (const seat of geo.seats) {
				const where = `${where0} | cell (${seat.i}, ${seat.j})`;
				const game = engine.getSymbolSeat(seat.i, seat.j);
				const want = toEditor(game);
				// THE assertion this fixture exists for.
				maps(`${where} :: seat cx`, seat.cx, want.x);
				maps(`${where} :: seat cy`, seat.cy, want.y);
				// The row's SCALE is the same number on both sides — exactly, since both compute
				// `farScale + perRow * row` from the same two inputs.
				same(`${where} :: seat scale`, seat.scale, game.scale);
				// …and therefore the CELL BOX the editor sizes a symbol into is the box the game
				// contain-fits its sprite/spine into: the game's cell is `cellW/HLocal` scaled by the
				// symbol container, which maps to `cellWidth * scale` in layout px.
				maps(`${where} :: cell w`, seat.w, grid.cellWidth * game.scale);
				maps(`${where} :: cell h`, seat.h, grid.cellHeight * game.scale);
				ok(`${where} :: finite seat`, Number.isFinite(seat.cx) && Number.isFinite(seat.cy));
				// The board-LOCAL cell box the engine reports, mapped through the container scale, is
				// the same box — a second route to the same number.
				maps(
					`${where} :: cell w via board-local`,
					seat.w,
					(cellWidthLocal * grid.cellSize * game.scale) / SYMBOL_SIZE,
				);
				maps(
					`${where} :: cell h via board-local`,
					seat.h,
					(cellHeightLocal * grid.cellSize * game.scale) / SYMBOL_SIZE,
				);
			}
		}
	}
}

// ---------------------------------------------------------------------------------------------
// 4. THE MODEL — the editor implements the design's shape, stated in the EDITOR's own terms, so a
//    mirror that merely inherited the engine's rounding would still have to be right.
// ---------------------------------------------------------------------------------------------
for (const [gridLabel, over] of GRIDS) {
	for (const farScale of FAR_SCALES) {
		for (const [reels, rows] of DIMS) {
			const geo = reelGridGeometry(nodeOf(over, { farScale }), ANCHOR, { reels, rows });
			const flat = reelGridGeometry(nodeOf(over), ANCHOR, { reels, rows });
			const frontRow = rows - 1;
			const where0 = `${gridLabel} | farScale ${farScale} | ${reels}x${rows}`;
			const seatAt = (i, j) => geo.seats.find((s) => s.i === i && s.j === j);
			const flatAt = (i, j) => flat.seats.find((s) => s.i === i && s.j === j);

			ok(`${where0} :: the mode is ON (an outline exists)`, Array.isArray(geo.outline));
			ok(`${where0} :: a clip window exists`, !!geo.clip);

			// -- the depth ramp ----------------------------------------------------------------------
			for (let j = 0; j <= frontRow; j += 1) {
				const t = frontRow > 0 ? j / frontRow : 0;
				near(
					`${where0} :: scale(${j}) === farScale + (1-farScale)*t`,
					seatAt(0, j).scale,
					farScale + (1 - farScale) * t,
				);
			}
			same(`${where0} :: the BACK row draws at farScale exactly`, seatAt(0, 0).scale, farScale);
			near(`${where0} :: the FRONT row draws at 1`, seatAt(0, frontRow).scale, 1);
			// The cell box follows the row, on both axes.
			near(`${where0} :: back-row cell w`, seatAt(0, 0).w, geo.cellW * farScale);
			near(`${where0} :: back-row cell h`, seatAt(0, 0).h, geo.cellH * farScale);
			near(`${where0} :: front-row cell w === the flat cell`, seatAt(0, frontRow).w, geo.cellW);

			// -- x converges toward the vanishing point ------------------------------------------------
			const spreadAt = (j) => seatAt(reels - 1, j).cx - seatAt(0, j).cx;
			near(
				`${where0} :: the back row's spread is farScale x the front row's`,
				spreadAt(0),
				farScale * spreadAt(frontRow),
			);
			// The DEFAULT vanishing point is the lattice centre, so a symmetric column pair closes
			// symmetrically — its midpoint is the same on every row, and equals the FLAT midpoint.
			const midAt = (j) => (seatAt(0, j).cx + seatAt(reels - 1, j).cx) / 2;
			const flatMid = (flatAt(0, 0).cx + flatAt(reels - 1, 0).cx) / 2;
			for (let j = 0; j <= frontRow; j += 1) {
				near(`${where0} :: the column midpoint is row-independent (row ${j})`, midAt(j), flatMid);
			}
			// An AUTHORED vanishing point is a FIXED POINT: a column sitting exactly on it never moves.
			// Authored in the GAME's board-local units, so this also re-proves the unit conversion.
			{
				const vanishX = sidesFor(nodeOf(over), reels, rows).engine.getSymbolX(1);
				const pinned = reelGridGeometry(nodeOf(over, { farScale, vanishX }), ANCHOR, {
					reels,
					rows,
				});
				for (let j = 0; j <= frontRow; j += 1) {
					near(
						`${where0} :: a column AT the authored vanishX does not move (row ${j})`,
						pinned.seats.find((s) => s.i === 1 && s.j === j).cx,
						flatAt(1, j).cx,
					);
				}
			}

			// -- rows compress with depth ---------------------------------------------------------------
			for (let j = 1; j <= frontRow; j += 1) {
				ok(
					`${where0} :: y increases from row ${j - 1} to ${j}`,
					seatAt(0, j).cy > seatAt(0, j - 1).cy,
				);
			}
			for (let j = 1; j < frontRow; j += 1) {
				const behind = seatAt(0, j).cy - seatAt(0, j - 1).cy;
				const ahead = seatAt(0, j + 1).cy - seatAt(0, j).cy;
				// farScale < 1 => the back is smaller => the gaps GROW toward the front. A farScale > 1
				// (legal, inverts the depth) does the opposite; either way they must not be equal.
				ok(
					`${where0} :: the row pitch changes with depth at row ${j}`,
					farScale < 1 ? ahead > behind : ahead < behind,
				);
			}

			// -- the outline is a trapezoid, and it is the board's own edges ------------------------------
			const [backLeft, backRight, frontRight, frontLeft] = geo.outline;
			same(`${where0} :: the outline has 4 corners`, geo.outline.length, 4);
			near(`${where0} :: the back edge is level`, backLeft.y, backRight.y);
			near(`${where0} :: the front edge is level`, frontRight.y, frontLeft.y);
			ok(`${where0} :: the back edge is above the front edge`, backLeft.y < frontLeft.y);
			near(
				`${where0} :: the back edge is farScale x the front edge`,
				backRight.x - backLeft.x,
				farScale * (frontRight.x - frontLeft.x),
			);
			// The outline's front width is the FLAT board width (the front row draws at 1)…
			near(
				`${where0} :: the front edge is the flat board width`,
				frontRight.x - frontLeft.x,
				geo.width,
			);
			// …and its sides really are the outer cells' box edges, so the drawn trapezoid frames the
			// cells rather than floating near them.
			near(
				`${where0} :: the back-left corner is the back-left cell's edge`,
				backLeft.x,
				seatAt(0, 0).x,
			);
			near(
				`${where0} :: the back-right corner is the back-right cell's edge`,
				backRight.x,
				seatAt(reels - 1, 0).x + seatAt(reels - 1, 0).w,
			);
			near(`${where0} :: the back edge is the back row's top`, backLeft.y, seatAt(0, 0).y);
			near(
				`${where0} :: the front edge is the front row's bottom`,
				frontLeft.y,
				seatAt(0, frontRow).y + seatAt(0, frontRow).h,
			);
			// The clip is the outline's axis-aligned BOUND — never tighter, or the editor would crop
			// art the game shows.
			for (const p of geo.outline) {
				ok(
					`${where0} :: the clip contains the outline corner (${p.x}, ${p.y})`,
					p.x >= geo.clip.x - 1e-9 &&
						p.x <= geo.clip.x + geo.clip.w + 1e-9 &&
						p.y >= geo.clip.y - 1e-9 &&
						p.y <= geo.clip.y + geo.clip.h + 1e-9,
				);
			}
		}
	}
}

console.log(
	`\n${checks} assertions across ${GRIDS.length} grids x ${DIMS.length} board sizes x ` +
		`${FLAT_PERSPECTIVES.length} flat variants + ${PERSPECTIVES.length - 1} perspectives`,
);
console.log(
	`worst relative error through the affine map: ${worstRelative.toExponential(3)}` +
		(worstRelativeLabel ? `  (${worstRelativeLabel})` : ''),
);
if (failures) {
	console.log(`${failures} FAILED — the editor and the game do not agree on where a symbol sits.`);
	process.exit(1);
}
console.log(
	'PASS — a flat board previews byte-identically to before, and every seat the editor draws is ' +
		"the seat the engine gives, through boardLayout()'s own pivot.",
);
