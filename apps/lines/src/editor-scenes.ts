import type { EffectDoc } from 'engine-fx';
import type { ComponentDef, FontCatalog, LayoutDoc } from 'engine-layout';
import {
	editorArtNamespace,
	registerComponentDefaults,
	registerComponents,
	registerTextResolver,
} from 'engine-layout';
import { stateI18nDerived, stateUrlDerived } from 'state-shared';
import type { MessagesMap } from 'utils-shared/i18n';

import bakedBundleJson from './baked-editor-bundle.json';
import { defaultLayout } from './game/defaultLayout';
import {
	HUD_BUTTON_INSTANCES,
	TRANSITION_INSTANCE,
	FREE_SPIN_OVERLAY_INSTANCES,
} from './game/editorFlags';
import type { SymbolInfoMap } from './game/types';

/**
 * Build-time freeze (see docs/design/live-assets.md → "Layout-doc bake").
 * `bake-editor-doc.mjs` overwrites `baked-editor-bundle.json` with the frozen doc + the
 * referenced ComponentDefs. A non-null `doc` flips the game to the baked path:
 * the layout + custom component defs come from the bundle (no `/api/editor/doc`
 * fetch, no launcher dependency). The checked-in placeholder has `doc: null`, so
 * an un-baked repo (incl. `apps/lines` dev) keeps fetching live — byte-identical.
 */
type BakedBundle = {
	doc: LayoutDoc | null;
	componentDefaults?: Record<string, Record<string, unknown>>;
	componentDefs?: Record<string, ComponentDef>;
	/** Exact pinned NON-LATEST ComponentDefs (§8.9 v2 multi-version store). Registered
	 * BEFORE `componentDefs` so a `componentInstance` that pins an older version resolves
	 * the precise def it was authored against while latest still wins for unpinned ones.
	 * Absent/empty for every game with no non-latest pin — bundle byte-identical (parity). */
	componentVersions?: ComponentDef[];
	/** Art exported from the doc's references (`deploy/editor-art/`), mirrored
	 * into `static/assets/` by the deploy pull. `json`/`file` are relative to
	 * `static/assets/`. `images[].key` is the sprite node's full `assetKey`. */
	editorArt?: {
		sheets: { key: string; json: string }[];
		images: { key: string; file: string }[];
		/** Spine bundles editor-placed `spine` nodes reference (atlas + skeleton +
		 * shared page). `key` is the node's full `assetKey` (the engine's lookup key);
		 * `scale` defaults to 2. */
		spines?: { key: string; atlas: string; skeleton: string; scale?: number }[];
	};
	/** Fonts (Font Maker output) the project uses, exported to `deploy/editor-fonts/`
	 * and mirrored into `static/assets/` by the deploy pull. The catalog's `prefix`
	 * is that subtree (`editor-fonts`); each entry keeps its `folder` + file names,
	 * so a bitmap descriptor's relative page refs resolve. Registered at boot so
	 * editor-authored fonts reach the shipped game. */
	fonts?: { catalog: FontCatalog };
	/** Localization-tool strings (source text + REVIEWED translations) in Lingui
	 * message-map shape — merged into the game catalog so editor-authored
	 * localization keys resolve in the shipped game. */
	localization?: {
		sourceLang: string;
		messages: Record<string, Record<string, string>>;
	};
	/** Invisible FX effect index (`invisible-fx.md` §4.4/§8). The pure `EffectDoc`s authored in
	 * `/fx`, exported to `deploy/effects/` and frozen into the bundle by `bake-editor-doc.mjs`.
	 * Each plays via `<EffectPlayer doc=…>`; its `art.assetKey` references an atlas that ALREADY
	 * travels the pipeline (FX never re-packs textures). Absent/empty for every game with no
	 * effects (parity) — the export→bake→pull half is a LATER Phase-4 increment, so this stays
	 * unpopulated for now and `bakedEffects()` returns `[]`. */
	effects?: EffectDoc[];
	/** Symbol→state asset bindings (Invisible Symbols State Machine output) + the index
	 * of any sprite sheets / images / spine bundles those bindings introduce, exported to
	 * `deploy/editor-symbols/` and mirrored into `static/assets/` by the deploy pull. The
	 * `map` is merged over the coded `SYMBOL_INFO_MAP` at first render (`game/symbolMap.ts`);
	 * the `index` registers the new assets at `createApp`. See
	 * docs/design/invisible-symbols-state-machine.md. */
	symbols?: {
		map: SymbolInfoMap;
		index: {
			/** Sprite sheets. `key` is the source manifest (kept for the exporter); the
			 * sheet's frames register under their own names — symbol bindings reference
			 * those plain frame keys (e.g. `h1.webp`). */
			sheets: { key: string; json: string }[];
			/** Standalone images, registered under the binding's full `assetKey`. */
			images: { key: string; file: string }[];
			/** Spine bundles (atlas + skeleton, shared page on disk). `key` is the
			 * binding's `assetKey`; `scale` defaults to 2 (the symbols convention). */
			spines: { key: string; atlas: string; skeleton: string; scale?: number }[];
		};
		/** Single GLOBAL win-highlight frame (Invisible Symbols State Machine output). `assetKey`
		 * is the engine spine-asset key the bundle registers — the highlight spine bundle is
		 * exported to `deploy/editor-symbols/` and registered via `index.spines` exactly like the
		 * per-symbol spine cells, so it is already loadable under its `assetKey`. Absent →
		 * `SymbolSpine.svelte` keeps the coded `anticipation`/`payframe` frame. */
		highlight?: { assetKey: string; animationName: string };
		/** Global win-line overlay config (Invisible Symbols State Machine output): on/off
		 * plus line + win-amount-text style. Pure config, no asset (the chosen `text.font`
		 * travels via the font pipeline). Sparse — every field falls through to the game's
		 * coded defaults. `apps/lines` has no win-line renderer (it uses a symbol-glow win
		 * model), so this type documents the shared contract; Book of Borut consumes it. */
		winLine?: {
			enabled?: boolean;
			line?: {
				color?: string;
				width?: number;
				glow?: boolean;
				glowColor?: string;
				animated?: boolean;
				speed?: number;
			};
			text?: { font?: string; size?: number; color?: string };
		};
	};
};
const bakedBundle = bakedBundleJson as unknown as BakedBundle;

/**
 * Live-runtime bundle (Invisible Game Maker, Phase 0). OPT-IN via `?runtime=1`: a
 * prebuilt generic engine bundle boots an arbitrary project by fetching ONE payload
 * from the launcher (`GET /api/editor/runtime`) — the same logical shape as
 * {@link BakedBundle} PLUS an `assetBase` (the absolute `/api/deploy?…&rel=` prefix
 * the runtime prepends to every deploy-relative asset path). When the param is
 * absent this stays `null` and EVERY function below is byte-identical to today
 * (baked-doc games and `apps/lines` live `/api/editor/doc` dev are untouched).
 */
type RuntimeBundle = BakedBundle & { assetBase: string };
let runtimeBundle: RuntimeBundle | null = null;

/** True only when `?runtime=1` is in the game URL — the single opt-in gate. Absent
 * (or server-side) ⇒ false ⇒ the runtime path is entirely inert (strict parity). */
function runtimeModeEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	return new URLSearchParams(window.location.search).get('runtime') === '1';
}

/** True once a runtime bundle has been fetched + accepted. Drives every asset/doc
 * function below to read from the live bundle instead of the baked json. Never true
 * unless `?runtime=1` AND the fetch succeeded — so off-mode is unaffected. */
function hasRuntimeBundle(): boolean {
	return runtimeBundle !== null;
}

/** Public form of {@link hasRuntimeBundle} for the boot path — true only after a
 * successful runtime fetch, so the game knows to re-merge the live asset entries
 * into `stateApp.assets` (which `createApp` built at import, before the fetch). */
export function isRuntimeBundleActive(): boolean {
	return hasRuntimeBundle();
}

/** Asset URL prefix: the launcher's absolute `/api/deploy?…&rel=` base in runtime
 * mode (so cross-origin deploy files resolve), else the page-relative `assets/`
 * (the deploy mirror) used by the baked path. Keeps every registration KEY identical
 * across the two modes — only the resolved `src` URL differs. */
function srcBase(): string {
	return hasRuntimeBundle() ? runtimeBundle!.assetBase : 'assets/';
}

function hasBakedDoc(): boolean {
	const doc = bakedBundle.doc;
	return !!(doc && Array.isArray(doc.scenes) && doc.scenes.length > 0);
}

/**
 * Register the baked component defs + per-project param defaults (no-op when not
 * baked). Call at boot BEFORE the doc renders, AFTER the game's built-in
 * `registerComponents(...)`, so a baked/edited def (e.g. a customized `button`
 * with an extra background node) shadows the coded built-in.
 */
export function registerBakedComponents(): void {
	const source = hasRuntimeBundle() ? runtimeBundle! : hasBakedDoc() ? bakedBundle : null;
	if (!source) return;
	// Pinned non-latest versions FIRST (§8.9 v2): each is retained in the registry's
	// per-version map so a pinned instance resolves it, then `componentDefs` sets the
	// id's `latest` last so unpinned instances follow latest. Register one at a time so
	// two pins of the SAME id at DIFFERENT versions are both retained (a single map keyed
	// by id would collapse them). Empty/absent for unpinned games ⇒ no-op ⇒ byte-identical
	// to before history existed (parity).
	for (const def of source.componentVersions ?? []) {
		registerComponents({ [def.id]: def });
	}
	if (source.componentDefs) registerComponents(source.componentDefs);
	if (source.componentDefaults) registerComponentDefaults(source.componentDefaults);
}

/**
 * Asset entries for the spritesheets the baked doc's art references (exported to
 * `deploy/editor-art/` at bake time, mirrored into `static/assets/` by the
 * deploy pull). Spread into the game's `assets` record at `createApp` so every
 * editor-placed sprite/image resolves WITHOUT a manual `assets.ts` entry — the
 * sheet frames are keyed by the editor's region names, exactly what
 * `LayoutNodeView` looks up. Empty when un-baked (dev keeps its own assets).
 * The src is page-relative (`assets/…`), matching how the static dir is served.
 */
type EditorArtAssetEntry =
	| { type: 'sprites' | 'sprite'; src: string; preload: boolean; namespace?: string }
	| { type: 'spine'; src: { atlas: string; skeleton: string; scale: number }; preload: boolean };

export function bakedEditorArtAssets(): Record<string, EditorArtAssetEntry> {
	const out: Record<string, EditorArtAssetEntry> = {};
	// In runtime mode the live bundle supplies the same `editorArt` index; the only
	// difference is the `src` URL prefix (`srcBase()`). Registration keys + namespaces
	// stay identical so `LayoutNodeView` lookups resolve in both modes.
	const source = hasRuntimeBundle() ? runtimeBundle! : hasBakedDoc() ? bakedBundle : null;
	if (!source) return out;
	const base = srcBase();
	for (const sheet of source.editorArt?.sheets ?? []) {
		// Scope each sheet's frames by its manifest key (the value sprite nodes store
		// as `assetKey`) so two sheets that reuse a region name don't collide in the
		// flat loadedAssets map. `LayoutNodeView` resolves the matching scoped key.
		out[`editorArt/${sheet.json}`] = {
			type: 'sprites',
			src: `${base}${sheet.json}`,
			preload: true,
			namespace: editorArtNamespace(sheet.key),
		};
	}
	// Standalone images register under the sprite node's full assetKey — that IS
	// the engine's lookup key for a region-less sprite node.
	for (const image of source.editorArt?.images ?? []) {
		out[image.key] = { type: 'sprite', src: `${base}${image.file}`, preload: true };
	}
	// Spine bundles register under the spine node's full assetKey — the value
	// `LayoutNodeView` passes to `<SpineProvider key=…>`.
	for (const spine of source.editorArt?.spines ?? []) {
		out[spine.key] = {
			type: 'spine',
			src: {
				atlas: `${base}${spine.atlas}`,
				skeleton: `${base}${spine.skeleton}`,
				scale: spine.scale ?? 2,
			},
			preload: true,
		};
	}
	return out;
}

/**
 * The Invisible FX effects authored for this project (`invisible-fx.md` §4.4). Each `EffectDoc`
 * is played by `<EffectPlayer doc=…>`; its layers reduce to `<ParticleEmitter>` (art bound from
 * `art.assetKey` via the shared `engine-fx` `bindArt`), wrapped in `<SpineBoneAttach>` for a
 * `bone`-placed layer against the HOST game's playing rig. Mirrors `bakedEditorArtAssets`'s
 * runtime→baked→empty resolution. Empty when un-baked / no effects (dev parity) — the
 * export→`deploy/effects/`→bake→pull half is a LATER Phase-4 increment, so this returns `[]`
 * until that lands. A consuming game iterates these and mounts an `<EffectPlayer>` per effect
 * (inside the relevant `<SpineProvider>` when a layer is bone-placed).
 */
export function bakedEffects(): EffectDoc[] {
	const source = hasRuntimeBundle() ? runtimeBundle! : hasBakedDoc() ? bakedBundle : null;
	if (!source) return [];
	return source.effects ?? [];
}

/**
 * The baked symbol→state binding overrides (Invisible Symbols State Machine). Merged over
 * the coded `SYMBOL_INFO_MAP` in `game/symbolMap.ts`. Undefined when un-baked → the game
 * keeps the coded map byte-for-byte (dev parity).
 */
export function bakedSymbolMap(): SymbolInfoMap | undefined {
	if (hasRuntimeBundle()) return runtimeBundle!.symbols?.map;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.symbols?.map;
}

/**
 * The GLOBAL win-highlight frame authored in the Invisible Symbols State Machine. When set,
 * `SymbolSpine.svelte` draws this spine/animation for the win frame instead of the coded
 * `anticipation`/`payframe`. Its spine bundle rides `symbols.index.spines` (registered like a
 * per-symbol spine cell), so the `assetKey` is already loadable. Mirrors `bakedSymbolMap`'s
 * runtime→baked→undefined resolution; undefined → the coded default frame.
 */
export function bakedHighlight(): { assetKey: string; animationName: string } | undefined {
	if (hasRuntimeBundle()) return runtimeBundle!.symbols?.highlight;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.symbols?.highlight;
}

type SymbolAssetEntry =
	| { type: 'sprites' | 'sprite'; src: string; preload: boolean }
	| { type: 'spine'; src: { atlas: string; skeleton: string; scale: number }; preload: boolean };

/**
 * Asset entries for any sprite sheet / image / spine bundle a baked symbol binding
 * introduces (exported to `deploy/editor-symbols/`, mirrored into `static/assets/` by the
 * deploy pull). Spread into `createApp({assets})` beside `bakedEditorArtAssets()` so a
 * rebound symbol resolves WITHOUT a manual `assets.ts` entry. The src is page-relative
 * (`assets/…`), matching how the static dir is served. Empty when un-baked (dev parity).
 *
 * Symbol sprite sheets register their frames under the sheet's OWN frame names (NOT
 * namespaced like editor-art), because a symbol binding's `assetKey` is the plain frame
 * key (e.g. `h1.webp`) that `SymbolSprite` looks up directly. The exporter therefore must
 * keep symbol frame keys unique across the project's bound sheets.
 */
export function bakedSymbolAssets(): Record<string, SymbolAssetEntry> {
	const out: Record<string, SymbolAssetEntry> = {};
	const source = hasRuntimeBundle() ? runtimeBundle! : hasBakedDoc() ? bakedBundle : null;
	if (!source) return out;
	const index = source.symbols?.index;
	if (!index) return out;
	const base = srcBase();
	for (const sheet of index.sheets ?? []) {
		out[`editorSymbols/${sheet.json}`] = {
			type: 'sprites',
			src: `${base}${sheet.json}`,
			preload: true,
		};
	}
	for (const image of index.images ?? []) {
		out[image.key] = { type: 'sprite', src: `${base}${image.file}`, preload: true };
	}
	for (const spine of index.spines ?? []) {
		out[spine.key] = {
			type: 'spine',
			src: {
				atlas: `${base}${spine.atlas}`,
				skeleton: `${base}${spine.skeleton}`,
				scale: spine.scale ?? 2,
			},
			preload: true,
		};
	}
	return out;
}

/**
 * The baked project font catalog (Font Maker output, frozen into the bundle by
 * `bake-editor-doc.mjs`). Undefined when un-baked (dev) → the game keeps only its
 * hardcoded built-in fonts. Feed it to the engine's shared `bakedFontAssets` /
 * `mergeBakedFontCatalog` / `registerBakedWebFonts` (the runtime half lives in
 * `engine-layout` so every game shares one implementation).
 */
export function bakedFontCatalog(): FontCatalog | undefined {
	if (hasRuntimeBundle()) return runtimeBundle!.fonts?.catalog;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.fonts?.catalog;
}

/**
 * The baked Localization-tool strings as a per-locale messages map, merged into
 * the game's Lingui catalog (LAST, so a project's reviewed strings override a
 * code catalog on key clash). Empty when un-baked / nothing localized — parity.
 */
export function bakedLocalizationMessagesMap(): MessagesMap {
	if (hasRuntimeBundle()) return (runtimeBundle!.localization?.messages ?? {}) as MessagesMap;
	return (bakedBundle.localization?.messages ?? {}) as MessagesMap;
}

/**
 * Register the engine's text-localization resolver (§18): any layout-doc text —
 * a text node's literal or a `textBox`'s `text` param — that matches a key in
 * the game's merged catalog renders its translation for the active language;
 * unknown strings render verbatim. Call once at boot with the SAME merged
 * `messagesMap` the game feeds `<LoadI18n>`, so the editor and code share one
 * catalog (including the baked Localization-tool strings merged above).
 */
export function registerEditorTextLocalization(messagesMap: MessagesMap): void {
	registerTextResolver((key) => {
		const lang = stateUrlDerived.lang();
		const catalog = (messagesMap[lang] ?? messagesMap['en' as keyof MessagesMap] ?? {}) as Record<
			string,
			unknown
		>;
		if (!(key in catalog)) return undefined;
		return stateI18nDerived.translate(key);
	});
}

/**
 * Offline fallback / checked-in stand-in for the editor document the Invisible
 * Editor would write to R2 at `editor/lines/<project>/scenes.json` (see
 * `apps/launcher-api/src/lib/server/projectPaths.ts#editorDocKey`). It is now
 * produced by the template-shaped generator `defaultLayout('lines')` rather
 * than a hand-written literal — the engine-truth "import" of the current
 * basegame (`docs/design/invisible-editor.md` §7.2) — so it round-trips cleanly
 * through `normalizeDoc` and stays in lock-step with `BoardFrame.svelte`.
 *
 * The animated reelhouse glow spine stays coded in `BoardFrame.svelte` (animated
 * loops are out of editor v1 scope, design doc §3). The `basegame` scene draws
 * INSIDE `<MainContainer>`; `basegameOverlays` (the coded `Win` / `Transition`
 * `mount` slots) draws OUTSIDE it, since those components self-position in
 * canvas coords.
 */
export const fallbackEditorScenes: LayoutDoc = defaultLayout('lines', {
	buttons: HUD_BUTTON_INSTANCES,
	transition: TRANSITION_INSTANCE,
	freeSpinOverlays: FREE_SPIN_OVERLAY_INSTANCES,
});

/**
 * Default launcher origin that serves the public layout-doc endpoint
 * (`GET /api/editor/doc?project=`). Overridable per-load with the
 * `?editorDocBase=` query param (e.g. a local launcher on :3010).
 */
const DEFAULT_DOC_BASE = 'https://app.invisiblewall.org';

/**
 * The asset-URL prefix the baked-font helpers ({@link bakedFontAssets} /
 * {@link registerBakedWebFonts}, shared in `engine-layout`) must prepend. In live
 * runtime mode the project's fonts live behind the launcher's `/api/deploy`, so the
 * game passes this absolute base instead of the default page-relative `assets/`. Off
 * mode returns `'assets/'` so the engine helpers behave exactly as before (parity).
 */
export function bakedFontSrcBase(): string {
	return srcBase();
}

/**
 * Fetch the live runtime bundle (Invisible Game Maker, Phase 0) ONCE, before
 * `createApp` registers assets, and stash it module-level so every `baked*` function
 * above reads from it. OPT-IN: a no-op unless `?runtime=1` is in the game URL. On any
 * failure (no `k`, non-200, bad shape) it leaves `runtimeBundle` null and returns
 * false, so boot transparently falls back to the live `/api/editor/doc` path (and
 * ultimately {@link fallbackEditorScenes}) — never a black screen.
 *
 * Call + AWAIT this from `+layout.ts`'s client `load()`, which SvelteKit resolves
 * before the page component (and therefore `AssetsLoader`) mounts, so the runtime
 * assets are present when the game re-merges them into `stateApp.assets`.
 */
export async function prepareRuntimeBundle(): Promise<boolean> {
	if (!runtimeModeEnabled()) return false;
	try {
		const params = new URLSearchParams(window.location.search);
		const base = params.get('editorDocBase') || DEFAULT_DOC_BASE;
		const project = params.get('project') || 'lines';
		const token = params.get('k');
		if (!token) {
			console.warn('[runtime] ?runtime=1 but no ?k= token — falling back to live doc fetch');
			return false;
		}
		const url =
			`${base}/api/editor/runtime?project=${encodeURIComponent(project)}` +
			`&k=${encodeURIComponent(token)}`;
		const res = await fetch(url);
		if (!res.ok) {
			console.warn(
				`[runtime] bundle fetch ${res.status} ${res.statusText} (${url}) — falling back`,
			);
			return false;
		}
		const data = (await res.json()) as Partial<RuntimeBundle>;
		const doc = data.doc;
		const valid =
			typeof data.assetBase === 'string' &&
			!!doc &&
			Array.isArray(doc.scenes) &&
			doc.scenes.some((scene) => scene.id === 'basegame');
		if (!valid) {
			console.warn('[runtime] bundle shape invalid (no assetBase / basegame scene) — falling back');
			return false;
		}
		runtimeBundle = data as RuntimeBundle;
		console.info(
			`[runtime] live runtime bundle ready for "${project}" — generic-bundle boot active`,
		);
		return true;
	} catch (err) {
		console.warn(
			`[runtime] bundle fetch threw: ${err instanceof Error ? err.message : String(err)} — falling back`,
		);
		return false;
	}
}

/**
 * Fetch the project's editor `LayoutDoc` from the launcher at game boot. The
 * launcher appends `?project=<active>` to the game URL; the endpoint resolves
 * the client itself. Falls back to {@link fallbackEditorScenes} on any failure
 * or when the fetched doc has no `basegame` scene, so the game still runs
 * offline / before any doc has been authored in the editor.
 */
function fellBack(reason: string): LayoutDoc {
	// Loud, single-line signal so a live game that is NOT honouring editor edits is
	// diagnosable from the browser console (the silent fallback was the #1 cause of
	// "my editor resize didn't reach the game"). The bundled layout still renders.
	console.warn(
		`[editor] using bundled fallback layout — editor edits will NOT show. Reason: ${reason}`,
	);
	return fallbackEditorScenes;
}

export async function loadEditorScenes(): Promise<LayoutDoc> {
	// Live runtime (Game Maker, Phase 0): `prepareRuntimeBundle()` already fetched +
	// validated the doc (it has a `basegame` scene), so render it directly. The asset
	// registrations above are already reading from the same bundle. Off mode (no
	// `?runtime=1` / failed fetch) leaves `runtimeBundle` null and this is skipped.
	if (hasRuntimeBundle()) {
		console.info('[runtime] using live runtime bundle doc — editor edits are active');
		return runtimeBundle!.doc as LayoutDoc;
	}
	// Build-time freeze: a baked doc is the authored layout snapshotted into the
	// bundle, so production renders it instantly with no fetch + no launcher
	// dependency. `registerBakedComponents()` (boot) has already registered its defs.
	if (hasBakedDoc()) {
		console.info('[editor] using baked layout doc (frozen at build) — live fetch skipped');
		return bakedBundle.doc as LayoutDoc;
	}
	if (typeof window === 'undefined') return fallbackEditorScenes;
	try {
		const params = new URLSearchParams(window.location.search);
		const base = params.get('editorDocBase') || DEFAULT_DOC_BASE;
		const project = params.get('project') || 'lines';
		// Shared read token the launcher appends to the game URL (`?k=`); the
		// doc endpoint is token-gated. Without it the fetch 401s -> fallback.
		const token = params.get('k');
		if (!token) return fellBack('no ?k= token in the game URL (launcher must append it)');
		const docUrl =
			`${base}/api/editor/doc?project=${encodeURIComponent(project)}` +
			`&k=${encodeURIComponent(token)}`;
		const res = await fetch(docUrl);
		if (!res.ok) return fellBack(`doc fetch ${res.status} ${res.statusText} (${docUrl})`);
		const data = (await res.json()) as {
			doc?: LayoutDoc;
			componentDefaults?: Record<string, Record<string, unknown>>;
		};
		// Register the project's author-set component param defaults (§14.2 B4.5)
		// before the doc renders, so a `componentInstance` (e.g. a HUD readout) picks
		// up per-project appearance defaults. Absent/empty ⇒ def defaults apply (parity).
		registerComponentDefaults(data.componentDefaults ?? {});
		const doc = data.doc;
		if (doc && Array.isArray(doc.scenes) && doc.scenes.some((scene) => scene.id === 'basegame')) {
			console.info(`[editor] loaded live layout doc for "${project}" — editor edits are active`);
			return doc;
		}
		return fellBack('fetched doc has no `basegame` scene (schema/validation rejected)');
	} catch (err) {
		return fellBack(`fetch threw: ${err instanceof Error ? err.message : String(err)}`);
	}
}
