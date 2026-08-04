import { and, eq, sql } from 'drizzle-orm';
import { getDb } from './db';
import { docLeases, type DocLease } from './db/schema';

/**
 * Soft, cooperative edit lease — the Postgres half of
 * `docs/design/multi-user-concurrency.md` Phase 2. A lease is a COORDINATION
 * HINT, never authz: `toolScope.gate()` stays the real security boundary. It lets
 * two people on the same `(client, project)` avoid clobbering each other; R2
 * `If-Match` remains the correctness floor for everything a lease can't cover
 * (a stale tab whose lease expired, a takeover mid-flight, the Python tools).
 *
 * Keyed per-project for now — `(toolId, clientKey, projectKey, docKey)`, with
 * `docKey` = the tool's single project doc (pass the tool id when a tool has one
 * doc). Adjudication is done by the DATABASE via one conditional upsert, so two
 * racing acquires can never both win. Expiry is the backstop; explicit takeover
 * from the UI is the plan (a crashed tab must never permanently wedge a doc).
 */

/** How often a holder should re-heartbeat to keep the lease alive. */
export const LEASE_HEARTBEAT_MS = 10_000;
/** How long a lease survives without a heartbeat before it becomes takeable. */
export const LEASE_TTL_MS = 45_000;
const LEASE_TTL_SECONDS = LEASE_TTL_MS / 1000;

export interface LeaseKey {
	toolId: string;
	clientKey: string;
	projectKey: string;
	docKey: string;
}

export interface LeaseHolder {
	userId: string;
	sessionId: string;
}

/** Who currently holds a lease we could not take, for the read-only banner. */
export interface HeldBy {
	userId: string;
	sessionId: string;
	acquiredAt: Date;
	heartbeatAt: Date;
	expiresAt: Date;
}

export type AcquireResult =
	| { held: true; lease: DocLease }
	| { held: false; heldBy: HeldBy; activeAgoMs: number };

export type HeartbeatResult =
	| { held: true; lease: DocLease }
	| { held: false; heldBy: HeldBy | null };

/**
 * The takeability predicate, kept as a pure function so it can be unit-tested
 * directly AND so it reads identically to the SQL `setWhere` below (which is a
 * faithful transcription — an existing lease is takeable when there is none, when
 * it has expired, or when we already hold it). Keep the two in lock-step: the SQL
 * is the source of truth in production, this mirror is what the offline fixture
 * adjudicates against.
 */
export function isTakeable(
	existing: Pick<DocLease, 'holderUserId' | 'holderSessionId' | 'expiresAt'> | null,
	holder: LeaseHolder,
	nowMs: number,
): boolean {
	if (!existing) return true;
	if (existing.expiresAt.getTime() < nowMs) return true;
	return isSameHolder(existing, holder);
}

/** Whether an existing lease row is held by this exact `(userId, sessionId)`. */
export function isSameHolder(
	existing: Pick<DocLease, 'holderUserId' | 'holderSessionId'>,
	holder: LeaseHolder,
): boolean {
	return existing.holderUserId === holder.userId && existing.holderSessionId === holder.sessionId;
}

function heldBy(row: DocLease): HeldBy {
	return {
		userId: row.holderUserId,
		sessionId: row.holderSessionId,
		acquiredAt: row.acquiredAt,
		heartbeatAt: row.heartbeatAt,
		expiresAt: row.expiresAt,
	};
}

function keyMatch(key: LeaseKey) {
	return and(
		eq(docLeases.toolId, key.toolId),
		eq(docLeases.clientKey, key.clientKey),
		eq(docLeases.projectKey, key.projectKey),
		eq(docLeases.docKey, key.docKey),
	);
}

async function readLease(key: LeaseKey): Promise<DocLease | null> {
	const [row] = await getDb().select().from(docLeases).where(keyMatch(key)).limit(1);
	return row ?? null;
}

const nowSql = sql`now()`;
const expiresSql = sql`now() + ${LEASE_TTL_SECONDS} * interval '1 second'`;

/**
 * Conditional upsert — the DB adjudicates. Insert if absent; on conflict, take
 * over ONLY if the current lease is expired or already ours (`setWhere`), else
 * leave the live holder untouched and return no row. One statement, so two racing
 * acquires can't both win. `acquiredAt` resets only when the holder changes.
 */
export async function acquire(key: LeaseKey, holder: LeaseHolder): Promise<AcquireResult> {
	const sameHolderSql = sql`${docLeases.holderUserId} = excluded.holder_user_id and ${docLeases.holderSessionId} = excluded.holder_session_id`;

	const [granted] = await getDb()
		.insert(docLeases)
		.values({
			...key,
			holderUserId: holder.userId,
			holderSessionId: holder.sessionId,
			acquiredAt: nowSql,
			heartbeatAt: nowSql,
			expiresAt: expiresSql,
		})
		.onConflictDoUpdate({
			target: [docLeases.toolId, docLeases.clientKey, docLeases.projectKey, docLeases.docKey],
			set: {
				holderUserId: holder.userId,
				holderSessionId: holder.sessionId,
				acquiredAt: sql`case when ${sameHolderSql} then ${docLeases.acquiredAt} else now() end`,
				heartbeatAt: nowSql,
				expiresAt: expiresSql,
			},
			setWhere: sql`${docLeases.expiresAt} < now() or (${sameHolderSql})`,
		})
		.returning();

	if (granted) return { held: true, lease: granted };

	// The upsert's `setWhere` was false: a live, other holder owns it. Report them.
	const current = await readLease(key);
	// Vanished between the upsert and this read (released/expired) — retry once.
	if (!current) return acquire(key, holder);
	return {
		held: false,
		heldBy: heldBy(current),
		activeAgoMs: Math.max(0, Date.now() - current.heartbeatAt.getTime()),
	};
}

/**
 * Extend the lease only while WE still hold it. If it was taken over (a different
 * holder), no row matches and we return not-held so the client can flip to
 * read-only. A same-holder heartbeat re-extends even past expiry (nobody took it).
 */
export async function heartbeat(key: LeaseKey, holder: LeaseHolder): Promise<HeartbeatResult> {
	const [row] = await getDb()
		.update(docLeases)
		.set({ heartbeatAt: nowSql, expiresAt: expiresSql })
		.where(
			and(
				keyMatch(key),
				eq(docLeases.holderUserId, holder.userId),
				eq(docLeases.holderSessionId, holder.sessionId),
			),
		)
		.returning();

	if (row) return { held: true, lease: row };
	const current = await readLease(key);
	return { held: false, heldBy: current ? heldBy(current) : null };
}

/** Best-effort release; only deletes a lease we still hold. Expiry is the backstop. */
export async function release(key: LeaseKey, holder: LeaseHolder): Promise<void> {
	await getDb()
		.delete(docLeases)
		.where(
			and(
				keyMatch(key),
				eq(docLeases.holderUserId, holder.userId),
				eq(docLeases.holderSessionId, holder.sessionId),
			),
		);
}

/**
 * Force-acquire regardless of the current holder — an explicit user action that
 * is ALWAYS allowed, because a lease must never permanently wedge a doc. Recorded
 * plainly as a fresh acquisition (`acquiredAt` resets).
 */
export async function takeover(key: LeaseKey, holder: LeaseHolder): Promise<{ lease: DocLease }> {
	const [row] = await getDb()
		.insert(docLeases)
		.values({
			...key,
			holderUserId: holder.userId,
			holderSessionId: holder.sessionId,
			acquiredAt: nowSql,
			heartbeatAt: nowSql,
			expiresAt: expiresSql,
		})
		.onConflictDoUpdate({
			target: [docLeases.toolId, docLeases.clientKey, docLeases.projectKey, docLeases.docKey],
			set: {
				holderUserId: holder.userId,
				holderSessionId: holder.sessionId,
				acquiredAt: nowSql,
				heartbeatAt: nowSql,
				expiresAt: expiresSql,
			},
		})
		.returning();

	return { lease: row };
}
