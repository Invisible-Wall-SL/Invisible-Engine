/**
 * THE HOLD AND WIN BANNER — the coded default for the beats that announce something over the board:
 * the Lucky Spin intro, a random metre, a pot filling, the feature's intro / total / outro, a jackpot
 * celebration and a coin jackpot during the tally. Drawn by `HoldAndWinBanner.svelte`; the copy is
 * the project's Win Text (the metre's name is the Game Config's).
 *
 * One banner at a time: a new one replaces the last, and hiding names the banner it hides, so a beat
 * that ends late cannot take down the next beat's banner.
 */
export type HoldAndWinBannerView = {
	id: number;
	/** Which beat put it up — what an authored screen for that beat steps it aside on
	 *  (`HOLD_AND_WIN_BANNER_SCREENS`) and the `luckySpinShow` / `jackpotWinShow` sources read. */
	kind:
		| 'luckySpin'
		| 'jackpot'
		| 'coinJackpot'
		| 'instantWin'
		| 'wheelPrize'
		| 'randomMetre'
		| 'meterFull'
		| 'featureIntro'
		| 'featureTotal'
		| 'featureOutro';
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
