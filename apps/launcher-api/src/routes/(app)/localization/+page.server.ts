import { error, fail, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE, getActiveProjectKey } from '$lib/server/auth';
import { loadDoc, normalizeDoc, saveDoc } from '$lib/server/localization';
import type { LocalizationDoc } from '$lib/server/localization';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { TranslateError, translateBatch } from '$lib/server/translate';
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
	if (!roleHasTool(locals.user.role, 'localization', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Localization.');
	}
	const projectKey =
		(await getActiveProjectKey(cookies.get(SESSION_COOKIE))) ?? DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	return { clientKey, projectKey };
}

/** Parse the `doc` form field (JSON) into a normalized document. */
function parseDocField(raw: FormDataEntryValue | null): LocalizationDoc {
	if (typeof raw !== 'string') throw new TranslateError('Missing document payload.');
	return normalizeDoc(JSON.parse(raw));
}

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies);
	return { projectKey, doc: await loadDoc(clientKey, projectKey) };
};

export const actions: Actions = {
	save: async ({ request, locals, cookies }) => {
		const { clientKey, projectKey } = await gate(locals, cookies);
		let doc: LocalizationDoc;
		try {
			doc = parseDocField((await request.formData()).get('doc'));
		} catch {
			return fail(400, { error: 'Invalid document.' });
		}
		const saved = await saveDoc(clientKey, projectKey, doc);
		return { saved: true, updatedAt: saved.updatedAt };
	},

	translate: async ({ request, locals, cookies }) => {
		await gate(locals, cookies);
		let doc: LocalizationDoc;
		let ids: string[];
		try {
			const data = await request.formData();
			doc = parseDocField(data.get('doc'));
			const rawIds = data.get('ids');
			ids =
				typeof rawIds === 'string' && rawIds
					? (JSON.parse(rawIds) as string[]).filter((i): i is string => typeof i === 'string')
					: doc.entries.map((e) => e.id);
		} catch {
			return fail(400, { error: 'Invalid request.' });
		}

		const wanted = new Set(ids);
		const items = doc.entries
			.filter((e) => wanted.has(e.id) && e.source.trim())
			.map((e) => ({ id: e.id, source: e.source }));

		if (items.length === 0) return fail(400, { error: 'No source text to translate.' });
		if (doc.targetLangs.length === 0) return fail(400, { error: 'No target languages set.' });

		try {
			const result = await translateBatch({
				sourceLang: doc.sourceLang,
				targetLangs: doc.targetLangs,
				context: doc.context,
				items,
			});
			// Return raw translations marked unreviewed; the client merges + the
			// human saves. We never auto-persist machine output.
			return { translations: result };
		} catch (e) {
			if (e instanceof TranslateError) return fail(400, { error: e.message });
			return fail(502, { error: 'Translation failed. Please try again.' });
		}
	},
};
