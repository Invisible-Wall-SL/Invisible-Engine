import { error, json } from '@sveltejs/kit';
import type { FontCatalog, FontDescriptorFormat, FontEntry } from 'engine-layout';
import { parseBmfontDescriptor } from '$lib/server/bmfont';
import { SUB, fontBundlePath, fontCatalogKey } from '$lib/server/projectPaths';
import { getObjectText, objectExists, putObjectText } from '$lib/server/r2';
import { assertAllowed, gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const FORMATS: ReadonlySet<string> = new Set(['xml', 'fnt', 'json']);

interface SaveRequest {
	folder?: unknown;
	descriptorFile?: unknown;
	descriptorFormat?: unknown;
}

function isSafeName(name: string): boolean {
	if (!name || name.length > 255) return false;
	if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
	return true;
}

/**
 * Commit an imported bitmap font into the active project's R2 fonts contract. The
 * client has already PUT the descriptor + page images straight to R2 (see
 * `/api/fonts/upload-urls`); this endpoint is AUTHORITATIVE — it re-reads the
 * uploaded descriptor bytes, re-parses them for `name` (BMFont `<info face>`) +
 * `pageFiles` (the descriptor's `<page file>` refs), verifies every page actually
 * landed in R2, then upserts the `fonts.json` entry keyed by `id === folder`. A
 * client-supplied name/pageFiles is NEVER trusted.
 *
 * Writes target the per-project prefix only (shared-library writes are Phase 4).
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

	const descriptorFile = body.descriptorFile;
	if (typeof descriptorFile !== 'string' || !isSafeName(descriptorFile)) {
		throw error(400, `Invalid descriptorFile: ${JSON.stringify(descriptorFile)}`);
	}

	const descriptorFormat = body.descriptorFormat;
	if (typeof descriptorFormat !== 'string' || !FORMATS.has(descriptorFormat)) {
		throw error(400, `Invalid descriptorFormat: ${JSON.stringify(descriptorFormat)}`);
	}
	const format = descriptorFormat as FontDescriptorFormat;

	// `fontBundlePath` validates the folder segment (throws on escapes / bad chars).
	let bundle: string;
	try {
		bundle = fontBundlePath(clientKey, projectKey, folder);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Invalid folder.');
	}

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

	const catalogKey = fontCatalogKey(clientKey, projectKey);
	const prefix = SUB.fonts(clientKey, projectKey);

	// Read-modify-write the catalog; start fresh if absent or unparseable.
	let catalog: FontCatalog = { prefix, fonts: [] };
	const existing = await getObjectText(catalogKey);
	if (existing) {
		try {
			const parsed = JSON.parse(existing) as Partial<FontCatalog>;
			if (parsed && Array.isArray(parsed.fonts)) catalog = { prefix, fonts: parsed.fonts };
		} catch {
			// Corrupt catalog → start clean (the entry we add is the source of truth).
		}
	}
	catalog.prefix = prefix;

	const entry: FontEntry = {
		id: folder,
		name: face,
		kind: 'bitmap',
		folder,
		descriptorFile,
		descriptorFormat: format,
		pageFiles,
	};
	const at = catalog.fonts.findIndex((f) => f.id === folder);
	if (at >= 0) catalog.fonts[at] = entry;
	else catalog.fonts.push(entry);

	await putObjectText(catalogKey, JSON.stringify(catalog), 'application/json');

	return json({ ok: true, font: entry });
};
