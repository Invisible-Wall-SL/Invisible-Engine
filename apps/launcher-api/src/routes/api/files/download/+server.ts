import { error } from '@sveltejs/kit';
import { assertAllowed, gate } from '$lib/server/ftpScope';
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
	txt: 'text/plain; charset=utf-8',
	atlas: 'text/plain; charset=utf-8',
	csv: 'text/csv; charset=utf-8',
	skel: 'application/octet-stream',
};

function contentTypeFor(key: string, fallback: string): string {
	const dot = key.lastIndexOf('.');
	if (dot === -1) return fallback;
	const ext = key.slice(dot + 1).toLowerCase();
	return EXT_CONTENT_TYPES[ext] ?? fallback;
}

/** Quote-safe filename for `content-disposition` (strip the path, escape quotes). */
function attachmentName(key: string): string {
	const base = key.slice(key.lastIndexOf('/') + 1) || 'download';
	return base.replace(/["\\]/g, '_');
}

/** Auth-gated, project-scoped streamer that forces a download (attachment). */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies);

	const key = url.searchParams.get('key');
	if (!key) throw error(400, 'missing key');
	assertAllowed(key, clientKey, projectKey);

	const obj = await getObjectBytes(key);
	if (!obj) throw error(404, 'not found');

	return new Response(obj.body, {
		headers: {
			'content-type': contentTypeFor(key, obj.contentType),
			'content-disposition': `attachment; filename="${attachmentName(key)}"`,
			'cache-control': 'no-store',
		},
	});
};
