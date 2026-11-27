// SALMONS' RIVER, PIXEL FOR PIXEL AGAINST ANOTHER CHECKOUT: `salmonsArt/river.ts` of this checkout
// and of `--base` (a worktree of main, say, with its packages installed) drawn by a real WebGL
// renderer in the headless shell, with the built-in art, and compared pixel for pixel. Each case
// is a river (a seed and its levels), a projector, a canvas, a zoom, antialiasing and a
// resolution; its camera is walked along the river from stop to stop, a frame at a time on a
// fixed clock (so the culling, the chunks and every animation move as a game moves them), and the
// canvas is read at each stop. Nothing but the river is drawn (no players, no screens), so a
// difference is the river's.
//
//   git worktree add ../ie-main origin/main && (cd ../ie-main && pnpm install)
//   node scripts/salmons/river-pixels.mjs --base ../ie-main [--out <dir>] [--chrome <exe>]
//
// Prints each stop's count of differing pixels and their largest channel difference, and writes
// both pictures and a map of the differences (red) for every stop that differs. Exit 1 when any
// pixel differs.

import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { PNG } from 'pngjs';

import { openPage } from '../current-games/lib/browser.mjs';
import { headlessShell } from '../playtest/headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		base: { type: 'string' },
		out: { type: 'string', default: join(ROOT, '.cache/salmons-river-pixels') },
		chrome: { type: 'string' },
	},
});
if (!opt.base) {
	console.error('river-pixels: --base <checkout> is required');
	process.exit(2);
}
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const esbuild = createRequire(createRequire(join(ROOT, 'apps/lines/package.json')).resolve('vite'))(
	'esbuild',
);

/** The page's entry, for the checkout at `root`: `window.riverPixels.render(case)` draws one case
 *  and returns each stop's canvas as a PNG data URL; `stops(case)` the river's facts to place them. */
const entry = (root) => `
import { Application, Container } from 'pixi.js';
import { mountSalmonsRiver } from '${root}/packages/engine-layout/src/lib/salmonsArt/river.ts';
import { loadSalmonsTextures } from '${root}/packages/engine-layout/src/lib/salmonsArt/load.ts';
import { registerProjectedLayer } from '${root}/packages/engine-layout/src/lib/worldDrawing.svelte.ts';
import { ISO_PROJECTOR, ISO_PROJECTOR_MIRRORED } from '${root}/packages/engine-layout/src/lib/projection.ts';
import { SALMONS_FIELD_LAYER } from '${root}/packages/engine-layout/src/lib/referenceLayouts/salmonsRiver.ts';
import { levelShape, salmonsMapRiver } from '${root}/packages/engine-mechanics/src/salmonsMap.js';
import { SALMONS_LEVELS } from '${root}/packages/engine-mechanics/src/salmons.js';

const LEVELS = {
	original: undefined,
	levels: SALMONS_LEVELS,
	falls: { river: {}, waterfalls: { heightMin: 5, heightMax: 10 } },
	biomes: {
		...SALMONS_LEVELS,
		biomes: {
			kinds: [
				{ id: 'birch', trees: [4], forestFloor: '#6a5a2a', grassTint: '#e0f0a0', riverbed: ['#101010', '#202020'], grass: 2, forest: 4 },
				{ id: 'forest1' },
			],
			sequences: { '*': [{ from: 0, biome: 'birch' }, { from: 200, biome: 'forest1' }] },
		},
	},
};
const riverOf = (c) => salmonsMapRiver(c.seed, undefined, levelShape(LEVELS[c.levels], c.seed));

async function render(c) {
	const app = new Application();
	await app.init({ width: c.w, height: c.h, preference: 'webgl', antialias: c.antialias, useBackBuffer: true, background: 0x000000, resolution: c.resolution, autoStart: false, preserveDrawingBuffer: true });
	document.body.appendChild(app.canvas);
	app.ticker.stop();
	const projector = c.mirrored ? ISO_PROJECTOR_MIRRORED : ISO_PROJECTOR;
	const camera = new Container();
	camera.scale.set(c.zoom);
	const into = new Container();
	const layer = new Container();
	camera.addChild(into, layer);
	app.stage.addChild(camera);
	const unregister = registerProjectedLayer(SALMONS_FIELD_LAYER, layer);
	const lookAt = (x, y) => {
		const p = projector.project(x, y);
		camera.position.set(c.w / 2 - c.zoom * p.x, c.h / 2 - c.zoom * p.y);
	};
	let time = 0;
	const frame = () => {
		time += 1000 / 60;
		app.ticker.update(time);
		app.renderer.render(app.stage);
	};
	lookAt(c.stops[0].x, c.stops[0].y);
	app.renderer.render(app.stage);
	const art = mountSalmonsRiver(into, app, await loadSalmonsTextures([]), riverOf(c), c.seed, projector);
	art.aboveWater();
	const shots = [];
	for (let s = 1; s < c.stops.length; s++) {
		const [a, b] = [c.stops[s - 1], c.stops[s]];
		for (let i = 1; i <= c.steps; i++) {
			const t = i / c.steps;
			// Off the pixel grid, as a camera that follows a body is.
			lookAt(a.x + (b.x - a.x) * t + 0.37, a.y + (b.y - a.y) * t + 0.21);
			frame();
		}
		for (let i = 0; i < c.settle; i++) frame();
		shots.push(app.canvas.toDataURL('image/png'));
	}
	const regions = art.regions();
	art.teardown();
	unregister();
	app.destroy(true);
	return { shots, regions };
}

function stops(c) {
	const river = riverOf(c);
	return { bands: river.bands, waterfalls: river.waterfalls ?? [], world: river.world, sea: river.sea };
}

window.riverPixels = { render, stops };
`;

const CASES = [
	{
		seed: 1,
		levels: 'original',
		mirrored: true,
		w: 960,
		h: 540,
		zoom: 1,
		antialias: true,
		resolution: 1,
	},
	{
		seed: 7,
		levels: 'levels',
		mirrored: true,
		w: 390,
		h: 844,
		zoom: 1,
		antialias: true,
		resolution: 2,
	},
	{
		seed: 123,
		levels: 'falls',
		mirrored: true,
		w: 960,
		h: 540,
		zoom: 0.75,
		antialias: false,
		resolution: 1,
	},
	{
		seed: 42,
		levels: 'original',
		mirrored: false,
		w: 960,
		h: 540,
		zoom: 1,
		antialias: true,
		resolution: 1,
	},
	{
		seed: 7,
		levels: 'biomes',
		mirrored: true,
		w: 960,
		h: 540,
		zoom: 1.25,
		antialias: true,
		resolution: 1,
	},
];
const CELL = 48;

const work = mkdtempSync(join(tmpdir(), 'salmons-river-pixels-'));
const trees = { base: resolve(opt.base), here: ROOT };
for (const [name, root] of Object.entries(trees)) {
	await esbuild.build({
		stdin: {
			contents: entry(root),
			resolveDir: join(root, 'packages/engine-layout'),
			loader: 'ts',
			sourcefile: 'river-pixels.ts',
		},
		bundle: true,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		outfile: join(work, name, 'bundle.js'),
		logLevel: 'warning',
	});
	// The built-in sheets, where the bundle's `new URL(…, import.meta.url)` looks for them.
	cpSync(
		join(root, 'packages/engine-layout/src/lib/salmonsArt/sheets'),
		join(work, name, 'sheets'),
		{
			recursive: true,
		},
	);
}
writeFileSync(join(work, 'index.html'), '<!doctype html><body style="margin:0"></body>');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp' };
const server = createServer((req, res) => {
	const path = join(work, decodeURIComponent(new URL(req.url, 'http://x').pathname));
	if (!path.startsWith(work) || !existsSync(path)) return res.writeHead(404).end();
	res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
	res.end(readFileSync(path));
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const origin = `http://127.0.0.1:${server.address().port}`;

const pages = {};
let failed = 0;
try {
	for (const name of Object.keys(trees)) {
		const page = await openPage(headlessShell(opt.chrome), join(work, `profile-${name}`));
		await page.navigate(`${origin}/index.html`);
		for (let i = 0; i < 100 && !(await page.evaluate('document.readyState === "complete"')); i++)
			await new Promise((r) => setTimeout(r, 50));
		await page.evaluate(`import('${origin}/${name}/bundle.js').then(() => true)`);
		pages[name] = page;
	}
	const decode = (url) => PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
	for (const c of CASES) {
		const river = await pages.base.evaluate(`window.riverPixels.stops(${JSON.stringify(c)})`);
		const n = river.bands.length;
		const mid = (i) => {
			const b = river.bands[Math.min(n - 1, Math.max(0, Math.round(i)))];
			return { x: (b.left + b.right) / 2, y: b.y + b.h / 2 };
		};
		const stops = [mid(n * 0.95), mid(n * 0.8), mid(n * 0.6)];
		for (const fall of river.waterfalls.slice(0, 3))
			stops.push({ x: fall.x + fall.w / 2, y: fall.y + fall.h + CELL * 2 });
		stops.push(mid(n * 0.35), mid(n * 0.1), mid(1), {
			x: river.world.w / 2,
			y: river.sea.y + CELL * 3,
		});
		const run = JSON.stringify({ ...c, stops, steps: 10, settle: 3 });
		const [base, here] = await Promise.all(
			[pages.base, pages.here].map((page) => page.evaluate(`window.riverPixels.render(${run})`)),
		);
		const tag = `${c.seed}-${c.levels}-${c.mirrored ? 'mirrored' : 'plain'}-${c.w}x${c.h}-z${c.zoom}-${c.antialias ? 'aa' : 'noaa'}-r${c.resolution}`;
		base.shots.forEach((shot, i) => {
			const a = decode(shot);
			const b = decode(here.shots[i]);
			const map = new PNG({ width: a.width, height: a.height });
			let differ = 0;
			let most = 0;
			for (let k = 0; k < a.data.length; k += 4) {
				let d = 0;
				for (let ch = 0; ch < 4; ch++) d = Math.max(d, Math.abs(a.data[k + ch] - b.data[k + ch]));
				if (d) differ++;
				most = Math.max(most, d);
				for (let ch = 0; ch < 3; ch++) map.data[k + ch] = d ? (ch ? 0 : 255) : a.data[k + ch] >> 2;
				map.data[k + 3] = 255;
			}
			const name = `${tag}-stop${i + 1}`;
			if (differ) {
				failed++;
				writeFileSync(join(out, `${name}.base.png`), PNG.sync.write(a));
				writeFileSync(join(out, `${name}.here.png`), PNG.sync.write(b));
				writeFileSync(join(out, `${name}.diff.png`), PNG.sync.write(map));
			}
			console.log(`  ${differ ? 'DIFF' : 'same'}  ${name}: ${differ} px differ, by up to ${most}`);
		});
		if (JSON.stringify(base.regions) !== JSON.stringify(here.regions)) {
			failed++;
			console.log(`  DIFF  ${tag}: the regions drawn differ`);
		}
	}
} finally {
	for (const page of Object.values(pages)) await page.close();
	server.close();
	rmSync(work, { recursive: true, force: true });
}
console.log(
	failed
		? `\nriver-pixels: ${failed} stop(s) differ → ${out}`
		: '\nriver-pixels: every stop the same',
);
process.exit(failed ? 1 : 0);
