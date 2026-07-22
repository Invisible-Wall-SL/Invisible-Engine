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
	'Cache-Control': 'no-store',
};

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
		const bundle = await getRuntimeBundle(projectKey);

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

		return json({ assetBase, name, ...bundle }, { headers: CORS_HEADERS });
	} catch (e) {
		console.error('runtime bundle failed:', e);
		throw error(502, 'Failed to assemble the runtime bundle.');
	}
};

export const OPTIONS: RequestHandler = async () =>
	new Response(null, { status: 204, headers: CORS_HEADERS });
