/**
 * The `tilemap` node's fields, read defensively (`docs/design/game-families.md` §4.4, P10.13), the
 * level a screen's tilemaps make for the arcade loop, and the paint operations the Scene Editor's
 * paint mode applies (brush, erase, fill, pick). Svelte-free, so a Node gate, the editor and the
 * game all load it from the bare `engine-layout` entry.
 */

import { resolveTransform } from './resolveTransform';
import type { LayoutType, Scene, TileCollide, TilemapNode, TilesetEntry } from './types';

/** A `tiles` entry with no tile. */
export const TILE_EMPTY = -1;

/** The most columns or rows a tilemap may have. */
export const TILEMAP_MAX_SIDE = 1024;

/** The most tiles one tilemap may hold (`cols × rows`). */
export const TILEMAP_MAX_TILES = 262144;

/** A new tilemap's tile size, px, when none is given. */
export const TILEMAP_DEFAULT_TILE = 64;

/** The solidity code of each collide value, as `engine-mechanics` `motion.js` numbers them. */
export const TILE_COLLIDE_CODES: Readonly<Record<TileCollide, number>> = {
	none: 0,
	solid: 1,
	oneWay: 2,
};

/** A screen's tilemap as the loop reads it: its top-left and tile size in the screen's space, one
 *  solidity code per tile (`engine-mechanics` `TileGrid`). */
export interface SceneTileGrid {
	id: string;
	x: number;
	y: number;
	tileW: number;
	tileH: number;
	cols: number;
	rows: number;
	cells: Uint8Array;
}

const side = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= TILEMAP_MAX_SIDE ? v : undefined;

const size = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** A tileset entry as the save keeps it: a string region, `collide` only when it collides. */
const normalizeEntry = (raw: unknown): TilesetEntry => {
	const entry = isRecord(raw) ? raw : {};
	const out: TilesetEntry = { region: typeof entry.region === 'string' ? entry.region : '' };
	if (entry.collide === 'solid' || entry.collide === 'oneWay') out.collide = entry.collide;
	return out;
};

/** The node's tileset, each entry readable (an unreadable one becomes an empty, non-colliding tile,
 *  so the indices after it keep their meaning). */
export const tilemapTileset = (node: Pick<TilemapNode, 'tileset'>): TilesetEntry[] =>
	Array.isArray(node.tileset) ? node.tileset.map(normalizeEntry) : [];

/** The node's tile index at every cell, `cols × rows`, an index the tileset does not have read as
 *  {@link TILE_EMPTY}. */
export function tilemapTiles(
	node: Pick<TilemapNode, 'cols' | 'rows' | 'tiles' | 'tileset'>,
): number[] {
	const cols = side(node.cols) ?? 0;
	const rows = side(node.rows) ?? 0;
	const count = Array.isArray(node.tileset) ? node.tileset.length : 0;
	const raw = Array.isArray(node.tiles) ? node.tiles : [];
	const out: number[] = new Array(cols * rows);
	for (let i = 0; i < out.length; i++) {
		const t = raw[i];
		out[i] = Number.isInteger(t) && t >= 0 && t < count ? t : TILE_EMPTY;
	}
	return out;
}

/**
 * A stored `tilemap` node as the save keeps it, or `undefined` to drop it: no usable tile size or
 * grid, or more than {@link TILEMAP_MAX_TILES} tiles. Every other field stays as written
 * (keep-unknown); the tileset's entries are made readable and `tiles` is made exactly `cols × rows`
 * long, an index the tileset does not have becoming {@link TILE_EMPTY}. A node already in that shape
 * comes back with the same fields in the same order.
 */
export function normalizeTilemapNode(input: Record<string, unknown>): TilemapNode | undefined {
	const tileWidth = size(input.tileWidth);
	const tileHeight = size(input.tileHeight);
	const cols = side(input.cols);
	const rows = side(input.rows);
	if (!tileWidth || !tileHeight || !cols || !rows || cols * rows > TILEMAP_MAX_TILES)
		return undefined;
	const tileset = tilemapTileset(input as unknown as TilemapNode);
	const tiles = tilemapTiles({ cols, rows, tiles: input.tiles as number[], tileset });
	return { ...input, tileset, tiles } as unknown as TilemapNode;
}

/** A fresh tilemap: `cols × rows` empty tiles, an empty tileset. */
export function newTilemapNode(
	id: string,
	x: number,
	y: number,
	{
		cols = 16,
		rows = 8,
		tile = TILEMAP_DEFAULT_TILE,
	}: { cols?: number; rows?: number; tile?: number } = {},
): TilemapNode {
	return {
		kind: 'tilemap',
		id,
		label: 'Tilemap',
		x,
		y,
		tileWidth: tile,
		tileHeight: tile,
		cols,
		rows,
		tiles: new Array(cols * rows).fill(TILE_EMPTY),
		tileset: [],
	};
}

/** The cell under a point in the node's own space (its top-left at 0, 0), or `undefined` off it. */
export function tilemapCellAt(
	node: Pick<TilemapNode, 'cols' | 'rows' | 'tileWidth' | 'tileHeight'>,
	x: number,
	y: number,
): { col: number; row: number } | undefined {
	const col = Math.floor(x / node.tileWidth);
	const row = Math.floor(y / node.tileHeight);
	if (!(col >= 0 && row >= 0 && col < node.cols && row < node.rows)) return undefined;
	return { col, row };
}

type Grid = Pick<TilemapNode, 'cols' | 'rows' | 'tiles' | 'tileset'>;

/** The tile index at a cell ({@link TILE_EMPTY} off the grid). */
export function tilemapPick(node: Grid, col: number, row: number): number {
	if (!(col >= 0 && row >= 0 && col < node.cols && row < node.rows)) return TILE_EMPTY;
	return tilemapTiles(node)[row * node.cols + col];
}

/** The tiles with one cell set to `tile` ({@link TILE_EMPTY} erases), or the same array when the
 *  cell is off the grid or already holds it (so the caller can skip a no-op write). */
export function tilemapPaint(node: Grid, col: number, row: number, tile: number): number[] {
	const tiles = tilemapTiles(node);
	if (!(col >= 0 && row >= 0 && col < node.cols && row < node.rows)) return node.tiles;
	const i = row * node.cols + col;
	if (tiles[i] === tile) return node.tiles;
	tiles[i] = tile;
	return tiles;
}

/** The tiles with the 4-connected region of the cell's tile replaced by `tile` (a flood fill). */
export function tilemapFill(node: Grid, col: number, row: number, tile: number): number[] {
	const tiles = tilemapTiles(node);
	const { cols, rows } = node;
	if (!(col >= 0 && row >= 0 && col < cols && row < rows)) return node.tiles;
	const from = tiles[row * cols + col];
	if (from === tile) return node.tiles;
	const stack = [row * cols + col];
	while (stack.length) {
		const i = stack.pop() as number;
		if (tiles[i] !== from) continue;
		tiles[i] = tile;
		const c = i % cols;
		if (c > 0) stack.push(i - 1);
		if (c < cols - 1) stack.push(i + 1);
		if (i >= cols) stack.push(i - cols);
		if (i < (rows - 1) * cols) stack.push(i + cols);
	}
	return tiles;
}

/** The tiles of a grid resized to `cols × rows`, its top-left content kept. */
export function tilemapResize(node: Grid, cols: number, rows: number): number[] {
	const tiles = tilemapTiles(node);
	const out = new Array(cols * rows).fill(TILE_EMPTY);
	for (let r = 0; r < Math.min(rows, node.rows); r++)
		for (let c = 0; c < Math.min(cols, node.cols); c++)
			out[r * cols + c] = tiles[r * node.cols + c];
	return out;
}

/** One solidity code per tile, row by row, from its tileset entry. */
export function tilemapCells(node: Grid): Uint8Array {
	const tileset = tilemapTileset(node);
	const tiles = tilemapTiles(node);
	const cells = new Uint8Array(tiles.length);
	for (let i = 0; i < tiles.length; i++) {
		const t = tiles[i];
		if (t !== TILE_EMPTY) cells[i] = TILE_COLLIDE_CODES[tileset[t].collide ?? 'none'];
	}
	return cells;
}

/** Whether a tilemap has a tile that collides. */
export const tilemapCollides = (node: Grid): boolean => tilemapCells(node).some((c) => c !== 0);

/** The regions a tilemap draws (its tileset entries that some tile uses), distinct, in tileset
 *  order: what the art export ships for it. */
export function tilemapRegions(node: Grid): string[] {
	const tileset = tilemapTileset(node);
	const used = new Set(tilemapTiles(node).filter((t) => t !== TILE_EMPTY));
	const out = new Set<string>();
	tileset.forEach((entry, i) => {
		if (used.has(i) && entry.region) out.add(entry.region);
	});
	return [...out];
}

/**
 * Every top-level `tilemap` node of a screen with a tile that collides, its grid in the screen's
 * space: from the node's x / y (`layoutType`'s override when one is given), the tile size times its
 * scale. Rotation is not applied (a level is axis-aligned); a tilemap nested in a container or a
 * component is not read, as a path is not.
 */
export function sceneTilemaps(scene: Scene, layoutType: LayoutType = ''): SceneTileGrid[] {
	const out: SceneTileGrid[] = [];
	for (const node of scene.nodes ?? []) {
		if (node.kind !== 'tilemap') continue;
		const cols = side(node.cols);
		const rows = side(node.rows);
		const tileW = size(node.tileWidth);
		const tileH = size(node.tileHeight);
		if (!cols || !rows || !tileW || !tileH) continue;
		const cells = tilemapCells(node);
		if (!cells.some((c) => c !== 0)) continue;
		const t = resolveTransform(node, layoutType);
		out.push({
			id: node.id,
			x: t.x,
			y: t.y,
			tileW: tileW * Math.abs(t.scale?.x ?? 1),
			tileH: tileH * Math.abs(t.scale?.y ?? 1),
			cols,
			rows,
			cells,
		});
	}
	return out;
}
