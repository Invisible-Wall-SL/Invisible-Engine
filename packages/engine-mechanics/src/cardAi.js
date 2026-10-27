// Invisible Engine — the CARD AI, the on-device opponent (docs/design/card-games.md §4, C2).
//
// Each time it must act the AI picks one action, then is asked again. It takes a win when it sees
// one; otherwise it tries each legal action on a copy of the match with the rules' own `apply` and
// keeps the best by `evaluate`. `hard` scores whole sequences of plays in `main` (a beam search)
// instead of one action. Types live in `cardAi.d.ts`; the behaviour is pinned by
// `scripts/check-card-ai.mjs`.
//
// ITS OWN STREAM (§4.3). The AI's random draws (a mistake roll, a mistaken action) come from a
// number in the AI's value, seeded from `${seed}:ai:${side}`, never from the match's `rngState`. A
// look-ahead never reads the match's stream either: every trial runs on a copy whose `rngState` is
// one of SAMPLE_STATES, and an action whose trial draws (a `randomEnemy`) is scored as the mean
// over all of them. So a decision depends on what the player can see, never on the next draw, and
// the match's draws are the same whichever difficulty plays.
//
// A FIXED BUDGET. One decision makes at most MAX_PLAN_APPLIES calls to `apply`, counted, not timed,
// so a decision is the same on every device.

import { rngNext, rngSeed } from './board.js';
import { apply, createMatch, legalActions } from './cards.js';

/** The evaluation's weights (§4.1). `win` is added for a won match and taken off for a lost one. */
export const AI_WEIGHT_DEFAULTS = { health: 1, board: 1.5, keyword: 0.5, hand: 0.7, win: 1000 };

/** The three presets (§4.2). `weights` are the preset's changes to the defaults. */
export const AI_DIFFICULTIES = {
	easy: { mistakes: 0.3, lethal: false, plan: false, weights: { board: 1 } },
	normal: { mistakes: 0.1, lethal: true, plan: false, weights: {} },
	hard: { mistakes: 0, lethal: true, plan: true, weights: {} },
};

/** `hard`'s plan search keeps this many sequences … */
export const PLAN_WIDTH = 4;
/** … and extends them this many plays deep. */
export const PLAN_DEPTH = 3;
/** Every `apply` one decision may make, the lethal search's included. */
export const MAX_PLAN_APPLIES = 600;
/** The part of that budget the lethal search may spend. */
export const MAX_LETHAL_APPLIES = 100;

/**
 * The streams a trial runs on in place of the match's, one per quarter of [0, 1): each is the
 * smallest state whose first draw falls in the middle of its quarter (`check:card-ai` pins that),
 * so a random pick from two or four targets is weighed exactly, and from any other number closely.
 */
const SAMPLE_STATES = [51, 18, 1, 30];

/**
 * A difficulty's settings with the weights resolved: the defaults, then the preset's, then the
 * deck's `weights`. Only the known weights are read; a known weight that is not a finite number
 * throws, as does an unknown difficulty.
 */
export function aiSettings({ difficulty = 'normal', weights } = {}) {
	const preset = Object.hasOwn(AI_DIFFICULTIES, difficulty) ? AI_DIFFICULTIES[difficulty] : null;
	if (!preset) throw new Error(`cardAi: unknown difficulty ${JSON.stringify(difficulty)}`);
	const resolved = { ...AI_WEIGHT_DEFAULTS, ...preset.weights };
	for (const key of Object.keys(AI_WEIGHT_DEFAULTS)) {
		const value = weights?.[key];
		if (value === undefined) continue;
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new Error(`cardAi: the weight ${key} must be a finite number (got ${String(value)})`);
		}
		resolved[key] = value;
	}
	const { mistakes, lethal, plan } = preset;
	return { difficulty, mistakes, lethal, plan, weights: resolved };
}

/** The AI for one side of a match: its settings and its own stream, as a value. */
export function createAi({ seed, side, difficulty, weights }) {
	if (side !== 0 && side !== 1) throw new Error(`cardAi: side must be 0 or 1 (got ${side})`);
	return {
		side,
		settings: aiSettings({ difficulty, weights }),
		rngState: rngSeed(`${seed}:ai:${side}`),
	};
}

/**
 * How good the match is for `side` (§4.1): a weighted sum of the hero health difference, the board
 * difference (attack plus remaining health), the `guard` and `shield` difference, the hand
 * difference, and `win` for a won match (taken off for a lost one). A unit is counted as it will be
 * once its `endOfTurn` buffs expire.
 */
export function evaluate(match, side, weights = AI_WEIGHT_DEFAULTS) {
	const w = weights === AI_WEIGHT_DEFAULTS ? weights : { ...AI_WEIGHT_DEFAULTS, ...weights };
	const me = match.players[side];
	const foe = match.players[1 - side];
	let score =
		w.health * (me.health - foe.health) +
		w.board * (boardValue(me) - boardValue(foe)) +
		w.keyword * (keywordCount(me) - keywordCount(foe)) +
		w.hand * (me.hand.length - foe.hand.length);
	if (match.result?.winner === side) score += w.win;
	else if (match.result?.winner === 1 - side) score -= w.win;
	return score;
}

function boardValue(player) {
	let value = 0;
	for (const unit of player.board) {
		let attack = unit.attack;
		let health = unit.health;
		let damage = unit.damage;
		let lapsing = 0;
		for (const buff of unit.buffs) {
			if (buff.until !== 'endOfTurn') continue;
			attack -= buff.attack;
			health -= buff.health;
			lapsing += buff.health;
		}
		if (lapsing > 0) {
			health = Math.max(1, health);
			damage = Math.min(damage, health - 1);
		}
		value += Math.max(0, attack) + Math.max(0, health - damage);
	}
	return value;
}

const keywordCount = (player) =>
	player.board.reduce(
		(n, unit) => n + unit.keywords.filter((k) => k === 'guard' || k === 'shield').length,
		0,
	);

/**
 * The AI's next action for the match, which must wait on its side. A roll on the AI's own stream
 * decides a mistake (a random legal action); otherwise: a win in `combat` if one is there (`lethal`),
 * the best plan in `main` (`plan`), or the best single action. Doing nothing (`endPhase`) is scored
 * too and wins ties; among the rest the first listed wins. Never concedes. `applies` is how many
 * `apply` calls the decision made. Never changes `match` or `ai`.
 */
export function chooseAction(ai, match) {
	if (match.result) throw new Error('cardAi: the match is over');
	if (match.active !== ai.side) throw new Error(`cardAi: it is not side ${ai.side}'s turn`);
	const actions = legalActions(match).filter((a) => a.type !== 'concede');
	const budget = { applies: 0 };
	const roll = rngNext(ai.rngState);
	let rngState = roll.state;
	let action;
	if (roll.value < ai.settings.mistakes) {
		const pick = rngNext(rngState);
		rngState = pick.state;
		action = actions[Math.floor(pick.value * actions.length)];
	} else {
		action = bestAction(match, ai, actions, budget);
	}
	return { action, ai: { ...ai, rngState }, applies: budget.applies };
}

function bestAction(match, ai, actions, budget) {
	const { side, settings } = ai;
	if (settings.lethal && match.phase === 'combat') {
		const win = findLethal(match, side, budget, budget.applies + MAX_LETHAL_APPLIES);
		if (win) return win;
	}
	if (settings.plan && match.phase === 'main') return planMain(match, side, settings, budget);
	let best = { action: { type: 'endPhase' }, score: evaluate(match, side, settings.weights) };
	for (const action of actions) {
		if (action.type === 'endPhase') continue;
		const result = trial(match, action, side, settings.weights, budget);
		if (!result) break;
		if (wins(result, side)) return action;
		if (result.score > best.score) best = { action, score: result.score };
	}
	return best.action;
}

/** A trial that ends the match won without a draw from the stream: a win to take now. */
const wins = (result, side) => result.certain && result.match.result?.winner === side;

/**
 * Beam search over plays (§4.2 `plan`): from the match, every play is tried; the PLAN_WIDTH best
 * sequences are extended by every play, PLAN_DEPTH plays deep. The first play of the best sequence
 * found at any depth is taken, or `endPhase` when none beats the match as it is. A sequence plays
 * only cards in the hand now: a card a trial drew is the deck's hidden order. A play whose trial
 * drew from the stream ends its sequence, scored by its mean: what follows it is a guess.
 */
function planMain(match, side, settings, budget) {
	const hand = new Set(match.players[side].hand.map((card) => card.uid));
	let best = { score: evaluate(match, side, settings.weights), first: { type: 'endPhase' } };
	let beam = [{ match, first: null }];
	for (let depth = 0; depth < PLAN_DEPTH && beam.length; depth++) {
		const children = [];
		search: for (const node of beam) {
			for (const action of legalActions(node.match)) {
				if (action.type !== 'play' || !hand.has(action.uid)) continue;
				const result = trial(node.match, action, side, settings.weights, budget);
				if (!result) break search;
				if (depth === 0 && wins(result, side)) return action;
				const child = { match: result.match, first: node.first ?? action, score: result.score };
				if (child.score > best.score) best = child;
				if (result.certain && !result.match.result) children.push(child);
			}
		}
		children.sort((a, b) => b.score - a.score);
		beam = children.slice(0, PLAN_WIDTH);
	}
	return best.first;
}

/**
 * An action tried on copies of the match, each on a sample stream in place of the match's own. When
 * the first copy draws nothing the action is `certain` and that one copy is its score; otherwise the
 * score is the mean over every sample. `match` is the first copy's result, to search on from. `null`
 * when the budget is spent before the first copy.
 */
function trial(match, action, side, weights, budget) {
	let total = 0;
	let first = null;
	for (let k = 0; k < SAMPLE_STATES.length; k++) {
		if (budget.applies >= MAX_PLAN_APPLIES) {
			return first && { score: total / k, match: first, certain: false };
		}
		budget.applies += 1;
		const next = apply({ ...match, rngState: SAMPLE_STATES[k] }, action).match;
		const score = evaluate(next, side, weights);
		if (k === 0) {
			first = next;
			if (next.rngState === SAMPLE_STATES[0]) return { score, match: next, certain: true };
		}
		total += score;
	}
	return { score: total / SAMPLE_STATES.length, match: first, certain: false };
}

/**
 * The first attack of a sequence of attacks that wins this turn, or `null`, searched depth first:
 * at each `guard` while one stands in the way; then at the enemy hero, with the first attacker (in
 * board order) whose attack draws nothing. A branch that draws from the stream is not counted as a
 * win: its result is a guess. Skipped outright when the ready units and their `onAttack` damage
 * cannot reach the hero's health. Stops at `limit` applies.
 */
function findLethal(match, side, budget, limit) {
	if (match.phase !== 'combat' || match.active !== side) return null;
	if (reach(match, side) < match.players[1 - side].health) return null;
	const attacks = legalActions(match).filter((a) => a.type === 'attack');
	const atHero = attacks.some((a) => 'hero' in a.target);
	for (const action of atHero ? attacks.filter((a) => 'hero' in a.target) : attacks) {
		if (budget.applies >= limit || budget.applies >= MAX_PLAN_APPLIES) return null;
		budget.applies += 1;
		const next = apply({ ...match, rngState: SAMPLE_STATES[0] }, action).match;
		if (next.rngState !== SAMPLE_STATES[0]) continue;
		if (next.result) {
			if (next.result.winner === side) return action;
			if (atHero) return null;
			continue;
		}
		const win = findLethal(next, side, budget, limit);
		if (win || atHero) return win && action;
	}
	return null;
}

/**
 * The most the ready units could deal the enemy hero this turn: attack plus `onAttack` damage. Our
 * units' `onDamaged` and `onDeath` damage is not counted, so a lethal that needs it is not sought.
 */
function reach(match, side) {
	let total = 0;
	for (const unit of match.players[side].board) {
		const ready =
			unit.attacksLeft > 0 &&
			(unit.summonedOnTurn !== match.turn || unit.keywords.includes('swift'));
		if (!ready) continue;
		total += Math.max(0, unit.attack);
		for (const effect of match.library[unit.cardId].effects ?? []) {
			if (effect.trigger !== 'onAttack') continue;
			if (effect.verb === 'damage' && effect.target.kind !== 'self') total += effect.amount;
			if (effect.verb === 'buff' && effect.attack > 0) total += effect.attack;
		}
	}
	return total;
}

/**
 * A match played from its record (§4.3): `ai` seats one or two AIs; every other turn takes the
 * next of `actions`, the player's, in order. Stops when the match ends or the player's actions run
 * out on the player's turn; a record with actions the match never reached throws. `log` is every
 * action taken, both sides', in order.
 */
export function replayMatch({ seed, decks, library, rules, first, ai, actions = [] }) {
	const seats = [null, null];
	for (const seat of ai) {
		if (seats[seat.side]) throw new Error(`cardAi: side ${seat.side} is seated twice`);
		seats[seat.side] = createAi({ seed, ...seat });
	}
	const start = createMatch({ seed, decks, library, rules, first });
	let match = start.match;
	const events = [...start.events];
	const log = [];
	let next = 0;
	while (!match.result) {
		const side = match.active;
		let action;
		if (seats[side]) {
			const choice = chooseAction(seats[side], match);
			seats[side] = choice.ai;
			action = choice.action;
		} else if (next < actions.length) {
			action = actions[next++];
		} else break;
		const step = apply(match, action);
		match = step.match;
		events.push(...step.events);
		log.push({ side, action });
	}
	if (next < actions.length) {
		throw new Error(`cardAi: the match never reached ${actions.length - next} recorded action(s)`);
	}
	return { match, events, log };
}
