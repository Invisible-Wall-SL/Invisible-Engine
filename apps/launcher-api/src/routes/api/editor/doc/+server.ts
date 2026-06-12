import { error, json } from '@sveltejs/kit';
import { applyHudGameNameDefault, collectComponentIds } from 'engine-layout';
import type { ComponentDef, LayoutDoc } from 'engine-layout';
import { getDeployToken } from '$lib/server/appSettings';
import { loadComponent } from '$lib/server/componentStorage';
import { listComponentDefaults } from '$lib/server/componentDefaultsStorage';
import { loadDoc } from '$lib/server/editorStorage';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey, projectName } from '$lib/server/projects';
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
 * Resolve the transitive set of {@link ComponentDef}s a doc references — every
 * `componentInstance.componentId` in the scenes, plus any nested inside those
 * defs' roots (cycle-safe via the `seen` set). Each id is resolved through the
 * built-in → shared → project precedence (`loadComponent`),
 * so a project's EDITED `button` shadows the coded one. Used by the build-time
 * bake (`&components=1`) so a shipped game can `registerComponents(...)` the
 * custom defs that otherwise live only in R2 and never reach the bundle.
 */
async function resolveReferencedDefs(
	doc: LayoutDoc,
	projectKey: string,
): Promise<Record<string, ComponentDef>> {
	const defs: Record<string, ComponentDef> = {};
	const seen = new Set<string>();
	const queue = collectComponentIds(doc.scenes.flatMap((scene) => scene.nodes));
	while (queue.length) {
		const id = queue.shift()!;
		if (seen.has(id)) continue;
		seen.add(id);
		const def = await loadComponent(id, projectKey);
		if (!def) continue;
		defs[id] = def;
		for (const nested of collectComponentIds([def.root])) {
			if (!seen.has(nested)) queue.push(nested);
		}
	}
	return defs;
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
	'Cache-Control': 'no-store',
};

export const GET: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Layout-doc endpoint is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const doc = await loadDoc(clientKey, projectKey);
		// Default the HUD game-name to the project's display name (unless the editor
		// overrode it), so the game shows the project name without a hard-coded string.
		applyHudGameNameDefault(doc, await projectName(projectKey));
		resolveSpineKeysForGame(doc, clientKey, projectKey);
		// Per-project component param defaults (§14.2 B4.5) so the game's
		// `registerComponentDefaults` can apply author-set appearance defaults to
		// `componentInstance`s (e.g. the HUD readouts). Empty map ⇒ def defaults apply.
		const componentDefaults = await listComponentDefaults(projectKey);
		// `&components=1` (build-time bake): also bundle the referenced ComponentDefs so a
		// shipped game can register the custom/edited ones (R2-only otherwise). Omitted by
		// default so the runtime boot fetch stays lean.
		const componentDefs =
			url.searchParams.get('components') === '1'
				? await resolveReferencedDefs(doc as LayoutDoc, projectKey)
				: undefined;
		return json(
			{
				clientKey,
				projectKey,
				doc,
				componentDefaults,
				...(componentDefs ? { componentDefs } : {}),
			},
			{ headers: CORS_HEADERS },
		);
	} catch {
		throw error(502, 'Failed to load the layout document.');
	}
};

export const OPTIONS: RequestHandler = async () =>
	new Response(null, { status: 204, headers: CORS_HEADERS });
