// The Typekit mirror (`lib/typekit.mjs`): the harness's browser must get the kit from the mirror
// and never from Adobe, a kit URL the mirror lacks must be refused and named, the beacon host must
// be answered locally, and the mirror's identity must pin a run. Proved against a fake kit served
// here on 127.0.0.1 — Adobe's real host is unreachable from a check — with the real headless shell
// when one is installed (`CHROME_PATH` or Playwright's), as in CI's check-all job.
//
//   node scripts/current-games/typekit.fixture.mjs

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { findHeadlessShell } from '../playtest/headless-shell.mjs';
import { openPage } from './lib/browser.mjs';
import { redactText } from './lib/redact.mjs';
import {
	beacon,
	BEACON_HOST,
	crawlKit,
	describeTypekit,
	interceptorFor,
	KIT_HOST,
	KIT_SOURCES,
	kitIds,
	manifestFor,
	manifestHash,
	mirrorInterceptor,
	planTypekit,
	readMirrorDir,
	sha256,
	TYPEKIT_HOSTS,
	writeMirrorDir,
} from './lib/typekit.mjs';

const ROOT = resolve(import.meta.dirname, '../..');

// ---- 1. the kit the runtime loads ----
{
	const ids = kitIds(ROOT);
	assert.deepEqual(ids, ['aba0ebl'], 'the runtime loads one kit, aba0ebl');
	// Both places name the SAME kit: the app template's stylesheet and WebFontLoader's module.
	for (const rel of KIT_SOURCES)
		assert.ok(
			readFileSync(join(ROOT, rel), 'utf8').includes(ids[0]),
			`${rel} names the kit ${ids[0]}`,
		);
	assert.deepEqual(TYPEKIT_HOSTS, [KIT_HOST, BEACON_HOST]);
}

// ---- 2. a fake kit, shaped like Adobe's ----
// A real face so the browser can mark it `loaded`: a system TTF (GitHub's runners and this
// container ship DejaVu). Without one the browser part asserts the plumbing, not the load.
const FONT = [
	'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
	'/usr/share/fonts/TTF/DejaVuSans.ttf',
	'/usr/share/fonts/dejavu/DejaVuSans.ttf',
	'/System/Library/Fonts/Supplemental/Arial.ttf',
	'C:\\Windows\\Fonts\\arial.ttf',
].find((f) => existsSync(f));
const BOLD = FONT?.replace(/(Sans|Arial|arial)\.ttf$/i, (m) =>
	m.startsWith('Sans') ? 'Sans-Bold.ttf' : m.startsWith('Arial') ? 'Arial Bold.ttf' : 'arialbd.ttf',
);
const fontBytes = (file) =>
	file && existsSync(file) ? readFileSync(file) : Buffer.from('not a font');
const PRIMER = 'a'.repeat(64);
const face = (id, fvd, weight) =>
	`@font-face{font-family:"cg-fixture-face";src:url("https://use.typekit.net/af/${id}/l?primer=${PRIMER}&fvd=${fvd}&v=3") format("truetype"),url("https://use.typekit.net/af/${id}/d?primer=${PRIMER}&fvd=${fvd}&v=3") format("woff"),url("https://use.typekit.net/af/${id}/a?primer=${PRIMER}&fvd=${fvd}&v=3") format("opentype");font-display:auto;font-style:normal;font-weight:${weight};}`;
const KIT = {
	'/kit.css': {
		type: 'text/css;charset=utf-8',
		body: Buffer.from(
			`/* fixture kit */\n@import url("https://p.typekit.net/p.css?s=1&k=kit&app=typekit&e=css");\n${face('1111', 'n4', 400)}\n${face('2222', 'n7', 700)}\n.tk-cg{font-family:"cg-fixture-face",sans-serif;}\n`,
		),
	},
	'/kit.js': {
		type: 'text/javascript',
		body: Buffer.from(
			`window.__kit='ran';var i=new Image();i.src='https://p.typekit.net/p.gif?s=1&k=kit&_='+Date.now();`,
		),
	},
	'/af/1111/l': { type: 'font/woff2', body: fontBytes(FONT) },
	'/af/1111/d': { type: 'font/woff', body: Buffer.from('woff 1111') },
	'/af/1111/a': { type: 'font/otf', body: Buffer.from('otf 1111') },
	'/af/2222/l': { type: 'font/woff2', body: fontBytes(BOLD) },
	'/af/2222/d': { type: 'font/woff', body: Buffer.from('woff 2222') },
	'/af/2222/a': { type: 'font/otf', body: Buffer.from('otf 2222') },
};
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://use.typekit.net/kit.css">
<script src="https://use.typekit.net/kit.js"></script>
</head><body><p class="tk-cg">The quick brown fox</p><p class="tk-cg" style="font-weight:700">jumps</p>
<script>document.fonts.forEach((f) => f.load());</script></body></html>`;
const PAGE_UNMIRRORED = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://use.typekit.net/other.css" onerror="window.__err=1" onload="window.__err=2">
</head><body>x</body></html>`;

const hits = [];
/** Requests the fake Adobe answered for the KIT (the test pages live on the same server). */
const kitHits = () => hits.filter((p) => p in KIT).length;
const server = createServer((req, res) => {
	const url = new URL(req.url, 'http://x');
	hits.push(url.pathname);
	const served = KIT[url.pathname];
	if (served) {
		res.writeHead(200, { 'content-type': served.type });
		return res.end(served.body);
	}
	if (url.pathname === '/page.html' || url.pathname === '/unmirrored.html') {
		res.writeHead(200, { 'content-type': 'text/html' });
		return res.end(url.pathname === '/page.html' ? PAGE : PAGE_UNMIRRORED);
	}
	res.writeHead(404);
	res.end();
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;
// The crawl fetches Adobe's host; here that host is the fake kit.
const local = (url, init) => fetch(url.replace(`https://${KIT_HOST}`, origin), init);

const work = mkdtempSync(join(tmpdir(), 'cg-typekit-'));
try {
	// ---- 3. the crawl and the manifest ----
	const files = await crawlKit('kit', local);
	assert.deepEqual(
		files.map((f) => f.url.replace(/\?.*$/, '')).sort(),
		Object.keys(KIT)
			.map((p) => `https://${KIT_HOST}${p}`)
			.sort(),
		'the stylesheet, the script and every file the stylesheet names, each once',
	);
	assert.equal(files.find((f) => f.url.endsWith('/kit.css')).contentType, 'text/css');
	assert.equal(hits.filter((p) => p.startsWith('/af/')).length, 6, 'each font fetched once');
	assert.equal(kitHits(), 8, 'the crawl fetched each kit file once');
	assert.ok(!hits.some((p) => p.includes('p.typekit')), 'the beacon host is not crawled');
	const manifest = manifestFor(['kit'], files, '2026-10-06T00:00:00.000Z');
	assert.equal(manifest.files.length, 8);
	assert.equal(
		manifest.hash,
		manifestHash([...manifest.files].reverse()),
		'the hash ignores order',
	);
	assert.notEqual(
		manifest.hash,
		manifestFor(['kit'], files.slice(1)).hash,
		'a file more or less is another mirror',
	);
	const entry = manifest.files.find((f) => f.url.includes('/af/1111/l'));
	assert.equal(entry.sha256, sha256(KIT['/af/1111/l'].body));
	assert.equal(entry.size, KIT['/af/1111/l'].body.length);

	// ---- 4. a mirror dir, the pin and the interceptor ----
	const dir = writeMirrorDir(join(work, 'mirror'), manifest, files);
	assert.deepEqual(readMirrorDir(dir), manifest);
	const pin = await planTypekit(dir, ROOT);
	assert.deepEqual(pin, {
		mode: 'mirror',
		source: dir,
		hash: manifest.hash,
		kits: ['kit'],
		fetchedAt: '2026-10-06T00:00:00.000Z',
		files: 8,
	});
	assert.deepEqual(await planTypekit('network', ROOT), { mode: 'network' });
	assert.match(describeTypekit(pin), /^typekit: mirror [0-9a-f]{16} \(8 files, kits kit/);
	assert.match(describeTypekit({ mode: 'network' }), /^typekit: network/);
	await assert.rejects(
		mirrorInterceptor({ ...pin, hash: '0000000000000000' }, work),
		/changed during the run/,
		'a refreshed mirror is not the one the plan pinned',
	);
	assert.equal(await mirrorInterceptor({ mode: 'network' }, work), undefined);
	const intercept = await mirrorInterceptor(pin, work);
	const kitCss = intercept(`https://${KIT_HOST}/kit.css`);
	assert.equal(kitCss.contentType, 'text/css');
	assert.ok(kitCss.body.equals(KIT['/kit.css'].body));
	assert.equal(intercept(`https://${KIT_HOST}/other.css`), null, 'a kit URL the mirror lacks');
	assert.equal(intercept('https://example.com/x.css'), undefined, 'not Typekit: let through');
	assert.equal(beacon(`https://${BEACON_HOST}/p.css?s=1`).contentType, 'text/css');
	assert.equal(beacon(`https://${BEACON_HOST}/p.css?s=1`).body.length, 0);
	assert.equal(beacon(`https://${BEACON_HOST}/p.gif?s=1`).contentType, 'image/gif');
	assert.ok(beacon(`https://${BEACON_HOST}/p.gif?s=1`).body.length > 0);
	assert.equal(intercept(`https://${BEACON_HOST}/p.gif?k=kit`).contentType, 'image/gif');
	// The render's error for an unmirrored URL keeps the path and masks the primer token.
	const named = redactText(
		`no entry for https://${KIT_HOST}/af/1111/l?primer=${PRIMER}&fvd=n4&v=3`,
	);
	assert.ok(named.includes(`https://${KIT_HOST}/af/1111/l?primer=***&fvd=n4`), named);

	// ---- 5. the browser: the mirror answers, Adobe is never asked ----
	const chrome = findHeadlessShell() ?? process.env.CHROME_PATH;
	if (!chrome) console.log('typekit.fixture: no headless shell here — the browser part is skipped');
	else {
		const before = kitHits();
		const until = async (page, expr, what) => {
			for (let i = 0; i < 300; i++) {
				if (await page.evaluate(expr).catch(() => false)) return;
				await new Promise((r) => setTimeout(r, 100));
			}
			throw new Error(`timed out waiting for ${what}`);
		};
		let profile = mkdtempSync(join(tmpdir(), 'cg-typekit-profile-'));
		let page = await openPage(chrome, profile, { intercept });
		try {
			await page.navigate(`${origin}/page.html`);
			await until(
				page,
				"window.__kit === 'ran' && [...document.fonts].length === 2 && [...document.fonts].every((f) => f.status === 'loaded' || f.status === 'error')",
				'the kit script and both faces',
			);
			// Chrome quotes `family` in some versions and not in others.
			const fonts = await page.evaluate(
				'[...document.fonts].map((f) => `${f.family.replace(/"/g, "")} ${f.weight} ${f.status}`).sort()',
			);
			if (FONT && existsSync(BOLD))
				assert.deepEqual(
					fonts,
					['cg-fixture-face 400 loaded', 'cg-fixture-face 700 loaded'],
					'both faces loaded from the mirror',
				);
			else assert.equal(fonts.length, 2, 'both faces were declared and tried');
			const mirrored = page.external.filter((l) => l.startsWith('mirror ')).map((l) => l.slice(7));
			for (const want of [
				`https://${KIT_HOST}/kit.css`,
				`https://${KIT_HOST}/kit.js`,
				`https://${KIT_HOST}/af/1111/l?primer=${PRIMER}&fvd=n4&v=3`,
				`https://${KIT_HOST}/af/2222/l?primer=${PRIMER}&fvd=n7&v=3`,
			])
				assert.ok(
					mirrored.includes(want),
					`served from the mirror: ${want}\n${page.external.join('\n')}`,
				);
			assert.ok(
				mirrored.some((u) => u.startsWith(`https://${BEACON_HOST}/p.css`)),
				'the stylesheet beacon was answered locally',
			);
			assert.ok(
				mirrored.some((u) => u.startsWith(`https://${BEACON_HOST}/p.gif`)),
				'the script beacon was answered locally',
			);
			assert.ok(
				!page.external.some((l) => /^\d{3} https:\/\/[a-z.]*typekit\.net/.test(l)),
				`no Typekit request went to the network:\n${page.external.join('\n')}`,
			);
			assert.deepEqual(page.unmirrored, []);
			assert.equal(kitHits(), before, 'the fake Adobe got no request while the page rendered');
		} finally {
			await page.close();
			rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
		}
		// A kit URL the mirror lacks is refused and named, never fetched.
		profile = mkdtempSync(join(tmpdir(), 'cg-typekit-profile-'));
		page = await openPage(chrome, profile, { intercept });
		try {
			await page.navigate(`${origin}/unmirrored.html`);
			await until(page, 'window.__err !== undefined', 'the missing stylesheet to settle');
			assert.equal(await page.evaluate('window.__err'), 1, 'the link errored');
			assert.deepEqual(page.unmirrored, [`https://${KIT_HOST}/other.css`]);
			assert.ok(page.external.includes(`unmirrored https://${KIT_HOST}/other.css`));
			assert.equal(kitHits(), before, 'nothing reached the network');
		} finally {
			await page.close();
			rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
		}
		// Without an interceptor the browser is as before: nothing is paused or recorded.
		profile = mkdtempSync(join(tmpdir(), 'cg-typekit-profile-'));
		page = await openPage(chrome, profile);
		try {
			await page.navigate(`${origin}/page.html`);
			await until(page, 'document.readyState === "complete"', 'the page');
			assert.deepEqual(page.unmirrored, []);
		} finally {
			await page.close();
			rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
		}
	}
} finally {
	server.close();
	rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}
console.log('typekit.fixture: ok');
