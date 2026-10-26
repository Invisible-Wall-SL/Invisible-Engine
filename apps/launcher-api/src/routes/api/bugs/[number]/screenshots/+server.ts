import { error, json } from '@sveltejs/kit';
import { addScreenshot, parseBugNumber, requireBugAccess } from '$lib/server/bugReports';
import type { RequestHandler } from './$types';

/**
 * `POST /api/bugs/<n>/screenshots` (multipart, `file=<png|jpg|webp>`): add one screenshot to a bug
 * the viewer may see; answers the bug in full. One file per request, so a refusal is about THE file
 * and nothing has half-landed; the limits (10 MB, 10 per bug, the image types by their bytes) are
 * `bugReports.ts`'s.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const access = await requireBugAccess(locals);
	const number = parseBugNumber(params.number);
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		throw error(400, 'Expected a multipart form.');
	}
	const files = form.getAll('file').filter((f): f is File => f instanceof File);
	if (files.length !== 1) throw error(400, 'Send exactly one file per request.');
	const bytes = new Uint8Array(await files[0].arrayBuffer());
	return json(await addScreenshot(access, number, bytes), {
		headers: { 'cache-control': 'no-store' },
	});
};
