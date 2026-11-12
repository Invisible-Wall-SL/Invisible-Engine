import { json } from '@sveltejs/kit';
import { conflictResponse } from '../conflict';
import { AdapterError } from './adapter';
import { FontRequestError } from './fontRequests';
import { MockupError } from './mockups';
import { PromptError } from './prompts';
import { RunError } from './runs';

/**
 * What the Director owner endpoints share: the mapping of a refusal thrown by `runs.ts`,
 * `fontRequests.ts` or `mockups.ts` (or an adapter call's own `AdapterError`, as the variant image
 * route makes one) — and of a lost conditional write — onto `{ error: code, message }` at its
 * status. Anything else is a 500, as it should be. Their JSON body is `http.ts`'s `jsonBody`.
 */

export const NO_STORE = { 'cache-control': 'no-store' } as const;

export function refusalResponse(e: unknown): Response | null {
	if (
		e instanceof RunError ||
		e instanceof FontRequestError ||
		e instanceof MockupError ||
		e instanceof PromptError ||
		e instanceof AdapterError
	) {
		return json({ error: e.code, message: e.message }, { status: e.status, headers: NO_STORE });
	}
	return conflictResponse(e, 'Someone saved this since it was read. Reload and retry.', {
		okFlag: false,
		headers: NO_STORE,
	});
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
