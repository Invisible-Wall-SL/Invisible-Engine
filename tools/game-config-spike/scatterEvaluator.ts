/**
 * Scatter-pays scoring AND the cascade chain, driven by a Game Config doc.
 *
 * Split out for the same reason `waysEvaluator` is: `scatterCrosscheck.ts` holds it against
 * `mock-rgs-server`'s `evaluateScatterPays` and PROVES the two agree, rather than leaving a second
 * implementation of the same rule to drift quietly. The mock's evaluator cannot be imported here —
 * it is bound to the mock's own PIC/SCAT vocabulary and its own paytable, so it cannot score a
 * project's config. Re-expressing the rule is the only option; asserting the agreement is the price.
 *
 * THE CASCADE IS PART OF THE MEASUREMENT, and that is the whole reason this file is not just a
 * twenty-line variant of the ways scorer. A scatter game tumbles: the cells that paid leave, the
 * survivors fall, the gaps refill, and the new board is scored again. Its return is therefore
 * chain-dependent, and a single-board RTP for one understates it by whatever the chain multiplies —
 * which is not a small factor. `docs/design/game-type-templates.md` records that as the reason the
 * ways verifier does not cover cascade RTP; this closes it rather than repeating it.
 */

import { type Cell, type Doc, type Rules } from './waysEvaluator';

/** The mock's own cap, mirrored: a chain that reaches it is truncated, not left to run. */
export const CASCADE_MAX_STEPS = 12;

export type ScatterWin = {
	symbol: string;
	count: number;
	positions: { reel: number; row: number }[];
	pay: number;
};

/**
 * The paying symbols of a scatter game, which is NOT `rules.paying`.
 *
 * A declared scatter is excluded even when it carries a paytable: that symbol pays through the
 * free-spin TRIGGER, scored separately, and letting it also pay as an ordinary count-anywhere win
 * would pay the same landing twice. The mock draws the same line (`evaluateScatterPays` iterates
 * `LINE_SYMBOLS`, and `evaluateScatters` handles SCAT).
 */
export const scatterPayingSymbols = (rules: Rules): string[] =>
	rules.paying.filter((s) => !rules.scatters.includes(s));

/**
 * The paytable row a COUNT lands on: the highest tier at or below it.
 *
 * Paytable rows are THRESHOLDS ("10+"), not exact matches. Against a sparse table (`{8,9,10,13}`) an
 * exact lookup pays NOTHING for a count of 11 — a win visible on the board scoring zero. The mock
 * had exactly that bug and it is worth not re-introducing here, since a verifier that silently
 * under-pays would report an RTP lower than the game's.
 */
export const tierFor = (pay: Record<number, number>, count: number): number => {
	const tier = Object.keys(pay)
		.map(Number)
		.filter((n) => n <= count)
		.sort((a, b) => a - b)
		.pop();
	return tier === undefined ? 0 : (pay[tier] ?? 0);
};

/**
 * Every symbol that reaches `minCount` ANYWHERE on the board pays, priced against the TOTAL stake —
 * `payoutDivisor` returns 1 for this model, because a scatter-pays multiplier applies to the whole
 * bet rather than a per-line or per-way slice. Wilds substitute. `board[reel][row]`.
 */
export const evaluateScatterPaysDoc = (
	board: string[][],
	rules: Rules,
	minCount: number,
	betPerSpin: number,
): ScatterWin[] => {
	const wins: ScatterWin[] = [];
	for (const symbol of scatterPayingSymbols(rules)) {
		const positions: { reel: number; row: number }[] = [];
		board.forEach((reel, r) =>
			reel.forEach((cell, row) => {
				if (cell === symbol || rules.wilds.includes(cell)) positions.push({ reel: r, row });
			}),
		);
		if (positions.length < minCount) continue;
		const mult = tierFor(rules.pay[symbol], positions.length);
		if (!mult) continue;
		wins.push({ symbol, count: positions.length, positions, pay: mult * betPerSpin });
	}
	return wins;
};

/** One refilled cell, drawn from that reel's OWN strip — so a refill carries the same frequencies
 *  the deal does, which is what a strip set means. */
const refillFrom = (strip: Cell[], rand: () => number): string =>
	strip[Math.floor(rand() * strip.length)].name;

export type ChainResult = {
	/** Total paid across every board in the chain, in units of the total bet. */
	pay: number;
	/** How many TUMBLES happened. 0 = the dealt board paid nothing (or paid, on a non-cascading run). */
	steps: number;
	/** True when the chain was still paying when it hit {@link CASCADE_MAX_STEPS}. */
	capped: boolean;
	/** Symbols that paid on the DEALT board — the threshold diagnostic, before any tumble. */
	dealtWins: ScatterWin[];
};

/**
 * Play one spin to the end of its chain.
 *
 * `cascade: false` scores the dealt board only, which is the honest number for a scatter game whose
 * `Winners tumble` is off — the two are genuinely different games and the tool reports whichever the
 * doc describes.
 */
export const playSpin = (
	board: string[][],
	strips: Cell[][],
	rules: Rules,
	minCount: number,
	betPerSpin: number,
	rand: () => number,
	cascade: boolean,
): ChainResult => {
	const dealtWins = evaluateScatterPaysDoc(board, rules, minCount, betPerSpin);
	let pay = dealtWins.reduce((sum, w) => sum + w.pay, 0);
	if (!cascade) return { pay, steps: 0, capped: false, dealtWins };

	let current = board.map((reel) => [...reel]);
	let wins = dealtWins;
	let steps = 0;
	while (wins.length) {
		if (steps >= CASCADE_MAX_STEPS) return { pay, steps, capped: true, dealtWins };
		const gone = new Set(wins.flatMap((w) => w.positions.map((p) => `${p.reel}:${p.row}`)));
		current = current.map((reel, r) => {
			const kept = reel.filter((_, row) => !gone.has(`${r}:${row}`));
			const refills = Array.from({ length: reel.length - kept.length }, () =>
				refillFrom(strips[r], rand),
			);
			return [...refills, ...kept];
		});
		steps += 1;
		wins = evaluateScatterPaysDoc(current, rules, minCount, betPerSpin);
		pay += wins.reduce((sum, w) => sum + w.pay, 0);
	}
	return { pay, steps, capped: false, dealtWins };
};

/** `minCount` as the doc declares it, with the schema's own default. */
export const minCountOf = (doc: Doc): number => {
	const model = doc.winModel as { type?: string; minCount?: number } | undefined;
	const n = Number(model?.minCount);
	return Number.isFinite(n) && n >= 2 ? Math.floor(n) : 8;
};
