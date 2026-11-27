import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { error } from '@sveltejs/kit';
import { deleteObject, getObjectBytesBounded, presignPut } from './r2';

/**
 * A run's result that is too large for adapter-node's 512 KB body limit travels through R2
 * (ADR-0013 §4, ADR-0015 §10): the job asks for an upload address, PUTs its gzipped result there,
 * then posts a small pointer `{ upload: { key, sha256, bytes } }` to the usual result endpoint.
 * One fixed key per run, under `_runs/`, which nothing else reads or writes; the launcher reads it
 * once, bounded, and deletes it. No new secret: the launcher signs with its own R2 credentials.
 */

export type RunKind = 'fix' | 'merge';

/** How long the signed address stays good. */
export const RESULT_UPLOAD_TTL_S = 15 * 60;
const CONTENT_TYPE = 'application/gzip';

export const resultObjectKey = (kind: RunKind, id: string): string =>
	`_runs/${kind}/${id}/result.json.gz`;

export interface ResultUpload {
	url: string;
	key: string;
	expiresAt: string;
	/** The most the object may hold: what the result may unpack to, which bounds its gzip as well. */
	maxBytes: number;
}

/** A signed PUT for the run's key; a second call signs the same key afresh. */
export async function issueResultUpload(
	kind: RunKind,
	id: string,
	maxBytes: number,
	nowMs = Date.now(),
): Promise<ResultUpload> {
	const key = resultObjectKey(kind, id);
	const url = await presignPut(key, CONTENT_TYPE, RESULT_UPLOAD_TTL_S);
	return {
		url,
		key,
		expiresAt: new Date(nowMs + RESULT_UPLOAD_TTL_S * 1000).toISOString(),
		maxBytes,
	};
}

/** The run's leftover result object, gone; a failure is the lifecycle rule's to clean up. */
export const forgetResultObject = (kind: RunKind, id: string): Promise<void> =>
	deleteObject(resultObjectKey(kind, id)).catch(() => undefined);

/** The pointer a job posts in place of its result, or null when `value` is not one. */
export function resultPointer(value: Record<string, unknown>): unknown | null {
	const keys = Object.keys(value);
	return keys.length === 1 && keys[0] === 'upload' ? value.upload : null;
}

/**
 * The JSON bytes a pointer stands for: the run's own key only, the object read bounded at `maxBytes`,
 * its size and sha256 as the job said, gunzipped within `maxBytes` — each failure a 400 with a
 * sentence that names the rule, never a value. The object is deleted whatever happened.
 */
export async function readUploadedResult(
	kind: RunKind,
	id: string,
	pointer: unknown,
	maxBytes: number,
): Promise<Buffer> {
	const key = resultObjectKey(kind, id);
	const mb = `${maxBytes / (1024 * 1024)} MB`;
	try {
		const p = pointer as { key?: unknown; sha256?: unknown; bytes?: unknown } | null;
		if (!p || typeof p !== 'object' || Array.isArray(p)) {
			throw error(400, 'The result’s upload is not a pointer.');
		}
		if (p.key !== key) throw error(400, 'The result’s upload is not this run’s.');
		if (typeof p.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256)) {
			throw error(400, 'The result’s upload has no sha256.');
		}
		if (!Number.isSafeInteger(p.bytes) || (p.bytes as number) < 1) {
			throw error(400, 'The result’s upload has no byte count.');
		}
		if ((p.bytes as number) > maxBytes) throw error(400, `An uploaded result is at most ${mb}.`);
		const got = await getObjectBytesBounded(key, maxBytes);
		if (got === null) throw error(400, 'The uploaded result is not there.');
		if (got === 'large') throw error(400, `An uploaded result is at most ${mb}.`);
		const raw = Buffer.from(got);
		if (raw.length !== p.bytes) throw error(400, 'The uploaded result is not the size it said.');
		if (createHash('sha256').update(raw).digest('hex') !== p.sha256) {
			throw error(400, 'The uploaded result is not the file it said.');
		}
		try {
			return gunzipSync(raw, { maxOutputLength: maxBytes });
		} catch (err) {
			if (err instanceof RangeError)
				throw error(400, `An uploaded result unpacks to at most ${mb}.`);
			throw error(400, 'The uploaded result is not gzip.');
		}
	} finally {
		await forgetResultObject(kind, id);
	}
}
