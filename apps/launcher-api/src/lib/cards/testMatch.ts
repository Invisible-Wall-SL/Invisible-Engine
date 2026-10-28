import {
	apply,
	chooseAction,
	createAi,
	createMatch,
	legalActions,
	replayMatch,
	type Action,
	type AiDifficulty,
	type AiSeat,
	type AiWeights,
	type CardAi,
	type CardEvent,
	type CardRulesInput,
	type DeckList,
	type Match,
	type MatchResult,
	type Side,
} from 'engine-mechanics';
import { resolveCard, type CardGameDeck, type GameConfigDoc } from 'game-config';

/**
 * Invisible Card Library's TEST MATCH (`docs/design/card-games.md` §8.3): a match on the config's
 * own rules and decks, played by `engine-mechanics`' `cards.js` and `cardAi.js` themselves — the
 * modules the game's `cardSession.ts` runs — with the config mapped onto them exactly as that
 * session maps it. Side 0 is the first deck picked, side 1 the second. Plain logic with no drawing,
 * so `check:cards-tool` plays the very same matches headless.
 */

export type SeatSetup = { deck: string; difficulty: AiDifficulty; weights?: Partial<AiWeights> };

/** A match's whole input: replaying it with `replayMatch` gives the same match. */
export type ReplayRecord = {
	seed: string | number;
	decks: [DeckList, DeckList];
	library: unknown[];
	rules: CardRulesInput;
	first: Side | 'random';
	ai: AiSeat[];
	actions?: Action[];
};

/** The deck's own difficulty and weights, the default seat for it. */
export const seatFor = (deck: CardGameDeck): SeatSetup => ({
	deck: deck.id,
	difficulty: deck.ai?.difficulty ?? 'normal',
	...(deck.ai?.weights ? { weights: deck.ai.weights } : {}),
});

/** The config's `first` on sides: side 0 is "the player", as in the game. */
const firstOf = (first: 'player' | 'ai' | 'random'): Side | 'random' =>
	first === 'player' ? 0 : first === 'ai' ? 1 : 'random';

/** The record of a match between two decks; `human` names the side a person plays (no AI seat). */
export function recordFor(
	doc: GameConfigDoc,
	seats: readonly [SeatSetup, SeatSetup],
	seed: string | number,
	human?: Side,
): ReplayRecord {
	const { rules, library, decks } = resolveCard(doc);
	const deck = (id: string): DeckList => {
		const found = decks.find((d) => d.id === id);
		if (!found) throw new Error(`cards: no deck "${id}"`);
		return found.cards;
	};
	return {
		seed,
		decks: [deck(seats[0].deck), deck(seats[1].deck)],
		library: JSON.parse(JSON.stringify(library)) as unknown[],
		rules: {
			startHealth: rules.startHealth,
			openingHand: rules.openingHand,
			handLimit: rules.handLimit,
			boardLimit: rules.boardLimit,
			resource: rules.resource,
			turnLimit: rules.turnLimit,
		},
		first: firstOf(rules.first),
		ai: ([0, 1] as const)
			.filter((side) => side !== human)
			.map((side) => ({
				side,
				difficulty: seats[side].difficulty,
				...(seats[side].weights ? { weights: seats[side].weights } : {}),
			})),
	};
}

/**
 * One match, stepped: a person may play one side (`act`), the AI plays every seat in the record
 * (`aiStep`). `log` is every action taken, and the record with the person's actions replays it.
 */
export function createTestMatch(record: ReplayRecord) {
	const created = createMatch(record);
	let match: Match = created.match;
	const ais = new Map<Side, CardAi>(
		record.ai.map((seat) => [
			seat.side,
			createAi({
				seed: record.seed,
				side: seat.side,
				difficulty: seat.difficulty,
				weights: seat.weights,
			}),
		]),
	);
	const log: { side: Side; action: Action }[] = [];
	const step = (action: Action): CardEvent[] => {
		const side = match.active;
		const result = apply(match, action);
		match = result.match;
		log.push({ side, action });
		return result.events;
	};
	return {
		get match() {
			return match;
		},
		dropped: created.dropped,
		openingEvents: created.events,
		log,
		/** The AI plays the side to move now. */
		aiTurn: () => !match.result && ais.has(match.active),
		legal: (): Action[] => (match.result ? [] : legalActions(match)),
		/** A person's action; throws `IllegalAction` for one the rules refuse. */
		act: (action: Action): CardEvent[] => step(action),
		aiStep(): CardEvent[] {
			const ai = ais.get(match.active);
			if (!ai || match.result) return [];
			const chosen = chooseAction(ai, match);
			ais.set(match.active, chosen.ai);
			return step(chosen.action);
		},
		/** The record that replays this match, the person's actions included. */
		replay(): ReplayRecord {
			const people = log.filter((entry) => !ais.has(entry.side)).map((entry) => entry.action);
			return { ...record, ...(people.length ? { actions: people } : {}) };
		},
	};
}

/** Steps a whole match can take before it is called stuck (the rules' own turn limit ends it). */
const MAX_STEPS = 20_000;

export type MatchSummary = {
	seed: string | number;
	result: MatchResult;
	/** Turns played (both sides' count). */
	turns: number;
	/** The cards each side still held when it ended, by id. */
	leftInHand: [Record<string, number>, Record<string, number>];
};

/** An AI-vs-AI match played to its end. */
export function playAiMatch(record: ReplayRecord): MatchSummary {
	const run = createTestMatch(record);
	for (let i = 0; i < MAX_STEPS && !run.match.result; i++) run.aiStep();
	const { match } = run;
	if (!match.result) throw new Error(`cards: the match on seed ${String(record.seed)} did not end`);
	const held = (side: Side): Record<string, number> => {
		const out: Record<string, number> = {};
		for (const card of match.players[side].hand) out[card.cardId] = (out[card.cardId] ?? 0) + 1;
		return out;
	};
	return {
		seed: record.seed,
		result: match.result,
		turns: match.turn,
		leftInHand: [held(0), held(1)],
	};
}

export type RunTotals = {
	played: number;
	/** Wins per side, then draws. */
	wins: [number, number];
	draws: number;
	averageTurns: number;
	/** How each match ended. */
	reasons: Record<MatchResult['reason'], number>;
	/** The cards most often left in a hand at the end, both sides together, most first. */
	leftInHand: { card: string; count: number }[];
};

/** Add one match to the running totals. */
export function addToTotals(totals: RunTotals | null, m: MatchSummary): RunTotals {
	const t: RunTotals = totals ?? {
		played: 0,
		wins: [0, 0],
		draws: 0,
		averageTurns: 0,
		reasons: { hero: 0, concede: 0, loop: 0, turnLimit: 0 },
		leftInHand: [],
	};
	const played = t.played + 1;
	const left = new Map(t.leftInHand.map((e) => [e.card, e.count]));
	for (const side of m.leftInHand)
		for (const [card, count] of Object.entries(side)) left.set(card, (left.get(card) ?? 0) + count);
	return {
		played,
		wins:
			m.result.winner === 0
				? [t.wins[0] + 1, t.wins[1]]
				: m.result.winner === 1
					? [t.wins[0], t.wins[1] + 1]
					: t.wins,
		draws: t.draws + (m.result.winner === 'draw' ? 1 : 0),
		averageTurns: (t.averageTurns * t.played + m.turns) / played,
		reasons: { ...t.reasons, [m.result.reason]: t.reasons[m.result.reason] + 1 },
		leftInHand: [...left]
			.map(([card, count]) => ({ card, count }))
			.sort((a, b) => b.count - a.count || a.card.localeCompare(b.card)),
	};
}

/** "Run 100": AI-vs-AI on seeds 1 … `count`, in order. */
export function runMany(
	doc: GameConfigDoc,
	seats: readonly [SeatSetup, SeatSetup],
	count = 100,
): RunTotals | null {
	let totals: RunTotals | null = null;
	for (let seed = 1; seed <= count; seed++)
		totals = addToTotals(totals, playAiMatch(recordFor(doc, seats, seed)));
	return totals;
}

/** A record checked by replaying it: the same match `createTestMatch` played. */
export const replayOf = (record: ReplayRecord): Match => replayMatch(record).match;
