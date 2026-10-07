import { error, isHttpError } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import type { DirectorRun } from '../db/schema';
import { clientExists, mayCreateUnderClient } from '../clients';
import { FOLDER_TAKEN_WORDS, UNASSIGNED_CLIENT, r2Slug } from '../projectPaths';
import { isValidProjectKey, projectExists, projectInFolder, projectKeyTaken } from '../projects';
import { getRoleOverrides } from '../roleToolAccess';
import { requireProjectScope } from '../toolScope';
import { getToolOverrides } from '../userToolAccess';
import { loadMockupsDoc, pendingDocOwnedBy } from './mockups';
import { getRun } from './store';

/**
 * The session gates shared by Invisible Director's own endpoints (mockup uploads, the run API, the
 * live event stream): logged in + entitled to the `director` tool, role and per-user overrides
 * applied — the SAME entitlement the `/director` page checks. Not the adapter gate (`gate.ts`),
 * which the worker passes with a service token and never a session.
 *
 * `requireDirectorAccess` returns the non-null user for the project rules below: the tool grant
 * alone is not a project grant.
 */
export async function requireDirectorAccess(
	locals: App.Locals,
): Promise<NonNullable<App.Locals['user']>> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'director', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Director.');
	}
	return locals.user;
}

type User = NonNullable<App.Locals['user']>;

/**
 * Whether `user` may reach `run`: its project through `requireProjectScope`, or — while the project
 * does not exist yet (a draft, or a create still copying the template) — because the run is theirs:
 * there is no project row to grant access to, and the owner is the person about to create it. Once
 * it exists the project rule applies to the owner too.
 */
export async function canReachRun(user: User, run: DirectorRun): Promise<boolean> {
	try {
		await requireProjectScope(user, run.projectKey);
		return true;
	} catch (e) {
		if (!isHttpError(e) || e.status !== 403) throw e;
		return run.ownerUserId === user.id && !(await projectExists(run.projectKey));
	}
}

/**
 * The run `runId` as its owner may act on it. A run that does not exist, one that is not the
 * caller's, and one whose project the caller can no longer reach all get the SAME 404, so the run
 * API is not an oracle for which run ids exist or who owns them.
 */
export async function requireOwnedRun(user: User, runId: string): Promise<DirectorRun> {
	const run = await getRun(runId);
	if (!run || run.ownerUserId !== user.id || !(await canReachRun(user, run))) {
		throw error(404, 'No such run.');
	}
	return run;
}

export interface DirectorProjectScope {
	clientKey: string;
	projectKey: string;
	/** True for a project that does not exist yet: a game the caller is about to create. */
	pending: boolean;
}

/**
 * The project a Director request names: an existing one under the usual rule
 * (`requireProjectScope`), or a PENDING one — the key of a game the New-game form is still filling
 * in, whose mockups are uploaded and whose ownership is confirmed before the run is created
 * (ADR-0005 "Ownership": the run cannot be created without the check). A pending project is one
 * the caller could create in Game Maker: a valid, free key (a deleted project's key is taken) under
 * a client they may create under, `client` naming it (none = unassigned) — and whose mockups, if
 * any, are the caller's own (`pendingDocOwnedBy`): a key another person has started uploading
 * under is theirs until the project exists. Anything else is the same 403 as an inaccessible
 * project, so the answer says nothing about which keys exist or who is preparing one — except a
 * creatable key whose R2 folder is already a project's under that client (`sunken_temple` beside
 * `sunken-temple`, live or deleted): its uploads would land in that project's `director/` tree, so
 * it is a 409 — one that does not name the project, which the caller may have no grant on.
 */
export async function requireDirectorProjectScope(
	user: User,
	project: string | null,
	client: string | null,
): Promise<DirectorProjectScope> {
	const projectKey = project?.trim().toLowerCase() ?? '';
	if (!projectKey || (await projectExists(projectKey))) {
		return { ...(await requireProjectScope(user, projectKey || null)), pending: false };
	}
	const clientKey = client?.trim() || null;
	const creatable =
		isValidProjectKey(projectKey) &&
		!(await projectKeyTaken(projectKey)) &&
		(clientKey === null || (await clientExists(clientKey))) &&
		(await mayCreateUnderClient(user.id, user.role, clientKey));
	const forbidden = () => error(403, `You do not have access to the project "${projectKey}".`);
	if (!creatable) throw forbidden();
	const scope = { clientKey: clientKey ?? UNASSIGNED_CLIENT, projectKey, pending: true };
	const holder = await projectInFolder(r2Slug(projectKey), { client: scope.clientKey });
	if (holder) throw error(409, FOLDER_TAKEN_WORDS);
	const { doc } = await loadMockupsDoc(scope.clientKey, scope.projectKey);
	if (!pendingDocOwnedBy(doc, user.id)) throw forbidden();
	return scope;
}
