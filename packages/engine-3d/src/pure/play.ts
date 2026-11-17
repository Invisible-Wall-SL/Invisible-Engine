import {
	createBody3d,
	MOTION3D_DEFAULTS,
	MOTION3D_HZ,
	stepBody3d,
	type Body3d,
	type Input3d,
	type Level3d,
	type Motion3dSpec,
	type Step3dResult,
} from 'engine-mechanics/src/motion3d.js';

import type { Vec3 } from './rig';

/** What the view draws for one body: where it stands this frame and how big it is. */
export type BodyView3d = {
	id: string;
	/** Feet, metres. */
	x: number;
	y: number;
	z: number;
	/** m/s on the plane (the camera's look-ahead). */
	vx: number;
	vz: number;
	/** uint16. */
	yaw: number;
	radius: number;
	height: number;
	/** The look of a placeholder: `hero` is the own player. */
	kind: 'hero' | 'other';
};

export type Play3d = {
	/** Run as many fixed steps as `dtMs` of the game's clock holds. */
	advance(dtMs: number, input: Input3d): void;
	/** Drop the time not yet stepped (after a hidden tab: the world resumes where it stopped). */
	resync(): void;
	/** The bodies at this frame, blended between the last two steps. */
	bodies(): readonly BodyView3d[];
	/** The own player's body, as the step left it. */
	readonly player: Body3d;
	/** Fixed steps run so far. */
	readonly steps: number;
	/** The last step's events. */
	readonly last: Step3dResult | undefined;
};

/** The longest frame the loop catches up on; a longer gap (a stall, a resumed tab) is dropped. */
export const MAX_CATCH_UP_MS = 250;

const STEP_MS = 1000 / MOTION3D_HZ;

/**
 * The offline 3D play field: one player body stepped by `motion3d` at its fixed rate against a
 * level, respawned at `spawn` when it falls past the death plane. Online, the room steps the
 * bodies instead (Phase 1b), and the view reads the same {@link BodyView3d}s.
 */
export function createPlay3d({
	level,
	spawn,
	spec = MOTION3D_DEFAULTS,
}: {
	level: Level3d;
	spawn: Vec3;
	spec?: Motion3dSpec;
}): Play3d {
	const player = createBody3d(spawn);
	let prev = { x: player.x, y: player.y, z: player.z };
	let pending = 0;
	let steps = 0;
	let last: Step3dResult | undefined;
	return {
		advance(dtMs, input) {
			pending += Math.min(Math.max(dtMs, 0), MAX_CATCH_UP_MS);
			while (pending >= STEP_MS) {
				prev = { x: player.x, y: player.y, z: player.z };
				last = stepBody3d(player, input, level, spec);
				if (last.fell) {
					Object.assign(player, createBody3d(spawn));
					prev = { x: player.x, y: player.y, z: player.z };
				}
				pending -= STEP_MS;
				steps += 1;
			}
		},
		resync() {
			pending = 0;
			prev = { x: player.x, y: player.y, z: player.z };
		},
		bodies() {
			const t = pending / STEP_MS;
			return [
				{
					id: 'player',
					x: prev.x + (player.x - prev.x) * t,
					y: prev.y + (player.y - prev.y) * t,
					z: prev.z + (player.z - prev.z) * t,
					vx: player.vx,
					vz: player.vz,
					yaw: player.yaw,
					radius: spec.radius,
					height: spec.height,
					kind: 'hero',
				},
			];
		},
		player,
		get steps() {
			return steps;
		},
		get last() {
			return last;
		},
	};
}
