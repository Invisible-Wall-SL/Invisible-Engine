import { json } from '@sveltejs/kit';
import { SUB } from '$lib/server/projectPaths';
import { putObjectText } from '$lib/server/r2';
import { buildSkeletonsIndex } from '$lib/server/spineIndex';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Rebuild `<client>/<project>/spines/skeletons.json` from whatever is currently in
 * R2 under the project's spines prefix. This is the FINAL step after the browser
 * has PUT the spine files: the server scans the uploaded objects (reading `.atlas`
 * / skeleton heads back from R2) and writes a byte-compatible index — never the
 * client. Safe to call standalone to re-derive the index for an existing project.
 */
export const POST: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		forbiddenMessage: 'Your role does not have access to the Invisible Editor.',
	});

	const spinesPrefix = SUB.spines(clientKey, projectKey);
	// `prefix` written into the index === the slug-normalized spines root the
	// viewer compares against (the script's PREFIX is the same string).
	const index = await buildSkeletonsIndex(spinesPrefix, spinesPrefix);

	await putObjectText(`${spinesPrefix}/skeletons.json`, JSON.stringify(index), 'application/json');

	return json({ ok: true, prefix: index.prefix, count: index.skeletons.length });
};
