import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { loadDoc } from '$lib/server/localization';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import type { RequestHandler } from './$types';

/**
 * Read-only export of a project's Localization-tool strings in the per-locale
 * message-map shape a game's Lingui catalog merges directly:
 *
 *   { sourceLang, messages: { en: { KEY: text }, es: { KEY: texto }, … } }
 *
 * The source language always exports every keyed entry; target languages export
 * only REVIEWED translations (the tool's `reviewed` flag gates delivery — see
 * `$lib/server/localization.ts`), so machine output never ships unvetted.
 * Same posture as `/api/editor/doc`: token-gated (`?k=` vs `EDITOR_DOC_SECRET`)
 * so the build-time bake can fetch it with no launcher session. Called by
 * `bake-editor-doc.mjs`, which embeds the result in the game's baked bundle.
 */
export const GET: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Localization export is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const doc = await loadDoc(clientKey, projectKey);
		const messages: Record<string, Record<string, string>> = {};
		const sourceMap: Record<string, string> = {};
		for (const entry of doc.entries) {
			if (!entry.key) continue;
			if (entry.source) sourceMap[entry.key] = entry.source;
			for (const [lang, t] of Object.entries(entry.translations)) {
				if (!t.reviewed || !t.text) continue;
				(messages[lang] ??= {})[entry.key] = t.text;
			}
		}
		if (Object.keys(sourceMap).length > 0) {
			messages[doc.sourceLang] = { ...messages[doc.sourceLang], ...sourceMap };
		}
		return json({ clientKey, projectKey, sourceLang: doc.sourceLang, messages });
	} catch {
		throw error(502, 'Failed to load the localization document.');
	}
};
