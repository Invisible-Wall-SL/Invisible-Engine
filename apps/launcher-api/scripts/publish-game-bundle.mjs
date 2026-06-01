// Publish a built game bundle to R2 so the Invisible Test Server
// (services/test-server) can serve it. The OWNER runs this after building a
// game; it uploads every file under <buildDir> to  test_server/<gameKey>/...
// and registers the game in the manifest  test_server/games.json.
//
//   R2_ENDPOINT=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//     node apps/launcher-api/scripts/publish-game-bundle.mjs <gameKey> <buildDir> \
//       [--protocol lines|book] [--name "Display Name"]
//
// Examples (from the engine repo root):
//   # Hot Fruits (in-repo `lines` game):
//   PUBLIC_RGS_TRANSPORT=play4fun PUBLIC_RGS_GAME=lines pnpm --filter lines build
//   node apps/launcher-api/scripts/publish-game-bundle.mjs hotfruits apps/lines/build \
//     --protocol lines --name "Hot Fruits"
//
//   # Book of Borut (built in its own repo, then point at that build dir):
//   node apps/launcher-api/scripts/publish-game-bundle.mjs book_of_borut <path>/build \
//     --protocol book --name "Book of Borut"
//
// The mock protocol selects which mock RGS the test server mounts for the game:
//   lines = Hot Fruits-style       book = Book-of (buy feature + free spins)

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const getFlag = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};

const gameKey = positional[0];
const buildDir = positional[1];
if (!gameKey || !buildDir) {
	console.error('Usage: node publish-game-bundle.mjs <gameKey> <buildDir> [--protocol lines|book] [--name "Display Name"]');
	process.exit(1);
}

const GAME_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
if (!GAME_KEY_RE.test(gameKey)) {
	console.error(`Invalid gameKey '${gameKey}' — must match ${GAME_KEY_RE} (lowercase, no spaces).`);
	process.exit(1);
}

// Default the mock protocol from the key when not given (book-of games → 'book').
const protocol =
	getFlag('protocol') ?? (/book|borut/.test(gameKey) ? 'book' : 'lines');
if (protocol !== 'lines' && protocol !== 'book') {
	console.error(`--protocol must be 'lines' or 'book' (got '${protocol}').`);
	process.exit(1);
}
const name = getFlag('name') ?? gameKey;

const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
	console.error('Missing R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.');
	process.exit(1);
}

// Sanity: the build dir must contain an index.html (the inline bundle).
try {
	await stat(join(buildDir, 'index.html'));
} catch {
	console.error(`No index.html in '${buildDir}'. Did you build the game first (vite build → build/)?`);
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

const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
const s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });

const PREFIX = `test_server/${gameKey}/`;
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

// Update the manifest (read-modify-write).
const MANIFEST_KEY = 'test_server/games.json';
let manifest = { games: {} };
try {
	const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: MANIFEST_KEY }));
	manifest = JSON.parse(await res.Body.transformToString());
	if (!manifest.games) manifest.games = {};
} catch (e) {
	if (e?.name !== 'NoSuchKey') console.warn(`(no existing manifest — creating: ${e?.name ?? e})`);
}
manifest.games[gameKey] = { protocol, name, updatedAt: new Date().toISOString() };
await s3.send(
	new PutObjectCommand({
		Bucket: bucket,
		Key: MANIFEST_KEY,
		Body: JSON.stringify(manifest, null, 2),
		ContentType: 'application/json; charset=utf-8',
	}),
);
console.info(`Registered '${gameKey}' (protocol=${protocol}, name="${name}") in ${MANIFEST_KEY}.`);
console.info(`\nNext: restart the test server (or POST /refresh) so it picks up the new bundle.`);
