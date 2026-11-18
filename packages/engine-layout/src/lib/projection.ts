/**
 * THE ISOMETRIC PROJECTION (`docs/design/phase-11.md` P11.4): how a play-field screen with
 * `projection: 'isometric'` draws its flat world. Presentation only: the loop, the room and the
 * netcode keep every place in flat world px; the stage projects at draw time, and a pointer is
 * un-projected back. Svelte-free, so the Node gates, the editor and the game read the same answer.
 *
 * The 2:1 projection: a world point (x, y) is drawn at (x − y, (x + y) / 2), so a square world cell
 * of side s is a diamond 2s wide and s high, its top corner at the cell's top-left.
 * A screen that is also `mirrored` draws the same diamonds mirrored left to right, (y − x, (x + y) / 2)
 * ({@link IsoProjector}: one object per projection, so a caller never picks a pair by hand).
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

/** Whether a projected screen is drawn mirrored left to right (`Scene.mirrored`); a flat one never
 *  is. */
export const sceneMirrored = (scene: Scene | undefined): boolean =>
	!!sceneProjection(scene) && scene?.mirrored === true;

/** Where a flat world point is drawn. */
export const isoProject = (x: number, y: number): Point2D => ({ x: x - y, y: (x + y) / 2 });

/** The world point drawn at a projected point (the inverse of {@link isoProject}). */
export const isoUnproject = (x: number, y: number): Point2D => ({ x: y + x / 2, y: y - x / 2 });

/**
 * Where a flat world point is drawn on a `mirrored` screen: {@link isoProject} mirrored left to
 * right, so the world's x runs down-LEFT and its y down-RIGHT (Salmons: the original's grid, the
 * source top-left and the sea bottom-right). The depth and the view's world box are the same.
 */
export const isoProjectMirrored = (x: number, y: number): Point2D => ({
	x: y - x,
	y: (x + y) / 2,
});

/** The world point drawn at a projected point (the inverse of {@link isoProjectMirrored}). */
export const isoUnprojectMirrored = (x: number, y: number): Point2D => ({
	x: y - x / 2,
	y: y + x / 2,
});

/**
 * ONE PROJECTION, WHOLE: what draws, reads back and turns by it. `project` / `unproject` are
 * linear (the origin maps to the origin), so they turn a velocity or a direction too. `ground` is
 * the turn a flat-drawn ground plane is given (inside a `scale(1, 0.5)`): its rotation and its x
 * scale's sign (−1 for a mirrored projection, which no rotation makes). A texture drawn inside the
 * ground keeps its own orientation on screen when its x scale is multiplied by `ground.flip`.
 */
export type IsoProjector = {
	mirrored: boolean;
	project: (x: number, y: number) => Point2D;
	unproject: (x: number, y: number) => Point2D;
	ground: { rotation: number; flip: 1 | -1 };
};

/** The isometric projection, and the same mirrored left to right (`Scene.mirrored`). */
export const ISO_PROJECTOR: IsoProjector = {
	mirrored: false,
	project: isoProject,
	unproject: isoUnproject,
	ground: { rotation: Math.PI / 4, flip: 1 },
};
export const ISO_PROJECTOR_MIRRORED: IsoProjector = {
	mirrored: true,
	project: isoProjectMirrored,
	unproject: isoUnprojectMirrored,
	ground: { rotation: -Math.PI / 4, flip: -1 },
};

/** The projector a screen draws its world by: `undefined` for a flat screen, else the isometric
 *  one, mirrored when the screen says so. THE one answer the game, its keys and its art read. */
export const sceneProjector = (scene: Scene | undefined): IsoProjector | undefined =>
	sceneProjection(scene)
		? sceneMirrored(scene)
			? ISO_PROJECTOR_MIRRORED
			: ISO_PROJECTOR
		: undefined;

/**
 * A screen-relative direction in the world (the keyboard on a projected screen, as the original
 * Salmons' client turned its keys): `dx` / `dy` say how much the input points right and down the
 * screen (−1..1 each, so Up is `(0, −1)`). Each screen axis is turned into the world direction
 * drawn along it, the two are added and the sum is normalised: a length of 1, or `(0, 0)` for no
 * direction. Flat (`projector` undefined) the screen's axes are the world's.
 */
export function screenToWorldDirection(
	projector: IsoProjector | undefined,
	dx: number,
	dy: number,
): Point2D {
	let x = dx;
	let y = dy;
	if (projector) {
		const right = projector.unproject(1, 0);
		const down = projector.unproject(0, 1);
		const r = Math.hypot(right.x, right.y);
		const d = Math.hypot(down.x, down.y);
		x = (dx * right.x) / r + (dy * down.x) / d;
		y = (dx * right.y) / r + (dy * down.y) / d;
	}
	const len = Math.hypot(x, y);
	return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
}

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
 * `isoProject(x, y) − (x, y)` (the game draws a top-level spawn layer or tilemap at its projected
 * place; the editor, which draws from the place, moves it by this). A world point inside them is
 * `node.xy + place` projected.
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
	if (node.rotation) out.push('it is rotated: the game ignores a tilemap’s rotation');
	const sx = node.scale?.x ?? 1;
	const sy = node.scale?.y ?? 1;
	if (sx !== sy || sx <= 0) out.push('its scale is not uniform and positive');
	if (node.parallax && (node.parallax.x !== 1 || node.parallax.y !== 1))
		out.push('it has a parallax factor: it is shifted in world px, not on the diamonds');
	return out;
}

/**
 * The box a tilemap cell's art fills, in the tilemap's own space (its top-left world corner at 0,
 * 0): the cell's diamond, `tileWidth + tileHeight` wide and half that high; `mirrored` for a
 * mirrored screen (the same box mirrored about x = 0; the art itself is not flipped).
 */
export function isoCellBox(
	node: Pick<TilemapNode, 'tileWidth' | 'tileHeight'>,
	col: number,
	row: number,
	mirrored = false,
): { x: number; y: number; w: number; h: number } {
	const { tileWidth: tw, tileHeight: th } = node;
	const x = col * tw - (row + 1) * th;
	return {
		x: mirrored ? -x - (tw + th) : x,
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
