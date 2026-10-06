import { error, redirect } from '@sveltejs/kit';
import { PIPELINE_MERGE_CAPABILITY, roleHasCapability } from '$lib/roles';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'pipelineChanges')) {
		throw error(403, 'Your role does not have access to Invisible Pipeline Changes.');
	}
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	const canMerge = roleHasCapability(
		locals.user.role,
		PIPELINE_MERGE_CAPABILITY,
		roleOverrides,
		overrides,
	);
	const asked = Number(url.searchParams.get('change'));
	const selected = Number.isSafeInteger(asked) && asked > 0 ? asked : null;
	return { canMerge, selected };
};
