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
import { HOLD_AND_WIN_PRESETS, HOLD_AND_WIN_PRESET_IDS } from './src/holdAndWinPresets.ts';
import { configuredSpecials, symbolsWithRole } from './src/holdAndWin.ts';
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

console.log(failures === 0 ? '\nAll Hold and Win assertions passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
