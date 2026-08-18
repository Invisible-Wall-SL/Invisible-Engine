/**
 * Anthropic (Claude) cost collector — powers the Localization tool's auto-translate.
 *
 * Reads the Admin API cost report:
 *   GET https://api.anthropic.com/v1/organizations/cost_report
 *
 * Two things about this API that are easy to get wrong, both verified against the docs:
 *
 * 1. **`amount` is in the LOWEST currency unit (cents), as a decimal STRING.** The docs
 *    spell it out: `"123.45"` in `"USD"` is $1.23. Reading it as dollars overstates
 *    every figure by 100×, so the division below is load-bearing.
 * 2. **The key is a separate ADMIN key** (`sk-ant-admin…`), not the `ANTHROPIC_API_KEY`
 *    that translate.ts spends with. A normal key gets 401 here.
 *
 * There is NO credit-balance endpoint — Anthropic reports spend only. Remaining prepaid
 * credit therefore comes from the top-up ledger (`costs/ledger.ts`), never from here.
 */

import { ENV } from '../env';
import { failed, notConfigured, type CostLine, type ProviderCost } from './types';

const LABEL = 'Anthropic (Claude API)';
const ENDPOINT = 'https://api.anthropic.com/v1/organizations/cost_report';
/** How far back to sum. One month is the window an admin reconciles against. */
const WINDOW_DAYS = 30;

interface CostResult {
	amount?: string;
	currency?: string;
	description?: string | null;
	model?: string | null;
	cost_type?: string | null;
}

interface CostBucket {
	starting_at?: string;
	ending_at?: string;
	results?: CostResult[];
}

interface CostReport {
	data?: CostBucket[];
	has_more?: boolean;
	next_page?: string | null;
}

/** Cents-as-decimal-string → dollars. Returns 0 for anything unparseable. */
function centsToUsd(amount: string | undefined): number {
	const n = Number(amount);
	return Number.isFinite(n) ? n / 100 : 0;
}

/** Cost reports get expensive to page far back; cap the window we'll ever ask for. */
const MAX_WINDOW_DAYS = 365;

/**
 * @param since Start of the window — the current Madrid month, so this card and the
 *   monthly table report the same number rather than two drifting windows.
 */
export async function collectAnthropic(since?: Date): Promise<ProviderCost> {
	const key = ENV.ANTHROPIC_ADMIN_API_KEY;
	if (!key) {
		return notConfigured(
			'anthropic',
			LABEL,
			['ANTHROPIC_ADMIN_API_KEY'],
			'Needs an Anthropic ADMIN key (sk-ant-admin…) from Console → Settings → Admin keys. ' +
				'This is a different credential from ANTHROPIC_API_KEY — the admin key only reads usage, it cannot spend.',
		);
	}

	const floor = new Date(Date.now() - MAX_WINDOW_DAYS * 86_400_000);
	const requested = since ?? new Date(Date.now() - WINDOW_DAYS * 86_400_000);
	const startingAt = new Date(Math.max(requested.getTime(), floor.getTime()));
	startingAt.setUTCHours(0, 0, 0, 0);
	const windowDays = Math.max(1, Math.round((Date.now() - startingAt.getTime()) / 86_400_000));

	// Group by description so the breakdown names the models and cost types rather
	// than showing one opaque total.
	const url = new URL(ENDPOINT);
	url.searchParams.set('starting_at', startingAt.toISOString());
	url.searchParams.set('bucket_width', '1d');
	url.searchParams.set('group_by[]', 'description');
	url.searchParams.set('limit', String(Math.min(windowDays + 1, 366)));

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 20_000);
	let report: CostReport;
	try {
		const res = await fetch(url, {
			headers: {
				'x-api-key': key,
				'anthropic-version': '2023-06-01',
				accept: 'application/json',
			},
			signal: controller.signal,
		});
		if (res.status === 401 || res.status === 403) {
			return failed(
				'anthropic',
				LABEL,
				`Anthropic rejected the key (${res.status}). The cost report needs an ADMIN key (sk-ant-admin…), not a regular API key.`,
			);
		}
		if (!res.ok) {
			return failed('anthropic', LABEL, `Anthropic returned HTTP ${res.status}.`);
		}
		report = (await res.json()) as CostReport;
	} catch (err) {
		return failed(
			'anthropic',
			LABEL,
			err instanceof Error ? err.message : 'Could not reach the Anthropic Admin API.',
		);
	} finally {
		clearTimeout(timer);
	}

	// Sum the window and roll the per-bucket results up by description, so the
	// breakdown is "what did we spend it on" rather than one row per day.
	let totalUsd = 0;
	const byDescription = new Map<string, number>();
	for (const bucket of report.data ?? []) {
		for (const result of bucket.results ?? []) {
			const dollars = centsToUsd(result.amount);
			totalUsd += dollars;
			const name =
				result.description?.trim() ||
				[result.model, result.cost_type].filter(Boolean).join(' · ') ||
				'Usage';
			byDescription.set(name, (byDescription.get(name) ?? 0) + dollars);
		}
	}

	const lines: CostLine[] = [...byDescription.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 12)
		.map(([label, amountUsd]) => ({ label, amountUsd }));

	// `has_more` means the window didn't fit in one page — say so rather than
	// presenting a partial sum as the total.
	const reason = report.has_more
		? 'Showing the first page of the window — the true total is higher.'
		: lines.length === 0
			? `No Claude API spend in the last ${windowDays} days.`
			: undefined;

	return {
		id: 'anthropic',
		label: LABEL,
		configured: true,
		ok: true,
		reason,
		// Anthropic exposes no balance endpoint; the ledger fills this in downstream.
		balanceUsd: null,
		spendUsd: totalUsd,
		spendWindow: since ? 'this month' : `last ${windowDays} days`,
		lines,
	};
}
