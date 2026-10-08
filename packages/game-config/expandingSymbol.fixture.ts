/**
 * The Book-of EXPANDING SPECIAL as a Game Config block (`freeSpins.expandingSymbol`,
 * docs/design/book-feature.md §3.1–§3.2, Phase 2): it normalizes departure-only and as a fixed
 * point, resolves through one reader, and the validator names each impossible config by path. And a
 * config without it is exactly what it was — every committed default normalizes byte-identically.
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
 *     packages/game-config/expandingSymbol.fixture.ts
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { bookOfThermopylaePreset } from './src/bookOfPresets.ts';
import {
	bookSymbols,
	DEFAULT_EXPAND_MIN_REELS,
	normalizeExpandingSymbol,
	resolveExpandingSymbol,
} from './src/expandingSymbol.ts';
import { HOLD_AND_WIN_PRESETS } from './src/holdAndWinPresets.ts';
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
const reels = (...names: string[]) => Array.from({ length: 5 }, () => strip(...names));
const base = {
	providerName: 'x',
	gameName: 'x',
	gameID: 'x',
	rtp: 0.96,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	paylines: { '1': [1, 1, 1, 1, 1] },
	symbols: {
		H1: { paytable: [{ '2': 10 }, { '3': 100 }] },
		H2: { paytable: [{ '3': 30 }] },
		L1: { paytable: [{ '4': 5 }] },
		OFF: { paytable: [{ '3': 9 }] },
		W: { special_properties: ['wild'], paytable: [{ '3': 50 }] },
		S: { special_properties: ['scatter'], paytable: [{ '3': 2 }] },
	},
	paddingReels: { basegame: reels('H1', 'H2', 'L1', 'W', 'S') },
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 } },
};
const doc = (over: Record<string, unknown> = {}): GameConfigDoc =>
	normalizeGameConfigDoc({ ...base, ...over }) as GameConfigDoc;
const withSpecial = (expandingSymbol: unknown, freeSpins: Record<string, unknown> = {}) =>
	doc({ freeSpins: { ...freeSpins, expandingSymbol } });
const issuesAt = (d: GameConfigDoc, path: string) =>
	validateGameConfigDoc(d)
		.filter((issue) => issue.path === path)
		.map((issue) => issue.severity);

console.log('\nwithout the block, nothing changes');
/** Each committed default as origin/main's normalizer emitted it (2026-10-07, before this block):
 *  sha-256 of `JSON.stringify(normalizeGameConfigDoc(json))`, first 16 hex digits. */
const PINNED: Record<string, string> = {
	'holdAndWin.classic.json': 'b8dddf930e614ea7',
	'holdAndWin.collector.json': 'e506f3c02d3aac09',
	'holdAndWin.pots.json': '01e2ac04f676ba9f',
	'lines.json': '4e6d5bb1764ee30c',
	'scatter.json': '7e9591cdf9382419',
	'ways.json': '81f7df3cd9bd192c',
};
const DEFAULTS = new URL('../../apps/launcher-api/src/lib/data/gameConfig/', import.meta.url);
const digest = (value: unknown) =>
	createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
/** The lines PRESETS beside the defaults (book-feature Phase 5a): a new file, not a changed one. */
const PRESET_FILES = ['lines.bookOfThermopylae.json'];
const files = readdirSync(DEFAULTS).filter(
	(name) => name.endsWith('.json') && !PRESET_FILES.includes(name),
);
check('every committed default is pinned', files.sort(), Object.keys(PINNED).sort());
check(
	'every lines preset is committed',
	PRESET_FILES.filter((name) => readdirSync(DEFAULTS).includes(name)),
	PRESET_FILES,
);
{
	const committed = normalizeGameConfigDoc(
		JSON.parse(readFileSync(new URL('lines.bookOfThermopylae.json', DEFAULTS), 'utf8')),
	) as GameConfigDoc;
	check(
		'the committed Book of Thermopylae preset deals the preset’s special',
		resolveExpandingSymbol(committed),
		resolveExpandingSymbol(normalizeGameConfigDoc(bookOfThermopylaePreset()) as GameConfigDoc),
	);
}
for (const file of files) {
	const normalized = normalizeGameConfigDoc(
		JSON.parse(readFileSync(new URL(file, DEFAULTS), 'utf8')),
	) as GameConfigDoc;
	check(`${file}: normalizes byte-identically`, digest(normalized), PINNED[file]);
	check(`${file}: carries no expanding symbol`, resolveExpandingSymbol(normalized), undefined);
}
check('a doc with no free-spins block resolves none', resolveExpandingSymbol(doc()), undefined);
check('no doc resolves none', resolveExpandingSymbol(undefined), undefined);

console.log('\nnormalize — presence is the feature');
check('`{}` is kept as `{}`', normalizeExpandingSymbol({}), {});
check('a non-object is no block', [normalizeExpandingSymbol(1), normalizeExpandingSymbol([])], [undefined, undefined]); // prettier-ignore
check(
	'bad weights and thresholds are dropped, good ones kept',
	normalizeExpandingSymbol({
		weights: { H1: 2, H2: 0, L1: -1, '': 3, X: 'a', H3: Infinity },
		minReels: { H1: 2, H2: 0, L1: 2.5, X: '3' },
	}),
	{ weights: { H1: 2 }, minReels: { H1: 2 } },
);
check(
	'an empty minReels is dropped; an empty weights map is kept (no symbol weighted)',
	normalizeExpandingSymbol({ weights: { H1: 0 }, minReels: {} }),
	{ weights: {} },
);
{
	// The author weighted the last symbol to 0: none can be drawn — not "every one, equally".
	const none = withSpecial({ weights: {} });
	check('an empty weights map survives the doc normalizer', none.freeSpins?.expandingSymbol, { weights: {} }); // prettier-ignore
	check('…draws nothing', resolveExpandingSymbol(none)?.candidates, []);
	check('…and is the "weight at least one" error', issuesAt(none, 'freeSpins.expandingSymbol'), [
		'error',
	]);
	check('no weights at all still draws every eligible symbol', resolveExpandingSymbol(withSpecial({}))?.candidates.length, 3); // prettier-ignore
}
check(
	'the block alone keeps the free-spins block',
	doc({ freeSpins: { expandingSymbol: {} } }).freeSpins,
	{ expandingSymbol: {} },
);
check(
	'it survives free spins off',
	doc({ freeSpins: { enabled: false, expandingSymbol: { minReels: { H1: 2 } } } }).freeSpins,
	{ enabled: false, expandingSymbol: { minReels: { H1: 2 } } },
);
const authored = withSpecial({ weights: { H1: 1, H2: 3 }, minReels: { H1: 2 } });
check('an authored doc is a normalize fixed point', normalizeGameConfigDoc(authored), authored);

console.log('\nresolve — the one reader');
check(
	'no weights ⇒ every paying line symbol on the strips, equally, at 3 reels',
	resolveExpandingSymbol(withSpecial({})),
	{
		candidates: ['H1', 'H2', 'L1'].map((symbol) => ({
			symbol,
			weight: 1,
			minReels: DEFAULT_EXPAND_MIN_REELS,
		})),
	},
);
check(
	'weights ⇒ only the symbols they name; a threshold where stated',
	resolveExpandingSymbol(authored),
	{
		candidates: [
			{ symbol: 'H1', weight: 1, minReels: 2 },
			{ symbol: 'H2', weight: 3, minReels: 3 },
		],
	},
);
check(
	'free spins off ⇒ inert',
	resolveExpandingSymbol(withSpecial({}, { enabled: false })),
	undefined,
);

console.log('\nvalidate — each impossible config, named by path');
const P = 'freeSpins.expandingSymbol';
check(
	'a clean block has no issue of its own',
	validateGameConfigDoc(authored).filter((issue) => issue.path.startsWith(P)),
	[],
);
check('free spins off ⇒ a warning (inert)', issuesAt(withSpecial({}, { enabled: false }), P), [
	'warning',
]);
check(
	'a ways game ⇒ an error',
	issuesAt(doc({ winModel: { type: 'ways' }, freeSpins: { expandingSymbol: {} } }), P),
	['error'],
);
const hw = normalizeGameConfigDoc({
	...HOLD_AND_WIN_PRESETS.classic,
	freeSpins: { expandingSymbol: {} },
}) as GameConfigDoc;
check('a Hold and Win game ⇒ an error', issuesAt(hw, P).includes('error'), true);
check(
	'a weight on a symbol outside the dictionary ⇒ an error',
	issuesAt(withSpecial({ weights: { H1: 1, X9: 1 } }), `${P}.weights.X9`),
	['error'],
);
check(
	'…off the strips ⇒ an error',
	issuesAt(withSpecial({ weights: { H1: 1, OFF: 1 } }), `${P}.weights.OFF`),
	['error'],
);
check(
	'…on the scatter or a wild ⇒ an error',
	[
		issuesAt(withSpecial({ weights: { H1: 1, S: 1 } }), `${P}.weights.S`),
		issuesAt(withSpecial({ weights: { H1: 1, W: 1 } }), `${P}.weights.W`),
	],
	[['error'], ['error']],
);
check('no eligible symbol left ⇒ an error', issuesAt(withSpecial({ weights: { S: 1 } }), P), [
	'error',
]);
check(
	'a threshold above the reel count ⇒ an error',
	issuesAt(withSpecial({ minReels: { H1: 6 } }), `${P}.minReels.H1`),
	['error'],
);
check(
	'a threshold on a symbol never drawn ⇒ a warning',
	issuesAt(withSpecial({ weights: { H1: 1 }, minReels: { H2: 3 } }), `${P}.minReels.H2`),
	['warning'],
);
check(
	'a candidate with no pay at its threshold ⇒ a warning (it would expand and pay nothing)',
	issuesAt(withSpecial({ weights: { L1: 1 } }), `${P}.minReels.L1`),
	['warning'],
);
const twoBooks = doc({
	symbols: {
		...base.symbols,
		S: { special_properties: ['scatter', 'wild'] },
		B: { special_properties: ['scatter', 'wild'] },
	},
});
check('two books ⇒ an error at symbols', issuesAt(twoBooks, 'symbols'), ['error']);
check('…one book is fine', bookSymbols(doc({ symbols: { ...base.symbols, S: { special_properties: ['scatter', 'wild'] } } })), ['S']); // prettier-ignore

console.log('\nthe Book of Thermopylae preset');
const preset = normalizeGameConfigDoc(bookOfThermopylaePreset()) as GameConfigDoc;
check('a normalize fixed point', normalizeGameConfigDoc(preset), preset);
check('no issues', validateGameConfigDoc(preset), []);
check(
	'nine candidates, H1 expanding from 2 reels',
	resolveExpandingSymbol(preset)?.candidates.map((c) => `${c.symbol}:${c.minReels}`),
	['H1:2', 'H2:3', 'H3:3', 'H4:3', 'L1:3', 'L2:3', 'L3:3', 'L4:3', 'L5:3'],
);

console.log(
	failures === 0 ? '\nAll expanding-symbol assertions passed.\n' : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
