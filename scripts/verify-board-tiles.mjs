// Offline fixture for the board's GROUND TILES (docs/design/perspective-board-mode.md, phase 4).
//
//   node scripts/verify-board-tiles.mjs
//
// WHAT IT PROVES. The tiles are an optional art key on the `reelGrid` node, stamped once per cell
// at the cell's SEAT and scaled by its row. Four claims, and every one of them fails silently:
//
//   1. PARITY — a board with no tile art authored mounts NO tile layer, so its scene graph is
//      byte-identical to before the feature existed. `apps/lines` IS the shared `_runtime/lines`
//      bundle every online game runs, so "it only renders when authored" is not a nicety.
//   2. THE SEATS — a tile's position and scale ARE `getSymbolSeat(reel, row)`'s, for every cell,
//      across the whole phases 0+1 knob matrix, flat AND under perspective. This is the entire
//      argument for drawing tiles from the lattice instead of painting them into the ground art:
//      they cannot desync. So the fixture asserts the tile READS the seat — not that some
//      re-derivation of it happens to agree today.
//   3. THE SHIP CHAIN (CLAUDE.md rule 8) — `collectArtRefs` in the editor-art exporter is a
//      per-node-KIND whitelist. The editor reads art straight from R2, so a tile key the exporter
//      does not know about renders perfectly while it is being authored and ships as a MISSING
//      FRAME. This is the assertion that stops the phase shipping a blank tile.
//   4. THE WIN HIGHLIGHT — a tile asks the dim exactly the question its symbol asks, about the same
//      cell, so the ground under a paying cell cannot stay bright while the symbol on it darkens.
//
// HOW IT RUNS THE REAL SOURCE. Nothing below is a copy of the shipped code:
//   * `parseScopedFrameRef` & co are IMPORTED from `editorArtKey.ts` (Node >= 22.18 strips types);
//   * `resolveReelGridTileArt`, and `collectArtRefs` with its helpers, are SLICED out of their
//     modules by brace balance and evaluated (both files pull in things Node cannot resolve here);
//   * the seat block is sliced out of `gameState.svelte.ts` the way `verify-symbol-seat.mjs` does
//     it (that module is full of runes and cannot be imported);
//   * and the tile component's own `$derived`s AND its `<Container>`/`<Sprite>` attribute
//     expressions are sliced out of `BoardTile.svelte` and evaluated in that scope — so what is
//     asserted is literally what Pixi is handed, whatever that turns out to be.
// Every slice throws if its anchor moves, which is exactly when someone needs to be told.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { editorArtTextureKey } from '../packages/engine-layout/src/lib/editorArtKey.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Normalized to LF: the repo checks out CRLF on Windows and every anchor below is written with \n.
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

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
const ok = (label, condition) => {
	checks += 1;
	if (!condition) fail(label);
};
const deepSame = (label, got, want) => {
	checks += 1;
	const a = JSON.stringify(got);
	const b = JSON.stringify(want);
	if (a !== b) fail(`${label}  got=${a}  want=${b}`);
};

// =============================================================================================
// Slicing helpers — pull a real function / expression out of a module that cannot be imported.
// =============================================================================================

/** Index of the `)` closing the `(` at `open`. */
const matchParen = (src, open) => {
	let depth = 0;
	for (let i = open; i < src.length; i += 1) {
		if (src[i] === '(') depth += 1;
		else if (src[i] === ')') {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	throw new Error('unbalanced parentheses');
};

/** Index of the `}` closing the `{` at `open`. */
const matchBrace = (src, open) => {
	let depth = 0;
	for (let i = open; i < src.length; i += 1) {
		if (src[i] === '{') depth += 1;
		else if (src[i] === '}') {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	throw new Error('unbalanced braces');
};

/** Split a parameter list at TOP-LEVEL commas and keep each parameter's NAME — all a plain-JS
 *  re-declaration of the function needs. */
const paramNames = (params) => {
	const out = [];
	let depth = 0;
	let current = '';
	for (const ch of params) {
		if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth += 1;
		else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth -= 1;
		if (ch === ',' && depth === 0) {
			out.push(current);
			current = '';
		} else current += ch;
	}
	out.push(current);
	return out
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => {
			const m = p.match(/^([A-Za-z_$][\w$]*)/);
			if (!m) throw new Error(`could not read a parameter name from "${p}"`);
			return m[1];
		});
};

/** The TypeScript a sliced BODY can still carry. Deliberately narrow: an annotation shape these
 *  three regexes do not know about makes the `new Function` below throw a SyntaxError, which is the
 *  loud failure we want rather than a silently skipped check. */
const stripBodyTs = (body) =>
	body
		// `const visit = (node: LayoutNode): void => {`
		.replace(
			/\(\s*([A-Za-z_$][\w$]*)\s*:\s*[\w.[\]<>| ]+\s*\)\s*:\s*[\w.[\]<>| ]+\s*=>/g,
			'($1) =>',
		)
		// `new Map<string, Set<string>>(` / `new Set<string>(`
		.replace(/new (Map|Set)<(?:[^<>]|<[^<>]*>)*>\(/g, 'new $1(')
		// `const refs: ArtRefs = {`
		.replace(/\b(const|let)\s+([A-Za-z_$][\w$]*)\s*:\s*[\w.[\]<>|; ]+?\s*=/g, '$1 $2 =');

/** Slice `function <name>(…)…{ … }` out of `src` and rebuild it as plain JS. */
const sliceFunction = (src, name, where) => {
	const start = src.indexOf(`function ${name}(`);
	if (start < 0) throw new Error(`${where} no longer defines ${name}()`);
	const open = src.indexOf('(', start);
	const close = matchParen(src, open);
	const bodyStart = src.indexOf('{', close);
	if (bodyStart < 0) throw new Error(`${where}: could not find the body of ${name}()`);
	const bodyEnd = matchBrace(src, bodyStart);
	const params = paramNames(src.slice(open + 1, close));
	return `function ${name}(${params.join(', ')}) ${stripBodyTs(src.slice(bodyStart, bodyEnd + 1))}`;
};

/** Read `const <name> = $derived(<expr>);` out of a Svelte `<script>` and return `<expr>`. */
const readDerived = (script, name, where) => {
	const marker = `const ${name} = $derived(`;
	const at = script.indexOf(marker);
	if (at < 0) throw new Error(`${where} no longer declares a $derived "${name}"`);
	const open = at + marker.length - 1;
	// Prettier leaves a trailing comma inside a multi-line `$derived(…)` call; it is the call's, not
	// the expression's, so drop it before evaluating.
	return script
		.slice(open + 1, matchParen(script, open))
		.trim()
		.replace(/,$/, '');
};

/**
 * Read one element's attributes out of Svelte markup as `{ name: expression }`. Handles
 * `x={expr}` (brace-balanced, so a ternary survives) and the `{name}` SHORTHAND — which is
 * load-bearing here, because passing `scale` by shorthand is how a flat board's `undefined`
 * reaches Pixi at all.
 */
const readAttributes = (markup, tag, where) => {
	const at = markup.indexOf(`<${tag}`);
	if (at < 0) throw new Error(`${where} no longer renders a <${tag}>`);
	let i = at + tag.length + 1;
	const out = {};
	while (i < markup.length) {
		const ch = markup[i];
		if (ch === '>' || (ch === '/' && markup[i + 1] === '>')) break;
		if (/\s/.test(ch)) {
			i += 1;
			continue;
		}
		if (ch === '{') {
			const end = matchBrace(markup, i);
			const name = markup.slice(i + 1, end).trim();
			out[name] = name;
			i = end + 1;
			continue;
		}
		const m = markup.slice(i).match(/^([\w:-]+)=\{/);
		if (!m) {
			throw new Error(`${where}: cannot read <${tag}> attributes at "${markup.slice(i, i + 40)}"`);
		}
		const braceAt = i + m[0].length - 1;
		const end = matchBrace(markup, braceAt);
		out[m[1]] = markup.slice(braceAt + 1, end).trim();
		i = end + 1;
	}
	return out;
};

/** A Svelte component split into its `<script>` body and its markup. */
const splitComponent = (rel) => {
	const source = read(rel);
	const scriptOpen = source.indexOf('>', source.indexOf('<script'));
	const scriptEnd = source.indexOf('</script>');
	if (scriptOpen < 0 || scriptEnd < 0) throw new Error(`${rel} has no <script> block`);
	return { script: source.slice(scriptOpen + 1, scriptEnd), markup: source.slice(scriptEnd) };
};

/** Read `export const NAME = <number>;` out of a constants module. */
const readConst = (src, name, where) => {
	const m = src.match(new RegExp(`export const ${name} = (0x[0-9a-fA-F]+|[\\d.]+);`));
	if (!m) throw new Error(`${where} no longer exports ${name}`);
	return Number(m[1]);
};

const CONSTANTS = read('packages/engine-game/src/game/constants.ts');
const SYMBOL_SIZE = readConst(CONSTANTS, 'SYMBOL_SIZE', 'constants.ts');
const REEL_PADDING = readConst(CONSTANTS, 'REEL_PADDING', 'constants.ts');
const SYMBOL_DIM_TINT = readConst(CONSTANTS, 'SYMBOL_DIM_TINT', 'constants.ts');

// =============================================================================================
// 1. THE RESOLVER — `resolveReelGridTileArt`, sliced from the real `reelGrid.ts`.
//    Its `undefined` IS the parity switch: the layer only mounts when it returns something.
// =============================================================================================

const REEL_GRID_SRC = read('packages/engine-layout/src/lib/reelGrid.ts');
const resolveReelGridTileArt = new Function(
	'parseScopedFrameRef',
	'isManifestAssetKey',
	'editorArtTextureKey',
	`${sliceFunction(REEL_GRID_SRC.replace('export function', 'function'), 'resolveReelGridTileArt', 'reelGrid.ts')}
return resolveReelGridTileArt;`,
)(
	// Imported, not stubbed: the point of routing the tile ref through the shared parser is that a
	// tile and a sprite bound to the same frame resolve identically, and a stub would let this pass
	// while the real pair diverged.
	(await import('../packages/engine-layout/src/lib/editorArtKey.ts')).parseScopedFrameRef,
	(await import('../packages/engine-layout/src/lib/editorArtKey.ts')).isManifestAssetKey,
	editorArtTextureKey,
);

const MANIFEST = 'invisible_wall/knights/atlases/atlas_manifest_S_Ground.json';
const TILE_FRAME = 'T_Ground_Tile_0000';
const SCOPED_TILE = `${MANIFEST}::${TILE_FRAME}`;

console.log('1. the tile-art resolver');
deepSame(
	'a scoped ref resolves to the scoped key + a bare fallback',
	resolveReelGridTileArt({ tileRegion: SCOPED_TILE }),
	{
		key: editorArtTextureKey(MANIFEST, TILE_FRAME),
		fallbackKey: TILE_FRAME,
	},
);
deepSame(
	'a bare frame name resolves to itself (atlas-blind, as a bare sprite region is)',
	resolveReelGridTileArt({ tileRegion: TILE_FRAME }),
	{ key: TILE_FRAME },
);
// An un-scopeable atlas prefix (a bare manifest basename / a Sheet-Maker output prefix) DEGRADES to
// the bare frame — the ship path's repair restores the pin, and until it does the tile still draws.
deepSame(
	'an un-scopeable prefix degrades to the bare frame',
	resolveReelGridTileArt({ tileRegion: `atlas_manifest_S_Ground.json::${TILE_FRAME}` }),
	{ key: TILE_FRAME },
);

// PARITY: every shape that means "no tile art" must be undefined, because the mount is gated on it.
const ABSENT = [
	['no node at all', undefined],
	['a node with no tileRegion', { cellSize: 120 }],
	['an empty string', { tileRegion: '' }],
	['a null', { tileRegion: null }],
	['a number', { tileRegion: 7 }],
	['an object', { tileRegion: { key: 'x' } }],
	['a perspective block but no tile', { perspective: { farScale: 0.6 } }],
];
for (const [label, node] of ABSENT) {
	same(`parity :: ${label} ⇒ no tile art`, resolveReelGridTileArt(node), undefined);
}

// =============================================================================================
// 2. THE MOUNT GATE — the layer is constructed only when the resolver returned something.
// =============================================================================================

console.log('2. the mount gate (parity)');
const BOARD = read('apps/lines/src/components/Board.svelte');
const GAME_STATE = read('packages/engine-game/src/game/gameState.svelte.ts');

ok(
	'gameState exposes boardTileArt off the reelGrid node',
	/const boardTileArt = \(\) => resolveReelGridTileArt\(boardOverride\.node \?\? undefined\);/.test(
		GAME_STATE,
	),
);
ok(
	'…and it is on stateGameDerived, where the board reads it',
	/stateGameDerived[\s\S]*?\bboardTileArt,/.test(GAME_STATE) ||
		/\bboardTileArt,\n/.test(GAME_STATE),
);
ok(
	'Board.svelte derives the tile art from boardTileArt()',
	/const tileArt = \$derived\(context\.stateGameDerived\.boardTileArt\(\)\);/.test(BOARD),
);
// The gate itself: `<BoardTiles` must appear ONCE, and inside `{#if tileArt}`.
const tileMounts = BOARD.split('<BoardTiles').length - 1;
same('Board.svelte mounts <BoardTiles> exactly once', tileMounts, 1);
const gateAt = BOARD.indexOf('{#if tileArt}');
const mountAt = BOARD.indexOf('<BoardTiles');
ok('…and only inside `{#if tileArt}`', gateAt >= 0 && gateAt < mountAt);
ok(
	'…with the guard closing after it (no unguarded tail)',
	BOARD.indexOf('{/if}', mountAt) > mountAt &&
		BOARD.indexOf('{/if}', mountAt) < BOARD.indexOf('<BoardBase />', mountAt),
);

// =============================================================================================
// 3. THE SEATS — the tile's rendered attributes ARE `getSymbolSeat(reel, row)`'s.
// =============================================================================================

// -- the real seat block, sliced exactly as `verify-symbol-seat.mjs` slices it -------------------
const blockStart = GAME_STATE.indexOf('\tconst boardGeometry = () => {');
const seatStart = GAME_STATE.indexOf('\tconst getSymbolSeat = (');
if (blockStart < 0 || seatStart < blockStart) {
	throw new Error('could not locate the boardGeometry…getSymbolSeat block in gameState.svelte.ts');
}
const blockEnd = GAME_STATE.indexOf('\n\t};\n', seatStart);
if (blockEnd < 0) throw new Error('could not locate the end of getSymbolSeat');
const seatBlock = GAME_STATE.slice(blockStart, blockEnd + '\n\t};\n'.length)
	.replace(/: number/g, '')
	.replace(/: BoardPerspective/g, '');

const buildGetters = new Function(
	'SYMBOL_SIZE',
	'REEL_PADDING',
	'resolveReelGridFromNode',
	'resolveReelGridPerspective',
	'boardOverride',
	'deps',
	`${seatBlock}
return { boardGeometry, getSymbolX, getSymbolY, getSymbolSeat, boardPerspective };`,
);

const gettersFor = (grid, dims, perspective) =>
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

/** A resolved `ReelGridLayout` (what `resolveReelGridFromNode` returns), with the defaults. */
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

// The phases 0+1 matrix: every knob the lattice actually has, so "the tile is on the seat" is a
// claim about the lattice and not about one convenient grid.
const GRIDS = [
	['no reelGrid doc (coded constants)', null],
	['square flush cells', gridOf({})],
	['square, resized cell (130)', gridOf({ cellSize: 130, cellWidth: 130, cellHeight: 130 })],
	['non-square cells (150x90)', gridOf({ cellSize: 120, cellWidth: 150, cellHeight: 90 })],
	['gapX only', gridOf({ gapX: 14 })],
	['gapY only', gridOf({ gapY: 10 })],
	['gaps on a non-square cell', gridOf({ cellWidth: 150, cellHeight: 90, gapX: 14, gapY: 10 })],
	['off-centre reelPadding', gridOf({ reelPadding: 0.53 })],
	['off-centre rowPadding', gridOf({ rowPadding: 0.37 })],
	['off-centre lead on both axes', gridOf({ reelPadding: 0.8, rowPadding: 0.2 })],
	['symbolAlignX != 0.5', gridOf({ symbolAlignX: 0.25 })],
	['symbolAlignY = 1 (feet on the tile)', gridOf({ symbolAlignY: 1 })],
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

const DIMS = [
	[3, 3],
	[5, 4],
	[10, 10],
];

/** Flat first (`undefined`), then the perspectives — the SAME matrix has to hold under both. */
const PERSPECTIVES = [
	['flat (no perspective block)', undefined],
	['flat (farScale exactly 1)', { farScale: 1 }],
	['perspective farScale 0.5', { farScale: 0.5 }],
	['perspective farScale 0.75', { farScale: 0.75 }],
	['perspective farScale 0.3, vanishX authored off-centre', { farScale: 0.3, vanishX: -40 }],
];

// -- the tile component, sliced ------------------------------------------------------------------
const TILE = splitComponent('apps/lines/src/components/BoardTile.svelte');
const TILE_WHERE = 'BoardTile.svelte';
const tileExpr = {
	seat: readDerived(TILE.script, 'seat', TILE_WHERE),
	geometry: readDerived(TILE.script, 'geometry', TILE_WHERE),
	dimmed: readDerived(TILE.script, 'dimmed', TILE_WHERE),
	scale: readDerived(TILE.script, 'scale', TILE_WHERE),
};
const tilePaddingRow = (() => {
	const m = TILE.script.match(/const PADDING_ROW = (-?\d+);/);
	if (!m) throw new Error('BoardTile.svelte no longer declares PADDING_ROW');
	return Number(m[1]);
})();
const containerAttrs = readAttributes(TILE.markup, 'Container', TILE_WHERE);
const spriteAttrs = readAttributes(TILE.markup, 'Sprite', TILE_WHERE);

/**
 * Evaluate the component: its four `$derived`s, then every attribute expression it actually hands
 * `<Container>` / `<Sprite>`, in that same scope. A direct `eval` inside the function body is what
 * lets an arbitrary authored attribute expression be read here — so this asserts what Pixi gets,
 * not what this fixture assumes it gets.
 */
const renderTile = new Function(
	'props',
	'context',
	'getSymbolSeat',
	'stateGame',
	'winDimCellKey',
	'SYMBOL_DIM_TINT',
	'PADDING_ROW',
	'ATTRS',
	`const seat = ${tileExpr.seat};
	const geometry = ${tileExpr.geometry};
	const dimmed = ${tileExpr.dimmed};
	const scale = ${tileExpr.scale};
	const out = { container: {}, sprite: {} };
	for (const [key, expression] of Object.entries(ATTRS.container)) out.container[key] = eval(expression);
	for (const [key, expression] of Object.entries(ATTRS.sprite)) out.sprite[key] = eval(expression);
	return out;`,
);

const ART = { key: 'ATLAS::TILE', fallbackKey: 'TILE' };
const NO_DIM = { active: false, cells: {} };
const winDimCellKey = (reel, row) => `${reel}:${row}`;

const drawTile = (getters, reelIndex, row, winDim = NO_DIM) =>
	renderTile(
		{ reelIndex, row, art: ART },
		{ stateGameDerived: { boardGeometry: getters.boardGeometry } },
		getters.getSymbolSeat,
		{ winDim },
		winDimCellKey,
		SYMBOL_DIM_TINT,
		tilePaddingRow,
		{ container: containerAttrs, sprite: spriteAttrs },
	);

console.log('3. every tile sits on its cell’s seat, flat and under perspective');
// The container must carry POSITION + SCALE + TINT and nothing that would resize it — a width/height
// there would fight the seat scale.
deepSame(
	'the tile container is positioned/scaled/tinted only',
	Object.keys(containerAttrs).sort(),
	['scale', 'tint', 'x', 'y'],
);
ok('the tile sprite is not separately scaled', spriteAttrs.scale === undefined);
same('the tile sprite is centred on the seat', spriteAttrs.anchor, '0.5');

for (const [gridLabel, grid] of GRIDS) {
	for (const [perspectiveLabel, perspective] of PERSPECTIVES) {
		for (const [reels, rows] of DIMS) {
			const getters = gettersFor(grid, { reels, rows }, perspective);
			const geometry = getters.boardGeometry();
			const where0 = `${gridLabel} | ${perspectiveLabel} | ${reels}x${rows}`;
			for (let reelIndex = 0; reelIndex < reels; reelIndex += 1) {
				for (let row = 0; row < rows; row += 1) {
					const where = `${where0} | cell (${reelIndex}, ${row})`;
					const seat = getters.getSymbolSeat(reelIndex, row);
					const drawn = drawTile(getters, reelIndex, row);
					// THE claim: position and scale ARE the seat's, exactly — not near it.
					same(`${where} :: tile x === seat.x`, drawn.container.x, seat.x);
					same(`${where} :: tile y === seat.y`, drawn.container.y, seat.y);
					same(
						`${where} :: tile scale === the seat's row scale (1 collapsed to undefined)`,
						drawn.container.scale,
						seat.scale === 1 ? undefined : seat.scale,
					);
					// The Pixi v8 trap, stated as its own assertion: a FLAT seat must pass `undefined`,
					// because assigning `scale = 1` swaps the shared `defaultScale` singleton for an
					// owned ObservablePoint and dirties the transform — once per tile, per frame.
					if (seat.scale === 1) {
						same(
							`${where} :: a flat seat passes undefined, never 1`,
							drawn.container.scale,
							undefined,
						);
					}
					// The tile is the CELL BOX; the row scale is applied once, by the container.
					same(
						`${where} :: tile width === the cell box`,
						drawn.sprite.width,
						geometry.cellWidthLocal,
					);
					same(
						`${where} :: tile height === the cell box`,
						drawn.sprite.height,
						geometry.cellHeightLocal,
					);
					// Untinted with no dim running — byte-parity for every board that never dims.
					same(`${where} :: untinted with no win dim`, drawn.container.tint, 0xffffff);
				}
			}
		}
	}
}

// =============================================================================================
// 4. THE WIN HIGHLIGHT — the tile asks the same question its symbol asks, about the same cell.
// =============================================================================================

console.log('4. the win highlight keys off the symbol’s own dim set');
const SYMBOL = splitComponent('apps/lines/src/components/ReelSymbol.svelte');
const symbolDimExpr = readDerived(SYMBOL.script, 'dimmed', 'ReelSymbol.svelte');
const symbolPaddingRow = (() => {
	const m = SYMBOL.script.match(/const PADDING_ROW = (-?\d+);/);
	if (!m) throw new Error('ReelSymbol.svelte no longer declares PADDING_ROW');
	return Number(m[1]);
})();
same('the tile and the symbol agree on where the padding row is', tilePaddingRow, symbolPaddingRow);

const symbolDimmed = new Function(
	'props',
	'stateGame',
	'winDimCellKey',
	`return ${symbolDimExpr};`,
);

{
	const [reels, rows] = [5, 4];
	const getters = gettersFor(gridOf({}), { reels, rows }, { farScale: 0.6 });
	// A paying line: cells keyed the way the book keys them — by STRIP row (a book `position.row`
	// indexes the padded strip), which is exactly what `refreshWinDim` writes.
	const paying = [
		{ reel: 0, stripRow: 1 },
		{ reel: 1, stripRow: 2 },
		{ reel: 2, stripRow: 2 },
	];
	const cells = {};
	for (const p of paying) cells[winDimCellKey(p.reel, p.stripRow)] = true;
	const winDim = { active: true, cells };

	for (let reelIndex = 0; reelIndex < reels; reelIndex += 1) {
		for (let row = 0; row < rows; row += 1) {
			const stripRow = row - tilePaddingRow;
			const where = `cell (${reelIndex}, row ${row} / strip ${stripRow})`;
			const drawn = drawTile(getters, reelIndex, row, winDim);
			const symbolIsDim = symbolDimmed({ reelIndex, row: stripRow }, { winDim }, winDimCellKey);
			const pays = paying.some((p) => p.reel === reelIndex && p.stripRow === stripRow);
			// 1. the tile darkens iff the SYMBOL on that same cell darkens…
			same(
				`${where} :: the tile's tint follows its symbol's dim`,
				drawn.container.tint,
				symbolIsDim ? SYMBOL_DIM_TINT : 0xffffff,
			);
			// 2. …and that is "bright iff paying", so the ground under a paying cell stays lit.
			same(
				`${where} :: a paying cell's tile stays bright, the rest darken`,
				drawn.container.tint,
				pays ? 0xffffff : SYMBOL_DIM_TINT,
			);
		}
	}
	// Dim OFF ⇒ nothing is tinted, whatever is in the set (parity for every game with no dim).
	const inactive = { active: false, cells };
	for (let reelIndex = 0; reelIndex < reels; reelIndex += 1) {
		for (let row = 0; row < rows; row += 1) {
			same(
				`dim inactive :: (${reelIndex}, ${row}) is untinted`,
				drawTile(getters, reelIndex, row, inactive).container.tint,
				0xffffff,
			);
		}
	}
}

// =============================================================================================
// 5. RULE 8 — the tile frame must reach `collectArtRefs`, or it ships as a missing frame.
// =============================================================================================

console.log('5. the rule-8 ship chain: collectArtRefs sees the tile');
const EXPORT_SRC = read('apps/launcher-api/src/lib/server/editorArtExport.ts');
const collectArtRefs = new Function(
	'parseScopedFrameRef',
	[
		sliceFunction(EXPORT_SRC, 'isManifestAssetKey', 'editorArtExport.ts'),
		sliceFunction(EXPORT_SRC, 'isImageAssetKey', 'editorArtExport.ts'),
		sliceFunction(EXPORT_SRC, 'walkNodes', 'editorArtExport.ts'),
		sliceFunction(EXPORT_SRC, 'addImageRef', 'editorArtExport.ts'),
		sliceFunction(EXPORT_SRC, 'collectArtRefs', 'editorArtExport.ts'),
		'return collectArtRefs;',
	].join('\n'),
)((await import('../packages/engine-layout/src/lib/editorArtKey.ts')).parseScopedFrameRef);

const docWith = (nodes) => ({ scenes: [{ nodes }] });
const refsFor = (nodes) => {
	const refs = collectArtRefs(docWith(nodes), {});
	return {
		manifestKeys: [...refs.manifestKeys],
		usedRegions: [...refs.usedRegions],
		regionNames: [...refs.regionNames],
		imageKeys: [...refs.imageKeys],
		spineKeys: [...refs.spineKeys],
	};
};

{
	const refs = refsFor([{ kind: 'reelGrid', id: 'grid', tileRegion: SCOPED_TILE }]);
	deepSame('a scoped tile ref exports its atlas', refs.manifestKeys, [MANIFEST]);
	deepSame('…and marks the BARE frame used', refs.usedRegions, [TILE_FRAME]);
	ok(
		'…and NEVER the raw <assetKey>::<frame> string (the dangling guard reads usedRegions)',
		!refs.usedRegions.includes(SCOPED_TILE),
	);
}
{
	// A bare name carries no atlas, so it joins the name-guess pool the exporter resolves against
	// the project's atlases — and still counts as used, so a truly dangling one is reported.
	const refs = refsFor([{ kind: 'reelGrid', id: 'grid', tileRegion: TILE_FRAME }]);
	deepSame('a bare tile name joins the name-guess pool', refs.regionNames, [TILE_FRAME]);
	deepSame('…and is marked used', refs.usedRegions, [TILE_FRAME]);
	deepSame('…and pins no atlas', refs.manifestKeys, []);
}
{
	// Nested inside a container — the walk has to reach it, not just top-level scene nodes.
	const refs = refsFor([
		{
			kind: 'container',
			id: 'group',
			children: [{ kind: 'reelGrid', id: 'grid', tileRegion: SCOPED_TILE }],
		},
	]);
	deepSame('a nested reelGrid is walked too', refs.manifestKeys, [MANIFEST]);
	deepSame('…and its frame marked used', refs.usedRegions, [TILE_FRAME]);
}
{
	// PARITY: a reel grid with no tile art must add nothing at all.
	const refs = refsFor([{ kind: 'reelGrid', id: 'grid', cellSize: 120 }]);
	deepSame('a tile-less reelGrid contributes nothing', refs, {
		manifestKeys: [],
		usedRegions: [],
		regionNames: [],
		imageKeys: [],
		spineKeys: [],
	});
}
{
	// The control: a sprite bound to the SAME frame must produce the same refs, since the whole
	// reason the tile stores a scoped frame ref is that it then travels the chain as an ordinary
	// sprite frame. If these two ever diverge, one of them is shipping wrong.
	const tile = refsFor([{ kind: 'reelGrid', id: 'grid', tileRegion: SCOPED_TILE }]);
	const sprite = refsFor([{ kind: 'sprite', id: 's', region: SCOPED_TILE }]);
	deepSame('a tile ref exports exactly what the same sprite ref does', tile, sprite);
}

console.log(
	`\n${checks} assertions across ${GRIDS.length} grids x ${DIMS.length} board sizes x ` +
		`${PERSPECTIVES.length} perspective variants`,
);
if (failures) {
	console.log(`${failures} FAILED — the tile contract is broken.`);
	process.exit(1);
}
console.log(
	'PASS — no tile art mounts nothing, an authored tile sits exactly on its seat at its row scale, ' +
		'the win dim reaches it through the symbol’s own set, and the frame travels the export chain.',
);
