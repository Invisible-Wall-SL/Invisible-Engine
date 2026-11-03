import { error, json } from '@sveltejs/kit';
import { startFixRun } from '$lib/server/bugFixRuns';
import { parseBugNumber, requireBugAccess } from '$lib/server/bugReports';
import type { RequestHandler } from './$types';

/**
 * Start a fix run on a pipeline bug (ADR-0013 §1):
 *
 *   POST /api/bugs/<n>/fix-runs   (JSON) { requestId }
 *        → 201 { run: FixRunView }; a replayed requestId → 200 with the run it started
 *
 * Needs a pipeline bug the user may see (else 404), both "Start fix runs on pipeline bugs" and
 * "Triage pipeline bugs" (403) and the GitHub App (503, nothing written). Refusals are 409
 * `{ message, code }`: `bug_closed`, `pr_open`, `fix_run_live`, `too_many_fix_runs`,
 * `fix_budget_spent`, `request_id_reused`. An unsent bug is sent in the same action. A dispatch
 * GitHub refuses still answers the run, ended `failed` with GitHub's reason.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const access = await requireBugAccess(locals);
	const number = parseBugNumber(params.number);
	const body: unknown = await request.json().catch(() => {
		throw error(400, 'Expected a JSON body.');
	});
	const { run, created } = await startFixRun(access, number, body);
	return json({ run }, { status: created ? 201 : 200, headers: { 'cache-control': 'no-store' } });
};
