import { error, json } from '@sveltejs/kit';
import { resolveEditorSpine } from '$lib/server/spine';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Resolve a spine node's `assetKey` (an R2 bundle prefix) into the data the editor
 * canvas needs to render the real skeleton: runtime line, PNG-preferred atlas text,
 * and the editor-gated stream URLs for the skeleton + page images. Defensive by
 * design — a project without a synced `skeletons.json` (or an unknown bundle)
 * returns `{ found: false }`, never a 500, so the canvas keeps its placeholder.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		forbiddenMessage: 'Your role does not have access to the Invisible Editor.',
		includeSharedSpines: true,
	});

	const key = url.searchParams.get('key');
	if (!key) throw error(400, 'missing key');
	const preferPng = url.searchParams.get('pp') !== '0';

	const descriptor = await resolveEditorSpine(clientKey, projectKey, key, preferPng);
	if (!descriptor) return json({ found: false });

	return json({
		found: true,
		folder: descriptor.folder,
		format: descriptor.format,
		runtime: descriptor.runtime,
		pma: descriptor.pma,
		atlasText: descriptor.atlasText,
		skeletonUrl: `/api/editor/asset?key=${encodeURIComponent(descriptor.skeletonKey)}`,
		pageNames: descriptor.pageNames,
		pageUrls: descriptor.pageKeys.map((k) => `/api/editor/asset?key=${encodeURIComponent(k)}`),
	});
};
