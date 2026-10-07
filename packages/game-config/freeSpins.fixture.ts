/**
 * Offline fixture for the free-spins block — the switch and the trigger. Run with the rest of the
 * free-spin gates:
 *   pnpm check:freespins
 *
 * The rule this pins is "free spins on, 3+ of the in-play scatter, unless the project says
 * otherwise", and the trap it guards is the STORAGE half, as with `cascade`: the block must be
 * persisted only where it DEPARTS from that. Storing the agreeing values would add a field to every
 * doc — invisible at build time, and a config that saves and comes back changed. The validator half
 * pins the two configs that save but cannot work: a buy card with no free spins to sell, and a
 * trigger nothing can ever deal.
 */

import { readFileSync } from 'node:fs';
import {
	BOOK_FREE_SPINS_DEFAULTS,
	MAX_FREE_SPINS_PER_ROUND,
	MIN_FREE_SPINS_TRIGGER_COUNT,
	DEFAULT_FREE_SPINS_AWARD,
	DEFAULT_FREE_SPINS_TRIGGER_COUNT,
	DEFAULT_RETRIGGER_AWARD,
	describeFreeSpinsAwards,
	freeSpinsAwardFor,
	freeSpinsAwardsAreDefault,
	freeSpinsDefaultsFor,
	freeSpinsTriggerIsDefault,
	normalizeAwardTable,
	normalizeFreeSpins,
	resolveFreeSpins,
	validateFreeSpins,
} from './src/freeSpins.ts';
import { normalizeGameConfigDoc } from './src/normalize.ts';
import { validateGameConfigDoc } from './src/validate.ts';
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

const strip = (...names: string[]) => names.map((name) => ({ name }));
const reels = (...names: string[]) => Array.from({ length: 5 }, () => strip(...names));
const base = {
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	paylines: { '0': [0, 0, 0, 0, 0] },
	symbols: {
		H1: { paytable: [{ '3': 5 }] },
		L1: { paytable: [{ '3': 1 }] },
		M: {},
		S: { special_properties: ['scatter'] },
	},
	paddingReels: { basegame: reels('H1', 'L1', 'S') },
	betModes: {
		base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 },
		bonus: { cost: 100, feature: false, buyBonus: true, rtp: 0.96, max_win: 5000 },
	},
};
const doc = (over: Record<string, unknown> = {}): GameConfigDoc =>
	normalizeGameConfigDoc({ ...base, ...over }) as GameConfigDoc;
const issuesAt = (d: GameConfigDoc, path: string) =>
	validateGameConfigDoc(d)
		.filter((issue) => issue.path === path)
		.map((issue) => issue.severity);

console.log('\nresolveFreeSpins — absent means "on, three of the scatter"');
check('default count is 3', DEFAULT_FREE_SPINS_TRIGGER_COUNT, 3);
const defaultAwards = (count: number) => ({
	awards: [{ count, spins: 10 }],
	retriggerAwards: [{ count, spins: 5 }],
	randomAwards: false,
});
check(
	'the default awards are 10, +5',
	[DEFAULT_FREE_SPINS_AWARD, DEFAULT_RETRIGGER_AWARD],
	[10, 5],
);
check('no doc ⇒ on, no symbol, 3, 10 spins, +5', resolveFreeSpins(undefined), {
	enabled: true,
	triggerSymbol: undefined,
	triggerCount: 3,
	...defaultAwards(3),
});
check('un-authored doc ⇒ the in-play scatter', resolveFreeSpins(doc()), {
	enabled: true,
	triggerSymbol: 'S',
	triggerCount: 3,
	...defaultAwards(3),
});
check(
	'a scatter off the strips is not the trigger',
	resolveFreeSpins(doc({ paddingReels: { basegame: reels('H1', 'L1') } })).triggerSymbol,
	undefined,
);
check(
	'authored off ⇒ off',
	resolveFreeSpins(doc({ freeSpins: { enabled: false } })).enabled,
	false,
);
check(
	'authored trigger wins',
	resolveFreeSpins(doc({ freeSpins: { triggerSymbol: 'H1', triggerCount: 4 } })),
	{ enabled: true, triggerSymbol: 'H1', triggerCount: 4, ...defaultAwards(4) },
);
check('the default trigger is the default', freeSpinsTriggerIsDefault(doc()), true);
check(
	'…and so is naming the scatter itself',
	freeSpinsTriggerIsDefault(doc({ freeSpins: { triggerSymbol: 'S' } })),
	true,
);
check(
	'another symbol departs',
	freeSpinsTriggerIsDefault(doc({ freeSpins: { triggerSymbol: 'H1' } })),
	false,
);
check(
	'another count departs',
	freeSpinsTriggerIsDefault(doc({ freeSpins: { triggerCount: 4 } })),
	false,
);

console.log('\nnormalizeFreeSpins — store ONLY a departure');
check('absent ⇒ dropped', normalizeFreeSpins(undefined), undefined);
check('garbage ⇒ dropped', normalizeFreeSpins('off'), undefined);
check('a bare false (not a block) ⇒ dropped', normalizeFreeSpins(false), undefined);
check('enabled true ⇒ dropped (agrees)', normalizeFreeSpins({ enabled: true }), undefined);
check('enabled false ⇒ kept', normalizeFreeSpins({ enabled: false }), { enabled: false });
check('count 3 ⇒ dropped (agrees)', normalizeFreeSpins({ triggerCount: 3 }), undefined);
check('count 4 ⇒ kept', normalizeFreeSpins({ triggerCount: 4 }), { triggerCount: 4 });
check(
	'count 0 / 2.5 / "4" ⇒ dropped',
	[0, 2.5, '4'].map((c) => normalizeFreeSpins({ triggerCount: c })),
	[undefined, undefined, undefined],
);
check('empty symbol ⇒ dropped', normalizeFreeSpins({ triggerSymbol: '  ' }), undefined);
check(
	'the trigger survives switching off',
	normalizeFreeSpins({ enabled: false, triggerSymbol: 'H1', triggerCount: 5, junk: 1 }),
	{ enabled: false, triggerSymbol: 'H1', triggerCount: 5 },
);

console.log('\nround-trip through the real normalizer');
const untouched = doc();
check('a doc that never mentioned free spins is unchanged', 'freeSpins' in untouched, false);
const committedDefault = (name: string): GameConfigDoc | undefined =>
	normalizeGameConfigDoc(
		JSON.parse(
			readFileSync(
				new URL(`../../apps/launcher-api/src/lib/data/gameConfig/${name}.json`, import.meta.url),
				'utf8',
			),
		),
	);
const COMMITTED = [
	'lines',
	'ways',
	'scatter',
	'holdAndWin.classic',
	'holdAndWin.pots',
	'holdAndWin.collector',
];
check(
	'…including every committed default',
	COMMITTED.filter((name) => 'freeSpins' in (committedDefault(name) ?? {})),
	[],
);
check(
	'…and none of them gains a free-spins issue',
	COMMITTED.filter((name) => {
		const d = committedDefault(name);
		return d && validateGameConfigDoc(d).some((issue) => issue.path.startsWith('freeSpins'));
	}),
	[],
);
check(
	'a block that agrees stores nothing',
	'freeSpins' in doc({ freeSpins: { enabled: true, triggerCount: 3 } }),
	false,
);
const off = doc({ freeSpins: { enabled: false } });
check('a game with free spins off stores the block', off.freeSpins, { enabled: false });
check('…and it is a fixed point', normalizeGameConfigDoc(off), off);
const custom = doc({ freeSpins: { triggerSymbol: 'H1', triggerCount: 4 } });
check('a custom trigger is stored', custom.freeSpins, { triggerSymbol: 'H1', triggerCount: 4 });

console.log('\nthe validator — a buy needs free spins to sell');
check('off + a buy ⇒ an error at freeSpins', issuesAt(off, 'freeSpins'), ['error']);
check(
	'…naming the mode',
	validateGameConfigDoc(off).find((issue) => issue.path === 'freeSpins')?.message,
	'Free spins are off, so the "bonus" buy mode has nothing to buy. Remove it in Bet modes.',
);
const offTwoBuys = doc({
	freeSpins: { enabled: false },
	betModes: {
		...base.betModes,
		ante: { cost: 2, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 },
	},
	betModePresentation: { ante: { kind: 'buy' } },
});
check(
	'a mode SOLD as a buy counts too, and both are named',
	validateGameConfigDoc(offTwoBuys).find((issue) => issue.path === 'freeSpins')?.message,
	'Free spins are off, so the "bonus" and "ante" buy modes have nothing to buy. Remove them in Bet modes.',
);
const offNoBuy = doc({ freeSpins: { enabled: false }, betModes: { base: base.betModes.base } });
check('off + no buy ⇒ no free-spins issue', issuesAt(offNoBuy, 'freeSpins'), []);
check('on + a buy ⇒ none', issuesAt(doc(), 'freeSpins'), []);
// The block's own contents are `validateHoldAndWin`'s business; only its presence matters here.
const withHoldAndWin = { ...off, holdAndWin: {} } as GameConfigDoc;
check(
	'off + a buy + a Hold and Win block ⇒ none (the buy buys that)',
	validateFreeSpins(withHoldAndWin),
	[],
);
const withPots = { ...off, potsOverlay: {} } as GameConfigDoc;
check('…and the same beside a pots overlay', validateFreeSpins(withPots), []);

console.log('\nthe validator — a trigger that can actually be dealt');
check(
	'a custom in-play trigger is clean',
	validateGameConfigDoc(custom).filter((issue) => issue.path.startsWith('freeSpins')),
	[],
);
check(
	'a symbol outside the dictionary ⇒ an error',
	issuesAt(doc({ freeSpins: { triggerSymbol: 'X9' } }), 'freeSpins.triggerSymbol'),
	['error'],
);
check(
	'a dictionary symbol on no strip ⇒ an error',
	issuesAt(doc({ freeSpins: { triggerSymbol: 'M' } }), 'freeSpins.triggerSymbol'),
	['error'],
);
check(
	'more than the board holds ⇒ an error',
	issuesAt(doc({ freeSpins: { triggerCount: 16 } }), 'freeSpins.triggerCount'),
	['error'],
);
check(
	'…exactly the board is fine',
	issuesAt(doc({ freeSpins: { triggerCount: 15 } }), 'freeSpins.triggerCount'),
	[],
);
const noScatter = { paddingReels: { basegame: reels('H1', 'L1') } };
check('on with nothing to trigger ⇒ a warning', issuesAt(doc(noScatter), 'freeSpins'), ['warning']);
check(
	'…not when a trigger symbol is named',
	issuesAt(doc({ ...noScatter, freeSpins: { triggerSymbol: 'H1' } }), 'freeSpins'),
	[],
);
check(
	'…nor when free spins are off',
	issuesAt(
		doc({ ...noScatter, freeSpins: { enabled: false }, betModes: { base: base.betModes.base } }),
		'freeSpins',
	),
	[],
);
check(
	'the trigger is not checked while off',
	issuesAt(
		doc({
			freeSpins: { enabled: false, triggerSymbol: 'X9' },
			betModes: { base: base.betModes.base },
		}),
		'freeSpins.triggerSymbol',
	),
	[],
);

console.log('\nfreeSpinsAwardFor — the row with the largest count at or below what landed');
const ranged = [
	{ count: 3, spins: 1, maxSpins: 3 },
	{ count: 4, spins: 3, maxSpins: 5 },
	{ count: 6, spins: 8 },
];
check('below every row ⇒ nothing', freeSpinsAwardFor(ranged, 2, true), undefined);
check('3 ⇒ 1–3', freeSpinsAwardFor(ranged, 3, true), { min: 1, max: 3 });
check('5 ⇒ the 4 row, 3–5', freeSpinsAwardFor(ranged, 5, true), { min: 3, max: 5 });
check('9 ⇒ the 6 row, fixed', freeSpinsAwardFor(ranged, 9, true), { min: 8, max: 8 });
check('random off ⇒ exactly spins', freeSpinsAwardFor(ranged, 4, false), { min: 3, max: 3 });
check(
	'a duplicate count ⇒ the first of them',
	freeSpinsAwardFor(
		[
			{ count: 3, spins: 7 },
			{ count: 3, spins: 9 },
		],
		3,
		false,
	),
	{ min: 7, max: 7 },
);

console.log('\ndescribeFreeSpinsAwards — the rule as a player meets it');
check('the default', describeFreeSpinsAwards(resolveFreeSpins(doc()).awards, 3, false), [
	{ counts: '3+', spins: '10' },
]);
check('ranges, with gaps and the last row open-ended', describeFreeSpinsAwards(ranged, 3, true), [
	{ counts: '3', spins: '1–3' },
	{ counts: '4–5', spins: '3–5' },
	{ counts: '6+', spins: '8' },
]);
check(
	'a row below the trigger that still covers it reads from the trigger; one superseded is gone',
	describeFreeSpinsAwards(
		[
			{ count: 1, spins: 2 },
			{ count: 2, spins: 4 },
			{ count: 5, spins: 9 },
		],
		3,
		false,
	),
	[
		{ counts: '3–4', spins: '4' },
		{ counts: '5+', spins: '9' },
	],
);

console.log('\naward tables — store ONLY a departure, sorted at save, nothing dropped silently');
check('absent ⇒ nothing', normalizeAwardTable(undefined, 10), undefined);
check('the default row ⇒ nothing', normalizeAwardTable([{ count: 3, spins: 10 }], 10), undefined);
check(
	'every row at the default, no range ⇒ nothing',
	normalizeAwardTable(
		[
			{ count: 3, spins: 10 },
			{ count: 5, spins: 10 },
		],
		10,
	),
	undefined,
);
check(
	'sorted by count; garbage rows dropped',
	normalizeAwardTable(
		[{ count: 5, spins: 12 }, { count: 3, spins: 7 }, { count: 0, spins: 4 }, { spins: 2 }, 'x'],
		10,
	),
	[
		{ count: 3, spins: 7 },
		{ count: 5, spins: 12 },
	],
);
check(
	'a range is kept; a no-op or upside-down one is not',
	normalizeAwardTable(
		[
			{ count: 3, spins: 1, maxSpins: 3 },
			{ count: 4, spins: 5, maxSpins: 5 },
			{ count: 5, spins: 6, maxSpins: 2 },
		],
		10,
	),
	[
		{ count: 3, spins: 1, maxSpins: 3 },
		{ count: 4, spins: 5 },
		{ count: 5, spins: 6 },
	],
);
check(
	'…a range at the default spins still departs',
	normalizeAwardTable([{ count: 3, spins: 10, maxSpins: 12 }], 10),
	[{ count: 3, spins: 10, maxSpins: 12 }],
);
check(
	'a duplicate count is KEPT, in authored order, for the validator to show',
	normalizeAwardTable(
		[
			{ count: 4, spins: 9 },
			{ count: 3, spins: 7 },
			{ count: 4, spins: 2 },
		],
		10,
	),
	[
		{ count: 3, spins: 7 },
		{ count: 4, spins: 9 },
		{ count: 4, spins: 2 },
	],
);
check('random true ⇒ kept', normalizeFreeSpins({ randomAwards: true }), { randomAwards: true });
check(
	'random false / "yes" ⇒ dropped',
	[false, 'yes'].map((v) => normalizeFreeSpins({ randomAwards: v })),
	[undefined, undefined],
);
check(
	'the block keeps its award tables while free spins are off, in canonical key order',
	normalizeFreeSpins({
		retriggerAwards: [{ count: 3, spins: 2 }],
		awards: [{ count: 3, spins: 1, maxSpins: 3 }],
		randomAwards: true,
		enabled: false,
	}),
	{
		enabled: false,
		randomAwards: true,
		awards: [{ count: 3, spins: 1, maxSpins: 3 }],
		retriggerAwards: [{ count: 3, spins: 2 }],
	},
);
check(
	'an entry table that agrees with the default stores no block at all',
	normalizeFreeSpins({ awards: [{ count: 3, spins: 10 }] }),
	undefined,
);
// The retrigger default is per KIND (+5 lines, +10 Book-of), which a config does not carry: a +5
// table stored for a Book-of game must survive a normalize anywhere. `/config` drops a table equal
// to its kind's default instead.
check(
	'a retrigger table is kept whatever it awards (its default depends on the kind)',
	normalizeFreeSpins({ retriggerAwards: [{ count: 3, spins: 5 }] }),
	{ retriggerAwards: [{ count: 3, spins: 5 }] },
);

console.log('\nper-kind defaults — a Book-of game retriggers +10 untold, lines +5');
check('lines (and any other kind) ⇒ 10 / +5', freeSpinsDefaultsFor('lines'), {
	award: 10,
	retrigger: 5,
});
check('a custom kind ⇒ 10 / +5', freeSpinsDefaultsFor('myKind'), { award: 10, retrigger: 5 });
check('bookOf ⇒ 10 / +10', freeSpinsDefaultsFor('bookOf'), { award: 10, retrigger: 10 });
check(
	'resolve with the book defaults ⇒ +10 at the trigger count',
	resolveFreeSpins(doc(), BOOK_FREE_SPINS_DEFAULTS).retriggerAwards,
	[{ count: 3, spins: 10 }],
);
check(
	'…and with no defaults given, still +5 (every lines caller unchanged)',
	resolveFreeSpins(doc()).retriggerAwards,
	[{ count: 3, spins: 5 }],
);
check(
	'a +5 retrigger table departs for a Book-of game',
	freeSpinsAwardsAreDefault(
		doc({ freeSpins: { retriggerAwards: [{ count: 3, spins: 5 }] } }),
		BOOK_FREE_SPINS_DEFAULTS,
	),
	false,
);
check(
	'…and is the default for a lines game',
	freeSpinsAwardsAreDefault(doc({ freeSpins: { retriggerAwards: [{ count: 3, spins: 5 }] } })),
	true,
);
check(
	'a +10 retrigger table is the default for a Book-of game',
	freeSpinsAwardsAreDefault(
		doc({ freeSpins: { retriggerAwards: [{ count: 3, spins: 10 }] } }),
		BOOK_FREE_SPINS_DEFAULTS,
	),
	true,
);
const awarded = doc({
	freeSpins: { randomAwards: true, awards: ranged, retriggerAwards: [{ count: 3, spins: 2 }] },
});
check('…and an authored one round-trips', normalizeGameConfigDoc(awarded), awarded);
check('resolve reads the authored tables', resolveFreeSpins(awarded).awards, ranged);
check(
	'…and fills the other with its default at the trigger count',
	resolveFreeSpins(doc({ freeSpins: { triggerCount: 4, awards: [{ count: 4, spins: 6 }] } }))
		.retriggerAwards,
	[{ count: 4, spins: 5 }],
);
check(
	'the award rule departs only when authored',
	[
		freeSpinsAwardsAreDefault(doc()),
		freeSpinsAwardsAreDefault(awarded),
		freeSpinsAwardsAreDefault(doc({ freeSpins: { randomAwards: true } })),
	],
	[true, false, false],
);

console.log('\nthe validator — award tables (only while free spins are on)');
const raw = (freeSpins: Record<string, unknown>) => ({ ...doc(), freeSpins }) as GameConfigDoc;
const messages = (d: GameConfigDoc, path: string) =>
	validateGameConfigDoc(d)
		.filter((issue) => issue.path === path)
		.map((issue) => `${issue.severity}: ${issue.message}`);
check('an authored, well-formed table is clean', issuesAt(awarded, 'freeSpins.awards'), []);
check('…and so is the retrigger one', issuesAt(awarded, 'freeSpins.retriggerAwards'), []);
check(
	'a table starting above the trigger count ⇒ an error',
	messages(raw({ awards: [{ count: 4, spins: 6 }] }), 'freeSpins.awards'),
	[
		'error: Free spins awarded starts at 4, but 3 trigger symbols already enter free spins, so that landing would award nothing. Add a row for 3.',
	],
);
check(
	'…the same for the retrigger table',
	issuesAt(raw({ retriggerAwards: [{ count: 5, spins: 2 }] }), 'freeSpins.retriggerAwards'),
	['error'],
);
check(
	'a row superseded below the trigger count ⇒ a warning',
	messages(
		raw({
			awards: [
				{ count: 1, spins: 4 },
				{ count: 2, spins: 5 },
				{ count: 4, spins: 6 },
			],
		}),
		'freeSpins.awards',
	),
	[
		'warning: Free spins awarded: the row for 1 is never used — fewer than 3 trigger symbols never enter free spins, and the row for 2 takes over from there.',
	],
);
check(
	'…but a row below it that still covers it is fine',
	issuesAt(raw({ awards: [{ count: 2, spins: 4 }] }), 'freeSpins.awards'),
	[],
);
check(
	'a duplicate count in the table AS EDITED ⇒ an error (before any save could sort it)',
	messages(
		raw({
			awards: [
				{ count: 3, spins: 7 },
				{ count: 4, spins: 9 },
				{ count: 3, spins: 2 },
			],
		}),
		'freeSpins.awards',
	),
	['error: Free spins awarded has more than one row for 3 — give each row its own count.'],
);
check(
	'a "to" below the spins ⇒ an error',
	issuesAt(raw({ awards: [{ count: 3, spins: 6, maxSpins: 2 }] }), 'freeSpins.awards'),
	['error'],
);
check(
	'random on with no range anywhere ⇒ a warning',
	issuesAt(raw({ randomAwards: true, awards: [{ count: 3, spins: 7 }] }), 'freeSpins.randomAwards'),
	['warning'],
);
check('…none once a row has one', issuesAt(awarded, 'freeSpins.randomAwards'), []);
check(
	'none of it while free spins are off',
	validateFreeSpins(
		raw({
			enabled: false,
			randomAwards: true,
			awards: [
				{ count: 5, spins: 7 },
				{ count: 5, spins: 2, maxSpins: 1 },
			],
		}),
	).filter((issue) => issue.path !== 'freeSpins'),
	[],
);

console.log('\nbounds — every free-spins round ends');
check('the round cap is 200', MAX_FREE_SPINS_PER_ROUND, 200);
check('the trigger floor is 3', MIN_FREE_SPINS_TRIGGER_COUNT, 3);
check(
	'a trigger count of 2 ⇒ an error (the feature would retrigger itself without end)',
	issuesAt(doc({ freeSpins: { triggerCount: 2 } }), 'freeSpins.triggerCount'),
	['error'],
);
check(
	'…and of 1, for a symbol trigger too',
	issuesAt(doc({ freeSpins: { triggerSymbol: 'H1', triggerCount: 1 } }), 'freeSpins.triggerCount'),
	['error'],
);
check(
	'…but not while free spins are off',
	issuesAt(doc({ freeSpins: { enabled: false, triggerCount: 2 } }), 'freeSpins.triggerCount'),
	[],
);
check(
	'a row awarding more than the round cap ⇒ an error',
	issuesAt(doc({ freeSpins: { awards: [{ count: 3, spins: 201 }] } }), 'freeSpins.awards'),
	['error'],
);
check(
	'…and a range topping out past it',
	issuesAt(
		doc({
			freeSpins: { randomAwards: true, retriggerAwards: [{ count: 3, spins: 5, maxSpins: 260 }] },
		}),
		'freeSpins.retriggerAwards',
	),
	['error'],
);
check(
	'a row at the cap is fine',
	issuesAt(doc({ freeSpins: { awards: [{ count: 3, spins: 200 }] } }), 'freeSpins.awards'),
	[],
);
check(
	'more rows than the board has cells ⇒ an error',
	issuesAt(
		doc({
			freeSpins: {
				awards: Array.from({ length: 16 }, (_unused, i) => ({ count: 3 + i, spins: 10 + i })),
			},
		}),
		'freeSpins.awards',
	).includes('error'),
	true,
);
check(
	'the normalizer keeps a row past the cap, so the save is refused rather than the row lost',
	normalizeFreeSpins({ awards: [{ count: 3, spins: 999 }] }),
	{ awards: [{ count: 3, spins: 999 }] },
);

console.log(failures === 0 ? '\nAll free-spins assertions passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
