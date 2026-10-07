import { error, redirect } from '@sveltejs/kit';
import { getObjectBytes } from '$lib/server/r2';
import {
	PROJECT_STORYBOOK_SEGMENT,
	requireStorybookAccess,
	resolveStorybookKey,
} from '$lib/server/storybooks';
import { extOf, userContentHeaders } from '$lib/server/userContent';
import type { RequestHandler } from './$types';

/**
 * Auth-gated static serving for published storybook builds (the same serve-from-R2
 * model as the Rig Viewer's `/rig-viewer/file`, but path-shaped: a storybook's
 * internal links are RELATIVE, so `/storybook/view/<id>/index.html` must find its
 * siblings — `iframe.html`, `assets/…` — at the same URL directory).
 */

/**
 * A published build is a set of live pages, so unlike other R2 content its HTML and scripts are
 * served inline. The type still comes from the extension, never the stored metadata; anything
 * outside the map gets the shared user-content headers (download, locked down).
 */
const PAGE_TYPES: Record<string, string> = {
	html: 'text/html; charset=utf-8',
	js: 'text/javascript; charset=utf-8',
	mjs: 'text/javascript; charset=utf-8',
	css: 'text/css; charset=utf-8',
	svg: 'image/svg+xml',
	ico: 'image/x-icon',
	map: 'application/json; charset=utf-8',
};

/**
 * The build runs its own scripts, and stories reach HTTPS hosts (web fonts, asset CDNs, an RGS),
 * so the policy fences what a page could be turned into rather than where it may connect: no
 * plugins, no plain-HTTP loads, no form posts, no `<base>` rewrite, no framing by other sites (the
 * manager frames its own `iframe.html`, hence `'self'`). Only `publish-storybook.mjs` writes these
 * trees; the file browser refuses them (`ftpScope.assertWritable`).
 */
const STORYBOOK_CSP = [
	"default-src 'self' https: wss: data: blob:",
	"script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
	"style-src 'self' 'unsafe-inline' https:",
	"worker-src 'self' blob:",
	"frame-src 'self'",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'none'",
	"frame-ancestors 'self'",
].join('; ');

function storybookHeaders(key: string, rel: string): Record<string, string> {
	const pageType = PAGE_TYPES[extOf(rel)];
	const base = pageType
		? { 'content-type': pageType, 'x-content-type-options': 'nosniff' }
		: userContentHeaders(key);
	return { ...base, 'content-security-policy': STORYBOOK_CSP };
}

/**
 * Vite/storybook content-hash suffix (`ModeBase.stories-D4GBCXCx.js`): a dash +
 * exactly 8 base64-ish chars including a digit, right before the extension.
 * Storybook's `assets/` also carries UN-hashed copies of the app's static dir
 * (audio, images), so "under assets/" alone is not a safe immutability signal.
 */
const HASHED_NAME = /-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{8}\.\w+$/;

/**
 * Caching per file class: the un-hashed entry/state documents (`.html`, `.json`)
 * must revalidate every publish; content-hashed bundles are immutable;
 * everything else (fonts, favicons, static-dir assets) gets a short TTL.
 */
function cacheControl(rel: string): string {
	const ext = rel.split('.').pop()?.toLowerCase() ?? '';
	if (ext === 'html' || ext === 'json') return 'no-store';
	if (HASHED_NAME.test(rel)) return 'public, max-age=31536000, immutable';
	return 'public, max-age=3600';
}

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const user = await requireStorybookAccess(locals);

	const segments = params.path.split('/').filter(Boolean);
	// Bare /storybook/view — nothing to serve; send the user back to the picker.
	if (segments.length === 0) throw redirect(302, '/storybook');

	const key = await resolveStorybookKey(user, segments);
	if (key === null) {
		// A storybook root (`…/engine`, `…/p/<project>` — with or without a trailing
		// slash): enter through index.html so the build's relative links resolve.
		throw redirect(302, `${url.pathname.replace(/\/+$/, '')}/index.html`);
	}

	const obj = await getObjectBytes(key);
	if (!obj) throw error(404, 'not found');

	const rel = segments.slice(segments[0] === PROJECT_STORYBOOK_SEGMENT ? 2 : 1).join('/');
	return new Response(obj.body, {
		headers: { ...storybookHeaders(key, rel), 'cache-control': cacheControl(rel) },
	});
};
