import { json } from '@sveltejs/kit';
import { resolveEditorFonts } from '$lib/server/fonts';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Serve the active project's font catalog (`fonts.json`) as the list of fonts the
 * editor can render — each file already routed through the editor-gated
 * `/api/editor/asset` streamer. The font analogue of `/api/editor/spine`.
 * Defensive: a project without a synced catalog returns `{ fonts: [] }`, never a
 * 500, so the editor degrades to the system-font fallback.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		forbiddenMessage: 'Your role does not have access to the Invisible Editor.',
		includeSharedFonts: true,
	});

	let fonts;
	try {
		fonts = await resolveEditorFonts(clientKey, projectKey);
	} catch (e) {
		console.error('[editor/fonts] resolve failed', e);
		return json({ fonts: [], error: e instanceof Error ? e.message : String(e) });
	}

	return json({ fonts: fonts ?? [] });
};
