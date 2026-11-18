import type { Vec3 } from '../rig';

/** A unit quaternion, as three.js `Quaternion` stores it. */
export type Quat = { x: number; y: number; z: number; w: number };

/** What the 3D camera shows: where it is, which way it looks (−z of `rotation`), its vertical FOV. */
export type Pose3d = { position: Vec3; rotation: Quat; fov: number };

export const RAD = Math.PI / 180;

export const IDENTITY: Readonly<Quat> = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export const mul = (a: Quat, b: Quat): Quat => ({
	x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
	y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
	z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
	w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

const normalize = (q: Quat): Quat => {
	const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
	return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
};

/**
 * The rotation that turns, then tilts, then rolls (degrees): three.js Euler order `YXZ`. Yaw 0 looks
 * down −z and grows anticlockwise seen from above (the room's convention, `rig.ts` `yawToward`);
 * pitch is up positive; roll turns the view clockwise as seen.
 */
export function fromYawPitchRoll(yaw: number, pitch: number, roll = 0): Quat {
	const hy = (yaw * RAD) / 2;
	const hp = (pitch * RAD) / 2;
	const hr = (roll * RAD) / 2;
	const qy = { x: 0, y: Math.sin(hy), z: 0, w: Math.cos(hy) };
	const qp = { x: Math.sin(hp), y: 0, z: 0, w: Math.cos(hp) };
	const qr = { x: 0, y: 0, z: Math.sin(hr), w: Math.cos(hr) };
	return mul(mul(qy, qp), qr);
}

/** `v` turned by `q`. */
export function rotate(q: Quat, v: Vec3): Vec3 {
	const tx = 2 * (q.y * v.z - q.z * v.y);
	const ty = 2 * (q.z * v.x - q.x * v.z);
	const tz = 2 * (q.x * v.y - q.y * v.x);
	return {
		x: v.x + q.w * tx + (q.y * tz - q.z * ty),
		y: v.y + q.w * ty + (q.z * tx - q.x * tz),
		z: v.z + q.w * tz + (q.x * ty - q.y * tx),
	};
}

/** The heading (yaw) and tilt (pitch, up positive) of a look rotation, degrees. */
export function yawPitchOf(q: Quat): { yaw: number; pitch: number } {
	const f = rotate(q, { x: 0, y: 0, z: -1 });
	return {
		yaw: Math.atan2(-f.x, -f.z) / RAD,
		pitch: Math.asin(clamp(f.y, -1, 1)) / RAD,
	};
}

/** The yaw and pitch (degrees) of a look from `from` to `to`. */
export function lookAngles(from: Vec3, to: Vec3): { yaw: number; pitch: number } {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const dz = to.z - from.z;
	const flat = Math.hypot(dx, dz);
	if (flat === 0 && dy === 0) return { yaw: 0, pitch: 0 };
	return { yaw: Math.atan2(-dx, -dz) / RAD, pitch: Math.atan2(dy, flat) / RAD };
}

/** The roll-free rotation that looks from `from` to `to`. */
export function lookAt(from: Vec3, to: Vec3): Quat {
	const { yaw, pitch } = lookAngles(from, to);
	return fromYawPitchRoll(yaw, pitch);
}

/** Spherical blend the short way round; `t` 0..1. */
export function slerp(a: Quat, b: Quat, t: number): Quat {
	let { x, y, z, w } = b;
	let cos = a.x * x + a.y * y + a.z * z + a.w * w;
	if (cos < 0) {
		cos = -cos;
		x = -x;
		y = -y;
		z = -z;
		w = -w;
	}
	if (cos > 0.9995)
		return normalize({
			x: a.x + (x - a.x) * t,
			y: a.y + (y - a.y) * t,
			z: a.z + (z - a.z) * t,
			w: a.w + (w - a.w) * t,
		});
	const angle = Math.acos(cos);
	const sin = Math.sin(angle);
	const ka = Math.sin((1 - t) * angle) / sin;
	const kb = Math.sin(t * angle) / sin;
	return { x: a.x * ka + x * kb, y: a.y * ka + y * kb, z: a.z * ka + z * kb, w: a.w * ka + w * kb };
}

/** A heading in degrees → the room's uint16 yaw (`motion3d` `YAW_UNITS` to the turn). */
export const yawUnitsOf = (degrees: number): number =>
	((Math.round((degrees / 360) * 65536) % 65536) + 65536) % 65536;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
	x: lerp(a.x, b.x, t),
	y: lerp(a.y, b.y, t),
	z: lerp(a.z, b.z, t),
});

/** Blend two poses: position lerps, rotation slerps, FOV lerps. */
export const mixPose = (a: Pose3d, b: Pose3d, t: number): Pose3d => ({
	position: lerp3(a.position, b.position, t),
	rotation: slerp(a.rotation, b.rotation, t),
	fov: lerp(a.fov, b.fov, t),
});

/** The share of the way an exponential ease with time constant `seconds` covers in `dt` seconds. */
export const damp = (seconds: number, dt: number) =>
	seconds <= 0 ? 1 : 1 - Math.exp(-dt / seconds);

/** The shortest signed turn from `from` to `to`, degrees in (−180, 180]. */
export const turn = (from: number, to: number) => {
	const d = ((((to - from) % 360) + 540) % 360) - 180;
	return d === -180 ? 180 : d;
};

/** How a camera switch blends (`cameraActivate`'s `ease`): `cut` jumps, the rest run over `blendMs`. */
export const CAMERA_EASES = ['smooth', 'linear', 'easeIn', 'easeOut', 'easeInOut', 'cut'] as const;
export type CameraEase3d = (typeof CAMERA_EASES)[number];

export function ease(kind: CameraEase3d, t: number): number {
	const x = clamp(t, 0, 1);
	switch (kind) {
		case 'linear':
			return x;
		case 'easeIn':
			return x * x * x;
		case 'easeOut':
			return 1 - (1 - x) ** 3;
		case 'easeInOut':
			return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
		case 'cut':
			return 1;
		default:
			return x * x * (3 - 2 * x);
	}
}
