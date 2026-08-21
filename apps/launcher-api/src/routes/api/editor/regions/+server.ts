import { error, json } from '@sveltejs/kit';
import { sheetVersion } from '$lib/server/assetVersion';
import { loadRegionSet } from '$lib/server/editorRegions';
import { assertAllowed, gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * List the individual regions defined by a sheet/atlas manifest so the editor
 * can show each frame as its own draggable thumbnail and render dropped region
 * sprites. The `sheet` query param is the library item's `key` (a `sheet`
 * output prefix or an `atlas-manifest` JSON key).
 *
 * Defensive by design: a missing/garbage manifest returns `{ regions: [] }`,
 * never a 500.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey, prefixes } = await gate(locals, cookies, {
		tool: 'editor',
		altTools: ['fx', 'rigger', 'flipbook', 'gameConfig'],
		forbiddenMessage: 'Your role does not have access to the project assets.',
		includeSharedSpines: true,
		// ...and its regions are read through here, so both halves need the library in scope.
		includeSharedSheets: true,
	});

	const sheet = url.searchParams.get('sheet');
	if (!sheet) throw error(400, 'missing sheet');
	assertAllowed(sheet, prefixes);

	const set = await loadRegionSet(sheet, clientKey, projectKey);

	// Never hand back a page key the asset streamer would reject — drop it so the
	// client falls back to per-region placeholders instead of a broken <img>.
	const pageKey = set.pageKey && prefixes.some((p) => set.pageKey.startsWith(p)) ? set.pageKey : '';

	// Content-version token for the resolved page (region rects + page ETag). Clients
	// stamp it into the `/api/editor/asset?key=…&v=…` URL so a re-authored atlas busts
	// every URL-keyed cache (browser/CDN/PIXI) AUTOMATICALLY — no manual "Reload art".
	// Empty when there's no page (nothing to version).
	const pageVersion = pageKey ? ((await sheetVersion({ ...set, pageKey })) ?? '') : '';

	return json({
		assetKey: set.assetKey,
		pageKey,
		pageVersion,
		pageWidth: set.pageWidth,
		pageHeight: set.pageHeight,
		regions: set.regions,
		// Rotated frames use the TexturePacker (PIXI-native) direction — RegionThumb un-rotates to match.
		...(set.tpRotated ? { tpRotated: true } : {}),
	});
};
