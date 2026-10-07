import { error } from '@sveltejs/kit';
import { DEPLOY_CORS_HEADERS, serveDeployFile } from '$lib/server/deployServe';
import { projectReadClient } from '$lib/server/projects';
import type { RequestHandler } from './$types';

/**
 * PATH-form read-only `deploy/` asset serving for the generic runtime:
 *
 *   GET /api/deploy/f/<token>/<client>/<project>/<...rel>
 *
 * Same R2 tree + token gate as the query-form `/api/deploy?project=&k=&rel=`,
 * but the token + project are leading PATH segments so a sub-file named inside a
 * parent (rig atlas page, spritesheet page, bitmap-font page) resolves
 * correctly when the runtime loads it RELATIVE to the parent's URL — see
 * `deployServe.ts`. The runtime's `assetBase` is everything up to and including
 * the trailing `/`, and it appends the deploy-relative path.
 *
 * Token note: the leading path segment is EITHER the shared deploy token (build
 * CI / pull scripts) OR the read token belonging to THIS `<project>` (the public
 * Game Maker runtime — design doc gap #3). Both are path-safe single segments.
 *
 * `<client>` is NOT trusted: files come from the project's OWN client
 * (`projectReadClient`), the tree `/api/editor/runtime` builds `assetBase` from.
 * Taking the caller's segment let a project's read token read
 * `<otherClient>/<project>/deploy/` — an orphan left wherever the key was once used
 * under another client. It stays in the URL because every live game's `assetBase`
 * carries it, and it is ignored rather than matched: a game opened before its
 * project moved client still holds the old segment, and is served the project's
 * current tree rather than a 404.
 */
export const GET: RequestHandler = async ({ params }) => {
	if (!params.rel) throw error(400, 'missing path');
	const client = await projectReadClient(params.project, params.token);
	if (client === null) throw error(401, 'Invalid or missing token.');
	return serveDeployFile(client, params.project, params.rel);
};

export const OPTIONS: RequestHandler = async () =>
	new Response(null, { status: 204, headers: DEPLOY_CORS_HEADERS });
