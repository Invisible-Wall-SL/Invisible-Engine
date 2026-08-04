import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { SESSION_COOKIE, sessionIdFromToken } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import {
	acquire,
	heartbeat,
	LEASE_HEARTBEAT_MS,
	LEASE_TTL_MS,
	release,
	takeover,
	type HeldBy,
	type LeaseHolder,
	type LeaseKey,
} from '$lib/server/lease';
import type { RequestHandler } from './$types';

/**
 * Soft edit-lease coordination endpoint — the BACKEND half of
 * `docs/design/multi-user-concurrency.md` Phase 2. Actions: `acquire`,
 * `heartbeat`, `release`, `takeover` over the key `(toolId, clientKey,
 * projectKey, docKey)`.
 *
 * The lease is a COORDINATION HINT, not authz — `toolScope.gate()` remains the
 * real gate — but we still require a logged-in user so a holder is attributable.
 * Not-held is a valid ANSWER, not a failure: acquire/heartbeat that can't grant
 * return `200 { held: false, … }`, never an error status. Errors (`json({error})`,
 * never `error()` on the not-held path) are reserved for genuinely bad requests.
 */

type Action = 'acquire' | 'heartbeat' | 'release' | 'takeover';
const ACTIONS: ReadonlySet<string> = new Set<Action>([
	'acquire',
	'heartbeat',
	'release',
	'takeover',
]);

interface HolderView {
	userId: string;
	name: string | null;
	email: string | null;
	/** Whether the holder is the caller's own session (a stale/other tab of theirs). */
	mine: boolean;
	acquiredAt: string;
	heartbeatAt: string;
	expiresAt: string;
}

function str(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function readKey(body: Record<string, unknown>): LeaseKey | null {
	const toolId = str(body.toolId);
	const clientKey = str(body.clientKey);
	const projectKey = str(body.projectKey);
	const docKey = str(body.docKey);
	if (!toolId || !clientKey || !projectKey || !docKey) return null;
	return { toolId, clientKey, projectKey, docKey };
}

/** Enrich a raw holder with the display name/email for the read-only banner. */
async function holderView(held: HeldBy, self: LeaseHolder): Promise<HolderView> {
	const [row] = await getDb()
		.select({ name: users.name, email: users.email })
		.from(users)
		.where(eq(users.id, held.userId))
		.limit(1);
	return {
		userId: held.userId,
		name: row?.name ?? null,
		email: row?.email ?? null,
		mine: held.userId === self.userId && held.sessionId === self.sessionId,
		acquiredAt: held.acquiredAt.toISOString(),
		heartbeatAt: held.heartbeatAt.toISOString(),
		expiresAt: held.expiresAt.toISOString(),
	};
}

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const sessionId = await sessionIdFromToken(cookies.get(SESSION_COOKIE));
	if (!sessionId) throw error(401, 'Not authenticated');

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ error: 'bad-request' }, { status: 400 });
	}

	const action = str(body.action);
	if (!action || !ACTIONS.has(action)) {
		return json({ error: 'bad-request' }, { status: 400 });
	}

	const key = readKey(body);
	if (!key) return json({ error: 'bad-request' }, { status: 400 });

	const holder: LeaseHolder = { userId: locals.user.id, sessionId };

	switch (action as Action) {
		case 'acquire': {
			const result = await acquire(key, holder);
			if (result.held) {
				return json({
					held: true,
					lease: result.lease,
					heartbeatMs: LEASE_HEARTBEAT_MS,
					ttlMs: LEASE_TTL_MS,
				});
			}
			return json({
				held: false,
				heldBy: await holderView(result.heldBy, holder),
				activeAgoMs: result.activeAgoMs,
			});
		}
		case 'heartbeat': {
			const result = await heartbeat(key, holder);
			if (result.held) {
				return json({ held: true, lease: result.lease, heartbeatMs: LEASE_HEARTBEAT_MS });
			}
			return json({
				held: false,
				heldBy: result.heldBy ? await holderView(result.heldBy, holder) : null,
			});
		}
		case 'release': {
			await release(key, holder);
			return json({ released: true });
		}
		case 'takeover': {
			const result = await takeover(key, holder);
			return json({
				held: true,
				lease: result.lease,
				heartbeatMs: LEASE_HEARTBEAT_MS,
				ttlMs: LEASE_TTL_MS,
			});
		}
	}
};
