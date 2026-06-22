/**
 * Export a project's font catalog + the font files it references into the
 * game-loadable `deploy/editor-fonts/` subtree — the font analogue of
 * `editorArtExport.ts`. Closes the "made a font in the Font Maker, it shows in
 * the editor, but the shipped game has no font" gap (docs/design/live-assets.md).
 *
 * The editor streams fonts straight from R2 (`/api/editor/fonts`), but a game
 * loads fonts only from files in its own `static/assets/`. This copies each
 * catalog font's descriptor + page images (bitmap) or web-font files into:
 *
 *   <client>/<project>/deploy/editor-fonts/<folder>/<files…>
 *   <client>/<project>/deploy/editor-fonts/index.json   ← the exported catalog
 *
 * The existing transport then carries it: `bake-editor-doc.mjs` triggers this and
 * embeds the catalog in the baked bundle; `pull-project-assets.mjs` mirrors
 * `deploy/` → `static/assets/`; the game registers a `{type:'font'}` asset per
 * bitmap font (so pixi installs the `BitmapFont` under its face) and merges the
 * catalog into `registerFontCatalog`. Stale objects from a previous export are
 * pruned. Idempotent — re-running converges.
 *
 * File NAMES (and the per-font `folder`) are preserved verbatim so a bitmap
 * descriptor's relative page references resolve next to it once mirrored into
 * `static/assets/editor-fonts/<folder>/`.
 */
import type { FontCatalog, FontEntry } from 'engine-layout';
import { resolveFontBundlePrefix, resolveFontCatalogRoot } from './fonts';
import { SUB } from './projectPaths';
import { copyObject, deleteObjects, getObjectText, listAllKeys, putObjectText } from './r2';

export interface FontExportIndex {
	/** The catalog of fonts actually exported. `prefix` is the `static/assets/`
	 *  subtree (`editor-fonts`); each entry keeps its `folder` + file names. */
	catalog: FontCatalog;
}

/** Files a catalog entry carries, as names relative to its `folder`. */
function entryFiles(f: FontEntry): string[] {
	if (f.kind === 'bitmap') {
		const out: string[] = [];
		if (f.descriptorFile) out.push(f.descriptorFile);
		for (const page of f.pageFiles ?? []) out.push(page);
		return out;
	}
	return (f.files ?? []).map((wf) => wf.file);
}

const EXPORT_SUBTREE = 'editor-fonts';

export async function exportEditorFonts(
	clientKey: string,
	projectKey: string,
): Promise<FontExportIndex> {
	const fontsPrefix = `${SUB.deploy(clientKey, projectKey)}/${EXPORT_SUBTREE}/`;
	const empty: FontCatalog = { prefix: EXPORT_SUBTREE, fonts: [] };

	// No catalog (or unreadable/invalid) ⇒ export nothing, but still prune any
	// leftovers from a previous export so deploy/editor-fonts/ mirrors reality.
	const pruneAndReturn = async (catalog: FontCatalog): Promise<FontExportIndex> => {
		const existing = await listAllKeys(fontsPrefix);
		await deleteObjects(existing);
		return { catalog };
	};

	const root = await resolveFontCatalogRoot(clientKey, projectKey);
	if (!root) return pruneAndReturn(empty);
	const text = await getObjectText(root.key);
	if (!text) return pruneAndReturn(empty);
	let catalog: FontCatalog;
	try {
		catalog = JSON.parse(text) as FontCatalog;
	} catch {
		return pruneAndReturn(empty);
	}

	const written = new Set<string>();
	const exported: FontEntry[] = [];

	for (const f of catalog.fonts ?? []) {
		const files = entryFiles(f);
		// Probe the descriptor (bitmap) / first file (web) to pick the per-project
		// vs shared `_shared/fonts/` folder — same resolution the editor uses.
		const probe = f.kind === 'bitmap' ? f.descriptorFile : f.files?.[0]?.file;
		if (!probe || files.length === 0) continue;
		const srcPrefix = await resolveFontBundlePrefix(clientKey, projectKey, f.folder, probe);
		if (!srcPrefix) continue;

		let copied = 0;
		for (const name of files) {
			const destKey = `${fontsPrefix}${f.folder}/${name}`;
			// Server-side copy the font file verbatim (no bytes through this process —
			// keeps peak memory flat); skip a missing source file.
			if (!(await copyObject(`${srcPrefix}/${name}`, destKey))) continue;
			written.add(destKey);
			copied++;
		}
		// Only advertise a font whose files actually shipped. Strip the authoring-only
		// `recipe` (source TTF + bake params) — it must never reach the shipped bundle.
		if (copied > 0) {
			const { recipe, ...rest } = f;
			exported.push(rest);
		}
	}

	const outCatalog: FontCatalog = { prefix: EXPORT_SUBTREE, fonts: exported };
	const indexKey = `${fontsPrefix}index.json`;
	await putObjectText(indexKey, JSON.stringify(outCatalog, null, '\t'), 'application/json');
	written.add(indexKey);

	const existing = await listAllKeys(fontsPrefix);
	await deleteObjects(existing.filter((k) => !written.has(k)));

	return { catalog: outCatalog };
}
