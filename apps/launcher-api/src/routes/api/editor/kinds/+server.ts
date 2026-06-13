import { error, json } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { listKinds } from '$lib/server/kindStorage';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

/**
 * Auth + role gate matching the editor template endpoint: logged-in and entitled
 * to the `editor` tool. Custom kinds are GLOBAL (§21.2), so there is no project
 * scope — gate on the tool entitlement alone.
 */
async function gate(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'editor', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Editor.');
	}
}

/** List every author-created custom kind's `{ id, name }` for the picker (§21.3). */
export const GET: RequestHandler = async ({ locals }) => {
	await gate(locals);
	return json(await listKinds());
};
