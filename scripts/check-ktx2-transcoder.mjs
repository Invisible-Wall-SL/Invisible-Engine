// check:ktx2-transcoder — the KTX2 transcoder ships as real files that every build finds, and a
// compressed texture that cannot load falls back to its WebP/PNG twin.
//
//   pnpm check:ktx2-transcoder                 builds three variants of apps/lines, then checks each
//   pnpm check:ktx2-transcoder --skip-build    re-checks the builds a previous `--out` kept
//   pnpm check:ktx2-transcoder --out <dir>     where the builds go (default: a temp dir, removed)
//
// Minutes (three full builds + Chromium), so NOT in Lint and skipped by `check:all`, like
// `check:family-runtimes`. Uses the machine's pre-installed Playwright + Chromium, resolved through
// `NODE_PATH` (`require('playwright')`), as the playtester does.
//
// WHY. `libktx.{js,wasm}` (~520 KB gz) used to be inlined as base64 into every build, so every
// desktop downloaded a transcoder only phones use. Emitted as files, their url is the hazard: an
// inline build resolved it against the page's folder (`<page>/assets/…`) instead of the bundle's
// (`<page>/_app/immutable/assets/…`), which only a phone on the compressed tier would ever request.
// So this boots each shape of build the way it is really served, with `?quality=low` forcing the
// compressed tier, and proves the transcoder loads from `_app/immutable/assets/` and transcodes a
// `.ktx2`; then breaks it four ways (both transcoder files blocked; only the wasm blocked, which
// used to hang every load; the wasm never answering; the `.ktx2` itself 404ing) and proves the
// art arrives anyway, as its WebP/PNG twin, with one retry of the transcoder and one warning; and
// that `?quality=high` never requests the transcoder at all:
//
//   runtime  the shared online runtime, served by the REAL test server (`TEST_SERVER_LOCAL`) under
//            `/<gameKey>/` from a versioned `_runtime/lines@<v>/` release, as production does. A
//            desktop ☁ Publish build is served the same way (`/<gameKey>/`, its own files).
//   inline   a delivery built the default (inline) way, dropped into a nested folder of a host.
//   embed    a `bundleStrategy: 'single'` delivery (`game.js`) on a separate CDN origin, included
//            by an operator page on another origin.
//
// The texture comes from a stub `/api/editor/runtime` (`?runtime=1`): one image and one sheet, each
// with a `.ktx2` twin, so it goes through the game's own registration (`bakedEditorArtAssets`) and
// `AssetsLoader`, not a test-only path.

import { spawn, spawnSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
	const i = process.argv.indexOf(name);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const skipBuild = process.argv.includes('--skip-build');
const keptOut = arg('--out', '');
if (skipBuild && !keptOut)
	throw new Error('--skip-build needs the --out <dir> a previous run kept');
const OUT = keptOut ? resolve(keptOut) : mkdtempSync(join(tmpdir(), 'ie-ktx2-transcoder-'));

/** A 16×16 PNG and its UASTC `.ktx2` twin (243 B), encoded the way `ktx2Encode.ts` encodes. */
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAKElEQVQ4jWP4/9/hPz7MQBD/HzXg/zAIAwaH//gwAyH8f9QAhqEfBgAW6T4fhhBJawAAAABJRU5ErkJggg==',
	'base64',
);
const KTX2 = Buffer.from(
	'q0tUWCAyMLsNChoKAAAAAAEAAAAQAAAAEAAAAAAAAAAAAAAAAQAAAAEAAAACAAAAaAAAACwAAACUAAAAJAAAAAAAAAAAAAAAAAAAAAAAAAC4AAAAAAAAADsAAAAAAAAAAAEAAAAAAAAsAAAAAAAAAAIAKACmAQIAAwMAABAAAAAAAAAAAAB/AAAAAAAAAAAA/////x8AAABLVFh3cml0ZXIAQmFzaXMgVW5pdmVyc2FsIDIuNTAAACi1L/1gAACNAQDo9/8f6N98bwAX4B/oPwIfAR8A6D/6ABcAAOifAUAHAAUSAIuZWcoDlgAAeSYKBOAC',
	'base64',
);
const sheet = (image) =>
	JSON.stringify({
		frames: { probe: { frame: { x: 0, y: 0, w: 16, h: 16 }, sourceSize: { w: 16, h: 16 } } },
		meta: { image, size: { w: 16, h: 16 }, scale: 1 },
	});
const FIXTURES = {
	'probe.png': PNG,
	'probe.ktx2': KTX2,
	'probe-page.png': PNG,
	'probe-page.ktx2': KTX2,
	'probe-sheet.json': sheet('probe-page.png'),
	'probe-sheet.ktx2.json': sheet('probe-page.ktx2'),
};
const COMPRESSED = ['probe.ktx2', 'probe-page.ktx2'];
const TWINS = ['probe.png', 'probe-page.png'];

const BUILDS = [
	{
		id: 'runtime',
		script: 'build',
		env: {
			PUBLIC_RGS_TRANSPORT: 'play4fun',
			PUBLIC_DELIVERY_PROFILES: '*',
			PUBLIC_IE_FAMILIES: 'slot',
		},
	},
	{
		id: 'inline',
		script: 'build',
		env: { PUBLIC_RGS_TRANSPORT: 'play4fun', PUBLIC_DELIVERY_PROFILE: '2complex' },
	},
	{
		id: 'embed',
		script: 'build:embed',
		env: {
			PUBLIC_DELIVERY_EMBED: '1',
			PUBLIC_RGS_TRANSPORT: 'play4fun',
			PUBLIC_DELIVERY_PROFILE: 'operator-embed',
		},
	},
];

const run = (args, env = {}) => {
	const r = spawnSync('pnpm', args, {
		cwd: ROOT,
		env: { ...process.env, ...env },
		stdio: ['ignore', 'inherit', 'inherit'],
		shell: process.platform === 'win32',
	});
	if (r.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed (exit ${r.status})`);
};

if (!skipBuild) {
	run(['--filter', 'lines^...', 'build']);
	for (const { id, script, env } of BUILDS) {
		run(['--filter', 'lines', script], env);
		rmSync(join(OUT, id), { recursive: true, force: true });
		cpSync(join(ROOT, 'apps/lines/build'), join(OUT, id), { recursive: true });
	}
}
for (const { id } of BUILDS) {
	if (!existsSync(join(OUT, id)))
		throw new Error(`no ${id} build in ${OUT} — run without --skip-build`);
}

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

/** Every path a stub server answered, so worker-side fetches (the `.ktx2` itself) are seen too. */
const served = [];

/** A static server for `mounts` (`url prefix → dir`) plus `routes` (`path → body`), CORS-open. */
const startServer = (mounts, routes = {}) =>
	new Promise((resolveServer) => {
		const server = createServer((req, res) => {
			const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
			const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
			const route = routes[path];
			if (route) {
				served.push(path);
				res.writeHead(200, {
					...headers,
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
				served.push(path);
				res.writeHead(200, {
					...headers,
					'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
				});
				return res.end(readFileSync(file));
			}
			res.writeHead(404, headers);
			res.end('not found');
		});
		server.listen(0, '127.0.0.1', () => resolveServer(server));
	});
const originOf = (server) => `http://127.0.0.1:${server.address().port}`;

// The stub launcher: the runtime bundle and the art it names.
const launcherRoutes = {};
const launcher = await startServer({}, launcherRoutes);
const LAUNCHER = originOf(launcher);
launcherRoutes['/api/editor/runtime'] = JSON.stringify({
	assetBase: `${LAUNCHER}/f/`,
	name: 'KTX2 transcoder probe',
	doc: { scenes: [{ id: 'basegame', name: 'Base game', nodes: [] }] },
	editorArt: {
		sheets: [{ key: 'probe-sheet', json: 'probe-sheet.json', ktx2Json: 'probe-sheet.ktx2.json' }],
		images: [{ key: 'probe/image', file: 'probe.png', ktx2: 'probe.ktx2' }],
	},
});
for (const [name, body] of Object.entries(FIXTURES)) launcherRoutes[`/f/${name}`] = body;

// The real test server, hydrating a versioned runtime release from a local directory.
const GAME = 'ktx2probe';
const local = join(OUT, 'test-server');
rmSync(local, { recursive: true, force: true });
mkdirSync(join(local, '_runtime/lines'), { recursive: true });
cpSync(join(OUT, 'runtime'), join(local, '_runtime/lines@probe'), { recursive: true });
writeFileSync(join(local, '_runtime/lines/current.json'), JSON.stringify({ version: 'probe' }));
writeFileSync(
	join(local, 'games.json'),
	JSON.stringify({
		games: { [GAME]: { name: 'KTX2 probe', protocol: 'lines', runtime: 'lines' } },
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
for (let i = 0; ; i++) {
	const page = await fetch(`${TEST_SERVER}/${GAME}/index.html`).then(
		(r) => r.status,
		() => 0,
	);
	if (page === 200) break;
	if (i > 60) throw new Error(`test server never served ${GAME}:\n${testServerLog}`);
	await new Promise((r) => setTimeout(r, 500));
}

// The inline delivery in a nested folder of some host; the embed on a CDN origin + an operator page.
const host = await startServer({ '/casino/games/probe/': join(OUT, 'inline') });
const cdn = await startServer({ '/brand/games/v1/Probe/': join(OUT, 'embed') });
const operator = await startServer(
	{},
	{
		'/operator/':
			`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">` +
			`<div id="game" style="width:100vw;height:100vh"></div>` +
			`<script src="${originOf(cdn)}/brand/games/v1/Probe/game.js"></script></body></html>`,
	},
);

const query = (extra) =>
	`?runtime=1&project=probe&k=probe&editorDocBase=${encodeURIComponent(LAUNCHER)}` +
	`&lang=en${extra}`;
const MOCK_RGS = `${TEST_SERVER}/api/${GAME}`;
const TARGETS = [
	{
		id: 'runtime',
		url: `${TEST_SERVER}/${GAME}/${query(`&sessionID=demo&rgs_url=${encodeURIComponent(MOCK_RGS)}`)}`,
		assets: `${TEST_SERVER}/${GAME}/_app/immutable/assets/`,
	},
	{
		id: 'inline',
		url: `${originOf(host)}/casino/games/probe/index.html${query('&sid=probe')}`,
		assets: `${originOf(host)}/casino/games/probe/_app/immutable/assets/`,
	},
	{
		id: 'embed',
		url: `${originOf(operator)}/operator/${query('&sid=probe')}`,
		assets: `${originOf(cdn)}/brand/games/v1/Probe/_app/immutable/assets/`,
	},
];

const RGS_PATHS = ['https://gs.2-complex.science', `${originOf(operator)}/webnode/`];
const CORS = {
	'access-control-allow-origin': '*',
	'access-control-allow-headers': '*',
	'access-control-allow-methods': '*',
};
const answerRgs = async (route, path) => {
	if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
	const response = await route.fetch({ url: `${MOCK_RGS}${path}` });
	return route.fulfill({ response, headers: { ...response.headers(), ...CORS } });
};

/** `breaks` aborts the transcoder files that match; `missing` 404s the `.ktx2` textures themselves,
 *  which fails inside Pixi's worker rather than in the transcoder check. */
const MODES = [
	{ id: 'transcoder ok' },
	{ id: 'transcoder blocked', breaks: /\/libktx\.[^/]+\.(js|wasm)$/ },
	{ id: 'wasm blocked', breaks: /\/libktx\.[^/]+\.wasm$/ },
	// Never answered: the production fetch timeout (30 s) runs out twice (one retry), so this mode
	// costs about a minute a target.
	{ id: 'wasm stalls', stalls: /\/libktx\.[^/]+\.wasm$/ },
	{ id: '.ktx2 missing', missing: true },
	{ id: 'quality=high', quality: 'high' },
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

const LOCAL_ORIGINS = [LAUNCHER, TEST_SERVER, originOf(host), originOf(cdn), originOf(operator)];
let failures = 0;
const check = (label, ok, detail = '') => {
	console.log(`  ${ok ? '[ok]  ' : 'FAIL  '}${label}${ok || !detail ? '' : `\n        ${detail}`}`);
	if (!ok) failures++;
};

const fixtureServed = (name) => served.includes(`/f/${name}`);
const waitFor = async (condition, ms) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (condition()) return true;
		await new Promise((r) => setTimeout(r, 250));
	}
	return condition();
};

try {
	for (const target of TARGETS) {
		for (const mode of MODES) {
			console.log(`\n${target.id} — ${mode.id}`);
			served.length = 0;
			for (const name of COMPRESSED) {
				if (mode.missing) delete launcherRoutes[`/f/${name}`];
				else launcherRoutes[`/f/${name}`] = FIXTURES[name];
			}
			const uncompressed = mode.quality === 'high';
			const broken = Boolean(mode.breaks || mode.stalls);
			const fallback = broken || Boolean(mode.missing);
			const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
			const page = await context.newPage();
			const transcoder = [];
			const warnings = [];
			const errors = [];
			page.on('console', (msg) => {
				if (msg.type() === 'warning' && msg.text().startsWith('[ktx2]')) warnings.push(msg.text());
				if (msg.type() === 'error') errors.push(msg.text());
			});
			page.on('pageerror', (error) => errors.push(String(error)));
			await context.route('**/*', (route) => {
				const url = route.request().url();
				if (/\/libktx\.[^/]+\.(js|wasm)$/.test(url)) {
					transcoder.push(url);
					if (mode.breaks?.test(url)) return route.abort();
					if (mode.stalls?.test(url)) return;
				}
				// The delivery's RGS — the partner's node (inline) or the operator page's own origin
				// (embed) — is answered by the test server's mock, so the game boots without the
				// connection retries an unreachable RGS costs.
				const rgs = RGS_PATHS.find((prefix) => url.startsWith(prefix));
				if (rgs) return answerRgs(route, url.slice(rgs.length));
				// Nothing else leaves the machine: Typekit, the real launcher.
				if (
					!url.startsWith('blob:') &&
					!url.startsWith('data:') &&
					!LOCAL_ORIGINS.some((o) => url.startsWith(o))
				)
					return route.abort();
				return route.continue();
			});
			await page.goto(`${target.url}&quality=${mode.quality ?? 'low'}`, {
				waitUntil: 'domcontentloaded',
			});

			const want = fallback || uncompressed ? TWINS : COMPRESSED;
			const arrived = await waitFor(
				() => want.every(fixtureServed),
				mode.stalls ? 150_000 : 90_000,
			);
			await page.waitForTimeout(2_000);
			const probeErrors = errors.filter(
				(e) => /\/f\/probe|ktx|transcod/i.test(e) && !e.startsWith('Failed to load resource'),
			);

			const servedList = `served: ${served.join(', ')}`;
			if (uncompressed) {
				check(
					'the uncompressed tier never requests the transcoder',
					transcoder.length === 0,
					transcoder.join(', '),
				);
				check('both WebP/PNG pages loaded', arrived, servedList);
				check('no .ktx2 was requested', !COMPRESSED.some(fixtureServed), servedList);
				check('no fallback warning', warnings.length === 0, warnings.join(' | '));
			} else {
				check(
					"the transcoder is requested from the build's _app/immutable/assets/",
					transcoder.length >= 2 && transcoder.every((u) => u.startsWith(target.assets)),
					`requested: ${transcoder.join(', ') || 'nothing'} (expected under ${target.assets})`,
				);
				check(
					broken ? 'the failed transcoder was retried once' : 'the transcoder was fetched once',
					transcoder.length === (broken ? 4 : 2),
					`requested ${transcoder.length}: ${transcoder.join(', ')}`,
				);
				if (fallback) {
					check('both WebP/PNG twins loaded instead', arrived, servedList);
					check(
						'exactly one fallback warning',
						warnings.length === 1,
						warnings.join(' | ') || 'none',
					);
				} else {
					check('both .ktx2 textures were fetched and transcoded', arrived, servedList);
					check('no WebP/PNG twin was needed', !TWINS.some(fixtureServed), servedList);
					check('no fallback warning', warnings.length === 0, warnings.join(' | '));
				}
			}
			check('no texture load error', probeErrors.length === 0, probeErrors.join(' | '));
			await context.close();
		}
	}
} finally {
	await browser.close();
	testServer.kill();
	for (const server of [launcher, host, cdn, operator]) server.close();
	if (!keptOut) rmSync(OUT, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
