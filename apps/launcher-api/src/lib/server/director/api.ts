import { error, json } from '@sveltejs/kit';
import { ConflictError } from '../r2';
import { AdapterError } from './adapter';
import { FontRequestError } from './fontRequests';
import { MockupError } from './mockups';
import { RunError } from './runs';

/**
 * What the Director owner endpoints share: a JSON body (400 when it is not one), and the mapping
 * of a refusal thrown by `runs.ts`, `fontRequests.ts` or `mockups.ts` (or an adapter call's own
 * `AdapterError`, as the variant image route makes one) — and of a lost conditional
 * write — onto `{ error: code, message }` at its status. Anything else is a 500, as it should be.
 */

export const NO_STORE = { 'cache-control': 'no-store' } as const;

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Expected a JSON body.');
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw error(400, 'Expected a JSON object.');
	}
	return body as Record<string, unknown>;
}

export function refusalResponse(e: unknown): Response | null {
	if (
		e instanceof RunError ||
		e instanceof FontRequestError ||
		e instanceof MockupError ||
		e instanceof AdapterError
	) {
		return json({ error: e.code, message: e.message }, { status: e.status, headers: NO_STORE });
	}
	if (e instanceof ConflictError) {
		return json(
			{ error: 'conflict', message: 'Someone saved this since it was read. Reload and retry.' },
			{ status: 409, headers: NO_STORE },
		);
	}
	return null;
}

/** Run `fn`, answering a known refusal as JSON and letting anything else through. */
export async function answering(fn: () => Promise<Response>): Promise<Response> {
	try {
		return await fn();
	} catch (e) {
		const refused = refusalResponse(e);
		if (refused) return refused;
		throw e;
	}
}
