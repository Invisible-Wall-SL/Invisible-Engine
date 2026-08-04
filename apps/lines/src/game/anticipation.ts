import { createLinesReach } from 'utils-slots';
import type { AnticipationReach, ReelAnticipationArming, AnticipationTier } from 'utils-slots';

import { stateGame } from './stateGame.svelte';
import {
	getActiveGameConfig,
	getNumLines,
	getPaylines,
	boardDimensions,
	activeBigTierThresholds,
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
 */

/** Build the reachable-win calculator from the FINAL revealed board + the active config. */
function buildReach(board: string[][]): {
	reach: AnticipationReach;
	triggerCount: number | undefined;
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

	const reach = createLinesReach({
		board,
		paylines: getPaylines(),
		payingSymbols: [...payBySymbol.keys()],
		linePay: (symbol, runLength) => payBySymbol.get(symbol)?.get(runLength) ?? 0,
		numLines: getNumLines(),
		isWild,
		isSpecial,
	});

	return { reach, triggerCount };
}

/** Coarse tier label from a stack level. */
function tierForLevel(level: number): AnticipationTier {
	if (level >= 3) return 'massive';
	if (level === 2) return 'mega';
	return 'big';
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

	const { reach, triggerCount } = buildReach(board);
	const bound = stateGame.anticipationConfidence === 'guaranteed' ? 'min' : 'max';
	const bigThresholds = activeBigTierThresholds();
	const smallestBig = bigThresholds[0];
	const minReel = stateGame.minAnticipateReel;

	return (reelIndex: number): ReelAnticipationArming | null => {
		if (reelIndex < minReel || reelIndex >= reach.numReels) return null;

		let level = 0;

		// Win-reach: arm once the reachable win clears the smallest big tier; stack a level per
		// further big threshold the reachable win still crosses.
		if (smallestBig !== undefined) {
			const win = reach.winBounds(reelIndex)[bound];
			if (win >= smallestBig) level = bigThresholds.filter((threshold) => win >= threshold).length;
		}

		// Trigger-reach: arm when the reachable special count can still reach the feature threshold.
		if (triggerCount !== undefined && triggerCount > 0) {
			const trigger = reach.triggerBounds(reelIndex)[bound];
			if (trigger >= triggerCount) level = Math.max(level, 1);
		}

		if (level <= 0) return null;
		return { level, tier: tierForLevel(level) };
	};
}
