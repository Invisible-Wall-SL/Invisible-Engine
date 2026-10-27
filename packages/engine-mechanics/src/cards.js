// Invisible Engine — the CARD rules engine (docs/design/card-games.md §2–§3, C1).
//
// A duel's whole rule set as plain functions over a match value: the four zones, the turn phases,
// the resource, the legal actions, the effect queue, the death check, fatigue and the loop and turn
// limits. No drawing and no imports beyond the generator it shares with `board.js`, so the shared
// runtime, the Card Library's test match and the AI (which tries a move on a copy and throws it
// away) all play the same rules. Types live in `cards.d.ts`; the behaviour is pinned by
// `scripts/check-card-rules.mjs` and `scripts/check-card-library.mjs`.
//
// NOTHING MUTATES ITS INPUT. `apply` copies the match and changes only the copy. The random stream
// is a number in the value (`rngState`), stepped with `rngNext`, never a closure: a copy made for a
// look-ahead cannot advance the real match's draws.
//
// EFFECTS ARE DATA from closed lists (§3): one trigger, one verb, one target each. A reader drops
// what it does not know (docs/conventions/doc-readers.md); the validator refuses it on a save.

import { rngNext, rngSeed } from './board.js';

export const CARD_KEYWORDS = ['guard', 'swift', 'shield'];
export const CARD_TRIGGERS = ['onPlay', 'onDeath', 'turnStart', 'onAttack', 'onDamaged'];
export const CARD_TARGET_KINDS = ['self', 'chosen', 'allEnemies', 'randomEnemy'];
export const CARD_VERBS = ['damage', 'heal', 'draw', 'summon', 'buff', 'destroy', 'giveKeyword'];

/** What each verb may aim at (§3.2): `any` target, `units` only, or no target at all. */
export const CARD_VERB_TARGETS = {
	damage: 'any',
	heal: 'any',
	draw: 'none',
	summon: 'none',
	buff: 'units',
	destroy: 'units',
	giveKeyword: 'units',
};

/** The rules a match plays by when the config leaves them out (§9.1). */
export const CARD_RULE_DEFAULTS = {
	startHealth: 30,
	openingHand: 3,
	handLimit: 10,
	boardLimit: 7,
	resource: { start: 1, perTurn: 1, max: 10 },
	turnLimit: 60,
};

/** Effects one action may resolve before the match is called a draw (§2.4). */
export const MAX_QUEUE_STEPS = 500;

const MAX_EFFECTS = 3;
const RANGES = {
	cost: [0, 10],
	attack: [0, 20],
	health: [1, 20],
	damage: [1, 20],
	heal: [1, 20],
	draw: [1, 5],
	count: [1, 3],
	buff: [-10, 10],
};
const SIDES = ['enemy', 'friendly', 'any'];
const INCLUDES = ['units', 'characters'];
const UNTILS = ['endOfTurn', 'permanent'];

export class IllegalAction extends Error {
	constructor(code, message) {
		super(`cards: ${message}`);
		this.name = 'IllegalAction';
		this.code = code;
	}
}

// ---- reading and validating a library ----------------------------------------------------------

/**
 * A library as the rules read it: known fields only. An unknown field is dropped; an unknown verb,
 * trigger, target kind, side, include or `until` drops its effect, an unknown keyword drops the
 * keyword and an unknown card type drops the card. Each drop is named in `dropped` as a path, for
 * the caller to warn with. Known fields are kept as written, malformed or not: that is the
 * validator's business.
 */
export function readLibrary(library) {
	const dropped = [];
	const cards = [];
	(Array.isArray(library) ? library : []).forEach((raw, i) => {
		const at = `[${i}]${typeof raw?.id === 'string' ? ` (${raw.id})` : ''}`;
		if (!isRecord(raw)) {
			dropped.push(`${at}: not a card`);
			return;
		}
		if (unknownIn(['unit', 'spell'], raw.type)) {
			dropped.push(`${at}: type "${raw.type}"`);
			return;
		}
		const card = {};
		for (const key of Object.keys(raw)) {
			if (CARD_FIELDS.has(key)) card[key] = raw[key];
			else dropped.push(`${at}.${key}`);
		}
		if (Array.isArray(raw.keywords)) {
			card.keywords = raw.keywords.filter((keyword) => {
				const unknown = unknownIn(CARD_KEYWORDS, keyword);
				if (unknown) dropped.push(`${at}.keywords: "${keyword}"`);
				return !unknown;
			});
		}
		if (Array.isArray(raw.effects)) {
			card.effects = [];
			raw.effects.forEach((effect, e) => {
				const read = readEffect(effect, `${at}.effects[${e}]`, dropped);
				if (read) card.effects.push(read);
			});
		}
		cards.push(card);
	});
	return { library: cards, dropped };
}

const CARD_FIELDS = new Set([
	'id',
	'name',
	'type',
	'cost',
	'attack',
	'health',
	'keywords',
	'effects',
	'flavor',
	'frame',
	'params',
	'token',
]);
const EFFECT_FIELDS = {
	damage: ['amount', 'target'],
	heal: ['amount', 'target'],
	draw: ['amount'],
	summon: ['card', 'count'],
	buff: ['attack', 'health', 'until', 'target'],
	destroy: ['target'],
	giveKeyword: ['keyword', 'target'],
};
const TARGET_FIELDS = {
	self: [],
	chosen: ['side', 'include'],
	allEnemies: ['include'],
	randomEnemy: ['include'],
};

function readEffect(raw, at, dropped) {
	if (!isRecord(raw)) {
		dropped.push(`${at}: not an effect`);
		return null;
	}
	const unknown = unknownValue(raw);
	if (unknown) {
		dropped.push(`${at}: ${unknown}`);
		return null;
	}
	if (!fieldsOf(EFFECT_FIELDS, raw.verb)) return { ...raw };
	const effect = { trigger: raw.trigger, verb: raw.verb };
	for (const key of Object.keys(raw)) {
		if (key === 'trigger' || key === 'verb') continue;
		if (!EFFECT_FIELDS[raw.verb].includes(key)) {
			dropped.push(`${at}.${key}`);
			continue;
		}
		effect[key] = key === 'target' ? readTarget(raw.target, `${at}.target`, dropped) : raw[key];
	}
	return effect;
}

/**
 * The first value outside a closed list that drops the whole effect, described; else null. Only a
 * string can be unknown: a missing value or one of the wrong type is malformed, kept for the
 * validator to refuse (doc-readers.md, "What counts as unknown").
 */
function unknownValue(raw) {
	if (unknownIn(CARD_TRIGGERS, raw.trigger)) return `trigger "${raw.trigger}"`;
	if (unknownIn(CARD_VERBS, raw.verb)) return `verb "${raw.verb}"`;
	if (raw.verb === 'giveKeyword' && unknownIn(CARD_KEYWORDS, raw.keyword)) {
		return `keyword "${raw.keyword}"`;
	}
	if (raw.verb === 'buff' && unknownIn(UNTILS, raw.until)) return `until "${raw.until}"`;
	const target = raw.target;
	if (!isRecord(target)) return null;
	if (unknownIn(CARD_TARGET_KINDS, target.kind)) return `target "${target.kind}"`;
	const fields = fieldsOf(TARGET_FIELDS, target.kind) ?? [];
	if (fields.includes('side') && unknownIn(SIDES, target.side)) return `side "${target.side}"`;
	if (fields.includes('include') && unknownIn(INCLUDES, target.include)) {
		return `include "${target.include}"`;
	}
	return null;
}

const unknownIn = (list, value) => typeof value === 'string' && !list.includes(value);
const fieldsOf = (table, key) =>
	typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;

function readTarget(raw, at, dropped) {
	if (!isRecord(raw) || !fieldsOf(TARGET_FIELDS, raw.kind)) return raw;
	const target = { kind: raw.kind };
	for (const key of Object.keys(raw)) {
		if (key === 'kind') continue;
		if (TARGET_FIELDS[raw.kind].includes(key)) target[key] = raw[key];
		else dropped.push(`${at}.${key}`);
	}
	return target;
}

/**
 * Every schema and closed-list problem in a library (§3.6), as issues: an `error` refuses a save, a
 * `warning` shows. `decks`, when given, adds the deck warnings (a card no deck uses, a token in a
 * deck). Unknown fields are not issues: a reader drops them.
 */
export function validateLibrary(library, { decks } = {}) {
	const issues = [];
	const list = Array.isArray(library) ? library : [];
	const byId = new Map();
	list.forEach((card, i) => {
		const where = typeof card?.id === 'string' && card.id ? card.id : `#${i}`;
		const error = (code, message, path = '') =>
			issues.push({ severity: 'error', code, card: where, path, message });
		if (!isRecord(card)) return error('card', 'is not a card');
		if (typeof card.id !== 'string' || !card.id) error('id', 'needs an id');
		else if (byId.has(card.id)) error('duplicateId', `the id "${card.id}" is used twice`);
		else byId.set(card.id, card);
		if (typeof card.name !== 'string' || !card.name) error('name', 'needs a name', 'name');
		if (card.type !== 'unit' && card.type !== 'spell') {
			error('type', `type must be "unit" or "spell" (got ${show(card.type)})`, 'type');
		}
		checkRange(card.cost, 'cost', 'cost', error);
		if (card.type === 'unit') {
			checkRange(card.attack, 'attack', 'attack', error);
			checkRange(card.health, 'health', 'health', error);
		}
		if (card.type === 'spell') {
			for (const field of ['attack', 'health', 'keywords']) {
				if (card[field] !== undefined) error('spellStats', `a spell has no ${field}`, field);
			}
		}
		if (card.keywords !== undefined) {
			if (!Array.isArray(card.keywords)) error('keyword', 'keywords must be a list', 'keywords');
			else {
				card.keywords.forEach((keyword, k) => {
					if (!CARD_KEYWORDS.includes(keyword)) {
						error('keyword', `unknown keyword ${show(keyword)}`, `keywords[${k}]`);
					}
				});
			}
		}
		if (card.effects !== undefined && !Array.isArray(card.effects)) {
			error('effects', 'effects must be a list', 'effects');
		} else if (card.effects) {
			if (card.effects.length > MAX_EFFECTS) {
				error(
					'effectCount',
					`has ${card.effects.length} effects; at most ${MAX_EFFECTS}`,
					'effects',
				);
			}
			card.effects.forEach((effect, e) => checkEffect(card, effect, `effects[${e}]`, error));
		}
	});
	list.forEach((card) => {
		if (!isRecord(card) || !Array.isArray(card.effects)) return;
		card.effects.forEach((effect, e) => {
			if (effect?.verb !== 'summon' || typeof effect.card !== 'string') return;
			const summoned = byId.get(effect.card);
			const where = typeof card.id === 'string' && card.id ? card.id : '?';
			if (!summoned) {
				issues.push(
					issue(
						'error',
						'summonCard',
						where,
						`effects[${e}].card`,
						`summons "${effect.card}", which is not in the library`,
					),
				);
			} else if (summoned.type !== 'unit') {
				issues.push(
					issue(
						'error',
						'summonCard',
						where,
						`effects[${e}].card`,
						`summons "${effect.card}", which is not a unit`,
					),
				);
			}
		});
	});
	for (const id of summonCycles(list)) {
		issues.push(
			issue(
				'warning',
				'summonLoop',
				id,
				'effects',
				'its summons can lead back to itself; a match that loops ends as a draw',
			),
		);
	}
	if (Array.isArray(decks)) {
		const used = new Set();
		decks.forEach((deck, d) => {
			for (const id of deckIds(deck?.cards ?? deck)) {
				used.add(id);
				if (byId.get(id)?.token) {
					issues.push(
						issue(
							'warning',
							'tokenInDeck',
							id,
							'',
							`is a token but deck ${deckName(deck, d)} holds it`,
						),
					);
				}
			}
		});
		for (const [id, card] of byId) {
			if (!card.token && !used.has(id)) {
				issues.push(issue('warning', 'unused', id, '', 'no deck uses it'));
			}
		}
	}
	return issues;
}

function checkEffect(card, effect, at, error) {
	if (!isRecord(effect)) return error('effect', 'is not an effect', at);
	if (!CARD_TRIGGERS.includes(effect.trigger)) {
		error('trigger', `unknown trigger ${show(effect.trigger)}`, `${at}.trigger`);
	}
	if (!CARD_VERBS.includes(effect.verb)) {
		return error('verb', `unknown verb ${show(effect.verb)}`, `${at}.verb`);
	}
	if (
		card.type === 'spell' &&
		effect.trigger !== 'onPlay' &&
		CARD_TRIGGERS.includes(effect.trigger)
	) {
		error(
			'spellTrigger',
			`a spell's effects are all onPlay (got ${effect.trigger})`,
			`${at}.trigger`,
		);
	}
	const verb = effect.verb;
	if (verb === 'damage' || verb === 'heal' || verb === 'draw') {
		checkRange(effect.amount, verb, `${at}.amount`, error);
	}
	if (verb === 'summon') {
		if (typeof effect.card !== 'string' || !effect.card)
			error('summonCard', 'summons no card', `${at}.card`);
		if (effect.count !== undefined) checkRange(effect.count, 'count', `${at}.count`, error);
	}
	if (verb === 'buff') {
		checkRange(effect.attack, 'buff', `${at}.attack`, error);
		checkRange(effect.health, 'buff', `${at}.health`, error);
		if (!UNTILS.includes(effect.until)) {
			error(
				'until',
				`until must be "endOfTurn" or "permanent" (got ${show(effect.until)})`,
				`${at}.until`,
			);
		}
	}
	if (verb === 'giveKeyword' && !CARD_KEYWORDS.includes(effect.keyword)) {
		error('keyword', `unknown keyword ${show(effect.keyword)}`, `${at}.keyword`);
	}
	const allowed = CARD_VERB_TARGETS[verb];
	if (allowed === 'none') {
		if (effect.target !== undefined)
			error('targetNotAllowed', `${verb} takes no target`, `${at}.target`);
		return;
	}
	checkTarget(card, effect, allowed, `${at}.target`, error);
}

function checkTarget(card, effect, allowed, at, error) {
	const target = effect.target;
	if (!isRecord(target)) return error('target', `${effect.verb} needs a target`, at);
	if (!CARD_TARGET_KINDS.includes(target.kind)) {
		return error('target', `unknown target ${show(target.kind)}`, `${at}.kind`);
	}
	if (target.kind === 'self' && card.type === 'spell') {
		error('selfOnSpell', 'a spell has no self to target', at);
	}
	if (target.kind === 'chosen') {
		if (effect.trigger !== 'onPlay') {
			error(
				'chosenOffPlay',
				`a chosen target is only on an onPlay effect (got ${effect.trigger})`,
				at,
			);
		}
		if (!SIDES.includes(target.side))
			error('side', `unknown side ${show(target.side)}`, `${at}.side`);
	}
	if (target.kind !== 'self') {
		if (!INCLUDES.includes(target.include)) {
			error(
				'include',
				`include must be "units" or "characters" (got ${show(target.include)})`,
				`${at}.include`,
			);
		} else if (allowed === 'units' && target.include === 'characters') {
			error('targetNotAllowed', `${effect.verb} can only target units`, `${at}.include`);
		}
	}
}

function checkRange(value, range, path, error) {
	const [min, max] = RANGES[range];
	if (!Number.isInteger(value) || value < min || value > max) {
		error(
			'range',
			`${path} must be a whole number from ${min} to ${max} (got ${show(value)})`,
			path,
		);
	}
}

/**
 * Cards whose death or damage summons lead, card to card, back to themselves. Only `onDeath` and
 * `onDamaged` can fire again inside one action; a `turnStart` or `onAttack` summon fires once per
 * turn or attack, so it cannot loop.
 */
function summonCycles(list) {
	const edges = new Map();
	for (const card of list) {
		if (!isRecord(card) || typeof card.id !== 'string' || !Array.isArray(card.effects)) continue;
		const next = card.effects
			.filter((e) => e?.verb === 'summon' && (e.trigger === 'onDeath' || e.trigger === 'onDamaged'))
			.map((e) => e.card);
		edges.set(card.id, next);
	}
	const looping = [];
	for (const start of edges.keys()) {
		const seen = new Set();
		const stack = [...edges.get(start)];
		while (stack.length) {
			const id = stack.pop();
			if (id === start) {
				looping.push(start);
				break;
			}
			if (seen.has(id)) continue;
			seen.add(id);
			stack.push(...(edges.get(id) ?? []));
		}
	}
	return looping;
}

const issue = (severity, code, card, path, message) => ({ severity, code, card, path, message });
const deckName = (deck, d) => (typeof deck?.id === 'string' ? `"${deck.id}"` : `#${d}`);

// ---- the rules text ----------------------------------------------------------------------------

const TRIGGER_TEXT = {
	onDeath: 'when this dies',
	turnStart: 'at the start of your turn',
	onAttack: 'when this attacks',
	onDamaged: 'when this takes damage',
};

/**
 * The rules text, one English sentence per effect in authored order (§3.6). The sentences are the
 * localization keys, so two cards that say the same thing share a translation.
 */
export function cardText(card, library = []) {
	const names = new Map(
		(Array.isArray(library) ? library : []).map((entry) => [entry?.id, entry?.name]),
	);
	return (card?.effects ?? []).map((effect) => {
		const action = verbText(effect, names);
		const when =
			effect.trigger === 'onPlay'
				? card.type === 'unit'
					? 'when played'
					: ''
				: TRIGGER_TEXT[effect.trigger];
		return `${capitalize(when ? `${when}, ${action}` : action)}.`;
	});
}

function verbText(effect, names) {
	const target = () => targetText(effect.target);
	switch (effect.verb) {
		case 'damage':
			return `deal ${effect.amount} damage to ${target()}`;
		case 'heal':
			return `restore ${effect.amount} health to ${target()}`;
		case 'draw':
			return effect.amount === 1 ? 'draw a card' : `draw ${effect.amount} cards`;
		case 'summon': {
			const name = names.get(effect.card) ?? effect.card;
			const count = effect.count ?? 1;
			return count === 1 ? `summon a copy of ${name}` : `summon ${count} copies of ${name}`;
		}
		case 'buff': {
			const stats = `${signed(effect.attack)}/${signed(effect.health)}`;
			return `give ${target()} ${stats}${effect.until === 'endOfTurn' ? ' until the end of the turn' : ''}`;
		}
		case 'destroy':
			return `destroy ${target()}`;
		case 'giveKeyword':
			return `give ${target()} ${capitalize(effect.keyword)}`;
		default:
			return '';
	}
}

function targetText(target) {
	const noun = (include, plural) =>
		include === 'characters' ? (plural ? 'characters' : 'character') : plural ? 'units' : 'unit';
	switch (target?.kind) {
		case 'self':
			return 'this unit';
		case 'chosen': {
			const side = target.side === 'any' ? '' : `${target.side} `;
			return `a chosen ${side}${noun(target.include)}`;
		}
		case 'allEnemies':
			return `all enemy ${noun(target.include, true)}`;
		case 'randomEnemy':
			return `a random enemy ${noun(target.include)}`;
		default:
			return '';
	}
}

const signed = (n) => (n < 0 ? `${n}` : `+${n}`);
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// ---- a match -----------------------------------------------------------------------------------

/**
 * A new match: both decks shuffled, the opening hands dealt (the second player gets one more) and
 * turn 1 run to `main`. `decks[0]` is side 0's. `first` is 0, 1 or `'random'` (drawn from the
 * match's stream). Throws on a library with errors, a deck naming a card the library lacks, or
 * malformed rules. `dropped` is what reading the library dropped (`readLibrary`), for the caller
 * to warn with.
 */
export function createMatch({ seed, decks, library, rules, first = 'random' }) {
	const read = readLibrary(library);
	const errors = validateLibrary(read.library).filter((i) => i.severity === 'error');
	if (errors.length) {
		throw new Error(
			`cards: the library has ${errors.length} error(s): ${errors.map((i) => `${i.card} ${i.message}`).join('; ')}`,
		);
	}
	if (!Array.isArray(decks) || decks.length !== 2)
		throw new Error('cards: a match needs two decks');
	if (first !== 0 && first !== 1 && first !== 'random') {
		throw new Error(`cards: first must be 0, 1 or "random" (got ${show(first)})`);
	}
	const byId = Object.fromEntries(read.library.map((card) => [card.id, card]));
	const resolved = resolveRules(rules);
	const ctx = context({
		seed,
		rngState: rngSeed(seed),
		turn: 1,
		active: 0,
		phase: 'start',
		players: [0, 1].map(() => ({
			health: resolved.startHealth,
			maxHealth: resolved.startHealth,
			resource: { current: 0, max: 0 },
			fatigue: 1,
			deck: [],
			hand: [],
			board: [],
			discard: [],
		})),
		queue: [],
		nextUid: 1,
		result: null,
		rules: resolved,
		library: byId,
	});
	const m = ctx.match;
	decks.forEach((deck, side) => {
		if (!Array.isArray(deck)) throw new Error(`cards: deck ${side} is not a list of cards`);
		for (const id of deckIds(deck)) {
			if (!byId[id])
				throw new Error(`cards: deck ${side} names "${id}", which is not in the library`);
			m.players[side].deck.push(instance(m, id, side));
		}
	});
	m.active = first === 'random' ? (draw(m) < 0.5 ? 0 : 1) : first;
	for (const player of m.players) shuffle(m, player.deck);
	const second = 1 - m.active;
	for (let i = 0; i < resolved.openingHand; i++) drawCard(ctx, m.active);
	for (let i = 0; i < resolved.openingHand + 1; i++) drawCard(ctx, second);
	beginTurn(ctx);
	return { match: m, events: ctx.events, dropped: read.dropped };
}

/** Each rule's smallest allowed value; every rule is a whole number. */
const RULE_MINIMUMS = {
	startHealth: 1,
	openingHand: 0,
	handLimit: 1,
	boardLimit: 1,
	turnLimit: 1,
	start: 0,
	perTurn: 0,
	max: 0,
};

function resolveRules(rules = {}) {
	const d = CARD_RULE_DEFAULTS;
	if (rules !== undefined && !isRecord(rules))
		throw new Error('cards: the rules must be an object');
	const r = rules ?? {};
	if (r.resource !== undefined && !isRecord(r.resource)) {
		throw new Error('cards: the rule resource must be an object');
	}
	const resource = r.resource ?? {};
	const rule = (source, key, fallback) => {
		const value = source[key] ?? fallback;
		if (!Number.isInteger(value) || value < RULE_MINIMUMS[key]) {
			throw new Error(
				`cards: the rule ${key} must be a whole number of at least ${RULE_MINIMUMS[key]} (got ${show(value)})`,
			);
		}
		return value;
	};
	return {
		startHealth: rule(r, 'startHealth', d.startHealth),
		openingHand: rule(r, 'openingHand', d.openingHand),
		handLimit: rule(r, 'handLimit', d.handLimit),
		boardLimit: rule(r, 'boardLimit', d.boardLimit),
		resource: {
			start: rule(resource, 'start', d.resource.start),
			perTurn: rule(resource, 'perTurn', d.resource.perTurn),
			max: rule(resource, 'max', d.resource.max),
		},
		turnLimit: rule(r, 'turnLimit', d.turnLimit),
	};
}

/** Whether the match has a result. */
export function isOver(match) {
	return match.result !== null;
}

/**
 * Every action the active player may take now, in a fixed order: plays in hand order (each legal
 * target in turn, enemies first, units in board order before the hero), or attacks in board order,
 * then `endPhase`, then `concede`. A play is listed without `slot`: any slot from 0 to the board's
 * length is legal for a listed unit play.
 */
export function legalActions(match) {
	if (match.result) return [];
	const actions = [];
	const me = match.players[match.active];
	if (match.phase === 'main') {
		for (const card of me.hand) {
			if (!canPlay(match, card)) continue;
			const targets = chosenTargets(match, card);
			if (targets === null) actions.push({ type: 'play', uid: card.uid });
			else for (const target of targets) actions.push({ type: 'play', uid: card.uid, target });
		}
	} else if (match.phase === 'combat') {
		const targets = attackTargets(match);
		for (const unit of me.board) {
			if (!canAttack(match, unit)) continue;
			for (const target of targets) actions.push({ type: 'attack', attacker: unit.uid, target });
		}
	} else return [];
	actions.push({ type: 'endPhase' }, { type: 'concede' });
	return actions;
}

/**
 * The match after one action of the active player, and what happened, in order. The automatic
 * phases run inside: the match returned waits in `main` or `combat`, or has ended. Throws
 * {@link IllegalAction} for an action `legalActions` would not allow.
 */
export function apply(match, action) {
	if (match.result) throw new IllegalAction('over', 'the match is over');
	const ctx = context(copyMatch(match));
	const m = ctx.match;
	switch (action?.type) {
		case 'play':
			play(ctx, action);
			break;
		case 'attack':
			attack(ctx, action);
			break;
		case 'endPhase':
			if (m.phase === 'main') enterPhase(ctx, 'combat');
			else if (m.phase === 'combat') endTurn(ctx);
			else throw new IllegalAction('phase', `no phase to end in ${m.phase}`);
			break;
		case 'concede':
			finish(ctx, 1 - m.active, 'concede');
			break;
		default:
			throw new IllegalAction('action', `unknown action ${show(action?.type)}`);
	}
	return { match: m, events: ctx.events };
}

function play(ctx, action) {
	const m = ctx.match;
	if (m.phase !== 'main')
		throw new IllegalAction('phase', `cards are played in main, not ${m.phase}`);
	const me = m.players[m.active];
	const index = me.hand.findIndex((card) => card.uid === action.uid);
	if (index < 0) throw new IllegalAction('hand', `card ${action.uid} is not in the hand`);
	const card = me.hand[index];
	const def = m.library[card.cardId];
	if (def.cost > me.resource.current) {
		throw new IllegalAction(
			'cost',
			`${card.cardId} costs ${def.cost}; ${me.resource.current} left`,
		);
	}
	if (def.type === 'unit' && me.board.length >= m.rules.boardLimit) {
		throw new IllegalAction('boardFull', 'the board is full');
	}
	const targets = chosenTargets(m, card);
	const target = targets?.find((t) => sameTarget(t, action.target));
	if (targets === null) {
		if (action.target !== undefined)
			throw new IllegalAction('target', `${card.cardId} takes no target`);
	} else if (!target) {
		throw new IllegalAction('target', `${card.cardId} needs a legal chosen target`);
	}
	let slot = null;
	if (def.type === 'unit') {
		slot = action.slot ?? me.board.length;
		if (!Number.isInteger(slot) || slot < 0 || slot > me.board.length) {
			throw new IllegalAction('slot', `slot ${show(action.slot)} is not on the board`);
		}
	} else if (action.slot !== undefined) {
		throw new IllegalAction('slot', 'a spell takes no slot');
	}
	me.hand.splice(index, 1);
	me.resource.current -= def.cost;
	if (def.type === 'unit') {
		card.summonedOnTurn = m.turn;
		card.attacksLeft = 1;
		me.board.splice(slot, 0, card);
	} else {
		me.discard.push(card);
	}
	ctx.events.push({ type: 'played', player: m.active, uid: card.uid, slot });
	queueTrigger(m, card, 'onPlay', target ? { target } : {});
	settle(ctx);
}

function attack(ctx, action) {
	const m = ctx.match;
	if (m.phase !== 'combat')
		throw new IllegalAction('phase', `attacks are made in combat, not ${m.phase}`);
	const unit = m.players[m.active].board.find((u) => u.uid === action.attacker);
	if (!unit) throw new IllegalAction('attacker', `unit ${action.attacker} is not on your board`);
	if (unit.attacksLeft <= 0)
		throw new IllegalAction('exhausted', `unit ${unit.uid} has no attack left`);
	if (unit.summonedOnTurn === m.turn && !unit.keywords.includes('swift')) {
		throw new IllegalAction('arrived', `unit ${unit.uid} arrived this turn and is not swift`);
	}
	const target = attackTargets(m).find((t) => sameTarget(t, action.target));
	if (!target) throw new IllegalAction('target', 'that is not a legal attack target (guard?)');
	unit.attacksLeft -= 1;
	ctx.events.push({ type: 'attacked', attacker: unit.uid, target: { ...target } });
	queueTrigger(m, unit, 'onAttack');
	m.queue.push({ combat: true, attacker: unit.uid, target });
	settle(ctx);
}

function beginTurn(ctx) {
	const m = ctx.match;
	const me = m.players[m.active];
	ctx.events.push({ type: 'turnStarted', player: m.active, turn: m.turn });
	enterPhase(ctx, 'start');
	const { start, perTurn, max } = m.rules.resource;
	me.resource.max = m.turn <= 2 ? Math.min(start, max) : Math.min(max, me.resource.max + perTurn);
	me.resource.current = me.resource.max;
	for (const unit of me.board) unit.attacksLeft = 1;
	for (const unit of me.board) queueTrigger(m, unit, 'turnStart');
	settle(ctx);
	if (m.result) return;
	enterPhase(ctx, 'draw');
	if (m.turn > 1) {
		drawCard(ctx, m.active);
		settle(ctx);
		if (m.result) return;
	}
	enterPhase(ctx, 'main');
}

function endTurn(ctx) {
	const m = ctx.match;
	enterPhase(ctx, 'end');
	const expired = [];
	for (const side of turnOrder(m)) {
		for (const unit of m.players[side].board) {
			const lapsing = unit.buffs.filter((b) => b.until === 'endOfTurn');
			if (!lapsing.length) continue;
			const health = lapsing.reduce((sum, b) => sum + b.health, 0);
			unit.attack -= lapsing.reduce((sum, b) => sum + b.attack, 0);
			unit.health -= health;
			if (health > 0) {
				unit.health = Math.max(1, unit.health);
				unit.damage = Math.min(unit.damage, unit.health - 1);
			}
			unit.buffs = unit.buffs.filter((b) => b.until !== 'endOfTurn');
			expired.push(unit.uid);
		}
	}
	if (expired.length) ctx.events.push({ type: 'buffsExpired', uids: expired });
	const raised = [];
	deathCheck(ctx, new Set(), raised);
	queueRaised(m, raised);
	settle(ctx);
	if (m.result) return;
	if (m.turn >= m.rules.turnLimit) return finish(ctx, 'draw', 'turnLimit');
	m.turn += 1;
	m.active = 1 - m.active;
	beginTurn(ctx);
}

function enterPhase(ctx, phase) {
	ctx.match.phase = phase;
	ctx.events.push({ type: 'phaseChanged', phase });
}

function finish(ctx, winner, reason) {
	const m = ctx.match;
	m.result = { winner, reason };
	m.queue = [];
	ctx.events.push({ type: 'matchEnded', winner, reason });
}

// ---- the effect queue --------------------------------------------------------------------------

/**
 * Resolves the queue front to back, one effect at a time, with a death check after each (§2.4).
 * When it is empty, a hero at 0 ends the match. Past {@link MAX_QUEUE_STEPS} effects in one action
 * the match is a draw by `loop`.
 */
function settle(ctx) {
	const m = ctx.match;
	while (m.queue.length && !m.result) {
		if (ctx.steps >= MAX_QUEUE_STEPS) return finish(ctx, 'draw', 'loop');
		ctx.steps += 1;
		const item = m.queue.shift();
		const raised = [];
		const doomed = new Set();
		if (item.combat) resolveCombat(ctx, item, raised);
		else resolveEffect(ctx, item, raised, doomed);
		deathCheck(ctx, doomed, raised);
		queueRaised(m, raised);
	}
	if (m.result) return;
	const [a, b] = m.players.map((p) => p.health <= 0);
	if (a && b) finish(ctx, 'draw', 'hero');
	else if (a) finish(ctx, 1, 'hero');
	else if (b) finish(ctx, 0, 'hero');
}

/** Queues a card's effects for one trigger, in authored order. */
function queueTrigger(m, card, trigger, extra = {}) {
	m.queue.push(...effectsFor(m, card, trigger, extra));
}

function effectsFor(m, card, trigger, extra = {}) {
	const effects = m.library[card.cardId].effects ?? [];
	const items = [];
	effects.forEach((effect, index) => {
		if (effect.trigger === trigger) {
			items.push({ source: card.uid, owner: card.owner, cardId: card.cardId, index, ...extra });
		}
	});
	return items;
}

/**
 * Triggers an effect raised (`onDamaged`, then the death check's `onDeath`) go to the back: the
 * active player's first, then in board order. Positions are read before the dead leave the board,
 * and the sort is stable, so one unit's `onDamaged` stays ahead of its `onDeath`.
 */
function queueRaised(m, raised) {
	raised.sort((a, b) => rank(m, a.owner) - rank(m, b.owner) || a.pos - b.pos);
	for (const entry of raised) m.queue.push(...entry.items);
}

const rank = (m, owner) => (owner === m.active ? 0 : 1);
const turnOrder = (m) => [m.active, 1 - m.active];

function resolveEffect(ctx, item, raised, doomed) {
	const m = ctx.match;
	const effect = m.library[item.cardId].effects[item.index];
	const owner = item.owner;
	switch (effect.verb) {
		case 'draw':
			for (let i = 0; i < effect.amount; i++) drawCard(ctx, owner);
			return;
		case 'summon':
			return summon(ctx, item, effect);
	}
	for (const target of resolveTargets(m, item, effect)) {
		switch (effect.verb) {
			case 'damage':
				dealDamage(ctx, target, effect.amount, item.source, raised);
				break;
			case 'heal':
				heal(ctx, target, effect.amount);
				break;
			case 'buff': {
				const unit = unitOf(m, target);
				unit.attack += effect.attack;
				unit.health += effect.health;
				unit.buffs.push({ attack: effect.attack, health: effect.health, until: effect.until });
				ctx.events.push({
					type: 'buffed',
					uid: unit.uid,
					attack: effect.attack,
					health: effect.health,
				});
				break;
			}
			case 'destroy':
				doomed.add(target.unit);
				ctx.events.push({ type: 'destroyed', uid: target.unit });
				break;
			case 'giveKeyword': {
				const unit = unitOf(m, target);
				if (unit.keywords.includes(effect.keyword)) break;
				unit.keywords.push(effect.keyword);
				ctx.events.push({ type: 'keywordGiven', uid: unit.uid, keyword: effect.keyword });
				break;
			}
		}
	}
}

/** The targets an effect hits, fixed now; a unit that has left the board is skipped. */
function resolveTargets(m, item, effect) {
	const target = effect.target;
	const enemy = 1 - item.owner;
	const units = effect.verb === 'damage' || effect.verb === 'heal' ? null : 'units';
	switch (target.kind) {
		case 'self':
			return unitOnBoard(m, item.source) ? [{ unit: item.source }] : [];
		case 'chosen': {
			const chosen = item.target;
			if (!chosen) return [];
			if ('unit' in chosen) return unitOnBoard(m, chosen.unit) ? [{ unit: chosen.unit }] : [];
			return units ? [] : [{ hero: chosen.hero }];
		}
		case 'allEnemies':
			return sideTargets(m, enemy, target.include);
		case 'randomEnemy': {
			const pool = sideTargets(m, enemy, target.include);
			return pool.length ? [pool[Math.floor(draw(m) * pool.length)]] : [];
		}
	}
	return [];
}

function sideTargets(m, side, include) {
	const targets = m.players[side].board.map((u) => ({ unit: u.uid }));
	if (include === 'characters') targets.push({ hero: side });
	return targets;
}

function dealDamage(ctx, target, amount, by, raised) {
	const m = ctx.match;
	if (amount <= 0) return;
	if ('hero' in target) {
		const hero = m.players[target.hero];
		hero.health = Math.max(0, hero.health - amount);
		ctx.events.push({
			type: 'damaged',
			target: { hero: target.hero },
			amount,
			by,
			shieldBroken: false,
		});
		return;
	}
	const unit = unitOf(m, target);
	if (unit.keywords.includes('shield')) {
		unit.keywords = unit.keywords.filter((k) => k !== 'shield');
		ctx.events.push({
			type: 'damaged',
			target: { unit: unit.uid },
			amount: 0,
			by,
			shieldBroken: true,
		});
		return;
	}
	unit.damage += amount;
	ctx.events.push({ type: 'damaged', target: { unit: unit.uid }, amount, by, shieldBroken: false });
	const items = effectsFor(m, unit, 'onDamaged');
	if (items.length) raised.push({ owner: unit.owner, pos: boardIndex(m, unit), items });
}

function heal(ctx, target, amount) {
	const m = ctx.match;
	let healed;
	if ('hero' in target) {
		const hero = m.players[target.hero];
		healed = Math.min(amount, hero.maxHealth - hero.health);
		hero.health += healed;
	} else {
		const unit = unitOf(m, target);
		healed = Math.min(amount, unit.damage);
		unit.damage -= healed;
	}
	if (healed > 0) ctx.events.push({ type: 'healed', target: { ...target }, amount: healed });
}

function resolveCombat(ctx, item, raised) {
	const m = ctx.match;
	const attacker = unitOnBoard(m, item.attacker);
	if (!attacker) return;
	const target = item.target;
	const defender = 'unit' in target ? unitOnBoard(m, target.unit) : null;
	if ('unit' in target && !defender) return;
	const strike = Math.max(0, attacker.attack);
	const back = defender ? Math.max(0, defender.attack) : 0;
	dealDamage(ctx, target, strike, attacker.uid, raised);
	if (defender) dealDamage(ctx, { unit: attacker.uid }, back, defender.uid, raised);
}

function summon(ctx, item, effect) {
	const m = ctx.match;
	const board = m.players[item.owner].board;
	const source = board.findIndex((u) => u.uid === item.source);
	const anchor = board.findIndex((u) => u.uid === item.anchor);
	let at = source >= 0 ? source + 1 : anchor >= 0 ? anchor : board.length;
	for (let i = 0; i < (effect.count ?? 1); i++) {
		if (board.length >= m.rules.boardLimit) return;
		const unit = instance(m, effect.card, item.owner);
		unit.summonedOnTurn = m.turn;
		unit.attacksLeft = 1;
		board.splice(at, 0, unit);
		ctx.events.push({ type: 'summoned', player: item.owner, uid: unit.uid, slot: at });
		at += 1;
	}
}

/**
 * Every unit with damage at or past its health, or destroyed by the last effect, dies at once: in
 * board order, the active player's first. Each goes to its owner's discard pile and its `onDeath`
 * effects are raised, each carrying the nearest unit to its right that survives (`anchor`), so a
 * death summon takes the dead unit's place. Waiting effects of the dead get the same anchor, and
 * an anchor that dies hands its own on, so the place holds however the board shifts first.
 */
function deathCheck(ctx, doomed, raised) {
	const m = ctx.match;
	const dying = [];
	for (const side of turnOrder(m)) {
		const board = m.players[side].board;
		const dies = (unit) => unit.damage >= unit.health || doomed.has(unit.uid);
		board.forEach((unit, pos) => {
			if (!dies(unit)) return;
			const anchor = board.slice(pos + 1).find((u) => !dies(u))?.uid ?? null;
			dying.push({ unit, pos, side, anchor });
		});
	}
	if (!dying.length) return;
	for (const side of [0, 1]) {
		const player = m.players[side];
		player.board = player.board.filter((u) => !dying.some((d) => d.unit === u));
	}
	const anchors = new Map(dying.map((d) => [d.unit.uid, d.anchor]));
	const follow = (item) => {
		if (item.combat) return;
		if (anchors.has(item.anchor)) item.anchor = anchors.get(item.anchor);
		else if (anchors.has(item.source) && item.anchor === undefined) {
			item.anchor = anchors.get(item.source);
		}
	};
	m.queue.forEach(follow);
	for (const entry of raised) entry.items.forEach(follow);
	for (const { unit, pos, side, anchor } of dying) {
		m.players[side].discard.push(unit);
		ctx.events.push({ type: 'died', uid: unit.uid });
		const items = effectsFor(m, unit, 'onDeath', { anchor });
		if (items.length) raised.push({ owner: unit.owner, pos, items });
	}
}

function drawCard(ctx, side) {
	const m = ctx.match;
	const player = m.players[side];
	const card = player.deck.pop();
	if (!card) {
		const amount = player.fatigue;
		player.health = Math.max(0, player.health - amount);
		player.fatigue += 1;
		ctx.events.push({ type: 'fatigue', player: side, amount });
		return;
	}
	const burned = player.hand.length >= m.rules.handLimit;
	(burned ? player.discard : player.hand).push(card);
	ctx.events.push({ type: 'drawn', player: side, uid: card.uid, burned });
}

// ---- legality ----------------------------------------------------------------------------------

function canPlay(m, card) {
	const def = m.library[card.cardId];
	const me = m.players[m.active];
	if (def.cost > me.resource.current) return false;
	if (def.type === 'unit' && me.board.length >= m.rules.boardLimit) return false;
	const targets = chosenTargets(m, card);
	return targets === null || targets.length > 0;
}

/**
 * The targets a card's `chosen` effects allow, all filters at once (one target serves them all), in
 * the listing order; `null` when the card chooses nothing.
 */
function chosenTargets(m, card) {
	const chosen = (m.library[card.cardId].effects ?? []).filter(
		(e) => e.trigger === 'onPlay' && e.target?.kind === 'chosen',
	);
	if (!chosen.length) return null;
	const enemy = 1 - m.active;
	const all = [...sideTargets(m, enemy, 'characters'), ...sideTargets(m, m.active, 'characters')];
	return all.filter((t) =>
		chosen.every((e) => {
			const side = 'unit' in t ? unitOnBoard(m, t.unit).owner : t.hero;
			if (e.target.side === 'enemy' && side !== enemy) return false;
			if (e.target.side === 'friendly' && side !== m.active) return false;
			return 'unit' in t || e.target.include === 'characters';
		}),
	);
}

/** What an attack may hit now: the enemy's `guard` units if it has any, else every enemy unit then
 *  the enemy hero. */
function attackTargets(m) {
	const enemy = 1 - m.active;
	const board = m.players[enemy].board;
	const guards = board.filter((u) => u.keywords.includes('guard'));
	if (guards.length) return guards.map((u) => ({ unit: u.uid }));
	return sideTargets(m, enemy, 'characters');
}

const canAttack = (m, unit) =>
	unit.attacksLeft > 0 && (unit.summonedOnTurn !== m.turn || unit.keywords.includes('swift'));

function sameTarget(a, b) {
	if (!isRecord(a) || !isRecord(b)) return false;
	if ('unit' in a) return 'unit' in b && a.unit === b.unit;
	return 'hero' in b && !('unit' in b) && a.hero === b.hero;
}

// ---- the value ---------------------------------------------------------------------------------

function context(match) {
	return { match, events: [], steps: 0 };
}

function instance(m, cardId, owner) {
	const def = m.library[cardId];
	return {
		uid: m.nextUid++,
		cardId,
		owner,
		attack: def.attack ?? 0,
		health: def.health ?? 0,
		damage: 0,
		keywords: [...(def.keywords ?? [])],
		buffs: [],
		summonedOnTurn: 0,
		attacksLeft: 0,
	};
}

/** A copy whose every changeable part is new; the library and rules are shared and never changed. */
function copyMatch(match) {
	const card = (c) => ({ ...c, keywords: [...c.keywords], buffs: c.buffs.map((b) => ({ ...b })) });
	return {
		...match,
		players: match.players.map((p) => ({
			...p,
			resource: { ...p.resource },
			deck: p.deck.map(card),
			hand: p.hand.map(card),
			board: p.board.map(card),
			discard: p.discard.map(card),
		})),
		queue: match.queue.map((item) => ({ ...item })),
	};
}

/** The next draw in [0, 1) from the match's own stream, advancing it. */
function draw(m) {
	const next = rngNext(m.rngState);
	m.rngState = next.state;
	return next.value;
}

function shuffle(m, cards) {
	for (let i = cards.length - 1; i > 0; i--) {
		const j = Math.floor(draw(m) * (i + 1));
		[cards[i], cards[j]] = [cards[j], cards[i]];
	}
}

function deckIds(deck) {
	const ids = [];
	for (const entry of Array.isArray(deck) ? deck : []) {
		if (typeof entry === 'string') ids.push(entry);
		else if (isRecord(entry)) for (let i = 0; i < (entry.count ?? 1); i++) ids.push(entry.card);
	}
	return ids;
}

const unitOnBoard = (m, uid) =>
	m.players[0].board.find((u) => u.uid === uid) ?? m.players[1].board.find((u) => u.uid === uid);
const unitOf = (m, target) => unitOnBoard(m, target.unit);
const boardIndex = (m, unit) => m.players[unit.owner].board.indexOf(unit);
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const show = (value) =>
	typeof value === 'string'
		? `"${value}"`
		: typeof value === 'object' && value !== null
			? JSON.stringify(value)
			: String(value);
