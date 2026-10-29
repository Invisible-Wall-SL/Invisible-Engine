import type { LayoutNode } from '../types';

/**
 * SALMONS' RIVER, DRAWN (P10.16, P11.2 (e)): the node a river (`engine-mechanics` `salmonsRiver`)
 * is drawn as. `salmonsReferenceLayout` places it for the authored river; a device in a room
 * whose config names the `salmonsRiver` generator draws the room's own river with it
 * ({@link FIELD_DRAWINGS}) in place of the authored one. Placeholder rectangles until the S0 art.
 */

type Rect = { x: number; y: number; w: number; h: number };
export type SalmonsRiverDrawing = {
	world: { w: number; h: number };
	bands: readonly { y: number; h: number; left: number; right: number; current: number }[];
	whirlpools: readonly { x: number; y: number; r: number }[];
	source: Rect;
	sea: Rect;
};

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

/** The river, bank to bank, sea to source: the world scene's `river` node. */
export function salmonsRiverNode(river: SalmonsRiverDrawing): LayoutNode {
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

/** How a device draws a generated field (`arcade.online.generator`, `engine-mechanics`
 *  `ONLINE_GENERATORS`, by the same id): the node it is drawn as, replacing the authored node of
 *  that id. */
export const FIELD_DRAWINGS: Readonly<Record<string, (made: SalmonsRiverDrawing) => LayoutNode>> = {
	salmonsRiver: salmonsRiverNode,
};
