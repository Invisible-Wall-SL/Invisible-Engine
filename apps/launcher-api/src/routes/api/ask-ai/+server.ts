import { error } from '@sveltejs/kit';
import { askAiStream, readAskAiRequest } from '$lib/server/askAi';
import type { RequestHandler } from './$types';

/**
 * POST /api/ask-ai  (JSON) { tool, messages: [{ role, content }], project? } — one turn of the
 * "Ask the AI" chat on a tool's bar, for a user who has that tool: by session, or relayed by the
 * Atlas / Sheet Maker's own server with an `X-IW-Relay` token (`$lib/server/toolRelay.ts`).
 * Answers an NDJSON stream of `AskAiEvent`s (`$lib/server/askAi.ts`).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body: unknown = await request.json().catch(() => {
		throw error(400, 'Expected a JSON body.');
	});
	const ask = await readAskAiRequest(locals, request.headers, body);
	return new Response(askAiStream(ask), {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
	});
};
