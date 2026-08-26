/**
 * Assemble a project's complete game-runtime bundle SERVER-SIDE — the live
 * equivalent of the build-time `scripts/bake-editor-doc.mjs` freeze, but with no
 * HTTP round-trips and no file write. It returns the SAME logical shape the game's
 * `apps/lines/src/editor-scenes.ts` consumes as its `BakedBundle` (doc +
 * componentDefs + componentDefaults + editorArt + fonts + localization + symbols),
 * so a prebuilt "generic engine runtime" can boot an arbitrary project from one
 * live fetch instead of a frozen per-game bundle.
 *
 * The bake script does this by calling the launcher's own HTTP endpoints
 * (`/api/editor/doc?components=1`, `/api/editor/export-{art,fonts,symbols}`,
 * `/api/localization/strings`). Those endpoints are all thin wrappers over
 * server-side functions, so this module calls those functions directly:
 *   - doc assembly mirrors `routes/api/editor/doc/+server.ts` (HUD name default +
 *     spine-key rewrite for the runtime + referenced ComponentDefs + per-project
 *     component defaults),
 *   - `exportEditorArt` / `exportEditorFonts` / `exportEditorSymbols` are run fresh
 *     so the `deploy/` indices reflect the current doc, then their returned indices
 *     are embedded,
 *   - localization mirrors `routes/api/localization/strings/+server.ts` (source
 *     strings + REVIEWED translations → per-locale message map).
 *
 * The asset path fields (`json`/`file`/`atlas`/`skeleton`) are RELATIVE to the
 * project's `deploy/` tree — the exact relative paths `GET /api/deploy?...&rel=<p>`
 * serves — so the runtime resolves each file as `assetBase + rel`. This module does
 * NOT build `assetBase`; the endpoint adds it from the request origin + token.
 */
import { type FlowDoc, isAuthoredFlow } from 'engine-flow';
import type { FlowDoc as FlowDocV2, FunctionLibraryDoc as FlowV2LibraryDoc } from 'engine-flow-v2';
import type { EffectDoc } from 'engine-fx';
import type { FlipbookClip } from 'engine-flipbook';
import {
	applyHudGameNameDefault,
	collectComponentIds,
	collectComponentPins,
	type ComponentDef,
	type FontCatalog,
	type SoundCatalog,
	type LayoutDoc,
	type RigFxBinding,
	type WinTextDoc,
} from 'engine-layout';
import { betModeCardIds, type GameConfigDoc } from 'game-config';
import { listComponentDefaults } from './componentDefaultsStorage';
import { loadComponent } from './componentStorage';
import { exportBootSplashes } from './bootSplashExport';
import { exportEditorArt, type EditorArtIndex } from './editorArtExport';
import { repairComponentDefsAtlasRefs } from './atlasRefRepair';
import { loadDoc as loadEditorDoc } from './editorStorage';
import { getGlobalLayoutProfile } from './layoutProfile';
import { pruneUnreachableEffects } from './effectReachability';
import { exportEditorFlow } from './flowExport';
import { exportEditorFlowV2 } from './flowV2Export';
import { cinematicRigNames, exportCinematics, loadAuthoredCinematics } from './cinematicExport';
import type { CinematicDoc } from './cinematicStorage';
import { exportEditorFonts } from './fontExport';
import { exportProjectSounds } from './soundExport';
import { exportEffects } from './effectExport';
import { exportClips } from './flipbookExport';
import { loadDoc as loadLocalizationDoc } from './localization';
import { UNASSIGNED_CLIENT } from './projectPaths';
import { projectClientKey, projectName } from './projects';
import { exportRigFx } from './rigFxExport';
import { loadGameConfigDoc } from './gameConfigStorage';
import { loadWinTextDoc } from './winTextStorage';
import { bundleFromAssetKey } from './spine';
import { exportEditorSymbols, type SymbolExportResult } from './symbolExport';

/**
 * The complete bundle the generic runtime boots from. Logically identical to the
 * `BakedBundle` in `apps/lines/src/editor-scenes.ts` (the canonical contract),
 * minus the `null`-doc placeholder case (a live bundle always has a real doc).
 * The endpoint serializes this and prepends `assetBase` for the asset path fields.
 */
export interface RuntimeBundle {
	doc: LayoutDoc;
	componentDefs: Record<string, ComponentDef>;
	/** Exact pinned non-latest defs (§8.9 v2). Registered before `componentDefs` so a
	 * pinned instance resolves its authored version; absent/empty for unpinned games. */
	componentVersions?: ComponentDef[];
	componentDefaults: Record<string, Record<string, unknown>>;
	editorArt: EditorArtIndex;
	fonts: { catalog: FontCatalog };
	/** The project's own sound library (Invisible Sound), turned into extra audio banks by
	 *  `bakedSoundBanks`. Always present, like `fonts`: an empty catalog yields no banks (parity). */
	sounds: { catalog: SoundCatalog };
	localization: { sourceLang: string; messages: Record<string, Record<string, string>> };
	symbols: SymbolExportResult;
	/** The authored presentation graph (Invisible Flow). Omitted unless the project
	 * authored a non-empty flow — absent ⇒ the interpreter is inert ⇒ coded path (§7). */
	flow?: FlowDoc;
	/** The authored Invisible Flow **v2** graph + shared library. Omitted unless the project
	 * authored a non-empty v2 flow — absent ⇒ v2 inert, v1/coded owns (parity). */
	flowV2?: FlowDocV2;
	flowV2Library?: FlowV2LibraryDoc;
	/** The authored Invisible Cinematic documents. Omitted unless the project authored one with at
	 * least one actor — absent ⇒ `bakedCinematics()` returns [] (parity). A cinematic carries no
	 * art of its own; the RIGS it casts ride the editor-art export via its `extraSpineNames` seed,
	 * because the static scene walk cannot see them. */
	cinematics?: CinematicDoc[];
	/** The authored Invisible FX effects (`invisible-fx.md` §8). Omitted unless the project
	 * authored ≥1 effect — absent ⇒ `bakedEffects()` returns [] (parity). Mirrors the offline
	 * bake (`scripts/bake-editor-doc.mjs`). */
	effects?: EffectDoc[];
	/** Rig-timeline direct FX bindings: a rig's own animation events → effects, keyed by the rig's
	 * runtime assetKey. Omitted unless a rig has ≥1 bound event — absent ⇒ `bakedRigFx()` returns {}
	 * (parity). Mirrors the offline bake (`scripts/bake-editor-doc.mjs`). */
	rigFx?: Record<string, RigFxBinding[]>;
	/** The authored Invisible Flipbook clips, the live twin of the offline bake's `flipbooks`
	 * (`bake-editor-doc.mjs`). Fed here so `resolveFlipbook(clipId)` resolves in authoring/runtime
	 * mode — without it a `flipbook` symbol cell registers nothing and renders its static fallback.
	 * A clip's sheets already ship via `editorArt` (the clip walk in `exportEditorArt`), so this is
	 * a pure-JSON add. Omitted when un-authored ⇒ `bakedFlipbooks()` returns [] (parity). */
	flipbooks?: FlipbookClip[];
	/** The authored win-text templates (Invisible Win Text). Pure config, no assets, so it is read
	 * straight from R2 with no export step — the live twin of the offline bake's
	 * `/api/win-text/doc` fetch. Omitted when un-authored ⇒ `bakedWinText()` yields the coded
	 * defaults (parity). See `docs/design/invisible-win-text.md`. */
	winText?: WinTextDoc;
	/** The project's AUTHORED game config (Invisible Game Config) — symbol dictionary + paytable,
	 * paylines, grid, bet modes, identity/RTP, cosmetic reel strips. Pure config, no assets, so it
	 * is read straight from R2 with no export step, like `winText`.
	 *
	 * Omitted when un-authored ⇒ `bakedGameConfig()` is undefined ⇒ the game runs its compiled
	 * `game/config.ts` (parity). Deliberately NOT seeded from the per-game-type template default
	 * here: the template default is what the TOOL opens with, so an author sees it and saves it
	 * knowingly. Shipping it implicitly would make "never authored" and "authored something
	 * identical to the template" indistinguishable in the bundle, and would silently start shipping
	 * a config the day a template changed. See `docs/design/invisible-game-config.md`. */
	config?: GameConfigDoc;
}

/**
 * Rewrite each spine node's `assetKey` from its R2 bundle-prefix down to the plain
 * bundle name the running game registers under — IDENTICAL to
 * `routes/api/editor/doc/+server.ts#resolveSpineKeysForGame`, so the doc this
 * module returns uses the SAME lookup keys the editor-doc endpoint would. Mutates
 * in place (the doc is freshly loaded per call).
 */
function rewriteSpineKeys(node: unknown, clientKey: string, projectKey: string): void {
	if (!node || typeof node !== 'object') return;
	const n = node as { kind?: string; assetKey?: unknown; children?: unknown };
	if (n.kind === 'spine' && typeof n.assetKey === 'string') {
		const bundle = bundleFromAssetKey(clientKey, projectKey, n.assetKey);
		if (bundle) n.assetKey = bundle;
	}
	if (Array.isArray(n.children))
		for (const c of n.children) rewriteSpineKeys(c, clientKey, projectKey);
}

function resolveSpineKeysForGame(doc: unknown, clientKey: string, projectKey: string): void {
	const scenes = (doc as { scenes?: unknown })?.scenes;
	if (Array.isArray(scenes)) {
		for (const scene of scenes) {
			const nodes = (scene as { nodes?: unknown })?.nodes;
			if (Array.isArray(nodes))
				for (const node of nodes) rewriteSpineKeys(node, clientKey, projectKey);
		}
	}
}

/**
 * The component defs a game registers carry their OWN spine nodes (a button's
 * `R_SpinButton`, a free-spin frame, …) — rewrite those `assetKey`s too, exactly as
 * {@link resolveSpineKeysForGame} does for the scene tree. Without this, `LayoutNodeView`
 * hands `<SpineProvider>` the full R2 bundle PREFIX while the game registered the bundle
 * under its bare NAME, so the lookup misses and the placed component's spine never loads.
 * Must mirror `routes/api/editor/doc/+server.ts`.
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
 * Resolve the transitive set of {@link ComponentDef}s a doc references — IDENTICAL
 * to `routes/api/editor/doc/+server.ts#resolveReferencedDefs`. Each id resolves
 * through the built-in → shared → project precedence (`loadComponent`), so a
 * project's EDITED def shadows the coded one. `versions` carries the EXACT pinned
 * non-latest defs (§8.9 v2) so a shipped game renders the authored version; empty
 * for every game with no non-latest pin (parity).
 *
 * `extraSeedIds` are component ids referenced from OUTSIDE the scene doc — the config-assigned
 * buy-feature card ids (`betModeCardIds`), which a bet mode names at RUNTIME, so the static scene
 * walk can't see them. Seeding them here folds each card def (and its nested defs) into the exported
 * set exactly like a scene component; a seed naming a non-existent def resolves to null and is
 * skipped (⇒ the mode falls back to the default `featureCard` at runtime — no broken bundle).
 */
async function resolveReferencedDefs(
	doc: LayoutDoc,
	projectKey: string,
	extraSeedIds: string[] = [],
): Promise<{ defs: Record<string, ComponentDef>; versions: ComponentDef[] }> {
	const defs: Record<string, ComponentDef> = {};
	const seen = new Set<string>();
	const queue = [
		...collectComponentIds(doc.scenes.flatMap((scene) => scene.nodes)),
		...extraSeedIds,
	];
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
		if (defs[pin.id]?.version === pin.version) continue;
		const pinned = await loadComponent(pin.id, projectKey, pin.version);
		if (pinned) versions.push(pinned);
	}
	return { defs, versions };
}

/**
 * The project's Localization-tool strings as a per-locale message map — matching
 * `routes/api/localization/strings/+server.ts`: the source language exports every
 * keyed entry; target languages export only REVIEWED translations.
 *
 * `includeUnreviewed` lifts that gate, and is passed ONLY on an authoring boot
 * (`ie_authoring=1`, a flag the launcher's own links carry and a published player
 * URL never does). That lets an author see machine output in the running game
 * before vetting it, while the published bundle — assembled without the flag, as
 * is the build-time bake in `bake-editor-doc.mjs` — still ships reviewed text only.
 */
async function loadLocalizationMessages(
	clientKey: string,
	projectKey: string,
	includeUnreviewed = false,
): Promise<{ sourceLang: string; messages: Record<string, Record<string, string>> }> {
	const doc = await loadLocalizationDoc(clientKey, projectKey);
	const messages: Record<string, Record<string, string>> = {};
	const sourceMap: Record<string, string> = {};
	for (const entry of doc.entries) {
		if (!entry.key) continue;
		if (entry.source) sourceMap[entry.key] = entry.source;
		for (const [lang, t] of Object.entries(entry.translations)) {
			if (!t.text || (!t.reviewed && !includeUnreviewed)) continue;
			(messages[lang] ??= {})[entry.key] = t.text;
		}
	}
	if (Object.keys(sourceMap).length > 0) {
		messages[doc.sourceLang] = { ...messages[doc.sourceLang], ...sourceMap };
	}
	return { sourceLang: doc.sourceLang, messages };
}

/**
 * Time one assembly step into `into`, so a slow/502-ing runtime boot can be pinned on the
 * exporter actually responsible instead of guessed at. Every step is measured — a total
 * without a breakdown is what made the 17-19s assemble opaque in the first place.
 */
async function step<T>(
	label: string,
	into: Record<string, number>,
	run: () => Promise<T>,
): Promise<T> {
	const t0 = Date.now();
	try {
		return await run();
	} finally {
		into[label] = Date.now() - t0;
	}
}

/** `a=120 b=90` — the per-step breakdown, slowest first (that's the one to fix). */
function formatTimings(timings: Record<string, number>): string {
	return Object.entries(timings)
		.sort(([, a], [, b]) => b - a)
		.map(([k, ms]) => `${k}=${ms}`)
		.join(' ');
}

/**
 * Build the full runtime bundle for a project. Runs the art/font/symbol exports
 * FRESH (so the `deploy/` indices match the current doc), then reads each returned
 * index. Reuse this from both this endpoint and a future server-side Publish so the
 * two never diverge.
 *
 * NOTE this is EXPENSIVE — seven exporters that list, re-serialize and write back to R2
 * (17-19s in production for a real project). Game boots must go through
 * `runtimeBundleCache.getRuntimeBundle`, which single-flights and briefly caches it;
 * calling this directly per-request is what made `/api/editor/runtime` 502 intermittently
 * and silently drop games onto stale baked data.
 *
 * @param projectKey  the BARE launcher project key (the client is DB-resolved),
 *                    matching `/api/editor/doc` — NOT `<client>/<project>`.
 */
export async function buildRuntimeBundle(
	projectKey: string,
	includeUnreviewed = false,
	out?: Record<string, number>,
): Promise<RuntimeBundle> {
	// The caller may supply the record so the per-step breakdown can leave this process — see the
	// `Server-Timing` header on `/api/editor/runtime`. Until it could, this data existed only in the
	// launcher's console, which is the wrong place for it: the whole point of the breakdown is to
	// find which exporter blew the budget, and the person debugging a slow boot is looking at a
	// browser, not at Railway.
	const timings: Record<string, number> = out ?? {};
	try {
		return await assembleRuntimeBundle(projectKey, timings, includeUnreviewed);
	} finally {
		// In a `finally` because the 502/slow case is the ONLY reason these timings exist — a
		// breakdown that only prints on success can't tell you which exporter blew the budget.
		// Steps that never started are simply absent from the line.
		console.info(`[runtime] assembled "${projectKey}" — ${formatTimings(timings)}`);
	}
}

async function assembleRuntimeBundle(
	projectKey: string,
	timings: Record<string, number>,
	includeUnreviewed = false,
): Promise<RuntimeBundle> {
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	// 1. Doc — same assembly as /api/editor/doc?components=1 (HUD name default +
	//    spine-key rewrite + referenced defs + per-project component defaults).
	const doc = await step('doc', timings, async () => {
		const loaded = (await loadEditorDoc(clientKey, projectKey)) as LayoutDoc;
		applyHudGameNameDefault(loaded, await projectName(projectKey));
		resolveSpineKeysForGame(loaded, clientKey, projectKey);
		// Bake the EFFECTIVE layout profile into the shipped doc: a project override (already
		// on the doc) wins; otherwise stamp the admin global default so a non-overriding game
		// still runs the pipeline's authored buckets without a runtime DB read. Absent global
		// default ⇒ no field added ⇒ the runtime uses the coded DEFAULT_LAYOUT_PROFILE (parity).
		if (!loaded.layoutProfile) {
			const globalDefault = await getGlobalLayoutProfile();
			if (globalDefault) loaded.layoutProfile = globalDefault;
		}
		return loaded;
	});
	// The game config is loaded up front (not just in the asset Promise.all below) because the
	// component-def resolution needs its config-assigned card ids: a bet mode names its buy-feature
	// card at RUNTIME, so the def must be folded into the exported set here or it never ships (the
	// static scene walk can't see a runtime-chosen id). `loadGameConfigDoc` returns null for a
	// never-authored project ⇒ no card ids ⇒ byte-identical to before (parity).
	const [componentDefaults, gameConfig] = await Promise.all([
		step('componentDefaults', timings, () => listComponentDefaults(projectKey)),
		step('gameConfig', timings, () => loadGameConfigDoc(clientKey, projectKey)),
	]);
	const cardComponentIds = gameConfig ? betModeCardIds(gameConfig) : [];
	const { defs: componentDefs, versions: componentVersions } = await step(
		'componentDefs',
		timings,
		() => resolveReferencedDefs(doc, projectKey, cardComponentIds),
	);
	// A placed component's OWN spine nodes need the same prefix→bundle-name rewrite as the
	// scene tree, or their spines never load in the built game (key mismatch).
	resolveSpineKeysForComponentDefs(
		{ defs: componentDefs, versions: componentVersions },
		clientKey,
		projectKey,
	);
	// The atlas-ref twin of that rewrite: `loadComponent` has no client key, so a def's own sprite
	// nodes and `image`-param defaults are repaired here, where the doc's already were in `loadDoc`.
	await repairComponentDefsAtlasRefs(
		[...Object.values(componentDefs), ...componentVersions],
		clientKey,
		projectKey,
	);

	// 2. Assets — run each exporter fresh so deploy/ mirrors the current doc, then
	//    embed the returned indices (paths are deploy-relative; the endpoint prefixes
	//    them with assetBase). Localization is read straight from R2 (no export step).
	//    FX (effects + rigFx) run alongside — the live twin of the offline bake in
	//    `scripts/bake-editor-doc.mjs`, which POSTs /api/editor/export-effects to embed both.
	// `gameConfig` is already loaded above (its card ids seed the component-def resolution). It stays
	// `loadGameConfigDoc` (not `resolveGameConfigDoc`): null for a never-authored project, and null
	// must stay null so the bundle omits `config` and the game runs its compiled template. See the
	// `config` field's note on the bundle type.
	const [
		{ editorArt, fonts, sounds, symbols, flow, flowV2, flowV2Library, cinematics },
		localization,
		effectIndex,
		rigFx,
		clipIndex,
		winTextDoc,
	] = await Promise.all([
		ensureDeployExports(projectKey, clientKey, timings),
		step('localization', timings, () =>
			loadLocalizationMessages(clientKey, projectKey, includeUnreviewed),
		),
		step('effects', timings, () => exportEffects(clientKey, projectKey)),
		step('rigFx', timings, () => exportRigFx(clientKey, projectKey)),
		step('flipbooks', timings, () => exportClips(clientKey, projectKey)),
		step('winText', timings, () => loadWinTextDoc(clientKey, projectKey)),
	]);
	// Only ship a doc that authors something: `loadWinTextDoc` returns `{version:1}` for a
	// never-authored project, which would otherwise add a no-op key to the bundle. Mirrors the
	// offline bake's `authored` check so the two paths agree.
	const winText = Object.keys(winTextDoc).some((k) => k !== 'version' && k !== 'updatedAt')
		? winTextDoc
		: undefined;
	// A Book-symbol VFX layer of kind 'fx' references an effect by `effectId` — a reachability source
	// this module's scene/rig/event walk can't see, so collect those ids and hand them to the pruner as
	// `extraReachable` or a book-symbol effect that isn't ALSO placed/rig-bound/event-triggered would be
	// stripped from the runtime bundle. Keep in sync with the bake path's inline keep-set in
	// `scripts/bake-editor-doc.mjs`.
	const bookVfxEffectIds = new Set<string>();
	for (const slot of ['background', 'foreground'] as const) {
		const layer = symbols.bookVfx?.[slot];
		if (layer?.kind === 'fx' && layer.effectId) bookVfxEffectIds.add(layer.effectId);
	}
	// Ship only REACHABLE effects (placed / rig-bound / event-triggered / book-VFX-referenced) — an
	// orphan/scratch effect that nothing mounts must not reach the game (it would otherwise ride the
	// bundle dead weight). The editor still reads ALL effects straight from R2, so authors keep managing
	// orphans in the FX tool; only this embedded list is pruned. Matches `components/Effects.svelte`'s
	// render-time `isEventReachable` guardrail, and must stay in sync with `scripts/bake-editor-doc.mjs`.
	const { effects: reachableEffects, prunedIds } = pruneUnreachableEffects(
		effectIndex.effects,
		doc.scenes,
		[...Object.values(componentDefs), ...componentVersions],
		rigFx,
		bookVfxEffectIds,
	);
	if (prunedIds.length) {
		console.info(
			`[runtime] pruned ${prunedIds.length} unreachable effect(s): [${prunedIds.join(', ')}]`,
		);
	}
	const effects = reachableEffects;

	return {
		doc,
		componentDefs,
		// Omit when empty so an unpinned project's bundle stays byte-identical (parity).
		...(componentVersions.length ? { componentVersions } : {}),
		componentDefaults,
		editorArt,
		fonts: { catalog: fonts.catalog },
		sounds: { catalog: sounds.catalog },
		localization,
		symbols,
		// Omit an un-authored flow so the runtime interpreter stays inert (parity, §7).
		...(flow ? { flow } : {}),
		// Invisible Flow v2 — omit when un-authored so v2 stays inert and v1/coded owns (parity).
		...(flowV2 ? { flowV2 } : {}),
		...(flowV2 && flowV2Library ? { flowV2Library } : {}),
		// Invisible Cinematic — omit when none are authored so a cinematic-less project's bundle
		// stays byte-identical and `bakedCinematics()` returns [] (parity).
		...(cinematics && cinematics.length ? { cinematics } : {}),
		// Invisible FX — omit when empty so a no-FX project stays byte-identical, exactly as the
		// offline bake does (`bake-editor-doc.mjs` ~575/579): absent ⇒ bakedEffects()/bakedRigFx() [].
		...(effects.length ? { effects } : {}),
		...(Object.keys(rigFx).length ? { rigFx } : {}),
		// Invisible Flipbook — omit when no clips so a no-clip project stays byte-identical and
		// `bakedFlipbooks()` returns [] (parity). Unlike effects, clips are NOT reachability-pruned
		// (no consumer walk exists yet — see the exporter header); a clip is a name list, negligible.
		...(clipIndex.clips.length ? { flipbooks: clipIndex.clips } : {}),
		// Invisible Win Text — omit when un-authored so the bundle stays byte-identical and
		// `bakedWinText()` falls back to the coded defaults (parity), exactly as the offline bake does.
		...(winText ? { winText } : {}),
		// Invisible Game Config — omit when un-authored so the bundle stays byte-identical and the
		// game keeps running its compiled `game/config.ts` (parity).
		...(gameConfig ? { config: gameConfig } : {}),
	};
}

/**
 * Run the art / fonts / symbols exporters FRESH so the project's R2 `deploy/` tree
 * mirrors the current doc, and return their indices. Shared by {@link buildRuntimeBundle}
 * (the live runtime boot) and the server-side Publish (`publishGame.ts`) so a publish
 * and a live fetch see the SAME exported assets — there is exactly one export path.
 *
 * @param clientKey  optional; DB-resolved from the project when omitted.
 * @param timings    optional per-step collector (see `buildRuntimeBundle`); Publish passes
 *                   nothing and just gets the exports.
 */
export async function ensureDeployExports(
	projectKey: string,
	clientKey?: string,
	timings: Record<string, number> = {},
): Promise<{
	editorArt: EditorArtIndex;
	fonts: { catalog: FontCatalog };
	sounds: { catalog: SoundCatalog };
	symbols: SymbolExportResult;
	/** The exported FlowDoc, or undefined when the project authored no flow (parity). */
	flow?: FlowDoc;
	/** The exported v2 FlowDoc + shared library, or undefined when no v2 flow is authored. */
	flowV2?: FlowDocV2;
	flowV2Library?: FlowV2LibraryDoc;
	/** The exported cinematics, or undefined when the project authored none (parity). */
	cinematics?: CinematicDoc[];
}> {
	const client = clientKey ?? (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	// Cinematics load BEFORE the batch, not inside it: the editor-art export needs the rig bundle
	// names they cast as a seed, or a cinematic ships as a doc whose rigs the game never loaded.
	const cinematicDocs = await step('cinematics:load', timings, () =>
		loadAuthoredCinematics(client, projectKey),
	);
	const extraSpineNames = cinematicRigNames(cinematicDocs);
	const [editorArt, fontIndex, soundIndex, symbols, flowIndex, flowV2Index, cinematicIndex] =
		await Promise.all([
			// `timings` goes in too: `art` dominates the assemble, and the per-PHASE breakdown it folds
			// back in (`art:manifests` / `art:images` / `art:spines` / `art:prune:list`) is what says
			// which loop to attack.
			step('art', timings, () => exportEditorArt(client, projectKey, { extraSpineNames, timings })),
			step('fonts', timings, () => exportEditorFonts(client, projectKey)),
			step('sounds', timings, () => exportProjectSounds(client, projectKey)),
			step('symbols', timings, () => exportEditorSymbols(client, projectKey)),
			step('flow', timings, () => exportEditorFlow(client, projectKey)),
			step('flowV2', timings, () => exportEditorFlowV2(client, projectKey)),
			step('cinematics', timings, () => exportCinematics(client, projectKey, cinematicDocs)),
			// Boot splashes are a SIDE EFFECT here, not part of the bundle: the splash paints
			// before this bundle is fetched, so it reads `deploy/_boot/boot.json` directly. It
			// rides this export because that is the one path both Publish and the live assemble
			// share — the same reason everything else in this list is here.
			step('bootSplash', timings, () => exportBootSplashes(client, projectKey)),
		]);
	// Forward an authored flow only — an un-authored doc stays undefined so the runtime
	// interpreter is inert and the game runs its coded path (parity, §7). `isAuthoredFlow`
	// is the SAME gate the interpreter's `isActive` uses, so the baked slot and the runtime
	// never diverge (a transitions-only doc is inert ⇒ not baked). v2 mirrors this: the export
	// already gates on an authored graph, so `flowV2Index` is undefined for an un-authored v2 doc.
	return {
		editorArt,
		fonts: { catalog: fontIndex.catalog },
		sounds: { catalog: soundIndex.catalog },
		symbols,
		...(isAuthoredFlow(flowIndex.flow) ? { flow: flowIndex.flow } : {}),
		...(flowV2Index.flowV2 ? { flowV2: flowV2Index.flowV2 } : {}),
		...(flowV2Index.flowV2Library ? { flowV2Library: flowV2Index.flowV2Library } : {}),
		...(cinematicIndex.cinematics ? { cinematics: cinematicIndex.cinematics } : {}),
	};
}
