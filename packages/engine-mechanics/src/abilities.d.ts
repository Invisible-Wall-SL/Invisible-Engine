/**
 * Types for abilities and zone forces (`abilities.js`, P11.5): the one implementation the offline
 * loop and an online room both call. Pinned by `scripts/check-online-rules.mjs`.
 */

import type { Body, StaticIndex } from './motion';

export const STATUS: Readonly<{ free: 0; stunned: 1; out: 2; grounded: 3; hooked: 4 }>;
export const GRACE_MS: 1000;

export function stepsOf(ms: number, hz: number): number;

/** An ability as `game-config` resolves it (`arcade.abilities`, `arcade.online.rules.abilities`). */
export type AbilityConfig = {
	character: string;
	button: string;
	reach: number;
	targets: readonly string[];
	effect: string;
	ms: number;
	score: number;
	cooldownMs: number;
};

/** An ability in steps: `key` names its cooldown, `cooldown` and `hold` are steps. */
export type AbilitySpec<A extends AbilityConfig = AbilityConfig> = A & {
	key: string;
	cooldown: number;
	hold: number;
};

export function abilitySpecs<A extends AbilityConfig>(
	abilities: readonly A[],
	hz: number,
): AbilitySpec<A>[];

/** What an ability acts on, mutated in place. */
export type AbilityActor = {
	id: string;
	character: { id: string };
	body: Body;
	status: number;
	/** The stamp its status ends at. */
	until: number;
	/** The stamp before which it cannot be hit. */
	safeUntil: number;
	/** Ability key → the stamp it can be used again at. */
	cooldowns: Record<string, number>;
};

export function hittable(actor: AbilityActor): boolean;
export function freeActor(actor: AbilityActor, stamp: number, grace: number): void;

export type AbilityReach<T extends AbilityActor> = {
	present(target: T): boolean;
	placeOf(target: T): { x: number; y: number };
};

export function abilityTargets<T extends AbilityActor>(
	user: T,
	ability: AbilitySpec,
	players: readonly T[],
	stamp: number,
	reach: AbilityReach<T>,
): { target: T; d: number }[];

export type AbilityUse<T extends AbilityActor, S extends AbilitySpec> = AbilityReach<T> & {
	pressed(ability: S): boolean;
	used(ability: S): void;
	players(): T[];
	hit(target: T, ability: S): void;
	hook(target: T, ability: S, players: T[]): void;
};

export function useAbilities<T extends AbilityActor, S extends AbilitySpec>(
	user: T,
	stamp: number,
	specs: readonly S[],
	use: AbilityUse<T, S>,
): void;

export function endStatuses<T extends AbilityActor>(
	actors: readonly T[],
	stamp: number,
	grace: number,
	back: (actor: T) => void,
): void;

/** A zone force rule: `arcade.forces` or an `arcade.online.rules.zones` entry with a force. */
export type ZoneForceRule = {
	zone: string;
	force?: { x: number; y: number };
	characters?: readonly string[];
};

export type ZoneForce = {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
	fx: number;
	fy: number;
	characters?: readonly string[];
};

export function zoneForces(
	zones: readonly { id: string; x: number; y: number; w: number; h: number }[] | undefined,
	rules: readonly ZoneForceRule[] | undefined,
	options?: {
		character?: string;
		clip?(zone: {
			id: string;
			x: number;
			y: number;
			w: number;
			h: number;
		}): { id: string; x: number; y: number; w: number; h: number } | undefined;
		cell?: number;
	},
): StaticIndex<ZoneForce>;

export function addZoneForces(body: Body, forces: StaticIndex<ZoneForce>, character?: string): void;
