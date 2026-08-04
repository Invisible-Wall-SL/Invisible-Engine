import { error, json } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import {
	ConflictError,
	listComponentDefaults,
	loadComponentDefaultsWithEtag,
	saveComponentDefaults,
} from '$lib/server/componentDefaultsStorage';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * Auth + role gate matching the component route: logged-in and entitled to the
 * `editor` tool (role + per-user overrides applied). Defaults are keyed by project
 * (`editor/<projectKey>/component-defaults/`), so the project is a request param —
 * there is no session-bound project scope here, exactly like the component route.
 */
async function gate(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'editor', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Editor.');
	}
}

/**
 * Read the per-project component defaults (§13.3). `?project=&id=` → `{ params }`
 * for that component (`{ params: {} }` when absent — defaults are an empty map, not
 * a 404). `?project=` with no `id` → the full `componentId → params` map for the
 * project, used once to hydrate the page.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	await gate(locals);
	const project = url.searchParams.get('project');
	if (!project) throw error(400, 'missing project');
	const id = url.searchParams.get('id');
	if (!id) {
		const defaults = await listComponentDefaults(project);
		return json({ defaults });
	}
	// `{ params, etag }` — the etag is the precondition the client sends back on save (Phase 1).
	const { params, etag } = await loadComponentDefaultsWithEtag(project, id);
	return json({ params, etag });
};

/**
 * Persist a component's per-project param defaults to its sidecar R2 key (§13.3).
 *
 * Guarded by `baseEtag` (Phase 1 of `docs/design/multi-user-concurrency.md`): a stale one
 * answers **409** rather than erasing a concurrent author's defaults. The precondition is
 * REQUIRED — a save that omits it (and is not a `force` overwrite) is a 400.
 *
 * Body: `{ project, id, params, baseEtag: string | null }` (or `force: true`).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	await gate(locals);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	if (!isRecord(body)) throw error(400, 'Body must be an object.');
	const { project, id, params } = body;
	if (typeof project !== 'string' || !project) throw error(400, 'missing project');
	if (typeof id !== 'string' || !id) throw error(400, 'missing id');
	if (!isRecord(params)) throw error(400, '`params` must be a plain object.');
	const baseEtag = writeBaseEtagJson(body);
	try {
		const { etag } = await saveComponentDefaults(project, id, params, baseEtag);
		return json({ ok: true, etag });
	} catch (e) {
		// Conflict before the generic 400 — a lost CAS is not a malformed payload.
		if (e instanceof ConflictError) {
			return json(
				{
					ok: false,
					error: 'conflict',
					message:
						'Someone else saved these component defaults while you were editing. ' +
						'Your changes are still here — reload to get their version first.',
				},
				{ status: 409 },
			);
		}
		throw error(400, e instanceof Error ? e.message : 'Invalid defaults.');
	}
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
