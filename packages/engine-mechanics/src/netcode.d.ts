/**
 * Types for online netcode (`netcode.js`, `docs/design/realtime-multiplayer.md` §6). The behaviour
 * is pinned by `scripts/check-netcode.mjs`.
 */

import type { Body, Field } from './motion';
import type { OnlineInput, OnlineLevel, StepContext } from './online';

/** A zone rule as `strongestForce` reads it. */
type ForceRule = { force?: { x: number; y: number } };

export const MATCH_PX: number;
export const SMOOTH_MS: 100;
export const SNAP_PX: 128;
export function snapFor(speed: number, patchHz: number): number;
export const INTERPOLATION_DELAY_MS: 100;
export const MAX_RATE: 0.25;
export const MAX_SLOW: 0.1;

/** The room's word on the predicted player. */
export type PredictorTruth = { x: number; y: number; ack: number; still?: boolean; step?: number };

export type Predictor = {
	readonly body: Body;
	/** Inputs sent and not yet acknowledged. */
	readonly pending: number;
	/** States that disagreed with the prediction. */
	readonly corrections: number;
	/** Corrections too long to fade, drawn at once. */
	readonly snaps: number;
	input(input: OnlineInput): void;
	reconcile(truth: PredictorTruth): 'stale' | 'match' | 'corrected';
	frame(dtMs: number): void;
	drawn(alpha?: number): { x: number; y: number };
};

export function createPredictor(options: {
	body: Body;
	speed: number;
	ctx: StepContext;
	field?: Field;
	level?: OnlineLevel;
	/** The input the body's place follows. Default 0, before any. */
	ack?: number;
	smoothMs?: number;
	snapPx?: number;
}): Predictor;

export type SnapshotClock = {
	readonly newest: number;
	observe(step: number, nowMs: number): void;
	advance(nowMs: number): number | undefined;
};

export function createSnapshotClock(options: {
	stepMs: number;
	delayMs?: number;
	maxRate?: number;
	maxSlow?: number;
}): SnapshotClock;

export type Interpolator = {
	push(id: string, step: number, x: number, y: number): void;
	retain(ids: ReadonlySet<string>): void;
	at(id: string, step: number): { x: number; y: number } | undefined;
};

export function createInterpolator(options?: { snapPx?: number; keep?: number }): Interpolator;

export const RECONCILED_FIELDS: readonly ['x', 'y', 'status'];

/** The state the Colyseus SDK's `Reconciler` hands {@link reconcilerStep}: {@link RECONCILED_FIELDS}. */
export type ReconciledState = { x: number; y: number; status: number };

export function reconcilerStep(options: {
	body: Body;
	speed: number;
	ctx: StepContext;
	field?: Field;
	level?: OnlineLevel;
}): (sdk: unknown, state: ReconciledState, command: OnlineInput) => void;

export function strongestForce(zoneRules: readonly ForceRule[]): number;

/** An online game as {@link reconcilerOptions} reads it (game-config `OnlineGame`). */
export type ReconcilerGame = {
	field: Field;
	bodies: Record<string, unknown>;
	zones: unknown[];
	online: {
		characters: readonly { id: string; body: string; speed: number }[];
		tickHz: number;
		subSteps: number;
		patchHz: number;
		rules: { zones: readonly (ForceRule & { zone: string; characters?: string[] })[] };
	};
};

export function reconcilerOptions(
	game: ReconcilerGame,
	id: string,
	player: { character: string; x: number; y: number },
):
	| {
			fields: typeof RECONCILED_FIELDS;
			step: (sdk: unknown, state: ReconciledState, command: OnlineInput) => void;
			snap: number;
	  }
	| undefined;
