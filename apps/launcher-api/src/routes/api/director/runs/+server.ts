import { json } from '@sveltejs/kit';
import { requireDirectorAccess, requireDirectorProjectScope } from '$lib/server/director/access';
import { NO_STORE, answering, jsonBody } from '$lib/server/director/api';
import {
	createRepairRun,
	createRun,
	listRunSummaries,
	summarizeRun,
} from '$lib/server/director/runs';
import type { RequestHandler } from './$types';

/**
 * Invisible Director runs (PLAN 4A):
 *
 *   GET  /api/director/runs[?project=<key>[&client=<key>]]   the caller's runs, newest first — inside
 *                                                           one project when named
 *   POST /api/director/runs                                   create a run, in `draft`
 *        { requestId, key, name, clientKey?, gameType?, template, notes?, checkpoints? }
 *        → 200 { run: <summary>, replayed }   (201 on the first answer)
 *        A body that still sends the retired `preset` is refused 400 `bad_request`.
 *   POST /api/director/runs   { requestId, bug }   create a game REPAIR run for game bug `bug` (a
 *        number), in `draft` (ADR-0012): the bug's own project, nothing copied. Needs Director and
 *        the game triage capability (403 `triage_required`) and a bug the caller can see (else 404);
 *        409 `bug_closed`, `template_project`, `live_run_on_project`. Same answer shape and
 *        `requestId` replay as a create.
 *
 * Session-gated on the `director` tool, and a create on Game Maker's too (403
 * `game_maker_required`): it takes the same fields and validation as Game Maker's "Create a
 * game", plus the template to re-theme, creates the project the way Game Maker does, and refuses
 * (409 `ownership_required`) while the project's mockups lack the ownership check. The budget
 * cap is copied onto the run when it starts, not here. `requestId` makes a create idempotent: the
 * same id with the same key, client and template answers the run it made; another is 409. The
 * list is the caller's own runs; a project named is checked like every Director project (a
 * pending one answers its draft runs).
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireDirectorAccess(locals);
	const project = url.searchParams.get('project');
	const projectKey = project?.trim()
		? (await requireDirectorProjectScope(user, project, url.searchParams.get('client'))).projectKey
		: undefined;
	return json({ runs: await listRunSummaries(user, projectKey) }, { headers: NO_STORE });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireDirectorAccess(locals);
	const body = await jsonBody(request);
	return answering(async () => {
		const { run, replayed } =
			body.bug !== undefined
				? await createRepairRun(user, { requestId: body.requestId, bug: body.bug })
				: await createRun(user, {
						requestId: body.requestId,
						key: body.key,
						name: body.name,
						clientKey: body.clientKey,
						gameType: body.gameType,
						template: body.template,
						notes: body.notes,
						preset: body.preset,
						checkpoints: body.checkpoints,
					});
		return json(
			{ run: await summarizeRun(run), replayed },
			{ status: replayed ? 200 : 201, headers: NO_STORE },
		);
	});
};
