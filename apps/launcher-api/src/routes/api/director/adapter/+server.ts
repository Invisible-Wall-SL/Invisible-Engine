import { json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { catalogAnswer } from '$lib/server/director/gate';
import { ADAPTER_OPS } from '$lib/server/director/registry';
import type { RequestHandler } from './$types';

/**
 * The Invisible Director adapter catalog, for the worker:
 *
 *   GET /api/director/adapter
 *     Authorization: Bearer <DIRECTOR_SERVICE_TOKEN>
 *   → { ops: [{ id, description, inputSchema, write, agents }] }
 *
 * The worker offers a model only the ops listed here, so an op the launcher does not serve yet is
 * never a tool. No session is read, as for `POST /api/director/adapter/<tool>/<op>`.
 */
export const GET: RequestHandler = ({ request }) => {
	const answer = catalogAnswer(
		request.headers.get('authorization'),
		ADAPTER_OPS,
		ENV.DIRECTOR_SERVICE_TOKEN,
	);
	const headers: Record<string, string> = { 'cache-control': 'no-store' };
	if (answer.status === 401) headers['www-authenticate'] = 'Bearer';
	return json(answer.body, { status: answer.status, headers });
};
