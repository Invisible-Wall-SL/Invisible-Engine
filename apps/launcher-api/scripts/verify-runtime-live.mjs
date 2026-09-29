// Prove a just-published runtime bundle is what the test server SERVES — and fail if it is not.
//
//   R2_ENDPOINT=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//     node apps/launcher-api/scripts/verify-runtime-live.mjs lines apps/lines/build   # a release
//     node apps/launcher-api/scripts/verify-runtime-live.mjs lines                    # what the pointer names
//     node apps/launcher-api/scripts/verify-runtime-live.mjs lines --game <key> --version <v>   # a pinned canary
//
// WHY THIS EXISTS: uploading is not serving. The test server holds every bundle in memory and
// re-reads R2 only on boot and on `POST /refresh` (`services/test-server/server.mjs` — `hydrate()`),
// and `/refresh` answers 202 before the hydrate runs, so a 202 proves nothing. The release job used
// to stop at the 202 and stay green: after #799 the old bundle was still served 12+ minutes after a
// green run, with `release.json` naming the new commit. `release.json` proves the UPLOAD.
//
// So this matches the served `index.html` against the build's content-hashed `bundle.<hash>.js` —
// unique per build, so a match proves THIS build is live, not "a" build — AND the server's
// `X-Runtime-Release` header against the release the pointer names, which is what tells a rollback
// between two builds of identical code apart. Same contract as `verify_deploy_live()` in the desktop
// launcher and the live check in `publish-game-via-portal.mjs`.
//
// A runtime has no URL of its own: the server resolves files only through a `games.json` key. The
// probe is therefore a game whose manifest entry has `runtime: <id>` and no `runtimeVersion` pin,
// read from R2 rather than hardcoded, since every such game serves the one release the pointer names.
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
import {
	GAMES_MANIFEST_KEY,
	MARKER_RE,
	r2FromEnv,
	readHistory,
	readJson,
	readPointer,
	refreshTestServer,
} from './lib/runtime-releases.mjs';

const argv = process.argv.slice(2);
const opt = (name) => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const [runtimeId, buildDir] = positional;
if (!runtimeId) {
	console.error(
		'Usage: node verify-runtime-live.mjs <runtimeId> [buildDir] [--game <key>] [--version <v>]\n' +
			'  expects the build in <buildDir>, else release <v>, else whatever the pointer names',
	);
	process.exit(1);
}

const ORIGIN = process.env.GAMES_ORIGIN ?? 'https://games.invisiblewall.org';
const DEADLINE_MS = Number(process.env.VERIFY_TIMEOUT_MS || 15 * 60_000);
const POLL_MS = 10_000;
/** Gaps between re-POSTs of /refresh — a hydrate that began before the upload finished can
 *  complete without it, and a rebooting server drops the request entirely. */
const REFRESH_GAPS_MS = [30_000, 45_000, 60_000, 90_000, 120_000];

const r2 = await r2FromEnv();
/** One transient R2 error must not turn a release that shipped into a red run. */
async function retrying(what, read) {
	for (const wait of [0, 5_000, 15_000, 30_000]) {
		await new Promise((r) => setTimeout(r, wait));
		try {
			return await read();
		} catch (e) {
			console.info(`  reading ${what} failed (${e.message})`);
		}
	}
	console.error(`Could not read ${what} from R2.`);
	process.exit(1);
}

// WHAT must be served: the release named by --version, else the pointer's. A build dir (the release
// job) must match it — the job promoted exactly that build, so a mismatch means something else moved
// the pointer in between.
const pointer = await retrying('the runtime pointer', () => readPointer(r2, runtimeId));
const wantVersion = opt('--version') || pointer?.version || null;
let marker =
	wantVersion && wantVersion !== pointer?.version
		? (await retrying('the release history', () => readHistory(r2, runtimeId))).find(
				(r) => r.version === wantVersion,
			)?.marker
		: pointer?.marker;
if (buildDir) {
	const built = MARKER_RE.exec(await readFile(join(buildDir, 'index.html'), 'utf8'))?.[0];
	if (!built) {
		console.error(
			`No bundle.<hash>.js in ${join(buildDir, 'index.html')} — cannot prove what is live.`,
		);
		process.exit(1);
	}
	if (marker && marker !== built) {
		console.error(
			`::error title=Runtime pointer moved::_runtime/${runtimeId} names ${wantVersion} (${marker}), not this build (${built}).`,
		);
		process.exit(1);
	}
	marker = built;
}
if (!marker) {
	console.error(
		`No release '${wantVersion}' of '${runtimeId}' is recorded — nothing to verify against.`,
	);
	process.exit(1);
}
/** What the test server's `X-Runtime-Release` header must say; null on the flat pre-pointer layout. */
const wantRelease = wantVersion ? `${runtimeId}@${wantVersion}` : null;

// WHERE to look: the named game, else a game that follows the pointer (a pinned canary would answer
// for its own release, not the pointer's).
const manifest = await retrying(GAMES_MANIFEST_KEY, () => readJson(r2, GAMES_MANIFEST_KEY));
const probe =
	opt('--game') ||
	Object.entries(manifest?.value?.games ?? {})
		.filter(([, meta]) => meta?.runtime === runtimeId && meta.runtimeVersion == null)
		.map(([key]) => key)
		.sort()[0];
if (!probe) {
	console.info(
		`::warning title=Runtime not verified::No game in test_server/games.json follows runtime ` +
			`'${runtimeId}', so nothing serves it and there is nothing to verify.`,
	);
	process.exit(0);
}

const refresh = () => refreshTestServer(ORIGIN);

async function served() {
	try {
		const res = await fetch(`${ORIGIN}/${probe}/index.html?cb=${Date.now()}`, {
			cache: 'no-store',
			signal: AbortSignal.timeout(25_000),
		});
		if (!res.ok) return `HTTP ${res.status}`;
		const name = MARKER_RE.exec(await res.text())?.[0] ?? 'no bundle marker';
		const release = res.headers.get('x-runtime-release');
		if (wantRelease && release !== wantRelease)
			return `${name} from ${release ?? 'the flat layout'}`;
		if (name !== marker) return name;
		// Only a served bundle counts, not an index.html that names it. `?cb=` keeps this off the
		// bare immutable URL's cache key (see the header).
		const bundle = await fetch(`${ORIGIN}/${probe}/_app/immutable/${marker}?cb=${Date.now()}`, {
			method: 'HEAD',
			cache: 'no-store',
			signal: AbortSignal.timeout(25_000),
		});
		return bundle.ok ? name : `${name} in index.html, but the bundle file is HTTP ${bundle.status}`;
	} catch (e) {
		return `unreachable (${e.message})`;
	}
}

console.info(
	`Waiting for ${ORIGIN}/${probe}/ to serve ${marker} (${wantRelease ?? `runtime '${runtimeId}'`})…`,
);
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
		console.info(
			`LIVE after ${elapsed}s — ${probe} serves ${marker}${wantRelease ? ` from ${wantRelease}` : ''}.`,
		);
		process.exit(0);
	}
	if (Date.now() >= nextRefreshAt) {
		// Waiting on the POINTER's release: if a rollback or another release moved the pointer
		// meanwhile, this release is no longer meant to be live — say that, instead of timing out.
		const followsPointer = !opt('--version') && !opt('--game');
		const now = followsPointer ? await readPointer(r2, runtimeId).catch(() => null) : null;
		if (now && now.version !== wantVersion) {
			console.error(
				`::error title=Runtime pointer moved::While verifying, _runtime/${runtimeId} moved from ` +
					`${wantVersion} to ${now.version} (via ${now.via}). The games follow ${now.version}.`,
			);
			process.exit(1);
		}
		await refresh();
		refreshes++;
		nextRefreshAt = Date.now() + REFRESH_GAPS_MS[Math.min(refreshes, REFRESH_GAPS_MS.length - 1)];
	}
}

console.error(
	`::error title=Runtime bundle not live::Expected ${marker}${wantRelease ? ` (${wantRelease})` : ''}, but after ` +
		`${Math.round((Date.now() - start) / 1000)}s ${ORIGIN}/${probe}/ still serves ${last}. Every online game on ` +
		`this runtime is still on another release. POST ${ORIGIN}/refresh by hand, or re-run this job.`,
);
process.exit(1);
