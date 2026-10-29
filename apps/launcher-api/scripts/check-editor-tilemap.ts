/**
 * The `tilemap` layout node in the Scene Editor (`docs/design/game-families.md` §4.4, P10.13) —
 * kept by the save, painted on the stage:
 *
 *   pnpm --filter launcher-api check:editor-tilemap
 *
 *  1. THE NORMALIZER (`normalizeTilemapNode`): an already-normal node keeps its fields and their
 *     order; a tile index the tileset lacks becomes -1; a `tiles` of the wrong length is made
 *     `cols × rows`; a grid over the cap or without a tile size is dropped; a tileset entry keeps
 *     `collide` only when it collides.
 *  2. THE SAVE (`normalizeDoc`): a tilemap survives with its unknown fields, byte-identically, and
 *     `LAYOUT_NODE_KINDS` / `LAYOUT_NODE_FIELDS` know it.
 *  3. THE PAINT TOOLS (`tilemapEdit.ts` over `engine-layout`'s paint): cell under a point, brush,
 *     erase, fill, pick, the stroke line, resize (clamped), tileset add / collide / remove (the
 *     tiles remapped), the brush after a removal, the tool keys and the box.
 *  4. THE DIAMOND GRID (P11.4): on an isometric screen the box is the diamond grid where the game
 *     draws it (from the node's projected place), a stage point paints the diamond under it, a new
 *     tilemap's place is world px as on a flat screen; an autotile slot is set and cleared
 *     sparsely; the save keeps a world `game` screen's projection only; the projection
 *     setter refuses a screen with no world and a world turned off takes it away.
 */
import {
	LAYOUT_NODE_KINDS,
	TILE_EMPTY,
	TILEMAP_MAX_SIDE,
	TILEMAP_MAX_TILES,
	newTilemapNode,
	normalizeTilemapNode,
	isoCellDiamond,
	isoGridBox,
	isoProject,
	tilemapCellAt,
	type ResolvedTransform,
	type Scene,
	type TilemapNode,
} from 'engine-layout';

import { LAYOUT_NODE_FIELDS } from '../src/lib/server/componentFields';
import { normalizeDoc } from '../src/lib/server/editorStorage';
import {
	addTilesetEntry,
	applyTilemapTool,
	brushAfterRemove,
	clampTilemapGrid,
	newTilemapAt,
	removeTilesetEntry,
	resizeTilemap,
	setTilemapTileSize,
	setTilesetAutotile,
	setTilesetCollide,
	tilemapBox,
	tilemapCellAtWorld,
	tilemapCellsBetween,
	tilemapPickTool,
	tilemapToolForKey,
	tilesWithoutEntry,
} from '../src/lib/editor/tilemapEdit';
import { setSceneProjection, setSceneWorldOn } from '../src/lib/editor/worldCameraEdit';

let passed = 0;
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
	if (ok) passed += 1;
	else failures += 1;
};
const json = (v: unknown): string => JSON.stringify(v);

const save = (nodes: unknown[]): Scene['nodes'] =>
	normalizeDoc({ version: 1, scenes: [{ id: 's', name: 'S', nodes }] }).scenes[0].nodes;

/** A 4 × 3 level: a solid floor, a one-way ledge, a decoration. */
const level = (): TilemapNode => ({
	id: 'lvl',
	kind: 'tilemap',
	label: 'Level 1',
	x: 10,
	y: 20,
	tileWidth: 32,
	tileHeight: 16,
	cols: 4,
	rows: 3,
	tiles: [-1, 2, -1, -1, -1, 1, 1, -1, 0, 0, 0, 0],
	tileset: [
		{ region: 'tiles/ground.json::floor', collide: 'solid' },
		{ region: 'ledge', collide: 'oneWay' },
		{ region: 'tiles/ground.json::flower' },
	],
});

console.log('1. the normalizer');
{
	const authored = { ...level(), futureField: { kept: 1 } };
	const out = normalizeTilemapNode(structuredClone(authored));
	check(
		'a normal tilemap comes back equal, same field order',
		json(out) === json(authored),
		json(out),
	);
	check(
		'normalizing again changes nothing',
		json(normalizeTilemapNode(structuredClone(out) as unknown as Record<string, unknown>)) ===
			json(out),
	);

	const bad = normalizeTilemapNode({ ...level(), tiles: [7, -3, 1.5, 'x', 2, 0] });
	check(
		'bad indices ⇒ -1, short tiles padded to cols × rows',
		json(bad?.tiles) === json([-1, -1, -1, -1, 2, 0, -1, -1, -1, -1, -1, -1]),
		json(bad?.tiles),
	);
	const long = normalizeTilemapNode({ ...level(), tiles: new Array(20).fill(0) });
	check('long tiles cut to cols × rows', long?.tiles.length === 12);
	const noTiles = normalizeTilemapNode({ ...level(), tiles: undefined });
	check('no tiles ⇒ all empty', json(noTiles?.tiles) === json(new Array(12).fill(TILE_EMPTY)));

	const entries = normalizeTilemapNode({
		...level(),
		tileset: [{ region: 'a', collide: 'none' }, { region: 3, collide: 'lava' }, 'junk'],
		tiles: new Array(12).fill(1),
	});
	check(
		'a tileset entry keeps collide only when it collides; an unreadable one stays, empty',
		json(entries?.tileset) === json([{ region: 'a' }, { region: '' }, { region: '' }]),
		json(entries?.tileset),
	);
	check('its tiles keep pointing at it', entries?.tiles.every((t) => t === 1) === true);

	check(
		'no tile width ⇒ dropped',
		normalizeTilemapNode({ ...level(), tileWidth: 0 }) === undefined,
	);
	check(
		'a fractional side ⇒ dropped',
		normalizeTilemapNode({ ...level(), cols: 2.5 }) === undefined,
	);
	check(
		'a side over the cap ⇒ dropped',
		normalizeTilemapNode({ ...level(), cols: TILEMAP_MAX_SIDE + 1 }) === undefined,
	);
	check(
		'more tiles than the cap ⇒ dropped',
		normalizeTilemapNode({ ...level(), cols: TILEMAP_MAX_SIDE, rows: TILEMAP_MAX_SIDE }) ===
			undefined,
	);
}

console.log('2. the save');
{
	const authored = { ...level(), futureField: { kept: 1 } };
	const [kept] = save([structuredClone(authored)]);
	check('a tilemap round-trips byte-identically', json(kept) === json(authored), json(kept));
	check('normalizing the doc again changes nothing', json(save([kept])) === json([kept]));
	check(
		'the save fixes a bad index',
		json(
			(save([{ ...level(), tiles: [9, ...level().tiles.slice(1)] }])[0] as TilemapNode).tiles,
		) === json([-1, ...level().tiles.slice(1)]),
	);
	check('the save drops an unusable tilemap', save([{ ...level(), rows: 0 }]).length === 0);
	check(
		'a fresh tilemap survives the save as is',
		json(save([newTilemapNode('t', 0, 0)])) === json([newTilemapNode('t', 0, 0)]),
	);
	check(
		'LAYOUT_NODE_KINDS has tilemap',
		(LAYOUT_NODE_KINDS as readonly string[]).includes('tilemap'),
	);
	for (const f of ['tileWidth', 'tileHeight', 'cols', 'rows', 'tiles', 'tileset'])
		check(`LAYOUT_NODE_FIELDS knows ${f}`, LAYOUT_NODE_FIELDS.has(f));
}

console.log('3. the paint tools');
{
	const t: ResolvedTransform = { x: 10, y: 20, scale: { x: 2, y: 2 }, visible: true };
	const node = level();
	check('cellAt: top-left cell', json(tilemapCellAt(node, 0, 0)) === json({ col: 0, row: 0 }));
	check('cellAt: last cell', json(tilemapCellAt(node, 127.9, 47.9)) === json({ col: 3, row: 2 }));
	check('cellAt: off the right', tilemapCellAt(node, 128, 0) === undefined);
	check('cellAt: off the top', tilemapCellAt(node, 5, -0.1) === undefined);
	check(
		'cellAtWorld undoes the position and scale',
		json(tilemapCellAtWorld(node, t, { x: 10 + 2 * 70, y: 20 + 2 * 20 })) ===
			json({ col: 2, row: 1 }),
	);
	check(
		'the box is the grid from the top-left',
		json(tilemapBox(node)) === json({ w: 128, h: 48, ax: 0, ay: 0 }),
	);
	const fresh = newTilemapAt('n', 500, 300);
	check(
		'a new tilemap is centred on the point',
		fresh.x + (fresh.cols * fresh.tileWidth) / 2 === 500 &&
			fresh.y + (fresh.rows * fresh.tileHeight) / 2 === 300 &&
			fresh.tiles.every((x) => x === TILE_EMPTY) &&
			fresh.tileset.length === 0,
	);

	const before = node.tiles;
	check('brush paints a cell', applyTilemapTool(node, 'brush', 2, 0, 0) && node.tiles[0] === 2);
	check('brush on the same tile is a no-op', !applyTilemapTool(node, 'brush', 2, 0, 0));
	check('the stored array is replaced, not mutated', before[0] === -1);
	check('brush with no such entry does nothing', !applyTilemapTool(node, 'brush', 3, 3, 0));
	check('brush off the grid does nothing', !applyTilemapTool(node, 'brush', 0, 4, 0));
	check('erase clears a cell', applyTilemapTool(node, 'erase', 0, 0, 0) && node.tiles[0] === -1);
	check('erase on an empty cell is a no-op', !applyTilemapTool(node, 'erase', 0, 0, 0));
	check('pick is not a paint', !applyTilemapTool(node, 'pick', 0, 0, 0));
	check('move is not a paint', !applyTilemapTool(node, 'move', 0, 0, 0));

	const fill = level();
	check('fill floods the empty region', applyTilemapTool(fill, 'fill', 0, 0, 0));
	check(
		'fill is 4-connected: the empty cells walled off by other tiles stay empty',
		json(fill.tiles) === json([0, 2, -1, -1, 0, 1, 1, -1, 0, 0, 0, 0]),
		json(fill.tiles),
	);
	check('fill with the same tile is a no-op', !applyTilemapTool(fill, 'fill', 0, 0, 0));

	const pick = level();
	check(
		'pick on a painted cell takes it as the brush',
		json(tilemapPickTool(pick, 1, 0)) === json({ tool: 'brush', brush: 2 }),
	);
	check(
		'pick on an empty cell picks the eraser',
		json(tilemapPickTool(pick, 0, 0)) === json({ tool: 'erase' }),
	);
	check(
		'pick off the grid picks the eraser',
		json(tilemapPickTool(pick, -1, 0)) === json({ tool: 'erase' }),
	);

	check(
		'a stroke line includes both ends, no gaps',
		json(tilemapCellsBetween({ col: 0, row: 0 }, { col: 3, row: 1 })) ===
			json([
				{ col: 0, row: 0 },
				{ col: 1, row: 0 },
				{ col: 2, row: 1 },
				{ col: 3, row: 1 },
			]),
	);
	check(
		'a stroke of one cell is that cell',
		json(tilemapCellsBetween({ col: 2, row: 2 }, { col: 2, row: 2 })) ===
			json([{ col: 2, row: 2 }]),
	);
	const diag = tilemapCellsBetween({ col: 5, row: 5 }, { col: 0, row: 9 });
	check(
		'a backwards stroke steps one cell at a time',
		diag.every(
			(c, i) =>
				i === 0 ||
				Math.max(Math.abs(c.col - diag[i - 1].col), Math.abs(c.row - diag[i - 1].row)) === 1,
		) && json(diag[diag.length - 1]) === json({ col: 0, row: 9 }),
	);

	const grow = level();
	check('resize grows', resizeTilemap(grow, 5, 4) && grow.cols === 5 && grow.rows === 4);
	check(
		'resize keeps the top-left content',
		json(grow.tiles) ===
			json([-1, 2, -1, -1, -1, -1, 1, 1, -1, -1, 0, 0, 0, 0, -1, -1, -1, -1, -1, -1]),
		json(grow.tiles),
	);
	check('resize to the same grid is a no-op', !resizeTilemap(grow, 5, 4));
	const shrink = level();
	resizeTilemap(shrink, 2, 2);
	check('resize shrinks', json(shrink.tiles) === json([-1, 2, -1, 1]));
	check('resize clamps a side to 1', json(clampTilemapGrid(0, -5)) === json({ cols: 1, rows: 1 }));
	check(
		'resize clamps a side to the cap',
		clampTilemapGrid(TILEMAP_MAX_SIDE * 2, 1).cols === TILEMAP_MAX_SIDE,
	);
	const capped = clampTilemapGrid(TILEMAP_MAX_SIDE, TILEMAP_MAX_SIDE);
	check(
		'resize keeps the grid within the tile cap',
		capped.cols * capped.rows <= TILEMAP_MAX_TILES && capped.cols === TILEMAP_MAX_SIDE,
	);
	const big = level();
	resizeTilemap(big, TILEMAP_MAX_SIDE, TILEMAP_MAX_SIDE);
	check(
		'a capped resize still survives the save',
		save([structuredClone(big)]).length === 1 && big.tiles.length === big.cols * big.rows,
	);
	const sized = level();
	check('tile size must be above 0', !setTilemapTileSize(sized, 'tileWidth', 0));
	check('tile size is set', setTilemapTileSize(sized, 'tileHeight', 24) && sized.tileHeight === 24);

	const ts = level();
	check('add an entry returns its index', addTilesetEntry(ts, 'tiles/ground.json::spike') === 3);
	check(
		'a new entry has no collide',
		json(ts.tileset[3]) === json({ region: 'tiles/ground.json::spike' }),
	);
	setTilesetCollide(ts, 3, 'solid');
	check('collide solid is stored', ts.tileset[3].collide === 'solid');
	setTilesetCollide(ts, 3, 'none');
	check('collide none deletes the key', !('collide' in ts.tileset[3]));
	check('collide on no such entry is refused', !setTilesetCollide(ts, 9, 'solid'));

	check(
		'remove remap: its tiles empty, the ones above shift down',
		json(tilesWithoutEntry([0, 1, 2, -1, 1], 1)) === json([0, -1, 1, -1, -1]),
	);
	const rm = level();
	check('remove an entry', removeTilesetEntry(rm, 1));
	check(
		'remove drops the entry',
		json(rm.tileset.map((e) => e.region)) ===
			json(['tiles/ground.json::floor', 'tiles/ground.json::flower']),
	);
	check(
		'remove remaps the tiles',
		json(rm.tiles) === json([-1, 1, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0]),
		json(rm.tiles),
	);
	check('remove of no such entry is refused', !removeTilesetEntry(rm, 5));
	check(
		'the removed node survives the save as is',
		json(save([structuredClone(rm)])) === json([rm]),
	);
	check('the brush above a removed entry follows it', brushAfterRemove(2, 1, 2) === 1);
	check('the brush below a removed entry stays', brushAfterRemove(0, 1, 2) === 0);
	check('the brush on the last, removed entry clamps', brushAfterRemove(2, 2, 2) === 1);
	check('the brush on an emptied tileset is 0', brushAfterRemove(0, 0, 0) === 0);

	const key = (
		k: string,
		mod: Partial<Record<'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {},
	) =>
		tilemapToolForKey({
			key: k,
			shiftKey: false,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			...mod,
		});
	check(
		'V / B / E / G / I pick move / brush / erase / fill / pick',
		json(['v', 'b', 'E', 'g', 'i'].map((k) => key(k))) ===
			json(['move', 'brush', 'erase', 'fill', 'pick']),
	);
	check(
		'a modifier leaves the key alone',
		key('b', { ctrlKey: true }) === null && key('e', { shiftKey: true }) === null,
	);
	check('no tool key is a stage key (F fit, X reveal)', key('f') === null && key('x') === null);
}

{
	const node = newTilemapNode('iso', 100, 50, { cols: 4, rows: 2, tile: 64 });
	const t = { x: 100, y: 50, scale: { x: 1, y: 1 } } as ResolvedTransform;
	const at = isoProject(100, 50);
	const grid = isoGridBox(node);
	const box = tilemapBox(node, 'isometric', t);
	check(
		'4. the iso box is the diamond grid where the game draws it: its top corner at the projected place',
		box.w === grid.w &&
			box.h === grid.h &&
			Math.abs(t.x - box.ax * box.w - (at.x - grid.ax * grid.w)) < 1e-9 &&
			Math.abs(t.y - box.ay * box.h - at.y) < 1e-9 &&
			json(tilemapBox(node, 'isometric')) === json(grid),
		json({ box, grid, at }),
	);
	const [top, right, bottom, left] = isoCellDiamond(node, 2, 1);
	const centre = { x: at.x + (left.x + right.x) / 2, y: at.y + (top.y + bottom.y) / 2 };
	check(
		'4. a stage point paints the diamond under it (flat would pick another cell)',
		json(tilemapCellAtWorld(node, t, centre, 'isometric')) === json({ col: 2, row: 1 }) &&
			json(tilemapCellAtWorld(node, t, centre)) !== json({ col: 2, row: 1 }),
		json([tilemapCellAtWorld(node, t, centre, 'isometric'), tilemapCellAtWorld(node, t, centre)]),
	);
	const fresh = newTilemapAt('n', 640, 360);
	check(
		'4. a new tilemap is placed in world px on every screen (its place is the level’s top-left)',
		fresh.x === Math.round(640 - (fresh.cols * fresh.tileWidth) / 2) &&
			fresh.y === Math.round(360 - (fresh.rows * fresh.tileHeight) / 2) &&
			newTilemapAt.length === 3,
		json({ x: fresh.x, y: fresh.y }),
	);
	const tm = newTilemapNode('a', 0, 0);
	addTilesetEntry(tm, 'r');
	check(
		'4. an autotile slot is stored up to the last set, and clearing the last drops the field',
		setTilesetAutotile(tm, 0, 5, 'v') &&
			json(tm.tileset[0].autotile) === json(['', '', '', '', '', 'v']) &&
			setTilesetAutotile(tm, 0, 5, '') &&
			!('autotile' in tm.tileset[0]) &&
			!setTilesetAutotile(tm, 0, 16, 'v') &&
			!setTilesetAutotile(tm, 3, 0, 'v'),
		json(tm.tileset),
	);
	const doc = (scene: Record<string, unknown>) =>
		normalizeDoc({ version: 1, scenes: [{ id: 's', name: 'S', nodes: [], ...scene }] }).scenes[0];
	check(
		'4. the save keeps a world game screen’s projection, drops it elsewhere, with no world, or unknown',
		doc({ world: { w: 2000, h: 2000 }, projection: 'isometric' }).projection === 'isometric' &&
			!('projection' in doc({ projection: 'isometric' })) &&
			!('projection' in doc({ space: 'canvas', projection: 'isometric' })) &&
			!('projection' in doc({ projection: 'oblique' })) &&
			!('projection' in doc({})),
	);
	const flat: Scene = { id: 's', name: 'S', nodes: [] };
	const refused = !setSceneProjection(flat, 'isometric') && !('projection' in flat);
	setSceneWorldOn(flat, true, { width: 1280, height: 720 });
	const set = setSceneProjection(flat, 'isometric') && flat.projection === 'isometric';
	setSceneWorldOn(flat, false, { width: 1280, height: 720 });
	check(
		'4. projection needs a world; turning the world off takes it away',
		refused && set && !('projection' in flat),
	);
}

console.log(
	failures === 0
		? `\neditor tilemap: ${passed}/${passed} passed.`
		: `\neditor tilemap: ${failures} FAILED (${passed} passed)`,
);
process.exit(failures === 0 ? 0 : 1);
