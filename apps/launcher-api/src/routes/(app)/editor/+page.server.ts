import { error, fail, redirect } from '@sveltejs/kit';
import { findUnfilledRequiredSlots, getTemplate, type LayoutDoc } from 'engine-layout';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE, getActiveScope } from '$lib/server/auth';
import { loadDoc, saveDoc } from '$lib/server/editorStorage';
import { listProjectAssets } from '$lib/server/projectAssets';
import { projectGameType } from '$lib/server/projects';
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
	// Template + initial slot warnings, so the UI shows slot state on first load
	// (§7.1) — not only after a save round-trip.
	const template = getTemplate(await projectGameType(projectKey));
	const warnings = template ? findUnfilledRequiredSlots(doc, template) : [];
	return { clientKey, projectKey, doc, assets, template, warnings };
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
		// Non-blocking template validation (§7.1): flag any required slot the
		// saved doc leaves unfilled, surfaced to the editor without rejecting.
		const template = getTemplate(await projectGameType(projectKey));
		const warnings = template ? findUnfilledRequiredSlots(saved, template) : [];
		return { action: 'save' as const, saved: true, updatedAt: saved.updatedAt, warnings };
	},
};
