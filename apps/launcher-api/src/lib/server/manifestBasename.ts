import { SUB } from './projectPaths';
import { listObjects } from './r2';

/**
 * Repair for bare-basename manifest refs — shared by the Flipbook and Symbols ship paths.
 *
 * A clip's `assetKey` / a scoped frame prefix / a sprite cell's scoped ref may name its atlas by
 * the manifest's BARE BASENAME (`atlas_manifest_S_Gem.json`, no path) instead of the full R2 key.
 * The runtime's `isManifestAssetKey` requires a `/`, so a basename ref makes the atlas-scoped
 * frame lookup SKIP — and two clips/symbols reusing a frame name (`frame_0000`) on DISTINCT atlases
 * then collide in the flat bare texture cache (last-loaded sheet wins). The runtime cannot repair
 * this itself (it has no R2 listing to map basename → real key), so the export/assemble layer does
 * it here — the one place every ship-path reader goes through.
 */

/** A manifest ref that names its atlas by bare basename: ends in `.json`, no path segment. */
export const isBareManifestBasename = (ref: string): boolean =>
	!ref.includes('/') && ref.toLowerCase().endsWith('.json');

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

/** Resolve one atlas ref to its full manifest key when it is a bare basename we recognise;
 *  otherwise return it untouched (a correctly-authored full key, or an unknown basename). */
export const canonicalizeAtlasRef = (ref: string, byBasename: Map<string, string>): string =>
	isBareManifestBasename(ref) ? (byBasename.get(ref) ?? ref) : ref;
