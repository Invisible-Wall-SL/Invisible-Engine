import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { formatWinText, platformJackpotCaption } from 'engine-layout';
import { stateBet } from 'state-shared';
import { bookEventAmountToCurrencyString } from 'utils-shared/amount';

import { bakedWinText } from '../editor-scenes';
import { eventEmitter } from './eventEmitter';
import { hideHoldAndWinBanner, showHoldAndWinBanner } from './holdAndWinBanner.svelte';
import { waitPresentation } from './unskippablePresentation';

/**
 * THE OPERATOR PLATFORM JACKPOT as this game shows it — design `docs/design/hold-and-win.md` §7 11c.
 * Kind-independent: any game whose server's platform runs one carries it.
 *
 * The tiers' values are the PLATFORM's: the facade publishes them from every answer, the balance
 * heartbeat's included (`__IE_PLATFORM_JACKPOTS__` at boot, `ie:platformJackpots` after), and they
 * are money — engine units like a balance, not a multiple of the bet. A hit arrives as the book event
 * `platformJackpotWin {tier, amount}` after the round's own wins; the facade holds its money back from
 * the shown balance until {@link presentPlatformJackpotWin} has celebrated it and releases it.
 * A server with no platform jackpot publishes nothing: nothing here draws, and its four standard
 * value sources read 0.
 */

/** A platform tier as the facade publishes it: money in engine (API) units. */
export type PlatformJackpotLevel = { name: string; value: number; min?: number; max?: number };

/** The tiers the coded Platform Jackpot Bar and the four standard value sources name. */
export const PLATFORM_JACKPOT_TIERS = ['mini', 'minor', 'major', 'grand'] as const;

export const statePlatformJackpots = $state({ tiers: [] as PlatformJackpotLevel[] });

/** A tier's value in currency (what a readout formats), or 0 when the platform has no such tier. */
export const platformJackpotValue = (tier: string): number => {
	const level = statePlatformJackpots.tiers.find(
		({ name }) => name.toLowerCase() === tier.toLowerCase(),
	);
	return level ? level.value / API_AMOUNT_MULTIPLIER : 0;
};

/** True once the platform has reported its tiers — the bar's natural gate. */
export const platformJackpotsLive = (): boolean => statePlatformJackpots.tiers.length > 0;

const record = (tiers: PlatformJackpotLevel[] | undefined) => {
	if (Array.isArray(tiers) && tiers.length > 0) statePlatformJackpots.tiers = tiers;
};

/**
 * Seed the tiers from the facade's boot answer and follow every later one. Returns the unsubscribe.
 * A no-op without the global (every server with no platform jackpot).
 */
export const seedPlatformJackpots = (): (() => void) => {
	record(
		(globalThis as { __IE_PLATFORM_JACKPOTS__?: PlatformJackpotLevel[] }).__IE_PLATFORM_JACKPOTS__,
	);
	const refresh = (event: Event) => record((event as CustomEvent<PlatformJackpotLevel[]>).detail);
	globalThis.addEventListener?.('ie:platformJackpots', refresh);
	return () => globalThis.removeEventListener?.('ie:platformJackpots', refresh);
};

const PLATFORM_JACKPOT_HOLD_MS = 3_000;

/**
 * Let the held win into the shown balance: the facade stops holding it back
 * (`__IE_PLATFORM_JACKPOT_RELEASE__`, which answers with the money it held) and the balance readout
 * moves by exactly that. A transport that holds nothing answers 0 and nothing moves.
 */
export const releaseHeldPlatformJackpotWin = () => {
	const release = (globalThis as { __IE_PLATFORM_JACKPOT_RELEASE__?: () => number })
		.__IE_PLATFORM_JACKPOT_RELEASE__;
	const held = release?.() ?? 0;
	if (held > 0) stateBet.balanceAmount += held / API_AMOUNT_MULTIPLIER;
};

/**
 * `platformJackpotWin` — the coded default celebration, outside any feature: the large jackpot
 * banner (the same one, and the same authored `jackpotWin` screen, a Hold and Win jackpot uses) with
 * the tier and the amount, then the held win released into the balance. The `platformJackpotCelebration`
 * cue goes out first, for authored sound and FX. The release runs however the beat ends, so a
 * celebration cut short never leaves the balance short.
 */
export const presentPlatformJackpotWin = async (event: { tier: string; amount: number }) => {
	try {
		eventEmitter.broadcast({
			type: 'platformJackpotCelebration',
			tier: event.tier,
			amount: event.amount,
			scope: event.tier,
		});
		const resolved = bakedWinText();
		const banner = showHoldAndWinBanner({
			kind: 'jackpot',
			title: formatWinText(resolved.platformJackpot.award, {
				jackpot: platformJackpotCaption(resolved, event.tier),
			}),
			detail: formatWinText(resolved.platformJackpot.awardDetail, {
				amount: bookEventAmountToCurrencyString(event.amount),
			}),
			size: 'large',
		});
		await waitPresentation(PLATFORM_JACKPOT_HOLD_MS);
		hideHoldAndWinBanner(banner);
	} finally {
		releaseHeldPlatformJackpotWin();
	}
};
