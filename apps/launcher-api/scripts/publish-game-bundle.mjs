// Publish a built game bundle to R2 so the Invisible Test Server
// (services/test-server) can serve it. The OWNER runs this after building a
// game; it uploads every file under <buildDir> to  test_server/<gameKey>/...
// and registers the game in the manifest  test_server/games.json.
//
//   R2_ENDPOINT=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//     node apps/launcher-api/scripts/publish-game-bundle.mjs <gameKey> <buildDir> \
//       [--protocol lines|book|ways|cluster|scatter] [--name "Display Name"] \
//       [--project <projectKey> --launcher <origin> --read-token <token>]
//
// ⚠️ PASS --project (with --launcher + --read-token) FOR ANY GAME AUTHORED IN THE STUDIO.
// Without them the entry has no pointer back at the project's Invisible Game Config, so the test
// server cannot follow it and the mock deals its BUILT-IN 5×3 Hot Fruits default — 7 line symbols
// + scatter, 5 paylines, lines scoring — no matter what `/config` says. The game still plays; it
// plays a different game than the client draws, and every symptom of that surfaces as an
// unexplainable presentation bug. `waysofwavesbuild` (project `test6`) shipped this way and drew a
// stepped 5×[3,4,4,4,4] `ways` board against a 5×3 lines deal: an out-of-dictionary symbol landed
// with placeholder art, and the client's bottom row — which was really the facade's own padding row,
// made visible by the row-count mismatch — never exploded.
//
// The three values are exactly what the online Game Maker stamps, and none is a new exposure: all
// three appear verbatim in the public game URL. `--read-token` is the project's public read token
// (the `k=` in that URL); `--launcher` is the launcher origin (https://app.invisiblewall.org).
//
// Examples (each game is its OWN standalone repo with the engine as a submodule;
// build with `pnpm build` → build/. The engine's apps/lines is a stale copy.):
//   # Hot Fruits (C:\…\Projects\iGaming\Borut\HotFruits):
//   PUBLIC_RGS_TRANSPORT=play4fun pnpm build
//   node <engine>/apps/launcher-api/scripts/publish-game-bundle.mjs hotfruits <HotFruits>/build \
//     --protocol lines --name "Hot Fruits"
//
//   # Book of Borut (its own repo):
//   PUBLIC_RGS_TRANSPORT=play4fun PUBLIC_RGS_GAME=book pnpm build
//   node <engine>/apps/launcher-api/scripts/publish-game-bundle.mjs bookofborut <repo>/build \
//     --protocol book --name "Book of Borut"
//
//   # Ways on Waves (Studio project `test6`) — a game whose key is NOT its project key:
//   node <engine>/apps/launcher-api/scripts/publish-game-bundle.mjs waysofwavesbuild <repo>/build \
//     --protocol ways --name "Ways on Waves" \
//     --project test6 --launcher https://app.invisiblewall.org --read-token <k>
//
// The mock protocol selects which mock RGS the test server mounts for the game:
//   lines = Hot Fruits-style       book = Book-of (buy feature + free spins)
//   ways / cluster / scatter = the lines mock with that win evaluator
// It is only the FALLBACK once --project is given: the test server then reads the protocol (and the
// grid, symbol pool, cascade and paytable) from the live config, which is the one place they cannot
// go stale.

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
	console.error(
		'Usage: node publish-game-bundle.mjs <gameKey> <buildDir> ' +
			'[--protocol lines|book|ways|cluster|scatter] [--name "Display Name"] ' +
			'[--project <projectKey> --launcher <origin> --read-token <token>]',
	);
	process.exit(1);
}

const GAME_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
if (!GAME_KEY_RE.test(gameKey)) {
	console.error(`Invalid gameKey '${gameKey}' — must match ${GAME_KEY_RE} (lowercase, no spaces).`);
	process.exit(1);
}

// Default the mock protocol from the key when not given (book-of games → 'book'). The list matches
// `MOCK_PROTOCOLS` in services/test-server/server.mjs — a name this side accepts but that side does
// not would silently downgrade the game to `lines`, which is the failure this whole flag guards.
const MOCK_PROTOCOLS = ['lines', 'book', 'ways', 'cluster', 'scatter'];
const protocol = getFlag('protocol') ?? (/book|borut/.test(gameKey) ? 'book' : 'lines');
if (!MOCK_PROTOCOLS.includes(protocol)) {
	console.error(`--protocol must be one of ${MOCK_PROTOCOLS.join('|')} (got '${protocol}').`);
	process.exit(1);
}
const name = getFlag('name') ?? gameKey;

// The pointer back at the project's live Invisible Game Config. All three or none: a `projectKey`
// with no way to fetch it is dead weight in the manifest, and a `docBase`/`readToken` with no
// project name is what sent the test server asking for a project named after the game.
const projectKey = getFlag('project');
const launcherOrigin = getFlag('launcher')?.replace(/\/+$/, '');
const readToken = getFlag('read-token');
const pointerFlags = [projectKey, launcherOrigin, readToken].filter(Boolean).length;
if (pointerFlags > 0 && pointerFlags < 3) {
	console.error(
		'--project, --launcher and --read-token go together (got ' +
			`${pointerFlags}/3). Without all three the test server cannot read the project's config.`,
	);
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

// Sanity: the build dir must contain an index.html (the inline bundle).
try {
	await stat(join(buildDir, 'index.html'));
} catch {
	console.error(
		`No index.html in '${buildDir}'. Did you build the game first (vite build → build/)?`,
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

const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
const s3 = new S3Client({
	region: 'auto',
	endpoint,
	credentials: { accessKeyId, secretAccessKey },
});

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
console.info(
	`Uploaded ${uploaded} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB to ${bucket}/${PREFIX}`,
);

// Update the manifest (CONDITIONAL read-modify-write — MERGE so other games aren't
// dropped, guarded with If-Match + retried on a lost CAS so two concurrent publishers
// can't silently drop each other's entry — see docs/design/multi-user-concurrency.md
// Phase 0; the same guard lives in src/lib/server/testServerManifest.ts).
// Canonical shape (see docs/tools/test-server.md "Manifest contract"); the desktop
// launcher's publish_game() and services/test-server/server.mjs share it:
//   { "games": { "<key>": { "protocol": …, "name": str, "updatedAt": iso,
//                           "projectKey"?: str, "docBase"?: str, "readToken"?: str,
//                           "grid"?: {…}, "cascade"?: bool } } }
const MANIFEST_KEY = 'test_server/games.json';
const MANIFEST_MAX_ATTEMPTS = 6;
for (let attempt = 1; ; attempt++) {
	let manifest = { games: {} };
	// Present ⇒ conditional If-Match overwrite; absent ⇒ If-None-Match create.
	let etag;
	try {
		const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: MANIFEST_KEY }));
		etag = res.ETag;
		try {
			const parsed = JSON.parse(await res.Body.transformToString());
			if (parsed && typeof parsed.games === 'object' && parsed.games)
				manifest = { games: parsed.games };
		} catch {
			// Present but corrupt: overwrite it in place (etag still drives an If-Match).
			console.warn('(existing manifest is corrupt — overwriting it in place)');
		}
	} catch (e) {
		if (e?.name !== 'NoSuchKey' && e?.$metadata?.httpStatusCode !== 404) throw e;
		// Absent — first publish; create with If-None-Match: '*'.
	}
	// SPREAD the existing entry rather than replacing it. This script only knows the fields it was
	// given; the online Game Maker writes several more (`grid`, `cascade`, and the project pointer),
	// and a plain assignment silently DELETED them — so re-publishing a bundle for a game that had a
	// working pointer un-pinned it from its config and sent the mock back to its default board. The
	// three explicit `...(x ? {} : {})` spreads below then let this run ADD the pointer without ever
	// blanking one it wasn't told about.
	const previous = manifest.games[gameKey] ?? {};
	manifest.games[gameKey] = {
		...previous,
		protocol,
		name,
		updatedAt: new Date().toISOString(),
		...(projectKey ? { projectKey } : {}),
		...(launcherOrigin ? { docBase: launcherOrigin } : {}),
		...(readToken ? { readToken } : {}),
	};
	const cond = etag ? { IfMatch: etag } : { IfNoneMatch: '*' };
	try {
		await s3.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: MANIFEST_KEY,
				Body: JSON.stringify(manifest, null, 2),
				ContentType: 'application/json; charset=utf-8',
				...cond,
			}),
		);
		break;
	} catch (e) {
		const code = e?.$metadata?.httpStatusCode;
		const lostCas =
			code === 412 ||
			code === 409 ||
			e?.name === 'PreconditionFailed' ||
			e?.name === 'ConditionalRequestConflict';
		if (lostCas && attempt < MANIFEST_MAX_ATTEMPTS) {
			console.warn(`(manifest changed under us — re-reading and retrying, attempt ${attempt + 1})`);
			continue;
		}
		throw e;
	}
}
console.info(`Registered '${gameKey}' (protocol=${protocol}, name="${name}") in ${MANIFEST_KEY}.`);
if (projectKey) {
	console.info(`Pinned to project '${projectKey}' at ${launcherOrigin} — the mock will follow its`);
	console.info(`Invisible Game Config (board, symbol pool, paytable, cascade) with no republish.`);
} else {
	// Loud, and at the END, because it is the difference between "published" and "published and
	// actually playing this project's game" — and the failure is otherwise invisible from here.
	console.warn(`\n⚠️  No --project given, so '${gameKey}' is NOT pinned to a Studio project.`);
	console.warn(`   The mock RGS will deal its built-in 5×3 lines default (7 symbols, 5 paylines)`);
	console.warn(`   regardless of what /config authors — see this file's header. Re-run with`);
	console.warn(`   --project <projectKey> --launcher <origin> --read-token <token> to fix it.`);
}
console.info(`\nNext: restart the test server (or POST /refresh) so it picks up the new bundle.`);
