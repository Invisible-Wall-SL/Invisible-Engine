/**
 * Types for the card rules engine (`cards.js`, `docs/design/card-games.md` §2–§3). The module is
 * plain JS — see the package's `index.ts` for why — so its contract is declared here. The behaviour
 * is pinned by `scripts/check-card-rules.mjs` and `scripts/check-card-library.mjs`.
 */

export type Keyword = 'guard' | 'swift' | 'shield';
export type Trigger = 'onPlay' | 'onDeath' | 'turnStart' | 'onAttack' | 'onDamaged';
export type Include = 'units' | 'characters';
export type Side = 0 | 1;
export type Phase = 'start' | 'draw' | 'main' | 'combat' | 'end';

export type Target =
	| { kind: 'self' }
	| { kind: 'chosen'; side: 'enemy' | 'friendly' | 'any'; include: Include }
	| { kind: 'allEnemies'; include: Include }
	| { kind: 'randomEnemy'; include: Include };

export type CardEffect = { trigger: Trigger } & (
	| { verb: 'damage'; amount: number; target: Target }
	| { verb: 'heal'; amount: number; target: Target }
	| { verb: 'draw'; amount: number }
	| { verb: 'summon'; card: string; count?: number }
	| {
			verb: 'buff';
			attack: number;
			health: number;
			until: 'endOfTurn' | 'permanent';
			target: Target;
	  }
	| { verb: 'destroy'; target: Target }
	| { verb: 'giveKeyword'; keyword: Keyword; target: Target }
);

/** A library entry (§3.1). */
export interface CardDef {
	id: string;
	/** Display text; a localization key. */
	name: string;
	type: 'unit' | 'spell';
	/** 0 … 10. */
	cost: number;
	/** Units only, 0 … 20. */
	attack?: number;
	/** Units only, 1 … 20. */
	health?: number;
	/** Units only. */
	keywords?: Keyword[];
	/** At most three. A spell's are all `onPlay`. */
	effects?: CardEffect[];
	flavor?: string;
	/** A card-frame component id; absent ⇒ the game's default. */
	frame?: string;
	/** The frame's param overrides: the art. */
	params?: Record<string, string | number | boolean>;
	/** Only summoned, never in a deck. */
	token?: true;
}

/** A deck: card ids, or the config's `{ card, count }` entries (count defaults to 1). */
export type DeckList = readonly (string | { card: string; count?: number })[];

export interface CardRules {
	startHealth: number;
	openingHand: number;
	handLimit: number;
	boardLimit: number;
	resource: { start: number; perTurn: number; max: number };
	turnLimit: number;
}

export type CardRulesInput = Partial<Omit<CardRules, 'resource'>> & {
	resource?: Partial<CardRules['resource']>;
};

export interface CardInstance {
	/** Unique in the match, never reused. Every event names cards by it. */
	uid: number;
	cardId: string;
	owner: Side;
	/** Current values: the card's base plus buffs. */
	attack: number;
	health: number;
	/** A unit dies when `damage >= health`. */
	damage: number;
	keywords: Keyword[];
	buffs: { attack: number; health: number; until: 'endOfTurn' | 'permanent' }[];
	/** For the "cannot attack the turn it arrives" rule; 0 until it reaches the board. */
	summonedOnTurn: number;
	attacksLeft: number;
}

export interface PlayerState {
	health: number;
	maxHealth: number;
	resource: { current: number; max: number };
	/** The damage the next empty-deck draw deals. */
	fatigue: number;
	/** Ordered; the top is the end of the array. */
	deck: CardInstance[];
	hand: CardInstance[];
	/** Left to right; also the trigger order. */
	board: CardInstance[];
	discard: CardInstance[];
}

export type TargetRef = { unit: number } | { hero: Side };

/** An effect waiting in the queue, or a declared attack's combat damage. */
export type QueuedEffect =
	| {
			source: number;
			owner: Side;
			cardId: string;
			/** The effect's index in its card's `effects`. */
			index: number;
			/** The play's chosen target, on an `onPlay` effect of a card that chooses. */
			target?: TargetRef;
			/** The board slot a dead unit left, on its `onDeath` effects. */
			at?: number;
	  }
	| { combat: true; attacker: number; target: TargetRef };

export type MatchResult = {
	winner: Side | 'draw';
	reason: 'hero' | 'concede' | 'loop' | 'turnLimit';
};

export interface Match {
	seed: string | number;
	/** The match's random stream; each draw returns a match with the next state. */
	rngState: number;
	/** 1, 2, 3 …; both players' turns count. */
	turn: number;
	active: Side;
	phase: Phase;
	players: [PlayerState, PlayerState];
	queue: QueuedEffect[];
	nextUid: number;
	result: MatchResult | null;
	/** The rules with their defaults applied. */
	rules: CardRules;
	/** The library as read, by id. Shared between copies and never changed. */
	library: Readonly<Record<string, CardDef>>;
}

export type Action =
	| { type: 'play'; uid: number; slot?: number; target?: TargetRef }
	| { type: 'attack'; attacker: number; target: TargetRef }
	| { type: 'endPhase' }
	| { type: 'concede' };

/** What happened, in order: the card family's book (§2.6). Cards are named by uid. */
export type CardEvent =
	| { type: 'turnStarted'; player: Side; turn: number }
	| { type: 'phaseChanged'; phase: Phase }
	| { type: 'drawn'; player: Side; uid: number; burned: boolean }
	| { type: 'fatigue'; player: Side; amount: number }
	| { type: 'played'; player: Side; uid: number; slot: number | null }
	| { type: 'attacked'; attacker: number; target: TargetRef }
	| { type: 'damaged'; target: TargetRef; amount: number; by: number; shieldBroken: boolean }
	| { type: 'healed'; target: TargetRef; amount: number }
	| { type: 'buffed'; uid: number; attack: number; health: number }
	| { type: 'keywordGiven'; uid: number; keyword: Keyword }
	| { type: 'summoned'; player: Side; uid: number; slot: number }
	| { type: 'destroyed'; uid: number }
	| { type: 'died'; uid: number }
	| { type: 'buffsExpired'; uids: number[] }
	| { type: 'matchEnded'; winner: Side | 'draw'; reason: MatchResult['reason'] };

export type LibraryIssue = {
	severity: 'error' | 'warning';
	code: string;
	/** The card's id, or `#<index>` for a card with none. */
	card: string;
	/** Inside the card, e.g. `effects[1].target`; empty for the card as a whole. */
	path: string;
	message: string;
};

export type IllegalActionCode =
	| 'over'
	| 'phase'
	| 'action'
	| 'hand'
	| 'cost'
	| 'boardFull'
	| 'target'
	| 'slot'
	| 'attacker'
	| 'exhausted'
	| 'arrived';

export class IllegalAction extends Error {
	readonly code: IllegalActionCode;
	constructor(code: IllegalActionCode, message: string);
}

export const CARD_KEYWORDS: readonly Keyword[];
export const CARD_TRIGGERS: readonly Trigger[];
export const CARD_TARGET_KINDS: readonly Target['kind'][];
export const CARD_VERBS: readonly CardEffect['verb'][];
/** What each verb may aim at: any target, units only, or none. */
export const CARD_VERB_TARGETS: Readonly<Record<CardEffect['verb'], 'any' | 'units' | 'none'>>;
export const CARD_RULE_DEFAULTS: Readonly<CardRules>;
export const MAX_QUEUE_STEPS: number;

/** Known fields only; unknown verbs, triggers, targets and card types drop their effect or card,
 *  an unknown keyword drops the keyword. Each drop is named in `dropped`. */
export function readLibrary(library: unknown): { library: CardDef[]; dropped: string[] };

/** The §3.6 checks. `decks` adds the "no deck uses it" and "token in a deck" warnings. */
export function validateLibrary(
	library: readonly unknown[],
	options?: { decks?: readonly (DeckList | { id?: string; cards: DeckList })[] },
): LibraryIssue[];

/** One English sentence per effect, in authored order. */
export function cardText(card: CardDef, library?: readonly CardDef[]): string[];

/** Shuffles, deals and runs turn 1 to `main`. Throws on a library with errors or an unknown deck
 *  card. */
export function createMatch(options: {
	seed: string | number;
	decks: readonly [DeckList, DeckList];
	library: readonly unknown[];
	rules?: CardRulesInput;
	first?: Side | 'random';
}): { match: Match; events: CardEvent[] };

/** Plays are listed without `slot`; any slot from 0 to the board's length is legal for them. */
export function legalActions(match: Match): Action[];

/** Never changes `match`. Throws {@link IllegalAction}. */
export function apply(match: Match, action: Action): { match: Match; events: CardEvent[] };

export function isOver(match: Match): boolean;
