import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { listComponentDefaults } from '$lib/server/componentDefaultsStorage';
import { listComponents } from '$lib/server/componentStorage';
import { loadDoc } from '$lib/server/editorStorage';
import { SESSION_COOKIE } from '$lib/server/auth';
import { listProjectAssets } from '$lib/server/projectAssets';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { resolveToolScope } from '$lib/server/toolScope';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { PageServerLoad } from './$types';

/**
 * The Component Editor is a client-only canvas/WebGL app (reuses the editor's
 * pixi-like 2D canvas + spine WebGL preview). SSR is pointless AND fragile here
 * for the same reasons the editor disables it — `load` still runs server-side.
 */
export const ssr = false;

/**
 * Auth + role gate. The component STORAGE + API (`/api/editor/component[s]`) are
 * gated on the `editor` tool, so this page gates on the SAME `editor` tool — a
 * user who can open this page can always read/write its components. The separate
 * `componentEditor` tool entry only controls whether the home grid surfaces the
 * tool card (granted to the same roles as `editor`), so the two never diverge.
 */
export const load: PageServerLoad = async ({ locals, cookies, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'editor', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to the Invisible Component Editor.');
	}
	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});
	const [components, assets, componentDefaults, doc] = await Promise.all([
		// Components the project can use (shared + project, project shadowing shared, §8.3).
		listComponents({ projectKey }),
		listProjectAssets(clientKey, projectKey),
		// Per-project author-set param defaults, by component id (§13.3) — hydrates the
		// Defaults controls + the non-empty canvas preview without a second round-trip.
		listComponentDefaults(projectKey),
		// The project's editor doc — only for its `mainSizesMap` (the game's real MAIN
		// box, e.g. 1422×800 for Borut). The Component Editor previews game-space
		// components through this box (same as the Scene Editor), so what's authored
		// matches the game instead of a neutral 1920×1080 frame.
		loadDoc(clientKey, projectKey),
	]);
	// Optional deep-link target: `/components?id=<id>` opens that component on mount.
	// `/editor`'s "Open in Component Editor" sends `&project=` too — that param is now
	// honoured by `resolveToolScope` above (project-explicit scoping), so the page
	// binds to the editor's project; here we only need to read the id.
	const openId = url.searchParams.get('id') || null;
	return {
		clientKey,
		projectKey,
		components,
		assets,
		componentDefaults,
		openId,
		mainSizesMap: doc.mainSizesMap,
	};
};
