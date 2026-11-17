import { error, json } from '@sveltejs/kit';
import { jsonBody, requireTool } from '$lib/server/http';
import { buildFile, buildProject, setBuildKeep } from '$lib/server/profiler/builds';
import { PROFILER_TOOL } from '$lib/server/profiler/origin';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** One build's `build-breakdown.json`, as the desktop launcher uploaded it. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireTool(locals, PROFILER_TOOL, 'Invisible Profiler');
	const project = await buildProject(params.id);
	if (!project) throw error(404, 'No such build.');
	await requireProjectScope(user, project);
	const text = await buildFile(params.id);
	if (text === null) throw error(404, 'This build record has been deleted.');
	return new Response(text, {
		headers: {
			'content-type': 'application/json',
			'content-disposition': `attachment; filename="build-breakdown-${params.id}.json"`,
			'cache-control': 'private, no-store',
		},
	});
};

/** Keep (or stop keeping) one build record: `{ "keep": true | false }`. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const user = await requireTool(locals, PROFILER_TOOL, 'Invisible Profiler');
	const body = await jsonBody(request);
	if (typeof body.keep !== 'boolean') throw error(400, 'Expected { "keep": true | false }.');
	const project = await buildProject(params.id);
	if (!project) throw error(404, 'No such build.');
	await requireProjectScope(user, project);
	if (!(await setBuildKeep(project, params.id, body.keep))) {
		throw error(404, 'This build record has just been deleted by the 15-day purge.');
	}
	return json({ id: params.id, keep: body.keep });
};
