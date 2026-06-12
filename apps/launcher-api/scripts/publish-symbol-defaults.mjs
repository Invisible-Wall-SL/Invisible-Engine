// Publish a game's coded `SYMBOL_INFO_MAP` to R2 at build time, so the Invisible
// Symbols State Machine tool drives its grid from THIS project's symbol set
// instead of the committed `lines.json` fallback. The deploy-token-gated
// `PUT /api/editor/symbol-defaults` stores it at `symbols/defaults.json` in R2;
// the tool's `+page.server.ts` reads it per-project (falling back to the coded
// `lines` set when un-published). Mirrors bake-editor-doc.mjs's transport.
// See docs/design/invisible-symbols-state-machine.md.
//
// HTTP only: no R2 creds, no aws-sdk. A build runner needs the shared token +
// network access to app.invisiblewall.org.
//
//   EDITOR_DOC_SECRET=... node --experimental-strip-types \
//     <engine>/apps/launcher-api/scripts/publish-symbol-defaults.mjs \
//     --project <projectKey> [--symbols ./src/game/constants.ts]
//
// NOTE: --project is the BARE launcher project key (e.g. `bookofborut`), NOT
// `<client>/<project>` — the endpoint DB-resolves the client from the key (same
// as bake-editor-doc.mjs / /api/editor/doc).
//
// The symbol-map module is TypeScript with computed numeric expressions (e.g.
// `0.5 * 0.9`), so it must be imported under Node type-stripping: invoke with
// `node --experimental-strip-types`. This script assumes that flag is present
// and `import()`s the module directly.
//
// Examples:
//   # Book of Borut (its own repo, engine as submodule):
//   EDITOR_DOC_SECRET=... node --experimental-strip-types \
//     ./engine/apps/launcher-api/scripts/publish-symbol-defaults.mjs --project bookofborut
//
//   # Preview without posting (resolves + prints the doc):
//   node --experimental-strip-types \
//     ./engine/apps/launcher-api/scripts/publish-symbol-defaults.mjs \
//     --project bookofborut --token <t> --dry-run

import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const getFlag = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(`--${name}`);

const DEFAULT_BASE = 'https://app.invisiblewall.org';
const DEFAULT_SYMBOLS = './src/game/constants.ts';
const DEFAULT_EXPORT = 'SYMBOL_INFO_MAP';

const USAGE =
	'Usage: node --experimental-strip-types publish-symbol-defaults.mjs --project <projectKey> \\\n' +
	'         [--symbols <path>] [--export <name>] [--game-type <type>] \\\n' +
	'         [--base <url>] [--token <t>] [--dry-run] [--optional]\n' +
	'\n' +
	'  --project <projectKey>        bare launcher project key, e.g. bookofborut\n' +
	'                                (NOT <client>/<project>). Required.\n' +
	`  --symbols <path>              the game's symbol-map module (default ${DEFAULT_SYMBOLS})\n` +
	`  --export <name>               named export to read (default ${DEFAULT_EXPORT})\n` +
	'  --game-type <type>            informational gameType to stamp (default the project key)\n' +
	`  --base <url>                  launcher base (default ${DEFAULT_BASE})\n` +
	'  --token <t>                   shared deploy token; defaults to env\n' +
	'                                EDITOR_DOC_SECRET or LIVE_ASSETS_TOKEN\n' +
	'  --dry-run                     print the resolved doc, post nothing\n' +
	'  --optional                    on missing module / token / unreachable endpoint,\n' +
	'                                warn loudly and exit 0 (keep the build green)';

if (args.length === 0 || hasFlag('help') || hasFlag('h')) {
	console.info(USAGE);
	process.exit(args.length === 0 ? 1 : 0);
}

const project = getFlag('project');
if (!project) {
	console.error(USAGE);
	console.error('Missing --project (the bare launcher project key, e.g. bookofborut).');
	process.exit(1);
}

const symbolsArg = getFlag('symbols') || DEFAULT_SYMBOLS;
const symbolsPath = isAbsolute(symbolsArg) ? symbolsArg : resolve(process.cwd(), symbolsArg);
const exportName = getFlag('export') || DEFAULT_EXPORT;
const gameType = getFlag('game-type') || project;
const base = (getFlag('base') || DEFAULT_BASE).replace(/\/+$/, '');
const token = getFlag('token') || process.env.EDITOR_DOC_SECRET || process.env.LIVE_ASSETS_TOKEN;
const dryRun = hasFlag('dry-run');
const optional = hasFlag('optional');

// In `--optional` mode a missing module / token / unreachable endpoint is not
// fatal: warn loudly and exit 0 so a game build stays green (matching the other
// build steps). Otherwise it's a hard failure so CI never silently ships stale.
//
// We set `process.exitCode` and unwind rather than calling `process.exit()`: on
// Windows, calling process.exit() while undici (global `fetch`) still has a
// socket closing trips a libuv assertion and crashes with exit 0xC0000409 —
// which would fail the build even in --optional mode. Letting the loop drain
// avoids it (same reason as bake-editor-doc.mjs).
class PublishBail {}
function bail(message) {
	if (optional) {
		console.warn(`⚠ publish-symbols: ${message}`);
		console.warn('⚠ publish-symbols: skipping (--optional). Tool grid may be STALE.');
		process.exitCode = 0;
	} else {
		console.error(message);
		process.exitCode = 1;
	}
	throw new PublishBail();
}

async function bodySnippet(res) {
	try {
		return (await res.text()).slice(0, 300);
	} catch {
		return '';
	}
}

async function main() {
	let mod;
	try {
		mod = await import(pathToFileURL(symbolsPath).href);
	} catch (err) {
		bail(`Could not import ${symbolsPath} — ${err instanceof Error ? err.message : err}`);
	}

	const map = mod?.[exportName];
	if (!map || typeof map !== 'object') {
		bail(`Export "${exportName}" not found (or not an object) in ${symbolsPath}.`);
	}

	// Strip `as const` readonly + clone to a plain JSON-safe object.
	const symbols = JSON.parse(JSON.stringify(map));
	const doc = { version: 1, gameType, symbols };
	const symbolNames = Object.keys(symbols);

	if (dryRun) {
		console.info(
			`(dry run) resolved ${symbolNames.length} symbols from ${exportName} in ${symbolsPath}` +
				` (gameType=${gameType}):`,
		);
		console.info(JSON.stringify(doc, null, '\t'));
		console.info(
			`\n(dry run) would PUT → ${base}/api/editor/symbol-defaults?project=${project}` +
				` (${symbolNames.length} symbols).`,
		);
		return;
	}

	if (!token) {
		console.error(USAGE);
		bail('Missing token — pass --token or set EDITOR_DOC_SECRET / LIVE_ASSETS_TOKEN in the env.');
	}

	const putUrl =
		`${base}/api/editor/symbol-defaults?project=${encodeURIComponent(project)}` +
		`&k=${encodeURIComponent(token)}`;

	console.info(`Publishing ${symbolNames.length} symbols → ${base}/api/editor/symbol-defaults [${project}]`);

	let res;
	try {
		res = await fetch(putUrl, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(doc),
		});
	} catch (err) {
		bail(
			`Could not reach ${base}/api/editor/symbol-defaults — ${err instanceof Error ? err.message : err}`,
		);
	}
	if (!res.ok) {
		bail(`Publish failed: HTTP ${res.status} — ${await bodySnippet(res)}`);
	}

	const out = await res.json();
	console.info(
		`\nPublished ${out?.symbols ?? symbolNames.length} symbols to ` +
			`${out?.clientKey}/${out?.projectKey}/symbols/defaults.json.`,
	);
}

try {
	await main();
} catch (err) {
	if (!(err instanceof PublishBail)) {
		console.error(err);
		process.exitCode = 1;
	}
}
