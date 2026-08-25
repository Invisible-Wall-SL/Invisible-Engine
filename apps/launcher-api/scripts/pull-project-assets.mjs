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
	'  --no-prune                    keep local generated files the deploy dropped\n' +
	'                                (default: prune stale editor-art/, editor-fonts/,\n' +
	'                                 editor-symbols/, effects/, clips/, _pages/,\n' +
	'                                 _boot/)\n' +
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
const audioFormats = (getFlag('audio-formats') || process.env.IE_OPTIMIZE_AUDIO_FORMATS || 'mp3,ogg')
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

// 3. Prune stale files under the export-generated subtrees (`editor-art/`,
// `editor-fonts/`, `editor-symbols/`, `effects/`, `clips/`, `_pages/`, `_boot/`). Each is ENTIRELY
// generated by an export step (the game never commits into them), so any local file there that
// the current deploy listing no longer carries is a leftover from a previous export
// (e.g. a renamed/removed sheet, a font the project no longer uses, a symbol
// rebound to a different bundle, a deleted Invisible FX effect, or a deleted Invisible
// Flipbook clip) and is safe to delete. We scope strictly to these subtrees — pruning the
// rest of `static/assets/` would risk deleting the game's committed sheets/fonts (which
// are NOT in deploy/). `--no-prune` opts out.
//
// `_pages/` is the heaviest of them and was the one MISSING here: `PageStore` writes each shared
// atlas page content-addressed (`_pages/<hash>.<ext>` + its `.ktx2` twin), so a re-packed or
// re-encoded page lands at a NEW hash and R2 prunes the old one — but the superseded LOCAL file
// just stayed, and shipped. It accumulates across pulls (untracked, so the launcher's
// `git reset --hard` never clears it either): a Book of Borut Remake checkout carried ~46 MB of
// pages from two earlier pulls that NO atlas referenced. `_boot/` (bootSplashExport) is the same
// class — fixed paths, fully regenerated — so it converges on the listing too.
const GENERATED_SUBTREES = [
	'editor-art',
	'editor-fonts',
	'editor-symbols',
	'effects',
	'clips',
	'_pages',
	'_boot',
];

async function pruneStaleGenerated() {
	let removed = 0;
	for (const sub of GENERATED_SUBTREES) {
		const subDir = join(dest, sub);
		const prefix = `${sub}/`;
		const keep = new Set(
			files.filter((f) => f.rel.startsWith(prefix)).map((f) => join(dest, ...f.rel.split('/'))),
		);
		const walk = async (dir) => {
			let entries;
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch {
				return; // no such dir locally → nothing to prune
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
		await walk(subDir);
	}
	return removed;
}

const pruned = noPrune ? 0 : await pruneStaleGenerated();

const destDisplay = dest.split(sep).join('/');
const pruneNote =
	pruned > 0 ? `, ${dryRun ? 'would prune' : 'pruned'} ${pruned} stale generated file(s)` : '';
if (dryRun) {
	console.info(`\nWould pull ${pulled} file(s) into ${destDisplay}${pruneNote}.`);
} else {
	console.info(
		`\nPulled ${pulled} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB into ${destDisplay}${pruneNote}.`,
	);
}

// OPT-IN standalone-build optimization. Kept OUT of the default path so the
// online publish always mirrors deploy/ verbatim; only a build that explicitly
// asks (`--optimize`) trims the mirrored tree. See optimize-build-assets.mjs.
if (optimize) {
	const { optimizeBuildAssets } = await import('./optimize-build-assets.mjs');
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
}
