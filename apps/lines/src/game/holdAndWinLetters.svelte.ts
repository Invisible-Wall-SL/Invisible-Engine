import { getActiveGameConfig } from './gameConfig';
import { stateHoldAndWin } from './stateHoldAndWin.svelte';

/**
 * THE COLUMN LETTERS (design §1.2 Grand: "G-R-A-N-D letters") as this game shows them — one letter
 * per reel from the Game Config's `boardEnd.letters`, lit when its column completed.
 *
 * What is lit is the SERVER's (`stateHoldAndWin.lettersLit`, recorded at the play seam). What the row
 * DRAWS is a copy, taken where a beat says so, for the two reasons the held layer is a copy: the
 * letter must light on its own beat (the play seam has already recorded it when the beat starts),
 * and the feature's end clears the picture while the board still shows what it paid.
 */

/** The letter per reel, or none when the board end is not column letters. */
export const configuredLetters = (): string[] => {
	const end = getActiveGameConfig().holdAndWin?.boardEnd;
	return end?.type === 'columnLetters' ? [...end.letters] : [];
};

export const stateLetters = $state({
	/** The reels whose letter the row draws lit. */
	lit: [] as number[],
	/** Bumped per reel when its letter lights (or a lit column completes again), so it pulses. */
	pulses: {} as Record<number, number>,
});

/** Draw what the server has lit — at a feature's entry, and on every snapshot. */
export const syncLetters = () => {
	stateLetters.lit = [...stateHoldAndWin.lettersLit];
};

/** Light one letter (and pulse it) — the column-complete beat's moment. */
export const lightLetter = (reel: number) => {
	if (!stateLetters.lit.includes(reel)) stateLetters.lit = [...stateLetters.lit, reel];
	stateLetters.pulses[reel] = (stateLetters.pulses[reel] ?? 0) + 1;
};
