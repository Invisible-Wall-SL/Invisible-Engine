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

	/**
	 * POST a GraphQL document. Returns the parsed body whatever the status code:
	 * a GraphQL server answers a malformed query with **400 plus an `errors[]`
	 * naming the field**, so bailing on `!res.ok` before reading the body discards
	 * the only diagnostic there is (which is exactly how this card first shipped —
	 * it reported a bare "HTTP 400" and told us nothing).
	 */
	async function post(
		query: string,
		variables?: Record<string, unknown>,
	): Promise<{ status: number; body: GraphQlResponse | null; transportError?: string }> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 20_000);
		try {
			const res = await fetch(ENDPOINT, {
				method: 'POST',
				headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
				body: JSON.stringify({ query, variables }),
				signal: controller.signal,
			});
			const text = await res.text();
			try {
				return { status: res.status, body: JSON.parse(text) as GraphQlResponse };
			} catch {
				return { status: res.status, body: null };
			}
		} catch (err) {
			return {
				status: 0,
				body: null,
				transportError: err instanceof Error ? err.message : 'Could not reach the Railway API.',
			};
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Railway does not publish the usage half of its schema, so when the query fails
	 * we ask the schema itself which root fields look usage-shaped and put them in
	 * the card. That turns a dead end into the exact name to use — far better than
	 * guessing a second time and shipping another blind query.
	 */
	async function suggestFields(): Promise<string> {
		const { body } = await post(`query { __schema { queryType { fields { name } } } }`);
		const data = body?.data as
			| { __schema?: { queryType?: { fields?: { name?: string }[] } } }
			| undefined;
		const names = (data?.__schema?.queryType?.fields ?? [])
			.map((f) => f.name ?? '')
			.filter((n) => /usage|cost|estimate|billing|metric/i.test(n));
		return names.length
			? ` Root fields on Railway's schema that look related: ${names.join(', ')}.`
			: '';
	}

	/**
	 * `estimatedUsage` requires `measurements: [MetricMeasurement!]!`. Rather than
	 * hardcode an enum Railway doesn't publish, ask the schema for its members and
	 * request all of them — that stays correct when Railway adds or renames one.
	 * Falls back to the measurements the dashboard bills on if introspection is
	 * unavailable.
	 */
	async function measurementNames(): Promise<string[]> {
		const { body } = await post(
			`query { __type(name: "MetricMeasurement") { enumValues { name } } }`,
		);
		const data = body?.data as { __type?: { enumValues?: { name?: string }[] } } | undefined;
		const names = (data?.__type?.enumValues ?? []).map((v) => v.name ?? '').filter(Boolean);
		return names.length
			? names
			: ['CPU_USAGE', 'MEMORY_USAGE_GB', 'NETWORK_TX_GB', 'DISK_USAGE_GB'];
	}

	const measurements = await measurementNames();
	const query = `query EstimatedUsage($projectId: String!, $measurements: [MetricMeasurement!]!) {
		estimatedUsage(projectId: $projectId, measurements: $measurements) {
			measurement
			estimatedValue
		}
	}`;

	const { status, body, transportError } = await post(query, { projectId, measurements });
	if (transportError) return failed('railway', LABEL, transportError);
	if (status === 401 || status === 403) {
		return failed(
			'railway',
			LABEL,
			`Railway rejected the token (${status}). Use an ACCOUNT or WORKSPACE token — a project token authenticates with a Project-Access-Token header and won't work here.`,
		);
	}
	if (!body) {
		return failed('railway', LABEL, `Railway returned HTTP ${status} with an unreadable body.`);
	}

	const gqlError = body.errors?.find((e) => e.message)?.message;
	if (gqlError) {
		return failed(
			'railway',
			LABEL,
			`Railway: ${gqlError.trim()}${await suggestFields()} Verify at https://railway.com/graphiql.`,
		);
	}
	if (status >= 400) {
		return failed(
			'railway',
			LABEL,
			`Railway returned HTTP ${status} with no error detail.${await suggestFields()}`,
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

	// `estimatedValue` is denominated per MEASUREMENT: a dollar figure for the
	// cost-ish members, but raw units (vCPU, GB, GB-egress) for the rest. Adding
	// those together would produce a confident-looking number that means nothing,
	// so only cost-denominated measurements feed the total; the rest are shown as
	// usage lines with no price. If Railway exposes no cost measurement at all, the
	// card reports usage and NO dollar figure rather than inventing one.
	const isCost = (name: string) => /COST|CREDIT|SPEND|USD|CHARGE|PRICE/i.test(name);

	let totalUsd = 0;
	let sawCost = false;
	const lines: CostLine[] = [];
	for (const entry of usage) {
		const value = num(entry.estimatedValue);
		if (value == null) continue;
		const name = entry.measurement ?? '';
		if (isCost(name)) {
			sawCost = true;
			totalUsd += value;
			lines.push({ label: humanize(name), amountUsd: value });
		} else {
			lines.push({
				label: humanize(name),
				amountUsd: null,
				detail: value.toLocaleString('en-US', { maximumFractionDigits: 2 }),
			});
		}
	}
	lines.sort((a, b) => (b.amountUsd ?? -1) - (a.amountUsd ?? -1));

	return {
		id: 'railway',
		label: LABEL,
		configured: true,
		ok: true,
		reason: sawCost
			? "Railway's own estimate for the current billing cycle."
			: 'Railway reports usage per measurement for this project, not a dollar figure — the lines below are raw units, so no total is shown.',
		// Railway has no prepaid balance — it bills a plan plus usage in arrears.
		balanceUsd: null,
		spendUsd: sawCost ? totalUsd : null,
		spendWindow: 'current billing cycle',
		estimated: true,
		lines,
	};
}
