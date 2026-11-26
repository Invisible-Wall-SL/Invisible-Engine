import { error, json } from '@sveltejs/kit';
import { buildFixRun } from '$lib/server/bugFixRuns';
import { parseBugNumber, requireBugAccess } from '$lib/server/bugReports';
import type { RequestHandler } from './$types';

/**
 * Build one option of a diagnosis (ADR-0014 §1):
 *
 *   POST /api/bugs/<n>/fix-runs/<diagnoseRunId>/build   (JSON) { optionId, note?, requestId }
 *        → 201 { run: FixRunView } (the build run); a replayed requestId → 200 with the run it started
 *
 * The same rights as Start fix (both "Start fix runs on pipeline bugs" and "Triage pipeline bugs",
 * 403), a pipeline bug the user may see (else 404) and the GitHub App (503, nothing written).
 * `note` is at most 1000 characters. Refusals are 409 `{ message, code }`: `not_diagnosed` (the
 * run is not a `diagnosed` diagnose run of this bug), `stale_diagnosis` (a newer diagnose run of
 * the bug exists), `no_such_option`, then Start's `bug_closed`, `pr_open`, `fix_run_live`,
 * `too_many_fix_runs`, `fix_budget_spent` and `request_id_reused`. The build run and the bug's
 * `fix_decision` event are stored in one transaction.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const access = await requireBugAccess(locals);
	const number = parseBugNumber(params.number);
	const body: unknown = await request.json().catch(() => {
		throw error(400, 'Expected a JSON body.');
	});
	const { run, created } = await buildFixRun(access, number, params.id, body);
	return json({ run }, { status: created ? 201 : 200, headers: { 'cache-control': 'no-store' } });
};
