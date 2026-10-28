import type { ComponentDef, LayoutDoc, LayoutNode } from '../types';
import { arcadeReferenceLayout } from './arcade';

/**
 * SALMONS' SCREENS (`docs/design/game-families.md` P10.16): the river a seed made
 * (`engine-mechanics` `salmonsRiver`), drawn as the play field's world, with a camera that follows
 * the device's own salmon, bear or fisherman (`apps/lines` `game/online.ts`), and the spawn layer
 * the room's players are drawn in. Placeholder shapes until the S0 art replaces the three
 * characters' components ({@link SALMONS_CHARACTER_COMPONENTS}) and the backdrop's rectangles.
 *
 * The river is passed in, not imported: this package does not depend on `engine-mechanics`, and
 * the type below is the part of `SalmonsRiver` the drawing reads. Played by
 * `scripts/playtest/salmons-play.mjs`; written into a project by `scripts/salmons/export.mjs`. Not
 * exported from the package entry, so no game bundles it.
 */

type Rect = { x: number; y: number; w: number; h: number };
export type SalmonsRiverDrawing = {
	world: { w: number; h: number };
	bands: readonly { y: number; h: number; left: number; right: number; current: number }[];
	whirlpools: readonly { x: number; y: number; r: number }[];
	source: Rect;
	sea: Rect;
};

/** The spawn layer the room's players are drawn in (`arcade.online.layer`'s default). */
export const SALMONS_FIELD = { id: 'field', cap: 120 } as const;

/** How the camera follows the device's own player (`online.ts` gives it the target). */
export const SALMONS_CAMERA = { deadZone: { w: 320, h: 200 }, smoothing: 0.1 } as const;

const COLOR = {
	bank: 0x4f7a3a,
	water: 0x3f86c6,
	rapids: 0x6fb2e6,
	whirlpool: 0x2a5d91,
	source: 0xcfe9f7,
	sea: 0x1f4f7a,
};

const rect = (id: string, r: Rect, color: number, round = false): LayoutNode =>
	({
		id,
		kind: 'rect',
		x: r.x,
		y: r.y,
		width: r.w,
		height: r.h,
		color,
		anchor: { x: 0, y: 0 },
		...(round ? { borderRadius: Math.min(r.w, r.h) / 2 } : {}),
	}) as LayoutNode;

const placeholder = (
	id: string,
	name: string,
	w: number,
	h: number,
	color: number,
	round = false,
): ComponentDef => ({
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
		children: [
			{
				id: `${id}-shape`,
				kind: 'rect',
				x: -w / 2,
				y: -h / 2,
				width: w,
				height: h,
				color,
				...(round ? { borderRadius: Math.min(w, h) / 2 } : {}),
			},
		],
	},
});

/** The three characters' looks, sized to their bodies in `salmonsConfig`. Placeholders. */
export const SALMONS_CHARACTER_COMPONENTS: readonly ComponentDef[] = [
	placeholder('salmonsSalmon', 'Salmon (placeholder)', 90, 44, 0xfa8072),
	placeholder('salmonsBear', 'Bear (placeholder)', 92, 92, 0x6b4423, true),
	placeholder('salmonsFisherman', 'Fisherman (placeholder)', 56, 88, 0xe0b04a),
];

/** The river, bank to bank, sea to source. */
function backdrop(river: SalmonsRiverDrawing): LayoutNode {
	const children: LayoutNode[] = [
		rect('river-sea', river.sea, COLOR.sea),
		rect('river-source', river.source, COLOR.source),
	];
	river.bands.forEach((band, i) => {
		children.push(
			rect(`river-${i}-left`, { x: 0, y: band.y, w: band.left, h: band.h }, COLOR.bank),
			rect(
				`river-${i}-water`,
				{ x: band.left, y: band.y, w: band.right - band.left, h: band.h },
				band.current > 100 ? COLOR.rapids : COLOR.water,
			),
			rect(
				`river-${i}-right`,
				{ x: band.right, y: band.y, w: river.world.w - band.right, h: band.h },
				COLOR.bank,
			),
		);
	});
	river.whirlpools.forEach((pool, i) =>
		children.push(
			rect(
				`river-whirlpool-${i}`,
				{ x: pool.x - pool.r, y: pool.y - pool.r, w: pool.r * 2, h: pool.r * 2 },
				COLOR.whirlpool,
				true,
			),
		),
	);
	return {
		id: 'river',
		label: 'River',
		kind: 'container',
		x: 0,
		y: 0,
		zIndex: -1,
		children,
	};
}

/**
 * Salmons' layout: the arcade scene set's loading and background screens, and its play field as
 * the river's world with the players' spawn layer. No HUD and no round-over screen yet: an online
 * game's room events and scores do not reach Flow or `var:` sources (P10.15's open item).
 */
export function salmonsReferenceLayout(river: SalmonsRiverDrawing): LayoutDoc {
	const base = arcadeReferenceLayout();
	const keep = new Set(['loading', 'background']);
	return {
		...base,
		projectKey: 'salmons',
		scenes: [
			...base.scenes.filter((scene) => keep.has(scene.id)),
			{
				id: 'basegame',
				name: 'River',
				role: 'basegame',
				world: { ...river.world },
				camera: { ...SALMONS_CAMERA, deadZone: { ...SALMONS_CAMERA.deadZone } },
				nodes: [
					backdrop(river),
					{
						id: SALMONS_FIELD.id,
						label: 'Players',
						kind: 'spawnLayer',
						x: 0,
						y: 0,
						spawnable: SALMONS_CHARACTER_COMPONENTS.map((def) => def.id),
						placement: 'free',
						cap: SALMONS_FIELD.cap,
					},
				],
			},
		],
	};
}
