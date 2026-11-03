// check:runtime-shell — a game build is a small `index.html` shell plus an immutable, content-hashed
// ES-module bundle, and every place we serve one boots it, loads each chunk from the right URL and,
// on a repeat visit, downloads no code but the shell.
//
//   pnpm check:runtime-shell                 builds three variants of apps/lines, then checks each
//   pnpm check:runtime-shell --skip-build    re-checks the builds a previous `--out` kept
//   pnpm check:runtime-shell --out <dir>     where the builds go (default: a temp dir, removed)
//
// The builds are `lib/game-build-variants.mjs`'s, so `pnpm check:ktx2-transcoder --out <dir>` then
// `pnpm check:runtime-shell --skip-build --out <dir>` builds once for both. Minutes (three full
// builds + Chromium), so NOT in Lint and skipped by `check:all`, like `check:ktx2-transcoder`. Uses
// the machine's pre-installed Playwright + Chromium, resolved through `NODE_PATH`.
//
// WHY. The runtime page is served `no-store`, and until 2026-11 it carried the whole ~700 KB gz
// bundle inline, so every visit downloaded all of it again. Split, the bundle and its chunks are
// `_app/immutable/` files a browser keeps for a year — which only pays if every host serves them
// that way, every chunk resolves wherever the build sits, and lazy chunks really are lazy:
//
//   runtime  the shared online runtime, served by the REAL test server (`TEST_SERVER_LOCAL`) under
//            `/<gameKey>/` from a versioned `_runtime/lines@<v>/` release, as production does; its
//            Sentry SDK is a lazy chunk (the build carries a stand-in DSN). Then a ROLLOUT: the
//            pointer moves to a release without that chunk, and the old release's chunk is still
//            served (immutable) for a page loaded before the flip, for one generation only.
//   desktop  the same build as a desktop ☁ Publish puts it: the test server's per-game files; then
//            two republishes, the first publish's chunk served after the first only.
//   inline   a delivery in a nested folder of some host that caches `_app/immutable/` and not the
//            page, as `docs/INFRA.md` asks of a host; no `telemetry.errors`, so no SDK request.
//   embed    the one-file embed delivery: `game.js` on a separate CDN origin, included by an
//            operator page on another origin. One bundle, no chunks.
//   arcade   the `arcade` runtime booting an ONLINE game: the boot imports the family's online
//            chunk (`engine-rooms`) from the build's own folder before joining a room. The room
//            server is a closed port, so the join fails onto the error screen after the import —
//            enough to prove the chunk's URL without running a room server.
//
// Each is visited twice in one browser context. Cold: the page boots (a canvas in the container,
// no page error), every `_app/immutable/` request is answered 200 from under the build's own folder
// with `immutable` caching, and a boot loads exactly the files `check:family-runtimes` counts as a
// first visit (plus the SDK, lazily). Warm: the shell is fetched again and every `_app/immutable/` file comes
// from the browser's cache. Nothing intercepts requests (Playwright routing turns the HTTP cache
// off); RGS and launcher calls go to local stubs by URL.

import { spawn } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { firstVisit } from './lib/build-chunks.mjs';
import { ROOT, assertVariants, buildVariants } from './lib/game-build-variants.mjs';
import { debugIdOf } from './sentry-sourcemaps.mjs';

const arg = (name, fallback) => {
	const i = process.argv.indexOf(name);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const skipBuild = process.argv.includes('--skip-build');
const keptOut = arg('--out', '');
if (skipBuild && !keptOut)
	throw new Error('--skip-build needs the --out <dir> a previous run kept');
const OUT = keptOut ? resolve(keptOut) : mkdtempSync(join(tmpdir(), 'ie-runtime-shell-'));

if (!skipBuild) buildVariants(OUT);
assertVariants(OUT);

const IMMUTABLE = 'public, max-age=31536000, immutable';
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.wasm': 'application/wasm',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.gif': 'image/gif',
};

/** The files of a build under `_app/immutable/`, relative to it. */
const immutableFiles = (dir) =>
	readdirSync(join(dir, '_app/immutable'), { recursive: true })
		.map(String)
		.filter((f) => statSync(join(dir, '_app/immutable', f)).isFile())
		.map((f) => f.split(sep).join('/'));
const sentryChunkOf = (dir) =>
	immutableFiles(dir).find(
		(f) =>
			f.startsWith('chunks/') &&
			readFileSync(join(dir, '_app/immutable', f), 'utf8').includes('__SENTRY__'),
	);
const bundleOf = (dir) => immutableFiles(dir).find((f) => /^bundle\.[\w-]+\.js$/.test(f));

/**
 * A static host for `mounts` (`url prefix → dir`) and `routes` (`path → body | handler`), CORS-open.
 * `_app/immutable/` is cached as a host is asked to cache it; everything else is `no-store`.
 */
const startServer = (mounts, routes = {}) =>
	new Promise((resolveServer) => {
		const server = createServer((req, res) => {
			const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
			const cors = { 'Access-Control-Allow-Origin': '*' };
			const route =
				routes[path] ??
				Object.entries(routes).find(
					([p]) => p.endsWith('*') && path.startsWith(p.slice(0, -1)),
				)?.[1];
			if (typeof route === 'function') return route(req, res);
			if (route !== undefined) {
				res.writeHead(200, {
					...cors,
					'Cache-Control': 'no-store',
					'Content-Type': path.endsWith('/')
						? MIME['.html']
						: (MIME[extname(path)] ?? 'application/json'),
				});
				return res.end(route);
			}
			for (const [prefix, dir] of Object.entries(mounts)) {
				if (!path.startsWith(prefix)) continue;
				const rel = path.slice(prefix.length) || 'index.html';
				const file = normalize(join(dir, rel));
				if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) break;
				res.writeHead(200, {
					...cors,
					'Cache-Control': rel.startsWith('_app/immutable/') ? IMMUTABLE : 'no-store',
					'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
				});
				return res.end(readFileSync(file));
			}
			res.writeHead(404, { ...cors, 'Cache-Control': 'no-store' });
			res.end('not found');
		});
		server.listen(0, '127.0.0.1', () => resolveServer(server));
	});
const originOf = (server) => `http://127.0.0.1:${server.address().port}`;

// The stub launcher: a doc with no art, so the boot is the runtime's own and nothing else.
const launcher = await startServer(
	{},
	{
		'/api/editor/runtime': JSON.stringify({
			assetBase: 'http://127.0.0.1:9/f/',
			name: 'Runtime shell probe',
			doc: { scenes: [{ id: 'basegame', name: 'Base game', nodes: [] }] },
		}),
	},
);
const LAUNCHER = originOf(launcher);

// A second stub launcher: an ONLINE arcade game (the committed arcade rules sample + `arcade.online`),
// so the boot joins a room — and imports the family's online chunk — before it mounts. The room
// server is a closed port: the join fails onto the error screen, after the chunk has loaded.
const arcadeSample = JSON.parse(
	readFileSync(join(ROOT, 'apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json'), 'utf8'),
);
const onlineArcade = await startServer(
	{},
	{
		'/api/editor/runtime': JSON.stringify({
			assetBase: 'http://127.0.0.1:9/f/',
			name: 'Online arcade probe',
			doc: { scenes: [{ id: 'basegame', name: 'Base game', nodes: [] }] },
			config: {
				...arcadeSample,
				arcade: {
					...arcadeSample.arcade,
					field: { w: 1422, h: 800 },
					online: {
						characters: [{ id: 'salmon', body: 'arcadeSalmon', speed: 300 }],
						maxPlayers: 4,
						spawn: { x: 711, y: 720 },
					},
				},
			},
		}),
	},
);

// The real test server: two runtime releases (`a` = the build, `b` = the build without its Sentry
// chunk, i.e. a release where that chunk changed) and a desktop-published game with its own files.
const GAME = 'shellprobe';
const DESKTOP = 'shelldesktop';
const ARCADE = 'shellarcade';
const runtimeDir = join(OUT, 'runtime');
const SENTRY_CHUNK = sentryChunkOf(runtimeDir);
const local = join(OUT, 'test-server-shell');
rmSync(local, { recursive: true, force: true });
mkdirSync(join(local, '_runtime/lines'), { recursive: true });
mkdirSync(join(local, '_runtime/arcade'), { recursive: true });
cpSync(join(OUT, 'arcade'), join(local, '_runtime/arcade@a'), { recursive: true });
writeFileSync(join(local, '_runtime/arcade/current.json'), JSON.stringify({ version: 'a' }));
for (const version of ['a', 'b', 'c']) {
	cpSync(runtimeDir, join(local, `_runtime/lines@${version}`), { recursive: true });
	if (version !== 'a' && SENTRY_CHUNK)
		rmSync(join(local, `_runtime/lines@${version}/_app/immutable`, SENTRY_CHUNK));
}
cpSync(runtimeDir, join(local, DESKTOP), { recursive: true });
const point = (version) =>
	writeFileSync(join(local, '_runtime/lines/current.json'), JSON.stringify({ version }));
point('a');
writeFileSync(
	join(local, 'games.json'),
	JSON.stringify({
		games: {
			[GAME]: { name: 'Shell probe', protocol: 'lines', runtime: 'lines' },
			[DESKTOP]: { name: 'Shell probe (desktop)', protocol: 'lines' },
			[ARCADE]: { name: 'Online arcade probe', protocol: 'freePlay', runtime: 'arcade' },
		},
	}),
);

const freePort = () =>
	new Promise((resolvePort) => {
		const probe = createServer().listen(0, '127.0.0.1', () => {
			const { port } = probe.address();
			probe.close(() => resolvePort(port));
		});
	});
const testServerPort = await freePort();
const testServer = spawn(process.execPath, [join(ROOT, 'services/test-server/server.mjs')], {
	env: { ...process.env, PORT: String(testServerPort), TEST_SERVER_LOCAL: local },
	stdio: ['ignore', 'pipe', 'pipe'],
});
let testServerLog = '';
testServer.stdout.on('data', (d) => (testServerLog += d));
testServer.stderr.on('data', (d) => (testServerLog += d));
const TEST_SERVER = `http://127.0.0.1:${testServerPort}`;
const releaseServed = async () => {
	const res = await fetch(`${TEST_SERVER}/${GAME}/index.html?cb=${Date.now()}`).catch(() => null);
	return res?.ok ? res.headers.get('x-runtime-release') : null;
};
const waitForRelease = async (want) => {
	for (let i = 0; i < 120; i++) {
		if ((await releaseServed()) === want) return true;
		await new Promise((r) => setTimeout(r, 250));
	}
	return false;
};
if (!(await waitForRelease('lines@a')))
	throw new Error(`test server never served ${GAME}:\n${testServerLog}`);
const MOCK_RGS = `${TEST_SERVER}/api/${GAME}`;

/** Forward the operator page's same-origin RGS calls to the mock, as a partner's page would. */
const proxyRgs = (req, res) => {
	const body = [];
	req.on('data', (c) => body.push(c));
	req.on('end', async () => {
		const search = new URL(req.url, 'http://x').search;
		const answer = await fetch(`${MOCK_RGS}/rgs/engine${search}`, {
			method: req.method,
			body: req.method === 'POST' ? Buffer.concat(body) : undefined,
		});
		res.writeHead(answer.status, {
			'Content-Type': answer.headers.get('content-type') ?? 'text/plain',
		});
		res.end(Buffer.from(await answer.arrayBuffer()));
	});
};

const host = await startServer({ '/casino/games/probe/': join(OUT, 'inline') });
const cdn = await startServer({ '/brand/games/v1/Probe/': join(OUT, 'embed') });
const operator = await startServer(
	{},
	{
		'/operator/':
			`<!doctype html><html><head><meta charset="utf-8"><script>window.params={GameSettings:` +
			`{token:'probe',service:'webnode/engine',config:{}}};</script></head><body style="margin:0">` +
			`<div id="game" style="width:100vw;height:100vh"></div>` +
			`<script src="${originOf(cdn)}/brand/games/v1/Probe/game.js"></script></body></html>`,
		'/webnode/engine': proxyRgs,
	},
);

const query = (extra) =>
	`?runtime=1&project=probe&k=probe&editorDocBase=${encodeURIComponent(LAUNCHER)}&lang=en${extra}`;
const TARGETS = [
	{
		id: 'runtime',
		dir: runtimeDir,
		url: `${TEST_SERVER}/${GAME}/${query(`&sessionID=demo&rgs_url=${encodeURIComponent(MOCK_RGS)}`)}`,
		shell: `${TEST_SERVER}/${GAME}/`,
		base: `${TEST_SERVER}/${GAME}/_app/immutable/`,
		sentry: true,
	},
	{
		id: 'desktop',
		dir: runtimeDir,
		url: `${TEST_SERVER}/${DESKTOP}/${query(`&sessionID=demo&rgs_url=${encodeURIComponent(`${TEST_SERVER}/api/${DESKTOP}`)}`)}`,
		shell: `${TEST_SERVER}/${DESKTOP}/`,
		base: `${TEST_SERVER}/${DESKTOP}/_app/immutable/`,
		sentry: true,
	},
	{
		id: 'inline',
		dir: join(OUT, 'inline'),
		url: `${originOf(host)}/casino/games/probe/index.html${query(`&sid=probe&rgs_url=${encodeURIComponent(MOCK_RGS)}`)}`,
		shell: `${originOf(host)}/casino/games/probe/index.html`,
		base: `${originOf(host)}/casino/games/probe/_app/immutable/`,
		sentry: false,
	},
	{
		id: 'embed',
		dir: join(OUT, 'embed'),
		url: `${originOf(operator)}/operator/${query('&sid=probe')}`,
		shell: `${originOf(cdn)}/brand/games/v1/Probe/game.js`,
		base: `${originOf(cdn)}/brand/games/v1/Probe/_app/immutable/`,
		sentry: false,
		oneFile: true,
	},
];

const require = createRequire(import.meta.url);
let playwright;
try {
	playwright = require('playwright');
} catch {
	throw new Error(
		"Playwright not found: this uses the machine's pre-installed Playwright (resolved through " +
			'NODE_PATH, as the playtester does); it installs nothing.',
	);
}
const browser = await playwright.chromium.launch();

let failures = 0;
const check = (label, ok, detail = '') => {
	console.log(`  ${ok ? '[ok]  ' : 'FAIL  '}${label}${ok || !detail ? '' : `\n        ${detail}`}`);
	if (!ok) failures++;
};

/** Every request the page made, as the network layer saw it (`fromCache` = never left the browser). */
const recordNetwork = async (context, page) => {
	const cdp = await context.newCDPSession(page);
	await cdp.send('Network.enable');
	const byId = new Map();
	const log = [];
	cdp.on('Network.requestWillBeSent', ({ requestId, request, timestamp }) => {
		const entry = { url: request.url, at: timestamp, status: 0, fromCache: false, headers: {} };
		byId.set(requestId, entry);
		log.push(entry);
	});
	cdp.on('Network.requestServedFromCache', ({ requestId }) => {
		const entry = byId.get(requestId);
		if (entry) entry.fromCache = true;
	});
	cdp.on('Network.responseReceived', ({ requestId, response }) => {
		const entry = byId.get(requestId);
		if (!entry) return;
		entry.status = response.status;
		entry.headers = Object.fromEntries(
			Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), v]),
		);
		if (response.fromDiskCache || response.fromMemoryCache) entry.fromCache = true;
	});
	cdp.on('Network.loadingFailed', ({ requestId, errorText }) => {
		const entry = byId.get(requestId);
		if (entry) entry.failed = errorText;
	});
	return log;
};

const booted = async (page) => {
	const end = Date.now() + 90_000;
	while (Date.now() < end) {
		if (await page.evaluate(() => !!document.querySelector('canvas')).catch(() => false))
			return true;
		await page.waitForTimeout(250);
	}
	return false;
};

const visit = async (context, url) => {
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(String(error)));
	const log = await recordNetwork(context, page);
	await page.goto(url, { waitUntil: 'domcontentloaded' });
	const up = await booted(page);
	// Lazy chunks (the renderer, the SDK) land after the first frame; give them time to.
	await page.waitForTimeout(4_000);
	const debugIds = await page.evaluate(() => Object.values(window._sentryDebugIds ?? {}));
	return { page, errors, log, up, debugIds };
};

const rel = (target, url) => url.slice(target.base.length).split('?')[0];

try {
	for (const target of TARGETS) {
		console.log(`\n${target.id}`);
		const files = immutableFiles(target.dir);
		const bundle = bundleOf(target.dir);
		const sentryChunk = sentryChunkOf(target.dir);
		const shellText = readFileSync(
			join(target.dir, target.oneFile ? 'game.js' : 'index.html'),
			'utf8',
		);
		const context = await browser.newContext({ viewport: { width: 960, height: 540 } });

		const cold = await visit(context, target.url);
		const immutable = cold.log.filter((r) => r.url.includes('/_app/immutable/'));
		check(
			'the page boots (a canvas, no page error)',
			cold.up && cold.errors.length === 0,
			cold.errors.join(' | '),
		);
		check(
			'the shell is small and loads the bundle by URL',
			Buffer.byteLength(shellText) < 20_000 &&
				!!bundle &&
				shellText.includes(`_app/immutable/${bundle}`),
			`${Buffer.byteLength(shellText)} B, bundle ${bundle}`,
		);
		check(
			"every _app/immutable/ request is under the build's own folder and answered 200",
			immutable.length > 0 &&
				immutable.every((r) => r.url.startsWith(target.base) && r.status === 200),
			immutable
				.filter((r) => !r.url.startsWith(target.base) || r.status !== 200)
				.map((r) => `${r.status} ${r.url}`)
				.join(', '),
		);
		check(
			"nothing under the build's _app/ 404s",
			!cold.log.some(
				(r) => r.url.startsWith(target.base.replace(/immutable\/$/, '')) && r.status === 404,
			),
			cold.log
				.filter((r) => r.status === 404)
				.map((r) => r.url)
				.join(', '),
		);
		check(
			'every _app/immutable/ answer is cached immutable for a year',
			immutable.every((r) => r.headers['cache-control'] === IMMUTABLE),
			[...new Set(immutable.map((r) => r.headers['cache-control']))].join(' | '),
		);
		const shellRequest = cold.log.find((r) => r.url.split('?')[0] === target.shell);
		check(
			'the shell itself is not cached',
			/no-store/.test(shellRequest?.headers['cache-control'] ?? ''),
			shellRequest ? shellRequest.headers['cache-control'] : `no request for ${target.shell}`,
		);
		const loaded = immutable.map((r) => rel(target, r.url));
		const js = loaded.filter((f) => f.endsWith('.js') && !f.startsWith('assets/'));
		if (target.oneFile) {
			check(
				'one bundle, no chunk',
				js.length === 1 && js[0] === bundle && !files.some((f) => f.startsWith('chunks/')),
				js.join(', '),
			);
		} else {
			const measured = firstVisit(target.dir);
			check(
				'the shell loads what check:family-runtimes counts as a first visit',
				measured.eager.length > 0 && measured.eager.every((f) => loaded.includes(f)),
				`counted ${measured.eager.join(', ')}; loaded ${loaded.join(', ')}`,
			);
			const extra = loaded.filter((f) => !measured.eager.includes(f) && f !== sentryChunk);
			check(
				'a boot loads nothing check:family-runtimes does not count, but the Sentry SDK',
				extra.length === 0,
				`also loaded: ${extra.join(', ')}`,
			);
		}
		if (target.sentry) {
			const at = (f) => immutable.find((r) => rel(target, r.url) === f)?.at ?? Infinity;
			check(
				'the Sentry SDK is a lazy chunk: not in the shell, fetched after the bundle',
				!!sentryChunk &&
					!shellText.includes(sentryChunk) &&
					js.includes(sentryChunk) &&
					at(sentryChunk) > at(bundle),
				`chunk ${sentryChunk}, loaded ${js.join(', ')}`,
			);
			const bundleId = debugIdOf(readFileSync(join(target.dir, '_app/immutable', bundle), 'utf8'));
			check(
				'the bundle registered its debug ID (Sentry can name its map)',
				!!bundleId && cold.debugIds.includes(bundleId),
				`${bundleId} not in ${cold.debugIds.join(', ')}`,
			);
		} else if (!target.oneFile) {
			check(
				'a build that may not report never fetches the Sentry SDK',
				!!sentryChunk && !js.includes(sentryChunk),
				`chunk ${sentryChunk}, loaded ${js.join(', ')}`,
			);
		}
		await cold.page.close();

		const warm = await visit(context, target.url);
		const warmImmutable = warm.log.filter((r) => r.url.includes('/_app/immutable/'));
		const warmShell = warm.log.find((r) => r.url.split('?')[0] === target.shell);
		check(
			'repeat visit: the page boots again',
			warm.up && warm.errors.length === 0,
			warm.errors.join(' | '),
		);
		check(
			'repeat visit: the shell is downloaded again',
			!!warmShell && !warmShell.fromCache && warmShell.status === 200,
		);
		check(
			'repeat visit: every _app/immutable/ file comes from the browser cache',
			warmImmutable.length > 0 && warmImmutable.every((r) => r.fromCache),
			warmImmutable
				.filter((r) => !r.fromCache)
				.map((r) => r.url)
				.join(', '),
		);
		await warm.page.close();
		await context.close();
	}

	console.log('\narcade online boot');
	{
		const dir = join(OUT, 'arcade');
		const base = `${TEST_SERVER}/${ARCADE}/_app/immutable/`;
		const measured = firstVisit(dir, { onlineMarkers: ['joinOrCreate'] });
		const sentryChunk = sentryChunkOf(dir);
		const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (error) => errors.push(String(error)));
		const log = await recordNetwork(context, page);
		const url =
			`${TEST_SERVER}/${ARCADE}/?runtime=1&project=${ARCADE}&k=probe&lang=en` +
			`&editorDocBase=${encodeURIComponent(originOf(onlineArcade))}` +
			`&rooms_url=${encodeURIComponent('http://127.0.0.1:9')}&rooms_game=${ARCADE}`;
		await page.goto(url, { waitUntil: 'domcontentloaded' });
		const end = Date.now() + 60_000;
		const onlineLoaded = () =>
			measured.online.length > 0 &&
			measured.online.every((f) => log.some((r) => r.url.split('?')[0] === base + f && r.status));
		while (Date.now() < end && !onlineLoaded()) await page.waitForTimeout(250);
		await page.waitForTimeout(2_000);
		const immutable = log.filter((r) => r.url.includes('/_app/immutable/'));
		const loaded = immutable.map((r) => r.url.split('?')[0].slice(base.length));
		check(
			'the build has an online chunk, not in the bundle',
			measured.online.length > 0,
			`lazy: ${measured.lazy.join(', ')}`,
		);
		check(
			"the online boot fetches it from the build's own folder, 200, immutable",
			onlineLoaded() &&
				immutable.every(
					(r) =>
						r.url.startsWith(base) && r.status === 200 && r.headers['cache-control'] === IMMUTABLE,
				),
			immutable.map((r) => `${r.status} ${r.url}`).join(', '),
		);
		const extra = loaded.filter(
			(f) => !measured.eager.includes(f) && !measured.online.includes(f) && f !== sentryChunk,
		);
		check(
			'it loads nothing check:family-runtimes does not count as an online boot, but the SDK',
			extra.length === 0,
			`also loaded: ${extra.join(', ')}`,
		);
		check('no page error', errors.length === 0, errors.join(' | '));
		await context.close();
	}

	console.log('\nruntime rollout (pointer a → b → c)');
	if (!SENTRY_CHUNK) check('the runtime build has a Sentry chunk to roll out', false);
	else {
		const chunkUrl = `${TEST_SERVER}/${GAME}/_app/immutable/${SENTRY_CHUNK}`;
		const flip = async (version) => {
			point(version);
			await fetch(`${TEST_SERVER}/refresh`, { method: 'POST' });
			return waitForRelease(`lines@${version}`);
		};
		check('the pointer moves to b', await flip('b'));
		const kept = await fetch(chunkUrl);
		check(
			'a chunk only the previous release has is still served, immutable, after the flip',
			kept.status === 200 && kept.headers.get('cache-control') === IMMUTABLE,
			`HTTP ${kept.status} ${kept.headers.get('cache-control')}`,
		);
		check('the pointer moves to c', await flip('c'));
		const gone = await fetch(chunkUrl);
		check('…and only for one generation', gone.status === 404, `HTTP ${gone.status}`);

		console.log("\ndesktop republish (the game's own files change twice)");
		const desktopFiles = join(local, DESKTOP, '_app/immutable');
		const other = immutableFiles(join(local, DESKTOP)).find(
			(f) => f.startsWith('chunks/') && f !== SENTRY_CHUNK,
		);
		const republish = async (n, removed) => {
			rmSync(join(desktopFiles, removed));
			const page = join(local, DESKTOP, 'index.html');
			writeFileSync(page, `${readFileSync(page, 'utf8')}<!-- republish ${n} -->`);
			await fetch(`${TEST_SERVER}/refresh`, { method: 'POST' });
			for (let i = 0; i < 120; i++) {
				const html = await fetch(`${TEST_SERVER}/${DESKTOP}/index.html?cb=${Date.now()}`).then(
					(r) => r.text(),
					() => '',
				);
				if (html.includes(`<!-- republish ${n} -->`)) return true;
				await new Promise((r) => setTimeout(r, 250));
			}
			return false;
		};
		const desktopChunk = (f) => fetch(`${TEST_SERVER}/${DESKTOP}/_app/immutable/${f}`);
		check('a republish without the Sentry chunk is live', await republish(1, SENTRY_CHUNK));
		const keptDesktop = await desktopChunk(SENTRY_CHUNK);
		check(
			"the previous publish's chunk is still served, immutable",
			keptDesktop.status === 200 && keptDesktop.headers.get('cache-control') === IMMUTABLE,
			`HTTP ${keptDesktop.status} ${keptDesktop.headers.get('cache-control')}`,
		);
		check(`a second republish (without ${other}) is live`, await republish(2, other));
		check(
			'…and only for one generation',
			(await desktopChunk(SENTRY_CHUNK)).status === 404 &&
				(await desktopChunk(other)).status === 200,
		);
	}
} finally {
	await browser.close();
	testServer.kill();
	for (const server of [launcher, onlineArcade, host, cdn, operator]) server.close();
	if (!keptOut) rmSync(OUT, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
