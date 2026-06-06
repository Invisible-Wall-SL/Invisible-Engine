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

/** Stream URL for a sibling page file, gated by the same `/api/editor/asset` endpoint. */
function pageUrl(dir: string, file: string): string {
	return `/api/editor/asset?key=${encodeURIComponent(dir + file)}`;
}

/**
 * Rewrite a BMFont descriptor's relative page-image references to absolute
 * `/api/editor/asset?key=…` URLs (resolved against the descriptor's R2 directory),
 * so PIXI's `Assets.load` fetches the page through the editor gate instead of
 * resolving `file="font.png"` relative to the descriptor's request URL (which
 * would 404 against `/api/editor/font.png`). Supports the three BMFont descriptor
 * formats: XML (`<page … file="…"/>`), text `.fnt` (`page … file="…"`), and JSON
 * (`pages: ["…", …]`). Only the page filename is touched — glyph/kerning data is
 * left byte-identical.
 */
function rewriteDescriptorPages(text: string, ext: string, dir: string): string {
	if (ext === 'json') {
		try {
			const data = JSON.parse(text) as { pages?: unknown };
			if (Array.isArray(data.pages)) {
				data.pages = data.pages.map((p) => (typeof p === 'string' ? pageUrl(dir, p) : p));
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
		return `${pre}${pageUrl(dir, file)}${post}`;
	});
}

/**
 * Auth-gated streamer for arbitrary R2 keys inside the active project's editor
 * tree (incl. the cross-project `_shared/spines/` bundles). The key must
 * start with one of the scope's allowed prefixes — which mirrors what
 * `listProjectAssets()` walks — so a user can never read outside the project
 * (the active project is bound to the session, never a request param).
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

	const obj = await getObjectBytes(key);
	if (!obj) throw error(404, 'not found');

	// Bitmap-font descriptor (`?font=1`): rewrite its relative `<page file>`
	// references to absolute editor-gated URLs so PIXI's loader fetches the page
	// images correctly (it otherwise resolves them against this request URL). Only
	// when the caller opts in, so generic atlas/spine `.json`/`.xml` keys stream
	// byte-for-byte.
	const ext = extOf(key);
	if (url.searchParams.get('font') === '1' && BITMAP_DESCRIPTOR_EXT.has(ext)) {
		const rewritten = rewriteDescriptorPages(new TextDecoder().decode(obj.body), ext, dirOf(key));
		return new Response(rewritten, {
			headers: {
				'content-type': contentTypeFor(key, obj.contentType),
				'cache-control': 'no-store',
			},
		});
	}

	return new Response(obj.body, {
		headers: {
			'content-type': contentTypeFor(key, obj.contentType),
			'cache-control': 'no-store',
		},
	});
};
