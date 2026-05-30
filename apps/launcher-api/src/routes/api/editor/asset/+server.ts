import { error } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE, getActiveProjectKey } from '$lib/server/auth';
import {
	UNASSIGNED_CLIENT,
	projectPrefix,
	spineBundleSharedPath,
} from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { getObjectBytes } from '$lib/server/r2';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

const EXT_CONTENT_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	svg: 'image/svg+xml',
	json: 'application/json',
	atlas: 'text/plain; charset=utf-8',
	skel: 'application/octet-stream',
};

/** Build the set of R2-key prefixes the active (client, project) may read from. */
function allowedPrefixes(clientKey: string, projectKey: string): string[] {
	const atlas = projectPrefix('atlas_maker', clientKey, projectKey);
	const sheet = projectPrefix('sheet_maker', clientKey, projectKey);
	const spines = projectPrefix('spines', clientKey, projectKey);
	const sharedSpines = 'spines/_shared/';
	return [`${atlas}/`, `${sheet}/`, `${spines}/`, sharedSpines];
}

function contentTypeFor(key: string, fallback: string): string {
	const dot = key.lastIndexOf('.');
	if (dot === -1) return fallback;
	const ext = key.slice(dot + 1).toLowerCase();
	return EXT_CONTENT_TYPES[ext] ?? fallback;
}

/**
 * Auth-gated streamer for arbitrary R2 keys inside the active project's
 * editor namespaces. The key must start with one of `allowedPrefixes(…)` —
 * which mirrors what `listProjectAssets()` walks — so a user can never read
 * outside the project (or outside their accessible projects, since the
 * active project is bound to the session).
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'editor', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to the Invisible Editor.');
	}

	const key = url.searchParams.get('key');
	if (!key) throw error(400, 'missing key');
	if (key.includes('..') || key.startsWith('/')) throw error(403, 'forbidden');

	const projectKey =
		(await getActiveProjectKey(cookies.get(SESSION_COOKIE))) ?? DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	const allowed = allowedPrefixes(clientKey, projectKey);
	if (!allowed.some((p) => key.startsWith(p))) throw error(403, 'forbidden');

	const obj = await getObjectBytes(key);
	if (!obj) throw error(404, 'not found');

	return new Response(obj.body, {
		headers: {
			'content-type': contentTypeFor(key, obj.contentType),
			'cache-control': 'no-store',
		},
	});
};
