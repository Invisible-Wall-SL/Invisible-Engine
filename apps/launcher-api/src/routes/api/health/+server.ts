import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/db';
import { getMigrationState, latestJournalEntry } from '$lib/server/db/migrate';
import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

const DB_TIMEOUT_MS = 3000;
/** The bookkeeping table itself is missing: the DB answered, but nothing was ever migrated. */
const UNDEFINED_TABLE = '42P01';

/**
 * Liveness AND readiness: 200 only when the database answers and its recorded migrations reach
 * the newest one this build carries. It is the path the Railway healthcheck and the external
 * uptime monitor both poll (docs/INFRA.md "Monitoring"), so red here means a deploy is held back
 * or someone is paged — which is why it checks the schema, not merely that Node is up.
 *
 * Unauthenticated and public, so it names STATES only — no error text, no host, no versions a
 * visitor could use.
 */
export const GET: RequestHandler = async () => {
	const boot = getMigrationState();
	const journal = latestJournalEntry();

	let db: 'ok' | 'down' | 'unconfigured' = 'unconfigured';
	let schema: 'current' | 'behind' | 'unknown' = 'unknown';
	if (env.DATABASE_URL) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const rows = await Promise.race([
				getDb().execute<{ latest: string | null }>(
					sql`SELECT max(created_at)::text AS latest FROM drizzle.__drizzle_migrations`,
				),
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error('db timeout')), DB_TIMEOUT_MS);
				}),
			]);
			db = 'ok';
			const latest = Number(rows[0]?.latest ?? 0);
			if (journal) schema = latest >= journal.latestWhen ? 'current' : 'behind';
		} catch (err) {
			if ((err as { code?: string }).code === UNDEFINED_TABLE) {
				db = 'ok';
				schema = 'behind';
			} else {
				db = 'down';
				console.error('[health] database check failed:', err);
			}
		} finally {
			clearTimeout(timer);
		}
	}

	// `boot` is reported but not gated on: a migration that failed is also unrecorded, so `schema`
	// is already `behind`; and a boot that failed only because the DB was briefly unreachable must
	// not keep the service red after the DB is back and the schema is in fact current.
	const ok = db === 'ok' && schema === 'current';
	return json(
		{ ok, db, migrations: { boot, schema } },
		{ status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
	);
};
