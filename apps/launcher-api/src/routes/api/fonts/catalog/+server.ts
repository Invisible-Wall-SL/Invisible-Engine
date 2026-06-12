import { json } from '@sveltejs/kit';
import { resolveEditorFonts, resolveFontCatalogRoot } from '$lib/server/fonts';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Serve the active project's font catalog (`fonts.json`) as the list of fonts the
 * Font Maker's View mode renders — each file routed through the self-contained,
 * `fontMaker`-gated `/api/fonts/asset` streamer (so the tool does NOT depend on the
 * editor grant). Also reports `source` (`project` | `shared`) so the client knows
 * which target a delete hits (the catalog resolves from the project first, then the
 * `_shared/fonts/` library fallback). Defensive: a project without a synced catalog
 * (or any resolve failure) returns `{ fonts: [] }`, never a 500.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'fontMaker',
		forbiddenMessage: 'Your role does not have access to the Invisible Font Maker.',
		includeSharedFonts: true,
	});

	let fonts;
	let source: 'project' | 'shared' = 'project';
	try {
		const root = await resolveFontCatalogRoot(clientKey, projectKey);
		source = root?.root === '_shared/fonts' ? 'shared' : 'project';
		fonts = await resolveEditorFonts(
			clientKey,
			projectKey,
			(key) => '/api/fonts/asset?key=' + encodeURIComponent(key),
		);
	} catch (e) {
		console.error('[fonts/catalog] resolve failed', e);
		return json({ fonts: [], source, error: e instanceof Error ? e.message : String(e) });
	}

	return json({ fonts: fonts ?? [], source });
};
