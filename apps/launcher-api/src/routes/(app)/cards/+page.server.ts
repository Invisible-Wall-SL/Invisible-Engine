import { error, redirect } from '@sveltejs/kit';
import { validateGameConfigDoc } from 'game-config';
import type { ComponentDef } from 'engine-layout';
import { frameCandidates } from '$lib/cards/cardEdit';
import { pickSheetsFrom } from '$lib/pickSheets';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { listComponents } from '$lib/server/componentStorage';
import { gameConfigDefaultFor, resolveGameConfig } from '$lib/server/gameConfigDefaults';
import { listProjectAssets } from '$lib/server/projectAssets';
import { projectFamily, projectGameType, projectName } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { resolveToolScope } from '$lib/server/toolScope';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { PageServerLoad } from './$types';

/**
 * Invisible Card Library (`/cards`, `docs/design/card-games.md` §8): a card project's cards and
 * decks — `GameConfigDoc.card` (§7, decision §13 #1). The cards live IN the game config, so this
 * page opens the same resolved doc `/config` does and saves it through the same
 * `PUT /api/game-config` under the same lease (`gameConfig`). The doc is the whole config, so the
 * load demands the Game Config grant as well as this tool's — the gate `GET /api/game-config`
 * applies — and refuses without it, as `/characters` does.
 *
 * For a project whose family does not use this tool the load still runs (the `(app)` layout only
 * swaps what renders for its hidden-tool notice), so it returns no config and reads nothing.
 */
export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const userOverrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'cards', roleOverrides, userOverrides)) {
		throw error(403, 'Your role does not have access to Invisible Card Library.');
	}
	if (!roleHasTool(locals.user.role, 'gameConfig', roleOverrides, userOverrides)) {
		throw error(
			403,
			'Invisible Card Library edits the game config, which needs access to Invisible Game Config.',
		);
	}

	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});

	const gameType = await projectGameType(projectKey);
	const base = { clientKey, projectKey, gameType, tools };
	if (projectFamily(projectKey, gameType) !== 'card') {
		return {
			...base,
			projectName: projectKey,
			doc: null,
			source: 'template' as const,
			etag: null,
			templateDefault: null,
			frames: [] as ComponentDef[],
			pickSheets: [],
			issues: [],
		};
	}
	const [{ doc, source, etag }, name, components, assets] = await Promise.all([
		resolveGameConfig(clientKey, projectKey, gameType),
		projectName(projectKey),
		listComponents({ projectKey }),
		listProjectAssets(clientKey, projectKey),
	]);

	return {
		...base,
		projectName: name,
		doc,
		source,
		etag,
		templateDefault: gameConfigDefaultFor(gameType),
		// The components a card can be drawn in, and what they nest: whole trees, because the page
		// draws every card in its frame. Only these, never the project's whole palette.
		frames: frameCandidates(components, doc),
		// The art picker's atlases: the same list the editor, `/symbols` and `/config` build, so the
		// writers of scoped frame refs cannot drift.
		pickSheets: pickSheetsFrom(assets),
		issues: doc ? validateGameConfigDoc(doc) : [],
	};
};
