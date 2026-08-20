import { json } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { clientExists } from '$lib/server/clients';
import {
	DuplicateTooLargeError,
	duplicateProjectData,
	type DuplicateScope,
} from '$lib/server/projectDuplicate';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { scaffoldProject } from '$lib/server/projectScaffold';
import {
	canAccessProject,
	createProject,
	deleteProject,
	isValidProjectKey,
	projectClientKey,
	projectExists,
	projectGameType,
} from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Duplicate an existing project onto a new key — the same client (a variant) or a different one (a
 * reskin for another client).
 *
 *   POST /api/game-maker/duplicate
 *     { source, key, name, clientKey?: string | null, scope?: 'setup' | 'full' }
 *   → 200 { ok, key, copied, rebased, skipped }
 *
 * Gated like the page's own "Create a game" action — any holder of the `gameMaker` tool may create
 * a project — plus the source must be a project the caller can actually access, so this can't be
 * used to read another client's game out through a copy.
 *
 * The new project is created FIRST and deleted again if the copy throws, so a failed duplicate does
 * not leave an empty project row behind for someone to publish by mistake. The copy itself is not
 * transactional (R2 has no such thing); a partial tree is reported, not hidden.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const toolOverrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'gameMaker', roleOverrides, toolOverrides)) {
		return json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
	}

	let body: {
		source?: unknown;
		key?: unknown;
		name?: unknown;
		clientKey?: unknown;
		scope?: unknown;
	};
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}

	const source = typeof body.source === 'string' ? body.source.trim() : '';
	const key = typeof body.key === 'string' ? body.key.trim().toLowerCase() : '';
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const scope: DuplicateScope = body.scope === 'full' ? 'full' : 'setup';
	const rawClient = typeof body.clientKey === 'string' ? body.clientKey.trim() : '';
	const clientKey = rawClient === '' ? null : rawClient;

	if (!source) return json({ error: 'Missing source project' }, { status: 400, headers: NO_STORE });
	if (!(await canAccessProject(locals.user.id, locals.user.role, source))) {
		return json({ error: 'Unknown source project' }, { status: 404, headers: NO_STORE });
	}
	if (!isValidProjectKey(key)) {
		return json(
			{ error: 'Key must match a-z, 0-9, _ or - (max 64).' },
			{ status: 400, headers: NO_STORE },
		);
	}
	if (key === source) {
		return json({ error: 'The copy needs a different key.' }, { status: 400, headers: NO_STORE });
	}
	if (!name) return json({ error: 'Name is required.' }, { status: 400, headers: NO_STORE });
	if (await projectExists(key)) {
		return json({ error: 'A project with that key exists.' }, { status: 409, headers: NO_STORE });
	}
	if (clientKey !== null && !(await clientExists(clientKey))) {
		return json({ error: 'Unknown client.' }, { status: 400, headers: NO_STORE });
	}

	const sourceClient = (await projectClientKey(source)) ?? UNASSIGNED_CLIENT;
	// The copy is a copy of the GAME, so it inherits the source's kind rather than the default —
	// otherwise a duplicated cluster game would scaffold (and profile) as `lines`.
	const gameType = await projectGameType(source);

	await createProject(key, name, clientKey, gameType);
	try {
		const result = await duplicateProjectData(
			{ clientKey: sourceClient, projectKey: source },
			{ clientKey: clientKey ?? UNASSIGNED_CLIENT, projectKey: key },
			scope,
		);
		// Backfill anything the source never had (a project scaffolded before a seed file existed),
		// so the copy is a complete project rather than a mirror of an old one. Idempotent: it only
		// writes keys that are missing, so nothing just copied is overwritten.
		await scaffoldProject(clientKey ?? UNASSIGNED_CLIENT, key);
		return json({ ok: true, key, ...result }, { headers: NO_STORE });
	} catch (e) {
		await deleteProject(key);
		if (e instanceof DuplicateTooLargeError) {
			return json({ error: e.message }, { status: 413, headers: NO_STORE });
		}
		console.error('duplicateProject failed:', e);
		const detail = e instanceof Error ? e.message : String(e);
		return json({ error: `Duplicate failed: ${detail}` }, { status: 502, headers: NO_STORE });
	}
};
