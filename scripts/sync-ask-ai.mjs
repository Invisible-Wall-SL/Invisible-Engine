#!/usr/bin/env node
/**
 * Keep the launcher's static copy of the "Ask the AI" window byte-identical to its source.
 *
 *   node scripts/sync-ask-ai.mjs           # copy iw_common source → launcher static
 *   node scripts/sync-ask-ai.mjs --check   # exit 1 if they differ (no write)
 *
 * WHY A COPY AT ALL: the vanilla window (`services/_shared/iw_common/ask_ai.js`, the twin of
 * `$lib/AskAiPanel.svelte`) has hosts that cannot share a file. The Atlas and Sheet Maker inline it
 * from `iw_common`; the Rigger's static `view.html` fetches it over HTTP from the launcher's
 * `static/` tree, which no bundler touches. So, like `sync-timeline.mjs`, the `iw_common` file is
 * the single SOURCE and the static file a generated artifact, with `--check` (run by CI's check-all) making
 * any divergence a loud failure.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SRC = fileURLToPath(new URL('services/_shared/iw_common/ask_ai.js', ROOT));
const DEST = fileURLToPath(new URL('apps/launcher-api/static/shared/ask-ai.js', ROOT));

const BANNER =
	'// GENERATED — do not edit. Source: services/_shared/iw_common/ask_ai.js\n' +
	'// Regenerate: node scripts/sync-ask-ai.mjs   (CI/gate check: --check)\n';

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
	console.log(`ask-ai in sync (${DEST})`);
	process.exit(0);
}

if (check) {
	console.error(
		`✗ ${DEST} is OUT OF DATE with services/_shared/iw_common/ask_ai.js.\n` +
			`  The Rigger would run a different Ask the AI window from the Atlas and Sheet Maker.\n` +
			`  Fix: node scripts/sync-ask-ai.mjs`,
	);
	process.exit(1);
}

writeFileSync(DEST, expected);
console.log(`wrote ${DEST}`);
