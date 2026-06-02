import { and, eq } from 'drizzle-orm';
import { getDb } from './db';
import { projects, userClientAccess, userProjectAccess } from './db/schema';
import type { Project } from './db/schema';
import type { Role } from '$lib/roles';

/** The default project every user can always reach; null session = this key. */
export const DEFAULT_PROJECT_KEY = 'cloud';

/** Project key slug: `^[a-z0-9][a-z0-9_-]{0,63}$` (shared tool contract). */
const PROJECT_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidProjectKey(value: string): boolean {
	return PROJECT_KEY_RE.test(value);
}

export async function listProjects(): Promise<Project[]> {
	return getDb().select().from(projects).orderBy(projects.createdAt);
}

export async function projectExists(key: string): Promise<boolean> {
	const [row] = await getDb()
		.select({ key: projects.key })
		.from(projects)
		.where(eq(projects.key, key));
	return Boolean(row);
}

/** Owning client key for a project, or `null` when unassigned / unknown. */
export async function projectClientKey(key: string): Promise<string | null> {
	const [row] = await getDb()
		.select({ clientKey: projects.clientKey })
		.from(projects)
		.where(eq(projects.key, key));
	return row?.clientKey ?? null;
}

/**
 * The game type a project targets — used to pick its Invisible Editor template
 * (see `docs/design/invisible-editor.md` §7.4).
 *
 * TODO: the `projects` table has no `game_type` column yet, so there is nowhere
 * to record this per-project. Until that schema lands (a deliberate migration,
 * not invented here) every project falls back to the only built-in template,
 * `'lines'`. When the column exists, read it here and only fall back when unset.
 */
export async function projectGameType(_key: string): Promise<string> {
	return 'lines';
}

/**
 * Projects a user may switch to. Admins get every project; everyone else gets
 * the union of their `user_client_access` grants (every project owned by a
 * granted client) and their per-project `user_project_access` grants, plus the
 * always-available default `cloud`.
 */
export async function accessibleProjects(userId: string, role: Role): Promise<Project[]> {
	const all = await listProjects();
	if (role === 'admin') return all;

	const db = getDb();
	const projectGrants = await db
		.select({ projectKey: userProjectAccess.projectKey })
		.from(userProjectAccess)
		.where(eq(userProjectAccess.userId, userId));
	const clientGrants = await db
		.select({ clientKey: userClientAccess.clientKey })
		.from(userClientAccess)
		.where(eq(userClientAccess.userId, userId));

	const allowedProjects = new Set(projectGrants.map((g) => g.projectKey));
	allowedProjects.add(DEFAULT_PROJECT_KEY);
	const allowedClients = new Set(clientGrants.map((g) => g.clientKey));

	return all.filter(
		(p) => allowedProjects.has(p.key) || (p.clientKey !== null && allowedClients.has(p.clientKey)),
	);
}

/** True when the user may select/use the given project key. */
export async function canAccessProject(userId: string, role: Role, key: string): Promise<boolean> {
	return (await accessibleProjects(userId, role)).some((p) => p.key === key);
}

/** Per-user project grants, keyed by userId (for the admin table). */
export async function projectAccessFor(userIds: string[]): Promise<Record<string, string[]>> {
	const out: Record<string, string[]> = {};
	if (userIds.length === 0) return out;

	const rows = await getDb()
		.select({ userId: userProjectAccess.userId, projectKey: userProjectAccess.projectKey })
		.from(userProjectAccess);

	const wanted = new Set(userIds);
	for (const r of rows) {
		if (!wanted.has(r.userId)) continue;
		(out[r.userId] ??= []).push(r.projectKey);
	}
	return out;
}

export async function grantProjectAccess(userId: string, projectKey: string): Promise<void> {
	await getDb()
		.insert(userProjectAccess)
		.values({ userId, projectKey })
		.onConflictDoNothing({ target: [userProjectAccess.userId, userProjectAccess.projectKey] });
}

export async function revokeProjectAccess(userId: string, projectKey: string): Promise<void> {
	await getDb()
		.delete(userProjectAccess)
		.where(and(eq(userProjectAccess.userId, userId), eq(userProjectAccess.projectKey, projectKey)));
}

export async function createProject(
	key: string,
	name: string,
	clientKey: string | null = null,
): Promise<void> {
	await getDb().insert(projects).values({ key, name, clientKey });
}

export async function renameProject(key: string, name: string): Promise<void> {
	await getDb().update(projects).set({ name }).where(eq(projects.key, key));
}

export async function deleteProject(key: string): Promise<void> {
	await getDb().delete(projects).where(eq(projects.key, key));
}

/** Ensure the default `cloud` project row exists (idempotent). */
export async function ensureDefaultProject(): Promise<void> {
	await getDb()
		.insert(projects)
		.values({ key: DEFAULT_PROJECT_KEY, name: 'Cloud' })
		.onConflictDoNothing({ target: projects.key });
}
