import { error, json } from '@sveltejs/kit';
import { requireDirectorAccess } from '$lib/server/director/access';
import { NO_STORE, answering, jsonBody } from '$lib/server/director/api';
import { listFontRequests, markFontRequestDone } from '$lib/server/director/fontRequests';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * The font bakes Director staged for the owner (PLAN 4A; `fonts.bake_from_ttf`):
 *
 *   GET  /api/director/fonts?project=<key>            every `director/fonts/<folder>/request.json`
 *   POST /api/director/fonts?project=<key>            { action: 'done', folder, baseEtag? }
 *        → 200 { request }                            marks it done once the font is in the catalog
 *
 * Session-gated on the `director` tool, then on the project. Marking is idempotent by state (a
 * done request is answered as it is) and conditional on the request as listed (`baseEtag`).
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireDirectorAccess(locals);
	const scope = await requireProjectScope(user, url.searchParams.get('project'));
	return json({ requests: await listFontRequests(scope) }, { headers: NO_STORE });
};

export const POST: RequestHandler = async ({ request, url, locals }) => {
	const user = await requireDirectorAccess(locals);
	const scope = await requireProjectScope(user, url.searchParams.get('project'));
	const body = await jsonBody(request);
	if (body.action !== 'done') throw error(400, 'Unknown action.');
	const folder = typeof body.folder === 'string' ? body.folder.trim() : '';
	const baseEtag = typeof body.baseEtag === 'string' && body.baseEtag ? body.baseEtag : null;
	const by = { uid: user.id, name: user.name ?? user.email };
	return answering(async () =>
		json(
			{ request: await markFontRequestDone(scope, folder, by, baseEtag) },
			{ headers: NO_STORE },
		),
	);
};
