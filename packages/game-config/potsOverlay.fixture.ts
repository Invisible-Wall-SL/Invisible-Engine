/**
 * Offline fixture for the POTS OVERLAY block and its presets (`docs/design/pots-overlay.md` §3.1).
 *   pnpm check:all --only potsOverlay.fixture
 *
 * Pins: a config without the block is untouched (every committed default included); the block is
 * sparse and a normalize fixed point; the validator names every impossible overlay; `resolveMeters`
 * lists the Hold and Win meters, then the pots; every preset validates clean once merged into a
 * book-like host of any width without replacing any of it (coins only: no pots, the Classic bonus),
 * and a Hold and Win game may add pots;
 * a `holdAndWin` block is the overlay's bonus or the base game by what the base strips deal; and
 * without the block every Hold and Win preset validates exactly as before.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGameConfigDoc } from './src/normalize.ts';
import { validateGameConfigDoc } from './src/validate.ts';
import { holdAndWinIsOverlayBonus, validateHoldAndWin } from './src/holdAndWin.ts';
import {
	HOLD_AND_WIN_PRESETS,
	HOLD_AND_WIN_PRESET_IDS,
	HOLD_AND_WIN_TEST_FIXTURES,
} from './src/holdAndWinPresets.ts';
import {
	normalizePotsOverlay,
	overlayDropModes,
	resolveMeters,
	validatePotsOverlay,
} from './src/potsOverlay.ts';
import {
	POTS_OVERLAY_PRESET_IDS,
	holdAndWinBonus,
	potsOverlayPreset,
	type PotsOverlayPresetId,
} from './src/potsOverlayPresets.ts';
import { symbolsInPlay } from './src/inPlay.ts';
import type { GameConfigDoc, GameConfigSymbol, RawGameConfig } from './src/types.ts';

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

const edit = (base: GameConfigDoc, change: (doc: GameConfigDoc) => void): GameConfigDoc => {
	const doc = clone(base);
	change(doc);
	return normalize(doc);
};

const issuesUnder = (doc: GameConfigDoc, prefix: string): string[] =>
	validateGameConfigDoc(doc)
		.filter((i) => i.path.startsWith(prefix))
		.map((i) => `${i.severity}:${i.path}`);

const overlayIssues = (doc: GameConfigDoc) => issuesUnder(doc, 'potsOverlay');

const holdAndWinIssues = (doc: GameConfigDoc) =>
	validateHoldAndWin(doc).map((i) => `${i.severity}:${i.path}`);

/** A Book of Borut-shaped host: N×3 lines, a scatter book, its own free-spin strips. */
const pays = (three: number, four: number, five: number): GameConfigSymbol => ({
	paytable: [{ '3': three }, { '4': four }, { '5': five }],
});
const BOOK_STRIP = ['PIC1', 'ACE', 'SCAT', 'KING', 'PIC2', 'TEN'].map((name) => ({ name }));
const bookHost = (numReels: number): RawGameConfig => ({
	providerName: 'invisible_wall',
	gameName: 'book_host',
	gameID: 'book_host',
	rtp: 0.96,
	numReels,
	numRows: Array.from({ length: numReels }, () => 3),
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 } },
	paylines: Object.fromEntries(
		[1, 0, 2].map((row, i) => [String(i + 1), Array.from({ length: numReels }, () => row)]),
	),
	symbols: {
		PIC1: pays(100, 1000, 5000),
		PIC2: pays(30, 400, 2000),
		ACE: pays(5, 50, 150),
		KING: pays(5, 50, 150),
		TEN: pays(5, 20, 100),
		SCAT: { special_properties: ['scatter'] },
	},
	paddingReels: {
		basegame: Array.from({ length: numReels }, () => BOOK_STRIP),
		freegame: Array.from({ length: numReels }, () => BOOK_STRIP),
	},
});
const BOOK_HOST = bookHost(5);

/** Merge a preset into a host the way an "add" does: the host keeps everything it has, and a Hold
 *  and Win game keeps its own block rather than gaining the preset's bonus. */
const insert = (host: RawGameConfig, id: PotsOverlayPresetId): GameConfigDoc => {
	const preset = potsOverlayPreset(id);
	const bonus =
		preset.holdAndWin && !host.holdAndWin ? holdAndWinBonus(preset.holdAndWin, host) : undefined;
	return normalize({
		...clone(host),
		symbols: { ...host.symbols, ...bonus?.symbols, ...preset.tokens },
		paddingReels: { ...host.paddingReels, ...bonus?.paddingReels },
		...(bonus && { holdAndWin: bonus.holdAndWin }),
		potsOverlay: preset.potsOverlay,
	});
};

const host = normalize(BOOK_HOST);
const three = insert(BOOK_HOST, 'threePots');
const free = insert(BOOK_HOST, 'potsToFreeSpins');
const coins = insert(BOOK_HOST, 'coinsOnly');

console.log('\n1. absent ⇒ absent');
check('the host validates clean on its own', validateGameConfigDoc(host), []);
check('the host stores no potsOverlay key', 'potsOverlay' in host, false);
for (const raw of [undefined, null, 'x', [], {}, { pots: [], drops: {} }, { pots: ['junk'] }]) {
	check(`${JSON.stringify(raw)} is no block`, normalizePotsOverlay(raw), undefined);
}
check(
	'an empty block on a doc stores no key',
	'potsOverlay' in normalize({ ...clone(BOOK_HOST), potsOverlay: { pots: [], drops: {} } }),
	false,
);
check('no block, no meters', resolveMeters(host), []);
check('no doc, no meters', resolveMeters(undefined), []);
check('no block, no overlay issues', validatePotsOverlay(host), []);
const DEFAULTS = join(
	dirname(fileURLToPath(import.meta.url)),
	'../../apps/launcher-api/src/lib/data/gameConfig',
);
for (const name of readdirSync(DEFAULTS).filter((n: string) => n.endsWith('.json'))) {
	const doc = normalize(JSON.parse(readFileSync(join(DEFAULTS, name), 'utf8')));
	check(`${name} stores no potsOverlay block`, 'potsOverlay' in doc, false);
}

console.log('\n2. normalize — structural, sparse, a fixed point');
const lax = normalizePotsOverlay({
	pots: [
		{
			id: ' red ',
			token: 'POT_RED',
			maxLevel: 12,
			sizeStages: [9, 5, 5, 0, 'x', 2.5],
			bonus: { mode: 'holdAndWin', activates: 'payer', extra: 1 },
			label: 'Red',
			junk: true,
		},
		{
			id: 'blue',
			token: 'POT_BLUE',
			maxLevel: 0,
			bonus: { mode: 'freeSpins', activates: 'nonsense', spins: 2.5 },
		},
		{ id: 'noToken', maxLevel: 3, bonus: { mode: 'freeSpins' } },
		{ id: 'noBonus', token: 'X', maxLevel: 3 },
		{ id: 'noMode', token: 'X', maxLevel: 3, bonus: {} },
		{ id: 'noLevel', token: 'X', bonus: { mode: 'freeSpins' } },
		'junk',
	],
	drops: {
		chance: 0.2,
		maxPerSpin: 3,
		table: [
			{ pot: 'red' },
			{ coin: true, weight: 2 },
			{ pot: 'blue', weight: 0 },
			{ coin: true, pot: 'red', weight: 1 },
			{ weight: 1 },
			{ pot: 'red', weight: 'x' },
			'junk',
		],
		reels: [3, 1, 3, -1, 1.5],
		modes: ['basegame'],
	},
});
check(
	'unreadable pots and entries dropped; wrong values kept for the validator; defaults not stored',
	lax,
	{
		pots: [
			{
				id: 'red',
				token: 'POT_RED',
				maxLevel: 12,
				sizeStages: [5, 9],
				bonus: { mode: 'holdAndWin', activates: 'payer' },
				label: 'Red',
			},
			{
				id: 'blue',
				token: 'POT_BLUE',
				maxLevel: 0,
				sizeStages: [],
				bonus: { mode: 'freeSpins', spins: 2.5 },
			},
		],
		drops: {
			chance: 0.2,
			maxPerSpin: 3,
			table: [
				{ pot: 'red', weight: 1 },
				{ coin: true, weight: 2 },
				{ pot: 'blue', weight: 0 },
				{ coin: true, weight: 1 },
			],
			reels: [1, 3],
		},
	},
);
check('re-normalizing is a fixed point', normalizePotsOverlay(clone(lax)), lax);
check('absent dropping modes read as the base game', overlayDropModes(lax!.drops), ['basegame']);
const onePot = { id: 'gold', token: 'POT_GOLD', maxLevel: 3, bonus: { mode: 'freeSpins' } };
check('a missing drops block fills readable defaults', normalizePotsOverlay({ pots: [onePot] }), {
	pots: [
		{ id: 'gold', token: 'POT_GOLD', maxLevel: 3, sizeStages: [], bonus: { mode: 'freeSpins' } },
	],
	drops: { chance: 0.1, maxPerSpin: 1, table: [] },
});
const departs = normalizePotsOverlay({
	pots: [onePot],
	drops: { table: [{ pot: 'gold' }], modes: ['basegame', 'freeSpins', 'freeSpins', ''], reels: [] },
})!.drops;
check('departing modes are stored once each; an empty reel list is kept as authored', departs, {
	chance: 0.1,
	maxPerSpin: 1,
	table: [{ pot: 'gold', weight: 1 }],
	reels: [],
	modes: ['basegame', 'freeSpins'],
});
check('stored modes read back as written', overlayDropModes(departs), ['basegame', 'freeSpins']);
const authoredLists = (reels: unknown, modes: unknown) =>
	normalizePotsOverlay({ pots: [onePot], drops: { table: [{ pot: 'gold' }], reels, modes } })!
		.drops;
check(
	'an every-reel list and an empty mode list are stored; an absent one is not',
	[authoredLists([4, 0, 1, 2, 3], []), authoredLists(undefined, undefined)],
	[
		{
			chance: 0.1,
			maxPerSpin: 1,
			table: [{ pot: 'gold', weight: 1 }],
			reels: [0, 1, 2, 3, 4],
			modes: [],
		},
		{ chance: 0.1, maxPerSpin: 1, table: [{ pot: 'gold', weight: 1 }] },
	],
);
check('a whole overlay doc is a fixed point', normalize(clone(three)), three);
check(
	'timing: per reel is stored; after the stop (the default) and anything unread are not',
	['perReel', 'afterStop', 'sideways', undefined].map(
		(timing) => normalizePotsOverlay({ pots: [onePot], timing })!.timing,
	),
	['perReel', undefined, undefined, undefined],
);

console.log('\n3. validate — every rule, both ways');
check('3 Pots on the host is clean', validateGameConfigDoc(three), []);
check('pots to free spins on the host is clean', validateGameConfigDoc(free), []);
check(
	'no pots and no value coins; value coins with no pots are fine',
	[
		overlayIssues(
			edit(three, (d) => {
				d.potsOverlay!.pots = [];
				d.potsOverlay!.drops.table = [{ pot: 'red', weight: 1 }];
			}),
		),
		overlayIssues(
			edit(three, (d) => {
				d.potsOverlay!.pots = [];
				d.potsOverlay!.drops.table = [{ coin: true, weight: 1 }];
			}),
		),
	],
	[['error:potsOverlay.pots', 'error:potsOverlay.drops.table.0.pot'], []],
);
check(
	'more than five pots',
	overlayIssues(
		edit(three, (d) => {
			for (const id of ['gold', 'purple', 'pink']) {
				d.symbols[`POT_${id.toUpperCase()}`] = { special_properties: ['meterSpecial'] };
				d.potsOverlay!.pots.push({
					id,
					token: `POT_${id.toUpperCase()}`,
					maxLevel: 12,
					sizeStages: [],
					bonus: { mode: 'holdAndWin' },
				});
				d.potsOverlay!.drops.table.push({ pot: id, weight: 1 });
			}
		}),
	),
	['error:potsOverlay.pots'],
);
check(
	'a pot id that cannot be an anchor',
	overlayIssues(
		edit(three, (d) => {
			d.potsOverlay!.pots[0].id = 'red.pot';
			d.potsOverlay!.drops.table[0] = { pot: 'red.pot', weight: 2 };
		}),
	),
	['error:potsOverlay.pots.0.id'],
);
check(
	'a pot listed twice',
	overlayIssues(
		edit(three, (d) => {
			d.potsOverlay!.pots[1].id = 'red';
			d.potsOverlay!.drops.table[1] = { pot: 'red', weight: 2 };
		}),
	),
	['error:potsOverlay.pots.1.id'],
);
const meter = { symbol: 'BOOST', maxLevel: 12, sizeStages: [5, 9], activates: 'payer' as const };
check(
	'a pot id that is also a Hold and Win meter',
	overlayIssues(edit(three, (d) => (d.holdAndWin!.meters = [{ id: 'red', ...meter }]))),
	['error:potsOverlay.pots.0.id'],
);
check(
	'...and none once the meter has its own id',
	overlayIssues(edit(three, (d) => (d.holdAndWin!.meters = [{ id: 'purple', ...meter }]))),
	[],
);
check(
	'a token missing from the dictionary',
	overlayIssues(edit(three, (d) => (d.potsOverlay!.pots[0].token = 'POT_NOPE'))),
	['error:potsOverlay.pots.0.token'],
);
check(
	'a token not tagged meterSpecial warns',
	overlayIssues(edit(three, (d) => (d.symbols.POT_RED = {}))),
	['warning:potsOverlay.pots.0.token'],
);
check(
	'a token on a base strip',
	overlayIssues(edit(three, (d) => d.paddingReels.basegame[0].push({ name: 'POT_RED' }))),
	// …which also makes the block the base game, so the dropped coins count for nothing.
	['error:potsOverlay.pots.0.token', 'warning:potsOverlay.drops.table.3'],
);
check(
	'a token on the respin strips',
	overlayIssues(edit(three, (d) => d.paddingReels.respin[2].push({ name: 'POT_GREEN' }))),
	['error:potsOverlay.pots.2.token'],
);
check(
	'two pots sharing a token warns',
	overlayIssues(edit(three, (d) => (d.potsOverlay!.pots[1].token = 'POT_RED'))),
	['warning:potsOverlay.pots.1.token'],
);
check(
	'a maximum level of 0, or of 2.5',
	[0, 2.5].map((maxLevel) =>
		overlayIssues(edit(three, (d) => (d.potsOverlay!.pots[0].maxLevel = maxLevel))),
	),
	[['error:potsOverlay.pots.0.maxLevel'], ['error:potsOverlay.pots.0.maxLevel']],
);
check(
	'a size stage at the maximum level; one below it is fine',
	[
		[5, 12],
		[5, 11],
	].map((stages) =>
		overlayIssues(edit(three, (d) => (d.potsOverlay!.pots[0].sizeStages = stages))),
	),
	[['error:potsOverlay.pots.0.sizeStages'], []],
);
check(
	'a pot starting the base game',
	overlayIssues(edit(free, (d) => (d.potsOverlay!.pots[0].bonus = { mode: 'basegame' }))),
	['error:potsOverlay.pots.0.bonus.mode'],
);
check(
	'a pot starting a mode the project does not have; fine once it does',
	[undefined, [{ id: 'wheel', board: 'wheel' as const }]].map((modes) =>
		overlayIssues(
			edit(free, (d) => {
				d.potsOverlay!.pots[0].bonus = { mode: 'wheel' };
				if (modes) d.modes = modes;
			}),
		),
	),
	[['error:potsOverlay.pots.0.bonus.mode'], []],
);
check(
	'a Hold and Win bonus with no holdAndWin block',
	overlayIssues(edit(free, (d) => (d.potsOverlay!.pots[0].bonus = { mode: 'holdAndWin' }))),
	['error:potsOverlay.pots.0.bonus.mode'],
);
check(
	'activates on a bonus that is not Hold and Win',
	overlayIssues(edit(free, (d) => (d.potsOverlay!.pots[0].bonus.activates = 'payer'))),
	['error:potsOverlay.pots.0.bonus.activates'],
);
check(
	'activates naming a special the Hold and Win block does not configure',
	overlayIssues(edit(three, (d) => (d.potsOverlay!.pots[0].bonus.activates = 'upgrade'))),
	['error:potsOverlay.pots.0.bonus.activates'],
);
check(
	'a spin count on the respin board',
	overlayIssues(edit(three, (d) => (d.potsOverlay!.pots[0].bonus.spins = 5))),
	['error:potsOverlay.pots.0.bonus.spins'],
);
check(
	'a spin count of 2.5, or of 0',
	[2.5, 0].map((spins) =>
		overlayIssues(edit(free, (d) => (d.potsOverlay!.pots[0].bonus.spins = spins))),
	),
	[['error:potsOverlay.pots.0.bonus.spins'], ['error:potsOverlay.pots.0.bonus.spins']],
);
check(
	"a spin count on the project's own reels mode is fine; on its own wheel it is not",
	(['reels', 'wheel'] as const).map((board) =>
		overlayIssues(
			edit(free, (d) => {
				d.modes = [{ id: 'superSpins', board, gameType: 'freegame' }];
				d.potsOverlay!.pots[0].bonus = { mode: 'superSpins', spins: 5 };
			}),
		),
	),
	[[], ['error:potsOverlay.pots.0.bonus.spins']],
);
check(
	'a drop chance of 0 or 1.5 is refused; 1 is every spin',
	[0, 1.5, 1].map((chance) =>
		overlayIssues(edit(free, (d) => (d.potsOverlay!.drops.chance = chance))),
	),
	[['error:potsOverlay.drops.chance'], ['error:potsOverlay.drops.chance'], []],
);
check(
	'at most 0, or 2.5, drops per spin',
	[0, 2.5].map((most) =>
		overlayIssues(edit(three, (d) => (d.potsOverlay!.drops.maxPerSpin = most))),
	),
	[['error:potsOverlay.drops.maxPerSpin'], ['error:potsOverlay.drops.maxPerSpin']],
);
check(
	'an empty drop table — and then no pot ever fills',
	overlayIssues(edit(three, (d) => (d.potsOverlay!.drops.table = []))),
	[
		'error:potsOverlay.drops.table',
		'warning:potsOverlay.pots.0',
		'warning:potsOverlay.pots.1',
		'warning:potsOverlay.pots.2',
	],
);
check(
	'a drop weighing 0, or less',
	[0, -1].map((weight) =>
		overlayIssues(edit(three, (d) => (d.potsOverlay!.drops.table[3].weight = weight))),
	),
	[['error:potsOverlay.drops.table.3.weight'], ['error:potsOverlay.drops.table.3.weight']],
);
check(
	'a drop naming a pot that does not exist',
	overlayIssues(edit(three, (d) => (d.potsOverlay!.drops.table[0] = { pot: 'purple', weight: 2 }))),
	['error:potsOverlay.drops.table.0.pot', 'warning:potsOverlay.pots.0'],
);
check(
	'a value coin with no holdAndWin block',
	overlayIssues(edit(free, (d) => d.potsOverlay!.drops.table.push({ coin: true, weight: 1 }))),
	['error:potsOverlay.drops.table.1'],
);
check(
	'a value coin with an empty Hold and Win coin table',
	overlayIssues(edit(three, (d) => (d.holdAndWin!.coins = []))),
	['error:potsOverlay.drops.table.3'],
);
check(
	'a value coin with no count trigger to start warns',
	overlayIssues(edit(three, (d) => delete d.holdAndWin!.trigger.count)),
	['warning:potsOverlay.drops.table.3'],
);
check(
	'tokens on a reel off the grid; on the last reel is fine',
	[
		[0, 5],
		[0, 4],
	].map((reels) => overlayIssues(edit(three, (d) => (d.potsOverlay!.drops.reels = reels)))),
	[['error:potsOverlay.drops.reels'], []],
);
check(
	'drops in a mode the project does not have, or off the reels; in free spins is fine',
	[
		['basegame', 'bonusWheel'],
		['basegame', 'holdAndWin'],
		['basegame', 'freeSpins'],
	].map((modes) => overlayIssues(edit(three, (d) => (d.potsOverlay!.drops.modes = modes)))),
	[['error:potsOverlay.drops.modes'], ['error:potsOverlay.drops.modes'], []],
);
check(
	'a pot that starts free spins while tokens drop in free spins can chain without end (a warning)',
	[
		overlayIssues(edit(free, (d) => (d.potsOverlay!.drops.modes = ['basegame', 'freeSpins']))),
		overlayIssues(edit(three, (d) => (d.potsOverlay!.drops.modes = ['basegame', 'freeSpins']))),
	],
	[['warning:potsOverlay.pots.0.bonus.mode'], []],
);
check(
	'an authored empty reel list, or mode list, drops nothing',
	[
		overlayIssues(edit(three, (d) => (d.potsOverlay!.drops.reels = []))),
		overlayIssues(edit(three, (d) => (d.potsOverlay!.drops.modes = []))),
	],
	[['error:potsOverlay.drops.reels'], ['error:potsOverlay.drops.modes']],
);
check(
	'a pot no drop fills warns',
	overlayIssues(
		edit(three, (d) => (d.potsOverlay!.drops.table = d.potsOverlay!.drops.table.slice(1))),
	),
	['warning:potsOverlay.pots.0'],
);
check(
	'fewer drops per spin than the coin trigger counts warns; without coins it does not',
	[
		overlayIssues(edit(three, (d) => (d.potsOverlay!.drops.maxPerSpin = 5))),
		overlayIssues(edit(free, (d) => (d.potsOverlay!.drops.maxPerSpin = 1))),
	],
	[['warning:potsOverlay.drops.maxPerSpin'], []],
);

console.log('\n4. resolveMeters — the Hold and Win meters, then the pots');
const potsGame = normalize(HOLD_AND_WIN_PRESETS.pots);
check(
	'a Hold and Win game: its symbol-filled meters',
	resolveMeters(potsGame).map((m) => `${m.id}:${m.source}:${m.symbol}→${m.bonus.activates}`),
	['red:symbol:BOOST→payer', 'blue:symbol:COLLECT→collector', 'green:symbol:MULTI→multiplier'],
);
const toFree = potsOverlayPreset('potsToFreeSpins');
const both = normalize({
	...clone(HOLD_AND_WIN_PRESETS.pots),
	symbols: { ...HOLD_AND_WIN_PRESETS.pots.symbols, ...toFree.tokens },
	potsOverlay: {
		...toFree.potsOverlay,
		pots: [{ ...toFree.potsOverlay.pots[0], label: 'Gold pot' }],
	},
});
check('both lists, one shape, meters first', resolveMeters(both), [
	{
		id: 'red',
		source: 'symbol',
		symbol: 'BOOST',
		maxLevel: 12,
		sizeStages: [5, 9],
		bonus: { mode: 'holdAndWin', activates: 'payer' },
	},
	{
		id: 'blue',
		source: 'symbol',
		symbol: 'COLLECT',
		maxLevel: 12,
		sizeStages: [5, 9],
		bonus: { mode: 'holdAndWin', activates: 'collector' },
	},
	{
		id: 'green',
		source: 'symbol',
		symbol: 'MULTI',
		maxLevel: 12,
		sizeStages: [5, 9],
		bonus: { mode: 'holdAndWin', activates: 'multiplier' },
	},
	{
		id: 'gold',
		source: 'overlay',
		symbol: 'POT_GOLD',
		maxLevel: 12,
		sizeStages: [5, 9],
		bonus: { mode: 'freeSpins', spins: 10 },
		label: 'Gold pot',
	},
]);
check(
	'the whole doc validates clean: a Hold and Win game may add an overlay',
	validateGameConfigDoc(both),
	[],
);
const resolved = resolveMeters(both);
resolved[0].sizeStages.push(99);
resolved[3].bonus.spins = 99;
check(
	'resolved meters are copies, never the doc',
	[both.holdAndWin!.meters![0].sizeStages, both.potsOverlay!.pots[0].bonus.spins],
	[[5, 9], 10],
);

console.log('\n5. presets — merged into a book host, clean, nothing of the host replaced');
for (const id of POTS_OVERLAY_PRESET_IDS) {
	const preset = potsOverlayPreset(id);
	const doc = insert(BOOK_HOST, id);
	check(`${id}: no issues at all`, validateGameConfigDoc(doc), []);
	check(`${id}: re-normalizing is a fixed point`, normalize(clone(doc)), doc);
	check(`${id}: the block round-trips unchanged`, doc.potsOverlay, preset.potsOverlay);
	check(
		`${id}: every token pays nothing, is tagged meterSpecial and is on no strip`,
		doc.potsOverlay!.pots.map((p) => [doc.symbols[p.token], symbolsInPlay(doc).includes(p.token)]),
		doc.potsOverlay!.pots.map(() => [{ special_properties: ['meterSpecial'] }, false]),
	);
	check(
		`${id}: the host's symbols and strips are untouched`,
		[
			Object.fromEntries(Object.keys(host.symbols).map((name) => [name, doc.symbols[name]])),
			doc.paddingReels.basegame,
			doc.paddingReels.freegame,
		],
		[host.symbols, host.paddingReels.basegame, host.paddingReels.freegame],
	);
}
const potsMeters = HOLD_AND_WIN_PRESETS.pots.holdAndWin!.meters!;
check(
	'3 Pots: red/blue/green → Hold and Win with payer/collector/multiplier',
	three.potsOverlay!.pots.map((p) => `${p.id}:${p.token}:${p.bonus.mode}+${p.bonus.activates}`),
	[
		'red:POT_RED:holdAndWin+payer',
		'blue:POT_BLUE:holdAndWin+collector',
		'green:POT_GREEN:holdAndWin+multiplier',
	],
);
check(
	'3 Pots: levels and size stages are the Hold and Win preset meters',
	three.potsOverlay!.pots.map((p) => [p.maxLevel, p.sizeStages]),
	potsMeters.map((m) => [m.maxLevel, m.sizeStages]),
);
check(
	'3 Pots: the three pots and value coins drop, in the base game only',
	[
		three.potsOverlay!.drops.table.map((e) => ('coin' in e ? 'coin' : e.pot)),
		overlayDropModes(three.potsOverlay!.drops),
		'modes' in three.potsOverlay!.drops,
	],
	[['red', 'blue', 'green', 'coin'], ['basegame'], false],
);
check(
	'3 Pots: enough drops per spin for the coin trigger',
	three.potsOverlay!.drops.maxPerSpin >= three.holdAndWin!.trigger.count!.min,
	true,
);
const { meters: _meters, ...potsBlock } = clone(HOLD_AND_WIN_PRESETS.pots.holdAndWin!);
check(
	'3 Pots: its bonus is the 3 Pots Hold and Win, minus the lucky spin and the symbol meters',
	three.holdAndWin,
	{ ...potsBlock, trigger: { count: potsBlock.trigger.count } },
);
check(
	"3 Pots: the bonus symbols are the respin board's, meterSpecial dropped",
	holdAndWinBonus('pots', BOOK_HOST).symbols,
	{
		BLANK: { special_properties: ['blank'] },
		BONUS: { special_properties: ['coin'] },
		BOOST: { special_properties: ['payer'] },
		COLLECT: { special_properties: ['collector'] },
		JACKPOT: { special_properties: ['jackpot'] },
		MULTI: { special_properties: ['coinMultiplier'] },
		MYSTERY: { special_properties: ['mystery'] },
	},
);
check(
	'pots to free spins: one gold pot → 10 free spins, no coins, no Hold and Win',
	[free.potsOverlay!.pots, free.potsOverlay!.drops.table, 'holdAndWin' in free],
	[
		[
			{
				id: 'gold',
				token: 'POT_GOLD',
				maxLevel: 12,
				sizeStages: [5, 9],
				bonus: { mode: 'freeSpins', spins: 10 },
			},
		],
		[{ pot: 'gold', weight: 1 }],
		false,
	],
);
check(
	'every Hold and Win preset as a bonus carries none of the refused options',
	HOLD_AND_WIN_PRESET_IDS.map((id) => {
		const { holdAndWin } = holdAndWinBonus(id, BOOK_HOST);
		const { collector, multiplier } = holdAndWin.specials;
		return [
			Object.keys(holdAndWin.trigger),
			Boolean(collector?.instantCollectInBaseGame || multiplier?.instantCollectInBaseGame),
			'meters' in holdAndWin,
		];
	}),
	[
		[['count'], false, false],
		[['count'], false, false],
		[[], false, false],
	],
);
const jade = (
	host: RawGameConfig,
	id: Parameters<typeof holdAndWinBonus>[0],
	drops: unknown[],
): GameConfigDoc => {
	const bonus = holdAndWinBonus(id, host);
	return normalize({
		...clone(host),
		symbols: {
			...host.symbols,
			...bonus.symbols,
			POT_JADE: { special_properties: ['meterSpecial'] },
		},
		paddingReels: { ...host.paddingReels, ...bonus.paddingReels },
		holdAndWin: bonus.holdAndWin,
		potsOverlay: {
			pots: [{ id: 'jade', token: 'POT_JADE', maxLevel: 5, bonus: { mode: 'holdAndWin' } }],
			drops: { chance: 0.1, maxPerSpin: 6, table: [{ pot: 'jade' }, ...drops] },
		},
	});
};
check(
	'the Classic preset as a pot bonus validates clean on the host too',
	validateGameConfigDoc(jade(BOOK_HOST, 'classic', [{ coin: true }])),
	[],
);
const collectorStrips = HOLD_AND_WIN_PRESETS.collector.paddingReels.respin;
const collectorBonus = jade(BOOK_HOST, 'collector', []);
check(
	'the 3×3 collector bonus on a 5-reel host: its strips cycle to five reels, and it validates clean',
	[collectorBonus.paddingReels.respin, validateGameConfigDoc(collectorBonus)],
	[[0, 1, 2, 0, 1].map((reel) => collectorStrips[reel]), []],
);
const wide = insert(bookHost(6), 'threePots');
check(
	'3 Pots on a 6-reel host: six respin strips, and it validates clean',
	[wide.paddingReels.respin.length, validateGameConfigDoc(wide)],
	[6, []],
);
const fresh = potsOverlayPreset('threePots');
fresh.potsOverlay.pots[0].sizeStages.push(11);
fresh.tokens.POT_RED.special_properties!.push('wild');
check(
	'every call builds a fresh preset; editing one touches neither the next nor the Hold and Win preset',
	[
		potsOverlayPreset('threePots').potsOverlay.pots[0].sizeStages,
		potsOverlayPreset('threePots').tokens.POT_RED,
		HOLD_AND_WIN_PRESETS.pots.holdAndWin!.meters![0].sizeStages,
	],
	[[5, 9], { special_properties: ['meterSpecial'] }, [5, 9]],
);
for (const id of HOLD_AND_WIN_PRESET_IDS) {
	const doc = insert(HOLD_AND_WIN_PRESETS[id], 'potsToFreeSpins');
	check(
		`a ${id} Hold and Win game adds pots to free spins: its own block stays the base game, clean`,
		[holdAndWinIsOverlayBonus(doc), validateGameConfigDoc(doc)],
		[false, []],
	);
}
check(
	'3 Pots added to a Hold and Win game names its conflicts: meter ids, specials, a coin trigger',
	HOLD_AND_WIN_PRESET_IDS.map((id) =>
		validateGameConfigDoc(insert(HOLD_AND_WIN_PRESETS[id], 'threePots')).map(
			(i) => `${i.severity}:${i.path}`,
		),
	),
	[
		[
			'error:potsOverlay.pots.0.id',
			'error:potsOverlay.pots.1.id',
			'error:potsOverlay.pots.2.id',
			'warning:potsOverlay.drops.table.3',
		],
		[
			'error:potsOverlay.pots.0.bonus.activates',
			'error:potsOverlay.pots.1.bonus.activates',
			'warning:potsOverlay.drops.table.3',
		],
		[
			'error:potsOverlay.pots.0.bonus.activates',
			'error:potsOverlay.pots.2.bonus.activates',
			'warning:potsOverlay.drops.table.3',
		],
	],
);

console.log('\n6. bonus or base game — decided by what the base strips deal');
const noOverlay = (doc: GameConfigDoc) =>
	edit(doc, (d) => {
		delete d.potsOverlay;
	});
const coinOnBase = (d: GameConfigDoc) => d.paddingReels.basegame[0].push({ name: 'BONUS' });
const ways = (d: GameConfigDoc) => (d.winModel = { type: 'ways', direction: 'ltr', minKind: 3 });
check(
	'the block is the bonus only beside an overlay, while the base strips deal no Hold and Win symbol',
	[
		holdAndWinIsOverlayBonus(three),
		holdAndWinIsOverlayBonus(noOverlay(three)),
		holdAndWinIsOverlayBonus(edit(three, coinOnBase)),
		holdAndWinIsOverlayBonus(both),
	],
	[true, false, false, false],
);
check(
	"the lines-only rule does not apply to an overlay's bonus; it does to a base-game block",
	[
		holdAndWinIssues(edit(three, ways)),
		holdAndWinIssues(noOverlay(edit(three, ways))),
		holdAndWinIssues(
			edit(three, (d) => {
				ways(d);
				coinOnBase(d);
			}),
		),
	],
	[[], ['error:winModel'], ['error:winModel']],
);
const toFreeSpins = (d: GameConfigDoc) =>
	d.potsOverlay!.pots.forEach((p) => (p.bonus = { mode: 'freeSpins' }));
const potsOnly = (d: GameConfigDoc) =>
	(d.potsOverlay!.drops.table = d.potsOverlay!.drops.table.filter((e) => !('coin' in e)));
check(
	'the bonus starts from a pot, or from dropped coins counted by the trigger — nothing else',
	[
		holdAndWinIssues(edit(three, (d) => (d.holdAndWin!.trigger = {}))),
		holdAndWinIssues(edit(three, toFreeSpins)),
		holdAndWinIssues(edit(three, potsOnly)),
		holdAndWinIssues(
			edit(three, (d) => {
				toFreeSpins(d);
				potsOnly(d);
			}),
		),
		holdAndWinIssues(
			edit(three, (d) => {
				toFreeSpins(d);
				d.holdAndWin!.trigger = {};
			}),
		),
	],
	[
		[],
		[],
		['warning:holdAndWin.trigger.count'],
		['error:holdAndWin.trigger', 'warning:holdAndWin.trigger.count'],
		['error:holdAndWin.trigger'],
	],
);
const triggerMessage = (doc: GameConfigDoc) =>
	validateHoldAndWin(doc).find((i) => i.path === 'holdAndWin.trigger')?.message;
const classicWithPot = (route: string) =>
	normalize({
		...clone(HOLD_AND_WIN_PRESETS.classic),
		symbols: {
			...HOLD_AND_WIN_PRESETS.classic.symbols,
			POT_JADE: { special_properties: ['meterSpecial'] },
		},
		holdAndWin: { ...clone(HOLD_AND_WIN_PRESETS.classic.holdAndWin!), trigger: {} },
		potsOverlay: {
			pots: [{ id: 'jade', token: 'POT_JADE', maxLevel: 5, bonus: { mode: route } }],
			drops: { table: [{ pot: 'jade' }] },
		},
	});
check(
	'each block says what starts it there; a base-game block also starts from a pot routed to it',
	[
		triggerMessage(
			edit(three, (d) => {
				toFreeSpins(d);
				d.holdAndWin!.trigger = {};
			}),
		),
		triggerMessage(classicWithPot('freeSpins')),
		holdAndWinIssues(classicWithPot('holdAndWin')),
	],
	[
		'Nothing can start the feature — route a pot to Hold and Win, or drop value coins for the count trigger.',
		'Nothing can start the feature — add a trigger.',
		[],
	],
);
const purpleMeter = (d: GameConfigDoc) => (d.holdAndWin!.meters = [{ id: 'purple', ...meter }]);
check(
	"a bonus's symbol-filled meters are refused and start nothing; a base-game block keeps them",
	[
		holdAndWinIssues(edit(three, purpleMeter)),
		holdAndWinIssues(
			edit(three, (d) => {
				purpleMeter(d);
				toFreeSpins(d);
				potsOnly(d);
				delete d.holdAndWin!.trigger.count;
			}),
		).includes('error:holdAndWin.trigger'),
		holdAndWinIssues(
			edit(three, (d) => {
				purpleMeter(d);
				coinOnBase(d);
			}),
		),
	],
	[
		['error:holdAndWin.meters', 'warning:holdAndWin.meters.0.symbol'],
		true,
		['warning:holdAndWin.meters.0.symbol'],
	],
);
const refusals: Record<string, (d: GameConfigDoc) => void> = {
	'trigger.pattern': (d) =>
		(d.holdAndWin!.trigger.pattern = [{ reel: 0, roles: ['coin'], min: 1 }]),
	'trigger.luckySpin': (d) => (d.holdAndWin!.trigger.luckySpin = true),
	'trigger.randomMetre': (d) => (d.holdAndWin!.trigger.randomMetre = { name: 'Metre' }),
	'trigger.buy': (d) => {
		d.betModes.buy = { cost: 70, feature: false, buyBonus: true, rtp: 0.96, max_win: 5000 };
		d.holdAndWin!.trigger.buy = [{ mode: 'buy', guaranteed: [], boostedSpecials: false }];
	},
	'specials.collector.instantCollectInBaseGame': (d) =>
		(d.holdAndWin!.specials.collector!.instantCollectInBaseGame = true),
	'specials.multiplier.instantCollectInBaseGame': (d) =>
		(d.holdAndWin!.specials.multiplier!.instantCollectInBaseGame = true),
};
for (const [path, change] of Object.entries(refusals)) {
	check(
		`${path} is refused for an overlay's bonus, allowed for a base-game block or without one`,
		[
			holdAndWinIssues(edit(three, change)),
			holdAndWinIssues(
				edit(three, (d) => {
					change(d);
					coinOnBase(d);
				}),
			),
			holdAndWinIssues(noOverlay(edit(three, change))),
		],
		[[`error:holdAndWin.${path}`], [], []],
	);
}
const nothingActive = (d: GameConfigDoc) => {
	d.holdAndWin!.activeModifiers = { atEntry: [], fromTriggeringSpecials: false };
	d.holdAndWin!.applyOrder = d.holdAndWin!.applyOrder.filter((k) => k !== 'mystery');
	delete d.holdAndWin!.specials.mystery;
	delete d.symbols.MYSTERY;
	d.paddingReels.respin = d.paddingReels.respin.map((reel) =>
		reel.filter((s) => s.name !== 'MYSTERY'),
	);
	if (d.holdAndWin!.boardEnd.type === 'fullBoardJackpot') {
		d.holdAndWin!.boardEnd.roles = d.holdAndWin!.boardEnd.roles.filter((r) => r !== 'mystery');
	}
};
check(
	'a pot that activates a special counts as activating one',
	[
		holdAndWinIssues(edit(three, nothingActive)),
		holdAndWinIssues(noOverlay(edit(three, nothingActive))),
	],
	[[], ['warning:holdAndWin.activeModifiers']],
);

console.log('\n6b. coins only — no pots, value coins start a classic Hold and Win');
const coinsBlock = { pots: [], drops: { table: [{ coin: true }] } };
check('normalize keeps a block with value coins and no pots', normalizePotsOverlay(coinsBlock), {
	pots: [],
	drops: { chance: 0.1, maxPerSpin: 1, table: [{ coin: true, weight: 1 }] },
});
check(
	'...on a doc too, a fixed point',
	[
		normalize({ ...clone(BOOK_HOST), potsOverlay: coinsBlock }).potsOverlay,
		normalize(clone(coins)),
	],
	[normalizePotsOverlay(coinsBlock), coins],
);
check(
	'the preset: no pots, no tokens, one coin row, the Classic bonus, enough drops for its trigger',
	[
		coins.potsOverlay,
		Object.keys(coins.symbols).filter((n) => !(n in host.symbols)),
		coins.potsOverlay!.drops.maxPerSpin >= coins.holdAndWin!.trigger.count!.min,
		coins.holdAndWin,
	],
	[
		{ pots: [], drops: { chance: 0.1, maxPerSpin: 8, table: [{ coin: true, weight: 1 }] } },
		Object.keys(holdAndWinBonus('classic', BOOK_HOST).symbols),
		true,
		holdAndWinBonus('classic', BOOK_HOST).holdAndWin,
	],
);
check(
	'the block is the bonus with zero pots; no meters; the dropped coins are its trigger',
	[holdAndWinIsOverlayBonus(coins), resolveMeters(coins), holdAndWinIssues(coins)],
	[true, [], []],
);
check(
	'with no count trigger nothing can start it: an error, and the coins warn',
	[
		holdAndWinIssues(edit(coins, (d) => (d.holdAndWin!.trigger = {}))),
		triggerMessage(edit(coins, (d) => (d.holdAndWin!.trigger = {}))),
		overlayIssues(edit(coins, (d) => (d.holdAndWin!.trigger = {}))),
	],
	[
		['error:holdAndWin.trigger'],
		'Nothing can start the feature — route a pot to Hold and Win, or drop value coins for the count trigger.',
		['warning:potsOverlay.drops.table.0'],
	],
);
check(
	'fewer drops per spin than the trigger counts warns',
	overlayIssues(edit(coins, (d) => (d.potsOverlay!.drops.maxPerSpin = 5))),
	['warning:potsOverlay.drops.maxPerSpin'],
);
check(
	'value coins with no Hold and Win block: an error, and nothing else to drop',
	overlayIssues(
		edit(coins, (d) => {
			delete d.holdAndWin;
			delete d.paddingReels.respin;
		}),
	),
	['error:potsOverlay.drops.table.0'],
);
const coinsOnGame = normalize({
	...clone(HOLD_AND_WIN_PRESETS.classic),
	potsOverlay: { ...coinsBlock, drops: { ...coinsBlock.drops, maxPerSpin: 1 } },
});
check(
	"on a Hold and Win game the block stays its base game: coins alone are one error (as the add refuses), with no per-coin warning beside it (the trigger's count is not compared)",
	[
		holdAndWinIsOverlayBonus(coinsOnGame),
		overlayIssues(coinsOnGame),
		holdAndWinIssues(coinsOnGame),
	],
	[false, ['error:potsOverlay.pots'], []],
);
check(
	'...and one pot beside the coins clears the error',
	overlayIssues(
		edit(coinsOnGame, (d) => {
			d.symbols.POT_GOLD = { special_properties: ['meterSpecial'] };
			d.potsOverlay!.pots = [
				{
					id: 'gold',
					token: 'POT_GOLD',
					maxLevel: 12,
					sizeStages: [5, 9],
					bonus: { mode: 'freeSpins' },
				},
			];
		}),
	).filter((issue) => issue === 'error:potsOverlay.pots'),
	[],
);

console.log('\n7. parity — without the block, Hold and Win validates exactly as before');
const holdAndWinDocs = { ...HOLD_AND_WIN_PRESETS, ...HOLD_AND_WIN_TEST_FIXTURES };
for (const [id, raw] of Object.entries(holdAndWinDocs)) {
	const doc = normalize(raw);
	check(
		`${id}: no overlay, no Hold and Win issue`,
		[validateHoldAndWin(doc), 'potsOverlay' in doc],
		[[], false],
	);
}
const classicGame = normalize(HOLD_AND_WIN_PRESETS.classic);
check(
	'the rules the overlay relaxes still hold without it',
	[
		holdAndWinIssues(edit(potsGame, ways)),
		holdAndWinIssues(edit(classicGame, (d) => (d.holdAndWin!.trigger = {}))),
		holdAndWinIssues(edit(potsGame, (d) => (d.holdAndWin!.trigger = { luckySpin: true }))),
		holdAndWinIssues(
			edit(potsGame, (d) => {
				delete d.holdAndWin!.meters;
				nothingActive(d);
			}),
		),
	],
	[['error:winModel'], ['error:holdAndWin.trigger'], [], ['warning:holdAndWin.activeModifiers']],
);
check(
	'a dictionary symbol on no strip still warns without the overlay',
	issuesUnder(
		normalize({ ...clone(BOOK_HOST), symbols: { ...BOOK_HOST.symbols, POT_RED: {} } }),
		'symbols',
	),
	['warning:symbols.POT_RED'],
);
check(
	'a token that advertises a payout still warns with it',
	issuesUnder(
		edit(free, (d) => (d.symbols.POT_GOLD = { ...d.symbols.POT_GOLD, ...pays(1, 2, 3) })),
		'symbols',
	),
	['warning:symbols.POT_GOLD.paytable'],
);

console.log(failures === 0 ? '\nAll pots overlay assertions passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
