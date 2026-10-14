import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';

/**
 * THE STAKE UNDER A PLAYER-PICKED LINE COUNT (`docs/design/hold-and-win-coin-board.md` §1.3), kept
 * pure so its fixture runs offline. The bet ladder is the bet PER LINE. The stake the game holds is
 * the TOTAL, lines × bet per line (`stateBet.betAmount`): what the HUD shows, what the balance is
 * checked against, and what every win and big-win threshold is read against. Amounts snap to the
 * ladder's own grain (the RGS API unit), so `0.1 × 3` is 0.3 and the facade's
 * `[lines, round(total / lines)]` sends the exact rung back.
 */

const exact = (amount: number): number =>
	Math.round(amount * API_AMOUNT_MULTIPLIER) / API_AMOUNT_MULTIPLIER;

/** The total stake: the lines played × the bet per line. */
export const coinBoardStake = (betPerLine: number, lines: number): number =>
	exact(betPerLine * lines);

/** The bet per line a total stake buys at a line count. */
export const coinBoardBetPerLine = (stake: number, lines: number): number =>
	exact(stake / Math.max(1, lines));

/** The total-stake ladder at a line count, from the per-line ladder. */
export const coinBoardLadder = (perLine: readonly number[], lines: number): number[] =>
	perLine.map((level) => coinBoardStake(level, lines));

/** The choice one step up (`1`) or down (`-1`) from `current`, or `undefined` at either end. */
export const coinBoardStepLines = (
	choices: readonly number[],
	current: number,
	step: 1 | -1,
): number | undefined => {
	const sorted = [...choices].sort((a, b) => a - b);
	return step === 1
		? sorted.find((count) => count > current)
		: sorted.reverse().find((count) => count < current);
};

/** The line count a resumed round was staked on: its base reveal's `paylineIds`, when that count is
 *  one of the choices. */
export const coinBoardResumedLines = (
	state: readonly unknown[] | undefined,
	choices: readonly number[],
): number | undefined => {
	const reveal = state?.find(
		(event): event is { paylineIds: unknown[] } =>
			(event as { type?: unknown }).type === 'reveal' &&
			Array.isArray((event as { paylineIds?: unknown }).paylineIds),
	);
	const count = reveal?.paylineIds.length;
	return count !== undefined && choices.includes(count) ? count : undefined;
};
