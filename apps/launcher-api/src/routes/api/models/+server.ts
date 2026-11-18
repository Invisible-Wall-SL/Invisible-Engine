import { json } from '@sveltejs/kit';
import { requireModelAccess } from '$lib/server/modelAccess';
import { listModelIds, loadModelDoc } from '$lib/server/modelStorage';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** The project's models: `{ models: [{ id, doc, etag }] }` (`doc` null when its model.json is unreadable). */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireModelAccess(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const ids = await listModelIds(clientKey, projectKey);
	const models = await Promise.all(
		ids.map(async (id) => {
			const loaded = await loadModelDoc(clientKey, projectKey, id);
			return { id, doc: loaded?.doc ?? null, etag: loaded?.etag ?? null };
		}),
	);
	return json({ models }, { headers: { 'cache-control': 'no-store' } });
};
