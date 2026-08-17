import { json } from '@sveltejs/kit';
import { loadDoc } from '$lib/server/localization';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * The project's localization KEYS, for the Rigger's rig-text authoring (design
 * `invisible-cinematic.md` §12.4a). A rig text element stores a key, never a literal — so
 * `/localization` stays the single source of the strings and re-baking a rig's art always
 * re-reads them from here.
 *
 * Target-language values are exposed ONLY when `reviewed`, matching `/api/localization/strings`
 * (the game's own export). Rig text is rasterised to ART: an unreviewed translation baked into
 * a page cannot be corrected at runtime, so it must not be bakeable in the first place. The
 * unreviewed ones are still COUNTED so the tool can say "3 more locales once reviewed" instead
 * of pretending they don't exist.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const doc = await loadDoc(clientKey, projectKey);
	const entries = doc.entries
		.filter((e) => e.key)
		.map((e) => {
			const reviewed: Record<string, string> = {};
			let pending = 0;
			for (const [lang, t] of Object.entries(e.translations)) {
				if (t.reviewed && t.text) reviewed[lang] = t.text;
				else if (t.text) pending++;
			}
			return { key: e.key, source: e.source, reviewed, pending };
		});

	return json({ sourceLang: doc.sourceLang, targetLangs: doc.targetLangs, entries });
};
