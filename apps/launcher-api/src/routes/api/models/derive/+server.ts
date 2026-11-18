import { error, json } from '@sveltejs/kit';
import { objectOrNull, readJson } from '$lib/server/http';
import { requireModelAccess } from '$lib/server/modelAccess';
import { isModelId, MODEL_ID_RULE } from '$lib/server/modelStorage';
import { deriveModelForViewer } from '$lib/server/modelViewer';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Derive every quality tier of one model from its STORED master and settings, for the Invisible
 * Model Viewer's tier table. Body: `{ id }`. It writes only the Viewer's own
 * `models/<id>/derived/` (never `deploy/`, never `model.json`) and can take a minute on a master
 * with large maps the texture cache has not seen.
 *
 * 200 `{ derived, deriveInputs, docEtag }` (`docEtag`: the `model.json` version it derived); 404
 * when the model or its master is gone; 422 `{ error }` when the master cannot be derived.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const user = await requireModelAccess(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const body = objectOrNull(await readJson(request)) ?? {};
	if (!isModelId(body.id)) throw error(400, `Expected an \`id\`: ${MODEL_ID_RULE}.`);
	const result = await deriveModelForViewer(clientKey, projectKey, body.id);
	if (!result.ok) return json({ error: result.error }, { status: result.status });
	return json({
		derived: result.derived,
		deriveInputs: result.deriveInputs,
		docEtag: result.docEtag,
	});
};
