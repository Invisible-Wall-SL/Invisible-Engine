import { error, json } from '@sveltejs/kit';
import { PROFILER_CORS_HEADERS } from '$lib/server/profiler/cors';
import { reportOrigin } from '$lib/server/profiler/origin';
import { presignReportUpload, ReportRefused } from '$lib/server/profiler/store';
import type { RequestHandler } from './$types';

export const OPTIONS: RequestHandler = () =>
	new Response(null, { status: 204, headers: PROFILER_CORS_HEADERS });

/**
 * A presigned PUT for a reading too large for a request body (the launcher's body cap): the sender
 * PUTs the JSON to `url` with `contentType`, then posts `{ "upload": id }` to
 * `/api/profiler/reports`. Same senders as that route.
 */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const origin = await reportOrigin(request, locals, url);
	try {
		return json(await presignReportUpload(origin));
	} catch (e) {
		if (e instanceof ReportRefused) throw error(e.status, e.message);
		throw e;
	}
};
