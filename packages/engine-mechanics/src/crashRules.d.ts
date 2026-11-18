/**
 * Types for Crash, the rules of an online 3D room (`crashRules.js`,
 * `docs/design/3d/gameplay-evaluation.md` §3). Pinned by `scripts/check-crash-rules.mjs`.
 */

import type { Body3d, Level3d, Motion3dSpec, Step3dResult } from './motion3d';
import type { Input3d } from './online3d';

export { REWIND_MS } from './onlineRules';
export { STATUS3D } from './online3d';

export declare const TEAMS: readonly ['red', 'blue'];
export declare const ENTITY_STATE: Readonly<{ resting: 0; carried: 1; flying: 2 }>;
export declare const CARRIABLE: readonly ['piece', 'corpse'];
export declare const WEAPON_TYPES: readonly ['hitscan', 'projectile', 'melee'];

export type WeaponType = 'hitscan' | 'projectile' | 'melee';

/** A weapon, as BOTY's `WeaponConfig` plus what its hits do here. */
export type CrashWeapon = {
	type: WeaponType;
	/** Seconds between shots (BOTY `FireRate`). */
	fireRate: number;
	damage: number;
	/** m: a melee reach, a hitscan's length, how far a projectile flies. */
	range: number;
	/** Fires while held (else once a press). */
	automatic: boolean;
	projectileSpeed: number;
	hitForce: number;
	knockUp: number;
	/** Melee: the sector's whole arc, degrees, and the height band, m. */
	arc: number;
	heightBand: number;
	projectileRadius: number;
	projectileGravity: number;
	splashRadius: number;
};

/** A hero, as BOTY's `HeroConfig` (its `MoveSpeed` is the motion's `speed`). */
export type CrashHero = {
	maxHealth: number;
	maxMana: number;
	maxShields: number;
	startingWeapons: readonly string[];
};

export type CrashPieceSpawn = { x: number; y: number; z: number; score: number };

export type CrashRulesSpec = {
	module: 'crash';
	roundSeconds: number;
	nextRoundSeconds: number;
	interactRange: number;
	interactHeight: number;
	throwSpeed: number;
	throwLift: number;
	carryHeight: number;
	carryAhead: number;
	pitRise: number;
	pitMax: number;
	corpseTeams: readonly (0 | 1)[];
	corpseSeconds: number;
	corpseScoredSeconds: number;
	respawnSeconds: number;
	spawnGraceSeconds: number;
	killScore: readonly [number, number];
	pieceRespawnSeconds: number;
	friendlyFire: boolean;
	eyeHeight: number;
	pieceFriction: number;
	pieceBounce: number;
	pieces: readonly CrashPieceSpawn[];
	weapons: Readonly<Record<string, CrashWeapon>>;
	heroes: Readonly<Record<string, CrashHero>>;
	defaultHero: string;
};

export declare const BOTY_WEAPONS: Readonly<Record<string, Partial<CrashWeapon>>>;
export declare const BOTY_HEROES: Readonly<Record<string, Partial<CrashHero>>>;
export declare const CRASH_DEFAULTS: Readonly<Record<string, unknown>>;

/** The rules of a raw `arcade.world3d.rules` block, `undefined` without one; throws naming the
 *  first bad path. */
export declare function crashRulesOf(raw: unknown): Readonly<CrashRulesSpec> | undefined;

export declare function aimDirection(
	yaw: number,
	pitch?: number,
): { x: number; y: number; z: number };
export declare function rayLevel3d(
	level: Level3d,
	ox: number,
	oy: number,
	oz: number,
	dx: number,
	dy: number,
	dz: number,
	maxT: number,
): number;
export declare function rayCylinder(
	ox: number,
	oy: number,
	oz: number,
	dx: number,
	dy: number,
	dz: number,
	cx: number,
	cz: number,
	y0: number,
	y1: number,
	r: number,
): number;
export declare function meleeSector(
	ax: number,
	ay: number,
	az: number,
	fx: number,
	fz: number,
	tx: number,
	ty: number,
	tz: number,
	spec: { reach: number; heightBand: number; cosHalf: number; radius: number },
): number;

/** A player as the rules see it: the room's player, whose rules fields the rules write. */
export type CrashPlayer = {
	id: string;
	character: { id: string };
	body: Body3d;
	spec: Readonly<Motion3dSpec>;
	home: { x: number; y: number; z: number; yaw: number };
	connected: boolean;
	ack: number;
	team: number;
	status: number;
	hp: number;
	shield: number;
	hero: string;
	weapon: string;
	/** The id of the entity it carries, or ''. */
	carrying: string;
	bot?: true;
};

export type CrashEntity = {
	id: string;
	kind: 'piece' | 'corpse' | 'projectile';
	body: Body3d;
	state: number;
	carriedBy: string;
	lastCarrier: string;
	lastTeam: number;
	owner: string;
	team: number;
	weapon: string;
};

export type CrashEvent =
	| { type: 'roundStart'; round: number }
	| { type: 'roundEnd'; round: number; winner: string; red: number; blue: number }
	| { type: 'picked' | 'thrown' | 'dropped'; id: string; entity: string }
	| {
			type: 'pieceScored';
			entity: string;
			kind: string;
			by: string;
			team: string;
			points: number;
			red: number;
			blue: number;
	  }
	| { type: 'pitRise'; level: number }
	| { type: 'attack'; id: string; weapon: string }
	| { type: 'shot'; id: string; x: number; y: number; z: number; target: string }
	| { type: 'impact'; entity: string; x: number; y: number; z: number; target: string }
	| { type: 'hit'; by: string; target: string; damage: number; hp: number; shield: number }
	| { type: 'knockback'; id: string; seq: number; vx: number; vy: number; vz: number }
	| { type: 'kill'; by: string; target: string; cause: 'weapon' | 'fall' | 'void' }
	| { type: 'corpse'; entity: string; owner: string }
	| { type: 'respawn'; id: string };

export type CrashRules = {
	readonly phase: 'waiting' | 'running' | 'ended';
	readonly round: number;
	readonly endsAt: number;
	readonly winner: string;
	/** [red, blue]. */
	readonly scores: readonly [number, number];
	readonly pitLevel: number;
	readonly entities: ReadonlyMap<string, CrashEntity>;
	bind(players: ReadonlyMap<string, CrashPlayer>): void;
	holds(player: CrashPlayer): boolean;
	joined(player: CrashPlayer, every: readonly CrashPlayer[], people: number, stamp: number): void;
	left(id: string): void;
	empty(): void;
	applied(
		player: CrashPlayer,
		input: Input3d,
		result: Step3dResult | undefined,
		every: readonly CrashPlayer[],
		stamp: number,
	): boolean;
	afterStep(every: readonly CrashPlayer[], stamp: number): void;
	take(): CrashEvent[];
};

export declare function createCrashRules(options: {
	level: Level3d;
	rules: Readonly<CrashRulesSpec>;
	tickHz: number;
}): CrashRules;

export declare const ONLINE_RULES3D_MODULES: Readonly<{
	crash: { create: typeof createCrashRules };
}>;
