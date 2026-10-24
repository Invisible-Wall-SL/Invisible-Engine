import { resolveFamily, resolveOutcome, type GameConfigDoc, type GameOutcome } from 'game-config';

/**
 * THE MECHANIC CONTRACT, declared once (`docs/design/game-type-templates.md` Phase B; game-families
 * §4.0). Phase A discovered the seam one factory `deps` object at a time, which was fine while
 * `reels` was the only mechanic. Match-3 is the second, so the shared runtime now asks ONE question
 * of the config — which mechanic plays it — and reads every family branch off the answer rather than
 * off the family or outcome fields themselves.
 *
 * A mechanic is the part of a game type that is code: what drives the board and where a round's
 * results come from. Everything else (scenes, components, symbols, Flow) is data the shared runtime
 * already plays for every type.
 */
export type MechanicId = 'reels' | 'match3';

export interface GameMechanic {
	id: MechanicId;
	/** Who decides a round (§2): the RGS, or the game's own rules (free play, no wallet). */
	outcome: GameOutcome;
	/** The round machine runs: bet → spin → book → idle. */
	spins: boolean;
	/** The runtime opens an RGS session: authenticate, the balance heartbeat, bets. */
	rgsSession: boolean;
	/** The bet and balance parts of the HUD are shown. */
	wallet: boolean;
	/** The board takes the pointer: a cell hit-test, selection and swaps. */
	boardInput: boolean;
	/** The book events the mechanic adds to the shared runtime's union. */
	bookEvents: readonly string[];
	/** Why the runtime cannot play this mechanic yet, or `undefined` when it can. */
	unplayable?: string;
}

/** Every slot kind: the reels spin, and the RGS decides every round. */
export const REELS_MECHANIC: GameMechanic = Object.freeze({
	id: 'reels',
	outcome: 'rgs',
	spins: true,
	rgsSession: true,
	wallet: true,
	boardInput: false,
	bookEvents: [],
});

/** A rules-decided match-3 game (§2.3): the board never spins, nothing reaches an RGS. */
export const MATCH3_RULES_MECHANIC: GameMechanic = Object.freeze({
	id: 'match3',
	outcome: 'rules',
	spins: false,
	rgsSession: false,
	wallet: false,
	boardInput: true,
	bookEvents: [],
});

/** An RGS-decided match-3 game (§2.2). Its interactive round and `move` request are P10.6. */
export const MATCH3_RGS_MECHANIC: GameMechanic = Object.freeze({
	id: 'match3',
	outcome: 'rgs',
	spins: false,
	rgsSession: true,
	wallet: true,
	boardInput: true,
	bookEvents: ['boardInit', 'swap', 'movesLeft', 'roundEnd'],
	unplayable: 'a match-3 game whose results come from the RGS needs its interactive round (P10.6)',
});

/**
 * The mechanic a config plays as. An arcade config (P10.8) has none yet, and the publish gate never
 * lets one reach the runtime; it is played as `reels`, with `unplayable` set so the boot refuses it.
 */
export function mechanicFor(doc: GameConfigDoc | null | undefined): GameMechanic {
	const family = resolveFamily(doc);
	if (family === 'match3')
		return resolveOutcome(doc) === 'rules' ? MATCH3_RULES_MECHANIC : MATCH3_RGS_MECHANIC;
	if (family === 'arcade')
		return { ...REELS_MECHANIC, unplayable: 'the runtime cannot play an arcade game yet (P10.8)' };
	return REELS_MECHANIC;
}

/** The HUD intents that stake money or change the stake: a bet, auto-play, a bonus buy, the bet
 *  steps. */
export const WAGER_INTENTS: readonly string[] = Object.freeze([
	'spin',
	'autoSpin',
	'buyBonus',
	'increase',
	'decrease',
]);

/**
 * Whether the runtime runs a HUD intent for this mechanic. A mechanic that never spins has no
 * round to bet on, so an authored Spin button or a flow's `startSpin` is a no-op rather than a bet
 * a free-play game must never send. Every intent runs for a slot.
 */
export const runsIntent = (mechanic: GameMechanic, intent: string): boolean =>
	mechanic.spins || !WAGER_INTENTS.includes(intent);
