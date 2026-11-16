import { error, json } from '@sveltejs/kit';
import { PROFILER_CORS_HEADERS } from '$lib/server/profiler/cors';
import { reportOrigin } from '$lib/server/profiler/origin';
import { registerUpload, ReportRefused, saveReport } from '$lib/server/profiler/store';
import type { RequestHandler } from './$types';

/** The probe's preflight (`hooks.server.ts` adds the CORS headers to every answer of this path). */
export const OPTIONS: RequestHandler = () =>
	new Response(null, { status: 204, headers: PROFILER_CORS_HEADERS });

/**
 * Keeps one Invisible Profiler reading. The body is the probe's Copy JSON (`perf: 7`), or
 * `{ "upload": "<id>" }` to register one sent by presigned PUT (`/api/profiler/uploads`) because it
 * was too large for a request body. Who may send it, and for which project, is `reportOrigin`'s:
 * a capture session's token, or a signed-in user's Paste. 201 `{ id }`.
 */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const origin = await reportOrigin(request, locals, url);
	const text = await request.text();
	try {
		const upload = uploadId(text);
		const id = upload ? await registerUpload(origin, upload) : await saveReport(origin, text);
		return json({ id }, { status: 201 });
	} catch (e) {
		if (e instanceof ReportRefused) throw error(e.status, e.message);
		throw e;
	}
};

/** The id of an `{ "upload": "<id>" }` body; null for anything else (a report, or not JSON). */
function uploadId(text: string): string | null {
	if (text.length > 200) return null;
	try {
		const body: unknown = JSON.parse(text);
		return body && typeof body === 'object' && 'upload' in body && typeof body.upload === 'string'
			? body.upload
			: null;
	} catch {
		return null;
	}
}
