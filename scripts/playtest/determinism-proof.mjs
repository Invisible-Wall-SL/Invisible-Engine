// Determinism proof for the runtime's test-only clock + seed hook (`?ie_determinism=<seed>`,
// apps/lines/src/game/determinism.ts; docs/status/engine.md "Determinism mode").
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
//     scripts/playtest/determinism-proof.mjs [--build apps/lines/build] [--runs 2] [--seed proof]
//     [--scenario book-base,book-line,book-big,hw-classic] [--draw every|last] [--flag on|off]
//     [--out <dir>] [--chrome <exe>]
//
// Each run boots the BUILT runtime (`pnpm --filter lines build`) against a FRESH mock started with
// a fixed `SEED`, so every run is dealt the same books. It drives the game over CDP with the page's
// `window.__IE_DETERMINISM__` (step N frames, wait for a screen to be idle), captures key screens
// at 1280×720, DPR 1, time zone UTC and locale en-US, and compares run 1 with every later run pixel
// by pixel. Exit 1 on any difference. `--draw last` draws only the last frame of each step (the
// API's fast mode; software GL spends ~99% of a frame drawing). `--flag off` boots without the flag
// and checks that the hook is absent and the game boots and spins on the real clock (real-clock
// captures are not comparable).
//
// Scenarios:
//   book-base   boot → base-game idle, then one losing spin (mock SEED=loss): mid-spin and settled
//   book-line   the first winning spin of the seed: its line-win presentation and the settled board
//   book-big    `BIG_WIN=1`: the big-win presentation at fixed frames into it, then settled
//   hw-classic  Hold and Win, Classic preset, forced `trigger`: the feature screen and its end
//
// Needs the headless shell (headless-shell.mjs). Writes PNGs + summary.json to --out.

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { inflateSync } from 'node:zlib';

import { headlessShell, spawnHeadlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		build: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		runs: { type: 'string', default: '2' },
		seed: { type: 'string', default: 'proof' },
		scenario: { type: 'string', default: 'book-base,book-line,book-big,hw-classic' },
		flag: { type: 'string', default: 'on' },
		draw: { type: 'string', default: 'every' },
		out: { type: 'string' },
		chrome: { type: 'string' },
	},
});

const W = 1280;
const H = 720;
const SEED = opt.seed;
const FLAG_ON = opt.flag !== 'off';
const DRAW = opt.draw === 'last' ? 'last' : 'every';
const RUNS = FLAG_ON ? Number(opt.runs) : 1;
const OUT =
	opt.out ?? join(tmpdir(), `ie-determinism-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const CHROME = headlessShell(opt.chrome);
mkdirSync(OUT, { recursive: true });

const log = (...parts) =>
	console.log(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- servers ----------

const TYPES = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.atlas': 'text/plain',
	'.ktx2': 'application/octet-stream',
	'.mp3': 'audio/mpeg',
	'.ogg': 'audio/ogg',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.fnt': 'text/plain',
};
const listen = (server) =>
	new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));

/** The build, as a static host serves it (adapter-static, index.html fallback). */
const serveBuild = (dir) =>
	createServer((req, res) => {
		const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		let file = join(dir, path);
		if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory())
			file = join(dir, 'index.html');
		res.writeHead(200, {
			'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
			'Access-Control-Allow-Origin': '*',
		});
		createReadStream(file).pipe(res);
	});

/** `/api/editor/runtime` for a local Hold and Win project: the reference layout + a preset. */
const serveHoldAndWinRuntime = async (preset, assetBase) => {
	const { holdAndWinReferenceLayout } =
		await import('../../packages/engine-layout/src/lib/referenceLayouts/holdAndWin.ts');
	const { HOLD_AND_WIN_PRESETS } =
		await import('../../packages/game-config/src/holdAndWinPresets.ts');
	const { normalizeGameConfigDoc } = await import('../../packages/game-config/src/normalize.ts');
	const body = JSON.stringify({
		assetBase,
		doc: holdAndWinReferenceLayout(),
		config: normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS[preset]),
	});
	return createServer((req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
		res.end(body);
	});
};

const freePort = async () => {
	const server = createServer();
	const port = await listen(server);
	await new Promise((ok) => server.close(ok));
	return port;
};

/** A fresh mock process per run, so the seeded deal starts over. */
const startMock = async (script, env) => {
	const port = await freePort();
	const args = script.endsWith('holdandwin.mjs')
		? ['--experimental-strip-types', '--import', './scripts/ts-loader.mjs', script]
		: [script];
	const child = spawn(process.execPath, args, {
		cwd: ROOT,
		env: { ...process.env, PORT: String(port), SEED, ...env },
		stdio: ['ignore', 'ignore', 'pipe'],
	});
	let stderr = '';
	child.stderr.on('data', (c) => (stderr = (stderr + c).slice(-2000)));
	for (let i = 0; i < 100; i++) {
		const up = await fetch(`http://127.0.0.1:${port}/healthz`).then(
			(r) => r.ok,
			() => false,
		);
		if (up) return { port, stop: () => child.kill() };
		await sleep(100);
	}
	child.kill();
	throw new Error(`mock ${script} did not start: ${stderr}`);
};

// ---------- CDP ----------

const openBrowser = async (profile) => {
	const chrome = spawnHeadlessShell(CHROME, { profile, width: W, height: H });
	const pending = new Map();
	const consoleLines = [];
	let nextId = 1;
	let buf = Buffer.alloc(0);
	chrome.stdio[4].on('data', (chunk) => {
		buf = Buffer.concat([buf, chunk]);
		let end;
		while ((end = buf.indexOf(0)) >= 0) {
			const msg = JSON.parse(buf.subarray(0, end).toString('utf8'));
			buf = buf.subarray(end + 1);
			if (msg.id && pending.has(msg.id)) {
				pending.get(msg.id)(msg);
				pending.delete(msg.id);
			} else if (msg.method === 'Runtime.exceptionThrown') {
				const d = msg.params.exceptionDetails;
				consoleLines.push(`[exception] ${d.exception?.description ?? d.text}`);
			} else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
				consoleLines.push(
					`[error] ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`,
				);
			}
		}
	});
	const send = (method, params = {}, sessionId) =>
		new Promise((ok) => {
			const id = nextId++;
			pending.set(id, ok);
			chrome.stdio[3].write(
				`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`,
			);
		});
	const { result: created } = await send('Target.createTarget', { url: 'about:blank' });
	const { result: attached } = await send('Target.attachToTarget', {
		targetId: created.targetId,
		flatten: true,
	});
	const page = (method, params) => send(method, params, attached.sessionId);
	await page('Runtime.enable');
	await page('Page.enable');
	await page('Emulation.setDeviceMetricsOverride', {
		width: W,
		height: H,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await page('Emulation.setFocusEmulationEnabled', { enabled: true });
	// The HUD clock formats in the browser's zone and locale: pin both, so machines agree.
	await page('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
	await page('Emulation.setLocaleOverride', { locale: 'en-US' });
	const evaluate = async (expression) => {
		const { result, error } = await page('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (error) throw new Error(error.message);
		if (result.exceptionDetails)
			throw new Error(
				result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
			);
		return result.result.value;
	};
	return { chrome, page, evaluate, consoleLines, close: () => chrome.kill() };
};

// ---------- PNG → RGBA (8-bit, non-interlaced: what Chromium writes) ----------

const decodePng = (png) => {
	let width = 0;
	let height = 0;
	let colorType = 0;
	const idat = [];
	for (let at = 8; at < png.length;) {
		const len = png.readUInt32BE(at);
		const type = png.toString('ascii', at + 4, at + 8);
		const data = png.subarray(at + 8, at + 8 + len);
		if (type === 'IHDR') {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			colorType = data[9];
		} else if (type === 'IDAT') idat.push(data);
		at += 12 + len;
	}
	const bpp = colorType === 6 ? 4 : 3;
	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * bpp;
	const out = Buffer.alloc(width * height * 4);
	const prev = Buffer.alloc(stride);
	const line = Buffer.alloc(stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		raw.copy(line, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
		for (let x = 0; x < stride; x++) {
			const a = x >= bpp ? line[x - bpp] : 0;
			const b = prev[x];
			const c = x >= bpp ? prev[x - bpp] : 0;
			let v = line[x];
			if (filter === 1) v += a;
			else if (filter === 2) v += b;
			else if (filter === 3) v += (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - b);
				const pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			line[x] = v & 0xff;
		}
		line.copy(prev);
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4;
			out[o] = line[x * bpp];
			out[o + 1] = line[x * bpp + 1];
			out[o + 2] = line[x * bpp + 2];
			out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
		}
	}
	return { width, height, rgba: out };
};

const diffPixels = (a, b) => {
	const A = decodePng(a);
	const B = decodePng(b);
	if (A.width !== B.width || A.height !== B.height)
		return { differing: -1, total: A.width * A.height };
	let differing = 0;
	for (let i = 0; i < A.rgba.length; i += 4)
		if (A.rgba.readUInt32BE(i) !== B.rgba.readUInt32BE(i)) differing++;
	return { differing, total: A.width * A.height };
};

// ---------- scenarios ----------

const BOOK_MOCK = 'scripts/mock-rgs-server-book.mjs';
const HW_MOCK = 'scripts/mock-rgs-server-holdandwin.mjs';

/** The harness side of the ready signal. */
const driver = (browser, capture) => {
	const api = (call) => browser.evaluate(`window.__IE_DETERMINISM__.${call}`);
	const waitFor = async (condition, label) => {
		const r = await api(`waitFor(${JSON.stringify({ ...condition, draw: DRAW })})`);
		if (!r.ok)
			throw new Error(`${label}: not reached by frame ${r.frame} — ${JSON.stringify(r.state)}`);
		return r.frame;
	};
	const key = async (type) =>
		browser.page('Input.dispatchKeyEvent', {
			type,
			key: ' ',
			code: 'Space',
			windowsVirtualKeyCode: 32,
			nativeVirtualKeyCode: 32,
		});
	const step = (n) => api(`step(${n}, { draw: '${DRAW}' })`);
	return {
		api,
		waitFor,
		step,
		state: () => api('state()'),
		/** A Space tap two frames long — a spin from idle, a tap past a press-to-continue. */
		space: async () => {
			await key('keyDown');
			await step(2);
			await key('keyUp');
		},
		/** Step in `batch`-frame slices until `test(state)` holds; resolves with that state. */
		until: async (test, label, maxFrames = 3600, batch = 10) => {
			for (let ran = 0; ran <= maxFrames; ran += batch) {
				const s = await api('state()');
				if (test(s)) return s;
				await step(batch);
			}
			throw new Error(`${label}: not reached in ${maxFrames} frames`);
		},
		capture,
	};
};

// The tiers the coded ladder calls a BIG win (`winLevelMap`).
const BIG_TIERS = ['big', 'superwin', 'mega', 'epic', 'max'];
const isWin = (s) => s.win > 0;

const bootToIdle = async (d) => {
	await d.waitFor({ loaded: true, idle: true, maxFrames: 7200 }, 'boot');
	await d.step(30);
	await d.capture('loaded');
	// A tap-to-start loading screen still covers the board: tap it away.
	if (!(await d.state()).playerIn) await d.space();
	await d.waitFor(
		{ screen: 'basegame', inSet: true, playerIn: true, idle: true, maxFrames: 3600 },
		'player in',
	);
	await d.step(60);
	await d.capture('idle');
};

/** One spin; captures `mid` frames in, then the settled board. */
const spin = async (d, { mid = 20, name = 'spin' } = {}) => {
	await d.space();
	await d.waitFor({ idle: false, maxFrames: 600 }, `${name} start`);
	await d.step(mid);
	await d.capture(`${name}-mid`);
};

const settle = async (d, name, maxFrames = 7200) => {
	// A presentation that holds for a tap (a big win, a feature end) is tapped through, at the same
	// frames on every run.
	for (let ran = 0; ran < maxFrames; ran += 600) {
		const r = await d.api(`waitFor(${JSON.stringify({ idle: true, maxFrames: 600, draw: DRAW })})`);
		if (r.ok) break;
		await d.space();
	}
	await d.waitFor({ idle: true, maxFrames: 60 }, `${name} settle`);
	await d.step(60);
	await d.capture(`${name}-settled`);
};

const SCENARIOS = {
	'book-base': {
		mock: BOOK_MOCK,
		// This mock seed's first spin loses.
		env: { SEED: 'loss' },
		play: async (d) => {
			await bootToIdle(d);
			await spin(d, { mid: 20, name: 'base' });
			await settle(d, 'base');
		},
	},
	'book-line': {
		mock: BOOK_MOCK,
		env: {},
		play: async (d) => {
			await bootToIdle(d);
			// The seed's first winning spin (the same spin on every run): capture into its win.
			for (let n = 1; n <= 12; n++) {
				await d.space();
				await d.waitFor({ idle: false, maxFrames: 600 }, `spin ${n} start`);
				const s = await d.until((st) => st.idle || isWin(st), `spin ${n}`, 3600);
				if (!isWin(s)) continue;
				await d.capture(`line-spin${n}-win`);
				await d.step(45);
				await d.capture(`line-spin${n}-win+45`);
				await settle(d, 'line');
				return;
			}
			throw new Error('no winning spin in 12');
		},
	},
	'book-big': {
		mock: BOOK_MOCK,
		env: { BIG_WIN: '1' },
		play: async (d) => {
			await bootToIdle(d);
			await d.space();
			await d.waitFor({ idle: false, maxFrames: 600 }, 'big spin start');
			const s = await d.until((st) => BIG_TIERS.includes(st.winLevel), 'big win', 3600);
			await d.capture(`bigwin-${s.winLevel}`);
			await d.step(30);
			await d.capture('bigwin+30');
			await d.step(90);
			await d.capture('bigwin+120');
			await settle(d, 'bigwin');
		},
	},
	'hw-classic': {
		mock: HW_MOCK,
		env: { PRESET: 'classic', FORCE: 'trigger' },
		runtime: 'classic',
		play: async (d) => {
			await bootToIdle(d);
			await d.space();
			await d.waitFor({ idle: false, maxFrames: 600 }, 'trigger spin start');
			// The base spin lands and the feature intro follows; capture at fixed frames into it.
			await d.step(240);
			await d.capture('hw+240');
			await d.step(240);
			await d.capture('hw+480');
			await settle(d, 'hw', 36000);
		},
	},
};

// ---------- run ----------

const build = resolve(opt.build);
if (!existsSync(join(build, 'index.html'))) {
	console.error(`No build at ${build} — run \`pnpm --filter lines build\` first.`);
	process.exit(1);
}
const buildServer = serveBuild(build);
const buildPort = await listen(buildServer);
const origin = `http://127.0.0.1:${buildPort}`;

let flagOffGlobals;
const summary = {
	seed: SEED,
	flag: FLAG_ON ? 'on' : 'off',
	draw: DRAW,
	runs: RUNS,
	viewport: `${W}x${H}@1`,
	scenarios: {},
};
let failed = false;

for (const name of opt.scenario.split(',')) {
	const scenario = SCENARIOS[name];
	if (!scenario) throw new Error(`unknown scenario ${name}`);
	const runs = [];
	for (let run = 1; run <= RUNS; run++) {
		const mock = await startMock(scenario.mock, scenario.env);
		let runtimeServer;
		const params = new URLSearchParams({
			sessionID: `det-${name}-${run}`,
			rgs_url: `127.0.0.1:${mock.port}`,
			lang: 'en',
			currency: 'USD',
			device: 'desktop',
		});
		if (FLAG_ON) params.set('ie_determinism', SEED);
		if (scenario.runtime) {
			runtimeServer = await serveHoldAndWinRuntime(scenario.runtime, `${origin}/`);
			const runtimePort = await listen(runtimeServer);
			params.set('runtime', '1');
			params.set('k', 'local');
			params.set('project', name);
			params.set('editorDocBase', `http://127.0.0.1:${runtimePort}`);
		}
		const browser = await openBrowser(join(OUT, `profile-${name}-${run}`));
		const shots = {};
		const started = Date.now();
		const capture = async (label) => {
			const { result } = await browser.page('Page.captureScreenshot', { format: 'png' });
			const png = Buffer.from(result.data, 'base64');
			shots[label] = png;
			writeFileSync(join(OUT, `${name}-run${run}-${label}.png`), png);
			const s = FLAG_ON ? await browser.evaluate('window.__IE_DETERMINISM__.state()') : {};
			log(
				`  ${name} run ${run}: ${label} @ frame ${s.frame ?? '-'} (${s.screens?.join('>') ?? ''})`,
			);
		};
		let error;
		try {
			await browser.page('Page.navigate', { url: `${origin}/?${params}` });
			if (FLAG_ON) {
				for (let i = 0; i < 200; i++) {
					if (await browser.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
					await sleep(100);
				}
				await scenario.play(driver(browser, capture));
			} else {
				await flagOffSmoke(browser, capture);
			}
		} catch (e) {
			error = e.message;
			failed = true;
			log(`  ${name} run ${run}: FAILED — ${error}`);
		}
		const globals = flagOffGlobals;
		flagOffGlobals = undefined;
		const state = FLAG_ON
			? await browser.evaluate('window.__IE_DETERMINISM__?.state()').catch(() => undefined)
			: undefined;
		runs.push({
			run,
			globals,
			shots,
			error,
			state,
			seconds: (Date.now() - started) / 1000,
			console: browser.consoleLines.slice(-20),
		});
		browser.close();
		mock.stop();
		runtimeServer?.close();
	}
	const compare = {};
	for (const label of Object.keys(runs[0].shots)) {
		compare[label] = runs.slice(1).map((r) => {
			const other = r.shots[label];
			if (!other) return { run: r.run, missing: true };
			const identicalBytes = other.equals(runs[0].shots[label]);
			const { differing, total } = identicalBytes
				? { differing: 0, total: W * H }
				: diffPixels(runs[0].shots[label], other);
			if (differing !== 0) failed = true;
			return { run: r.run, identicalBytes, differing, total };
		});
	}
	summary.scenarios[name] = {
		runs: runs.map(({ shots, ...r }) => ({ ...r, captures: Object.keys(shots) })),
		compare,
	};
	log(`${name}:`, compare);
}

/** Without the flag: nothing is replaced, and the game boots and spins on the real clock. */
async function flagOffSmoke(browser, capture) {
	for (let i = 0; i < 600; i++) {
		const up = await browser.evaluate(
			`!document.getElementById('ie-boot') && !!document.querySelector('canvas')`,
		);
		if (up) break;
		await sleep(500);
	}
	const replaced = await browser.evaluate(`(() => {
		const native = (f) =>
			typeof f === 'function' &&
			/\\{\\s*\\[native code\\]\\s*\\}$/.test(Function.prototype.toString.call(f));
		const checks = {
			requestAnimationFrame, cancelAnimationFrame, setTimeout, setInterval, clearTimeout,
			clearInterval, fetch, createImageBitmap, Worker, Date, 'Date.now': Date.now,
			'performance.now': performance.now, 'Math.random': Math.random,
			'XMLHttpRequest.send': XMLHttpRequest.prototype.send, 'Response.json': Response.prototype.json,
			'img.src': Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src').set,
		};
		return {
			hook: '__IE_DETERMINISM__' in window,
			nonNative: Object.keys(checks).filter((k) => !native(checks[k])),
			fetchSource: Function.prototype.toString.call(fetch).slice(0, 160),
		};
	})()`);
	if (replaced.hook) throw new Error('flag off but __IE_DETERMINISM__ is installed');
	// Compare this list with main's: anything the bundle wraps without the flag shows on both.
	flagOffGlobals = replaced;
	log('  flag off: not native =', replaced.nonNative.join(', ') || 'none');
	await sleep(4000);
	await capture('flag-off-loaded');
	const key = (type) =>
		browser.page('Input.dispatchKeyEvent', {
			type,
			key: ' ',
			code: 'Space',
			windowsVirtualKeyCode: 32,
			nativeVirtualKeyCode: 32,
		});
	const tap = async () => {
		await key('keyDown');
		await sleep(50);
		await key('keyUp');
	};
	await tap();
	await sleep(4000);
	await capture('flag-off-idle');
	await tap();
	await sleep(1500);
	await capture('flag-off-spin');
	await sleep(15000);
	await capture('flag-off-settled');
}

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
buildServer.close();
log(`${failed ? 'FAIL' : 'PASS'} — ${OUT}/summary.json`);
process.exit(failed ? 1 : 0);
