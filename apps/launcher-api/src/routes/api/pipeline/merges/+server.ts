import { json } from '@sveltejs/kit';
import { requirePipelineAccess } from '$lib/server/pipelineAccess';
import { listHistory } from '$lib/server/pipelineMerge';
import type { RequestHandler } from './$types';

/**
 * The History tab of Invisible Pipeline Changes (ADR-0007): every change merged from here, newest
 * first, with the revert that undid it or is open to undo it. Not a pure read: a merge claimed more
 * than two minutes ago and never completed (the launcher died, or GitHub's answer was lost) is
 * first settled against GitHub — recorded if the App merged it, dropped if not. Otherwise it answers
 * from the launcher's own table, even with the App unconfigured or GitHub down: only those claims
 * and the open reverts are then left unknown. Session-gated on the `pipelineChanges` tool.
 */
export const GET: RequestHandler = async ({ locals }) => {
	await requirePipelineAccess(locals);
	return json(await listHistory(), { headers: { 'cache-control': 'no-store' } });
};
