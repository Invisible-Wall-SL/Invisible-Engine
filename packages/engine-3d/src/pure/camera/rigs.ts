import { YAW_UNITS } from 'engine-mechanics/src/motion3d.js';

import { RIG3D_DEFAULTS, rigPosition, type Rig3d, type Vec3 } from '../rig';
import type { CameraCollider3d } from './collision';
import {
	clamp,
	RAD,
	damp,
	fromYawPitchRoll,
	lerp,
	lookAngles,
	lookAt,
	rotate,
	turn,
	yawPitchOf,
	type Pose3d,
} from './math';

/** A body the camera can follow, as the field draws it this frame. */
export type CameraTarget3d = {
	/** Feet, metres. */
	x: number;
	y: number;
	z: number;
	/** m/s on the plane. */
	vx: number;
	vz: number;
	/** uint16 facing (0 looks down −z). */
	yaw: number;
	/** The head socket, when the body has one (a character rig); else the eye height is used. */
	head?: Vec3;
	grounded?: boolean;
};

/** The player's look this frame: pointer travel (CSS px), wheel steps (+ zooms out), aim held. */
export type CameraInput3d = { lookX: number; lookY: number; zoom: number; aiming: boolean };

export const NO_CAMERA_INPUT: Readonly<CameraInput3d> = Object.freeze({
	lookX: 0,
	lookY: 0,
	zoom: 0,
	aiming: false,
});

export type CameraFrame3d = {
	dtMs: number;
	/** The followed body; absent before it exists (rigs that need one hold their pose). */
	target: CameraTarget3d | undefined;
	input: CameraInput3d;
};

type Collide = {
	/** Pull in against the level's colliders. */
	collide: boolean;
	/** The swept sphere's radius, m. */
	radius: number;
	/** Seconds the camera takes to ease back out once the way is clear (it pulls in at once). */
	release: number;
};

export type FollowParams = Collide & {
	pitch: number;
	/** Degrees round the target; with `heading: 'target'`, added to the body's facing. */
	yaw: number;
	heading: 'world' | 'target';
	distance: number;
	fov: number;
	aimHeight: number;
	/** Time constants per axis, s (0 = rigid). */
	damping: Vec3;
	/** Seconds of the body's velocity the pivot leads by. */
	lookAhead: number;
	/** Metres on the plane the body moves before the pivot does. */
	deadZone: { w: number; h: number };
	/** With `heading: 'target'`: seconds the heading takes to swing behind the body. */
	yawDamping: number;
};

export type OrbitParams = Collide & {
	pitch: number;
	minPitch: number;
	maxPitch: number;
	yaw: number;
	distance: number;
	minDistance: number;
	maxDistance: number;
	fov: number;
	aimHeight: number;
	/** Degrees per CSS px of pointer travel. */
	sensitivity: number;
	/** Distance factor per wheel step. */
	zoomStep: number;
	damping: number;
};

export type ShoulderParams = Collide & {
	pitch: number;
	minPitch: number;
	maxPitch: number;
	distance: number;
	/** Pivot height above the feet, m. */
	height: number;
	/** Metres to the camera's right. */
	side: number;
	fov: number;
	/** FOV while aiming (aim zoom). */
	aimFov: number;
	/** ms the aim zoom takes. */
	aimMs: number;
	sensitivity: number;
	damping: number;
};

export type FirstPersonParams = {
	/** Eye height above the feet when the body has no head socket, m. */
	eyeHeight: number;
	fov: number;
	minPitch: number;
	maxPitch: number;
	sensitivity: number;
	/**
	 * Head bob while walking, as BattleOTtheYear's `PlayerController.HandleHeadBob`: the eye rises
	 * and falls by `sin(phase) × amplitude` m, the phase running at `frequency` rad/s while the body
	 * walks on the ground; `sway` m side to side (0 in BOTY). It fades out at rest rather than
	 * snapping back.
	 */
	bob: { amplitude: number; frequency: number; sway: number };
	/**
	 * The near plane must not cut into a wall: the eye is swept from the body's axis to where it
	 * wants to be with a sphere of this radius (m), so a head socket ahead of the body or a sway never
	 * puts the near plane inside a collider. No pull-in beyond that: first person has no boom.
	 */
	nearRadius: number;
};

export type GhostParams = {
	/** Metres the camera rises and backs away from where it detached, over `ms`. */
	rise: number;
	back: number;
	ms: number;
	fov: number;
	/** The camera looks at the target this high above its feet. */
	aimHeight: number;
};

export type FixedParams = { position: Vec3; lookAt?: Vec3; fov: number; aimHeight: number };

export type RailParams = {
	/** The rail, two or more points; the camera rides it to the point nearest the target. */
	points: Vec3[];
	fov: number;
	aimHeight: number;
	/** Seconds the camera takes to slide along the rail. */
	damping: number;
};

export type CameraRigSpec3d =
	| { id: string; kind: 'follow'; target?: string; priority: number; params: FollowParams }
	| { id: string; kind: 'orbit'; target?: string; priority: number; params: OrbitParams }
	| { id: string; kind: 'shoulder'; target?: string; priority: number; params: ShoulderParams }
	| {
			id: string;
			kind: 'firstPerson';
			target?: string;
			priority: number;
			params: FirstPersonParams;
	  }
	| { id: string; kind: 'fixed'; target?: string; priority: number; params: FixedParams }
	| { id: string; kind: 'ghost'; target?: string; priority: number; params: GhostParams }
	| { id: string; kind: 'rail'; target?: string; priority: number; params: RailParams };

export type CameraRigKind3d = CameraRigSpec3d['kind'];
export const CAMERA_RIG_KINDS: readonly CameraRigKind3d[] = [
	'firstPerson',
	'follow',
	'orbit',
	'shoulder',
	'fixed',
	'rail',
	'ghost',
];

/** A rig as it runs: entered from the pose on screen, then stepped each frame it is live. */
export type RigRuntime3d = {
	readonly spec: CameraRigSpec3d;
	enter(screen: Pose3d | undefined, frame: CameraFrame3d): void;
	step(frame: CameraFrame3d): Pose3d;
	/** The body turns to the camera's heading while this rig is live (first person, shoulder). */
	readonly aims: boolean;
};

const yawDeg = (yaw: number) => (yaw / YAW_UNITS) * 360;

/** Where a rig with nothing to follow yet looks from: high over the origin. */
const overview = (fov: number): Pose3d => {
	const position = { x: 0, y: 18, z: 18 };
	return { position, rotation: lookAt(position, { x: 0, y: 0, z: 0 }), fov };
};

const feet = (t: CameraTarget3d): Vec3 => ({ x: t.x, y: t.y, z: t.z });

/**
 * The pull-in against walls for a camera that hangs off a pivot: sweep from the pivot to the
 * wanted place, take the clear distance at once when it is shorter, ease back out when longer.
 */
function boom(params: Collide, collider: CameraCollider3d | undefined) {
	let current: number | undefined;
	return {
		reset() {
			current = undefined;
		},
		place(pivot: Vec3, wanted: Vec3, dt: number): Vec3 {
			const dx = wanted.x - pivot.x;
			const dy = wanted.y - pivot.y;
			const dz = wanted.z - pivot.z;
			const length = Math.hypot(dx, dy, dz);
			if (!params.collide || !collider || length === 0) return wanted;
			const clear = collider.cast(pivot, wanted, params.radius) * length;
			current =
				current === undefined || clear < current
					? clear
					: current + (clear - current) * damp(params.release, dt);
			const k = Math.min(current, length) / length;
			return { x: pivot.x + dx * k, y: pivot.y + dy * k, z: pivot.z + dz * k };
		},
		get distance() {
			return current;
		},
	};
}

function followRig(
	spec: CameraRigSpec3d & { kind: 'follow' },
	collider: CameraCollider3d | undefined,
): RigRuntime3d {
	const p = spec.params;
	const arm = boom(p, collider);
	let pivot: Vec3 | undefined;
	let heading = p.yaw;
	const wanted = (t: CameraTarget3d): Vec3 => ({
		x: t.x + t.vx * p.lookAhead,
		y: t.y + p.aimHeight,
		z: t.z + t.vz * p.lookAhead,
	});
	const headingOf = (t: CameraTarget3d) => (p.heading === 'target' ? yawDeg(t.yaw) + p.yaw : p.yaw);
	let last: Pose3d | undefined;
	return {
		spec,
		aims: false,
		enter(_screen, frame) {
			arm.reset();
			pivot = frame.target ? wanted(frame.target) : undefined;
			heading = frame.target ? headingOf(frame.target) : p.yaw;
		},
		step({ dtMs, target }) {
			const dt = dtMs / 1000;
			if (target) {
				const w = wanted(target);
				if (!pivot) pivot = w;
				const edge = (at: number, to: number, half: number) =>
					to > at + half ? to - half : to < at - half ? to + half : at;
				const goal = {
					x: edge(pivot.x, w.x, p.deadZone.w / 2),
					y: w.y,
					z: edge(pivot.z, w.z, p.deadZone.h / 2),
				};
				pivot = {
					x: lerp(pivot.x, goal.x, damp(p.damping.x, dt)),
					y: lerp(pivot.y, goal.y, damp(p.damping.y, dt)),
					z: lerp(pivot.z, goal.z, damp(p.damping.z, dt)),
				};
				const h = headingOf(target);
				heading += turn(heading, h) * damp(p.heading === 'target' ? p.yawDamping : 0, dt);
			}
			if (!pivot) return last ?? overview(p.fov);
			const at = arm.place(
				pivot,
				rigPosition(pivot, { pitch: p.pitch, yaw: heading, distance: p.distance }),
				dt,
			);
			last = { position: at, rotation: lookAt(at, pivot), fov: p.fov };
			return last;
		},
	};
}

/** A pivot that eases after the target's point at `height` above its feet. */
function pivotOf(height: number, damping: number) {
	let pivot: Vec3 | undefined;
	return {
		reset(target: CameraTarget3d | undefined) {
			pivot = target ? { x: target.x, y: target.y + height, z: target.z } : undefined;
		},
		step(target: CameraTarget3d | undefined, dt: number): Vec3 | undefined {
			if (!target) return pivot;
			const goal = { x: target.x, y: target.y + height, z: target.z };
			const k = damp(damping, dt);
			pivot = pivot
				? { x: lerp(pivot.x, goal.x, k), y: lerp(pivot.y, goal.y, k), z: lerp(pivot.z, goal.z, k) }
				: goal;
			return pivot;
		},
	};
}

function orbitRig(
	spec: CameraRigSpec3d & { kind: 'orbit' },
	collider: CameraCollider3d | undefined,
): RigRuntime3d {
	const p = spec.params;
	const arm = boom(p, collider);
	const pivot = pivotOf(p.aimHeight, p.damping);
	let yaw = p.yaw;
	let pitch = p.pitch;
	let distance = p.distance;
	let last: Pose3d | undefined;
	return {
		spec,
		aims: false,
		enter(screen, frame) {
			arm.reset();
			pivot.reset(frame.target);
			const at = pivot.step(frame.target, 0);
			// Keep the view the screen shows: the orbit starts where the camera already sits.
			if (screen && at) {
				const back = lookAngles(at, screen.position);
				yaw = back.yaw + 180;
				pitch = clamp(back.pitch, p.minPitch, p.maxPitch);
				const d = Math.hypot(
					screen.position.x - at.x,
					screen.position.y - at.y,
					screen.position.z - at.z,
				);
				distance = clamp(d, p.minDistance, p.maxDistance);
			}
		},
		step({ dtMs, target, input }) {
			const dt = dtMs / 1000;
			yaw -= input.lookX * p.sensitivity;
			pitch = clamp(pitch + input.lookY * p.sensitivity, p.minPitch, p.maxPitch);
			if (input.zoom)
				distance = clamp(distance * p.zoomStep ** input.zoom, p.minDistance, p.maxDistance);
			const at = pivot.step(target, dt);
			if (!at) return last ?? overview(p.fov);
			const position = arm.place(at, rigPosition(at, { pitch, yaw, distance }), dt);
			last = { position, rotation: lookAt(position, at), fov: p.fov };
			return last;
		},
	};
}

function shoulderRig(
	spec: CameraRigSpec3d & { kind: 'shoulder' },
	collider: CameraCollider3d | undefined,
): RigRuntime3d {
	const p = spec.params;
	const arm = boom(p, collider);
	const pivot = pivotOf(p.height, p.damping);
	let yaw = 0;
	let pitch = p.pitch;
	let zoom = 0;
	let last: Pose3d | undefined;
	return {
		spec,
		aims: true,
		enter(screen, frame) {
			arm.reset();
			pivot.reset(frame.target);
			zoom = frame.input.aiming ? 1 : 0;
			if (screen) {
				const view = yawPitchOf(screen.rotation);
				yaw = view.yaw;
				pitch = clamp(view.pitch, p.minPitch, p.maxPitch);
			} else if (frame.target) yaw = yawDeg(frame.target.yaw);
		},
		step({ dtMs, target, input }) {
			const dt = dtMs / 1000;
			yaw -= input.lookX * p.sensitivity;
			pitch = clamp(pitch - input.lookY * p.sensitivity, p.minPitch, p.maxPitch);
			zoom = clamp(zoom + (input.aiming ? 1 : -1) * (dtMs / Math.max(1, p.aimMs)), 0, 1);
			const at = pivot.step(target, dt);
			const rotation = fromYawPitchRoll(yaw, pitch);
			const fov = lerp(p.fov, p.aimFov, zoom * zoom * (3 - 2 * zoom));
			if (!at) return last ?? { position: { x: 0, y: 2, z: 0 }, rotation, fov };
			const right = rotate(rotation, { x: p.side, y: 0, z: 0 });
			const back = rotate(rotation, { x: 0, y: 0, z: p.distance });
			const wanted = {
				x: at.x + right.x + back.x,
				y: at.y + right.y + back.y,
				z: at.z + right.z + back.z,
			};
			last = { position: arm.place(at, wanted, dt), rotation, fov };
			return last;
		},
	};
}

function firstPersonRig(
	spec: CameraRigSpec3d & { kind: 'firstPerson' },
	collider: CameraCollider3d | undefined,
): RigRuntime3d {
	const p = spec.params;
	let yaw = 0;
	let pitch = 0;
	let phase = 0;
	let amount = 0;
	let last: Pose3d | undefined;
	return {
		spec,
		aims: true,
		enter(screen, frame) {
			amount = 0;
			// The heading on screen is kept (no spin); the eyes come up level.
			if (screen) yaw = yawPitchOf(screen.rotation).yaw;
			else if (frame.target) yaw = yawDeg(frame.target.yaw);
			pitch = clamp(0, p.minPitch, p.maxPitch);
		},
		step({ dtMs, target, input }) {
			const dt = dtMs / 1000;
			yaw -= input.lookX * p.sensitivity;
			pitch = clamp(pitch - input.lookY * p.sensitivity, p.minPitch, p.maxPitch);
			const rotation = fromYawPitchRoll(yaw, pitch);
			if (!target)
				return last ?? { position: { x: 0, y: p.eyeHeight, z: 0 }, rotation, fov: p.fov };
			const walking = target.grounded !== false && Math.hypot(target.vx, target.vz) > 0.1;
			if (walking) phase += dt * p.bob.frequency;
			amount = lerp(amount, walking ? 1 : 0, damp(0.08, dt));
			const axis = { x: target.x, y: target.y + p.eyeHeight, z: target.z };
			const eye = target.head ?? axis;
			const side = rotate(fromYawPitchRoll(yaw, 0), {
				x: Math.sin(phase / 2) * p.bob.sway * amount,
				y: 0,
				z: 0,
			});
			const wanted = {
				x: eye.x + side.x,
				y: eye.y + Math.sin(phase) * p.bob.amplitude * amount,
				z: eye.z + side.z,
			};
			const k = collider && p.nearRadius > 0 ? collider.cast(axis, wanted, p.nearRadius) : 1;
			last = {
				position: {
					x: axis.x + (wanted.x - axis.x) * k,
					y: axis.y + (wanted.y - axis.y) * k,
					z: axis.z + (wanted.z - axis.z) * k,
				},
				rotation,
				fov: p.fov,
			};
			return last;
		},
	};
}

/**
 * The death camera (BattleOTtheYear's `Health.cs` ghost follow): the camera leaves the body where
 * it was on screen, drifts up and back, and keeps looking at the target — the body where it fell.
 */
function ghostRig(
	spec: CameraRigSpec3d & { kind: 'ghost' },
	collider: CameraCollider3d | undefined,
): RigRuntime3d {
	const p = spec.params;
	let from: Vec3 = { x: 0, y: 2, z: 0 };
	let away: Vec3 = { x: 0, y: 0, z: 1 };
	let t = 0;
	let fov = p.fov;
	let look: Vec3 | undefined;
	return {
		spec,
		aims: false,
		enter(screen, { target }) {
			t = 0;
			from = screen
				? { ...screen.position }
				: target
					? { x: target.x, y: target.y + 1.6, z: target.z }
					: from;
			fov = screen?.fov ?? p.fov;
			const view = screen ? yawPitchOf(screen.rotation) : { yaw: 0, pitch: 0 };
			// "Back" is away from where the camera was looking, on the plane.
			away = { x: Math.sin(view.yaw * RAD), y: 0, z: Math.cos(view.yaw * RAD) };
		},
		step({ dtMs, target }) {
			t = Math.min(1, t + dtMs / Math.max(1, p.ms));
			const k = t * t * (3 - 2 * t);
			const wanted = {
				x: from.x + away.x * p.back * k,
				y: from.y + p.rise * k,
				z: from.z + away.z * p.back * k,
			};
			const clear = collider ? collider.cast(from, wanted, 0.2) : 1;
			const position = {
				x: from.x + (wanted.x - from.x) * clear,
				y: from.y + (wanted.y - from.y) * clear,
				z: from.z + (wanted.z - from.z) * clear,
			};
			if (target) look = { x: target.x, y: target.y + p.aimHeight, z: target.z };
			const at = look ?? { x: position.x - away.x, y: position.y - 1, z: position.z - away.z };
			return { position, rotation: lookAt(position, at), fov: lerp(fov, p.fov, k) };
		},
	};
}

function fixedRig(spec: CameraRigSpec3d & { kind: 'fixed' }): RigRuntime3d {
	const p = spec.params;
	return {
		spec,
		aims: false,
		enter() {},
		step({ target }) {
			const look =
				p.lookAt ??
				(target ? { x: target.x, y: target.y + p.aimHeight, z: target.z } : { x: 0, y: 0, z: 0 });
			return { position: { ...p.position }, rotation: lookAt(p.position, look), fov: p.fov };
		},
	};
}

/** The point at arc length `s` along a polyline, and the arc length nearest a point. */
function railOf(points: readonly Vec3[]) {
	const lengths = [0];
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		lengths.push(lengths[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
	}
	return {
		length: lengths[lengths.length - 1],
		at(s: number): Vec3 {
			for (let i = 1; i < points.length; i++) {
				if (s <= lengths[i] || i === points.length - 1) {
					const span = lengths[i] - lengths[i - 1] || 1;
					const t = clamp((s - lengths[i - 1]) / span, 0, 1);
					const a = points[i - 1];
					const b = points[i];
					return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
				}
			}
			return { ...points[0] };
		},
		nearest(q: Vec3): number {
			let best = 0;
			let bestD = Infinity;
			for (let i = 1; i < points.length; i++) {
				const a = points[i - 1];
				const b = points[i];
				const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
				const len2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z || 1;
				const t = clamp(
					((q.x - a.x) * ab.x + (q.y - a.y) * ab.y + (q.z - a.z) * ab.z) / len2,
					0,
					1,
				);
				const d = Math.hypot(a.x + ab.x * t - q.x, a.y + ab.y * t - q.y, a.z + ab.z * t - q.z);
				if (d < bestD) {
					bestD = d;
					best = lengths[i - 1] + t * Math.sqrt(len2);
				}
			}
			return best;
		},
	};
}

function railRig(spec: CameraRigSpec3d & { kind: 'rail' }): RigRuntime3d {
	const p = spec.params;
	const rail = railOf(p.points);
	let s = 0;
	return {
		spec,
		aims: false,
		enter(_screen, { target }) {
			s = target ? rail.nearest(feet(target)) : 0;
		},
		step({ dtMs, target }) {
			if (target) s = lerp(s, rail.nearest(feet(target)), damp(p.damping, dtMs / 1000));
			const position = rail.at(s);
			const look = target
				? { x: target.x, y: target.y + p.aimHeight, z: target.z }
				: rail.at(rail.length);
			return { position, rotation: lookAt(position, look), fov: p.fov };
		},
	};
}

export function createRig3d(
	spec: CameraRigSpec3d,
	collider: CameraCollider3d | undefined,
): RigRuntime3d {
	switch (spec.kind) {
		case 'follow':
			return followRig(spec, collider);
		case 'orbit':
			return orbitRig(spec, collider);
		case 'shoulder':
			return shoulderRig(spec, collider);
		case 'firstPerson':
			return firstPersonRig(spec, collider);
		case 'fixed':
			return fixedRig(spec);
		case 'rail':
			return railRig(spec);
		case 'ghost':
			return ghostRig(spec, collider);
	}
}

// --- Rigs as authored data.

const num = (value: unknown, fallback: number, lo = -Infinity, hi = Infinity) =>
	typeof value === 'number' && Number.isFinite(value) ? clamp(value, lo, hi) : fallback;

const obj = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const vec = (value: unknown, fallback: Vec3): Vec3 => {
	const v = obj(value);
	return { x: num(v.x, fallback.x), y: num(v.y, fallback.y), z: num(v.z, fallback.z) };
};

const collideOf = (r: Record<string, unknown>, radius: number): Collide => ({
	collide: r.collide !== false,
	radius: num(r.radius, radius, 0, 2),
	release: num(r.release, 0.35, 0, 10),
});

/** The follow rig the play-field screen's `camera.rig3d` block describes (Phase 1a's view). */
export const followFromRig3d = (rig: Rig3d, raw: unknown = {}): FollowParams => {
	const r = obj(raw);
	const d = obj(r.damping);
	return {
		...collideOf(r, 0.3),
		pitch: num(r.pitch, rig.pitch, -80, 89),
		yaw: num(r.yaw, rig.yaw),
		heading: r.heading === 'target' ? 'target' : 'world',
		distance: num(r.distance, rig.distance, 0.5, 500),
		fov: num(r.fov, rig.fov, 10, 120),
		aimHeight: num(r.aimHeight, rig.aimHeight, -10, 10),
		damping: {
			x: num(d.x, rig.smoothing, 0, 10),
			y: num(d.y, rig.smoothing, 0, 10),
			z: num(d.z, rig.smoothing, 0, 10),
		},
		lookAhead: num(r.lookAhead, rig.lookAhead, 0, 5),
		deadZone: {
			w: num(obj(r.deadZone).w, rig.deadZone.w, 0, 100),
			h: num(obj(r.deadZone).h, rig.deadZone.h, 0, 100),
		},
		yawDamping: num(r.yawDamping, 0.4, 0, 10),
	};
};

function paramsOf(kind: CameraRigKind3d, raw: unknown, rig: Rig3d): CameraRigSpec3d['params'] {
	const r = obj(raw);
	switch (kind) {
		case 'follow':
			return followFromRig3d(rig, r);
		case 'orbit': {
			const minPitch = num(r.minPitch, -10, -89, 89);
			const maxPitch = num(r.maxPitch, 80, minPitch, 89);
			const minDistance = num(r.minDistance, 3, 0.5, 500);
			const maxDistance = num(r.maxDistance, 30, minDistance, 500);
			return {
				...collideOf(r, 0.3),
				pitch: num(r.pitch, 30, minPitch, maxPitch),
				minPitch,
				maxPitch,
				yaw: num(r.yaw, 0),
				distance: num(r.distance, 10, minDistance, maxDistance),
				minDistance,
				maxDistance,
				fov: num(r.fov, 50, 10, 120),
				aimHeight: num(r.aimHeight, 1, -10, 10),
				sensitivity: num(r.sensitivity, 0.3, 0, 10),
				zoomStep: num(r.zoomStep, 1.12, 1, 4),
				damping: num(r.damping, 0.08, 0, 10),
			};
		}
		case 'shoulder': {
			const minPitch = num(r.minPitch, -40, -89, 89);
			const maxPitch = num(r.maxPitch, 60, minPitch, 89);
			return {
				...collideOf(r, 0.2),
				pitch: num(r.pitch, -8, minPitch, maxPitch),
				minPitch,
				maxPitch,
				distance: num(r.distance, 3.5, 0.2, 50),
				height: num(r.height, 1.6, -5, 10),
				side: num(r.side, 0.7, -5, 5),
				fov: num(r.fov, 55, 10, 120),
				aimFov: num(r.aimFov, 35, 10, 120),
				aimMs: num(r.aimMs, 150, 0, 5000),
				sensitivity: num(r.sensitivity, 0.2, 0, 10),
				damping: num(r.damping, 0.04, 0, 10),
			};
		}
		case 'firstPerson': {
			const b = obj(r.bob);
			return {
				eyeHeight: num(r.eyeHeight, 1.6, 0, 10),
				fov: num(r.fov, 70, 10, 120),
				// BOTY clamps the look at ±90°; 89 keeps the heading defined.
				minPitch: num(r.minPitch, -89, -89, 0),
				maxPitch: num(r.maxPitch, 89, 0, 89),
				sensitivity: num(r.sensitivity, 0.2, 0, 10),
				bob: {
					amplitude: num(b.amplitude, 0.05, 0, 1),
					frequency: num(b.frequency, 10, 0, 100),
					sway: num(b.sway, 0, 0, 1),
				},
				nearRadius: num(r.nearRadius, 0.15, 0, 1),
			};
		}
		case 'ghost':
			return {
				rise: num(r.rise, 2.5, -10, 50),
				back: num(r.back, 3, -50, 50),
				ms: num(r.ms, 1500, 0, 20_000),
				fov: num(r.fov, 60, 10, 120),
				aimHeight: num(r.aimHeight, 0.6, -10, 10),
			};
		case 'fixed':
			return {
				position: vec(r.position, { x: 0, y: 24, z: 24 }),
				...(r.lookAt ? { lookAt: vec(r.lookAt, { x: 0, y: 0, z: 0 }) } : {}),
				fov: num(r.fov, 45, 10, 120),
				aimHeight: num(r.aimHeight, 1, -10, 10),
			};
		case 'rail': {
			const pts = Array.isArray(r.points) ? r.points.map((q) => vec(q, { x: 0, y: 0, z: 0 })) : [];
			if (pts.length < 2) throw new Error('a rail needs two or more points');
			return {
				points: pts,
				fov: num(r.fov, 45, 10, 120),
				aimHeight: num(r.aimHeight, 1, -10, 10),
				damping: num(r.damping, 0.3, 0, 10),
			};
		}
	}
}

/** The id of the default death camera: the stage activates it when the own player dies, aimed at
 *  the body id `corpse` (where it died). */
export const GHOST_RIG_ID = 'ghost';

/**
 * The rigs a game has when it authors none. `firstPerson` is live (the owner's choice, 2026-11-18:
 * the brawler is first person, as BattleOTtheYear); `ghost` (priority 10) takes over on death;
 * `follow` (the play-field screen's Phase 1a view), `orbit`, `shoulder` and `overview` are for
 * spectating, intros, round ends and debugging — all at one priority, so the last activated wins.
 */
export function defaultCameraRigs3d(rig: Rig3d = RIG3D_DEFAULTS): CameraRigSpec3d[] {
	const of = <K extends CameraRigKind3d>(id: string, kind: K, priority = 0) =>
		({ id, kind, priority, params: paramsOf(kind, {}, rig) }) as CameraRigSpec3d;
	return [
		of('firstPerson', 'firstPerson'),
		of('follow', 'follow'),
		of('orbit', 'orbit'),
		of('shoulder', 'shoulder'),
		of('overview', 'fixed'),
		// `corpse` is where the own player died (the stage keeps it).
		{ ...of(GHOST_RIG_ID, 'ghost', 10), target: 'corpse' },
	];
}

/**
 * One authored rig (`arcade.world3d.camera.rigs[i]`): `{ id, kind, target?, priority?, params? }`.
 * Every param is optional and clamped; a missing `id` or an unknown `kind` throws, naming the path.
 */
export function resolveCameraRig3d(
	raw: unknown,
	path: string,
	rig: Rig3d = RIG3D_DEFAULTS,
): CameraRigSpec3d {
	const r = obj(raw);
	if (typeof r.id !== 'string' || !r.id) throw new Error(`${path}.id: a name`);
	if (!CAMERA_RIG_KINDS.includes(r.kind as CameraRigKind3d))
		throw new Error(`${path}.kind: one of ${CAMERA_RIG_KINDS.join(' ')}`);
	const kind = r.kind as CameraRigKind3d;
	let params;
	try {
		params = paramsOf(kind, r.params, rig);
	} catch (error) {
		throw new Error(`${path}.params: ${error instanceof Error ? error.message : error}`, {
			cause: error,
		});
	}
	return {
		id: r.id,
		kind,
		...(typeof r.target === 'string' && r.target ? { target: r.target } : {}),
		priority: num(r.priority, 0),
		params,
	} as CameraRigSpec3d;
}
