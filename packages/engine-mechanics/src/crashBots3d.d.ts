/**
 * Types for the Crash bot's brain (`crashBots3d.js`, `docs/design/3d/gameplay-evaluation.md` §3).
 * Pinned by `scripts/check-bots-3d.mjs`.
 */

import type { Rng } from './board';
import type { Body3d, Level3d, Motion3dSpec } from './motion3d';
import type { NavGrid3d, PathFollower3d } from './nav3d';
import type { CrashBotPart, Input3d, World3dBots } from './online3d';

export type CrashWeights = Record<'fight' | 'carry' | 'escort' | 'intercept' | 'wander', number>;
export type CrashBotOptions = Readonly<
	Required<Omit<CrashBotPart, 'weights'>> & { carry: boolean; weights: Readonly<CrashWeights> }
>;
export declare const CRASH_BOT_DEFAULTS: CrashBotOptions;
export type CrashGoal = 'wander' | 'fight' | 'carry' | 'score' | 'escort' | 'intercept';
export declare const CRASH_GOALS: readonly CrashGoal[];

export declare function crashOptionsFor(
	base: NonNullable<World3dBots['crash']> | undefined,
	characterId: string,
): CrashBotOptions;

export type CrashBot3d = {
	options: CrashBotOptions;
	rng: Rng;
	follower: PathFollower3d;
	seq: number;
	blocked: boolean;
	goal: { kind: CrashGoal; id?: string } | null;
	planned: { x: number; z: number } | null;
	plannedAt: number;
	swing: boolean;
	grab: boolean;
	jumpHeld: boolean;
	steps: number;
};
export declare function createCrashBot3d(options: {
	seed: number;
	options?: CrashBotOptions;
}): CrashBot3d;

/** A room player as the Crash brain sees it. */
export type CrashSeen3d = {
	id: string;
	body: Body3d;
	team: number;
	connected: boolean;
	status: number;
};
/** A piece (or a corpse) on the field; `carrier` is the carrying player's id. */
export type CrashPiece3d = { id: string; x: number; y: number; z: number; carrier: string | null };
export type CrashSituation3d = {
	players: Iterable<CrashSeen3d>;
	pieces?: readonly CrashPiece3d[];
	pit?: { x: number; y: number; z: number } | null;
};

export declare function crashBotInput3d(
	bot: CrashBot3d,
	self: CrashSeen3d,
	situation: CrashSituation3d,
	options: {
		nav: NavGrid3d;
		level: Level3d;
		dt: number;
		spec: Readonly<Motion3dSpec>;
		view: number;
	},
): Input3d;
