import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { MODELS_TOOL } from '$lib/server/modelAccess';
import { MAX_MODEL_BYTES } from '$lib/server/modelStorage';
import { listModels, loadModelProjectContext } from '$lib/server/modelViewer';
import { projectFamily, projectGameType } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { resolveToolScope } from '$lib/server/toolScope';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { PageServerLoad } from './$types';

/**
 * Invisible Model Viewer (`/models`, `docs/design/3d-games.md` §6 Phase 4): a 3D game's models —
 * each one's master GLB, its `model.json` and what every quality tier ships.
 *
 * The loader gates on the tool, then lists the project's models and what they are shown against
 * (the published tiers, which models the game names, the Game Config's per-class settings). One
 * model's detail and derive are fetched when it is opened (`/api/models/detail`).
 *
 * For a project whose family does not use this tool the load still runs (the `(app)` layout only
 * swaps what renders for its hidden-tool notice), so it reads nothing and returns no models.
 */
export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const userOverrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, MODELS_TOOL, roleOverrides, userOverrides)) {
		throw error(403, 'Your role does not have access to Invisible Model Viewer.');
	}

	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});
	const base = {
		clientKey,
		projectKey,
		tools,
		maxModelBytes: MAX_MODEL_BYTES,
	};
	if (projectFamily(projectKey, await projectGameType(projectKey)) !== 'arcade') {
		return { ...base, models: [], context: null };
	}
	const [models, context] = await Promise.all([
		listModels(clientKey, projectKey),
		loadModelProjectContext(clientKey, projectKey),
	]);
	return { ...base, models, context };
};
