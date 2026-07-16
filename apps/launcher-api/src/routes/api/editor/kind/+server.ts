import { error, json } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { type CustomKind, loadKind, saveKind } from '$lib/server/kindStorage';
import { ConflictError } from '$lib/server/r2';
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

/**
 * Persist an authored custom kind to its shared R2 key (§21.3).
 *
 * Kinds are GLOBAL and their id comes from the author's chosen name, so an id that is
 * already taken answers **409** instead of replacing another author's kind. `overwrite:
 * true` is the author confirming — mirroring the Font Maker's id-collision contract.
 *
 * Body: `{ id, name, doc, overwrite? }`.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	await gate(locals);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	const overwrite = isRecord(body) && body.overwrite === true;
	try {
		const saved = await saveKind(body as CustomKind, { overwrite });
		return json({ ok: true, id: saved.id, name: saved.name });
	} catch (e) {
		// The conflict branch MUST come before the generic 400, else a taken id reads as
		// "invalid kind" and the author has no idea another kind is being protected.
		if (e instanceof ConflictError) {
			const id = isRecord(body) && typeof body.id === 'string' ? body.id : 'that id';
			return json(
				{
					ok: false,
					error: 'conflict',
					message: `A game kind "${id}" already exists. Pick a different name, or confirm overwrite.`,
				},
				{ status: 409 },
			);
		}
		throw error(400, e instanceof Error ? e.message : 'Invalid kind.');
	}
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
