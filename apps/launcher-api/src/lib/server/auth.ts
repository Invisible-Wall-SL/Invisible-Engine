import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from './db';
import { loginTokens, sessions, users } from './db/schema';
import { ENV } from './env';
import type { Role } from '$lib/roles';

export const SESSION_COOKIE = 'session';

export interface SessionUser {
	id: string;
	email: string;
	name: string | null;
	role: Role;
}

function newSecret(): string {
	return randomBytes(32).toString('base64url');
}

function hash(secret: string): string {
	return createHash('sha256').update(secret).digest('hex');
}

/** Create a single-use login token for a user. Returns the raw token for the magic link. */
export async function createLoginToken(userId: string): Promise<string> {
	const db = getDb();
	const token = newSecret();
	const expiresAt = new Date(Date.now() + ENV.MAGIC_LINK_TTL_MINUTES * 60_000);
	await db.insert(loginTokens).values({ id: hash(token), userId, expiresAt });
	return token;
}

/** Consume a login token. Returns the userId on success, or null if invalid/expired/used. */
export async function consumeLoginToken(token: string): Promise<string | null> {
	const db = getDb();
	const id = hash(token);
	const [row] = await db
		.select()
		.from(loginTokens)
		.where(and(eq(loginTokens.id, id), isNull(loginTokens.usedAt)));

	if (!row) return null;
	if (row.expiresAt.getTime() < Date.now()) return null;

	await db.update(loginTokens).set({ usedAt: new Date() }).where(eq(loginTokens.id, id));
	return row.userId;
}

/** Create a session. Returns the raw session token for the cookie. */
export async function createSession(userId: string): Promise<string> {
	const db = getDb();
	const token = newSecret();
	const expiresAt = new Date(Date.now() + ENV.SESSION_TTL_DAYS * 86_400_000);
	await db.insert(sessions).values({ id: hash(token), userId, expiresAt });
	return token;
}

/** Resolve a session token to its user, or null. Cleans up expired sessions lazily. */
export async function validateSession(token: string | undefined): Promise<SessionUser | null> {
	if (!token) return null;
	const db = getDb();
	const id = hash(token);

	const [row] = await db
		.select({
			sessionId: sessions.id,
			expiresAt: sessions.expiresAt,
			id: users.id,
			email: users.email,
			name: users.name,
			role: users.role,
			active: users.active,
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.id, id));

	if (!row) return null;
	if (row.expiresAt.getTime() < Date.now() || !row.active) {
		await db.delete(sessions).where(eq(sessions.id, id));
		return null;
	}

	return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function invalidateSession(token: string | undefined): Promise<void> {
	if (!token) return;
	await getDb().delete(sessions).where(eq(sessions.id, hash(token)));
}

/** Look up an active user by email (login is invite-only: no auto-registration). */
export async function findActiveUserByEmail(email: string) {
	const [row] = await getDb()
		.select()
		.from(users)
		.where(and(eq(users.email, email.toLowerCase().trim()), eq(users.active, true)));
	return row ?? null;
}

/** Helper for seeding/admin: create a user if absent. */
export async function upsertUser(email: string, role: Role, name?: string) {
	const db = getDb();
	const normalized = email.toLowerCase().trim();
	const [existing] = await db.select().from(users).where(eq(users.email, normalized));
	if (existing) return existing;
	const [created] = await db
		.insert(users)
		.values({ id: randomUUID(), email: normalized, role, name: name ?? null })
		.returning();
	return created;
}
