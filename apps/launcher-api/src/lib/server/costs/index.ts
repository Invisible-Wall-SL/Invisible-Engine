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
 * 3. **One window, not several.** Every collector reports MONTH-TO-DATE against the
 *    Madrid calendar month, so the live cards and the current row of the monthly
 *    table are the same number. Windows that drifted per provider (a rolling 30 days
 *    here, a billing cycle there) would make the two disagree with no way to tell
 *    which was right.
 */

import { ENV } from '../env';
import { collectAnthropic } from './anthropic';
import { usdToEur, type FxRate } from './fx';
import {
	listMonths,
	madridMonth,
	madridMonthProgress,
	recordAndLock,
	startOfMadridMonth,
	summarize,
	type YearSummary,
} from './months';
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

export interface CostsSnapshot {
	providers: ProviderCost[];
	/** Monthly history grouped into calendar years, newest first. */
	years: YearSummary[];
	/** The Madrid calendar month currently open (its row is still moving). */
	openMonth: { year: number; month: number };
	/**
	 * USD→EUR for the secondary figures. `null` when the rate couldn't be fetched —
	 * the page then shows dollars only rather than converting at a stale guess.
	 */
	fx: FxRate | null;
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
 * Gather every provider, record the open month, and return the whole picture.
 * `force` skips the cache (the Refresh button).
 */
export async function getCosts(force = false): Promise<CostsSnapshot> {
	if (!force && cache && cache.expiresAt > Date.now()) {
		return { ...cache.snapshot, cached: true };
	}

	const now = new Date();
	const openMonth = madridMonth(now);
	const monthStart = startOfMadridMonth(openMonth);
	const progress = madridMonthProgress(now);

	// Show an LLM card when it holds a key (someone deliberately wants to watch it)
	// OR when it is the provider translate.ts would actually dispatch to. Anything
	// else is a card for a bill that doesn't exist.
	const activeLlm = translationProvider();
	const showAnthropic = !!ENV.ANTHROPIC_ADMIN_API_KEY || activeLlm === 'anthropic';
	const showOpenAI = !!ENV.OPENAI_ADMIN_API_KEY || activeLlm === 'openai';

	const jobs: (() => Promise<ProviderCost>)[] = [
		() => safely('runpod', 'RunPod (GPU)', collectRunpod),
		() => safely('railway', 'Railway (services + Postgres)', collectRailway),
		() => safely('r2', 'Cloudflare R2 (assets)', () => collectR2(monthStart, progress)),
	];
	if (showOpenAI) {
		jobs.push(() => safely('openai', 'OpenAI (translations)', () => collectOpenAI(monthStart)));
	}
	if (showAnthropic) {
		jobs.push(() =>
			safely('anthropic', 'Anthropic (Claude API)', () => collectAnthropic(monthStart)),
		);
	}

	// The FX lookup rides along with the provider calls rather than adding a step —
	// it's a third-party HTTP call like the rest, and it already fails to `null`.
	const [settled, fx] = await Promise.all([
		Promise.allSettled(jobs.map((job) => job())),
		usdToEur().catch(() => null),
	]);
	const providers = settled
		.filter((r): r is PromiseFulfilledResult<ProviderCost> => r.status === 'fulfilled')
		.map((r) => r.value);

	// Persist the open month and freeze any month that has ended. Only providers that
	// actually reported a figure are written — a provider that errored this cycle must
	// not overwrite a good running total with 0.
	let years: YearSummary[] = [];
	try {
		await recordAndLock(
			providers
				.filter((p) => p.ok && (p.spendUsd != null || p.ratePerHourUsd != null))
				// A provider that publishes a period total gets it written straight in;
				// one that only publishes a burn rate (RunPod) is integrated across the
				// gap instead, so its month stops reading as nothing at all.
				.map((p) => ({
					provider: p.id,
					spendUsd: p.spendUsd,
					ratePerHourUsd: p.ratePerHourUsd,
				})),
			now,
		);
		years = summarize(await listMonths());
	} catch (err) {
		// The monthly table is a reporting surface layered on top of the live cards;
		// losing it must never take them down with it.
		console.warn('[costs] monthly rollup failed:', err instanceof Error ? err.message : err);
	}

	const snapshot: CostsSnapshot = {
		providers,
		years,
		openMonth,
		fx,
		fetchedAt: now,
		cached: false,
	};
	cache = { snapshot, expiresAt: Date.now() + TTL_MS };
	return snapshot;
}

/** Drop the cached snapshot so the next read re-polls (used after an edit). */
export function invalidateCosts(): void {
	cache = null;
}

export type { ProviderCost, ProviderId } from './types';
export type { FxRate } from './fx';
export type { MonthSummary, YearSummary } from './months';
