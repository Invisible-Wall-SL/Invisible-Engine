import { error, json } from '@sveltejs/kit';
import { isModelClass } from 'constants-shared/modelTiers';
import { conflictJson } from '$lib/server/conflict';
import { objectOrNull, readJson } from '$lib/server/http';
import { requireModelAccess } from '$lib/server/modelAccess';
import { isModelId } from '$lib/server/modelStorage';
import { saveModelSettings } from '$lib/server/modelViewer';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Save a model's settings. Body: `{ id, baseEtag, class, overrides, lodScreenSize }` — `baseEtag`
 * is REQUIRED: the `model.json` ETag the author loaded. There is no force: a model that changed
 * under the author (a new master, another author's settings) is reloaded, never overwritten.
 *
 * 200 `{ doc, etag, deriveInputs }`; 409 `{ error: 'conflict', message }` when the model changed
 * since it was loaded; 422 `{ error, issues }` when the master is not a valid model of the new
 * class; 404 when the model or its master is gone.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const user = await requireModelAccess(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const body = objectOrNull(await readJson(request)) ?? {};
	if (!isModelId(body.id)) throw error(400, 'Expected an `id` in lower snake case.');
	if (!isModelClass(body.class)) throw error(400, 'Expected a model `class`.');
	if (typeof body.baseEtag !== 'string' || !body.baseEtag)
		throw error(400, 'Expected `baseEtag`: the model.json ETag you loaded.');

	const result = await saveModelSettings(
		clientKey,
		projectKey,
		body.id,
		{ class: body.class, overrides: body.overrides, lodScreenSize: body.lodScreenSize },
		body.baseEtag,
	);
	if (result.ok)
		return json({ doc: result.doc, etag: result.etag, deriveInputs: result.deriveInputs });
	if (result.status === 409) return conflictJson(result.error, { okFlag: false });
	return json(
		{ error: result.error, ...(result.issues ? { issues: result.issues } : {}) },
		{ status: result.status },
	);
};
