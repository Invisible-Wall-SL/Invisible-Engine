// Pull a project's deploy-ready assets out of R2 into a game repo's
// `static/assets/`, so `pnpm build` bundles the LATEST edited art (not the
// stale spritesheet committed in the repo). Wire as a `prebuild`/`predeploy`
// hook so every build grabs the current `<client>/<project>/deploy/` tree.
// See docs/design/live-assets.md §2 (Transport — build-time pull).
//
// This is an HTTP puller: it talks to the launcher's `GET /api/deploy` endpoint
// (gated by the shared `EDITOR_DOC_SECRET` token) — NO R2 creds, no aws-sdk.
// A build runner only needs the token + network access to app.invisiblewall.org.
//
//   EDITOR_DOC_SECRET=... node apps/launcher-api/scripts/pull-project-assets.mjs \
//     --project <client>/<project> --dest <gameRepo>/static/assets [--dry-run]
//
// Each object at `deploy/<rel>` is mirrored verbatim to `<dest>/<rel>`:
//   R2:    borut/bookofborut/deploy/sprites/symbolsStatic/symbolsStatic.json
//   local: <dest>/sprites/symbolsStatic/symbolsStatic.json
//
// Examples:
//   # Book of Borut (its own repo, engine as submodule):
//   EDITOR_DOC_SECRET=... node <engine>/apps/launcher-api/scripts/pull-project-assets.mjs \
//     --project borut/bookofborut --dest ./static/assets
//
//   # Preview what would be pulled without writing anything:
//   node <engine>/apps/launcher-api/scripts/pull-project-assets.mjs \
//     --project borut/bookofborut --dest ./static/assets --token <t> --dry-run

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const getFlag = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(`--${name}`);

const DEFAULT_BASE = 'https://app.invisiblewall.org';

const USAGE =
	'Usage: node pull-project-assets.mjs --project <client>/<project> --dest <static/assets> \\\n' +
	'         [--base <url>] [--token <t>] [--dry-run]\n' +
	'\n' +
	'  --project <client>/<project>  R2 project key (required)\n' +
	'  --dest <path>                 game repo static/assets dir to mirror into (required)\n' +
	`  --base <url>                  launcher base (default ${DEFAULT_BASE})\n` +
	'  --token <t>                   shared read token; defaults to env\n' +
	'                                EDITOR_DOC_SECRET or LIVE_ASSETS_TOKEN\n' +
	'  --dry-run                     print planned rel → outPath mappings, write nothing\n' +
	'  --no-prune                    keep local editor-art/ files the deploy dropped\n' +
	'                                (default: prune stale editor-art/ leftovers)\n' +
	'  --optional                    on missing token / unreachable endpoint / empty deploy,\n' +
	'                                warn loudly and keep the checked-in assets (exit 0)\n' +
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
	console.error("Missing --dest (the game repo's static/assets directory to mirror into).");
	process.exit(1);
}
const dest = isAbsolute(destArg) ? destArg : resolve(process.cwd(), destArg);

const base = (getFlag('base') || DEFAULT_BASE).replace(/\/+$/, '');
const token = getFlag('token') || process.env.EDITOR_DOC_SECRET || process.env.LIVE_ASSETS_TOKEN;
const dryRun = hasFlag('dry-run');
const optional = hasFlag('optional');
const noPrune = hasFlag('no-prune');

// In `--optional` mode a missing token / unreachable endpoint / empty deploy is
// not fatal: warn loudly and keep the checked-in assets so the build proceeds.
// Otherwise it's a hard failure so CI never silently ships stale art.
function bail(message) {
	if (optional) {
		console.warn(`⚠ live-assets: ${message}`);
		console.warn('⚠ live-assets: keeping checked-in assets (--optional). Build may be STALE.');
		process.exit(0);
	}
	console.error(message);
	process.exit(1);
}

if (!token) {
	if (!optional) console.error(USAGE);
	bail('Missing token — pass --token or set EDITOR_DOC_SECRET / LIVE_ASSETS_TOKEN in the env.');
}

const projectEnc = encodeURIComponent(project);

function deployUrl(rel) {
	const relPart = rel === undefined ? '' : `&rel=${encodeURIComponent(rel)}`;
	return `${base}/api/deploy?project=${projectEnc}&k=${encodeURIComponent(token)}${relPart}`;
}

async function bodySnippet(res) {
	try {
		const text = await res.text();
		return text.slice(0, 300);
	} catch {
		return '';
	}
}

console.info(`Pulling ${base}/api/deploy [${project}] → ${dest}${dryRun ? '  (dry run)' : ''}`);

// 1. List the deploy tree.
let listRes;
try {
	listRes = await fetch(deployUrl());
} catch (err) {
	bail(`Could not reach ${base}/api/deploy — ${err instanceof Error ? err.message : err}`);
}
if (!listRes.ok) {
	bail(`List failed: HTTP ${listRes.status} — ${await bodySnippet(listRes)}`);
}
const listing = await listRes.json();
const files = Array.isArray(listing.files) ? listing.files : [];

if (files.length === 0) {
	bail(`no deploy assets for ${project} — has the atlas been deployed?`);
}

// 2. Mirror each file verbatim under dest.
let pulled = 0;
let bytes = 0;
for (const file of files.sort((a, b) => a.rel.localeCompare(b.rel))) {
	const rel = file.rel;
	const outPath = join(dest, ...rel.split('/'));
	if (dryRun) {
		console.info(`  ${rel}  →  ${outPath}`);
		pulled++;
		continue;
	}
	const res = await fetch(deployUrl(rel));
	if (!res.ok) {
		console.error(`Fetch failed for ${rel}: HTTP ${res.status} — ${await bodySnippet(res)}`);
		process.exit(1);
	}
	const body = new Uint8Array(await res.arrayBuffer());
	await mkdir(dirname(outPath), { recursive: true });
	await writeFile(outPath, body);
	pulled++;
	bytes += body.length;
	if (pulled === 1 || pulled % 25 === 0) {
		console.info(`  ${rel} (${(body.length / 1024).toFixed(0)} KB)`);
	}
}

// 3. Prune stale files under `editor-art/`. That subtree is ENTIRELY generated by
// the editor-art export (the game never commits into it), so any local file there
// that the current deploy listing no longer carries is a leftover from a previous
// export (e.g. a renamed/removed sheet) and is safe to delete. We scope strictly to
// `editor-art/` — pruning the rest of `static/assets/` would risk deleting the
// game's committed sheets (which are NOT in deploy/). `--no-prune` opts out.
async function pruneStaleEditorArt() {
	const artDir = join(dest, 'editor-art');
	const keep = new Set(
		files.filter((f) => f.rel.startsWith('editor-art/')).map((f) => join(dest, ...f.rel.split('/'))),
	);
	let removed = 0;
	const walk = async (dir) => {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return; // no editor-art/ dir locally → nothing to prune
		}
		for (const entry of entries) {
			const abs = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(abs);
				const rest = await readdir(abs).catch(() => ['x']);
				if (rest.length === 0 && !dryRun) await rm(abs, { recursive: true, force: true });
			} else if (!keep.has(abs)) {
				removed++;
				if (dryRun) console.info(`  prune ${abs.split(sep).join('/')}`);
				else await rm(abs, { force: true });
			}
		}
	};
	await walk(artDir);
	return removed;
}

const pruned = noPrune ? 0 : await pruneStaleEditorArt();

const destDisplay = dest.split(sep).join('/');
const pruneNote = pruned > 0 ? `, ${dryRun ? 'would prune' : 'pruned'} ${pruned} stale editor-art file(s)` : '';
if (dryRun) {
	console.info(`\nWould pull ${pulled} file(s) into ${destDisplay}${pruneNote}.`);
} else {
	console.info(
		`\nPulled ${pulled} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB into ${destDisplay}${pruneNote}.`,
	);
}
