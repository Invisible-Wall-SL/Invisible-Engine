/**
 * Offline fixture for the ADD-ON merge helpers (`docs/design/pots-overlay.md` §3.1, §4 — the
 * `/config` Add-ons section and the Game Maker's add-on action).
 *   pnpm check:all --only addOns.fixture
 *
 * Pins: an add merges into the host and replaces nothing of it, and the input is never mutated; a
 * name the host already uses is renamed everywhere the add-on names it; what cannot be added is
 * refused with a reason; and removing the overlay gives back exactly the doc it was added to.
 */

import {
	addHoldAndWinBonus,
	addPotsOverlay,
	removePotsOverlay,
	setOverlayPotCount,
	zeroPotsRefusal,
} from './src/addOns.ts';
import { potsOverlayOf, primaryHoldAndWin } from './src/bonusGames.ts';
import { holdAndWinIsOverlayBonus } from './src/holdAndWin.ts';
import { HOLD_AND_WIN_PRESETS, HOLD_AND_WIN_PRESET_IDS } from './src/holdAndWinPresets.ts';
import { symbolsInPlay } from './src/inPlay.ts';
import type { GameModeDecl } from './src/modes.ts';
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
	check(`${id}: the block is the preset's`, potsOverlayOf(doc), potsOverlayPreset(id).potsOverlay);
	check(
		`${id}: the host's symbols, strips, lines and win model are kept`,
		hostKept(doc),
		hostKept(host),
	);
	check(`${id}: the input is not mutated`, host, before);
	check(
		`${id}: tokens are in the dictionary and on no strip`,
		potsOverlayOf(doc)!.pots.map((p) => [
			p.token in doc.symbols,
			symbolsInPlay(doc).includes(p.token),
		]),
		potsOverlayOf(doc)!.pots.map(() => [true, false]),
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
	[
		Boolean(primaryHoldAndWin(added(addPotsOverlay(host, 'potsToFreeSpins')))),
		'respin' in host.paddingReels,
	],
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
		potsOverlayOf(renamedDoc)!.pots[0].token,
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
		primaryHoldAndWin(added(onPotsGame)),
		potsOverlayOf(added(onPotsGame))!.drops.table.map((e) => ('pot' in e ? e.pot : 'coin')),
		issues(added(onPotsGame)),
	],
	[
		{ red: 'red_2', blue: 'blue_2', green: 'green_2' },
		primaryHoldAndWin(potsGame),
		['red_2', 'blue_2', 'green_2'],
		[],
	],
);
const errorsOn = (doc: GameConfigDoc, id: PotsOverlayPresetId) => {
	const result = addPotsOverlay(doc, id);
	return result.ok ? issues(result.doc).filter((i) => i.startsWith('error:')) : 'refused';
};
check(
	'on each Hold and Win game every preset with pots comes out clean (8b: it brings its specials)',
	HOLD_AND_WIN_PRESET_IDS.map((game) => [
		game,
		POTS_OVERLAY_PRESET_IDS.map((id) => [id, errorsOn(normalize(HOLD_AND_WIN_PRESETS[game]), id)]),
	]),
	HOLD_AND_WIN_PRESET_IDS.map((game) => [
		game,
		POTS_OVERLAY_PRESET_IDS.map((id) => [id, id === 'coinsOnly' ? 'refused' : []]),
	]),
);
const classicGame = normalize(HOLD_AND_WIN_PRESETS.classic);
const threeOnClassic = added(addPotsOverlay(classicGame, 'threePots'));
check(
	'...3 Pots on Classic adds the payer and collector it lacks, beside its own multiplier and order',
	[
		Object.keys(primaryHoldAndWin(threeOnClassic)!.specials).sort(),
		primaryHoldAndWin(threeOnClassic)!.applyOrder,
		primaryHoldAndWin(threeOnClassic)!.specials.multiplier,
		['BOOST_2', 'COLLECT'].map((n) => threeOnClassic.symbols[n]?.special_properties),
		threeOnClassic.paddingReels.respin.map((strip) => strip.slice(-2).map((c) => c.name)),
	],
	[
		['collector', 'multiplier', 'payer'],
		[...primaryHoldAndWin(classicGame)!.applyOrder, 'payer', 'collector'],
		primaryHoldAndWin(classicGame)!.specials.multiplier,
		[['payer'], ['collector']],
		classicGame.paddingReels.respin.map(() => ['BOOST_2', 'COLLECT']),
	],
);
check(
	'...and the 3 Pots game, which has them all, gets the overlay exactly as before 8b',
	primaryHoldAndWin(added(addPotsOverlay(potsGame, 'threePots')))!.specials,
	primaryHoldAndWin(potsGame)!.specials,
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
		[Boolean(primaryHoldAndWin(doc)), doc.paddingReels.respin.length, hostKept(doc)],
		[true, 5, hostKept(host)],
	);
}
const classicFirst = added(addHoldAndWinBonus(host, 'classic'));
const overClassic = added(addPotsOverlay(classicFirst, 'threePots'));
check(
	'the overlay keeps a Hold and Win bonus already added, bringing only the specials it lacks',
	[
		{ ...primaryHoldAndWin(overClassic), specials: undefined, applyOrder: undefined },
		primaryHoldAndWin(overClassic)!.specials.multiplier,
		Object.keys(primaryHoldAndWin(overClassic)!.specials).sort(),
		holdAndWinIsOverlayBonus(overClassic),
	],
	[
		{ ...primaryHoldAndWin(classicFirst), specials: undefined, applyOrder: undefined },
		primaryHoldAndWin(classicFirst)!.specials.multiplier,
		['collector', 'multiplier', 'payer'],
		true,
	],
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
		potsOverlayOf(coinsDoc)!.pots,
		holdAndWinIsOverlayBonus(coinsDoc),
		primaryHoldAndWin(coinsDoc)!.trigger,
		removePotsOverlay(coinsDoc),
	],
	[[], true, { count: HOLD_AND_WIN_PRESETS.classic.holdAndWin!.trigger.count }, host],
);
const coinsOverBonus = added(addPotsOverlay(classicFirst, 'coinsOnly'));
check(
	'coins only over a Hold and Win bonus already added keeps it, and is its trigger',
	[
		primaryHoldAndWin(coinsOverBonus),
		holdAndWinIsOverlayBonus(coinsOverBonus),
		issues(coinsOverBonus),
	],
	[primaryHoldAndWin(classicFirst), true, []],
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
/** `doc` with its Hold and Win mode overriding `over`, its rules kept. */
const withPrimary = (doc: GameConfigDoc, over: Partial<GameModeDecl>): GameConfigDoc => ({
	...doc,
	modes: doc.modes?.map((m) => (m.id === 'holdAndWin' ? { ...m, ...over } : m)),
});
check(
	"the Hold and Win mode's override goes with the bonus",
	'modes' in removePotsOverlay(withPrimary(three, { label: 'Pot bonus' })),
	false,
);
const repointed = withPrimary(clone(three), { gameType: 'freegame' });
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

console.log('\n6. the pot count runs 0 to 5');
const potRows = (doc: GameConfigDoc) =>
	potsOverlayOf(doc)!.pots.map((p) => [p.id, p.token, p.bonus.mode, p.bonus.activates ?? '-']);
const dropRows = (doc: GameConfigDoc) =>
	potsOverlayOf(doc)!.drops.table.map((e) =>
		'pot' in e ? `${e.pot}:${e.weight}` : `coin:${e.weight}`,
	);
const five = added(setOverlayPotCount(three, 5));
check(
	'5 pots: two more, each with its own colour, token and the next unused special',
	potRows(five),
	[
		['red', 'POT_RED', 'holdAndWin', 'payer'],
		['blue', 'POT_BLUE', 'holdAndWin', 'collector'],
		['green', 'POT_GREEN', 'holdAndWin', 'multiplier'],
		['gold', 'POT_GOLD', 'holdAndWin', 'mystery'],
		['purple', 'POT_PURPLE', 'holdAndWin', '-'],
	],
);
check("5 pots: each new pot drops at the last pot's weight", dropRows(five), [
	'red:2',
	'blue:2',
	'green:2',
	'coin:3',
	'gold:2',
	'purple:2',
]);
check('5 pots validates clean', issues(five), []);
check('5 pots: the input is not mutated', 'gold' in Object.fromEntries(potRows(three)), false);
check('back to 3 gives the 3 Pots doc again', added(setOverlayPotCount(five, 3)), three);
const none = added(setOverlayPotCount(three, 0));
check(
	'0 pots: value coins only, the tokens gone, the Hold and Win bonus kept',
	[
		potsOverlayOf(none)!.pots,
		dropRows(none),
		'POT_RED' in none.symbols,
		Boolean(primaryHoldAndWin(none)),
	],
	[[], ['coin:3'], false, true],
);
check('0 pots validates clean', issues(none), []);
check('0 pots survives normalizing', normalize(clone(none)), none);
check(
	'from 0 back to 3: the 3 Pots pots, each dropping once',
	[potRows(added(setOverlayPotCount(none, 3))), dropRows(added(setOverlayPotCount(none, 3)))],
	[potRows(three), ['coin:3', 'red:1', 'blue:1', 'green:1']],
);
const freeOverlay = added(addPotsOverlay(host, 'potsToFreeSpins'));
check(
	'pots to free spins at 3: each new pot starts the free spins like the gold one',
	potRows(added(setOverlayPotCount(freeOverlay, 3))),
	[
		['gold', 'POT_GOLD', 'freeSpins', '-'],
		['red', 'POT_RED', 'freeSpins', '-'],
		['blue', 'POT_BLUE', 'freeSpins', '-'],
	],
);
check(
	'0 pots with no Hold and Win bonus is refused: nothing would drop',
	refused(setOverlayPotCount(freeOverlay, 0)),
	'With no pots the overlay drops only value coins, which start a Hold and Win bonus — add one first, or keep at least one pot.',
);
check(
	'0 pots on a Hold and Win game is refused: its block counts only its own landed coins',
	refused(setOverlayPotCount(added(onPotsGame), 0)),
	"This game's own Hold and Win is its base game, started by coins landing on its reels, so value coins alone start nothing — it needs at least one pot.",
);
check(
	'out of range is refused',
	[refused(setOverlayPotCount(three, 6)), refused(setOverlayPotCount(three, -1))],
	['An overlay holds 0 to 5 pots.', 'An overlay holds 0 to 5 pots.'],
);
check(
	'no overlay is refused',
	refused(setOverlayPotCount(host, 2)),
	'This project has no pots overlay.',
);
const keptArt = clone(five);
keptArt.symbols.POT_PURPLE.paytable = [{ '3': 1 }];
const shrunk = added(setOverlayPotCount(keptArt, 4));
check(
	'a dropped pot whose token the author changed keeps the token; a regrown pot reuses it',
	['POT_PURPLE' in shrunk.symbols, potRows(added(setOverlayPotCount(shrunk, 5)))[4][1]],
	[true, 'POT_PURPLE'],
);
check(
	'adding the overlay with a count',
	[
		potRows(added(addPotsOverlay(host, 'threePots', 5))).length,
		potsOverlayOf(added(addPotsOverlay(host, 'threePots', 0)))!.pots.length,
		refused(addPotsOverlay(host, 'potsToFreeSpins', 0)),
	],
	[
		5,
		0,
		'With no pots the overlay drops only value coins, which start a Hold and Win bonus. Pick a preset that brings one (3 Pots, Coins only), or keep at least one pot.',
	],
);
check(
	'Coins only with 3 pots asked for on a Hold and Win game is added with 3 pots',
	[
		potsOverlayOf(added(addPotsOverlay(potsGame, 'coinsOnly', 3)))!.pots.length,
		issues(added(addPotsOverlay(potsGame, 'coinsOnly', 3))).filter((i) =>
			i.startsWith('error:potsOverlay'),
		),
	],
	[3, []],
);
const freeWithClassic = added(addHoldAndWinBonus(freeOverlay, 'classic'));
const freeToCoins = added(setOverlayPotCount(freeWithClassic, 0));
check(
	'0 pots raises the most drops per spin to reach the coin trigger, so it can start',
	[
		potsOverlayOf(freeToCoins)!.drops.maxPerSpin,
		issues(freeToCoins).filter((i) => i.includes('potsOverlay')),
	],
	[(primaryHoldAndWin(freeWithClassic)!.trigger.count!.min ?? 0) + 2, []],
);
check(
	'raising most-per-spin is said, and it stays raised when a pot comes back',
	[
		(() => {
			const result = setOverlayPotCount(freeWithClassic, 0);
			return result.ok && result.notes;
		})(),
		potsOverlayOf(added(setOverlayPotCount(freeToCoins, 1)))!.drops.maxPerSpin,
	],
	[
		[
			'Removed gold. What is authored for it elsewhere (a Pot Meter, a Win Text name, a flight style) is kept and draws nothing until a pot with that id returns.',
			'Most per spin raised from 2 to 8, so the 6 coins the Hold and Win trigger needs can land on one spin. Lower it again if you add pots back.',
		],
		8,
	],
);
check(
	'lowering the count names the pots it removed; raising it says nothing',
	[
		(() => {
			const result = setOverlayPotCount(five, 3);
			return (
				result.ok &&
				result.notes?.[0]?.startsWith('Removed gold, purple. What is authored for them')
			);
		})(),
		(() => {
			const result = setOverlayPotCount(three, 5);
			return result.ok && result.notes;
		})(),
	],
	[true, undefined],
);
check(
	"zeroPotsRefusal: the one rule the count and the last pot's × share",
	[
		zeroPotsRefusal(three),
		zeroPotsRefusal(freeOverlay)?.startsWith('With no pots'),
		zeroPotsRefusal(added(onPotsGame))?.startsWith("This game's own Hold and Win"),
		zeroPotsRefusal(added(addHoldAndWinBonus(freeOverlay, 'collector')))?.startsWith(
			'Value coins start this Hold and Win only through its coin count trigger',
		),
	],
	[undefined, true, true, true],
);
const coinRoleGold = clone(three);
coinRoleGold.symbols.POT_GOLD = { special_properties: ['coin', 'meterSpecial'] };
check(
	'a Hold and Win role symbol named like a new token is never taken over',
	potsOverlayOf(added(setOverlayPotCount(coinRoleGold, 4)))!.pots[3].token,
	'POT_GOLD_2',
);
check(
	'0 pots on a bonus with no coin count trigger is refused',
	refused(setOverlayPotCount(added(addHoldAndWinBonus(freeOverlay, 'collector')), 0)),
	'Value coins start this Hold and Win only through its coin count trigger, which it does not set — set one in the Coin overlay triggers first, or keep at least one pot.',
);
const goldTaken = clone(three);
goldTaken.symbols.POT_GOLD = { paytable: [{ '3': 1 }] };
check(
	'a new pot whose token name is taken gets a suffix, and the result says so',
	(() => {
		const result = setOverlayPotCount(goldTaken, 4);
		return result.ok && [potsOverlayOf(result.doc)!.pots[3].token, result.renamed.symbols];
	})(),
	['POT_GOLD_2', { POT_GOLD: 'POT_GOLD_2' }],
);
check(
	'a rename the merge made is dropped when the count cut what it named',
	(() => {
		const result = addPotsOverlay(crowded, 'threePots', 0);
		return result.ok && result.renamed;
	})(),
	{ symbols: { BONUS: 'BONUS_2' }, pots: {} },
);
check(
	"on a 3 Pots Hold and Win game, new pots skip the meters' ids and specials",
	potRows(added(setOverlayPotCount(added(onPotsGame), 5))).slice(3),
	[
		['gold', 'POT_GOLD', 'holdAndWin', 'mystery'],
		['purple', 'POT_PURPLE', 'holdAndWin', '-'],
	],
);

console.log(failures === 0 ? '\nAll add-on assertions passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
