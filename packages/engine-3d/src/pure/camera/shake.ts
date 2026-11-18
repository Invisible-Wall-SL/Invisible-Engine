import { createRng } from 'engine-mechanics/src/board.js';

import type { Vec3 } from '../rig';

/** How hard the strongest shake turns and moves the camera. */
export type ShakeSpec3d = {
	/** Degrees at full trauma. */
	yaw: number;
	pitch: number;
	roll: number;
	/** Metres at full trauma. */
	offset: number;
	/** Noise lattice points per second: how fast it trembles. */
	frequency: number;
};

export const SHAKE3D_DEFAULTS: Readonly<ShakeSpec3d> = Object.freeze({
	yaw: 4,
	pitch: 4,
	roll: 3,
	offset: 0.12,
	frequency: 18,
});

export type ShakeSample3d = { yaw: number; pitch: number; roll: number; offset: Vec3 };

const CHANNELS = 6;

/**
 * A trauma shake (`docs/design/3d/animation-evaluation.md` §4): `add(strength, ms)` raises the
 * trauma (0..1) and it falls linearly to rest over `ms`; the camera moves by trauma² times smooth
 * noise — rotation mostly, a little position. The noise is value noise on a lattice drawn from the
 * seeded camera stream (`createRng('<seed>:camera')`, as the 2D camera's), one point per channel per
 * tick of `frequency`, in order. So the sample at a time depends only on the seed, the time and the
 * shakes asked for — never on how the frames cut that time.
 */
export function createShake3d(seed: string, spec: ShakeSpec3d = SHAKE3D_DEFAULTS) {
	const rng = createRng(`${seed}:camera`);
	/** Lattice points from `base` on, `CHANNELS` values each. */
	let base = 0;
	const points: number[][] = [];
	const point = (i: number) => {
		while (base + points.length <= i)
			points.push(Array.from({ length: CHANNELS }, () => rng() * 2 - 1));
		return points[i - base];
	};
	let clockMs = 0;
	let trauma = 0;
	/** Trauma lost per ms. */
	let fall = 0;
	return {
		/** Add `strength` (0..1) of trauma, at rest again in `durationMs`. */
		add(strength: number, durationMs: number) {
			const s = Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 0));
			if (s === 0) return;
			const left = fall > 0 ? trauma / fall : 0;
			trauma = Math.min(1, trauma + s);
			fall = trauma / Math.max(1, left, Number.isFinite(durationMs) ? durationMs : 0);
		},
		get trauma() {
			return trauma;
		},
		/** Advance the clock by `dtMs` and sample the shake there. */
		step(dtMs: number): ShakeSample3d {
			clockMs += Math.max(0, dtMs);
			trauma = Math.max(0, trauma - fall * Math.max(0, dtMs));
			if (trauma === 0) fall = 0;
			const u = (clockMs / 1000) * spec.frequency;
			const i = Math.floor(u);
			const a = point(i);
			const b = point(i + 1);
			// Only the two points in use are kept.
			while (base < i) {
				points.shift();
				base += 1;
			}
			const f = u - i;
			const s = f * f * (3 - 2 * f);
			const k = trauma * trauma;
			const n = (c: number) => (a[c] + (b[c] - a[c]) * s) * k;
			return {
				yaw: n(0) * spec.yaw,
				pitch: n(1) * spec.pitch,
				roll: n(2) * spec.roll,
				offset: { x: n(3) * spec.offset, y: n(4) * spec.offset, z: n(5) * spec.offset },
			};
		},
	};
}

export type Shake3d = ReturnType<typeof createShake3d>;
