import { json } from '@sveltejs/kit';
import { bugScopeOf, currentLinkSync, fixTabFor, listSentBugs } from '$lib/server/bugReports';
import { requirePipelineAccess } from '$lib/server/pipelineAccess';
import type { RequestHandler } from './$types';

/**
 * The Bugs tab of Invisible Pipeline Changes: the pipeline bugs triaged in Invisible Pipeline Bug
 * Reports and sent here to be fixed, still-to-do first, each with the pull requests that name it.
 * Session-gated on the `pipelineChanges` tool, and scoped like the bug list itself: a bug naming a
 * project the viewer cannot open is not listed. Game bugs never come here.
 *
 * `fix` is what the tab needs for Start fix (ADR-0013): per bug its latest fix runs and the first
 * refusal a start would meet; for the viewer whether they hold the capability pair and whether fix
 * runs can run at all (`ready`).
 */
export const GET: RequestHandler = async ({ locals }) => {
	const user = await requirePipelineAccess(locals);
	const sync = await currentLinkSync();
	const bugs = await listSentBugs(await bugScopeOf(user, ['pipeline']));
	return json(
		{ bugs, sync, fix: await fixTabFor(user, bugs) },
		{ headers: { 'cache-control': 'no-store' } },
	);
};
