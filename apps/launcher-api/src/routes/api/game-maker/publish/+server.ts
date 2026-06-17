import { error, json } from '@sveltejs/kit';
import { ADMIN_PANEL_CAPABILITY, roleHasCapability } from '$lib/roles';
import { projectExists } from '$lib/server/projects';
import { publishGame } from '$lib/server/publishGame';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Server-side Publish for the Invisible Game Maker page (Phase 1). Cookie-authed
 * (the page is in the authed `(app)` area); gated like `/admin` via the
 * `adminPanel` capability — Phase 1 keeps publish an admin operation. Body:
 * `{ project: string }`. On success returns the playable game URL.
 *
 *   POST /api/game-maker/publish   { "project": "<key>" }
 *   → 200 { ok, key, url, playUrl }
 */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasCapability(locals.user.role, ADMIN_PANEL_CAPABILITY, roleOverrides, overrides)) {
		return json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
	}

	let body: { project?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}
	const project = typeof body.project === 'string' ? body.project.trim() : '';
	if (!project) return json({ error: 'Missing project' }, { status: 400, headers: NO_STORE });
	if (!(await projectExists(project))) {
		return json({ error: 'Unknown project' }, { status: 400, headers: NO_STORE });
	}

	try {
		// The runtime fetches its authoring data back from THIS launcher's origin.
		const result = await publishGame(project, url.origin);
		return json({ ok: true, ...result }, { headers: NO_STORE });
	} catch (e) {
		console.error('publishGame failed:', e);
		throw error(502, 'Publish failed.');
	}
};
