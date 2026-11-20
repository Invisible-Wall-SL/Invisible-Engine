import { error, json } from '@sveltejs/kit';
import { RIG3D_SIDECAR } from '$lib/rig3d';
import { jsonObjectOrNull } from '$lib/server/http';
import { SUB } from '$lib/server/projectPaths';
import { deleteObject, deleteObjects, getObjectText, listAllKeys } from '$lib/server/r2';
import { sidecarOwner } from '$lib/server/riggerIrigWrite';
import { isBundleSidecar } from '$lib/server/rigIndex';
import { reindexProjectSkeletons, writeSkeletonsIndex } from '$lib/server/rigReindex';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

// Files that ARE a skeleton — if one of these remains in a bundle after the delete,
// we leave the rest of the bundle alone (it still backs another rig / the artist's
// source). Anything else (`.atlas`, `.png`, …) is a support file we may purge once the
// last skeleton in a dedicated bundle dir is gone. The bundle's own JSON sidecars end in `.json`
// but are not skeletons; counted as one, they kept a deleted rig's folder (page, atlas and all)
// alive for good.
const SKELETON_EXT = ['.irig', '.skel', '.json'];
const isSkeleton = (key: string) =>
	!isBundleSidecar(key.slice(key.lastIndexOf('/') + 1)) &&
	SKELETON_EXT.some((e) => key.toLowerCase().endsWith(e));

/**
 * Delete a Rigger skeleton from R2 and rebuild the project's `skeletons.json` (preserving, so an
 * unrelated atlas-less rig stays listed; the deleted file is never carried forward).
 * Deletes ONLY the named skeleton file (never a sibling source `.json`/`.skel` that
 * belongs to another rig). If that leaves a dedicated bundle dir with no skeleton at
 * all (a from-scratch rig = `spines/<name>/<name>.irig` + its `.atlas`/page), the now-
 * orphaned support files in that exact dir are purged too. The rigs root is never
 * purged. Gated by `rigger` access; path-guarded.
 *
 * A `.irig`'s 3D data (`rig3d.json`, naming it) goes with it, first: left behind, it would be read
 * as the 3D data of the next `.irig` saved under that name.
 *
 * Body: `{ dir: <base64url bundle dir, '' = rigs root>, skeleton_file: <file name> }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');

	const dirB64 = typeof body.dir === 'string' ? body.dir : '';
	const skeletonFile = typeof body.skeleton_file === 'string' ? body.skeleton_file : '';
	if (!skeletonFile) throw error(400, 'missing skeleton_file');

	let dir = '';
	if (dirB64) {
		try {
			dir = Buffer.from(dirB64, 'base64url').toString('utf8');
		} catch {
			throw error(400, 'bad dir');
		}
	}
	if (dir.includes('..') || skeletonFile.includes('..') || skeletonFile.includes('/'))
		throw error(403, 'forbidden');

	const rigsPrefix = SUB.spines(clientKey, projectKey);
	const bundlePrefix = dir ? `${rigsPrefix}/${dir}` : rigsPrefix;

	const irig = /\.irig$/i.exec(skeletonFile);
	if (irig) {
		const rig3dKey = `${bundlePrefix}/${RIG3D_SIDECAR}`;
		const text = await getObjectText(rig3dKey);
		if (text !== null && sidecarOwner(text) === skeletonFile.slice(0, irig.index))
			await deleteObject(rig3dKey);
	}
	await deleteObject(`${bundlePrefix}/${skeletonFile}`);

	// Purge an orphaned dedicated bundle: only when this is a named sub-dir (never the
	// rigs root) and no skeleton remains in it.
	let purged = 0;
	if (dir) {
		const remaining = await listAllKeys(`${bundlePrefix}/`);
		if (remaining.length && !remaining.some(isSkeleton)) {
			await deleteObjects(remaining);
			purged = remaining.length;
		}
	}

	const { index } = await reindexProjectSkeletons(clientKey, projectKey, rigsPrefix);
	await writeSkeletonsIndex(rigsPrefix, index);

	return json({ ok: true, purged, count: index.skeletons.length });
};
