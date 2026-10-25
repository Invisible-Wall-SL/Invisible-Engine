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
export type MechanicId = 'reels' | 'match3' | 'arcade';

export interface GameMechanic {
	id: MechanicId;
	/** Who decides a round (§2): the RGS, or the game's own rules (free play, no wallet). */
	outcome: GameOutcome;
	/** The reels spin: the pre-spin roll on a bet, the Space spin hotkey and hold-to-spin. */
	spins: boolean;
	/** A bet opens a round on the RGS: the round machine runs (bet → book → end), and the wager
	 *  intents and the coded HUD reach it. */
	bets: boolean;
	/** A round stays open across player-paced requests (§2.2): the bet's book deals a board, each
	 *  move is a request of its own, and the server ends the round. No autoplay, no bonus buy. */
	interactiveRound: boolean;
	/** The runtime opens an RGS session: authenticate, the balance heartbeat, bets. */
	rgsSession: boolean;
	/** The bet and balance parts of the HUD are shown. */
	wallet: boolean;
	/** The board takes the pointer: a cell hit-test, selection and swaps. */
	boardInput: boolean;
	/** The game is a play field (§4.2): `<ArcadeStage />` and its loop stand in for the reel stack. */
	playField: boolean;
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
	bets: true,
	interactiveRound: false,
	rgsSession: true,
	wallet: true,
	boardInput: false,
	playField: false,
	bookEvents: [],
});

/** A rules-decided match-3 game (§2.3): the board never spins, nothing reaches an RGS. */
export const MATCH3_RULES_MECHANIC: GameMechanic = Object.freeze({
	id: 'match3',
	outcome: 'rules',
	spins: false,
	bets: false,
	interactiveRound: false,
	rgsSession: false,
	wallet: false,
	boardInput: true,
	playField: false,
	bookEvents: [],
});

/** An RGS-decided match-3 game (§2.2): the bet deals the board, each swap is a `move` request, and
 *  the server ends the round. The board never spins. */
export const MATCH3_RGS_MECHANIC: GameMechanic = Object.freeze({
	id: 'match3',
	outcome: 'rgs',
	spins: false,
	bets: true,
	interactiveRound: true,
	rgsSession: true,
	wallet: true,
	boardInput: true,
	playField: false,
	bookEvents: ['boardInit', 'swap', 'movesLeft', 'match3RoundEnd'],
});

/** A rules-decided arcade game (§4.2): a play field of moving bodies; no reels, no RGS, no wallet. */
export const ARCADE_RULES_MECHANIC: GameMechanic = Object.freeze({
	id: 'arcade',
	outcome: 'rules',
	spins: false,
	bets: false,
	interactiveRound: false,
	rgsSession: false,
	wallet: false,
	boardInput: false,
	playField: true,
	bookEvents: [],
});

/**
 * The mechanic a config plays as. An arcade game is decided by its rules (an RGS-decided one is the
 * optional P10.10, and the config validator refuses it), so an arcade config that says otherwise is
 * `unplayable` and the boot refuses it.
 */
export function mechanicFor(doc: GameConfigDoc | null | undefined): GameMechanic {
	const family = resolveFamily(doc);
	if (family === 'match3')
		return resolveOutcome(doc) === 'rules' ? MATCH3_RULES_MECHANIC : MATCH3_RGS_MECHANIC;
	if (family === 'arcade')
		return resolveOutcome(doc) === 'rules'
			? ARCADE_RULES_MECHANIC
			: {
					...ARCADE_RULES_MECHANIC,
					outcome: 'rgs',
					unplayable: 'an arcade game decided by the RGS is not built yet (P10.10)',
				};
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

/** The wager intents that chain or buy rounds, which a round waiting on the player cannot take. */
export const CONTINUOUS_INTENTS: readonly string[] = Object.freeze(['autoSpin', 'buyBonus']);

/**
 * Whether the runtime runs a HUD intent for this mechanic. A mechanic with no bet has no round to
 * bet on, so an authored Spin button or a flow's `startSpin` is a no-op rather than a bet a
 * free-play game must never send; an interactive round takes a bet but no autoplay or bonus buy.
 * Every intent runs for a slot.
 */
export const runsIntent = (mechanic: GameMechanic, intent: string): boolean => {
	if (!mechanic.bets) return !WAGER_INTENTS.includes(intent);
	return !mechanic.interactiveRound || !CONTINUOUS_INTENTS.includes(intent);
};
