import { error, json } from '@sveltejs/kit';
import type { GameTemplate } from 'engine-layout';
import { roleHasTool } from '$lib/roles';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { loadTemplate, saveTemplate } from '$lib/server/templateStorage';
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

/** Persist an authored game-type template to its shared R2 key (§7.5). */
export const POST: RequestHandler = async ({ request, locals }) => {
	await gate(locals);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	try {
		await saveTemplate(body as GameTemplate);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Invalid template.');
	}
	return json({ ok: true });
};

/** Resolve the effective template for `?gameType=` (R2 override or built-in). */
export const GET: RequestHandler = async ({ url, locals }) => {
	await gate(locals);
	const gameType = url.searchParams.get('gameType');
	if (!gameType) throw error(400, 'missing gameType');
	const template = await loadTemplate(gameType);
	if (!template) throw error(404, 'not found');
	return json(template);
};
