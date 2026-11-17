import { json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { pipelineCiDenial } from '$lib/server/pipelineGames';
import { openLabSession } from '$lib/server/profiler/labSession';
import type { RequestHandler } from './$types';

/**
 * A lab run's capture session for one game (Invisible Profiler P6): `{ "game": "<key>", "label"? }`
 * → `{ sid, token, expiresAt, game: { key, name, projectKey, url } }`. The lab job then posts its
 * reading to `/api/profiler/reports` with the token, kept as `source: lab`. Bearer
 * `PIPELINE_CI_TOKEN` only, as `GET /api/pipeline/games`: no session or role is read.
 */
export const POST: RequestHandler = async ({ request }) => {
	const denial = pipelineCiDenial(request.headers.get('authorization'), ENV.PIPELINE_CI_TOKEN);
	if (denial) {
		const headers: Record<string, string> =
			denial.status === 401 ? { 'www-authenticate': 'Bearer' } : {};
		return json({ error: denial.error }, { status: denial.status, headers });
	}
	const body: unknown = await request.json().catch(() => null);
	const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	const game = typeof fields.game === 'string' ? fields.game.trim() : '';
	if (!game) return json({ error: 'Send { "game": "<key>" }.' }, { status: 400 });
	const label = typeof fields.label === 'string' ? fields.label.trim().slice(0, 80) || null : null;
	const result = await openLabSession(game, label);
	if (!result.ok) return json({ error: result.error }, { status: 404 });
	return json(result.session, { headers: { 'cache-control': 'no-store' } });
};
