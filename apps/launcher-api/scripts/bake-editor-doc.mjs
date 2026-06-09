// Freeze a project's editor LayoutDoc + its referenced ComponentDefs into a game
// repo at build time, so the shipped game renders the authored layout WITHOUT a
// runtime fetch and WITHOUT depending on the launcher being up — and so custom
// component defs (which otherwise live only in R2 and are never registered at
// game runtime) actually reach the bundle.
// See docs/design/live-assets.md → "Layout-doc bake (build-time freeze)".
//
// HTTP only: it talks to the launcher's `GET /api/editor/doc?...&components=1`
// (gated by the shared `EDITOR_DOC_SECRET` token) — NO R2 creds, no aws-sdk. A
// build runner only needs the token + network access to app.invisiblewall.org.
//
//   EDITOR_DOC_SECRET=... node apps/launcher-api/scripts/bake-editor-doc.mjs \
//     --project <client>/<project> --dest <gameRepo>/src/baked-editor-bundle.json
//
// The written file is the SAME shape the game's editor-scenes.ts imports:
//   { doc: LayoutDoc, componentDefaults: {...}, componentDefs: { <id>: ComponentDef } }
// A non-null `doc` flips the game to the baked path (live fetch skipped); the
// checked-in placeholder has `doc: null`, so an un-baked repo keeps fetching live.
//
// Examples:
//   # Book of Borut (its own repo, engine as submodule):
//   EDITOR_DOC_SECRET=... node <engine>/apps/launcher-api/scripts/bake-editor-doc.mjs \
//     --project borut/bookofborut --dest ./src/baked-editor-bundle.json
//
//   # Preview without writing:
//   node <engine>/apps/launcher-api/scripts/bake-editor-doc.mjs \
//     --project borut/bookofborut --dest ./src/baked-editor-bundle.json --token <t> --dry-run

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const getFlag = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(`--${name}`);

const DEFAULT_BASE = 'https://app.invisiblewall.org';

const USAGE =
	'Usage: node bake-editor-doc.mjs --project <client>/<project> --dest <out.json> \\\n' +
	'         [--base <url>] [--token <t>] [--dry-run] [--optional]\n' +
	'\n' +
	'  --project <client>/<project>  R2 project key (required)\n' +
	'  --dest <path>                 output JSON file to write (required)\n' +
	`  --base <url>                  launcher base (default ${DEFAULT_BASE})\n` +
	'  --token <t>                   shared read token; defaults to env\n' +
	'                                EDITOR_DOC_SECRET or LIVE_ASSETS_TOKEN\n' +
	'  --dry-run                     print a summary, write nothing\n' +
	'  --optional                    on missing token / unreachable endpoint / no doc,\n' +
	'                                warn loudly and keep the checked-in bundle (exit 0)\n' +
	'                                instead of failing the build';

if (args.length === 0 || hasFlag('help') || hasFlag('h')) {
	console.info(USAGE);
	process.exit(args.length === 0 ? 1 : 0);
}

const project = getFlag('project');
if (!project || !project.includes('/')) {
	console.error(USAGE);
	console.error('Missing --project as <client>/<project>.');
	process.exit(1);
}

const destArg = getFlag('dest');
if (!destArg) {
	console.error(USAGE);
	console.error(
		'Missing --dest (the game repo JSON file to write, e.g. src/baked-editor-bundle.json).',
	);
	process.exit(1);
}
const dest = isAbsolute(destArg) ? destArg : resolve(process.cwd(), destArg);

const base = (getFlag('base') || DEFAULT_BASE).replace(/\/+$/, '');
const token = getFlag('token') || process.env.EDITOR_DOC_SECRET || process.env.LIVE_ASSETS_TOKEN;
const dryRun = hasFlag('dry-run');
const optional = hasFlag('optional');

// In `--optional` mode a missing token / unreachable endpoint / no authored doc is
// not fatal: warn loudly and keep the checked-in bundle so the build proceeds.
// Otherwise it's a hard failure so CI never silently ships a stale/empty layout.
function bail(message) {
	if (optional) {
		console.warn(`⚠ bake-doc: ${message}`);
		console.warn('⚠ bake-doc: keeping checked-in bundle (--optional). Layout may be STALE.');
		process.exit(0);
	}
	console.error(message);
	process.exit(1);
}

if (!token) {
	if (!optional) console.error(USAGE);
	bail('Missing token — pass --token or set EDITOR_DOC_SECRET / LIVE_ASSETS_TOKEN in the env.');
}

const docUrl =
	`${base}/api/editor/doc?project=${encodeURIComponent(project)}` +
	`&k=${encodeURIComponent(token)}&components=1`;

async function bodySnippet(res) {
	try {
		return (await res.text()).slice(0, 300);
	} catch {
		return '';
	}
}

console.info(`Baking ${base}/api/editor/doc [${project}] → ${dest}${dryRun ? '  (dry run)' : ''}`);

let res;
try {
	res = await fetch(docUrl);
} catch (err) {
	bail(`Could not reach ${base}/api/editor/doc — ${err instanceof Error ? err.message : err}`);
}
if (!res.ok) {
	bail(`Doc fetch failed: HTTP ${res.status} — ${await bodySnippet(res)}`);
}

const data = await res.json();
const doc = data?.doc;
if (!doc || !Array.isArray(doc.scenes) || doc.scenes.length === 0) {
	bail(`no authored doc for ${project} — has the project been opened + saved in the editor?`);
}

const bundle = {
	doc,
	componentDefaults: data.componentDefaults ?? {},
	componentDefs: data.componentDefs ?? {},
};

const sceneCount = doc.scenes.length;
const defCount = Object.keys(bundle.componentDefs).length;
const defaultCount = Object.keys(bundle.componentDefaults).length;
const json = `${JSON.stringify(bundle, null, '\t')}\n`;

if (dryRun) {
	console.info(
		`\nWould write ${(json.length / 1024).toFixed(1)} KB → ${dest.split(sep).join('/')}` +
			` (${sceneCount} scenes, ${defCount} component defs, ${defaultCount} default sets).`,
	);
	process.exit(0);
}

await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, json);
console.info(
	`\nBaked ${(json.length / 1024).toFixed(1)} KB → ${dest.split(sep).join('/')}` +
		` (${sceneCount} scenes, ${defCount} component defs, ${defaultCount} default sets).`,
);
