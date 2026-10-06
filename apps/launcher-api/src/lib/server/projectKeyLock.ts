import { sql } from 'drizzle-orm';
import { getDb } from './db';
import { r2Slug } from './projectPaths';

/**
 * The first half of the two-int advisory lock key ('PROJ'). The two-int form is a key space of its
 * own (the one-bigint form, e.g. the Rigger backfill's, never meets it), and this half keeps a
 * project key from sharing a lock with any other feature that hashes a string.
 */
const PROJECT_KEY_LOCK = 0x50524f4a;

/** How long a caller waits for the key before its statement fails, rather than hanging forever. */
const LOCK_WAIT = sql.raw(`SET LOCAL lock_timeout = '30s'`);

type Db = ReturnType<typeof getDb>;
export type LockTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Run `fn` holding the project key `projectKey`: a transaction-scoped Postgres advisory lock keyed
 * by the key's R2 folder, `r2Slug(key)` — `my-game` and `my_game` share a folder, so they share the
 * lock — and by nothing else: keys are global, so a pending key under one client and a project made
 * under another still meet here. Taken by every path that makes a key stop being free —
 * `createProject` (Game Maker, Admin, the desktop sync, Director's duplicate) and Director's run
 * create — and by the pending-mockup cleanup, which re-checks "no project, no run" inside it, so a
 * folder is never cleared while it is becoming a project's or a run's.
 *
 * Released at commit or rollback. A hash collision between two folders only serializes them.
 */
export async function withProjectKeyLock<T>(
	projectKey: string,
	fn: (tx: LockTx) => Promise<T>,
): Promise<T> {
	return getDb().transaction(async (tx) => {
		await tx.execute(LOCK_WAIT);
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(${PROJECT_KEY_LOCK}::int, hashtext(${r2Slug(projectKey)}))`,
		);
		return fn(tx);
	});
}
