import { json } from '@sveltejs/kit';
import { requireDirectorAccess, requireDirectorProjectScope } from '$lib/server/director/access';
import { NO_STORE, answering, jsonBody } from '$lib/server/director/api';
import { createRun, listRunSummaries, summarizeRun } from '$lib/server/director/runs';
import type { RequestHandler } from './$types';

/**
 * Invisible Director runs (PLAN 4A):
 *
 *   GET  /api/director/runs[?project=<key>[&client=<key>]]   the caller's runs, newest first — inside
 *                                                           one project when named
 *   POST /api/director/runs                                   create a run, in `draft`
 *        { requestId, key, name, clientKey?, gameType?, template, notes?, preset?, checkpoints? }
 *        → 200 { run: <summary>, replayed }   (201 on the first answer)
 *
 * Session-gated on the `director` tool. A create takes the same fields and validation as Game
 * Maker's "Create a game", plus the template to re-theme; it creates the project the way Game
 * Maker does and refuses (409 `ownership_required`) while the project's mockups lack the
 * ownership check. `requestId` makes it idempotent: the same id creates nothing twice. The list
 * is the caller's own runs; a project named is checked like every Director project (a pending
 * one answers its draft runs).
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
		const { run, replayed } = await createRun(user, {
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
