// Publish an ALREADY-BUILT game bundle to the Invisible Test Server THROUGH the portal, for a
// machine that cannot reach R2 directly.
//
//   node apps/launcher-api/scripts/publish-game-via-portal.mjs <gameKey> <buildDir> \
//     [--protocol lines|book|ways|cluster|scatter] [--name "Display Name"] \
//     [--project <projectKey>] [--launcher <origin>] [--token <t>] [--no-register] [--dry-run]
//
// WHY THIS EXISTS, and when to reach for it instead of the desktop launcher's own Build & publish:
// Spanish ISPs null-route whole Cloudflare anycast ranges under the LaLiga anti-piracy orders, and
// `<account>.r2.cloudflarestorage.com` resolves INTO them. On a blocked line DNS answers but TCP
// 443 never connects, so the launcher's first R2 call dies with a bare `ConnectTimeoutError` and
// the publish stops before uploading anything — while the portal, the test server and the rest of
// the zone stay reachable. This script sends the same bytes to `PUT /api/launcher/game-upload`, and
// Railway (not behind the block) writes them to R2. The build is NOT re-run: it ships exactly the
// files already on disk, so a publish the launcher refused is recoverable without rebuilding.
//
// It is also the plain-node twin of `publish-game-bundle.mjs`: same positional arguments, same
// resulting manifest entry and portal card. Use that one when your line can reach R2 (it talks
// straight to the bucket, no portal round trip); use this one when it can't.
//
// The upload is IDEMPOTENT and resumable — re-running re-PUTs and finishes the job, which is the
// behaviour you want on a line that drops mid-matchday.
//
// Auth: an admin session token, the same one the desktop launcher gets. Pass `--token`, or set
// LAUNCHER_TOKEN, or let the script ask for your portal email + password (never echoed, never
// stored) and mint one via POST /api/launcher/login.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);

const gameKey = positional[0];
const buildDir = positional[1];
if (!gameKey || !buildDir) {
	console.error(
		'Usage: node publish-game-via-portal.mjs <gameKey> <buildDir> ' +
			'[--protocol lines|book|ways|cluster|scatter] [--name "Display Name"] ' +
			'[--project <projectKey>] [--launcher <origin>] [--token <t>] [--no-register] [--dry-run]',
	);
	process.exit(1);
}

// MUST match isValidGameKey() in src/lib/server/games.ts and publish_game() in Invisible_Launcher.py.
const GAME_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
if (!GAME_KEY_RE.test(gameKey)) {
	console.error(`Invalid gameKey '${gameKey}' — must match ${GAME_KEY_RE} (lowercase, no spaces).`);
	process.exit(1);
}

// Matches MOCK_PROTOCOLS in services/test-server/server.mjs. It is only the FALLBACK once the game
// is pinned to a project: the test server then reads the protocol, grid, symbol pool, cascade and
// paytable from the project's LIVE config, which is the one place they cannot go stale.
const MOCK_PROTOCOLS = ['lines', 'book', 'ways', 'cluster', 'scatter'];
const protocol = flag('protocol') ?? (/book|borut/.test(gameKey) ? 'book' : 'lines');
if (!MOCK_PROTOCOLS.includes(protocol)) {
	console.error(`Unknown --protocol '${protocol}' — one of ${MOCK_PROTOCOLS.join(', ')}.`);
	process.exit(1);
}

const name = flag('name') ?? gameKey;
const projectKey = flag('project');
const launcherOrigin = (flag('launcher') ?? 'https://app.invisiblewall.org').replace(/\/+$/, '');
const gamesOrigin = (flag('games') ?? 'https://games.invisiblewall.org').replace(/\/+$/, '');
const register = !has('no-register');
const dryRun = has('dry-run');

if (register && !projectKey) {
	console.error(
		'--project <projectKey> is required to register the portal card (it scopes the game and ' +
			'pins it to its live Game Config). Pass --no-register to upload the bundle only.\n' +
			'NOTE: the project key is NOT the cloud key — e.g. game `waysofwavesbuild` is project `test6`.',
	);
	process.exit(1);
}

// ── The bundle on disk ────────────────────────────────────────────────────────
async function walk(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const abs = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(abs)));
		else if (entry.isFile()) out.push(abs);
	}
	return out;
}

const root = buildDir;
if (!(await stat(root).catch(() => null))?.isDirectory()) {
	console.error(`Not a directory: ${root}`);
	process.exit(1);
}
if (!(await stat(join(root, 'index.html')).catch(() => null))?.isFile()) {
	console.error(`No index.html in ${root} — did the build run? (that is the build output dir)`);
	process.exit(1);
}

const absFiles = (await walk(root)).sort();
// R2 keys are posix; a Windows build dir yields `assets\x.png` from relative().
const rels = absFiles.map((abs) => relative(root, abs).split(sep).join('/'));
const totalBytes = (await Promise.all(absFiles.map(async (f) => (await stat(f)).size))).reduce(
	(a, b) => a + b,
	0,
);
console.info(
	`${rels.length} file(s), ${(totalBytes / 1024 / 1024).toFixed(1)} MB in ${root}\n` +
		`  → ${launcherOrigin}/api/launcher/game-upload  (key '${gameKey}', protocol '${protocol}')`,
);
if (dryRun) {
	console.info('--dry-run: nothing sent.');
	process.exit(0);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function ask(question, { hidden = false } = {}) {
	return new Promise((resolve, reject) => {
		const stdin = process.stdin;
		if (!stdin.isTTY) {
			reject(new Error('No TTY to prompt on — pass --token or set LAUNCHER_TOKEN.'));
			return;
		}
		process.stdout.write(question);
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding('utf8');
		let buf = '';
		const done = (fn, arg) => {
			stdin.setRawMode(false);
			stdin.pause();
			stdin.off('data', onData);
			process.stdout.write('\n');
			fn(arg);
		};
		const onData = (chunk) => {
			for (const ch of chunk) {
				if (ch === '\r' || ch === '\n') return done(resolve, buf);
				if (ch.charCodeAt(0) === 3) return done(reject, new Error('Cancelled.')); // ctrl-c
				if (ch.charCodeAt(0) === 127 || ch.charCodeAt(0) === 8) {
					if (buf) {
						buf = buf.slice(0, -1);
						if (!hidden) process.stdout.write('\b \b');
					}
				} else {
					buf += ch;
					if (!hidden) process.stdout.write(ch);
				}
			}
		};
		stdin.on('data', onData);
	});
}

async function mintToken() {
	const fromFlag = flag('token') ?? process.env.LAUNCHER_TOKEN;
	if (fromFlag) return fromFlag;
	console.info(`\nPortal sign-in (${launcherOrigin}) — needed to publish; nothing is stored.`);
	const email = await ask('  email: ');
	const password = await ask('  password: ', { hidden: true });
	const res = await fetch(`${launcherOrigin}/api/launcher/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email: email.trim(), password }),
	});
	if (!res.ok) {
		throw new Error(`Sign-in failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
	}
	const { token } = await res.json();
	if (!token) throw new Error('Sign-in returned no token.');
	return token;
}

const token = await mintToken();
const auth = { authorization: `Bearer ${token}` };

// ── Upload ────────────────────────────────────────────────────────────────────
/** Retry the transient things only: a connect/read failure or a 5xx. A 4xx is a decision. */
async function send(url, init, { attempts = 3, label } = {}) {
	for (let attempt = 1; ; attempt++) {
		let res;
		try {
			res = await fetch(url, init);
		} catch (e) {
			if (attempt >= attempts) throw new Error(`${label}: ${e.message}`);
			await new Promise((r) => setTimeout(r, 500 * attempt));
			continue;
		}
		if (res.ok) return res;
		const text = (await res.text()).slice(0, 400);
		if (res.status === 413) {
			throw new Error(
				`${label}: 413 too large. adapter-node caps request bodies at 512 KB by default — ` +
					`set BODY_SIZE_LIMIT on the launcher-api Railway service (e.g. 64M) and redeploy.`,
			);
		}
		if (res.status >= 500 && attempt < attempts) {
			await new Promise((r) => setTimeout(r, 500 * attempt));
			continue;
		}
		throw new Error(`${label}: ${res.status} ${text}`);
	}
}

const uploadUrl = (rel) =>
	`${launcherOrigin}/api/launcher/game-upload?key=${encodeURIComponent(gameKey)}` +
	`&path=${encodeURIComponent(rel)}`;

let uploaded = 0;
let sentBytes = 0;
for (const [i, rel] of rels.entries()) {
	const body = await readFile(absFiles[i]);
	await send(
		uploadUrl(rel),
		{ method: 'PUT', headers: { ...auth, 'content-type': 'application/octet-stream' }, body },
		{ label: rel },
	);
	uploaded++;
	sentBytes += body.length;
	if (rel === 'index.html' || uploaded % 25 === 0 || uploaded === rels.length) {
		const pct = ((sentBytes / totalBytes) * 100).toFixed(0);
		console.info(
			`  [${uploaded}/${rels.length}] ${pct}% — ${rel} (${(body.length / 1024).toFixed(0)} KB)`,
		);
	}
}
console.info(`Uploaded ${uploaded} file(s), ${(sentBytes / 1024 / 1024).toFixed(1)} MB.`);

// ── Commit: verify + prune + merge games.json ─────────────────────────────────
const commit = await (
	await send(
		`${launcherOrigin}/api/launcher/game-upload?key=${encodeURIComponent(gameKey)}`,
		{
			method: 'POST',
			headers: { ...auth, 'content-type': 'application/json' },
			body: JSON.stringify({ name, protocol, files: rels }),
		},
		{ label: 'commit' },
	)
).json();
console.info(
	`Registered '${gameKey}' in test_server/games.json ` +
		`(${commit.files} file(s)${commit.pruned ? `, pruned ${commit.pruned} stale` : ''}).`,
);

// ── Portal card + project pin + edge purge ────────────────────────────────────
// Exactly what the desktop launcher does after its own upload: this is what makes the game appear
// in the portal's Games section, re-stamps the project pointer onto the manifest entry (so the
// mock deals THIS project's math and not its default board) and purges the game's edge cache.
const host = gamesOrigin.split('://', 1).pop();
const playUrl =
	`${gamesOrigin}/${gameKey}/?sessionID=demo&rgs_url=${host}/api/${gameKey}` +
	`&lang=en&currency=USD&device=desktop`;

if (register) {
	const res = await send(
		`${launcherOrigin}/api/launcher/register-game`,
		{
			method: 'POST',
			headers: { ...auth, 'content-type': 'application/json' },
			body: JSON.stringify({ key: gameKey, name, url: playUrl, project: projectKey }),
		},
		{ label: 'register-game' },
	);
	const body = await res.json();
	const pin = body.pin?.status ?? 'unknown';
	console.info(`Portal card upserted (project '${projectKey}', pin: ${pin}).`);
	if (pin === 'skipped' || pin === 'error') {
		console.warn(
			`  ⚠ The project pin did not land (${body.pin?.error ?? 'no detail'}). The game will deal ` +
				`the mock's DEFAULT board until it does — re-run this, or publish again from the launcher.`,
		);
	}
} else {
	console.info('--no-register: skipped the portal card, project pin and cache purge.');
}

console.info(`\nPlay: ${playUrl}`);
