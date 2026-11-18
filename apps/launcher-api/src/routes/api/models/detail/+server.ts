import { error, json } from '@sveltejs/kit';
import { requireModelAccess } from '$lib/server/modelAccess';
import { isModelId } from '$lib/server/modelStorage';
import { loadModelDetail } from '$lib/server/modelViewer';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * One model as the Invisible Model Viewer opens it (`?id=`): `{ id, doc, etag, derived,
 * deriveInputs }` — its `model.json`, the ETag a write must match, the Viewer's last derive (or
 * null) and the key a current derive would carry. 404 when the project has no such model.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireModelAccess(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const id = url.searchParams.get('id');
	if (!isModelId(id)) throw error(400, 'Expected an `id` in lower snake case.');
	const detail = await loadModelDetail(clientKey, projectKey, id);
	if (!detail) throw error(404, 'This project has no such model.');
	return json(detail, { headers: { 'cache-control': 'no-store' } });
};
