import { and, eq } from 'drizzle-orm';
import { getDb } from './db';
import { clients, projects, userClientAccess, userProjectAccess } from './db/schema';
import type { Project } from './db/schema';
import type { Role } from '$lib/roles';
import { DEFAULT_GAME_KIND } from '$lib/roles';

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

/** A project's display name (e.g. "Book of Borut"), or `null` when unknown. Used
 * as the default HUD game-name so the game shows the project name automatically. */
export async function projectName(key: string): Promise<string | null> {
	const [row] = await getDb()
		.select({ name: projects.name })
		.from(projects)
		.where(eq(projects.key, key));
	return row?.name ?? null;
}

/**
 * The game kind a project targets — used to pick its Invisible Editor template
 * + scaffold projection (see `docs/design/invisible-editor.md` §7.4 / §19.8 / §21.6).
 *
 * Returns the stored `game_type` verbatim when non-empty (a built-in kind id OR
 * an author-created custom kind id — §21.6), otherwise (null / legacy rows) falls
 * back to the default `'lines'`. No `isGameKind` restriction: a custom kind id is a
 * valid value now, and the admin actions are the gatekeeper that validate against
 * the built-in + custom union before writing. The DB read is wrapped in try/catch
 * returning the default — a TRANSITIONAL guard for the brief deploy window where the
 * running code knows the column but the `0010` migration has not yet been applied in
 * prod. Remove the guard once the migration is confirmed applied.
 */
export async function projectGameType(key: string): Promise<string> {
	try {
		const [row] = await getDb()
			.select({ gameType: projects.gameType })
			.from(projects)
			.where(eq(projects.key, key));
		return row?.gameType ? row.gameType : DEFAULT_GAME_KIND;
	} catch {
		return DEFAULT_GAME_KIND;
	}
}

/** Set (or change) an existing project's game kind (built-in or custom — the
 * admin action validates against the known union before calling). */
export async function setProjectGameType(key: string, gameType: string): Promise<void> {
	await getDb().update(projects).set({ gameType }).where(eq(projects.key, key));
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

/** An accessible project enriched with its owning client's display name. */
export type AccessibleProjectWithClient = {
	key: string;
	name: string;
	clientKey: string | null;
	clientName: string | null;
	launcherProfile: unknown;
};

/**
 * Like {@link accessibleProjects} but each row also carries `clientName` resolved
 * from the `clients` table. Wraps the existing access logic (no reimplementation)
 * and joins clients with a single key→name lookup — no per-project query.
 */
export async function accessibleProjectsWithClient(
	userId: string,
	role: Role,
): Promise<AccessibleProjectWithClient[]> {
	const accessible = await accessibleProjects(userId, role);
	const clientRows = await getDb().select({ key: clients.key, name: clients.name }).from(clients);
	const clientNames = new Map(clientRows.map((c) => [c.key, c.name]));

	return accessible.map((p) => ({
		key: p.key,
		name: p.name,
		clientKey: p.clientKey,
		clientName: p.clientKey === null ? null : (clientNames.get(p.clientKey) ?? null),
		launcherProfile: p.launcherProfile,
	}));
}

// Standalone game repos vendor the engine as a git submodule and share ONE root
// pnpm-lock.yaml that flattens `engine/packages/*`. The desktop launcher's build runs
// `pnpm install` with CI=1 → frozen-lockfile. If a machine's `engine/` submodule has
// drifted off the committed pin (the launcher's sync skips the submodule update when a
// dirty tree blocks its ff-pull), that frozen install hard-fails with
// ERR_PNPM_OUTDATED_LOCKFILE even though the pushed lockfile is correct.
//
// Fix at the contract boundary: every game build-cmd we hand the launcher pins the
// submodule to the superproject's committed commit FIRST, so engine == pin == committed
// lockfile right before the frozen install. This reaches EVERY launcher (even ones that
// predate the source-side fix) on its next "Sync from cloud" — no exe rebuild, no
// re-seed. Idempotent; only game-publish profiles; leaves an already-pinning cmd alone.
// See gotcha-game-deploy-lockfile-submodule-drift.
const SUBMODULE_PIN = 'git submodule update --init --recursive';
const DEFAULT_GAME_BUILD_CMD = 'pnpm install && pnpm build';

export function normalizeLauncherProfile(profile: unknown): unknown {
	if (!profile || typeof profile !== 'object') return profile;
	const p = profile as Record<string, unknown>;
	const game = p.game;
	if (!game || typeof game !== 'object') return profile;
	const g = game as Record<string, unknown>;
	const publish = g.publish;
	if (!publish || typeof publish !== 'object') return profile;
	const pub = publish as Record<string, unknown>;

	const current = typeof pub.build_cmd === 'string' ? pub.build_cmd.trim() : '';
	const base = current || DEFAULT_GAME_BUILD_CMD;
	if (base.includes('submodule update')) return profile; // already pins — leave as-is

	return {
		...p,
		game: { ...g, publish: { ...pub, build_cmd: `${SUBMODULE_PIN} && ${base}` } },
	};
}

/** The opaque launcher profile for a project, or `null` when unset/unknown. */
export async function getLauncherProfile(key: string): Promise<unknown | null> {
	const [row] = await getDb()
		.select({ launcherProfile: projects.launcherProfile })
		.from(projects)
		.where(eq(projects.key, key));
	return row?.launcherProfile ?? null;
}

/** Store (or replace) a project's opaque launcher profile. */
export async function setLauncherProfile(key: string, profile: unknown): Promise<void> {
	await getDb().update(projects).set({ launcherProfile: profile }).where(eq(projects.key, key));
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
	gameType?: string,
): Promise<void> {
	await getDb()
		.insert(projects)
		.values({ key, name, clientKey, gameType: gameType ?? null });
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
