import { soundOptionsFor } from '$lib/soundOptions';
import { loadSoundsDoc } from '$lib/server/soundsStorage';
import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { loadFlowV2DocForEditor } from '$lib/server/flowV2Storage';
import { loadFlowV2LibraryWithEtag } from '$lib/server/flowV2LibraryStorage';
import { loadDoc } from '$lib/server/editorStorage';
import { resolveToolScope } from '$lib/server/toolScope';
import { actionBindingOf, BUILTIN_COMPONENTS } from 'engine-layout';
import {
	componentSignalConfiguredEvents,
	deriveContainerEvents,
	repeaterSelectConfiguredEvent,
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
 * Flow's entitlement) and loads the project's v2 FlowDoc from R2 at `flowV2DocKey`. The
 * `(app)` route ALWAYS resolves a real `(client, project)`, so a project is always bound and
 * saving is always enabled. When the object is absent or malformed, `loadFlowV2DocForEditor`
 * SEEDS a deep clone of the canonical reference flow (`seeded: true`) — a real, editable,
 * saveable loading→tap→basegame→win flow — instead of a throwaway sample, and the author's
 * first edit persists it (create-on-first-save via the null `etag`).
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
	// The ETags go to the client so its saves can CAS against them. Note the container
	// sync below MUTATES `doc`, so the client doc deliberately differs from the stored
	// bytes — the etag guards the stored OBJECT, and must not be re-derived from the
	// payload.
	// The Scene Editor's friendly screen NAMES, keyed by scene id — so the container nodes
	// (show/hideContainer) can label themselves "HUD - Bottom BAR" instead of the raw id
	// (`hud_kv04zk3j`). Best-effort: an unsaved / standalone project just yields an empty map.
	// Loaded BEFORE the flow doc because its `gameType` selects which starter an un-seeded project
	// opens on (a ways project must not be handed the Book-of flow).
	const layout = await loadDoc(clientKey, projectKey);
	const {
		doc,
		etag: docEtag,
		seeded,
	} = await loadFlowV2DocForEditor(clientKey, projectKey, layout.gameType);
	const { lib: library, etag: libraryEtag } = await loadFlowV2LibraryWithEtag();
	const sceneNames: Record<string, string> = Object.fromEntries(
		(layout.scenes ?? []).map((s) => [s.id, s.name ?? s.id]),
	);

	// CONTAINER SYNC — the flow can show/hide any SCENE, so every Scene-Editor screen is a container.
	// The doc's `containers` were seeded once (the v1→v2 migration froze the then-current screens), so a
	// screen AUTHORED LATER (e.g. "Background") would otherwise never appear in the flow. Merge in any
	// scene missing from `containers` (id = sceneId; a placeholder z appended after the last — the
	// runtime re-derives the real z from the Scene-Editor order, so this z is only a tiebreak). Returning
	// the merged doc means the palette offers every screen immediately, and a Save persists the ones the
	// author actually shows. `doc` is never null (a fresh project is SEEDED with the reference flow), so
	// a brand-new project's own scenes still surface here. A `space:'background'` scene is a container
	// like any other: under a screen-driving flow its space is only the coordinate frame (cover-fit to
	// the window), and the flow alone decides when it is on screen — the engine no longer draws it as an
	// always-on backdrop there (owner direction 2026-09-02), so it MUST be offered for show/hide.
	const seen = new Set(doc.containers.map((c) => c.sceneId));
	let z = doc.containers.reduce((m, c) => Math.max(m, c.z), 0);
	for (const scene of layout.scenes ?? []) {
		if (seen.has(scene.id)) continue;
		z += 10;
		doc.containers.push({ id: scene.id, sceneId: scene.id, z });
	}

	// §6.1 — the container-event surface, keyed by ContainerId. For each of the FlowDoc's
	// `containers`, find its Scene-Editor scene by `sceneId`, project the scene's nodes down to the
	// minimal `ConfiguredComponentEvent` shape (any node with a non-empty universal `action` binding
	// contributes `{ componentId: node.id, event: <action> }`), then aggregate via
	// `deriveContainerEvents`. The fused `showContainer` node reads its container's decls from this
	// surface (`derivePins`). Best-effort: an unsaved project with no scenes yields an empty map.
	const scenesById = new Map((layout.scenes ?? []).map((s) => [s.id, s]));
	const containerEvents: Record<string, ContainerEventDecl[]> = {};
	for (const container of doc.containers) {
		const scene = scenesById.get(container.sceneId);
		if (!scene) continue;
		const configured: ConfiguredComponentEvent[] = (scene.nodes ?? []).flatMap((node) => {
			// A `repeater` node projects the SINGLE fused `onSelect` decl for the whole list (N cards → one
			// pin), carrying the selected item's `betModeKey` — it has no per-item `action` param, so it is
			// recognised by kind (`repeaterSelectConfiguredEvent`, the deriver's single source of that shape).
			if ((node as { kind?: string }).kind === 'repeater') {
				const canonical = repeaterSelectConfiguredEvent(node.id);
				const repeaterEvents: ConfiguredComponentEvent[] = [canonical];
				// The repeater's ITEM component may declare OTHER signals worth surfacing (a richer,
				// multi-action card), but its `select` signal IS the repeater's canonical fused `onSelect`
				// (+`betModeKey`) — so SUPPRESS that duplicate here (its event equals `canonical.event`),
				// else the `showContainer` node shows TWO `onSelect` pins and wiring the payload-less one
				// silently breaks the card press. (The `deriveContainerEvents` de-dupe is the deeper safety
				// net; this keeps the surface clean.)
				const itemId = (node as { componentId?: string }).componentId;
				const itemDef = itemId ? BUILTIN_COMPONENTS.find((d) => d.id === itemId) : undefined;
				for (const signal of itemDef?.signals ?? []) {
					if (signal.key === canonical.event) continue;
					repeaterEvents.push({ componentId: node.id, event: signal.key });
				}
				return repeaterEvents;
			}
			const events: ConfiguredComponentEvent[] = [];
			// The universal `action` binding lives on `node.params` for ANY instance (not only a def that
			// declares it — see engine-layout `engineBindings.ts`); only `componentInstance` nodes type it,
			// so read it off a widened shape. Empty/absent action ⇒ no configured event ⇒ no decl.
			const params = (node as { params?: Record<string, unknown> }).params ?? {};
			const action = actionBindingOf(params);
			if (action) events.push({ componentId: node.id, event: action });
			// A component's DECLARED signals ALSO project — one fused pin per signal — so a multi-button
			// component surfaces every press it exposes (the confirm dialog's `confirm`/`cancel`, generic
			// over any def's `signals`, never special-cased by name). Resolved from the BUILT-IN defs
			// synchronously; a CUSTOM (R2) component's signals are not yet projected here (the loader would
			// need to resolve its def) — a follow-up, flagged in the buy-flow work.
			const componentId = (node as { componentId?: string }).componentId;
			if ((node as { kind?: string }).kind === 'componentInstance' && componentId) {
				const def = BUILTIN_COMPONENTS.find((d) => d.id === componentId);
				for (const signal of def?.signals ?? []) {
					if (!events.some((e) => e.event === signal.key)) {
						events.push({ componentId: node.id, event: signal.key });
					}
				}
			}
			return events;
		});
		containerEvents[container.id] = deriveContainerEvents(configured);
	}

	return {
		clientKey,
		projectKey,
		doc,
		docEtag,
		/** What every sound picker on this page may offer: the engine's own sounds PLUS the ones this
		 *  project uploaded in Invisible Sound. Before this, an uploaded sound was unselectable here. */
		soundOptions: soundOptionsFor(await loadSoundsDoc(clientKey, projectKey)),
		seeded,
		library,
		libraryEtag,
		sceneNames,
		containerEvents,
	};
};
