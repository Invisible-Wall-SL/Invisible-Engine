import { json } from '@sveltejs/kit';
import { bugScopeOf, currentLinkSync, listSentBugs } from '$lib/server/bugReports';
import { requirePipelineAccess } from '$lib/server/pipelineAccess';
import type { RequestHandler } from './$types';

/**
 * The Bugs tab of Invisible Pipeline Changes: the pipeline bugs triaged in Invisible Pipeline Bug
 * Reports and sent here to be fixed, still-to-do first, each with the pull requests that name it.
 * Session-gated on the `pipelineChanges` tool, and scoped like the bug list itself: a bug naming a
 * project the viewer cannot open is not listed. Game bugs never come here.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const user = await requirePipelineAccess(locals);
	const sync = await currentLinkSync();
	return json(
		{ bugs: await listSentBugs(await bugScopeOf(user, ['pipeline'])), sync },
		{ headers: { 'cache-control': 'no-store' } },
	);
};
