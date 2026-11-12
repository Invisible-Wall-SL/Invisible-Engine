import { error } from '@sveltejs/kit';
import { PIPELINE_MERGE_CAPABILITY } from '$lib/roles';
import { requireToolGrants } from './http';

/**
 * The session gates for Invisible Pipeline Changes' own endpoints (`/api/pipeline/changes/*`,
 * `/api/pipeline/merges/*`): logged in + entitled to the `pipelineChanges` tool, role and per-user
 * overrides applied — the SAME entitlement the `/pipeline` page checks. Not the CI gate
 * (`pipelineGames.ts`), which the harness passes with a bearer token and never a session.
 */
export async function requirePipelineAccess(locals: App.Locals): Promise<User> {
	return (await entitled(locals)).user;
}

type User = NonNullable<App.Locals['user']>;

const entitled = (locals: App.Locals) =>
	requireToolGrants(locals, 'pipelineChanges', 'Invisible Pipeline Changes');

/**
 * The extra gate for approving a changed screen, editing an agent definition, merging a change
 * and rolling one back: the `pipelineMerge` capability, default-ON for admin only. Seeing the tool
 * — Pipeline Testers do by default — never implies it (SPEC §3). `action` names what was refused.
 */
export async function requirePipelineMerge(
	locals: App.Locals,
	action = 'Approving a changed screen',
): Promise<User> {
	const { user, grants } = await entitled(locals);
	if (!grants.hasCapability(PIPELINE_MERGE_CAPABILITY)) {
		throw error(403, `${action} needs the "Merge pipeline changes" capability.`);
	}
	return user;
}
