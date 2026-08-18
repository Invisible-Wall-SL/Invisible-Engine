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

import { ENV } from '../env';
import { collectAnthropic } from './anthropic';
import { listTopUps, totalToppedUp, type TopUpEntry } from './ledger';
import { collectOpenAI } from './openai';
import { collectR2 } from './r2';
import { collectRailway } from './railway';
import { collectRunpod } from './runpod';
import { failed, type ProviderCost, type ProviderId } from './types';

/**
 * Which LLM provider Localization actually spends at, mirroring the dispatch in
 * `translate.ts`: an OpenAI-COMPATIBLE endpoint wins whenever both
 * `LOCALIZATION_LLM_*` vars are set, and Anthropic is only the fallback.
 *
 * This drives which card is worth showing. Both providers report spend the same
 * way, so without this the dormant one sits on the page as a permanent
 * "not configured" card for a service nobody is being billed for.
 *
 * `'other'` is an OpenAI-compatible endpoint that ISN'T OpenAI (Google AI Studio,
 * a local gateway, …). Neither cost API applies there, so neither card is forced on.
 */
function translationProvider(): 'anthropic' | 'openai' | 'other' {
	const base = ENV.LOCALIZATION_LLM_BASE_URL.trim();
	if (!base || !ENV.LOCALIZATION_LLM_API_KEY) return 'anthropic';
	try {
		return /(^|\.)openai\.com$/i.test(new URL(base).hostname) ? 'openai' : 'other';
	} catch {
		// A malformed base URL is still a configured non-Anthropic path as far as
		// translate.ts is concerned; treat it as 'other' rather than throwing on a
		// page load over a typo in an env var.
		return 'other';
	}
}

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
	// Show an LLM card when it holds a key (someone deliberately wants to watch it)
	// OR when it is the provider translate.ts would actually dispatch to. Anything
	// else is a card for a bill that doesn't exist.
	const activeLlm = translationProvider();
	const showAnthropic = !!ENV.ANTHROPIC_ADMIN_API_KEY || activeLlm === 'anthropic';
	const showOpenAI = !!ENV.OPENAI_ADMIN_API_KEY || activeLlm === 'openai';

	const jobs: (() => Promise<ProviderCost>)[] = [
		() => safely('runpod', 'RunPod (GPU)', collectRunpod),
		() => safely('railway', 'Railway (services + Postgres)', collectRailway),
		() => safely('r2', 'Cloudflare R2 (assets)', collectR2),
	];
	if (showOpenAI) {
		jobs.push(() =>
			safely('openai', 'OpenAI (translations)', () =>
				collectOpenAI(anchorFor('openai') ?? undefined),
			),
		);
	}
	if (showAnthropic) {
		jobs.push(() =>
			safely('anthropic', 'Anthropic (Claude API)', () =>
				collectAnthropic(anchorFor('anthropic') ?? undefined),
			),
		);
	}

	const settled = await Promise.allSettled(jobs.map((job) => job()));
	const providers = settled
		.filter((r): r is PromiseFulfilledResult<ProviderCost> => r.status === 'fulfilled')
		.map((r) => r.value);

	const credits: Record<string, ProviderCredit> = {};
	for (const provider of providers) {
		const toppedUpUsd = totalToppedUp(topUps, provider.id);
		const since = anchorFor(provider.id);
		// Only derive "remaining" where the measured spend actually covers the period
		// since the anchor. Both LLM collectors take a `since` and are asked for exactly
		// that window, so they qualify. Railway (billing cycle) and R2 (rolling 30 days)
		// do not, and RunPod reports a real balance that beats any estimate — so those
		// show the recorded total only.
		const comparable = provider.id === 'anthropic' || provider.id === 'openai';
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
