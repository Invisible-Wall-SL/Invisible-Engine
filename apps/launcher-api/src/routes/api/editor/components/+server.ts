import { error, json } from '@sveltejs/kit';
import type { ComponentCategory } from 'engine-layout';
import { roleHasTool } from '$lib/roles';
import { listComponents } from '$lib/server/componentStorage';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

/** Same tool-only gate as the editor template / single-component routes. */
async function gate(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'editor', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Editor.');
	}
}

const CATEGORIES = new Set<ComponentCategory>(['ui', 'overlay', 'scenery']);

/** List components (shared + project, project shadowing shared); optional filters. */
export const GET: RequestHandler = async ({ url, locals }) => {
	await gate(locals);
	const projectKey = url.searchParams.get('project') || undefined;
	const scopeParam = url.searchParams.get('scope');
	const scope = scopeParam === 'shared' || scopeParam === 'project' ? scopeParam : undefined;
	const categoryParam = url.searchParams.get('category');
	const category =
		categoryParam && CATEGORIES.has(categoryParam as ComponentCategory)
			? (categoryParam as ComponentCategory)
			: undefined;
	const components = await listComponents({ projectKey, scope, category });
	return json(components);
};
