import { error, redirect } from '@sveltejs/kit';
import { validateGameConfigDoc } from 'game-config';
import { componentInputs } from 'engine-layout';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { listComponents } from '$lib/server/componentStorage';
import { gameConfigDefaultFor, resolveGameConfig } from '$lib/server/gameConfigDefaults';
import { projectGameType, projectName } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { resolveToolScope } from '$lib/server/toolScope';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { PageServerLoad } from './$types';

/**
 * Invisible Characters (`/characters`, `docs/design/game-families.md` §4.3, §5.1): an arcade
 * project's characters — `GameConfigDoc.arcade.characters` (§9 #14). The characters live IN the
 * game config, so this page opens the same resolved doc `/config` does and saves it through the
 * same `PUT /api/game-config` under the same lease (`gameConfig`): saving needs the Game Config
 * grant too, which every role holding this tool has by default.
 *
 * A non-arcade project never reaches this load: the `(app)` layout shows its hidden-tool notice
 * (`FAMILY_TOOLS`).
 */
export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const userOverrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'characters', roleOverrides, userOverrides)) {
		throw error(403, 'Your role does not have access to Invisible Characters.');
	}
	const canSave = roleHasTool(locals.user.role, 'gameConfig', roleOverrides, userOverrides);

	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});

	const gameType = await projectGameType(projectKey);
	const [{ doc, source, etag }, name, components] = await Promise.all([
		resolveGameConfig(clientKey, projectKey, gameType),
		projectName(projectKey),
		listComponents({ projectKey }),
	]);

	return {
		clientKey,
		projectKey,
		projectName: name,
		gameType,
		tools,
		canSave,
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
