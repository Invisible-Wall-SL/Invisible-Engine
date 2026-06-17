// Publish a GENERIC ENGINE RUNTIME bundle to R2 so the Invisible Test Server
// can serve it for every Game-Maker game whose manifest entry has
// `runtime: "<id>"`. Unlike publish-game-bundle.mjs this uploads to
// test_server/_runtime/<id>/ and writes NO games.json entry — a runtime bundle
// is shared infrastructure, not a game. Re-run it only when the ENGINE changes
// (a deliberate runtime release), not per published game.
//
//   # build the generic lines runtime once, then upload it as `_runtime/lines`:
//   pnpm --filter lines build
//   R2_ENDPOINT=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//     node apps/launcher-api/scripts/publish-runtime-bundle.mjs lines apps/lines/build
//
// The bundle is a normal `apps/lines` build (doc:null placeholder). A game URL
// activates runtime mode with `?runtime=1&project=<key>&k=<readToken>`, so ONE
// uploaded bundle serves every lines-type project. (Other game-type runtimes —
// ways/cluster/scatter/book — land in Phase 3.)

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const runtimeId = positional[0];
const buildDir = positional[1];
if (!runtimeId || !buildDir) {
	console.error('Usage: node publish-runtime-bundle.mjs <runtimeId> <buildDir>  (e.g. lines apps/lines/build)');
	process.exit(1);
}

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

try {
	await stat(join(buildDir, 'index.html'));
} catch {
	console.error(`No index.html in '${buildDir}'. Build the runtime first (e.g. pnpm --filter lines build).`);
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

const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
const s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });

const PREFIX = `test_server/_runtime/${runtimeId}/`;
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
console.info(`\nNext: POST /refresh the test server so it picks up the runtime bundle.`);
