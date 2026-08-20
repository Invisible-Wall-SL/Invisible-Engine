import { createLinesReach, createWaysReach } from 'utils-slots';
import type { AnticipationReach, ReelAnticipationArming } from 'utils-slots';

import { stateGame } from './stateGame.svelte';
import {
	getActiveGameConfig,
	getNumLines,
	getPaylines,
	boardDimensions,
	activeBigTiers,
	activeWinModel,
} from './gameConfig';
import { paytable } from './paytable';
import type { BookEventOfType } from './typesBookEvent';

/**
 * Reel-anticipation arming for the LINES game — the client-computed replacement for the removed
 * server `anticipation[]` flag (`docs/design/reel-anticipation.md`, Phase 2).
 *
 * Everything is config-derived (NO hardcoded symbol ids): the paylines/paytable come from the active
 * Invisible Game Config, the wild + scatter from their `special_properties`, the feature-trigger
 * count from the scatter row's `occurs`, and the big-win thresholds from the authored/coded win
 * tiers. When `stateGame.anticipationMode` is OFF this returns `undefined` so the spin runs the plain
 * path (byte-parity).
 *
 * During a FREE-SPIN round a third axis is added: the round's Book-of expanding special
 * (`stateGame.specialSymbol`, set at feature start by `setExpandingSymbol`) is teased toward its 3+
 * expansion exactly like the scatter — see `buildReach`'s `bookReach`. It is inert (undefined) in the
 * base game and in non-Book-of games, so parity holds there.
 */

/**
 * Book-of expansion count: 3+ of the round's special symbol on the board triggers `expandBookColumns`
 * (see `typesBookEvent.ts` / `bookEventHandlerMap.expandBookColumns`). No dedicated config field
 * carries this today — it is the fixed Thermopylae "3+" rule — so default to 3; pull from config if a
 * value is ever authored. (It coincides with the scatter feature-trigger count in Thermopylae, but is
 * a distinct Book-of rule, so it is NOT derived from the scatter row.)
 */
const BOOK_EXPANSION_COUNT = 3;

/** Build the reachable-win calculator from the FINAL revealed board + the active config. */
function buildReach(board: string[][]): {
	reach: AnticipationReach;
	triggerCount: number | undefined;
	bookReach: AnticipationReach | undefined;
	bookTriggerCount: number;
} {
	const entries = paytable();
	const config = getActiveGameConfig();

	// Line pays (bet-per-line units) keyed by symbol → run length. `createLinesReach` divides the
	// summed line pays by `numLines` to get the total-bet multiplier the win tiers threshold against.
	const payBySymbol = new Map<string, Map<number, number>>();
	for (const entry of entries) {
		if (entry.on.mode !== 'line') continue;
		const runToPay = new Map<number, number>();
		entry.on.occurs.forEach((occurs, index) => runToPay.set(occurs, entry.pay[index] ?? 0));
		payBySymbol.set(entry.on.of, runToPay);
	}

	// The feature-trigger special = the scatter row's symbol; the trigger COUNT = its first `occurs`
	// (e.g. 3 scatters → free spins). Absent ⇒ no trigger axis.
	const scatterEntry = entries.find(
		(entry) => entry.on.mode === 'scatter' || entry.trigger === 'feature',
	);
	const scatterName = scatterEntry?.on.of;
	const triggerCount = scatterEntry?.on.occurs[0];

	const isWild = (symbol: string): boolean =>
		config.symbols[symbol]?.special_properties?.includes('wild') ?? false;
	const isSpecial = scatterName ? (symbol: string) => symbol === scatterName : undefined;

	// The reach calculation follows the DECLARED WIN MODEL, because "could this reel still complete a
	// paying run" is a different question per model and the wrong walker does not merely mis-tease —
	// it reports a reachable AMOUNT that the win tiers then threshold against.
	//
	//  - `lines` walks each payline's fixed rows.
	//  - `ways` has no rows to walk: a reel either holds the symbol or it does not, and the pay
	//    multiplies by the product of the per-reel counts. See `createWaysReach`.
	//  - `cluster`/`scatter` still stand DOWN. Their reach is a third calculation again (adjacency
	//    growth, whole-board counts) and neither has a runtime, so feeding either a walker built for
	//    something else would be worse than teasing nothing. Anticipation is opt-in per flow, so off
	//    is a correct degradation rather than a lost feature.
	//
	// See docs/design/game-type-templates.md (Phase D).
	const model = activeWinModel().type;
	const paylines = getPaylines();
	const symbolPay = (symbol: string, runLength: number) =>
		payBySymbol.get(symbol)?.get(runLength) ?? 0;
	const payingSymbols = [...payBySymbol.keys()];

	const reach =
		model === 'ways'
			? createWaysReach({
					board,
					payingSymbols,
					// The SAME paytable the lines model quotes per line, quoted per way — `payoutDivisor`
					// (#357) is what makes the two denominations agree, and `createWaysReach` divides by
					// the ways count exactly as the line walker divides by `numLines`.
					wayPay: symbolPay,
					isWild,
					isSpecial,
				})
			: createLinesReach({
					board,
					paylines,
					// `cluster`/`scatter` arrive here too, and stand down through this list: `getPaylines()`
					// returns [] for a model with no lines, so with no candidate symbols the win axis sums
					// to zero and nothing arms. Stated rather than left implicit, because the stand-down
					// reads as an accident otherwise and would not survive someone "fixing" that empty list.
					payingSymbols: paylines.length ? payingSymbols : [],
					linePay: symbolPay,
					numLines: getNumLines(),
					isWild,
					isSpecial,
				});

	// Book-of expanding-special axis (Book-of ONLY, free spins ONLY): when the round's expanding
	// symbol is set (`setExpandingSymbol` at feature start → cleared at `freeSpinEnd`), tease its
	// instances landing toward the 3+ expansion the SAME way the scatter tease works — a second reach
	// whose `triggerBounds` counts the round's special. The special is a dynamic PAYING symbol drawn
	// per round, so the predicate reads `stateGame.specialSymbol` (NO hardcoded id). Only the trigger
	// axis of this reach is used; the win axis is identical to `reach` above and left unread.
	const special = stateGame.specialSymbol;
	const bookReach = special
		? createLinesReach({
				board,
				paylines,
				payingSymbols,
				linePay,
				numLines,
				isWild,
				isSpecial: (symbol) => symbol === special,
			})
		: undefined;

	return { reach, triggerCount, bookReach, bookTriggerCount: BOOK_EXPANSION_COUNT };
}

/**
 * Build the per-reel arming policy for one reveal, or `undefined` when anticipation mode is off (the
 * spin then runs the plain path — byte-parity). The returned function is called by
 * `createEnhanceBoardSpin` with the index of the reel about to settle: `winBounds(reelIndex)` /
 * `triggerBounds(reelIndex)` express what is still reachable given reels `0..reelIndex-1` are locked.
 */
export function buildAnticipationArming(
	revealEvent: BookEventOfType<'reveal'>,
): ((reelIndex: number) => ReelAnticipationArming | null) | undefined {
	if (!stateGame.anticipationMode) return undefined;

	// Reveal boards are padded one row top+bottom (`padReel`); the VISIBLE window is rows 1..y, which
	// is what the paylines index into. (Phase 3 owns pixel-accurate presentation; this slice matches
	// the facade's padding.)
	const { y } = boardDimensions();
	const board = revealEvent.board.map((reel) => reel.slice(1, 1 + y).map((cell) => cell.name));

	const { reach, bookReach, bookTriggerCount } = buildReach(board);
	const bound = stateGame.anticipationConfidence === 'guaranteed' ? 'min' : 'max';
	// The config big-win tiers (ascending) drive BOTH the numeric stack level and the tier ALIAS: the
	// win-reach arming stacks a level per big threshold crossed, and the reached tier's alias tags the
	// reel so the FX ramp + `/symbols` panel key off the same config tiers (no fixed big/mega/massive).
	const bigTiers = activeBigTiers();
	const bigThresholds = bigTiers.map((tier) => tier.threshold);
	const smallestBig = bigThresholds[0];
	const minReel = stateGame.minAnticipateReel;

	// TEMP diagnostic (opt-in `&antdebug=1`): one line per reveal with the exact book/line arming
	// inputs, so we can see WHY the book tease does or doesn't arm — is the mode on, is `specialSymbol`
	// set (did `bookReach` build?), and what are the per-reel book bounds vs the N-1/N thresholds.
	if (typeof location !== 'undefined' && location.search.includes('antdebug')) {
		const perReel = [];
		for (let k = 0; k <= reach.numReels; k += 1) {
			perReel.push({
				k,
				book: bookReach ? bookReach.triggerBounds(k) : null,
				win: Number(reach.winBounds(k)[bound].toFixed(2)),
			});
		}

		console.log(
			'[ANT-DEBUG]',
			JSON.stringify({
				gameType: revealEvent.gameType,
				mode: stateGame.anticipationMode,
				special: stateGame.specialSymbol ?? null,
				bookReachBuilt: bookReach !== undefined,
				bookTriggerCount,
				smallestBig: smallestBig ?? null,
				minReel,
				perReel,
			}),
		);
	}

	return (reelIndex: number): ReelAnticipationArming | null => {
		if (reelIndex >= reach.numReels) return null;

		let level = 0;

		// Book-of expanding special (free spins only) — the "one book away from the expansion" tease.
		// The expansion IS the feature's big-win moment: a Book-of round that lands the Nth of the
		// round's symbol expands it to fill reels and pays big — that is the whole mechanic — so reaching
		// it IS reaching a big win, and there is NO separate win-amount gate. (An earlier attempt gated
		// this on `linePay(special, numReels)`, but the expansion pays FAR more than a single line of the
		// symbol, so that wrongly suppressed real big book wins on low-paytable specials.) Arms once N-1
		// of the book are ALREADY on the board (`min` counts every book CELL, so two stacked on one reel
		// count as two) with the Nth still reachable (`max`); it drops the instant the last book becomes
		// impossible. NOT gated by `minAnticipateReel`. `bookReach` exists only when
		// `stateGame.specialSymbol` is set (Book-of + free spins), so base game / non-Book-of are
		// unaffected (byte-parity).
		if (bookReach && bookTriggerCount > 0) {
			const book = bookReach.triggerBounds(reelIndex);
			if (book.min >= bookTriggerCount - 1 && book.max >= bookTriggerCount) {
				level = Math.max(level, 1);
			}
		}

		// Line-win reach — "big wins only": arm once the reachable win clears the smallest big tier;
		// stack a level per further big threshold it still crosses. Gated by `minAnticipateReel` (a run
		// below the minimum can't reach a big win) and skipped entirely when no big tiers are configured.
		// (There is deliberately NO scatter feature-trigger axis: entering free spins is a FEATURE, not a
		// big WIN — see docs/design/reel-anticipation.md.)
		if (smallestBig !== undefined && reelIndex >= minReel) {
			const win = reach.winBounds(reelIndex)[bound];
			if (win >= smallestBig) {
				level = bigThresholds.filter((threshold) => win >= threshold).length;
			}
		}

		if (level <= 0) return null;
		// The tier alias = the big tier the reachable win reached (rank `level`, 1-based). A book-only
		// arm sits at level 1 → the lowest tier alias (its FX ramp uses the first step); `level` stays
		// the numeric rank on `reelState.anticipationLevel`.
		return { level, tier: bigTiers[level - 1]?.alias ?? null };
	};
}
