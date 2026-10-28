/**
 * EXPANDING WILDS and the GROWING WILD as Game Config blocks (`expandingWilds`, `growingWild`,
 * docs/design/expanding-and-growing-wilds.md §1): each normalizes as a fixed point, resolves through
 * one reader with its defaults, and the validator names each impossible config by path. A config
 * without them normalizes exactly as before.
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
 *     packages/game-config/expandingWilds.fixture.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import {
	normalizeExpandingWilds,
	reelsDealing,
	resolveExpandingWilds,
} from './src/expandingWilds.ts';
import { growCells, normalizeGrowingWild, resolveGrowingWild } from './src/growingWild.ts';
import { normalizeGameConfigDoc } from './src/normalize.ts';
import type { GameConfigDoc } from './src/types.ts';
import { validateGameConfigDoc } from './src/validate.ts';

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
const base = {
	providerName: 'x',
	gameName: 'x',
	gameID: 'x',
	rtp: 0.96,
	numReels: 5,
	numRows: [4, 4, 4, 4, 4],
	paylines: { '1': [1, 1, 1, 1, 1] },
	symbols: {
		H1: { paytable: [{ '3': 100 }] },
		L1: { paytable: [{ '3': 5 }] },
		FAIRY: { special_properties: ['wild'] },
		CLOVER: { special_properties: ['wild'] },
		OFF: { special_properties: ['wild'] },
		BOOK: { special_properties: ['wild', 'scatter'], paytable: [{ '3': 2 }] },
		S: { special_properties: ['scatter'], paytable: [{ '3': 2 }] },
	},
	paddingReels: {
		basegame: [
			strip('H1', 'L1', 'S'),
			strip('H1', 'L1', 'FAIRY'),
			strip('H1', 'L1', 'FAIRY', 'CLOVER'),
			strip('H1', 'L1', 'FAIRY'),
			strip('H1', 'L1', 'S', 'BOOK'),
		],
	},
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 } },
};
const doc = (over: Record<string, unknown> = {}): GameConfigDoc =>
	normalizeGameConfigDoc({ ...base, ...over }) as GameConfigDoc;
const issuesAt = (d: GameConfigDoc, prefix: string) =>
	validateGameConfigDoc(d)
		.filter((i) => i.path.startsWith(prefix))
		.map((i) => `${i.severity} ${i.path}`);

console.log('\n1. normalize: presence is the feature; only departures are stored');
check('not an object ⇒ no block', normalizeExpandingWilds('x'), undefined);
check('{} ⇒ an empty block', normalizeExpandingWilds({}), { symbols: [] });
check(
	'names trimmed, deduped, non-strings dropped; show only when always',
	normalizeExpandingWilds({ symbols: [' FAIRY', 'FAIRY', 3, ''], show: 'onWin' }),
	{ symbols: ['FAIRY'] },
);
check('show always is stored', normalizeExpandingWilds({ symbols: ['A'], show: 'always' }), {
	symbols: ['A'],
	show: 'always',
});
check('growing: {} ⇒ a block with no symbol', normalizeGrowingWild({}), { symbol: '' });
check(
	'growing: reels sorted + deduped, junk dropped; empty list and plus pattern not stored',
	normalizeGrowingWild({
		symbol: 'C',
		reels: [3, 1, 1, -1, 1.5],
		freeSpinReels: [],
		pattern: 'plus',
	}),
	{ symbol: 'C', reels: [1, 3] },
);
check(
	'growing: a known pattern is stored, an unknown one dropped',
	[
		normalizeGrowingWild({ symbol: 'C', pattern: 'all8' }),
		normalizeGrowingWild({ symbol: 'C', pattern: 'x' }),
	],
	[{ symbol: 'C', pattern: 'all8' }, { symbol: 'C' }],
);
const authored = doc({
	expandingWilds: { symbols: ['FAIRY'], show: 'always' },
	growingWild: { symbol: 'CLOVER', freeSpinReels: [1, 2, 3], pattern: 'vertical' },
});
check(
	'a fixed point',
	normalizeGameConfigDoc(JSON.parse(JSON.stringify(authored))),
	JSON.parse(JSON.stringify(authored)),
);
check('no blocks ⇒ none stored', 'expandingWilds' in doc() || 'growingWild' in doc(), false);

console.log('\n2. every committed config normalizes without the blocks');
for (const dir of ['apps/launcher-api/src/lib/data/gameConfig']) {
	for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
		const raw = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
		const out = normalizeGameConfigDoc(raw);
		check(`${file}: no block appears`, Boolean(out?.expandingWilds || out?.growingWild), false);
	}
}

console.log('\n3. resolve: one reader, every default');
check('no block ⇒ undefined', resolveExpandingWilds(doc()), undefined);
check(
	'expanding: each wild with the reels its base strips deal it on',
	resolveExpandingWilds(doc({ expandingWilds: { symbols: ['FAIRY', 'OFF', 'H1'] } })),
	{ symbols: [{ symbol: 'FAIRY', reels: [1, 2, 3] }], show: 'onWin' },
);
check(
	'expanding: nothing usable ⇒ undefined',
	resolveExpandingWilds(doc({ expandingWilds: { symbols: ['BOOK'] } })),
	undefined,
);
check(
	'expanding: a ways game ⇒ undefined',
	resolveExpandingWilds(
		doc({ winModel: { type: 'ways' }, expandingWilds: { symbols: ['FAIRY'] } }),
	),
	undefined,
);
check(
	'expanding: a lines game that tumbles ⇒ undefined',
	resolveExpandingWilds(doc({ cascade: true, expandingWilds: { symbols: ['FAIRY'] } })),
	undefined,
);
check(
	'growing: centre reel, free spins the same, plus',
	resolveGrowingWild(doc({ growingWild: { symbol: 'CLOVER' } })),
	{ symbol: 'CLOVER', reels: [2], freeSpinReels: [2], pattern: 'plus' },
);
check(
	'growing: reels off the grid dropped, an emptied list falls back',
	resolveGrowingWild(
		doc({ growingWild: { symbol: 'CLOVER', reels: [7], freeSpinReels: [1, 3, 9] } }),
	),
	{ symbol: 'CLOVER', reels: [2], freeSpinReels: [1, 3], pattern: 'plus' },
);
check(
	'growing: a scatter ⇒ undefined',
	resolveGrowingWild(doc({ growingWild: { symbol: 'S' } })),
	undefined,
);
check('reelsDealing', reelsDealing(doc(), 'CLOVER'), [2]);

console.log('\n4. growCells: the pattern, clipped at the edge');
const rows = [4, 4, 4, 4, 4];
check('plus at the centre', growCells({ reel: 2, row: 1 }, 'plus', rows), [
	{ reel: 2, row: 0 },
	{ reel: 2, row: 2 },
	{ reel: 1, row: 1 },
	{ reel: 3, row: 1 },
]);
check('plus at a corner', growCells({ reel: 0, row: 0 }, 'plus', rows), [
	{ reel: 0, row: 1 },
	{ reel: 1, row: 0 },
]);
check('all8 at the bottom edge', growCells({ reel: 4, row: 3 }, 'all8', rows).length, 3);
check(
	'a stepped board clips by its own column',
	growCells({ reel: 1, row: 3 }, 'horizontal', [3, 4, 3]),
	[],
);

console.log('\n5. validate: each impossible config, by path');
check(
	'a good config is clean',
	issuesAt(authored, 'expandingWilds').concat(issuesAt(authored, 'growingWild')),
	[],
);
check(
	'expanding: empty, unknown, not wild, scatter, undealt',
	issuesAt(doc({ expandingWilds: { symbols: ['NOPE', 'H1', 'BOOK'] } }), 'expandingWilds'),
	[
		'error expandingWilds.symbols.0',
		'error expandingWilds.symbols.1',
		'error expandingWilds.symbols.2',
	],
);
check('expanding: no symbol', issuesAt(doc({ expandingWilds: {} }), 'expandingWilds'), [
	'error expandingWilds.symbols',
]);
check(
	'expanding: a wild on no strip',
	issuesAt(doc({ expandingWilds: { symbols: ['OFF'] } }), 'expandingWilds'),
	['error expandingWilds.symbols.0'],
);
check(
	'expanding: a ways game',
	issuesAt(
		doc({ winModel: { type: 'ways' }, expandingWilds: { symbols: ['FAIRY'] } }),
		'expandingWilds',
	),
	['error expandingWilds'],
);
check(
	'expanding: a tumbling game',
	issuesAt(doc({ cascade: true, expandingWilds: { symbols: ['FAIRY'] } }), 'expandingWilds'),
	['error expandingWilds'],
);
check(
	'the same wild expanding and growing',
	issuesAt(
		doc({ expandingWilds: { symbols: ['FAIRY'] }, growingWild: { symbol: 'FAIRY', reels: [1] } }),
		'expandingWilds',
	),
	['error expandingWilds.symbols.0'],
);
check(
	'growing: no symbol, reels off the board',
	issuesAt(doc({ growingWild: { reels: [5], freeSpinReels: [6] } }), 'growingWild'),
	['error growingWild.symbol', 'error growingWild.reels', 'error growingWild.freeSpinReels'],
);
check('growing: a scatter', issuesAt(doc({ growingWild: { symbol: 'S' } }), 'growingWild'), [
	'error growingWild.symbol',
]);
check(
	'growing: reels its strips never deal it on',
	issuesAt(doc({ growingWild: { symbol: 'CLOVER', reels: [0, 4] } }), 'growingWild'),
	['warning growingWild.reels'],
);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
