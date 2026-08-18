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

/** A GraphQL introspection type reference — recursive through `ofType`. */
interface TypeRef {
	kind?: string;
	name?: string | null;
	ofType?: TypeRef | null;
}

/**
 * Railway's published rates, and the unit each measurement is actually in.
 *
 * Railway's API returns **no cost measurement** — its enum is `CPU_USAGE`,
 * `MEMORY_USAGE_GB`, `NETWORK_TX_GB`, … with nothing denominated in money. The
 * dashboard prices those units client-side, so we do the same.
 *
 * The units are NOT what the names suggest: `MEMORY_USAGE_GB` is GB-**minutes** and
 * `CPU_USAGE` is vCPU-**minutes** (integrated over the period), while `NETWORK_TX_GB`
 * really is plain GB. That was confirmed by reconciling a live read against Railway's
 * own dashboard for the same project: 31,244 GB-min × $0.000231 = $7.22 memory,
 * 35.96 GB × $0.05 = $1.80 network, 31,863 GB-min volume = $0.11, 116.48 vCPU-min =
 * $0.05 CPU — $9.18 against the dashboard's $9.22 estimate, a 0.4% match.
 *
 * Like the R2 rates, this is a PRICE LIST IN CODE and will go stale silently when
 * Railway changes it, so each line prints the rate it used. Re-check against
 * https://railway.com/pricing.
 */
const RATES: Record<string, { usdPerUnit: number; unit: string }> = {
	CPU_USAGE: { usdPerUnit: 0.000463, unit: 'vCPU-min' },
	MEMORY_USAGE_GB: { usdPerUnit: 0.000231, unit: 'GB-min' },
	NETWORK_TX_GB: { usdPerUnit: 0.05, unit: 'GB' },
	// $0.15/GB-month ÷ (60 × 24 × 30.4) minutes.
	DISK_USAGE_GB: { usdPerUnit: 0.15 / 43_800, unit: 'GB-min' },
	EPHEMERAL_DISK_USAGE_GB: { usdPerUnit: 0, unit: 'GB-min' },
	BACKUP_USAGE_GB: { usdPerUnit: 0.15 / 43_800, unit: 'GB-min' },
};

/** The measurements we price. Limits + protobuf artifacts are not usage. */
const PRICED_MEASUREMENTS = Object.keys(RATES);

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

	/** Render an introspected type ref back into GraphQL syntax (`[Foo!]!`). */
	function renderType(t: TypeRef | null | undefined): string {
		if (!t) return '?';
		if (t.kind === 'NON_NULL') return `${renderType(t.ofType)}!`;
		if (t.kind === 'LIST') return `[${renderType(t.ofType)}]`;
		return t.name ?? '?';
	}

	/**
	 * Full argument signatures for the usage-shaped root fields. When a query is
	 * syntactically valid but Railway still refuses it, the missing information is
	 * "what does this field actually take" — so surface that rather than guessing a
	 * third time. This is how `measurements` was found in the first place.
	 */
	async function describeUsageFields(): Promise<string> {
		const { body } = await post(`query {
			__type(name: "Query") {
				fields {
					name
					args { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
				}
			}
		}`);
		const data = body?.data as
			| { __type?: { fields?: { name?: string; args?: { name?: string; type?: TypeRef }[] }[] } }
			| undefined;
		const wanted = /^(estimatedUsage|projectServiceUsage|usage)$/;
		const sigs = (data?.__type?.fields ?? [])
			.filter((f) => wanted.test(f.name ?? ''))
			.map((f) => {
				const args = (f.args ?? []).map((a) => `${a.name}: ${renderType(a.type)}`).join(', ');
				return `${f.name}(${args})`;
			});
		return sigs.length ? ` Signatures: ${sigs.join(' · ')}.` : '';
	}

	/**
	 * When Railway answers with usage but no money, the open question is "where DOES
	 * the dollar figure live" — so report the full measurement enum plus the fields of
	 * the `EstimatedUsage` type. If a cost measurement or an `estimatedCost`-style
	 * field exists, this names it; if none does, that is itself the answer and the
	 * euro column becomes the authoritative record for Railway.
	 */
	async function describeUsageOptions(): Promise<string> {
		const { body } = await post(`query {
			measurements: __type(name: "MetricMeasurement") { enumValues { name } }
			shape: __type(name: "EstimatedUsage") { fields { name type { kind name ofType { kind name } } } }
		}`);
		const data = body?.data as
			| {
					measurements?: { enumValues?: { name?: string }[] };
					shape?: { fields?: { name?: string; type?: TypeRef }[] };
			  }
			| undefined;
		const enums = (data?.measurements?.enumValues ?? []).map((v) => v.name ?? '').filter(Boolean);
		const fields = (data?.shape?.fields ?? [])
			.map((f) => `${f.name}: ${renderType(f.type)}`)
			.filter(Boolean);
		const parts: string[] = [];
		if (enums.length) parts.push(`Measurements offered: ${enums.join(', ')}.`);
		if (fields.length) parts.push(`EstimatedUsage fields: ${fields.join(', ')}.`);
		return parts.length ? ` ${parts.join(' ')}` : '';
	}

	async function enumMembers(): Promise<string[]> {
		const { body } = await post(
			`query { __type(name: "MetricMeasurement") { enumValues { name } } }`,
		);
		const data = body?.data as { __type?: { enumValues?: { name?: string }[] } } | undefined;
		return (data?.__type?.enumValues ?? []).map((v) => v.name ?? '').filter(Boolean);
	}

	const query = `query EstimatedUsage($projectId: String!, $measurements: [MetricMeasurement!]!) {
		estimatedUsage(projectId: $projectId, measurements: $measurements) {
			measurement
			estimatedValue
		}
	}`;

	// Ask only for measurements we can price, intersected with the live enum so a
	// renamed member is dropped rather than rejecting the whole query. Requesting the
	// full enum was the previous attempt and Railway refused it — `MEASUREMENT_UNSPECIFIED`
	// and `UNRECOGNIZED` are protobuf artifacts, and the `*_LIMIT` members aren't usage.
	const available = await enumMembers();
	const measurements = available.length
		? PRICED_MEASUREMENTS.filter((m) => available.includes(m))
		: PRICED_MEASUREMENTS;

	const attempt = await post(query, { projectId, measurements });
	if (attempt.transportError) return failed('railway', LABEL, attempt.transportError);
	const status = attempt.status;
	const body = attempt.body;
	if (status === 401 || status === 403) {
		return failed(
			'railway',
			LABEL,
			`Railway rejected the token (${status}). Use an ACCOUNT or WORKSPACE token — a project token authenticates with a Project-Access-Token header and won't work here.`,
		);
	}
	const gqlError = body?.errors?.find((e) => e.message)?.message?.trim();

	if (!body) {
		return failed('railway', LABEL, `Railway returned HTTP ${status} with an unreadable body.`);
	}
	if (gqlError) {
		return failed(
			'railway',
			LABEL,
			// Report the enum too, not just the signatures: when a query is valid but
			// still refused, the next question is always "then which measurement?".
			`Railway: ${gqlError}${await describeUsageFields()}${await describeUsageOptions()} Verify at https://railway.com/graphiql.`,
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

	let totalUsd = 0;
	const lines: CostLine[] = [];
	for (const entry of usage) {
		const value = num(entry.estimatedValue);
		const name = entry.measurement ?? '';
		const rate = RATES[name];
		if (value == null || !rate) continue;
		const usd = value * rate.usdPerUnit;
		totalUsd += usd;
		lines.push({
			label: humanize(name),
			amountUsd: usd,
			detail: `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${rate.unit}`,
		});
	}
	lines.sort((a, b) => (b.amountUsd ?? 0) - (a.amountUsd ?? 0));

	return {
		id: 'railway',
		label: LABEL,
		configured: true,
		ok: true,
		reason:
			'Railway exposes usage units, not money, so this prices them at the published rates. ' +
			'⚠️ Known to run LOW — checked against a real invoice it came out roughly 4× under, ' +
			'because the API quantities are not in the same units as the billed ones. Railway also ' +
			'bills on an 18th-to-18th cycle, so it never lines up with a calendar month. Treat this ' +
			'as a direction-of-travel figure and import the invoice for the real number.',
		// Railway has no prepaid balance — it bills a plan plus usage in arrears.
		balanceUsd: null,
		spendUsd: totalUsd,
		// `estimatedUsage` is Railway's PROJECTION for the whole cycle, not a
		// month-to-date figure — the same number their dashboard headlines.
		spendWindow: 'projected, this cycle',
		estimated: true,
		lines,
	};
}
