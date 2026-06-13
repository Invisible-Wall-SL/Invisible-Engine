import { json } from '@sveltejs/kit';
import { SUB } from '$lib/server/projectPaths';
import { getObjectText, listAllKeys } from '$lib/server/r2';
import { atlasRegionNames } from '$lib/server/spine';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * List the project's packed atlases (from the spines prefix) with their region
 * names, so the Rigger can (a) bind a NEW rig to an existing atlas folder and
 * (b) attach packed images to slots. Gated by `rigger` access.
 *
 * Returns `{ atlases: [{ folder, atlas_file, dir, regions }] }` where `dir` is the
 * base64url of the bundle folder (the same token `/spine/file` + `/api/rigger/save`
 * use) and `folder` is the human-readable relative path under `<spines>/`.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const root = `${SUB.spines(clientKey, projectKey)}/`;
	const keys = await listAllKeys(root);
	const atlasKeys = keys.filter((k) => k.toLowerCase().endsWith('.atlas'));

	const atlases = [];
	for (const key of atlasKeys) {
		const rel = key.slice(root.length); // e.g. "symbols/symbols.atlas"
		const slash = rel.lastIndexOf('/');
		const folder = slash === -1 ? '' : rel.slice(0, slash);
		const atlas_file = slash === -1 ? rel : rel.slice(slash + 1);
		const text = await getObjectText(key);
		if (text === null) continue;
		atlases.push({
			folder,
			atlas_file,
			dir: Buffer.from(folder, 'utf8').toString('base64url'),
			regions: atlasRegionNames(text),
		});
	}
	atlases.sort((a, b) => a.folder.localeCompare(b.folder));
	return json({ atlases });
};
