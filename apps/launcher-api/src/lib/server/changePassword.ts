import { eq } from 'drizzle-orm';
import { passwordChangeProblem } from '$lib/passwordPolicy';
import { hashPassword, revokeUserSessions, verifyCredentials } from './auth';
import { getDb } from './db';
import { users } from './db/schema';
import { checkLoginThrottle, recordLoginFailure, recordLoginSuccess } from './loginThrottle';

export const TOO_MANY_ATTEMPTS = 'Too many attempts. Please wait and try again.';
export const WRONG_CURRENT_PASSWORD = 'Current password is incorrect.';

export interface ChangePasswordInput {
	user: { id: string; email: string };
	ip: string;
	/** The caller's own `sessions.id`, kept signed in; every other session of the user ends. */
	currentSessionId: string | null;
	current: string;
	next: string;
	confirm: string;
}

export type ChangePasswordResult = { ok: true } | { ok: false; status: 400 | 429; error: string };

/**
 * A signed-in user's self-service password change. The new password is validated first, so a
 * typo there costs no throttle attempt; the current password is then checked exactly like a
 * sign-in — same throttle, same uniform-timing verification, one message for every way it fails.
 */
export async function changePassword(input: ChangePasswordInput): Promise<ChangePasswordResult> {
	const { user, ip, current, next, confirm } = input;

	const problem = passwordChangeProblem({ current, next, confirm, email: user.email });
	if (problem) return { ok: false, status: 400, error: problem };

	const throttle = await checkLoginThrottle(ip, user.email);
	if (throttle.blocked) return { ok: false, status: 429, error: TOO_MANY_ATTEMPTS };

	const verified = await verifyCredentials(user.email, current);
	if (!verified || verified.id !== user.id) {
		await recordLoginFailure(ip, user.email);
		return { ok: false, status: 400, error: WRONG_CURRENT_PASSWORD };
	}
	await recordLoginSuccess(ip, user.email);

	await getDb()
		.update(users)
		.set({ passwordHash: await hashPassword(next) })
		.where(eq(users.id, user.id));
	await revokeUserSessions(user.id, input.currentSessionId);
	return { ok: true };
}
