/**
 * Offline fixture for the ADD-ON merge helpers (`docs/design/pots-overlay.md` §3.1, §4 — the
 * `/config` Add-ons section and the Game Maker's add-on action).
 *   pnpm check:all --only addOns.fixture
 *
 * Pins: an add merges into the host and replaces nothing of it, and the input is never mutated; a
 * name the host already uses is renamed everywhere the add-on names it; what cannot be added is
 * refused with a reason; and removing the overlay gives back exactly the doc it was added to.
 */

import { addHoldAndWinBonus, addPotsOverlay, removePotsOverlay } from './src/addOns.ts';
import { holdAndWinIsOverlayBonus } from './src/holdAndWin.ts';
import { HOLD_AND_WIN_PRESETS, HOLD_AND_WIN_PRESET_IDS } from './src/holdAndWinPresets.ts';
import { symbolsInPlay } from './src/inPlay.ts';
import { normalizeGameConfigDoc } from './src/normalize.ts';
import {
	POTS_OVERLAY_PRESET_IDS,
	potsOverlayPreset,
	type PotsOverlayPresetId,
} from './src/potsOverlayPresets.ts';
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

const issues = (doc: GameConfigDoc) =>
	validateGameConfigDoc(normalize(clone(doc))).map((i) => `${i.severity}:${i.path}`);

/** A Book of Borut-shaped host: 5×3 lines, a scatter book, its own free-spin strips. */
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
const host = normalize(BOOK_HOST);

const hostKept = (doc: GameConfigDoc, of: GameConfigDoc = host) => [
	Object.fromEntries(Object.keys(of.symbols).map((name) => [name, doc.symbols[name]])),
	Object.fromEntries(Object.keys(of.paddingReels).map((key) => [key, doc.paddingReels[key]])),
	doc.paylines,
	doc.winModel,
];

console.log('\n1. add the overlay to a book host');
for (const id of POTS_OVERLAY_PRESET_IDS) {
	const before = clone(host);
	const result = addPotsOverlay(host, id);
	const doc = added(result);
	check(`${id}: validates clean`, issues(doc), []);
	check(`${id}: normalizing it changes nothing`, normalize(clone(doc)), doc);
	check(`${id}: nothing clashed`, result.ok && result.renamed, { symbols: {}, pots: {} });
	check(`${id}: the block is the preset's`, doc.potsOverlay, potsOverlayPreset(id).potsOverlay);
	check(
		`${id}: the host's symbols, strips, lines and win model are kept`,
		hostKept(doc),
		hostKept(host),
	);
	check(`${id}: the input is not mutated`, host, before);
	check(
		`${id}: tokens are in the dictionary and on no strip`,
		doc.potsOverlay!.pots.map((p) => [
			p.token in doc.symbols,
			symbolsInPlay(doc).includes(p.token),
		]),
		doc.potsOverlay!.pots.map(() => [true, false]),
	);
}
const three = added(addPotsOverlay(host, 'threePots'));
check(
	'3 Pots brings its Hold and Win bonus: the block, its respin strips and their symbols',
	[holdAndWinIsOverlayBonus(three), three.paddingReels.respin.length, 'BONUS' in three.symbols],
	[true, 5, true],
);
check(
	'pots to free spins brings no Hold and Win',
	['holdAndWin' in added(addPotsOverlay(host, 'potsToFreeSpins')), 'respin' in host.paddingReels],
	[false, false],
);

console.log('\n2. names the host already uses are renamed');
const crowded = normalize({
	...clone(BOOK_HOST),
	symbols: {
		...BOOK_HOST.symbols,
		BONUS: pays(1, 2, 3),
		POT_RED: { special_properties: ['wild'] },
		POT_RED_2: pays(4, 5, 6),
	},
	paddingReels: {
		...BOOK_HOST.paddingReels,
		basegame: BOOK_HOST.paddingReels.basegame.map((s) => [
			...s,
			{ name: 'BONUS' },
			{ name: 'POT_RED' },
			{ name: 'POT_RED_2' },
		]),
	},
});
const renamedResult = addPotsOverlay(crowded, 'threePots');
const renamedDoc = added(renamedResult);
check('each clash takes the first free suffix', renamedResult.ok && renamedResult.renamed, {
	symbols: { BONUS: 'BONUS_2', POT_RED: 'POT_RED_3' },
	pots: {},
});
check(
	"the host's own BONUS and POT_RED are untouched",
	hostKept(renamedDoc, crowded),
	hostKept(crowded, crowded),
);
check(
	'the respin strips deal the renamed coin, and the red pot drops the renamed token',
	[
		renamedDoc.paddingReels.respin.some((s) => s.some((c) => c.name === 'BONUS_2')),
		renamedDoc.paddingReels.respin.some((s) => s.some((c) => c.name === 'BONUS')),
		renamedDoc.potsOverlay!.pots[0].token,
		renamedDoc.symbols.BONUS_2,
	],
	[true, false, 'POT_RED_3', { special_properties: ['coin'] }],
);
check(
	'it validates with no overlay or Hold and Win issue',
	issues(renamedDoc).filter((i) => /potsOverlay|holdAndWin/.test(i)),
	[],
);
const potsGame = normalize(HOLD_AND_WIN_PRESETS.pots);
const onPotsGame = addPotsOverlay(potsGame, 'threePots');
check(
	"a 3 Pots Hold and Win game keeps its block; the overlay's pots take free ids beside its meters, and its coin drops are left out (the game's own reels start its feature)",
	[
		onPotsGame.ok && onPotsGame.renamed.pots,
		added(onPotsGame).holdAndWin,
		added(onPotsGame).potsOverlay!.drops.table.map((e) => ('pot' in e ? e.pot : 'coin')),
		issues(added(onPotsGame)),
	],
	[
		{ red: 'red_2', blue: 'blue_2', green: 'green_2' },
		potsGame.holdAndWin,
		['red_2', 'blue_2', 'green_2'],
		[],
	],
);
const errorsOn = (doc: GameConfigDoc, id: PotsOverlayPresetId) => {
	const result = addPotsOverlay(doc, id);
	return result.ok ? issues(result.doc).filter((i) => i.startsWith('error:')) : 'refused';
};
check(
	'on each Hold and Win game: what each preset leaves (3 Pots names specials Classic and Collector lack)',
	HOLD_AND_WIN_PRESET_IDS.map((game) => [
		game,
		POTS_OVERLAY_PRESET_IDS.map((id) => [id, errorsOn(normalize(HOLD_AND_WIN_PRESETS[game]), id)]),
	]),
	HOLD_AND_WIN_PRESET_IDS.map((game) => [
		game,
		POTS_OVERLAY_PRESET_IDS.map((id) => [
			id,
			id === 'coinsOnly'
				? 'refused'
				: id === 'threePots' && game !== 'pots'
					? errorsOn(normalize(HOLD_AND_WIN_PRESETS[game]), id)
					: [],
		]),
	]),
);
check(
	'...and 3 Pots on Classic or Collector does not come out clean',
	['classic', 'collector'].map(
		(game) =>
			(errorsOn(normalize(HOLD_AND_WIN_PRESETS[game as 'classic']), 'threePots') as string[])
				.length > 0,
	),
	[true, true],
);

console.log('\n3. refusals');
const refused = (result: AddOnResult) => (result.ok ? 'added' : result.reason);
check(
	'a second overlay is refused',
	refused(addPotsOverlay(three, 'potsToFreeSpins')),
	'This project already has a pots overlay. Remove it first.',
);
check(
	'a Hold and Win bonus on a project with a block is refused',
	HOLD_AND_WIN_PRESET_IDS.map((id) => refused(addHoldAndWinBonus(potsGame, id))),
	HOLD_AND_WIN_PRESET_IDS.map(() => 'This project already has a Hold and Win block.'),
);
const staleRespin = normalize({
	...clone(BOOK_HOST),
	paddingReels: { ...BOOK_HOST.paddingReels, respin: BOOK_HOST.paddingReels.basegame },
});
check(
	'strips already under the respin game type are never overwritten',
	[
		refused(addHoldAndWinBonus(staleRespin, 'classic')),
		refused(addPotsOverlay(staleRespin, 'threePots')),
	],
	[
		'This project already has "respin" strips, which the Hold and Win respin board would pad from. Remove them first.',
		'This project already has "respin" strips, which the Hold and Win respin board would pad from. Remove them first.',
	],
);

check(
	'coins only is refused on a Hold and Win game: its block counts only its own landed coins',
	HOLD_AND_WIN_PRESET_IDS.map((id) =>
		refused(addPotsOverlay(normalize(HOLD_AND_WIN_PRESETS[id]), 'coinsOnly')),
	),
	HOLD_AND_WIN_PRESET_IDS.map(
		() =>
			"This project's Hold and Win is its base game, started by coins landing on its reels, so dropped value coins would start nothing. Pick a preset with pots.",
	),
);

console.log('\n4. a Hold and Win bonus on its own, then the overlay over it');
for (const id of HOLD_AND_WIN_PRESET_IDS) {
	const doc = added(addHoldAndWinBonus(host, id));
	check(
		`${id}: the block, its symbols and its strips land; the host is kept`,
		[Boolean(doc.holdAndWin), doc.paddingReels.respin.length, hostKept(doc)],
		[true, 5, hostKept(host)],
	);
}
const classicFirst = added(addHoldAndWinBonus(host, 'classic'));
const overClassic = added(addPotsOverlay(classicFirst, 'threePots'));
check(
	'the overlay keeps a Hold and Win bonus already added',
	[overClassic.holdAndWin, holdAndWinIsOverlayBonus(overClassic)],
	[classicFirst.holdAndWin, true],
);

const waysHost = normalize({
	...clone(BOOK_HOST),
	winModel: { type: 'ways', direction: 'ltr', minKind: 3 },
});
const waysBonus = added(
	addHoldAndWinBonus(added(addPotsOverlay(waysHost, 'potsToFreeSpins')), 'classic'),
);
check(
	"a bonus beside an overlay on a ways host is the overlay's: the win model stays ways, no winModel issue",
	[
		holdAndWinIsOverlayBonus(waysBonus),
		waysBonus.winModel?.type,
		issues(waysBonus).filter((i) => i.includes('winModel')),
	],
	[true, 'ways', []],
);

console.log('\n5. remove gives back the doc it was added to');
for (const id of POTS_OVERLAY_PRESET_IDS) {
	check(`${id} on the book host`, removePotsOverlay(added(addPotsOverlay(host, id))), host);
}
check('3 Pots with renames', removePotsOverlay(renamedDoc), crowded);
const coinsDoc = added(addPotsOverlay(host, 'coinsOnly'));
check(
	"coins only: no pots, the Classic bonus is the overlay's, and remove takes it all back",
	[
		coinsDoc.potsOverlay!.pots,
		holdAndWinIsOverlayBonus(coinsDoc),
		coinsDoc.holdAndWin!.trigger,
		removePotsOverlay(coinsDoc),
	],
	[[], true, { count: HOLD_AND_WIN_PRESETS.classic.holdAndWin!.trigger.count }, host],
);
const coinsOverBonus = added(addPotsOverlay(classicFirst, 'coinsOnly'));
check(
	'coins only over a Hold and Win bonus already added keeps it, and is its trigger',
	[coinsOverBonus.holdAndWin, holdAndWinIsOverlayBonus(coinsOverBonus), issues(coinsOverBonus)],
	[classicFirst.holdAndWin, true, []],
);
for (const id of HOLD_AND_WIN_PRESET_IDS) {
	const game = normalize(HOLD_AND_WIN_PRESETS[id]);
	check(
		`a ${id} Hold and Win game keeps its own block`,
		removePotsOverlay(added(addPotsOverlay(game, 'potsToFreeSpins'))),
		game,
	);
}
check('no overlay: an equal copy', removePotsOverlay(host), host);
check(
	"the Hold and Win mode's override goes with the bonus",
	'modes' in
		removePotsOverlay({
			...three,
			modes: [{ id: 'holdAndWin', board: 'respinBoard', label: 'Pot bonus' }],
		}),
	false,
);
const repointed = clone(three);
repointed.modes = [{ id: 'holdAndWin', board: 'respinBoard', gameType: 'freegame' }];
check(
	'strips another mode pads from are never removed with the bonus',
	removePotsOverlay(repointed).paddingReels.freegame,
	host.paddingReels.freegame,
);
const tokenEdited = clone(three);
tokenEdited.symbols.POT_RED.paytable = [{ '3': 1 }];
check(
	'a token the author has since given a payout is kept',
	'POT_RED' in removePotsOverlay(tokenEdited).symbols,
	true,
);

console.log(failures === 0 ? '\nAll add-on assertions passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
