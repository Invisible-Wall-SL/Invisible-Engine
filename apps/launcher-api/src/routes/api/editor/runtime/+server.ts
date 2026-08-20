import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import {
	DEFAULT_PROJECT_KEY,
	projectAllowsRead,
	projectClientKey,
	projectName,
} from '$lib/server/projects';
import { getRuntimeBundle } from '$lib/server/runtimeBundleCache';
import type { RequestHandler } from './$types';

/**
 * Generic-runtime boot endpoint (Invisible Game Maker, Phase 0). Returns — in ONE
 * payload — everything a prebuilt "generic engine runtime" needs to boot an
 * arbitrary project purely from a live fetch: the layout doc, its referenced
 * ComponentDefs + per-project param defaults, and the project's editor-art / fonts
 * / symbols / localization assets. The logical shape matches the build-time
 * `BakedBundle` the game's `editor-scenes.ts` consumes (the canonical contract),
 * PLUS an `assetBase` — the absolute URL prefix the runtime prepends to every asset
 * file ref below, resolving to THIS launcher's `/api/deploy` for this project+token.
 *
 * This is the LIVE equivalent of `scripts/bake-editor-doc.mjs`'s build-time freeze
 * (`runtimeBundle.ts` extracts the shared assembly), so changing a project's doc /
 * art / fonts / strings / symbols re-publishes with no rebuild.
 *
 * A deployed runtime runs on its own origin with no launcher session, so this is
 * NOT cookie-authed: it is gated by the SAME shared read token (`?k=` vs
 * `getDeployToken()`) as `/api/editor/doc` + `/api/deploy`. When the secret is
 * unset the endpoint refuses to serve (503) so it is never public. CORS is open
 * because the token, not the origin, is the gate.
 *
 *   GET /api/editor/runtime?project=<projectKey>&k=<token>
 *
 * `project` is the BARE launcher project key (the client is DB-resolved), matching
 * `/api/editor/doc` — NOT `<client>/<project>`.
 */
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	// `Server-Timing` is not a CORS-safelisted response header, so a cross-origin reader (the game,
	// or DevTools on a game tab) cannot see it unless it is EXPOSED. Without this the header ships
	// and is invisible exactly where it is most useful.
	'Access-Control-Expose-Headers': 'Server-Timing',
	'Cache-Control': 'no-store',
};

/**
 * The assemble's per-step breakdown as a `Server-Timing` header, so "which exporter cost the 33
 * seconds" is readable from a browser instead of only from the launcher's console.
 *
 * This exists because the cost is real and growing: `bookofborutremake` assembles in ~33s and its
 * FIRST request 502s at the gateway (the game survives only because `fetchRuntimeWithRetry` joins
 * the in-flight run), while a near-empty project answers in under 5s. The difference is per-project
 * CONTENT walked by the exporters on every read, so every project trends toward the slow number as
 * it fills up. Fixing that means moving exports off the read path — and this header is the data that
 * says which exporter to move first (see `runtimeBundleCache`'s "THE REAL FIX" note).
 *
 * Empty in, nothing out: a cache hit or an in-flight join did no work, and reporting someone else's
 * numbers would be worse than reporting none.
 */
function serverTimingHeader(timings: Record<string, number>): Record<string, string> {
	const entries = Object.entries(timings);
	if (!entries.length) return {};
	const value = entries
		// Step names are internal labels (`cinematics:load`), and `Server-Timing` names must be
		// tokens — so anything outside the token charset becomes `_` rather than emitting a header
		// a parser will reject and a reader will never see.
		.map(
			([name, ms]) => `${name.replace(/[^A-Za-z0-9!#$%&'*+\-.^_`|~]/g, '_')};dur=${Math.round(ms)}`,
		)
		.join(', ');
	return { 'Server-Timing': value };
}

export const GET: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Runtime endpoint is not configured.');
	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	// Accept the shared deploy token (build CI) OR this project's own read token —
	// so a public Game Maker game URL embeds the per-project read-only token, never
	// the shared build/deploy secret (design doc gap #3).
	const token = url.searchParams.get('k') ?? '';
	if (!(await projectAllowsRead(projectKey, token))) throw error(401, 'Invalid or missing token.');

	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		// Single-flighted + briefly cached: assembling this re-runs every exporter (17-19s in
		// production), so a per-request assemble made concurrent boots pile up and 502 — and a
		// 502 silently drops the game onto stale baked data. See `runtimeBundleCache`.
		// `authoring=1` — sent only by a game booted from a launcher link (`ie_authoring=1`),
		// never by a published player URL — additionally serves UNREVIEWED translations, so
		// an author can see machine output in the running game before vetting it. The
		// player-facing bundle and the build-time bake stay reviewed-only.
		const authoring = url.searchParams.get('authoring') === '1';
		// Per-step assemble timings, surfaced as `Server-Timing` below. Stays EMPTY when this request
		// did not assemble (a cache hit, or a join onto someone else's in-flight run) — which is the
		// honest answer for those requests rather than someone else's numbers.
		const timings: Record<string, number> = {};
		const bundle = await getRuntimeBundle(projectKey, authoring, timings);

		// Absolute PATH prefix the runtime prepends to every deploy-relative asset
		// path (`json`/`file`/`atlas`/`skeleton` below). MUST be the path form
		// (`/api/deploy/f/<token>/<client>/<project>/`) — NOT the query form — so a
		// sub-file named inside a parent (Spine atlas page, spritesheet page, bitmap
		// font page) resolves correctly when the runtime loads it RELATIVE to the
		// parent's URL. The token + project survive as leading path segments; the
		// query form would drop them on relative resolution. Ends with `/` so the
		// runtime appends the relative path directly.
		const assetBase =
			`${url.origin}/api/deploy/f/${encodeURIComponent(token)}` +
			`/${encodeURIComponent(clientKey)}/${encodeURIComponent(projectKey)}/`;

		// The launcher's project display name, so the boot loading screen can show the real
		// game title (e.g. "Book of Borut") instead of the bare slug. Falls back to the key.
		const name = (await projectName(projectKey)) ?? projectKey;

		return json(
			{ assetBase, name, ...bundle },
			{ headers: { ...CORS_HEADERS, ...serverTimingHeader(timings) } },
		);
	} catch (e) {
		console.error('runtime bundle failed:', e);
		throw error(502, 'Failed to assemble the runtime bundle.');
	}
};

export const OPTIONS: RequestHandler = async () =>
	new Response(null, { status: 204, headers: CORS_HEADERS });
