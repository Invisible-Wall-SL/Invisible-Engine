/**
 * THE AUTHORED SCREENS OF THE HOLD AND WIN BANNER — the one coded banner (`apps/lines`
 * `HoldAndWinBanner.svelte`) every Hold and Win beat announces itself with, and the operator platform
 * jackpot's celebration too. Each banner kind has screens that draw it instead; while one of them is
 * MOUNTED (for a mode screen, the active respin mode's copy) the coded banner steps aside and that
 * screen draws it, so the two never draw together. A kind lists its screens in preference order: the
 * first one mounted draws it.
 */
export const HOLD_AND_WIN_BANNER_SCREENS = {
	luckySpin: ['luckySpin'],
	jackpot: ['jackpotWin'],
	/** The platform jackpot's own screen, else the Hold and Win jackpot's, which drew it before the
	 *  platform jackpot had one. */
	platformJackpot: ['platformJackpotBanner', 'jackpotWin'],
	coinJackpot: ['coinJackpotBanner'],
	jackpotUpgrade: ['jackpotUpgradeBanner'],
	instantWin: ['instantWinBanner'],
	wheelPrize: ['wheelPrizeBanner'],
	randomMetre: ['randomMetreBanner'],
	meterFull: ['potFullBanner'],
	rowUnlocked: ['rowUnlockedBanner'],
	featureIntro: ['featureIntro'],
	featureTotal: ['featureTotalBanner'],
	featureOutro: ['featureOutro'],
} as const satisfies Record<string, readonly string[]>;

/** Which beat put the banner up. */
export type HoldAndWinBannerKind = keyof typeof HOLD_AND_WIN_BANNER_SCREENS;

/**
 * Each banner screen's visibility source: true while a banner it draws is up and no screen that
 * kind prefers over it is mounted to draw it. The feature intro and outro have none — they are tap
 * screens a flow holds the round on.
 */
export const HOLD_AND_WIN_BANNER_SHOW_SOURCES = {
	luckySpin: 'luckySpinShow',
	jackpotWin: 'jackpotWinShow',
	platformJackpotBanner: 'platformJackpotBannerShow',
	coinJackpotBanner: 'coinJackpotBannerShow',
	jackpotUpgradeBanner: 'jackpotUpgradeBannerShow',
	instantWinBanner: 'instantWinBannerShow',
	wheelPrizeBanner: 'wheelPrizeBannerShow',
	randomMetreBanner: 'randomMetreBannerShow',
	potFullBanner: 'potFullBannerShow',
	rowUnlockedBanner: 'rowUnlockedBannerShow',
	featureTotalBanner: 'featureTotalBannerShow',
} as const satisfies Record<string, string>;

/**
 * The banner screens the game mounts ITSELF whenever the layout has them — on the coded path like
 * any author screen, and under a driven flow that never shows one (a flow that shows it owns it).
 * Each is gated on its own source, so it draws exactly while its banner is up: putting art on one is
 * the whole job, with no flow wiring. The Lucky Spin, jackpot-win, intro and outro screens are not
 * here: they stay a flow's to show around their beat, so a project that has one its flow never
 * shows keeps the coded banner it plays today.
 */
export const SELF_MOUNTED_BANNER_SCREENS: readonly string[] = [
	'platformJackpotBanner',
	'coinJackpotBanner',
	'jackpotUpgradeBanner',
	'instantWinBanner',
	'wheelPrizeBanner',
	'randomMetreBanner',
	'potFullBanner',
	'rowUnlockedBanner',
	'featureTotalBanner',
];

/**
 * The screen that draws a `kind` banner: the first of its screens that `mounted` says is up, else
 * `undefined` (the coded banner draws it).
 */
export const bannerScreenFor = (
	kind: HoldAndWinBannerKind,
	mounted: (screen: string) => boolean,
): string | undefined => {
	const screens: readonly string[] = HOLD_AND_WIN_BANNER_SCREENS[kind];
	return screens.find(mounted);
};

/**
 * Is `screen`'s visibility source on while a `kind` banner is up? When `screen` draws that kind and
 * no screen the kind prefers over it is mounted. It does not ask whether `screen` itself is mounted,
 * so a component elsewhere gated on the source shows with the banner.
 */
export const bannerScreenShows = (
	kind: HoldAndWinBannerKind,
	screen: string,
	mounted: (screen: string) => boolean,
): boolean => {
	const screens: readonly string[] = HOLD_AND_WIN_BANNER_SCREENS[kind];
	const at = screens.indexOf(screen);
	return at >= 0 && !screens.slice(0, at).some(mounted);
};

/**
 * Is `scene` a self-mounted banner screen, or a respin mode's copy of one? A layout gets one only
 * when an author adds it for its popup: a new game's scaffold and the bulk "add screens" actions
 * leave them out, so every popup keeps the built-in banner until then.
 */
export const isSelfMountedBannerScreen = (scene: { id: string; modeId?: string }): boolean =>
	SELF_MOUNTED_BANNER_SCREENS.some(
		(id) => scene.id === id || (scene.modeId !== undefined && scene.id === `${id}-${scene.modeId}`),
	);
