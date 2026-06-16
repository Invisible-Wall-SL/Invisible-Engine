import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { listAllObjects } from '$lib/server/r2';
import { r2Slug, SUB } from '$lib/server/projectPaths';
import { DEPLOY_CORS_HEADERS, serveDeployFile } from '$lib/server/deployServe';
import type { RequestHandler } from './$types';

/**
 * Read-only `deploy/` asset endpoint (QUERY form) for anonymous game clients
 * (build CI + pull scripts). A deployed game / build runner has no launcher
 * session, so this is NOT cookie-authed: it is gated by the SAME shared read
 * token (`?k=`, matched against the deploy token — see `getDeployToken()`) the
 * layout-doc / atlas tools use. The deploy tree is non-sensitive final art, and
 * the token is client-visible to anyone the game is served to; the gate keeps the
 * assets from being read by anonymous/external callers. When the secret is unset
 * the endpoint refuses to serve (503) so it is never public. CORS is open because
 * the token, not the origin, is the gate.
 *
 * Single-file serving is shared with the PATH-form route
 * (`/api/deploy/f/<token>/<client>/<project>/<...rel>`) via `deployServe.ts`;
 * the runtime uses the path form because relative sub-file resolution (Spine
 * pages etc.) needs the token + project as path segments, not query params.
 */
const CORS_HEADERS = DEPLOY_CORS_HEADERS;

/** Split `<client>/<project>` on the FIRST `/`. */
function splitProject(project: string): { client: string; proj: string } {
	const slash = project.indexOf('/');
	if (slash === -1) throw error(400, 'project must be <client>/<project>.');
	const client = project.slice(0, slash);
	const proj = project.slice(slash + 1);
	if (!client || !proj) throw error(400, 'project must be <client>/<project>.');
	return { client, proj };
}

export const GET: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Deploy endpoint is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectParam = url.searchParams.get('project');
	if (!projectParam) throw error(400, 'missing project');
	const { client, proj } = splitProject(projectParam);
	const canonicalProject = `${r2Slug(client)}/${r2Slug(proj)}`;
	const deployPrefix = SUB.deploy(client, proj);

	const rel = url.searchParams.get('rel');

	// Single-file mode: stream one object's bytes (shared with the path-form route).
	if (rel !== null) {
		return serveDeployFile(client, proj, rel);
	}

	// Listing mode: every object under deploy/, minus folder placeholders.
	const stripFrom = `${deployPrefix}/`;
	const objects = await listAllObjects(stripFrom);
	const files = objects
		.filter((o) => !o.key.endsWith('/'))
		.map((o) => ({ rel: o.key.slice(stripFrom.length), size: o.size }))
		.filter((f) => f.rel.length > 0);

	return json({ project: canonicalProject, files }, { headers: CORS_HEADERS });
};

export const OPTIONS: RequestHandler = async () =>
	new Response(null, { status: 204, headers: CORS_HEADERS });
