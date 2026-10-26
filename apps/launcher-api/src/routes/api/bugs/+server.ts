import { error, json } from '@sveltejs/kit';
import {
	createBug,
	currentLinkSync,
	listBugs,
	requireBugAccess,
	requireKind,
} from '$lib/server/bugReports';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * The overview and reporting of both bug tools, session-gated on the kind's tool:
 *
 *   GET  /api/bugs?kind=pipeline             every pipeline bug the viewer may see
 *   GET  /api/bugs?kind=game&project=<key>   one project's game bugs (403 unless the viewer can open it)
 *        — filtering is the page's; the answer says whether linked pull requests could be read, as
 *        the last sync found (a new one runs in the background, at most once a minute)
 *   POST /api/bugs   (JSON) report one: { kind, title, description, area, project?, pageUrl?,
 *                    priority? } — a game bug must name its project; answers the bug in full, with no
 *                    screenshots yet (they upload one by one)
 */
const NO_STORE = { 'cache-control': 'no-store' };

export const GET: RequestHandler = async ({ locals, url }) => {
	const access = await requireBugAccess(locals);
	const kind = requireKind(access, url.searchParams.get('kind'));
	const projectKey =
		kind === 'game'
			? (await requireProjectScope(access.user, url.searchParams.get('project'))).projectKey
			: undefined;
	const sync = await currentLinkSync();
	return json({ bugs: await listBugs(access, { kind, projectKey }), sync }, { headers: NO_STORE });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const access = await requireBugAccess(locals);
	const body: unknown = await request.json().catch(() => {
		throw error(400, 'Expected a JSON body.');
	});
	return json(await createBug(access, body), { status: 201, headers: NO_STORE });
};
