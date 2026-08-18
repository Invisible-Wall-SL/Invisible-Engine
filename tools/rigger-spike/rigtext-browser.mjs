// Browser contract test for RIG TEXT rasterisation — the half `rigtext.mjs` structurally
// cannot see (design `docs/design/invisible-cinematic.md` §12.4a).
//
//   node tools/rigger-spike/rigtext-browser.mjs
//
// `rigtext.mjs` proves the DATA: the atlas composes, spine resolves the regions, the ship chain
// enumerates the page. None of that draws a pixel. This runs the REAL vendored bundle
// (`static/rigger/vendor/rigger-text.js` — the exact bytes `/rigger` loads) in a REAL Chromium
// with WebGL, against a fake launcher API serving a REAL shipped bitmap font
// (`apps/lines/static/assets/fonts/goldFont/mm_gold.xml`), and drives the whole authoring round
// trip: catalog → localization keys → rasterise → pack → presigned upload → document write.
//
// THE METRICS ARE CHOSEN TO BE SENSITIVE. A lit-pixel count would pass on a blank page and
// cannot tell a landscape page from a portrait one, so instead this asserts:
//   - a rendered string's INK BOX, not its pixel count;
//   - that a LONGER string is measurably WIDER (so "rendered nothing" fails);
//   - that two different strings produce different pixel hashes (so "rendered the same glyph
//     twice" fails);
//   - that every packed rect lands inside the page and no two overlap;
//   - that the page the server receives is the page the browser packed.
//
// It does NOT verify the /rigger PANEL (the modal, the slot/attachment writing) — that is
// `view.html`, which needs an authed launcher with real R2. That remains an owner live check.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url);
const BUNDLE = fileURLToPath(new URL('apps/launcher-api/static/rigger/vendor/rigger-text.js', ROOT));
const FONT_DIR = fileURLToPath(new URL('apps/lines/static/assets/fonts/goldFont/', ROOT));

if (!existsSync(BUNDLE)) {
	console.error(`Missing ${BUNDLE} — run: pnpm --filter launcher-api build:rigger-text`);
	process.exit(1);
}

// ------------------------------------------------------------------ chromium ----

function findChromium() {
	const base = join(process.env.LOCALAPPDATA ?? process.env.HOME ?? '', 'ms-playwright');
	if (!existsSync(base)) return null;
	for (const dir of readdirSync(base)) {
		for (const rel of [
			join('chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
			join('chrome-win', 'chrome.exe'),
			join('chrome-linux', 'chrome'),
		]) {
			const p = join(base, dir, rel);
			if (existsSync(p)) return p;
		}
	}
	return null;
}

const CHROME = findChromium();
if (!CHROME) {
	console.error('No Chromium found under ms-playwright — this gate needs a real browser.');
	process.exit(1);
}

// ------------------------------------------------------------------ fake API ----

const descriptor = readFileSync(join(FONT_DIR, 'mm_gold.xml'), 'utf8');
// The SAME art behind a descriptor that UNDER-declares its box: a line 45px shorter than the
// glyphs, and advances narrower than they are. Real BMFont exports do both — a descender hangs
// below `lineHeight`, a swash or a baked shadow reaches past `xadvance` — and both used to be
// cut off at rasterisation, permanently, because PIXI frames text by its METRICS.
const liarDescriptor = descriptor
	.replace('lineHeight="105" base="105"', 'lineHeight="60" base="60"')
	.replace(/xadvance="([\d.]+)"/g, (_m, v) => `xadvance="${(Number(v) * 0.6).toFixed(1)}"`);
// The shipped descriptor declares its page as `mm_gold.webp` — serve exactly what it names.
const pageImg = readFileSync(join(FONT_DIR, 'mm_gold.webp'));
const bundleJs = readFileSync(BUNDLE);

/** What the browser PUT to the presigned URL — the page bytes the server would have stored. */
let uploadedPage = null;
/** The document body posted to `/api/rigger/text`. */
let savedDoc = null;

const HARNESS = `<!doctype html><meta charset="utf-8"><title>rig text harness</title>
<body style="background:#111"></body>
<script src="/rigger-text.js"></script>
<script>window.__READY__ = !!window.RiggerText;</script>`;

const server = createServer((req, res) => {
	const url = new URL(req.url, 'http://x');
	const send = (code, type, body) => {
		res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*' });
		res.end(body);
	};
	if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', HARNESS);
	if (url.pathname === '/rigger-text.js') return send(200, 'text/javascript', bundleJs);
	if (url.pathname === '/api/fonts/catalog')
		return send(
			200,
			'application/json',
			JSON.stringify({
				fonts: [
					{
						id: 'gold',
						name: 'mm_gold',
						kind: 'bitmap',
						descriptorUrl: '/font/mm_gold.xml',
						descriptorFormat: 'xml',
						pages: [{ file: 'mm_gold.webp', url: '/font/mm_gold.webp' }],
					},
					{
						id: 'liar',
						name: 'mm_liar',
						kind: 'bitmap',
						descriptorUrl: '/font/mm_liar.xml',
						descriptorFormat: 'xml',
						pages: [{ file: 'mm_gold.webp', url: '/font/mm_gold.webp' }],
					},
				],
			}),
		);
	if (url.pathname === '/font/mm_gold.xml') return send(200, 'text/plain', descriptor);
	if (url.pathname === '/font/mm_liar.xml') return send(200, 'text/plain', liarDescriptor);
	if (url.pathname === '/font/mm_gold.webp') return send(200, 'image/webp', pageImg);
	if (url.pathname === '/api/rigger/strings')
		return send(
			200,
			'application/json',
			JSON.stringify({
				sourceLang: 'en',
				targetLangs: ['de', 'es'],
				entries: [
					{
						key: 'FREE_SPINS',
						source: '10',
						reviewed: { de: '1000000', es: '100' },
						pending: 1,
					},
				],
			}),
		);
	if (url.pathname === '/api/rigger/text/page-url') {
		return readBody(req).then((body) => {
			const { file } = JSON.parse(body);
			send(
				200,
				'application/json',
				JSON.stringify({ url: `/upload/${file}`, contentType: 'image/png' }),
			);
		});
	}
	if (url.pathname.startsWith('/upload/') && req.method === 'PUT') {
		return readBodyBytes(req).then((bytes) => {
			uploadedPage = { name: url.pathname.slice('/upload/'.length), bytes, type: req.headers['content-type'] };
			send(200, 'text/plain', 'ok');
		});
	}
	if (url.pathname === '/api/rigger/text' && req.method === 'POST') {
		return readBody(req).then((body) => {
			savedDoc = JSON.parse(body);
			send(200, 'application/json', JSON.stringify({ ok: true, etag: 'etag-1', regions: [] }));
		});
	}
	send(404, 'text/plain', 'not found');
});

const readBody = (req) =>
	new Promise((r) => {
		let s = '';
		req.on('data', (c) => (s += c));
		req.on('end', () => r(s));
	});
const readBodyBytes = (req) =>
	new Promise((r) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => r(Buffer.concat(chunks)));
	});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// ------------------------------------------------------------------ CDP ----

const profile = mkdtempSync(join(tmpdir(), 'rigtext-cdp-'));
const chrome = spawn(
	CHROME,
	[
		'--headless',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		'--no-sandbox',
		'--disable-dev-shm-usage',
		// PIXI needs a GL context; the headless shell has no GPU, so force the software rasteriser.
		'--use-gl=angle',
		'--use-angle=swiftshader',
		'--enable-unsafe-swiftshader',
		'--hide-scrollbars',
		`http://127.0.0.1:${PORT}/`,
	],
	{ stdio: ['ignore', 'pipe', 'pipe'] },
);

const wsUrl = await new Promise((resolve, reject) => {
	const t = setTimeout(() => reject(new Error('chromium did not report a devtools endpoint')), 20000);
	let buf = '';
	chrome.stderr.on('data', (c) => {
		buf += c;
		const m = /ws:\/\/[^\s]+/.exec(buf);
		if (m) {
			clearTimeout(t);
			resolve(m[0]);
		}
	});
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let msgId = 0;
const pending = new Map();
// Forward the page's console + uncaught errors. A silent browser failure (a GL context that
// never initialises, a font that 404s) is exactly the class of bug this gate exists to catch,
// and without this it surfaces only as "the result was null".
const pageLog = [];
ws.onmessage = (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.id && pending.has(msg.id)) {
		pending.get(msg.id)(msg);
		pending.delete(msg.id);
		return;
	}
	if (msg.method === 'Runtime.consoleAPICalled') {
		pageLog.push(
			`[${msg.params.type}] ` +
				msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '),
		);
	}
	if (msg.method === 'Runtime.exceptionThrown') {
		pageLog.push(`[uncaught] ${msg.params.exceptionDetails.exception?.description ?? ''}`);
	}
};
const cdp = (method, params = {}, sessionId) =>
	new Promise((resolve) => {
		const id = ++msgId;
		pending.set(id, resolve);
		ws.send(JSON.stringify({ id, method, params, sessionId }));
	});

const { result: targets } = await cdp('Target.getTargets');
const page = targets.targetInfos.find((t) => t.type === 'page');
const { result: attached } = await cdp('Target.attachToTarget', { targetId: page.targetId, flatten: true });
const session = attached.sessionId;
await cdp('Runtime.enable', {}, session);

/** Evaluate an async expression in the page and return its value (or throw its error). */
async function evaluate(expression) {
	const res = await cdp(
		'Runtime.evaluate',
		{ expression, awaitPromise: true, returnByValue: true },
		session,
	);
	if (res.error) throw new Error(JSON.stringify(res.error));
	const r = res.result;
	if (r.exceptionDetails) {
		throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
	}
	return r.result.value;
}

// Wait for the harness to have loaded the bundle.
for (let i = 0; i < 100; i++) {
	const ready = await evaluate('!!window.RiggerText').catch(() => false);
	if (ready) break;
	await new Promise((r) => setTimeout(r, 100));
}

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) {
		pass++;
		console.log(`  ✓ ${name}`);
	} else {
		fail++;
		console.log(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
	}
};

try {
	console.log('\n1. the vendored bundle loads and reaches the launcher API');
	{
		const info = await evaluate(`(async () => {
			const fonts = await window.RiggerText.loadFonts();
			const strings = await window.RiggerText.loadStrings();
			return { fonts: fonts.length, font0: fonts[0]?.name, keys: strings.entries.length, src: strings.sourceLang };
		})()`);
		ok('window.RiggerText exists in a real browser', !!info);
		ok('it reads the font catalog', info.fonts === 2 && info.font0 === 'mm_gold', JSON.stringify(info));
		ok('it reads the localization keys', info.keys === 1 && info.src === 'en');
	}

	console.log('\n2. PIXI actually rasterises the string (metrics that fail on a blank canvas)');
	{
		const m = await evaluate(`(async () => {
			const style = { fontId: 'gold', fontSize: 64, color: '#ffffff' };
			const measure = async (text) => {
				const c = await window.RiggerText.preview(text, style);
				if (!c) return null;
				const ctx = c.getContext('2d');
				const d = ctx.getImageData(0, 0, c.width, c.height).data;
				let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, lit = 0, sum = 0;
				for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
					const a = d[(y * c.width + x) * 4 + 3];
					if (a > 8) { lit++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
					sum = (sum * 31 + d[(y * c.width + x) * 4] + a) % 2147483647;
				}
				return { w: c.width, h: c.height, lit, inkW: maxX - minX + 1, inkH: maxY - minY + 1, hash: sum };
			};
			return { one: await measure('1'), long: await measure('1000000'), other: await measure('7') };
		})()`);
		ok('a string rasterises to a canvas', !!m.one && m.one.w > 0 && m.one.h > 0, JSON.stringify(m.one));
		ok('it has INK (not a blank page)', m.one.lit > 0 && m.one.inkW > 0 && m.one.inkH > 0, JSON.stringify(m.one));
		// The decisive one: a 7-character string must be materially wider than a 1-character one.
		ok('a longer string is measurably WIDER', m.long.inkW > m.one.inkW * 4, `${m.one.inkW} → ${m.long.inkW}`);
		ok('…and the SAME height (one line, same size)', Math.abs(m.long.h - m.one.h) <= 2, `${m.one.h} vs ${m.long.h}`);
		// …and two different single characters must not produce identical pixels, which is what
		// "the renderer drew the same fallback glyph for everything" would look like.
		ok('two different strings differ in pixels', m.one.hash !== m.other.hash, `${m.one.hash} / ${m.other.hash}`);
	}

	console.log('\n3. a descriptor that under-declares its box does not CUT the glyphs');
	{
		const m = await evaluate(`(async () => {
			const measure = async (fontId) => {
				const c = await window.RiggerText.preview('7', { fontId, fontSize: 105, color: '#ffffff' });
				if (!c) return null;
				const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
				let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, lit = 0;
				for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
					if (d[(y * c.width + x) * 4 + 3] > 8) { lit++;
						if (x < minX) minX = x; if (x > maxX) maxX = x;
						if (y < minY) minY = y; if (y > maxY) maxY = y; }
				}
				return { w: c.width, h: c.height, lit, inkW: maxX - minX + 1, inkH: maxY - minY + 1 };
			};
			return { honest: await measure('gold'), liar: await measure('liar') };
		})()`);
		// The honest font's line box IS its glyph box, so its tile must come back as exactly that:
		// the room the rasteriser draws into is measured off again, never baked in.
		ok('an honest descriptor yields exactly its metric box', m.honest.h === 105, JSON.stringify(m.honest));
		// The decisive pair: same art, same size, a box claiming to be 45px shorter and 40% narrower.
		// Every pixel must survive — this is the assertion a cut fails.
		ok('the lying descriptor keeps the FULL glyph height', m.liar.inkH === m.honest.inkH, `${m.honest.inkH} → ${m.liar.inkH}`);
		ok('…and the full glyph width', m.liar.inkW === m.honest.inkW, `${m.honest.inkW} → ${m.liar.inkW}`);
		ok('…and the same ink, pixel for pixel', Math.abs(m.liar.lit - m.honest.lit) <= 2, `${m.honest.lit} vs ${m.liar.lit}`);
		// …in a tile that GREW to hold the overhang, rather than one that clipped it.
		ok('the tile grew past the declared line box', m.liar.h > 60, JSON.stringify(m.liar));
	}

	console.log('\n4. the full authoring round trip: bake → pack → upload → document');
	{
		const res = await evaluate(`(async () => {
			const r = await window.RiggerText.save({
				dir: 'ZGly', atlasFile: 'rig.atlas', projectKey: 'p',
				elements: [{
					id: 'title', key: 'FREE_SPINS', fontId: 'gold', fontName: 'mm_gold', fontSize: 48,
					sourceLocale: 'en', slot: 'text_title', style: { color: '#ffffff' },
				}],
				baseEtag: null,
			});
			return r;
		})()`);
		ok('the save reports success', res.ok === true, JSON.stringify(res).slice(0, 300));
		ok('it returns one attachment per baked locale', res.attachments?.length === 3, JSON.stringify(res.attachments));
		const locales = (res.attachments ?? []).map((a) => a.locale).sort().join(',');
		ok('the locales are the source + the REVIEWED translations only', locales === 'de,en,es', locales);
		ok('the region names are namespaced', res.attachments?.every((a) => a.region === 'text/title/' + a.locale));

		ok('a page was PUT to the presigned URL', !!uploadedPage, 'no upload seen');
		ok('…as image/png', uploadedPage?.type === 'image/png', uploadedPage?.type);
		ok('…and it is a real PNG', uploadedPage && uploadedPage.bytes.slice(1, 4).toString() === 'PNG');
		ok('the page filename is content-addressed', /^rigtext-[0-9a-f]{16}\.png$/.test(uploadedPage?.name ?? ''), uploadedPage?.name);

		ok('the document was posted', !!savedDoc);
		ok('…naming the page that was uploaded', savedDoc?.doc?.page?.file === uploadedPage?.name, `${savedDoc?.doc?.page?.file} vs ${uploadedPage?.name}`);
		ok('…with the write precondition', 'baseEtag' in (savedDoc ?? {}) && savedDoc.baseEtag === null);
		ok('…and the project scope guard', savedDoc?.projectKey === 'p');

		const variants = savedDoc?.doc?.elements?.[0]?.variants ?? [];
		ok('the document carries one variant per locale', variants.length === 3, JSON.stringify(variants.map((v) => v.locale)));
		ok('each variant remembers the STRING it baked', variants.every((v) => typeof v.text === 'string' && v.text.length > 0));
		// The `de` string is 7 chars and `es` is 3 — the packed rects must reflect that, which is
		// the end-to-end proof that per-locale art really is per-locale.
		const de = variants.find((v) => v.locale === 'de');
		const es = variants.find((v) => v.locale === 'es');
		ok('a longer translation packs a WIDER rect', de.w > es.w * 1.5, `de ${de.w} vs es ${es.w}`);

		const page = savedDoc.doc.page;
		ok('every rect fits inside the declared page', variants.every((v) => v.x >= 0 && v.y >= 0 && v.x + v.w <= page.width && v.y + v.h <= page.height), JSON.stringify({ page, variants }));
		let overlap = false;
		for (let i = 0; i < variants.length; i++)
			for (let j = i + 1; j < variants.length; j++) {
				const a = variants[i], b = variants[j];
				if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap = true;
			}
		ok('no two variants overlap on the page', !overlap);
	}

	console.log('\n5. failure is reported, never silently baked');
	{
		const res = await evaluate(`(async () => window.RiggerText.save({
			dir: 'ZGly', atlasFile: 'rig.atlas', projectKey: 'p',
			elements: [{ id: 'bad', key: 'FREE_SPINS', fontId: 'no-such-font', fontName: 'x', fontSize: 48,
				sourceLocale: 'en', slot: 'text_bad', style: { color: '#ffffff' } }],
			baseEtag: null,
		}))()`);
		ok('an unknown font fails the bake instead of substituting one', res.ok === false && res.error === 'bake-failed', JSON.stringify(res).slice(0, 200));
		ok('…and names every locale it could not render', res.failed?.length === 3, JSON.stringify(res.failed));
	}
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}`);
} finally {
	if (pageLog.length) console.log('\npage console:\n  ' + pageLog.join('\n  '));
	ws.close();
	chrome.kill();
	server.close();
}

console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
