import { error } from '@sveltejs/kit';
import { getObjectBytes } from './r2';

/**
 * Shared byte-streamer for the gated R2 asset endpoints (the editor's
 * `/api/editor/asset` + the Font Maker's `/api/fonts/asset`). Extracted so the two
 * endpoints share ONE implementation of the content-type map, the BMFont
 * `?font=1` descriptor page-rewrite, and the response/headers — with no copy-paste
 * drift. Each endpoint owns its own gate (tool grant + prefix allow-list) and
 * passes its own `assetUrl` base so rewritten page refs route back through ITSELF.
 */

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
	xml: 'application/xml',
	fnt: 'text/plain; charset=utf-8',
	woff2: 'font/woff2',
	woff: 'font/woff',
	ttf: 'font/ttf',
	otf: 'font/otf',
};

function contentTypeFor(key: string, fallback: string): string {
	const dot = key.lastIndexOf('.');
	if (dot === -1) return fallback;
	const ext = key.slice(dot + 1).toLowerCase();
	return EXT_CONTENT_TYPES[ext] ?? fallback;
}

/** BMFont descriptor extensions whose `<page file>` references must be rewritten. */
const BITMAP_DESCRIPTOR_EXT = new Set(['fnt', 'xml', 'json']);

function extOf(key: string): string {
	const dot = key.lastIndexOf('.');
	return dot === -1 ? '' : key.slice(dot + 1).toLowerCase();
}

/** R2 directory of a key (everything up to and including the final `/`). */
function dirOf(key: string): string {
	const slash = key.lastIndexOf('/');
	return slash === -1 ? '' : key.slice(0, slash + 1);
}

/**
 * Rewrite a BMFont descriptor's relative page-image references to absolute gated
 * URLs (resolved against the descriptor's R2 directory), so PIXI's `Assets.load`
 * fetches the page through the gate instead of resolving `file="font.png"` relative
 * to the descriptor's request URL (which would 404). Supports the three BMFont
 * descriptor formats: XML (`<page … file="…"/>`), text `.fnt` (`page … file="…"`),
 * and JSON (`pages: ["…", …]`). Only the page filename is touched — glyph/kerning
 * data is left byte-identical. `assetUrlBase` is the endpoint's own stream-URL
 * prefix (e.g. `/api/editor/asset?key=` or `/api/fonts/asset?key=`) so the rewritten
 * refs route back through the SAME gated endpoint.
 */
function rewriteDescriptorPages(
	text: string,
	ext: string,
	dir: string,
	assetUrlBase: string,
): string {
	const pageUrl = (file: string): string => `${assetUrlBase}${encodeURIComponent(dir + file)}`;
	if (ext === 'json') {
		try {
			const data = JSON.parse(text) as { pages?: unknown };
			if (Array.isArray(data.pages)) {
				data.pages = data.pages.map((p) => (typeof p === 'string' ? pageUrl(p) : p));
				return JSON.stringify(data);
			}
		} catch {
			/* not a JSON BMFont descriptor — leave untouched */
		}
		return text;
	}
	// XML + text `.fnt` both express the page image as a `file="…"` attribute.
	return text.replace(/(\bfile\s*=\s*")([^"]+)(")/g, (_m, pre, file, post) => {
		// Skip already-absolute references (an earlier rewrite, or an authored URL).
		if (/^(?:https?:)?\/\//.test(file) || file.startsWith('/')) return `${pre}${file}${post}`;
		return `${pre}${pageUrl(file)}${post}`;
	});
}

export interface StreamAssetOptions {
	/** The already-gated + allow-list-checked R2 key to stream. */
	key: string;
	/** When `true`, rewrite a BMFont descriptor's relative `<page file>` refs. */
	rewriteFont: boolean;
	/** Stream-URL prefix the endpoint exposes, e.g. `/api/fonts/asset?key=`. */
	assetUrlBase: string;
	/**
	 * The incoming `If-None-Match` header (if any). When it matches the streamed
	 * object's ETag, the verbatim branch returns a bodyless `304 Not Modified`.
	 * Pass `request.headers.get('if-none-match')` from the endpoint.
	 */
	ifNoneMatch?: string | null;
}

/**
 * These responses are auth-gated and per-user (the gate + project-prefix
 * allow-list run on EVERY request, including conditional ones), so the cache is
 * `private` — never shared across users by a proxy. A short `max-age` with
 * `must-revalidate` means the browser may reuse a cached image for a few minutes
 * without a request, then revalidate via `If-None-Match`. A 304 is safe because
 * the endpoint has already re-run its gate before we get here — caching never
 * bypasses auth, it only saves re-streaming bytes the client already holds.
 */
const VERBATIM_CACHE_CONTROL = 'private, max-age=300, must-revalidate';

export async function streamAsset(opts: StreamAssetOptions): Promise<Response> {
	const { key, rewriteFont, assetUrlBase, ifNoneMatch } = opts;
	const obj = await getObjectBytes(key);
	if (!obj) throw error(404, 'not found');

	const ext = extOf(key);
	if (rewriteFont && BITMAP_DESCRIPTOR_EXT.has(ext)) {
		// The rewritten descriptor is request-base-dependent (page refs are
		// absolutised against `assetUrlBase`), so it is NOT byte-stable per R2
		// ETag — leave it uncacheable rather than serve a stale/mismatched rewrite.
		const rewritten = rewriteDescriptorPages(
			new TextDecoder().decode(obj.body),
			ext,
			dirOf(key),
			assetUrlBase,
		);
		return new Response(rewritten, {
			headers: {
				'content-type': contentTypeFor(key, obj.contentType),
				'cache-control': 'no-store',
			},
		});
	}

	// Verbatim image/binary branch: cacheable + conditionally revalidated. R2's
	// ETag identifies the exact bytes, so a matching `If-None-Match` means the
	// client already holds this object — answer `304` (no body) after the gate.
	const headers: Record<string, string> = {
		'content-type': contentTypeFor(key, obj.contentType),
		'cache-control': VERBATIM_CACHE_CONTROL,
	};
	if (obj.etag) {
		headers['etag'] = obj.etag;
		if (ifNoneMatch && etagMatches(ifNoneMatch, obj.etag)) {
			return new Response(null, { status: 304, headers });
		}
	}

	return new Response(obj.body, { headers });
}

/**
 * Does the client's `If-None-Match` value match our ETag? Handles the comma-
 * separated list form and the `W/` weak prefix on either side (R2's GET ETag is
 * strong, but a previous revalidation may echo it weakly).
 */
function etagMatches(ifNoneMatch: string, etag: string): boolean {
	const norm = (t: string): string => t.trim().replace(/^W\//, '');
	const ours = norm(etag);
	if (ifNoneMatch.trim() === '*') return true;
	return ifNoneMatch.split(',').some((candidate) => norm(candidate) === ours);
}
