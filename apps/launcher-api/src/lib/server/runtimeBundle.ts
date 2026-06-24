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
import {
	applyHudGameNameDefault,
	collectComponentIds,
	collectComponentPins,
	type ComponentDef,
	type FontCatalog,
	type LayoutDoc,
} from 'engine-layout';
import { listComponentDefaults } from './componentDefaultsStorage';
import { loadComponent } from './componentStorage';
import { exportEditorArt, type EditorArtIndex } from './editorArtExport';
import { loadDoc as loadEditorDoc } from './editorStorage';
import { exportEditorFonts } from './fontExport';
import { loadDoc as loadLocalizationDoc } from './localization';
import { UNASSIGNED_CLIENT } from './projectPaths';
import { projectClientKey, projectName } from './projects';
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
	localization: { sourceLang: string; messages: Record<string, Record<string, string>> };
	symbols: SymbolExportResult;
}

/**
 * Rewrite each spine node's `assetKey` from its R2 bundle-prefix down to the plain
 * bundle name the running game registers under — IDENTICAL to
 * `routes/api/editor/doc/+server.ts#resolveSpineKeysForGame`, so the doc this
 * module returns uses the SAME lookup keys the editor-doc endpoint would. Mutates
 * in place (the doc is freshly loaded per call).
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
 * Resolve the transitive set of {@link ComponentDef}s a doc references — IDENTICAL
 * to `routes/api/editor/doc/+server.ts#resolveReferencedDefs`. Each id resolves
 * through the built-in → shared → project precedence (`loadComponent`), so a
 * project's EDITED def shadows the coded one. `versions` carries the EXACT pinned
 * non-latest defs (§8.9 v2) so a shipped game renders the authored version; empty
 * for every game with no non-latest pin (parity).
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
		if (defs[pin.id]?.version === pin.version) continue;
		const pinned = await loadComponent(pin.id, projectKey, pin.version);
		if (pinned) versions.push(pinned);
	}
	return { defs, versions };
}

/**
 * The project's Localization-tool strings as a per-locale message map — IDENTICAL
 * to `routes/api/localization/strings/+server.ts`: the source language exports
 * every keyed entry; target languages export only REVIEWED translations.
 */
async function loadLocalizationMessages(
	clientKey: string,
	projectKey: string,
): Promise<{ sourceLang: string; messages: Record<string, Record<string, string>> }> {
	const doc = await loadLocalizationDoc(clientKey, projectKey);
	const messages: Record<string, Record<string, string>> = {};
	const sourceMap: Record<string, string> = {};
	for (const entry of doc.entries) {
		if (!entry.key) continue;
		if (entry.source) sourceMap[entry.key] = entry.source;
		for (const [lang, t] of Object.entries(entry.translations)) {
			if (!t.reviewed || !t.text) continue;
			(messages[lang] ??= {})[entry.key] = t.text;
		}
	}
	if (Object.keys(sourceMap).length > 0) {
		messages[doc.sourceLang] = { ...messages[doc.sourceLang], ...sourceMap };
	}
	return { sourceLang: doc.sourceLang, messages };
}

/**
 * Build the full runtime bundle for a project. Runs the art/font/symbol exports
 * FRESH (so the `deploy/` indices match the current doc), then reads each returned
 * index. Reuse this from both this endpoint and a future server-side Publish so the
 * two never diverge.
 *
 * @param projectKey  the BARE launcher project key (the client is DB-resolved),
 *                    matching `/api/editor/doc` — NOT `<client>/<project>`.
 */
export async function buildRuntimeBundle(projectKey: string): Promise<RuntimeBundle> {
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	// 1. Doc — same assembly as /api/editor/doc?components=1 (HUD name default +
	//    spine-key rewrite + referenced defs + per-project component defaults).
	const doc = (await loadEditorDoc(clientKey, projectKey)) as LayoutDoc;
	applyHudGameNameDefault(doc, await projectName(projectKey));
	resolveSpineKeysForGame(doc, clientKey, projectKey);
	const componentDefaults = await listComponentDefaults(projectKey);
	const { defs: componentDefs, versions: componentVersions } = await resolveReferencedDefs(
		doc,
		projectKey,
	);

	// 2. Assets — run each exporter fresh so deploy/ mirrors the current doc, then
	//    embed the returned indices (paths are deploy-relative; the endpoint prefixes
	//    them with assetBase). Localization is read straight from R2 (no export step).
	const [{ editorArt, fonts, symbols }, localization] = await Promise.all([
		ensureDeployExports(projectKey, clientKey),
		loadLocalizationMessages(clientKey, projectKey),
	]);

	return {
		doc,
		componentDefs,
		// Omit when empty so an unpinned project's bundle stays byte-identical (parity).
		...(componentVersions.length ? { componentVersions } : {}),
		componentDefaults,
		editorArt,
		fonts: { catalog: fonts.catalog },
		localization,
		symbols,
	};
}

/**
 * Run the art / fonts / symbols exporters FRESH so the project's R2 `deploy/` tree
 * mirrors the current doc, and return their indices. Shared by {@link buildRuntimeBundle}
 * (the live runtime boot) and the server-side Publish (`publishGame.ts`) so a publish
 * and a live fetch see the SAME exported assets — there is exactly one export path.
 *
 * @param clientKey  optional; DB-resolved from the project when omitted.
 */
export async function ensureDeployExports(
	projectKey: string,
	clientKey?: string,
): Promise<{
	editorArt: EditorArtIndex;
	fonts: { catalog: FontCatalog };
	symbols: SymbolExportResult;
}> {
	const client = clientKey ?? (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	const [editorArt, fontIndex, symbols] = await Promise.all([
		exportEditorArt(client, projectKey),
		exportEditorFonts(client, projectKey),
		exportEditorSymbols(client, projectKey),
	]);
	return { editorArt, fonts: { catalog: fontIndex.catalog }, symbols };
}
