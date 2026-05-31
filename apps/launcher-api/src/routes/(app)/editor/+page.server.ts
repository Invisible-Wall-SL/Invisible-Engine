import { error, fail, redirect } from '@sveltejs/kit';
import type { LayoutDoc } from 'engine-layout';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE, getActiveScope } from '$lib/server/auth';
import { loadDoc, saveDoc } from '$lib/server/editorStorage';
import { listProjectAssets } from '$lib/server/projectAssets';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { Actions, PageServerLoad } from './$types';

/**
 * Auth + role gate for actions, where `await parent()` is unavailable so the
 * effective tool manifest must be recomputed. The loader instead reuses the
 * parent layout's already-resolved `tools` (see `load`). Returns `(client, project)`.
 */
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
	return getActiveScope(cookies.get(SESSION_COOKIE));
}

export const load: PageServerLoad = async ({ locals, cookies, parent }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'editor')) {
		throw error(403, 'Your role does not have access to Invisible Editor.');
	}
	const { clientKey, projectKey } = await getActiveScope(cookies.get(SESSION_COOKIE));
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
