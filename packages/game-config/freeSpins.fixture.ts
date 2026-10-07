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
	DEFAULT_FREE_SPINS_TRIGGER_COUNT,
	freeSpinsTriggerIsDefault,
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
check('no doc ⇒ on, no symbol, 3', resolveFreeSpins(undefined), {
	enabled: true,
	triggerSymbol: undefined,
	triggerCount: 3,
});
check('un-authored doc ⇒ the in-play scatter', resolveFreeSpins(doc()), {
	enabled: true,
	triggerSymbol: 'S',
	triggerCount: 3,
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
	{ enabled: true, triggerSymbol: 'H1', triggerCount: 4 },
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

console.log(failures === 0 ? '\nAll free-spins assertions passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
