import { error } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SHARED_ENGINE_STORYBOOK_PREFIX, SUB, UNASSIGNED_CLIENT } from './projectPaths';
import { canAccessProject, projectClientKey } from './projects';
import { objectExists } from './r2';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

/**
 * Invisible Storybook: published `storybook build` outputs served from R2.
 *
 * Layout (one prefix per storybook, each a self-contained static site whose
 * internal links are RELATIVE — index.html, iframe.html, hashed assets/):
 * - `_shared/storybook/engine/**` — the engine reference (apps/lines); readable
 *   by any logged-in user entitled to the tool.
 * - `<client>/<project>/storybook/**` — per-project builds; gated by the same
 *   project-access model as every other project namespace.
 *
 * The view route serves them under `/storybook/view/engine/<rel>` and
 * `/storybook/view/p/<projectKey>/<rel>` so each build's relative links resolve
 * against its own URL directory.
 */

/** Reserved first path segment for the shared engine reference storybook. */
export const ENGINE_STORYBOOK_SEGMENT = 'engine';
/** First path segment namespacing project storybooks (avoids key collisions). */
export const PROJECT_STORYBOOK_SEGMENT = 'p';

/** Auth + role gate (mirrors `requireSpineAccess`). Returns the non-null user. */
export async function requireStorybookAccess(
	locals: App.Locals,
): Promise<NonNullable<App.Locals['user']>> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'storybook', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Storybook.');
	}
	return locals.user;
}

/** A storybook build's R2 prefix (no trailing slash). */
export function projectStorybookPrefix(clientKey: string | null, projectKey: string): string {
	return SUB.storybook(clientKey ?? UNASSIGNED_CLIENT, projectKey);
}

/** True when a published build exists at the prefix (its index.html is there). */
export async function storybookExists(prefix: string): Promise<boolean> {
	return objectExists(`${prefix}/index.html`);
}

export const sharedEngineStorybookPrefix = SHARED_ENGINE_STORYBOOK_PREFIX;

/** An escape-free relative path inside one storybook build (`assets/x.js`). */
function isSafeRel(rel: string): boolean {
	if (!rel || rel.startsWith('/') || rel.includes('\\')) return false;
	return rel.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/**
 * Resolve the view route's splat segments to an R2 key, enforcing access:
 * `engine/<rel>` is open to every gated user; `p/<projectKey>/<rel>` requires
 * the project to be in the user's accessible set. Returns `null` when the path
 * names a storybook ROOT (the caller redirects to its index.html).
 */
export async function resolveStorybookKey(
	user: NonNullable<App.Locals['user']>,
	segments: string[],
): Promise<string | null> {
	if (segments[0] === ENGINE_STORYBOOK_SEGMENT) {
		const rel = segments.slice(1).join('/');
		if (!rel) return null;
		if (!isSafeRel(rel)) throw error(403, 'forbidden');
		return `${SHARED_ENGINE_STORYBOOK_PREFIX}/${rel}`;
	}
	if (segments[0] === PROJECT_STORYBOOK_SEGMENT && segments.length >= 2) {
		const projectKey = segments[1];
		const rel = segments.slice(2).join('/');
		if (rel && !isSafeRel(rel)) throw error(403, 'forbidden');
		if (!(await canAccessProject(user.id, user.role, projectKey))) {
			throw error(403, 'You do not have access to this project.');
		}
		if (!rel) return null;
		const clientKey = await projectClientKey(projectKey);
		return `${projectStorybookPrefix(clientKey, projectKey)}/${rel}`;
	}
	throw error(404, 'not found');
}
