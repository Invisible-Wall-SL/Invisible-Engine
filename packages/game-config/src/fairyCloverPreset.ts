/**
 * The FAIRY CLOVER preset — a lines game whose maths starts from Slotmotion's *Fairy's Charm*, the
 * reference the owner chose (`docs/design/expanding-and-growing-wilds.md`), captured in
 * `docs/reference/fairys-charm-capture.json` and restated here in our symbol ids through its
 * `symbolMap` (LEPRICAUHN…BEER_MUG → H1–H5, ACE…TEN → L1–L5, FAIRY → W, CLOVER → CL, SCAT → S).
 * `check:fairy-clover-preset` holds the two equal.
 *
 * 5×4, 50 lines. Line pays are per line bet; the scatter pays 1× the total bet for two. Free spins:
 * two scatters (they sit on reels 1 and 5 only) award 10, and two more during free spins add 10 —
 * a count below 3 that the free-game strips show ends (`retriggerSpinsPerSpin`, about 0.2). The
 * fairy is an expanding wild and the clover a growing one (`docs/design/expanding-and-growing-wilds.md`).
 *
 * NOT the reference's RTP. It draws one of five weighted base reel sets per spin; a config holds one,
 * so `basegame` is the set its boot config declares (the one with the fairy, the clover and the
 * scatter all on it) and `freegame` its one free-spin set. The RTP and the max win are placeholders
 * (the lines template's max win) until someone tunes the maths.
 *
 * Built on call, like the Book of Thermopylae preset, so a game bundle never carries it.
 */

import type { GameConfigSymbol, Paylines, RawGameConfig, ReelStrip } from './types';

/** `{ count: pays }` as the dictionary's single-entry rows, ascending. */
const pays = (table: Record<number, number>): GameConfigSymbol => ({
	paytable: Object.entries(table).map(([count, pay]) => ({ [count]: pay })),
});

/** One strip, top to bottom, as space-separated symbol ids. */
const strip = (cells: string): ReelStrip => cells.split(' ').map((name) => ({ name }));

/** The fifty captured paylines, in the order the server declares them. */
const PAYLINES: number[][] = [
	[0, 0, 0, 0, 0],
	[1, 1, 1, 1, 1],
	[2, 2, 2, 2, 2],
	[3, 3, 3, 3, 3],
	[0, 0, 1, 0, 0],
	[0, 1, 1, 1, 0],
	[0, 1, 2, 1, 0],
	[0, 1, 0, 1, 0],
	[0, 0, 0, 1, 0],
	[0, 1, 0, 0, 0],
	[0, 0, 1, 1, 0],
	[0, 1, 1, 0, 0],
	[0, 0, 2, 0, 0],
	[0, 0, 2, 1, 0],
	[0, 1, 2, 0, 0],
	[1, 1, 2, 1, 1],
	[1, 1, 0, 1, 1],
	[1, 2, 2, 2, 1],
	[1, 0, 0, 0, 1],
	[1, 2, 1, 2, 1],
	[1, 0, 1, 0, 1],
	[1, 1, 1, 2, 1],
	[1, 1, 1, 0, 1],
	[1, 2, 1, 1, 1],
	[1, 0, 1, 1, 1],
	[1, 2, 0, 2, 1],
	[1, 0, 2, 0, 1],
	[2, 2, 3, 2, 2],
	[2, 2, 1, 2, 2],
	[2, 3, 3, 3, 2],
	[2, 1, 1, 1, 2],
	[2, 3, 2, 3, 2],
	[2, 1, 2, 1, 2],
	[2, 2, 2, 3, 2],
	[2, 2, 2, 1, 2],
	[2, 3, 2, 2, 2],
	[2, 1, 2, 2, 2],
	[2, 3, 1, 3, 2],
	[2, 1, 3, 1, 2],
	[3, 3, 2, 3, 3],
	[3, 2, 2, 2, 3],
	[3, 2, 1, 2, 3],
	[3, 2, 3, 2, 3],
	[3, 3, 3, 2, 3],
	[3, 2, 3, 3, 3],
	[3, 3, 2, 2, 3],
	[3, 2, 2, 3, 3],
	[3, 3, 1, 3, 3],
	[3, 3, 2, 1, 0],
	[3, 2, 1, 0, 0],
];

/** The base reel set the reference's boot config declares. */
const BASE_STRIPS = [
	'H5 H1 H3 L4 H2 L1 H1 S L2 L3 H3 H4 L1 H2 H5 H3 L5 H4 L1 L3 H5 L4 L2 L5 S L5 H2 H3 H5 L1 H4 L5 H2 L2 H3 L4 L3 H4 L2',
	'H3 L5 L4 L1 L2 H5 H3 L3 H2 L2 L1 L5 H5 H4 H2 L3 L1 L2 W L4 H4 L3 L2 L5 L1 H3 L4 L5 H4 L2',
	'L5 H2 H5 CL H3 L2 H4 L1 CL L5 L3 H1 H5 L4 L2 H4 H3 H5 W L4 L1 L2 L3 H4 CL L1 H2 L4 L5 L3 L1 H2 H3 H5 L2',
	'L1 H1 L5 H3 L3 L1 H5 H3 H4 W L1 L3 H1 H4 H5 L4 H2 H1 L1 L2 H2 H1 H5 L5 L4 L3 H3 H2 H1 L5 H5 L2 H4 W H2 L4 H5 L2 H4',
	'L4 L5 H1 H5 H2 L1 L2 H4 H5 H1 H2 L3 H4 H3 L1 L4 H5 S L2 H3 H4 H1 L1 H2 L4 H3 H4 L1 H5 H1 L5 H2 H3 L2 H4 L3 H5 H3 L5 H4 L3 S H2 H3',
];

/** The reference's one free-spin reel set. */
const FREE_STRIPS = [
	'H3 H2 L5 L3 S L2 L1 H4 L3 L4 H5 L2 L5 L1 L4 L2 H3 L1 L3 L5 L4 L3 L1 L2 L5 L3 L1 L4 S H5 H4 L4 L2 L3 L4 H5 L1 L4 L3 L2 L5 H4 H1 L4 L3 L2 H5 H4 L5 L2 H3 L1 L4 L2 L5 L1 L3',
	'H5 L5 H4 L2 L3 H2 L4 L5 L2 L1 H4 W L5 L4 L1 H1 H4 L2 H5 L4 L2 L5 L4 L2 CL L5 L4 H5 L5 L2 L3 L4 L3 H3 L1 L4 L5 L2 H5 L1 L4 L2 H1 L3 L5 L1 H4 H3 L2 L4 L3 L1 L2 L4 L3 L1 L3 L5 H5 L3 L5 L2 L1 H5 L4 H2 L3 L4 L1',
	'H1 L1 L3 L2 L4 L3 H4 L5 CL H5 L3 H4 L5 L4 L2 H2 H3 L5 L4 L2 H1 H5 L3 L4 L2 L5 L1 L3 L2 L4 L1 L3 L2 H5 L4 H4 L3 L1 W H3 L5 L4 H4 H5 L1 L2 H2 H4 W L4 L3 L5 L2 L4',
	'CL L3 H2 H5 H3 L5 L4 L2 H5 L3 L5 L2 L1 H5 L4 L2 H4 H1 L4 H5 L5 L2 L4 H4 L1 W L2 L3 L4 L5 L2 L1 L4 H5 H3 L2 H4 L1 H5 H1 L2 L3 L1 H4 L3 H5 H3 L5 L4 L2 H5 L3 L5 L2 L1 H5 L4 H2',
	'L1 H3 H4 L4 L2 S H2 H5 L3 H3 H1 L1 L2 H4 L5 L1 L3 H5 H4 L5 L1 H3 L4 L2 L3 H1 H3 L5 L1 L2 L4 H5 H3 S L3 H1 H2 H5 L4 H4 L2 H3 H5 L4 H4 L2 L1 L5 L4 H4 L2 H1 L5 L4 L3',
];

const MAX_WIN = 5000;

/** A fresh copy of the Fairy Clover config. */
export const fairyCloverPreset = (): RawGameConfig => ({
	providerName: 'invisible_wall',
	gameName: 'fairy_clover',
	gameID: 'fairy_clover',
	rtp: 0.96,
	numReels: 5,
	numRows: [4, 4, 4, 4, 4],
	betModes: {
		base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: MAX_WIN },
	},
	paylines: Object.fromEntries(PAYLINES.map((line, i) => [String(i + 1), line])) as Paylines,
	symbols: {
		H1: pays({ 2: 5, 3: 40, 4: 400, 5: 2000 }),
		H2: pays({ 3: 10, 4: 50, 5: 300 }),
		H3: pays({ 3: 6, 4: 30, 5: 150 }),
		H4: pays({ 3: 5, 4: 15, 5: 75 }),
		H5: pays({ 3: 5, 4: 15, 5: 75 }),
		L1: pays({ 3: 3, 4: 10, 5: 30 }),
		L2: pays({ 3: 3, 4: 10, 5: 30 }),
		L3: pays({ 3: 2, 4: 6, 5: 20 }),
		L4: pays({ 3: 2, 4: 6, 5: 20 }),
		L5: pays({ 3: 1, 4: 3, 5: 10 }),
		W: { special_properties: ['wild'] },
		CL: { special_properties: ['wild'] },
		S: { ...pays({ 2: 1 }), special_properties: ['scatter'] },
	},
	paddingReels: {
		basegame: BASE_STRIPS.map(strip),
		freegame: FREE_STRIPS.map(strip),
	},
	// The fairy fills its reel when it lands, drawn only when a win crosses it (`show` 'onWin', the
	// reference); the clover lands on the centre reel (reels 2–4 in free spins) and grows a plus.
	expandingWilds: { symbols: ['W'] },
	growingWild: { symbol: 'CL', reels: [2], freeSpinReels: [1, 2, 3] },
	freeSpins: {
		triggerCount: 2,
		awards: [{ count: 2, spins: 10 }],
		retriggerAwards: [{ count: 2, spins: 10 }],
	},
});
