/** One grid cell of Salmons' river, world px (`engine-mechanics` `salmonsMap` `CELL`). */
export const CELL = 48;
/** The old client's sizes to the engine's: a 64 × 32 tile is a 96 × 48 one. */
export const K = CELL / 32;

/**
 * THE RIVER RAISED BY ITS WATERFALLS (Salmons), as the old client (`GuiltyForever/Salmon-` 41811c2
 * `client/game.js`) raised it: a waterfall of height H (grid cells) is a cliff of
 * `cliffPxFor(H) = 32 + H · 16` old px, and everything upstream of it (river, banks, trees, rocks,
 * whirlpools and characters) is drawn `elevStepFor(H) = cliffPxFor(H) − 16` old px higher, so a
 * row is raised by the steps of every waterfall below it (`riverElev`). The row at a waterfall
 * stands at its foot. Old px are scaled by {@link K}. Pure, so `check:salmons-heights` holds it to
 * the original's formula. Here rather than in `salmonsArt/` because the placeholder drawing
 * (`salmonsRiver.ts`, which `/editor` also draws) shows it too, and only a Salmons room reaches the
 * art.
 *
 * In the engine's world a waterfall stands on the line `y` across the river (the original's column
 * `gx`, `y = (gx + 5) · CELL`), so a point is raised by the steps of the waterfalls whose line is
 * below it (`line > y`), which is the original's `W > gx` for a row.
 */

/** The old client's height unit (px a cell) and its tile's height (64 × 32), old px. */
export const HEIGHT_UNIT = 16;
export const TILE_H = 32;
/** A waterfall with no height is the original's lowest (`WATERFALL_HEIGHT_MIN`). */
export const LOWEST_FALL = 1;

/** The cliff under a waterfall of height `h` cells, old px. */
export const cliffPxFor = (h: number): number => TILE_H + h * HEIGHT_UNIT;

/** How much higher the river upstream of a waterfall of height `h` is drawn, old px. */
export const elevStepFor = (h: number): number => cliffPxFor(h) - TILE_H / 2;

/** A waterfall as the river carries it: its zone (straddling its line) and its height, cells. */
export type RaisingFall = { y: number; h: number; height?: number };

/** One waterfall's step, screen px: the line it stands on, how high it is, and its cliff. */
export type FallStep = {
	line: number;
	height: number;
	/** How far the ground at its foot is raised, and its top (the foot plus its step). */
	foot: number;
	top: number;
	/** The cliff's height, screen px. */
	cliff: number;
};

export type Elevation = {
	/** How far the ground at world `y` is drawn raised, screen px. */
	at: (y: number) => number;
	/** Each waterfall's step, from the sea up. */
	steps: readonly FallStep[];
	/** How far the source is raised: every step. */
	total: number;
};

/** The elevation `falls` make. */
export function riverElevation(falls: readonly RaisingFall[] = []): Elevation {
	const byLine = falls
		.map((f) => ({ line: f.y + f.h / 2, height: f.height ?? LOWEST_FALL }))
		.sort((a, b) => b.line - a.line);
	const steps: FallStep[] = [];
	let foot = 0;
	for (const { line, height } of byLine) {
		const top = foot + elevStepFor(height) * K;
		steps.push({ line, height, foot, top, cliff: cliffPxFor(height) * K });
		foot = top;
	}
	const at = (y: number) => {
		let lift = 0;
		for (const step of steps) {
			if (step.line <= y) break;
			lift = step.top;
		}
		return lift;
	};
	return { at, steps, total: foot };
}
