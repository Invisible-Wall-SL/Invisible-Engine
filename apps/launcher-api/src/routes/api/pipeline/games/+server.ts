import { json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { listPipelineGames, pipelineCiDenial } from '$lib/server/pipelineGames';
import type { RequestHandler } from './$types';

/**
 * Every live game for the current-games CI harness (ADR-0004). Bearer `PIPELINE_CI_TOKEN` only:
 * the session `hooks.server.ts` resolved is deliberately never read here.
 */
export const GET: RequestHandler = async ({ request }) => {
	const denial = pipelineCiDenial(request.headers.get('authorization'), ENV.PIPELINE_CI_TOKEN);
	if (denial) {
		const headers: Record<string, string> =
			denial.status === 401 ? { 'www-authenticate': 'Bearer' } : {};
		return json({ error: denial.error }, { status: denial.status, headers });
	}
	return json({ games: await listPipelineGames() }, { headers: { 'cache-control': 'no-store' } });
};
