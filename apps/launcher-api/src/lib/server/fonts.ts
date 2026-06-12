import { error } from '@sveltejs/kit';
import type { FontCatalog, FontDescriptorFormat, FontKind } from 'engine-layout';
import { FONT_PUBLISH_CAPABILITY, roleHasCapability, type Role, type ToolOverrides } from '$lib/roles';
import {
	SUB,
	fontBundlePath,
	fontBundleSharedPath,
	fontCatalogKey,
	sharedFontsPrefix,
} from './projectPaths';
import { getObjectText, objectExists } from './r2';

/**
 * Resolve a project's font catalog (`fonts.json`) and turn each entry into the
 * editor-gated stream URLs the editor canvas needs to render the real fonts —
 * the font analogue of `resolveEditorSpine` (`spine.ts`). Defensive: a project
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
