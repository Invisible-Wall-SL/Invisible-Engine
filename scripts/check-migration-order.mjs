#!/usr/bin/env node
/**
 * Fail a change whose launcher migration would be skipped in production:
 *   pnpm check:migration-order            (base: origin/main locally, HEAD^1 in CI)
 *   node scripts/check-migration-order.mjs --base <ref>
 *
 * The launcher migrates itself at boot with drizzle's postgres-js migrator
 * (`apps/launcher-api/src/lib/server/db/migrate.ts`), which applies a migration only when its
 * journal `when` is LATER than the newest `created_at` already recorded in the database. It does not
 * go by index. So when two PRs each generate a migration and the one generated second merges and
 * deploys first, the other's older `when` is silently skipped: its table or column never exists in
 * production while every fresh-DB test, which applies all of them in one pass, stays green. 9F and
 * 9G (0034 and 0035) were one merge away from exactly that on 2026-10-27.
 *
 * The rules:
 *  - the journal is well formed: `idx` runs 0..n-1, every `tag` has its `.sql`, `when` increases;
 *  - nothing the base applied is gone or renamed;
 *  - every migration the change adds has a `when` later than every migration on the base.
 *
 * The fix for the last one is to regenerate the migration on top of the merged base
 * (`pnpm --filter launcher-api db:generate`), never to edit `when` by hand.
 *
 * In CI the checkout is the PR's merge commit (fetch-depth 2), so HEAD^1 is the base tip; on a push
 * to main it is the commit before. A base without the journal, or without a parent, skips the base
 * rules.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRIZZLE = 'apps/launcher-api/drizzle';
const JOURNAL = `${DRIZZLE}/meta/_journal.json`;

/**
 * The problems with `head`'s journal, against `base`'s when there is one. Pure, so the fixture
 * drives it; `sqlExists(tag)` says whether a migration's `.sql` is on disk.
 */
export function journalProblems(head, base, sqlExists = () => true) {
	const problems = [];
	const entries = head.entries ?? [];
	entries.forEach((entry, i) => {
		if (entry.idx !== i) problems.push(`entry ${i} has idx ${entry.idx}, expected ${i}`);
		if (!sqlExists(entry.tag))
			problems.push(`${entry.tag}: no ${entry.tag}.sql next to the journal`);
		const before = entries[i - 1];
		if (before && !(entry.when > before.when)) {
			problems.push(`${entry.tag}: when ${entry.when} is not after ${before.tag}'s ${before.when}`);
		}
	});
	if (!base) return problems;

	const headTags = new Set(entries.map((e) => e.tag));
	const baseEntries = base.entries ?? [];
	for (const e of baseEntries) {
		if (!headTags.has(e.tag)) {
			problems.push(
				`${e.tag} is on the base but gone from this journal: never remove or rename an applied migration (behind the base? merge it first)`,
			);
		}
	}
	const baseTags = new Set(baseEntries.map((e) => e.tag));
	const newest = baseEntries.reduce((a, e) => (e.when > a.when ? e : a), { when: -Infinity });
	for (const e of entries) {
		if (baseTags.has(e.tag) || e.when > newest.when) continue;
		problems.push(
			`${e.tag} is older (when ${e.when}) than ${newest.tag} (${newest.when}) on the base, so a ` +
				'database that applied the base would skip it: regenerate it on top of the merged base ' +
				'(pnpm --filter launcher-api db:generate)',
		);
	}
	return problems;
}

const git = (...args) =>
	execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** The base journal, or null when the ref or the file is not there. */
function baseJournal(ref) {
	try {
		return JSON.parse(git('show', `${ref}:${JOURNAL}`));
	} catch {
		return null;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const flag = process.argv.indexOf('--base');
	const ref =
		flag > 0 ? process.argv[flag + 1] : process.env.GITHUB_ACTIONS ? 'HEAD^1' : 'origin/main';
	const head = JSON.parse(readFileSync(join(ROOT, JOURNAL), 'utf8'));
	const base = baseJournal(ref);
	const problems = journalProblems(head, base, (tag) =>
		existsSync(join(ROOT, DRIZZLE, `${tag}.sql`)),
	);
	if (problems.length) {
		console.error(`check:migration-order — ${problems.length} problem(s) (base ${ref}):`);
		for (const p of problems) console.error(`  ✗ ${p}`);
		process.exit(1);
	}
	console.log(
		`check:migration-order — ${head.entries.length} migrations in order` +
			(base ? `, every new one after ${ref}'s newest: ok` : ` (no base journal at ${ref}): ok`),
	);
}
