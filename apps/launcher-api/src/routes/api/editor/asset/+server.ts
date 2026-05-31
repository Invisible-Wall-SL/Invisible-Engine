import { error } from '@sveltejs/kit';
import { assertAllowed, gate } from '$lib/server/toolScope';
import { getObjectBytes } from '$lib/server/r2';
import type { RequestHandler } from './$types';

const EXT_CONTENT_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	svg: 'image/svg+xml',
	json: 'application/json',
	atlas: 'text/plain; charset=utf-8',
	skel: 'application/octet-stream',
};

function contentTypeFor(key: string, fallback: string): string {
	const dot = key.lastIndexOf('.');
	if (dot === -1) return fallback;
	const ext = key.slice(dot + 1).toLowerCase();
	return EXT_CONTENT_TYPES[ext] ?? fallback;
}

/**
 * Auth-gated streamer for arbitrary R2 keys inside the active project's editor
 * namespaces (incl. the cross-project `spines/_shared/` bundles). The key must
 * start with one of the scope's allowed prefixes — which mirrors what
 * `listProjectAssets()` walks — so a user can never read outside the project
 * (the active project is bound to the session, never a request param).
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { prefixes } = await gate(locals, cookies, {
		tool: 'editor',
		forbiddenMessage: 'Your role does not have access to the Invisible Editor.',
		includeSharedSpines: true,
	});

	const key = url.searchParams.get('key');
	if (!key) throw error(400, 'missing key');
	assertAllowed(key, prefixes);

	const obj = await getObjectBytes(key);
	if (!obj) throw error(404, 'not found');

	return new Response(obj.body, {
		headers: {
			'content-type': contentTypeFor(key, obj.contentType),
			'cache-control': 'no-store',
		},
	});
};
