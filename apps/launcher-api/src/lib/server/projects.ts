import { and, eq } from 'drizzle-orm';
import { getDb } from './db';
import { projects, userProjectAccess } from './db/schema';
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
	const [row] = await getDb().select({ key: projects.key }).from(projects).where(eq(projects.key, key));
	return Boolean(row);
}

/**
 * Projects a user may switch to. Admins get every project; everyone else gets
 * their `user_project_access` grants plus the always-available default `cloud`.
 */
export async function accessibleProjects(userId: string, role: Role): Promise<Project[]> {
	const all = await listProjects();
	if (role === 'admin') return all;

	const grants = await getDb()
		.select({ projectKey: userProjectAccess.projectKey })
		.from(userProjectAccess)
		.where(eq(userProjectAccess.userId, userId));

	const allowed = new Set(grants.map((g) => g.projectKey));
	allowed.add(DEFAULT_PROJECT_KEY);
	return all.filter((p) => allowed.has(p.key));
}

/** True when the user may select/use the given project key. */
export async function canAccessProject(
	userId: string,
	role: Role,
	key: string,
): Promise<boolean> {
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
		.where(
			and(eq(userProjectAccess.userId, userId), eq(userProjectAccess.projectKey, projectKey)),
		);
}

export async function createProject(key: string, name: string): Promise<void> {
	await getDb().insert(projects).values({ key, name });
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
