import { error, json } from '@sveltejs/kit';
import { resolveEditorSpineMeta } from '$lib/server/spine';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Animation / skin / slot NAME lists for a spine node's `assetKey`, parsed from the
 * skeleton manifest in R2. This is the author-facing dropdown source for the editor's
 * spine panels: unlike the canvas's live-render meta (only published once a bundle
 * renders "ready" on the WebGL layer), this reads straight from the skeleton, so a
 * placeholder/marker-only preview still gets real dropdowns. Defensive by design — an
 * unknown bundle (or unparseable skeleton) returns `{ found: false }`, never a 500.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		forbiddenMessage: 'Your role does not have access to the Invisible Editor.',
		includeSharedSpines: true,
	});

	const key = url.searchParams.get('key');
	if (!key) throw error(400, 'missing key');

	try {
		const meta = await resolveEditorSpineMeta(clientKey, projectKey, key);
		if (!meta) return json({ found: false });
		return json({ found: true, ...meta });
	} catch (e) {
		console.error('[editor/spine/meta] resolve failed', key, e);
		return json({ found: false, error: e instanceof Error ? e.message : String(e) });
	}
};
