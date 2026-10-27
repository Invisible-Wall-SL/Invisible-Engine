/**
 * Editing a `tilemap` node in the Scene Editor (`docs/design/game-families.md` §4.4, P10.13): its
 * selectable box, the stage ↔ cell mapping, the paint tools (brush, erase, fill, pick) and the
 * tileset / grid edits the canvas and Properties share. Plain functions over the node (the paint
 * itself is `engine-layout`'s `tilemapPaint` / `tilemapFill`), so a Node gate runs them.
 */
import {
	TILE_EMPTY,
	TILEMAP_MAX_SIDE,
	TILEMAP_MAX_TILES,
	newTilemapNode,
	tilemapCellAt,
	tilemapFill,
	tilemapPaint,
	tilemapPick,
	tilemapResize,
	tilemapTiles,
	type Point2D,
	type ResolvedTransform,
	type TileCollide,
	type TilemapNode,
} from 'engine-layout';

/** The paint mode's tools; `move` is paint mode off (a stage drag moves the node as usual). */
export type TilemapTool = 'move' | 'brush' | 'erase' | 'fill' | 'pick';

/** The tool buttons, in order, with the key that picks each while a tilemap is selected. */
export const TILEMAP_TOOLS: readonly {
	id: TilemapTool;
	label: string;
	key: string;
	does: string;
}[] = [
	{ id: 'move', label: 'Move', key: 'V', does: 'Paint off: drag the tilemap to move it' },
	{ id: 'brush', label: 'Brush', key: 'B', does: 'Click or drag to paint the brush tile' },
	{ id: 'erase', label: 'Erase', key: 'E', does: 'Click or drag to clear tiles' },
	{ id: 'fill', label: 'Fill', key: 'G', does: 'Flood-fill the touching cells of one tile' },
	{ id: 'pick', label: 'Pick', key: 'I', does: 'Take the clicked tile as the brush' },
];

/** The tool a key press picks, or `null` (a modifier held, or not a paint key). */
export function tilemapToolForKey(e: {
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
}): TilemapTool | null {
	if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return null;
	const key = e.key.toUpperCase();
	return TILEMAP_TOOLS.find((t) => t.key === key)?.id ?? null;
}

/** A new tilemap of `cols × rows` tiles, centred on (`cx`, `cy`) (a tilemap draws from its
 *  top-left). */
export function newTilemapAt(id: string, cx: number, cy: number): TilemapNode {
	const node = newTilemapNode(id, 0, 0);
	node.x = Math.round(cx - (node.cols * node.tileWidth) / 2);
	node.y = Math.round(cy - (node.rows * node.tileHeight) / 2);
	return node;
}

/** The box the canvas selects and frames: the whole grid, from the node's top-left. */
export function tilemapBox(node: Pick<TilemapNode, 'cols' | 'rows' | 'tileWidth' | 'tileHeight'>): {
	w: number;
	h: number;
	ax: number;
	ay: number;
} {
	return {
		w: Math.max(1, node.cols * node.tileWidth),
		h: Math.max(1, node.rows * node.tileHeight),
		ax: 0,
		ay: 0,
	};
}

/** A stage point in the node's own space: its top-left at 0, 0, scale undone. A tilemap ignores
 *  rotation in the game, so this does too. */
export function tilemapWorldToLocal(t: ResolvedTransform, w: Point2D): Point2D {
	return { x: (w.x - t.x) / (t.scale?.x || 1), y: (w.y - t.y) / (t.scale?.y || 1) };
}

/** The cell under a stage point, or `undefined` off the grid. */
export function tilemapCellAtWorld(
	node: TilemapNode,
	t: ResolvedTransform,
	w: Point2D,
): { col: number; row: number } | undefined {
	const p = tilemapWorldToLocal(t, w);
	return tilemapCellAt(node, p.x, p.y);
}

/** Every cell on the line from `a` to `b`, both ends included (so a fast drag leaves no gaps). */
export function tilemapCellsBetween(
	a: { col: number; row: number },
	b: { col: number; row: number },
): { col: number; row: number }[] {
	const out: { col: number; row: number }[] = [];
	const dc = Math.abs(b.col - a.col);
	const dr = -Math.abs(b.row - a.row);
	const sc = a.col < b.col ? 1 : -1;
	const sr = a.row < b.row ? 1 : -1;
	let err = dc + dr;
	let { col, row } = a;
	for (;;) {
		out.push({ col, row });
		if (col === b.col && row === b.row) return out;
		const e2 = 2 * err;
		if (e2 >= dr) {
			err += dr;
			col += sc;
		}
		if (e2 <= dc) {
			err += dc;
			row += sr;
		}
	}
}

/**
 * Apply a paint tool at a cell: `brush` paints tileset entry `brush` (nothing when the tileset has
 * no such entry), `erase` clears, `fill` flood-fills with `brush`. True when a tile changed.
 */
export function applyTilemapTool(
	node: TilemapNode,
	tool: TilemapTool,
	brush: number,
	col: number,
	row: number,
): boolean {
	let next: number[];
	if (tool === 'erase') next = tilemapPaint(node, col, row, TILE_EMPTY);
	else if (tool === 'brush' || tool === 'fill') {
		if (!(brush >= 0 && brush < node.tileset.length)) return false;
		next = (tool === 'fill' ? tilemapFill : tilemapPaint)(node, col, row, brush);
	} else return false;
	if (next === node.tiles) return false;
	node.tiles = next;
	return true;
}

/** What the eyedropper does with a cell: a painted one becomes the brush; an empty one picks the
 *  eraser. */
export function tilemapPickTool(
	node: TilemapNode,
	col: number,
	row: number,
): { tool: TilemapTool; brush?: number } {
	const tile = tilemapPick(node, col, row);
	return tile === TILE_EMPTY ? { tool: 'erase' } : { tool: 'brush', brush: tile };
}

/** Add a tileset entry for `region` (no collide); returns its index. */
export function addTilesetEntry(node: TilemapNode, region: string): number {
	if (!Array.isArray(node.tileset)) node.tileset = [];
	node.tileset.push({ region });
	return node.tileset.length - 1;
}

/** Set an entry's region. False when there is no such entry. */
export function setTilesetRegion(node: TilemapNode, index: number, region: string): boolean {
	const entry = node.tileset?.[index];
	if (!entry) return false;
	entry.region = region;
	return true;
}

/** Set an entry's collide, sparse: `none` deletes the key. False when there is no such entry. */
export function setTilesetCollide(node: TilemapNode, index: number, collide: TileCollide): boolean {
	const entry = node.tileset?.[index];
	if (!entry) return false;
	if (collide === 'none') delete entry.collide;
	else entry.collide = collide;
	return true;
}

/** The tiles once tileset entry `removed` is gone: its own tiles become {@link TILE_EMPTY}, the
 *  indices above it shift down by one. */
export function tilesWithoutEntry(tiles: readonly number[], removed: number): number[] {
	return tiles.map((t) => (t === removed ? TILE_EMPTY : t > removed ? t - 1 : t));
}

/** Remove tileset entry `index`, remapping the tiles that point past it. False when there is no
 *  such entry. */
export function removeTilesetEntry(node: TilemapNode, index: number): boolean {
	if (!Array.isArray(node.tileset) || index < 0 || index >= node.tileset.length) return false;
	const tiles = tilesWithoutEntry(tilemapTiles(node), index);
	node.tileset.splice(index, 1);
	node.tiles = tiles;
	return true;
}

/** The brush after entry `removed` is gone: still the same entry when it was above, else clamped
 *  into the tileset. */
export function brushAfterRemove(brush: number, removed: number, count: number): number {
	const next = brush > removed ? brush - 1 : brush;
	return Math.max(0, Math.min(next, count - 1));
}

/** The largest grid a `cols × rows` request may have: each side 1 … {@link TILEMAP_MAX_SIDE}, and
 *  rows reduced until the grid holds at most {@link TILEMAP_MAX_TILES} tiles. */
export function clampTilemapGrid(cols: number, rows: number): { cols: number; rows: number } {
	const side = (v: number): number =>
		Math.min(Math.max(Number.isFinite(v) ? Math.round(v) : 1, 1), TILEMAP_MAX_SIDE);
	const c = side(cols);
	const r = Math.min(side(rows), Math.floor(TILEMAP_MAX_TILES / c));
	return { cols: c, rows: r };
}

/** Resize the grid (clamped, see {@link clampTilemapGrid}), its top-left content kept. False when
 *  nothing changed. */
export function resizeTilemap(node: TilemapNode, cols: number, rows: number): boolean {
	const next = clampTilemapGrid(cols, rows);
	if (next.cols === node.cols && next.rows === node.rows) return false;
	node.tiles = tilemapResize(node, next.cols, next.rows);
	node.cols = next.cols;
	node.rows = next.rows;
	return true;
}

/** Set the tile width or height (px, above 0). False for a non-positive or non-number value. */
export function setTilemapTileSize(
	node: TilemapNode,
	axis: 'tileWidth' | 'tileHeight',
	v: number,
): boolean {
	if (!Number.isFinite(v) || v <= 0) return false;
	node[axis] = v;
	return true;
}
