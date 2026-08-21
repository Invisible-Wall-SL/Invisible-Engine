/**
 * Offline fixture for the rule that made `/config` unsaveable: the reel STRIPS and the symbol
 * DICTIONARY are two lists, and a symbol removed from one has to leave the other.
 *
 * `validateGameConfigDoc` raises a BLOCKING error when a strip deals a symbol the dictionary does
 * not declare — correctly, since the board would be dealing something it cannot draw. The bug was
 * never that rule; it was that the page deleted a dictionary entry and left the strips alone, then
 * refused to save the result and offered no control to repair it (`toggleInPlay`, the one thing
 * that strips a symbol off the reels, early-returns for a symbol that is no longer in the
 * dictionary).
 *
 * So this pins the CONTRACT the page has to satisfy, in both directions, plus the fallback that
 * stops the repair from creating a worse problem — an empty reel.
 *
 * Run through tsx (this package's internal imports are extensionless):
 *   pnpm --filter launcher-api exec tsx ../../packages/game-config/stripDictionary.fixture.ts
 */

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

const docWith = (symbols: string[], reels: string[][]): GameConfigDoc =>
	({
		numReels: reels.length,
		numRows: reels.map(() => 3),
		paylines: {},
		winModel: { type: 'scatter', minCount: 8 },
		symbols: Object.fromEntries(symbols.map((n) => [n, { paytable: [{ '8': 3 }] }])),
		paddingReels: { basegame: reels.map((r) => strip(...r)) },
		betModes: { default: {} },
	}) as unknown as GameConfigDoc;

/** The page's repair, as the fixed `removeSymbol` performs it. */
const removeSymbol = (doc: GameConfigDoc, name: string): GameConfigDoc => {
	const symbols = { ...doc.symbols };
	delete symbols[name];
	const fallback = Object.keys(symbols)[0];
	const paddingReels = Object.fromEntries(
		Object.entries(doc.paddingReels).map(([gt, reels]) => [
			gt,
			reels.map((reel) => {
				const kept = reel.filter((cell) => cell.name !== name);
				return kept.length ? kept : fallback ? strip(fallback) : reel;
			}),
		]),
	);
	return { ...doc, symbols, paddingReels } as GameConfigDoc;
};

const stripOrphans = (doc: GameConfigDoc) =>
	validateGameConfigDoc(doc)
		.filter((i) => i.severity === 'error')
		.filter((i) => i.message.includes('appears on a reel strip'))
		.map((i) => i.path);

console.log('\nthe rule that blocks the save');
const orphaned = docWith(
	['H1', 'H5'],
	[
		['H1', 'L5'],
		['H5', 'L5'],
	],
);
check('a strip dealing an undeclared symbol is a blocking error', stripOrphans(orphaned), [
	'symbols.L5',
]);

console.log('\nremoving a symbol has to clear it from BOTH lists');
const repaired = removeSymbol(
	docWith(
		['H1', 'H5', 'L5'],
		[
			['H1', 'L5'],
			['H5', 'L5'],
		],
	),
	'L5',
);
check('...so the doc validates clean afterwards', stripOrphans(repaired), []);
check('...and the dictionary entry is gone', 'L5' in repaired.symbols, false);
check(
	'...and the surviving cells are untouched',
	repaired.paddingReels.basegame.map((r) => r.map((c) => c.name)),
	[['H1'], ['H5']],
);

console.log('\na reel must never be left empty');
const wouldEmpty = removeSymbol(docWith(['H1', 'L5'], [['L5'], ['H1', 'L5']]), 'L5');
check(
	'a reel that held only the removed symbol falls back to a survivor',
	stripOrphans(wouldEmpty),
	[],
);
check(
	'...rather than keeping the deleted one, which would re-raise the error',
	wouldEmpty.paddingReels.basegame.map((r) => r.map((c) => c.name)),
	[['H1'], ['H1']],
);

console.log('\nthe last symbol standing');
const emptied = removeSymbol(docWith(['L5'], [['L5']]), 'L5');
check(
	'with nothing left to fall back to, the reel is left as-is (and stays flagged)',
	stripOrphans(emptied),
	['symbols.L5'],
);

console.log(
	failures === 0 ? '\nAll strip/dictionary assertions passed.\n' : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
