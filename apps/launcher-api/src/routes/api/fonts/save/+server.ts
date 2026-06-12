import { error, json } from '@sveltejs/kit';
import type {
	FontCatalog,
	FontDescriptorFormat,
	FontEntry,
	FontFile,
	FontRecipe,
} from 'engine-layout';
import { parseBmfontDescriptor } from '$lib/server/bmfont';
import { parseFontTarget, resolveFontTarget } from '$lib/server/fonts';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import { getObjectText, objectExists, putObjectText } from '$lib/server/r2';
import { assertAllowed, gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const FORMATS: ReadonlySet<string> = new Set(['xml', 'fnt', 'json']);
/** Valid `@font-face` format tokens for a web font file. */
const WEB_FORMATS: ReadonlySet<string> = new Set(['woff2', 'woff', 'truetype', 'opentype']);

interface SaveRequest {
	folder?: unknown;
	target?: unknown;
	kind?: unknown;
	/** Must be explicitly `true` to replace an existing entry with the same `id`. */
	overwrite?: unknown;
	// Bitmap.
	descriptorFile?: unknown;
	descriptorFormat?: unknown;
	/** Bitmap, authoring-only: `{ file, sourceFile }` sidecar refs (re-bake support). */
	recipe?: unknown;
	// Web.
	name?: unknown;
	files?: unknown;
}

interface WebFileRequest {
	file?: unknown;
	format?: unknown;
	weight?: unknown;
	style?: unknown;
}

function isSafeName(name: string): boolean {
	if (!name || name.length > 255) return false;
	if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
	return true;
}

/** Read-modify-write the target catalog: parse the existing one or start fresh. */
async function loadCatalog(catalogKey: string, prefix: string): Promise<FontCatalog> {
	const catalog: FontCatalog = { prefix, fonts: [] };
	const existing = await getObjectText(catalogKey);
	if (existing) {
		try {
			const parsed = JSON.parse(existing) as Partial<FontCatalog>;
			if (parsed && Array.isArray(parsed.fonts)) catalog.fonts = parsed.fonts;
		} catch {
			// Corrupt catalog → start clean (the entry we add is the source of truth).
		}
	}
	catalog.prefix = prefix;
	return catalog;
}

/**
 * Upsert an entry by `id === folder` and write the catalog back. A collision is only
 * replaced when `overwrite` is explicitly true — otherwise it throws 409 so a new font
 * never silently clobbers an existing one (defense in depth: the client already gates
 * this, but the uploaded bytes have landed by now, so the catalog is the last guard).
 */
async function commit(
	catalog: FontCatalog,
	catalogKey: string,
	entry: FontEntry,
	overwrite: boolean,
): Promise<void> {
	const at = catalog.fonts.findIndex((f) => f.id === entry.id);
	if (at >= 0) {
		if (!overwrite) {
			throw error(
				409,
				`A font with id "${entry.id}" already exists. Pick a different folder/id, or confirm overwrite.`,
			);
		}
		catalog.fonts[at] = entry;
	} else {
		catalog.fonts.push(entry);
	}
	await putObjectText(catalogKey, JSON.stringify(catalog), 'application/json');
}

/**
 * Commit an imported/generated font into the target's R2 fonts contract. The client
 * has already PUT every file straight to R2 (see `/api/fonts/upload-urls`); this
 * endpoint is AUTHORITATIVE.
 *
 * - **bitmap** (default for back-compat): re-reads the uploaded descriptor bytes,
 *   re-parses them for `name` (BMFont `<info face>`) + `pageFiles` (the descriptor's
 *   `<page file>` refs), verifies every page actually landed in R2, then upserts the
 *   `fonts.json` entry. A client-supplied name/pageFiles is NEVER trusted.
 * - **web** (`kind: 'web'`): web fonts have no embedded contract, so the client
 *   supplies the family `name` + the uploaded `files`; we validate each file
 *   (`isSafeName`, allowed key, exists, valid `format`) and upsert the entry.
 *
 * `target` (`project` default | `shared`) routes the bundle + catalog. A `shared`
 * target requires the `fontPublish` capability (enforced in `resolveFontTarget`);
 * `assertAllowed` still runs on every key as defense in depth.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey, prefixes } = await gate(locals, cookies, {
		tool: 'fontMaker',
		forbiddenMessage: 'Your role does not have access to the Invisible Font Maker.',
		includeSharedFonts: true,
	});

	let body: SaveRequest;
	try {
		body = (await request.json()) as SaveRequest;
	} catch {
		throw error(400, 'Invalid JSON body.');
	}

	const folder = body.folder;
	if (typeof folder !== 'string' || !folder) throw error(400, 'Expected a `folder` string.');

	const role = locals.user!.role;
	const roleOverrides = await getRoleOverrides(role);
	const userOverrides = await getToolOverrides(locals.user!.id);
	const dest = resolveFontTarget(
		parseFontTarget(body.target),
		clientKey,
		projectKey,
		role,
		roleOverrides,
		userOverrides,
	);

	// `bundleFor` validates the folder segment (throws on escapes / bad chars).
	let bundle: string;
	try {
		bundle = dest.bundleFor(folder);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Invalid folder.');
	}

	const kind = body.kind === 'web' ? 'web' : 'bitmap';
	const overwrite = body.overwrite === true;

	if (kind === 'web') {
		const entry = await saveWebEntry(body, folder, bundle, prefixes);
		const catalog = await loadCatalog(dest.catalogKey, dest.prefix);
		await commit(catalog, dest.catalogKey, entry, overwrite);
		return json({ ok: true, font: entry });
	}

	const entry = await saveBitmapEntry(body, folder, bundle, prefixes);
	const catalog = await loadCatalog(dest.catalogKey, dest.prefix);
	await commit(catalog, dest.catalogKey, entry, overwrite);
	return json({ ok: true, font: entry });
};

/** Validate + build a bitmap `FontEntry` from the uploaded BMFont descriptor. */
async function saveBitmapEntry(
	body: SaveRequest,
	folder: string,
	bundle: string,
	prefixes: string[],
): Promise<FontEntry> {
	const descriptorFile = body.descriptorFile;
	if (typeof descriptorFile !== 'string' || !isSafeName(descriptorFile)) {
		throw error(400, `Invalid descriptorFile: ${JSON.stringify(descriptorFile)}`);
	}

	const descriptorFormat = body.descriptorFormat;
	if (typeof descriptorFormat !== 'string' || !FORMATS.has(descriptorFormat)) {
		throw error(400, `Invalid descriptorFormat: ${JSON.stringify(descriptorFormat)}`);
	}
	const format = descriptorFormat as FontDescriptorFormat;

	const descriptorKey = `${bundle}/${descriptorFile}`;
	assertAllowed(descriptorKey, prefixes);

	// AUTHORITATIVE: read the just-uploaded descriptor back + re-derive name/pages.
	const text = await getObjectText(descriptorKey);
	if (text === null) throw error(400, 'Descriptor not uploaded — PUT it before saving.');
	const { face, pageFiles } = parseBmfontDescriptor(text, format);

	// Every referenced page must be a safe name AND actually present in R2.
	for (const page of pageFiles) {
		if (!isSafeName(page)) throw error(400, `Invalid page file in descriptor: ${page}`);
		const pageKey = `${bundle}/${page}`;
		assertAllowed(pageKey, prefixes);
		if (!(await objectExists(pageKey))) throw error(400, `page not uploaded: ${page}`);
	}

	const entry: FontEntry = {
		id: folder,
		name: face,
		kind: 'bitmap',
		folder,
		descriptorFile,
		descriptorFormat: format,
		pageFiles,
	};

	const recipe = await resolveRecipe(body.recipe, bundle, prefixes);
	if (recipe) entry.recipe = recipe;

	return entry;
}

/**
 * Validate an optional authoring-only recipe sidecar. Both files must be safe
 * names, inside an allowed prefix, and already uploaded (the client PUTs them
 * before save). Absent → `undefined` (web fonts never get one). NOT shipped.
 */
async function resolveRecipe(
	raw: unknown,
	bundle: string,
	prefixes: string[],
): Promise<FontRecipe | undefined> {
	if (raw === undefined || raw === null) return undefined;
	const r = raw as { file?: unknown; sourceFile?: unknown };
	const file = r.file;
	const sourceFile = r.sourceFile;
	if (typeof file !== 'string' || !isSafeName(file)) {
		throw error(400, `Invalid recipe file: ${JSON.stringify(file)}`);
	}
	if (typeof sourceFile !== 'string' || !isSafeName(sourceFile)) {
		throw error(400, `Invalid recipe sourceFile: ${JSON.stringify(sourceFile)}`);
	}
	const recipeKey = `${bundle}/${file}`;
	const sourceKey = `${bundle}/${sourceFile}`;
	assertAllowed(recipeKey, prefixes);
	assertAllowed(sourceKey, prefixes);
	if (!(await objectExists(recipeKey))) throw error(400, `recipe not uploaded: ${file}`);
	if (!(await objectExists(sourceKey))) throw error(400, `recipe source not uploaded: ${sourceFile}`);
	return { file, sourceFile };
}

/** Validate + build a web `FontEntry` from the client-supplied family + files. */
async function saveWebEntry(
	body: SaveRequest,
	folder: string,
	bundle: string,
	prefixes: string[],
): Promise<FontEntry> {
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) throw error(400, 'Expected a non-empty `name` (the CSS family).');

	const rawFiles = body.files;
	if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
		throw error(400, 'Expected a non-empty `files` array.');
	}

	const files: FontFile[] = [];
	for (const raw of rawFiles as WebFileRequest[]) {
		const file = raw?.file;
		if (typeof file !== 'string' || !isSafeName(file)) {
			throw error(400, `Invalid file name: ${JSON.stringify(file)}`);
		}
		const format = raw?.format;
		if (typeof format !== 'string' || !WEB_FORMATS.has(format)) {
			throw error(400, `Invalid format for ${file}: ${JSON.stringify(format)}`);
		}
		const key = `${bundle}/${file}`;
		assertAllowed(key, prefixes);
		if (!(await objectExists(key))) throw error(400, `file not uploaded: ${file}`);

		const entry: FontFile = { file, format };
		if (typeof raw?.weight === 'string' && raw.weight) entry.weight = raw.weight;
		if (raw?.style === 'italic' || raw?.style === 'oblique' || raw?.style === 'normal') {
			entry.style = raw.style;
		}
		files.push(entry);
	}

	return { id: folder, name, kind: 'web', folder, files };
}
