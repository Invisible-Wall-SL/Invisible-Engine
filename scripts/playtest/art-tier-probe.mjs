// Does a device load the art tier it should, and does that art draw at full size?
// (docs/design/arcade-4k-builds.md Phase 4)
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
//     scripts/playtest/art-tier-probe.mjs [--build apps/lines/build] [--out <dir>]
//
// Boots the BUILT runtime (`?runtime=1`) against a local runtime-bundle stub carrying a 4K game: the
// Book-of reference rescaled ×2, plus two pieces of art made for it, each published the way the
// launcher publishes a tier (`docs/design/arcade-4k-builds.md` Phase 3) —
//   - a sprite SHEET (one region of a 3000×1600 page) with its half page and a `@half.json` written
//     by the launcher's own `sheetOnPage`;
//   - a standalone IMAGE (1400×900) with its half copy and the resolution it loads at;
//   - a FLIPBOOK clip over two frames of that sheet (the form a video render ships in), with no
//     tier of its own: it must ride the sheet's.
// All are placed at their natural size, which is exactly where a wrong scale would show.
//
// Runs, all in a 1280×720 window (the Book-of canvas, 2844×1600 at 4K, shows at 0.45 of its size, so
// auto picks `half`):
//   auto        must load the `@half` files and nothing of the full pages;
//   full        `?tier=full` must load the full pages and nothing `@half`;
//   no-res      the image's tier entry WITHOUT its resolution (a negative control): the half image
//               then draws at half size, so this capture must differ from `full` where it sits.
// `auto` must look like `full` (half art drawn at under half of 4K is the same picture). Exit 1 on any
// failure. Real clock, like canvas-scale-probe.mjs.

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { headlessShell } from './headless-shell.mjs';
import {
	ROOT,
	describeDiff,
	diffPngs,
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
		build: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string' },
		chrome: { type: 'string' },
	},
});
const W = 1280;
const H = 720;
const TOLERANCE = 24;
const OUT =
	opt.out ?? join(tmpdir(), `ie-art-tier-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const ART = join(OUT, 'art');
mkdirSync(join(ART, 'sheet'), { recursive: true });
const CHROME = headlessShell(opt.chrome);

const { bookofReferenceLayout } =
	await import('../../packages/engine-layout/src/lib/referenceLayouts/bookof.ts');
const { DEFAULT_LAYOUT_PROFILE } = await import('../../packages/constants-shared/layoutProfile.ts');
const { rescaleCanvas } = await import('../../packages/engine-layout/src/lib/canvasRescale.ts');
const { sheetOnPage } = await import('../../apps/launcher-api/src/lib/server/sheetOnPage.ts');

// ---------- the art, published as the launcher publishes a tier ----------

/** A page of big colour blocks with a dark border: easy to see, and a wrong size moves its edges. */
const blocks = async (width, height, colours) => {
	const cell = Math.round(width / colours.length);
	return sharp({ create: { width, height, channels: 4, background: '#202020' } })
		.composite(
			await Promise.all(
				colours.map(async (background, i) => ({
					input: await sharp({
						create: {
							width: cell - 24,
							height: height - 24,
							channels: 4,
							background,
						},
					})
						.png()
						.toBuffer(),
					left: i * cell + 12,
					top: 12,
				})),
			),
		)
		.png()
		.toBuffer();
};
const half = (png, width, height) =>
	sharp(png)
		.resize(Math.round(width / 2), Math.round(height / 2), { fit: 'fill' })
		.webp({ quality: 95 })
		.toBuffer();
const write = (rel, bytes) => writeFileSync(join(ART, rel), bytes);

const SHEET_W = 3000;
const SHEET_H = 1600;
const sheetPage = await sharp({
	create: { width: SHEET_W, height: SHEET_H, channels: 4, background: '#000000' },
})
	.composite([
		{ input: await blocks(1200, 800, ['#e94e77', '#f9d423', '#5cc8ff']), left: 0, top: 0 },
		// Two clip frames with the SAME picture under two names, so the clip looks the same at
		// whatever moment a real-clock capture lands on.
		{ input: await blocks(600, 400, ['#ffffff', '#00b3a4']), left: 1300, top: 0 },
		{ input: await blocks(600, 400, ['#ffffff', '#00b3a4']), left: 1300, top: 450 },
	])
	.png()
	.toBuffer();
write('sheet/page.webp', await sharp(sheetPage).webp({ quality: 95 }).toBuffer());
write('sheet/page@half.webp', await half(sheetPage, SHEET_W, SHEET_H));
const frame = (r) => ({
	frame: r,
	rotated: false,
	trimmed: false,
	spriteSourceSize: { ...r, x: 0, y: 0 },
	sourceSize: { w: r.w, h: r.h },
});
const sheet = {
	frames: {
		panel: frame({ x: 0, y: 0, w: 1200, h: 800 }),
		flipA: frame({ x: 1300, y: 0, w: 600, h: 400 }),
		flipB: frame({ x: 1300, y: 450, w: 600, h: 400 }),
	},
	meta: {
		app: 'art-tier-probe',
		format: 'RGBA8888',
		image: 'page.webp',
		scale: '1',
		size: { w: SHEET_W, h: SHEET_H },
	},
};
write('sheet/sheet.json', JSON.stringify(sheet));
write(
	'sheet/sheet@half.json',
	JSON.stringify(sheetOnPage(sheet, 'page@half.webp', SHEET_W / 2, SHEET_H / 2)),
);

const IMAGE_W = 1400;
const IMAGE_H = 900;
const image = await blocks(IMAGE_W, IMAGE_H, ['#7ed957', '#b06ab3', '#ff914d']);
write('image.webp', await sharp(image).webp({ quality: 95 }).toBuffer());
write('image@half.webp', await half(image, IMAGE_W, IMAGE_H));

// ---------- the 4K game ----------

const SHEET_KEY = 'probe/manifests/atlas_manifest_S_Probe.json';
const IMAGE_KEY = 'probe/images/I_Probe.png';
const reference = bookofReferenceLayout();
const doc4k = rescaleCanvas(reference, 2, reference.layoutProfile ?? DEFAULT_LAYOUT_PROFILE).doc;
const basegame = doc4k.scenes.find((s) => s.id === 'basegame') ?? doc4k.scenes[0];
basegame.nodes.push(
	{
		id: 'probe-sheet',
		kind: 'sprite',
		x: 700,
		y: 1100,
		assetKey: SHEET_KEY,
		region: 'panel',
		anchor: { x: 0.5, y: 0.5 },
	},
	{
		id: 'probe-image',
		kind: 'sprite',
		x: 2300,
		y: 1100,
		assetKey: IMAGE_KEY,
		anchor: { x: 0.5, y: 0.5 },
	},
	// A flipbook clip over the same tiered sheet (Phase 5: clips, the form a video render ships
	// in, ride the sheet tiers with no tier of their own).
	{
		id: 'probe-clip',
		kind: 'flipbook',
		clipId: 'probe-clip',
		x: 1450,
		y: 330,
		anchor: { x: 0.5, y: 0.5 },
	},
);
const clip = {
	id: 'probe-clip',
	name: 'probe clip',
	assetKey: SHEET_KEY,
	frames: ['flipA', 'flipB'],
	fps: 4,
	loop: true,
};

const editorArt = (imageTier) => ({
	sheets: [
		{
			key: SHEET_KEY,
			json: 'sheet/sheet.json',
			names: ['panel', 'flipA', 'flipB'],
			tiers: { half: { json: 'sheet/sheet@half.json' } },
		},
	],
	images: [{ key: IMAGE_KEY, file: 'image.webp', tiers: { half: imageTier } }],
	spines: [],
});

// ---------- run ----------

const build = resolve(opt.build);
const host = serveStatic({ '/': build, '/probe-art/': ART });
const origin = `http://127.0.0.1:${await listen(host)}`;
const RUNS = {
	auto: { tier: null, imageTier: { file: 'image@half.webp', resolution: 0.5 } },
	full: { tier: 'full', imageTier: { file: 'image@half.webp', resolution: 0.5 } },
	'no-res': { tier: null, imageTier: { file: 'image@half.webp' } },
};
const shots = {};
const loaded = {};
for (const [name, run] of Object.entries(RUNS)) {
	const mock = await startBookMock('art-tier');
	const runtime = serveJson({
		assetBase: `${origin}/probe-art/`,
		doc: doc4k,
		editorArt: editorArt(run.imageTier),
		flipbooks: [clip],
	});
	const params = new URLSearchParams({
		sessionID: `art-tier-${name}`,
		rgs_url: `127.0.0.1:${mock.port}`,
		lang: 'en',
		currency: 'USD',
		device: 'desktop',
		runtime: '1',
		k: 'local',
		project: 'art-tier',
		editorDocBase: `http://127.0.0.1:${await listen(runtime)}`,
	});
	if (run.tier) params.set('tier', run.tier);
	const browser = await openBrowser({
		chrome: CHROME,
		profile: join(OUT, `profile-${name}`),
		width: W,
		height: H,
	});
	try {
		await browser.boot(`${origin}/?${params}`);
		await sleep(4000);
		await browser.tap();
		await sleep(4000);
		shots[name] = await browser.capture();
		writeFileSync(join(OUT, `${name}.png`), shots[name]);
		loaded[name] = host.served
			.splice(0)
			.filter((u) => u.includes('/probe-art/'))
			.map((u) => u.split('/probe-art/')[1]);
	} finally {
		if (browser.log.some((l) => /error|exception/i.test(l)))
			console.log(
				`${name} page log:`,
				browser.log.filter((l) => /error|exception/i.test(l)).slice(0, 10),
			);
		browser.close();
		mock.stop();
		runtime.close();
	}
}
host.close();

let failed = false;
const ok = (label, condition, detail = '') => {
	if (!condition) failed = true;
	console.log(`${condition ? '  ok  ' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const has = (name, file) => loaded[name].some((u) => u.split('?')[0] === file);

console.log('what each run loaded:', JSON.stringify(loaded));
ok(
	'auto loads the half sheet and page',
	has('auto', 'sheet/sheet@half.json') && has('auto', 'sheet/page@half.webp'),
);
ok('auto loads the half image', has('auto', 'image@half.webp'));
ok(
	'auto loads none of the full pages',
	!has('auto', 'sheet/page.webp') && !has('auto', 'image.webp'),
);
ok('?tier=full loads the full pages', has('full', 'sheet/page.webp') && has('full', 'image.webp'));
ok('?tier=full loads nothing @half', !loaded.full.some((u) => u.includes('@half')));

const same = diffPngs(shots.full, shots.auto, TOLERANCE);
writeFileSync(join(OUT, 'auto-vs-full-diff.png'), same.map);
console.log(describeDiff('auto vs full', same, same.share > 0.01));
ok('half art draws like full art (≤1% of the window differs)', same.share <= 0.01);

const control = diffPngs(shots.full, shots['no-res'], TOLERANCE);
writeFileSync(join(OUT, 'no-res-vs-full-diff.png'), control.map);
console.log(describeDiff('no-res vs full', control, control.share > 0.01));
ok(
	'the control (half image with no resolution) visibly differs',
	control.share > 0.03,
	'the image must draw at half size — ten times the real-clock noise between auto and full',
);

console.log(`captures: ${OUT}`);
process.exit(failed ? 1 : 0);
