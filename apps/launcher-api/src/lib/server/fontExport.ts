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
 *
 * With `ENV.KTX2_ENCODE`, a bitmap font's pages also get premultiplied `.pm.ktx2` twins beside
 * them, padded to whole 4×4 blocks so no glyph rect moves, and a twin descriptor naming them
 * (`<descriptor>.ktx2.<ext>`, recorded as `ktx2DescriptorFile`), which the compressed tier loads
 * (`bakedFontAssets`). Each twin is content-cached by its source page's ETag + size and the
 * encoder revision (`<page>.meta.json`), so an unchanged font is not re-encoded.
 */
import type { FontCatalog, FontEntry } from 'engine-layout';
import { ENV } from './env';
import { catalogFontPrefix, loadRenderableFonts } from './fonts';
import { PREMULTIPLIED_KTX2_EXT } from './ktx2Alpha';
import { paddedTwinFont, type PaddedTwin } from './ktx2Descriptors';
import { KTX2_ENCODER_REVISION } from './ktx2Dimensions';
import { encodePageToKtx2 } from './ktx2Encode';
import { SUB } from './projectPaths';
import { DeployMirror } from './deployMirror';
import { getObjectBytes, getObjectText, headObject, objectExists, putObjectBytes } from './r2';

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

/** `name` without its extension. */
const stem = (name: string) => name.replace(/\.[^./]+$/, '');

/** The twin descriptor's name: `Golden.xml` → `Golden.ktx2.xml`. */
export const fontTwinDescriptorName = (descriptor: string) =>
	descriptor.replace(/(\.[^./]+)$/, '.ktx2$1');

/** What a page's `<page>.meta.json` sidecar records: the source it was made from, by which
 *  encoder, and the twin (none when the page earns none). */
interface FontTwinMeta {
	src: string;
	enc: number;
	twin?: string;
	w?: number;
	h?: number;
}

/**
 * The `.pm.ktx2` twin of the page at `srcKey`, written beside its copy in `destDir` (or reused from
 * the sidecar when its source and encoder are unchanged); null when the page earns none.
 */
async function fontPageTwin(
	srcKey: string,
	destDir: string,
	page: string,
	mirror: DeployMirror,
): Promise<Omit<PaddedTwin, 'page'> | null> {
	const head = await headObject(srcKey);
	if (!head) return null;
	const src = `${head.etag ?? ''}:${head.size}`;
	const metaKey = `${destDir}${stem(page)}.meta.json`;
	const metaText = await getObjectText(metaKey);
	const meta = metaText ? (JSON.parse(metaText) as FontTwinMeta) : null;
	if (
		meta?.src === src &&
		meta.enc === KTX2_ENCODER_REVISION &&
		(!meta.twin || (await objectExists(`${destDir}${meta.twin}`)))
	) {
		mirror.claim([metaKey, ...(meta.twin ? [`${destDir}${meta.twin}`] : [])]);
		return meta.twin ? { twin: meta.twin, width: meta.w ?? 0, height: meta.h ?? 0 } : null;
	}
	const bytes = await getObjectBytes(srcKey);
	const encoded = bytes ? await encodePageToKtx2(bytes.body, { pad: true }) : null;
	const twin = encoded ? `${stem(page)}${PREMULTIPLIED_KTX2_EXT}` : undefined;
	if (encoded && twin) {
		await putObjectBytes(`${destDir}${twin}`, encoded.bytes, 'image/ktx2');
		mirror.claim([`${destDir}${twin}`]);
	}
	const next: FontTwinMeta = {
		src,
		enc: KTX2_ENCODER_REVISION,
		...(encoded && twin ? { twin, w: encoded.width, h: encoded.height } : {}),
	};
	await mirror.put(metaKey, JSON.stringify(next));
	return encoded && twin ? { twin, width: encoded.width, height: encoded.height } : null;
}

/**
 * A bitmap font's KTX2 twin descriptor, written beside its descriptor in `destDir`: its name, or
 * undefined when encoding is off, the font is not a BMFont text/XML descriptor, or no page earns
 * a twin.
 */
async function exportFontTwin(
	f: FontEntry,
	srcPrefix: string,
	destDir: string,
	mirror: DeployMirror,
): Promise<string | undefined> {
	if (!ENV.KTX2_ENCODE || f.kind !== 'bitmap' || !f.descriptorFile) return undefined;
	if (f.descriptorFormat === 'json') return undefined;
	const twins: PaddedTwin[] = [];
	for (const page of f.pageFiles ?? []) {
		const twin = await fontPageTwin(`${srcPrefix}/${page}`, destDir, page, mirror);
		if (twin) twins.push({ page, ...twin });
	}
	if (twins.length === 0) return undefined;
	const text = await getObjectText(`${srcPrefix}/${f.descriptorFile}`);
	if (text === null) return undefined;
	const name = fontTwinDescriptorName(f.descriptorFile);
	await mirror.put(`${destDir}${name}`, paddedTwinFont(text, twins), 'text/plain');
	return name;
}

export async function exportEditorFonts(
	clientKey: string,
	projectKey: string,
): Promise<FontExportIndex> {
	const fontsPrefix = `${SUB.deploy(clientKey, projectKey)}/${EXPORT_SUBTREE}/`;
	const mirror = new DeployMirror(fontsPrefix);

	// The project's catalog plus the shared library — what the editor draws, so a library font a
	// shared component def names ships too (`loadRenderableFonts`).
	const catalog = await loadRenderableFonts(clientKey, projectKey);
	// No catalog (or unreadable/invalid) ⇒ export nothing, but still prune any
	// leftovers from a previous export so deploy/editor-fonts/ mirrors reality.
	if (!catalog) {
		await mirror.commit();
		return { catalog: { prefix: EXPORT_SUBTREE, fonts: [] } };
	}

	const exported: FontEntry[] = [];

	for (const entry of catalog) {
		const f = entry.font;
		const files = entryFiles(f);
		// Probe the descriptor (bitmap) / first file (web) to pick the per-project
		// vs shared `_shared/fonts/` folder — same resolution the editor uses.
		const probe = f.kind === 'bitmap' ? f.descriptorFile : f.files?.[0]?.file;
		if (!probe || files.length === 0) continue;
		const srcPrefix = await catalogFontPrefix(clientKey, projectKey, entry, probe);
		if (!srcPrefix) continue;

		let copied = 0;
		for (const name of files) {
			const destKey = `${fontsPrefix}${f.folder}/${name}`;
			// Server-side copy the font file verbatim (no bytes through this process —
			// keeps peak memory flat); skip a missing source file.
			if (!(await mirror.copy(`${srcPrefix}/${name}`, destKey))) continue;
			copied++;
		}
		// Only advertise a font whose files actually shipped. Strip the authoring-only
		// `recipe` (source TTF + bake params) — it must never reach the shipped bundle.
		if (copied > 0) {
			const { recipe, ...rest } = f;
			const twin = await exportFontTwin(f, srcPrefix, `${fontsPrefix}${f.folder}/`, mirror);
			exported.push(twin ? { ...rest, ktx2DescriptorFile: twin } : rest);
		}
	}

	const outCatalog: FontCatalog = { prefix: EXPORT_SUBTREE, fonts: exported };
	await mirror.put(`${fontsPrefix}index.json`, JSON.stringify(outCatalog, null, '\t'));
	await mirror.commit();

	return { catalog: outCatalog };
}
