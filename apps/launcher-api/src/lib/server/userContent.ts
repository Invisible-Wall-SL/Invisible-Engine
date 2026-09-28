/**
 * Response headers for streaming project content out of R2 on the launcher's own origin.
 *
 * The stored `Content-Type` is never trusted — an upload records whatever the browser sent. The type
 * comes from the key's extension through this allow-list instead, and anything that can act as a
 * document when opened directly (HTML, SVG, XML, unknown) is sent as a download. `fetch()`, `<img>`,
 * `<audio>` and `FontFace` ignore `Content-Disposition`, so the tools that load these files are
 * unaffected; only a top-level navigation to the URL changes.
 */

/** Types a browser renders passively — safe to serve inline. */
const INLINE_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	avif: 'image/avif',
	ktx2: 'image/ktx2',
	json: 'application/json',
	txt: 'text/plain; charset=utf-8',
	csv: 'text/csv; charset=utf-8',
	atlas: 'text/plain; charset=utf-8',
	fnt: 'text/plain; charset=utf-8',
	skel: 'application/octet-stream',
	woff2: 'font/woff2',
	woff: 'font/woff',
	ttf: 'font/ttf',
	otf: 'font/otf',
	mp3: 'audio/mpeg',
	ogg: 'audio/ogg',
	wav: 'audio/wav',
	m4a: 'audio/mp4',
	webm: 'audio/webm',
	mp4: 'video/mp4',
};

/** Types that keep their real type (an `<img>` of an SVG needs it) but always download. */
const ATTACHMENT_TYPES: Record<string, string> = {
	svg: 'image/svg+xml',
	xml: 'application/xml',
};

/** Applied to every streamed object: if one is ever opened as a document, it can do nothing. */
const LOCKED_DOWN_CSP =
	"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox";

export function extOf(key: string): string {
	const name = key.slice(key.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * `attachment` value for a key's filename: an ASCII fallback (a header value must be Latin-1, so a
 * raw non-ASCII name would throw) plus the RFC 5987 UTF-8 form browsers prefer.
 */
function attachmentDisposition(key: string): string {
	const base = key.slice(key.lastIndexOf('/') + 1) || 'download';
	const ascii = base.replace(/[^\x20-\x7e]|["\\]/g, '_');
	const utf8 = encodeURIComponent(base).replace(
		/['()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * `content-type`, `content-disposition`, `x-content-type-options` and `content-security-policy` for
 * one R2 key. `download` forces an attachment even for an inline-safe type.
 */
export function userContentHeaders(
	key: string,
	opts: { download?: boolean } = {},
): Record<string, string> {
	const ext = extOf(key);
	const inline = INLINE_TYPES[ext];
	const asAttachment = opts.download || !inline;
	return {
		'content-type': inline ?? ATTACHMENT_TYPES[ext] ?? 'application/octet-stream',
		'content-disposition': asAttachment ? attachmentDisposition(key) : 'inline',
		'x-content-type-options': 'nosniff',
		'content-security-policy': LOCKED_DOWN_CSP,
	};
}
