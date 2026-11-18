import { RIG3D_DEFAULTS, type Rig3d } from '../rig';
import { CAMERA_BLEND_DEFAULT } from './director';
import {
	CAMERA_EASES,
	CAMERA_LENS_DEFAULT,
	clamp,
	type CameraEase3d,
	type CameraLens3d,
} from './math';
import {
	defaultCameraRigs3d,
	GHOST_RIG_ID,
	resolveCameraRig3d,
	type CameraRigSpec3d,
} from './rigs';
import { SHAKE3D_DEFAULTS, type ShakeSpec3d } from './shake';

/** A game's 3D camera as data: `arcade.world3d.camera` (local only; the room never reads it). */
export type Camera3dConfig = {
	rigs: CameraRigSpec3d[];
	/** The rig on screen at start. */
	active: string;
	blend: { blendMs: number; ease: CameraEase3d };
	shake: ShakeSpec3d;
	/** The FOV on a narrow (portrait) screen. */
	lens: CameraLens3d;
	/** The game's camera moves: a GLB of camera clips (`anim/cameras/<arena>.glb`), relative to the
	 *  game's asset base or absolute. */
	moves?: string;
	/** On the own player's death: this rig (the ghost by default) for `ms`, then back over
	 *  `blendBackMs`. Absent when the game has no such rig. */
	death?: { rig: string; ms: number; blendBackMs: number };
	/** A move to play when the field mounts, then hand back to `active`. */
	intro?: { move: string; blendInMs: number; blendOutMs: number; ease: CameraEase3d };
};

const obj = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const num = (value: unknown, fallback: number, lo: number, hi: number) =>
	typeof value === 'number' && Number.isFinite(value) ? clamp(value, lo, hi) : fallback;

const easeOf = (value: unknown, fallback: CameraEase3d): CameraEase3d =>
	CAMERA_EASES.includes(value as CameraEase3d) ? (value as CameraEase3d) : fallback;

/**
 * The camera block as authored (any field may be absent) → a whole camera. No `rigs` ⇒
 * `defaultCameraRigs3d`: first person live, the ghost for a death, and every other kind but `rail`
 * (`follow` being the play-field screen's `camera.rig3d` view). A bad rig throws, naming its path.
 */
export function camera3dOf(raw: unknown, rig: Rig3d = RIG3D_DEFAULTS): Camera3dConfig {
	const r = obj(raw);
	const rigs = Array.isArray(r.rigs)
		? r.rigs.map((entry, i) => resolveCameraRig3d(entry, `arcade.world3d.camera.rigs.${i}`, rig))
		: defaultCameraRigs3d(rig);
	if (!rigs.length) throw new Error('arcade.world3d.camera.rigs: one rig or more');
	const ids = new Set<string>();
	for (const [i, spec] of rigs.entries()) {
		if (ids.has(spec.id)) throw new Error(`arcade.world3d.camera.rigs.${i}.id: ${spec.id} twice`);
		ids.add(spec.id);
	}
	const active = typeof r.active === 'string' && ids.has(r.active) ? r.active : rigs[0].id;
	const shake = obj(r.shake);
	const lens = obj(r.lens);
	const blend = {
		blendMs: num(r.blendMs, CAMERA_BLEND_DEFAULT.blendMs, 0, 20_000),
		ease: easeOf(r.ease, CAMERA_BLEND_DEFAULT.ease),
	};
	const intro = obj(r.intro);
	const death = obj(r.death);
	const deathRig = typeof death.rig === 'string' ? death.rig : GHOST_RIG_ID;
	return {
		rigs,
		active,
		blend,
		shake: {
			yaw: num(shake.yaw, SHAKE3D_DEFAULTS.yaw, 0, 45),
			pitch: num(shake.pitch, SHAKE3D_DEFAULTS.pitch, 0, 45),
			roll: num(shake.roll, SHAKE3D_DEFAULTS.roll, 0, 45),
			offset: num(shake.offset, SHAKE3D_DEFAULTS.offset, 0, 5),
			frequency: num(shake.frequency, SHAKE3D_DEFAULTS.frequency, 0.1, 120),
		},
		lens: {
			minAspect: num(lens.minAspect, CAMERA_LENS_DEFAULT.minAspect, 0, 4),
			maxFov: num(lens.maxFov, CAMERA_LENS_DEFAULT.maxFov, 10, 150),
		},
		...(typeof r.moves === 'string' && r.moves ? { moves: r.moves } : {}),
		...(ids.has(deathRig)
			? {
					death: {
						rig: deathRig,
						ms: num(death.ms, 2000, 0, 60_000),
						blendBackMs: num(death.blendBackMs, 400, 0, 20_000),
					},
				}
			: {}),
		...(typeof intro.move === 'string' && intro.move
			? {
					intro: {
						move: intro.move,
						blendInMs: num(intro.blendInMs, 0, 0, 20_000),
						blendOutMs: num(intro.blendOutMs, blend.blendMs, 0, 20_000),
						ease: easeOf(intro.ease, blend.ease),
					},
				}
			: {}),
	};
}
