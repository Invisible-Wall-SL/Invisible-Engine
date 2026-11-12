import { error, json } from '@sveltejs/kit';
import { requireDeployToken } from '$lib/server/deployToken';
import { loadDoc } from '$lib/server/localization';
import { clientKeyOf, projectParam } from '$lib/server/projectLookup';
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
	await requireDeployToken(url, 'Localization export is not configured.');

	const projectKey = projectParam(url);
	const clientKey = await clientKeyOf(projectKey);

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
