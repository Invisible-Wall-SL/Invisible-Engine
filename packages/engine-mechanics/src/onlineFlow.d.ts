/**
 * Types for what an online room gives a device's Flow (`onlineFlow.js`, P11.2). The behaviour is
 * pinned by `scripts/check-online-rules.mjs` and `scripts/check-netcode.mjs`.
 */

import type { OnlineEvent } from './onlineRules';

export const ONLINE_FLOW_EVENTS: Readonly<{
	joined: 'playerJoined';
	left: 'playerLeft';
	hit: 'hit';
	caught: 'caught';
	roundStart: 'roundStart';
	roundEnd: 'roundEnd';
	ability: 'ability';
}>;

export type ServerValueKind = 'number' | 'string' | 'bool';
export const SERVER_VALUE_KINDS: Readonly<Record<keyof ServerValues, ServerValueKind>>;

/** One Flow signal: its event name and payload. */
export type OnlineFlowSignal = { name: string; payload: Record<string, unknown> };

/** A player as drawn: where, and which character. */
type Drawn = { x: number; y: number; character?: string };

export function abilitySignal(
	by: string,
	button: string,
	me: string,
	at: Drawn | undefined,
	predicted: boolean,
): OnlineFlowSignal;

export function flowSignalsOf(
	events: readonly OnlineEvent[],
	me: string,
	at?: (id: string) => Drawn | undefined,
	predictor?: AbilityPredictor,
): OnlineFlowSignal[];

export type ServerValues = {
	score: number;
	status: 'free' | 'stunned' | 'out' | 'grounded' | 'hooked';
	round: number;
	phase: string;
	secondsLeft: number;
	winner: string;
	won: boolean;
};

/** The part of the room's synced state the values are read from. */
export type ServerValuesState = {
	step?: number;
	phase?: string;
	round?: number;
	endsAt?: number;
	winner?: string;
	players?: { get(id: string): { score: number; status: number } | undefined };
};

export function serverValuesOf(state: ServerValuesState, me: string, tickHz: number): ServerValues;

export function shownInRoom(player: { status: number }): boolean;

export type AbilityPredictor = {
	/** One sent input's buttons; `free` when the round runs and the own player is free; `seq` the
	 *  input's (default: one after the last). Returns the buttons of the abilities it uses. */
	step(buttons: number, free: boolean, seq?: number): string[];
	/** The room's `ability` on `button` for the own player came: whether it answers a press
	 *  already raised. */
	echo(button: string): boolean;
	/** A state acknowledged the own inputs up to `ack`: presses still unanswered a state later
	 *  were refused, and are dropped. */
	acked(ack: number): void;
	/** The room cleared the player's cooldowns: those set by inputs it had taken by then, but not
	 *  by a press still waiting for its echo. */
	reset(): void;
};

export function createAbilityPredictor(
	game: {
		online: {
			tickHz: number;
			rules: {
				abilities: readonly { character: string; button: string; cooldownMs: number }[];
			};
		};
	},
	character: string,
): AbilityPredictor;
