import { error } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

/**
 * Gate for the /comfyui JSON control endpoints — the exact same entitlement the
 * /comfyui page enforces (user must hold the `comfyui` tool). Mirrors the page's
 * `parent().tools` check, resolved directly here since a `+server.ts` has no
 * `parent()`. Throws 401 (not authed) / 403 (no tool) otherwise.
 */
export async function requireComfyAccess(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'comfyui', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to ComfyUI.');
	}
}
