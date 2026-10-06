import { error, redirect } from '@sveltejs/kit';
import { requireOwnedRun } from '$lib/server/director/access';
import type { PageServerLoad } from './$types';

/**
 * The run page: the Mockup breakdown (PLAN 4.2) while the run waits at that checkpoint, and the
 * run's state otherwise. Gated like `/director`, then owner-only like the run API: a run that is
 * not the caller's, one outside their projects and an unknown id are the same 404. The page loads
 * the summary, the mockups and the font requests from the API and follows the live stream.
 */
export const load: PageServerLoad = async ({ locals, params, parent }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'director')) {
		throw error(403, 'Your role does not have access to Invisible Director.');
	}
	const run = await requireOwnedRun(locals.user, params.runId);
	return { runId: run.id };
};
