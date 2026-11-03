import { fixRunScreenshot } from '$lib/server/bugFixRuns';
import type { RequestHandler } from './$types';

/**
 * One screenshot of the fix run's own bug, for its Actions job (ADR-0013 §4):
 *
 *   GET /api/pipeline/fix-runs/<id>/screenshots/<sid>   Authorization: Bearer <GitHub OIDC token>
 *       → the image, at most 1568 px on its long edge
 *
 * Authorised as the brief is; a screenshot of another bug is 404, as one that does not exist.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	const { bytes, mediaType } = await fixRunScreenshot(request, params.id, params.sid);
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': mediaType,
			'content-length': String(bytes.byteLength),
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff',
		},
	});
};
