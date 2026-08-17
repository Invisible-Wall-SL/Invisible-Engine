#!/usr/bin/env node
/**
 * Keep the browser's copy of the cinematic evaluator byte-identical to the package source.
 *
 *   node scripts/sync-cinematic-eval.mjs           # copy package → launcher static
 *   node scripts/sync-cinematic-eval.mjs --check   # exit 1 if they differ (no write)
 *
 * WHY A COPY AT ALL: the evaluator has exactly two consumers that cannot share a module path —
 * the ENGINE imports it as the `engine-cinematic` package, and `/rigger`'s static `view.html`
 * fetches it over HTTP from the launcher's `static/` tree, which cannot reach into `packages/`.
 * Rather than let two hand-maintained files drift (the hand-synced-renderer bug this project has
 * already paid for three times over in FX), the package is the single SOURCE and the static file
 * is a generated artifact — with `--check` making any divergence a loud failure instead of a
 * silent behaviour split between the editor preview and the shipped game.
 *
 * Verbatim copy, no transform: the source is deliberately plain dependency-free ESM JavaScript so
 * nothing has to be stripped or bundled on the way.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SRC = fileURLToPath(new URL('packages/engine-cinematic/src/cinematicEval.js', ROOT));
const DEST = fileURLToPath(new URL('apps/launcher-api/static/shared/cinematicEval.mjs', ROOT));

const BANNER =
	'// GENERATED — do not edit. Source: packages/engine-cinematic/src/cinematicEval.js\n' +
	'// Regenerate: node scripts/sync-cinematic-eval.mjs   (CI/gate check: --check)\n';

const source = readFileSync(SRC, 'utf8');
const expected = BANNER + source;
const check = process.argv.includes('--check');

let current = null;
try {
	current = readFileSync(DEST, 'utf8');
} catch {
	/* missing counts as out of date */
}

if (current === expected) {
	console.log(`cinematic evaluator in sync (${DEST})`);
	process.exit(0);
}

if (check) {
	console.error(
		`✗ ${DEST} is OUT OF DATE with packages/engine-cinematic/src/cinematicEval.js.\n` +
			`  The /rigger preview and the in-game player would evaluate DIFFERENTLY.\n` +
			`  Fix: node scripts/sync-cinematic-eval.mjs`,
	);
	process.exit(1);
}

writeFileSync(DEST, expected);
console.log(`wrote ${DEST}`);
