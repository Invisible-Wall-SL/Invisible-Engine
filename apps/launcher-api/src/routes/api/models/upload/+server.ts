import { error, json } from '@sveltejs/kit';
import { objectOrNull, readJson } from '$lib/server/http';
import { requireModelAccess } from '$lib/server/modelAccess';
import {
	isModelId,
	MAX_MODEL_BYTES,
	MODEL_ID_RULE,
	presignModelUpload,
} from '$lib/server/modelStorage';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** How long the browser has to PUT a master: a hero GLB with 4096² maps on a poor line. */
const PUT_TTL_SECONDS = 900;

/**
 * Mint the URL that uploads one model master. Body: `{ id, bytes }`. Returns `{ upload, url,
 * contentType }`; the browser PUTs the GLB straight to R2 with that `contentType`, then calls
 * `POST /api/models/register` with the `upload` id. The URL names a staging key, never the model's
 * own files, and this endpoint writes nothing (the launcher's 512 KB body cap never sees the bytes).
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const user = await requireModelAccess(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const body = objectOrNull(await readJson(request)) ?? {};
	if (!isModelId(body.id)) throw error(400, `Expected an \`id\`: ${MODEL_ID_RULE}.`);
	const bytes = typeof body.bytes === 'number' && Number.isFinite(body.bytes) ? body.bytes : -1;
	if (bytes <= 0) throw error(400, 'That file is empty.');
	if (bytes > MAX_MODEL_BYTES)
		throw error(413, `That model is larger than ${MAX_MODEL_BYTES / 1024 / 1024} MB.`);
	try {
		return json(await presignModelUpload(clientKey, projectKey, body.id, PUT_TTL_SECONDS));
	} catch {
		throw error(502, 'Failed to prepare the upload.');
	}
};
