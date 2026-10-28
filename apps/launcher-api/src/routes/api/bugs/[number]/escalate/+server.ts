import { error, json } from '@sveltejs/kit';
import { escalateGameBug, parseBugNumber, requireBugAccess } from '$lib/server/bugReports';
import type { RequestHandler } from './$types';

/**
 * A triager hands a game bug to the pipeline (ADR-0012 §3), with no Director run:
 *
 *   POST /api/bugs/<n>/escalate   (JSON) { area, title, description? }
 *
 * Needs the game triage capability and the Pipeline Bug Reports tool, and a bug the user may see
 * (else 404). Files one pipeline bug (Open, not sent) in the game bug's project, relates the two,
 * and moves the game bug Open → Working on; escalating again answers the bug already filed.
 * Answers the game bug as it now stands.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const access = await requireBugAccess(locals);
	const body: unknown = await request.json().catch(() => {
		throw error(400, 'Expected a JSON body.');
	});
	return json(await escalateGameBug(access, parseBugNumber(params.number), body), {
		headers: { 'cache-control': 'no-store' },
	});
};
