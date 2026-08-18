/**
 * OpenAI cost collector — the provider actually doing Localization's translations.
 *
 * `translate.ts` dispatches to an **OpenAI-compatible** endpoint whenever
 * `LOCALIZATION_LLM_BASE_URL` + `LOCALIZATION_LLM_API_KEY` are set, and only falls
 * back to Anthropic when they are not. So this card, not the Anthropic one, is the
 * live translation spend here.
 *
 * Reads the Admin API cost report:
 *   GET https://api.openai.com/v1/organization/costs
 *
 * Differences from the Anthropic collector that matter, both verified rather than
 * assumed (the Anthropic one hides a cents-vs-dollars trap, so neither was guessed):
 *
 * - `amount.value` is in **DOLLARS as a number** (`0.06` = six cents). Anthropic's
 *   `amount` is cents-as-a-decimal-string. Do not copy the /100 across.
 * - `start_time` is **Unix SECONDS**, not RFC 3339.
 * - Auth is `Authorization: Bearer`, not `x-api-key`.
 * - The key must be an **Admin** key (`sk-admin-…`), created by an organization
 *   *Owner* at platform.openai.com. A normal `sk-proj-…` key gets 401.
 *
 * As with Anthropic there is **no credit-balance endpoint**, so remaining prepaid
 * credit comes from the top-up ledger, never from here.
 */

import { ENV } from '../env';
import { failed, notConfigured, num, type CostLine, type ProviderCost } from './types';

const LABEL = 'OpenAI (translations)';
const ENDPOINT = 'https://api.openai.com/v1/organization/costs';
const WINDOW_DAYS = 30;
/** Cost buckets are daily and the API caps how far back one page reaches. */
const MAX_WINDOW_DAYS = 180;

interface CostResult {
	amount?: { value?: number | string; currency?: string };
	line_item?: string | null;
	project_id?: string | null;
}
interface CostBucket {
	results?: CostResult[];
}
interface CostReport {
	data?: CostBucket[];
	has_more?: boolean;
	next_page?: string | null;
	error?: { message?: string; type?: string };
}

/**
 * @param since Start of the window — the ledger passes the first recorded top-up so
 *   the burndown measures spend over exactly the period the credit covers.
 */
export async function collectOpenAI(since?: Date): Promise<ProviderCost> {
	const key = ENV.OPENAI_ADMIN_API_KEY;
	if (!key) {
		return notConfigured(
			'openai',
			LABEL,
			['OPENAI_ADMIN_API_KEY'],
			'Needs an OpenAI ADMIN key (sk-admin-…) from platform.openai.com → Settings → Organization → Admin keys. ' +
				'Only an organization Owner can create one, and it is a different credential from the project key Localization translates with.',
		);
	}

	const floor = new Date(Date.now() - MAX_WINDOW_DAYS * 86_400_000);
	const requested = since ?? new Date(Date.now() - WINDOW_DAYS * 86_400_000);
	const startingAt = new Date(Math.max(requested.getTime(), floor.getTime()));
	startingAt.setUTCHours(0, 0, 0, 0);
	const windowDays = Math.max(1, Math.round((Date.now() - startingAt.getTime()) / 86_400_000));

	function buildUrl(withGrouping: boolean): URL {
		const url = new URL(ENDPOINT);
		// Unix SECONDS — passing milliseconds silently asks for a window ~55,000 years
		// wide and returns nothing useful.
		url.searchParams.set('start_time', String(Math.floor(startingAt.getTime() / 1000)));
		url.searchParams.set('bucket_width', '1d');
		url.searchParams.set('limit', String(Math.min(windowDays + 1, MAX_WINDOW_DAYS)));
		if (withGrouping) url.searchParams.set('group_by', 'line_item');
		return url;
	}

	async function read(url: URL): Promise<{ status: number; report: CostReport | null }> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 20_000);
		try {
			const res = await fetch(url, {
				headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
				signal: controller.signal,
			});
			const text = await res.text();
			try {
				return { status: res.status, report: JSON.parse(text) as CostReport };
			} catch {
				return { status: res.status, report: null };
			}
		} finally {
			clearTimeout(timer);
		}
	}

	let status: number;
	let report: CostReport | null;
	try {
		// Ask for the per-line-item breakdown, but treat grouping as optional: if the
		// param shape is rejected, a correct TOTAL with no breakdown still beats a dead
		// card, so retry once without it.
		({ status, report } = await read(buildUrl(true)));
		if (status >= 400) ({ status, report } = await read(buildUrl(false)));
	} catch (err) {
		return failed(
			'openai',
			LABEL,
			err instanceof Error ? err.message : 'Could not reach the OpenAI Admin API.',
		);
	}

	if (status === 401 || status === 403) {
		return failed(
			'openai',
			LABEL,
			`OpenAI rejected the key (${status}). The cost endpoint needs an ADMIN key (sk-admin-…) created by an organization Owner — a project key (sk-proj-…) cannot read it.`,
		);
	}
	if (status >= 400 || !report) {
		const detail = report?.error?.message?.trim();
		return failed(
			'openai',
			LABEL,
			detail ? `OpenAI: ${detail}` : `OpenAI returned HTTP ${status}.`,
		);
	}

	let totalUsd = 0;
	const byLineItem = new Map<string, number>();
	for (const bucket of report.data ?? []) {
		for (const result of bucket.results ?? []) {
			// Already dollars — no /100 here, unlike the Anthropic collector.
			const dollars = num(result.amount?.value) ?? 0;
			totalUsd += dollars;
			const name = result.line_item?.trim() || 'Usage';
			byLineItem.set(name, (byLineItem.get(name) ?? 0) + dollars);
		}
	}

	const lines: CostLine[] = [...byLineItem.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 12)
		.map(([label, amountUsd]) => ({ label, amountUsd }));

	const reason = report.has_more
		? 'Showing the first page of the window — the true total is higher.'
		: lines.length === 0
			? `No OpenAI spend in the last ${windowDays} days.`
			: undefined;

	return {
		id: 'openai',
		label: LABEL,
		configured: true,
		ok: true,
		reason,
		// No balance endpoint — the ledger derives remaining credit downstream.
		balanceUsd: null,
		spendUsd: totalUsd,
		spendWindow: since
			? `since ${startingAt.toISOString().slice(0, 10)}`
			: `last ${windowDays} days`,
		lines,
	};
}
