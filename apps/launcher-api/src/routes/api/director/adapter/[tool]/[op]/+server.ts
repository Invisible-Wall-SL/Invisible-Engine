import { json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { runAdapterCall } from '$lib/server/director/gate';
import { ADAPTER_OPS } from '$lib/server/director/registry';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * One Invisible Director tool adapter call (ADR-0002), from the Director worker:
 *
 *   POST /api/director/adapter/<tool>/<op>
 *     Authorization: Bearer <DIRECTOR_SERVICE_TOKEN>
 *     { runId, agent, opId?, input }
 *
 * Every check lives in `runAdapterCall`. The service token is the only credential: the session
 * `hooks.server.ts` resolved is deliberately never read here.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		body = null;
	}
	try {
		const answer = await runAdapterCall(
			{
				tool: params.tool,
				op: params.op,
				authorization: request.headers.get('authorization'),
				body,
			},
			ADAPTER_OPS,
			ENV.DIRECTOR_SERVICE_TOKEN,
		);
		const headers: Record<string, string> = { ...NO_STORE };
		if (answer.status === 401) headers['www-authenticate'] = 'Bearer';
		if (answer.replayed) headers['x-director-replay'] = '1';
		return json(answer.body, { status: answer.status, headers });
	} catch (e) {
		console.error(`director adapter ${params.tool}.${params.op} failed:`, e);
		return json(
			{
				error: 'internal',
				message:
					'The adapter failed; whether it wrote anything is unknown. Re-read, then retry with the same opId.',
			},
			{ status: 500, headers: NO_STORE },
		);
	}
};
