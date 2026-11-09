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
// (`<label>-diff.png`). Exit 1 when more than 2% of the window differs. A real clock leaves a little
// noise under that: the background's animated smoke and particles, the win glow caught at a
// slightly different moment, and the HUD clock when a minute turns between the two runs. A layout
// that does not follow the canvas moves whole regions (the coded board on `lines`: ~11%).
//
// Real clock, not `?ie_determinism`: on Windows the determinism hook holds the boot on its loading
// screen (determinism-proof.mjs fails there the same way), so the spin outcome comes from the
// mock's SEED and the captures from waits. Writes both runs' PNGs to --out.

import { mkdirSync, writeFileSync } from 'node:fs';
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
/** Share of the window allowed to differ: the real clock's noise measured 0.05–0.99% (a win
 *  symbol caught a frame apart), a layout that does not follow the canvas 11–13%. */
const ALLOWED = 0.02;
const OUT =
	opt.out ?? join(tmpdir(), `ie-canvas-scale-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const CHROME = headlessShell(opt.chrome);

const { defaultLayout } =
	await import('../../packages/engine-layout/src/lib/referenceLayouts/lines.ts');
const { bookofReferenceLayout } =
	await import('../../packages/engine-layout/src/lib/referenceLayouts/bookof.ts');
const { DEFAULT_LAYOUT_PROFILE } = await import('../../packages/constants-shared/layoutProfile.ts');
const { rescaleCanvas } = await import('../../packages/engine-layout/src/lib/canvasRescale.ts');

const build = resolve(opt.build);
const buildServer = serveStatic({ '/': build });
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
	const mock = await startBookMock(SEED);
	// `/api/editor/doc` — the path a non-runtime boot reads its layout from (`?k=` + `editorDocBase`).
	const docServer = serveJson({ doc });
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
	const browser = await openBrowser({
		chrome: CHROME,
		profile: join(OUT, `profile-${name}`),
		width: W,
		height: H,
	});
	shots[name] = {};
	const capture = async (label) => {
		shots[name][label] = await browser.capture();
		writeFileSync(join(OUT, `${name}-${label}.png`), shots[name][label]);
	};
	try {
		await browser.boot(`${origin}/?${params}`);
		await sleep(4000);
		await browser.tap();
		await sleep(4000);
		await capture('idle');
		await browser.tap();
		await sleep(15000);
		await capture('settled');
	} finally {
		if (browser.log.length) console.log(`${name} page log:`, browser.log.slice(0, 40));
		browser.close();
		mock.stop();
		docServer.close();
	}
}
buildServer.close();

let failed = false;
for (const label of Object.keys(shots.native)) {
	const d = diffPngs(shots.native[label], shots.scaled[label], TOLERANCE);
	const flag = d.share > ALLOWED;
	if (flag) failed = true;
	writeFileSync(join(OUT, `${label}-diff.png`), d.map);
	console.log(describeDiff(label, d, flag));
}
console.log(`captures: ${OUT}`);
process.exit(failed ? 1 : 0);
