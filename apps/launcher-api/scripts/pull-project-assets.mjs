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
//   # A game repo (engine as submodule):
//   EDITOR_DOC_SECRET=... node <engine>/apps/launcher-api/scripts/pull-project-assets.mjs \
//     --project invisible_wall/bookofborutremake --dest ./static/assets
//
//   # Preview what would be pulled without writing anything:
//   node <engine>/apps/launcher-api/scripts/pull-project-assets.mjs \
//     --project invisible_wall/bookofborutremake --dest ./static/assets --token <t> --dry-run

import { spawnSync } from 'node:child_process';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
// By relative path, not `config-svelte`: inside a game repo the engine submodule's node_modules is
// never installed (same reason as bake-editor-doc.mjs).
import {
	appSrcDir,
	ENGINE_ROOT,
	isStandaloneGame,
} from '../../../packages/config-svelte/appSrc.js';
import {
	foundGameRefs,
	followDescriptors,
	isGenerated,
	isReachable,
	pruneDecision,
	scanSources,
} from './lib/assetReachability.mjs';
import { writeBuildReport } from './lib/buildReportDir.mjs';

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
	'  --no-prune                    mirror ALL of deploy/ and delete nothing locally.\n' +
	'                                Default: ship only what the game loads — a deploy\n' +
	'                                folder outside the generated subtrees (editor-art/,\n' +
	'                                _pages/, …) that no game code names is not pulled,\n' +
	'                                and stale/unloaded local copies are removed\n' +
	'  --optimize                    OPT-IN: after mirroring, trim provably-redundant\n' +
	'                                bytes for a lean STANDALONE build — drop dead\n' +
	'                                image twins + extra audio formats (online is\n' +
	'                                unaffected; it never runs this). See\n' +
	'                                optimize-build-assets.mjs.\n' +
	'  --audio-formats <csv>         with --optimize: audio formats to keep, priority\n' +
	'                                order (default mp3,ogg; pass `mp3` for max savings)\n' +
	'  --optional                    NO-token build only: warn + keep the checked-in\n' +
	'                                assets (exit 0). WITH a token (a real publish) a\n' +
	'                                missing/unreachable/empty deploy is a HARD failure\n' +
	'                                — it never silently ships stale/missing assets.';

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
// Enable via the flag OR the IE_OPTIMIZE_ASSETS env var — the desktop launcher's
// "Optimize" build toggle injects the env var (like PUBLIC_IE_DEBUG) rather than
// editing the project's build_cmd.
const envTruthy = (v) => ['1', 'true', 'yes', 'on'].includes(String(v || '').toLowerCase());
const optimize = hasFlag('optimize') || envTruthy(process.env.IE_OPTIMIZE_ASSETS);
const audioFormats = (
	getFlag('audio-formats') ||
	process.env.IE_OPTIMIZE_AUDIO_FORMATS ||
	'mp3,ogg'
)
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

// `--optional` stays lenient ONLY when there's NO token (a dev / no-credentials build
// that keeps the checked-in assets). When a TOKEN is present we are doing a REAL PUBLISH:
// a missing/unreachable endpoint or empty deploy means the editor-placed art + symbol
// assets WON'T ship — which renders as broken/empty textures (e.g. blue-circle symbols).
// So FAIL LOUDLY even with `--optional` rather than silently ship stale/missing assets.
// (Matches the same guard in bake-editor-doc.mjs.)
function bail(message) {
	if (optional && !token) {
		console.warn(`⚠ live-assets: ${message}`);
		console.warn('⚠ live-assets: no token + --optional → keeping checked-in assets (dev build).');
		process.exit(0);
	}
	console.error(`✖ live-assets: ${message}`);
	if (optional) {
		console.error(
			'✖ live-assets: a token WAS provided, so this is a PUBLISH — refusing to ship missing/stale ' +
				'assets (would render as broken textures). Fix the error above and re-publish.',
		);
	}
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

// 2. Decide what the game can load. The export-generated subtrees are already limited to what the
// game's scenes, flow and symbols reach; every other folder (`sprites/`, `spines/`, …) is loaded
// only by a path the game's code names, so it ships only if that code names it — see
// lib/assetReachability.mjs. `--no-prune` keeps the old mirror-everything behaviour.
const toRel = (abs) => relative(dest, abs).split(sep).join('/');

async function localFiles() {
	const out = [];
	const walk = async (dir) => {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const abs = join(dir, entry.name);
			if (entry.isDirectory()) await walk(abs);
			else out.push(toRel(abs));
		}
	};
	await walk(dest);
	return out;
}

const tops = [
	...new Set(
		[...files.map((f) => f.rel), ...(await localFiles())]
			.filter((rel) => rel.includes('/') && !isGenerated(rel))
			.map((rel) => rel.split('/')[0]),
	),
];
let refs = null;
if (!noPrune) {
	const packagesDir = join(ENGINE_ROOT, 'packages');
	const packageSrcs = (await readdir(packagesDir).catch(() => [])).map((p) =>
		join(packagesDir, p, 'src'),
	);
	const scan = await scanSources([appSrcDir(), dirname(dest), ...packageSrcs], tops, {
		skip: [dest],
	});
	if (foundGameRefs(scan.refs)) refs = scan.refs;
	else {
		console.warn(
			`⚠ live-assets: found no asset path in the game's source (${scan.scanned} file(s) under ` +
				`${appSrcDir()}) — keeping everything rather than guessing.`,
		);
	}
}
const wanted = (rel) => refs === null || isReachable(rel, refs);

// 3. Mirror what the game loads, verbatim, under dest. A kept file can name another (an atlas its
// page, a data file a folder), so mirror → follow those names → mirror again until nothing grows.
let pulled = 0;
let bytes = 0;
const mirrored = new Set();
const seenDescriptors = new Set();
const sorted = files.sort((a, b) => a.rel.localeCompare(b.rel));
for (;;) {
	for (const file of sorted) {
		const rel = file.rel;
		if (mirrored.has(rel) || !wanted(rel)) continue;
		mirrored.add(rel);
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
	if (refs === null) break;
	if (!(await followDescriptors(dest, await localFiles(), refs, tops, seenDescriptors))) break;
}

// 4. Prune. The export-generated subtrees converge on the listing: each is ENTIRELY written by an
// export step (the game never commits into them), so a local file the listing no longer carries is
// a leftover from a previous export — a renamed sheet, a dropped font, a deleted effect or clip.
// `_pages/` is the heaviest: `PageStore` writes each page content-addressed, so a re-encoded page
// lands at a NEW hash, and the superseded local file used to stay and ship (~46 MB on one Book of
// Borut Remake checkout). Untracked, so the launcher's `git reset --hard` never cleared it.
//
// Every other folder is pruned by reachability instead: a local file no game code can load is
// deleted — in a game repo even when committed, in the engine's own apps only when it is not (see
// `pruneDecision`).
function trackedFiles() {
	const res = spawnSync('git', ['ls-files', '-z', '--full-name', '--', '.'], {
		cwd: dest,
		encoding: 'utf8',
	});
	if (res.status !== 0) return null;
	const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dest, encoding: 'utf8' });
	if (top.status !== 0) return null;
	const root = top.stdout.trim();
	return new Set(
		res.stdout
			.split('\0')
			.filter(Boolean)
			.map((p) => toRel(join(root, p))),
	);
}

async function prune() {
	const listed = new Set(files.map((f) => f.rel));
	const standalone = isStandaloneGame();
	const tracked = refs === null || standalone ? null : trackedFiles();
	const removed = [];
	const unloaded = new Map();
	const kept = [];
	for (const rel of await localFiles()) {
		const decision = pruneDecision(rel, { listed, refs, tracked, standalone });
		if (decision === 'report') kept.push(rel);
		if (decision !== 'delete') continue;
		removed.push(rel);
		const abs = join(dest, ...rel.split('/'));
		if (!isGenerated(rel)) unloaded.set(rel, (await stat(abs).catch(() => null))?.size ?? 0);
		if (dryRun) console.info(`  prune ${rel}`);
		else await rm(abs, { force: true });
	}
	if (!dryRun) await removeEmptyDirs(dest);
	return { removed, unloaded, kept, gitKnown: tracked !== null };
}

async function removeEmptyDirs(dir) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const abs = join(dir, entry.name);
		await removeEmptyDirs(abs);
		if ((await readdir(abs).catch(() => ['x'])).length === 0) await rm(abs, { recursive: true });
	}
}

/** `sprites/S_Background (1 file, 34.0 MB)` — per folder, so a 160-frame sheet is one line. */
function byFolder(rels, sizeOf) {
	const groups = new Map();
	for (const rel of rels) {
		const key = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : rel;
		const g = groups.get(key) ?? { n: 0, size: 0 };
		g.n++;
		g.size += sizeOf(rel);
		groups.set(key, g);
	}
	return [...groups]
		.sort((a, b) => b[1].size - a[1].size)
		.map(([k, g]) => `  ${k}  (${g.n} file(s), ${(g.size / 1048576).toFixed(1)} MB)`);
}

const { removed, unloaded, kept, gitKnown } = noPrune
	? { removed: [], unloaded: new Map(), kept: [], gitKnown: true }
	: await prune();
const pruned = removed.length;
const skipped = files.filter((f) => !mirrored.has(f.rel));
if (skipped.length) {
	const size = new Map(files.map((f) => [f.rel, f.size ?? 0]));
	console.info(
		`\nNot pulled — in deploy/ but loaded by nothing in this game (delete them in the ` +
			`Invisible FTP Browser to tidy the project):`,
	);
	for (const line of byFolder(
		skipped.map((f) => f.rel),
		(rel) => size.get(rel) ?? 0,
	))
		console.info(line);
}
if (unloaded.size) {
	console.info(
		`\n${dryRun ? 'Would remove' : 'Removed'} — in static/assets/ but loaded by nothing:`,
	);
	for (const line of byFolder([...unloaded.keys()], (rel) => unloaded.get(rel) ?? 0))
		console.info(line);
}
if (kept.length) {
	console.info(
		gitKnown
			? `\nCommitted in the engine app but loaded by nothing (left in place, and they ship):`
			: `\nLoaded by nothing, left in place (no git to tell an old pull from a committed file):`,
	);
	for (const line of byFolder(kept, () => 0)) console.info(line.replace(/, 0\.0 MB\)$/, ')'));
}

const destDisplay = dest.split(sep).join('/');
const pruneNote =
	pruned > 0 ? `, ${dryRun ? 'would prune' : 'pruned'} ${pruned} stale/unloaded file(s)` : '';
if (dryRun) {
	console.info(`\nWould pull ${pulled} file(s) into ${destDisplay}${pruneNote}.`);
} else {
	console.info(
		`\nPulled ${pulled} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB into ${destDisplay}${pruneNote}.`,
	);
}

const listedSize = new Map(files.map((f) => [f.rel, f.size ?? 0]));
const withSize = (rels, sizeOf) => rels.map((rel) => ({ rel, bytes: sizeOf(rel) }));
const report = {
	project,
	pulled: withSize([...mirrored].sort(), (rel) => listedSize.get(rel) ?? 0),
	notPulled: withSize(
		skipped.map((f) => f.rel),
		(rel) => listedSize.get(rel) ?? 0,
	),
	removed: withSize([...unloaded.keys()], (rel) => unloaded.get(rel) ?? 0),
	keptUnloaded: kept,
	optimize: null,
};

// OPT-IN standalone-build optimization. Kept OUT of the default path so the
// online publish always mirrors deploy/ verbatim; only a build that explicitly
// asks (`--optimize`) trims the mirrored tree. See optimize-build-assets.mjs.
if (optimize) {
	const { optimizeBuildAssets } = await import('./optimize-build-assets.mjs');
	// Sized BEFORE the trim, which deletes them: the breakdown says what each removal saved.
	const localSize = new Map();
	for (const rel of await localFiles()) {
		localSize.set(rel, (await stat(join(dest, ...rel.split('/'))).catch(() => null))?.size ?? 0);
	}
	console.info(`\nOptimizing build assets${dryRun ? ' (dry run)' : ''} [audio: ${audioFormats.join(', ')}]`); // prettier-ignore
	const s = await optimizeBuildAssets({
		dir: dest,
		audioFormats,
		dryRun,
		log: (m) => console.info(m),
	});
	const mb = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;
	console.info(
		`${dryRun ? 'Would reclaim' : 'Reclaimed'} ${mb(s.bytesSaved)} — ` +
			`${s.imagesDeleted.length} image twin(s), ${s.audioDeleted.length} audio file(s), ` +
			`${s.manifestsRewritten.length} manifest(s) rewritten.`,
	);
	if (s.unreferenced.length) {
		console.info(
			`${s.unreferenced.length} image(s) referenced by NO descriptor (review — may load dynamically):`,
		);
		for (const u of s.unreferenced) console.info(`  ? ${u}`);
	}
	const sizeOf = (rel) => localSize.get(rel) ?? 0;
	report.optimize = {
		audioFormats,
		imagesDeleted: withSize(s.imagesDeleted, sizeOf),
		audioDeleted: withSize(s.audioDeleted, sizeOf),
		manifestsRewritten: s.manifestsRewritten,
		unreferenced: s.unreferenced,
		bytesSaved: s.bytesSaved,
	};
}

if (!dryRun) writeBuildReport('pull.json', report);
