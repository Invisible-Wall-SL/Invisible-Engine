import { isBareManifestBasename, needsAtlasRefRepair } from 'engine-layout';

import { resolveManifestKey } from './editorRegions';
import { SUB } from './projectPaths';
import { listObjects } from './r2';

/**
 * Repair for atlas refs the RUNTIME cannot scope by — shared by the Flipbook and Symbols ship paths.
 *
 * A clip's `assetKey` / a scoped frame prefix / a sprite cell's scoped ref may name its atlas by
 * something other than the full `<path>/<name>.json` manifest key:
 *
 * - a BARE BASENAME (`atlas_manifest_S_Gem.json`, no path), or
 * - a Sheet-Maker OUTPUT PREFIX (`<client>/<project>/sheets/S_Gem/`, no `.json`) — what the region
 *   picker stores when the source is a sheet rather than a manifest.
 *
 * The runtime's `isManifestAssetKey` demands both a `/` and a `.json`, so either form makes the
 * atlas-scoped frame lookup SKIP — and two clips/symbols reusing a frame name (`frame_0000`) on
 * DISTINCT atlases then collide in the flat bare texture cache (last-loaded sheet wins), so one
 * symbol silently plays another's animation. The runtime cannot repair this itself (it has no R2
 * listing to map a ref → real key), so the export/assemble layer does it here — the one place every
 * ship-path reader goes through.
 */

/**
 * `isBareManifestBasename` / `needsAtlasRefRepair` — which refs the runtime cannot scope by — live
 * in `engine-layout` beside `isManifestAssetKey`, so this repair pass and the runtime lookup can
 * never disagree about what "scopeable" means. Re-exported here for the ship-path callers.
 */
export { isBareManifestBasename, needsAtlasRefRepair };

/**
 * Map each project manifest's BASENAME → its full R2 key. A basename shared by two manifests is
 * AMBIGUOUS, so it is dropped (left as-is) rather than guessed.
 */
export async function manifestBasenameMap(
	clientKey: string,
	projectKey: string,
): Promise<Map<string, string>> {
	const prefix = `${SUB.manifests(clientKey, projectKey)}/`;
	const listed = await listObjects(prefix, 1000);
	const map = new Map<string, string>();
	const ambiguous = new Set<string>();
	for (const key of listed.keys) {
		if (!key.toLowerCase().endsWith('.json')) continue;
		const base = key.slice(key.lastIndexOf('/') + 1);
		if (map.has(base)) ambiguous.add(base);
		else map.set(base, key);
	}
	for (const base of ambiguous) map.delete(base);
	return map;
}

/**
 * A Sheet-Maker sheet's manifest lives under its OWN output folder
 * (`<client>/<project>/sheets/<name>/atlas_manifest_<name>.json`), NOT under `manifests/` — so
 * {@link manifestBasenameMap} never sees it and a clip that stored just the basename stays
 * unrepaired. Derive the sheet folder from the Sheet-Maker naming convention and let
 * `resolveManifestKey` list that one folder for the real key. Listing the folder (rather than
 * trusting the derived filename) also covers a sheet whose manifest was written under a different
 * name. Returns null when there is no such sheet.
 */
async function sheetManifestForBasename(
	clientKey: string,
	projectKey: string,
	base: string,
): Promise<string | null> {
	const match = /^atlas_manifest_(.+)\.json$/i.exec(base);
	if (!match) return null;
	return resolveManifestKey(`${SUB.sheets(clientKey, projectKey)}/${match[1]}`);
}

/**
 * A per-(client, project) resolver that maps any repairable atlas ref to the full `.json` manifest
 * key the editor-art export registers textures under. Unresolvable refs come back untouched, so a
 * repair can only ever make a ref MORE specific.
 *
 * Caches every answer (including the `manifests/` listing, fetched at most once and only when a
 * bare basename actually shows up), so a ref reused across clips/symbols/states costs one lookup.
 */
export function createAtlasRefResolver(
	clientKey: string,
	projectKey: string,
): (ref: string) => Promise<string> {
	const cache = new Map<string, string>();
	let byBasename: Map<string, string> | null = null;

	return async (ref: string): Promise<string> => {
		if (!needsAtlasRefRepair(ref)) return ref;
		const cached = cache.get(ref);
		if (cached !== undefined) return cached;

		let resolved = ref;
		if (isBareManifestBasename(ref)) {
			if (!byBasename) byBasename = await manifestBasenameMap(clientKey, projectKey);
			resolved =
				byBasename.get(ref) ?? (await sheetManifestForBasename(clientKey, projectKey, ref)) ?? ref;
		} else {
			// A path that is not a manifest key — a Sheet-Maker output prefix. `resolveManifestKey`
			// lists it and prefers the `atlas_manifest_*` the sheet ships under.
			resolved = (await resolveManifestKey(ref)) ?? ref;
		}

		cache.set(ref, resolved);
		return resolved;
	};
}
