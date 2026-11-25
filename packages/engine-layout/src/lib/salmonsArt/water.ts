import type { SalmonsRiverDrawing } from '../referenceLayouts/salmonsRiver';
import { CELL } from './scale';

/**
 * THE WATER OF SALMONS' RIVER AS ITS ART TINTS IT: what a world place holds (`river.ts` paints the
 * same answer cell by cell) and the tint drawn over it. Free of the drawing, so the looks, the
 * wading (`wade.ts`) and `scripts/check-salmons-art.mjs` ask the river the same question.
 */

const WATER_TINT = 0x0ea5e9;
const RAPIDS_TINT = 0x38bdf8;
const SOURCE_TINT = 0x7dd3fc;
/** How strongly the water's tint covers the riverbed and what swims under it. */
export const TINT_ALPHA = 0.75;

export type Wet = 'water' | 'rapids' | 'source' | 'sea';

export const tintOf = (wet: Wet) =>
	wet === 'rapids' ? RAPIDS_TINT : wet === 'source' ? SOURCE_TINT : WATER_TINT;

/** What the river holds at a world point: its kind of water, or `undefined` for a bank. */
export function wetAt(river: SalmonsRiverDrawing, x: number, y: number): Wet | undefined {
	if (y >= river.sea.y) return 'sea';
	const { source } = river;
	if (y >= source.y && y < source.y + source.h) {
		return x >= source.x && x < source.x + source.w ? 'source' : undefined;
	}
	const band = river.bands.find((b) => y >= b.y && y < b.y + b.h);
	if (!band || x < band.left || x >= band.right) return undefined;
	return band.current > 100 ? 'rapids' : 'water';
}

/**
 * The water a body at world (x, y) swims in, as the art draws it: on open water (its cell's water,
 * not the sea, a sandbank or a rock), with the tint drawn over that cell (none for the sea, which
 * has none); `undefined` off the water.
 */
export function waterUnder(
	river: SalmonsRiverDrawing,
	x: number,
	y: number,
): { tint: number | undefined } | undefined {
	const wet = wetAt(
		river,
		(Math.floor(x / CELL) + 0.5) * CELL,
		(Math.floor(y / CELL) + 0.5) * CELL,
	);
	if (!wet) return undefined;
	const inside = (b: { x: number; y: number; w: number; h: number }) =>
		x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
	if ((river.sandbanks ?? []).some(inside) || (river.rocks ?? []).some(inside)) return undefined;
	return { tint: wet === 'sea' ? undefined : tintOf(wet) };
}
