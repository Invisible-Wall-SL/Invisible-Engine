import { riverElevation } from './salmonsElevation';
import type { LayoutNode } from '../types';

/**
 * SALMONS' RIVER, DRAWN (P10.16, P11.2 (e)): the node a river (`engine-mechanics` `salmonsRiver`)
 * is drawn as. `salmonsReferenceLayout` places it for the authored river; a device in a room
 * whose config names the `salmonsRiver` generator draws the room's own river with it
 * ({@link FIELD_DRAWINGS}) in place of the authored one. Placeholder rectangles until the S0 art.
 * The stage is flat, so the ground the waterfalls raise (`salmonsElevation.ts`) is shown as
 * each waterfall's cliff: a strip upstream of it, as many px deep as its step.
 */

type Rect = { x: number; y: number; w: number; h: number };
export type SalmonsRiverDrawing = {
	world: { w: number; h: number };
	/** The seed and generator that made it, when a generator did (`engine-mechanics`). */
	seed?: string | number;
	generator?: string;
	/** Present when its pieces sit on a cell grid (`salmonsMap`): sand runs then join into islands. */
	grid?: { cell: number };
	bands: readonly { y: number; h: number; left: number; right: number; current: number }[];
	/** `spin`: the way it turns, 1 or −1. */
	whirlpools: readonly { x: number; y: number; r: number; spin?: number }[];
	/** P11.3; absent in a river made before it. */
	rocks?: readonly Rect[];
	sandbanks?: readonly Rect[];
	/** `height`: grid cells (`salmonsMap`'s; none ⇒ the original's lowest). */
	waterfalls?: readonly (Rect & { height?: number })[];
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
	rock: 0x6b6b6b,
	sandbank: 0xd9c38a,
	waterfall: 0xe8f4fb,
	/** The old client's cliff where it had no cliff texture. */
	cliff: 0x4a4a3a,
};

const CLIFF_ALPHA = 0.6;

const rect = (id: string, r: Rect, color: number, round = false, alpha?: number): LayoutNode =>
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
		...(alpha === undefined ? {} : { alpha }),
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
	river.sandbanks?.forEach((r, i) =>
		children.push(rect(`river-sandbank-${i}`, r, COLOR.sandbank, !river.grid)),
	);
	river.rocks?.forEach((r, i) => children.push(rect(`river-rock-${i}`, r, COLOR.rock, true)));
	const { steps } = riverElevation(river.waterfalls);
	river.waterfalls?.forEach((r, i) => {
		const step = steps.find((s) => s.line === r.y + r.h / 2);
		const deep = step ? step.top - step.foot : 0;
		children.push(
			rect(
				`river-cliff-${i}`,
				{ x: 0, y: r.y - deep, w: river.world.w, h: deep },
				COLOR.cliff,
				false,
				CLIFF_ALPHA,
			),
			rect(`river-waterfall-${i}`, r, COLOR.waterfall),
		);
	});
	const generated =
		river.generator && typeof river.seed === 'number'
			? { generator: river.generator, seed: river.seed }
			: undefined;
	// A generated river is read-only in `/editor`: its pieces come from the seed, not from hand edits.
	if (generated) for (const child of children) child.locked = true;
	return {
		id: 'river',
		label: 'River',
		kind: 'container',
		x: 0,
		y: 0,
		zIndex: -1,
		children,
		...(generated ? { generated, locked: true } : {}),
	};
}

/** How a device draws a generated field (`arcade.online.generator`, `engine-mechanics`
 *  `ONLINE_GENERATORS`, by the same id): the node it is drawn as, replacing the authored node of
 *  that id. */
export const FIELD_DRAWINGS: Readonly<Record<string, (made: SalmonsRiverDrawing) => LayoutNode>> = {
	salmonsRiver: salmonsRiverNode,
	salmonsMap: salmonsRiverNode,
};
