/**
 * Offline fixture for the GAME FAMILY and OUTCOME fields (`docs/design/game-families.md` §2.1,
 * P10.1). This package's internal imports are extensionless (bundler resolution), which bare `node`
 * cannot resolve, so run it through tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/game-config/family.fixture.ts
 *
 * What it pins:
 *
 *  1. THE RESOLVERS. Absent ⇒ a slot decided by the RGS, the meaning of every doc authored before
 *     Phase 10. A slot is always RGS-decided, whatever it carries.
 *  2. DEFAULTS ARE NEVER STORED, and a block lives only beside its family. A slot doc that names the
 *     defaults normalizes byte-identically to one that does not; a match-3 doc stores no `winModel`
 *     or `cascade` (it always plays the `match3` arm and always tumbles).
 *  3. ROUND-TRIPS. Each family's doc is a fixed point of the normalizer.
 *  4. VALIDATION FOLLOWS THE FAMILY, and the section table `/config` renders from: what a family
 *     hides never refuses its save.
 *  5. The family list agrees with `constants-shared`'s, which this package cannot import.
 *  6. ARCADE CHARACTERS (P10.11): sparse and cleaned by the normalizer, a fixed point, absent from
 *     a doc without them, checked by the validator, and every runtime-spawned look listed for the
 *     bake by `characterComponentIds`.
 */

import { GAME_FAMILIES, familyOfKind } from '../constants-shared/gameKinds.ts';
import {
	CONFIG_FAMILIES,
	ARCADE_ONLINE_DEFAULTS,
	DEFAULT_ARCADE_FIXED_HZ,
	normalizeArcade,
	resolveArcadeOnline,
	normalizeMatch3,
	resolveArcade,
	resolveFamily,
	resolveMatch3,
	resolveOutcome,
} from './src/family.ts';
import { characterComponentIds, normalizeArcadeCharacters } from './src/arcadeCharacters.ts';
import { CONFIG_SECTIONS, configSectionsFor, configShowsPays } from './src/familySections.ts';
import { resolveCascade } from './src/mechanics.ts';
import { normalizeGameConfigDoc } from './src/normalize.ts';
import { validateGameConfigDoc } from './src/validate.ts';
import { resolveWinModel } from './src/winModel.ts';
import type { GameConfigDoc } from './src/types.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const normalize = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(raw);
	if (!doc) throw new Error(`did not normalize: ${JSON.stringify(raw)}`);
	return doc;
};
const paths = (doc: GameConfigDoc, severity?: 'error' | 'warning') =>
	validateGameConfigDoc(doc)
		.filter((i) => !severity || i.severity === severity)
		.map((i) => i.path);

const strips = (cols: number, cells = ['A', 'B', 'C', 'D']) =>
	Array.from({ length: cols }, () => [...cells]);

const SLOT = {
	providerName: '',
	gameName: '',
	gameID: '',
	rtp: 0.96,
	numReels: 3,
	numRows: [3, 3, 3],
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 1000 } },
	paylines: { '1': [0, 0, 0] },
	symbols: { A: { paytable: [{ '3': 5 }] }, B: {}, C: {}, D: {} },
	paddingReels: { basegame: strips(3) },
};

const MATCH3 = {
	...SLOT,
	family: 'match3',
	numReels: 6,
	numRows: [6, 6, 6, 6, 6, 6],
	paylines: {},
	paddingReels: { basegame: strips(6, ['A', 'B', 'C', 'D', 'A', 'B', 'C']) },
	symbols: { A: { paytable: [{ '3': 1 }] }, B: {}, C: {}, D: {} },
};

const ARCADE = { family: 'arcade', outcome: 'rules', gameName: 'Dodger' };

console.log('\n1. the resolvers');
check('absent ⇒ slot', resolveFamily(undefined), 'slot');
check('an un-authored doc ⇒ rgs', resolveOutcome(undefined), 'rgs');
check('match-3 ⇒ match3', resolveFamily({ family: 'match3' }), 'match3');
check('match-3, rules ⇒ rules', resolveOutcome({ family: 'match3', outcome: 'rules' }), 'rules');
check('match-3, no outcome ⇒ rgs', resolveOutcome({ family: 'match3' }), 'rgs');
check('a slot is always rgs', resolveOutcome({ outcome: 'rules' }), 'rgs');
check('match-3 min run defaults to 3', resolveMatch3({}).minRun, 3);
check('arcade rate defaults to 60', resolveArcade({}).fixedHz, DEFAULT_ARCADE_FIXED_HZ);
check(
	'a match-3 doc plays the match3 arm, from its block',
	resolveWinModel({
		family: 'match3',
		match3: { minRun: 4 },
		winModel: { type: 'ways', direction: 'ltr', minKind: 3 },
	}),
	{ type: 'match3', minRun: 4 },
);
check(
	'a slot keeps its win model',
	resolveWinModel({ winModel: { type: 'scatter', minCount: 8 } }),
	{
		type: 'scatter',
		minCount: 8,
	},
);
check('a match-3 board always tumbles', resolveCascade({ family: 'match3' }), true);

console.log('\n2. defaults are never stored');
const slot = normalize(SLOT);
const withDefaults = normalize({ ...SLOT, family: 'slot', outcome: 'rgs' });
check(
	'a slot naming the defaults is byte-identical',
	JSON.stringify(withDefaults),
	JSON.stringify(slot),
);
check(
	'a slot keeps no outcome, match3 or arcade block',
	JSON.stringify(
		normalize({ ...SLOT, outcome: 'rules', match3: { moves: 20 }, arcade: { fixedHz: 30 } }),
	),
	JSON.stringify(slot),
);
check('…and no family key at all', Object.hasOwn(slot, 'family'), false);
check('an unknown family is a slot', normalize({ ...SLOT, family: 'card' }).family, undefined);
check('an rgs outcome is not stored', normalize({ ...MATCH3, outcome: 'rgs' }).outcome, undefined);
check('min run 3 is not stored', normalizeMatch3({ minRun: 3 }), undefined);
check('a run of one is not a run', normalizeMatch3({ minRun: 1 }), undefined);
check('60 Hz is not stored', normalizeArcade({ fixedHz: 60 }), undefined);
const m3 = normalize({
	...MATCH3,
	winModel: { type: 'cluster', minCluster: 5, adjacency: 'orthogonal' },
	cascade: false,
	arcade: { fixedHz: 30 },
});
check('a match-3 doc stores no win model', m3.winModel, undefined);
check('…no cascade', m3.cascade, undefined);
check('…and no arcade block', m3.arcade, undefined);
check(
	'an arcade doc keeps no match3 block',
	normalize({ ...ARCADE, match3: { moves: 3 } }).match3,
	undefined,
);
check(
	'a match3 win model on a slot is dropped',
	normalize({ ...SLOT, winModel: { type: 'match3', minRun: 3 } }).winModel,
	undefined,
);

console.log('\n3. round-trips');
const m3Rules = normalize({
	...MATCH3,
	outcome: 'rules',
	match3: {
		minRun: 4,
		moves: 20,
		goals: [
			{ type: 'score', target: 5000 },
			{ type: 'collect', symbol: 'A', count: 12 },
			{ type: 'score' },
		],
		scoreTable: { '5': 200, '4': 100, x: 3 },
	},
});
check('match-3 rules: the block, cleaned', m3Rules.match3, {
	minRun: 4,
	moves: 20,
	goals: [
		{ type: 'score', target: 5000 },
		{ type: 'collect', symbol: 'A', count: 12 },
	],
	scoreTable: { '4': 100, '5': 200 },
});
const arcade = normalize({
	...ARCADE,
	arcade: {
		field: { w: 1080, h: 1920 },
		fixedHz: 120,
		bodies: {
			player: { shape: 'circle', r: 40, tags: ['player', 'player', ' '], solid: false },
			wall: { shape: 'box', w: 100, h: 20, solid: true },
			ghost: { shape: 'box', w: 0, h: 20 },
			hook: { shape: 'box', w: 10, h: 30, tags: ['hazard'], edges: 'pass' },
			fish: { shape: 'circle', r: 8, edges: 'clamp' },
			loop: { shape: 'circle', r: 8, edges: 'bounce' },
		},
		pairs: [
			['player', 'hazard'],
			['hazard', 'player'],
			['player', ' '],
			['player'],
			[' player ', 'pickup'],
		],
		zones: [
			{ id: 'bank', x: 0, y: 1700, w: 1080, h: 220 },
			{ id: 'bank', x: 0, y: 0, w: 10, h: 10 },
			{ id: 'flat', x: 0, y: 0, w: 10, h: 0 },
			{ id: '', x: 0, y: 0, w: 10, h: 10 },
			{ id: 'noCorner', w: 10, h: 10 },
		],
	},
});
check(
	'an arcade doc needs no symbols or strips',
	[arcade.numReels, arcade.symbols, arcade.paddingReels],
	[0, {}, {}],
);
check('arcade: the block, cleaned', arcade.arcade, {
	field: { w: 1080, h: 1920 },
	fixedHz: 120,
	bodies: {
		player: { shape: 'circle', r: 40, tags: ['player'] },
		wall: { shape: 'box', w: 100, h: 20, solid: true },
		hook: { shape: 'box', w: 10, h: 30, tags: ['hazard'], edges: 'pass' },
		fish: { shape: 'circle', r: 8 },
		loop: { shape: 'circle', r: 8 },
	},
	pairs: [
		['player', 'hazard'],
		['player', 'pickup'],
	],
	zones: [{ id: 'bank', x: 0, y: 1700, w: 1080, h: 220 }],
});
check(
	'arcade: no pairs or zones resolve to empty lists',
	[resolveArcade({}).pairs, resolveArcade({}).zones],
	[[], []],
);
for (const [name, doc] of [
	['slot', slot],
	['match-3 rgs', normalize(MATCH3)],
	['match-3 rules', m3Rules],
	['arcade', arcade],
] as const) {
	check(
		`${name} is a fixed point`,
		JSON.stringify(normalize(JSON.parse(JSON.stringify(doc)))),
		JSON.stringify(doc),
	);
}
check(
	'a match-3 doc still needs symbols',
	normalizeGameConfigDoc({ ...MATCH3, symbols: {} }),
	undefined,
);

console.log('\n4. validation follows the family');
check(
	'a slot is checked as before: the free-spins warning of a game with no scatter',
	paths(slot),
	['freeSpins'],
);
check('a slot with no bet modes is refused', paths(normalize({ ...SLOT, betModes: {} }), 'error'), [
	'betModes',
]);
const m3Rgs = normalize(MATCH3);
check('a match-3 rgs sample is clean', paths(m3Rgs), []);
check(
	'match-3 rgs: no bet modes is refused',
	paths(normalize({ ...MATCH3, betModes: {} }), 'error'),
	['betModes'],
);
check(
	'match-3: paylines are not checked',
	paths(normalize({ ...MATCH3, paylines: { '1': [9] } })),
	[],
);
check(
	'match-3: a run longer than the board is refused',
	paths(normalize({ ...MATCH3, match3: { minRun: 7 } }), 'error'),
	['match3.minRun'],
);
check(
	'match-3: a stepped board is refused',
	paths(normalize({ ...MATCH3, numRows: [6, 6, 5, 6, 6, 6] }), 'error'),
	['numRows'],
);
check(
	'match-3: a column with no strip is still refused',
	paths(normalize({ ...MATCH3, numReels: 7, numRows: 6 }), 'error'),
	['paddingReels.basegame'],
);
const rules = (match3: unknown, extra: Record<string, unknown> = {}) =>
	normalize({ ...MATCH3, outcome: 'rules', betModes: {}, match3, ...extra });
check(
	'match-3 rules: no bet modes is fine, and no moves only warns',
	validateGameConfigDoc(rules({})).map((i) => `${i.severity} ${i.path}`),
	['warning match3.moves'],
);
check(
	'match-3 rules: the sample is clean',
	paths(rules({ moves: 20, goals: [{ type: 'collect', symbol: 'A', count: 3 }] })),
	[],
);
check(
	'match-3 rules: a goal to collect a gem no strip deals is refused',
	paths(rules({ moves: 20, goals: [{ type: 'collect', symbol: 'Z', count: 3 }] }), 'error'),
	['match3.goals.0'],
);
check(
	'match-3 rules: a score goal with nothing that scores is refused',
	paths(
		rules({ moves: 20, goals: [{ type: 'score', target: 100 }], scoreTable: { '2': 10 } }),
		'error',
	),
	['match3.goals.0'],
);
check(
	'match-3 rules: a run below the min run warns',
	paths(rules({ moves: 20, scoreTable: { '2': 10, '3': 50 } }), 'warning'),
	['match3.scoreTable.2'],
);
check(
	'match-3 rules: bet-mode and win-tier problems are not reported',
	paths(
		rules(
			{ moves: 20 },
			{ betModePresentation: { x: {} }, winLevels: [{ alias: 'a', threshold: 5, type: 'big' }] },
		),
	),
	[],
);
check('arcade (rules) is clean but the pair whose tag no body has', paths(arcade, 'warning'), [
	'arcade.pairs[1]',
]);
check('…and has no error', paths(arcade, 'error'), []);
check(
	'arcade: a zone wholly off the field warns',
	paths(
		normalize({
			...ARCADE,
			arcade: { field: { w: 100, h: 100 }, zones: [{ id: 'z', x: 100, y: 0, w: 10, h: 10 }] },
		}),
		'warning',
	),
	['arcade.zones[0]'],
);
check('arcade decided by the RGS is refused', paths(normalize({ family: 'arcade' }), 'error'), [
	'outcome',
]);
check(
	'arcade: a rate out of range warns',
	paths(normalize({ ...ARCADE, arcade: { fixedHz: 500 } }), 'warning'),
	['arcade.fixedHz'],
);
check(
	'arcade: no grid, symbol or bet-mode check runs',
	paths(
		normalize({
			...ARCADE,
			symbols: { A: { paytable: [{ '3': 1 }] } },
			paddingReels: { basegame: [['A']] },
		}),
	),
	[],
);

console.log('\n4b. the sections /config shows (design §6.2)');
const sections = (family: 'slot' | 'match3' | 'arcade', outcome: 'rgs' | 'rules') =>
	[...configSectionsFor(family, outcome)].sort();
check(
	'a slot shows every slot section, as today',
	sections('slot', 'rgs'),
	CONFIG_SECTIONS.filter((s) => s !== 'match3' && s !== 'arcade').sort(),
);
check('a slot ignores a rules outcome', sections('slot', 'rules'), sections('slot', 'rgs'));
check('match-3, RGS', sections('match3', 'rgs'), [
	'betModes',
	'grid',
	'match3',
	'rtp',
	'sounds',
	'symbols',
	'winLevels',
	'winModel',
]);
check('match-3, rules', sections('match3', 'rules'), ['grid', 'match3', 'sounds', 'symbols']);
check('arcade', sections('arcade', 'rules'), ['arcade']);
check('pays show for a slot', configShowsPays({}), true);
check('…and a match-3 RGS game', configShowsPays({ family: 'match3' }), true);
check('…but not a rules game', configShowsPays({ family: 'match3', outcome: 'rules' }), false);

console.log('\n4c. an online arcade game (P10.14)');
const ONLINE_BODIES = { salmon: { shape: 'circle', r: 20, tags: ['player'] } };
const online = (block: Record<string, unknown>, field: unknown = { w: 800, h: 600 }) =>
	normalize({ ...ARCADE, arcade: { field, bodies: ONLINE_BODIES, online: block } });
const swimmers = [{ id: 'salmon', body: 'salmon', speed: 200 }];
check(
	'defaults are dropped and the block round-trips',
	online({ characters: swimmers, ...ARCADE_ONLINE_DEFAULTS }).arcade?.online,
	{ characters: swimmers },
);
check(
	'a bad character is dropped; a repeated id keeps the first',
	online({
		characters: [
			{ id: 'salmon', body: 'salmon', speed: 200, max: 3 },
			{ id: 'salmon', body: 'salmon', speed: 90 },
			{ id: 'bear', body: 'bear' },
			{ id: '', body: 'x', speed: 1 },
		],
	}).arcade?.online?.characters,
	[{ id: 'salmon', body: 'salmon', speed: 200, max: 3 }],
);
check('an empty object is still online', online({}).arcade?.online, { characters: [] });
/** What an online game with no `rules` resolves them to (P10.15): players only move. */
const NO_RULES = { zones: [], abilities: [], round: { nextRoundSeconds: 15, goalScore: 1 } };
check(
	'resolve: defaults, the spawn at the field centre',
	resolveArcadeOnline(online({ characters: swimmers }), { w: 800, h: 600 }),
	{
		maxPlayers: 16,
		characters: swimmers,
		tickHz: 30,
		subSteps: 2,
		patchHz: 20,
		rejoinSeconds: 60,
		spawn: { x: 400, y: 300 },
		layer: 'field',
		rules: NO_RULES,
	},
);
check(
	'resolve: every number held to the limits, the state rate to the step rate',
	resolveArcadeOnline(
		online({
			characters: [{ id: 'salmon', body: 'salmon', speed: 99999 }],
			maxPlayers: 5000,
			tickHz: 240,
			subSteps: 50,
			patchHz: 200,
			rejoinSeconds: 3600,
		}),
		{ w: 800, h: 600 },
	),
	{
		maxPlayers: 100,
		characters: [{ id: 'salmon', body: 'salmon', speed: 5000 }],
		tickHz: 60,
		subSteps: 4,
		patchHz: 60,
		rejoinSeconds: 60,
		spawn: { x: 400, y: 300 },
		layer: 'field',
		rules: NO_RULES,
	},
);
check('resolve: not online', resolveArcadeOnline(normalize(ARCADE), { w: 1, h: 1 }), undefined);
check(
	'an online game with a field and a character is clean',
	paths(online({ characters: swimmers })),
	[],
);
check(
	'online needs a field, a character, and a body for each',
	paths(
		normalize({
			...ARCADE,
			arcade: {
				bodies: ONLINE_BODIES,
				online: { characters: [{ id: 'bear', body: 'bear', speed: 100 }] },
			},
		}),
		'error',
	),
	['arcade.field', 'arcade.online.characters[0]'],
);
check('…and no character at all', paths(online({}), 'error'), ['arcade.online.characters']);
check(
	'P10.11 characters on an online game warn: they do not run in a room',
	paths(
		normalize({
			...ARCADE,
			arcade: {
				field: { w: 800, h: 600 },
				bodies: ONLINE_BODIES,
				characters: [{ id: 'guard', component: 'guardLook' }],
				online: { characters: swimmers },
			},
		}),
		'warning',
	),
	['arcade.characters'],
);
check(
	'out-of-range rates warn',
	paths(online({ characters: swimmers, maxPlayers: 500, tickHz: 30, patchHz: 40 }), 'warning'),
	['arcade.online.maxPlayers', 'arcade.online.patchHz'],
);
check(
	'a slot keeps no online block',
	normalize({ ...SLOT, arcade: { online: { characters: swimmers } } }).arcade,
	undefined,
);

console.log('\n5. one family list');
check('the config families are the kind families', [...CONFIG_FAMILIES], [...GAME_FAMILIES]);
check(
	'match3 and arcade kinds',
	[familyOfKind('match3'), familyOfKind('arcade')],
	['match3', 'arcade'],
);
check(
	'a slot kind, a custom kind and none are slots',
	['lines', 'holdAndWin', 'myKind', 'toString', undefined, ''].map(familyOfKind),
	['slot', 'slot', 'slot', 'slot', 'slot', 'slot'],
);

console.log('\n6. arcade characters');
check('no characters resolve to an empty list', resolveArcade({}).characters, []);
check(
	'a doc without characters normalizes as before: no key',
	Object.hasOwn(arcade.arcade ?? {}, 'characters'),
	false,
);
check(
	'an empty or unusable list is not stored',
	[
		normalizeArcade({ characters: [] }),
		normalizeArcade({ characters: [{ id: 'x' }, { component: 'c' }, 'y'] }),
		normalizeArcade({ characters: {} }),
	],
	[undefined, undefined, undefined],
);
const RAW_CHARACTERS = [
	{
		id: ' hero ',
		name: ' ',
		component: 'heroLook',
		movement: { accel: 900, decel: -1, maxSpeed: 300, turnRate: 'fast' },
		controller: { kind: 'topDown', speed: 240 },
		animInputs: { speed: 'speed', run: 'moving', face: 'facing', bad: 'jump', none: 'state:' },
	},
	{ id: 'hero', component: 'other' },
	{ id: 'ghost', component: ' ' },
	{
		id: 'guard',
		name: 'Guard',
		component: 'guardLook',
		movement: {},
		controller: { kind: 'pointer', axes: 'z' },
		brain: {
			states: [
				{
					id: 'walk',
					behaviour: 'patrol',
					params: { speed: 80, path: 'route', x: null },
					pos: { x: 1 },
				},
				{ id: 'hunt', behaviour: 'chase', params: {}, pos: { x: 10, y: 20 } },
				{ id: 'walk', behaviour: 'idle' },
				{ id: 'fly', behaviour: 'teleport' },
				{ id: 'fire', behaviour: 'shootAt', params: { component: 'bullet', layer: 'shots' } },
			],
			transitions: [
				{
					id: 't1',
					from: 'walk',
					to: 'hunt',
					when: [{ kind: 'targetWithin', tag: 'player', px: 200 }],
				},
				{ id: 't2', from: 'hunt', to: 'walk', when: [{ kind: 'teleported' }] },
				{ id: 't3', from: '*', to: 'fire', when: [{ kind: 'random', chance: 0.5, every: 1000 }] },
				{ id: 't4', from: 'fire', to: 'walk', when: [{ kind: 'random', chance: 2 }] },
				{
					id: 't5',
					from: 'fire',
					to: 'walk',
					when: [{ kind: 'timer', ms: 500 }, { kind: 'hitSolid' }],
				},
				{ id: 't6', from: 'hunt', to: 'walk' },
				{ id: '', from: 'hunt', to: 'walk', when: [] },
				{
					id: 't7',
					from: 'hunt',
					to: 'walk',
					when: [{ kind: 'variable', id: 'lives', op: '<=', value: 0 }],
				},
				{
					id: 't8',
					from: 'hunt',
					to: 'walk',
					when: [{ kind: 'variable', id: 'lives', op: '=<', value: 0 }],
				},
			],
		},
	},
	{
		id: 'drone',
		component: 'droneLook',
		brain: { initial: 'x', states: [{ id: 'a', behaviour: 'nope' }] },
	},
];
check('characters: the list, cleaned', normalizeArcadeCharacters(RAW_CHARACTERS), [
	{
		id: 'hero',
		component: 'heroLook',
		movement: { accel: 900, maxSpeed: 300 },
		controller: { kind: 'topDown', speed: 240 },
		animInputs: { speed: 'speed', run: 'moving', face: 'facing' },
	},
	{
		id: 'guard',
		name: 'Guard',
		component: 'guardLook',
		brain: {
			initial: 'walk',
			states: [
				{ id: 'walk', behaviour: 'patrol', params: { speed: 80, path: 'route' } },
				{ id: 'hunt', behaviour: 'chase', pos: { x: 10, y: 20 } },
				{ id: 'fire', behaviour: 'shootAt', params: { component: 'bullet', layer: 'shots' } },
			],
			transitions: [
				{
					id: 't1',
					from: 'walk',
					to: 'hunt',
					when: [{ kind: 'targetWithin', tag: 'player', px: 200 }],
				},
				{ id: 't3', from: '*', to: 'fire', when: [{ kind: 'random', chance: 0.5 }] },
				{
					id: 't5',
					from: 'fire',
					to: 'walk',
					when: [{ kind: 'timer', ms: 500 }, { kind: 'hitSolid' }],
				},
				{ id: 't6', from: 'hunt', to: 'walk', when: [] },
				{
					id: 't7',
					from: 'hunt',
					to: 'walk',
					when: [{ kind: 'variable', id: 'lives', op: '<=', value: 0 }],
				},
			],
		},
	},
	{ id: 'drone', component: 'droneLook' },
]);
check(
	'a pointer controller keeps its axes and an optional speed',
	normalizeArcadeCharacters([
		{ id: 'a', component: 'a', controller: { kind: 'pointer', axes: 'x' } },
		{ id: 'b', component: 'b', controller: { kind: 'pointer', axes: 'xy', speed: 500 } },
		{ id: 'c', component: 'c', controller: { kind: 'sideScroll' } },
	])?.map((c) => c.controller),
	[{ kind: 'pointer', axes: 'x' }, { kind: 'pointer', axes: 'xy', speed: 500 }, undefined],
);
const withCharacters = normalize({
	...ARCADE,
	arcade: {
		bodies: { heroLook: { shape: 'circle', r: 20, tags: ['player'] } },
		characters: RAW_CHARACTERS,
	},
});
check(
	'characters: a fixed point',
	JSON.stringify(normalize(JSON.parse(JSON.stringify(withCharacters)))),
	JSON.stringify(withCharacters),
);
check(
	'characters: the sample validates clean',
	validateGameConfigDoc(withCharacters).map((i) => `${i.severity} ${i.path}`),
	[],
);
check(
	'characterComponentIds: the looks and the shots, distinct, in order',
	characterComponentIds(withCharacters),
	['heroLook', 'guardLook', 'bullet', 'droneLook'],
);
check(
	'characterComponentIds: none without characters',
	[characterComponentIds(arcade), characterComponentIds(slot), characterComponentIds({})],
	[[], [], []],
);
const issues = (characters: unknown[], bodies: Record<string, unknown> = {}) =>
	validateGameConfigDoc({
		...(normalize(ARCADE) as GameConfigDoc),
		arcade: { bodies: bodies as never, characters: characters as never },
	}).map((i) => `${i.severity} ${i.path}`);
check(
	'validation: a repeated id, a missing look and a shared look are refused',
	issues([
		{ id: 'a', component: 'x' },
		{ id: 'a', component: 'y' },
		{ id: 'b', component: '' },
		{ id: 'c', component: 'x' },
	]),
	[
		'error arcade.characters[1].id',
		'error arcade.characters[2].component',
		'error arcade.characters[3].component',
	],
);
check(
	'validation: an initial and transitions that name no state are refused',
	issues([
		{
			id: 'a',
			component: 'x',
			brain: {
				initial: 'gone',
				states: [{ id: 's', behaviour: 'idle' }],
				transitions: [
					{ id: 'ok', from: '*', to: 's', when: [] },
					{ id: 'bad', from: 'nowhere', to: 's', when: [] },
					{ id: 'bad2', from: 's', to: 'nowhere', when: [] },
				],
			},
		},
	]),
	[
		'error arcade.characters[0].brain.initial',
		'error arcade.characters[0].brain.transitions[1]',
		'error arcade.characters[0].brain.transitions[2]',
	],
);
check(
	'validation: the warnings',
	issues(
		[
			{
				id: 'a',
				component: 'x',
				controller: { kind: 'topDown', speed: 100 },
				animInputs: { hunting: 'state:hunt', idle: 'state:s' },
				brain: {
					initial: 's',
					states: [
						{ id: 's', behaviour: 'chase' },
						{ id: 'f', behaviour: 'flee', params: { tag: 'enemy' } },
						{ id: 'g', behaviour: 'shootAt', params: { component: 'shot' } },
						{ id: 'h', behaviour: 'chase', params: { tag: 'enemy' } },
					],
					transitions: [],
				},
			},
			{ id: 'b', component: 'y', controller: { kind: 'sideScroll', speed: 1 } },
			{ id: 'c', component: 'z', animInputs: { on: 'state:s' } },
		],
		{ y: { shape: 'box', w: 1, h: 1, tags: ['player'] } },
	),
	[
		'warning arcade.characters[0].controller',
		'warning arcade.characters[0].brain.states[1]',
		'warning arcade.characters[0].brain.states[2]',
		'warning arcade.characters[0].brain.states[3]',
		'warning arcade.characters[0].animInputs.hunting',
		'warning arcade.characters[2].animInputs.on',
	],
);

if (failures) {
	console.log(`\n${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('\nall family checks passed');
