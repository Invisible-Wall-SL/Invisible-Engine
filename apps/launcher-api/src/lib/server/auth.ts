import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { getDb } from './db';
import { sessions, users } from './db/schema';
import type { Role } from '$lib/roles';

const scrypt = promisify(_scrypt);

export const SESSION_COOKIE = 'session';

export interface SessionUser {
	id: string;
	email: string;
	name: string | null;
	role: Role;
}

function token(): string {
	return randomBytes(32).toString('base64url');
}

async function sha256(value: string): Promise<string> {
	const { createHash } = await import('node:crypto');
	return createHash('sha256').update(value).digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString('hex');
	const derived = (await scrypt(password, salt, 64)) as Buffer;
	return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [salt, key] = stored.split(':');
	if (!salt || !key) return false;
	const derived = (await scrypt(password, salt, 64)) as Buffer;
	const keyBuf = Buffer.from(key, 'hex');
	return keyBuf.length === derived.length && timingSafeEqual(keyBuf, derived);
}

/** Verify email + password against an active user. Returns the user, or null. */
export async function verifyCredentials(
	email: string,
	password: string,
): Promise<SessionUser | null> {
	const [row] = await getDb()
		.select()
		.from(users)
		.where(and(eq(users.email, email.toLowerCase().trim()), eq(users.active, true)));

	if (!row || !row.passwordHash) return null;
	if (!(await verifyPassword(password, row.passwordHash))) return null;

	return { id: row.id, email: row.email, name: row.name, role: row.role };
}

/** Create a session row + return the raw session token for the cookie. */
export async function createSession(userId: string, ttlMs: number): Promise<string> {
	const raw = token();
	const expiresAt = new Date(Date.now() + ttlMs);
	await getDb()
		.insert(sessions)
		.values({ id: await sha256(raw), userId, expiresAt });
	return raw;
}

/** Resolve a session token to its user, or null. Cleans up expired sessions lazily. */
export async function validateSession(raw: string | undefined): Promise<SessionUser | null> {
	if (!raw) return null;
	const id = await sha256(raw);

	const [row] = await getDb()
		.select({
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
		await getDb().delete(sessions).where(eq(sessions.id, id));
		return null;
	}

	return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function invalidateSession(raw: string | undefined): Promise<void> {
	if (!raw) return;
	await getDb()
		.delete(sessions)
		.where(eq(sessions.id, await sha256(raw)));
}
