/**
 * USD → EUR for the Costs page's secondary figures.
 *
 * Every provider on this page bills in USD (RunPod, Railway, Cloudflare, OpenAI,
 * Anthropic all quote dollars), so EUR is a *display* conversion, never a source
 * figure. The card shows both, with the rate and its date printed alongside — a
 * converted number whose rate you can't see is a number you can't check against
 * an invoice.
 *
 * Source: Frankfurter, which serves the **ECB reference rates** — free, no key, no
 * attribution requirement. Note `api.frankfurter.app` now 301-redirects; `.dev` is
 * the live host.
 *
 * ECB publishes once per working day around 16:00 CET, so `date` is frequently
 * *yesterday* and will sit still over a weekend. That's expected, and is exactly
 * why the date is surfaced instead of implying a live tick.
 *
 * Fails to `null` — a missing rate hides the EUR column rather than falling back to
 * a hardcoded rate, because a silently stale multiplier is worse than no euros at
 * all on a page people reconcile against real bills.
 */

const ENDPOINT = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR';

export interface FxRate {
	/** Multiply USD by this to get EUR. */
	rate: number;
	/** ECB publication date of the rate, `YYYY-MM-DD`. */
	date: string;
	source: string;
}

interface FrankfurterResponse {
	base?: string;
	date?: string;
	rates?: Record<string, number>;
}

export async function usdToEur(): Promise<FxRate | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 10_000);
	try {
		const res = await fetch(ENDPOINT, {
			headers: { accept: 'application/json' },
			signal: controller.signal,
		});
		if (!res.ok) return null;
		const body = (await res.json()) as FrankfurterResponse;
		const rate = body.rates?.EUR;
		// A zero or negative rate would silently zero out every euro figure, so treat
		// anything non-positive as no rate at all.
		if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
		return {
			rate,
			date: typeof body.date === 'string' ? body.date : '',
			source: 'ECB via Frankfurter',
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
