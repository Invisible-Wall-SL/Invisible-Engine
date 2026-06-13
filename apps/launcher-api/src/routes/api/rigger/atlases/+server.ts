import { json } from '@sveltejs/kit';
import { loadRegionSet } from '$lib/server/editorRegions';
import { SUB } from '$lib/server/projectPaths';
import { listObjects } from '$lib/server/r2';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const basename = (k: string): string => { const i = k.lastIndexOf('/'); return i === -1 ? k : k.slice(i + 1); };

/**
 * List the project's atlases the Rigger can build a new rig from — sourced from the
 * Atlas Maker / Sheet Maker MANIFESTS (`<project>/manifests/*.json`), the same way
 * the editor finds them (NOT the `spines/` prefix, which is empty for a fresh
 * project). Each entry that has resolvable regions + a page is returned with its
 * manifest key + region names. `rigger`-gated.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const manifestsPrefix = `${SUB.manifests(clientKey, projectKey)}/`;
	const listed = await listObjects(manifestsPrefix, 500);
	const manifestKeys = listed.keys.filter((k) => k.toLowerCase().endsWith('.json'));

	const atlases = [];
	for (const manifestKey of manifestKeys) {
		const rs = await loadRegionSet(manifestKey, clientKey, projectKey);
		if (!rs.regions.length || !rs.pageKey) continue; // unusable (no regions or no page)
		atlases.push({
			manifestKey,
			label: basename(manifestKey).replace(/^atlas_manifest_/, '').replace(/\.json$/i, ''),
			regions: rs.regions.map((r) => r.name),
		});
	}
	atlases.sort((a, b) => a.label.localeCompare(b.label));
	return json({ atlases });
};
