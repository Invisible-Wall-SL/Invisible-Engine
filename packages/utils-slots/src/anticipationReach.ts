/**
 * Reel-anticipation reachability — the pure math behind the client-computed anticipation MODE
 * (see `docs/design/reel-anticipation.md`). Given a FINAL revealed board, it answers: after `k`
 * reels have locked left-to-right, what win is still achievable from the reels not yet stopped?
 *
 * Two bounds, both expressed as a TOTAL-BET multiplier (the quantity `resolveWinLevel` thresholds
 * against — line pays are bet-per-line, so we divide by `numLines`):
 *   - `max` = OPTIMISTIC: assume every not-yet-stopped reel lands the best-paying continuation.
 *             Non-increasing in `k`; collapses toward the true final win as reels lock. Drives the
 *             `possible` (suspenseful) confidence mode — arm while `max >= smallestBigTier`.
 *   - `min` = GUARANTEED: assume every not-yet-stopped reel breaks the run. Non-decreasing in `k`;
 *             rises to the true final win. Drives the `guaranteed` (honest) confidence mode — arm
 *             only once `min >= smallestBigTier`, i.e. the big win is already locked in.
 * At `k = numReels` both bounds equal the true final win.
 *
 * DEPENDENCY-FREE ON PURPOSE (type-only imports): the module is imported by a Node fixture under
 * type-stripping to validate the math offline before any UI exists, and by the engine at runtime.
 * The caller supplies the config-derived paytable/paylines/wild predicate — NO hardcoded symbol ids.
 */

/** The reachable-win bounds after `lockedReelCount` reels have settled, as total-bet multipliers. */
export interface ReachBounds {
	min: number;
	max: number;
}

export interface AnticipationReach {
	/** `lockedReelCount` in `[0, numReels]`. 0 = nothing settled yet; numReels = final board. */
	bounds(lockedReelCount: number): ReachBounds;
	/** Number of reels — so callers can iterate `bounds(0..numReels)` without knowing the board. */
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
}

/**
 * Standard left-to-right payline math. For each line and each candidate base symbol `b` we walk the
 * locked reels from reel 0: the run extends while the cell is `b` or a wild, and stops at the first
 * mismatch. From that we derive, per line, the OPTIMISTIC run (unbroken prefix ⇒ extend through the
 * unlocked reels to full width; broken ⇒ capped at the break) and the GUARANTEED run (exactly the
 * matched locked prefix — the unlocked reels are assumed to break it). The line contributes the best
 * paying interpretation across candidate symbols, the same single-best-line rule the RGS uses.
 */
export function createLinesReach(args: LinesReachArgs): AnticipationReach {
	const numReels = args.board.length;

	const bounds = (lockedReelCount: number): ReachBounds => {
		const locked = Math.max(0, Math.min(lockedReelCount, numReels));
		let maxSum = 0;
		let minSum = 0;

		for (const line of args.paylines) {
			let lineMax = 0;
			let lineMin = 0;

			for (const base of args.payingSymbols) {
				// Walk the locked prefix of this line for candidate `base`.
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

	return { bounds, numReels };
}
