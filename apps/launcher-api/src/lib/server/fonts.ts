import type { FontCatalog, FontDescriptorFormat, FontKind } from 'engine-layout';
import { SUB, sharedFontsPrefix } from './projectPaths';
import { getObjectText, objectExists } from './r2';

/**
 * Resolve a project's font catalog (`fonts.json`) and turn each entry into the
 * editor-gated stream URLs the editor canvas needs to render the real fonts —
 * the font analogue of `resolveEditorSpine` (`spine.ts`). Defensive: a project
 * without a synced catalog returns `null` so the endpoint degrades to "no fonts",
 * never a 500.
 */

/** Per-project `fonts.json` key, with a `_shared/fonts/` library fallback root. */
export async function resolveFontCatalogRoot(
	clientKey: string,
	projectKey: string,
): Promise<{ root: string; key: string } | null> {
	const projectRoot = SUB.fonts(clientKey, projectKey);
	if (await objectExists(`${projectRoot}/fonts.json`)) {
		return { root: projectRoot, key: `${projectRoot}/fonts.json` };
	}
	const sharedRoot = '_shared/fonts';
	if (await objectExists(`${sharedRoot}/fonts.json`)) {
		return { root: sharedRoot, key: `${sharedRoot}/fonts.json` };
	}
	return null;
}

/** Pick the first existing font-folder prefix: per-project, then shared `_shared/`. */
async function resolveFontBundlePrefix(
	clientKey: string,
	projectKey: string,
	folder: string,
	probe: string,
): Promise<string | null> {
	const project = `${SUB.fonts(clientKey, projectKey)}/${folder}`;
	if (await objectExists(`${project}/${probe}`)) return project;
	const shared = sharedFontsPrefix(folder);
	if (await objectExists(`${shared}/${probe}`)) return shared;
	return null;
}

/** Default stream-URL builder: route bytes through the editor-gated `/api/editor/asset`. */
const editorAssetUrl = (key: string): string =>
	`/api/editor/asset?key=${encodeURIComponent(key)}`;

/** One font, resolved into the editor-gated stream URLs (relative filenames → URLs). */
export interface EditorFont {
	id: string;
	name: string;
	kind: FontKind;
	/** Bitmap: the BMFont descriptor stream URL + its format. */
	descriptorUrl?: string;
	descriptorFormat?: FontDescriptorFormat;
	/** Bitmap: each page image filename mapped to its stream URL. */
	pages?: { file: string; url: string }[];
	/** Web: each font file's stream URL + `@font-face` format token. */
	files?: { url: string; format: string; weight?: string; style?: string }[];
}

/**
 * Resolve the project's `fonts.json` into a flat list of fonts a tool can load,
 * each file routed through a gated streamer (so no extra tool grant is required).
 * Resolves each font's folder per-project first, then the shared `_shared/fonts/`
 * library. Returns `null` when the project has no catalog.
 *
 * `assetUrl` builds the stream URL for a resolved R2 key; it defaults to the
 * editor-gated `/api/editor/asset?key=…` builder (so the editor path stays
 * byte-identical). The Font Maker passes its own `/api/fonts/asset?key=…` builder
 * to route bytes through its self-contained, `fontMaker`-gated streamer instead.
 */
export async function resolveEditorFonts(
	clientKey: string,
	projectKey: string,
	assetUrl: (key: string) => string = editorAssetUrl,
): Promise<EditorFont[] | null> {
	const root = await resolveFontCatalogRoot(clientKey, projectKey);
	if (!root) return null;
	const text = await getObjectText(root.key);
	if (!text) return null;

	let catalog: FontCatalog;
	try {
		catalog = JSON.parse(text) as FontCatalog;
	} catch {
		return null;
	}

	const out: EditorFont[] = [];
	for (const f of catalog.fonts ?? []) {
		// Probe with the descriptor (bitmap) or the first file (web) to pick the
		// per-project vs shared folder, mirroring the spine bundle resolution.
		const probe = f.kind === 'bitmap' ? f.descriptorFile : f.files?.[0]?.file;
		if (!probe) continue;
		const prefix = await resolveFontBundlePrefix(clientKey, projectKey, f.folder, probe);
		if (!prefix) continue;

		if (f.kind === 'bitmap') {
			out.push({
				id: f.id,
				name: f.name,
				kind: f.kind,
				descriptorUrl: f.descriptorFile ? assetUrl(`${prefix}/${f.descriptorFile}`) : undefined,
				descriptorFormat: f.descriptorFormat,
				pages: (f.pageFiles ?? []).map((file) => ({ file, url: assetUrl(`${prefix}/${file}`) })),
			});
		} else {
			out.push({
				id: f.id,
				name: f.name,
				kind: f.kind,
				files: (f.files ?? []).map((wf) => ({
					url: assetUrl(`${prefix}/${wf.file}`),
					format: wf.format,
					weight: wf.weight,
					style: wf.style,
				})),
			});
		}
	}
	return out;
}
