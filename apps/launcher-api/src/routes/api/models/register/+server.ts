import { error, json } from '@sveltejs/kit';
import { isModelClass } from 'constants-shared/modelTiers';
import { objectOrNull, readJson } from '$lib/server/http';
import { requireModelAccess } from '$lib/server/modelAccess';
import { isModelId, registerModelUpload } from '$lib/server/modelStorage';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Commit a staged upload as a model's master. Body: `{ id, upload, class, baseEtag }` — `baseEtag`
 * is REQUIRED: the `model.json` ETag the author loaded, or `null` for a new model. A new endpoint has
 * no pre-CAS tabs to keep working, so an unguarded write is refused rather than allowed.
 *
 * 200 `{ doc, etag }`; 409 `{ error }` when the model changed since it was loaded; 422 `{ error,
 * issues }` when the validator refuses the GLB; 404 when the upload is gone.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const user = await requireModelAccess(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const body = objectOrNull(await readJson(request)) ?? {};
	if (!isModelId(body.id)) throw error(400, 'Expected an `id` in lower snake case.');
	if (typeof body.upload !== 'string' || !/^[0-9a-f-]{36}$/.test(body.upload))
		throw error(400, 'Expected the `upload` id the upload endpoint returned.');
	if (!isModelClass(body.class))
		throw error(400, 'Expected a `class`: hero, weapon, prop, tile or fx.');
	if (body.baseEtag !== null && typeof body.baseEtag !== 'string')
		throw error(
			400,
			'Expected `baseEtag`: the model.json ETag you loaded, or null for a new model.',
		);

	const result = await registerModelUpload(
		clientKey,
		projectKey,
		body.id,
		body.upload,
		body.class,
		body.baseEtag,
	);
	if (!result.ok)
		return json(
			{ error: result.error, ...(result.issues ? { issues: result.issues } : {}) },
			{ status: result.status },
		);
	return json({ doc: result.doc, etag: result.etag });
};
