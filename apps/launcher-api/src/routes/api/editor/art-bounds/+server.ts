import { error, json } from '@sveltejs/kit';
import {
	ConflictError,
	loadArtBoundsDocWithEtag,
	saveArtBoundsDoc,
} from '$lib/server/artBoundsStorage';
import { gate } from '$lib/server/toolScope';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * The project's ART BOUNDS — the per-region declared box (`<assetKey>::<region>` → `{x,y,w,h}`),
 * the sprite twin of a rig's size frame and of a flipbook clip's `bounds`.
 *
 * Gated on `editor` with `flipbook`/`fx`/`rigger` as alt-tools, matching `/api/editor/flipbooks`:
 * a box describes the ART, so every surface that draws a region legitimately reads it. Scope is
 * bound to the SESSION's active project, like every other editor endpoint.
 *
 * The doc never ships as its own asset: `editorArtExport` folds each box into the TexturePacker
 * JSON's `sourceSize`/`spriteSourceSize`, which is where PIXI reads a declared box from.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		altTools: ['flipbook', 'fx', 'rigger'],
		forbiddenMessage: 'Your role does not have access to the project art bounds.',
	});
	const { doc, etag } = await loadArtBoundsDocWithEtag(clientKey, projectKey);
	return json({ bounds: doc.bounds, etag });
};

/**
 * Replace the whole map, guarded by `baseEtag` (multi-user-concurrency Phase 1).
 *
 * The doc is read and written WHOLE — it is a small flat map — so an unguarded save would erase a
 * concurrent author's every box, not just the one being edited. A stale precondition answers 409
 * through `json()` (never `error()`, which the client cannot read a body from).
 *
 * Body: `{ bounds: Record<string, {x,y,w,h}>, baseEtag: string | null }` (or `force: true`).
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		altTools: ['flipbook', 'fx', 'rigger'],
		forbiddenMessage: 'Your role does not have access to the project art bounds.',
	});
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw error(400, 'Body must be an object.');
	}
	const bounds = (body as Record<string, unknown>).bounds;
	if (typeof bounds !== 'object' || bounds === null || Array.isArray(bounds)) {
		throw error(400, '`bounds` must be a plain object.');
	}
	const baseEtag = writeBaseEtagJson(body);
	try {
		const saved = await saveArtBoundsDoc(clientKey, projectKey, { bounds }, baseEtag);
		return json({ ok: true, etag: saved.etag, bounds: saved.doc.bounds });
	} catch (e) {
		if (e instanceof ConflictError) {
			return json(
				{
					ok: false,
					error: 'conflict',
					message:
						'Someone else changed this project’s art bounds while you were editing. ' +
						'Reload to get their version, then re-apply your box.',
				},
				{ status: 409 },
			);
		}
		throw error(400, e instanceof Error ? e.message : 'Invalid art bounds.');
	}
};
