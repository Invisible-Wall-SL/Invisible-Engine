/**
 * THE ISOMETRIC PROJECTION (`docs/design/phase-11.md` P11.4): how a play-field screen with
 * `projection: 'isometric'` draws its flat world. Presentation only: the loop, the room and the
 * netcode keep every place in flat world px; the stage projects at draw time, and a pointer is
 * un-projected back. Svelte-free, so the Node gates, the editor and the game read the same answer.
 *
 * The 2:1 projection: a world point (x, y) is drawn at (x − y, (x + y) / 2), so a square world cell
 * of side s is a diamond 2s wide and s high, its top corner at the cell's top-left.
 */

import { TILE_EMPTY, tilemapTiles, tilemapTileset } from './tilemapNodes';
import type { Point2D, Scene, SceneProjection, TilemapNode } from './types';

/** The projections a screen may name; `flat` is the default and is never stored. */
export const SCENE_PROJECTIONS: readonly ('flat' | SceneProjection)[] = ['flat', 'isometric'];

/** A screen's projection, when it departs from flat: a `game` screen naming `isometric`. */
export const sceneProjection = (scene: Scene | undefined): SceneProjection | undefined =>
	scene && (scene.space ?? 'game') === 'game' && scene.projection === 'isometric'
		? 'isometric'
		: undefined;

/** Where a flat world point is drawn. */
export const isoProject = (x: number, y: number): Point2D => ({ x: x - y, y: (x + y) / 2 });

/** The world point drawn at a projected point (the inverse of {@link isoProject}). */
export const isoUnproject = (x: number, y: number): Point2D => ({ x: y + x / 2, y: y - x / 2 });

/**
 * A body's ground depth: drawn later (in front) the larger it is. Twice the projected y of its
 * place, so it orders by how far down the screen it stands; equal depths keep spawn order.
 */
export const isoDepth = (x: number, y: number): number => x + y;

/**
 * The box a tilemap cell's art fills, in the tilemap's own space (its top-left world corner at 0,
 * 0): the cell's diamond, `tileWidth + tileHeight` wide and half that high.
 */
export function isoCellBox(
	node: Pick<TilemapNode, 'tileWidth' | 'tileHeight'>,
	col: number,
	row: number,
): { x: number; y: number; w: number; h: number } {
	const { tileWidth: tw, tileHeight: th } = node;
	return {
		x: col * tw - (row + 1) * th,
		y: (col * tw + row * th) / 2,
		w: tw + th,
		h: (tw + th) / 2,
	};
}

/** The four corners of a cell's diamond (top, right, bottom, left), in the tilemap's own space. */
export function isoCellDiamond(
	node: Pick<TilemapNode, 'tileWidth' | 'tileHeight'>,
	col: number,
	row: number,
): Point2D[] {
	const { tileWidth: tw, tileHeight: th } = node;
	return [
		isoProject(col * tw, row * th),
		isoProject((col + 1) * tw, row * th),
		isoProject((col + 1) * tw, (row + 1) * th),
		isoProject(col * tw, (row + 1) * th),
	];
}

/** The cell whose diamond holds a projected point in the tilemap's own space, or `undefined` off
 *  the grid (the diamond hit-test: un-project, then the flat cell). */
export function isoCellAt(
	node: Pick<TilemapNode, 'cols' | 'rows' | 'tileWidth' | 'tileHeight'>,
	x: number,
	y: number,
): { col: number; row: number } | undefined {
	const w = isoUnproject(x, y);
	const col = Math.floor(w.x / node.tileWidth);
	const row = Math.floor(w.y / node.tileHeight);
	if (!(col >= 0 && row >= 0 && col < node.cols && row < node.rows)) return undefined;
	return { col, row };
}

/** The whole grid's box in the tilemap's own space, and where its origin (the top corner) sits in
 *  it as a fraction (`ax`, `ay`): what the editor selects and frames. */
export function isoGridBox(node: Pick<TilemapNode, 'cols' | 'rows' | 'tileWidth' | 'tileHeight'>): {
	w: number;
	h: number;
	ax: number;
	ay: number;
} {
	const across = node.cols * node.tileWidth;
	const down = node.rows * node.tileHeight;
	const w = Math.max(1, across + down);
	return { w, h: Math.max(1, w / 2), ax: down / w, ay: 0 };
}

/**
 * NEIGHBOUR AUTOTILING: the bits of a cell's four neighbours that hold the same tile — 1 the cell
 * above (`row − 1`), 2 the right (`col + 1`), 4 below (`row + 1`), 8 the left (`col − 1`). Off the
 * grid is not the same tile.
 */
export function tilemapAutotileMask(
	tiles: readonly number[],
	cols: number,
	rows: number,
	i: number,
): number {
	const tile = tiles[i];
	if (tile === TILE_EMPTY) return 0;
	const col = i % cols;
	const row = Math.floor(i / cols);
	let mask = 0;
	if (row > 0 && tiles[i - cols] === tile) mask |= 1;
	if (col < cols - 1 && tiles[i + 1] === tile) mask |= 2;
	if (row < rows - 1 && tiles[i + cols] === tile) mask |= 4;
	if (col > 0 && tiles[i - 1] === tile) mask |= 8;
	return mask;
}

/** The neighbour arrows of each autotile mask, for a label (↑ → ↓ ←). */
export const autotileMaskLabel = (mask: number): string =>
	['↑', '→', '↓', '←'].filter((_, bit) => mask & (1 << bit)).join('') || '·';

/**
 * The region every cell of an isometric tilemap draws, `cols × rows` (`''` for no art): the
 * tileset entry's `autotile[mask]` when it names one for the cell's neighbours, else its region.
 */
export function isoTileRegions(
	node: Pick<TilemapNode, 'cols' | 'rows' | 'tiles' | 'tileset'>,
): string[] {
	const tiles = tilemapTiles(node);
	const tileset = tilemapTileset(node);
	return tiles.map((tile, i) => {
		if (tile === TILE_EMPTY) return '';
		const entry = tileset[tile];
		const variant = entry.autotile?.[tilemapAutotileMask(tiles, node.cols, node.rows, i)];
		return variant || entry.region;
	});
}
