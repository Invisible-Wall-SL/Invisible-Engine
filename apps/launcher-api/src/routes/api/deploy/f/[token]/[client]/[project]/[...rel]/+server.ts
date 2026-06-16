import { error } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { DEPLOY_CORS_HEADERS, serveDeployFile } from '$lib/server/deployServe';
import type { RequestHandler } from './$types';

/**
 * PATH-form read-only `deploy/` asset serving for the generic runtime:
 *
 *   GET /api/deploy/f/<token>/<client>/<project>/<...rel>
 *
 * Same R2 tree + token gate as the query-form `/api/deploy?project=&k=&rel=`,
 * but the token + project are leading PATH segments so a sub-file named inside a
 * parent (Spine atlas page, spritesheet page, bitmap-font page) resolves
 * correctly when the runtime loads it RELATIVE to the parent's URL — see
 * `deployServe.ts`. The runtime's `assetBase` is everything up to and including
 * the trailing `/`, and it appends the deploy-relative path.
 *
 * Token note: the path segment is the shared deploy token, which is path-safe
 * today. Phase 1 replaces it with a per-project read-only token (design doc gap
 * #3); keep this a single segment so that swap is a one-line change.
 */
export const GET: RequestHandler = async ({ params }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Deploy endpoint is not configured.');
	if (params.token !== secret) throw error(401, 'Invalid or missing token.');
	if (!params.rel) throw error(400, 'missing path');
	return serveDeployFile(params.client, params.project, params.rel);
};

export const OPTIONS: RequestHandler = async () =>
	new Response(null, { status: 204, headers: DEPLOY_CORS_HEADERS });
