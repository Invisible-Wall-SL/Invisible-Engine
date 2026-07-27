import { error, json } from '@sveltejs/kit';
import { applyHudGameNameDefault, collectComponentIds, collectComponentPins } from 'engine-layout';
import type { ComponentDef, LayoutDoc } from 'engine-layout';
import { getDeployToken } from '$lib/server/appSettings';
import { loadComponent } from '$lib/server/componentStorage';
import { listComponentDefaults } from '$lib/server/componentDefaultsStorage';
import { loadDoc } from '$lib/server/editorStorage';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import {
	DEFAULT_PROJECT_KEY,
	projectAllowsRead,
	projectClientKey,
	projectName,
} from '$lib/server/projects';
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
function rewriteSpineKeys(node: unknown, clientKey: string, projectKey: string): void {
	if (!node || typeof node !== 'object') return;
	const n = node as { kind?: string; assetKey?: unknown; children?: unknown };
	if (n.kind === 'spine' && typeof n.assetKey === 'string') {
		const bundle = bundleFromAssetKey(clientKey, projectKey, n.assetKey);
		if (bundle) n.assetKey = bundle;
	}
	if (Array.isArray(n.children)) for (const c of n.children) rewriteSpineKeys(c, clientKey, projectKey);
}

function resolveSpineKeysForGame(doc: unknown, clientKey: string, projectKey: string): void {
	const scenes = (doc as { scenes?: unknown })?.scenes;
	if (Array.isArray(scenes)) {
		for (const scene of scenes) {
			const nodes = (scene as { nodes?: unknown })?.nodes;
			if (Array.isArray(nodes)) for (const node of nodes) rewriteSpineKeys(node, clientKey, projectKey);
		}
	}
}

/**
 * The component defs a game registers carry their OWN spine nodes (a button's
 * `R_SpinButton`, a free-spin frame, …) — rewrite those `assetKey`s too, exactly as
 * {@link resolveSpineKeysForGame} does for the scene tree. Without this, `LayoutNodeView`
 * hands `<SpineProvider>` the full R2 bundle PREFIX while the game registered the bundle
 * under its bare NAME, so the lookup misses and the placed component's spine never loads.
 * Must mirror `lib/server/runtimeBundle.ts`.
 */
function resolveSpineKeysForComponentDefs(
	resolved: { defs: Record<string, ComponentDef>; versions: ComponentDef[] } | undefined,
	clientKey: string,
	projectKey: string,
): void {
	if (!resolved) return;
	for (const def of Object.values(resolved.defs)) rewriteSpineKeys(def.root, clientKey, projectKey);
	for (const def of resolved.versions) rewriteSpineKeys(def.root, clientKey, projectKey);
}

/**
 * Resolve the transitive set of {@link ComponentDef}s a doc references — every
 * `componentInstance.componentId` in the scenes, plus any nested inside those
 * defs' roots (cycle-safe via the `seen` set). Each id is resolved through the
 * built-in → shared → project precedence (`loadComponent`),
 * so a project's EDITED `button` shadows the coded one. Used by the build-time
 * bake (`&components=1`) so a shipped game can `registerComponents(...)` the
 * custom defs that otherwise live only in R2 and never reach the bundle.
 *
 * `versions` (§8.9 v2): the EXACT historical defs any instance PINS to a
 * non-latest version, loaded from the multi-version store (`loadComponent(id,
 * projectKey, version)`). The game registers these BEFORE `defs` so each pinned
 * instance resolves the precise version it was authored against while latest still
 * wins for unpinned ones. No non-latest pin ⇒ `versions` is empty and the bundle is
 * byte-identical to today (parity). The transitive nested-pin closure is not walked
 * (a nested instance's own pin is resolved against whatever the parent def shipped);
 * v1 nesting is 1–2 levels and no game pins yet, so this is the precise, sufficient
 * slice — see §8.9 for the scoped remainder.
 */
async function resolveReferencedDefs(
	doc: LayoutDoc,
	projectKey: string,
): Promise<{ defs: Record<string, ComponentDef>; versions: ComponentDef[] }> {
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
	const versions: ComponentDef[] = [];
	for (const pin of collectComponentPins(doc.scenes.flatMap((scene) => scene.nodes))) {
		// Skip a pin that already equals the latest def we shipped above — registering
		// latest covers it, so no extra version doc is needed (parity for unedited games).
		if (defs[pin.id]?.version === pin.version) continue;
		const pinned = await loadComponent(pin.id, projectKey, pin.version);
		if (pinned) versions.push(pinned);
	}
	return { defs, versions };
}

/**
 * Read-only layout-doc endpoint for running games to fetch at boot.
 *
 * A deployed game runs on its own origin with no launcher session, so this is
 * NOT cookie-authed. Instead it is gated by a read token (`?k=`) accepted by
 * `projectAllowsRead`: EITHER the shared build/deploy token (build CI) OR the
 * project's OWN per-project read token — the same gate as `/api/editor/runtime`.
 * This matters because the public game URL embeds the per-project read-only token
 * (`getOrMintReadToken`), never the shared deploy secret; checking only the deploy
 * token here 401'd every launcher-launched game. A `LayoutDoc` is non-sensitive
 * scenery data (sprite keys + positions), and the token is client-visible to anyone
 * the game is served to; the gate exists to keep docs from anonymous/external
 * callers. When no deploy token is configured at all the endpoint refuses to serve
 * (503) so it is never public. CORS is open because the token, not the origin, is
 * the gate.
 */
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Cache-Control': 'no-store',
};

export const GET: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Layout-doc endpoint is not configured.');
	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	// Accept the shared deploy token (build CI) OR this project's own read token —
	// the public game URL embeds the per-project read-only token, never the shared
	// build/deploy secret. Mirrors `/api/editor/runtime` (projectAllowsRead).
	const token = url.searchParams.get('k') ?? '';
	if (!(await projectAllowsRead(projectKey, token))) throw error(401, 'Invalid or missing token.');

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
		// default so the runtime boot fetch stays lean. `componentVersions` carries the
		// exact pinned non-latest defs (§8.9 v2) — empty (and so omitted) for every game
		// with no non-latest pin, keeping the payload byte-identical.
		const resolved =
			url.searchParams.get('components') === '1'
				? await resolveReferencedDefs(doc as LayoutDoc, projectKey)
				: undefined;
		// A placed component's OWN spine nodes need the same prefix→bundle-name rewrite as the
		// scene tree, or their spines never load in the built game (key mismatch).
		resolveSpineKeysForComponentDefs(resolved, clientKey, projectKey);
		return json(
			{
				clientKey,
				projectKey,
				doc,
				componentDefaults,
				...(resolved ? { componentDefs: resolved.defs } : {}),
				...(resolved && resolved.versions.length ? { componentVersions: resolved.versions } : {}),
			},
			{ headers: CORS_HEADERS },
		);
	} catch {
		throw error(502, 'Failed to load the layout document.');
	}
};

export const OPTIONS: RequestHandler = async () =>
	new Response(null, { status: 204, headers: CORS_HEADERS });
