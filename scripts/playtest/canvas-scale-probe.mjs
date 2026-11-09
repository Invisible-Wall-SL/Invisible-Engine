// Does a game put on a BIGGER canvas look the same? (docs/design/arcade-4k-builds.md Phase 2)
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
//     scripts/playtest/canvas-scale-probe.mjs [--build apps/lines/build] [--factor 2]
//     [--layout bookof|lines] [--out <dir>]
//
// Boots the BUILT runtime twice against the same seeded book mock, on a real clock: once with a
// reference layout as authored, once with that layout put on a canvas `--factor` times larger by
// `rescaleCanvas` (engine-layout), the function the Scene Editor's Canvas Size panel runs. The
// window fits either box, so whatever the doc lays out draws identically; anything that differs is
// still sized in the ORIGINAL canvas's units. `bookof` carries a reel grid; `lines` does not, so its
// board is the coded default, which does not follow the canvas (the editor says so).
//
// Captures the idle board and the board settled after one spin, and reports, per capture, how many
// pixels differ by more than a resampling tolerance and where, with a red-on-grey map of them
// (`<label>-diff.png`). Exit 1 when more than 1% of the window differs. A real clock leaves a little
// noise under that: the background's animated smoke and particles, the win glow caught at a
// slightly different moment, and the HUD clock when a minute turns between the two runs. A layout
// that does not follow the canvas moves whole regions (the coded board on `lines`: ~11%).
//
// Real clock, not `?ie_determinism`: on Windows the determinism hook holds the boot on its loading
// screen (determinism-proof.mjs fails there the same way), so the spin outcome comes from the
// mock's SEED and the captures from waits. Writes both runs' PNGs to --out.

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { deflateSync, inflateSync } from 'node:zlib';

import { headlessShell, spawnHeadlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		build: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		factor: { type: 'string', default: '2' },
		layout: { type: 'string', default: 'bookof' },
		out: { type: 'string' },
		chrome: { type: 'string' },
	},
});
const FACTOR = Number(opt.factor);
const W = 1280;
const H = 720;
const SEED = 'canvas-scale';
/** Per-channel difference that counts: bilinear sampling of the same art at another scale moves an
 *  edge pixel by a few levels, and that is not what this looks for. */
const TOLERANCE = 24;
const OUT =
	opt.out ?? join(tmpdir(), `ie-canvas-scale-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const CHROME = headlessShell(opt.chrome);
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
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.fnt': 'text/plain',
};
const listen = (server) =>
	new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));

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

const { defaultLayout } =
	await import('../../packages/engine-layout/src/lib/referenceLayouts/lines.ts');
const { bookofReferenceLayout } =
	await import('../../packages/engine-layout/src/lib/referenceLayouts/bookof.ts');
const { DEFAULT_LAYOUT_PROFILE } = await import('../../packages/constants-shared/layoutProfile.ts');
const { rescaleCanvas } = await import('../../packages/engine-layout/src/lib/canvasRescale.ts');

/** `/api/editor/doc` — the path a non-runtime boot reads its layout from (`?k=` + `editorDocBase`). */
const serveDoc = (doc) => {
	const body = JSON.stringify({ doc });
	return createServer((req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
		res.end(body);
	});
};

const startMock = async () => {
	const probe = createServer();
	const port = await listen(probe);
	await new Promise((ok) => probe.close(ok));
	const child = spawn(process.execPath, ['scripts/mock-rgs-server-book.mjs'], {
		cwd: ROOT,
		env: { ...process.env, PORT: String(port), SEED },
		stdio: 'ignore',
	});
	for (let i = 0; i < 100; i++) {
		if (
			await fetch(`http://127.0.0.1:${port}/healthz`).then(
				(r) => r.ok,
				() => false,
			)
		)
			return { port, stop: () => child.kill() };
		await sleep(100);
	}
	child.kill();
	throw new Error('mock did not start');
};

// ---------- CDP ----------

const openBrowser = async (profile) => {
	const chrome = spawnHeadlessShell(CHROME, { profile, width: W, height: H });
	const pending = new Map();
	const errors = [];
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
				errors.push(msg.params.exceptionDetails.exception?.description ?? 'exception');
			} else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type !== 'debug') {
				const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
				errors.push(`[${msg.params.type}] ${text}`.slice(0, 300));
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
	await page('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
	await page('Emulation.setLocaleOverride', { locale: 'en-US' });
	const evaluate = async (expression) => {
		const { result } = await page('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails)
			throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
		return result.result.value;
	};
	return { page, evaluate, errors, close: () => chrome.kill() };
};

// ---------- PNG ----------

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
			for (let ch = 0; ch < 3; ch++) out[o + ch] = line[x * bpp + ch];
			out[o + 3] = 255;
		}
	}
	return { width, height, rgba: out };
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc32 = (buf) => {
	let c = 0xffffffff;
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
/** An 8-bit RGB PNG from rows of RGB bytes. */
const encodePng = (width, height, rgb) => {
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([len, body, crc]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 2;
	const raw = Buffer.alloc(height * (width * 3 + 1));
	for (let y = 0; y < height; y++)
		rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]);
};

/** Pixels differing by more than TOLERANCE on any channel, their bounding box, and a map of them:
 *  the native capture dimmed to grey, each differing pixel red. */
const diff = (a, b) => {
	const A = decodePng(a);
	const B = decodePng(b);
	let count = 0;
	let box = null;
	const map = Buffer.alloc(A.width * A.height * 3);
	for (let y = 0; y < A.height; y++)
		for (let x = 0; x < A.width; x++) {
			const o = (y * A.width + x) * 4;
			const d = Math.max(
				Math.abs(A.rgba[o] - B.rgba[o]),
				Math.abs(A.rgba[o + 1] - B.rgba[o + 1]),
				Math.abs(A.rgba[o + 2] - B.rgba[o + 2]),
			);
			const m = (y * A.width + x) * 3;
			if (d <= TOLERANCE) {
				map.fill(Math.round(A.rgba[o] * 0.15 + A.rgba[o + 1] * 0.15), m, m + 3);
				continue;
			}
			map[m] = 255;
			count++;
			box = box
				? {
						x0: Math.min(box.x0, x),
						y0: Math.min(box.y0, y),
						x1: Math.max(box.x1, x),
						y1: Math.max(box.y1, y),
					}
				: { x0: x, y0: y, x1: x, y1: y };
		}
	return {
		count,
		share: count / (A.width * A.height),
		box,
		map: encodePng(A.width, A.height, map),
	};
};

// ---------- run ----------

const build = resolve(opt.build);
if (!existsSync(join(build, 'index.html'))) {
	console.error(`No build at ${build} — run \`pnpm --filter lines build\` first.`);
	process.exit(1);
}
const buildServer = serveBuild(build);
const origin = `http://127.0.0.1:${await listen(buildServer)}`;
const native =
	opt.layout === 'lines' ? defaultLayout('lines', { buttons: true }) : bookofReferenceLayout();
const rescaled = rescaleCanvas(native, FACTOR, native.layoutProfile ?? DEFAULT_LAYOUT_PROFILE);
if (rescaled.codedBoard)
	console.log(
		'note: no reel grid — the board is the coded default, which does not follow the canvas',
	);
const variants = { native, scaled: rescaled.doc };
const shots = {};

for (const [name, doc] of Object.entries(variants)) {
	const mock = await startMock();
	const docServer = serveDoc(doc);
	const params = new URLSearchParams({
		sessionID: `scale-${name}`,
		rgs_url: `127.0.0.1:${mock.port}`,
		lang: 'en',
		currency: 'USD',
		device: 'desktop',
		k: 'local',
		project: 'canvas-scale',
		editorDocBase: `http://127.0.0.1:${await listen(docServer)}`,
	});
	const browser = await openBrowser(join(OUT, `profile-${name}`));
	shots[name] = {};
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
	const capture = async (label) => {
		const { result } = await browser.page('Page.captureScreenshot', { format: 'png' });
		const png = Buffer.from(result.data, 'base64');
		shots[name][label] = png;
		writeFileSync(join(OUT, `${name}-${label}.png`), png);
	};
	try {
		await browser.page('Page.navigate', { url: `${origin}/?${params}` });
		for (let i = 0; i < 600; i++) {
			const up = await browser.evaluate(
				`!document.getElementById('ie-boot') && !!document.querySelector('canvas')`,
			);
			if (up) break;
			await sleep(500);
		}
		await sleep(4000);
		await tap();
		await sleep(4000);
		await capture('idle');
		await tap();
		await sleep(15000);
		await capture('settled');
	} finally {
		if (browser.errors.length) console.log(`${name} page log:`, browser.errors.slice(0, 40));
		browser.close();
		mock.stop();
		docServer.close();
	}
}
buildServer.close();

/** Share of the window allowed to differ — above the real clock's noise (see the header). */
const ALLOWED = 0.01;
let failed = false;
for (const label of Object.keys(shots.native)) {
	const d = diff(shots.native[label], shots.scaled[label]);
	const flag = d.share > ALLOWED;
	writeFileSync(join(OUT, `${label}-diff.png`), d.map);
	if (flag) failed = true;
	console.log(
		`${flag ? 'DIFF' : 'same'}  ${label}: ${d.count} px (${(d.share * 100).toFixed(2)}%)` +
			(d.box ? ` in x ${d.box.x0}–${d.box.x1}, y ${d.box.y0}–${d.box.y1}` : ''),
	);
}
console.log(`captures: ${OUT}`);
process.exit(failed ? 1 : 0);
