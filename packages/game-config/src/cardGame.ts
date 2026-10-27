import {
	readLibrary,
	validateLibrary,
	type AiDifficulty,
	type AiWeights,
	type CardDef,
} from 'engine-mechanics';

import { isObject, num } from './normalizeParts';
import type { GameConfigDoc } from './types';

/**
 * A CARD GAME's rules, cards and decks (`docs/design/card-games.md` §7, §9.1; owner decision §13 #1):
 * the `card` block of a `family: 'card'` config. The rules engine (`engine-mechanics` `cards.js`)
 * and its AI (`cardAi.js`) read it through {@link resolveCard}; the cards themselves are
 * `cards.js`'s {@link CardDef}, read with its `readLibrary` so this package and the game drop the
 * same unknown fields. SPARSE: a rule at its default is not stored.
 *
 * The names say "card game" where they could be confused with a buy-feature card
 * (`betModePresentation[mode].card`), which the config already calls a card.
 */

export type CardGameFirst = 'player' | 'ai' | 'random';

export type CardGameRules = {
	startHealth?: number;
	openingHand?: number;
	handLimit?: number;
	boardLimit?: number;
	/** Every deck must hold exactly this many cards. */
	deckSize?: number;
	/** Copies of one card a deck may hold. */
	maxCopies?: number;
	resource?: { start?: number; perTurn?: number; max?: number };
	first?: CardGameFirst;
	turnLimit?: number;
};

export type CardGameDeckAi = { difficulty: AiDifficulty; weights?: Partial<AiWeights> };

export type CardGameDeck = {
	id: string;
	/** A localization key. */
	name: string;
	side: 'player' | 'ai';
	cards: { card: string; count: number }[];
	/** An AI deck's difficulty and weight overrides. Absent ⇒ `normal`. */
	ai?: CardGameDeckAi;
};

export type CardBlock = {
	rules?: CardGameRules;
	library?: CardDef[];
	decks?: CardGameDeck[];
};

export const CARD_GAME_RULE_DEFAULTS = Object.freeze({
	startHealth: 30,
	openingHand: 3,
	handLimit: 10,
	boardLimit: 7,
	deckSize: 30,
	maxCopies: 2,
	resource: Object.freeze({ start: 1, perTurn: 1, max: 10 }),
	first: 'random' as CardGameFirst,
	turnLimit: 60,
});

export type ResolvedCardGameRules = Required<Omit<CardGameRules, 'resource'>> & {
	resource: { start: number; perTurn: number; max: number };
};

/** The card-frame component a card with no `frame` is drawn in (Game Maker's placeholder, §6). */
export const DEFAULT_CARD_FRAME_ID = 'cardFrame';

const AI_DIFFICULTY_IDS: readonly AiDifficulty[] = ['easy', 'normal', 'hard'];
const AI_WEIGHT_KEYS: readonly (keyof AiWeights)[] = ['health', 'board', 'keyword', 'hand', 'win'];
const RULE_KEYS = [
	'startHealth',
	'openingHand',
	'handLimit',
	'boardLimit',
	'deckSize',
	'maxCopies',
	'turnLimit',
] as const;
const RESOURCE_KEYS = ['start', 'perTurn', 'max'] as const;

const wholeAtLeast = (v: unknown, min: number): number | undefined => {
	const n = num(v);
	return n !== undefined && Number.isInteger(n) && n >= min ? n : undefined;
};

const idOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The rules with their defaults applied. */
export const resolveCardRules = (rules: CardGameRules | undefined): ResolvedCardGameRules => {
	const d = CARD_GAME_RULE_DEFAULTS;
	return {
		startHealth: rules?.startHealth ?? d.startHealth,
		openingHand: rules?.openingHand ?? d.openingHand,
		handLimit: rules?.handLimit ?? d.handLimit,
		boardLimit: rules?.boardLimit ?? d.boardLimit,
		deckSize: rules?.deckSize ?? d.deckSize,
		maxCopies: rules?.maxCopies ?? d.maxCopies,
		resource: {
			start: rules?.resource?.start ?? d.resource.start,
			perTurn: rules?.resource?.perTurn ?? d.resource.perTurn,
			max: rules?.resource?.max ?? d.resource.max,
		},
		first: rules?.first ?? d.first,
		turnLimit: rules?.turnLimit ?? d.turnLimit,
	};
};

/** A card game's rules, cards and decks with the defaults applied. */
export const resolveCard = (
	doc: Pick<GameConfigDoc, 'card'> | null | undefined,
): { rules: ResolvedCardGameRules; library: CardDef[]; decks: CardGameDeck[] } => ({
	rules: resolveCardRules(doc?.card?.rules),
	library: doc?.card?.library ?? [],
	decks: doc?.card?.decks ?? [],
});

/** The cards of a config: the one place that knows where they are stored (§7's "when to move"). */
export const cardLibraryOf = (doc: Pick<GameConfigDoc, 'card'> | null | undefined): CardDef[] =>
	doc?.card?.library ?? [];

/** A deck as `cards.js` takes it. */
export const cardDeckList = (deck: CardGameDeck): { card: string; count: number }[] => deck.cards;

const normalizeRules = (raw: unknown): CardGameRules | undefined => {
	if (!isObject(raw)) return undefined;
	const d = CARD_GAME_RULE_DEFAULTS;
	const rules: CardGameRules = {};
	for (const key of RULE_KEYS) {
		const value = wholeAtLeast(raw[key], key === 'openingHand' ? 0 : 1);
		if (value !== undefined && value !== d[key]) rules[key] = value;
	}
	if (isObject(raw.resource)) {
		const resource: NonNullable<CardGameRules['resource']> = {};
		for (const key of RESOURCE_KEYS) {
			const value = wholeAtLeast(raw.resource[key], key === 'max' ? 1 : 0);
			if (value !== undefined && value !== d.resource[key]) resource[key] = value;
		}
		if (Object.keys(resource).length) rules.resource = resource;
	}
	if ((raw.first === 'player' || raw.first === 'ai') && raw.first !== d.first)
		rules.first = raw.first;
	return Object.keys(rules).length ? rules : undefined;
};

const normalizeDeckAi = (raw: unknown): CardGameDeckAi | undefined => {
	if (!isObject(raw)) return undefined;
	const difficulty = AI_DIFFICULTY_IDS.find((d) => d === raw.difficulty) ?? 'normal';
	const ai: CardGameDeckAi = { difficulty };
	if (isObject(raw.weights)) {
		const weights: Partial<AiWeights> = {};
		for (const key of AI_WEIGHT_KEYS) {
			const value = num(raw.weights[key]);
			if (value !== undefined) weights[key] = value;
		}
		if (Object.keys(weights).length) ai.weights = weights;
	}
	return ai;
};

/** Decks with a unique id; an entry with no card id or a count below one is dropped. */
const normalizeDecks = (raw: unknown): CardGameDeck[] | undefined => {
	if (!Array.isArray(raw)) return undefined;
	const decks: CardGameDeck[] = [];
	for (const entry of raw) {
		if (!isObject(entry)) continue;
		const id = idOf(entry.id);
		if (!id || decks.some((d) => d.id === id)) continue;
		const side = entry.side === 'ai' ? 'ai' : 'player';
		const cards = Array.isArray(entry.cards)
			? entry.cards.flatMap((c) => {
					if (!isObject(c)) return [];
					const card = idOf(c.card);
					const count = wholeAtLeast(c.count ?? 1, 1);
					return card && count ? [{ card, count }] : [];
				})
			: [];
		const deck: CardGameDeck = { id, name: idOf(entry.name) || id, side, cards };
		const ai = side === 'ai' ? normalizeDeckAi(entry.ai) : undefined;
		if (ai) deck.ai = ai;
		decks.push(deck);
	}
	return decks.length ? decks : undefined;
};

/**
 * Normalize an authored `card` block, or `undefined` when it holds nothing. The library is read by
 * `cards.js`'s own reader, which drops unknown fields and values (`doc-readers.md`) and keeps a
 * value of the wrong type for the validator to refuse.
 */
export function normalizeCard(raw: unknown): CardBlock | undefined {
	if (!isObject(raw)) return undefined;
	const block: CardBlock = {};
	const rules = normalizeRules(raw.rules);
	if (rules) block.rules = rules;
	if (Array.isArray(raw.library)) {
		const { library } = readLibrary(raw.library);
		if (library.length) block.library = library;
	}
	const decks = normalizeDecks(raw.decks);
	if (decks) block.decks = decks;
	return Object.keys(block).length ? block : undefined;
}

/**
 * Every card-frame component a card game draws its cards in (each card's `frame`, and the default
 * frame for a card that names none): spawned at runtime, so the static scene walk never sees them.
 * The twin of `betModeCardIds`. Empty for a config with no cards (parity).
 */
export const cardGameComponentIds = (doc: GameConfigDoc): string[] => {
	const library = cardLibraryOf(doc);
	const ids = new Set<string>();
	for (const card of library) ids.add(card.frame?.trim() || DEFAULT_CARD_FRAME_ID);
	return [...ids];
};

/**
 * Each card's frame param overrides (its art) with the frame they belong to, for the export to
 * classify by the frame's param kind. The twin of `betModeCardParamRefs`.
 */
export const cardGameParamRefs = (
	doc: GameConfigDoc,
): { frame: string; params: Record<string, string | number | boolean> }[] =>
	cardLibraryOf(doc)
		.filter((card) => card.params && Object.keys(card.params).length)
		.map((card) => ({
			frame: card.frame?.trim() || DEFAULT_CARD_FRAME_ID,
			params: card.params as Record<string, string | number | boolean>,
		}));

type Issue = { severity: 'error' | 'warning'; path: string; message: string };

/** What is wrong with a card doc as a card game (§9.1). */
export function validateCardGame(doc: GameConfigDoc): Issue[] {
	const issues: Issue[] = [];
	const { rules, library, decks } = resolveCard(doc);
	const byId = new Map(library.map((card) => [card.id, card]));
	for (const issue of validateLibrary(library, { decks })) {
		const at = library.findIndex((card) => card.id === issue.card);
		const index = at >= 0 ? at : Number(issue.card.slice(1));
		issues.push({
			severity: issue.severity,
			path: `card.library[${Number.isInteger(index) ? index : 0}]${issue.path ? `.${issue.path}` : ''}`,
			message: issue.message,
		});
	}
	decks.forEach((deck, d) => {
		const at = `card.decks[${d}]`;
		const size = deck.cards.reduce((sum, entry) => sum + entry.count, 0);
		if (size !== rules.deckSize)
			issues.push({
				severity: 'error',
				path: `${at}.cards`,
				message: `The deck "${deck.id}" holds ${size} cards; every deck must hold ${rules.deckSize}.`,
			});
		deck.cards.forEach((entry, c) => {
			if (!byId.has(entry.card))
				issues.push({
					severity: 'error',
					path: `${at}.cards[${c}]`,
					message: `The deck "${deck.id}" names "${entry.card}", which is not in the library.`,
				});
			if (entry.count > rules.maxCopies)
				issues.push({
					severity: 'error',
					path: `${at}.cards[${c}].count`,
					message: `The deck "${deck.id}" holds ${entry.count} of "${entry.card}"; a deck may hold ${rules.maxCopies}.`,
				});
		});
	});
	for (const side of ['player', 'ai'] as const)
		if (!decks.some((deck) => deck.side === side))
			issues.push({
				severity: 'error',
				path: 'card.decks',
				message:
					side === 'player'
						? 'A card game needs at least one player deck.'
						: 'A card game needs at least one AI deck.',
			});
	if (rules.openingHand + 1 > rules.handLimit)
		issues.push({
			severity: 'error',
			path: 'card.rules.openingHand',
			message: `The second player's opening hand (${rules.openingHand + 1}) is over the hand limit (${rules.handLimit}).`,
		});
	return issues;
}
