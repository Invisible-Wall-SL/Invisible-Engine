import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { loadFlowV2Doc } from '$lib/server/flowV2Storage';
import { loadFlowV2Library } from '$lib/server/flowV2LibraryStorage';
import { loadDoc } from '$lib/server/editorStorage';
import { resolveToolScope } from '$lib/server/toolScope';
import { actionBindingOf } from 'engine-layout';
import {
	deriveContainerEvents,
	type ConfiguredComponentEvent,
	type ContainerEventDecl,
} from 'engine-flow-v2';
import type { PageServerLoad } from './$types';

/**
 * Invisible Flow v2 — `/flow-v2` (Phase 2a, DEV route).
 *
 * An UNLISTED dev route (not in the tool registry) — reached by direct URL until the
 * Phase-5 hard cut retires v1 authoring. The canvas is a client-only Svelte Flow graph
 * (touches `window`), so SSR is disabled, mirroring `/flow`.
 *
 * Persistence: this loader mirrors v1 `/flow`'s scope resolution (`resolveToolScope` +
 * the `flow` role gate — `/flow-v2` has no registry entry of its own, so it reuses v1
 * Flow's entitlement) and loads the project's v2 FlowDoc from R2 at `flowV2DocKey`. When
 * no project is selected OR the object is absent/malformed, `doc` is `null` and the page
 * falls back to its built-in `SAMPLE_DOC` (so the dev route still works standalone).
 *
 * The shared FUNCTION LIBRARY is loaded here too, from the GLOBAL key
 * `_shared/flow-v2/functions.json` (project-agnostic — "Collapse to Function" grows one
 * library reusable across every project). When absent/malformed, `library` is `null` and the
 * page falls back to its built-in sample `LIBRARY`.
 *
 * OUT OF SCOPE (later increment): the template VOCABULARY still comes from the client-side
 * `sample.ts` (`BOOK_OF_VOCAB`).
 */
export const ssr = false;

export const load: PageServerLoad = async ({ locals, cookies, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	if (!roleHasTool(locals.user.role, 'flow')) {
		throw error(403, 'Your role does not have access to Invisible Flow.');
	}
	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});
	const doc = await loadFlowV2Doc(clientKey, projectKey);
	const library = await loadFlowV2Library();
	// The Scene Editor's friendly screen NAMES, keyed by scene id — so the container nodes
	// (show/hideContainer) can label themselves "HUD - Bottom BAR" instead of the raw id
	// (`hud_kv04zk3j`). Best-effort: an unsaved / standalone project just yields an empty map.
	const layout = await loadDoc(clientKey, projectKey);
	const sceneNames: Record<string, string> = Object.fromEntries(
		(layout.scenes ?? []).map((s) => [s.id, s.name ?? s.id]),
	);

	// CONTAINER SYNC — the flow can show/hide any SCENE, so every Scene-Editor screen is a container.
	// The doc's `containers` were seeded once (the v1→v2 migration froze the then-current screens), so a
	// screen AUTHORED LATER (e.g. "Background") would otherwise never appear in the flow. Merge in any
	// scene missing from `containers` (id = sceneId; a placeholder z appended after the last — the
	// runtime re-derives the real z from the Scene-Editor order, so this z is only a tiebreak). Returning
	// the merged doc means the palette offers every screen immediately, and a Save persists the ones the
	// author actually shows. New/standalone project (doc === null) still falls back to the client sample.
	if (doc) {
		const seen = new Set(doc.containers.map((c) => c.sceneId));
		let z = doc.containers.reduce((m, c) => Math.max(m, c.z), 0);
		for (const scene of layout.scenes ?? []) {
			if (seen.has(scene.id)) continue;
			z += 10;
			doc.containers.push({ id: scene.id, sceneId: scene.id, z });
		}
	}

	// §6.1 — the container-event surface, keyed by ContainerId. For each of the FlowDoc's
	// `containers`, find its Scene-Editor scene by `sceneId`, project the scene's nodes down to the
	// minimal `ConfiguredComponentEvent` shape (any node with a non-empty universal `action` binding
	// contributes `{ componentId: node.id, event: <action> }`), then aggregate via
	// `deriveContainerEvents`. The fused `showContainer` node reads its container's decls from this
	// surface (`derivePins`). Best-effort: no project / no saved FlowDoc ⇒ `doc` is null ⇒ empty map,
	// and the client's `SAMPLE_DOC` surfaces its own sample decls instead.
	const scenesById = new Map((layout.scenes ?? []).map((s) => [s.id, s]));
	const containerEvents: Record<string, ContainerEventDecl[]> = {};
	for (const container of doc?.containers ?? []) {
		const scene = scenesById.get(container.sceneId);
		if (!scene) continue;
		const configured: ConfiguredComponentEvent[] = (scene.nodes ?? []).map((node) => {
			// The universal `action` binding lives on `node.params` for ANY instance (not only a def that
			// declares it — see engine-layout `engineBindings.ts`); only `componentInstance` nodes type it,
			// so read it off a widened shape. Empty/absent action ⇒ no configured event ⇒ no decl.
			const params = (node as { params?: Record<string, unknown> }).params ?? {};
			return { componentId: node.id, event: actionBindingOf(params) || undefined };
		});
		containerEvents[container.id] = deriveContainerEvents(configured);
	}

	return { clientKey, projectKey, doc, library, sceneNames, containerEvents };
};
