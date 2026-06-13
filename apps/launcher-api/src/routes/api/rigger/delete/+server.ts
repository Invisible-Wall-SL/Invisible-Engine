import { error, json } from '@sveltejs/kit';
import { SUB } from '$lib/server/projectPaths';
import { deleteObject, deleteObjects, listAllKeys, putObjectText } from '$lib/server/r2';
import { buildSkeletonsIndex } from '$lib/server/spineIndex';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

// Files that ARE a skeleton — if one of these remains in a bundle after the delete,
// we leave the rest of the bundle alone (it still backs another rig / the artist's
// source). Anything else (`.atlas`, `.png`, …) is a support file we may purge once the
// last skeleton in a dedicated bundle dir is gone.
const SKELETON_EXT = ['.irig', '.skel', '.json'];
const isSkeleton = (key: string) => SKELETON_EXT.some((e) => key.toLowerCase().endsWith(e));

/**
 * Delete a Rigger skeleton from R2 and rebuild the project's `skeletons.json`.
 * Deletes ONLY the named skeleton file (never a sibling source `.json`/`.skel` that
 * belongs to another rig). If that leaves a dedicated bundle dir with no skeleton at
 * all (a from-scratch rig = `spines/<name>/<name>.irig` + its `.atlas`/page), the now-
 * orphaned support files in that exact dir are purged too. The spines root is never
 * purged. Gated by `rigger` access; path-guarded.
 *
 * Body: `{ dir: <base64url bundle dir, '' = spines root>, skeleton_file: <file name> }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
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
	if (dir.includes('..') || skeletonFile.includes('..') || skeletonFile.includes('/')) throw error(403, 'forbidden');

	const spinesPrefix = SUB.spines(clientKey, projectKey);
	const bundlePrefix = dir ? `${spinesPrefix}/${dir}` : spinesPrefix;

	await deleteObject(`${bundlePrefix}/${skeletonFile}`);

	// Purge an orphaned dedicated bundle: only when this is a named sub-dir (never the
	// spines root) and no skeleton remains in it.
	let purged = 0;
	if (dir) {
		const remaining = await listAllKeys(`${bundlePrefix}/`);
		if (remaining.length && !remaining.some(isSkeleton)) {
			await deleteObjects(remaining);
			purged = remaining.length;
		}
	}

	const index = await buildSkeletonsIndex(spinesPrefix, spinesPrefix);
	await putObjectText(`${spinesPrefix}/skeletons.json`, JSON.stringify(index), 'application/json');

	return json({ ok: true, purged, count: index.skeletons.length });
};
