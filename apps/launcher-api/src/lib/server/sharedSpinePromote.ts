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
	ConflictError,
	copyObject,
	deleteObjects,
	getObjectTextWithEtag,
	listAllKeys,
	objectExists,
	precondition,
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
const BUNDLE_SOURCE_SIDECAR = 'source.json';
/** The namespace bonus imports promote under (`projectBonusImport.importedSpineBundle`). */
const IMPORTED_ROOT = 'imported';

/**
 * Copy `<client>/<project>/spines/<bundle>` → `_shared/spines/<as>` (`as` defaults to the bundle's
 * own name) and merge its entry into the shared `skeletons.json`, creating that index if this is the
 * first promotion. A bonus import promotes under `imported/<project>/<bundle>`, so it never
 * overwrites another project's shared bundle of the same name.
 *
 * Overwrites an existing shared bundle of the same name — the admin UI warns first. Stale files
 * from a previous promotion of the SAME bundle are pruned, so a rig that dropped a page doesn't
 * leave the orphan behind for the atlas to trip over.
 */
export async function promoteSpineToShared(
	clientKey: string,
	projectKey: string,
	bundle: string,
	as: string = bundle,
): Promise<{ entry: SkeletonIndexEntry; files: number; replaced: boolean }> {
	if (as === bundle && (as === IMPORTED_ROOT || as.startsWith(`${IMPORTED_ROOT}/`))) {
		// The prune below would delete every bonus import's promoted bundles under it.
		throw new PromoteError(`'${bundle}' is reserved for bonus imports; rename the bundle first.`);
	}
	const srcPrefix = spineBundlePath(clientKey, projectKey, bundle);
	const destPrefix = spineBundleSharedPath(as);

	// The index entry is what makes a folder of files a loadable bundle — it names which file is
	// the skeleton and which is the atlas. A bundle the project's own index doesn't list cannot
	// be promoted, because nothing downstream could resolve it either.
	const own = (await loadSkeletonIndex(clientKey, projectKey)).find((e) => e.folder === bundle);
	if (!own) {
		throw new PromoteError(
			`'${bundle}' has no entry in this project's spines/skeletons.json, so it isn't a loadable ` +
				'bundle yet. Open it in the Rigger and save (or re-sync its atlas) first.',
		);
	}
	const entry: SkeletonIndexEntry =
		as === bundle ? own : { ...own, folder: as, dir_b64: Buffer.from(as).toString('base64url') };

	const srcKeys = await listAllKeys(`${srcPrefix}/`);
	if (srcKeys.length === 0) throw new PromoteError(`'${bundle}' has no files under ${srcPrefix}/.`);
	for (const required of [entry.skeleton_file, entry.atlas_file]) {
		if (!(await objectExists(`${srcPrefix}/${required}`))) {
			throw new PromoteError(`'${bundle}' is missing '${required}' — the bundle is incomplete.`);
		}
	}

	const replaced = await objectExists(`${destPrefix}/${entry.atlas_file}`);

	// R2-side copies: the page textures are the heavy objects and never enter this process.
	// Never the `source.json` sidecar: it names the authoring project's sheet, and every read of
	// a bundle re-derives it from that sheet when it drifts (`ensureBundleAtlasFresh`) — so a
	// re-pack in that project would rewrite the shared copy, the reference this module refuses.
	const written = new Set<string>();
	for (const key of srcKeys) {
		if (key === `${srcPrefix}/${BUNDLE_SOURCE_SIDECAR}`) continue;
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
 * A conditional read-modify-write: the index is written `If-Match` the ETag it was read with
 * (`If-None-Match` when there is none yet), and a lost race re-reads and retries, so two promotions
 * at once (an admin's and a bonus import's) never drop each other's entry. It preserves every other
 * entry rather than rewriting the file wholesale.
 */
async function mergeSharedIndex(entry: SkeletonIndexEntry): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		let skeletons: SkeletonIndexEntry[] = [];
		const existing = await getObjectTextWithEtag(SHARED_INDEX_KEY);
		if (existing) {
			let parsed: { skeletons?: unknown };
			try {
				parsed = JSON.parse(existing.text) as { skeletons?: unknown };
			} catch {
				// Rewriting it would drop every other project's entry (the engine mark among them).
				throw new PromoteError(`${SHARED_INDEX_KEY} does not parse; fix it before promoting.`);
			}
			if (Array.isArray(parsed.skeletons)) skeletons = parsed.skeletons as SkeletonIndexEntry[];
		}
		const next = [...skeletons.filter((e) => e.folder !== entry.folder), entry].sort((a, b) =>
			a.folder.localeCompare(b.folder),
		);
		try {
			await putObjectText(
				SHARED_INDEX_KEY,
				JSON.stringify({ skeletons: next }, null, '\t'),
				'application/json',
				precondition(existing ? (existing.etag ?? undefined) : null),
			);
			return;
		} catch (e) {
			if (!(e instanceof ConflictError) || attempt >= 4) throw e;
		}
	}
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
