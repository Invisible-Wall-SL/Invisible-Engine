/**
 * Offline fixture for the symbol MAP + symbol INFO factories — run with tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/engine-game/src/game/symbolInfo.fixture.ts
 *
 * (tsx rather than bare node, because `symbolInfo.ts` imports `./symbolCell` without an extension
 * and Node's type-stripping will not resolve that; `symbolCell.fixture.ts` next door can use node
 * only because its one import is extensionful.)
 *
 * What it is actually guarding. Phase A of `docs/design/game-type-templates.md` split what used to
 * be two app modules sharing module-level state — `symbolMap.ts`'s merge memo and `utils.ts`'s
 * resolved-cell memo — into two FACTORIES, wired together by passing the map's API into the
 * resolver. Those two memos are invalidated by ONE counter, and the whole point of the coupling is
 * that they can never disagree about which map is live: an online game fetches its symbol overrides
 * AFTER module evaluation, so a resolver that kept a memo the map reset would render the coded
 * template art forever. Splitting them across a package seam is exactly the change that could break
 * that, so it is asserted here rather than left to a live spin to discover.
 */

import { createSymbolMap } from './symbolMap.ts';
import { createSymbolInfo } from './symbolInfo.ts';
import type { SymbolInfoMap, SymbolState } from './types.ts';

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
const ok = (label: string, actual: boolean): void => check(label, actual, true);

const cell = (type: 'sprite' | 'spine', assetKey: string) => ({ type, assetKey }) as const;

const CODED: SymbolInfoMap = {
	H1: {
		static: cell('sprite', 'h1.webp'),
		win: cell('spine', 'H1'),
	},
	L1: {
		static: { ...cell('sprite', 'l1.webp'), sizeRatios: { width: 0.8, height: 0.8 } },
	},
};

const state = (s: string) => s as SymbolState;

console.log('\nno baked overrides ⇒ the coded map, byte for byte (dev parity)');
{
	const map = createSymbolMap({ codedMap: CODED, bakedMap: () => undefined });
	check('the merge is the coded map', map.getActiveSymbolInfoMap(), CODED);
	ok('…and is the very same object, not a copy', map.getActiveSymbolInfoMap() === CODED);
}

console.log('\na baked override replaces a CELL, never a whole symbol');
{
	const map = createSymbolMap({
		codedMap: CODED,
		bakedMap: () => ({ H1: { win: cell('spine', 'H1_AUTHORED') } }),
	});
	const merged = map.getActiveSymbolInfoMap();
	check('the overridden cell wins', merged.H1.win.assetKey, 'H1_AUTHORED');
	check('the un-overridden sibling falls through', merged.H1.static.assetKey, 'h1.webp');
	check('an untouched symbol is untouched', merged.L1.static.assetKey, 'l1.webp');
}

console.log('\nthe resolved cell is memoised BY IDENTITY, not merely by value');
{
	const map = createSymbolMap({ codedMap: CODED, bakedMap: () => undefined });
	const info = createSymbolInfo({ symbolMap: map });
	const first = info.getSymbolInfo({ rawSymbol: { name: 'H1' }, state: state('static') });
	const second = info.getSymbolInfo({ rawSymbol: { name: 'H1' }, state: state('static') });
	ok('the same (name, state) returns the SAME object', first === second);
	ok(
		'a different state returns a different one',
		first !== info.getSymbolInfo({ rawSymbol: { name: 'H1' }, state: state('win') }),
	);
	check('…and resolves that state', first.assetKey, 'h1.webp');
}

console.log('\nONE reset invalidates BOTH caches — the coupling the package split could break');
{
	let overrides: SymbolInfoMap | undefined = undefined;
	const map = createSymbolMap({ codedMap: CODED, bakedMap: () => overrides });
	const info = createSymbolInfo({ symbolMap: map });

	// The online shape: something reads a symbol at import time, BEFORE the runtime bundle lands.
	const early = info.getSymbolInfo({ rawSymbol: { name: 'H1' }, state: state('static') });
	check('the early read sees the coded art', early.assetKey, 'h1.webp');

	overrides = { H1: { static: cell('sprite', 'h1_live.webp') } };
	check(
		'…and STILL does, until the reset — both memos are warm',
		info.getSymbolInfo({ rawSymbol: { name: 'H1' }, state: state('static') }).assetKey,
		'h1.webp',
	);

	map.resetSymbolMapCache();
	const late = info.getSymbolInfo({ rawSymbol: { name: 'H1' }, state: state('static') });
	check('after the reset the map recomputes', map.getActiveSymbolInfoMap().H1.static.assetKey, 'h1_live.webp'); // prettier-ignore
	check('…and the RESOLVER follows it', late.assetKey, 'h1_live.webp');
	ok('…with a fresh object, so every renderer re-derives', late !== early);
	check('the generation counter advanced exactly once', map.symbolMapGeneration(), 1);
}

console.log('\na symbol or state with no art renders NOTHING — it never takes the board down');
{
	const map = createSymbolMap({ codedMap: CODED, bakedMap: () => undefined });
	const info = createSymbolInfo({ symbolMap: map });

	const unknown = info.getSymbolInfo({ rawSymbol: { name: 'NOPE' }, state: state('static') });
	check('an unknown symbol reports missing art', unknown.missingArt, true);
	check('…and names no asset to render', unknown.assetKey, undefined);
	check('…at the default size', unknown.sizeRatios, { width: 1, height: 1 });

	// `explosion` is the state that took a live board down: only the cascade asks for it, and a
	// symbol with nothing to inherit fell through to the SPINE renderer with an undefined key.
	const exploded = info.getSymbolInfo({ rawSymbol: { name: 'L1' }, state: state('explosion') });
	check('an unauthored state inherits `static`', exploded.assetKey, 'l1.webp');
	check('…and is NOT reported as missing', exploded.missingArt, false);
	check('…carrying that cell’s authored size', exploded.sizeRatios, { width: 0.8, height: 0.8 });

	ok('`hasAuthoredSymbolState` is true for the authored state', info.hasAuthoredSymbolState('H1', state('win'))); // prettier-ignore
	check(
		'…and FALSE for an inherited one (the long animation cap is not spent on it)',
		info.hasAuthoredSymbolState('L1', state('explosion')),
		false,
	);
}

console.log('\nsize ratios resolve baked → coded → 1×1');
{
	const map = createSymbolMap({
		codedMap: CODED,
		bakedMap: () => ({ H1: { static: { ...cell('sprite', 'h1.webp'), sizeRatios: { width: 2, height: 3 } } } }), // prettier-ignore
	});
	check('a baked ratio wins', map.resolveSymbolSizeRatios('H1', 'static'), { width: 2, height: 3, fit: 'stretch' }); // prettier-ignore
	check('a coded ratio is next', map.resolveSymbolSizeRatios('L1', 'static'), { width: 0.8, height: 0.8, fit: 'stretch' }); // prettier-ignore
	check('neither ⇒ 1×1', map.resolveSymbolSizeRatios('H1', 'win'), { width: 1, height: 1, fit: 'stretch' }); // prettier-ignore
}

console.log('\ntwo instances never share state');
{
	const a = createSymbolMap({ codedMap: CODED, bakedMap: () => undefined });
	const b = createSymbolMap({ codedMap: CODED, bakedMap: () => undefined });
	a.resetSymbolMapCache();
	check('resetting one does not advance the other', b.symbolMapGeneration(), 0);
}

console.log(
	failures === 0 ? `\nAll symbol map/info assertions passed.\n` : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
