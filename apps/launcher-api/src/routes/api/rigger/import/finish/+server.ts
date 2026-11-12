import { error, json } from '@sveltejs/kit';
import { jsonObjectOrNull } from '$lib/server/http';
import { SUB } from '$lib/server/projectPaths';
import { ConflictError, headObject, precondition, putObjectText } from '$lib/server/r2';
import { reindexProjectSkeletons, writeSkeletonsIndex } from '$lib/server/rigReindex';
import { importAtlasPages } from '$lib/server/riggerImport';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Finish an import begun by `/api/rigger/import`, after the browser has PUT the pages: check the
 * claim and every page the atlas names are in the folder, write `<name>.atlas` and reindex, which
 * is what lists the rig. The atlas is a conditional create, so this can only complete a folder that
 * has none — never replace an existing rig's atlas. `rigger`-gated.
 *
 * Body: `{ name, projectKey, atlas }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');
	const mismatch = scopeMismatch(body.projectKey, projectKey, { required: true });
	if (mismatch) return mismatch;
	const name = (typeof body.name === 'string' ? body.name : '')
		.trim()
		.replace(/[^A-Za-z0-9_-]/g, '_');
	if (!name) throw error(400, 'missing rig name');
	const atlas = importAtlasPages(body.atlas);
	if (!atlas.ok) throw error(atlas.status, atlas.message);

	const rigsPrefix = SUB.spines(clientKey, projectKey);
	const bundle = `${rigsPrefix}/${name}`;
	if (!(await headObject(`${bundle}/${name}.irig`)))
		throw error(404, `no import of "${name}" is in progress — import it again`);
	for (const page of atlas.pages) {
		if (!(await headObject(`${bundle}/${page}`)))
			throw error(400, `the page "${page}" did not upload — import it again`);
	}
	try {
		await putObjectText(
			`${bundle}/${name}.atlas`,
			atlas.text,
			'text/plain; charset=utf-8',
			precondition(null),
		);
	} catch (e) {
		if (e instanceof ConflictError) throw error(409, `"${name}" already has an atlas`);
		throw e;
	}

	const outcome = await reindexProjectSkeletons(clientKey, projectKey, rigsPrefix);
	await writeSkeletonsIndex(rigsPrefix, outcome.index);
	return json({
		ok: true,
		dir: Buffer.from(name, 'utf8').toString('base64url'),
		stem: name,
		count: outcome.index.skeletons.length,
	});
};
