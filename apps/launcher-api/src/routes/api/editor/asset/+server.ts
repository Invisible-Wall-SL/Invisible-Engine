import { error } from '@sveltejs/kit';
import { streamAsset } from '$lib/server/assetStream';
import { assertProjectArt } from '$lib/server/projectArtScope';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Auth-gated streamer for arbitrary R2 keys inside the active project's editor
 * tree (incl. the cross-project `_shared/spines/` + `_shared/fonts/` bundles). The
 * key must start with one of the scope's allowed prefixes — which mirrors what
 * `listProjectAssets()` walks — or be art the project's doc / placed component defs
 * reference within its own client (`projectArtScope`: exactly what the export ships).
 * The active project is bound to the session, never a request param.
 *
 * The byte-streaming + BMFont `?font=1` descriptor page-rewrite live in
 * `$lib/server/assetStream`, shared with the Font Maker's `/api/fonts/asset`. The
 * page refs are rewritten back through THIS endpoint (`/api/editor/asset?key=`).
 */
export const GET: RequestHandler = async ({ url, locals, cookies, request }) => {
	const { prefixes, clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		altTools: ['fx', 'rigger', 'flipbook', 'gameConfig'],
		forbiddenMessage: 'Your role does not have access to the project assets.',
		includeSharedRigs: true,
		includeSharedFonts: true,
		// The shared art library — a sheet bound from `_shared/sheets/` streams its page through here.
		includeSharedSheets: true,
	});

	const key = url.searchParams.get('key');
	if (!key) throw error(400, 'missing key');
	// …or art the project references from another of the client's projects (`projectArtScope`).
	await assertProjectArt(key, prefixes, clientKey, projectKey);

	return streamAsset({
		key,
		rewriteFont: url.searchParams.get('font') === '1',
		assetUrlBase: '/api/editor/asset?key=',
		ifNoneMatch: request.headers.get('if-none-match'),
	});
};
