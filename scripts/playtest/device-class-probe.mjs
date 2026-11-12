// Does a phone in "Desktop site" mode get the phone treatment, and does a desktop stay as it was?
// (`pixi-svelte` `deviceClass.ts`; docs/status/engine.md, 2026-11-12)
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
//     scripts/playtest/device-class-probe.mjs --build <dir> [--base-build <dir>] [--out <dir>]
//
// Boots the BUILT runtime (`?runtime=1&perf=1`; a Play4Fun build, as the current-games harness and
// a release build it) against a stub runtime bundle: a 4K game (the Book-of reference ×2.7, so its
// portrait box is 2160 px wide) with one sheet and one image, each published with a KTX2 twin and a
// `half` tier that has its own twin. Each device is emulated over CDP:
//   s25          a Galaxy S25 in Chrome's Desktop site (the 2026-11-12 `?perf=1` report): Chrome's
//                desktop UA, touch, DPR 2.8125, a 384 px wide screen, the page's viewport meta
//                ignored (so it is laid out 980 px wide and zoomed out to fit), and the Adreno
//                830's name for `WEBGL_debug_renderer_info`;
//   s25-high     the same with `?quality=high`;
//   tablet       an Android tablet in landscape, 1280 px wide, so not zoomed out: the GPU decides
//                (Adreno 740), and `tablet-sw` the same tablet with SwiftShader's own name;
//   desktop      the same desktop UA without touch at DPR 1, and `desktop-2x` at DPR 2.
// Per run it prints the art files requested (`.ktx2` or not, full or `@half`), the canvas's backing
// size and the renderer's resolution, and the `?perf=1` device line where the build has one. With
// `--base-build` the same runs boot both builds, and every desktop run must request the same files
// and draw the same canvas on both. Exit 1 on a failed expectation.

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { headlessShell } from './headless-shell.mjs';
import {
	ROOT,
	listen,
	openBrowser,
	serveJson,
	serveStatic,
	sleep,
	startBookMock,
} from './probe-kit.mjs';

const sharp = createRequire(join(ROOT, 'apps/launcher-api/package.json'))('sharp');

const { values: opt } = parseArgs({
	options: {
		build: { type: 'string' },
		'base-build': { type: 'string' },
		out: { type: 'string' },
		chrome: { type: 'string' },
	},
});
if (!opt.build) throw new Error('--build <dir> is required (a Play4Fun build of apps/lines)');
const OUT =
	opt.out ?? join(tmpdir(), `ie-device-class-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const ART = join(OUT, 'art');
mkdirSync(ART, { recursive: true });
const CHROME = headlessShell(opt.chrome);

const { bookofReferenceLayout } =
	await import('../../packages/engine-layout/src/lib/referenceLayouts/bookof.ts');
const { DEFAULT_LAYOUT_PROFILE } = await import('../../packages/constants-shared/layoutProfile.ts');
const { rescaleCanvas } = await import('../../packages/engine-layout/src/lib/canvasRescale.ts');

// ---------- the art: a sheet and an image, each with a KTX2 twin and a half tier ----------

/** A 16×16 UASTC `.ktx2` (`check-ktx2-transcoder.mjs`'s), encoded as `ktx2Encode.ts` does. */
const KTX2 = Buffer.from(
	'q0tUWCAyMLsNChoKAAAAAAEAAAAQAAAAEAAAAAAAAAAAAAAAAQAAAAEAAAACAAAAaAAAACwAAACUAAAAJAAAAAAAAAAAAAAAAAAAAAAAAAC4AAAAAAAAADsAAAAAAAAAAAEAAAAAAAAsAAAAAAAAAAIAKACmAQIAAwMAABAAAAAAAAAAAAB/AAAAAAAAAAAA/////x8AAABLVFh3cml0ZXIAQmFzaXMgVW5pdmVyc2FsIDIuNTAAACi1L/1gAACNAQDo9/8f6N98bwAX4B/oPwIfAR8A6D/6ABcAAOifAUAHAAUSAIuZWcoDlgAAeSYKBOAC',
	'base64',
);
const WEBP = await sharp({
	create: { width: 16, height: 16, channels: 4, background: '#e94e77' },
})
	.webp()
	.toBuffer();
const sheet = (image) =>
	JSON.stringify({
		frames: { panel: { frame: { x: 0, y: 0, w: 16, h: 16 }, sourceSize: { w: 16, h: 16 } } },
		meta: { image, size: { w: 16, h: 16 }, scale: 1 },
	});
const FILES = {
	'page.webp': WEBP,
	'page.ktx2': KTX2,
	'page@half.webp': WEBP,
	'page@half.ktx2': KTX2,
	'sheet.json': sheet('page.webp'),
	'sheet.ktx2.json': sheet('page.ktx2'),
	'sheet@half.json': sheet('page@half.webp'),
	'sheet@half.ktx2.json': sheet('page@half.ktx2'),
	'image.webp': WEBP,
	'image.ktx2': KTX2,
	'image@half.webp': WEBP,
	'image@half.ktx2': KTX2,
};
for (const [name, bytes] of Object.entries(FILES)) writeFileSync(join(ART, name), bytes);
const ART_FILES = new Set(Object.keys(FILES).filter((f) => !f.endsWith('.json')));

const reference = bookofReferenceLayout();
const doc4k = rescaleCanvas(reference, 2.7, reference.layoutProfile ?? DEFAULT_LAYOUT_PROFILE).doc;
const SHEET_KEY = 'probe/manifests/atlas_manifest_S_Probe.json';
const IMAGE_KEY = 'probe/images/I_Probe.png';
// Placed, or the runtime leaves the art unloaded (`stockAssets.ts` `editorArtUnused`).
const basegame = doc4k.scenes.find((s) => s.id === 'basegame') ?? doc4k.scenes[0];
basegame.nodes.push(
	{ id: 'probe-sheet', kind: 'sprite', x: 900, y: 1200, assetKey: SHEET_KEY, region: 'panel' },
	{ id: 'probe-image', kind: 'sprite', x: 2900, y: 1200, assetKey: IMAGE_KEY },
);
const bundle = (assetBase) => ({
	assetBase,
	doc: doc4k,
	editorArt: {
		sheets: [
			{
				key: SHEET_KEY,
				json: 'sheet.json',
				ktx2Json: 'sheet.ktx2.json',
				names: ['panel'],
				tiers: { half: { json: 'sheet@half.json', ktx2Json: 'sheet@half.ktx2.json' } },
			},
		],
		images: [
			{
				key: IMAGE_KEY,
				file: 'image.webp',
				ktx2: 'image.ktx2',
				tiers: {
					half: {
						file: 'image@half.webp',
						resolution: 0.5,
						ktx2: 'image@half.ktx2',
						ktx2Resolution: 0.5,
					},
				},
			},
		],
		spines: [],
	},
});

// ---------- the devices ----------

const DESKTOP_UA =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const ADRENO_830 = 'ANGLE (Qualcomm, Adreno (TM) 830, OpenGL ES 3.2)';
const ADRENO_740 = 'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)';
/** `WEBGL_debug_renderer_info`'s unmasked renderer answered with `name`, before any page script. */
const gpuName = (name) => `(() => {
	for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
		const get = C.prototype.getParameter;
		C.prototype.getParameter = function (p) { return p === 0x9246 ? ${JSON.stringify(name)} : get.call(this, p); };
	}
})();`;
/** The zoom and layout width as the page saw them at its first script and at DOMContentLoaded. */
const ZOOM_TRACE = `(() => {
	const at = () => ({ scale: visualViewport.scale, inner: innerWidth + 'x' + innerHeight });
	window.__probeZoom = { start: at() };
	document.addEventListener('DOMContentLoaded', () => (window.__probeZoom.ready = at()));
})();`;

const S25 = {
	metrics: {
		width: 384,
		height: 694,
		deviceScaleFactor: 2.8125,
		mobile: true,
		screenWidth: 384,
		screenHeight: 832,
	},
	touch: true,
	desktopSite: true,
	gpu: ADRENO_830,
};
const TABLET = {
	metrics: {
		width: 1280,
		height: 712,
		deviceScaleFactor: 2,
		mobile: true,
		screenWidth: 1280,
		screenHeight: 800,
	},
	touch: true,
	desktopSite: true,
};
const RUNS = {
	s25: S25,
	's25-high': { ...S25, query: { quality: 'high' } },
	tablet: { ...TABLET, gpu: ADRENO_740 },
	'tablet-sw': TABLET,
	desktop: { metrics: { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false } },
	'desktop-2x': { metrics: { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false } },
};

// ---------- run ----------

/** A copy of `dir` whose page drops its viewport meta: Chrome's Desktop site ignores it. */
const desktopSiteCopy = (dir, name) => {
	const copy = join(OUT, `desktop-site-${name}`);
	cpSync(dir, copy, { recursive: true });
	const index = join(copy, 'index.html');
	const html = readFileSync(index, 'utf8');
	const stripped = html.replace(/<meta name="viewport"[^>]*>/, '');
	if (stripped === html) throw new Error(`${dir}/index.html has no viewport meta to drop`);
	writeFileSync(index, stripped);
	return copy;
};

const builds = {
	head: resolve(opt.build),
	...(opt['base-build'] && { base: resolve(opt['base-build']) }),
};
const results = {};
for (const [side, dir] of Object.entries(builds)) {
	const desktopSite = desktopSiteCopy(dir, side);
	for (const [name, run] of Object.entries(RUNS)) {
		const host = serveStatic({ '/': run.desktopSite ? desktopSite : dir, '/probe-art/': ART });
		const origin = `http://127.0.0.1:${await listen(host)}`;
		const mock = await startBookMock('device-class');
		const runtime = serveJson(bundle(`${origin}/probe-art/`));
		const params = new URLSearchParams({
			sessionID: `device-class-${side}-${name}`,
			rgs_url: `127.0.0.1:${mock.port}`,
			lang: 'en',
			currency: 'USD',
			runtime: '1',
			perf: '1',
			k: 'local',
			project: 'device-class',
			editorDocBase: `http://127.0.0.1:${await listen(runtime)}`,
			...run.query,
		});
		const browser = await openBrowser({
			chrome: CHROME,
			profile: join(OUT, `profile-${side}-${name}`),
			width: run.metrics.width,
			height: run.metrics.height,
		});
		try {
			await browser.page('Emulation.setDeviceMetricsOverride', run.metrics);
			await browser.page('Emulation.setUserAgentOverride', {
				userAgent: DESKTOP_UA,
				platform: 'Linux x86_64',
			});
			if (run.touch)
				await browser.page('Emulation.setTouchEmulationEnabled', {
					enabled: true,
					maxTouchPoints: 5,
				});
			await browser.page('Page.addScriptToEvaluateOnNewDocument', { source: ZOOM_TRACE });
			if (run.gpu)
				await browser.page('Page.addScriptToEvaluateOnNewDocument', { source: gpuName(run.gpu) });
			await browser.boot(`${origin}/?${params}`);
			await sleep(4000);
			await browser.tap();
			await sleep(4000);
			const page = await browser.evaluate(`(() => {
				const perf = window.__IE_PERF__ ? JSON.parse(window.__IE_PERF__()) : undefined;
				const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
				return {
					touchPoints: navigator.maxTouchPoints,
					coarse: matchMedia('(pointer: coarse)').matches,
					dpr: devicePixelRatio,
					zoom: visualViewport.scale,
					viewport: innerWidth + 'x' + innerHeight,
					zoomTrace: window.__probeZoom,
					canvas: canvas && canvas.width + 'x' + canvas.height,
					resolution: perf && perf.resolution,
					device: perf && perf.device,
					textures: perf && perf.textures,
				};
			})()`);
			const art = [
				...new Set(
					host.served
						.filter((u) => u.startsWith('/probe-art/'))
						.map((u) => u.slice('/probe-art/'.length))
						.filter((f) => ART_FILES.has(f)),
				),
			].sort();
			results[`${side}:${name}`] = { ...page, art };
			const errors = browser.log.filter((l) => /error|exception|netfail/i.test(l));
			if (errors.length) console.log(`${side}:${name} page log:`, errors.slice(0, 6));
		} finally {
			browser.close();
			mock.stop();
			runtime.close();
			host.close();
		}
	}
}

let failed = false;
const ok = (label, condition, detail = '') => {
	if (!condition) failed = true;
	console.log(`${condition ? '  ok  ' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
for (const [key, r] of Object.entries(results)) {
	console.log(`\n${key}`);
	console.log(
		`  touch ${r.touchPoints} · ${r.coarse ? 'coarse' : 'not coarse'} · DPR ${r.dpr} · zoom ${r.zoom} · viewport ${r.viewport}`,
	);
	console.log(`  zoom at first script ${JSON.stringify(r.zoomTrace)}`);
	console.log(`  canvas ${r.canvas} · resolution ${r.resolution}`);
	if (r.device) console.log(`  device ${JSON.stringify(r.device)}`);
	console.log(`  art requested: ${r.art.join(', ') || 'none'}`);
	console.log(`  textures: ${JSON.stringify(r.textures)}`);
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, '\t'));

const ktx2 = (r) => r.art.some((f) => f.endsWith('.ktx2'));
const webp = (r) => r.art.some((f) => f.endsWith('.webp'));
const half = (r) => r.art.length > 0 && r.art.every((f) => f.includes('@half'));
const head = (name) => results[`head:${name}`];
console.log('\nexpectations (head)');
ok(
	'the S25 emulation reads touch, a coarse pointer and a zoomed-out page',
	head('s25').touchPoints > 0 && head('s25').coarse && head('s25').zoom < 1,
);
ok('S25: KTX2 art only', ktx2(head('s25')) && !webp(head('s25')), head('s25').art.join(', '));
ok('S25: the half tier only', half(head('s25')), head('s25').art.join(', '));
ok(
	'S25: a canvas no wider than the screen (1080 px)',
	Number(head('s25').canvas.split('x')[0]) <= 1080,
	head('s25').canvas,
);
ok(
	'S25 ?quality=high: WebP only',
	webp(head('s25-high')) && !ktx2(head('s25-high')),
	head('s25-high').art.join(', '),
);
ok(
	'tablet (Adreno 740): KTX2, decided by its GPU',
	ktx2(head('tablet')) && head('tablet').device?.reason === 'phone-gpu',
	JSON.stringify(head('tablet').device),
);
ok(
	'tablet with a desktop GPU name: WebP',
	webp(head('tablet-sw')) && !ktx2(head('tablet-sw')),
	head('tablet-sw').art.join(', '),
);
ok(
	'desktop: WebP, no GPU read',
	webp(head('desktop')) && !ktx2(head('desktop')) && head('desktop').device?.reason === 'no-touch',
	JSON.stringify(head('desktop').device),
);
if (builds.base) {
	console.log('\nexpectations (base vs head)');
	for (const name of ['desktop', 'desktop-2x', 'tablet-sw']) {
		const [b, h] = [results[`base:${name}`], results[`head:${name}`]];
		ok(
			`${name}: the same art on both`,
			b.art.join() === h.art.join(),
			`${b.art.join(', ')} | ${h.art.join(', ')}`,
		);
		ok(`${name}: the same canvas on both`, b.canvas === h.canvas, `${b.canvas} | ${h.canvas}`);
	}
	const b = results['base:s25'];
	ok(
		'base S25 (before): WebP, full tier, a 2× canvas',
		webp(b) && !ktx2(b) && !half(b),
		`${b.art.join(', ')} · ${b.canvas}`,
	);
}
console.log(`\nresults: ${join(OUT, 'results.json')}`);
process.exit(failed ? 1 : 0);
