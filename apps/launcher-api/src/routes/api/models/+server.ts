import { json } from '@sveltejs/kit';
import { requireModelAccess } from '$lib/server/modelAccess';
import { listModels } from '$lib/server/modelViewer';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** The project's models: `{ models: [{ id, doc, etag }] }` (`doc` null when its model.json is unreadable). */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireModelAccess(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	return json(
		{ models: await listModels(clientKey, projectKey) },
		{ headers: { 'cache-control': 'no-store' } },
	);
};
