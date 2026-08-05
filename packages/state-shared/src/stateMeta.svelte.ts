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

export const stateMetaDerived = {
	betModeMetaList: () => Object.values(stateMeta.betModeMeta),
};
