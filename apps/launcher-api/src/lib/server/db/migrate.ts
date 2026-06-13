import { existsSync } from 'node:fs';
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
 * Apply any pending Drizzle migrations against `DATABASE_URL`. Called once from
 * the server `init` hook (see `hooks.server.ts`), so the prod schema is brought
 * up to date BEFORE the first request — the "apply migrations before serving
 * schema-dependent code" rule (`docs/INFRA.md`), without a manual step.
 *
 * Fail-soft: a missing `DATABASE_URL` (local build/dev), an unlocatable folder,
 * or a migration error is logged and swallowed rather than crashing boot — a
 * throw here would refuse to start the whole server. The migrator is
 * transactional + idempotent (tracked in `__drizzle_migrations`), so a re-run is
 * safe. NOTE: this assumes prod's migration bookkeeping is current (the project
 * uses numbered `drizzle-kit` migrations); if a boot log shows a migration error,
 * reconcile once with `pnpm --filter launcher-api db:migrate`.
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
