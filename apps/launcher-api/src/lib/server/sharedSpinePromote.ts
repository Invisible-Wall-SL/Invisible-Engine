/**
 * Promote a project's spine bundle into the CROSS-PROJECT library at `_shared/spines/<bundle>`.
 *
 * WHY THIS EXISTS. `_shared/spines/` was a read-only root: `resolveBundlePrefix` and
 * `listProjectAssets` fall back to it, but the only thing that ever WROTE it was the one-off
 * June 2026 unified-repo migration. Every producer — the Rigger especially — writes
 * project-scoped bundles (`riggerBundlePrefix` → `<client>/<project>/spines/<dir>`). So the
 * engine boot mark, which is global by definition and must resolve shared-only, had nowhere to
 * come from. This is the missing writer, modelled on the shared font / blueprint libraries.
 *
 * COPY, DON'T REFERENCE. The shared bundle is a snapshot, not a pointer into the project that
 * happened to author it. The engine mark opens EVERY game, so it must not break when that
 * project is renamed, re-scoped, or deleted — and a client editing their own project must not
 * be able to change what plays in front of everyone else's game.
 *
 * DISTINCT FROM `_shared/rigs/`. That library holds skeleton DOCS only (bones/slots/skins/
 * animations — see `api/rigger/rigs/save`), with no atlas and no page textures; it is something
 * you APPLY onto art in the Rigger, and nothing can render it. A loadable bundle is what this
 * module copies: skeleton + `.atlas` + every page image.
 */
import {
	copyObject,
	deleteObjects,
	getObjectText,
	listAllKeys,
	objectExists,
	putObjectText,
} from './r2';
import { spineBundlePath, spineBundleSharedPath } from './projectPaths';
import { loadSkeletonIndex, type SkeletonIndexEntry } from './spine';

/** Raised for every "you asked for something that isn't there" case, so the caller can turn
 * the whole family into one 400 with a message worth reading. */
export class PromoteError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PromoteError';
	}
}

const SHARED_INDEX_KEY = '_shared/spines/skeletons.json';

/**
 * Copy `<client>/<project>/spines/<bundle>` → `_shared/spines/<bundle>` and merge its entry
 * into the shared `skeletons.json`, creating that index if this is the first promotion.
 *
 * Overwrites an existing shared bundle of the same name — the admin UI warns first. Stale files
 * from a previous promotion of the SAME bundle are pruned, so a rig that dropped a page doesn't
 * leave the orphan behind for the atlas to trip over.
 */
export async function promoteSpineToShared(
	clientKey: string,
	projectKey: string,
	bundle: string,
): Promise<{ entry: SkeletonIndexEntry; files: number; replaced: boolean }> {
	const srcPrefix = spineBundlePath(clientKey, projectKey, bundle);
	const destPrefix = spineBundleSharedPath(bundle);

	// The index entry is what makes a folder of files a loadable bundle — it names which file is
	// the skeleton and which is the atlas. A bundle the project's own index doesn't list cannot
	// be promoted, because nothing downstream could resolve it either.
	const entry = (await loadSkeletonIndex(clientKey, projectKey)).find((e) => e.folder === bundle);
	if (!entry) {
		throw new PromoteError(
			`'${bundle}' has no entry in this project's spines/skeletons.json, so it isn't a loadable ` +
				'bundle yet. Open it in the Rigger and save (or re-sync its atlas) first.',
		);
	}

	const srcKeys = await listAllKeys(`${srcPrefix}/`);
	if (srcKeys.length === 0) throw new PromoteError(`'${bundle}' has no files under ${srcPrefix}/.`);
	for (const required of [entry.skeleton_file, entry.atlas_file]) {
		if (!(await objectExists(`${srcPrefix}/${required}`))) {
			throw new PromoteError(`'${bundle}' is missing '${required}' — the bundle is incomplete.`);
		}
	}

	const replaced = await objectExists(`${destPrefix}/${entry.atlas_file}`);

	// R2-side copies: the page textures are the heavy objects and never enter this process.
	const written = new Set<string>();
	for (const key of srcKeys) {
		const destKey = `${destPrefix}${key.slice(srcPrefix.length)}`;
		await copyObject(key, destKey);
		written.add(destKey);
	}

	// Prune leftovers from an earlier promotion of this same bundle only — never the whole
	// shared root, which holds other people's bundles.
	const stale = (await listAllKeys(`${destPrefix}/`)).filter((k) => !written.has(k));
	if (stale.length > 0) await deleteObjects(stale);

	await mergeSharedIndex(entry);
	return { entry, files: written.size, replaced };
}

/**
 * Insert-or-replace one entry in `_shared/spines/skeletons.json`, keyed by `folder`.
 *
 * Read-modify-write on a shared index is a lost-update risk if two admins promote at once, but
 * this is an admin-only action taken a handful of times in a project's life; a lease here would
 * be ceremony. It does preserve every other entry rather than rewriting the file wholesale.
 */
async function mergeSharedIndex(entry: SkeletonIndexEntry): Promise<void> {
	let skeletons: SkeletonIndexEntry[] = [];
	const existing = await getObjectText(SHARED_INDEX_KEY);
	if (existing) {
		try {
			const parsed = JSON.parse(existing) as { skeletons?: SkeletonIndexEntry[] };
			if (Array.isArray(parsed.skeletons)) skeletons = parsed.skeletons;
		} catch {
			// An unparseable shared index is treated as empty rather than throwing: refusing to
			// promote because of somebody else's corrupt file helps nobody, and we rewrite it whole.
		}
	}
	const next = [...skeletons.filter((e) => e.folder !== entry.folder), entry].sort((a, b) =>
		a.folder.localeCompare(b.folder),
	);
	await putObjectText(
		SHARED_INDEX_KEY,
		JSON.stringify({ skeletons: next }, null, '\t'),
		'application/json',
	);
}

/** Bundle names in one project's `spines/` that are listed in its `skeletons.json` — i.e. the
 * ones that are actually promotable. Powers the admin picker. */
export async function listPromotableBundles(
	clientKey: string,
	projectKey: string,
): Promise<{ folder: string; name: string }[]> {
	return (await loadSkeletonIndex(clientKey, projectKey))
		.filter((e) => e.folder)
		.map((e) => ({ folder: e.folder, name: e.name || e.folder }))
		.sort((a, b) => a.name.localeCompare(b.name));
}
