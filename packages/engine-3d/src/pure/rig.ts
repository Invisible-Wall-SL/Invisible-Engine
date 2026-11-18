import { MOVE_SCALE, YAW_UNITS } from 'engine-mechanics/src/motion3d.js';

/**
 * The 3D camera rig (`docs/design/3d/runtime-evaluation.md` §2.2): a target point on the level and
 * the camera's pitch, yaw and distance from it. The arcade camera (`engine-mechanics` `camera.js`)
 * keeps following, the dead zone, smoothing and look-ahead, in metres on the ground plane; this
 * places the 3D camera around the point it settles on. Pure: no three.js, pinned in Node by
 * `scripts/check-engine-3d.mjs`.
 */
export type Rig3d = {
	/** Degrees above the horizon the camera looks down from. */
	pitch: number;
	/** Degrees the camera sits round the target: 0 behind it on +z, looking toward −z. */
	yaw: number;
	/** Metres from the target. */
	distance: number;
	/** Vertical field of view, degrees. */
	fov: number;
	/** Metres above the followed body's feet the camera aims at. */
	aimHeight: number;
	/** The arcade camera's follow settings, in metres (`camera.js` `CameraSpec`). */
	smoothing: number;
	lookAhead: number;
	deadZone: { w: number; h: number };
};

export const RIG3D_DEFAULTS: Readonly<Rig3d> = Object.freeze({
	pitch: 38,
	yaw: 0,
	distance: 14,
	fov: 45,
	aimHeight: 1,
	smoothing: 0.12,
	lookAhead: 0.15,
	deadZone: Object.freeze({ w: 0.6, h: 0.6 }),
});

const LIMITS: Record<'pitch' | 'distance' | 'fov' | 'aimHeight', [number, number]> = {
	pitch: [-80, 89],
	distance: [0.5, 500],
	fov: [10, 120],
	aimHeight: [-10, 10],
};

const num = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const clamp = (value: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, value));

/**
 * A play-field screen's `camera.rig3d` block as authored (any field may be absent or wrong) → a
 * whole rig. Unknown or out-of-range values fall back to, or are clamped toward, the defaults.
 */
export function resolveRig3d(raw: unknown): Rig3d {
	const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const d = RIG3D_DEFAULTS;
	const dead =
		r.deadZone && typeof r.deadZone === 'object' ? (r.deadZone as Record<string, unknown>) : {};
	return {
		pitch: clamp(num(r.pitch) ?? d.pitch, LIMITS.pitch),
		yaw: num(r.yaw) ?? d.yaw,
		distance: clamp(num(r.distance) ?? d.distance, LIMITS.distance),
		fov: clamp(num(r.fov) ?? d.fov, LIMITS.fov),
		aimHeight: clamp(num(r.aimHeight) ?? d.aimHeight, LIMITS.aimHeight),
		smoothing: Math.max(0, num(r.smoothing) ?? d.smoothing),
		lookAhead: Math.max(0, num(r.lookAhead) ?? d.lookAhead),
		deadZone: {
			w: Math.max(0, num(dead.w) ?? d.deadZone.w),
			h: Math.max(0, num(dead.h) ?? d.deadZone.h),
		},
	};
}

export type Vec3 = { x: number; y: number; z: number };

const RAD = Math.PI / 180;

/** Where the camera sits for a rig aimed at `target`. */
export function rigPosition(target: Vec3, rig: Pick<Rig3d, 'pitch' | 'yaw' | 'distance'>): Vec3 {
	const p = rig.pitch * RAD;
	const y = rig.yaw * RAD;
	const flat = Math.cos(p) * rig.distance;
	return {
		x: target.x + Math.sin(y) * flat,
		y: target.y + Math.sin(p) * rig.distance,
		z: target.z + Math.cos(y) * flat,
	};
}

/**
 * Stick axes relative to the camera (`right`, `forward`, each −1..1: ← → and ↓ ↑) → the int8
 * world-space move axes `motion3d` steps (`mx`, `mz`). The trigonometry happens here, on the
 * device, before the step; the step only sees the quantised integers. A diagonal is normalised,
 * so it is no faster than a straight line.
 */
export function moveAxes(
	right: number,
	forward: number,
	rigYaw: number,
): { mx: number; mz: number } {
	const len = Math.sqrt(right * right + forward * forward);
	if (len === 0) return { mx: 0, mz: 0 };
	const k = Math.min(1, len) / len;
	const y = rigYaw * RAD;
	const fx = -Math.sin(y);
	const fz = -Math.cos(y);
	// The camera's right is its forward turned a quarter clockwise seen from above.
	const x = (right * -fz + forward * fx) * k;
	const z = (right * fx + forward * fz) * k;
	return { mx: Math.round(x * MOVE_SCALE), mz: Math.round(z * MOVE_SCALE) };
}

/**
 * The uint16 yaw that faces the direction (`dx`, `dz`). The room's convention (`engine-mechanics`
 * `online3d.js` `yawFromRadians`): 0 looks down −z, the three.js camera's forward, and the yaw grows
 * anticlockwise seen from above, as `rotation.y` does — a quarter turn faces −x.
 */
export function yawToward(dx: number, dz: number): number {
	const turns = Math.atan2(-dx, -dz) / (2 * Math.PI);
	return Math.round((turns < 0 ? turns + 1 : turns) * YAW_UNITS) % YAW_UNITS;
}

/** A uint16 yaw → radians about +y, as three.js `rotation.y` reads it. */
export const yawRadians = (yaw: number): number => (yaw / YAW_UNITS) * 2 * Math.PI;
