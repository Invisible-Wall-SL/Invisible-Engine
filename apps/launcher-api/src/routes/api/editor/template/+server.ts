import { error, json } from '@sveltejs/kit';
import type { GameTemplate } from 'engine-layout';
import { requireEditorAccess } from '$lib/server/editorAccess';
import { conflictResponse } from '$lib/server/conflict';
import { readJson } from '$lib/server/http';
import { loadTemplateWithEtag, saveTemplate } from '$lib/server/templateStorage';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/*
 * Gated on the `editor` tool alone. Unlike `toolScope.gate`, there is NO project scope —
 * templates are GLOBAL per game type under `_shared/`.
 */

/**
 * Persist an authored game-type template to its shared R2 key (§7.5).
 *
 * Guarded by `baseEtag`: the key is GLOBAL (one object per game type, shared across
 * every project), so a lease can never cover it and a stale etag answers **409**
 * instead of discarding another author's slot edits. `force: true` is the author's
 * explicit "overwrite theirs". Both ride ALONGSIDE the template fields and are dropped
 * by `normalizeTemplate` (which rebuilds `{gameType, version, scenes}`), so the wire
 * shape is unchanged for the template itself.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	await requireEditorAccess(locals);
	const body = await readJson(request, 'Invalid JSON body.');
	const baseEtag = writeBaseEtagJson(body);
	try {
		const { etag } = await saveTemplate(body as GameTemplate, baseEtag);
		return json({ ok: true, etag });
	} catch (e) {
		// Before the generic 400 — a lost CAS is not a malformed template.
		const conflict = conflictResponse(
			e,
			'Someone else changed this template while you were editing it. ' +
				'Your changes are still here — reload to get their version first.',
		);
		if (conflict) return conflict;
		throw error(400, e instanceof Error ? e.message : 'Invalid template.');
	}
};

/**
 * Resolve the effective template for `?gameType=` (R2 override or built-in) plus the
 * ETag a save must match. `etag: null` = no R2 override (the built-in fallback), so a
 * save creates.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	await requireEditorAccess(locals);
	const gameType = url.searchParams.get('gameType');
	if (!gameType) throw error(400, 'missing gameType');
	const { template, etag } = await loadTemplateWithEtag(gameType);
	if (!template) throw error(404, 'not found');
	return json({ template, etag });
};
