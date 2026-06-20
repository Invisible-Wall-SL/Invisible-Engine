import { createHash } from 'node:crypto';
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

/** Postgres "object already exists" SQLSTATEs — expected for every statement
 * whose object `db:push` already created. Everything else is a real error. */
const DUPLICATE_OBJECT_CODES = new Set([
	'42P07', // duplicate_table (also duplicate index)
	'42701', // duplicate_column
	'42710', // duplicate_object (constraint, type, …)
	'42P06', // duplicate_schema
	'42723', // duplicate_function
	'42P16', // invalid_table_definition — e.g. PK already present on the column
]);

/**
 * Self-healing reconcile for a DB provisioned by `db:push` (incidents 2026-06-13 /
 * 2026-06-20, see `docs/INFRA.md` "Auto-migrate on boot"): `push` syncs the schema
 * to `schema.ts` at push time but records NOTHING in `drizzle.__drizzle_migrations`,
 * so a plain `migrate()` would replay from `0000` onto existing tables and abort.
 *
 * The OLD fix stamped one baseline row at the *newest* journal `when` and skipped
 * every migration — but the migrator decides what to apply by a `created_at`
 * THRESHOLD (apply where `when` > max recorded), so any migration whose `when` sat
 * below the stamped baseline was silently skipped FOREVER. That masked the missing
 * `app_settings` table (`0009`) when the baseline was stamped at `0010`.
 *
 * The fix here records the journal HONESTLY: when the bookkeeping table is empty BUT
 * the app is already provisioned (a core table exists), replay every journal
 * migration's SQL with duplicate-object errors tolerated and record each as applied.
 * Statements whose objects already exist (everything the push created) are skipped;
 * statements introducing genuinely new objects (migrations added after the push)
 * apply for real. Result: an accurately-recorded journal with no missing objects and
 * no overshoot — independent of which schema version the push matched.
 *
 * A truly EMPTY database (no app tables) and an already-migrate-managed DB are both
 * left untouched, so the normal `migrate()` handles them.
 */
async function reconcilePushProvisioned(
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
	if (recorded[0].n > 0) return; // already migrate-managed — nothing to reconcile

	const provisioned = await sql<{ reg: string | null }[]>`
		SELECT to_regclass('public.users') AS reg
	`;
	if (provisioned[0].reg === null) return; // truly empty DB — let migrate apply 0000+

	const journal = JSON.parse(
		readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
	) as { entries: { when: number; tag: string }[] };
	const entries = [...journal.entries].sort((a, b) => a.when - b.when);

	let healed = 0;
	for (const entry of entries) {
		const body = readFileSync(join(migrationsFolder, `${entry.tag}.sql`), 'utf8');
		const statements = body
			.split('--> statement-breakpoint')
			.map((s) => s.trim())
			.filter(Boolean);
		for (const statement of statements) {
			try {
				await sql.unsafe(statement);
			} catch (err) {
				const code = (err as { code?: string }).code;
				if (!code || !DUPLICATE_OBJECT_CODES.has(code)) throw err;
			}
		}
		// Hash = sha256 of the file (matches drizzle's format; the threshold check
		// keys off `created_at`, so the value is bookkeeping-cosmetic).
		const hash = createHash('sha256').update(body).digest('hex');
		await sql`
			INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${entry.when})
		`;
		healed++;
	}
	console.warn(
		`[migrate] db:push-provisioned DB detected — reconciled ${healed} migration(s) ` +
			`with duplicate-tolerant replay (no overshoot)`,
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
 * reconciled first (see {@link reconcilePushProvisioned}) so it never replays
 * from `0000` and never overshoots past an unapplied migration.
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
		await reconcilePushProvisioned(sql, migrationsFolder);
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
