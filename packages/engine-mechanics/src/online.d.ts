/**
 * Types for online arcade rooms (`online.js`, `docs/design/realtime-multiplayer.md` §5, §6). The
 * behaviour is pinned by `scripts/check-room-sim.mjs`.
 */

import type { Body, BodyEdges, Field, StaticIndex, StaticShape } from './motion';

/** What a device sends, once per fixed step. Nothing else ever reaches the server. */
export type OnlineInput = {
	/** Increases by one per step the device samples; the server drops a repeated or older one. */
	seq: number;
	/** -127..127, the move's length at most 127. */
	moveX: number;
	moveY: number;
	/** {@link BUTTONS} bits. */
	buttons: number;
	/** A point on the field. */
	aimX: number;
	aimY: number;
	/** The room step the device was drawing everyone else at. */
	view: number;
};

export type StepContext = { dt: number; subSteps: number; subDt: number };

export const MOVE_SCALE: 127;
export const BUTTONS: Readonly<{ jump: 1; ability1: 2; ability2: 4 }>;

export function sanitizeInput<I extends Partial<OnlineInput>>(
	input: I,
	field?: Field,
): I & OnlineInput;
export function clampInput(raw: unknown, field?: Field): OnlineInput;
export function stepContext(tickHz: number, subSteps?: number): StepContext;
/** A current: a zone that pushes a moving player by `fx` / `fy` px/s. */
export type OnlineCurrent = StaticShape & { fx: number; fy: number };

/** What of a level moves one character's players. */
export type OnlineLevel = { currents: StaticIndex<OnlineCurrent> };

export function stepPlayer<B extends Body>(
	body: B,
	input: OnlineInput | undefined,
	speed: number,
	ctx: StepContext,
	field?: Field,
	level?: OnlineLevel,
): B;
export function onlineLevel(
	zones: readonly StaticShape[] | undefined,
	rules:
		| readonly { zone: string; force?: { x: number; y: number }; characters?: string[] }[]
		| undefined,
	character: string,
	field: Field,
): OnlineLevel;
/** A zone held to the field; `undefined` when none of it is on it. */
export function clipToField<Z extends StaticShape>(zone: Z, field: Field): Z | undefined;
/** The grid cell a level of this field is indexed in. */
export function levelCell(field: Field): number;
export function facingOf(input: OnlineInput | undefined, previous?: number): number;
export function cleanName(raw: unknown): string;
export function characterBody(
	id: string,
	spec:
		| (({ shape: 'box'; w: number; h: number } | { shape: 'circle'; r: number }) & {
				tags?: string[];
				edges?: BodyEdges;
		  })
		| undefined,
	at: { x: number; y: number },
): Body;
