import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Locate the committed `drizzle/` migrations folder at runtime. adapter-node does
 * NOT copy it into `build/`, and the process cwd varies with the Railway start
 * command (repo root vs `apps/launcher-api`), so probe a few candidates derived
 * from cwd and from this module's location. A folder counts only if it carries
 * the drizzle journal. Returns `null` when none is found.
 */
function resolveMigrationsFolder(): string | null {
	const candidates = [
		resolve(process.cwd(), 'drizzle'),
		resolve(process.cwd(), 'apps/launcher-api/drizzle'),
	];
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 8; i++) {
		candidates.push(resolve(dir, 'drizzle'), resolve(dir, 'apps/launcher-api/drizzle'));
		dir = dirname(dir);
	}
	return candidates.find((c) => existsSync(join(c, 'meta', '_journal.json'))) ?? null;
}

let ran = false;

/**
 * Self-healing baseline for a DB provisioned by `db:push` (incident 2026-06-13,
 * see `docs/INFRA.md` "Auto-migrate on boot"): `push` syncs the schema to the
 * current definition but records NOTHING in `drizzle.__drizzle_migrations`, so the
 * migrator would replay from `0000` onto already-existing tables and abort. If the
 * bookkeeping table is empty BUT the app is already provisioned (a core table
 * exists), the schema is current-by-push — so we record one baseline row at the
 * latest journal timestamp; the migrator then applies only genuinely newer
 * migrations (none, at baseline time). A truly EMPTY database (no app tables) is
 * left untouched so the migrator creates everything from `0000` as normal.
 */
async function baselineIfPushProvisioned(
	sql: ReturnType<typeof postgres>,
	migrationsFolder: string,
): Promise<void> {
	// Same bookkeeping DDL the migrator itself uses (idempotent), so we can read
	// the table before handing off to `migrate()`.
	await sql.unsafe('CREATE SCHEMA IF NOT EXISTS "drizzle"');
	await sql.unsafe(
		'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
	);
	const recorded = await sql<{ n: number }[]>`
		SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations
	`;
	if (recorded[0].n > 0) return; // already migrate-managed — nothing to baseline

	const provisioned = await sql<{ reg: string | null }[]>`
		SELECT to_regclass('public.users') AS reg
	`;
	if (provisioned[0].reg === null) return; // truly empty DB — let migrate apply 0000+

	const journal = JSON.parse(
		readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
	) as { entries: { when: number }[] };
	const latest = Math.max(...journal.entries.map((e) => e.when));
	await sql`
		INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('baseline-auto', ${latest})
	`;
	console.warn(
		`[migrate] db:push-provisioned DB detected — baselined journal to ${latest} (no replay)`,
	);
}

/**
 * Apply any pending Drizzle migrations against `DATABASE_URL`. Called once from
 * the server `init` hook (see `hooks.server.ts`), so the prod schema is brought
 * up to date BEFORE the first request — the "apply migrations before serving
 * schema-dependent code" rule (`docs/INFRA.md`), without a manual step.
 *
 * Fail-soft: a missing `DATABASE_URL` (local build/dev), an unlocatable folder,
 * or a migration error is logged and swallowed rather than crashing boot — a
 * throw here would refuse to start the whole server. The migrator is
 * transactional + idempotent (tracked in `__drizzle_migrations`), so a re-run is
 * safe. A `db:push`-provisioned DB (empty journal + existing tables) is
 * auto-baselined first (see {@link baselineIfPushProvisioned}) so it never
 * replays from `0000`.
 */
export async function runMigrations(): Promise<void> {
	if (ran) return;
	ran = true;

	const url = process.env.DATABASE_URL;
	if (!url) {
		console.warn('[migrate] DATABASE_URL unset — skipping auto-migration');
		return;
	}
	const migrationsFolder = resolveMigrationsFolder();
	if (!migrationsFolder) {
		console.error('[migrate] drizzle migrations folder not found — skipping auto-migration');
		return;
	}

	const sql = postgres(url, { max: 1 });
	try {
		await baselineIfPushProvisioned(sql, migrationsFolder);
		await migrate(drizzle(sql), { migrationsFolder });
		console.log(`[migrate] schema up to date (${migrationsFolder})`);
	} catch (err) {
		console.error(
			'[migrate] auto-migration FAILED — schema-dependent routes may 500 until resolved:',
			err,
		);
	} finally {
		await sql.end({ timeout: 5 });
	}
}
