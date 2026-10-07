import { json } from '@sveltejs/kit';
import { SUB } from '$lib/server/projectPaths';
import { reindexProjectSkeletons, writeSkeletonsIndex } from '$lib/server/rigReindex';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Rebuild `<client>/<project>/rigs/skeletons.json` from whatever is currently in
 * R2 under the project's rigs prefix. This is the FINAL step after the browser
 * has PUT the rig files: the server scans the uploaded objects (reading `.atlas`
 * / skeleton heads back from R2) and writes a byte-compatible index — never the
 * client. Safe to call standalone to re-derive the index for an existing project.
 *
 * A skeleton folder with no `.atlas` is not dropped: its atlas is re-derived from `source.json`
 * when it has one (`rederived`), else its prior entry is kept (`preserved`). `atlasMissing` names
 * the folders still without an atlas — an upload that forgot its `.atlas` shows up there.
 */
export const POST: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		forbiddenMessage: 'Your role does not have access to the Invisible Editor.',
	});

	const rigsPrefix = SUB.spines(clientKey, projectKey);
	// `prefix` written into the index === the slug-normalized rigs root the
	// viewer compares against (the script's PREFIX is the same string).
	const outcome = await reindexProjectSkeletons(clientKey, projectKey, rigsPrefix);
	await writeSkeletonsIndex(rigsPrefix, outcome.index);

	return json({
		ok: true,
		prefix: outcome.index.prefix,
		count: outcome.index.skeletons.length,
		rederived: outcome.rederivedFolders.length,
		preserved: outcome.preservedFolders.length,
		atlasMissing: outcome.atlasMissingFolders,
	});
};
