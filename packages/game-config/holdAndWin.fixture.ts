/**
 * Offline fixture for the Hold and Win block and its three presets (`docs/design/hold-and-win.md`).
 *   pnpm check:all --only holdAndWin.fixture
 *
 * Pins three things: every preset normalizes to a fixed point with NO blocking issue (a preset that
 * saves and comes back changed, or that the bake refuses, would seed every new project broken); a
 * config without the block is untouched (parity for every other kind); and the validator names each
 * impossible config instead of letting the mock try to generate a round from it.
 */

import { normalizeGameConfigDoc } from './src/normalize.ts';
import { gameConfigErrors, validateGameConfigDoc } from './src/validate.ts';
import {
	HOLD_AND_WIN_PRESETS,
	HOLD_AND_WIN_PRESET_IDS,
	HOLD_AND_WIN_TEST_FIXTURES,
} from './src/holdAndWinPresets.ts';
import {
	configuredSpecials,
	jackpotLadder,
	respinBoardMaxRows,
	symbolsWithRole,
} from './src/holdAndWin.ts';
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
	if (!doc) throw new Error('config did not normalize');
	return doc;
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

console.log('\npresets — normalize fixed point, no errors, block survives intact');
for (const id of HOLD_AND_WIN_PRESET_IDS) {
	const raw = HOLD_AND_WIN_PRESETS[id];
	const doc = normalize(raw);
	check(`${id}: re-normalizing is a fixed point`, normalize(clone(doc)), doc);
	check(`${id}: the block round-trips unchanged`, doc.holdAndWin, raw.holdAndWin);
	check(`${id}: no blocking issues`, gameConfigErrors(doc), []);
	check(`${id}: no warnings either`, validateGameConfigDoc(doc), []);
}

const pots = normalize(HOLD_AND_WIN_PRESETS.pots);
const classic = normalize(HOLD_AND_WIN_PRESETS.classic);
const collector = normalize(HOLD_AND_WIN_PRESETS.collector);
check(
	'pots: decimals survive',
	pots.holdAndWin?.coins.slice(0, 4).map((c) => c.kind === 'cash' && c.value),
	[1, 1.5, 2, 2.5],
);
check('pots: every special configured', configuredSpecials(pots.holdAndWin!), [
	'collector',
	'multiplier',
	'payer',
	'mystery',
]);
check(
	'pots: three meters',
	pots.holdAndWin?.meters?.map((m) => `${m.symbol}→${m.activates}`),
	['BOOST→payer', 'COLLECT→collector', 'MULTI→multiplier'],
);
check('classic: letters board end', classic.holdAndWin?.boardEnd.type, 'columnLetters');
check(
	'classic: buy tiers priced by their bet modes',
	classic.holdAndWin?.trigger.buy?.map((b) => classic.betModes[b.mode].cost),
	[70, 300],
);
check('collector: collectors only', collector.holdAndWin?.stickiness, 'collectorsOnly');
check('collector: COLLECT is the collector symbol', symbolsWithRole(collector, 'collector'), [
	'COLLECT',
]);

console.log('\npresets — none configures the Phase 11a specials (they play as before)');
for (const id of HOLD_AND_WIN_PRESET_IDS) {
	const doc = normalize(HOLD_AND_WIN_PRESETS[id]);
	check(
		`${id}: no add-respins or upgrade configured`,
		[doc.holdAndWin?.specials.addRespins, doc.holdAndWin?.specials.upgrade],
		[undefined, undefined],
	);
	check(
		`${id}: no symbol carries their roles`,
		[...symbolsWithRole(doc, 'addRespins'), ...symbolsWithRole(doc, 'upgrade')],
		[],
	);
}
check(
	'pots-extra is not a preset id',
	(HOLD_AND_WIN_PRESET_IDS as readonly string[]).includes('pots-extra'),
	false,
);

console.log('\ntest fixture — pots-extra validates clean');
const potsExtra = normalize(HOLD_AND_WIN_TEST_FIXTURES['pots-extra']);
check('potsExtra: re-normalizing is a fixed point', normalize(clone(potsExtra)), potsExtra);
check(
	'potsExtra: the block round-trips unchanged',
	potsExtra.holdAndWin,
	HOLD_AND_WIN_TEST_FIXTURES['pots-extra'].holdAndWin,
);
check('potsExtra: no issues at all', validateGameConfigDoc(potsExtra), []);
check('potsExtra: every special configured', configuredSpecials(potsExtra.holdAndWin!), [
	'collector',
	'multiplier',
	'payer',
	'mystery',
	'addRespins',
	'upgrade',
]);
check(
	'potsExtra: ADD and UPG carry the roles',
	[symbolsWithRole(potsExtra, 'addRespins'), symbolsWithRole(potsExtra, 'upgrade')],
	[['ADD'], ['UPG']],
);
check('potsExtra: both active at entry', potsExtra.holdAndWin?.activeModifiers.atEntry, [
	'mystery',
	'addRespins',
	'upgrade',
]);
const extraOrder = potsExtra.holdAndWin!.applyOrder;
check(
	'potsExtra: both apply after the payer',
	[extraOrder.indexOf('addRespins'), extraOrder.indexOf('upgrade')].map(
		(at) => at > extraOrder.indexOf('payer'),
	),
	[true, true],
);
check(
	'potsExtra: the mystery may reveal both',
	potsExtra.holdAndWin?.specials.mystery?.reveals.flatMap((r) =>
		r.type === 'special' && (r.special === 'addRespins' || r.special === 'upgrade')
			? [r.special]
			: [],
	),
	['addRespins', 'upgrade'],
);

console.log('\njackpot ladder — lowest prize first');
const potsBlock = normalize(HOLD_AND_WIN_PRESETS.pots).holdAndWin!;
check('pots: the ladder', jackpotLadder(potsBlock), ['MINI', 'MINOR', 'MAJOR', 'GRAND']);
check(
	'sorted by multiplier, not listed order',
	jackpotLadder({
		jackpots: [
			{ name: 'GRAND', multiplier: 2000, fixed: true },
			{ name: 'MINI', multiplier: 15, fixed: true },
		],
	}),
	['MINI', 'GRAND'],
);

console.log('\nparity — a config without the block is untouched');
const { holdAndWin: _drop, winLevels: _tiers, ...plain } = clone(HOLD_AND_WIN_PRESETS.classic);
check('no holdAndWin key appears', 'holdAndWin' in normalize(plain), false);

console.log('\nnormalize — structural drops, defaults, tolerated shorthand');
const lax = normalize({
	...clone(HOLD_AND_WIN_PRESETS.classic),
	holdAndWin: {
		coins: [{ value: 2 }, { jackpot: 'MINI' }, { value: -1 }, { value: 'x' }, { kind: 'jackpot' }],
		jackpots: [{ name: 'MINI', multiplier: 15 }],
		specials: { payer: { values: [{ value: 3 }] } },
		trigger: { count: { min: 6, roles: ['coin', 'nonsense', 'coin'] } },
	},
});
check('weightless coins default to weight 1, garbage dropped', lax.holdAndWin?.coins, [
	{ kind: 'cash', value: 2, weight: 1 },
	{ kind: 'jackpot', jackpot: 'MINI', weight: 1 },
]);
check('jackpot defaults to fixed', lax.holdAndWin?.jackpots[0].fixed, true);
check('respins default to 3 resetting on a coin', lax.holdAndWin?.respins, {
	start: 3,
	reset: 'anyCoin',
});
check('stickiness defaults to allCoins', lax.holdAndWin?.stickiness, 'allCoins');
check('unknown roles dropped, duplicates collapsed', lax.holdAndWin?.trigger.count?.roles, [
	'coin',
]);
check('absent apply order = the configured specials', lax.holdAndWin?.applyOrder, ['payer']);
check('board end defaults to none', lax.holdAndWin?.boardEnd, { type: 'none' });

const laxExtra = normalize({
	...clone(HOLD_AND_WIN_PRESETS.classic),
	holdAndWin: {
		...clone(HOLD_AND_WIN_PRESETS.classic.holdAndWin),
		applyOrder: undefined,
		specials: {
			upgrade: {
				targets: [
					{ target: 'all' },
					{ target: 'nope', weight: 1 },
					{ target: 'all', weight: 3 },
					{ target: 'jackpotTier', weight: 2 },
				],
				values: [{ value: 0.5 }, { value: 0 }],
			},
			addRespins: {
				values: [{ value: 2 }, { value: -1 }],
				raisesCap: 'yes',
				sticky: true,
				reels: [2, 1, 2],
			},
			multiplier: clone(HOLD_AND_WIN_PRESETS.classic.holdAndWin!.specials.multiplier),
			mystery: {
				reveals: [
					{ type: 'special', special: 'addRespins' },
					{ type: 'special', special: 'upgrade' },
				],
			},
		},
	},
});
check(
	'add-respins: garbage values dropped, flags strict, reels sorted and unique',
	laxExtra.holdAndWin?.specials.addRespins,
	{
		values: [{ value: 2, weight: 1 }],
		raisesCap: false,
		sticky: true,
		landsInBaseGame: false,
		reels: [1, 2],
	},
);
check(
	'upgrade: unknown rules dropped, the first of a repeated rule kept',
	laxExtra.holdAndWin?.specials.upgrade,
	{
		targets: [
			{ target: 'all', weight: 1 },
			{ target: 'jackpotTier', weight: 2 },
		],
		values: [{ value: 0.5, weight: 1 }],
		landsInBaseGame: false,
	},
);
check(
	'a mystery may reveal either',
	laxExtra.holdAndWin?.specials.mystery?.reveals.map((r) => r.type === 'special' && r.special),
	['addRespins', 'upgrade'],
);
check('absent apply order appends them in the canonical order', laxExtra.holdAndWin?.applyOrder, [
	'multiplier',
	'mystery',
	'addRespins',
	'upgrade',
]);

console.log('\nvalidate — impossible configs are named');
const issuePaths = (doc: GameConfigDoc) => gameConfigErrors(doc).map((i) => i.path);
const withBlock = (base: GameConfigDoc, edit: (doc: GameConfigDoc) => void): GameConfigDoc => {
	const doc = clone(base);
	edit(doc);
	return normalize(doc);
};

check('a stepped grid', issuePaths(withBlock(collector, (d) => (d.numRows = [3, 4, 3]))), [
	'holdAndWin.grid',
]);
check(
	'a pattern needing a reel that does not exist',
	issuePaths(
		withBlock(collector, (d) =>
			d.holdAndWin!.trigger.pattern!.push({ reel: 3, roles: ['coin'], min: 1 }),
		),
	),
	['holdAndWin.trigger.pattern.3.reel'],
);
check(
	'a pattern needing a coin on a reel no coin lands on',
	issuePaths(withBlock(collector, (d) => (d.holdAndWin!.trigger.pattern![1].roles = ['coin']))),
	['holdAndWin.trigger.pattern.1.reel'],
);
check(
	'a pattern needing more symbols than the reel has rows',
	issuePaths(withBlock(collector, (d) => (d.holdAndWin!.trigger.pattern![0].min = 4))),
	['holdAndWin.trigger.pattern.0.min'],
);
check(
	'collectorsOnly with no collector',
	issuePaths(
		withBlock(collector, (d) => {
			delete d.holdAndWin!.specials.collector;
			d.holdAndWin!.applyOrder = [];
			d.holdAndWin!.activeModifiers.atEntry = [];
			delete d.holdAndWin!.wheel;
		}),
	),
	['holdAndWin.stickiness'],
);
check(
	'a coin naming an unknown jackpot',
	issuePaths(
		withBlock(pots, (d) =>
			d.holdAndWin!.coins.push({ kind: 'jackpot', jackpot: 'MEGA', weight: 1 }),
		),
	),
	['holdAndWin.coins.11.jackpot'],
);
check(
	'letters that do not match the reel count',
	issuePaths(
		withBlock(
			classic,
			(d) =>
				(d.holdAndWin!.boardEnd = {
					type: 'columnLetters',
					letters: 'GRANDE',
					jackpot: 'GRAND',
					clearOnComplete: true,
				}),
		),
	),
	['holdAndWin.boardEnd.letters'],
);
check(
	'a buy tier on a missing bet mode',
	issuePaths(withBlock(classic, (d) => (d.holdAndWin!.trigger.buy![0].mode = 'nope'))),
	['holdAndWin.trigger.buy.0.mode'],
);
check(
	'a buy tier on a non-buy bet mode',
	issuePaths(withBlock(classic, (d) => (d.holdAndWin!.trigger.buy![0].mode = 'base'))),
	['holdAndWin.trigger.buy.0.mode'],
);
check(
	'a count trigger larger than the board',
	issuePaths(
		withBlock(collector, (d) => (d.holdAndWin!.trigger = { count: { min: 10, roles: ['coin'] } })),
	),
	['holdAndWin.trigger.count.min'],
);
check('no trigger at all', issuePaths(withBlock(classic, (d) => (d.holdAndWin!.trigger = {}))), [
	'holdAndWin.trigger',
]);
check(
	'a meter activating an unconfigured special',
	issuePaths(
		withBlock(
			classic,
			(d) =>
				(d.holdAndWin!.meters = [
					{ id: 'x', symbol: 'BOOST', maxLevel: 12, sizeStages: [5], activates: 'payer' },
				]),
		),
	),
	['holdAndWin.meters.0.activates'],
);
check(
	'a size stage past the meter max',
	issuePaths(withBlock(pots, (d) => (d.holdAndWin!.meters![0].sizeStages = [5, 12]))),
	['holdAndWin.meters.0.sizeStages'],
);
check(
	'an extra-collect prize past the collector max',
	issuePaths(
		withBlock(collector, (d) =>
			d.holdAndWin!.wheel!.prizes.push({ type: 'extraCollect', count: 3, weight: 1 }),
		),
	),
	['holdAndWin.wheel.prizes.7.count'],
);
check(
	'a configured special with no tagged symbol',
	issuePaths(withBlock(classic, (d) => (d.symbols.BOOST = {}))),
	['holdAndWin.trigger.buy.1.guaranteed', 'holdAndWin.specials.multiplier'],
);
check(
	'a configured special missing from the apply order',
	issuePaths(
		withBlock(pots, (d) => (d.holdAndWin!.applyOrder = ['payer', 'multiplier', 'collector'])),
	),
	['holdAndWin.applyOrder'],
);
check(
	'a mystery revealing an unconfigured special',
	issuePaths(
		withBlock(classic, (d) => {
			d.symbols.MYSTERY = { special_properties: ['mystery'] };
			d.paddingReels.respin[0].push({ name: 'MYSTERY' });
			d.holdAndWin!.specials.mystery = {
				reveals: [{ type: 'special', special: 'payer', weight: 1 }],
				unlocksInactive: false,
			};
			d.holdAndWin!.applyOrder.push('mystery');
		}),
	),
	['holdAndWin.specials.mystery.reveals.0.special'],
);
check(
	'a Hold and Win base game that does not pay by lines',
	issuePaths(
		withBlock(pots, (d) => (d.winModel = { type: 'ways', direction: 'ltr', minKind: 3 })),
	).includes('winModel'),
	true,
);
check(
	'a special restricted to a reel off the grid',
	issuePaths(withBlock(collector, (d) => (d.holdAndWin!.specials.collector!.reels = [1, 5]))),
	['holdAndWin.specials.collector.reels'],
);

check(
	'collectorsOnly with a collector that does not stick',
	issuePaths(withBlock(collector, (d) => (d.holdAndWin!.specials.collector!.sticky = false))),
	['holdAndWin.stickiness'],
);
check(
	'a blank counting toward the trigger',
	issuePaths(withBlock(pots, (d) => d.holdAndWin!.trigger.count!.roles.push('blank'))),
	['holdAndWin.trigger.count.roles'],
);
check(
	'a blank filling the full board',
	issuePaths(
		withBlock(
			pots,
			(d) =>
				d.holdAndWin!.boardEnd.type === 'fullBoardJackpot' &&
				d.holdAndWin!.boardEnd.roles.push('blank'),
		),
	),
	['holdAndWin.boardEnd.roles'],
);
check(
	'a collector starting above its max level is kept and named',
	issuePaths(
		withBlock(collector, (d) => {
			d.holdAndWin!.specials.collector!.level = 3;
			d.holdAndWin!.specials.collector!.maxLevel = 2;
			delete d.holdAndWin!.wheel;
		}),
	),
	['holdAndWin.specials.collector.level'],
);
check(
	'collectorsOnly collecting only at the end warns',
	validateGameConfigDoc(
		withBlock(collector, (d) => (d.holdAndWin!.specials.collector!.collects = 'atEnd')),
	).map((i) => i.path),
	['holdAndWin.specials.collector.collects'],
);

console.log('\nprogressive tiers (11c) — a pool per fixed:false tier, fixed tiers untouched');
const progressive = normalize(HOLD_AND_WIN_TEST_FIXTURES['pots-progressive']);
check('the progressive fixture has no blocking issue', issuePaths(progressive), []);
check(
	'the progressive fixture is a normalize fixed point',
	normalize(clone(progressive)),
	progressive,
);
check(
	'a fixed tier carries no pool; a progressive one keeps its seed, contribution and cap',
	progressive.holdAndWin?.jackpots.map((j) => j.progressive ?? null),
	[
		null,
		{ seed: 30, contribution: 1, cap: 40 },
		{ seed: 100, contribution: 0.2 },
		{ seed: 2000, contribution: 1 },
	],
);
check(
	'no preset has a progressive tier',
	HOLD_AND_WIN_PRESET_IDS.flatMap((id) =>
		normalize(HOLD_AND_WIN_PRESETS[id]).holdAndWin!.jackpots.filter((j) => !j.fixed),
	),
	[],
);
check(
	'a bare fixed:false tier is a pool that starts at its multiplier and never grows (pre-11c pay)',
	withBlock(pots, (d) => {
		d.holdAndWin!.jackpots = [{ name: 'MINI', multiplier: 15, fixed: false }];
	}).holdAndWin?.jackpots[0],
	{ name: 'MINI', multiplier: 15, fixed: false, progressive: { seed: 15, contribution: 0 } },
);
check(
	'a cap under the seed is an error; a pool nobody contributes to warns',
	validateGameConfigDoc(
		withBlock(progressive, (d) => {
			d.holdAndWin!.jackpots[1].progressive = { seed: 30, contribution: 0.05, cap: 20 };
			d.holdAndWin!.jackpots[2].progressive = { seed: 100, contribution: 0 };
		}),
	).map((i) => `${i.severity}:${i.path}`),
	[
		'error:holdAndWin.jackpots.1.progressive.cap',
		'warning:holdAndWin.jackpots.2.progressive.contribution',
	],
);

console.log('\nvalidate — the Phase 11a specials');
const extraWith = (edit: (doc: GameConfigDoc) => void) => issuePaths(withBlock(potsExtra, edit));
check(
	'an add-respins worth a fraction of a respin',
	extraWith((d) => (d.holdAndWin!.specials.addRespins!.values = [{ value: 1.5, weight: 1 }])),
	['holdAndWin.specials.addRespins.values.0.value'],
);
check(
	'an add-respins with no values',
	extraWith((d) => (d.holdAndWin!.specials.addRespins!.values = [])),
	['holdAndWin.specials.addRespins.values'],
);
check(
	'an add-respins with no symbol tagged',
	extraWith((d) => (d.symbols.ADD = {})),
	['holdAndWin.specials.addRespins'],
);
check(
	'an upgrade with no target rule',
	extraWith((d) => (d.holdAndWin!.specials.upgrade!.targets = [])),
	['holdAndWin.specials.upgrade.targets'],
);
check(
	'an upgrade whose rules all weigh 0',
	extraWith((d) => d.holdAndWin!.specials.upgrade!.targets.forEach((t) => (t.weight = 0))),
	['holdAndWin.specials.upgrade.targets'],
);
check(
	'a cash upgrade with no step',
	extraWith((d) => (d.holdAndWin!.specials.upgrade!.values = [])),
	['holdAndWin.specials.upgrade.values'],
);
check(
	'a tier-only upgrade needs no step',
	extraWith((d) => {
		d.holdAndWin!.specials.upgrade!.targets = [{ target: 'jackpotTier', weight: 1 }];
		d.holdAndWin!.specials.upgrade!.values = [];
	}),
	[],
);
check(
	'a tier upgrade with a single jackpot tier',
	issuePaths(
		withBlock(collector, (d) => {
			d.symbols.UPG = { special_properties: ['upgrade'] };
			d.holdAndWin!.jackpots = [{ name: 'GRAND', multiplier: 1000, fixed: true }];
			d.holdAndWin!.coins = d.holdAndWin!.coins.filter((c) => c.kind === 'cash');
			delete d.holdAndWin!.wheel;
			d.holdAndWin!.specials.upgrade = {
				targets: [{ target: 'jackpotTier', weight: 1 }],
				values: [],
				landsInBaseGame: false,
			};
			d.holdAndWin!.applyOrder.push('upgrade');
		}),
	),
	['holdAndWin.specials.upgrade.targets'],
);
check(
	'a mystery revealing an upgrade that is not configured',
	extraWith((d) => {
		delete d.holdAndWin!.specials.upgrade;
		delete d.symbols.UPG;
		d.paddingReels.respin = d.paddingReels.respin.map((reel) =>
			reel.filter((s) => s.name !== 'UPG'),
		);
		d.holdAndWin!.applyOrder = d.holdAndWin!.applyOrder.filter((k) => k !== 'upgrade');
		d.holdAndWin!.activeModifiers.atEntry = ['mystery', 'addRespins'];
	}),
	['holdAndWin.specials.mystery.reveals.7.special'],
);
check(
	'an add-respins missing from the apply order',
	extraWith(
		(d) => (d.holdAndWin!.applyOrder = d.holdAndWin!.applyOrder.filter((k) => k !== 'addRespins')),
	),
	['holdAndWin.applyOrder'],
);

console.log('\nboard expansion (11b) — one fixture per rule, every impossible config named');
for (const id of ['pots-expansion-fullrow', 'pots-expansion-unlock', 'pots-expansion-count']) {
	const raw = HOLD_AND_WIN_TEST_FIXTURES[id];
	const doc = normalize(raw);
	check(`${id}: re-normalizing is a fixed point`, normalize(clone(doc)), doc);
	check(`${id}: the block round-trips unchanged`, doc.holdAndWin, raw.holdAndWin);
	check(`${id}: no issues`, validateGameConfigDoc(doc), []);
	check(`${id}: the respin board reaches 6 rows`, respinBoardMaxRows(doc), 6);
}
check(
	'no preset expands; an unexpanded board reaches the grid rows',
	HOLD_AND_WIN_PRESET_IDS.map((id) => {
		const doc = normalize(HOLD_AND_WIN_PRESETS[id]);
		return [Boolean(doc.holdAndWin?.expansion), respinBoardMaxRows(doc)];
	}),
	[
		[false, 3],
		[false, 3],
		[false, 3],
	],
);
const fullRow = normalize(HOLD_AND_WIN_TEST_FIXTURES['pots-expansion-fullrow']);
const unlockRule = normalize(HOLD_AND_WIN_TEST_FIXTURES['pots-expansion-unlock']);
const countRule = normalize(HOLD_AND_WIN_TEST_FIXTURES['pots-expansion-count']);
check(
	'only the chosen rule keeps its own field; resetsRespins defaults on',
	normalize({
		...clone(HOLD_AND_WIN_PRESETS.pots),
		holdAndWin: {
			...clone(HOLD_AND_WIN_PRESETS.pots.holdAndWin),
			expansion: {
				startRows: 3,
				maxRows: 5,
				rule: 'fullRow',
				thresholds: [1, 2],
				unlockReels: [0],
				rowJackpots: [{ rows: 5 }],
			},
		},
	}).holdAndWin?.expansion,
	{ startRows: 3, maxRows: 5, rule: 'fullRow', resetsRespins: true },
);
check(
	'an unreadable expansion is dropped, not half-kept',
	normalize({
		...clone(HOLD_AND_WIN_PRESETS.pots),
		holdAndWin: { ...clone(HOLD_AND_WIN_PRESETS.pots.holdAndWin), expansion: { rule: 'nope' } },
	}).holdAndWin?.expansion,
	undefined,
);
const expansionIssues = (doc: GameConfigDoc) =>
	validateGameConfigDoc(doc)
		.filter((i) => i.path.startsWith('holdAndWin.expansion'))
		.map((i) => `${i.severity}:${i.path}`);
check(
	'startRows must be the grid rows; maxRows below it is an error, equal a warning',
	[
		expansionIssues(withBlock(fullRow, (d) => (d.holdAndWin!.expansion!.startRows = 4))),
		expansionIssues(
			withBlock(fullRow, (d) => {
				d.holdAndWin!.expansion!.maxRows = 2;
				delete d.holdAndWin!.expansion!.rowJackpots;
			}),
		),
		expansionIssues(
			withBlock(fullRow, (d) => {
				d.holdAndWin!.expansion!.maxRows = 3;
				delete d.holdAndWin!.expansion!.rowJackpots;
			}),
		),
	],
	[
		['error:holdAndWin.expansion.startRows'],
		['error:holdAndWin.expansion.maxRows'],
		['warning:holdAndWin.expansion.maxRows'],
	],
);
check(
	'a row jackpot must name a tier, a row that unlocks, and each row once',
	expansionIssues(
		withBlock(fullRow, (d) => {
			d.holdAndWin!.expansion!.rowJackpots = [
				{ rows: 3, jackpot: 'MAJOR' },
				{ rows: 6, jackpot: 'NOPE' },
				{ rows: 6, jackpot: 'GRAND' },
			];
		}),
	),
	[
		'error:holdAndWin.expansion.rowJackpots.0.rows',
		'error:holdAndWin.expansion.rowJackpots.1.jackpot',
		'error:holdAndWin.expansion.rowJackpots.2.rows',
	],
);
check(
	'count thresholds: one per row, ascending, each reachable on the rows open before it',
	[
		expansionIssues(withBlock(countRule, (d) => (d.holdAndWin!.expansion!.thresholds = [8, 12]))),
		expansionIssues(
			withBlock(countRule, (d) => (d.holdAndWin!.expansion!.thresholds = [8, 8, 26])),
		),
	],
	[
		['error:holdAndWin.expansion.thresholds'],
		['error:holdAndWin.expansion.thresholds.1', 'error:holdAndWin.expansion.thresholds.2'],
	],
);
check(
	'the unlock rule needs an unlock symbol on the grid; an unused unlock symbol warns',
	[
		expansionIssues(
			withBlock(unlockRule, (d) => {
				delete d.symbols.UNLOCK;
				d.holdAndWin!.expansion!.unlockReels = [7];
			}),
		),
		expansionIssues(
			withBlock(fullRow, (d) => (d.symbols.UNLOCK = { special_properties: ['unlock'] })),
		),
	],
	[
		['error:holdAndWin.expansion.rule', 'error:holdAndWin.expansion.unlockReels'],
		['warning:holdAndWin.expansion'],
	],
);
check(
	'a row cannot fill when coins clear; letters need a fixed column height',
	[
		issuePaths(withBlock(fullRow, (d) => (d.holdAndWin!.stickiness = 'collectorsOnly'))),
		issuePaths(
			withBlock(classic, (d) => {
				d.holdAndWin!.expansion = {
					startRows: 3,
					maxRows: 4,
					rule: 'fullRow',
					resetsRespins: true,
				};
			}),
		),
	],
	[['holdAndWin.expansion.rule'], ['holdAndWin.expansion']],
);

console.log(failures === 0 ? '\nAll Hold and Win assertions passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
