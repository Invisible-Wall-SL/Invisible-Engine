import { and, eq } from 'drizzle-orm';
import { getDb } from './db';
import { sessions, users } from './db/schema';
import { ROLES, type Role } from '$lib/roles';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
	return raw.toLowerCase().trim();
}

export function isValidEmail(email: string): boolean {
	return EMAIL_RE.test(email);
}

export function isValidRole(value: string): value is Role {
	return (ROLES as string[]).includes(value);
}

/** Row shape for the admin user table (never includes the password hash). */
export interface AdminUserRow {
	id: string;
	email: string;
	name: string | null;
	role: Role;
	active: boolean;
	expiresAt: Date | null;
	createdAt: Date;
	sessionCount: number;
	lastSeenAt: Date | null;
}

export async function listUsers(): Promise<AdminUserRow[]> {
	const db = getDb();
	const rows = await db
		.select({
			id: users.id,
			email: users.email,
			name: users.name,
			role: users.role,
			active: users.active,
			expiresAt: users.expiresAt,
			createdAt: users.createdAt,
		})
		.from(users)
		.orderBy(users.createdAt);

	const sessionRows = await db
		.select({ userId: sessions.userId, createdAt: sessions.createdAt })
		.from(sessions);

	const counts = new Map<string, number>();
	const lastSeen = new Map<string, Date>();
	for (const s of sessionRows) {
		counts.set(s.userId, (counts.get(s.userId) ?? 0) + 1);
		const prev = lastSeen.get(s.userId);
		if (!prev || s.createdAt.getTime() > prev.getTime()) lastSeen.set(s.userId, s.createdAt);
	}

	return rows.map((r) => ({
		...r,
		sessionCount: counts.get(r.id) ?? 0,
		lastSeenAt: lastSeen.get(r.id) ?? null,
	}));
}

/** Number of accounts that are admins AND still able to log in (active + unexpired). */
export async function activeAdminCount(): Promise<number> {
	const rows = await getDb()
		.select({ expiresAt: users.expiresAt })
		.from(users)
		.where(and(eq(users.role, 'admin'), eq(users.active, true)));

	const now = Date.now();
	return rows.filter((r) => r.expiresAt === null || r.expiresAt.getTime() >= now).length;
}

/**
 * Guard against an admin removing the last usable admin. `targetId` is the user
 * being changed; `change` describes whether the change makes them a non-admin or
 * unusable. Returns true when the change would leave zero usable admins.
 */
export async function wouldRemoveLastAdmin(targetId: string): Promise<boolean> {
	const [target] = await getDb()
		.select({ role: users.role, active: users.active, expiresAt: users.expiresAt })
		.from(users)
		.where(eq(users.id, targetId));
	if (!target) return false;

	const now = Date.now();
	const targetIsUsableAdmin =
		target.role === 'admin' &&
		target.active &&
		(target.expiresAt === null || target.expiresAt.getTime() >= now);
	if (!targetIsUsableAdmin) return false;

	return (await activeAdminCount()) <= 1;
}

export async function sessionsForUser(userId: string) {
	return getDb()
		.select({
			id: sessions.id,
			expiresAt: sessions.expiresAt,
			createdAt: sessions.createdAt,
		})
		.from(sessions)
		.where(eq(sessions.userId, userId))
		.orderBy(sessions.createdAt);
}
