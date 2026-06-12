import { json } from '@sveltejs/kit';
import { resolveEditorFonts } from '$lib/server/fonts';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Serve the active project's font catalog (`fonts.json`) as the list of fonts the
 * Font Maker's View mode renders — each file routed through the self-contained,
 * `fontMaker`-gated `/api/fonts/asset` streamer (so the tool does NOT depend on the
 * editor grant). Defensive: a project without a synced catalog (or any resolve
 * failure) returns `{ fonts: [] }`, never a 500.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'fontMaker',
		forbiddenMessage: 'Your role does not have access to the Invisible Font Maker.',
		includeSharedFonts: true,
	});

	let fonts;
	try {
		fonts = await resolveEditorFonts(
			clientKey,
			projectKey,
			(key) => '/api/fonts/asset?key=' + encodeURIComponent(key),
		);
	} catch (e) {
		console.error('[fonts/catalog] resolve failed', e);
		return json({ fonts: [], error: e instanceof Error ? e.message : String(e) });
	}

	return json({ fonts: fonts ?? [] });
};
