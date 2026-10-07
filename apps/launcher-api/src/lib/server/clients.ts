import { and, eq } from 'drizzle-orm';
import { getDb } from './db';
import { clients, projects, userClientAccess } from './db/schema';
import type { Client } from './db/schema';
import { mayTargetClient } from '$lib/accessRules';
import { withProjectKeyLock } from './projectKeyLock';
import { ProjectFolderTakenError, UNASSIGNED_CLIENT, r2Slug } from './projectPaths';
import { projectInFolder } from './projects';
import type { Role } from '$lib/roles';

/** Client key slug: same rule as project keys (`^[a-z0-9][a-z0-9_-]{0,63}$`). */
const CLIENT_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidClientKey(value: string): boolean {
	return CLIENT_KEY_RE.test(value);
}

export async function listClients(): Promise<Client[]> {
	return getDb().select().from(clients).orderBy(clients.name);
}

export async function clientExists(key: string): Promise<boolean> {
	const [row] = await getDb()
		.select({ key: clients.key })
		.from(clients)
		.where(eq(clients.key, key));
	return Boolean(row);
}

export async function createClient(key: string, name: string): Promise<void> {
	await getDb().insert(clients).values({ key, name });
}

export async function renameClient(key: string, name: string): Promise<void> {
	await getDb().update(clients).set({ name }).where(eq(clients.key, key));
}

/** Delete a client. Owned projects unassign automatically (FK ON DELETE SET NULL). */
export async function deleteClient(key: string): Promise<void> {
	await getDb().delete(clients).where(eq(clients.key, key));
}

/**
 * Assign (or clear, with `null`) a project's owning client. Holding the key's folder lock, like
 * `createProject`: throws {@link ProjectFolderTakenError} when another project, live or deleted,
 * already holds the key's R2 folder under the target client (`my_game` moved beside `my-game`).
 * Only the column changes; no R2 data moves.
 */
export async function assignProjectToClient(
	projectKey: string,
	clientKey: string | null,
): Promise<void> {
	await withProjectKeyLock(projectKey, async (tx) => {
		const holder = await projectInFolder(r2Slug(projectKey), {
			client: clientKey ?? UNASSIGNED_CLIENT,
			db: tx,
		});
		if (holder && holder !== projectKey) throw new ProjectFolderTakenError(projectKey, holder);
		await tx.update(projects).set({ clientKey }).where(eq(projects.key, projectKey));
	});
}

/** Per-user client grants, keyed by userId (for the admin table). */
export async function clientAccessFor(userIds: string[]): Promise<Record<string, string[]>> {
	const out: Record<string, string[]> = {};
	if (userIds.length === 0) return out;

	const rows = await getDb()
		.select({ userId: userClientAccess.userId, clientKey: userClientAccess.clientKey })
		.from(userClientAccess);

	const wanted = new Set(userIds);
	for (const r of rows) {
		if (!wanted.has(r.userId)) continue;
		(out[r.userId] ??= []).push(r.clientKey);
	}
	return out;
}

/** The client keys a user holds a direct grant for. */
export async function clientGrantsOf(userId: string): Promise<string[]> {
	const rows = await getDb()
		.select({ clientKey: userClientAccess.clientKey })
		.from(userClientAccess)
		.where(eq(userClientAccess.userId, userId));
	return rows.map((r) => r.clientKey);
}

/**
 * Whether a user may put a new project under `clientKey` (null = unassigned) — see
 * {@link mayTargetClient}. Only an admin skips the grant read.
 */
export async function mayCreateUnderClient(
	userId: string,
	role: Role,
	clientKey: string | null,
): Promise<boolean> {
	if (role === 'admin' || clientKey === null) return true;
	return mayTargetClient(role, clientKey, await clientGrantsOf(userId));
}

export async function grantClientAccess(userId: string, clientKey: string): Promise<void> {
	await getDb()
		.insert(userClientAccess)
		.values({ userId, clientKey })
		.onConflictDoNothing({ target: [userClientAccess.userId, userClientAccess.clientKey] });
}

export async function revokeClientAccess(userId: string, clientKey: string): Promise<void> {
	await getDb()
		.delete(userClientAccess)
		.where(and(eq(userClientAccess.userId, userId), eq(userClientAccess.clientKey, clientKey)));
}
