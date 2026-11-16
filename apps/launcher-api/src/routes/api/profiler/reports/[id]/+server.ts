import { error, json } from '@sveltejs/kit';
import { jsonBody, requireTool } from '$lib/server/http';
import { PROFILER_TOOL } from '$lib/server/profiler/origin';
import { reportFile, reportProject, setKeep } from '$lib/server/profiler/store';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** One reading's full report JSON, as the probe sent it — for a reading the user's project holds. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireTool(locals, PROFILER_TOOL, 'Invisible Profiler');
	const project = await reportProject(params.id);
	if (!project) throw error(404, 'No such reading.');
	await requireProjectScope(user, project);
	const text = await reportFile(params.id);
	if (text === null) throw error(404, 'This reading has been deleted.');
	return new Response(text, {
		headers: {
			'content-type': 'application/json',
			'content-disposition': `attachment; filename="perf-${params.id}.json"`,
			'cache-control': 'private, no-store',
		},
	});
};

/**
 * Keep (or stop keeping) one reading: `{ "keep": true | false }`. A kept reading is never purged
 * (owner decision 2026-11-16: every role may pin). 404 when the reading is gone — including when the
 * purge claimed it first.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const user = await requireTool(locals, PROFILER_TOOL, 'Invisible Profiler');
	const body = await jsonBody(request);
	if (typeof body.keep !== 'boolean') throw error(400, 'Expected { "keep": true | false }.');
	const project = await reportProject(params.id);
	if (!project) throw error(404, 'No such reading.');
	await requireProjectScope(user, project);
	if (!(await setKeep(project, params.id, body.keep))) {
		throw error(404, 'This reading has just been deleted by the 15-day purge.');
	}
	return json({ id: params.id, keep: body.keep });
};
