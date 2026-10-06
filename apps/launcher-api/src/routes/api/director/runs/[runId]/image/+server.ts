import { error, json } from '@sveltejs/kit';
import { requireDirectorAccess, requireOwnedRun } from '$lib/server/director/access';
import { NO_STORE } from '$lib/server/director/api';
import { SERVED_IMAGE_TYPES, sniffServedImage } from '$lib/server/director/mockups';
import { MAX_IMAGE_BYTES } from '$lib/server/director/ops/atlas';
import { UNASSIGNED_CLIENT, projectPrefix } from '$lib/server/projectPaths';
import { getObjectBytes, headObject } from '$lib/server/r2';
import type { RequestHandler } from './$types';

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;

/** Whether `key` is an image inside `prefix` that names no way out of it. */
function isImageKeyUnder(prefix: string, key: string): boolean {
	return (
		key.startsWith(prefix) &&
		key.length > prefix.length &&
		IMAGE_EXT.test(key) &&
		!CONTROL_OR_BACKSLASH.test(key) &&
		!key.includes('//') &&
		!key.split('/').includes('..')
	);
}

/**
 * `GET /api/director/runs/[runId]/image?key=<R2 key>&v=<n>` — one image of the run's project, for
 * the Live run galleries (mockups, crops, exported art). Owner-only, like the summary. The key must
 * sit under the run's project prefix and name a PNG, JPEG or WebP, and the bytes must be one: any
 * other key, a missing object and a non-image are the same 404, so the route says nothing about
 * which keys are well-formed. The type served is the one the bytes sniff as, never R2's. `v` is a
 * cache-buster the page appends when it knows an image changed; its value is ignored.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const user = await requireDirectorAccess(locals);
	const run = await requireOwnedRun(user, params.runId);
	const key = url.searchParams.get('key') ?? '';
	const prefix = `${projectPrefix(run.clientKey ?? UNASSIGNED_CLIENT, run.projectKey)}/`;
	if (!isImageKeyUnder(prefix, key)) throw error(404, 'No such image.');
	// An atlas page can run to tens of MB; the galleries show art, not pages, so the cap the variant
	// route applies holds here too — checked on the head, before the bytes are read.
	const head = await headObject(key);
	if (!head) throw error(404, 'No such image.');
	if (head.size > MAX_IMAGE_BYTES) {
		return json(
			{ error: 'too_large', message: 'The image is too large to show here.' },
			{ status: 413, headers: NO_STORE },
		);
	}
	const got = await getObjectBytes(key);
	const type = got ? sniffServedImage(got.body) : null;
	if (!got || !type) throw error(404, 'No such image.');
	return new Response(got.body, {
		headers: {
			'content-type': SERVED_IMAGE_TYPES[type],
			'content-length': String(got.body.byteLength),
			'cache-control': 'private, max-age=300',
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox",
		},
	});
};
