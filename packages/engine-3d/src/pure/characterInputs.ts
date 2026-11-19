import type { BodyView3d } from './play';
import { yawRadians } from './rig';

/**
 * Gameplay → the animation graph's `character:*` inputs (animation eval §3, Phase 2 A3), for every
 * body the view draws: the offline player, the own predicted player and everyone interpolated. The
 * rule is "replicate gameplay, never animation": each device derives these from the state it already
 * has, so nothing here travels.
 *
 * - `speed` (m/s on the ground plane) and `localMoveX` / `localMoveY` (that velocity in the body's
 *   own frame — x to its right, y ahead — divided by its top speed, so 1 = full sprint ahead) come
 *   from the DRAWN positions, smoothed over {@link VELOCITY_TC_MS}: an interpolated player carries no
 *   velocity, and the drawn path is what the eye compares the feet with.
 * - `grounded`, `carrying`, `aimPitch`: the body's (the step's, or the room's `anim` bits).
 * - Triggers: `jump` when a grounded body leaves the ground going up (or, in the air, gains
 *   {@link DOUBLE_JUMP_MS} m/s of climb in one frame — the double jump); `land` when it lands. A
 *   room one-shot or a press on the own device adds its own (`attack` from the room's `attacked`,
 *   the own press predicted at once; `hit`).
 */
export type CharacterSample3d = {
	speed: number;
	localMoveX: number;
	localMoveY: number;
	grounded: boolean;
	carrying: boolean;
	aimPitch: number;
};

/** The smoothing time constant of the drawn velocity. */
export const VELOCITY_TC_MS = 80;
/** A body leaving the ground faster than this upwards jumped (it did not walk off a ledge). */
export const JUMP_CLIMB_MS = 1.5;
/** Climb gained in one frame in the air that counts as a double jump. */
export const DOUBLE_JUMP_MS = 3;

type Track = {
	x: number;
	y: number;
	z: number;
	vx: number;
	vz: number;
	vy: number;
	grounded: boolean;
};

export type CharacterInputs3d = {
	/**
	 * One render frame of one body: its sample and the triggers its motion raised. `extra` are
	 * triggers from elsewhere this frame (room one-shots, the own press).
	 */
	update(
		body: BodyView3d,
		dtMs: number,
		state?: { carrying?: boolean; aimPitch?: number },
	): { sample: CharacterSample3d; triggers: string[] };
	forget(id: string): void;
};

/** The room's one-shots (`services/game-server` `Online3dEvent`) → the graph's triggers: a room
 *  without rules raises `attacked` on the attack button; a Crash room raises its rules' own `attack`
 *  (only a swing or shot the rules let through) and `hit` (on its `target`). */
export const ROOM_TRIGGERS3D: Readonly<Record<string, string>> = Object.freeze({
	attacked: 'attack',
	attack: 'attack',
	hit: 'hit',
});

export function createCharacterInputs3d({
	topSpeed,
}: {
	/** A body's top speed (m/s; its sprint), by body: what 1 means on the local move axes. */
	topSpeed: (body: BodyView3d) => number;
}): CharacterInputs3d {
	const tracks = new Map<string, Track>();
	return {
		update(body, dtMs, state = {}) {
			const triggers: string[] = [];
			const grounded = body.grounded !== false;
			let t = tracks.get(body.id);
			if (!t) {
				t = { x: body.x, y: body.y, z: body.z, vx: 0, vz: 0, vy: 0, grounded };
				tracks.set(body.id, t);
			}
			const dt = Math.max(dtMs, 0) / 1000;
			if (dt > 0) {
				const k = 1 - Math.exp(-dtMs / VELOCITY_TC_MS);
				const vy = (body.y - t.y) / dt;
				if (t.grounded && !grounded && vy > JUMP_CLIMB_MS) triggers.push('jump');
				else if (!t.grounded && !grounded && vy - t.vy > DOUBLE_JUMP_MS) triggers.push('jump');
				if (!t.grounded && grounded) triggers.push('land');
				t.vx += ((body.x - t.x) / dt - t.vx) * k;
				t.vz += ((body.z - t.z) / dt - t.vz) * k;
				t.vy = vy;
			}
			t.x = body.x;
			t.y = body.y;
			t.z = body.z;
			t.grounded = grounded;
			// Yaw 0 looks down −z; the body's right is +x there.
			const r = yawRadians(body.yaw);
			const ahead = -Math.sin(r) * t.vx - Math.cos(r) * t.vz;
			const right = Math.cos(r) * t.vx - Math.sin(r) * t.vz;
			const top = Math.max(topSpeed(body), 1e-6);
			const clamp = (v: number) => Math.min(Math.max(v, -1), 1);
			return {
				sample: {
					speed: Math.hypot(t.vx, t.vz),
					localMoveX: clamp(right / top),
					localMoveY: clamp(ahead / top),
					grounded,
					carrying: state.carrying === true,
					aimPitch: state.aimPitch ?? 0,
				},
				triggers,
			};
		},
		forget: (id) => void tracks.delete(id),
	};
}
