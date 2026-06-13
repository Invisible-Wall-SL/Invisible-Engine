import { error, json } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { type CustomKind, loadKind, saveKind } from '$lib/server/kindStorage';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

/**
 * Auth + role gate matching the editor template endpoint: logged-in and entitled
 * to the `editor` tool (role + per-user overrides applied). Custom kinds are
 * GLOBAL under `_shared/editor-kinds/` (§21.2), so — like templates — we gate on
 * the tool entitlement alone, with NO project scope.
 */
async function gate(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'editor', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Editor.');
	}
}

/** Resolve one custom kind's `{ id, name, doc }` (§21.3). 404 when it doesn't exist. */
export const GET: RequestHandler = async ({ url, locals }) => {
	await gate(locals);
	const id = url.searchParams.get('id');
	if (!id) throw error(400, 'missing id');
	const kind = await loadKind(id);
	if (!kind) throw error(404, 'not found');
	return json(kind);
};

/** Persist an authored custom kind to its shared R2 key (§21.3). */
export const POST: RequestHandler = async ({ request, locals }) => {
	await gate(locals);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	try {
		const saved = await saveKind(body as CustomKind);
		return json({ ok: true, id: saved.id, name: saved.name });
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Invalid kind.');
	}
};
