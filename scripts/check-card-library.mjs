// The card library's schema, validator, rules text and reader (packages/engine-mechanics/src/cards.js;
// docs/design/card-games.md §3, C1): every §3.6 error and warning by its code, the generated
// sentence for every verb × allowed target pinned as a string, and that unknown fields and values
// are dropped by the reader (docs/conventions/doc-readers.md) rather than failing the library —
// against the committed sample in packages/engine-mechanics/fixtures/cards-sample.library.json.
//
// Run: pnpm check:card-library

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CARD_KEYWORDS,
	CARD_TARGET_KINDS,
	CARD_TRIGGERS,
	CARD_VERB_TARGETS,
	CARD_VERBS,
	cardText,
	createMatch,
	readLibrary,
	validateLibrary,
} from '../packages/engine-mechanics/src/cards.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = JSON.parse(
	readFileSync(join(ROOT, 'packages/engine-mechanics/fixtures/cards-sample.library.json'), 'utf8'),
);

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

const unit = (id, extra = {}) => ({
	id,
	name: id,
	type: 'unit',
	cost: 1,
	attack: 1,
	health: 1,
	...extra,
});
/** A copy of a card with one field left out. */
const without = (card, field) =>
	Object.fromEntries(Object.entries(card).filter(([key]) => key !== field));
const spell = (id, extra = {}) => ({ id, name: id, type: 'spell', cost: 1, ...extra });

const T = {
	self: { kind: 'self' },
	enemyUnit: { kind: 'chosen', side: 'enemy', include: 'units' },
	enemyChar: { kind: 'chosen', side: 'enemy', include: 'characters' },
	friendlyUnit: { kind: 'chosen', side: 'friendly', include: 'units' },
	friendlyChar: { kind: 'chosen', side: 'friendly', include: 'characters' },
	anyUnit: { kind: 'chosen', side: 'any', include: 'units' },
	anyChar: { kind: 'chosen', side: 'any', include: 'characters' },
	allUnits: { kind: 'allEnemies', include: 'units' },
	allChars: { kind: 'allEnemies', include: 'characters' },
	randomUnit: { kind: 'randomEnemy', include: 'units' },
	randomChar: { kind: 'randomEnemy', include: 'characters' },
};

const hit = (target, trigger = 'onPlay') => ({ trigger, verb: 'damage', amount: 1, target });

/** Every issue as `severity code card path`, in the validator's order. */
const issues = (library, options) =>
	validateLibrary(library, options).map((i) => `${i.severity} ${i.code} ${i.card} ${i.path}`);

/** The issues one card raises on its own (plus any cards it needs), as `code path`. */
function errorsOf(card, ...others) {
	return validateLibrary([card, ...others])
		.filter((i) => i.card === card.id)
		.map((i) => `${i.code} ${i.path}`);
}

// ---- the closed lists ---------------------------------------------------------------------------

check('the closed lists are §3.2–§3.5', () => {
	assert.deepEqual(CARD_KEYWORDS, ['guard', 'swift', 'shield']);
	assert.deepEqual(CARD_TRIGGERS, ['onPlay', 'onDeath', 'turnStart', 'onAttack', 'onDamaged']);
	assert.deepEqual(CARD_TARGET_KINDS, ['self', 'chosen', 'allEnemies', 'randomEnemy']);
	assert.deepEqual(CARD_VERBS, [
		'damage',
		'heal',
		'draw',
		'summon',
		'buff',
		'destroy',
		'giveKeyword',
	]);
	assert.deepEqual(CARD_VERB_TARGETS, {
		damage: 'any',
		heal: 'any',
		draw: 'none',
		summon: 'none',
		buff: 'units',
		destroy: 'units',
		giveKeyword: 'units',
	});
});

// ---- validateLibrary: a clean library -----------------------------------------------------------

check('the sample library validates with no errors', () => {
	const errors = validateLibrary(SAMPLE).filter((i) => i.severity === 'error');
	assert.deepEqual(errors, []);
	assert.deepEqual(issues(SAMPLE), []);
});

check('the sample library, decks given, warns only for the cards no deck uses', () => {
	const deck = SAMPLE.filter((c) => !c.token && c.id !== 'quiet-end').map((c) => c.id);
	assert.deepEqual(issues(SAMPLE, { decks: [deck, deck] }), ['warning unused quiet-end ']);
});

check('unknown fields on a card, an effect or a target are not issues', () => {
	const card = unit('odd', {
		rarity: 'epic',
		effects: [{ ...hit({ ...T.enemyUnit, glow: true }), fx: 'sparks' }],
	});
	assert.deepEqual(issues([card]), []);
});

check('every number at the edge of its range is valid', () => {
	const library = [
		unit('low', { cost: 0, attack: 0, health: 1 }),
		unit('high', {
			cost: 10,
			attack: 20,
			health: 20,
			effects: [
				{ trigger: 'onPlay', verb: 'damage', amount: 20, target: T.anyChar },
				{ trigger: 'onDeath', verb: 'summon', card: 'low', count: 3 },
				{
					trigger: 'turnStart',
					verb: 'buff',
					attack: -10,
					health: 10,
					until: 'permanent',
					target: T.self,
				},
			],
		}),
		spell('edges', {
			effects: [
				{ trigger: 'onPlay', verb: 'heal', amount: 1, target: T.anyChar },
				{ trigger: 'onPlay', verb: 'draw', amount: 5 },
				{
					trigger: 'onPlay',
					verb: 'buff',
					attack: 10,
					health: -10,
					until: 'endOfTurn',
					target: T.allUnits,
				},
			],
		}),
		spell('mins', {
			effects: [
				{ trigger: 'onPlay', verb: 'damage', amount: 1, target: T.randomChar },
				{ trigger: 'onPlay', verb: 'heal', amount: 20, target: T.enemyChar },
				{ trigger: 'onPlay', verb: 'draw', amount: 1 },
			],
		}),
		spell('one-summon', {
			effects: [{ trigger: 'onPlay', verb: 'summon', card: 'low', count: 1 }],
		}),
	];
	assert.deepEqual(issues(library), []);
});

// ---- validateLibrary: the §3.6 errors -----------------------------------------------------------

check('an unknown verb', () => {
	assert.deepEqual(errorsOf(unit('a', { effects: [{ ...hit(T.self), verb: 'explode' }] })), [
		'verb effects[0].verb',
	]);
});

check('an unknown trigger', () => {
	assert.deepEqual(errorsOf(unit('a', { effects: [hit(T.self, 'onSunrise')] })), [
		'trigger effects[0].trigger',
	]);
});

check('an unknown target kind, and a missing target', () => {
	assert.deepEqual(errorsOf(unit('a', { effects: [hit({ kind: 'everyone' })] })), [
		'target effects[0].target.kind',
	]);
	assert.deepEqual(errorsOf(unit('a', { effects: [{ trigger: 'onPlay', verb: 'destroy' }] })), [
		'target effects[0].target',
	]);
});

check('an unknown keyword on a card and in giveKeyword', () => {
	assert.deepEqual(errorsOf(unit('a', { keywords: ['guard', 'flying'] })), ['keyword keywords[1]']);
	assert.deepEqual(errorsOf(unit('a', { keywords: 'guard' })), ['keyword keywords']);
	const give = { trigger: 'onPlay', verb: 'giveKeyword', keyword: 'flying', target: T.anyUnit };
	assert.deepEqual(errorsOf(spell('a', { effects: [give] })), ['keyword effects[0].keyword']);
});

check('a verb with a target its §3.2 row does not allow', () => {
	for (const verb of ['buff', 'destroy', 'giveKeyword']) {
		for (const target of [T.enemyChar, T.anyChar, T.allChars, T.randomChar]) {
			const effect = {
				trigger: 'onPlay',
				verb,
				attack: 1,
				health: 1,
				until: 'permanent',
				keyword: 'guard',
				target,
			};
			if (verb !== 'buff') for (const key of ['attack', 'health', 'until']) delete effect[key];
			if (verb !== 'giveKeyword') delete effect.keyword;
			assert.deepEqual(
				errorsOf(spell('a', { effects: [effect] })),
				['targetNotAllowed effects[0].target.include'],
				`${verb} → ${target.kind} characters`,
			);
		}
	}
	const draw = { trigger: 'onPlay', verb: 'draw', amount: 1, target: T.self };
	assert.deepEqual(errorsOf(unit('a', { effects: [draw] })), [
		'targetNotAllowed effects[0].target',
	]);
	const summon = { trigger: 'onPlay', verb: 'summon', card: 'b', target: T.anyUnit };
	assert.deepEqual(errorsOf(unit('a', { effects: [summon] }), unit('b')), [
		'targetNotAllowed effects[0].target',
	]);
});

check('self on a spell', () => {
	assert.deepEqual(errorsOf(spell('a', { effects: [hit(T.self)] })), [
		'selfOnSpell effects[0].target',
	]);
});

check('chosen off onPlay', () => {
	for (const trigger of ['onDeath', 'turnStart', 'onAttack', 'onDamaged']) {
		assert.deepEqual(
			errorsOf(unit('a', { effects: [hit(T.enemyUnit, trigger)] })),
			['chosenOffPlay effects[0].target'],
			trigger,
		);
	}
});

check('a spell with a non-onPlay effect', () => {
	for (const trigger of ['onDeath', 'turnStart', 'onAttack', 'onDamaged']) {
		assert.deepEqual(
			errorsOf(spell('a', { effects: [hit(T.allUnits, trigger)] })),
			['spellTrigger effects[0].trigger'],
			trigger,
		);
	}
});

check('a unit without attack or health', () => {
	const noAttack = without(unit('a'), 'attack');
	const noHealth = without(unit('b'), 'health');
	assert.deepEqual(errorsOf(noAttack), ['range attack']);
	assert.deepEqual(errorsOf(noHealth), ['range health']);
});

check('every number outside its range, and non-integers', () => {
	const cases = [
		[unit('a', { cost: -1 }), 'cost'],
		[unit('a', { cost: 11 }), 'cost'],
		[unit('a', { cost: 1.5 }), 'cost'],
		[unit('a', { cost: '1' }), 'cost'],
		[spell('a'), null],
		[{ ...spell('a'), cost: undefined }, 'cost'],
		[unit('a', { attack: -1 }), 'attack'],
		[unit('a', { attack: 21 }), 'attack'],
		[unit('a', { attack: 0.5 }), 'attack'],
		[unit('a', { health: 0 }), 'health'],
		[unit('a', { health: 21 }), 'health'],
		[unit('a', { health: Number.NaN }), 'health'],
		[spell('a', { effects: [{ ...hit(T.anyChar), amount: 0 }] }), 'effects[0].amount'],
		[spell('a', { effects: [{ ...hit(T.anyChar), amount: 21 }] }), 'effects[0].amount'],
		[spell('a', { effects: [{ ...hit(T.anyChar), amount: 2.5 }] }), 'effects[0].amount'],
		[
			spell('a', { effects: [{ ...hit(T.anyChar), verb: 'heal', amount: 0 }] }),
			'effects[0].amount',
		],
		[
			spell('a', { effects: [{ ...hit(T.anyChar), verb: 'heal', amount: 21 }] }),
			'effects[0].amount',
		],
		[
			spell('a', { effects: [{ trigger: 'onPlay', verb: 'draw', amount: 0 }] }),
			'effects[0].amount',
		],
		[
			spell('a', { effects: [{ trigger: 'onPlay', verb: 'draw', amount: 6 }] }),
			'effects[0].amount',
		],
		[spell('a', { effects: [{ trigger: 'onPlay', verb: 'draw' }] }), 'effects[0].amount'],
	];
	for (const [card, path] of cases) {
		assert.deepEqual(errorsOf(card), path ? [`range ${path}`] : [], JSON.stringify(card));
	}
	const summon = (count) =>
		unit('a', { effects: [{ trigger: 'onDeath', verb: 'summon', card: 'b', count }] });
	for (const count of [0, 4, 1.5]) {
		assert.deepEqual(
			errorsOf(summon(count), unit('b')),
			['range effects[0].count'],
			`count ${count}`,
		);
	}
	const buff = (attack, health) =>
		spell('a', {
			effects: [
				{ trigger: 'onPlay', verb: 'buff', attack, health, until: 'permanent', target: T.anyUnit },
			],
		});
	assert.deepEqual(errorsOf(buff(-11, 0)), ['range effects[0].attack']);
	assert.deepEqual(errorsOf(buff(11, 0)), ['range effects[0].attack']);
	assert.deepEqual(errorsOf(buff(0, -11)), ['range effects[0].health']);
	assert.deepEqual(errorsOf(buff(0, 11)), ['range effects[0].health']);
	assert.deepEqual(errorsOf(buff(0.5, 0)), ['range effects[0].attack']);
	assert.deepEqual(errorsOf(buff(0, undefined)), ['range effects[0].health']);
});

check('a summon of a missing card, of a spell, and of nothing', () => {
	const summon = (card) => ({ trigger: 'onDeath', verb: 'summon', card });
	assert.deepEqual(errorsOf(unit('a', { effects: [summon('ghost')] })), [
		'summonCard effects[0].card',
	]);
	assert.deepEqual(errorsOf(unit('a', { effects: [summon('b')] }), spell('b')), [
		'summonCard effects[0].card',
	]);
	assert.deepEqual(errorsOf(unit('a', { effects: [summon(undefined)] })), [
		'summonCard effects[0].card',
	]);
});

check('a duplicate id', () => {
	assert.deepEqual(issues([unit('a'), unit('a', { name: 'Again' })]), ['error duplicateId a ']);
});

check('more than three effects', () => {
	const draw = { trigger: 'onPlay', verb: 'draw', amount: 1 };
	assert.deepEqual(errorsOf(spell('a', { effects: [draw, draw, draw] })), []);
	assert.deepEqual(errorsOf(spell('a', { effects: [draw, draw, draw, draw] })), [
		'effectCount effects',
	]);
});

check('a spell with attack, health or keywords', () => {
	assert.deepEqual(errorsOf(spell('a', { attack: 1 })), ['spellStats attack']);
	assert.deepEqual(errorsOf(spell('a', { health: 1 })), ['spellStats health']);
	assert.deepEqual(errorsOf(spell('a', { keywords: ['guard'] })), ['spellStats keywords']);
});

check('a bad until on a buff', () => {
	const buff = (until) => ({
		trigger: 'onPlay',
		verb: 'buff',
		attack: 1,
		health: 1,
		until,
		target: T.anyUnit,
	});
	assert.deepEqual(errorsOf(spell('a', { effects: [buff('forever')] })), [
		'until effects[0].until',
	]);
	assert.deepEqual(errorsOf(spell('a', { effects: [buff(undefined)] })), [
		'until effects[0].until',
	]);
});

check('a bad include or side', () => {
	assert.deepEqual(errorsOf(spell('a', { effects: [hit({ ...T.anyChar, include: 'heroes' })] })), [
		'include effects[0].target.include',
	]);
	assert.deepEqual(errorsOf(spell('a', { effects: [hit({ kind: 'allEnemies' })] })), [
		'include effects[0].target.include',
	]);
	assert.deepEqual(errorsOf(spell('a', { effects: [hit({ ...T.anyChar, side: 'both' })] })), [
		'side effects[0].target.side',
	]);
	assert.deepEqual(errorsOf(spell('a', { effects: [hit({ kind: 'chosen', include: 'units' })] })), [
		'side effects[0].target.side',
	]);
});

check('a missing id, name or type', () => {
	assert.deepEqual(issues([{ ...unit('a'), id: undefined }]), ['error id #0 ']);
	assert.deepEqual(errorsOf({ ...unit('a'), name: '' }), ['name name']);
	assert.deepEqual(errorsOf({ ...unit('a'), type: 'hero' }), ['type type']);
});

// ---- validateLibrary: the warnings --------------------------------------------------------------

check('an onDeath summon cycle A → B → A warns on both cards', () => {
	const summon = (card) => ({ trigger: 'onDeath', verb: 'summon', card });
	const library = [unit('a', { effects: [summon('b')] }), unit('b', { effects: [summon('a')] })];
	assert.deepEqual(issues(library), [
		'warning summonLoop a effects',
		'warning summonLoop b effects',
	]);
});

check('a card that summons itself on death warns; a chain that ends does not', () => {
	const summon = (card) => ({ trigger: 'onDeath', verb: 'summon', card });
	assert.deepEqual(issues([unit('a', { effects: [summon('a')] })]), [
		'warning summonLoop a effects',
	]);
	assert.deepEqual(issues([unit('a', { effects: [summon('b')] }), unit('b')]), []);
	const onPlay = { trigger: 'onPlay', verb: 'summon', card: 'a' };
	assert.deepEqual(issues([unit('a', { effects: [onPlay] })]), []);
});

check('a card no deck uses warns, only when decks are passed, and never for a token', () => {
	const library = [unit('a'), unit('b'), unit('t', { token: true })];
	assert.deepEqual(issues(library), []);
	assert.deepEqual(issues(library, { decks: [['a'], [{ card: 'a', count: 2 }]] }), [
		'warning unused b ',
	]);
	assert.deepEqual(issues(library, { decks: [{ id: 'one', cards: ['a', 'b'] }] }), []);
});

check('a token in a deck warns', () => {
	const library = [unit('a'), unit('t', { token: true })];
	assert.deepEqual(issues(library, { decks: [{ id: 'main', cards: ['a', 't'] }] }), [
		'warning tokenInDeck t ',
	]);
	const warning = validateLibrary(library, { decks: [['a', 't']] })[0];
	assert.equal(warning.message, 'is a token but deck #0 holds it');
});

// ---- cardText -----------------------------------------------------------------------------------

/** A card with one effect, valid as written; spells for chosen/enemy targets, a unit for self. */
function textOf(effect) {
	const card =
		effect.target?.kind === 'self'
			? unit('x', { effects: [effect] })
			: spell('x', { effects: [effect] });
	assert.deepEqual(issues([card]), [], `the pinned card is valid: ${JSON.stringify(effect)}`);
	return cardText(card);
}

const damage = (target) => ({ trigger: 'onPlay', verb: 'damage', amount: 2, target });
const heal = (target) => ({ trigger: 'onPlay', verb: 'heal', amount: 3, target });
const buff = (target) => ({
	trigger: 'onPlay',
	verb: 'buff',
	attack: 2,
	health: 1,
	until: 'permanent',
	target,
});
const destroy = (target) => ({ trigger: 'onPlay', verb: 'destroy', target });
const give = (target) => ({ trigger: 'onPlay', verb: 'giveKeyword', keyword: 'shield', target });

const TEXT = [
	[damage(T.self), 'When played, deal 2 damage to this unit.'],
	[damage(T.enemyUnit), 'Deal 2 damage to a chosen enemy unit.'],
	[damage(T.enemyChar), 'Deal 2 damage to a chosen enemy character.'],
	[damage(T.friendlyUnit), 'Deal 2 damage to a chosen friendly unit.'],
	[damage(T.friendlyChar), 'Deal 2 damage to a chosen friendly character.'],
	[damage(T.anyUnit), 'Deal 2 damage to a chosen unit.'],
	[damage(T.anyChar), 'Deal 2 damage to a chosen character.'],
	[damage(T.allUnits), 'Deal 2 damage to all enemy units.'],
	[damage(T.allChars), 'Deal 2 damage to all enemy characters.'],
	[damage(T.randomUnit), 'Deal 2 damage to a random enemy unit.'],
	[damage(T.randomChar), 'Deal 2 damage to a random enemy character.'],
	[heal(T.self), 'When played, restore 3 health to this unit.'],
	[heal(T.enemyUnit), 'Restore 3 health to a chosen enemy unit.'],
	[heal(T.enemyChar), 'Restore 3 health to a chosen enemy character.'],
	[heal(T.friendlyUnit), 'Restore 3 health to a chosen friendly unit.'],
	[heal(T.friendlyChar), 'Restore 3 health to a chosen friendly character.'],
	[heal(T.anyUnit), 'Restore 3 health to a chosen unit.'],
	[heal(T.anyChar), 'Restore 3 health to a chosen character.'],
	[heal(T.allUnits), 'Restore 3 health to all enemy units.'],
	[heal(T.allChars), 'Restore 3 health to all enemy characters.'],
	[heal(T.randomUnit), 'Restore 3 health to a random enemy unit.'],
	[heal(T.randomChar), 'Restore 3 health to a random enemy character.'],
	[buff(T.self), 'When played, give this unit +2/+1.'],
	[buff(T.enemyUnit), 'Give a chosen enemy unit +2/+1.'],
	[buff(T.friendlyUnit), 'Give a chosen friendly unit +2/+1.'],
	[buff(T.anyUnit), 'Give a chosen unit +2/+1.'],
	[buff(T.allUnits), 'Give all enemy units +2/+1.'],
	[buff(T.randomUnit), 'Give a random enemy unit +2/+1.'],
	[destroy(T.self), 'When played, destroy this unit.'],
	[destroy(T.enemyUnit), 'Destroy a chosen enemy unit.'],
	[destroy(T.friendlyUnit), 'Destroy a chosen friendly unit.'],
	[destroy(T.anyUnit), 'Destroy a chosen unit.'],
	[destroy(T.allUnits), 'Destroy all enemy units.'],
	[destroy(T.randomUnit), 'Destroy a random enemy unit.'],
	[give(T.self), 'When played, give this unit Shield.'],
	[give(T.enemyUnit), 'Give a chosen enemy unit Shield.'],
	[give(T.friendlyUnit), 'Give a chosen friendly unit Shield.'],
	[give(T.anyUnit), 'Give a chosen unit Shield.'],
	[give(T.allUnits), 'Give all enemy units Shield.'],
	[give(T.randomUnit), 'Give a random enemy unit Shield.'],
	[{ trigger: 'onPlay', verb: 'draw', amount: 1 }, 'Draw a card.'],
	[{ trigger: 'onPlay', verb: 'draw', amount: 3 }, 'Draw 3 cards.'],
];

check('cardText covers every verb × every target it allows', () => {
	const covered = new Set(
		TEXT.map(([e]) =>
			e.target
				? `${e.verb} ${e.target.kind} ${e.target.side ?? ''} ${e.target.include ?? ''}`
				: e.verb,
		),
	);
	const sides = ['enemy', 'friendly', 'any'];
	for (const verb of CARD_VERBS) {
		const allowed = CARD_VERB_TARGETS[verb];
		if (allowed === 'none') {
			if (verb !== 'summon') assert.ok(covered.has(verb), verb);
			continue;
		}
		const includes = allowed === 'any' ? ['units', 'characters'] : ['units'];
		assert.ok(covered.has(`${verb} self  `), `${verb} self`);
		for (const include of includes) {
			for (const side of sides) {
				assert.ok(covered.has(`${verb} chosen ${side} ${include}`), `${verb} ${side} ${include}`);
			}
			assert.ok(covered.has(`${verb} allEnemies  ${include}`), `${verb} allEnemies ${include}`);
			assert.ok(covered.has(`${verb} randomEnemy  ${include}`), `${verb} randomEnemy ${include}`);
		}
	}
});

check('cardText for every verb × target, pinned', () => {
	for (const [effect, expected] of TEXT) assert.deepEqual(textOf(effect), [expected]);
});

check('cardText: summon names the summoned card, 1 vs n', () => {
	const library = [
		unit('seed', {
			effects: [
				{ trigger: 'onDeath', verb: 'summon', card: 'sprout' },
				{ trigger: 'onDeath', verb: 'summon', card: 'sprout', count: 1 },
				{ trigger: 'onDeath', verb: 'summon', card: 'sprout', count: 3 },
			],
		}),
		unit('sprout', { name: 'Sproutling', token: true }),
	];
	assert.deepEqual(issues(library), []);
	assert.deepEqual(cardText(library[0], library), [
		'When this dies, summon a copy of Sproutling.',
		'When this dies, summon a copy of Sproutling.',
		'When this dies, summon 3 copies of Sproutling.',
	]);
	const spellSummon = spell('call', {
		effects: [{ trigger: 'onPlay', verb: 'summon', card: 'sprout', count: 2 }],
	});
	assert.deepEqual(cardText(spellSummon, library), ['Summon 2 copies of Sproutling.']);
	assert.deepEqual(cardText(spellSummon), ['Summon 2 copies of sprout.'], 'no library: the id');
});

check('cardText: the trigger phrasings', () => {
	const draw = (trigger) => ({ trigger, verb: 'draw', amount: 1 });
	const card = unit('x', { effects: [draw('onPlay'), draw('onDeath'), draw('turnStart')] });
	assert.deepEqual(cardText(card), [
		'When played, draw a card.',
		'When this dies, draw a card.',
		'At the start of your turn, draw a card.',
	]);
	const card2 = unit('y', {
		effects: [hit(T.randomChar, 'onAttack'), hit(T.allUnits, 'onDamaged')],
	});
	assert.deepEqual(cardText(card2), [
		'When this attacks, deal 1 damage to a random enemy character.',
		'When this takes damage, deal 1 damage to all enemy units.',
	]);
	assert.deepEqual(cardText(spell('z', { effects: [draw('onPlay')] })), ['Draw a card.']);
});

check('cardText: a buff with negative numbers and endOfTurn', () => {
	const effect = (attack, health, until) => ({
		trigger: 'turnStart',
		verb: 'buff',
		attack,
		health,
		until,
		target: T.self,
	});
	const card = unit('x', {
		effects: [effect(-2, -1, 'endOfTurn'), effect(3, 0, 'endOfTurn'), effect(0, -3, 'permanent')],
	});
	assert.deepEqual(issues([card]), []);
	assert.deepEqual(cardText(card), [
		'At the start of your turn, give this unit -2/-1 until the end of the turn.',
		'At the start of your turn, give this unit +3/+0 until the end of the turn.',
		'At the start of your turn, give this unit +0/-3.',
	]);
});

check('cardText: one sentence per effect, in authored order; none for a vanilla card', () => {
	const card = SAMPLE.find((c) => c.id === 'rally-cry');
	assert.deepEqual(cardText(card, SAMPLE), [
		'Give a chosen friendly unit +2/+2.',
		'Give a chosen friendly unit Guard.',
	]);
	assert.deepEqual(
		cardText(
			SAMPLE.find((c) => c.id === 'ember-imp'),
			SAMPLE,
		),
		[],
	);
	assert.deepEqual(
		cardText(
			SAMPLE.find((c) => c.id === 'hollow-seed'),
			SAMPLE,
		),
		['When this dies, summon 2 copies of Sproutling.'],
	);
});

// ---- readLibrary: unknown fields and values -----------------------------------------------------

check('a library of only known fields reads deep-equal to itself, nothing dropped', () => {
	const before = JSON.stringify(SAMPLE);
	const read = readLibrary(SAMPLE);
	assert.deepEqual(read.library, SAMPLE);
	assert.deepEqual(read.dropped, []);
	assert.equal(JSON.stringify(SAMPLE), before, 'the input is not changed');
	const full = unit('full', {
		keywords: ['guard', 'swift', 'shield'],
		flavor: 'Old.',
		frame: 'frame-a',
		params: { art: 'a.png', glow: 2, foil: true },
		token: true,
	});
	assert.deepEqual(readLibrary([full]), { library: [full], dropped: [] });
});

check('readLibrary drops an unknown card, effect and target field, naming each', () => {
	const card = unit('a', {
		rarity: 'epic',
		effects: [{ ...hit({ ...T.enemyUnit, glow: true }), fx: 'sparks' }],
	});
	const read = readLibrary([card]);
	assert.deepEqual(read.library, [unit('a', { effects: [hit(T.enemyUnit)] })]);
	assert.deepEqual(read.dropped, [
		'[0] (a).rarity',
		'[0] (a).effects[0].target.glow',
		'[0] (a).effects[0].fx',
	]);
});

check('readLibrary drops a field its verb or target kind does not have', () => {
	const card = unit('a', {
		effects: [
			{ trigger: 'onPlay', verb: 'draw', amount: 1, target: T.self },
			hit({ kind: 'self', side: 'enemy' }),
			hit({ kind: 'self', include: 'bogus' }),
			hit({ kind: 'allEnemies', include: 'units', side: 'sideways' }),
		],
	});
	const read = readLibrary([card]);
	assert.deepEqual(read.library[0].effects, [
		{ trigger: 'onPlay', verb: 'draw', amount: 1 },
		hit(T.self),
		hit(T.self),
		hit({ kind: 'allEnemies', include: 'units' }),
	]);
	assert.deepEqual(read.dropped, [
		'[0] (a).effects[0].target',
		'[0] (a).effects[1].target.side',
		'[0] (a).effects[2].target.include',
		'[0] (a).effects[3].target.side',
	]);
});

check(
	'an unknown verb, trigger, target kind, side, include or until drops just that effect',
	() => {
		const keep = { trigger: 'onPlay', verb: 'draw', amount: 1 };
		const bad = [
			[{ ...hit(T.anyUnit), verb: 'explode' }, 'verb "explode"'],
			[hit(T.anyUnit, 'onSunrise'), 'trigger "onSunrise"'],
			[hit({ kind: 'everyone', include: 'units' }), 'target "everyone"'],
			[hit({ ...T.anyUnit, side: 'both' }), 'side "both"'],
			[hit({ ...T.allUnits, include: 'heroes' }), 'include "heroes"'],
			[{ ...buff(T.anyUnit), until: 'forever' }, 'until "forever"'],
			[{ ...give(T.anyUnit), keyword: 'flying' }, 'keyword "flying"'],
		];
		for (const [effect, why] of bad) {
			const read = readLibrary([spell('s', { effects: [keep, effect, keep] })]);
			assert.deepEqual(read.library, [spell('s', { effects: [keep, keep] })], why);
			assert.deepEqual(read.dropped, [`[0] (s).effects[1]: ${why}`], why);
		}
	},
);

check('an unknown keyword drops just the keyword', () => {
	const read = readLibrary([unit('a', { keywords: ['guard', 'flying', 'shield'] })]);
	assert.deepEqual(read.library, [unit('a', { keywords: ['guard', 'shield'] })]);
	assert.deepEqual(read.dropped, ['[0] (a).keywords: "flying"']);
});

check('an unknown card type drops the card', () => {
	const read = readLibrary([unit('a'), { ...unit('h'), type: 'hero' }, unit('b')]);
	assert.deepEqual(read.library, [unit('a'), unit('b')]);
	assert.deepEqual(read.dropped, ['[1] (h): type "hero"']);
});

check('every drop at once is listed in dropped, in order', () => {
	const library = [
		{ ...unit('h'), type: 'artifact' },
		unit('a', {
			keywords: ['flying'],
			lore: 'x',
			effects: [{ ...hit(T.self), verb: 'explode' }, hit({ ...T.self, glow: 1 })],
		}),
	];
	const read = readLibrary(library);
	assert.deepEqual(read.library, [unit('a', { keywords: [], effects: [hit(T.self)] })]);
	assert.deepEqual(read.dropped, [
		'[0] (h): type "artifact"',
		'[1] (a).lore',
		'[1] (a).keywords: "flying"',
		'[1] (a).effects[0]: verb "explode"',
		'[1] (a).effects[1].target.glow',
	]);
});

// ---- createMatch reads before it validates ------------------------------------------------------

const DECK = Array.from({ length: 10 }, (_, i) => (i % 2 ? 'a' : 'b'));

check('createMatch loads a library carrying unknown fields and an unknown verb', () => {
	const library = [
		unit('a', { rarity: 'epic', effects: [{ ...hit(T.allUnits), verb: 'explode', fx: 1 }] }),
		unit('b', { keywords: ['guard', 'flying'], effects: [{ ...hit(T.anyChar), glow: 1 }] }),
		{ ...unit('c'), type: 'artifact' },
	];
	assert.ok(
		validateLibrary(library).some((i) => i.severity === 'error'),
		'the validator refuses it',
	);
	const { match, dropped } = createMatch({ seed: 1, decks: [DECK, DECK], library, first: 0 });
	assert.deepEqual(dropped, readLibrary(library).dropped, 'the drops come back for a warning');
	assert.ok(dropped.length > 0);
	assert.equal(match.phase, 'main');
	assert.deepEqual(match.library.a, unit('a', { effects: [] }));
	assert.deepEqual(match.library.b.keywords, ['guard']);
	assert.deepEqual(match.library.b.effects, [hit(T.anyChar)]);
	assert.equal(match.library.c, undefined);
});

check('a value of the wrong type is malformed, not unknown: it is kept and refused', () => {
	const library = [
		{ ...unit('a'), type: 3 },
		unit('b', { keywords: ['guard', 7] }),
		unit('c', { effects: [{ ...hit(T.allUnits), verb: 5 }] }),
		unit('d', { effects: [hit({ kind: 9, include: 'units' })] }),
	];
	const read = readLibrary(library);
	assert.deepEqual(read.dropped, []);
	assert.deepEqual(read.library, library);
	const codes = validateLibrary(read.library).map((i) => `${i.card} ${i.code}`);
	assert.deepEqual(codes, ['a type', 'b keyword', 'c verb', 'd target']);
	assert.throws(() => createMatch({ seed: 1, decks: [[], []], library }), /4 error/);
});

check('createMatch throws on a library with a real error', () => {
	const noHealth = without(unit('b'), 'health');
	assert.throws(
		() => createMatch({ seed: 1, decks: [DECK, DECK], library: [unit('a'), noHealth] }),
		/the library has 1 error\(s\): b health must be a whole number from 1 to 20/,
	);
	assert.throws(
		() => createMatch({ seed: 1, decks: [DECK, DECK], library: [unit('a'), unit('b'), unit('a')] }),
		/used twice/,
	);
});

check('createMatch plays the sample library', () => {
	const deck = SAMPLE.filter((c) => !c.token).map((c) => c.id);
	const { match } = createMatch({ seed: 7, decks: [deck, deck], library: SAMPLE });
	assert.equal(match.phase, 'main');
	assert.equal(Object.keys(match.library).length, SAMPLE.length);
});

if (failures.length) {
	console.error(failures.join('\n'));
	console.error(`\ncheck:card-library — ${failures.length} failed, ${passed} passed`);
	process.exit(1);
}
console.log(`check:card-library — ${passed} checks passed`);
