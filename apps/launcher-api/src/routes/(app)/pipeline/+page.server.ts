import { error, redirect } from '@sveltejs/kit';
import { AGENT_NAME } from '$lib/agentEdit';
import type { PageServerLoad } from './$types';

/**
 * The tool gate, as every tool page has it, plus what the tabs need: whether this user may approve
 * a changed screen, merge, roll back and edit an agent definition (`pipelineMerge`, resolved by the
 * layout from the same override layers as the tool list), the change a shared link names
 * (`?change=<n>`), the agent it names (`?agent=<name>`, which opens the Agents tab) and
 * `?tab=catalogue`.
 */
export const load: PageServerLoad = async ({ locals, parent, url }) => {
	if (!locals.user) throw redirect(303, '/login');
	const { tools, canPipelineMerge } = await parent();
	if (!tools.some((t) => t.id === 'pipelineChanges')) {
		throw error(403, 'Your role does not have access to Invisible Pipeline Changes.');
	}
	const asked = Number(url.searchParams.get('change'));
	const selected = Number.isSafeInteger(asked) && asked > 0 ? asked : null;
	const agent = url.searchParams.get('agent');
	return {
		canMerge: canPipelineMerge,
		selected,
		agent: agent && AGENT_NAME.test(agent) ? agent : null,
		tab: url.searchParams.get('tab') === 'catalogue' ? ('catalogue' as const) : null,
	};
};
