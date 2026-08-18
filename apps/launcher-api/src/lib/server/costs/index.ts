/**
 * Admin → Costs: gathers every provider into one snapshot.
 *
 * Three properties this module exists to guarantee:
 *
 * 1. **Nothing here can break the admin page.** Each collector already degrades to a
 *    `{ ok: false }` card, and the `Promise.allSettled` below catches anything that
 *    still escapes. A billing dashboard must never be the reason user management is
 *    unreachable.
 * 2. **Opening the tab doesn't hammer four APIs.** Results are cached in-process for
 *    `TTL_MS`; the page has an explicit Refresh that bypasses it. In-process (not
 *    `app_settings`) because this is a read cache — a DB write on every page view to
 *    avoid four HTTP calls is the wrong trade, and a cold cache after a deploy just
 *    means one slower load.
 * 3. **Credit burndown is honest.** Only RunPod reports a real balance. For Anthropic
 *    the collector is asked for spend measured *from the first recorded top-up*, so
 *    "remaining" compares like with like instead of subtracting a fixed 30-day total
 *    from a credit added on some other date.
 */

import { collectAnthropic } from './anthropic';
import { listTopUps, totalToppedUp, type TopUpEntry } from './ledger';
import { collectR2 } from './r2';
import { collectRailway } from './railway';
import { collectRunpod } from './runpod';
import { failed, type ProviderCost, type ProviderId } from './types';

/** How long a snapshot stays fresh. Long enough that clicking around the admin tabs
 *  doesn't re-poll; short enough that Refresh is rarely needed. */
const TTL_MS = 10 * 60 * 1000;

export interface ProviderCredit {
	/** Total the admin has recorded adding, all time. */
	toppedUpUsd: number;
	/** Date of the earliest recorded top-up — the anchor spend is measured from. */
	since: Date | null;
	/**
	 * Estimated credit left: recorded top-ups minus measured spend since `since`.
	 * `null` when we can't compute it honestly — no ledger entry, no measured spend,
	 * or a provider whose spend window doesn't line up with the anchor.
	 */
	remainingUsd: number | null;
}

export interface CostsSnapshot {
	providers: ProviderCost[];
	credits: Record<string, ProviderCredit>;
	topUps: TopUpEntry[];
	/** When this snapshot was gathered. */
	fetchedAt: Date;
	/** True when served from cache rather than freshly fetched. */
	cached: boolean;
}

let cache: { snapshot: CostsSnapshot; expiresAt: number } | null = null;

/** Run a collector so that a thrown error becomes a card, never a page crash. */
async function safely(
	id: ProviderId,
	label: string,
	run: () => Promise<ProviderCost>,
): Promise<ProviderCost> {
	try {
		return await run();
	} catch (err) {
		console.warn(`[costs] ${id} collector threw:`, err instanceof Error ? err.message : err);
		return failed(id, label, 'The collector failed unexpectedly — see the server logs.');
	}
}

/**
 * Gather every provider. `force` skips the cache (the Refresh button).
 *
 * The ledger is read first because Anthropic's window depends on it: with a recorded
 * top-up we ask for spend since that date, otherwise the collector's own 30-day default.
 */
export async function getCosts(force = false): Promise<CostsSnapshot> {
	if (!force && cache && cache.expiresAt > Date.now()) {
		return { ...cache.snapshot, cached: true };
	}

	// A ledger read failure must not take the whole page down either — an empty ledger
	// just means no burndown, which is the same as never having recorded a top-up.
	let topUps: TopUpEntry[] = [];
	try {
		topUps = await listTopUps();
	} catch (err) {
		console.warn('[costs] ledger read failed:', err instanceof Error ? err.message : err);
	}

	const anchorFor = (provider: ProviderId): Date | null => {
		const dates = topUps.filter((t) => t.provider === provider).map((t) => t.occurredAt.getTime());
		return dates.length ? new Date(Math.min(...dates)) : null;
	};
	const anthropicAnchor = anchorFor('anthropic');

	const settled = await Promise.allSettled([
		safely('runpod', 'RunPod (GPU)', collectRunpod),
		safely('railway', 'Railway (services + Postgres)', collectRailway),
		safely('r2', 'Cloudflare R2 (assets)', collectR2),
		safely('anthropic', 'Anthropic (Claude API)', () =>
			collectAnthropic(anthropicAnchor ?? undefined),
		),
	]);
	const providers = settled
		.filter((r): r is PromiseFulfilledResult<ProviderCost> => r.status === 'fulfilled')
		.map((r) => r.value);

	const credits: Record<string, ProviderCredit> = {};
	for (const provider of providers) {
		const toppedUpUsd = totalToppedUp(topUps, provider.id);
		const since = anchorFor(provider.id);
		// Only derive "remaining" where the measured spend actually covers the period
		// since the anchor. Anthropic is asked for exactly that window, so it qualifies.
		// Railway (billing cycle) and R2 (rolling 30 days) do not, and RunPod reports a
		// real balance that beats any estimate — so those show the recorded total only.
		const comparable = provider.id === 'anthropic';
		const remainingUsd =
			comparable && since && toppedUpUsd > 0 && provider.ok && provider.spendUsd != null
				? toppedUpUsd - provider.spendUsd
				: null;
		credits[provider.id] = { toppedUpUsd, since, remainingUsd };
	}

	const snapshot: CostsSnapshot = {
		providers,
		credits,
		topUps,
		fetchedAt: new Date(),
		cached: false,
	};
	cache = { snapshot, expiresAt: Date.now() + TTL_MS };
	return snapshot;
}

/** Drop the cached snapshot so the next read re-polls (used after a ledger edit). */
export function invalidateCosts(): void {
	cache = null;
}

export type { ProviderCost, ProviderId } from './types';
export type { TopUpEntry } from './ledger';
