import { TILE_EMPTY } from '../tilemapNodes';
import type { ComponentDef, LayoutDoc, LayoutNode, Scene, TilemapNode } from '../types';
import { ARCADE_FIELD, arcadeReferenceLayout } from './arcade';

/**
 * The PLATFORMER sample's screens (`docs/design/game-families.md` §4.4, P10.13): the P10.8 scene
 * set with its play field turned into a side-view level twice the screen wide, painted as a
 * `tilemap` (`ledgesLevel`): solid ground with two gaps, a low wall, and three one-way ledges. The
 * camera follows the hero (P10.12). Its spawn layer holds the hero (a `sideScroll` controller with a
 * `gravity` jump: arrows / A D to run, Space / ↑ / W to jump, hold to jump higher; or touch) and the
 * coins; the config's zones are the pits under the gaps and the goal at the far end. The HUD shows
 * LIVES and COINS. Placeholder shapes; the tiles draw two frames of one sample sheet
 * ({@link ARCADE_LEDGES_SHEET}), so nothing is read from R2.
 *
 * Played by the launcher's `check:arcade-platformer` and `scripts/playtest/arcade-platformer-play.mjs`
 * with `engine-flow-v2`'s `ARCADE_LEDGES_SEED_DOC` and the config
 * `packages/engine-mechanics/fixtures/arcade-ledges.rules.json`. Not a Game Maker kind, and not
 * exported from the package entry, so no game bundles it.
 */

/** The components, by role. */
export const ARCADE_LEDGES = { hero: 'ledgesHero', coin: 'ledgesCoin' } as const;

/** The level: twice the desktop screen wide, as tall. */
export const ARCADE_LEDGES_WORLD = { w: 2880, h: 800 } as const;

/** How the camera follows the hero. */
export const ARCADE_LEDGES_CAMERA = {
	follow: 'player',
	deadZone: { w: 320, h: 220 },
	smoothing: 0.12,
} as const;

/** The tile grid: 64 px tiles from the world's top-left, 45 × 12 (the bottom 32 px is the pit). */
export const ARCADE_LEDGES_TILES = { id: 'ledgesLevel', size: 64, cols: 45, rows: 12 } as const;

/** The tileset's atlas: one sheet, two 64 px frames. A fixture names it; the playtest writes it
 *  into its snapshot's `deploy/editor-art/` and lists it in the bundle's `editorArt`, as a publish
 *  would (rule 8). */
export const ARCADE_LEDGES_SHEET = {
	manifest: 'sample/arcade-ledges/manifests/atlas_manifest_S_Ledges.json',
	frames: { ground: 'ground', ledge: 'ledge' },
} as const;

/** The tileset: ground (solid) and a ledge (one-way), scoped to {@link ARCADE_LEDGES_SHEET}. */
export const ARCADE_LEDGES_TILESET = [
	{
		region: `${ARCADE_LEDGES_SHEET.manifest}::${ARCADE_LEDGES_SHEET.frames.ground}`,
		collide: 'solid',
	},
	{
		region: `${ARCADE_LEDGES_SHEET.manifest}::${ARCADE_LEDGES_SHEET.frames.ledge}`,
		collide: 'oneWay',
	},
] as const;

/** Where the level's pieces are, in tiles: the ground row and its gaps, the wall, the ledges. */
export const ARCADE_LEDGES_MAP = {
	groundRow: 11,
	gaps: [
		[12, 13],
		[27, 29],
	],
	wall: { col: 20, rows: [9, 10] },
	ledges: [
		{ row: 9, cols: [5, 8] },
		{ row: 7, cols: [9, 12] },
		{ row: 9, cols: [33, 36] },
	],
} as const;

const GROUND = 0;
const LEDGE = 1;

/** The level's tile indices, row by row (`cols × rows`). */
export function arcadeLedgesTiles(): number[] {
	const { cols, rows } = ARCADE_LEDGES_TILES;
	const tiles = new Array<number>(cols * rows).fill(TILE_EMPTY);
	const set = (c: number, r: number, t: number) => (tiles[r * cols + c] = t);
	const { groundRow, gaps, wall, ledges } = ARCADE_LEDGES_MAP;
	for (let c = 0; c < cols; c++)
		if (!gaps.some(([a, b]) => c >= a && c <= b)) set(c, groundRow, GROUND);
	for (const r of wall.rows) set(wall.col, r, GROUND);
	for (const ledge of ledges)
		for (let c = ledge.cols[0]; c <= ledge.cols[1]; c++) set(c, ledge.row, LEDGE);
	return tiles;
}

const level = (): TilemapNode => ({
	id: ARCADE_LEDGES_TILES.id,
	label: 'Level',
	kind: 'tilemap',
	x: 0,
	y: 0,
	tileWidth: ARCADE_LEDGES_TILES.size,
	tileHeight: ARCADE_LEDGES_TILES.size,
	cols: ARCADE_LEDGES_TILES.cols,
	rows: ARCADE_LEDGES_TILES.rows,
	tiles: arcadeLedgesTiles(),
	tileset: ARCADE_LEDGES_TILESET.map((entry) => ({ ...entry })),
});

/** A flat shape centred on `at` (a rect's default anchor), as a body's x / y is its centre. */
const rect = (
	id: string,
	label: string,
	w: number,
	h: number,
	color: number,
	at = { x: 0, y: 0 },
): LayoutNode =>
	({ id, label, kind: 'rect', x: at.x, y: at.y, width: w, height: h, color }) as LayoutNode;

const shape = (id: string, name: string, w: number, h: number, color: number): ComponentDef => ({
	id,
	name,
	version: 1,
	scope: 'project',
	category: 'ui',
	params: [],
	root: {
		id: `${id}-root`,
		kind: 'container',
		x: 0,
		y: 0,
		children: [rect(`${id}-shape`, 'Shape', w, h, color)],
	},
});

/** The sample's spawnable components. Sizes match the bodies the config gives them. */
export const ARCADE_LEDGES_COMPONENTS: readonly ComponentDef[] = [
	shape(ARCADE_LEDGES.hero, 'Hero (placeholder)', 40, 56, 0x06d6a0),
	shape(ARCADE_LEDGES.coin, 'Coin (placeholder)', 28, 28, 0xffd166),
];

/** A sky behind the level, and the pit's dark strip along the bottom. */
const backdrop = (): LayoutNode => ({
	id: 'al-backdrop',
	label: 'Backdrop',
	kind: 'container',
	x: 0,
	y: 0,
	children: [
		rect('al-sky', 'Sky', ARCADE_LEDGES_WORLD.w, ARCADE_LEDGES_WORLD.h, 0x1d3557, {
			x: ARCADE_LEDGES_WORLD.w / 2,
			y: ARCADE_LEDGES_WORLD.h / 2,
		}),
		rect('al-pit', 'Pit', ARCADE_LEDGES_WORLD.w, 32, 0x0b0f1a, {
			x: ARCADE_LEDGES_WORLD.w / 2,
			y: ARCADE_LEDGES_WORLD.h - 16,
		}),
	],
});

const textBox = (
	id: string,
	label: string,
	x: number,
	y: number,
	params: Record<string, unknown>,
): LayoutNode => ({ id, label, kind: 'componentInstance', componentId: 'textBox', x, y, params });

const readout = (key: string, caption: string, y: number): LayoutNode[] => [
	textBox(`al-${key}-caption`, `${caption} caption`, 60, y, { text: caption, fontSize: 28 }),
	textBox(`al-${key}-value`, caption, 60, y + 38, {
		text: '0',
		source: `var:${key}`,
		fontSize: 44,
	}),
];

export function arcadeLedgesReferenceLayout(): LayoutDoc {
	const base = arcadeReferenceLayout();
	const scenes: Scene[] = base.scenes.map((scene) => {
		if (scene.id === 'basegame')
			return {
				...scene,
				world: { ...ARCADE_LEDGES_WORLD },
				camera: { ...ARCADE_LEDGES_CAMERA, deadZone: { ...ARCADE_LEDGES_CAMERA.deadZone } },
				nodes: [
					backdrop(),
					level(),
					{
						id: ARCADE_FIELD.id,
						label: 'Play field',
						kind: 'spawnLayer',
						x: 0,
						y: 0,
						spawnable: ARCADE_LEDGES_COMPONENTS.map((def) => def.id),
						placement: 'free',
						cap: ARCADE_FIELD.cap,
					},
				],
			};
		if (scene.id === 'arcadeHud')
			return {
				...scene,
				nodes: [...readout('lives', 'LIVES', 40), ...readout('collected', 'COINS', 140)],
			};
		if (scene.id === 'roundOver')
			return {
				...scene,
				nodes: scene.nodes.map((node) =>
					node.id === 'roundOver-text' && node.kind === 'componentInstance'
						? { ...node, params: { ...node.params, text: 'FELL! Tap to run again' } }
						: node,
				),
			};
		return scene;
	});
	return { ...base, projectKey: 'arcade-ledges', scenes };
}
