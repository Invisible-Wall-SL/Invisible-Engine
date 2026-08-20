/**
 * Reel-anticipation reachability — the pure math behind the client-computed anticipation MODE
 * (see `docs/design/reel-anticipation.md`). Given a FINAL revealed board, it answers: after `k`
 * reels have locked left-to-right, what is still achievable from the reels not yet stopped?
 *
 * This is the SINGLE source of anticipation (the server `anticipation[]` flag is removed). It covers
 * two reach axes, both from the same locked-prefix walk:
 *
 *   - WIN-reach (`winBounds`) — the reachable big-win AMOUNT as a TOTAL-BET multiplier (the quantity
 *     `resolveWinLevel` thresholds against; line pays are bet-per-line, so we divide by `numLines`).
 *   - TRIGGER-reach (`triggerBounds`) — the reachable COUNT of the special/scatter symbol toward its
 *     feature threshold (e.g. 3 scatters → free spins). The classic "tease the 3rd book".
 *
 * Each axis returns two bounds:
 *   - `max` = OPTIMISTIC: assume every not-yet-stopped reel lands the best continuation. Non-increasing
 *     in `k`; collapses toward the true final value. Drives the `possible` (suspenseful) mode.
 *   - `min` = GUARANTEED: assume every not-yet-stopped reel breaks the run / adds nothing. Non-decreasing
 *     in `k`; rises to the true final value. Drives the `guaranteed` (honest) mode.
 * At `k = numReels` both bounds equal the true final value.
 *
 * DEPENDENCY-FREE ON PURPOSE (type-only imports): imported by a Node fixture under type-stripping to
 * validate the math offline before any UI exists, and by the engine at runtime. The caller supplies
 * the config-derived paytable/paylines/predicates — NO hardcoded symbol ids.
 */

/** Reachable bounds after `lockedReelCount` reels have settled. Units per axis: win = total-bet
 *  multiplier; trigger = special-symbol count. */
export interface ReachBounds {
	min: number;
	max: number;
}

export interface AnticipationReach {
	/** Reachable big-win amount (total-bet multiplier). `lockedReelCount` in `[0, numReels]`. */
	winBounds(lockedReelCount: number): ReachBounds;
	/** Reachable special/scatter COUNT toward the feature trigger. `{0,0}` when no special is set. */
	triggerBounds(lockedReelCount: number): ReachBounds;
	/** Number of reels — so callers can iterate `0..numReels` without knowing the board. */
	readonly numReels: number;
}

export interface LinesReachArgs {
	/** Final VISIBLE board, `board[reelIndex][rowIndex]` = symbol name. */
	board: string[][];
	/** Paylines, `paylines[line][reelIndex]` = the row index that line reads on that reel. */
	paylines: number[][];
	/** Candidate base symbols — every symbol that can pay a LINE (has a line paytable). Excludes
	 *  scatter. Include the wild: a pure-wild run pays as the wild. */
	payingSymbols: string[];
	/** Line pay for a left-anchored run of `runLength` of `symbol`, in BET-PER-LINE units. Returns
	 *  0 for a non-paying run length (typically `< 3`). */
	linePay: (symbol: string, runLength: number) => number;
	/** Total bet = bet-per-line × numLines. The divisor that turns line pays into a bet multiplier. */
	numLines: number;
	/** Whether `symbol` substitutes for any base symbol on a line (wild). */
	isWild: (symbol: string) => boolean;
	/** Whether `symbol` is the feature-trigger special (scatter). Omit ⇒ trigger-reach is `{0,0}`. */
	isSpecial?: (symbol: string) => boolean;
	/** Optimistic cap on how many specials an unlocked reel may still contribute (scatter designs
	 *  are typically 1 per reel). Default 1. */
	maxSpecialsPerReel?: number;
}

/**
 * Standard left-to-right payline math for win-reach, plus a whole-board special count for
 * trigger-reach. For each line and candidate base symbol we walk the locked reels from reel 0: the
 * run extends while the cell is that symbol or a wild, and stops at the first mismatch. From that we
 * derive the OPTIMISTIC run (unbroken prefix ⇒ extend through the unlocked reels; broken ⇒ capped at
 * the break) and the GUARANTEED run (exactly the matched locked prefix). The line takes the best
 * paying interpretation across candidate symbols — the single-best-line rule the RGS uses.
 */
export function createLinesReach(args: LinesReachArgs): AnticipationReach {
	const numReels = args.board.length;
	const maxSpecialsPerReel = args.maxSpecialsPerReel ?? 1;

	const clamp = (k: number) => Math.max(0, Math.min(k, numReels));

	const winBounds = (lockedReelCount: number): ReachBounds => {
		const locked = clamp(lockedReelCount);
		let maxSum = 0;
		let minSum = 0;

		for (const line of args.paylines) {
			let lineMax = 0;
			let lineMin = 0;

			for (const base of args.payingSymbols) {
				let prefix = 0;
				let broken = false;
				for (let reel = 0; reel < locked; reel++) {
					const symbol = args.board[reel][line[reel]];
					if (symbol === base || args.isWild(symbol)) {
						prefix += 1;
					} else {
						broken = true;
						break;
					}
				}

				// Optimistic: an unbroken prefix can ride the unlocked reels to full width.
				const optRun = broken ? prefix : numReels;
				// Guaranteed: the unlocked reels may break immediately, so only the matched prefix counts.
				const certRun = prefix;

				const optPay = args.linePay(base, optRun);
				const certPay = args.linePay(base, certRun);
				if (optPay > lineMax) lineMax = optPay;
				if (certPay > lineMin) lineMin = certPay;
			}

			maxSum += lineMax;
			minSum += lineMin;
		}

		const divisor = args.numLines > 0 ? args.numLines : 1;
		return { max: maxSum / divisor, min: minSum / divisor };
	};

	return {
		winBounds,
		triggerBounds: createTriggerBounds(args.board, args.isSpecial, maxSpecialsPerReel),
		numReels,
	};
}

/**
 * TRIGGER-reach, shared by every win model.
 *
 * A scatter triggers on a COUNT ANYWHERE on the board — it is not read along a payline and not
 * multiplied by ways — so this axis is identical whether the game pays by lines or by ways, and
 * lives here rather than in either evaluator. That is not a coincidence worth hiding: the whole
 * reason `ways` can reuse the classic "tease the 3rd scatter" behaviour unchanged is that its
 * feature trigger was never a line calculation in the first place.
 */
function createTriggerBounds(
	board: string[][],
	isSpecial: ((symbol: string) => boolean) | undefined,
	maxSpecialsPerReel: number,
): (lockedReelCount: number) => ReachBounds {
	const numReels = board.length;
	return (lockedReelCount: number): ReachBounds => {
		if (!isSpecial) return { min: 0, max: 0 };
		const locked = Math.max(0, Math.min(lockedReelCount, numReels));

		// Specials pay/trigger ANYWHERE, so count across every visible row of a reel, not a line.
		let lockedCount = 0;
		for (let reel = 0; reel < locked; reel++) {
			for (const symbol of board[reel]) {
				if (isSpecial(symbol)) lockedCount += 1;
			}
		}

		// Guaranteed: only the specials already locked in. Optimistic: plus what the unlocked reels
		// could still contribute (capped per reel — we do NOT peek at their actual final symbols).
		const unlockedReels = numReels - locked;
		return { min: lockedCount, max: lockedCount + unlockedReels * maxSpecialsPerReel };
	};
}

export interface WaysReachArgs {
	/** Final VISIBLE board, `board[reelIndex][rowIndex]` = symbol name. */
	board: string[][];
	/** Candidate base symbols — every symbol with a paytable. Include the wild: a pure-wild run pays
	 *  as the wild. Excludes scatter (it pays on the trigger axis). */
	payingSymbols: string[];
	/** Pay for a left-anchored run of `runLength` of `symbol`, in BET-PER-WAY units — the same
	 *  paytable the lines model quotes per line (`payoutDivisor`, #357). 0 for a non-paying length. */
	wayPay: (symbol: string, runLength: number) => number;
	/** Whether `symbol` substitutes for any base symbol (wild). */
	isWild: (symbol: string) => boolean;
	/** Whether `symbol` is the feature-trigger special (scatter). Omit ⇒ trigger-reach is `{0,0}`. */
	isSpecial?: (symbol: string) => boolean;
	/** Optimistic cap on specials an unlocked reel may still contribute. Default 1. */
	maxSpecialsPerReel?: number;
}

/**
 * WAYS reachability — the ways analogue of {@link createLinesReach}, and the reason anticipation no
 * longer has to stand down on a ways game.
 *
 * Three things make this a genuinely different calculation rather than lines math with the paylines
 * swapped out, which is why feeding a ways board to the line walker was refused rather than fudged:
 *
 *  1. **There is no row to walk.** A reel either CONTAINS the symbol or it does not; what matters is
 *     HOW MANY of its cells do, because the pay multiplies by the product of those per-reel counts.
 *     So the locked prefix carries a running product, not a run of single cells.
 *  2. **Symbols do not compete.** A payline pays its single best interpretation, so lines takes a max
 *     across candidate symbols and sums across lines. Ways has no lines and every symbol that
 *     completes a run pays at once, so this SUMS across symbols — the same thing `evaluateWays` does.
 *  3. **The optimistic case has to choose a length.** An unbroken prefix can ride the unlocked reels,
 *     but a longer run is not automatically worth more: `mult(r)` may be absent at some `r` while the
 *     ways product keeps growing. So the optimistic bound maximises `mult(r) x ways(r)` over every
 *     reachable length rather than assuming full width the way the line walker safely can.
 *
 * `waysCount` (the divisor that turns per-way pays into a total-bet multiplier) is the product of
 * each reel's VISIBLE row count, read off the board rather than from config — the board is what was
 * actually dealt, so a stepped or resized grid counts correctly. Mirrors `activeWaysCount`.
 */
export function createWaysReach(args: WaysReachArgs): AnticipationReach {
	const numReels = args.board.length;
	const rowsOn = args.board.map((reel) => reel.length);
	const waysCount = rowsOn.reduce((product, rows) => product * Math.max(1, rows), 1);
	const clamp = (k: number) => Math.max(0, Math.min(k, numReels));

	const matchCount = (reel: number, base: string) =>
		args.board[reel].filter((cell) => cell === base || args.isWild(cell)).length;

	const winBounds = (lockedReelCount: number): ReachBounds => {
		const locked = clamp(lockedReelCount);
		let maxSum = 0;
		let minSum = 0;

		for (const base of args.payingSymbols) {
			// Walk the locked reels, carrying the ways PRODUCT alongside the run length. The run ends
			// at the first locked reel holding none of the symbol.
			let prefix = 0;
			let prefixWays = 1;
			let broken = false;
			for (let reel = 0; reel < locked; reel++) {
				const count = matchCount(reel, base);
				if (count === 0) {
					broken = true;
					break;
				}
				prefix += 1;
				prefixWays *= count;
			}

			// GUARANTEED: every unlocked reel breaks the run, so the run is exactly the matched prefix
			// and its ways product is exactly what is already on the board.
			minSum += args.wayPay(base, prefix) * prefixWays;

			if (broken) {
				// A broken run cannot be rescued by an unlocked reel — the optimistic case is the same
				// fixed win the guaranteed case sees.
				maxSum += args.wayPay(base, prefix) * prefixWays;
				continue;
			}

			// OPTIMISTIC: the unlocked reels can land the symbol on EVERY row. Take the best reachable
			// length rather than assuming full width — see (3) above.
			let bestPay = args.wayPay(base, prefix) * prefixWays;
			let ways = prefixWays;
			for (let reel = locked; reel < numReels; reel++) {
				ways *= Math.max(1, rowsOn[reel]);
				const pay = args.wayPay(base, reel + 1) * ways;
				if (pay > bestPay) bestPay = pay;
			}
			maxSum += bestPay;
		}

		return { max: maxSum / waysCount, min: minSum / waysCount };
	};

	return {
		winBounds,
		triggerBounds: createTriggerBounds(args.board, args.isSpecial, args.maxSpecialsPerReel ?? 1),
		numReels,
	};
}
