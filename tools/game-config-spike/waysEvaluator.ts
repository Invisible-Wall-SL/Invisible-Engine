/**
 * Ways scoring, driven by a Game Config doc.
 *
 * Split out of `verify.ts` so `crosscheck.ts` can hold it against `mock-rgs-server`'s
 * `evaluateWays` and PROVE the two agree, rather than leaving a second implementation of the same
 * rule to drift quietly. That mock evaluator cannot simply be imported here: it is bound to the
 * mock's own PIC/SCAT vocabulary and its own hardcoded paytable, so it cannot score a project's
 * config. Re-expressing the rule is the only option; asserting the agreement is the price.
 */

export type Cell = { name: string };
export type SymbolDef = {
	paytable?: Record<string, number>[] | null;
	special_properties?: string[];
};
export type Doc = {
	numReels: number;
	numRows: number[];
	symbols: Record<string, SymbolDef>;
	paddingReels?: Record<string, Cell[][]>;
	winModel?: { type: string };
	rtp?: number;
};

export type Rules = {
	paying: string[];
	wilds: string[];
	scatters: string[];
	pay: Record<string, Record<number, number>>;
	/** The product of each reel's visible rows (5x3 = 243) — mirrors `engine-game` `activeWaysCount`. */
	waysCount: number;
};

const hasProp = (doc: Doc, sym: string, prop: string) =>
	(doc.symbols[sym]?.special_properties ?? []).includes(prop);

/** `paytable: [{ '3': 0.5 }, { '4': 1 }]` -> `{ 3: 0.5, 4: 1 }`. */
const payMap = (doc: Doc, sym: string): Record<number, number> => {
	const out: Record<number, number> = {};
	for (const entry of doc.symbols[sym]?.paytable ?? []) {
		for (const [occurs, mult] of Object.entries(entry)) out[Number(occurs)] = mult;
	}
	return out;
};

/** Everything the scorer needs, read from the doc. No per-game constants. */
export const buildRules = (doc: Doc): Rules => {
	const paying = Object.keys(doc.symbols).filter((s) => (doc.symbols[s].paytable ?? []).length > 0);
	return {
		paying,
		wilds: Object.keys(doc.symbols).filter((s) => hasProp(doc, s, 'wild')),
		scatters: Object.keys(doc.symbols).filter((s) => hasProp(doc, s, 'scatter')),
		pay: Object.fromEntries(paying.map((s) => [s, payMap(doc, s)])),
		waysCount: doc.numRows.reduce((product, r) => product * Math.max(1, Math.floor(r)), 1),
	};
};

export type WaysWin = { symbol: string; occurs: number; ways: number; pay: number };

/**
 * A ways win is a symbol on CONSECUTIVE reels from the LEFTMOST; the run stops at the first reel
 * that does not contain it, and the pay multiplies by the PRODUCT of its per-reel counts (3 on reel
 * 1 x 2 on reel 2 = 6 ways). Wilds substitute for the paying symbol. `board[reel][row]`.
 */
export const evaluateWaysDoc = (board: string[][], rules: Rules, betPerWay: number): WaysWin[] => {
	const wins: WaysWin[] = [];
	for (const symbol of rules.paying) {
		const perReel: number[] = [];
		for (const reel of board) {
			const count = reel.filter((c) => c === symbol || rules.wilds.includes(c)).length;
			if (count === 0) break;
			perReel.push(count);
		}
		const mult = rules.pay[symbol][perReel.length];
		if (!mult) continue;
		const ways = perReel.reduce((p, c) => p * c, 1);
		wins.push({ symbol, occurs: perReel.length, ways, pay: mult * ways * betPerWay });
	}
	return wins;
};

export const scatterCount = (board: string[][], rules: Rules) =>
	board.flat().filter((c) => rules.scatters.includes(c)).length;

/** Deterministic LCG — the same generator the mock uses, so a seeded run reproduces exactly. */
export const makeRng = (seed: number) => {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
};

/**
 * One board off the strips: an independent uniform stop per reel, reading `numRows[reel]`
 * consecutive cells with wraparound. This is what a strip set MEANS — the frequencies on the strip
 * become the frequencies on the board — and it is precisely the property a cosmetic (uniform) strip
 * set does not have.
 */
export const dealFromStrips = (
	strips: Cell[][],
	numRows: number[],
	rand: () => number,
): string[][] =>
	strips.map((reel, i) => {
		const stop = Math.floor(rand() * reel.length);
		const rows = numRows[i] ?? numRows[0];
		return Array.from({ length: rows }, (_, r) => reel[(stop + r) % reel.length].name);
	});
