/**
 * Offline fixture for symbol-state resolution — run with node (it strips the types):
 *   node packages/engine-game/src/game/symbolCell.fixture.ts
 *
 * The case that matters is the one that took the live board down: a project's own multiplier symbol,
 * authored with every state EXCEPT `explosion`, on a cascading game. `explosion` is the only state
 * the tumble asks for, and a symbol that exists only as an override has no coded cell to inherit —
 * so the lookup returned nothing, `Symbol.svelte` fell through to its SPINE arm, and
 * `SpineProvider` did `key.match(...)` on `undefined`. A throw inside a render unmounts the board:
 * the player loses the reels because one symbol lacked one state.
 *
 * So these assert the rule end to end, including the shape that crashed, verbatim.
 */

import { isUsableCell, resolveSymbolState, type StateMapLike } from './symbolCell.ts';

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

const spine = (assetKey: string) => ({ type: 'spine', assetKey });
const sprite = (assetKey: string) => ({ type: 'sprite', assetKey });

console.log('\na cell only counts when it names an asset');
check('a bound spine cell is usable', isUsableCell(spine('m_spine')), true);
check('a missing cell is not', isUsableCell(undefined), false);
// This is the crash shape: typed, but with nothing to render.
check('a spine cell with NO assetKey is not', isUsableCell({ type: 'spine' }), false);
check('...nor is an empty assetKey', isUsableCell({ type: 'spine', assetKey: '' }), false);

console.log('\nthe live `test5` multiplier — every state but explosion');
const M: StateMapLike = {
	static: spine('m_static'),
	spin: spine('m_spin'),
	land: spine('m_land'),
	win: spine('m_win'),
	postWinStatic: spine('m_post'),
};
check('an authored state draws itself', resolveSymbolState(M, 'win'), 'win');
check(
	'EXPLOSION falls back to static rather than nothing',
	resolveSymbolState(M, 'explosion'),
	'static',
);
check(
	'...which is what stops the board unmounting mid-tumble',
	resolveSymbolState(M, 'explosion') !== null,
	true,
);

console.log('\nthe inherited fallbacks stay');
const book: StateMapLike = { static: sprite('s'), win: spine('w') };
check('bookIntro inherits win', resolveSymbolState(book, 'bookIntro'), 'win');
check('bookIdle inherits win', resolveSymbolState(book, 'bookIdle'), 'win');
check('stacked inherits static', resolveSymbolState(book, 'stacked'), 'static');

console.log('\nthe cascade explosion inherits the on-reel one');
const oneExplosion: StateMapLike = { static: sprite('s'), explosion: spine('boom') };
check(
	'an UNBOUND tumble explosion plays the normal explosion — the pre-split behaviour, kept',
	resolveSymbolState(oneExplosion, 'clearReel'),
	'explosion',
);
check(
	'...and a bound one wins, which is the whole point of the second binding',
	resolveSymbolState({ ...oneExplosion, clearReel: spine('cascade_boom') }, 'clearReel'),
	'clearReel',
);
check(
	'the on-reel explosion is NEVER redirected to the cascade one',
	resolveSymbolState({ static: sprite('s'), clearReel: spine('cascade_boom') }, 'explosion'),
	'static',
);
check(
	'neither explosion bound ⇒ static, not a crash mid-tumble',
	resolveSymbolState(M, 'clearReel'),
	'static',
);

console.log('\nwhen there is genuinely nothing to draw');
check('no map at all ⇒ null', resolveSymbolState(undefined, 'static'), null);
check('an empty map ⇒ null', resolveSymbolState({}, 'explosion'), null);
check(
	'a map whose only cell is unusable ⇒ null, not a blank binding',
	resolveSymbolState({ static: { type: 'spine' } }, 'explosion'),
	null,
);
check(
	'a book state with an unusable win falls to static',
	resolveSymbolState({ static: sprite('s'), win: { type: 'spine' } }, 'bookIntro'),
	'static',
);

console.log(failures === 0 ? `\nAll symbol-state assertions passed.\n` : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
