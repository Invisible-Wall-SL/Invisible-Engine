/**
 * Anthropic (agents) cost collector — Invisible Director's own Claude spend (ADR-0006).
 *
 * Reads our ledger (`director_spend`), not an Anthropic API: the org-wide cost report can't
 * tell agent spend from translation spend, so the worker records each Messages response's
 * `usage`, priced at write time from `pricing.json` (or the Admin override). This card sums
 * the `claude` rows month-to-date; GPU rows are left to the RunPod card, whose balance they
 * already drain.
 *
 * Always configured — the ledger is our own table. An empty month is a real $0.
 */

import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { directorSpend } from '../db/schema';
import { getDirectorPricing } from './pricingConfig';
import { INCLUDED_IN, type CostLine, type ProviderCost } from './types';

const LABEL = 'Anthropic (agents)';
/** How many runs the "Top runs" breakdown lists. */
const TOP_RUNS = 5;

export async function collectAnthropicAgents(since: Date): Promise<ProviderCost> {
	const db = getDb();
	const usd = sql<number>`coalesce(sum(${directorSpend.usd}), 0)`.mapWith(Number);
	const monthToDate = and(eq(directorSpend.kind, 'claude'), gte(directorSpend.at, since));

	const [byAgent, topRuns, pricing] = await Promise.all([
		db
			.select({ agent: directorSpend.agent, usd, calls: count() })
			.from(directorSpend)
			.where(monthToDate)
			.groupBy(directorSpend.agent)
			.orderBy(desc(usd)),
		db
			.select({ runId: directorSpend.runId, usd, calls: count() })
			.from(directorSpend)
			.where(monthToDate)
			.groupBy(directorSpend.runId)
			.orderBy(desc(usd))
			.limit(TOP_RUNS),
		getDirectorPricing(),
	]);

	const calls = (n: number): string => `${n} call${n === 1 ? '' : 's'}`;
	const agentLines: CostLine[] = byAgent.map((row) => ({
		label: row.agent,
		amountUsd: row.usd,
		detail: calls(row.calls),
	}));
	const runLines: CostLine[] = topRuns.map((row) => ({
		label: row.runId,
		amountUsd: row.usd,
		detail: calls(row.calls),
	}));
	const totalUsd = byAgent.reduce((sum, row) => sum + row.usd, 0);

	const priced =
		pricing.source === 'override'
			? 'Calls are priced when recorded, from pricing.json under the Admin override.'
			: 'Calls are priced when recorded, from services/director-worker/pricing.json.';
	const note = pricing.overrideError
		? `${priced} The stored override was ignored: ${pricing.overrideError}`
		: priced;

	return {
		id: 'anthropicAgents',
		label: LABEL,
		configured: true,
		ok: true,
		reason: byAgent.length === 0 ? 'No Director agent spend this month.' : undefined,
		note,
		balanceUsd: null,
		spendUsd: totalUsd,
		spendWindow: 'this month',
		includedIn: INCLUDED_IN.anthropicAgents,
		lines: [],
		sections: [
			{ title: 'By agent', lines: agentLines },
			{ title: 'Top runs', lines: runLines },
		].filter((section) => section.lines.length > 0),
	};
}
