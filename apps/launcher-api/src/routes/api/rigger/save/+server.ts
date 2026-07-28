import { error, json } from '@sveltejs/kit';
import { SUB } from '$lib/server/projectPaths';
import { getObjectText, putObjectText } from '$lib/server/r2';
import { ensureBundleAtlasFresh } from '$lib/server/spineBundleSync';
import {
	reindexSkeletonsPreserving,
	scanSkeletonsIndex,
	type SkeletonsIndex,
} from '$lib/server/spineIndex';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Save a Rigger-edited skeleton to R2 as `<bundle>/<stem>.irig` (Spine 4.2 JSON
 * under our extension) WITHOUT clobbering the artist's source `.json`, then rebuild
 * the project's `skeletons.json` so the saved edit is listed + re-openable in the
 * tool. Gated by `rigger` access; path-guarded; the body must be a real skeleton.
 *
 * Body: `{ dir: <base64url bundle dir, '' = spines root>, stem: <file stem>,
 *          skeleton: <object|string Spine JSON> }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) throw error(400, 'bad body');

	const dirB64 = typeof body.dir === 'string' ? body.dir : '';
	const stem = typeof body.stem === 'string' ? body.stem : '';
	if (!stem) throw error(400, 'missing stem');

	let dir = '';
	if (dirB64) {
		try {
			dir = Buffer.from(dirB64, 'base64url').toString('utf8');
		} catch {
			throw error(400, 'bad dir');
		}
	}
	if (dir.includes('..') || stem.includes('..') || stem.includes('/')) throw error(403, 'forbidden');

	let doc: Record<string, unknown> | null = null;
	const raw = body.skeleton;
	if (typeof raw === 'string') {
		try {
			doc = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			throw error(400, 'skeleton is not valid JSON');
		}
	} else if (raw && typeof raw === 'object') {
		doc = raw as Record<string, unknown>;
	}
	if (!doc || !Array.isArray(doc.bones)) throw error(400, 'body.skeleton is not a skeleton (no bones[])');

	const spinesPrefix = SUB.spines(clientKey, projectKey);
	const bundlePrefix = dir ? `${spinesPrefix}/${dir}` : spinesPrefix;
	const key = `${bundlePrefix}/${stem}.irig`;
	await putObjectText(key, JSON.stringify(doc), 'application/json');

	// Re-derive the index so the new `.irig` is listed — but a naive project-wide rebuild
	// SILENTLY DROPS any skeleton folder whose `.atlas` is missing (deleted / never
	// co-located / a failed sync), un-shipping a working rig and, worse, letting THIS save
	// drop a DIFFERENT atlas-less rig. `reindexSkeletonsPreserving` (a) re-derives a missing
	// atlas from the folder's `source.json`, and (b) preserves the prior entry for any folder
	// it still can't rebuild — never dropping one.
	const outcome = await reindexSkeletonsPreserving({
		scan: () => scanSkeletonsIndex(spinesPrefix, spinesPrefix),
		readPriorIndex: async () => {
			const text = await getObjectText(`${spinesPrefix}/skeletons.json`);
			if (!text) return null;
			try {
				return JSON.parse(text) as SkeletonsIndex;
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

	// The rig we just saved has no atlas AND no source to rebuild one: writing the rebuilt
	// index would list it pointing at a missing atlas (blank in the editor, dropped from the
	// export). Fail LOUDLY instead — the `.irig` is already saved to R2, so no edit is lost;
	// leave the prior index untouched so nothing else is dropped either.
	if (outcome.atlasMissingFolders.includes(dir)) {
		throw error(
			400,
			`"${stem}" has no atlas and no source to rebuild it — re-sync an atlas first ` +
				`(⟳ source…), then save again. Your edit was saved to storage and will list once the ` +
				`atlas is restored.`,
		);
	}

	await putObjectText(
		`${spinesPrefix}/skeletons.json`,
		JSON.stringify(outcome.index),
		'application/json',
	);

	return json({
		ok: true,
		key,
		count: outcome.index.skeletons.length,
		rederived: outcome.rederivedFolders,
		preserved: outcome.preservedFolders,
	});
};
