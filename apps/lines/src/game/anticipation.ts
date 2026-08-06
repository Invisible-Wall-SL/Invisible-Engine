import { createLinesReach } from 'utils-slots';
import type { AnticipationReach, ReelAnticipationArming } from 'utils-slots';

import { stateGame } from './stateGame.svelte';
import {
	getActiveGameConfig,
	getNumLines,
	getPaylines,
	boardDimensions,
	activeBigTiers,
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
	bookExpansionMaxWin: number;
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

	const paylines = getPaylines();
	const payingSymbols = [...payBySymbol.keys()];
	const numLines = getNumLines();
	const linePay = (symbol: string, runLength: number) =>
		payBySymbol.get(symbol)?.get(runLength) ?? 0;

	const reach = createLinesReach({
		board,
		paylines,
		payingSymbols,
		linePay,
		numLines,
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

	// The book expansion's WIN, so the tease can be gated on "big wins only" like every other axis. When
	// the round's special expands it fills the reels it covers; the biggest that expansion can pay is a
	// FULL board of the special — every payline a `numReels`-of-a-kind. That total, as a total-bet
	// multiplier, equals the special's own top line pay (the `numLines` factor cancels against the
	// win-reach divisor), so `linePay(special, numReels)` IS the max expansion win in the same units the
	// big-win tiers threshold against. A low-paying round symbol therefore can't clear the tier and its
	// book is never teased — only a book that could actually pay big is.
	const bookExpansionMaxWin = special ? linePay(special, board.length) : 0;

	return {
		reach,
		triggerCount,
		bookReach,
		bookTriggerCount: BOOK_EXPANSION_COUNT,
		bookExpansionMaxWin,
	};
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

	const { reach, bookReach, bookTriggerCount, bookExpansionMaxWin } = buildReach(board);
	const bound = stateGame.anticipationConfidence === 'guaranteed' ? 'min' : 'max';
	// The config big-win tiers (ascending) drive BOTH the numeric stack level and the tier ALIAS: the
	// win-reach arming stacks a level per big threshold crossed, and the reached tier's alias tags the
	// reel so the FX ramp + `/symbols` panel key off the same config tiers (no fixed big/mega/massive).
	const bigTiers = activeBigTiers();
	const bigThresholds = bigTiers.map((tier) => tier.threshold);
	const smallestBig = bigThresholds[0];
	const minReel = stateGame.minAnticipateReel;

	return (reelIndex: number): ReelAnticipationArming | null => {
		if (reelIndex >= reach.numReels) return null;

		// "Big wins only" (the whole point of the feature): EVERY axis must resolve to a reachable BIG
		// win — a config big-win tier. So with no big tiers configured there is nothing to anticipate
		// and nothing arms. This is the single gate that keeps the mode from firing on small wins.
		if (smallestBig === undefined) return null;

		let level = 0;

		// Book-of expanding special (free spins only) — the "one book away from the expansion" tease,
		// but ONLY when that expansion could itself be a BIG win. Two gates, both required:
		//   1. big-win gate — `bookExpansionMaxWin` (the special fully expanded) clears the smallest big
		//      tier. A low-paying round symbol can't, so its book is never teased (big wins only).
		//   2. count gate — N-1 of the book are ALREADY on the board (`min` counts EVERY book cell, so
		//      two books STACKED on one reel still count as two) AND the Nth is still reachable (`max`).
		// So "two books down → tease" holds even when they share a column, and it drops the instant the
		// last book becomes impossible. NOT gated by `minAnticipateReel` (two books is meaningful this
		// early). `bookReach` is only built when `stateGame.specialSymbol` is set, so the base game and
		// non-Book-of games are unaffected (byte-parity).
		if (bookReach && bookTriggerCount > 0 && bookExpansionMaxWin >= smallestBig) {
			const book = bookReach.triggerBounds(reelIndex);
			if (book.min >= bookTriggerCount - 1 && book.max >= bookTriggerCount) {
				level = Math.max(level, 1);
			}
		}

		// Line-win reach — arm once the reachable win clears the smallest big tier; stack a level per
		// further big threshold it still crosses. Gated by `minAnticipateReel`: a run below the minimum
		// can't reach a big win, so an early arm there is meaningless. (There is deliberately NO scatter
		// feature-trigger axis: entering free spins is a FEATURE, not a big WIN, and the mode is big-wins
		// only — see docs/design/reel-anticipation.md.)
		if (reelIndex >= minReel) {
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
