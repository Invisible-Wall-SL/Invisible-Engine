import { error } from '@sveltejs/kit';
import { getObjectBytes } from '$lib/server/r2';
import { SUB } from '$lib/server/projectPaths';

/**
 * Shared serving for the read-only `deploy/` asset tree. Two routes use it:
 * `/api/deploy?project=&k=&rel=` (query form — build CI / pull scripts) and
 * `/api/deploy/f/<token>/<client>/<project>/<...rel>` (PATH form — the generic
 * runtime). The path form exists because a Spine atlas page, a multi-page
 * spritesheet, and a bitmap-font page are all named INSIDE a parent file and
 * loaded by the runtime RELATIVE to that parent's URL. A query-string base
 * (`?…&rel=…`) breaks that relative resolution (the page resolves against the
 * `/api/deploy` path, dropping the `rel`/token), so the runtime needs a clean
 * path prefix where the token + project survive as leading path segments.
 */
export const DEPLOY_CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const EXT_CONTENT_TYPES: Record<string, string> = {
	json: 'application/json',
	png: 'image/png',
	webp: 'image/webp',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	atlas: 'text/plain',
	fnt: 'application/xml',
	xml: 'application/xml',
	woff2: 'font/woff2',
	woff: 'font/woff',
	ttf: 'font/ttf',
	otf: 'font/otf',
	mp3: 'audio/mpeg',
	ogg: 'audio/ogg',
	wav: 'audio/wav',
};

export function deployContentType(rel: string): string {
	const dot = rel.lastIndexOf('.');
	if (dot === -1) return 'application/octet-stream';
	const ext = rel.slice(dot + 1).toLowerCase();
	return EXT_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** Reject path-traversal / absolute refs before resolving against the deploy prefix. */
export function assertSafeRel(rel: string): void {
	if (rel.includes('..') || rel.includes('\\') || rel.startsWith('/')) {
		throw error(400, 'invalid rel');
	}
}

/** Stream one object's bytes from `<client>/<project>/deploy/<rel>`; 404 when absent. */
export async function serveDeployFile(
	client: string,
	proj: string,
	rel: string,
): Promise<Response> {
	assertSafeRel(rel);
	const key = `${SUB.deploy(client, proj)}/${rel}`;
	const obj = await getObjectBytes(key);
	if (!obj) throw error(404, 'not found');
	return new Response(obj.body, {
		headers: {
			...DEPLOY_CORS_HEADERS,
			'content-type': deployContentType(rel),
			'cache-control': 'public, max-age=60',
		},
	});
}
