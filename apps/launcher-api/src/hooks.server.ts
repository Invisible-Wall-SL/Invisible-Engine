import { bootPhrases } from '$lib/bootPhrases';
import { TOOLS } from '$lib/roles';
import { SESSION_COOKIE, validateSession } from '$lib/server/auth';
import { BUILD_ID } from '$lib/server/buildId';
import { startCostRecorder } from '$lib/server/costs/recorder';
import { runMigrations } from '$lib/server/db/migrate';
import { DEPLOY_CORS_HEADERS } from '$lib/server/deployServe';
import { startRunpodIdleWatchdog } from '$lib/server/runpodWatchdog';
import type { Handle, ServerInit } from '@sveltejs/kit';

/** Runs once at server startup, before the first request — apply pending DB
 * migrations so schema-dependent routes never serve against an old schema, start
 * the ComfyUI R&D pod idle auto-stop watchdog (a no-op when pod control / idle
 * auto-stop isn't configured), and start the Admin → Costs monthly recorder so a
 * month's figure doesn't depend on someone happening to open the page. */
export const init: ServerInit = async () => {
	await runMigrations();
	startRunpodIdleWatchdog();
	startCostRecorder();
};

const attr = (s: string): string =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * The CRT boot splash for a HARD load of a tool page (typed URL, refresh, a link from a
 * static tool, or an in-tool full navigation like Flipbook's open-a-clip). Client-side
 * navigation is covered by `<BootSplash>` in `(app)/+layout.svelte`, but a hard load has no
 * app running yet — the tool pages are `ssr = false`, so the browser would sit on a blank
 * shell while the chunk + `load` land. Injecting the vanilla splash into the shell paints it
 * on the first byte (same trick as the Python tools' `splash_html`); the root `+layout.svelte`
 * calls `IWBoot.done()` once the app has mounted. See docs/ui-inventory.md §12.
 */
function bootSplashTag(pathname: string): string | null {
	const tool = Object.values(TOOLS).find((t) => t.url === pathname);
	if (!tool) return null;
	// `data-settle-ms`: the app itself lifts the splash (root `+layout.svelte` → `IWBoot.done()`),
	// so the window.load fallback only has to catch a boot that never mounts at all — an
	// `ssr = false` page has barely STARTED loading its data at `load`.
	// `?v=BUILD_ID`: the file has a stable name and adapter-node serves static with no
	// Cache-Control, so without it a browser keeps the previous deploy's splash forever.
	return (
		`<script src="/shared/boot-splash.js?v=${BUILD_ID}" data-tool="${attr(tool.name)}"` +
		` data-settle-ms="8000" data-phrases="${attr(bootPhrases(tool.id).join('|'))}"></script>`
	);
}

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = await validateSession(token);
	const splash = bootSplashTag(event.url.pathname);
	const response = await resolve(
		event,
		splash
			? {
					transformPageChunk: ({ html }) => html.replace('<!--iw-boot-splash-->', splash),
				}
			: undefined,
	);
	// The read-only deploy asset tree is fetched cross-origin by the game runtime
	// (games.invisiblewall.org → app.invisiblewall.org). The handlers set CORS on the
	// 200/preflight responses, but SvelteKit's error() responses (404/401) don't — so a
	// missing/stale asset surfaces in the browser as a misleading "No
	// Access-Control-Allow-Origin" CORS error that hides its real status. Set the CORS
	// headers on every /api/deploy response so failures report honestly.
	// Same treatment for the generic-runtime boot endpoint AND the layout-doc fallback
	// (`/api/editor/doc`): both set CORS on their 200,
	// but a `throw error()` (401 bad token / 502 / 503) response does NOT — so a game
	// booted with a wrong token sees an opaque "Failed to fetch" (CORS) instead of the
	// real 401, then silently falls back to stale baked assets. Setting CORS on EVERY
	// response makes the failure legible in the console (the boot logs the real status).
	if (
		event.url.pathname.startsWith('/api/deploy') ||
		event.url.pathname === '/api/editor/runtime' ||
		event.url.pathname === '/api/editor/doc'
	) {
		for (const [key, value] of Object.entries(DEPLOY_CORS_HEADERS)) {
			response.headers.set(key, value);
		}
	}
	return response;
};
