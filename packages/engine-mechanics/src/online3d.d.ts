/**
 * Types for online 3D arcade rooms (`online3d.js`, `docs/design/3d/gameplay-evaluation.md` §2–§3).
 * Pinned by `scripts/check-room-sim-3d.mjs`.
 */

import type { Brain, BrainSpec } from './behaviours';

import type {
	Body3d,
	Collider3dSpec,
	Level3d,
	Motion3dSpec,
	Step3dResult,
	Zone3dSpec,
} from './motion3d';

export { BOT_PREFIX, isBotId } from './onlineBots';
export { createSnapshotClock, INTERPOLATION_DELAY_MS } from './netcode';
export { MOVE_SCALE, YAW_UNITS } from './motion3d';

/** What a 3D device sends, once per fixed step. Nothing else ever reaches the server. */
export type Input3d = {
	seq: number;
	/** int8 world-space axes, the move's length at most 127. */
	moveX: number;
	moveZ: number;
	/** {@link BUTTONS3D} bits. */
	buttons: number;
	/** uint16, 65536 to the turn; 0 looks down −z. */
	yaw: number;
	/** In yaw units, up positive, held to ±{@link PITCH_LIMIT}. */
	pitch: number;
	/** The room step the device was drawing everyone else at. */
	view: number;
};

export declare const BUTTONS3D: Readonly<{
	jump: 1;
	sprint: 2;
	attack: 4;
	altAttack: 8;
	interact: 16;
	ability: 32;
}>;
export declare const PITCH_LIMIT: number;
export declare const ANIM3D: Readonly<{
	grounded: 1;
	sprinting: 2;
	carrying: 4;
	aiming: 8;
	doubleJumped: 16;
}>;

export declare function sanitizeInput3d<I extends Partial<Input3d>>(input: I): I & Input3d;
export declare function clampInput3d(raw: unknown): Input3d;
export declare function stepPlayer3d(
	body: Body3d,
	input: Input3d,
	level: Level3d,
	spec?: Motion3dSpec,
	dt?: number,
): Step3dResult;
export declare function respawnOnFall3d(
	body: Body3d,
	result: Step3dResult,
	home: { x: number; y: number; z: number; yaw: number },
): boolean;
export declare function animBits3d(
	body: Body3d,
	input: Input3d | undefined,
	extra?: number,
): number;

export declare function yawFromRadians(radians: number): number;
export declare function radiansOfYaw(yaw: number): number;
export declare function pitchFromRadians(radians: number): number;
export declare function moveFromStick(
	x: number,
	y: number,
	yaw: number,
): { moveX: number; moveZ: number };

export declare const MATCH_M: number;
export declare const SNAP_M: number;
export declare function snapFor3d(spec: Motion3dSpec, patchHz: number): number;

/**
 * What the 3D view draws for one player (`engine-3d` `sync`): metres, y up, `y` the feet; `yaw` in
 * uint16 units (fractional when interpolated; {@link radiansOfYaw} for `rotation.y`).
 */
export type Drawn3d = { x: number; y: number; z: number; yaw: number };

/** One player's state as the room sends it, for the interpolator. */
export type State3d = Drawn3d & { anim?: number };

export type Truth3d = {
	x: number;
	y: number;
	z: number;
	ack: number;
	step?: number;
	still?: boolean;
};

export type Predictor3d = {
	readonly body: Body3d;
	readonly pending: number;
	readonly corrections: number;
	readonly snaps: number;
	input(input: Input3d): Step3dResult | undefined;
	reconcile(truth: Truth3d): 'stale' | 'match' | 'corrected';
	frame(dtMs: number): void;
	drawn(alpha?: number): Drawn3d;
};

export declare function createPredictor3d(options: {
	body: Body3d;
	level: Level3d;
	spec?: Motion3dSpec;
	dt?: number;
	ack?: number;
	/** Where a fall puts the body back; default: where `body` is. */
	home?: { x: number; y: number; z: number; yaw: number };
	smoothMs?: number;
	snapM?: number;
}): Predictor3d;

export type Interpolator3d = {
	push(id: string, step: number, state: State3d): void;
	retain(ids: ReadonlySet<string>): void;
	at(id: string, at: number): Required<State3d> | undefined;
};

export declare function createInterpolator3d(options?: {
	snapM?: number;
	keep?: number;
}): Interpolator3d;

export type Bot3d = { brain: Brain; seq: number; blocked: boolean };

/** A room player as a bot sees it. */
export type BotSeen3d = {
	id: string;
	body: Body3d;
	tags?: readonly string[];
	connected: boolean;
	status: number;
};

export declare function createBot3d(options: {
	brain: BrainSpec;
	seed: number;
	at: { x: number; z: number };
}): Bot3d;
export declare function botInput3d(
	bot: Bot3d,
	self: BotSeen3d,
	players: Iterable<BotSeen3d>,
	options: { dt: number; spec?: Motion3dSpec; view: number },
): Input3d;

export type World3dLevel = {
	colliders: Collider3dSpec[];
	zones: Zone3dSpec[];
	cellSize?: number;
	killY?: number;
};

export type World3d = Readonly<{
	level: World3dLevel;
	motion: Readonly<Motion3dSpec>;
	characters: Readonly<Record<string, Readonly<Motion3dSpec>>>;
	spawns: readonly Readonly<{ x: number; y: number; z: number; yaw: number }>[];
}>;

export declare function world3dOf(raw: unknown): World3d | undefined;
export declare function motionFor3d(world: World3d, characterId: string): Readonly<Motion3dSpec>;
