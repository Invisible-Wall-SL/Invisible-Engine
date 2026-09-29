// Publish a GENERIC ENGINE RUNTIME bundle to R2 so the Invisible Test Server
// can serve it for every Game-Maker game whose manifest entry has
// `runtime: "<id>"`. Unlike publish-game-bundle.mjs this writes NO games.json
// entry — a runtime bundle is shared infrastructure, not a game. Re-run it only
// when the ENGINE changes (a deliberate runtime release), not per published game.
//
//   # build the generic lines runtime once, then release it:
//   PUBLIC_RGS_TRANSPORT=play4fun pnpm --filter lines build
//   R2_ENDPOINT=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//     node apps/launcher-api/scripts/publish-runtime-bundle.mjs lines apps/lines/build
//
// !! PUBLIC_RGS_TRANSPORT=play4fun IS REQUIRED. The test server's mock RGS speaks
// Play4Fun; a bundle built without it uses the default native transport, never
// completes the RGS handshake, and the game hangs on the loading screen (blank).
//
// VERSIONED, THEN PROMOTED. The build goes to its own immutable prefix
// `test_server/_runtime/<id>@<version>/` (version = the commit), is checked complete, is added to
// `releases.json`, and only then does ONE write of the pointer `_runtime/<id>/current.json` move
// every unpinned game onto it. Nothing a game is being served from is ever overwritten, so a hydrate
// mid-upload sees the old release whole, and a rollback is a pointer flip (`runtime-pointer.mjs`).
// See scripts/lib/runtime-releases.mjs for the layout.
//
// Flags:
//   --status building   only stamp `release.json` building (the launcher shows "Releasing engine…")
//   --status failed     the release failed after that stamp: put the stamp back to the live release
//                       and record the failure (otherwise "Releasing engine…" sticks for 30 min)
//   --no-promote        upload + record the release but leave the pointer alone (a canary: pin one
//                       game to it with `runtime-pointer.mjs pin`, then `promote` it)

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, relative, sep } from 'node:path';
import {
	MARKER_RE,
	assertRuntimeId,
	keys,
	listKeys,
	promote,
	prune,
	r2FromEnv,
	readHistory,
	readJson,
	readPointer,
	readPointerForSwap,
	writeHistory,
	writeJson,
} from './lib/runtime-releases.mjs';

const args = process.argv.slice(2);

function flagValue(name) {
	const i = args.indexOf(name);
	return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
const statusFlag = flagValue('--status') ?? process.env.RELEASE_STATUS;
const promoteAfterUpload = !args.includes('--no-promote');

// Positional args, skipping flags AND the value consumed by `--status`.
const positional = [];
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--status') {
		i++;
		continue;
	}
	if (args[i].startsWith('--')) continue;
	positional.push(args[i]);
}
const runtimeId = positional[0];
const buildDir = positional[1];
if (!runtimeId || (!statusFlag && !buildDir)) {
	console.error(
		'Usage: node publish-runtime-bundle.mjs <runtimeId> <buildDir>  (e.g. lines apps/lines/build)',
	);
	process.exit(1);
}
assertRuntimeId(runtimeId);

// Commit the bundle was built from — GitHub Actions injects GITHUB_SHA; a local run has none.
const commit = process.env.GITHUB_SHA || 'unknown';
const shortCommit = commit === 'unknown' ? 'unknown' : commit.slice(0, 7);
const builtAt = new Date().toISOString();
const runUrl =
	process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
		? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
		: null;

const r2 = await r2FromEnv();

if (statusFlag === 'building') {
	// Advisory stamp the launcher reads (`testServerManifest.ts` → `engineDeployStatus`).
	await writeJson(r2, keys.status(runtimeId), {
		runtimeId,
		commit,
		shortCommit,
		builtAt,
		status: 'building',
	});
	console.info(`Stamped ${keys.status(runtimeId)} → status='building' commit=${shortCommit}`);
	process.exit(0);
}

if (statusFlag === 'failed') {
	// Only undo OUR building stamp; a stamp some other run wrote is left alone. The live release is
	// whatever the pointer names. `stage` tells the two failures apart: this run never moved the
	// pointer ('before-promote'), or moved it and the served check then failed ('unverified').
	const stamp = (await readJson(r2, keys.status(runtimeId)))?.value ?? null;
	const pointer = await readPointer(r2, runtimeId);
	const promoted = stamp?.status === 'released' && stamp.commit === commit;
	const lastFailure = {
		commit,
		shortCommit,
		at: builtAt,
		runUrl,
		stage: promoted ? 'unverified' : 'before-promote',
	};
	const next =
		stamp?.status === 'building' && stamp.commit === commit
			? pointer
				? {
						runtimeId,
						commit: pointer.commit,
						shortCommit: pointer.shortCommit,
						builtAt: pointer.builtAt,
						status: 'released',
						version: pointer.version,
						promotedAt: pointer.promotedAt,
						via: pointer.via,
					}
				: { runtimeId, commit, shortCommit, builtAt, status: 'failed' }
			: stamp;
	await writeJson(r2, keys.status(runtimeId), { ...next, lastFailure });
	console.info(
		`Stamped ${keys.status(runtimeId)} → status='${next?.status}' after a failed release of ${shortCommit}`,
	);
	process.exit(0);
}

try {
	await stat(join(buildDir, 'index.html'));
} catch {
	console.error(
		`No index.html in '${buildDir}'. Build the runtime first (e.g. pnpm --filter lines build).`,
	);
	process.exit(1);
}
const marker = MARKER_RE.exec(await readFile(join(buildDir, 'index.html'), 'utf8'))?.[0];
if (!marker) {
	console.error(
		`No bundle.<hash>.js in ${join(buildDir, 'index.html')} — the release could never be verified.`,
	);
	process.exit(1);
}

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.wasm': 'application/wasm',
	'.mp3': 'audio/mpeg',
	'.ogg': 'audio/ogg',
	'.wav': 'audio/wav',
	'.atlas': 'text/plain; charset=utf-8',
};

async function* walk(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(full);
		else if (entry.isFile()) yield full;
	}
}

// The version names the commit; a second release of the SAME commit (a re-run) gets a suffix, so an
// existing release — possibly the one being served — is never written into.
const base = commit === 'unknown' ? `local-${Date.now().toString(36)}` : commit.slice(0, 12);
let version = base;
if ((await listKeys(r2, keys.versionPrefix(runtimeId, version))).length > 0) {
	version = `${base}-${Date.now().toString(36)}`;
}
const prefix = keys.versionPrefix(runtimeId, version);
// Read before the upload: the promote below is a compare-and-swap against THIS pointer, so a rollback
// made while the release uploads is not silently undone by it.
const swap = await readPointerForSwap(r2, runtimeId);

const files = [];
for await (const file of walk(buildDir)) files.push(file);
let bytes = 0;
const UPLOAD_CONCURRENCY = 8;
for (let i = 0; i < files.length; i += UPLOAD_CONCURRENCY) {
	await Promise.all(
		files.slice(i, i + UPLOAD_CONCURRENCY).map(async (file) => {
			const rel = relative(buildDir, file).split(sep).join('/');
			const body = await readFile(file);
			await r2.s3.send(
				new r2.sdk.PutObjectCommand({
					Bucket: r2.bucket,
					Key: `${prefix}${rel}`,
					Body: body,
					ContentType: MIME[extname(rel).toLowerCase()] ?? 'application/octet-stream',
				}),
			);
			bytes += body.length;
		}),
	);
}
const landed = await listKeys(r2, prefix);
if (landed.length !== files.length) {
	console.error(
		`Uploaded ${files.length} file(s) but ${prefix} lists ${landed.length} — not releasing it.`,
	);
	process.exit(1);
}
console.info(
	`Uploaded ${files.length} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB to ${r2.bucket}/${prefix}`,
);

const release = {
	version,
	commit,
	shortCommit,
	builtAt,
	marker,
	files: files.length,
	bytes,
	runUrl,
};
const history = await readHistory(r2, runtimeId);
await writeHistory(r2, runtimeId, [release, ...history.filter((r) => r.version !== version)]);

if (!promoteAfterUpload) {
	console.info(
		`\nRecorded ${runtimeId}@${version} WITHOUT promoting it — no game serves it yet.\n` +
			`Canary: runtime-pointer.mjs ${runtimeId} pin <gameKey> ${version}; then promote ${version}.`,
	);
	process.exit(0);
}

const pointer = await promote(r2, runtimeId, release, 'release', swap);
console.info(
	`Pointer ${keys.pointer(runtimeId)} → ${version} (previous: ${pointer.previous ?? 'none'})`,
);
// Best-effort: the release is live once the pointer moved, and a failed prune must not fail the
// step before the served check runs. The next release prunes again.
try {
	const pruned = await prune(r2, runtimeId);
	if (pruned.length) console.info(`Pruned ${pruned.length} old release(s).`);
} catch (e) {
	console.info(`::warning title=Prune skipped::${e.message}`);
}

console.info(`\nNext: POST /refresh the test server so it picks up ${runtimeId}@${version}.`);
