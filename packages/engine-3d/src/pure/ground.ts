import { collidersNear, topUnder, type Level3d } from 'engine-mechanics/src/motion3d.js';

import type { Vec3 } from './rig';

/** The surface under a point: its height and its unit normal (a ramp leans, a box faces up). */
export type Ground3d = { y: number; normal: Vec3 };

/** How far above the feet a surface may be and still count as under them (rounding, a step). */
const TOLERANCE_M = 0.01;

/**
 * The highest surface of `level` at (`x`, `z`) at or below `feetY` — where a blob shadow lies
 * (`world.ts`), not where the body is: in the air the shadow stays on the ground, and on a ramp it
 * lies on the slope instead of half inside it. `undefined` over nothing (a pit). Uses `motion3d`'s
 * own column query and `topUnder`, so the shadow and the step agree on what is ground.
 */
export function groundUnder3d(
	level: Level3d,
	x: number,
	z: number,
	feetY: number,
): Ground3d | undefined {
	let best: Ground3d | undefined;
	for (const c of collidersNear(level, x, z, x, z)) {
		if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
		const y = topUnder(c, x, z, x, z);
		if (y > feetY + TOLERANCE_M || (best && y <= best.y)) continue;
		best = { y, normal: normalOf(c.rise, c.slope) };
	}
	return best;
}

/** A surface's unit normal: up for a box, leaning back from the direction a ramp rises toward. */
function normalOf(rise: number, slope: number): Vec3 {
	if (rise < 0 || slope === 0) return { x: 0, y: 1, z: 0 };
	const len = Math.sqrt(slope * slope + 1);
	const n = -slope / len;
	const up = 1 / len;
	// `RAMP_FACINGS`: +x, -x, +z, -z.
	if (rise === 0) return { x: n, y: up, z: 0 };
	if (rise === 1) return { x: -n, y: up, z: 0 };
	if (rise === 2) return { x: 0, y: up, z: n };
	return { x: 0, y: up, z: -n };
}
