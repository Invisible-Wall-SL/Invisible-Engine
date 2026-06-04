import { error, json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { loadDoc } from '$lib/server/editorStorage';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { bundleFromAssetKey } from '$lib/server/spine';
import type { RequestHandler } from './$types';

/**
 * Spine `assetKey`s are stored as the R2 bundle PREFIX
 * (`<client>/<project>/spines/<bundle>/`) because the editor canvas resolves
 * spines straight from R2 by that key. A running GAME, however, registers its
 * spines under the plain `<bundle>` key in its own `assets.ts`. So for the
 * game-facing doc we rewrite each spine node's prefix down to its bundle name;
 * the editor's own load path (`+page.server.ts`) is untouched and keeps the
 * prefix it needs. Mutates in place — the doc is freshly parsed per request.
 */
function resolveSpineKeysForGame(doc: unknown, clientKey: string, projectKey: string): void {
	const walk = (node: unknown): void => {
		if (!node || typeof node !== 'object') return;
		const n = node as { kind?: string; assetKey?: unknown; children?: unknown };
		if (n.kind === 'spine' && typeof n.assetKey === 'string') {
			const bundle = bundleFromAssetKey(clientKey, projectKey, n.assetKey);
			if (bundle) n.assetKey = bundle;
		}
		if (Array.isArray(n.children)) n.children.forEach(walk);
	};
	const scenes = (doc as { scenes?: unknown })?.scenes;
	if (Array.isArray(scenes)) {
		for (const scene of scenes) {
			const nodes = (scene as { nodes?: unknown })?.nodes;
			if (Array.isArray(nodes)) nodes.forEach(walk);
		}
	}
}

/**
 * Read-only layout-doc endpoint for running games to fetch at boot.
 *
 * A deployed game runs on its own origin with no launcher session, so this is
 * NOT cookie-authed. Instead it is gated by a shared read token (`?k=`, matched
 * against `EDITOR_DOC_SECRET`) — the same pattern the atlas/sheet tools use.
 * A `LayoutDoc` is non-sensitive scenery data (sprite keys + positions), and
 * the token is client-visible to anyone the game is served to; the gate exists
 * to keep the docs from being read by anonymous/external callers. When the
 * secret is unset the endpoint refuses to serve (503) so it is never public.
 * CORS is open because the token, not the origin, is the gate.
 */
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Cache-Control': 'public, max-age=30',
};

export const GET: RequestHandler = async ({ url }) => {
	const secret = ENV.EDITOR_DOC_SECRET;
	if (!secret) throw error(503, 'Layout-doc endpoint is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const doc = await loadDoc(clientKey, projectKey);
		resolveSpineKeysForGame(doc, clientKey, projectKey);
		return json({ clientKey, projectKey, doc }, { headers: CORS_HEADERS });
	} catch {
		throw error(502, 'Failed to load the layout document.');
	}
};

export const OPTIONS: RequestHandler = async () =>
	new Response(null, { status: 204, headers: CORS_HEADERS });
