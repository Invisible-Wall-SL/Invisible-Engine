import { json } from '@sveltejs/kit';
import { parseModeRoute } from '$lib/bonusImport';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE, sessionIdFromToken } from '$lib/server/auth';
import {
	applyBonusImport,
	importToolsMissing,
	sourceFeatures,
} from '$lib/server/projectBonusImport';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { canAccessProject, projectClientKey } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

type Gate = { ok: true; client: string; source?: string } | { ok: false; response: Response };

const unauthorized = () => json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });

/**
 * The Game Maker grant, every tool whose doc an import writes, both projects accessible
 * (`mayAccess`, the handler's own `canAccessProject`), and the SAME client: an import copies a
 * feature between one client's projects, never across clients.
 */
async function gate(
	user: NonNullable<App.Locals['user']>,
	mayAccess: (project: string) => Promise<boolean>,
	project: string,
	source: string | undefined,
): Promise<Gate> {
	const refuse = (status: number, error: string): Gate => ({
		ok: false,
		response: json({ error }, { status, headers: NO_STORE }),
	});
	const { role, id } = user;
	const roleOverrides = await getRoleOverrides(role);
	const toolOverrides = await getToolOverrides(id);
	const hasTool = (tool: string) => roleHasTool(role, tool, roleOverrides, toolOverrides);
	if (!hasTool('gameMaker')) return refuse(403, 'Forbidden');
	const missing = importToolsMissing(hasTool);
	if (missing.length) {
		return refuse(403, `The import writes docs your role cannot edit: ${missing.join(', ')}.`);
	}
	if (!project) return refuse(400, 'Missing project');
	if (!(await mayAccess(project))) return refuse(404, 'Unknown project');
	const client = (await projectClientKey(project)) ?? UNASSIGNED_CLIENT;
	if (source !== undefined) {
		if (!source || !(await mayAccess(source))) {
			return refuse(404, 'Unknown source project');
		}
		if (((await projectClientKey(source)) ?? UNASSIGNED_CLIENT) !== client) {
			return refuse(400, 'A bonus can only be imported from a project of the same client.');
		}
	}
	return { ok: true, client, source };
}

/**
 * What a source project offers to import (docs/design/pots-overlay.md §5 A).
 *
 *   GET /api/game-maker/import?project=<key>&source=<key>
 *   → 200 { features: ImportableFeature[] }   (`refused` says why one cannot be imported yet)
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const project = url.searchParams.get('project')?.trim() ?? '';
	const source = url.searchParams.get('source')?.trim() ?? '';
	const user = locals.user;
	if (!user) return unauthorized();
	const mayAccess = (key: string) => canAccessProject(user.id, user.role, key);
	const gated = await gate(user, mayAccess, project, source);
	if (!gated.ok) return gated.response;
	const offered = await sourceFeatures(gated.client, source);
	if ('error' in offered) return json(offered, { status: 409, headers: NO_STORE });
	return json(offered, { headers: NO_STORE });
};

/**
 * Import a bonus from another project of the same client, or re-sync one (Phase 7).
 *
 *   POST /api/game-maker/import
 *     { project, source, mode, asMode: true, routes?: ModeRoute[] }  — Add a bonus mode…
 *     { project, source, mode, replace?: boolean, pots?: string[] }   — the pots overlay's import
 *     { project, mode, resync: true }                                — re-sync from its recorded source
 *
 * "Add a bonus mode…" (`docs/design/bonus-games.md` §1, Phase 6) adds a respin mode as a NEW mode,
 * `_2`-renamed on a clash, started by `routes`; a reels mode goes through the pots overlay's import,
 * started by the pots among them.
 *   → 200 { ok, mode, resynced, replaced, renamed, leftOut, droppedActivates, parts }
 *   → 400 / 403 / 404 / 409 { error }
 *
 * The config is written first (`If-Match`, with a backup), then each other doc as its own
 * conditional write; see `projectBonusImport.ts`. While another session holds an edit lease on one of
 * those docs it answers 409 and writes nothing. The source project is only ever read.
 */
export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return json({ error: 'Expected a JSON object' }, { status: 400, headers: NO_STORE });
	}
	const body: Record<string, unknown> = raw as Record<string, unknown>;
	const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
	const project = text(body.project);
	const resync = body.resync === true;
	const mode = text(body.mode);
	if (!mode) return json({ error: 'Missing mode' }, { status: 400, headers: NO_STORE });
	const pots = Array.isArray(body.pots)
		? body.pots.filter((p): p is string => typeof p === 'string')
		: undefined;
	const routes = Array.isArray(body.routes) ? body.routes.map(parseModeRoute) : undefined;
	if (routes?.some((r) => !r)) {
		return json({ error: 'Unknown route' }, { status: 400, headers: NO_STORE });
	}
	// A re-sync's source is the one the config records; the gate checks it once it is known.
	const user = locals.user;
	if (!user) return unauthorized();
	const mayAccess = (key: string) => canAccessProject(user.id, user.role, key);
	const gated = await gate(user, mayAccess, project, resync ? undefined : text(body.source));
	if (!gated.ok) return gated.response;

	const sessionId = await sessionIdFromToken(cookies.get(SESSION_COOKIE));
	if (!sessionId) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });

	const result = await applyBonusImport(gated.client, project, {
		source: gated.source,
		mode,
		resync,
		replace: body.replace === true,
		pots,
		asMode: body.asMode === true,
		routes: routes?.filter((r) => r !== undefined),
		sessionId,
		mayRead: async (source) => (await gate(user, mayAccess, project, source)).ok,
	});
	if (!result.ok) {
		return json({ error: result.error }, { status: result.status, headers: NO_STORE });
	}
	return json(result, { headers: NO_STORE });
};
