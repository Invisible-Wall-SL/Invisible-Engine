/**
 * Upgrade every `.irig` on R2 to irig v1 (docs/design/irig-format.md, Phase 5). A DRY RUN unless
 * `--write` is given: it reads every rig, says what each would become, and writes nothing.
 *
 *   pnpm --filter launcher-api exec tsx --tsconfig tsconfig.scripts.json scripts/r2-migrate-irig.ts \
 *     [--prefix <client>/<project>/] [--report <file.json>] [--write]
 *
 * Env: R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (the launcher's).
 *
 * Verdicts: `already` (irig v1), `upgrade` (imports dropping only keys the 4.2 reader ignores, and
 * the runtime builds the same rig from both), `changes-a-value` (the import would change a value
 * the 4.2 reader coerces: look at it), `poses-differ`, `unreadable`. Only `upgrade` is ever
 * written, through the Rigger save's own write: backed up first, and skipped if the rig was saved
 * since it was read.
 */
import { writeFile } from 'node:fs/promises';
import { migrateIrigs, type IrigMigrationRow } from '../src/lib/server/irigMigration.ts';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const write = args.includes('--write');
const prefix = opt('--prefix') ?? '';
const report = opt('--report');

const rows = await migrateIrigs({ prefix, write });

const count = (pick: (r: IrigMigrationRow) => string | undefined) => {
	const out: Record<string, number> = {};
	for (const r of rows) {
		const k = pick(r);
		if (k) out[k] = (out[k] ?? 0) + 1;
	}
	return out;
};
for (const r of rows)
	if (r.verdict !== 'already')
		console.info(
			`${r.verdict.padEnd(16)} ${r.outcome ? `[${r.outcome}] ` : ''}${r.key}${r.detail ? `  — ${r.detail}` : ''}`,
		);
console.info(
	`\n${rows.length} .irig file(s) under '${prefix || '(bucket root)'}' — ${JSON.stringify(count((r) => r.verdict))}`,
);
if (write) console.info(`written: ${JSON.stringify(count((r) => r.outcome))}`);
else
	console.info('Dry run: nothing was written. Re-run with --write to upgrade the `upgrade` rows.');
if (report) {
	await writeFile(report, JSON.stringify({ prefix, write, rows }, null, '\t'));
	console.info(`report: ${report}`);
}
