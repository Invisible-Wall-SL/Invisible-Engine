// Offline fixture for SYMBOL OVERFLOW — the `reelGrid` node's optional padding around the reel
// window, so a landed symbol drawn bigger than its cell is not cut off at the board edge.
//
//   node scripts/verify-symbol-overflow.mjs
//
// WHAT IT PROVES. The feature is three claims, and every one of them is a claim about code that
// cannot be type-checked into correctness (the launcher has no `check` script, and `apps/lines` is
// the shared `_runtime/lines` bundle every online game runs — a moved float here moves live boards
// with no authored change to blame). So all three are asserted against the SHIPPED expressions,
// sliced out of their real files:
//
//   1. PARITY. A node that authors no overflow — or authors an unusable one (0, negative, NaN,
//      Infinity, a string, absent) — produces byte-identically what it produced before the knob
//      existed: 0 out of the layout resolver, 0 out of the engine's `boardGeometry`, the shared
//      frozen zero out of `boardOverflow`, 0 out of the editor's `reelGridGeometry`, and a stepped
//      board's compound mask ring float-identical to the one it drew before.
//   2. THE GATE. The overflow is spent ONLY when every reel is `stopped`. This is the whole
//      "only the pictures that landed" contract: `SymbolWrap` culls a symbol when its CENTRE leaves
//      the window, so a cell entering from above is drawn while it is still half outside and the
//      mask is what hides that half. A mask grown mid-spin uncovers it — half a symbol blinking in
//      above the board, on every cell, at every reel, for the length of the spin.
//   3. THE GROWTH, AND THAT THE EDITOR AGREES. Authored + settled, the mask grows by exactly the
//      authored px on each side — and the Scene Editor's preview clip grows by the same authored px,
//      so the author is not positioning against a lie.
//
// WHY IT RUNS THE REAL SOURCE. `gameState.svelte.ts` is full of runes and `editorCanvas.helpers.ts`
// lives in a SvelteKit route, so neither imports from Node. Both are SLICED out verbatim and
// evaluated with their free names supplied — the same technique as `verify-symbol-seat.mjs` and
// `verify-reel-grid-geometry.mjs`, and it throws loudly if a block is renamed or reordered rather
// than silently testing less. `BoardMask.svelte` cannot be evaluated at all, so its four mask-rect
// prop EXPRESSIONS are lifted out of the markup by name and evaluated on their own — which is why
// this fixture pins the arithmetic that actually ships rather than a transcription of it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGrid } from '../packages/game-config/src/grid.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The repo checks out CRLF on Windows and the slice markers below are written with `\n`.
const readLF = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const ENGINE_SRC = readLF('packages/engine-game/src/game/gameState.svelte.ts');
const EDITOR_SRC = readLF('apps/launcher-api/src/routes/(app)/editor/editorCanvas.helpers.ts');
const LAYOUT_SRC = readLF('packages/engine-layout/src/lib/reelGrid.ts');
const CONSTANTS_SRC = readLF('packages/engine-game/src/game/constants.ts');
const MASK_SRC = readLF('apps/lines/src/components/BoardMask.svelte');
const EDITOR_CANVAS_SRC = readLF('apps/launcher-api/src/routes/(app)/editor/EditorCanvas.svelte');
const BOARD_SRC = readLF('apps/lines/src/components/Board.svelte');
const TUMBLE_SRC = readLF('apps/lines/src/components/TumbleBoard.svelte');

const readConst = (src, name, where) => {
	const match = src.match(new RegExp(`const ${name} = ([\\d.]+);`));
	if (!match) throw new Error(`${where} no longer declares ${name}`);
	return Number(match[1]);
};
const SYMBOL_SIZE = readConst(CONSTANTS_SRC, 'SYMBOL_SIZE', 'constants.ts');
const REEL_PADDING = readConst(CONSTANTS_SRC, 'REEL_PADDING', 'constants.ts');

/** Slice `[start, end)` out of a source file, failing loudly rather than testing less. */
const sliceBlock = (src, startMarker, endMarker, what) => {
	const from = src.indexOf(startMarker);
	if (from < 0) throw new Error(`could not locate ${what}`);
	const to = src.indexOf(endMarker, from);
	if (to < 0) throw new Error(`could not locate the end of ${what}`);
	return src.slice(from, to + endMarker.length);
};

// ---------------------------------------------------------------------------------------------
// The LAYOUT side: the real `resolveReelGridFromNode` (node → resolved grid, where the authored
// overflow is gated and folded through the cell scale).
// ---------------------------------------------------------------------------------------------
const resolveReelGridFromNode = new Function(
	'resolveTransform',
	`${sliceBlock(
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
		.replace(/: number/g, '')}
return resolveReelGridFromNode;`,
)((node) => ({ x: node.x, y: node.y, anchor: node.anchor, scale: node.scale }));

// ---------------------------------------------------------------------------------------------
// The ENGINE side: `boardGeometry` … `getSymbolSeat` (which carries `boardMaskColumns`), plus
// `boardOverflow`, which lives further down because it reads the live board's reel motion.
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
const overflowBlock = sliceBlock(
	ENGINE_SRC,
	'\tconst boardOverflow = () => {',
	'\n\t};\n',
	'boardOverflow in gameState.svelte.ts',
);
const engineBlock = (seatBlock + overflowBlock)
	.replace(/: number/g, '')
	.replace(/: BoardPerspective/g, '');

const buildEngine = new Function(
	'SYMBOL_SIZE',
	'REEL_PADDING',
	'NO_BOARD_OVERFLOW',
	'resolveReelGridFromNode',
	'resolveReelGridPerspective',
	'boardOverride',
	'stateGame',
	'deps',
	`${engineBlock}
return { boardGeometry, boardOverflow, boardMaskColumns };`,
);

/** The engine's own shared zero, read back out of the source so this fixture cannot assert against
 *  a different object than the one that ships. */
const NO_BOARD_OVERFLOW = (() => {
	const match = ENGINE_SRC.match(/const NO_BOARD_OVERFLOW = Object\.freeze\((\{[^}]*\})\);/);
	if (!match) throw new Error('gameState.svelte.ts no longer declares NO_BOARD_OVERFLOW');
	return Object.freeze(new Function(`return ${match[1]};`)());
})();

/**
 * @param node the raw `reelGrid` node (or null = "no doc", the coded constants)
 * @param motions one reel-motion string per reel — the live board this `boardOverflow` reads
 * @param rowsPerReel `{ rows, align }` for a STEPPED grid; absent ⇒ uniform
 */
const engineFor = (node, { dims = { reels: 5, rows: 3 }, motions, rowsPerReel } = {}) =>
	buildEngine(
		SYMBOL_SIZE,
		REEL_PADDING,
		NO_BOARD_OVERFLOW,
		(n, layoutType) => (n ? resolveReelGridFromNode(n, layoutType) : undefined),
		(n) => n?.perspective,
		{ node },
		{
			board: (motions ?? Array.from({ length: dims.reels }, () => 'stopped')).map((motion) => ({
				reelState: { motion },
			})),
		},
		{
			layout: { layoutType: () => 'desktop' },
			boardDimensions: () => ({ x: dims.reels, y: dims.rows }),
			// The REAL `resolveGrid`, so `stepped` is decided by the shipped code.
			activeGrid: () =>
				resolveGrid({
					numReels: dims.reels,
					numRows: rowsPerReel?.rows ?? Array.from({ length: dims.reels }, () => dims.rows),
					gridAlign: rowsPerReel?.align,
				}),
		},
	);

// ---------------------------------------------------------------------------------------------
// The EDITOR side: the real `reelGridGeometry`.
// ---------------------------------------------------------------------------------------------
const BOARD_LOCAL_CELL = readConst(EDITOR_SRC, 'BOARD_LOCAL_CELL', 'editorCanvas.helpers.ts');
const reelGridGeometry = new Function(
	'BOARD_LOCAL_CELL',
	'resolveReelGridPerspective',
	`${sliceBlock(
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
		.replace(/: number/g, '')}
return reelGridGeometry;`,
)(BOARD_LOCAL_CELL, (node) => node?.perspective);

// ---------------------------------------------------------------------------------------------
// The MASK's own arithmetic, lifted out of `BoardMask.svelte`'s markup. The component cannot be
// evaluated here, but its four prop expressions can — so what this fixture measures is the shipped
// rect, not a copy of it that can rot.
// ---------------------------------------------------------------------------------------------
const maskRect = (() => {
	const rect = sliceBlock(
		MASK_SRC,
		'{:else}',
		'/>',
		'the uniform-board <Rectangle isMask …> in BoardMask.svelte',
	);
	if (!/<Rectangle\s+isMask/.test(rect)) {
		throw new Error('the {:else} branch of BoardMask.svelte is no longer the single <Rectangle>');
	}
	const propOf = (name) => {
		// Balanced-brace read: each expression is one `{…}` with no nested braces today, and a nested
		// one would be caught by the evaluation below rather than silently truncated here.
		const at = rect.indexOf(`${name}={`);
		if (at < 0) throw new Error(`BoardMask.svelte's mask rect no longer sets ${name}`);
		let depth = 0;
		let i = at + name.length + 1;
		const from = i + 1;
		for (; i < rect.length; i += 1) {
			if (rect[i] === '{') depth += 1;
			else if (rect[i] === '}' && (depth -= 1) === 0) break;
		}
		return rect.slice(from, i);
	};
	const build = new Function(
		'SYMBOL_SIZE',
		'windowWidth',
		'windowHeight',
		'overflow',
		`return {
			x: ${propOf('x')},
			y: ${propOf('y')},
			width: ${propOf('width')},
			height: ${propOf('height')},
		};`,
	);
	return (windowWidth, windowHeight, overflow) =>
		build(SYMBOL_SIZE, windowWidth, windowHeight, overflow);
})();

// ---------------------------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------------------------
let checks = 0;
let failures = 0;
const fail = (message) => {
	failures += 1;
	console.error(`FAIL  ${message}`);
};
const ok = (label, condition) => {
	checks += 1;
	if (!condition) fail(label);
};
/** Float equality, `Object.is` — parity claims are not "close enough" claims. */
const same = (label, got, want) => {
	checks += 1;
	if (!Object.is(got, want)) fail(`${label}  got=${got}  want=${want}`);
};
const near = (label, got, want, epsilon = 1e-9) => {
	checks += 1;
	if (!(Math.abs(got - want) <= epsilon)) fail(`${label}  got=${got}  want=${want}`);
};

const nodeOf = (extra = {}) => ({
	id: 'board',
	kind: 'reelGrid',
	reels: 5,
	rows: 3,
	cellSize: 120,
	x: 0,
	y: 0,
	anchor: { x: 0.5, y: 0.5 },
	...extra,
});

/**
 * The board container's scale — the game seats in board-LOCAL units inside it, so this is what turns
 * an authored px into the local px `boardOverflow` answers in.
 *
 * It is the SQUARE `cellSize`, never `cellWidth`: `boardGeometry` divides every local edge by
 * `override.cellSize / SYMBOL_SIZE`, and a non-square board expresses its width through
 * `cellWidthLocal` instead. And it is the RESOLVED cellSize, so a node carrying a transform scale
 * (an editor drag-resize) folds that scale into the numerator and the denominator alike — which is
 * exactly why the authored px survives a resize.
 */
const boardScaleOf = (node) => resolveReelGridFromNode(node, 'desktop').cellSize / SYMBOL_SIZE;

// The shapes that must all mean "off". `0` and the negatives matter most: a negative would SHRINK
// the window, cutting art that fits its cell today on every game running the shared bundle.
const UNUSABLE = [
	['absent', {}],
	['zero', { overflowX: 0, overflowY: 0 }],
	['negative', { overflowX: -40, overflowY: -40 }],
	['NaN', { overflowX: Number.NaN, overflowY: Number.NaN }],
	['Infinity', { overflowX: Infinity, overflowY: Infinity }],
	['a string', { overflowX: '40', overflowY: '40' }],
	['null', { overflowX: null, overflowY: null }],
	['x only, unusable y', { overflowX: 0, overflowY: -1 }],
];

// The board shapes the overflow has to survive — the same axes the other reel-grid fixtures walk,
// because the fold through the cell scale is where an authored px and a board-local px meet.
const GRIDS = [
	['square flush', {}],
	['big cell', { cellSize: 240 }],
	['small cell', { cellSize: 60 }],
	['non-square', { cellSize: 120, cellWidth: 150, cellHeight: 90 }],
	['gapped', { cellSize: 120, gapX: 12, gapY: 8 }],
	['everything at once', { cellSize: 200, cellWidth: 260, cellHeight: 140, gapX: 18, gapY: 9 }],
	// A drag-resized board. The resize writes the node's transform `scale` (that is how every node
	// resizes), and `resolveReelGridFromNode` folds it into the cell size AND into the overflow — so
	// the spill zooms with the board it belongs to instead of staying at its pre-resize size.
	['drag-resized', { cellSize: 120, scale: { x: 1.75, y: 1.75 } }],
	['drag-resized non-square', { cellSize: 90, cellWidth: 130, gapY: 6, scale: { x: 0.6, y: 0.6 } }],
];

// ---------------------------------------------------------------------------------------------
// 1. PARITY — nothing authored (or nothing usable) is byte-identically the old behaviour.
// ---------------------------------------------------------------------------------------------
for (const [gridLabel, grid] of GRIDS) {
	for (const [offLabel, off] of UNUSABLE) {
		const where = `${gridLabel} | ${offLabel}`;
		const node = nodeOf({ ...grid, ...off });

		const resolved = resolveReelGridFromNode(node, 'desktop');
		same(`${where} :: resolver overflowX`, resolved.overflowX, 0);
		same(`${where} :: resolver overflowY`, resolved.overflowY, 0);

		const engine = engineFor(node);
		same(`${where} :: boardGeometry().overflowXLocal`, engine.boardGeometry().overflowXLocal, 0);
		same(`${where} :: boardGeometry().overflowYLocal`, engine.boardGeometry().overflowYLocal, 0);
		// The SHARED frozen object, not merely an equal one: `BoardMask`'s `$derived` re-runs on a
		// changed reference, and a fresh `{x:0,y:0}` per call would invalidate it every tick.
		same(
			`${where} :: boardOverflow() is the shared zero`,
			engine.boardOverflow(),
			NO_BOARD_OVERFLOW,
		);

		const geo = reelGridGeometry(node, node.anchor, { reels: 5, rows: 3 });
		same(`${where} :: editor geo.overflowX`, geo.overflowX, 0);
		same(`${where} :: editor geo.overflowY`, geo.overflowY, 0);

		// The mask rect the component builds is the rect it built before the knob existed.
		const rect = maskRect(1000, 360, NO_BOARD_OVERFLOW);
		same(`${where} :: mask x`, rect.x, -SYMBOL_SIZE);
		same(`${where} :: mask width`, rect.width, 1000 + SYMBOL_SIZE * 2);
		same(`${where} :: mask height`, rect.height, 360);
		// `y` is left UNSET rather than assigned a 0 — `pixi-svelte` skips undefined props, so an
		// un-authored board's mask container is touched by exactly the props it always was.
		same(`${where} :: mask y is unset`, rect.y, undefined);
	}

	// A STEPPED board's compound ring is float-identical with no overflow to the call that predates
	// the parameters. Every vertex, not a sampled one.
	const node = nodeOf({ ...grid });
	const stepped = { rows: [3, 4, 5, 4, 3], align: 'middle' };
	const engine = engineFor(node, { dims: { reels: 5, rows: 5 }, rowsPerReel: stepped });
	const before = engine.boardMaskColumns();
	const after = engine.boardMaskColumns(0, 0);
	ok(`${gridLabel} | stepped :: the compound ring exists`, Array.isArray(before));
	for (let c = 0; c < before.length; c += 1) {
		for (let v = 0; v < before[c].length; v += 1) {
			same(`${gridLabel} | stepped :: column ${c} vertex ${v} x`, after[c][v].x, before[c][v].x);
			same(`${gridLabel} | stepped :: column ${c} vertex ${v} y`, after[c][v].y, before[c][v].y);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// 2. THE GATE — the overflow is spent only when EVERY reel has stopped.
// ---------------------------------------------------------------------------------------------
{
	const node = nodeOf({ overflowX: 30, overflowY: 45 });
	const local = { x: 30 / boardScaleOf(node), y: 45 / boardScaleOf(node) };
	const MOVING = ['spinning', 'bouncing'];

	for (const motion of MOVING) {
		// Every reel moving…
		const all = engineFor(node, { motions: Array.from({ length: 5 }, () => motion) });
		same(`gate :: all reels ${motion}`, all.boardOverflow(), NO_BOARD_OVERFLOW);
		// …and every single-reel case, because the mask is ONE rectangle over all five columns:
		// growing it while any reel still rolls uncovers THAT reel's strip.
		for (let reel = 0; reel < 5; reel += 1) {
			const motions = Array.from({ length: 5 }, () => 'stopped');
			motions[reel] = motion;
			const one = engineFor(node, { motions });
			same(
				`gate :: reel ${reel} still ${motion} (a staggered / anticipated stop)`,
				engineFor(node, { motions }).boardOverflow(),
				NO_BOARD_OVERFLOW,
			);
			ok(
				`gate :: reel ${reel} ${motion} returns the frozen zero`,
				Object.isFrozen(one.boardOverflow()),
			);
		}
	}

	const settled = engineFor(node).boardOverflow();
	near('gate :: settled spends the authored x', settled.x, local.x);
	near('gate :: settled spends the authored y', settled.y, local.y);
}

// ---------------------------------------------------------------------------------------------
// 3. THE GROWTH, AND THE EDITOR AGREEING WITH IT.
// ---------------------------------------------------------------------------------------------
const AUTHORED = [
	['y only (the reported case: art cut at the top / bottom)', { overflowX: 0, overflowY: 60 }],
	['x only', { overflowX: 55, overflowY: 0 }],
	['both', { overflowX: 24, overflowY: 72 }],
	['asymmetric axes', { overflowX: 8, overflowY: 140 }],
];

for (const [gridLabel, grid] of GRIDS) {
	for (const [authoredLabel, authored] of AUTHORED) {
		const where = `${gridLabel} | ${authoredLabel}`;
		const node = nodeOf({ ...grid, ...authored });
		const scale = boardScaleOf(node);
		// A drag-resize lives on the node's TRANSFORM, and the editor canvas applies that scale around
		// this preview rather than inside it — so the editor's numbers are pre-resize and the engine's
		// are post-resize. That is the one factor between the two spaces, and naming it here is what
		// lets the agreement below be an equality rather than a shrug.
		const nodeScale = grid.scale?.x ?? 1;

		// THE ENGINE. The authored px is a board-LOCAL distance divided by the container scale — so
		// multiplying it back out has to land on exactly the px that was typed (times the resize).
		const overflow = engineFor(node).boardOverflow();
		near(
			`${where} :: engine x round-trips to the authored px`,
			overflow.x * scale,
			authored.overflowX * nodeScale,
		);
		near(
			`${where} :: engine y round-trips to the authored px`,
			overflow.y * scale,
			authored.overflowY * nodeScale,
		);

		// THE MASK. Grown by exactly that much on each of the four sides — and the top edge moves,
		// which is the half of this the old rect could not express at all (it had no `y`).
		const rect = maskRect(1000, 360, overflow);
		near(`${where} :: mask left edge`, rect.x, -SYMBOL_SIZE - overflow.x);
		near(`${where} :: mask right edge`, rect.x + rect.width, 1000 + SYMBOL_SIZE + overflow.x);
		near(`${where} :: mask top edge`, rect.y ?? 0, -overflow.y);
		near(`${where} :: mask bottom edge`, (rect.y ?? 0) + rect.height, 360 + overflow.y);

		// THE EDITOR. Its preview clip grows by the authored px in its own space, which is the same
		// distance on screen the engine's local overflow becomes — so what the author drags against
		// is what the game draws.
		const geo = reelGridGeometry(node, node.anchor, { reels: 5, rows: 3 });
		same(`${where} :: editor reports the authored overflowX`, geo.overflowX, authored.overflowX);
		same(`${where} :: editor reports the authored overflowY`, geo.overflowY, authored.overflowY);
		near(
			`${where} :: editor and engine grow by the same px on x`,
			geo.overflowX * nodeScale,
			overflow.x * scale,
		);
		near(
			`${where} :: editor and engine grow by the same px on y`,
			geo.overflowY * nodeScale,
			overflow.y * scale,
		);
		// It is CLIP-ONLY: no cell, no seat and no board box moves.
		const plain = reelGridGeometry(nodeOf({ ...grid }), node.anchor, { reels: 5, rows: 3 });
		for (const key of ['left', 'top', 'width', 'height', 'cellW', 'cellH']) {
			same(`${where} :: editor geo.${key} is untouched`, geo[key], plain[key]);
		}
		for (let n = 0; n < plain.seats.length; n += 1) {
			same(`${where} :: seat ${n} cx untouched`, geo.seats[n].cx, plain.seats[n].cx);
			same(`${where} :: seat ${n} cy untouched`, geo.seats[n].cy, plain.seats[n].cy);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// 4. THE STEPPED BOARD's compound ring grows the same way — outward at each column's OWN top and
//    bottom and at the board's two outer sides, and NOT at the boundaries between columns. Those
//    boundaries are the exact tiling that makes the union mean "the visible board"; widening them
//    would let a tall neighbour cover the notch beside a short column, and a symbol scrolling
//    through that notch would draw where the board does not exist.
// ---------------------------------------------------------------------------------------------
{
	const rowsPerReel = { rows: [3, 4, 5, 4, 3], align: 'middle' };
	const dims = { reels: 5, rows: 5 };
	for (const [gridLabel, grid] of GRIDS) {
		const node = nodeOf({ ...grid, overflowX: 24, overflowY: 72 });
		const engine = engineFor(node, { dims, rowsPerReel });
		const scale = boardScaleOf(node);
		const overflow = engine.boardOverflow();
		const before = engine.boardMaskColumns();
		const after = engine.boardMaskColumns(overflow.x, overflow.y);
		const where0 = `${gridLabel} | stepped`;
		near(
			`${where0} :: the overflow is the authored px`,
			overflow.y * scale,
			72 * (grid.scale?.x ?? 1),
		);

		for (let c = 0; c < before.length; c += 1) {
			const ys = before[c].map((p) => p.y);
			const topY = Math.min(...ys);
			const bottomY = Math.max(...ys);
			const xs = before[c].map((p) => p.x);
			const leftX = Math.min(...xs);
			const rightX = Math.max(...xs);
			for (let v = 0; v < before[c].length; v += 1) {
				const was = before[c][v];
				const now = after[c][v];
				// Y: outward at this column's own two edges, nowhere else.
				const wantDY = was.y === topY ? -overflow.y : was.y === bottomY ? overflow.y : 0;
				near(`${where0} :: column ${c} vertex ${v} dy`, now.y - was.y, wantDY);
				// X: only the board's OUTER sides move. An interior boundary is shared with a
				// neighbour, and the tiling depends on it staying put.
				const outer = (c === 0 && was.x === leftX) || (c === before.length - 1 && was.x === rightX);
				near(
					`${where0} :: column ${c} vertex ${v} dx`,
					now.x - was.x,
					outer ? (was.x === leftX ? -overflow.x : overflow.x) : 0,
				);
			}
		}
	}
}

// ---------------------------------------------------------------------------------------------
// 5. THE WIRING. Which board asks for the overflow is the difference between "landed art spills"
//    and "a falling symbol is drawn outside the board", so it is pinned in the markup.
// ---------------------------------------------------------------------------------------------
ok(
	'Board.svelte mounts the resting board mask WITH allowOverflow',
	/<BoardMask\s+allowOverflow\s*\/>/.test(BOARD_SRC),
);
ok(
	// A cascade's symbols cross the same window edge a rolling strip does, so the overlay keeps the
	// tight window: it has a spin's problem, not a settled board's.
	'TumbleBoard.svelte mounts its mask WITHOUT allowOverflow',
	/<BoardMask\s*\/>/.test(TUMBLE_SRC) && !/<BoardMask[^/]*allowOverflow/.test(TUMBLE_SRC),
);
ok(
	'BoardMask only reads boardOverflow() when the mount asked for it',
	/props\.allowOverflow\s*\?\s*context\.stateGameDerived\.boardOverflow\(\)\s*:\s*NO_OVERFLOW/.test(
		MASK_SRC,
	),
);
ok(
	'BoardMask passes the overflow through to the compound ring',
	/boardMaskColumns\(overflow\.x,\s*overflow\.y\)/.test(MASK_SRC),
);
// The editor's preview clip is drawing code, not geometry, so `reelGridGeometry` reporting the
// overflow proves nothing about whether the canvas SPENDS it. Both of `drawReelGrid`'s clip
// branches — the flat board box and the perspective bound — have to grow, or the author dials a
// number and sees their art keep getting cut.
{
	const draw = sliceBlock(
		EDITOR_CANVAS_SRC,
		'function drawReelGrid(',
		'\n\t}\n',
		'drawReelGrid in EditorCanvas.svelte',
	);
	ok(
		'the editor clips the perspective bound to the grown window',
		/clip\.x - geo\.overflowX[\s\S]{0,160}?clip\.w \+ geo\.overflowX \* 2/.test(draw),
	);
	ok(
		'the editor clips the flat board box to the grown window',
		/left - geo\.overflowX[\s\S]{0,160}?w \+ geo\.overflowX \* 2/.test(draw),
	);
	ok(
		'the editor draws the overflow band so the author can see the room it bought',
		/geo\.overflowX > 0 \|\| geo\.overflowY > 0/.test(draw) && /setLineDash/.test(draw),
	);
}

// ---------------------------------------------------------------------------------------------
console.log(`\n${checks} assertions across ${GRIDS.length} grids`);
if (failures > 0) {
	console.error(`\nFAILED — ${failures} assertion(s)`);
	process.exit(1);
}
console.log(
	'PASS — an un-authored board is byte-identical, the spill is spent only once every reel has stopped, and the editor grows its preview by the px the mask grows by.',
);
