import { json } from '@sveltejs/kit';
import {
	parseBugNumber,
	readScreenshot,
	removeScreenshot,
	requireBugAccess,
} from '$lib/server/bugReports';
import type { RequestHandler } from './$types';

/**
 *   GET    /api/bugs/<n>/screenshots/<id>   the image, on a bug the viewer may see
 *   DELETE /api/bugs/<n>/screenshots/<id>   remove it (whoever added it, the reporter, or a
 *                                           triager); answers the bug in full
 *
 * An id is random and never reused, so the browser may keep the image.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	const access = await requireBugAccess(locals);
	const { bytes, mediaType } = await readScreenshot(
		access,
		parseBugNumber(params.number),
		params.id,
	);
	return new Response(bytes, {
		headers: {
			'content-type': mediaType,
			'content-length': String(bytes.byteLength),
			'cache-control': 'private, max-age=86400',
			'x-content-type-options': 'nosniff',
		},
	});
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const access = await requireBugAccess(locals);
	return json(await removeScreenshot(access, parseBugNumber(params.number), params.id), {
		headers: { 'cache-control': 'no-store' },
	});
};
