// Run every `packages/engine-game/fixtures/*.fixture.ts` and fail if any of them fails.
//
//   node scripts/check-engine-game-fixtures.mjs
//
// WHY THIS EXISTS: these fixtures pin the win presentation's wiring — much of it against SOURCE
// TEXT, because a Svelte template cannot be executed from Node — and nothing ran them. #692 moved
// the celebration-lock rule into `celebrationLock.ts`, `winTapLand.fixture.ts` went red on `main`,
// and it stayed red for 12 days; #802 even recorded it as "pre-existing and unrelated". A guard that
// everyone has learned to ignore hides the real regression that lands in the same file.
//
// DISCOVERED, not listed: a new `*.fixture.ts` dropped in the directory is gated without anyone
// having to remember this file. Each one runs exactly as its own header documents
// (`node --experimental-strip-types <file>`), in its own process, so one fixture's globals cannot
// leak into the next.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not `new URL(...).pathname` — this repo's path contains spaces, which stay
// percent-encoded in `pathname`, so the directory read would find nothing.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'packages', 'engine-game', 'fixtures');
const TIMEOUT_MS = 120_000;

const fixtures = readdirSync(DIR)
	.filter((name) => name.endsWith('.fixture.ts'))
	.sort()
	.map((name) => join(DIR, name));

// An empty directory read is a vacuous pass — the exact failure this gate exists to prevent.
if (fixtures.length === 0) {
	console.error(`No *.fixture.ts found in ${relative(ROOT, DIR)} — refusing to pass vacuously.`);
	process.exit(1);
}

const failed = [];
for (const file of fixtures) {
	const rel = relative(ROOT, file);
	console.log(`\n▶ ${rel}`);
	const run = spawnSync(process.execPath, ['--experimental-strip-types', file], {
		cwd: ROOT,
		stdio: 'inherit',
		timeout: TIMEOUT_MS,
	});
	if (run.error?.code === 'ETIMEDOUT') console.error(`  timed out after ${TIMEOUT_MS / 1000}s`);
	if (run.status !== 0) failed.push(rel);
}

console.log(`\n${fixtures.length - failed.length}/${fixtures.length} engine-game fixtures passed.`);
if (failed.length > 0) {
	console.error(`FAILED:\n${failed.map((rel) => `  ${rel}`).join('\n')}`);
	process.exit(1);
}
