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
 * EVERY translation is exposed, reviewed or not — deliberately UNLIKE `/api/localization/strings`
 * (the game's own export), which still ships reviewed-only.
 *
 * That gate used to apply here too, and its reasoning was sound at the time: rig text is
 * rasterised to ART, and art baked into a page cannot be corrected at runtime. But the premise
 * died when the re-bake became automatic (`autoSyncRigText` in `static/rigger/view.html`):
 * opening the rig now re-reads this endpoint and re-rasterises anything that drifted, so a bad
 * translation IS correctable — fix the string in `/localization`, and the next open reships the
 * art. Holding the gate bought nothing after that and cost the author a manual approval step per
 * language, which is exactly the human input the automation exists to remove.
 *
 * `unreviewed` is still reported so the panel can say how much of what it baked is machine
 * output nobody has vetted. It is a LABEL now, not a gate.
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
			const translations: Record<string, string> = {};
			let unreviewed = 0;
			for (const [lang, t] of Object.entries(e.translations)) {
				if (!t.text) continue;
				translations[lang] = t.text;
				if (!t.reviewed) unreviewed++;
			}
			return { key: e.key, source: e.source, translations, unreviewed };
		});

	return json({ sourceLang: doc.sourceLang, targetLangs: doc.targetLangs, entries });
};
