import { error, redirect } from '@sveltejs/kit';
import { validateGameConfigDoc } from 'game-config';
import { componentInputs } from 'engine-layout';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { listComponents } from '$lib/server/componentStorage';
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
			issues: [],
		};
	}
	const [{ doc, source, etag }, name, components] = await Promise.all([
		resolveGameConfig(clientKey, projectKey, gameType),
		projectName(projectKey),
		listComponents({ projectKey }),
	]);

	return {
		...base,
		projectName: name,
		doc,
		source,
		etag,
		templateDefault: gameConfigDefaultFor(gameType),
		// The looks a character can take, slimmed to what the page needs: the inputs its state
		// machine reads (bool and number — a trigger has no value to follow).
		components: components.map((c) => ({
			id: c.id,
			name: c.name,
			inputs: componentInputs(c)
				.filter((i) => i.kind === 'bool' || i.kind === 'number')
				.map((i) => ({ id: i.id, kind: i.kind as 'bool' | 'number' })),
		})),
		issues: doc ? validateGameConfigDoc(doc) : [],
	};
};
