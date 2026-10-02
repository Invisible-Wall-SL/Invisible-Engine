import { soundOptionsFor } from '$lib/soundOptions';
import { collectSceneCueNames } from '$lib/sceneCues';
import { collectContainerTaps } from '$lib/containerTaps';
import { loadSoundsDoc } from '$lib/server/soundsStorage';
import { error, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE } from '$lib/server/auth';
import { loadFlowV2DocForEditor } from '$lib/server/flowV2Storage';
import { loadFlowV2LibraryWithEtag } from '$lib/server/flowV2LibraryStorage';
import { listComponents } from '$lib/server/componentStorage';
import { loadDoc } from '$lib/server/editorStorage';
import { loadGameConfigDocWithEtag } from '$lib/server/gameConfigStorage';
import { resolveGameModes } from 'game-config';
import { resolveToolScope } from '$lib/server/toolScope';
import { projectContainerEvents, syncFlowContainers } from '$lib/flowV2Projection';
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

export const load: PageServerLoad = async ({ locals, cookies, url, parent }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'flow')) {
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

	// AUTHOR-NAMED CUES — every `SpineCue.signal` on every scene's spines (nested containers walked).
	// WHY: a `fireCue` node can only name something in `TemplateVocabulary.cues`, and the engine's cue
	// list is CLOSED (board / win / free-spin / sound / UI). An author-named cue is therefore the ONLY
	// way a flow can address an asset the author PLACED — put `characterSpin` on a spine OR a flipbook
	// Editor and a `fireCue characterSpin` reaches it through the open component-signal bus
	// (`emitComponentSignal`). Harvesting the names here is what makes them AUTHORABLE: `withSceneCues`
	// turns each into a payload-less CueDecl, so the palette, the inspector's ref dropdown,
	// `derivePins` and the validator all accept it. Best-effort: a project whose scenes name no cue
	// yields an empty list and the vocabulary is returned untouched.
	// Inside COMPONENTS too: a cue authored in a placed component, or a placement's signal override.
	const sceneCues = collectSceneCueNames(layout.scenes ?? [], await listComponents({ projectKey }));

	// CONTAINER SYNC (`syncFlowContainers`): every Scene-Editor screen is offered as a container.
	// Returning the merged doc means the palette offers every screen immediately, and a Save persists
	// the ones the author actually shows.
	syncFlowContainers(doc, layout.scenes ?? []);

	// HOLD SAFETY — ContainerId → does its backing scene mount something that can COMPLETE it (a
	// `tapToContinue` overlay, or a `completeOnLoaded` auto-advance)? A `showContainer{awaitComplete}`
	// on a container with no release hangs the round forever and the engine has no timeout by design,
	// so the validator flags it — but only where this map actually resolved the container (a scene-less
	// project keys nothing and the checks stay silent). Same projection shape as the cue harvest above.
	const containerTaps = collectContainerTaps(doc.containers, layout.scenes ?? []);

	// §6.1 — the container-event surface (see `projectContainerEvents`).
	const containerEvents = projectContainerEvents(doc.containers, layout.scenes ?? []);

	// GAME MODES (`docs/design/hold-and-win.md` §4.5) — the project's mode registry (the built-ins plus
	// its Game Config `modes`), offered by the "+ Mode" tab picker and the mode nodes' inspector. An
	// unauthored config resolves to the built-ins.
	const { doc: configDoc } = await loadGameConfigDocWithEtag(clientKey, projectKey);
	const gameModes = resolveGameModes(configDoc ?? undefined).map((mode) => ({
		id: mode.id,
		label: mode.label ?? mode.id,
	}));

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
		/** Author-named cues off the project’s spine AND flipbook nodes, so a `fireCue` node can
		 *  address a placed asset (see the harvest above). Composed client-side by `withSceneCues`. */
		sceneCues,
		containerEvents,
		/** ContainerId → whether that screen can complete itself (a tap-to-continue / completeOnLoaded
		 *  surface). Fed to `validateFlowDoc` so an unreleasable round-block hold is caught at authoring
		 *  time; a container absent from the map is unresolved and stays unchecked. */
		containerTaps,
		gameModes,
	};
};
