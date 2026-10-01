/**
 * THE HOLD AND WIN BANNER — the coded default for the beats that announce something over the board:
 * the Lucky Spin intro, a jackpot celebration (large) and a coin jackpot during the tally (small).
 * Drawn by `HoldAndWinBanner.svelte`; Phase 6 gives these their authored screens and Phase 8 their
 * copy, so the text here is English literals like the other Hold and Win toasts.
 *
 * One banner at a time: a new one replaces the last, and hiding names the banner it hides, so a beat
 * that ends late cannot take down the next beat's banner.
 */
export type HoldAndWinBannerView = {
	id: number;
	/** Which beat put it up — what the authored `luckySpin` / `jackpotWin` screens gate on
	 *  (`luckySpinShow`, `jackpotWinShow`). */
	kind: 'luckySpin' | 'jackpot' | 'coinJackpot' | 'instantWin' | 'wheelPrize';
	title: string;
	detail?: string;
	size: 'large' | 'small';
};

export const stateHoldAndWinBanner = $state({ current: null as HoldAndWinBannerView | null });

let nextId = 1;

/** Put a banner up; returns its id for {@link hideHoldAndWinBanner}. */
export const showHoldAndWinBanner = (banner: Omit<HoldAndWinBannerView, 'id'>): number => {
	const id = nextId++;
	stateHoldAndWinBanner.current = { ...banner, id };
	return id;
};

export const hideHoldAndWinBanner = (id: number): void => {
	if (stateHoldAndWinBanner.current?.id === id) stateHoldAndWinBanner.current = null;
};
