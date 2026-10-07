import { error } from '@sveltejs/kit';
import type { FontCatalog, FontDescriptorFormat, FontEntry, FontKind } from 'engine-layout';
import {
	FONT_PUBLISH_CAPABILITY,
	roleHasCapability,
	type Role,
	type ToolOverrides,
} from '$lib/roles';
import {
	SUB,
	fontBundlePath,
	fontBundleSharedPath,
	fontCatalogKey,
	sharedFontsPrefix,
} from './projectPaths';
import { getObjectText, objectExists } from './r2';

const SHARED_FONTS_ROOT = '_shared/fonts';

/**
 * Resolve a project's font catalog (`fonts.json`) and turn each entry into the
 * editor-gated stream URLs the editor canvas needs to render the real fonts —
 * the font analogue of `resolveEditorRig` (`rig.ts`). Defensive: a project
 * without a synced catalog returns `null` so the endpoint degrades to "no fonts",
 * never a 500.
 */

/** Where a font write/delete lands: the active project, or the shared library. */
export type FontTarget = 'project' | 'shared';

/** The single non-string default. */
export function parseFontTarget(value: unknown): FontTarget {
	return value === 'shared' ? 'shared' : 'project';
}

/** A resolved write target: where the bundle/catalog live + the prefix it occupies. */
export interface ResolvedFontTarget {
	/** R2 bundle prefix for a font folder (no trailing slash). */
	bundleFor(folder: string): string;
	/** The `fonts.json` key for this target's catalog. */
	catalogKey: string;
	/** The catalog's `prefix` field + the root used for `assertAllowed` widening. */
	prefix: string;
}

/**
 * Resolve where a Font Maker WRITE/DELETE lands. `project` is unrestricted (the
 * tool gate already scopes it to the active project). `shared` is the cross-project
 * `_shared/fonts/` library — and it is the REAL write gate: `includeSharedFonts`
 * merely adds `_shared/fonts/` to the `assertAllowed` allow-list (so any Font Maker
 * user COULD otherwise PUT/delete there), so a shared target requires the explicit
 * `fontPublish` capability. `assertAllowed` still runs on every key downstream as
 * defense in depth, but it is NOT sufficient on its own for shared writes.
 */
export function resolveFontTarget(
	target: FontTarget,
	clientKey: string,
	projectKey: string,
	role: Role,
	roleOverrides: ToolOverrides = {},
	userOverrides: ToolOverrides = {},
): ResolvedFontTarget {
	if (target === 'shared') {
		if (!roleHasCapability(role, FONT_PUBLISH_CAPABILITY, roleOverrides, userOverrides)) {
			throw error(403, 'You cannot publish to the shared font library.');
		}
		return {
			bundleFor: (folder) => fontBundleSharedPath(folder),
			catalogKey: '_shared/fonts/fonts.json',
			prefix: '_shared/fonts',
		};
	}
	return {
		bundleFor: (folder) => fontBundlePath(clientKey, projectKey, folder),
		catalogKey: fontCatalogKey(clientKey, projectKey),
		prefix: SUB.fonts(clientKey, projectKey),
	};
}

/** Per-project `fonts.json` key, with a `_shared/fonts/` library fallback root. */
export async function resolveFontCatalogRoot(
	clientKey: string,
	projectKey: string,
): Promise<{ root: string; key: string } | null> {
	const projectRoot = SUB.fonts(clientKey, projectKey);
	if (await objectExists(`${projectRoot}/fonts.json`)) {
		return { root: projectRoot, key: `${projectRoot}/fonts.json` };
	}
	if (await objectExists(`${SHARED_FONTS_ROOT}/fonts.json`)) {
		return { root: SHARED_FONTS_ROOT, key: `${SHARED_FONTS_ROOT}/fonts.json` };
	}
	return null;
}

/** Pick the first existing font-folder prefix: per-project, then shared `_shared/`. */
export async function resolveFontBundlePrefix(
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

async function readCatalog(key: string): Promise<FontEntry[] | null> {
	const text = await getObjectText(key);
	if (!text) return null;
	try {
		return (JSON.parse(text) as FontCatalog).fonts ?? [];
	} catch {
		return null;
	}
}

/** A catalog entry, and whether it came from the shared library's catalog. */
export interface RootedFont {
	font: FontEntry;
	shared: boolean;
}

/**
 * The fonts a project RENDERS: its own catalog, then every `_shared/fonts/` library entry it does
 * not override (by id or folder). The library is merged, not a fallback for a project with no
 * catalog — a shared component def names a library font by family, and a project with fonts of its
 * own would otherwise draw (and ship) it as the default font. The same reason
 * `loadSkeletonIndexWithShared` exists for rigs. `null` when neither catalog exists.
 *
 * The Font Maker keeps {@link resolveFontCatalogRoot}: its catalog view is where a write or delete
 * lands, and a merged list would point a delete of a library font at the project.
 */
export async function loadRenderableFonts(
	clientKey: string,
	projectKey: string,
): Promise<RootedFont[] | null> {
	const [own, shared] = await Promise.all([
		readCatalog(`${SUB.fonts(clientKey, projectKey)}/fonts.json`),
		readCatalog(`${SHARED_FONTS_ROOT}/fonts.json`),
	]);
	if (!own && !shared) return null;
	const ownFonts = own ?? [];
	const ids = new Set(ownFonts.map((f) => f.id));
	const folders = new Set(ownFonts.map((f) => f.folder));
	return [
		...ownFonts.map((font) => ({ font, shared: false })),
		...(shared ?? [])
			.filter((f) => !ids.has(f.id) && !folders.has(f.folder))
			.map((font) => ({ font, shared: true })),
	];
}

/** The R2 folder a catalog font's files live in — a library entry only in the library. */
export async function catalogFontPrefix(
	clientKey: string,
	projectKey: string,
	entry: RootedFont,
	probe: string,
): Promise<string | null> {
	if (!entry.shared)
		return resolveFontBundlePrefix(clientKey, projectKey, entry.font.folder, probe);
	const shared = sharedFontsPrefix(entry.font.folder);
	return (await objectExists(`${shared}/${probe}`)) ? shared : null;
}

/** The Font Maker's catalog — the project's, else the library's ({@link resolveFontCatalogRoot}). */
async function fontMakerCatalog(
	clientKey: string,
	projectKey: string,
): Promise<RootedFont[] | null> {
	const root = await resolveFontCatalogRoot(clientKey, projectKey);
	const fonts = root ? await readCatalog(root.key) : null;
	return fonts && fonts.map((font) => ({ font, shared: false }));
}

/** Default stream-URL builder: route bytes through the editor-gated `/api/editor/asset`. */
const editorAssetUrl = (key: string): string => `/api/editor/asset?key=${encodeURIComponent(key)}`;

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
	/** Bitmap only: the font carries an authoring recipe, so the Font Maker can re-bake it. */
	editable?: boolean;
}

/**
 * Resolve the project's fonts into a flat list a tool can load, each file routed through a gated
 * streamer (so no extra tool grant is required). `catalog` picks the list: `renderable` (the
 * default — every tool that DRAWS fonts) is {@link loadRenderableFonts}, the project's catalog plus
 * the library; `fontMaker` is the one catalog the Font Maker writes to. Returns `null` when there
 * is no catalog.
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
	catalog: 'renderable' | 'fontMaker' = 'renderable',
): Promise<EditorFont[] | null> {
	const fonts =
		catalog === 'renderable'
			? await loadRenderableFonts(clientKey, projectKey)
			: await fontMakerCatalog(clientKey, projectKey);
	if (!fonts) return null;

	const out: EditorFont[] = [];
	for (const entry of fonts) {
		const f = entry.font;
		// Probe with the descriptor (bitmap) or the first file (web) to pick the
		// per-project vs shared folder, mirroring the rig bundle resolution.
		const probe = f.kind === 'bitmap' ? f.descriptorFile : f.files?.[0]?.file;
		if (!probe) continue;
		const prefix = await catalogFontPrefix(clientKey, projectKey, entry, probe);
		if (!prefix) continue;

		if (f.kind === 'bitmap') {
			out.push({
				id: f.id,
				name: f.name,
				kind: f.kind,
				descriptorUrl: f.descriptorFile ? assetUrl(`${prefix}/${f.descriptorFile}`) : undefined,
				descriptorFormat: f.descriptorFormat,
				pages: (f.pageFiles ?? []).map((file) => ({ file, url: assetUrl(`${prefix}/${file}`) })),
				editable: !!f.recipe,
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
