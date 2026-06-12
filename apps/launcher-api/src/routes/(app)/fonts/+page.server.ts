import { error, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, getActiveScope } from '$lib/server/auth';
import { projectName } from '$lib/server/projects';
import type { PageServerLoad } from './$types';

/**
 * The Font Maker is a client-only canvas/preview app — it renders fonts live with
 * PIXI (`BitmapText` / `Text`). Server-rendering it is pointless and fragile (same
 * rationale as the editor route): `load` still runs server-side and the data flows
 * to the client, only the component render is client-only.
 */
export const ssr = false;

export const load: PageServerLoad = async ({ locals, cookies, parent }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'fontMaker')) {
		throw error(403, 'Your role does not have access to the Invisible Font Maker.');
	}
	const { clientKey, projectKey } = await getActiveScope(cookies.get(SESSION_COOKIE));
	return { clientKey, projectKey, projectName: await projectName(projectKey) };
};
