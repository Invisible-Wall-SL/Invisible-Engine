import type { ReelAnticipationArming } from 'utils-slots';

/**
 * THE LUCKY SPIN'S REVEAL HOOK (design §1.3 `luckySpin`) — a server-announced base spin that
 * guarantees the feature. Its `luckySpin` book event arrives BEFORE the base `reveal`, and the beat
 * that presents it (`presentLuckySpin`) arms this ONE-SHOT; the next `reveal` reads it twice:
 *
 *  - at its dispatch (`unskippablePresentation.ts`), so that reveal runs unskippable and the spin
 *    button is inert for the whole roll — the player watches it land;
 *  - in `presentReveal`, which takes it (clearing it whatever the board) and arms anticipation on
 *    every reel instead of the client-computed reach (`luckySpinArming`).
 *
 * Explicit rather than faked: no scatter is invented and the reach maths is not touched. A game that
 * never receives a `luckySpin` never arms it, so every reveal reads `false` and takes the old path.
 */
let armed = false;

export const armLuckySpinReveal = (): void => {
	armed = true;
};

/** A new round starts clean: a round that threw between `luckySpin` and its `reveal`, or a flow whose
 *  `reveal` never runs `revealBoard`, must not leave every later reveal unskippable. */
export const resetLuckySpinReveal = (): void => {
	armed = false;
};

/** Is the next `reveal` the Lucky Spin's? Read-only — the reveal itself takes it. */
export const luckySpinRevealArmed = (): boolean => armed;

/** Take the one-shot: true once, for the reveal that follows a Lucky Spin intro. */
export const takeLuckySpinReveal = (): boolean => {
	const was = armed;
	armed = false;
	return was;
};

/**
 * Anticipation on every reel that has one before it to wait on (the first reel starts the roll), at
 * level 1 with the lowest big tier's alias — the same arming the reach would give its first tier, so
 * the authored anticipation FX and hold play as they do for any tease.
 */
export const luckySpinArming =
	(tier: string | null) =>
	(reelIndex: number): ReelAnticipationArming | null =>
		reelIndex > 0 ? { level: 1, tier } : null;
