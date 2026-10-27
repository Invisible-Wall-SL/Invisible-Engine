import { loadRegionSet } from './editorRegions';
import { SUB } from './projectPaths';
import { listObjects } from './r2';

export interface FxAtlas {
	/** Manifest R2 key — the value a layer keeps as `art.assetKey`. */
	manifestKey: string;
	label: string;
	regions: string[];
}

const basename = (k: string): string => {
	const i = k.lastIndexOf('/');
	return i === -1 ? k : k.slice(i + 1);
};

/**
 * The atlases an effect layer may draw from: every manifest under the project's `manifests/` that
 * resolves with regions and a packed page. `/fx`'s picker and the Director FX adapter list the same
 * set, so what an agent may bind is what a person may pick.
 */
export async function listFxAtlases(clientKey: string, projectKey: string): Promise<FxAtlas[]> {
	const manifestsPrefix = `${SUB.manifests(clientKey, projectKey)}/`;
	const listed = await listObjects(manifestsPrefix, 500);
	const manifestKeys = listed.keys.filter((k) => k.toLowerCase().endsWith('.json'));

	const atlases: FxAtlas[] = [];
	for (const manifestKey of manifestKeys) {
		const rs = await loadRegionSet(manifestKey);
		if (!rs.regions.length || !rs.pageKey) continue; // unusable (no regions or no page)
		atlases.push({
			manifestKey,
			label: basename(manifestKey)
				.replace(/^atlas_manifest_/, '')
				.replace(/\.json$/i, ''),
			regions: rs.regions.map((r) => r.name),
		});
	}
	atlases.sort((a, b) => a.label.localeCompare(b.label));
	return atlases;
}
