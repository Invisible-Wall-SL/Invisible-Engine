import { error, redirect } from '@sveltejs/kit';
import { resolveEmitterVocabulary } from '$lib/emitterVocabularies';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE } from '$lib/server/auth';
import { loadDoc } from '$lib/server/editorStorage';
import { loadFlowV2Doc } from '$lib/server/flowV2Storage';
import { loadRegionSet } from '$lib/server/editorRegions';
import { listEffects, loadEffect, type FxEffectRow, type FxMeta } from '$lib/server/fxStorage';
import { SUB } from '$lib/server/projectPaths';
import { listObjects } from '$lib/server/r2';
import { resolveToolScope } from '$lib/server/toolScope';
import type { EffectDoc } from 'engine-fx';
import type { PageServerLoad } from './$types';

/**
 * Invisible FX — `/fx` (Phase 1, emitter-core authoring shell).
 *
 * The stage mounts its OWN WebGL `PIXI.Application` + a live `@barvynkoa/particle-emitter`
 * `Emitter` (touches `window`/canvas); SSR is pointless and fragile, the same call the
 * Scene Editor + Flow make. `load` still runs server-side: it streams the project's atlas
 * list (for the region picker), the saved-effect list (for the picker), and — when
 * `?effect=<id>` is present — the opened EffectDoc + its editor-only sidecar.
 */
export const ssr = false;

interface FxAtlas {
	/** Manifest R2 key — the value a layer keeps as `art.assetKey`. */
	manifestKey: string;
	label: string;
	regions: string[];
}

/**
 * Loader: auth + `fx`-scope gate (Invisible FX is now a registered tool — `roles.ts`), then
 * REUSE the launcher's atlas listing (`loadRegionSet` over the project's `manifests/*.json`
 * — the exact pattern the Rigger's `/api/rigger/atlases` uses) so the region picker can drive
 * a layer's `art.assetKey` + `art.frames`. The page reads regions + the page image through
 * the existing `/api/editor/regions` + `/api/editor/asset` (now `fx`-or-`editor` gated). The
 * saved-effect index + the optionally-opened effect come from `fxStorage` (the `/api/fx/save`
 * sibling read path).
 */
export const load: PageServerLoad = async ({ locals, cookies, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!roleHasTool(locals.user.role, 'fx')) {
		throw error(403, 'Your role does not have access to Invisible FX.');
	}
	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});

	const basename = (k: string): string => {
		const i = k.lastIndexOf('/');
		return i === -1 ? k : k.slice(i + 1);
	};

	const manifestsPrefix = `${SUB.manifests(clientKey, projectKey)}/`;
	const listed = await listObjects(manifestsPrefix, 500);
	const manifestKeys = listed.keys.filter((k) => k.toLowerCase().endsWith('.json'));

	const atlases: FxAtlas[] = [];
	for (const manifestKey of manifestKeys) {
		const rs = await loadRegionSet(manifestKey, clientKey, projectKey);
		if (!rs.regions.length || !rs.pageKey) continue; // unusable (no regions or no page)
		atlases.push({
			manifestKey,
			label: basename(manifestKey)
				.replace(/^atlas_manifest_/, '')
				.replace(/\.json$/i, ''),
			regions: rs.regions.map((r) => r.name),
		});
	}
	atlases.sort((a, b) => a.label.localeCompare(b.label));

	// Saved-effect index (for the picker) + the optionally-opened effect.
	const effects: FxEffectRow[] = await listEffects(clientKey, projectKey);
	const openId = url.searchParams.get('effect')?.trim() ?? '';
	let openedDoc: EffectDoc | null = null;
	let openedMeta: FxMeta | null = null;
	if (openId) {
		const { doc, meta } = await loadEffect(clientKey, projectKey, openId);
		openedDoc = doc;
		openedMeta = meta;
	}

	// The trigger picker's suggestions are the SHARED name vocabulary a layer's `trigger.eventType`
	// must match for a Flow to fire it (the FX⇄Flow seam — the layer fires when a broadcast of this
	// exact name hits the event bus). Two real, per-project sources, unioned + deduped:
	//   1. The game's EXPORTED emitter vocabulary (`emitterVocabularies.ts`, codegen'd from
	//      `typesEmitterEvent.ts`, keyed by the LayoutDoc `gameType`) — the SAME names Flow v1's
	//      Broadcast node offers. Unknown/absent game ⇒ `DEFAULT_EMITTER_VOCABULARY`.
	//   2. The cue names the project's Flow **v2** graph actually broadcasts — every `fireCue` node's
	//      `ref` in the saved v2 FlowDoc. (The v2 template VOCABULARY isn't project-loaded yet, so we
	//      source the cues the flow really uses instead.) Best-effort: no v2 doc ⇒ none.
	// The picker is a combobox, so these are SUGGESTIONS — an author can still type any custom cue.
	const layout = await loadDoc(clientKey, projectKey);
	const vocab = resolveEmitterVocabulary(layout.gameType);
	const flowV2 = await loadFlowV2Doc(clientKey, projectKey).catch(() => null);
	const v2Cues: string[] = [];
	for (const node of flowV2?.graph?.nodes ?? []) {
		if (node.kind === 'fireCue' && typeof node.ref === 'string' && node.ref) v2Cues.push(node.ref);
	}
	const eventTypes = Array.from(
		new Set([...vocab.events.map((e) => e.type), ...v2Cues]),
	).sort((a, b) => a.localeCompare(b));

	return { clientKey, projectKey, tools, atlases, effects, openedDoc, openedMeta, eventTypes };
};
