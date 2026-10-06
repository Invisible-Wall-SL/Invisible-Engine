import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * The tool gate, as every tool page has it, plus what the Changes tab needs: whether this user may
 * approve a changed screen (`pipelineMerge`, resolved by the layout from the same override layers
 * as the tool list) and the change a shared link names (`?change=<n>`).
 */
export const load: PageServerLoad = async ({ locals, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools, canPipelineMerge } = await parent();
	if (!tools.some((t) => t.id === 'pipelineChanges')) {
		throw error(403, 'Your role does not have access to Invisible Pipeline Changes.');
	}
	const asked = Number(url.searchParams.get('change'));
	const selected = Number.isSafeInteger(asked) && asked > 0 ? asked : null;
	return { canMerge: canPipelineMerge, selected };
};
