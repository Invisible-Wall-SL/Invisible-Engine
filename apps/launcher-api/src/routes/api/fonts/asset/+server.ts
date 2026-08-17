import { error } from '@sveltejs/kit';
import { streamAsset } from '$lib/server/assetStream';
import { assertAllowed, gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Self-contained, `fontMaker`-gated streamer for the Font Maker (so the tool does
 * NOT depend on the editor grant). Mirrors `/api/editor/asset` but gates on the
 * `fontMaker` tool and rewrites BMFont `?font=1` descriptor page refs back through
 * THIS endpoint (`/api/fonts/asset?key=`). Allows the project's tree + the shared
 * `_shared/fonts/` library. Never 500s on a missing object — 404.
 */
export const GET: RequestHandler = async ({ url, locals, cookies, request }) => {
	const { prefixes } = await gate(locals, cookies, {
		tool: 'fontMaker',
		// Also the Rigger's font byte source for rig text rasterisation (see `/api/fonts/catalog`).
		altTools: ['rigger'],
		forbiddenMessage: 'Your role does not have access to the Invisible Font Maker.',
		includeSharedFonts: true,
	});

	const key = url.searchParams.get('key');
	if (!key) throw error(400, 'missing key');
	assertAllowed(key, prefixes);

	return streamAsset({
		key,
		rewriteFont: url.searchParams.get('font') === '1',
		assetUrlBase: '/api/fonts/asset?key=',
		ifNoneMatch: request.headers.get('if-none-match'),
	});
};
