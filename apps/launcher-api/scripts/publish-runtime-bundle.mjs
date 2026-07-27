// Publish a GENERIC ENGINE RUNTIME bundle to R2 so the Invisible Test Server
// can serve it for every Game-Maker game whose manifest entry has
// `runtime: "<id>"`. Unlike publish-game-bundle.mjs this uploads to
// test_server/_runtime/<id>/ and writes NO games.json entry — a runtime bundle
// is shared infrastructure, not a game. Re-run it only when the ENGINE changes
// (a deliberate runtime release), not per published game.
//
//   # build the generic lines runtime once, then upload it as `_runtime/lines`:
//   PUBLIC_RGS_TRANSPORT=play4fun pnpm --filter lines build
//   R2_ENDPOINT=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//     node apps/launcher-api/scripts/publish-runtime-bundle.mjs lines apps/lines/build
//
// !! PUBLIC_RGS_TRANSPORT=play4fun IS REQUIRED. The test server's mock RGS speaks
// Play4Fun; a bundle built without it uses the default Stake transport, never
// completes the RGS handshake, and the game hangs on the loading screen (blank).
//
// The bundle is a normal `apps/lines` build (doc:null placeholder). A game URL
// activates runtime mode with `?runtime=1&project=<key>&k=<readToken>`, so ONE
// uploaded bundle serves every lines-type project. (Other game-type runtimes —
// ways/cluster/scatter/book — land in Phase 3.)

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, relative, sep } from 'node:path';

const args = process.argv.slice(2);

// `--status building` (or RELEASE_STATUS=building) is the EARLY-STAMP mode: write only
// `release.json` with status:'building' and exit WITHOUT building or uploading the bundle,
// so the launcher can show "Releasing engine…" while the real upload runs. The normal path
// (no flag) does the full upload and then stamps status:'released'.
function flagValue(name) {
	const i = args.indexOf(name);
	return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
const statusFlag = flagValue('--status') ?? process.env.RELEASE_STATUS;
const buildingOnly = statusFlag === 'building';

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
if (!runtimeId || (!buildingOnly && !buildDir)) {
	console.error('Usage: node publish-runtime-bundle.mjs <runtimeId> <buildDir>  (e.g. lines apps/lines/build)');
	process.exit(1);
}

// Commit the bundle was built from — GitHub Actions injects GITHUB_SHA; a local run has none.
const commit = process.env.GITHUB_SHA || 'unknown';
const shortCommit = commit === 'unknown' ? 'unknown' : commit.slice(0, 7);
const builtAt = new Date().toISOString();

const RUNTIME_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
if (!RUNTIME_ID_RE.test(runtimeId)) {
	console.error(`Invalid runtimeId '${runtimeId}' — must match ${RUNTIME_ID_RE} (lowercase, no spaces).`);
	process.exit(1);
}

const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
	console.error('Missing R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.');
	process.exit(1);
}

if (!buildingOnly) {
	try {
		await stat(join(buildDir, 'index.html'));
	} catch {
		console.error(`No index.html in '${buildDir}'. Build the runtime first (e.g. pnpm --filter lines build).`);
		process.exit(1);
	}
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

const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
const s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });

const PREFIX = `test_server/_runtime/${runtimeId}/`;

// Advisory stamp the launcher reads to tell "what engine commit is live + is a release
// building right now" (the bundle-vs-source axis). Shape is consumed by
// `testServerManifest.ts` → `runtimeRelease` / `engineDeployStatus`.
async function stampRelease(status) {
	const release = { runtimeId, commit, shortCommit, builtAt, status };
	await s3.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: `${PREFIX}release.json`,
			Body: JSON.stringify(release, null, 2),
			ContentType: 'application/json; charset=utf-8',
		}),
	);
	console.info(`Stamped ${PREFIX}release.json → status='${status}' commit=${shortCommit}`);
}

if (buildingOnly) {
	await stampRelease('building');
	console.info('Early stamp only (--status building) — skipping build + upload.');
	process.exit(0);
}

let uploaded = 0;
let bytes = 0;
for await (const file of walk(buildDir)) {
	const rel = relative(buildDir, file).split(sep).join('/');
	const body = await readFile(file);
	await s3.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: `${PREFIX}${rel}`,
			Body: body,
			ContentType: MIME[extname(rel).toLowerCase()] ?? 'application/octet-stream',
		}),
	);
	uploaded++;
	bytes += body.length;
	if (rel === 'index.html' || uploaded % 25 === 0) {
		console.info(`  ${rel} (${(body.length / 1024).toFixed(0)} KB)`);
	}
}
console.info(`Uploaded ${uploaded} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB to ${bucket}/${PREFIX}`);

await stampRelease('released');

console.info(`\nNext: POST /refresh the test server so it picks up the runtime bundle.`);
