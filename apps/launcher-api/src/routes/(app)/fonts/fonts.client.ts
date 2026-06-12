/**
 * Font Maker client glue: the tool-specific catalog fetch + the Import/Generate save
 * helpers. The actual font LOADING (descriptor parse, `BitmapFont` build, page +
 * web-`FontFace` loading) lives in the shared `$lib/fontLoad.client` so the Scene
 * Editor and the Font Maker share ONE implementation — re-exported here so this
 * tool's components keep importing from `./fonts.client`.
 */
import type { FontDescriptorFormat } from 'engine-layout';
import { loadCatalogBitmapFont } from '$lib/fontLoad.client';

export type {
	CatalogFont,
	ParsedDescriptor,
	LocalBitmapFont,
} from '$lib/fontLoad.client';
export {
	parseDescriptorClient,
	loadLocalBitmapFont,
	ensureWebFont,
	fitCanvasToObject,
} from '$lib/fontLoad.client';
/** A catalog bitmap font, registered with PIXI under its `name`. See the shared module. */
export const ensureBitmapFont = loadCatalogBitmapFont;

import type { CatalogFont } from '$lib/fontLoad.client';

/** Where a font write/delete lands: the active project, or the shared library. */
export type FontTarget = 'project' | 'shared';

/** The catalog + which source it resolved from (so a delete knows its target). */
export interface FontCatalogResult {
	fonts: CatalogFont[];
	/** Whether the catalog came from the project or the `_shared/fonts/` fallback. */
	source: FontTarget;
}

/** Fetch the active project's font catalog + its source. Empty on any failure. */
export async function fetchFontCatalog(): Promise<FontCatalogResult> {
	try {
		const res = await fetch('/api/fonts/catalog');
		if (!res.ok) return { fonts: [], source: 'project' };
		const body = (await res.json()) as { fonts?: CatalogFont[]; source?: FontTarget };
		return { fonts: body.fonts ?? [], source: body.source === 'shared' ? 'shared' : 'project' };
	} catch {
		return { fonts: [], source: 'project' };
	}
}

/** One file to upload as part of a bitmap-font save (descriptor or page image). */
export interface SaveFile {
	/** Filename — must match a `<page file>` ref for pages, or the descriptor name. */
	name: string;
	blob: Blob;
	contentType: string;
}

/**
 * Run the Phase-2 save sequence shared by Import + Generate: mint presigned PUT URLs
 * (`POST /api/fonts/upload-urls`), PUT each file straight to R2 with its content-type,
 * then `POST /api/fonts/save` (AUTHORITATIVE — re-reads the descriptor + upserts the
 * catalog). The descriptor MUST be one of `files`; `descriptorFile` names it. Throws
 * on any failure; resolves to the committed entry's `{ id, name }`.
 */
export async function saveBitmapFont(args: {
	folder: string;
	descriptorFile: string;
	descriptorFormat: FontDescriptorFormat;
	files: SaveFile[];
	/** Where to save (default `project`; `shared` needs the `fontPublish` capability). */
	target?: FontTarget;
	/** Replace an existing entry with the same id (the server rejects collisions otherwise). */
	overwrite?: boolean;
}): Promise<{ id: string; name: string }> {
	const { folder, descriptorFile, descriptorFormat, files, target = 'project', overwrite } = args;
	await putFiles(folder, files, target);

	const saveRes = await fetch('/api/fonts/save', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			folder,
			target,
			kind: 'bitmap',
			descriptorFile,
			descriptorFormat,
			overwrite,
		}),
	});
	if (!saveRes.ok) throw new Error(await errText(saveRes, 'Save failed.'));
	const { font } = (await saveRes.json()) as { font: { name: string; id: string } };
	return { id: font.id, name: font.name };
}

/** One web-font file to upload + register: blob + its `@font-face` format token. */
export interface WebSaveFile {
	name: string;
	blob: Blob;
	contentType: string;
	format: string;
	weight?: string;
	style?: string;
}

/**
 * Save a WEB font (woff2/woff/ttf/otf) via the SAME presign → PUT → save sequence as
 * `saveBitmapFont`, but the save call carries `kind: 'web'` + the family `name` + each
 * file's `format`/`weight`/`style` (web fonts have no embedded descriptor, so the
 * server can't re-derive them). Throws on failure; resolves to the committed entry.
 */
export async function saveWebFont(args: {
	folder: string;
	name: string;
	files: WebSaveFile[];
	target?: FontTarget;
	/** Replace an existing entry with the same id (the server rejects collisions otherwise). */
	overwrite?: boolean;
}): Promise<{ id: string; name: string }> {
	const { folder, name, files, target = 'project', overwrite } = args;
	await putFiles(folder, files, target);

	const saveRes = await fetch('/api/fonts/save', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			folder,
			target,
			kind: 'web',
			name,
			overwrite,
			files: files.map((f) => ({
				file: f.name,
				format: f.format,
				weight: f.weight,
				style: f.style,
			})),
		}),
	});
	if (!saveRes.ok) throw new Error(await errText(saveRes, 'Save failed.'));
	const { font } = (await saveRes.json()) as { font: { name: string; id: string } };
	return { id: font.id, name: font.name };
}

/** Mint presigned PUT URLs for `files` and upload each blob straight to R2. */
async function putFiles(
	folder: string,
	files: { name: string; blob: Blob; contentType: string }[],
	target: FontTarget,
): Promise<void> {
	const byName = new Map(files.map((f) => [f.name, f]));
	const urlsRes = await fetch('/api/fonts/upload-urls', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			folder,
			target,
			files: files.map((f) => ({ name: f.name, contentType: f.contentType })),
		}),
	});
	if (!urlsRes.ok) throw new Error(await errText(urlsRes, 'Failed to mint upload URLs.'));
	const { uploads } = (await urlsRes.json()) as {
		uploads: { name: string; url: string; contentType: string }[];
	};

	for (const up of uploads) {
		const file = byName.get(up.name);
		if (!file) throw new Error(`Internal: no local file for "${up.name}".`);
		const put = await fetch(up.url, {
			method: 'PUT',
			headers: { 'content-type': up.contentType },
			body: file.blob,
		});
		if (!put.ok) throw new Error(`Upload of "${up.name}" failed (${put.status}).`);
	}
}

/** Delete a font (by catalog id) from the given target. Throws on failure. */
export async function deleteFont(id: string, target: FontTarget): Promise<void> {
	const res = await fetch('/api/fonts/delete', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id, target }),
	});
	if (!res.ok) throw new Error(await errText(res, 'Delete failed.'));
}

/** Read a JSON error `message` off a failed response, falling back to a default. */
async function errText(res: Response, fallback: string): Promise<string> {
	try {
		const body = (await res.json()) as { message?: string };
		return body.message ?? fallback;
	} catch {
		return `${fallback} (${res.status})`;
	}
}
