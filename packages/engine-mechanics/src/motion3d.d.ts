/**
 * Types for arcade 3D motion (`motion3d.js`, `docs/design/3d/gameplay-evaluation.md` §2). Metres,
 * y up; pinned by `scripts/check-arcade-3d.mjs`.
 */

export declare const MOTION3D_HZ: number;
export declare const MAX_SUB_STEPS_3D: number;
export declare const MOVE_SCALE: number;
export declare const YAW_UNITS: number;
export declare const BUTTON_JUMP: number;
export declare const BUTTON_SPRINT: number;
export declare const HASH3D_SEED: number;
export declare const MIN_CELL_SIZE_3D: number;
export declare const MAX_LEVEL_CELLS_3D: number;
export declare const MAX_COLLIDERS_3D: number;
export declare const MAX_ZONES_3D: number;
export declare const MAX_CELL_COLLIDERS_3D: number;
export declare const MAX_COORD_3D: number;
export declare const MAX_STEP_DT_3D: number;
export declare const MAX_SWEEP_CELLS_3D: number;
export declare const MAX_TRAMPOLINE_M: number;

export type RampFacing = '+x' | '-x' | '+z' | '-z';
export declare const RAMP_FACINGS: readonly RampFacing[];

export type Box3 = {
	minX: number;
	minY: number;
	minZ: number;
	maxX: number;
	maxY: number;
	maxZ: number;
};

/** A ramp's surface rises from `minY` on its low edge to `maxY` on the edge `facing` names. */
export type Collider3dSpec = Box3 & ({ kind: 'box' } | { kind: 'ramp'; facing: RampFacing });

/** A `trampoline` launches a body standing in it to `height` m (> 0); other kinds are for the
 *  rules. */
export type Zone3dSpec = Box3 & { kind: string; height?: number };

export type Collider3d = Box3 & {
	readonly id: number;
	readonly kind: 'box' | 'ramp';
	/** Index into {@link RAMP_FACINGS}; −1 for a box. */
	readonly rise: number;
	/** Rise per metre of run; 0 for a box. */
	readonly slope: number;
};

export type Zone3d = Box3 & { readonly id: number; readonly kind: string; readonly height: number };

/** Built once per level; its query scratch (`seen`, `query`) is mutated by every step. */
export type Level3d = {
	readonly colliders: readonly Collider3d[];
	readonly zones: readonly Zone3d[];
	readonly cells: ReadonlyMap<string, readonly number[]>;
	readonly cellSize: number;
	readonly killY: number;
	seen: Int32Array;
	query: number;
};

export type Motion3dSpec = {
	radius: number;
	height: number;
	/** m/s at full stick. */
	speed: number;
	/** Speed multiplier while {@link BUTTON_SPRINT} is held. */
	sprint: number;
	/** m/s² toward the stick's velocity, on the ground and in the air. */
	groundAccel: number;
	airAccel: number;
	/** m/s², negative (down). */
	gravity: number;
	maxFall: number;
	jumpHeight: number;
	doubleJumpHeight: number;
	/** A double jump is allowed only while |vy| is under this. */
	apexWindow: number;
	coyoteSteps: number;
	bufferSteps: number;
	stepUp: number;
	snapDown: number;
	/** The longest sub-step move, m. */
	subMove: number;
	/** The steepest ramp walked, rise over run; a steeper one is a wall. */
	maxSlope: number;
};

export declare const MOTION3D_DEFAULTS: Readonly<Motion3dSpec>;
/** The committed replay's code: what the step does. */
export declare const MOTION3D_VERSION: string;

/** `x` / `z` is the centre on the plane, `y` the feet; `yaw` a uint16 copied from the input. */
export type Body3d = {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	yaw: number;
	grounded: boolean;
	held: boolean;
	coyote: number;
	buffer: number;
	doubleUsed: boolean;
	/** The step-up in hand, m (`Infinity` until the first step holds it to `stepUp`). */
	climb: number;
};

/** int8 world-space move axes, a uint16 yaw and button bits. */
export type Input3d = { mx: number; mz: number; yaw: number; buttons: number };

export type Step3dResult = {
	grounded: boolean;
	landed: boolean;
	jumped: boolean;
	doubleJumped: boolean;
	bounced: boolean;
	onWall: boolean;
	onRamp: boolean;
	steppedUp: boolean;
	hitCeiling: boolean;
	/** Below the level's `killY`; the rules respawn. */
	fell: boolean;
};

/** Throws past the `MAX_*_3D` caps, under {@link MIN_CELL_SIZE_3D} or past {@link MAX_COORD_3D}. */
export declare function createLevel3d(level?: {
	colliders?: readonly Collider3dSpec[];
	zones?: readonly Zone3dSpec[];
	cellSize?: number;
	killY?: number;
}): Level3d;

/** `[min, max]` of every motion value a config may set. */
export declare const MOTION3D_LIMITS: Readonly<
	Record<keyof Motion3dSpec, readonly [number, number]>
>;
/** Whether one step of `spec` sweeps at most `MAX_SWEEP_CELLS_3D` columns of `cellSize`. */
export declare function sweepFits3d(spec: Motion3dSpec, cellSize: number): boolean;

export declare function collidersNear(
	level: Level3d,
	x0: number,
	z0: number,
	x1: number,
	z1: number,
): Collider3d[];

export declare function topUnder(
	c: Collider3d,
	x0: number,
	z0: number,
	x1: number,
	z1: number,
): number;

export declare function createBody3d(at?: {
	x?: number;
	y?: number;
	z?: number;
	yaw?: number;
}): Body3d;

export declare function stepBody3d(
	body: Body3d,
	input: Input3d,
	level: Level3d,
	spec?: Motion3dSpec,
	dt?: number,
): Step3dResult;

/** The most zones a body is in at once (the lowest ids count). */
export declare const MAX_ZONES_AT_ONCE_3D: number;
/** The zones a body is in, by id, ascending, at most {@link MAX_ZONES_AT_ONCE_3D}. */
export declare function zonesAt3d(body: Body3d, level: Level3d, spec?: Motion3dSpec): number[];

export declare const SIGNALS3D: Readonly<{
	jumped: 'jumped';
	doubleJumped: 'doubleJumped';
	landed: 'landed';
	bounced: 'bounced';
	leaveZone: 'leaveZone';
	enterZone: 'enterZone';
	fell: 'fell';
}>;

export type Signal3d =
	| { type: 'jumped' | 'doubleJumped' | 'landed' | 'bounced' | 'fell' }
	| { type: 'enterZone' | 'leaveZone'; zone: number; kind: string };

export type Tracker3d = { zones: number[]; fell: boolean };

export declare function createTracker3d(): Tracker3d;

export declare function trackStep3d(
	tracker: Tracker3d,
	body: Body3d,
	result: Step3dResult,
	level: Level3d,
	spec?: Motion3dSpec,
): Signal3d[];

export declare function hashBodies3d(bodies: readonly Body3d[], h?: number): number;
