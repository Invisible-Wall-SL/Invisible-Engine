import { error, json } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { listAllComponents } from '$lib/server/componentStorage';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

/** Same tool-only gate as the sibling component routes. */
async function gate(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'editor', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Editor.');
	}
}

/**
 * Every authored component across ALL projects + the shared library, each tagged
 * with its project key. Powers the Storybook "Authored Components" gallery (served
 * same-origin from the launcher, so the session cookie carries the auth).
 */
export const GET: RequestHandler = async ({ locals }) => {
	await gate(locals);
	const components = await listAllComponents();
	return json(components);
};
