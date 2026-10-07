/**
 * The BOOK OF THERMOPYLAE preset — the captured partner game every Book-of title is a copy of
 * (`docs/design/book-feature.md` §3.5), as a lines config with the expanding special switched on.
 *
 * The numbers are the captured ones the book mock deals (`BOOK_OF_THERMOPYLAE` in
 * `scripts/mock-rgs-server-book.mjs`), restated in the project's own symbol names through
 * `bookMapping` (PIC1–PIC4 → H1–H4, ACE…TEN → L1–L5, SCAT → S). `check:book-preset` holds the two
 * equal, so a capture fixed in one place cannot drift from the other.
 *
 * Two values are owner decisions, not captures (§8): the book PAYS its scatter row (decision 1; the
 * book mock still pays it nothing until Phase 3), and the book is a wild (decision 2). The RTP is a
 * placeholder: the partner's math decides it.
 *
 * Built on call, like the pots-overlay presets, so a game bundle never carries it.
 */

import type { GameConfigSymbol, Paylines, RawGameConfig, ReelStrip } from './types';

/** `{ count: pays }` as the dictionary's single-entry rows, ascending. */
const pays = (table: Record<number, number>): GameConfigSymbol => ({
	paytable: Object.entries(table).map(([count, pay]) => ({ [count]: pay })),
});

/** The ten captured paylines, in the order the server declares them. */
const PAYLINES: number[][] = [
	[1, 1, 1, 1, 1],
	[0, 0, 0, 0, 0],
	[2, 2, 2, 2, 2],
	[0, 1, 2, 1, 0],
	[2, 1, 0, 1, 2],
	[0, 0, 1, 2, 2],
	[2, 2, 1, 0, 0],
	[1, 2, 2, 2, 1],
	[1, 0, 0, 0, 1],
	[1, 0, 1, 2, 1],
];

/** Every symbol on every reel: the strips are cosmetic for a server-dealt game, and the gate. */
const STRIP_SYMBOLS = ['H1', 'L1', 'S', 'L2', 'H2', 'L3', 'H3', 'L4', 'H4', 'L5'];
const strip = (): ReelStrip => STRIP_SYMBOLS.map((name) => ({ name }));

const MAX_WIN = 10000;

/** A fresh copy of the Book of Thermopylae config. */
export const bookOfThermopylaePreset = (): RawGameConfig => ({
	providerName: 'invisible_wall',
	gameName: 'book_of_thermopylae',
	gameID: 'book_of_thermopylae',
	rtp: 0.96,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	betModes: {
		base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: MAX_WIN },
		bonus: { cost: 100, feature: false, buyBonus: true, rtp: 0.96, max_win: MAX_WIN },
	},
	paylines: Object.fromEntries(PAYLINES.map((line, i) => [String(i + 1), line])) as Paylines,
	symbols: {
		H1: pays({ 2: 10, 3: 100, 4: 1000, 5: 5000 }),
		H2: pays({ 2: 10, 3: 30, 4: 400, 5: 2000 }),
		H3: pays({ 2: 5, 3: 30, 4: 100, 5: 750 }),
		H4: pays({ 2: 5, 3: 20, 4: 100, 5: 750 }),
		L1: pays({ 3: 5, 4: 50, 5: 150 }),
		L2: pays({ 3: 5, 4: 50, 5: 150 }),
		L3: pays({ 3: 5, 4: 20, 5: 100 }),
		L4: pays({ 3: 5, 4: 20, 5: 100 }),
		L5: pays({ 3: 5, 4: 20, 5: 100 }),
		S: { ...pays({ 3: 2, 4: 20, 5: 200 }), special_properties: ['scatter', 'wild'] },
	},
	paddingReels: {
		basegame: Array.from({ length: 5 }, strip),
		freegame: Array.from({ length: 5 }, strip),
	},
	freeSpins: {
		retriggerAwards: [{ count: 3, spins: 10 }],
		expandingSymbol: {
			weights: {
				H1: 0.09,
				H2: 0.09,
				H3: 0.09,
				H4: 0.095,
				L1: 0.095,
				L2: 0.095,
				L3: 0.11,
				L4: 0.14,
				L5: 0.195,
			},
			minReels: { H1: 2 },
		},
	},
});
