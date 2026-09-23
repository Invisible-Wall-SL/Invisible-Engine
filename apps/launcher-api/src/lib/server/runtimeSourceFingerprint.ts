/**
 * A digest of everything `/api/editor/runtime` READS, so the bundle cache can hold a result until
 * the sources actually change instead of expiring on a timer.
 *
 * WHY THIS EXISTS. The assemble costs ~25s for a real project (it was 93s before the concurrency
 * work), and `runtimeBundleCache`'s TTL is measured from when the assemble READ its data — so a
 * 25s assemble is already stale when it lands, is served once, and every boot pays full price. The
 * TTL can only be raised safely if something can say "nothing changed since", and that is this.
 *
 * ⚠️ THE FAILURE MODE THIS MUST NOT HAVE. `runtimeBundleCache` warns at length against exactly this
 * idea, and the warning is right: a fingerprint that misses ONE input tree yields a false HIT — the
 * author saves, the game serves an old bundle, and it looks perfectly healthy. That is the
 * stale-data-that-looks-fine bug in its subtlest form. Three properties answer it:
 *
 *  1. **The tree list is DISCOVERED, not written down.** The per-project half enumerates the
 *     project's subfolders FROM R2 and walks all of them but `deploy/`. Someone adding a new
 *     `SUB.*` folder, or a tool inventing a path nobody updated a constant for, is covered without
 *     anyone remembering to update this file. A hardcoded list is precisely how this goes wrong.
 *  2. **Any doubt returns `null`, which callers must treat as "cannot cache".** A listing error, a
 *     missing bucket, anything unexpected — never a HIT.
 *  3. **It fingerprints CONTENT IDENTITY, not names.** Key + size + lastModified, so overwriting a
 *     doc in place — the ordinary save — changes the digest. A names-only digest would miss every
 *     edit that keeps the filename, i.e. almost all of them.
 *
 * WHY EXCLUDING `deploy/` IS SAFE AND NECESSARY. Necessary: the assemble WRITES its exports there,
 * so including it would change the fingerprint on every run and never hit. Safe: `deploy/` is
 * output, never input — verified by reading every write in the eleven exporter modules, all of
 * which resolve under `SUB.deploy(...)`. If an exporter ever writes outside `deploy/`, this
 * silently stops hitting (slow, not wrong) — the failure lands on the safe side.
 */
import { createHash } from 'node:crypto';
import type { FolderListing, ListedObject } from './r2';

/**
 * Cross-project source trees. These are genuinely read during an assemble — shared spines through
 * `loadSkeletonIndexWithShared`, shared sheets/fonts through the art and font exports, shared
 * component defs through the def resolution — so a change in one can change a project's bundle
 * without anything under that project moving. Listing them costs a few requests; omitting them
 * would buy a false HIT, which is the one outcome worth paying to avoid.
 */
const SHARED_SOURCE_TREES = [
	'_shared/editor-components/',
	'_shared/spines/',
	'_shared/sheets/',
	'_shared/fonts/',
];

/** The assemble's own output, and the one subtree deliberately not fingerprinted. */
const DEPLOY_FOLDER = 'deploy/';

/**
 * The two R2 listings this needs, injectable so the offline fixture can exercise the REAL digest
 * logic against a synthetic bucket. Defaults to the live client; nothing in production passes it.
 * The properties worth testing here — that `deploy/` is excluded, that an in-place overwrite is
 * noticed, that listing order cannot change the digest — are all ones that fail SILENTLY, and a
 * silent failure is a stale game.
 */
export interface FingerprintIo {
	listFolder(prefix: string, token?: string): Promise<FolderListing>;
	listAllObjects(prefix: string): Promise<ListedObject[]>;
	/**
	 * `<client>/<project>/`. Injected alongside the listings for one reason: `projectPaths` pulls in
	 * `engine-layout`, which pulls in a GENERATED file, so importing it statically would make this
	 * module — and therefore its guard — unloadable until the workspace happens to be built. A
	 * correctness guard that only runs after a successful build is a guard that stops running.
	 */
	rootPrefix(clientKey: string, projectKey: string): string;
}

/**
 * The live implementations, imported LAZILY and typed only above. The digest itself is pure — it
 * needs a bucket LISTING, not a bucket — so keeping `./r2` and `./projectPaths` off the module's
 * static import graph is what lets the offline fixture drive it against a synthetic bucket with no
 * bundler, no build, and no AWS client. Never called when a caller injects its own.
 */
async function liveIo(): Promise<FingerprintIo> {
	const [r2, paths] = await Promise.all([import('./r2'), import('./projectPaths')]);
	return {
		listFolder: r2.listFolder,
		listAllObjects: r2.listAllObjects,
		rootPrefix: (c, p) => `${paths.projectPrefix(c, p)}/`,
	};
}

/**
 * A digest of every source object, or `null` when it could not be computed — which callers MUST
 * read as "do not serve from cache" rather than as any kind of value.
 */
export async function runtimeSourceFingerprint(
	clientKey: string,
	projectKey: string,
	injectedIo?: FingerprintIo,
): Promise<string | null> {
	try {
		const io = injectedIo ?? (await liveIo());
		const root = io.rootPrefix(clientKey, projectKey);
		// Discover the project's own subfolders rather than trusting a list. `listFolder` is
		// delimited, so this is one cheap request that returns the folder names without walking
		// their contents — and it is what keeps a newly invented path from being silently missed.
		const folders: string[] = [];
		const rootFiles: { key: string; size: number; lastModified: number }[] = [];
		let token: string | undefined;
		do {
			const page = await io.listFolder(root, token);
			for (const f of page.folders) folders.push(f);
			for (const f of page.files) {
				rootFiles.push({
					key: f.key,
					size: f.size,
					lastModified: f.lastModified ? Date.parse(f.lastModified) || 0 : 0,
				});
			}
			token = page.nextToken;
		} while (token);

		// ⚠️ THE TREE LIST IS SORTED, not just the objects inside each tree. The project's folders are
		// DISCOVERED from a listing, and R2 guarantees no order — so folding them in discovery order
		// let an UNCHANGED project digest differently between two boots, which never hits and quietly
		// makes this whole mechanism a no-op that still looks implemented. Caught by the fixture's
		// reversed-listing case; it read as passing until `check` was made to await.
		const trees = [
			...folders.filter((f) => !f.endsWith(DEPLOY_FOLDER)),
			`editor/${projectKey}/components/`,
			...SHARED_SOURCE_TREES,
		].sort();
		const listings = await Promise.all(trees.map((t) => io.listAllObjects(t)));

		// Sorted per tree so the digest depends on CONTENT, not on the order R2 happened to page
		// results back in — otherwise an unchanged project could fingerprint differently twice and
		// the cache would never hit.
		const hash = createHash('sha256');
		const fold = (label: string, objs: { key: string; size: number; lastModified: number }[]) => {
			hash.update(JSON.stringify(label));
			for (const o of [...objs].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
				hash.update(JSON.stringify([o.key, o.size, o.lastModified]));
			}
		};
		fold(root, rootFiles);
		trees.forEach((t, i) => fold(t, listings[i]));
		return hash.digest('hex');
	} catch (e) {
		// Slow beats wrong: a boot that re-assembles costs seconds, a boot served a stale bundle
		// costs a debugging session (see this module's header).
		console.warn(`[runtime] source fingerprint failed for "${projectKey}" (${e}) — cannot cache`);
		return null;
	}
}
