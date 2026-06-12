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
import { HUD_BUTTON_INSTANCES } from './game/editorFlags';

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
	/** Art exported from the doc's references (`deploy/editor-art/`), mirrored
	 * into `static/assets/` by the deploy pull. `json`/`file` are relative to
	 * `static/assets/`. `images[].key` is the sprite node's full `assetKey`. */
	editorArt?: {
		sheets: { key: string; json: string }[];
		images: { key: string; file: string }[];
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
};
const bakedBundle = bakedBundleJson as unknown as BakedBundle;

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
	if (!hasBakedDoc()) return;
	if (bakedBundle.componentDefs) registerComponents(bakedBundle.componentDefs);
	if (bakedBundle.componentDefaults) registerComponentDefaults(bakedBundle.componentDefaults);
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
export function bakedEditorArtAssets(): Record<
	string,
	{ type: 'sprites' | 'sprite'; src: string; preload: boolean; namespace?: string }
> {
	const out: Record<
		string,
		{ type: 'sprites' | 'sprite'; src: string; preload: boolean; namespace?: string }
	> = {};
	if (!hasBakedDoc()) return out;
	for (const sheet of bakedBundle.editorArt?.sheets ?? []) {
		// Scope each sheet's frames by its manifest key (the value sprite nodes store
		// as `assetKey`) so two sheets that reuse a region name don't collide in the
		// flat loadedAssets map. `LayoutNodeView` resolves the matching scoped key.
		out[`editorArt/${sheet.json}`] = {
			type: 'sprites',
			src: `assets/${sheet.json}`,
			preload: true,
			namespace: editorArtNamespace(sheet.key),
		};
	}
	// Standalone images register under the sprite node's full assetKey — that IS
	// the engine's lookup key for a region-less sprite node.
	for (const image of bakedBundle.editorArt?.images ?? []) {
		out[image.key] = { type: 'sprite', src: `assets/${image.file}`, preload: true };
	}
	return out;
}

/**
 * Asset entries for the baked project fonts (exported to `deploy/editor-fonts/`,
 * mirrored into `static/assets/` by the deploy pull). Only BITMAP fonts ride the
 * pixi asset loader: a `{type:'font'}` entry makes `AssetsLoader` preload the
 * descriptor before first paint, and pixi installs the `BitmapFont` under its
 * `<info face>` — exactly what `<BitmapText fontFamily={name}>` then resolves.
 * Spread into the game's `assets` record at `createApp`, alongside
 * {@link bakedEditorArtAssets}. Web fonts load via {@link registerBakedWebFonts}.
 * Empty when un-baked (dev keeps its hardcoded font assets). The src is
 * page-relative (`assets/…`), matching how the static dir is served.
 */
export function bakedFontAssets(): Record<
	string,
	{ type: 'font'; src: string; preload: boolean }
> {
	const out: Record<string, { type: 'font'; src: string; preload: boolean }> = {};
	if (!hasBakedDoc()) return out;
	const catalog = bakedBundle.fonts?.catalog;
	if (!catalog) return out;
	for (const f of catalog.fonts) {
		if (f.kind !== 'bitmap' || !f.descriptorFile) continue;
		out[`bakedFont/${f.id}`] = {
			type: 'font',
			src: `assets/${catalog.prefix}/${f.folder}/${f.descriptorFile}`,
			preload: true,
		};
	}
	return out;
}

/**
 * The baked project font catalog, merged into the game's boot-time
 * `registerFontCatalog` so the engine layout text path renders `<BitmapText>` for
 * a node whose `style.fontFamily` names one of these families. Undefined when
 * un-baked (dev) → the game keeps only its hardcoded built-in font catalog.
 */
export function bakedFontCatalog(): FontCatalog | undefined {
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.fonts?.catalog;
}

/**
 * Register the baked WEB fonts via the FontFace API (bitmap fonts go through the
 * pixi asset loader in {@link bakedFontAssets} instead). Best-effort + idempotent:
 * each `@font-face` is loaded from `static/assets/editor-fonts/…` and added to
 * `document.fonts` so a `<Text fontFamily={name}>` renders the real face. No-op
 * server-side / when un-baked / when the project has no web fonts.
 */
export async function registerBakedWebFonts(): Promise<void> {
	if (typeof document === 'undefined' || !hasBakedDoc()) return;
	const catalog = bakedBundle.fonts?.catalog;
	if (!catalog) return;
	for (const f of catalog.fonts) {
		if (f.kind !== 'web') continue;
		for (const wf of f.files ?? []) {
			try {
				const url = `assets/${catalog.prefix}/${f.folder}/${wf.file}`;
				const face = new FontFace(f.name, `url(${url})`, {
					weight: wf.weight ?? 'normal',
					style: wf.style ?? 'normal',
				});
				await face.load();
				document.fonts.add(face);
			} catch (err) {
				console.warn(`[fonts] web font "${f.name}" (${wf.file}) failed to load:`, err);
			}
		}
	}
}

/**
 * The baked Localization-tool strings as a per-locale messages map, merged into
 * the game's Lingui catalog (LAST, so a project's reviewed strings override a
 * code catalog on key clash). Empty when un-baked / nothing localized — parity.
 */
export function bakedLocalizationMessagesMap(): MessagesMap {
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
});

/**
 * Default launcher origin that serves the public layout-doc endpoint
 * (`GET /api/editor/doc?project=`). Overridable per-load with the
 * `?editorDocBase=` query param (e.g. a local launcher on :3010).
 */
const DEFAULT_DOC_BASE = 'https://app.invisiblewall.org';

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
