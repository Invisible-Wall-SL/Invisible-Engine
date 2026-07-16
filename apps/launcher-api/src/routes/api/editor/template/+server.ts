import { error, json } from '@sveltejs/kit';
import type { GameTemplate } from 'engine-layout';
import { roleHasTool } from '$lib/roles';
import { ConflictError, jsonBaseEtag } from '$lib/server/r2';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { loadTemplateWithEtag, saveTemplate } from '$lib/server/templateStorage';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

/**
 * Auth + role gate matching the editor `+page.server.ts` action gate: logged-in
 * and entitled to the `editor` tool (role + per-user overrides applied). Unlike
 * `toolScope.gate`, there is NO project scope — templates are GLOBAL per game
 * type under `_shared/`, so we gate on the tool entitlement alone.
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
	await gate(locals);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	const baseEtag =
		isRecord(body) && body.force === true
			? undefined
			: jsonBaseEtag(isRecord(body) ? body.baseEtag : undefined);
	try {
		const { etag } = await saveTemplate(body as GameTemplate, baseEtag);
		return json({ ok: true, etag });
	} catch (e) {
		// Before the generic 400 — a lost CAS is not a malformed template.
		if (e instanceof ConflictError) {
			return json(
				{
					ok: false,
					error: 'conflict',
					message:
						'Someone else changed this template while you were editing it. ' +
						'Your changes are still here — reload to get their version first.',
				},
				{ status: 409 },
			);
		}
		throw error(400, e instanceof Error ? e.message : 'Invalid template.');
	}
};

/**
 * Resolve the effective template for `?gameType=` (R2 override or built-in) plus the
 * ETag a save must match. `etag: null` = no R2 override (the built-in fallback), so a
 * save creates.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	await gate(locals);
	const gameType = url.searchParams.get('gameType');
	if (!gameType) throw error(400, 'missing gameType');
	const { template, etag } = await loadTemplateWithEtag(gameType);
	if (!template) throw error(404, 'not found');
	return json({ template, etag });
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
