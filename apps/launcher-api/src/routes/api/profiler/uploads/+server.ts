import { error, json } from '@sveltejs/kit';
import { PROFILER_CORS_HEADERS } from '$lib/server/profiler/cors';
import { buildOrigin, hasBearer, reportOrigin } from '$lib/server/profiler/origin';
import { presignUpload, ReportRefused, type UploadScope } from '$lib/server/profiler/store';
import type { RequestHandler } from './$types';

export const OPTIONS: RequestHandler = () =>
	new Response(null, { status: 204, headers: PROFILER_CORS_HEADERS });

/**
 * A presigned PUT for a file too large for a request body: the sender PUTs the JSON to `url` with
 * `contentType`, then registers the id. A reading (same senders as `/api/profiler/reports`) is
 * registered with `{ "upload": id }` there; a build breakdown — the desktop launcher, with its
 * bearer and `?project=` — with `{ project, gameKey, upload }` at `/api/profiler/builds`.
 */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	let scope: UploadScope;
	let capped = true;
	if (hasBearer(request)) {
		const origin = await buildOrigin(request, url.searchParams.get('project'));
		if (origin instanceof Response) return origin;
		scope = { ...origin, session: null };
		capped = false;
	} else {
		scope = await reportOrigin(request, locals, url);
	}
	try {
		return json(await presignUpload(scope, capped));
	} catch (e) {
		if (e instanceof ReportRefused) throw error(e.status, e.message);
		throw e;
	}
};
