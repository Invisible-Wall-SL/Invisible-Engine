import { error, json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { getObjectBytes, listAllObjects } from '$lib/server/r2';
import { r2Slug, SUB } from '$lib/server/projectPaths';
import type { RequestHandler } from './$types';

/**
 * Read-only `deploy/` asset endpoint for anonymous game clients (build CI +
 * browser). A deployed game / build runner has no launcher session, so this is
 * NOT cookie-authed: it is gated by the SAME shared read token (`?k=`, matched
 * against `EDITOR_DOC_SECRET`) the layout-doc / atlas tools use. The deploy tree
 * is non-sensitive final art, and the token is client-visible to anyone the game
 * is served to; the gate keeps the assets from being read by anonymous/external
 * callers. When the secret is unset the endpoint refuses to serve (503) so it is
 * never public. CORS is open because the token, not the origin, is the gate.
 */
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const EXT_CONTENT_TYPES: Record<string, string> = {
	json: 'application/json',
	png: 'image/png',
	webp: 'image/webp',
	atlas: 'text/plain',
};

function contentTypeFor(rel: string): string {
	const dot = rel.lastIndexOf('.');
	if (dot === -1) return 'application/octet-stream';
	const ext = rel.slice(dot + 1).toLowerCase();
	return EXT_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

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
	const secret = ENV.EDITOR_DOC_SECRET;
	if (!secret) throw error(503, 'Deploy endpoint is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectParam = url.searchParams.get('project');
	if (!projectParam) throw error(400, 'missing project');
	const { client, proj } = splitProject(projectParam);
	const canonicalProject = `${r2Slug(client)}/${r2Slug(proj)}`;
	const deployPrefix = SUB.deploy(client, proj);

	const rel = url.searchParams.get('rel');

	// Single-file mode: stream one object's bytes.
	if (rel !== null) {
		if (rel.includes('..') || rel.includes('\\') || rel.startsWith('/')) {
			throw error(400, 'invalid rel');
		}
		const key = `${deployPrefix}/${rel}`;
		const obj = await getObjectBytes(key);
		if (!obj) throw error(404, 'not found');
		return new Response(obj.body, {
			headers: {
				...CORS_HEADERS,
				'content-type': contentTypeFor(rel),
				'cache-control': 'public, max-age=60',
			},
		});
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
