/**
 * The engine's CODED UI STRINGS — every player-facing literal the shipped HUD, menus and modals
 * render from code rather than from an authored layout node.
 *
 * These are localizable by exactly the same source-as-key model as scene text: each component calls
 * `stateI18nDerived.translate('BALANCE')`, and Lingui resolves it against the merged catalog (into
 * which the Invisible Localization tool's reviewed strings are merged LAST). What they lacked was
 * DISCOVERABILITY — `/localization` harvests the Scene Editor, Win Text, the Symbols SM, Flow and
 * Game Config, but never these, so an owner had no row to translate and the whole HUD chrome stayed
 * in the source language for any language the code catalogs don't ship (only `en`/`zh` do).
 *
 * This module is the ONE home for those literals: the `i18nDerived` maps in `components-ui-pixi` and
 * `components-ui-html` read their keys from here, and the launcher's localization harvester collects
 * the same list. So adding a coded label in one place makes it translatable everywhere, and the list
 * can't drift from what the game actually renders.
 *
 * Lives on `engine-layout` because it is the shared, Svelte-free, Node-resolvable package both UI
 * packages already depend on and the launcher already imports (see `winText.ts`, same reasoning).
 */

/** One collected coded string: the catalog KEY (= the source literal) and a human label for the row. */
export interface UiTextString {
	key: string;
	source: string;
	label: string;
}

/**
 * The catalog keys, by semantic name. The VALUE is the source literal AND the catalog key
 * (source-as-key), so these strings must never be "tidied" — changing one orphans any translation
 * already authored against it, exactly like renaming a text node's literal.
 */
export const UI_TEXT = {
	// HUD readouts + buttons
	balance: 'BALANCE',
	win: 'WIN',
	bet: 'BET',
	spin: 'SPIN',
	stop: 'STOP',
	freeSpins: 'FREE SPINS',
	buyBonus: 'BUY BONUS',
	playBonus: 'PLAY BONUS',
	max: 'MAX',
	// Menu / info surfaces
	menu: 'MENU',
	menuExit: 'EXIT',
	turbo: 'TURBO',
	autoSpin: 'AUTO SPIN',
	payTable: 'PAYTABLE',
	payLines: 'PAYLINES',
	gameRules: 'GAME RULES',
	info: 'INFO',
	settings: 'SETTINGS',
	audio: 'AUDIO',
	soundOn: 'SOUND ON',
	soundOff: 'SOUND OFF',
	disable: 'DISABLE',
	home: 'HOME',
	// Bet menu
	betMenu: 'BET MENU',
	selectYourBet: 'SELECT YOUR BET',
	confirm: 'CONFIRM',
	cancel: 'CANCEL',
	// Settings modal
	masterVolume: 'MASTER VOLUME',
	musicVolume: 'MUSIC VOLUME',
	soundEffectVolume: 'SOUND EFFECT VOLUME',
	// Autoplay modal + its stop notifications
	autoSpins: 'AUTO SPINS',
	numberOfRounds: 'NUMBER OF ROUNDS',
	advanced: 'ADVANCED',
	singleWinLimit: 'SINGLE WIN LIMIT',
	lossLimit: 'LOSS LIMIT',
	startAutoplay: 'START AUTOPLAY',
	notification: 'NOTIFICATION',
	autoSpinsStopInfo: 'AUTO PLAY HAS STOPPED DUE TO',
	insufficientFunds:
		'INSUFFICIENT FUNDS TO PLACE THIS BET. PLEASE ADD FUNDS TO YOUR ACCOUNT OR LOWER THE BET LEVEL.',
	lossLimitReached: 'LOSS LIMIT REACHED',
	singleWinLimitReached: 'SINGLE WIN LIMIT REACHED',
} as const;

export type UiTextKey = keyof typeof UI_TEXT;

/** Which surface each string belongs to — the row label, so a translator has context for a bare word. */
const UI_TEXT_GROUP: Record<UiTextKey, string> = {
	balance: 'HUD',
	win: 'HUD',
	bet: 'HUD',
	spin: 'HUD',
	stop: 'HUD',
	freeSpins: 'HUD',
	buyBonus: 'HUD',
	playBonus: 'HUD',
	max: 'HUD',
	menu: 'Menu',
	menuExit: 'Menu',
	turbo: 'Menu',
	autoSpin: 'Menu',
	payTable: 'Menu',
	payLines: 'Menu',
	gameRules: 'Menu',
	info: 'Menu',
	settings: 'Menu',
	audio: 'Menu',
	soundOn: 'Menu',
	soundOff: 'Menu',
	disable: 'Menu',
	home: 'Menu',
	betMenu: 'Bet menu',
	selectYourBet: 'Bet menu',
	confirm: 'Bet menu',
	cancel: 'Bet menu',
	masterVolume: 'Settings',
	musicVolume: 'Settings',
	soundEffectVolume: 'Settings',
	autoSpins: 'Autoplay',
	numberOfRounds: 'Autoplay',
	advanced: 'Autoplay',
	singleWinLimit: 'Autoplay',
	lossLimit: 'Autoplay',
	startAutoplay: 'Autoplay',
	notification: 'Autoplay',
	autoSpinsStopInfo: 'Autoplay',
	insufficientFunds: 'Autoplay',
	lossLimitReached: 'Autoplay',
	singleWinLimitReached: 'Autoplay',
};

/** One rule block on the info page: a heading and its body copy. */
export interface UiInfoRule {
	heading: string;
	body: string;
}

/**
 * The DEFAULT game-rules copy the in-canvas info page shows (`InfoOverlay`'s "GAME RULES" page).
 * Here for the same reason as {@link UI_TEXT}: the overlay already renders each string through
 * `translate()`, but while the literals lived inside the game's `infoManifest` the launcher could
 * not see them, so the whole rules page stayed in the source language with no row to translate.
 *
 * These are DEFAULTS — a game's `infoManifest` may still supply its own `rules`; a game that does
 * owns those strings and must make them harvestable the same way.
 */
export const UI_INFO_RULES: UiInfoRule[] = [
	{
		heading: 'WILD',
		body: 'The Wild substitutes for all paying symbols to complete winning lines.',
	},
	{
		heading: 'SCATTER',
		body: 'The Scatter is paid anywhere on the reels. 3 or more trigger the Free Spins feature.',
	},
	{
		heading: 'PAYLINES & BET',
		body: 'Line wins pay left to right on adjacent reels. Total bet = bet per line × the number of lines.',
	},
	{
		heading: 'MAX WIN',
		body: 'If the total win of a round reaches the win cap, the round ends and the win is awarded up to the cap.',
	},
];

/**
 * Every coded UI string as a translatable row, deduped by catalog key (`SETTINGS` is both a menu
 * entry and the settings modal's title — one string, one translation; `PAYLINES` is both a menu
 * entry and a rule heading). Source-as-key, so `key` IS the literal `translate()` looks up.
 */
export function collectUiTextStrings(): UiTextString[] {
	const out: UiTextString[] = [];
	const seen = new Set<string>();
	const add = (source: string, label: string): void => {
		if (seen.has(source)) return;
		seen.add(source);
		out.push({ key: source, source, label });
	};
	for (const [name, source] of Object.entries(UI_TEXT) as [UiTextKey, string][]) {
		add(source, UI_TEXT_GROUP[name]);
	}
	for (const rule of UI_INFO_RULES) {
		add(rule.heading, 'Info page');
		add(rule.body, 'Info page');
	}
	return out;
}
