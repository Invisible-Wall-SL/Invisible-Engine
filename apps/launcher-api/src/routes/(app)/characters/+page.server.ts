import { error, redirect } from '@sveltejs/kit';
import { listedLook } from '$lib/characters/characterAdd';
import { pageIssues, sheetProjection } from '$lib/characters/characterSheetCheck';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { listComponents } from '$lib/server/componentStorage';
import { loadDocWithEtag } from '$lib/server/editorStorage';
import { gameConfigDefaultFor, resolveGameConfig } from '$lib/server/gameConfigDefaults';
import { projectFamily, projectGameType, projectName } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { resolveToolScope } from '$lib/server/toolScope';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { PageServerLoad } from './$types';

/**
 * Invisible Characters (`/characters`, `docs/design/game-families.md` §4.3, §5.1): an arcade
 * project's characters — `GameConfigDoc.arcade.characters` (§9 #14). The characters live IN the
 * game config, so this page opens the same resolved doc `/config` does and saves it through the
 * same `PUT /api/game-config` under the same lease (`gameConfig`). The doc is the whole config
 * (paytable included), so the load demands the Game Config grant as well as this tool's — the same
 * gate `GET /api/game-config` applies — and refuses without it. Every role holding this tool holds
 * Game Config by default; only an override can split them.
 *
 * The page lists what the save says (`characterSheetCheck.ts` `pageIssues`), character sheets
 * included, and reads the screens' projections once for the view warnings the save cannot make.
 *
 * For a project whose family does not use this tool the load still runs (the `(app)` layout only
 * swaps what renders for its hidden-tool notice), so it returns no config and reads nothing.
 */
export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const userOverrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'characters', roleOverrides, userOverrides)) {
		throw error(403, 'Your role does not have access to Invisible Characters.');
	}
	if (!roleHasTool(locals.user.role, 'gameConfig', roleOverrides, userOverrides)) {
		throw error(
			403,
			'Invisible Characters edits the game config, which needs access to Invisible Game Config.',
		);
	}

	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});

	const gameType = await projectGameType(projectKey);
	const base = { clientKey, projectKey, gameType, tools };
	if (projectFamily(projectKey, gameType) !== 'arcade') {
		return {
			...base,
			projectName: projectKey,
			doc: null,
			source: 'template' as const,
			etag: null,
			templateDefault: null,
			components: [],
			projection: undefined,
			issues: [],
		};
	}
	// The screens' projection is what a sheet's view is checked against (`/config`'s load reads it
	// the same way). A layout that cannot be read means the view is not checked against a screen,
	// as in the save.
	const [{ doc, source, etag }, name, components, projection] = await Promise.all([
		resolveGameConfig(clientKey, projectKey, gameType),
		projectName(projectKey),
		listComponents({ projectKey }),
		loadDocWithEtag(clientKey, projectKey).then(
			(layout) =>
				layout.corrupt
					? undefined
					: sheetProjection(layout.doc.scenes.flatMap((s) => (s.projection ? [s.projection] : []))),
			() => undefined,
		),
	]);

	return {
		...base,
		projectName: name,
		doc,
		source,
		etag,
		templateDefault: gameConfigDefaultFor(gameType),
		// The looks a character can take, slimmed to what the page needs.
		components: components.map(listedLook),
		projection,
		// What the save says of the config (`pageIssues`), as the page lists it.
		issues: doc ? pageIssues(doc, projection).issues : [],
	};
};
