/**
 * Types for arcade characters (`behaviours.js`, `docs/design/game-families.md` §4.3, P10.11). The
 * module is plain JS — see the package's `index.ts` for why — so its contract is declared here. The
 * spec types mirror game-config's `ArcadeBrain` / `ArcadeController` structurally; this package
 * stays dependency-free. The behaviour is pinned by `scripts/check-arcade-characters.mjs`.
 */

import type { Rng } from './board.js';
import type { Body, Movement, Point, SampledPath, Velocity } from './motion.js';

export type BehaviourKind =
	| 'idle'
	| 'wander'
	| 'patrol'
	| 'followPath'
	| 'chase'
	| 'flee'
	| 'keepDistance'
	| 'hover'
	| 'shootAt';

export type ConditionKind =
	'targetWithin' | 'targetBeyond' | 'touching' | 'hitSolid' | 'timer' | 'variable' | 'random';

export type BrainCondition =
	| { kind: 'targetWithin'; tag: string; px: number }
	| { kind: 'targetBeyond'; tag: string; px: number }
	| { kind: 'touching'; tag: string }
	| { kind: 'hitSolid' }
	| { kind: 'timer'; ms: number }
	| {
			kind: 'variable';
			id: string;
			op: '==' | '!=' | '<' | '<=' | '>' | '>=';
			value: number | boolean | string;
	  }
	| { kind: 'random'; chance: number; every?: number };

export type BrainState = {
	id: string;
	behaviour: string;
	params?: Readonly<Record<string, number | string | boolean>>;
};

export type BrainTransition = {
	id: string;
	/** A state id, or `*` for any state. */
	from: string;
	to: string;
	when: readonly BrainCondition[];
};

export type BrainSpec = {
	initial: string;
	states: readonly BrainState[];
	transitions: readonly BrainTransition[];
};

export type Brain = {
	readonly spec: BrainSpec;
	state: string;
	/** ms in the current state. */
	time: number;
	/** The current behaviour's own state, reset on entering a state. */
	memory: Record<string, unknown>;
	/** The tick each `random` condition last rolled on, by `<transition index>:<condition index>`. */
	rolls: Record<string, number>;
	readonly rng: Rng;
	/** Where the body spawned. */
	readonly at: Point;
};

export type BrainChange = { from: string; to: string };

export type Nearest<B extends Body = Body> = { body: B; distance: number };

/** What one character's brain sees this step (see {@link createBrainWorld}). */
export type BrainWorld<B extends Body = Body> = {
	readonly self: B;
	readonly bodies: readonly B[];
	nearest(self: Body, tag: string): Nearest<B> | undefined;
	touching(self: Body, tag: string): boolean;
	/** Whether this character's last solid step stopped it. */
	readonly hitSolid: boolean;
	readonly paths: Readonly<Record<string, SampledPath>>;
	variable(id: string): unknown;
};

/** A shot `shootAt` asks the loop to spawn, centred on the shooter. */
export type BrainSpawn = {
	component: string;
	layer: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
};

export type BrainVelocity = Velocity & { spawn?: BrainSpawn };

export type Controller =
	| { kind: 'topDown'; speed: number }
	| { kind: 'sideScroll'; speed: number }
	| { kind: 'pointer'; axes: 'x' | 'y' | 'xy'; speed?: number };

export type ControllerInput = {
	held(action: string): boolean;
	/** A pressed pointer (mouse button or touch) in field px, or `undefined` while none is down. */
	pointer(): Point | undefined;
};

export const BEHAVIOUR_DEFAULTS: {
	readonly idle: Record<string, never>;
	readonly wander: { speed: number; turnEvery: number };
	readonly patrol: { speed: number; dx: number; dy: number };
	readonly followPath: { speed: number };
	readonly chase: { tag: string; range: number; speed: number };
	readonly flee: { tag: string; range: number; speed: number };
	readonly keepDistance: { tag: string; distance: number; speed: number };
	readonly hover: { amplitude: number; period: number; axis: string };
	readonly shootAt: { tag: string; every: number; speed: number; range: number };
};
export const BEHAVIOURS: BehaviourKind[];
export const CONDITIONS: ConditionKind[];
export const CONTROLLER_ACTIONS: ('left' | 'right' | 'up' | 'down')[];
export const RANDOM_EVERY: 1000;
export const PATH_LEAD: 12;

export function createBrain(spec: BrainSpec, options: { rng: Rng; at: Point }): Brain;
export function createBrainWorld<B extends Body>(options: {
	self: B;
	bodies: readonly B[];
	hitSolid?: boolean;
	paths?: Readonly<Record<string, SampledPath>>;
	variable?: (id: string) => unknown;
}): BrainWorld<B>;
export function stepBrain(brain: Brain, world: BrainWorld, dt: number): BrainChange | undefined;
export function setBrainState(brain: Brain, id: string): BrainChange | undefined;
export function brainVelocity(
	brain: Brain,
	self: Body,
	world: BrainWorld,
	dt: number,
): BrainVelocity;
export function controllerVelocity(
	controller: Controller,
	input: ControllerInput,
	self: Body,
	movement: Movement | undefined,
	dt: number,
): Velocity;
