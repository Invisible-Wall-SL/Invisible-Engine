// The card rules engine (packages/engine-mechanics/src/cards.js; docs/design/card-games.md §2, C1):
// each phase's order, the resource, every legality rule, each verb on each target it allows,
// `shield`, simultaneous deaths and trigger order, the loop guard, fatigue, the turn limit, that a
// seed and an action list replay byte for byte — against the committed trace in
// packages/engine-mechanics/fixtures/cards-replay.json — and that `apply` never changes its input.
//
// Run: pnpm check:card-rules            (--update rewrites the replay fixture)

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, rngNext, rngSeed } from '../packages/engine-mechanics/src/board.js';
import {
	IllegalAction,
	MAX_QUEUE_STEPS,
	apply,
	createMatch,
	isOver,
	legalActions,
} from '../packages/engine-mechanics/src/cards.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'packages/engine-mechanics/fixtures');
const REPLAY_FIXTURE = join(FIXTURES, 'cards-replay.json');
const SAMPLE = JSON.parse(readFileSync(join(FIXTURES, 'cards-sample.library.json'), 'utf8'));

let passed = 0;
const failures = [];
function check(name, fn) {
	try {
		fn();
		passed++;
	} catch (error) {
		failures.push(`✗ ${name}\n    ${error.message.split('\n').join('\n    ')}`);
	}
}

const unit = (id, cost, attack, health, extra = {}) => ({
	id,
	name: id,
	type: 'unit',
	cost,
	attack,
	health,
	...extra,
});
const spell = (id, cost, effects) => ({ id, name: id, type: 'spell', cost, effects });
const enemyUnit = { kind: 'chosen', side: 'enemy', include: 'units' };

/** The sample, plus cards made to isolate one rule each. */
const LIBRARY = [
	...SAMPLE,
	unit('dummy', 0, 0, 5),
	unit('brute', 1, 4, 4),
	unit('husk', 1, 1, 1, {
		effects: [{ trigger: 'onDeath', verb: 'summon', card: 'sproutling' }],
	}),
	unit('mirror-golem', 1, 0, 5, {
		effects: [
			{
				trigger: 'onDamaged',
				verb: 'damage',
				amount: 1,
				target: { kind: 'allEnemies', include: 'units' },
			},
			{ trigger: 'onDamaged', verb: 'heal', amount: 1, target: { kind: 'self' } },
		],
	}),
	unit('watcher', 1, 1, 3, {
		effects: [{ trigger: 'onDamaged', verb: 'draw', amount: 1 }],
	}),
	unit('frail-banner', 1, 1, 1, {
		effects: [
			{
				trigger: 'onPlay',
				verb: 'buff',
				attack: 1,
				health: 1,
				until: 'endOfTurn',
				target: { kind: 'self' },
			},
		],
	}),
	spell('bolt-then-guard', 0, [
		{ trigger: 'onPlay', verb: 'damage', amount: 3, target: enemyUnit },
		{ trigger: 'onPlay', verb: 'giveKeyword', keyword: 'guard', target: enemyUnit },
	]),
	spell('scorch', 0, [
		{
			trigger: 'onPlay',
			verb: 'damage',
			amount: 2,
			target: { kind: 'allEnemies', include: 'characters' },
		},
	]),
	spell('lucky-shot', 0, [
		{
			trigger: 'onPlay',
			verb: 'damage',
			amount: 1,
			target: { kind: 'randomEnemy', include: 'characters' },
		},
	]),
	spell('wither', 0, [
		{
			trigger: 'onPlay',
			verb: 'buff',
			attack: -1,
			health: -4,
			until: 'permanent',
			target: enemyUnit,
		},
	]),
	spell('focus', 0, [
		{
			trigger: 'onPlay',
			verb: 'buff',
			attack: 3,
			health: 3,
			until: 'endOfTurn',
			target: { kind: 'chosen', side: 'friendly', include: 'units' },
		},
	]),
	spell('ward', 0, [
		{
			trigger: 'onPlay',
			verb: 'giveKeyword',
			keyword: 'shield',
			target: { kind: 'chosen', side: 'friendly', include: 'units' },
		},
	]),
	spell('backfire', 0, [
		{
			trigger: 'onPlay',
			verb: 'damage',
			amount: 3,
			target: { kind: 'allEnemies', include: 'characters' },
		},
		{
			trigger: 'onPlay',
			verb: 'damage',
			amount: 3,
			target: { kind: 'chosen', side: 'friendly', include: 'characters' },
		},
	]),
	unit('caller', 0, 1, 1, {
		effects: [{ trigger: 'onDeath', verb: 'summon', card: 'archive-owl' }],
	}),
	unit('last-word', 1, 1, 1, {
		effects: [{ trigger: 'onDeath', verb: 'draw', amount: 1 }],
	}),
	unit('spiteful', 1, 1, 5, {
		effects: [
			{
				trigger: 'onDamaged',
				verb: 'damage',
				amount: 1,
				target: { kind: 'allEnemies', include: 'characters' },
			},
		],
	}),
	unit('sapper', 1, 1, 1, {
		effects: [{ trigger: 'onDamaged', verb: 'summon', card: 'sproutling' }],
	}),
	unit('pillar', 1, 0, 2),
	spell('double-ash', 0, [
		{
			trigger: 'onPlay',
			verb: 'damage',
			amount: 1,
			target: { kind: 'allEnemies', include: 'units' },
		},
		{
			trigger: 'onPlay',
			verb: 'damage',
			amount: 1,
			target: { kind: 'allEnemies', include: 'units' },
		},
	]),
	spell('ponder', 0, [{ trigger: 'onPlay', verb: 'draw', amount: 3 }]),
	spell('bloom', 0, [{ trigger: 'onPlay', verb: 'summon', card: 'sproutling', count: 3 }]),
];

/**
 * A match set up by hand: `mine` is the active player's zones, `theirs` the other's. A zone lists
 * card ids, or `{ card, ...fields }` to set an instance's fields (damage, keywords, …). Units on a
 * board arrived on turn 1 and have their attack, unless the spec says otherwise.
 */
function table({
	active = 0,
	phase = 'main',
	turn = 3,
	resource = 10,
	rules,
	mine,
	theirs,
	library = LIBRARY,
} = {}) {
	const { match } = createMatch({
		seed: 'table',
		decks: [[], []],
		library,
		rules: { openingHand: 0, ...rules },
		first: 0,
	});
	const m = structuredClone({ ...match, library: undefined });
	m.library = match.library;
	m.active = active;
	m.phase = phase;
	m.turn = turn;
	m.nextUid = 1;
	m.result = null;
	const build = (side, spec = {}) => {
		const player = m.players[side];
		player.health = spec.health ?? 30;
		player.fatigue = 1;
		player.resource = { current: resource, max: resource };
		for (const zone of ['deck', 'hand', 'board', 'discard']) {
			player[zone] = (spec[zone] ?? []).map((entry) => {
				const { card, ...fields } = typeof entry === 'string' ? { card: entry } : entry;
				const def = m.library[card];
				const onBoard = zone === 'board';
				return {
					uid: m.nextUid++,
					cardId: card,
					owner: side,
					attack: def.attack ?? 0,
					health: def.health ?? 0,
					damage: 0,
					keywords: [...(def.keywords ?? [])],
					buffs: [],
					summonedOnTurn: onBoard ? 1 : 0,
					attacksLeft: onBoard ? 1 : 0,
					...fields,
				};
			});
		}
	};
	build(active, mine);
	build(1 - active, theirs);
	return m;
}

const me = (m) => m.players[m.active];
const them = (m) => m.players[1 - m.active];
const uidOf = (zone, cardId, nth = 0) => zone.filter((c) => c.cardId === cardId)[nth].uid;
const types = (events) => events.map((e) => e.type);
const ofType = (events, type) => events.filter((e) => e.type === type);

function illegal(code, fn) {
	assert.throws(fn, (error) => {
		assert.ok(error instanceof IllegalAction, `expected an IllegalAction, got ${error}`);
		assert.equal(error.code, code, error.message);
		return true;
	});
}

/** Plays a card from the active player's hand by id. */
function playCard(m, cardId, extra = {}) {
	return apply(m, { type: 'play', uid: uidOf(me(m).hand, cardId), ...extra });
}

// ---- phases and the resource ---------------------------------------------------------------

const DECK = SAMPLE.filter((c) => !c.token).flatMap((c) => [c.id, c.id]);

check(
	'a new match deals the hands and runs turn 1 to main; the first player skips the draw',
	() => {
		const { match, events } = createMatch({
			seed: 'phases',
			decks: [DECK, DECK],
			library: LIBRARY,
			first: 1,
		});
		assert.equal(match.active, 1);
		assert.equal(match.turn, 1);
		assert.equal(match.phase, 'main');
		assert.equal(match.players[1].hand.length, 3, 'the first player draws the opening hand');
		assert.equal(match.players[0].hand.length, 4, 'the second player gets one more');
		assert.deepEqual(types(events).slice(-4), [
			'turnStarted',
			'phaseChanged',
			'phaseChanged',
			'phaseChanged',
		]);
		assert.deepEqual(
			ofType(events, 'phaseChanged').map((e) => e.phase),
			['start', 'draw', 'main'],
		);
		assert.equal(ofType(events, 'drawn').length, 7, 'no draw on turn 1');
	},
);

check('main → combat → end → the next turn: start, draw, main', () => {
	const { match } = createMatch({
		seed: 'phases',
		decks: [DECK, DECK],
		library: LIBRARY,
		first: 0,
	});
	const combat = apply(match, { type: 'endPhase' });
	assert.equal(combat.match.phase, 'combat');
	assert.deepEqual(types(combat.events), ['phaseChanged']);
	const next = apply(combat.match, { type: 'endPhase' });
	assert.equal(next.match.active, 1);
	assert.equal(next.match.turn, 2);
	assert.equal(next.match.phase, 'main');
	assert.deepEqual(types(next.events), [
		'phaseChanged',
		'turnStarted',
		'phaseChanged',
		'phaseChanged',
		'drawn',
		'phaseChanged',
	]);
	assert.deepEqual(
		ofType(next.events, 'phaseChanged').map((e) => e.phase),
		['end', 'start', 'draw', 'main'],
	);
	assert.equal(next.match.players[1].hand.length, 5);
});

check('the resource grows by perTurn to its cap, refills each turn, and unspent is lost', () => {
	let { match } = createMatch({ seed: 'mana', decks: [DECK, DECK], library: LIBRARY, first: 0 });
	const seen = [];
	for (let turn = 1; turn <= 24; turn++) {
		seen.push(match.players[match.active].resource.max);
		assert.equal(
			match.players[match.active].resource.current,
			match.players[match.active].resource.max,
		);
		match = apply(apply(match, { type: 'endPhase' }).match, { type: 'endPhase' }).match;
		if (isOver(match)) break;
	}
	const firsts = seen.filter((_, i) => i % 2 === 0);
	assert.deepEqual(firsts, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10]);
	assert.deepEqual(seen.filter((_, i) => i % 2 === 1).slice(0, 3), [1, 2, 3]);

	let custom = createMatch({
		seed: 'mana',
		decks: [DECK, DECK],
		library: LIBRARY,
		first: 0,
		rules: { resource: { start: 3, perTurn: 2, max: 6 } },
	}).match;
	const maxes = [];
	for (let i = 0; i < 4; i++) {
		maxes.push(custom.players[0].resource.max);
		custom = apply(apply(custom, { type: 'endPhase' }).match, { type: 'endPhase' }).match;
		custom = apply(apply(custom, { type: 'endPhase' }).match, { type: 'endPhase' }).match;
	}
	assert.deepEqual(maxes, [3, 5, 6, 6]);
});

check('playing a card pays its cost; a spell goes to the discard pile', () => {
	const m = table({ resource: 4, mine: { hand: ['cinder-bolt', 'ember-imp'] } });
	const after = playCard(m, 'cinder-bolt', { target: { hero: 1 } });
	assert.equal(me(after.match).resource.current, 3);
	assert.deepEqual(
		me(after.match).discard.map((c) => c.cardId),
		['cinder-bolt'],
	);
	assert.equal(them(after.match).health, 27);
	const unitPlayed = playCard(after.match, 'ember-imp');
	assert.deepEqual(
		me(unitPlayed.match).board.map((c) => c.cardId),
		['ember-imp'],
	);
	assert.equal(me(unitPlayed.match).board[0].summonedOnTurn, 3);
	assert.deepEqual(ofType(unitPlayed.events, 'played'), [
		{ type: 'played', player: 0, uid: me(unitPlayed.match).board[0].uid, slot: 0 },
	]);
});

// ---- legality ------------------------------------------------------------------------------

check('a card above the resource is not legal', () => {
	const m = table({ resource: 1, mine: { hand: ['lantern-warden'] } });
	assert.ok(!legalActions(m).some((a) => a.type === 'play'));
	illegal('cost', () => playCard(m, 'lantern-warden'));
});

check('a unit cannot be played on a full board; a spell still can', () => {
	const m = table({
		rules: { boardLimit: 2 },
		mine: { hand: ['ember-imp', 'ponder'], board: ['dummy', 'dummy'] },
	});
	const plays = legalActions(m).filter((a) => a.type === 'play');
	assert.deepEqual(
		plays.map((a) => m.library[me(m).hand.find((c) => c.uid === a.uid).cardId].id),
		['ponder'],
	);
	illegal('boardFull', () => playCard(m, 'ember-imp'));
});

check('a slot places the unit; an off-board slot, and a slot on a spell, are illegal', () => {
	const m = table({ mine: { hand: ['ember-imp', 'ponder'], board: ['dummy', 'brute'] } });
	const placed = playCard(m, 'ember-imp', { slot: 1 });
	assert.deepEqual(
		me(placed.match).board.map((c) => c.cardId),
		['dummy', 'ember-imp', 'brute'],
	);
	illegal('slot', () => playCard(m, 'ember-imp', { slot: 3 }));
	illegal('slot', () => playCard(m, 'ember-imp', { slot: -1 }));
	illegal('slot', () => playCard(m, 'ponder', { slot: 0 }));
});

check('a chosen target is required and filtered; with none valid the card is not playable', () => {
	const m = table({
		mine: { hand: ['quiet-end', 'rally-cry', 'cinder-bolt'], board: ['dummy'] },
		theirs: { board: ['brute'] },
	});
	const brute = them(m).board[0].uid;
	const dummy = me(m).board[0].uid;
	illegal('target', () => playCard(m, 'quiet-end'));
	illegal('target', () => playCard(m, 'quiet-end', { target: { unit: dummy } }));
	illegal('target', () => playCard(m, 'quiet-end', { target: { hero: 1 } }));
	illegal('target', () => playCard(m, 'rally-cry', { target: { unit: brute } }));
	const targets = (cardId) =>
		legalActions(m)
			.filter((a) => a.uid === uidOf(me(m).hand, cardId))
			.map((a) => a.target);
	assert.deepEqual(targets('quiet-end'), [{ unit: brute }]);
	assert.deepEqual(targets('rally-cry'), [{ unit: dummy }]);
	assert.deepEqual(targets('cinder-bolt'), [
		{ unit: brute },
		{ hero: 1 },
		{ unit: dummy },
		{ hero: 0 },
	]);
	const empty = table({ mine: { hand: ['quiet-end', 'rally-cry'] } });
	assert.deepEqual(
		legalActions(empty).map((a) => a.type),
		['endPhase', 'concede'],
	);
	illegal('target', () =>
		playCard(table({ mine: { hand: ['ponder'] } }), 'ponder', { target: { hero: 1 } }),
	);
});

check('cards are played in main only; attacks are made in combat only', () => {
	const m = table({ phase: 'combat', mine: { hand: ['ember-imp'], board: ['brute'] } });
	illegal('phase', () => playCard(m, 'ember-imp'));
	const main = table({ mine: { board: ['brute'] } });
	illegal('phase', () =>
		apply(main, { type: 'attack', attacker: me(main).board[0].uid, target: { hero: 1 } }),
	);
	illegal('hand', () => apply(main, { type: 'play', uid: 999 }));
	illegal('action', () => apply(main, { type: 'pass' }));
});

check('guard must be attacked first', () => {
	const m = table({
		phase: 'combat',
		mine: { board: ['brute'] },
		theirs: { board: ['dummy', 'lantern-warden'] },
	});
	const attacker = me(m).board[0].uid;
	const warden = uidOf(them(m).board, 'lantern-warden');
	assert.deepEqual(
		legalActions(m)
			.filter((a) => a.type === 'attack')
			.map((a) => a.target),
		[{ unit: warden }],
	);
	illegal('target', () => apply(m, { type: 'attack', attacker, target: { hero: 1 } }));
	illegal('target', () =>
		apply(m, { type: 'attack', attacker, target: { unit: uidOf(them(m).board, 'dummy') } }),
	);
});

check('a unit that arrived this turn cannot attack unless swift; an exhausted one cannot', () => {
	const m = table({ mine: { hand: ['brute', 'brook-scout'] } });
	let next = playCard(m, 'brute').match;
	next = playCard(next, 'brook-scout').match;
	next = apply(next, { type: 'endPhase' }).match;
	const attackers = [
		...new Set(
			legalActions(next)
				.filter((a) => a.type === 'attack')
				.map((a) => a.attacker),
		),
	];
	assert.deepEqual(attackers, [uidOf(me(next).board, 'brook-scout')]);
	illegal('arrived', () =>
		apply(next, { type: 'attack', attacker: uidOf(me(next).board, 'brute'), target: { hero: 1 } }),
	);
	const scout = uidOf(me(next).board, 'brook-scout');
	const spent = apply(next, { type: 'attack', attacker: scout, target: { hero: 1 } }).match;
	assert.equal(them(spent).health, 28);
	illegal('exhausted', () =>
		apply(spent, { type: 'attack', attacker: scout, target: { hero: 1 } }),
	);
	illegal('attacker', () => apply(spent, { type: 'attack', attacker: 999, target: { hero: 1 } }));
});

check('a finished match takes no action and lists none', () => {
	const m = table();
	const over = apply(m, { type: 'concede' });
	assert.deepEqual(over.match.result, { winner: 1, reason: 'concede' });
	assert.deepEqual(ofType(over.events, 'matchEnded'), [
		{ type: 'matchEnded', winner: 1, reason: 'concede' },
	]);
	assert.ok(isOver(over.match));
	assert.deepEqual(legalActions(over.match), []);
	illegal('over', () => apply(over.match, { type: 'endPhase' }));
});

// ---- combat --------------------------------------------------------------------------------

check('combat is simultaneous; a unit hitting the hero takes nothing back', () => {
	const m = table({
		phase: 'combat',
		mine: { board: ['brute', 'ember-imp'] },
		theirs: { board: ['moss-mender'] },
	});
	const brute = uidOf(me(m).board, 'brute');
	const mender = uidOf(them(m).board, 'moss-mender');
	const hit = apply(m, { type: 'attack', attacker: brute, target: { unit: mender } });
	assert.deepEqual(ofType(hit.events, 'damaged'), [
		{ type: 'damaged', target: { unit: mender }, amount: 4, by: brute, shieldBroken: false },
		{ type: 'damaged', target: { unit: brute }, amount: 2, by: mender, shieldBroken: false },
	]);
	assert.deepEqual(ofType(hit.events, 'died'), [{ type: 'died', uid: mender }]);
	assert.equal(me(hit.match).board[0].damage, 2);
	const face = apply(hit.match, {
		type: 'attack',
		attacker: uidOf(me(hit.match).board, 'ember-imp'),
		target: { hero: 1 },
	});
	assert.equal(them(face.match).health, 29);
	assert.equal(ofType(face.events, 'damaged').length, 1);
});

check('onAttack resolves before the damage', () => {
	const m = table({
		phase: 'combat',
		mine: { board: ['drum-captain'] },
		theirs: { board: ['dummy'] },
	});
	const captain = me(m).board[0].uid;
	const { match, events } = apply(m, {
		type: 'attack',
		attacker: captain,
		target: { unit: them(m).board[0].uid },
	});
	assert.deepEqual(types(events).slice(0, 3), ['attacked', 'buffed', 'damaged']);
	assert.equal(them(match).board.length, 0, 'the 5-attack hit (3 + 2) killed the 5-health dummy');
	const expired = apply(match, { type: 'endPhase' });
	assert.deepEqual(ofType(expired.events, 'buffsExpired'), [
		{ type: 'buffsExpired', uids: [captain] },
	]);
	assert.equal(expired.match.players[0].board[0].attack, 3);
});

// ---- the verbs -----------------------------------------------------------------------------

check('damage: a chosen unit, a chosen hero, all enemy characters, a random enemy', () => {
	const m = table({
		mine: { hand: ['cinder-bolt', 'scorch', 'lucky-shot'] },
		theirs: { board: ['dummy', 'brute'] },
	});
	const bolt = playCard(m, 'cinder-bolt', { target: { unit: them(m).board[0].uid } });
	assert.equal(them(bolt.match).board[0].damage, 3);
	const hero = playCard(m, 'cinder-bolt', { target: { hero: 0 } });
	assert.equal(me(hero.match).health, 27, 'a chosen "any" target can be your own hero');
	const scorch = playCard(m, 'scorch');
	assert.deepEqual(
		ofType(scorch.events, 'damaged').map((e) => e.target),
		[{ unit: them(m).board[0].uid }, { unit: them(m).board[1].uid }, { hero: 1 }],
	);
	assert.equal(them(scorch.match).health, 28);
	const lucky = playCard(m, 'lucky-shot');
	assert.equal(ofType(lucky.events, 'damaged').length, 1);
	assert.notEqual(lucky.match.rngState, m.rngState, 'a random target draws from the match stream');
	assert.deepEqual(playCard(m, 'lucky-shot'), lucky, 'and the same state draws the same target');
});

check("heal: removes a unit's damage, and a hero's up to its max", () => {
	const m = table({
		mine: {
			hand: ['second-wind', 'second-wind'],
			board: [{ card: 'dummy', damage: 3 }],
			deck: ['ember-imp'],
			health: 27,
		},
	});
	const unitHealed = playCard(m, 'second-wind', { target: { unit: me(m).board[0].uid } });
	assert.equal(me(unitHealed.match).board[0].damage, 0);
	assert.deepEqual(ofType(unitHealed.events, 'healed'), [
		{ type: 'healed', target: { unit: me(m).board[0].uid }, amount: 3 },
	]);
	const heroHealed = playCard(m, 'second-wind', { target: { hero: 0 } });
	assert.equal(me(heroHealed.match).health, 30, 'capped at maxHealth');
	assert.deepEqual(ofType(heroHealed.events, 'healed'), [
		{ type: 'healed', target: { hero: 0 }, amount: 3 },
	]);
	assert.equal(me(heroHealed.match).hand.length, 2, 'its second effect drew a card');
});

check('draw: the owner draws; into a full hand the card is burned', () => {
	const m = table({
		rules: { handLimit: 3 },
		mine: { hand: ['ponder', 'dummy'], deck: ['brute', 'husk', 'ember-imp'] },
	});
	const { match, events } = playCard(m, 'ponder');
	assert.deepEqual(
		ofType(events, 'drawn').map((e) => e.burned),
		[false, false, true],
	);
	assert.deepEqual(
		me(match).hand.map((c) => c.cardId),
		['dummy', 'ember-imp', 'husk'],
	);
	assert.deepEqual(
		me(match).discard.map((c) => c.cardId),
		['ponder', 'brute'],
	);
});

check('summon: to the right of the source, never past the board limit', () => {
	const m = table({
		rules: { boardLimit: 4 },
		mine: { hand: ['bloom'], board: ['dummy', 'brute'] },
	});
	const { match, events } = playCard(m, 'bloom');
	assert.deepEqual(
		me(match).board.map((c) => c.cardId),
		['dummy', 'brute', 'sproutling', 'sproutling'],
	);
	assert.deepEqual(
		ofType(events, 'summoned').map((e) => e.slot),
		[2, 3],
	);
	assert.equal(me(match).board[2].summonedOnTurn, 3);
	assert.ok(
		new Set(me(match).board.map((c) => c.uid)).size === 4,
		'every instance has its own uid',
	);
});

check('a death summon takes the slot the unit left', () => {
	const m = table({
		mine: { hand: ['cinder-bolt'] },
		theirs: { board: ['dummy', 'hollow-seed', 'brute'] },
	});
	const { match } = playCard(m, 'cinder-bolt', { target: { unit: them(m).board[1].uid } });
	assert.deepEqual(
		them(match).board.map((c) => c.cardId),
		['dummy', 'sproutling', 'sproutling', 'brute'],
	);
	assert.deepEqual(
		them(match).discard.map((c) => c.cardId),
		['hollow-seed'],
	);
});

check('buff: permanent stays, endOfTurn expires, a negative health buff can kill', () => {
	const m = table({
		mine: { hand: ['rally-cry', 'focus', 'wither'], board: ['ember-imp'] },
		theirs: { board: ['brute'] },
	});
	const imp = me(m).board[0].uid;
	const rallied = playCard(m, 'rally-cry', { target: { unit: imp } });
	const ralliedImp = me(rallied.match).board[0];
	assert.deepEqual([ralliedImp.attack, ralliedImp.health], [3, 4]);
	assert.ok(ralliedImp.keywords.includes('guard'), 'its second effect gave guard');
	assert.deepEqual(
		types(rallied.events).filter((t) => t !== 'phaseChanged'),
		['played', 'buffed', 'keywordGiven'],
	);
	const focused = playCard(rallied.match, 'focus', { target: { unit: imp } }).match;
	assert.deepEqual([me(focused).board[0].attack, me(focused).board[0].health], [6, 7]);
	const nextTurn = apply(apply(focused, { type: 'endPhase' }).match, { type: 'endPhase' }).match;
	const later = nextTurn.players[0].board[0];
	assert.deepEqual([later.attack, later.health], [3, 4], 'the endOfTurn buff expired');
	const withered = playCard(m, 'wither', { target: { unit: them(m).board[0].uid } });
	assert.deepEqual(ofType(withered.events, 'died'), [{ type: 'died', uid: them(m).board[0].uid }]);
});

check('an expiring health buff leaves a damaged unit at 1 health, never kills it', () => {
	const m = table({ mine: { hand: ['frail-banner'] } });
	const played = playCard(m, 'frail-banner').match;
	const banner = me(played).board[0];
	const hit = {
		...played,
		players: played.players.map((p, i) =>
			i === 0 ? { ...p, board: [{ ...banner, damage: 1 }] } : p,
		),
	};
	const ended = apply(apply(hit, { type: 'endPhase' }).match, { type: 'endPhase' });
	assert.deepEqual(ofType(ended.events, 'died'), []);
	const after = ended.match.players[0].board[0];
	assert.deepEqual([after.attack, after.health, after.damage], [1, 1, 0]);
});

check('an expiring buff never kills, even when a later debuff leaves less than it gave', () => {
	const m = table({ mine: { hand: ['focus'], board: ['ember-imp'] } });
	const imp = me(m).board[0].uid;
	const focused = playCard(m, 'focus', { target: { unit: imp } }).match;
	const withered = {
		...focused,
		players: focused.players.map((p, i) =>
			i === 0
				? {
						...p,
						board: p.board.map((u) => ({
							...u,
							health: u.health - 4,
							buffs: [...u.buffs, { attack: 0, health: -4, until: 'permanent' }],
						})),
					}
				: p,
		),
	};
	const unitNow = withered.players[0].board[0];
	assert.deepEqual([unitNow.health, unitNow.damage], [1, 0], 'a 2-health imp, +3 then -4');
	const { match, events } = apply(apply(withered, { type: 'endPhase' }).match, {
		type: 'endPhase',
	});
	assert.deepEqual(ofType(events, 'died'), []);
	assert.deepEqual([match.players[0].board[0].health, match.players[0].board[0].damage], [1, 0]);
});

check('destroy: the unit dies through a shield, and its onDeath fires', () => {
	const m = table({
		mine: { hand: ['quiet-end', 'quiet-end'] },
		theirs: { board: ['glass-knight', 'husk'] },
	});
	const knight = them(m).board[0].uid;
	const gone = playCard(m, 'quiet-end', { target: { unit: knight } });
	assert.deepEqual(types(gone.events).slice(-2), ['destroyed', 'died']);
	assert.equal(them(gone.match).board.length, 1);
	const husk = playCard(m, 'quiet-end', { target: { unit: them(m).board[1].uid } });
	assert.deepEqual(
		them(husk.match).board.map((c) => c.cardId),
		['glass-knight', 'sproutling'],
	);
});

check('giveKeyword: adds it once', () => {
	const m = table({ mine: { hand: ['ward', 'ward'], board: ['dummy'] } });
	const dummy = me(m).board[0].uid;
	const once = playCard(m, 'ward', { target: { unit: dummy } });
	assert.deepEqual(me(once.match).board[0].keywords, ['shield']);
	const twice = playCard(once.match, 'ward', { target: { unit: dummy } });
	assert.deepEqual(ofType(twice.events, 'keywordGiven'), [], 'already shielded: nothing given');
});

/** The cards an effect touched, in event order: a uid for a unit, `hero<side>` for a hero. */
function touched(events) {
	const keyOf = (target) => ('unit' in target ? target.unit : `hero${target.hero}`);
	return events.flatMap((e) => {
		if (e.type === 'damaged' || e.type === 'healed') return [keyOf(e.target)];
		if (e.type === 'buffed' || e.type === 'keywordGiven' || e.type === 'destroyed') {
			return [e.uid];
		}
		return [];
	});
}

const VERB_CASES = {
	damage: { amount: 1 },
	heal: { amount: 1 },
	buff: { attack: 1, health: 1, until: 'permanent' },
	destroy: {},
	giveKeyword: { keyword: 'guard' },
};

check('every verb on every target it allows touches exactly those targets', () => {
	for (const [verb, fields] of Object.entries(VERB_CASES)) {
		const includes = verb === 'damage' || verb === 'heal' ? ['units', 'characters'] : ['units'];
		const cases = [{ kind: 'self' }];
		for (const include of includes) {
			cases.push({ kind: 'allEnemies', include }, { kind: 'randomEnemy', include });
			for (const side of ['enemy', 'friendly', 'any'])
				cases.push({ kind: 'chosen', side, include });
		}
		for (const target of cases) {
			const label = `${verb} → ${JSON.stringify(target)}`;
			const effect = { verb, ...fields, target };
			const probe = unit('probe', 0, 1, 5, {
				effects: [{ trigger: target.kind === 'self' ? 'turnStart' : 'onPlay', ...effect }],
			});
			const hurt = (card) => ({ card, damage: 1 });
			const m = table({
				library: [...LIBRARY, probe],
				active: target.kind === 'self' ? 1 : 0,
				phase: target.kind === 'self' ? 'combat' : 'main',
				mine:
					target.kind === 'self'
						? { deck: ['dummy'] }
						: { hand: ['probe'], board: [hurt('dummy')], health: 29 },
				theirs:
					target.kind === 'self'
						? { board: [hurt('probe')], deck: ['dummy'] }
						: { board: [hurt('dummy'), hurt('brute')], health: 29 },
			});
			const friendly = target.kind === 'self' ? m.players[0] : me(m);
			const enemy = them(m);
			const enemyUnits = enemy.board.map((c) => c.uid);
			if (target.kind === 'self') {
				const { events } = apply(m, { type: 'endPhase' });
				assert.deepEqual(touched(events), [friendly.board[0].uid], label);
				continue;
			}
			const enemyHero = `hero${1 - m.active}`;
			const pool = target.include === 'characters' ? [...enemyUnits, enemyHero] : enemyUnits;
			const probeUid = uidOf(me(m).hand, 'probe');
			if (target.kind === 'allEnemies') {
				assert.deepEqual(touched(playCard(m, 'probe').events), pool, label);
			} else if (target.kind === 'randomEnemy') {
				const hit = touched(playCard(m, 'probe').events);
				assert.equal(hit.length, 1, label);
				assert.ok(pool.includes(hit[0]), label);
				const alone = {
					...m,
					players: m.players.map((p, i) => (i === m.active ? p : { ...p, board: [] })),
				};
				const lonely = touched(playCard(alone, 'probe').events);
				assert.deepEqual(
					lonely,
					target.include === 'characters' ? [enemyHero] : [],
					`${label}, no units`,
				);
			} else {
				const listed = legalActions(m)
					.filter((a) => a.uid === probeUid)
					.map((a) => a.target);
				for (const chosen of listed) {
					const key = 'unit' in chosen ? chosen.unit : `hero${chosen.hero}`;
					assert.deepEqual(touched(playCard(m, 'probe', { target: chosen }).events), [key], label);
				}
				const sideOf = (t) =>
					'unit' in t
						? enemyUnits.includes(t.unit)
							? 'enemy'
							: 'friendly'
						: t.hero === m.active
							? 'friendly'
							: 'enemy';
				assert.ok(listed.length > 0, label);
				assert.ok(
					listed.every((t) => target.side === 'any' || sideOf(t) === target.side),
					label,
				);
				assert.ok(
					listed.every((t) => target.include === 'characters' || 'unit' in t),
					label,
				);
				const characters = target.include === 'characters' ? 1 : 0;
				const expected =
					(target.side === 'enemy' ? 0 : 1 + characters) +
					(target.side === 'friendly' ? 0 : 2 + characters);
				assert.equal(listed.length, expected, label);
			}
		}
	}
});

check('shield absorbs one whole hit, then is gone', () => {
	const m = table({
		mine: { hand: ['cinder-bolt', 'cinder-bolt'] },
		theirs: { board: ['glass-knight'] },
	});
	const knight = them(m).board[0].uid;
	const first = playCard(m, 'cinder-bolt', { target: { unit: knight } });
	assert.deepEqual(ofType(first.events, 'damaged'), [
		{
			type: 'damaged',
			target: { unit: knight },
			amount: 0,
			by: me(m).hand[0].uid,
			shieldBroken: true,
		},
	]);
	assert.deepEqual(
		[them(first.match).board[0].damage, them(first.match).board[0].keywords],
		[0, []],
	);
	const second = playCard(first.match, 'cinder-bolt', { target: { unit: knight } });
	assert.deepEqual(ofType(second.events, 'died'), [{ type: 'died', uid: knight }]);
});

check("turnStart fires at its owner's start phase", () => {
	const m = table({
		phase: 'combat',
		active: 1,
		mine: {},
		theirs: { board: [{ card: 'moss-mender', damage: 2 }], deck: ['dummy'] },
	});
	const { match, events } = apply(m, { type: 'endPhase' });
	assert.equal(match.players[0].board[0].damage, 0);
	assert.deepEqual(types(events).slice(2, 5), ['phaseChanged', 'healed', 'phaseChanged']);
});

check('a target that left the board is skipped', () => {
	const m = table({ mine: { hand: ['bolt-then-guard'] }, theirs: { board: ['sproutling'] } });
	const { events } = playCard(m, 'bolt-then-guard', { target: { unit: them(m).board[0].uid } });
	assert.deepEqual(
		types(events).filter((t) => t !== 'phaseChanged'),
		['played', 'damaged', 'died'],
	);
});

// ---- deaths and triggers -------------------------------------------------------------------

check('simultaneous deaths go in board order, the active player first', () => {
	const m = table({
		phase: 'combat',
		mine: { board: ['husk', 'ember-imp'] },
		theirs: { board: ['husk', 'brute', 'husk'] },
	});
	const attacker = me(m).board[0].uid;
	const target = them(m).board[0].uid;
	const fight = apply(m, { type: 'attack', attacker, target: { unit: target } });
	assert.deepEqual(
		ofType(fight.events, 'died').map((e) => e.uid),
		[attacker, target],
	);
	assert.deepEqual(
		ofType(fight.events, 'summoned').map((e) => e.player),
		[0, 1],
		'their onDeath effects queue in the same order',
	);
	const ash = table({
		mine: { hand: ['rain-of-ash'] },
		theirs: { board: ['husk', 'brute', 'husk'] },
	});
	const rained = playCard(ash, 'rain-of-ash');
	assert.deepEqual(
		ofType(rained.events, 'died').map((e) => e.uid),
		[them(ash).board[0].uid, them(ash).board[2].uid],
	);
	assert.deepEqual(
		them(rained.match).board.map((c) => c.cardId),
		['sproutling', 'brute', 'sproutling'],
	);
});

check("raised triggers queue the active player's first, then in board order", () => {
	const m = table({
		phase: 'combat',
		mine: { board: ['watcher', 'brute'], deck: ['dummy', 'dummy'] },
		theirs: { board: ['watcher'], deck: ['dummy', 'dummy'] },
	});
	const mine = me(m).board[0].uid;
	const theirs = them(m).board[0].uid;
	const fight = apply(m, { type: 'attack', attacker: mine, target: { unit: theirs } });
	assert.deepEqual(
		ofType(fight.events, 'drawn').map((e) => e.player),
		[0, 1],
	);
	const flipped = table({
		active: 1,
		phase: 'combat',
		mine: { board: ['watcher'], deck: ['dummy'] },
		theirs: { board: ['watcher'], deck: ['dummy'] },
	});
	const back = apply(flipped, {
		type: 'attack',
		attacker: me(flipped).board[0].uid,
		target: { unit: them(flipped).board[0].uid },
	});
	assert.deepEqual(
		ofType(back.events, 'drawn').map((e) => e.player),
		[1, 0],
	);
});

check("a summoned unit's onPlay does not fire", () => {
	const m = table({
		mine: { hand: ['cinder-bolt'], deck: ['dummy'] },
		theirs: { board: ['caller'], deck: ['dummy'] },
	});
	const { match, events } = playCard(m, 'cinder-bolt', { target: { unit: them(m).board[0].uid } });
	assert.deepEqual(
		them(match).board.map((c) => c.cardId),
		['archive-owl'],
	);
	assert.deepEqual(
		ofType(events, 'drawn'),
		[],
		'the owl was summoned, not played: it drew nothing',
	);
});

check("a death summon takes the dead unit's place when units beside it die too", () => {
	const m = table({
		mine: { hand: ['rain-of-ash', 'rain-of-ash'] },
		theirs: { board: ['sproutling', 'husk', 'dummy'] },
	});
	const rained = playCard(m, 'rain-of-ash').match;
	assert.deepEqual(
		them(rained).board.map((c) => c.cardId),
		['sproutling', 'dummy'],
	);
	assert.notEqual(them(rained).board[0].uid, them(m).board[0].uid, 'a new sproutling');
	const pair = table({
		mine: { hand: ['rain-of-ash'] },
		theirs: { board: ['husk', 'hollow-seed', 'dummy'] },
	});
	const { match, events } = playCard(pair, 'rain-of-ash');
	assert.deepEqual(
		them(match).board.map((c) => c.cardId),
		['sproutling', 'sproutling', 'sproutling', 'dummy'],
	);
	assert.deepEqual(
		ofType(events, 'summoned').map((e) => e.slot),
		[0, 1, 2],
		"husk's sproutling first, then hollow seed's two, each in the dead unit's place",
	);
});

check("a summon keeps the dead unit's place when the unit it was placed by dies first", () => {
	const m = table({
		mine: { hand: ['double-ash', 'rain-of-ash'] },
		theirs: { board: ['husk', 'pillar', 'dummy'] },
	});
	const twice = playCard(m, 'double-ash').match;
	assert.deepEqual(
		them(twice).board.map((c) => c.cardId),
		['sproutling', 'dummy'],
	);
	const sap = table({ mine: { hand: ['rain-of-ash'] }, theirs: { board: ['sapper', 'dummy'] } });
	const sapped = playCard(sap, 'rain-of-ash').match;
	assert.deepEqual(
		them(sapped).board.map((c) => c.cardId),
		['sproutling', 'dummy'],
		'an onDamaged summon of a unit that died of the same hit takes its place',
	);
});

check('onDamaged and onDeath raised by one effect share one order: the active player first', () => {
	const m = table({
		phase: 'combat',
		mine: { board: ['last-word'], deck: ['dummy'] },
		theirs: { board: ['spiteful'] },
	});
	const { events } = apply(m, {
		type: 'attack',
		attacker: me(m).board[0].uid,
		target: { unit: them(m).board[0].uid },
	});
	const drew = events.findIndex((e) => e.type === 'drawn');
	const pinged = events.findIndex((e) => e.type === 'damaged' && 'hero' in e.target);
	assert.ok(drew >= 0 && pinged >= 0, 'both triggers resolved');
	assert.ok(drew < pinged, "my unit's onDeath resolves before their unit's onDamaged");
});

check("an action's target is stored as the legal target, nothing more", () => {
	const m = table({ phase: 'combat', mine: { board: ['brute'] }, theirs: { board: ['dummy'] } });
	const dummy = them(m).board[0].uid;
	const junk = { unit: dummy, junk: [1] };
	const { events } = apply(m, { type: 'attack', attacker: me(m).board[0].uid, target: junk });
	assert.deepEqual(ofType(events, 'attacked')[0].target, { unit: dummy });
	const play = table({ mine: { hand: ['cinder-bolt'] } });
	const bolt = playCard(play, 'cinder-bolt', { target: { hero: 1, extra: true } });
	assert.deepEqual(ofType(bolt.events, 'damaged')[0].target, { hero: 1 });
});

check(`a loop ends the match as a draw after ${MAX_QUEUE_STEPS} effects`, () => {
	const m = table({
		mine: { hand: ['cinder-bolt'], board: ['mirror-golem'] },
		theirs: { board: ['mirror-golem'] },
	});
	const { match, events } = playCard(m, 'cinder-bolt', { target: { unit: them(m).board[0].uid } });
	assert.deepEqual(match.result, { winner: 'draw', reason: 'loop' });
	assert.deepEqual(match.queue, []);
	assert.deepEqual(events.at(-1), { type: 'matchEnded', winner: 'draw', reason: 'loop' });
	assert.equal(
		ofType(events, 'damaged').length + ofType(events, 'healed').length >= MAX_QUEUE_STEPS - 1,
		true,
	);
});

// ---- the end of a match --------------------------------------------------------------------

check('fatigue: an empty deck deals 1, 2, 3 … and can end the match', () => {
	let m = table({ phase: 'combat', active: 1 });
	const dealt = [];
	for (let turn = 0; turn < 6; turn++) {
		const toMain = apply(m, { type: 'endPhase' });
		dealt.push(...ofType(toMain.events, 'fatigue').map((e) => `${e.player}:${e.amount}`));
		m = apply(toMain.match, { type: 'endPhase' }).match;
	}
	assert.deepEqual(dealt, ['0:1', '1:1', '0:2', '1:2', '0:3', '1:3']);
	assert.deepEqual([m.players[0].health, m.players[0].fatigue], [24, 4]);
	const dying = table({ phase: 'combat', active: 1, theirs: { health: 1 } });
	const { match } = apply(dying, { type: 'endPhase' });
	assert.deepEqual(match.result, { winner: 1, reason: 'hero' });
	assert.equal(match.players[0].health, 0);
	assert.equal(match.players[0].fatigue, 2);
});

check('a hero at 0 loses; both at 0 together is a draw', () => {
	const m = table({ mine: { hand: ['scorch'] }, theirs: { health: 2 } });
	assert.deepEqual(playCard(m, 'scorch').match.result, { winner: 0, reason: 'hero' });
	const both = table({ mine: { hand: ['cinder-bolt'], health: 3 }, theirs: { health: 3 } });
	const selfHit = playCard(both, 'cinder-bolt', { target: { hero: 0 } });
	assert.deepEqual(selfHit.match.result, { winner: 1, reason: 'hero' });
	const mutual = table({ mine: { hand: ['backfire'], health: 3 }, theirs: { health: 3 } });
	const { match, events } = playCard(mutual, 'backfire', { target: { hero: 0 } });
	assert.deepEqual(match.result, { winner: 'draw', reason: 'hero' });
	assert.deepEqual(events.at(-1), { type: 'matchEnded', winner: 'draw', reason: 'hero' });
});

check('malformed rules throw', () => {
	const make = (rules) => () =>
		createMatch({ seed: 'r', decks: [DECK, DECK], library: LIBRARY, rules });
	for (const rules of [
		{ turnLimit: 0 },
		{ handLimit: '10' },
		{ boardLimit: 2.5 },
		{ startHealth: 0 },
		{ openingHand: -1 },
		{ resource: { perTurn: -1 } },
	]) {
		assert.throws(make(rules), /must be a whole number/, JSON.stringify(rules));
	}
	assert.throws(make('fast'), /rules must be an object/);
	assert.throws(make({ resource: 5 }), /resource must be an object/);
	assert.doesNotThrow(make({ openingHand: 0, resource: { start: 0 } }));
	assert.throws(
		() => createMatch({ seed: 'r', decks: [{ cards: DECK }, DECK], library: LIBRARY }),
		/deck 0 is not a list/,
	);
});

check('the turn limit ends the match as a draw', () => {
	let { match } = createMatch({
		seed: 'limit',
		decks: [DECK, DECK],
		library: LIBRARY,
		first: 0,
		rules: { turnLimit: 4 },
	});
	let last;
	while (!isOver(match)) {
		last = apply(match, { type: 'endPhase' });
		match = last.match;
	}
	assert.equal(match.turn, 4);
	assert.deepEqual(match.result, { winner: 'draw', reason: 'turnLimit' });
	assert.deepEqual(last.events.at(-1), { type: 'matchEnded', winner: 'draw', reason: 'turnLimit' });
});

// ---- randomness, replay and purity ---------------------------------------------------------

check("the match stream is board.js's mulberry32, held as a number", () => {
	const rng = createRng('same');
	let state = rngSeed('same');
	for (let i = 0; i < 5; i++) {
		const step = rngNext(state);
		assert.equal(step.value, rng());
		state = step.state;
	}
	const a = createMatch({ seed: 's', decks: [DECK, DECK], library: LIBRARY });
	const b = createMatch({ seed: 's', decks: [DECK, DECK], library: LIBRARY });
	const c = createMatch({ seed: 't', decks: [DECK, DECK], library: LIBRARY });
	assert.deepEqual(a, b);
	assert.notDeepEqual(
		a.match.players.map((p) => p.hand),
		c.match.players.map((p) => p.hand),
	);
	assert.equal(typeof a.match.rngState, 'number');
});

/** A whole match played by a seeded chooser, which prefers anything to ending a phase. */
function playOut(seed, chooserSeed = `${seed}:chooser`) {
	const choose = createRng(chooserSeed);
	const start = createMatch({ seed, decks: [DECK, DECK], library: LIBRARY });
	let match = start.match;
	const events = [...start.events];
	const actions = [];
	while (!isOver(match)) {
		const legal = legalActions(match).filter((a) => a.type !== 'concede');
		const moves = legal.filter((a) => a.type !== 'endPhase');
		const action =
			moves.length && choose() < 0.85
				? moves[Math.floor(choose() * moves.length)]
				: { type: 'endPhase' };
		const step = apply(match, action);
		actions.push(action);
		events.push(...step.events);
		match = step.match;
	}
	return { seed, actions, events, result: match.result, turn: match.turn };
}

function replay({ seed, actions }) {
	const start = createMatch({ seed, decks: [DECK, DECK], library: LIBRARY });
	let match = start.match;
	const events = [...start.events];
	for (const action of actions) {
		const step = apply(match, action);
		events.push(...step.events);
		match = step.match;
	}
	return { match, events };
}

const SEEDS = ['c1', 20261027, 'guard-wall', 'fatigue-run'];

check('every listed action applies, and apply never changes its input', () => {
	for (const seed of SEEDS) {
		const choose = createRng(`${seed}:purity`);
		let match = createMatch({ seed, decks: [DECK, DECK], library: LIBRARY }).match;
		deepFreeze(match);
		let steps = 0;
		while (!isOver(match) && steps++ < 2000) {
			const before = JSON.stringify(match);
			const legal = legalActions(match);
			for (const action of legal) {
				if (action.type === 'concede') continue;
				apply(match, action);
				if (
					action.type === 'play' &&
					match.library[me(match).hand.find((c) => c.uid === action.uid).cardId].type === 'unit'
				) {
					apply(match, { ...action, slot: 0 });
				}
			}
			assert.equal(JSON.stringify(match), before, 'a trial apply changed the match');
			const moves = legal.filter((a) => a.type !== 'concede' && a.type !== 'endPhase');
			const action =
				moves.length && choose() < 0.8
					? moves[Math.floor(choose() * moves.length)]
					: { type: 'endPhase' };
			match = deepFreeze(apply(match, action).match);
		}
		assert.ok(isOver(match), `seed ${seed} ended`);
	}
});

check('a seed and an action list replay byte for byte, and match the committed trace', () => {
	const traces = SEEDS.map((seed) => playOut(seed));
	for (const trace of traces) {
		const again = replay(trace);
		assert.equal(
			JSON.stringify(again.events),
			JSON.stringify(trace.events),
			`seed ${trace.seed} replayed differently`,
		);
		assert.deepEqual(again.match.result, trace.result);
	}
	assert.ok(
		traces.some((t) => t.result.reason === 'hero'),
		'a sample match should end on a hero',
	);
	const seen = new Set(traces.flatMap((t) => t.events.map((e) => e.type)));
	for (const type of [
		'summoned',
		'died',
		'healed',
		'buffed',
		'keywordGiven',
		'destroyed',
		'attacked',
	]) {
		assert.ok(seen.has(type), `the sample matches should include a ${type} event`);
	}
	const fixture = traces.map(({ seed, actions, result, turn, events }) => ({
		seed,
		result,
		turn,
		actions,
		events: events.length,
		digest: digest(JSON.stringify(events)),
	}));
	if (process.argv.includes('--update')) {
		writeFileSync(REPLAY_FIXTURE, `${JSON.stringify(fixture, null, '\t')}\n`);
		return;
	}
	assert.deepEqual(
		fixture,
		JSON.parse(readFileSync(REPLAY_FIXTURE, 'utf8')),
		'the replay drifted from cards-replay.json (run with --update only if the change to the rules is meant)',
	);
});

function deepFreeze(value) {
	if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}

/** FNV-1a over the event log, so the fixture pins every event without holding thousands. */
function digest(text) {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(16).padStart(8, '0');
}

if (failures.length) {
	console.error(failures.join('\n'));
	console.error(`\ncheck:card-rules — ${failures.length} failed, ${passed} passed`);
	process.exit(1);
}
console.log(`check:card-rules — ${passed} checks passed`);
