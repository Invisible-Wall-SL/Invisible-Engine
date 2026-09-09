import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { getDb } from './db';
import {
	clients,
	games,
	projects,
	sessions,
	userClientAccess,
	userProjectAccess,
} from './db/schema';
import type { Project } from './db/schema';
import type { Role } from '$lib/roles';
import { DEFAULT_GAME_KIND } from '$lib/roles';
import { getDeployToken } from './appSettings';

/** The default project every user can always reach; null session = this key. */
export const DEFAULT_PROJECT_KEY = 'cloud';

/** Project key slug: `^[a-z0-9][a-z0-9_-]{0,63}$` (shared tool contract). */
const PROJECT_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidProjectKey(value: string): boolean {
	return PROJECT_KEY_RE.test(value);
}

/** Every LIVE project. Soft-deleted rows are excluded — see {@link softDeleteProject}. */
export async function listProjects(): Promise<Project[]> {
	return getDb()
		.select()
		.from(projects)
		.where(isNull(projects.deletedAt))
		.orderBy(projects.createdAt);
}

/** Soft-deleted projects, newest deletion first — the admin panel's restore/purge list. */
export async function listDeletedProjects(): Promise<Project[]> {
	return getDb()
		.select()
		.from(projects)
		.where(isNotNull(projects.deletedAt))
		.orderBy(desc(projects.deletedAt));
}

/** True only for a TOMBSTONED row — the precondition for restore and purge. */
export async function projectIsDeleted(key: string): Promise<boolean> {
	const [row] = await getDb()
		.select({ key: projects.key })
		.from(projects)
		.where(and(eq(projects.key, key), isNotNull(projects.deletedAt)));
	return Boolean(row);
}

/**
 * True when a LIVE project has this key. A soft-deleted row reads as absent, so a
 * deleted project can't be renamed, re-scoped or granted without being restored first.
 * To ask "is this key free to CREATE?" use {@link projectKeyTaken} — the key is still
 * a primary key while the tombstone exists, so `!projectExists` does NOT imply insertable.
 */
export async function projectExists(key: string): Promise<boolean> {
	const [row] = await getDb()
		.select({ key: projects.key })
		.from(projects)
		.where(and(eq(projects.key, key), isNull(projects.deletedAt)));
	return Boolean(row);
}

/**
 * True when ANY row holds this key, deleted or not. Creation paths must use this:
 * inserting over a tombstone is a primary-key violation, and the caller owes the user
 * the real reason ("deleted — restore or purge it") rather than a 500.
 */
export async function projectKeyTaken(key: string): Promise<boolean> {
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
	/** The project's game kind, defaulted exactly as {@link projectGameType} defaults it, so a
	 *  caller never has to re-apply the legacy-null fallback. */
	gameType: string;
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
		gameType: p.gameType ? p.gameType : DEFAULT_GAME_KIND,
		launcherProfile: p.launcherProfile,
	}));
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

/**
 * A PATH-SAFE 32-char random token from CSPRNG bytes. Used for the per-project read
 * token, which must survive as a single leading PATH segment in `/api/deploy/f/<token>/...`
 * — so no `+`/`/`/`=` (rules out raw base64).
 *
 * The alphabet deliberately EXCLUDES visually-ambiguous glyphs (`0/O`, `1/l/I`) because this
 * token ends up in a game URL humans copy/paste/read — and a lowercase-`l` mistaken for a
 * capital-`I` silently 401s the live-fetch, dropping the game back to stale baked assets with
 * no visible error. A homoglyph-free alphabet makes that class of corruption impossible.
 */
function mintReadToken(): string {
	// A–Z minus I,O · a–z minus l · 2–9 (no 0/1) — 57 unambiguous, path-safe chars.
	const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
	const bytes = randomBytes(32);
	let out = '';
	for (let i = 0; i < 32; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
	return out;
}

/**
 * Return the project's existing read token, or mint + persist a new one. The read
 * token is the PUBLIC, read-only credential a browser-served generic-runtime game
 * uses for its live `/api/editor/runtime` + `/api/deploy/f/...` fetches — so the
 * shared build/deploy token is never embedded in a public game URL. Idempotent:
 * once minted the same token is returned forever (rotation is a future admin op).
 * Returns `null` only when the project key is unknown.
 */
export async function getOrMintReadToken(projectKey: string): Promise<string | null> {
	const db = getDb();
	const [row] = await db
		.select({ readToken: projects.readToken })
		.from(projects)
		.where(eq(projects.key, projectKey));
	if (!row) return null;
	if (row.readToken) return row.readToken;
	const token = mintReadToken();
	await db.update(projects).set({ readToken: token }).where(eq(projects.key, projectKey));
	return token;
}

/**
 * Whether `token` may READ the given project's runtime/deploy data. True when it
 * equals EITHER the shared build/deploy token (so build CI + the existing tools
 * keep working everywhere they did) OR the project's own read token. A blank
 * token never matches. Used to gate the two public serving endpoints.
 */
export async function projectAllowsRead(projectKey: string, token: string): Promise<boolean> {
	if (!token) return false;
	const deployToken = await getDeployToken();
	if (deployToken && token === deployToken) return true;
	const [row] = await getDb()
		.select({ readToken: projects.readToken })
		.from(projects)
		.where(eq(projects.key, projectKey));
	return Boolean(row?.readToken) && token === row!.readToken;
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

/**
 * Soft-delete: stamp the tombstone, unregister the project's games, and drop any
 * session parked on it back to the default. Reversible by {@link restoreProject};
 * NOTHING in R2 is touched. Returns the game keys that were unregistered so the
 * caller can name them back to the user.
 *
 * The games rows go WITH the project deliberately. Leaving them (the old
 * `ON DELETE SET NULL` behaviour) is what produced two rows in the live Games grid
 * pointing at a project that no longer existed, with URLs that 401 once the read
 * token is gone. A game without its project is not a game.
 */
export async function softDeleteProject(key: string, when: Date): Promise<string[]> {
	return getDb().transaction(async (tx) => {
		const owned = await tx
			.select({ key: games.key })
			.from(games)
			.where(eq(games.projectKey, key));
		await tx.delete(games).where(eq(games.projectKey, key));
		await tx
			.update(sessions)
			.set({ activeProjectKey: null })
			.where(eq(sessions.activeProjectKey, key));
		await tx.update(projects).set({ deletedAt: when }).where(eq(projects.key, key));
		return owned.map((g) => g.key);
	});
}

/** Undo a {@link softDeleteProject}. The games it unregistered are NOT resurrected. */
export async function restoreProject(key: string): Promise<void> {
	await getDb().update(projects).set({ deletedAt: null }).where(eq(projects.key, key));
}

/**
 * HARD delete of the row — no tombstone, no undo. Reached from exactly two places:
 * the purge action (after its R2 objects are gone) and the game-maker duplicate's
 * rollback (which is deleting a row it created seconds earlier). Never wire this to
 * a user-facing "Delete" button; that is {@link softDeleteProject}.
 */
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
