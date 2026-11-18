import { CELL, K } from './scale';

/**
 * THE SALMON'S LEAP AS THE OLD CLIENT DREW IT (`GuiltyForever/Salmon-` 41811c2 `client/game.js`,
 * the salmon's pose), in its own units: the height `z` in grid cells, lengths in the old 50 px
 * salmon's pixels. The room sends `z` in world px ({@link CELL} a cell); the look turns it back.
 * Pinned by `scripts/check-salmons-jump.mjs`.
 *
 * - airborne while `z > 0.1`; the jump factor is `min(1.5, z / 2)`;
 * - while airborne the body tilts nose-up by `factor · 0.4` (eased at 0.15) and swells to
 *   `1 + factor · 0.12` (eased at 0.1);
 * - the curl eases (0.15) towards `min(1, factor)` in the air and 0 on the water; the arch is
 *   `−curl · sin(2π · 2 Hz · t) · 36` and each of the 12 rope points bends by it times
 *   `(1 − i / 11)^2.5`: the tail (point 0) whips, the head stays rigid;
 * - the body is drawn `z · HEIGHT_UNIT` (16 old px a cell) above its place;
 * - on open water, no higher than airborne and not climbing, it is UNDER the water: the old client
 *   drew it in its `underwaterEntityLayer`, below the water's tint, with its spine glint; in the air,
 *   climbing or on a sandbank or rock it broke the surface (`entityLayer`), the glint hidden
 *   ({@link underwater}).
 */
export const LEAP = Object.freeze({
	airborneCells: 0.1,
	factorPerCell: 0.5,
	maxFactor: 1.5,
	tilt: 0.4,
	tiltEase: 0.15,
	swell: 0.12,
	curlEase: 0.15,
	flickHz: 2,
	arch: 36,
	envelopePower: 2.5,
	heightUnit: 16,
});

/** A height the room sent (world px) in the old client's grid cells. */
export const cellsOf = (zPx: number): number => zPx / CELL;

export const airborne = (cells: number): boolean => cells > LEAP.airborneCells;

/** The jump factor at a height (cells): 0 on the water. */
export const jumpFactor = (cells: number): number =>
	airborne(cells) ? Math.min(LEAP.maxFactor, cells * LEAP.factorPerCell) : 0;

/** What the curl eases towards at a height (cells). */
export const curlTarget = (cells: number): number => Math.min(1, jumpFactor(cells));

/** The arch at a curl and a time (ms), in old salmon px. */
export const archAt = (curl: number, atMs: number): number =>
	-curl * Math.sin((atMs / 1000) * 2 * Math.PI * LEAP.flickHz) * LEAP.arch;

/** How much rope point `i` of `n` bends with the arch: 1 at the tail, 0 at the head. */
export const envelope = (i: number, n: number): number =>
	Math.pow(1 - i / (n - 1), LEAP.envelopePower);

/** How far above its place a body `cells` up is drawn, screen px (the old height unit × K). */
export const liftOf = (cells: number): number => cells * LEAP.heightUnit * K;

/** Whether a salmon is drawn under the water ({@link LEAP}): on open water (`onWater`: not a bank,
 *  a sandbank or a rock), not airborne at `cells` and not climbing. */
export const underwater = (cells: number, onWater: boolean, climbing: boolean): boolean =>
	onWater && !climbing && !airborne(cells);

/**
 * The colour matrix (Pixi's 4 × 5, offsets 0..1) that draws a body as if under a tint of `color`
 * laid over it at `alpha` (the river's tint squares: normal blend), `(1 − alpha) · c + alpha · T`
 * per channel, its alpha kept.
 */
export function underTint(color: number, alpha: number): number[] {
	const k = 1 - alpha;
	const r = ((color >> 16) & 0xff) / 255;
	const g = ((color >> 8) & 0xff) / 255;
	const b = (color & 0xff) / 255;
	// prettier-ignore
	return [
		k, 0, 0, 0, alpha * r,
		0, k, 0, 0, alpha * g,
		0, 0, k, 0, alpha * b,
		0, 0, 0, 1, 0,
	];
}
