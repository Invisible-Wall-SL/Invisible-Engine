import { json } from '@sveltejs/kit';
import { SESSION_COOKIE } from '$lib/server/auth';
import { CatalogueError, readCatalogue } from '$lib/server/blueprintCatalogue';
import { requirePipelineAccess } from '$lib/server/pipelineAccess';
import type { RequestHandler } from './$types';

/**
 * The Catalogue tab of Invisible Pipeline Changes: the image pipelines Director's agents may use
 * (`atlas.list_blueprints`) and the ones that are not offered yet, with why. Session-gated on the
 * `pipelineChanges` tool, like the other tabs.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const user = await requirePipelineAccess(locals);
	try {
		return json(await readCatalogue(user, cookies.get(SESSION_COOKIE)), {
			headers: { 'cache-control': 'no-store' },
		});
	} catch (err) {
		if (err instanceof CatalogueError) return json({ error: err.message }, { status: err.status });
		throw err;
	}
};
