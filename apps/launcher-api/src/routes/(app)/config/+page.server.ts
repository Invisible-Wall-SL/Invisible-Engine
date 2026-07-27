import { error, redirect } from '@sveltejs/kit';
import { validateGameConfigDoc } from 'game-config';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { gameConfigDefaultFor, resolveGameConfig } from '$lib/server/gameConfigDefaults';
import { projectGameType, projectName } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { resolveToolScope } from '$lib/server/toolScope';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { PageServerLoad } from './$types';

/**
 * Invisible Game Config (`/config`) — author the project's GAME MATH CONTRACT: the symbol
 * dictionary + paytable, paylines, grid, bet modes, identity/RTP, and the cosmetic reel strips.
 * It replaces the ONE compiled `apps/lines/src/game/config.ts` that every online project shares.
 *
 * The page opens on the RESOLVED config: the project's authored doc if it has one, otherwise its
 * game-type template default. `source` tells the author which they are looking at (so "edit" vs
 * "adopt the template" is never ambiguous), and `etag` is the save precondition — `null` when the
 * project has never authored, which correctly asks R2 to CREATE rather than overwrite on first save.
 *
 * See `docs/design/invisible-game-config.md`.
 */
export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	// Defensive parity with the other tool routes: the parent layout already resolved the effective
	// manifest, but re-check with overrides so a per-user revoke is honoured.
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const userOverrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'gameConfig', roleOverrides, userOverrides)) {
		throw error(403, 'Your role does not have access to Invisible Game Config.');
	}

	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});

	const gameType = await projectGameType(projectKey);
	const [{ doc, source, etag }, name] = await Promise.all([
		resolveGameConfig(clientKey, projectKey, gameType),
		projectName(projectKey),
	]);

	// The template default the "Reset to template default" action restores. Sent even when the
	// project is already on it (source === 'template') so the button works after any edit without a
	// round-trip. Null only if the generated defaults are broken (see `gameConfigDefaults.ts`).
	const templateDefault = gameConfigDefaultFor(gameType);

	return {
		clientKey,
		projectKey,
		projectName: name,
		gameType,
		tools,
		doc,
		source,
		etag,
		templateDefault,
		// Validate server-side too, so the page shows issues on FIRST paint (before any edit fires
		// the client validator) — a pasted-in config that lies is visible immediately.
		issues: doc ? validateGameConfigDoc(doc) : [],
	};
};
