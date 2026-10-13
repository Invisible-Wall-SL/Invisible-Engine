#!/usr/bin/env node
/**
 * Keep the browser's copy of the Timeline panel byte-identical to its source.
 *
 *   node scripts/sync-timeline.mjs           # copy $lib source → launcher static
 *   node scripts/sync-timeline.mjs --check   # exit 1 if they differ (no write)
 *
 * WHY A COPY AT ALL: the Timeline (one timeline panel — docs/design/rive-style-editor.md §3.4) has
 * two hosts that cannot share a module path. `/editor` is Svelte and imports it from `$lib`;
 * `/rigger`'s static `view.html` fetches it over HTTP from the launcher's `static/` tree, which no
 * bundler touches. So, exactly like the evaluator (`scripts/sync-cinematic-eval.mjs`), the `$lib`
 * file is the single SOURCE and the static file is a generated artifact — with `--check` making
 * any divergence a loud failure instead of two timelines that quietly behave differently.
 *
 * Verbatim copy, no transform: the source is deliberately plain dependency-free ESM JavaScript so
 * nothing has to be stripped or bundled on the way.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SRC = fileURLToPath(new URL('apps/launcher-api/src/lib/timeline/timeline.js', ROOT));
const DEST = fileURLToPath(new URL('apps/launcher-api/static/shared/timeline.mjs', ROOT));

const BANNER =
	'// GENERATED — do not edit. Source: apps/launcher-api/src/lib/timeline/timeline.js\n' +
	'// Regenerate: node scripts/sync-timeline.mjs   (CI/gate check: --check)\n';

const expected = BANNER + readFileSync(SRC, 'utf8');
const check = process.argv.includes('--check');

let current = null;
try {
	current = readFileSync(DEST, 'utf8');
} catch {
	/* missing counts as out of date */
}

/** Compare CONTENT, not line endings — a Windows checkout is CRLF, the banner is `\n`. */
const sameContent = (a, b) =>
	a !== null && b !== null && a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

if (sameContent(current, expected)) {
	console.log(`timeline in sync (${DEST})`);
	process.exit(0);
}

if (check) {
	console.error(
		`✗ ${DEST} is OUT OF DATE with apps/launcher-api/src/lib/timeline/timeline.js.\n` +
			`  /rigger and /editor would run DIFFERENT timelines.\n` +
			`  Fix: node scripts/sync-timeline.mjs`,
	);
	process.exit(1);
}

writeFileSync(DEST, expected);
console.log(`wrote ${DEST}`);
