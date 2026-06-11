import { error, redirect } from '@sveltejs/kit';
import { getObjectBytes } from '$lib/server/r2';
import {
	PROJECT_STORYBOOK_SEGMENT,
	requireStorybookAccess,
	resolveStorybookKey,
} from '$lib/server/storybooks';
import type { RequestHandler } from './$types';

/**
 * Auth-gated static serving for published storybook builds (the same serve-from-R2
 * model as the Spine Viewer's `/spine/file`, but path-shaped: a storybook's
 * internal links are RELATIVE, so `/storybook/view/<id>/index.html` must find its
 * siblings — `iframe.html`, `assets/…` — at the same URL directory).
 */

/** R2's stored type wins (the publish script sets it); fallback for old objects. */
const FALLBACK_TYPE: Record<string, string> = {
	html: 'text/html; charset=utf-8',
	js: 'text/javascript; charset=utf-8',
	mjs: 'text/javascript; charset=utf-8',
	css: 'text/css; charset=utf-8',
	json: 'application/json; charset=utf-8',
	svg: 'image/svg+xml',
	png: 'image/png',
	woff2: 'font/woff2',
};

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
	const ext = rel.split('.').pop()?.toLowerCase() ?? '';
	const contentType =
		obj.contentType !== 'application/octet-stream'
			? obj.contentType
			: (FALLBACK_TYPE[ext] ?? 'application/octet-stream');

	return new Response(obj.body, {
		headers: { 'content-type': contentType, 'cache-control': cacheControl(rel) },
	});
};
