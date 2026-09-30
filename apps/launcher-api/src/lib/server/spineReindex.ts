import { getObjectText, putObjectText } from './r2';
import { ensureBundleAtlasFresh } from './spineBundleSync';
import {
	reindexSkeletonsPreserving,
	scanSkeletonsIndex,
	type ReindexOutcome,
	type SkeletonsIndex,
} from './spineIndex';

/**
 * Rebuild a project's `skeletons.json` the one way that never silently drops a rig: a bare scan
 * skips every folder with no `.atlas`, so a save, create, delete or reindex of rig A would
 * un-ship an unrelated atlas-less rig B. `reindexSkeletonsPreserving`, wired to R2 here, first
 * re-derives a missing atlas from the folder's `source.json`, then carries a still-atlas-less
 * folder's prior entry forward. Every writer of `skeletons.json` goes through this; the caller
 * decides from `atlasMissingFolders` whether its own folder is broken, then writes the index with
 * {@link writeSkeletonsIndex}.
 */
export async function reindexProjectSkeletons(
	clientKey: string,
	projectKey: string,
	spinesPrefix: string,
): Promise<ReindexOutcome> {
	return reindexSkeletonsPreserving({
		scan: () => scanSkeletonsIndex(spinesPrefix, spinesPrefix),
		readPriorIndex: async () => {
			const prior = await getObjectText(`${spinesPrefix}/skeletons.json`);
			if (!prior) return null;
			try {
				return JSON.parse(prior) as SkeletonsIndex;
			} catch {
				return null;
			}
		},
		rederiveAtlas: async (folder, atlasFile) => {
			const folderPrefix = folder ? `${spinesPrefix}/${folder}` : spinesPrefix;
			const res = await ensureBundleAtlasFresh(clientKey, projectKey, folderPrefix, atlasFile, {
				force: true,
			});
			return !!res;
		},
	});
}

export async function writeSkeletonsIndex(
	spinesPrefix: string,
	index: SkeletonsIndex,
): Promise<void> {
	await putObjectText(`${spinesPrefix}/skeletons.json`, JSON.stringify(index), 'application/json');
}
