import { ENV } from './env';
import { listAllKeys } from './r2';

/** R2 prefix where the desktop launcher uploads a published game bundle. */
const TEST_SERVER_PREFIX = 'test_server/';

/** Cloudflare free/pro `purge_cache` accepts at most 30 URLs per request. */
const PURGE_BATCH = 30;

export interface PurgeResult {
	ok: boolean;
	purged: number;
	skipped?: string;
	error?: string;
}

interface CfPurgeResponse {
	success?: boolean;
	errors?: { message?: string }[];
}

/**
 * Purge the Cloudflare edge cache for every object of a published game so a
 * republish is immediately visible (filenames are stable, so the edge otherwise
 * keeps serving stale files). Lists R2 `test_server/<key>/` and POSTs each public
 * `${GAMES_BASE_URL}/<key>/<rel>` URL to the zone's `purge_cache` in batches of 30.
 *
 * No-op (and `ok: true`) when `CF_API_TOKEN` / `CF_ZONE_ID` aren't configured.
 * Never throws — always resolves with a result the caller can log.
 */
export async function purgeGameCache(key: string): Promise<PurgeResult> {
	const token = ENV.CF_API_TOKEN;
	const zoneId = ENV.CF_ZONE_ID;
	if (!token || !zoneId) {
		return { ok: true, purged: 0, skipped: 'CF not configured' };
	}

	let files: string[];
	try {
		const prefix = `${TEST_SERVER_PREFIX}${key}/`;
		const keys = await listAllKeys(prefix);
		const base = ENV.GAMES_BASE_URL.replace(/\/+$/, '');
		files = keys.map((k) => `${base}/${k.slice(TEST_SERVER_PREFIX.length)}`);
	} catch (e) {
		return { ok: false, purged: 0, error: e instanceof Error ? e.message : String(e) };
	}

	if (files.length === 0) {
		return { ok: true, purged: 0, skipped: 'no objects' };
	}

	const endpoint = `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`;
	let purged = 0;
	let firstError: string | undefined;

	for (let i = 0; i < files.length; i += PURGE_BATCH) {
		const batch = files.slice(i, i + PURGE_BATCH);
		try {
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${token}`,
					'content-type': 'application/json',
				},
				body: JSON.stringify({ files: batch }),
			});
			const data = (await res.json().catch(() => ({}))) as CfPurgeResponse;
			if (res.ok && data.success) {
				purged += batch.length;
			} else {
				const msg = data.errors?.[0]?.message ?? `HTTP ${res.status}`;
				firstError ??= msg;
			}
		} catch (e) {
			firstError ??= e instanceof Error ? e.message : String(e);
		}
	}

	return firstError ? { ok: false, purged, error: firstError } : { ok: true, purged };
}
