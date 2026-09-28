// Prove a just-published runtime bundle is what the test server SERVES — and fail if it is not.
//
//   R2_ENDPOINT=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//     node apps/launcher-api/scripts/verify-runtime-live.mjs lines apps/lines/build
//
// WHY THIS EXISTS: uploading is not serving. The test server holds every bundle in memory and
// re-reads R2 only on boot and on `POST /refresh` (`services/test-server/server.mjs` — `hydrate()`),
// and `/refresh` answers 202 before the hydrate runs, so a 202 proves nothing. The release job used
// to stop at the 202 and stay green: after #799 the old bundle was still served 12+ minutes after a
// green run, with `release.json` naming the new commit. `release.json` proves the UPLOAD.
//
// So this matches the served `index.html` against the build's content-hashed `bundle.<hash>.js` —
// unique per build, so a match proves THIS build is live, not "a" build. Same contract as
// `verify_deploy_live()` in the desktop launcher and the live check in `publish-game-via-portal.mjs`.
//
// `_runtime/<id>` has no URL of its own: the server resolves files only through a `games.json` key.
// The probe is therefore a game whose manifest entry has `runtime: <id>`, read from R2 rather than
// hardcoded, since any such game serves the one shared in-memory bundle.
//
// The index is fetched with a `?cb=` query and never the bare immutable bundle URL: fetching that
// before the hydrate lands 404s, and the edge caches the 404 for hours on the exact file every game
// then needs.
//
// Exits 1 if the served bundle never matches within the deadline. The deadline outlasts a test
// server reboot (it hydrates all of R2 before it listens, and a push to `main` can redeploy it at
// the same moment a release lands).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const [runtimeId, buildDir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!runtimeId || !buildDir) {
	console.error('Usage: node verify-runtime-live.mjs <runtimeId> <buildDir>');
	process.exit(1);
}

const ORIGIN = process.env.GAMES_ORIGIN ?? 'https://games.invisiblewall.org';
const DEADLINE_MS = Number(process.env.VERIFY_TIMEOUT_MS ?? 15 * 60_000);
const POLL_MS = 10_000;
/** Gaps between re-POSTs of /refresh — a hydrate that began before the upload finished can
 *  complete without it, and a rebooting server drops the request entirely. */
const REFRESH_GAPS_MS = [30_000, 45_000, 60_000, 90_000, 120_000];

const MARKER_RE = /bundle\.[A-Za-z0-9_-]+\.js/;

const localIndex = await readFile(join(buildDir, 'index.html'), 'utf8');
const marker = MARKER_RE.exec(localIndex)?.[0];
if (!marker) {
	console.error(
		`No bundle.<hash>.js in ${join(buildDir, 'index.html')} — cannot prove what is live.`,
	);
	process.exit(1);
}

const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
	console.error('Missing R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.');
	process.exit(1);
}
const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
const s3 = new S3Client({
	region: 'auto',
	endpoint: R2_ENDPOINT,
	credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});
const manifestObject = await s3.send(
	new GetObjectCommand({ Bucket: R2_BUCKET, Key: 'test_server/games.json' }),
);
const manifest = JSON.parse(await manifestObject.Body.transformToString());
const probe = Object.entries(manifest?.games ?? {})
	.filter(([, meta]) => meta?.runtime === runtimeId)
	.map(([key]) => key)
	.sort()[0];
if (!probe) {
	console.info(
		`No game in test_server/games.json uses runtime '${runtimeId}' — nothing serves it.`,
	);
	process.exit(0);
}

async function refresh() {
	const secret = process.env.TEST_SERVER_SECRET;
	const url = `${ORIGIN}/refresh${secret ? `?secret=${encodeURIComponent(secret)}` : ''}`;
	try {
		const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(25_000) });
		console.info(`  POST /refresh → HTTP ${res.status}`);
	} catch (e) {
		console.info(`  POST /refresh → unreachable (${e.message})`);
	}
}

async function served() {
	try {
		const res = await fetch(`${ORIGIN}/${probe}/index.html?cb=${Date.now()}`, {
			cache: 'no-store',
			signal: AbortSignal.timeout(25_000),
		});
		if (!res.ok) return `HTTP ${res.status}`;
		return MARKER_RE.exec(await res.text())?.[0] ?? 'no bundle marker';
	} catch (e) {
		return `unreachable (${e.message})`;
	}
}

console.info(`Waiting for ${ORIGIN}/${probe}/ to serve ${marker} (runtime '${runtimeId}')…`);
const start = Date.now();
await refresh();
let refreshes = 0;
let nextRefreshAt = start + REFRESH_GAPS_MS[0];
let last = '';
while (Date.now() - start < DEADLINE_MS) {
	await new Promise((r) => setTimeout(r, POLL_MS));
	last = await served();
	const elapsed = Math.round((Date.now() - start) / 1000);
	console.info(`  ${elapsed}s: serving ${last}`);
	if (last === marker) {
		console.info(`LIVE — the test server is serving this build (${marker}).`);
		process.exit(0);
	}
	if (Date.now() >= nextRefreshAt) {
		await refresh();
		refreshes++;
		nextRefreshAt = Date.now() + REFRESH_GAPS_MS[Math.min(refreshes, REFRESH_GAPS_MS.length - 1)];
	}
}

console.error(
	`::error title=Runtime bundle not live::Uploaded ${marker} to _runtime/${runtimeId}, but after ` +
		`${Math.round((Date.now() - start) / 1000)}s ${ORIGIN}/${probe}/ still serves ${last}. Every online game on ` +
		`this runtime is on the previous engine. POST ${ORIGIN}/refresh by hand, or re-run this job.`,
);
process.exit(1);
