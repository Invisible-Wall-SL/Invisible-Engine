import { json } from '@sveltejs/kit';
import { jsonBody, requireTool } from '$lib/server/http';
import { PROFILER_TOOL } from '$lib/server/profiler/origin';
import { openCaptureSession } from '$lib/server/profiler/session';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * New capture: `{ "project": "<key>", "label"?: "<device>" }` → a 24-hour capture session for that
 * project, with each published game's capture links and their QR codes.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireTool(locals, PROFILER_TOOL, 'Invisible Profiler');
	const body = await jsonBody(request);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		typeof body.project === 'string' ? body.project : null,
	);
	const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) || null : null;
	return json(await openCaptureSession({ clientKey, projectKey, uid: user.id, label }));
};
