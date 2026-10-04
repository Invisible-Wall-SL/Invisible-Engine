import { clientExists, mayCreateUnderClient } from './clients';
import {
	DuplicateTooLargeError,
	duplicateProjectData,
	type DuplicateResult,
	type DuplicateScope,
} from './projectDuplicate';
import { UNASSIGNED_CLIENT } from './projectPaths';
import { scaffoldProject } from './projectScaffold';
import {
	canAccessProject,
	createProject,
	deleteProject,
	isValidProjectKey,
	projectClientKey,
	projectExists,
	projectGameType,
	projectKeyTaken,
} from './projects';

export interface DuplicateProjectInput {
	source: string;
	key: string;
	name: string;
	/** null = unassigned. */
	clientKey: string | null;
	scope: DuplicateScope;
}

export type DuplicateProjectOutcome =
	| ({ ok: true; key: string } & DuplicateResult)
	| { ok: false; status: 400 | 404 | 403 | 409 | 413 | 502; error: string };

/**
 * Game Maker's "Duplicate" — a new `projects` row plus a copy of the source's R2 tree — for `user`,
 * who must already hold the tool. Shared by `POST /api/game-maker/duplicate` and Invisible
 * Director's `gamemaker.create_from_template`, so a Director project is created exactly the way a
 * person creates one.
 *
 * The source must be a project `user` can access, so this can't read another client's game out
 * through a copy, and the destination a client they may create under. The new project is created
 * FIRST and deleted again if the copy throws, so a failed duplicate leaves no empty row behind for
 * someone to publish by mistake. The copy itself is not transactional (R2 has no such thing); a
 * partial tree is reported, not hidden.
 */
export async function duplicateProject(
	user: NonNullable<App.Locals['user']>,
	input: DuplicateProjectInput,
): Promise<DuplicateProjectOutcome> {
	const { source, key, name, clientKey, scope } = input;
	if (!source) return { ok: false, status: 400, error: 'Missing source project' };
	if (!(await canAccessProject(user.id, user.role, source))) {
		return { ok: false, status: 404, error: 'Unknown source project' };
	}
	if (!isValidProjectKey(key)) {
		return { ok: false, status: 400, error: 'Key must match a-z, 0-9, _ or - (max 64).' };
	}
	if (key === source) return { ok: false, status: 400, error: 'The copy needs a different key.' };
	if (!name) return { ok: false, status: 400, error: 'Name is required.' };
	if (await projectExists(key)) {
		return { ok: false, status: 409, error: 'A project with that key exists.' };
	}
	// A soft-deleted row still owns the primary key, so the insert below would 500.
	if (await projectKeyTaken(key)) {
		return {
			ok: false,
			status: 409,
			error: `"${key}" is a deleted project. An admin can restore or purge it in /admin.`,
		};
	}
	if (clientKey !== null && !(await clientExists(clientKey))) {
		return { ok: false, status: 400, error: 'Unknown client.' };
	}
	if (!(await mayCreateUnderClient(user.id, user.role, clientKey))) {
		return { ok: false, status: 403, error: 'You do not have access to that client.' };
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
		return { ok: true, key, ...result };
	} catch (e) {
		await deleteProject(key);
		if (e instanceof DuplicateTooLargeError) return { ok: false, status: 413, error: e.message };
		console.error('duplicateProject failed:', e);
		const detail = e instanceof Error ? e.message : String(e);
		return { ok: false, status: 502, error: `Duplicate failed: ${detail}` };
	}
}
