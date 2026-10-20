import type { HoldAndWinBannerKind } from 'engine-layout';

/**
 * THE HOLD AND WIN BANNER — the coded default for the beats that announce something over the board:
 * the Lucky Spin intro, a random metre, a pot filling, the feature's intro / total / outro, a jackpot
 * celebration, a coin jackpot during the tally, a jackpot coin an upgrade stepped up a tier, an
 * expanding board opening a row, a base-game instant win, a wheel prize and the operator platform
 * jackpot's celebration.
 * Drawn by `HoldAndWinBanner.svelte`, unless an authored screen draws it (`bannerScreen()`); the copy
 * is the project's Win Text (the metre's name is the Game Config's).
 *
 * One banner at a time: a new one replaces the last, and hiding names the banner it hides, so a beat
 * that ends late cannot take down the next beat's banner.
 */
export type HoldAndWinBannerView = {
	id: number;
	/** Which beat put it up — which authored screens can draw it (`HOLD_AND_WIN_BANNER_SCREENS`). */
	kind: HoldAndWinBannerKind;
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
