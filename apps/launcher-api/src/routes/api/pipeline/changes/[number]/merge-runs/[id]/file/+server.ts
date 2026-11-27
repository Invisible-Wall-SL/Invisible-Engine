import { error } from '@sveltejs/kit';
import { requirePipelineMerge } from '$lib/server/pipelineAccess';
import { parseChangeNumber } from '$lib/server/pipelineChanges';
import { resolvedFileOf } from '$lib/server/pipelineMergeRuns';
import type { RequestHandler } from './$types';

/**
 * A proposal's resolved file, read before Accept (ADR-0015 §5): `GET …/merge-runs/<id>/file?path=…`.
 * The exact text Accept would push, from the run's own record (the branch is not fetched), as plain
 * text that is never sniffed or downloaded. Only while the run is `proposed` or `accepting`, only a
 * path the proposal lists. Needs the `pipelineMerge` capability, like Accept: it is what a person
 * reads to decide.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	await requirePipelineMerge(locals, 'Reading a resolved file');
	const number = parseChangeNumber(params.number);
	const path = url.searchParams.get('path');
	if (!path) throw error(400, 'path is the file of the proposal to read.');
	const content = await resolvedFileOf(number, params.id, path);
	return new Response(content, {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'x-content-type-options': 'nosniff',
			'content-disposition': 'inline',
			'cache-control': 'no-store',
		},
	});
};
