import type { HoldAndWinJackpotLevel } from 'engine-game';

import { getActiveGameConfig } from './gameConfig';
import { recordHoldAndWinEvent, stateHoldAndWin } from './stateHoldAndWin.svelte';

/**
 * THE JACKPOT TIERS' VALUES as this game shows them — design §7 11c.
 *
 * A fixed tier is worth its Game Config `multiplier` × the bet. A PROGRESSIVE tier (`fixed: false`)
 * is worth its pool, which is SERVER state: it arrives at boot (the facade's
 * `__IE_HOLD_AND_WIN_JACKPOTS__`), with every play (`jackpotLevels`, recorded at the play seam) and on
 * a balance heartbeat between rounds (the facade's `ie:holdAndWinJackpots`). The client never grows
 * one; until the server has spoken, a progressive tier shows its multiplier, as it did before 11c.
 */

const levelOf = (tier: string): HoldAndWinJackpotLevel | undefined =>
	stateHoldAndWin.jackpots.find(({ name }) => name.toLowerCase() === tier.toLowerCase());

/** A tier's worth × total bet — its live pool when progressive, else its multiplier. 0 when the Game
 *  Config names no such tier. */
export const jackpotMultiplier = (tier: string): number => {
	const jackpot = getActiveGameConfig().holdAndWin?.jackpots.find(
		({ name }) => name.toLowerCase() === tier.toLowerCase(),
	);
	if (!jackpot) return 0;
	return (!jackpot.fixed && levelOf(tier)?.value) || jackpot.multiplier;
};

const readGlobal = (): HoldAndWinJackpotLevel[] | undefined =>
	(globalThis as { __IE_HOLD_AND_WIN_JACKPOTS__?: HoldAndWinJackpotLevel[] })
		.__IE_HOLD_AND_WIN_JACKPOTS__;

const record = (jackpots: HoldAndWinJackpotLevel[] | undefined) => {
	if (Array.isArray(jackpots) && jackpots.length > 0) {
		recordHoldAndWinEvent({ type: 'jackpotLevels', jackpots });
	}
};

/**
 * Seed the pools from the boot levels, once, at game start, and follow the heartbeat's refreshes
 * from then on. A no-op without the global (every server with no progressive tier). A resume that
 * already replayed a `jackpotLevels` keeps it: the server's later word wins. Returns the unsubscribe.
 */
export const seedHoldAndWinJackpots = (): (() => void) => {
	if (stateHoldAndWin.jackpots.length === 0) record(readGlobal());
	const refresh = (event: Event) => record((event as CustomEvent<HoldAndWinJackpotLevel[]>).detail);
	globalThis.addEventListener?.('ie:holdAndWinJackpots', refresh);
	return () => globalThis.removeEventListener?.('ie:holdAndWinJackpots', refresh);
};
