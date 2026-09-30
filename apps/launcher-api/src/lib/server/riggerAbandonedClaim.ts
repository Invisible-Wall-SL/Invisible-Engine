import {
	ConflictError,
	deleteObjects,
	getObjectText,
	headObject,
	listAllObjects,
	precondition,
	putObjectText,
} from './r2';
import { backupIrigBeforeOverwrite, irigBackupsPrefix } from './riggerIrig';
import { bundleFoldersNamedLike, spineExt, type SkeletonsIndex } from './spineIndex';

/**
 * How long a create's claim may sit with nothing but its page beside it before it counts as
 * abandoned. After the claim a create only lists once and writes a page, an atlas and the index —
 * seconds — so a claim this old belongs to a request that died.
 */
export const ABANDONED_CLAIM_MS = 10 * 60_000;

const PAGE_EXT = new Set(['.png', '.webp', '.jpg', '.jpeg']);

/**
 * Free a rig name held only by an ABANDONED create. `＋ New rig` and upload claim
 * `<spines>/<name>/<name>.irig` first and write the page, the atlas and the index after; a request
 * that dies in between leaves a folder the index never lists (it has no atlas), so nobody can open
 * or delete it — yet it keeps the name, case-insensitively, forever.
 *
 * A folder named like `name` is abandoned when it is not in `skeletons.json`, has no `.atlas`,
 * holds only `<folder>.irig` and page images, and nothing in it was written for
 * {@link ABANDONED_CLAIM_MS}. Such a folder is reclaimed: the `.irig` is copied to the rig's 🕘
 * backups, taken over with `If-Match` on the ETag the listing showed, and only then is the folder
 * deleted. The takeover is what makes two creates reclaiming at once safe — a plain delete by the
 * slower one could remove the claim the faster one has just made on the freed name; with the CAS
 * the slower one's write fails and it deletes nothing.
 *
 * Returns the folders reclaimed. An unreadable index reclaims nothing: it cannot say the folder is
 * unlisted.
 */
export async function reclaimAbandonedClaims(
	clientKey: string,
	projectKey: string,
	spinesPrefix: string,
	name: string,
	now = Date.now(),
): Promise<string[]> {
	const folders = await bundleFoldersNamedLike(spinesPrefix, name);
	if (!folders.length) return [];

	const indexed = await indexedFolders(spinesPrefix);
	if (!indexed) return [];

	const reclaimed: string[] = [];
	for (const folder of folders) {
		if (indexed.has(folder)) continue;
		const folderPrefix = `${spinesPrefix}/${folder}/`;
		const irigKey = `${folderPrefix}${folder}.irig`;
		const objects = await listAllObjects(folderPrefix);
		const abandoned =
			objects.some((o) => o.key === irigKey) &&
			objects.every((o) => {
				const rest = o.key.slice(folderPrefix.length);
				const shape = o.key === irigKey || (!rest.includes('/') && PAGE_EXT.has(spineExt(rest)));
				return shape && o.lastModified > 0 && now - o.lastModified >= ABANDONED_CLAIM_MS;
			});
		if (!abandoned) continue;

		// The takeover must be conditional on the claim JUDGED abandoned. A HEAD alone would read
		// whatever is there now — a fresh claim on the freed name that landed since the listing.
		const listedTag = objects.find((o) => o.key === irigKey)?.etag;
		const head = await headObject(irigKey);
		if (!head?.etag || !listedTag || head.etag.replace(/"/g, '') !== listedTag) continue;
		await backupIrigBeforeOverwrite(
			irigKey,
			irigBackupsPrefix(clientKey, projectKey, folder, folder),
			head.etag,
		);
		try {
			await putObjectText(irigKey, '{}', 'application/json', precondition(head.etag));
		} catch (e) {
			if (e instanceof ConflictError) continue;
			throw e;
		}
		await deleteObjects(objects.map((o) => o.key));
		reclaimed.push(folder);
	}
	if (reclaimed.length) {
		console.warn(`[rigger] reclaimed abandoned rig claim(s) [${reclaimed.join(', ')}]`);
	}
	return reclaimed;
}

/** The folders `skeletons.json` lists; empty when there is none yet, null when it is unreadable. */
async function indexedFolders(spinesPrefix: string): Promise<Set<string> | null> {
	const text = await getObjectText(`${spinesPrefix}/skeletons.json`);
	if (text === null) return new Set();
	try {
		const index = JSON.parse(text) as SkeletonsIndex;
		return new Set(index.skeletons.map((s) => s.folder));
	} catch {
		return null;
	}
}
