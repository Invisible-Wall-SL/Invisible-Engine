import { error } from '@sveltejs/kit';

import { referencedArtRefs } from './editorArtExport';
import { loadRegionSet, ownedByManifest } from './editorRegions';
import { loadDoc } from './editorStorage';
import { DEFAULT_PROJECT_KEY } from './projects';
import { r2Slug, UNASSIGNED_CLIENT } from './projectPaths';
import { isKeyAllowed } from './toolScope';

/**
 * THE ATLASES A PROJECT REFERENCES, as a read allowance for the Scene Editor.
 *
 * The editor's art endpoints read only under the project's own prefix and the shared library. But a
 * project's doc — and above all the SHARED component defs it places (`hudReadout`, `featureCard`) —
 * can name an atlas that lives in ANOTHER project of the same client: the defs were authored there.
 * The game is fine (the export copies that atlas into the project's own `deploy/editor-art/`), while
 * the editor 403'd the same sheet and drew every such frame as a grey placeholder, in every project
 * that placed the def, new or old.
 *
 * Deliberately narrow, because `/api/editor/asset` streams whatever it allows byte for byte:
 * - only keys SHAPED like an atlas manifest (`…/manifests/atlas_manifest_*.json`) that LOAD as one
 *   (regions and all), plus that atlas's own page — never an arbitrary `.json`, image or folder a
 *   doc happens to name;
 * - only within the project's own CLIENT, and never for the shared `unassigned` pseudo-client or
 *   the default project every user lands in, where "the client" is not one customer;
 * - a scope that cannot be built allows nothing (a refusal, never a 500), and is remembered.
 */
export type ArtScope = { keys: Set<string> };

const TTL_MS = 60_000;
/** A refusal recomputes the scope first — unless it was computed this recently. */
const RECHECK_MS = 10_000;
const cache = new Map<string, { at: number; scope: Promise<ArtScope> }>();

/** `<client>/<project>/manifests/atlas_manifest_*.json` — where the Atlas Maker writes one, and only
 *  there (one project segment, no deeper path). */
const ATLAS_MANIFEST = /^[a-z0-9_]+\/[a-z0-9_]+\/manifests\/atlas_manifest_[^/]+\.json$/;
const PAGE_IMAGE = /\.(png|webp|jpe?g|avif|ktx2)$/i;

/**
 * May this atlas's page be read? Its page key is built from the MANIFEST's own fields
 * (`resolvePageKey`), which whoever can write that project can set — so it is trusted only inside the
 * manifest's own project, and only as an image. Pure, for the fixture.
 */
export const pageAllowed = (manifestKey: string, pageKey: string): boolean =>
	ownedByManifest(manifestKey, pageKey) && PAGE_IMAGE.test(pageKey);

/** May this project borrow its client's art at all? Pure, for the fixture. */
export const borrowsClientArt = (client: string, project: string): boolean =>
	r2Slug(client) !== UNASSIGNED_CLIENT && project !== DEFAULT_PROJECT_KEY;

/** The referenced keys that may be atlases of this client — never a `_`-rooted library (`_shared`)
 *  a client name could slug to. Pure, for the fixture. */
export const candidateAtlases = (keys: Iterable<string>, client: string): string[] => {
	const own = `${r2Slug(client)}/`;
	return [...keys].filter(
		(key) =>
			key.startsWith(own) &&
			!key.startsWith('_') &&
			!key.includes('..') &&
			ATLAS_MANIFEST.test(key),
	);
};

/** Does the scope allow this key? Pure, for the fixture. */
export const artScopeAllows = (scope: ArtScope, key: string): boolean =>
	!key.includes('..') && scope.keys.has(key);

const computeArtScope = async (client: string, project: string): Promise<ArtScope> => {
	const keys = new Set<string>();
	const refs = await referencedArtRefs(await loadDoc(client, project), project);
	const atlases = candidateAtlases(refs.manifestKeys, client);
	const sets = await Promise.allSettled(atlases.map((key) => loadRegionSet(key)));
	for (const [index, settled] of sets.entries()) {
		if (settled.status !== 'fulfilled' || settled.value.regions.length === 0) continue;
		keys.add(atlases[index]);
		if (pageAllowed(atlases[index], settled.value.pageKey)) keys.add(settled.value.pageKey);
	}
	return { keys };
};

const artScope = (client: string, project: string, fresh: boolean): Promise<ArtScope> => {
	const now = Date.now();
	for (const [id, entry] of cache) if (now - entry.at > TTL_MS) cache.delete(id);
	const id = `${client}\u0000${project}`;
	const hit = cache.get(id);
	if (hit && now - hit.at < (fresh ? RECHECK_MS : TTL_MS)) return hit.scope;
	// A failed rebuild keeps the last good scope (an R2 blip must not 403 art that was readable);
	// with none, it allows nothing.
	const previous = hit?.scope;
	const scope = computeArtScope(client, project).catch(async (e) => {
		console.warn('[projectArtScope] could not build the art scope', client, project, e);
		return (await previous) ?? { keys: new Set<string>() };
	});
	cache.set(id, { at: now, scope });
	return scope;
};

/** Is `key` readable: inside the scope's prefixes, or an atlas the project references? */
export async function isProjectArtAllowed(
	key: string,
	prefixes: string[],
	client: string,
	project: string,
): Promise<boolean> {
	if (isKeyAllowed(key, prefixes)) return true;
	if (!key || key.includes('..') || key.startsWith('/')) return false;
	if (!borrowsClientArt(client, project)) return false;
	if (artScopeAllows(await artScope(client, project, false), key)) return true;
	// The author may just have bound this art: look again before refusing.
	return artScopeAllows(await artScope(client, project, true), key);
}

/** {@link isProjectArtAllowed}, as a 403. */
export async function assertProjectArt(
	key: string,
	prefixes: string[],
	client: string,
	project: string,
	message = 'forbidden',
): Promise<void> {
	if (!(await isProjectArtAllowed(key, prefixes, client, project))) throw error(403, message);
}
