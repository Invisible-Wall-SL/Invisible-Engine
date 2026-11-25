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
	/** A caught player's Respawn, or a pick in the lobby: `1 +` the index of the character it
	 *  picked in `arcade.online.characters`, 0 or absent for none. */
	respawn?: number;
	/** What the device's screen shows about its own player (`shown.js` `shownOf`): two sizes in
	 *  whole px and a `SHOWN_SHAPE`. All 0, or absent: nothing. Never read by the step. */
	shownW?: number;
	shownH?: number;
	shownIso?: number;
};

export type StepContext = { dt: number; subSteps: number; subDt: number };

export const MOVE_SCALE: 127;
export const RESPAWN_MAX: 16;
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
export type OnlineLevel = {
	currents: StaticIndex<OnlineCurrent>;
	/** Absent ⇒ none. */
	solids?: StaticIndex<OnlineSolid>;
	/** The game's slide (`arcade.online.slide`). Absent ⇒ a player stops at a solid's corner. */
	slide?: Slide;
};

/** The side a one-way solid stops a body coming from; `true` = every side. */
export type OnlineSolidSide = true | 'below' | 'above' | 'left' | 'right';

/** A solid: a zone that stops a moving player, from every side or only from one (P11.3). */
export type OnlineSolid = StaticShape & {
	from: 'any' | 'below' | 'above' | 'left' | 'right';
	box: { x0: number; y0: number; x1: number; y1: number };
	body: Body & { solid: true };
};

export function stepPlayer<B extends Body>(
	body: B,
	input: OnlineInput | undefined,
	speed: number,
	ctx: StepContext,
	field?: Field,
	level?: OnlineLevel,
): B;
/** What a player carries (Salmons' leap): `air` inputs left to carry `carryX` / `carryY` for. */
export type MoveCarry = { air?: number; carryX?: number; carryY?: number };

/** The input a player carrying a move is stepped with; spends one of `carry.air` (mutated). */
export function carriedInput<I extends OnlineInput | undefined>(carry: MoveCarry, input: I): I;
export function moveAgainstSolids<B extends Body>(
	body: B,
	dt: number,
	solids: StaticIndex<OnlineSolid>,
	field?: Field,
	slide?: Slide,
): B;
export function onlineLevel(
	zones: readonly StaticShape[] | undefined,
	rules:
		| readonly {
				zone: string;
				force?: { x: number; y: number };
				solid?: OnlineSolidSide;
				characters?: string[];
		  }[]
		| undefined,
	character: string,
	field: Field,
	slide?: Slide,
): OnlineLevel;
/** A zone held to the field; `undefined` when none of it is on it. */
export function clipToField<Z extends StaticShape>(zone: Z, field: Field): Z | undefined;
/** The grid cell a level of this field is indexed in. */
export function levelCell(field: Field): number;
export function facingOf(input: OnlineInput | undefined, previous?: number): number;
/** The longest name a room keeps, in characters. */
export const NAME_LENGTH: 24;
export function cleanName(raw: unknown): string;
/** What a join carries besides its game: a name, a character and a winner's pass. */
export type LaunchJoin = { name?: string; character?: string; pass?: string };
/** What a launch joins as (`carried` wins over the launch's own), and whether its person must pick
 *  a character on the game's start menu before the device joins any room. */
export function launchJoin(
	carried: LaunchJoin,
	launch: { name?: string | null; character?: string | null },
	hasMenu: boolean,
): { join: LaunchJoin; choose: boolean };
/** What a person asks to play as, on its device (a caught person's Respawn, a pick in the lobby):
 *  sent as inputs' `respawn` until the room acknowledges one, and answered by the state that does. */
export type RespawnAsk = {
	/** The person pressed the character `respawn` counts (`1 +` its index). */
	press(respawn: number): void;
	/** The `respawn` input `seq` carries: the ask while it waits for its answer, else 0. A press
	 *  right after inputs that asked for the same first sends one that asks for nothing. */
	input(seq: number): number;
	/** A state of a room that takes the ask: the newest input it applied for the own player, and
	 *  the character it has the player as (counted as `respawn` is; 0: none, it is out). */
	answer(ack: number, playing: number): void;
	/** The room no longer takes it: the ask is forgotten. */
	drop(): void;
	/** The room answered the last press with something else: no place was left. */
	readonly refused: boolean;
	/** What it holds, or `null` (the probe's). */
	held(): { respawn: number; from: number; refused: boolean } | null;
};
export function createRespawnAsk(): RespawnAsk;
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
