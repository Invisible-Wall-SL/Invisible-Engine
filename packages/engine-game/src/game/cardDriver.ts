import type { Action, CardEvent, Match, TargetRef } from 'engine-mechanics';
import type { GameConfigDoc } from 'game-config';

import { DEVICE, PLAYER, createCardSession, type CardSession } from './cardSession';

/**
 * A card game's MATCH DRIVER (`docs/design/card-games.md` §5): what the player's drops and the
 * flow's actions do to the session, when the device plays its turn, and which Flow signals the
 * rules' events raise. Plain logic: the runtime (`apps/lines` `cards.svelte.ts`) supplies the
 * presentation, and the headless `check:card-runtime` gate supplies none, so both run this code.
 *
 * Flow decides nothing here (§5.3): it hears the signals and calls the actions; every rule is
 * `cards.js`'s, every device choice `cardAi.js`'s.
 */

/** The pause before each device action when the game names none (§4.3: presentation only). */
export const DEFAULT_DEVICE_DELAY_MS = 600;

/** How the runtime shows the match. Every method may be a no-op (the headless gate). */
export type CardPresenter = {
	/** Put the match on screen as it is now: spawn, move and despawn cards, feed their values. */
	sync(match: Match): void;
	/** One event's animation on the match before the action's result is seated (an attack's lunge). */
	event?(event: CardEvent, before: Match): Promise<void>;
	/** Wait `ms` before a device action, so the player can follow it. */
	wait(ms: number): Promise<void>;
};

/** What the driver keeps; the runtime passes a reactive object to draw from. */
export type CardDriverState = {
	/** A match is running. */
	active: boolean;
	/** An action is playing; the player's input waits for it. */
	busy: boolean;
	/** The flow's `cardsSetInput`. */
	inputEnabled: boolean;
	mine: boolean;
	phase: string;
	turn: number;
	myHealth: number;
	enemyHealth: number;
	resource: number;
	resourceMax: number;
	deckCount: number;
	enemyDeckCount: number;
	/** The card `cardsHint` lights, by uid; 0 for none. */
	hint: number;
	over: boolean;
	won: boolean;
	reason: string;
};

export const initialCardDriverState = (): CardDriverState => ({
	active: false,
	busy: false,
	inputEnabled: true,
	mine: false,
	phase: '',
	turn: 0,
	myHealth: 0,
	enemyHealth: 0,
	resource: 0,
	resourceMax: 0,
	deckCount: 0,
	enemyDeckCount: 0,
	hint: 0,
	over: false,
	won: false,
	reason: '',
});

/** The `$engine` keys a card flow reads (§5.3). */
export const CARD_ENGINE_KEYS = [
	'myHealth',
	'enemyHealth',
	'resource',
	'resourceMax',
	'deckCount',
	'enemyDeckCount',
	'turn',
	'phase',
] as const satisfies readonly (keyof CardDriverState)[];

export type CardDriver = ReturnType<typeof createCardDriver>;

type Signal = { name: string; payload: Record<string, unknown> };

/** A unit's or hero's name for a signal: the card id, or `myHero` / `enemyHero`. */
const targetName = (match: Match, target: TargetRef): string =>
	'hero' in target
		? target.hero === PLAYER
			? 'myHero'
			: 'enemyHero'
		: cardIdOf(match, target.unit);

const cardIdOf = (match: Match, uid: number): string => {
	for (const player of match.players)
		for (const zone of [player.board, player.hand, player.discard, player.deck]) {
			const card = zone.find((c) => c.uid === uid);
			if (card) return card.cardId;
		}
	return '';
};

/** The Flow signals an action's events raise, in order (§5.3). `before` names the cards that have
 *  since left the board; `after` those that arrived. */
export function signalsOf(events: readonly CardEvent[], before: Match, after: Match): Signal[] {
	const id = (uid: number) => cardIdOf(after, uid) || cardIdOf(before, uid);
	const signals: Signal[] = [];
	for (const e of events) {
		switch (e.type) {
			case 'turnStarted':
				signals.push({ name: 'turnStarted', payload: { mine: e.player === PLAYER, turn: e.turn } });
				break;
			case 'phaseChanged':
				signals.push({ name: 'phaseChanged', payload: { phase: e.phase } });
				break;
			case 'drawn':
				signals.push({
					name: 'cardDrawn',
					payload: { card: id(e.uid), mine: e.player === PLAYER, burned: e.burned },
				});
				break;
			case 'played':
				signals.push({
					name: 'cardPlayed',
					payload: { card: id(e.uid), mine: e.player === PLAYER },
				});
				break;
			case 'attacked':
				signals.push({
					name: 'unitAttacked',
					payload: {
						attacker: id(e.attacker),
						target: targetName(after, e.target) || targetName(before, e.target),
					},
				});
				break;
			case 'damaged':
				signals.push({
					name: 'damaged',
					payload: {
						target: targetName(after, e.target) || targetName(before, e.target),
						amount: e.amount,
					},
				});
				break;
			case 'healed':
				signals.push({
					name: 'healed',
					payload: { target: targetName(after, e.target), amount: e.amount },
				});
				break;
			case 'summoned':
				signals.push({
					name: 'unitSummoned',
					payload: { card: id(e.uid), mine: e.player === PLAYER },
				});
				break;
			case 'died':
				signals.push({ name: 'unitDied', payload: { card: id(e.uid) } });
				break;
			case 'matchEnded':
				signals.push({
					name: 'matchEnded',
					payload: { won: e.winner === PLAYER, reason: e.reason },
				});
				break;
		}
	}
	return signals;
}

export function createCardDriver({
	doc,
	seed,
	state,
	signal,
	present,
	deviceDelayMs = DEFAULT_DEVICE_DELAY_MS,
	onError = (error) => console.error('[cards] match work failed:', error),
}: {
	doc: GameConfigDoc;
	/** The match seed; a new match after the first adds its number, so each replays. */
	seed: string;
	state: CardDriverState;
	/** Raise a Flow signal and resolve when its chain has run. */
	signal: (name: string, payload: Record<string, unknown>) => Promise<void>;
	present: CardPresenter;
	deviceDelayMs?: number;
	onError?: (error: unknown) => void;
}) {
	let session: CardSession | undefined;
	let matches = 0;
	let queue: Promise<void> = Promise.resolve();
	let pending = 0;
	/** Match work runs one piece at a time; a flow action raised inside a chain waits its turn. */
	const exclusive = (run: () => Promise<void>): Promise<void> => {
		pending++;
		state.busy = true;
		const next = queue.then(async () => {
			try {
				await run();
			} catch (error) {
				onError(error);
			} finally {
				state.busy = --pending > 0;
			}
		});
		queue = next;
		return next;
	};

	const read = () => {
		const m = session?.match;
		if (!m) return;
		const me = m.players[PLAYER];
		const enemy = m.players[DEVICE];
		state.mine = m.active === PLAYER;
		state.phase = m.phase;
		state.turn = m.turn;
		state.myHealth = me.health;
		state.enemyHealth = enemy.health;
		state.resource = me.resource.current;
		state.resourceMax = me.resource.max;
		state.deckCount = me.deck.length;
		state.enemyDeckCount = enemy.deck.length;
		state.over = m.result !== null;
		state.won = m.result?.winner === PLAYER;
		state.reason = m.result?.reason ?? '';
	};

	/** Animate, seat and announce one action's events. */
	const show = async (events: readonly CardEvent[], before: Match) => {
		const after = session!.match;
		for (const event of events) await present.event?.(event, before);
		state.hint = 0;
		read();
		present.sync(after);
		for (const { name, payload } of signalsOf(events, before, after)) await signal(name, payload);
	};

	const deviceTurn = async () => {
		while (session?.devicesTurn()) {
			await present.wait(deviceDelayMs);
			const before = session.match;
			const { events } = session.deviceStep();
			await show(events, before);
		}
	};

	const playerAct = (action: Action): Promise<boolean> => {
		if (!session?.playersTurn() || !state.inputEnabled || state.busy) return Promise.resolve(false);
		const legal = session.legalMatch(action);
		if (!legal) return Promise.resolve(false);
		return exclusive(async () => {
			const before = session!.match;
			await show(session!.act(legal), before);
			await deviceTurn();
		}).then(() => true);
	};

	return {
		get session() {
			return session;
		},
		/** Start a match with the player deck `deck` names ('' ⇒ the first). */
		newMatch: (deck = ''): Promise<void> =>
			exclusive(async () => {
				matches += 1;
				session = createCardSession(doc, {
					seed: matches === 1 ? seed : `${seed}:${matches}`,
					deck: deck || undefined,
				});
				state.active = true;
				state.hint = 0;
				read();
				present.sync(session.match);
				await signal('matchReady', { first: session.match.active === PLAYER });
				const opening = signalsOf(session.openingEvents, session.match, session.match);
				for (const { name, payload } of opening) await signal(name, payload);
				await deviceTurn();
			}),
		/** Play a card, attack or end a phase for the player; resolves `false` for one not allowed now. */
		act: playerAct,
		endPhase: () => playerAct({ type: 'endPhase' }),
		concede: () => playerAct({ type: 'concede' }),
		setInput: (enabled: boolean) => {
			state.inputEnabled = enabled;
		},
		/** Light the first card the player can play or attack with. */
		hint: () => {
			const legal = session?.legal() ?? [];
			const first = legal.find((a) => a.type === 'play' || a.type === 'attack');
			state.hint = first ? (first.type === 'play' ? first.uid : first.attacker) : 0;
		},
		/** The player's legal actions that move `uid`: its plays from the hand, or its attacks. */
		actionsFor(uid: number): Action[] {
			if (!session?.playersTurn() || !state.inputEnabled || state.busy) return [];
			return session
				.legal()
				.filter(
					(a) =>
						(a.type === 'play' && a.uid === uid) || (a.type === 'attack' && a.attacker === uid),
				);
		},
		/** Settle work in flight (the headless gate). */
		idle: () => queue,
	};
}
