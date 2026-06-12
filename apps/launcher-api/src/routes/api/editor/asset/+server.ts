import { error } from '@sveltejs/kit';
import { streamAsset } from '$lib/server/assetStream';
import { assertAllowed, gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Auth-gated streamer for arbitrary R2 keys inside the active project's editor
 * tree (incl. the cross-project `_shared/spines/` + `_shared/fonts/` bundles). The
 * key must start with one of the scope's allowed prefixes — which mirrors what
 * `listProjectAssets()` walks — so a user can never read outside the project
 * (the active project is bound to the session, never a request param).
 *
 * The byte-streaming + BMFont `?font=1` descriptor page-rewrite live in
 * `$lib/server/assetStream`, shared with the Font Maker's `/api/fonts/asset`. The
 * page refs are rewritten back through THIS endpoint (`/api/editor/asset?key=`).
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { prefixes } = await gate(locals, cookies, {
		tool: 'editor',
		forbiddenMessage: 'Your role does not have access to the Invisible Editor.',
		includeSharedSpines: true,
		includeSharedFonts: true,
	});

	const key = url.searchParams.get('key');
	if (!key) throw error(400, 'missing key');
	assertAllowed(key, prefixes);

	return streamAsset({
		key,
		rewriteFont: url.searchParams.get('font') === '1',
		assetUrlBase: '/api/editor/asset?key=',
	});
};
