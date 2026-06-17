import { error } from '@sveltejs/kit';
import { DEPLOY_CORS_HEADERS, serveDeployFile } from '$lib/server/deployServe';
import { projectAllowsRead } from '$lib/server/projects';
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
 * Token note: the leading path segment is EITHER the shared deploy token (build
 * CI / pull scripts) OR the read token belonging to THIS `<client>/<project>`
 * (the public Game Maker runtime — design doc gap #3). Both are path-safe single
 * segments, so the swap stayed a one-line gate change. `projectAllowsRead` scopes
 * the read token to its own project, so one project's token can't read another's.
 */
export const GET: RequestHandler = async ({ params }) => {
	if (!params.rel) throw error(400, 'missing path');
	if (!(await projectAllowsRead(params.project, params.token))) {
		throw error(401, 'Invalid or missing token.');
	}
	return serveDeployFile(params.client, params.project, params.rel);
};

export const OPTIONS: RequestHandler = async () =>
	new Response(null, { status: 204, headers: DEPLOY_CORS_HEADERS });
