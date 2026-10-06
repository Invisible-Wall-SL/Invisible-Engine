import { error } from '@sveltejs/kit';
import { PIPELINE_MERGE_CAPABILITY, roleHasCapability, roleHasTool } from '$lib/roles';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

/**
 * The session gates for Invisible Pipeline Changes' own endpoints (`/api/pipeline/changes/*`):
 * logged in + entitled to the `pipelineChanges` tool, role and per-user overrides applied — the
 * SAME entitlement the `/pipeline` page checks. Not the CI gate (`pipelineGames.ts`), which the
 * harness passes with a bearer token and never a session.
 */
export async function requirePipelineAccess(
	locals: App.Locals,
): Promise<NonNullable<App.Locals['user']>> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'pipelineChanges', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Pipeline Changes.');
	}
	return locals.user;
}

/**
 * The extra gate for approving a changed screen (and, later, merging): the `pipelineMerge`
 * capability, default-ON for admin only. Seeing the tool — Pipeline Testers do by default — never
 * implies it (SPEC §3).
 */
export async function requirePipelineMerge(
	locals: App.Locals,
): Promise<NonNullable<App.Locals['user']>> {
	const user = await requirePipelineAccess(locals);
	const roleOverrides = await getRoleOverrides(user.role);
	const overrides = await getToolOverrides(user.id);
	if (!roleHasCapability(user.role, PIPELINE_MERGE_CAPABILITY, roleOverrides, overrides)) {
		throw error(403, 'Approving a changed screen needs the "Merge pipeline changes" capability.');
	}
	return user;
}
