import { error, json } from '@sveltejs/kit';
import type { ComponentCategory } from 'engine-layout';
import { roleHasTool } from '$lib/roles';
import { listComponents, listComponentsWithEtags } from '$lib/server/componentStorage';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { requireOptionalProjectKey } from '$lib/server/toolScope';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

/** Same tool gate as the single-component route; `?project=` is access-checked after it. */
async function gate(locals: App.Locals): Promise<NonNullable<App.Locals['user']>> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'editor', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Editor.');
	}
	return locals.user;
}

const CATEGORIES = new Set<ComponentCategory>(['ui', 'overlay', 'scenery']);

/**
 * List components (shared + project, project shadowing shared); optional filters.
 * `?etags=1` answers `{ components, etags }` instead: each def with the ETag of the object it was
 * read from (`null` = built-in), so a tab that refreshes its list gets content and save
 * precondition together and can never pair an old def with a newer ETag.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await gate(locals);
	const projectKey = await requireOptionalProjectKey(user, url.searchParams.get('project'));
	const scopeParam = url.searchParams.get('scope');
	const scope = scopeParam === 'shared' || scopeParam === 'project' ? scopeParam : undefined;
	const categoryParam = url.searchParams.get('category');
	const category =
		categoryParam && CATEGORIES.has(categoryParam as ComponentCategory)
			? (categoryParam as ComponentCategory)
			: undefined;
	if (url.searchParams.get('etags') === '1') {
		const entries = await listComponentsWithEtags({ projectKey, scope, category });
		const etags: Record<string, string | null> = {};
		for (const e of entries) etags[e.def.id] = e.etag;
		return json({ components: entries.map((e) => e.def), etags });
	}
	const components = await listComponents({ projectKey, scope, category });
	return json(components);
};
