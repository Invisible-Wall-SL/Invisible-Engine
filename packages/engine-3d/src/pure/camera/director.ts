import type { Collider3dSpec } from 'engine-mechanics/src/motion3d.js';

import type { Vec3 } from '../rig';
import { createCameraCollider3d } from './collision';
import {
	ease as easeOf,
	fromYawPitchRoll,
	mixPose,
	mul,
	rotate,
	yawPitchOf,
	type CameraEase3d,
	type Pose3d,
	type Quat,
} from './math';
import {
	createRig3d,
	NO_CAMERA_INPUT,
	type CameraFrame3d,
	type CameraInput3d,
	type CameraRigSpec3d,
	type CameraTarget3d,
	type RigRuntime3d,
} from './rigs';
import { createShake3d, SHAKE3D_DEFAULTS, type ShakeSpec3d } from './shake';

/** A switch: how long it blends and how (`cut`, or `blendMs` ≤ 0, jumps). */
export type CameraBlend3d = { blendMs?: number; ease?: CameraEase3d };

/**
 * An authored camera move (an intro, a round end, a kill cam): a camera node's path sampled at a
 * time, from a glTF clip (`cameraMoves.ts` reads `anim/cameras/<arena>.glb`). FOV is constant per
 * move (glTF FOV animation needs `KHR_animation_pointer`).
 */
export type CameraMove3d = {
	name: string;
	durationMs: number;
	fov: number;
	sample(tMs: number): { position: Vec3; rotation: Quat };
};

export type PlayMove3d = {
	blendInMs?: number;
	blendOutMs?: number;
	ease?: CameraEase3d;
	/** `target`: the clip's origin is the followed body's feet when the move starts (orbit round the
	 *  winner); `world`, the default: the level's origin. */
	space?: 'world' | 'target';
};

/** What the director shows this frame. */
export type CameraView3d = {
	/** The pose on screen, shake included. */
	pose: Pose3d;
	/** Heading and tilt of the pose before the shake, degrees (the room's yaw convention; pitch up
	 *  positive): the stick maps through `yaw`, and Flow reads both (`cameraYaw` / `cameraPitch`). */
	yaw: number;
	pitch: number;
	/** The rig on screen (`move:<name>#<n>` while a move plays). */
	live: string;
	blending: boolean;
	/** The live rig turns the body to the camera's heading (first person, shoulder). */
	aims: boolean;
};

export type CameraDirector3d = {
	/** Make a rig active: the highest-priority active rig is on screen, the last activated among
	 *  equals. A switch blends over `blendMs`, from the pose on screen. False for an unknown id. */
	activate(id: string, blend?: CameraBlend3d): boolean;
	deactivate(id: string, blend?: CameraBlend3d): boolean;
	/** The body the rigs follow (one that names its own `target` keeps it). */
	follow(target: string | undefined): void;
	/** Add trauma (0..1), at rest in `durationMs`. */
	shake(strength: number, durationMs: number): void;
	/** Play a move as a temporary top-priority rig; resolves when its last frame has played and the
	 *  camera starts back to the rig underneath (or when another move or `stopMove` replaces it). */
	playMove(move: CameraMove3d, opts?: PlayMove3d): Promise<void>;
	stopMove(blend?: CameraBlend3d): void;
	/** One frame: the followed bodies by id, the player's look. */
	frame(
		dtMs: number,
		targets: (id: string) => CameraTarget3d | undefined,
		input?: CameraInput3d,
	): CameraView3d;
	readonly rigs: readonly CameraRigSpec3d[];
	readonly live: string | undefined;
	readonly followed: string | undefined;
	/** What the last frame showed. */
	readonly view: CameraView3d | undefined;
};

export type DirectorOptions3d = {
	rigs: readonly CameraRigSpec3d[];
	/** The rig active at start (the first rig when absent). */
	active?: string;
	/** The followed body at start. */
	follow?: string;
	/** The game's seed: the shake draws from `<seed>:camera`. */
	seed: string;
	/** The level's colliders, for the pull-in. */
	colliders?: readonly Collider3dSpec[];
	shake?: ShakeSpec3d;
	/** A switch with no blend of its own. */
	blend?: Required<CameraBlend3d>;
};

export const CAMERA_BLEND_DEFAULT: Readonly<Required<CameraBlend3d>> = Object.freeze({
	blendMs: 600,
	ease: 'smooth',
});

type Playing = {
	move: CameraMove3d;
	opts: PlayMove3d;
	tMs: number;
	origin: Vec3;
	done: () => void;
};

/**
 * The 3D camera director (`docs/design/3d/animation-evaluation.md` §4): virtual cameras as data,
 * the highest-priority active one on screen, switches blended — position lerped, rotation
 * slerped, FOV lerped — from the pose on screen, so a blend interrupted midway starts again from
 * where the camera is and never pops. New code beside the 2D `camera.js`, entirely local (only the
 * aim leaves the device). Pure: no three.js; `scripts/check-engine-3d-camera.mjs` pins it.
 */
export function createCameraDirector3d(opts: DirectorOptions3d): CameraDirector3d {
	const collider = opts.colliders?.length ? createCameraCollider3d(opts.colliders) : undefined;
	const runtimes = new Map<string, RigRuntime3d>();
	for (const spec of opts.rigs) {
		if (runtimes.has(spec.id)) throw new Error(`camera rig ${spec.id}: two rigs share the id`);
		runtimes.set(spec.id, createRig3d(spec, collider));
	}
	const fallback = opts.blend ?? CAMERA_BLEND_DEFAULT;
	const shake = createShake3d(opts.seed, opts.shake ?? SHAKE3D_DEFAULTS);
	/** Active rig ids → activation stamp (later wins among equal priorities). */
	const active = new Map<string, number>();
	let stamp = 0;
	const first = opts.active ?? opts.rigs[0]?.id;
	if (first && runtimes.has(first)) active.set(first, ++stamp);
	let followed = opts.follow;
	let playing: Playing | undefined;
	let moves = 0;

	let live: string | undefined;
	/** The pose on screen last frame, before the shake. */
	let screen: Pose3d | undefined;
	let blend: { from: Pose3d; ms: number; t: number; ease: CameraEase3d } | undefined;
	let pending: Required<CameraBlend3d> | undefined;
	/** A move's origin is taken on its first frame, where the followed body is known. */
	let originPending = false;
	let shown: CameraView3d | undefined;

	const winner = (): string | undefined => {
		// Numbered, so a move replacing one of the same name is still a switch (it blends in).
		if (playing) return `move:${playing.move.name}#${moves}`;
		let best: string | undefined;
		let bestP = -Infinity;
		let bestS = -1;
		for (const [id, s] of active) {
			const p = runtimes.get(id)!.spec.priority;
			if (p > bestP || (p === bestP && s > bestS)) {
				best = id;
				bestP = p;
				bestS = s;
			}
		}
		return best;
	};

	const want = (blendOpts: CameraBlend3d | undefined) => {
		pending = {
			blendMs: blendOpts?.blendMs ?? fallback.blendMs,
			ease: blendOpts?.ease ?? fallback.ease,
		};
	};

	const endMove = () => {
		const was = playing;
		playing = undefined;
		was?.done();
	};

	const movePose = (p: Playing): Pose3d => {
		const at = p.move.sample(Math.min(p.tMs, p.move.durationMs));
		return {
			position: {
				x: at.position.x + p.origin.x,
				y: at.position.y + p.origin.y,
				z: at.position.z + p.origin.z,
			},
			rotation: at.rotation,
			fov: p.move.fov,
		};
	};

	return {
		activate(id, b) {
			if (!runtimes.has(id)) return false;
			active.set(id, ++stamp);
			want(b);
			return true;
		},
		deactivate(id, b) {
			if (!active.delete(id)) return false;
			want(b);
			return true;
		},
		follow(target) {
			followed = target;
		},
		shake(strength, durationMs) {
			shake.add(strength, durationMs);
		},
		playMove(move, moveOpts = {}) {
			if (playing) endMove();
			moves += 1;
			return new Promise<void>((done) => {
				playing = { move, opts: moveOpts, tMs: 0, origin: { x: 0, y: 0, z: 0 }, done };
				want({ blendMs: moveOpts.blendInMs ?? 0, ease: moveOpts.ease });
				// The origin is fixed when the move starts, on its first frame (`frame` sets it).
				originPending = true;
			});
		},
		stopMove(b) {
			if (!playing) return;
			endMove();
			want(b);
		},
		frame(dtMs, targets, input = NO_CAMERA_INPUT) {
			const dt = Math.max(0, dtMs);
			if (playing && originPending) {
				originPending = false;
				const t = playing.opts.space === 'target' && followed ? targets(followed) : undefined;
				playing.origin = t ? { x: t.x, y: t.y, z: t.z } : { x: 0, y: 0, z: 0 };
			}
			if (playing) {
				playing.tMs += dt;
				if (playing.tMs >= playing.move.durationMs) {
					const { blendOutMs, ease } = playing.opts;
					// The move's last frame is the pose the camera goes back from.
					screen = movePose(playing);
					endMove();
					want({ blendMs: blendOutMs, ease });
				}
			}
			const id = winner();
			const rigOf = (rig: RigRuntime3d): CameraFrame3d => ({
				dtMs: dt,
				target: targets(rig.spec.target ?? followed ?? ''),
				input,
			});
			if (id !== live) {
				const runtime = id ? runtimes.get(id) : undefined;
				if (runtime) runtime.enter(screen, rigOf(runtime));
				const how = pending ?? fallback;
				blend =
					screen && how.ease !== 'cut' && how.blendMs > 0
						? { from: screen, ms: how.blendMs, t: 0, ease: how.ease }
						: undefined;
				live = id;
			}
			pending = undefined;
			const runtime = live ? runtimes.get(live) : undefined;
			let pose: Pose3d;
			if (playing) pose = movePose(playing);
			else if (runtime) pose = runtime.step(rigOf(runtime));
			else
				pose = screen ?? {
					position: { x: 0, y: 18, z: 18 },
					rotation: fromYawPitchRoll(0, -45),
					fov: 45,
				};
			if (blend) {
				blend.t += dt;
				const k = easeOf(blend.ease, blend.t / blend.ms);
				pose = mixPose(blend.from, pose, k);
				if (blend.t >= blend.ms) blend = undefined;
			}
			screen = pose;
			const { yaw, pitch } = yawPitchOf(pose.rotation);
			const s = shake.step(dt);
			const shaken = shake.trauma > 0 || s.yaw !== 0;
			const rotation = shaken
				? mul(pose.rotation, fromYawPitchRoll(s.yaw, s.pitch, s.roll))
				: pose.rotation;
			const nudge = shaken ? rotate(pose.rotation, s.offset) : { x: 0, y: 0, z: 0 };
			shown = {
				pose: {
					position: {
						x: pose.position.x + nudge.x,
						y: pose.position.y + nudge.y,
						z: pose.position.z + nudge.z,
					},
					rotation,
					fov: pose.fov,
				},
				yaw,
				pitch,
				live: live ?? '',
				blending: !!blend,
				aims: !playing && !!runtime?.aims,
			};
			return shown;
		},
		get rigs() {
			return opts.rigs;
		},
		get live() {
			return live;
		},
		get followed() {
			return followed;
		},
		get view() {
			return shown;
		},
	};
}
