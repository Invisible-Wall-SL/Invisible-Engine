import { error } from '@sveltejs/kit';

import { referencedArtRefs } from './editorArtExport';
import { loadRegionSet } from './editorRegions';
import { loadDoc } from './editorStorage';
import { r2Slug } from './projectPaths';
import { isKeyAllowed } from './toolScope';

/**
 * THE ART A PROJECT REFERENCES, as a read allowance for the Scene Editor.
 *
 * The editor's art endpoints read only under the project's own prefix and the shared library. But a
 * project's doc — and above all the SHARED component defs it places (`hudReadout`, `featureCard`) —
 * can name an atlas that lives in ANOTHER project of the same client: the defs were authored there.
 * The game is fine (the export copies that art into the project's own `deploy/editor-art/`), while
 * the editor 403'd the same sheet and drew every such frame as a grey placeholder, in every project
 * that placed the def, new or old.
 *
 * This set is the export's own reference walk (`referencedArtRefs`), so the editor may read exactly
 * the art the game ships — never anything the project does not reference. It is held to the
 * project's CLIENT: a doc that names another client's key gains nothing here.
 */
export type ArtScope = {
	/** Exact keys: atlas manifests, their atlas pages, plain images. */
	keys: Set<string>;
	/** Spine bundle folders — any file under one is allowed. */
	prefixes: string[];
};

const TTL_MS = 60_000;
/** A denial recomputes the set first — unless it was computed this recently. */
const RECHECK_MS = 2_000;
const cache = new Map<string, { at: number; scope: Promise<ArtScope> }>();

/** Keep only keys under the client's own prefix. Pure, for the fixture. */
export const withinClient = (keys: Iterable<string>, client: string): string[] => {
	const own = `${r2Slug(client)}/`;
	return [...keys].filter((key) => key.startsWith(own) && !key.includes('..'));
};

/** Does the scope allow this key? Pure, for the fixture. */
export const artScopeAllows = (scope: ArtScope, key: string): boolean =>
	!key.includes('..') && (scope.keys.has(key) || scope.prefixes.some((p) => key.startsWith(p)));

const computeArtScope = async (client: string, project: string): Promise<ArtScope> => {
	const refs = await referencedArtRefs(await loadDoc(client, project), project);
	const manifests = withinClient(refs.manifestKeys, client);
	const pages = await Promise.all(
		manifests.map(async (key) => (await loadRegionSet(key, client, project)).pageKey),
	);
	return {
		keys: new Set([
			...manifests,
			...withinClient(pages.filter(Boolean), client),
			...withinClient(refs.imageKeys, client),
		]),
		prefixes: withinClient([...refs.spineKeys, ...refs.spineFallbackKeys], client).map((key) =>
			key.endsWith('/') ? key : `${key}/`,
		),
	};
};

const artScope = (client: string, project: string, fresh: boolean): Promise<ArtScope> => {
	const id = `${client}\u0000${project}`;
	const hit = cache.get(id);
	const age = hit ? Date.now() - hit.at : Infinity;
	if (hit && age < (fresh ? RECHECK_MS : TTL_MS)) return hit.scope;
	const scope = computeArtScope(client, project);
	cache.set(id, { at: Date.now(), scope });
	scope.catch(() => cache.delete(id));
	return scope;
};

/** Is `key` readable: inside the scope's prefixes, or art the project references? */
export async function isProjectArtAllowed(
	key: string,
	prefixes: string[],
	client: string,
	project: string,
): Promise<boolean> {
	if (isKeyAllowed(key, prefixes)) return true;
	if (!key || key.includes('..') || key.startsWith('/')) return false;
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
