import { json } from '@sveltejs/kit';
import { POTS_OVERLAY_PRESET_IDS } from 'game-config';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE, sessionIdFromToken } from '$lib/server/auth';
import { addOnToolsMissing, applyPotsOverlayAddOn } from '$lib/server/projectAddOn';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { canAccessProject, projectClientKey } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Add the pots overlay to an existing project (docs/design/pots-overlay.md §4, Game Maker row).
 *
 *   POST /api/game-maker/add-on
 *     { project, preset?: PotsOverlayPresetId (POTS_OVERLAY_PRESET_IDS), flow?: boolean }
 *   → 200 { ok, configAdded, renamed, seeds: { symbols, layout, winText, flow? } }
 *   → 400 / 409 { error }
 *
 * With a `preset` the overlay is merged into the Game Config (refused, 409, when the project already
 * has one) and its parts are seeded. Without one, the project must already have the overlay and only
 * its missing parts are seeded — the re-run after a part lost a race. `flow` also grafts the overlay
 * steps into a stored flow. Every write is create-only and conditional; see `projectAddOn.ts`.
 *
 * Gated like the duplicate endpoint (the `gameMaker` tool, plus a project the caller can access),
 * and by the tools that own the docs it writes ({@link addOnToolsMissing}). While another session
 * holds an edit lease on one of those docs it answers 409 and writes nothing.
 */
export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	const { role } = locals.user;
	const roleOverrides = await getRoleOverrides(role);
	const toolOverrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(role, 'gameMaker', roleOverrides, toolOverrides)) {
		return json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return json({ error: 'Expected a JSON object' }, { status: 400, headers: NO_STORE });
	}
	const body: { project?: unknown; preset?: unknown; flow?: unknown } = raw;
	const flow = body.flow === true;
	const missing = addOnToolsMissing(
		(tool) => roleHasTool(role, tool, roleOverrides, toolOverrides),
		flow,
	);
	if (missing.length) {
		return json(
			{ error: `The add-on writes docs your role cannot edit: ${missing.join(', ')}.` },
			{ status: 403, headers: NO_STORE },
		);
	}

	const project = typeof body.project === 'string' ? body.project.trim() : '';
	if (!project) return json({ error: 'Missing project' }, { status: 400, headers: NO_STORE });
	if (!(await canAccessProject(locals.user.id, locals.user.role, project))) {
		return json({ error: 'Unknown project' }, { status: 404, headers: NO_STORE });
	}
	const preset = POTS_OVERLAY_PRESET_IDS.find((id) => id === body.preset);
	if (body.preset !== undefined && !preset) {
		return json({ error: 'Unknown pots overlay preset.' }, { status: 400, headers: NO_STORE });
	}

	const sessionId = await sessionIdFromToken(cookies.get(SESSION_COOKIE));
	if (!sessionId) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });

	const client = (await projectClientKey(project)) ?? UNASSIGNED_CLIENT;
	const result = await applyPotsOverlayAddOn(client, project, { preset, flow, sessionId });
	if (!result.ok) {
		return json({ error: result.error }, { status: result.status, headers: NO_STORE });
	}
	return json(result, { headers: NO_STORE });
};
