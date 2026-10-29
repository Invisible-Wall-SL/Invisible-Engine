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
import { hasWorldCamera } from './worldCamera';

/** The projections a screen may name; `flat` is the default and is never stored. */
export const SCENE_PROJECTIONS: readonly ('flat' | SceneProjection)[] = ['flat', 'isometric'];

/** A screen's projection, when it departs from flat: a `game` screen with a world or a camera
 *  (`hasWorldCamera`) naming `isometric`. The one answer the game, the save and the editor read. */
export const sceneProjection = (scene: Scene | undefined): SceneProjection | undefined =>
	scene &&
	(scene.space ?? 'game') === 'game' &&
	scene.projection === 'isometric' &&
	hasWorldCamera(scene)
		? 'isometric'
		: undefined;

/** Where a flat world point is drawn. */
export const isoProject = (x: number, y: number): Point2D => ({ x: x - y, y: (x + y) / 2 });

/** The world point drawn at a projected point (the inverse of {@link isoProject}). */
export const isoUnproject = (x: number, y: number): Point2D => ({ x: y + x / 2, y: y - x / 2 });

/**
 * A body's ground depth: drawn later (in front) the larger it is. Twice the projected y of its
 * place, so it orders by how far down the screen it stands.
 */
export const isoDepth = (x: number, y: number): number => x + y;

/** How many places in spawn order {@link isoDepthOrder} breaks a tie between. */
export const ISO_DEPTH_SPREAD = 65536;

/**
 * The draw order (zIndex) of a body: its ground depth to the whole px, then its place `seq` in
 * its layer's spawn order, so a tie draws the same on every device whatever the sort's history.
 */
export const isoDepthOrder = (x: number, y: number, seq: number): number =>
	Math.floor(isoDepth(x, y)) * ISO_DEPTH_SPREAD + (seq % ISO_DEPTH_SPREAD);

/**
 * How far a top-level node placed at world (x, y) is moved so it is drawn at its projected place:
 * `isoProject(x, y) − (x, y)`. A spawn layer's and a tilemap's own place go through it, so a
 * world point inside them is `node.xy + place` projected.
 */
export const isoNodeShift = (x: number, y: number): Point2D => {
	const at = isoProject(x, y);
	return { x: at.x - x, y: at.y - y };
};

/**
 * The world box an isometric screen shows: the bounding box of its four corners un-projected
 * about the camera's centre (`camera` the view's top-left in world px, as `camera.js` `viewRect`).
 * The arcade loop judges `enterView` / `leaveView`, `despawnOutsideView` and culling by it.
 */
export function isoViewRect(
	camera: { x: number; y: number },
	view: { w: number; h: number },
): { x0: number; y0: number; x1: number; y1: number } {
	const cx = camera.x + view.w / 2;
	const cy = camera.y + view.h / 2;
	const half = view.w / 4 + view.h / 2;
	return { x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half };
}

/**
 * What an isometric screen's tilemap does not draw as it collides, for the editor to say: tiles
 * that are not square (a cell is then a parallelogram the diamond art does not cover), a rotation,
 * a scale that is not uniform and positive, a parallax factor. Empty when it draws true.
 */
export function isoTilemapIssues(
	node: Pick<TilemapNode, 'tileWidth' | 'tileHeight' | 'rotation' | 'scale' | 'parallax'>,
): string[] {
	const out: string[] = [];
	if (node.tileWidth !== node.tileHeight)
		out.push('tiles are not square: an isometric tile is a square of world, tile w = tile h');
	if (node.rotation) out.push('it is rotated: the game draws the diamonds turned');
	const sx = node.scale?.x ?? 1;
	const sy = node.scale?.y ?? 1;
	if (sx !== sy || sx <= 0) out.push('its scale is not uniform and positive');
	if (node.parallax && (node.parallax.x !== 1 || node.parallax.y !== 1))
		out.push('it has a parallax factor: it is shifted in world px, not on the diamonds');
	return out;
}

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
