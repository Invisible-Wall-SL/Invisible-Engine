import { eq, inArray } from 'drizzle-orm';
import { getDb } from './db';
import { loginAttempts } from './db/schema';

/**
 * Shared brute-force throttle for the two password-login surfaces — the web
 * `/login` form action and the open `POST /api/launcher/login` JSON endpoint —
 * so both behave identically. Failures are counted independently per client IP
 * and per target email; a hit on EITHER scope locks the request out. For each
 * scope: a handful of free attempts (a human fat-fingering a password), then an
 * exponential-backoff lockout capped per scope, and a decay window after which a
 * quiet scope starts fresh (so an occasional typo never accumulates). A
 * successful login clears both scopes immediately.
 *
 * The two scopes are deliberately ASYMMETRIC:
 *  - IP scope clamps harder (longer lockout) — an IP is not an account, so
 *    stalling a guessing source for up to an hour can't deny a real user.
 *  - EMAIL scope is capped SHORT. A per-email lockout is itself an
 *    account-lockout DoS surface: a remote attacker who only knows a victim's
 *    email (never the password) can keep that email locked by guessing. Capping
 *    the email lockout low (minutes, not an hour) means the worst case is a
 *    brief, self-healing delay rather than a sustained denial of the owner's own
 *    login. On this invite-only portal the victim could be the owner, so the
 *    short cap matters. Residual accepted risk: a determined attacker can still
 *    impose repeated short delays on a known email; eliminating that entirely
 *    (e.g. CAPTCHA / proof-of-work) is out of scope here.
 *
 * Storage is the existing Postgres DB (the `login_attempts` table) rather than an
 * in-memory map: the launcher runs on Railway where the process restarts on every
 * deploy and may be horizontally scaled, both of which would silently reset (or
 * shard) an in-memory counter and defeat the throttle. The DB is the one piece of
 * shared, durable state every instance already talks to. (Rows are removed only on
 * a successful login; never-succeeding scanner IPs accumulate slowly — the decay
 * logic ignores their stale counts, so it's a housekeeping concern, not a
 * correctness one. Prune rows older than the decay window if the table ever grows.)
 *
 * Every DB access fails OPEN (logs + allows): a database hiccup must never lock
 * the whole team out of signing in. The window where that matters is small, and
 * the counters resume as soon as the DB recovers.
 */

interface ScopePolicy {
	/** Failures allowed before any lockout kicks in. */
	freeAttempts: number;
	/** Lockout for the first failure past the free allowance; doubles each step. */
	baseLockMs: number;
	/** Ceiling on the exponential backoff. */
	maxLockMs: number;
	/** A scope quiet for this long resets to zero failures on its next failure. */
	decayMs: number;
}

const IP_POLICY: ScopePolicy = {
	freeAttempts: 10,
	baseLockMs: 60_000, // 1 minute
	maxLockMs: 60 * 60_000, // up to 1 hour — an IP isn't an account
	decayMs: 60 * 60_000, // 1 hour
};

const EMAIL_POLICY: ScopePolicy = {
	freeAttempts: 5,
	baseLockMs: 30_000, // 30 seconds
	maxLockMs: 15 * 60_000, // capped at 15 min to bound the account-lockout DoS
	decayMs: 30 * 60_000, // 30 minutes
};

export interface ThrottleDecision {
	blocked: boolean;
	/** Seconds the caller should wait before retrying (for a `Retry-After` header). */
	retryAfterSeconds: number;
}

const ALLOWED: ThrottleDecision = { blocked: false, retryAfterSeconds: 0 };

function ipKey(ip: string): string {
	return `ip:${ip}`;
}

function emailKey(email: string): string {
	return `email:${email.toLowerCase().trim()}`;
}

/** Lockout duration once `failures` has passed the scope's free allowance. */
function lockMs(policy: ScopePolicy, failures: number): number {
	const steps = failures - policy.freeAttempts - 1; // 0 on the first locked failure
	return Math.min(policy.maxLockMs, policy.baseLockMs * 2 ** steps);
}

/**
 * Reject when the client IP or the target email is currently locked out. Call
 * BEFORE verifying credentials. `retryAfterSeconds` reflects the longer of the
 * two scopes' remaining lockouts.
 */
export async function checkLoginThrottle(ip: string, email: string): Promise<ThrottleDecision> {
	try {
		const rows = await getDb()
			.select({ lockedUntil: loginAttempts.lockedUntil })
			.from(loginAttempts)
			.where(inArray(loginAttempts.key, [ipKey(ip), emailKey(email)]));

		const now = Date.now();
		let until = 0;
		for (const row of rows) {
			const t = row.lockedUntil?.getTime() ?? 0;
			if (t > until) until = t;
		}

		if (until > now) {
			return { blocked: true, retryAfterSeconds: Math.ceil((until - now) / 1000) };
		}
		return ALLOWED;
	} catch (err) {
		console.error('[loginThrottle] check failed, allowing request:', err);
		return ALLOWED;
	}
}

/** Record one failed login attempt against both the IP and the email scope. */
export async function recordLoginFailure(ip: string, email: string): Promise<void> {
	await Promise.all([
		bumpFailure(ipKey(ip), IP_POLICY),
		bumpFailure(emailKey(email), EMAIL_POLICY),
	]);
}

async function bumpFailure(key: string, policy: ScopePolicy): Promise<void> {
	try {
		const db = getDb();
		const now = Date.now();
		const [row] = await db.select().from(loginAttempts).where(eq(loginAttempts.key, key));

		// A scope that has been quiet past its decay window starts its count over.
		const prior = row && now - row.updatedAt.getTime() <= policy.decayMs ? row.failures : 0;
		const failures = prior + 1;
		const lockedUntil =
			failures > policy.freeAttempts ? new Date(now + lockMs(policy, failures)) : null;
		const updatedAt = new Date(now);

		await db
			.insert(loginAttempts)
			.values({ key, failures, lockedUntil, updatedAt })
			.onConflictDoUpdate({
				target: loginAttempts.key,
				set: { failures, lockedUntil, updatedAt },
			});
	} catch (err) {
		console.error('[loginThrottle] record failure failed:', err);
	}
}

/** Clear both scopes after a successful login so the next session starts clean. */
export async function recordLoginSuccess(ip: string, email: string): Promise<void> {
	try {
		await getDb()
			.delete(loginAttempts)
			.where(inArray(loginAttempts.key, [ipKey(ip), emailKey(email)]));
	} catch (err) {
		console.error('[loginThrottle] clear failed:', err);
	}
}
