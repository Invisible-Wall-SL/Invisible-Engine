/**
 * Cloudflare R2 cost collector — the shared asset store (`invisibleassets`).
 *
 * R2 has **no billing API**. What it exposes is the GraphQL Analytics API's usage
 * counters — `r2StorageAdaptiveGroups` (bytes + object count) and
 * `r2OperationsAdaptiveGroups` (request counts per action) — so the dollar figure here
 * is OUR arithmetic over those counters at the published rates. It is an estimate and
 * the card says so; reconcile against the Cloudflare invoice, not against this.
 *
 * The token is deliberately NOT the existing `CF_API_TOKEN`: that one is zone-scoped
 * for cache purge and cannot read account analytics. This needs Account → Account
 * Analytics: Read.
 *
 * Egress is free on R2, which is the entire reason the pipeline serves games from it —
 * so there is no bandwidth line here by design.
 */

import { ENV } from '../env';
import { failed, notConfigured, num, type CostLine, type ProviderCost } from './types';

const LABEL = 'Cloudflare R2 (assets)';
const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

/**
 * Published R2 standard-storage rates (USD). These are a PRICE LIST copied into code,
 * which means they go stale silently when Cloudflare changes them — so the card prints
 * the rate it used next to every line, making a drift visible instead of invisible.
 * Re-check at https://developers.cloudflare.com/r2/pricing/.
 */
const RATES = {
	storagePerGbMonth: 0.015,
	classAPerMillion: 4.5,
	classBPerMillion: 0.36,
};

const DAYS = 30;
const GB = 1024 ** 3;

/**
 * R2 bills writes/lists as Class A and reads as Class B; deletes are free. Cloudflare
 * returns raw `actionType` names, so classify by name. Anything unrecognized falls to
 * Class B — the cheaper side, so an unknown action can't silently inflate the estimate.
 */
const CLASS_A = new Set([
	'PutObject',
	'CopyObject',
	'ListObjects',
	'ListBuckets',
	'CreateBucket',
	'CreateMultipartUpload',
	'CompleteMultipartUpload',
	'ListMultipartUploads',
	'UploadPart',
	'UploadPartCopy',
	'ListParts',
	'PutBucketEncryption',
	'PutBucketCors',
	'PutBucketLifecycleConfiguration',
]);
const FREE = new Set(['DeleteObject', 'DeleteObjects', 'DeleteBucket', 'AbortMultipartUpload']);

interface StorageGroup {
	max?: { objectCount?: number; payloadSize?: number; metadataSize?: number };
}
interface OperationGroup {
	dimensions?: { actionType?: string };
	sum?: { requests?: number };
}
interface GraphQlResponse {
	data?: {
		viewer?: {
			accounts?: { storage?: StorageGroup[]; operations?: OperationGroup[] }[];
		} | null;
	};
	errors?: { message?: string }[] | null;
}

export async function collectR2(): Promise<ProviderCost> {
	const accountId = ENV.CF_ACCOUNT_ID.trim();
	const token = ENV.CF_ANALYTICS_TOKEN.trim();
	if (!accountId || !token) {
		return notConfigured(
			'r2',
			LABEL,
			['CF_ACCOUNT_ID', 'CF_ANALYTICS_TOKEN'],
			'Needs the Cloudflare account id plus a token with Account → Account Analytics: Read. ' +
				'The existing CF_API_TOKEN is zone-scoped for cache purge and cannot read this.',
		);
	}
	// The account tag is interpolated into the query; keep it to the hex id shape so a
	// malformed value fails here rather than becoming part of the GraphQL document.
	if (!/^[a-f0-9]{32}$/i.test(accountId)) {
		return failed('r2', LABEL, 'CF_ACCOUNT_ID is not a 32-character Cloudflare account id.');
	}

	const end = new Date();
	const start = new Date(end.getTime() - DAYS * 86_400_000);
	const query = `
		query {
			viewer {
				accounts(filter: { accountTag: "${accountId}" }) {
					storage: r2StorageAdaptiveGroups(
						limit: 1
						orderBy: [datetime_DESC]
						filter: { datetime_geq: "${start.toISOString()}", datetime_leq: "${end.toISOString()}" }
					) {
						max { objectCount payloadSize metadataSize }
					}
					operations: r2OperationsAdaptiveGroups(
						limit: 100
						filter: { datetime_geq: "${start.toISOString()}", datetime_leq: "${end.toISOString()}" }
					) {
						dimensions { actionType }
						sum { requests }
					}
				}
			}
		}`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 20_000);
	let body: GraphQlResponse;
	try {
		const res = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ query }),
			signal: controller.signal,
		});
		if (!res.ok) return failed('r2', LABEL, `Cloudflare returned HTTP ${res.status}.`);
		body = (await res.json()) as GraphQlResponse;
	} catch (err) {
		return failed(
			'r2',
			LABEL,
			err instanceof Error ? err.message : 'Could not reach the Cloudflare Analytics API.',
		);
	} finally {
		clearTimeout(timer);
	}

	const gqlError = body.errors?.find((e) => e.message)?.message;
	if (gqlError) {
		return failed('r2', LABEL, `Cloudflare: ${gqlError.trim()}`);
	}

	const account = body.data?.viewer?.accounts?.[0];
	if (!account) {
		return failed(
			'r2',
			LABEL,
			'Cloudflare returned no account — check the token has Account Analytics: Read on this account.',
		);
	}

	const storage = account.storage?.[0]?.max;
	const storedBytes = (num(storage?.payloadSize) ?? 0) + (num(storage?.metadataSize) ?? 0);
	const storedGb = storedBytes / GB;
	const storageUsd = storedGb * RATES.storagePerGbMonth;

	let classA = 0;
	let classB = 0;
	for (const op of account.operations ?? []) {
		const action = op.dimensions?.actionType ?? '';
		const requests = num(op.sum?.requests) ?? 0;
		if (FREE.has(action)) continue;
		if (CLASS_A.has(action)) classA += requests;
		else classB += requests;
	}
	const classAUsd = (classA / 1_000_000) * RATES.classAPerMillion;
	const classBUsd = (classB / 1_000_000) * RATES.classBPerMillion;

	const lines: CostLine[] = [
		{
			label: 'Storage',
			amountUsd: storageUsd,
			detail: `${storedGb.toFixed(2)} GB · $${RATES.storagePerGbMonth}/GB-month`,
		},
		{
			label: 'Class A operations (writes, lists)',
			amountUsd: classAUsd,
			detail: `${classA.toLocaleString('en-US')} ops · $${RATES.classAPerMillion}/M`,
		},
		{
			label: 'Class B operations (reads)',
			amountUsd: classBUsd,
			detail: `${classB.toLocaleString('en-US')} ops · $${RATES.classBPerMillion}/M`,
		},
		{ label: 'Egress', amountUsd: 0, detail: 'free on R2' },
	];
	const objectCount = num(storage?.objectCount);
	if (objectCount != null) {
		lines.push({
			label: 'Objects stored',
			amountUsd: null,
			detail: objectCount.toLocaleString('en-US'),
		});
	}

	return {
		id: 'r2',
		label: LABEL,
		configured: true,
		ok: true,
		reason:
			'Derived from usage counters at published rates — R2 has no billing API, so treat this as an estimate.',
		balanceUsd: null,
		spendUsd: storageUsd + classAUsd + classBUsd,
		spendWindow: `last ${DAYS} days`,
		estimated: true,
		lines,
	};
}
