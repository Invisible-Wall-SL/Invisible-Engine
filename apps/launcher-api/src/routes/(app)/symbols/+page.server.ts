import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE, getActiveScope } from '$lib/server/auth';
import { listProjectAssets } from '$lib/server/projectAssets';
import { projectGameType, projectName } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { loadPublishedSymbolDefaults, symbolDefaultsFor } from '$lib/server/symbolDefaults';
import { loadSymbolsDoc } from '$lib/server/symbolsStorage';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { PageServerLoad } from './$types';

/**
 * The Invisible Symbols State Machine renders a live preview grid (canvas image
 * thumbs + a WebGL spine preview for the focused cell). Server-rendering that is
 * pointless and fragile — same rationale as the editor/font routes: `load` still
 * runs server-side and its data flows to the client; only the component render is
 * client-only.
 */
export const ssr = false;

export const load: PageServerLoad = async ({ locals, cookies, parent }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	// Defensive parity with the editor route: the parent layout already resolved
	// the effective manifest, but re-check with overrides so a per-user revoke is
	// honoured even if the manifest were stale.
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const userOverrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'symbols', roleOverrides, userOverrides)) {
		throw error(403, 'Your role does not have access to the Invisible Symbols State Machine.');
	}

	const { clientKey, projectKey } = await getActiveScope(cookies.get(SESSION_COOKIE));
	const [doc, assets, gameType, published] = await Promise.all([
		loadSymbolsDoc(clientKey, projectKey),
		listProjectAssets(clientKey, projectKey),
		projectGameType(projectKey),
		loadPublishedSymbolDefaults(clientKey, projectKey),
	]);
	// The defaults drive the grid's symbol list, the 6 states, and every cell's
	// default binding; the doc above is the sparse override on top. Prefer the
	// project's OWN published `SYMBOL_INFO_MAP` (built from its coded map) so e.g.
	// Book of Borut shows its symbols; fall back to the committed coded set for an
	// un-published project (or `apps/lines` dev) resolved by game type.
	const defaults = published ?? symbolDefaultsFor(gameType);

	return {
		clientKey,
		projectKey,
		projectName: await projectName(projectKey),
		doc,
		defaults,
		assets,
	};
};
