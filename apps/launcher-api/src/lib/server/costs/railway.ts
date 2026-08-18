/**
 * Railway cost collector — the launcher, atlas-tool, atlas-backend, sheet-tool and
 * Postgres all bill here (one project, environment `production` — see docs/INFRA.md).
 *
 * Railway's public GraphQL API (https://backboard.railway.com/graphql/v2) is the same
 * API that powers their dashboard, and `estimatedUsage` is what the dashboard's
 * current-cycle cost panel reads. Railway does NOT document the usage/cost side of the
 * schema, so unlike the other collectors this query is written against the introspected
 * schema rather than a published reference: if Railway renames a field, the card shows
 * Railway's own GraphQL error text verbatim, which names the offending field and makes
 * it a one-line fix. That is deliberate — a silent $0 would be the worse failure.
 * Verify interactively at https://railway.com/graphiql.
 *
 * Auth note: account and workspace tokens use `Authorization: Bearer`; PROJECT tokens
 * use a `Project-Access-Token` header instead. This uses the Bearer form, so
 * `RAILWAY_API_TOKEN` must be an account or workspace token.
 */

import { ENV } from '../env';
import { failed, notConfigured, num, type CostLine, type ProviderCost } from './types';

const LABEL = 'Railway (services + Postgres)';
const ENDPOINT = 'https://backboard.railway.com/graphql/v2';

interface EstimatedUsage {
	measurement?: string;
	estimatedValue?: number | string | null;
}
interface GraphQlResponse {
	data?: { estimatedUsage?: EstimatedUsage[] | null } | null;
	errors?: { message?: string }[] | null;
}

/** `MEMORY_USAGE_GB` → `Memory usage gb`. Railway returns SCREAMING_SNAKE enum names. */
function humanize(measurement: string): string {
	const words = measurement.toLowerCase().replace(/_/g, ' ').trim();
	return words ? words[0].toUpperCase() + words.slice(1) : 'Usage';
}

export async function collectRailway(): Promise<ProviderCost> {
	const token = ENV.RAILWAY_API_TOKEN.trim();
	const projectId = ENV.RAILWAY_PROJECT_ID.trim();
	if (!token || !projectId) {
		return notConfigured(
			'railway',
			LABEL,
			['RAILWAY_API_TOKEN', 'RAILWAY_PROJECT_ID'],
			'Needs an account or workspace token (Railway → Account Settings → Tokens) and the project id from the Railway project URL.',
		);
	}

	const query = `query EstimatedUsage($projectId: String!) {
		estimatedUsage(projectId: $projectId) { measurement estimatedValue }
	}`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 20_000);
	let body: GraphQlResponse;
	try {
		const res = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ query, variables: { projectId } }),
			signal: controller.signal,
		});
		if (res.status === 401 || res.status === 403) {
			return failed(
				'railway',
				LABEL,
				`Railway rejected the token (${res.status}). Use an ACCOUNT or WORKSPACE token — a project token needs a different header and won't work here.`,
			);
		}
		if (!res.ok) return failed('railway', LABEL, `Railway returned HTTP ${res.status}.`);
		body = (await res.json()) as GraphQlResponse;
	} catch (err) {
		return failed(
			'railway',
			LABEL,
			err instanceof Error ? err.message : 'Could not reach the Railway API.',
		);
	} finally {
		clearTimeout(timer);
	}

	const gqlError = body.errors?.find((e) => e.message)?.message;
	if (gqlError) {
		return failed(
			'railway',
			LABEL,
			`Railway: ${gqlError.trim()} — check the query against https://railway.com/graphiql.`,
		);
	}

	const usage = body.data?.estimatedUsage ?? [];
	if (usage.length === 0) {
		return {
			id: 'railway',
			label: LABEL,
			configured: true,
			ok: true,
			reason: 'Railway reported no usage for this project in the current cycle.',
			balanceUsd: null,
			spendUsd: 0,
			spendWindow: 'current billing cycle',
			estimated: true,
			lines: [],
		};
	}

	let totalUsd = 0;
	const lines: CostLine[] = [];
	for (const entry of usage) {
		const value = num(entry.estimatedValue);
		if (value == null) continue;
		totalUsd += value;
		lines.push({ label: humanize(entry.measurement ?? ''), amountUsd: value });
	}
	lines.sort((a, b) => (b.amountUsd ?? 0) - (a.amountUsd ?? 0));

	return {
		id: 'railway',
		label: LABEL,
		configured: true,
		ok: true,
		reason: "Railway's own estimate for the current billing cycle, broken down by measurement.",
		// Railway has no prepaid balance — it bills a plan plus usage in arrears.
		balanceUsd: null,
		spendUsd: totalUsd,
		spendWindow: 'current billing cycle',
		estimated: true,
		lines,
	};
}
