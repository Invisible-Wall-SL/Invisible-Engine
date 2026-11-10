import { fail, json, type ActionFailure } from '@sveltejs/kit';
import { ConflictError } from './r2';

/**
 * The answer to a write that lost its conditional race (`ConflictError`): a JSON 409, never
 * `error()`, which surfaces as an opaque 502 and hides the cause. Apart from `http.ts` so the tool
 * gate and the body readers do not load the R2 client.
 */

export interface ConflictOptions {
	/** The `error` code a client branches on: `conflict` unless the clash is a taken name. */
	code?: string;
	/** Fields sent between `error` and `message` (the stored version's ETag, …). */
	extra?: Record<string, unknown>;
	headers?: HeadersInit;
	/** `false` for the few routes whose 409 never carried the `ok: false` envelope. */
	okFlag?: boolean;
}

/** The 409 JSON answer for a write that lost a race: `{ ok: false, error, …extra, message }`. */
export function conflictJson(message: string, opts: ConflictOptions = {}): Response {
	return json(
		{
			...(opts.okFlag === false ? {} : { ok: false }),
			error: opts.code ?? 'conflict',
			...opts.extra,
			message,
		},
		{ status: 409, headers: opts.headers },
	);
}

/**
 * {@link conflictJson} when `e` is a lost conditional write, else `null` — the caller rethrows or
 * handles anything else.
 */
export function conflictResponse(
	e: unknown,
	message: string,
	opts?: ConflictOptions,
): Response | null {
	return e instanceof ConflictError ? conflictJson(message, opts) : null;
}

/**
 * The form-action twin of {@link conflictResponse}: `fail(409, { …fields, error: message,
 * conflict: true })` when `e` is a lost conditional write, else `null`. `fail`, never `error()`,
 * so the client's envelope parser can read the reason and keep the author's local doc.
 */
export function conflictFailure<T extends Record<string, unknown> = Record<never, never>>(
	e: unknown,
	message: string,
	fields?: T,
): ActionFailure<T & { error: string; conflict: true }> | null {
	if (!(e instanceof ConflictError)) return null;
	return fail(409, { ...(fields as T), error: message, conflict: true as const });
}
