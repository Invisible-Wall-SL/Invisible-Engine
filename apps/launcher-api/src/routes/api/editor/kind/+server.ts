import { error, json } from '@sveltejs/kit';
import { requireEditorAccess } from '$lib/server/editorAccess';
import { conflictResponse } from '$lib/server/conflict';
import { readJson } from '$lib/server/http';
import { type CustomKind, loadKind, saveKind } from '$lib/server/kindStorage';
import type { RequestHandler } from './$types';

/*
 * Gated on the `editor` tool alone, like templates: custom kinds are GLOBAL under
 * `_shared/editor-kinds/` (§21.2), with NO project scope.
 */

/** Resolve one custom kind's `{ id, name, doc }` (§21.3). 404 when it doesn't exist. */
export const GET: RequestHandler = async ({ url, locals }) => {
	await requireEditorAccess(locals);
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
	await requireEditorAccess(locals);
	const body = await readJson(request, 'Invalid JSON body.');
	const overwrite = isRecord(body) && body.overwrite === true;
	try {
		const saved = await saveKind(body as CustomKind, { overwrite });
		return json({ ok: true, id: saved.id, name: saved.name });
	} catch (e) {
		// The conflict branch MUST come before the generic 400, else a taken id reads as
		// "invalid kind" and the author has no idea another kind is being protected.
		const id = isRecord(body) && typeof body.id === 'string' ? body.id : 'that id';
		const conflict = conflictResponse(
			e,
			`A game kind "${id}" already exists. Pick a different name, or confirm overwrite.`,
		);
		if (conflict) return conflict;
		throw error(400, e instanceof Error ? e.message : 'Invalid kind.');
	}
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
