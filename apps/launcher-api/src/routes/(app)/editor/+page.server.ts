import { error, fail, redirect } from '@sveltejs/kit';
import type { LayoutDoc } from 'engine-layout';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE, getActiveProjectKey } from '$lib/server/auth';
import { loadDoc, saveDoc } from '$lib/server/editorStorage';
import { listProjectAssets } from '$lib/server/projectAssets';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { Actions, PageServerLoad } from './$types';

/** Auth + role gate shared by the loader and every action. Returns `(client, project)`. */
async function gate(
	locals: App.Locals,
	cookies: import('@sveltejs/kit').Cookies,
): Promise<{ clientKey: string; projectKey: string }> {
	if (!locals.user) throw redirect(303, '/login');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'editor', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Editor.');
	}
	const projectKey =
		(await getActiveProjectKey(cookies.get(SESSION_COOKIE))) ?? DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	return { clientKey, projectKey };
}

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies);
	const [doc, assets] = await Promise.all([
		loadDoc(clientKey, projectKey),
		listProjectAssets(clientKey, projectKey),
	]);
	return { clientKey, projectKey, doc, assets };
};

export const actions: Actions = {
	save: async ({ request, locals, cookies }) => {
		const { clientKey, projectKey } = await gate(locals, cookies);
		const raw = (await request.formData()).get('doc');
		if (typeof raw !== 'string') {
			return fail(400, { action: 'save' as const, error: 'Missing doc payload.' });
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return fail(400, { action: 'save' as const, error: 'Invalid doc.' });
		}
		// `saveDoc` normalizes + stamps `updatedAt`, so the wire payload is the
		// only validation barrier we need.
		const saved = await saveDoc(clientKey, projectKey, parsed as LayoutDoc);
		return { action: 'save' as const, saved: true, updatedAt: saved.updatedAt };
	},
};
