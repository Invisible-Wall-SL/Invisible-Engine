import { json } from '@sveltejs/kit';
import { stopFixRun } from '$lib/server/bugFixRuns';
import { parseBugNumber, requireBugAccess } from '$lib/server/bugReports';
import type { RequestHandler } from './$types';

/**
 * Stop a live fix run (ADR-0013 §3):
 *
 *   POST /api/bugs/<n>/fix-runs/<id>/stop   → 200 { run: FixRunView }, now `cancelled`
 *
 * The same rights as Start. A run that has ended, or whose result is being opened as a pull
 * request, is 409 (`fix_run_ended`, `fix_run_finishing`); GitHub refusing the cancel is 502 and
 * stops nothing.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	const access = await requireBugAccess(locals);
	const run = await stopFixRun(access, parseBugNumber(params.number), params.id);
	return json({ run }, { headers: { 'cache-control': 'no-store' } });
};
