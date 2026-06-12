import { error, json } from '@sveltejs/kit';
import type { FontCatalog } from 'engine-layout';
import { resolveFontBundlePrefix, resolveFontCatalogRoot } from '$lib/server/fonts';
import { getObjectText } from '$lib/server/r2';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** A recipe ref must be a single safe filename segment (no path separators / escapes). */
function isSafeName(name: string): boolean {
	if (!name || name.length > 255) return false;
	return !name.includes('/') && !name.includes('\\') && !name.includes('..');
}

/**
 * Serve a generated bitmap font's AUTHORING-ONLY re-bake recipe so the Font Maker's
 * Generate tab can reopen it: the parsed bake-params doc plus a `fontMaker`-gated
 * stream URL for the original source TTF/OTF. The recipe + source font live next to
 * the font's descriptor in R2 but are never shipped to a game (see `fontExport.ts`).
 *
 * Defensive like `/api/fonts/catalog`: a missing entry / recipe / object returns 404,
 * never a 500.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'fontMaker',
		forbiddenMessage: 'Your role does not have access to the Invisible Font Maker.',
		includeSharedFonts: true,
	});

	const id = url.searchParams.get('id');
	if (!id) throw error(400, 'missing id');

	const root = await resolveFontCatalogRoot(clientKey, projectKey);
	if (!root) throw error(404, 'No font catalog for this project.');
	const text = await getObjectText(root.key);
	if (!text) throw error(404, 'No font catalog for this project.');

	let catalog: FontCatalog;
	try {
		catalog = JSON.parse(text) as FontCatalog;
	} catch {
		throw error(404, 'Font catalog is unreadable.');
	}

	const entry = (catalog.fonts ?? []).find((f) => f.id === id);
	if (!entry || !entry.recipe) throw error(404, 'No recipe for this font.');

	// Self-defending: these come from the (validated) save path, but never trust the
	// catalog as a key source — a single safe filename segment only.
	if (!isSafeName(entry.recipe.file) || !isSafeName(entry.recipe.sourceFile)) {
		throw error(404, 'Recipe references are invalid.');
	}

	const prefix = await resolveFontBundlePrefix(
		clientKey,
		projectKey,
		entry.folder,
		entry.recipe.file,
	);
	if (!prefix) throw error(404, 'Recipe file not found.');

	const recipeText = await getObjectText(`${prefix}/${entry.recipe.file}`);
	if (recipeText === null) throw error(404, 'Recipe file not found.');

	let recipe: unknown;
	try {
		recipe = JSON.parse(recipeText);
	} catch {
		throw error(404, 'Recipe file is unreadable.');
	}

	const sourceKey = `${prefix}/${entry.recipe.sourceFile}`;
	return json({
		recipe,
		sourceUrl: '/api/fonts/asset?key=' + encodeURIComponent(sourceKey),
		name: entry.name,
		folder: entry.folder,
	});
};
