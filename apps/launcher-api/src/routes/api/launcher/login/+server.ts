import { json } from '@sveltejs/kit';
import { createSession, verifyCredentials } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// OPEN route: the desktop launcher has no portal session yet, so it logs in here
// with email + password and receives a bearer token (a normal session token) it
// replays once to GET /api/launcher/tunnel-bundle. Mirrors the web login's
// protections: generic error (no user enumeration), same scrypt verify + session.
//
// The token is deliberately SHORT-lived: the desktop fetches the bundle within
// seconds and never persists the token, so a long TTL would only be a needless
// brute-force prize + sessions-table churn. It is a real session row, validated
// the same way as the web session cookie.
const SETUP_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid email or password.' }, { status: 401 });
	}

	const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };
	if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
		return json({ error: 'Invalid email or password.' }, { status: 401 });
	}

	const user = await verifyCredentials(email, password);
	if (!user) {
		return json({ error: 'Invalid email or password.' }, { status: 401 });
	}

	const token = await createSession(user.id, SETUP_TOKEN_TTL_MS);
	const expiresAt = new Date(Date.now() + SETUP_TOKEN_TTL_MS).toISOString();

	return json(
		{ token, expiresAt, role: user.role },
		{ headers: { 'cache-control': 'no-store' } },
	);
};
