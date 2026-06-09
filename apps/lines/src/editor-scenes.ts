import type { ComponentDef, LayoutDoc } from 'engine-layout';
import { registerComponentDefaults, registerComponents } from 'engine-layout';

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
