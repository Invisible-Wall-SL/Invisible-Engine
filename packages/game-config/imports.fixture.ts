/**
 * Offline fixture for a BONUS IMPORTED from another project (`docs/design/pots-overlay.md` §5 A,
 * Phase 7): the Game Config half of the Game Maker's import and re-sync.
 *   pnpm check:all --only imports.fixture
 *
 * The source is `hw-classic-sample`'s config, which is the Classic sticky preset as the Game Maker
 * saves it. Pins: an import adds the feature as the host's Hold and Win bonus and keeps the host;
 * a clash is renamed and the map is stored; a re-sync picks up a source edit, keeps every name and
 * every pot route, and touches nothing else; what cannot be imported is refused with a reason; and
 * removing the overlay takes the import with it.
 */

import { addPotsOverlay, removePotsOverlay } from './src/addOns.ts';
import { normalizeBonusImports } from './src/bonusImports.ts';
import { holdAndWinIsOverlayBonus } from './src/holdAndWin.ts';
import { HOLD_AND_WIN_PRESETS } from './src/holdAndWinPresets.ts';
import { importBonus, importableFeatures, resyncBonus, type ImportResult } from './src/imports.ts';
import { symbolsInPlay, symbolsInPlayForGameType } from './src/inPlay.ts';
import { normalizeGameConfigDoc } from './src/normalize.ts';
import type { AddOnResult } from './src/addOns.ts';
import type { GameConfigDoc, GameConfigSymbol, RawGameConfig } from './src/types.ts';
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

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const normalize = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(raw);
	if (!doc) throw new Error('config did not normalize');
	return doc;
};

const added = (result: AddOnResult): GameConfigDoc => {
	if (!result.ok) throw new Error(`add refused: ${result.reason}`);
	return result.doc;
};

const imported = (result: ImportResult) => {
	if (!result.ok) throw new Error(`import refused: ${result.reason}`);
	return result;
};

/** Key order is not content: a doc an import builds orders its blocks as they were added. */
const canon = (v: unknown): unknown =>
	Array.isArray(v)
		? v.map(canon)
		: v && typeof v === 'object'
			? Object.fromEntries(
					Object.keys(v)
						.sort()
						.map((k) => [k, canon((v as Record<string, unknown>)[k])]),
				)
			: v;

const refusal = (result: ImportResult): string => (result.ok ? 'accepted' : result.reason);

const errors = (doc: GameConfigDoc) =>
	validateGameConfigDoc(normalize(clone(doc)))
		.filter((i) => i.severity === 'error')
		.map((i) => `${i.path}: ${i.message}`);

const pays = (three: number, four: number, five: number): GameConfigSymbol => ({
	paytable: [{ '3': three }, { '4': four }, { '5': five }],
});
const BOOK_STRIP = ['PIC1', 'ACE', 'SCAT', 'KING', 'TEN'].map((name) => ({ name }));
const BOOK_HOST: RawGameConfig = {
	providerName: 'invisible_wall',
	gameName: 'book_host',
	gameID: 'book_host',
	rtp: 0.96,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 } },
	paylines: { '1': [1, 1, 1, 1, 1], '2': [0, 0, 0, 0, 0], '3': [2, 2, 2, 2, 2] },
	symbols: {
		PIC1: pays(100, 1000, 5000),
		ACE: pays(5, 50, 150),
		KING: pays(5, 50, 150),
		TEN: pays(5, 20, 100),
		SCAT: { special_properties: ['scatter'] },
	},
	paddingReels: {
		basegame: Array.from({ length: 5 }, () => BOOK_STRIP),
		freegame: Array.from({ length: 5 }, () => BOOK_STRIP),
	},
};

const SOURCE = normalize(clone(HOLD_AND_WIN_PRESETS.classic));
const AT = '2026-10-03T08:00:00.000Z';
const LATER = '2026-10-04T09:00:00.000Z';
const FROM = { project: 'hw-classic-sample', mode: 'holdAndWin', at: AT };

const host = normalize(BOOK_HOST);
const goldHost = added(addPotsOverlay(host, 'potsToFreeSpins'));

console.log('\n1. what a source offers');
check(
	'the Classic sample offers its Hold and Win; its free spins are listed but refused',
	importableFeatures(SOURCE).map((f) => [f.mode, Boolean(f.refused)]),
	[
		['freeSpins', true],
		['holdAndWin', false],
	],
);

console.log('\n2. import into a host with no Hold and Win');
{
	const before = clone(goldHost);
	const result = imported(importBonus(goldHost, SOURCE, { ...FROM, pots: ['gold'] }));
	const doc = result.doc;
	check('validates without an error', errors(doc), []);
	check('normalizing it changes nothing', canon(normalize(clone(doc))), canon(doc));
	check('the input is not mutated', goldHost, before);
	check('it is the overlay bonus, not the base game', holdAndWinIsOverlayBonus(doc), true);
	check('the host replaced nothing', result.replaced, false);
	check('the record keeps where it came from', doc.imports, [
		{ mode: 'holdAndWin', importedFrom: FROM, symbols: result.symbols },
	]);
	check('nothing clashed', result.renamed, { symbols: {}, pots: {} });
	check("the source's base-board-only options are left out and said so", result.leftOut, [
		'the random metre',
		'buying the feature',
		"the multiplier's instant collect",
	]);
	check(
		'the block is the source feature, its base-game triggers dropped',
		[doc.holdAndWin!.boardEnd, doc.holdAndWin!.trigger, doc.holdAndWin!.coins.length],
		[SOURCE.holdAndWin!.boardEnd, { count: SOURCE.holdAndWin!.trigger.count }, 11],
	);
	check(
		'the respin strips are the source respin strips',
		doc.paddingReels.respin,
		SOURCE.paddingReels.respin,
	);
	check(
		'its symbols are in the dictionary as the source has them',
		Object.keys(result.symbols).map((name) => doc.symbols[name]),
		Object.keys(result.symbols).map((name) => SOURCE.symbols[name]),
	);
	check('the pot now starts it', doc.potsOverlay!.pots[0].bonus, { mode: 'holdAndWin' });
	check(
		"the host's base game is kept",
		[doc.paddingReels.basegame, doc.paddingReels.freegame, doc.paylines],
		[host.paddingReels.basegame, host.paddingReels.freegame, host.paylines],
	);
	check(
		'no imported symbol is dealt by the base game',
		symbolsInPlayForGameType(doc, 'basegame').some((n) => n in result.symbols),
		false,
	);
	check('removing the overlay gives back the host', removePotsOverlay(doc), host);
}

console.log('\n3. what an import refuses');
check(
	'no overlay',
	refusal(importBonus(host, SOURCE, FROM)),
	'Add a pots overlay first: a full pot is what starts an imported bonus.',
);
check(
	'a reels feature',
	refusal(importBonus(goldHost, SOURCE, { ...FROM, mode: 'freeSpins' })).startsWith(
		'A reels bonus',
	),
	true,
);
check(
	'a feature the source lacks',
	refusal(importBonus(goldHost, SOURCE, { ...FROM, mode: 'wheel' })),
	'The source project has no "wheel" feature.',
);
check(
	'a pot the host lacks',
	refusal(importBonus(goldHost, SOURCE, { ...FROM, pots: ['red'] })),
	'This project has no pot "red".',
);
const threePotsHost = added(addPotsOverlay(host, 'threePots'));
check(
	"the host's own Hold and Win bonus, unasked",
	refusal(importBonus(threePotsHost, SOURCE, FROM)),
	'This project already has a Hold and Win bonus. Replace it to import this one.',
);
const hwGame = added(addPotsOverlay(normalize(clone(HOLD_AND_WIN_PRESETS.pots)), 'threePots'));
check(
	'a Hold and Win GAME, even asked',
	refusal(importBonus(hwGame, SOURCE, { ...FROM, replace: true })),
	"This project's Hold and Win is its base game, so an imported one cannot take its place.",
);

console.log("\n4. replace the 3 Pots host's bonus");
{
	const result = imported(importBonus(threePotsHost, SOURCE, { ...FROM, replace: true }));
	const doc = result.doc;
	check('validates without an error', errors(doc), []);
	check('it replaced the bonus', result.replaced, true);
	check(
		'pots whose special the Classic feature lacks lose it; the multiplier pot keeps it',
		[result.droppedActivates, doc.potsOverlay!.pots.map((p) => p.bonus)],
		[
			['red', 'blue'],
			[
				{ mode: 'holdAndWin' },
				{ mode: 'holdAndWin' },
				{ mode: 'holdAndWin', activates: 'multiplier' },
			],
		],
	);
	check(
		"the 3 Pots bonus's own symbols are gone; the tokens stay",
		Object.keys(doc.symbols)
			.filter((n) => !(n in host.symbols))
			.sort(),
		[...Object.keys(result.symbols), 'POT_BLUE', 'POT_GREEN', 'POT_RED'].sort(),
	);
	check('one Hold and Win block, one record', doc.imports?.length, 1);
}

console.log('\n5. a clash is renamed and the map is kept');
const clashHost = (() => {
	const raw = clone(BOOK_HOST);
	raw.symbols.BONUS = pays(10, 20, 30);
	raw.paddingReels.basegame = raw.paddingReels.basegame.map((s) => [...s, { name: 'BONUS' }]);
	return added(addPotsOverlay(normalize(raw), 'potsToFreeSpins'));
})();
const first = imported(importBonus(clashHost, SOURCE, { ...FROM, pots: ['gold'] }));
check("the host's BONUS is kept as it was", first.doc.symbols.BONUS, pays(10, 20, 30));
check('the source BONUS becomes BONUS_2', first.renamed.symbols, { BONUS: 'BONUS_2' });
check(
	'the respin strips deal BONUS_2, never the host BONUS',
	[
		symbolsInPlayForGameType(first.doc, 'respin').includes('BONUS_2'),
		symbolsInPlayForGameType(first.doc, 'respin').includes('BONUS'),
	],
	[true, false],
);
check('the record stores the rename', first.doc.imports![0].symbols.BONUS, 'BONUS_2');
check('validates without an error', errors(first.doc), []);

console.log('\n6. re-sync picks up a source edit and keeps everything else');
{
	const edited = clone(SOURCE);
	edited.holdAndWin!.respins.start = 4;
	edited.holdAndWin!.coins[0].weight = 99;
	edited.symbols.BONUS = { ...edited.symbols.BONUS, special_properties: ['coin'] };
	// The host authors around the import: renames a pot's label, adds its own mode.
	const authored = clone(first.doc);
	authored.potsOverlay!.pots[0].label = 'Gold pot';
	const result = imported(resyncBonus(authored, edited, 'holdAndWin', LATER));
	const doc = result.doc;
	check(
		'the edit arrives',
		[doc.holdAndWin!.respins.start, doc.holdAndWin!.coins[0].weight],
		[4, 99],
	);
	check('the rename is reused, not renamed again', result.symbols, first.symbols);
	check('the record is the same import, re-synced', doc.imports, [
		{ mode: 'holdAndWin', importedFrom: { ...FROM, at: LATER }, symbols: first.symbols },
	]);
	check(
		'the pot route and the authored label are kept',
		doc.potsOverlay!.pots[0],
		authored.potsOverlay!.pots[0],
	);
	check(
		'nothing outside the import moved',
		{ ...doc, holdAndWin: null, imports: null, symbols: null, paddingReels: null },
		{ ...authored, holdAndWin: null, imports: null, symbols: null, paddingReels: null },
	);
	check(
		"the host's own symbols and strips are untouched",
		[
			Object.keys(clashHost.symbols).map((n) => doc.symbols[n]),
			doc.paddingReels.basegame,
			doc.paddingReels.freegame,
		],
		[
			Object.keys(clashHost.symbols).map((n) => clashHost.symbols[n]),
			clashHost.paddingReels.basegame,
			clashHost.paddingReels.freegame,
		],
	);
	const again = imported(resyncBonus(doc, edited, 'holdAndWin', LATER));
	check('a second re-sync with no source edit changes nothing', again.doc, doc);
	check('validates without an error', errors(doc), []);

	const dropped = clone(edited);
	const gone = 'BOOST';
	dropped.paddingReels.respin = dropped.paddingReels.respin.map((s) =>
		s.filter((c) => c.name !== gone),
	);
	const shrunk = imported(resyncBonus(doc, dropped, 'holdAndWin', LATER)).doc;
	check(
		'a symbol the source no longer deals leaves the dictionary and the map',
		[gone in shrunk.symbols, gone in shrunk.imports![0].symbols],
		[false, false],
	);
	check(
		'a re-sync of a mode that was not imported is refused',
		refusal(resyncBonus(goldHost, SOURCE, 'holdAndWin', LATER)),
		'"holdAndWin" was not imported from another project.',
	);
}

console.log('\n7. the record normalizes structurally');
check(
	'junk is dropped, a duplicate mode is kept once',
	normalizeBonusImports([
		{ mode: 'holdAndWin', importedFrom: FROM, symbols: { BONUS: 'BONUS_2', X: 3 } },
		{ mode: 'holdAndWin', importedFrom: { ...FROM, project: 'other' }, symbols: {} },
		{ mode: '9bad', importedFrom: FROM },
		{ mode: 'x', importedFrom: { project: 'p' } },
		'nope',
	]),
	[{ mode: 'holdAndWin', importedFrom: FROM, symbols: { BONUS: 'BONUS_2' } }],
);
check('none ⇒ absent', normalizeBonusImports([]), undefined);
check(
	'a record whose mode is gone warns',
	validateGameConfigDoc(
		normalize({
			...clone(goldHost),
			imports: [{ mode: 'holdAndWin', importedFrom: FROM, symbols: {} }],
		}),
	).map((i) => `${i.severity}:${i.path}`),
	['warning:imports.0.mode'],
);
check(
	"a host with no import normalizes byte-identically (no 'imports' key)",
	'imports' in normalize(clone(BOOK_HOST)),
	false,
);
check('the renamed BONUS_2 is dealt', symbolsInPlay(first.doc).includes('BONUS_2'), true);

if (failures) {
	console.log(`\n${failures} FAILED`);
	process.exit(1);
}
console.log('\nall ok');
