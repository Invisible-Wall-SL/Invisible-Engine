import {
	apply,
	chooseAction,
	createAi,
	createMatch,
	legalActions,
	type Action,
	type CardAi,
	type CardDef,
	type CardEvent,
	type CardInstance,
	type Match,
	type Side,
	type TargetRef,
} from 'engine-mechanics';
import { resolveCard, type CardGameDeck, type GameConfigDoc } from 'game-config';

/**
 * A card game's MATCH (`docs/design/card-games.md` §2, §4, §5.1): `engine-mechanics`' rules
 * (`cards.js`) and AI (`cardAi.js`) over the config's `card` block, as one value-holding session.
 * The player is side 0, the device side 1.
 *
 * Plain logic with no drawing and no Svelte, so the runtime and the headless `check:card-runtime`
 * gate drive the very same session.
 */

export const PLAYER: Side = 0;
export const DEVICE: Side = 1;

export type CardSession = ReturnType<typeof createCardSession>;

/** The decks a config offers the player, in authored order. */
export const playerDecks = (doc: GameConfigDoc): CardGameDeck[] =>
	resolveCard(doc).decks.filter((deck) => deck.side === 'player');

/** The deck `id` names, or the first player deck for none or an unknown id. */
const pickDeck = (decks: CardGameDeck[], id: string | undefined): CardGameDeck | undefined =>
	decks.find((deck) => deck.id === id) ?? decks[0];

const sameTarget = (a: TargetRef | undefined, b: TargetRef | undefined): boolean =>
	JSON.stringify(a) === JSON.stringify(b);

/** Where a card is: one of a side's zones, or gone (discarded). */
export type CardZone = 'deck' | 'hand' | 'board' | 'discard';

export function createCardSession(
	doc: GameConfigDoc,
	{ seed, deck: deckId }: { seed: string | number; deck?: string },
) {
	const { rules, library, decks } = resolveCard(doc);
	const playerDeck = pickDeck(
		decks.filter((deck) => deck.side === 'player'),
		deckId,
	);
	const aiDeck = decks.find((deck) => deck.side === 'ai');
	if (!playerDeck || !aiDeck)
		throw new Error('cards: the config needs a player deck and an AI deck');
	const first = rules.first === 'player' ? PLAYER : rules.first === 'ai' ? DEVICE : 'random';
	const created = createMatch({
		seed,
		decks: [playerDeck.cards, aiDeck.cards],
		library,
		rules: {
			startHealth: rules.startHealth,
			openingHand: rules.openingHand,
			handLimit: rules.handLimit,
			boardLimit: rules.boardLimit,
			resource: rules.resource,
			turnLimit: rules.turnLimit,
		},
		first,
	});
	let match: Match = created.match;
	let ai: CardAi = createAi({
		seed,
		side: DEVICE,
		difficulty: aiDeck.ai?.difficulty ?? 'normal',
		weights: aiDeck.ai?.weights,
	});
	const cards: Readonly<Record<string, CardDef>> = match.library;
	/** The player's actions, for a replay record (§4.3). */
	const actions: Action[] = [];

	const find = (uid: number): { card: CardInstance; side: Side; zone: CardZone } | undefined => {
		for (const side of [PLAYER, DEVICE] as const)
			for (const zone of ['hand', 'board', 'deck', 'discard'] as const) {
				const card = match.players[side][zone].find((c) => c.uid === uid);
				if (card) return { card, side, zone };
			}
		return undefined;
	};

	return {
		get match() {
			return match;
		},
		cards,
		playerDeck,
		aiDeck,
		/** The events `createMatch` raised: the opening hands and turn 1 up to `main`. */
		openingEvents: created.events,
		get actions(): readonly Action[] {
			return actions;
		},
		/** The player may act now. */
		playersTurn: () => !match.result && match.active === PLAYER,
		devicesTurn: () => !match.result && match.active === DEVICE,
		find,
		/** The player's legal actions now (none when it is not their turn). */
		legal: (): Action[] => (match.active === PLAYER ? legalActions(match) : []),
		/** A legal action of the player that matches `wanted` (a play's `slot` is free). */
		legalMatch(wanted: Action): Action | undefined {
			const legal = this.legal();
			if (wanted.type === 'play')
				return legal.find(
					(a) => a.type === 'play' && a.uid === wanted.uid && sameTarget(a.target, wanted.target),
				)
					? wanted
					: undefined;
			if (wanted.type === 'attack')
				return legal.find(
					(a) =>
						a.type === 'attack' &&
						a.attacker === wanted.attacker &&
						sameTarget(a.target, wanted.target),
				);
			return legal.find((a) => a.type === wanted.type);
		},
		/** Apply one of the player's actions; throws `IllegalAction` for one the rules refuse. */
		act(action: Action): CardEvent[] {
			const result = apply(match, action);
			match = result.match;
			actions.push(action);
			return result.events;
		},
		/** The device's next action, applied. */
		deviceStep(): { action: Action; events: CardEvent[] } {
			const chosen = chooseAction(ai, match);
			ai = chosen.ai;
			const result = apply(match, chosen.action);
			match = result.match;
			return { action: chosen.action, events: result.events };
		},
		/** The replay record of this match so far (§4.3). */
		record: () => ({
			seed,
			decks: [playerDeck.cards, aiDeck.cards] as const,
			library,
			rules: {
				startHealth: rules.startHealth,
				openingHand: rules.openingHand,
				handLimit: rules.handLimit,
				boardLimit: rules.boardLimit,
				resource: rules.resource,
				turnLimit: rules.turnLimit,
			},
			first,
			ai: [
				{
					side: DEVICE,
					difficulty: aiDeck.ai?.difficulty ?? 'normal',
					weights: aiDeck.ai?.weights,
				},
			],
			actions: [...actions],
		}),
	};
}
