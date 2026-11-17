import { error } from '@sveltejs/kit';
import { requireTool } from '$lib/server/http';
import { buildFile, buildProject } from '$lib/server/profiler/builds';
import { PROFILER_TOOL } from '$lib/server/profiler/origin';
import { requireProjectScope } from '$lib/server/toolScope';
import { renderBreakdownHtml } from '../../../../../../../../../scripts/lib/build-breakdown.mjs';
import type { RequestHandler } from './$types';

/**
 * A build's breakdown as the same page the desktop launcher opens from disk, rendered from the
 * uploaded JSON by the engine's own renderer. The JSON came from a publisher's machine, so the page
 * is served sandboxed (an opaque origin: no cookies, no same-origin requests) and may only run its
 * own inline script and styles.
 */
const SANDBOX_CSP =
	"sandbox allow-scripts allow-downloads; default-src 'none'; script-src 'unsafe-inline'; " +
	"style-src 'unsafe-inline'; img-src data: blob:";

export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireTool(locals, PROFILER_TOOL, 'Invisible Profiler');
	const project = await buildProject(params.id);
	if (!project) throw error(404, 'No such build.');
	await requireProjectScope(user, project);
	const text = await buildFile(params.id);
	if (text === null) throw error(404, 'This build record has been deleted.');
	let breakdown: unknown;
	try {
		breakdown = JSON.parse(text);
	} catch {
		throw error(422, 'This build record’s breakdown is not readable.');
	}
	return new Response(renderBreakdownHtml(breakdown), {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'content-security-policy': SANDBOX_CSP,
			'x-content-type-options': 'nosniff',
			'cache-control': 'private, no-store',
		},
	});
};
