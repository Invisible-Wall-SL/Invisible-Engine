import { json } from '@sveltejs/kit';
import { requirePipelineAccess } from '$lib/server/pipelineAccess';
import { listHistory } from '$lib/server/pipelineMerge';
import type { RequestHandler } from './$types';

/**
 * The History tab of Invisible Pipeline Changes (ADR-0007): every change merged from here, newest
 * first, with the revert that undid it or is open to undo it. Read from the launcher's own table,
 * so it answers even with the App unconfigured or GitHub down — only the open reverts are then
 * unknown. Session-gated on the `pipelineChanges` tool.
 */
export const GET: RequestHandler = async ({ locals }) => {
	await requirePipelineAccess(locals);
	return json(await listHistory(), { headers: { 'cache-control': 'no-store' } });
};
