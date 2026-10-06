import { json } from '@sveltejs/kit';
import { requireDirectorAccess, requireOwnedRun } from '$lib/server/director/access';
import { NO_STORE } from '$lib/server/director/api';
import { summarizeRun } from '$lib/server/director/runs';
import type { RequestHandler } from './$types';

/**
 * `GET /api/director/runs/[runId]` — the run summary the Live-run and Mockup-breakdown screens
 * load first: state (status, step, open checkpoint), spend against the cap, each agent's status,
 * the actions the owner may take now, and the event id the live stream picks up from. Owner-only:
 * another user's run, a run outside the caller's projects and an unknown id all answer 404.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireDirectorAccess(locals);
	const run = await requireOwnedRun(user, params.runId);
	return json({ run: await summarizeRun(run) }, { headers: NO_STORE });
};
