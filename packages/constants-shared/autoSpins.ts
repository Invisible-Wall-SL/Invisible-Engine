/**
 * AUTOPLAY option vocabulary — the three ladders an auto-spin menu offers (round count, loss limit,
 * single-win limit) and the numbers each option means.
 *
 * They live HERE, not in `state-shared`, because they are constants rather than state and several
 * consumers need them without the runes state they used to sit beside: the game's HTML modal, the
 * engine repeater sources that feed an AUTHORED auto-spin screen, and the launcher editor's canvas,
 * which draws the tile grid an author is laying out and can't import a `.svelte.ts` module on the
 * server. `state-shared` re-exports every name below, so nothing that imported them from there had
 * to change.
 *
 * Each ladder is TEXT: the option label is the stored value and the list key, and the paired map
 * turns it into a number. `∞` is a real option in all three, mapping to `Infinity` — which is why
 * the text, not the number, is what gets stored and passed around.
 */

export const INFINITY_MARK = '∞';

export const AUTO_SPINS_TEXT_OPTIONS = [
	'10',
	'25',
	'50',
	'75',
	'100',
	'250',
	'500',
	'1000',
	INFINITY_MARK,
] as const;
export type AutoSpinsText = (typeof AUTO_SPINS_TEXT_OPTIONS)[number];
export const AUTO_SPINS_TEXT_OPTION_MAP: Record<AutoSpinsText, number> = {
	'10': 10,
	'25': 25,
	'50': 50,
	'75': 75,
	'100': 100,
	'250': 250,
	'500': 500,
	'1000': 1000,
	[INFINITY_MARK]: Infinity,
};

export const LOSS_LIMIT_TEXT_OPTIONS = ['5×', '10×', '25×', '50×', '100×', INFINITY_MARK] as const;
export type LossLimitText = (typeof LOSS_LIMIT_TEXT_OPTIONS)[number];
export const AUTO_SPINS_LOSS_LIMIT_MULTIPLIER_MAP: Record<LossLimitText, number> = {
	'5×': 5,
	'10×': 10,
	'25×': 25,
	'50×': 50,
	'100×': 100,
	[INFINITY_MARK]: Infinity,
};

export const SINGLE_WIN_LIMIT_TEXT_OPTIONS = [
	'5×',
	'10×',
	'25×',
	'50×',
	'100×',
	INFINITY_MARK,
] as const;
export type SingleWinLimitText = (typeof SINGLE_WIN_LIMIT_TEXT_OPTIONS)[number];
export const AUTO_SPINS_SINGLE_WIN_LIMIT_MULTIPLIER_MAP: Record<SingleWinLimitText, number> = {
	'5×': 5,
	'10×': 10,
	'25×': 25,
	'50×': 50,
	'100×': 100,
	[INFINITY_MARK]: Infinity,
};
