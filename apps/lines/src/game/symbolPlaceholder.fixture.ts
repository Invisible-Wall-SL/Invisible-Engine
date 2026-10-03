/**
 * Offline fixture for the ADD-ON SYMBOL PLACEHOLDER — what a pot token or a Hold and Win coin draws
 * while it has no art bound in `/symbols`.
 *
 *   pnpm check:all --only symbolPlaceholder
 *
 * Pins: each overlay pot's token takes its pot's colour and name; a Hold and Win coin, jackpot and
 * special each have a look, and a coin carries no text because its value label draws over it; a
 * `blank` and every symbol an add-on did not bring get none, so a game without the add-ons draws
 * exactly what it drew before.
 */

import {
	addPotsOverlay,
	normalizeGameConfigDoc,
	setOverlayPotCount,
	type GameConfigDoc,
} from 'game-config';

import { potColour, symbolPlaceholder } from './symbolPlaceholder.ts';

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

const strip = ['H1', 'L1', 'S', 'L2', 'H2'].map((name) => ({ name }));
const host = normalizeGameConfigDoc({
	providerName: 'invisible_wall',
	gameName: 'book_host',
	gameID: 'book_host',
	rtp: 0.96,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 } },
	paylines: { '1': [1, 1, 1, 1, 1] },
	symbols: {
		H1: { paytable: [{ '3': 5 }] },
		H2: { paytable: [{ '3': 5 }] },
		L1: { paytable: [{ '3': 1 }] },
		L2: { paytable: [{ '3': 1 }] },
		S: { special_properties: ['scatter'] },
	},
	paddingReels: { basegame: Array.from({ length: 5 }, () => strip) },
})!;
const added = (result: ReturnType<typeof addPotsOverlay>): GameConfigDoc => {
	if (!result.ok) throw new Error(result.reason);
	return normalizeGameConfigDoc(result.doc)!;
};
const three = added(addPotsOverlay(host, 'threePots'));
const five = added(setOverlayPotCount(three, 5));

console.log('\n1. pot tokens');
check(
	'each token takes its pot colour and name',
	['POT_RED', 'POT_BLUE', 'POT_GREEN'].map((name) => symbolPlaceholder(three, name)),
	[
		{ fill: 0xe0452f, text: 'RED' },
		{ fill: 0x2f7be0, text: 'BLUE' },
		{ fill: 0x3fbf5a, text: 'GREEN' },
	],
);
check(
	'a fourth and fifth pot have their own colours',
	['POT_GOLD', 'POT_PURPLE'].map((name) => symbolPlaceholder(five, name)?.fill),
	[0xe0b030, 0x9a4fe0],
);
check('an unnamed pot takes the palette by position', potColour('pot6', 1), 0x30b0e0);
check('a clash-renamed pot keeps its colour', potColour('red_2', 4), 0xe0452f);

console.log('\n2. Hold and Win coins and specials');
check('a coin is a gold disc with no text', symbolPlaceholder(three, 'BONUS'), {
	fill: 0xe0b030,
	text: '',
});
check(
	'a jackpot and each special have a look',
	['JACKPOT', 'COLLECT', 'BOOST', 'MULTI', 'MYSTERY'].map(
		(name) => symbolPlaceholder(three, name)?.text,
	),
	['', 'COLLECT', 'PAY', 'MULTI', '?'],
);
check('a blank draws nothing', symbolPlaceholder(three, 'BLANK'), undefined);

console.log('\n3. nothing for symbols an add-on did not bring');
check(
	"the host's own symbols, with or without the overlay",
	[symbolPlaceholder(host, 'H1'), symbolPlaceholder(three, 'H1'), symbolPlaceholder(three, 'S')],
	[undefined, undefined, undefined],
);
check('an unknown name', symbolPlaceholder(three, 'NOPE'), undefined);
const noBlock = normalizeGameConfigDoc({
	...host,
	symbols: { ...host.symbols, MYSTERY: { special_properties: ['mystery'] } },
})!;
check(
	'a Hold and Win role without a Hold and Win block',
	symbolPlaceholder(noBlock, 'MYSTERY'),
	undefined,
);

if (failures) throw new Error(`${failures} placeholder assertion(s) FAILED`);
console.log('\nAll placeholder assertions passed.\n');
