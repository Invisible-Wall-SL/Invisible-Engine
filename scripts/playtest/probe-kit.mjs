// What the 4K-builds probes share (`canvas-scale-probe.mjs`, `art-tier-probe.mjs`): a static host
// for the built runtime, a seeded book mock, a headless shell driven over CDP, and a PNG pixel diff
// with a map of where two captures differ.

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

import { spawnHeadlessShell } from './headless-shell.mjs';

export const ROOT = resolve(import.meta.dirname, '../..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

export const listen = (server) =>
	new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));

/** A static host: `mounts` maps a url prefix to a folder. The `/` mount is the build, served the
 *  way adapter-static is (an unknown path gets `index.html`); any other mount 404s what it lacks.
 *  `served` lists every path asked for — including a worker's fetches, which the page's own network
 *  log never sees (Pixi decodes textures in one). */
export const serveStatic = (mounts) => {
	const served = [];
	const server = createServer((req, res) => {
		const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		served.push(path);
		const prefix = Object.keys(mounts)
			.sort((a, b) => b.length - a.length)
			.find((p) => path.startsWith(p));
		const dir = mounts[prefix];
		let file = join(dir, path.slice(prefix.length));
		const missing = !file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory();
		if (missing && prefix !== '/') {
			res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
			res.end();
			return;
		}
		if (missing) file = join(dir, 'index.html');
		res.writeHead(200, {
			'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
			'Access-Control-Allow-Origin': '*',
		});
		createReadStream(file).pipe(res);
	});
	return Object.assign(server, { served });
};

/** A server answering every request with one JSON body (a `/api/editor/doc` or `/runtime` stub). */
export const serveJson = (body) => {
	const text = JSON.stringify(body);
	return createServer((req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
		res.end(text);
	});
};

/** The book mock on a free port, dealing from `seed`. */
export const startBookMock = async (seed) => {
	const probe = createServer();
	const port = await listen(probe);
	await new Promise((ok) => probe.close(ok));
	const child = spawn(process.execPath, ['scripts/mock-rgs-server-book.mjs'], {
		cwd: ROOT,
		env: { ...process.env, PORT: String(port), SEED: seed },
		stdio: 'ignore',
	});
	for (let i = 0; i < 100; i++) {
		const up = await fetch(`http://127.0.0.1:${port}/healthz`).then(
			(r) => r.ok,
			() => false,
		);
		if (up) return { port, stop: () => child.kill() };
		await sleep(100);
	}
	child.kill();
	throw new Error('mock did not start');
};

/** A headless shell with one page at `width`×`height`, DPR 1, UTC, en-US. `log` collects page
 *  exceptions and console lines; `requests` every url the page asked for. */
export const openBrowser = async ({ chrome: exe, profile, width, height }) => {
	const chrome = spawnHeadlessShell(exe, { profile, width, height });
	const pending = new Map();
	const log = [];
	const requests = [];
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
				log.push(msg.params.exceptionDetails.exception?.description ?? 'exception');
			} else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type !== 'debug') {
				const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
				log.push(`[${msg.params.type}] ${text}`.slice(0, 300));
			} else if (msg.method === 'Network.requestWillBeSent') {
				requests.push(msg.params.request.url);
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
	await page('Network.enable');
	await page('Emulation.setDeviceMetricsOverride', {
		width,
		height,
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
	const key = (type) =>
		page('Input.dispatchKeyEvent', {
			type,
			key: ' ',
			code: 'Space',
			windowsVirtualKeyCode: 32,
			nativeVirtualKeyCode: 32,
		});
	return {
		page,
		evaluate,
		log,
		requests,
		/** A Space tap: a spin from idle, a tap past a press-to-continue. */
		tap: async () => {
			await key('keyDown');
			await sleep(50);
			await key('keyUp');
		},
		/** Navigate and wait until the boot screen is gone and the canvas is up. */
		boot: async (url) => {
			await page('Page.navigate', { url });
			for (let i = 0; i < 600; i++) {
				const up = await evaluate(
					`!document.getElementById('ie-boot') && !!document.querySelector('canvas')`,
				);
				if (up) return;
				await sleep(500);
			}
			throw new Error(`the game did not boot: ${url}`);
		},
		capture: async () => {
			const { result } = await page('Page.captureScreenshot', { format: 'png' });
			return Buffer.from(result.data, 'base64');
		},
		close: () => chrome.kill(),
	};
};

// ---------- PNG ----------

export const decodePng = (png) => {
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
export const encodePng = (width, height, rgb) => {
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

/** Pixels differing by more than `tolerance` on any channel, their bounding box, and a map of them:
 *  the first capture dimmed to grey, each differing pixel red. */
export const diffPngs = (a, b, tolerance) => {
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
			if (d <= tolerance) {
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

export const describeDiff = (label, d, flag) =>
	`${flag ? 'DIFF' : 'same'}  ${label}: ${d.count} px (${(d.share * 100).toFixed(2)}%)` +
	(d.box ? ` in x ${d.box.x0}–${d.box.x1}, y ${d.box.y0}–${d.box.y1}` : '');
