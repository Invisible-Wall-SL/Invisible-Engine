import { SvelteSet } from 'svelte/reactivity';

import { DEFAULT_BET_MODE_META, DEFAULT_GAME_RULE_META } from './constants';

export type BetModeData = {
	maxWin?: number;
	mode: string;
	costMultiplier: number;
	type: 'default' | 'activate' | 'buy';
	parent: string;
	children: string;
	/** The card ComponentDef id this mode renders in the buy-feature menu (distinct, authorable
	 *  cards). Empty string ⇒ unset ⇒ the repeater falls back to its node's default `featureCard`,
	 *  byte-identical to before (parity). Optional so existing coded metas need no change. */
	card?: string;
	/** Per-mode overrides for the card component's params — a generic map from a card-component param
	 *  key to a scalar override, merged into the repeater item's values so ONE shared card renders
	 *  visually-distinct per mode. Absent/empty ⇒ no overrides, every param keeps the card's authored
	 *  default (parity). Optional so existing coded metas need no change. */
	cardParams?: Record<string, string | number | boolean>;
	/** An `activate` (ante) mode shown as the HUD's ante switch instead of a buy-menu card. Absent ⇒ a
	 *  card, as before. */
	toggle?: boolean;
	/** The symbols the spinning filler reels show while this mode is the stake. Absent/empty ⇒ the
	 *  base strips. Presentation only. */
	fillerSymbols?: string[];
	/** The operator may switch this option off: a server refusal of it is a message, not an error.
	 *  Absent ⇒ an error, as before. */
	refusable?: boolean;
	assets: {
		icon: string;
		volatility: string;
		button: string;
		dialogImage: string;
		dialogVolatility: string;
	};
	text: {
		bannerText?: string;
		description?: string;
		betAmountLabel?: string;
		title: string;
		dialog: string;
		button: string;
		tickerIdle: string;
		tickerSpin: string;
	};
};

export type BetModeMeta = Record<string, BetModeData>;

export type GameRuleContainer = {
	title: string;
	text: string;
	textImages?: { [key: string]: string };
	image: string;
	row: number;
	column: number;
	imagePosition: 'top' | 'left';
};

export type GameRuleData = {
	containers: GameRuleContainer[];
	rows: number;
	columns: number;
	title: string;
};

type GameRuleMeta = {
	gameRules: GameRuleData[];
	payTable: GameRuleData[];
	splashScreen: GameRuleData[];
};

export const stateMeta = $state({
	betModeMeta: DEFAULT_BET_MODE_META as BetModeMeta,
	gameRuleMeta: DEFAULT_GAME_RULE_META as GameRuleMeta,
});

/** A mode the buy menu offers as a card: anything but the plain bet and an ante that is the HUD's
 *  switch. */
export const isBuyMenuMode = (mode: BetModeData): boolean =>
	mode.type !== 'default' && !(mode.type === 'activate' && mode.toggle);

/** The ante the HUD switch arms — the first `activate` mode marked `toggle` — or undefined. */
const anteToggleMode = (): BetModeData | undefined =>
	Object.values(stateMeta.betModeMeta).find((mode) => mode.type === 'activate' && mode.toggle);

export const stateMetaDerived = {
	betModeMetaList: () => Object.values(stateMeta.betModeMeta),
	/** Whether the buy menu has a card to show. False once a jurisdiction that forbids buying a
	 *  feature has stripped every buy and the game authors no menu ante (or only refused ones) — at
	 *  which point the buy-bonus button would open an empty menu. */
	hasFeatureBetModes: () => Object.values(stateMeta.betModeMeta).some(isBuyMenuMode),
	anteToggleMode,
};

/**
 * The bet options the server REFUSED this session (an operator can switch the ante and the buys
 * off, and says so only by refusing the bet). Uppercased mode keys. A refused mode leaves the menu
 * for the rest of the session: the runtime's menu builder drops these, so a rebuild cannot bring
 * one back.
 */
export const refusedBetModes = new SvelteSet<string>();

/** Record a refusal and drop the mode from the live menu at once. */
export const refuseBetMode = (key: string): void => {
	const refused = key.toUpperCase();
	refusedBetModes.add(refused);
	if (!stateMeta.betModeMeta[refused]) return;
	stateMeta.betModeMeta = Object.fromEntries(
		Object.entries(stateMeta.betModeMeta).filter(([mode]) => mode !== refused),
	);
};
