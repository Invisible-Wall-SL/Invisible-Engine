/**
 * Types for the card AI (`cardAi.js`, `docs/design/card-games.md` §4). The module is plain JS — see
 * the package's `index.ts` for why — so its contract is declared here. The behaviour is pinned by
 * `scripts/check-card-ai.mjs`.
 */

import type { Action, CardEvent, CardRulesInput, DeckList, Match, Side } from './cards.js';

export type AiDifficulty = 'easy' | 'normal' | 'hard';

/** The evaluation's weights (§4.1). `win` is added for a won match and taken off for a lost one. */
export interface AiWeights {
	/** My hero's health − the enemy hero's. */
	health: number;
	/** My board's attack + remaining health − the enemy's. */
	board: number;
	/** My `guard` and `shield` keywords on the board − the enemy's. */
	keyword: number;
	/** Cards in my hand − in the enemy's. */
	hand: number;
	win: number;
}

export interface AiSettings {
	difficulty: AiDifficulty;
	/** The chance, per decision, of a random legal action instead of the best. */
	mistakes: number;
	/** Looks for a win in `combat` first. */
	lethal: boolean;
	/** Plans whole sequences of plays in `main`. */
	plan: boolean;
	weights: AiWeights;
}

/** The AI for one side: its settings and its own stream, as a value it returns a new copy of. */
export interface CardAi {
	side: Side;
	settings: AiSettings;
	rngState: number;
}

/** One AI seat in a replay record: a difficulty and its deck's weight overrides. */
export interface AiSeat {
	side: Side;
	difficulty?: AiDifficulty;
	weights?: Partial<AiWeights>;
}

export const AI_WEIGHT_DEFAULTS: Readonly<AiWeights>;
export const AI_DIFFICULTIES: Readonly<
	Record<
		AiDifficulty,
		{ mistakes: number; lethal: boolean; plan: boolean; weights: Partial<AiWeights> }
	>
>;
export const PLAN_WIDTH: number;
export const PLAN_DEPTH: number;
/** Every `apply` one decision may make. */
export const MAX_PLAN_APPLIES: number;
/** The part of that budget the lethal search may spend. */
export const MAX_LETHAL_APPLIES: number;

/** The defaults, then the preset's weights, then `weights`. Only known weights are read; one that
 *  is not a finite number throws, as does an unknown difficulty. `difficulty` defaults to normal. */
export function aiSettings(options?: {
	difficulty?: AiDifficulty;
	weights?: Partial<AiWeights>;
}): AiSettings;

/** Its stream is seeded from `${seed}:ai:${side}`, never the match's. */
export function createAi(options: {
	seed: string | number;
	side: Side;
	difficulty?: AiDifficulty;
	weights?: Partial<AiWeights>;
}): CardAi;

/** How good the match is for `side`; units count as they will be once `endOfTurn` buffs lapse. */
export function evaluate(match: Match, side: Side, weights?: Partial<AiWeights>): number;

/** The AI's next action; the match must wait on its side. Never changes `match` or `ai`, never
 *  concedes; `applies` is the decision's `apply` count, at most {@link MAX_PLAN_APPLIES}. */
export function chooseAction(
	ai: CardAi,
	match: Match,
): { action: Action; ai: CardAi; applies: number };

/** A match played from its record: `ai` seats one or two AIs, `actions` are the other side's. Stops
 *  at the end or when the actions run out on their turn; throws on actions the match never reached. */
export function replayMatch(record: {
	seed: string | number;
	decks: readonly [DeckList, DeckList];
	library: readonly unknown[];
	rules?: CardRulesInput;
	first?: Side | 'random';
	ai: readonly AiSeat[];
	actions?: readonly Action[];
}): { match: Match; events: CardEvent[]; log: { side: Side; action: Action }[] };
