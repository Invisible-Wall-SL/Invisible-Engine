// SALMONS' BODIES, PIXEL FOR PIXEL AGAINST ANOTHER CHECKOUT: the salmon and the bear as
// `salmonsArt/looks.ts` and `wade.ts` of this checkout and of `--base` draw them, by a real WebGL
// renderer in the headless shell, over a seeded backdrop (so a blend that is off shows), and
// compared pixel for pixel. Each case is a canvas, a zoom, antialiasing and a resolution; its
// bodies swim under the water's tints, surface, leap, swim in the sea (no tint, its glint drawn
// straight onto the scene), lie on a bank, swim red through blood and swim gold; its bears stand on
// the bank, wade in and stand half under. A fixed clock moves them and `Math.random` is seeded
// alike in both, so their glints flash at the same moments; the canvas is read at each stop. Only
// the bodies and the backdrop are drawn, so a difference is theirs, except in the last case, which
// also draws a river under them and walks the renderer's resolution down and back as the quality
// ladder does, printing any warning either checkout logs (with its stack).
//
// The base is the filter-drawn bodies; this checkout draws them in their own programs, so the
// differences it prints are explained in `docs/status/salmons.md` (T5): one level of 8-bit
// rounding inside a body, the outline of a salmon under the water (its pass was drawn without
// MSAA), and at resolution 2 every salmon under the water (its pass ran at resolution 1).
//
//   git worktree add ../ie-base <base branch> && (cd ../ie-base && pnpm install)
//   node scripts/salmons/bodies-pixels.mjs --base ../ie-base [--out <dir>] [--chrome <exe>]
//
// Prints each stop's count of differing pixels and their largest channel difference, how many of
// them differ by one level only (an 8-bit rounding) and whose they are (`id count/largest`, `~` for
// a body drawn under the water, `-` outside every body's box), and writes both pictures and a map
// of the differences (red) for every stop that differs; and for each case how often the root's
// draw list was rebuilt and how many filter passes were pushed, a frame. Exit 1 when any pixel
// differs by more than `--tolerance` levels (default 0). `--only 0,2` runs those cases alone.

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
		out: { type: 'string', default: join(ROOT, '.cache/salmons-bodies-pixels') },
		chrome: { type: 'string' },
		tolerance: { type: 'string', default: '0' },
		only: { type: 'string' },
	},
});
if (!opt.base) {
	console.error('bodies-pixels: --base <checkout> is required');
	process.exit(2);
}
const tolerance = Number(opt.tolerance);
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const esbuild = createRequire(createRequire(join(ROOT, 'apps/lines/package.json')).resolve('vite'))(
	'esbuild',
);

/** The page's entry for the checkout at `root`: `window.bodiesPixels.render(case)` draws one case
 *  and returns each stop's canvas as a PNG data URL, with what each body drew. */
const entry = (root) => `
import { Application, Container, Sprite, Texture } from 'pixi.js';
import { createLookFactory } from '${root}/packages/engine-layout/src/lib/salmonsArt/looks.ts';
import { createWading } from '${root}/packages/engine-layout/src/lib/salmonsArt/wade.ts';
import { wadeSurface, warmWade } from '${root}/packages/engine-layout/src/lib/salmonsArt/wadeFilter.ts';
import { loadSalmonsTextures } from '${root}/packages/engine-layout/src/lib/salmonsArt/load.ts';
import { TINT_ALPHA } from '${root}/packages/engine-layout/src/lib/salmonsArt/water.ts';
import { mountSalmonsRiver } from '${root}/packages/engine-layout/src/lib/salmonsArt/river.ts';
import { ISO_PROJECTOR } from '${root}/packages/engine-layout/src/lib/projection.ts';
import { levelShape, salmonsMapRiver } from '${root}/packages/engine-mechanics/src/salmonsMap.js';
import { SALMONS_LEVELS } from '${root}/packages/engine-mechanics/src/salmons.js';

const seeded = (seed) => () => {
	seed |= 0;
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A backdrop of seeded colour noise in 8 px squares over soft bands: every blend shows on it. */
function backdrop(w, h) {
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	const random = seeded(99);
	for (let y = 0; y < h; y += 8)
		for (let x = 0; x < w; x += 8) {
			const r = Math.floor(random() * 256);
			const g = Math.floor(80 + random() * 120);
			const b = Math.floor(120 + random() * 136);
			ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
			ctx.fillRect(x, y, 8, 8);
		}
	return Texture.from(canvas);
}

// The water: world x < 0 a bank, 0..400 water, 400..800 rapids, from 800 the sea (no tint).
const waterAt = (x) =>
	x < 0 ? undefined : x < 400 ? { tint: 0x0ea5e9 } : x < 800 ? { tint: 0x38bdf8 } : { tint: undefined };

/** Each body: its character, where it starts and how it moves (world px per second), how high the
 *  room lifts it (a leap), whether it is marked, held (climbing) or swims through blood. */
const BODIES = [
	{ id: 's1', character: 'salmon', x: 100, y: 60, vx: 40, vy: -10 },
	{ id: 's2', character: 'salmon', x: 300, y: 200, vx: -30, vy: 20 },
	{ id: 's3', character: 'salmon', x: 500, y: 100, vx: 25, vy: 25 },
	{ id: 's4', character: 'salmon', x: 650, y: 260, vx: 0, vy: -35, red: true },
	{ id: 's5', character: 'salmon', x: 200, y: 330, vx: 30, vy: 0, marked: true },
	{ id: 's6', character: 'salmon', x: 900, y: 150, vx: -20, vy: 10 },
	{ id: 's7', character: 'salmon', x: 350, y: 420, vx: 10, vy: -20, leap: true },
	{ id: 's8', character: 'salmon', x: -120, y: 200, vx: 15, vy: 15 },
	{ id: 's9', character: 'salmon', x: 120, y: 480, vx: 0, vy: 0, held: true },
	{ id: 's10', character: 'salmon', x: 1000, y: 380, vx: 20, vy: -5, marked: true },
	{ id: 'b1', character: 'bear', x: 180, y: 140, vx: 20, vy: 10 },
	{ id: 'b2', character: 'bear', x: -60, y: 380, vx: 60, vy: 0 },
	{ id: 'b3', character: 'bear', x: -200, y: 40, vx: 10, vy: 30 },
	{ id: 'b4', character: 'bear', x: 560, y: 380, vx: -15, vy: -15, swipe: true },
];
const STATUS_FREE = 0;
const project = (x, y) => ({ x: x - y, y: (x + y) / 2 });

async function render(c) {
	Math.random = seeded(7);
	const app = new Application();
	await app.init({ width: c.w, height: c.h, preference: 'webgl', antialias: c.antialias, useBackBuffer: true, background: 0x000000, resolution: c.resolution, autoStart: false, preserveDrawingBuffer: true });
	document.body.appendChild(app.canvas);
	app.ticker.stop();
	const back = new Sprite(backdrop(c.w, c.h));
	app.stage.addChild(back);

	const camera = new Container();
	camera.scale.set(c.zoom);
	camera.position.set(c.w / 2 - c.zoom * 200 + 0.37, c.h * 0.2 + 0.21);
	app.stage.addChild(camera);
	const textures = await loadSalmonsTextures([]);
	let river;
	if (c.ladder) {
		// The river under the bodies, its bed's displacement filter a full-screen pass.
		const ground = new Container();
		camera.addChildAt(ground, 0);
		const seed = 7;
		river = mountSalmonsRiver(ground, app, textures, salmonsMapRiver(seed, undefined, levelShape(SALMONS_LEVELS, seed)), seed, ISO_PROJECTOR);
	}
	const blood = { sink: () => {}, touches: () => true, shed: () => {} };
	const looks = createLookFactory(textures, waterAt, TINT_ALPHA, blood);
	const wading = createWading(waterAt, TINT_ALPHA, wadeSurface);
	warmWade(app);
	const placed = BODIES.map((b) => {
		const look = looks.look(b.character, { w: b.character === 'bear' ? 80 : 50, h: 30 });
		const holder = new Container();
		camera.addChild(holder);
		const lift = new Container();
		holder.addChild(lift);
		return { b, look, holder, lift, into: undefined, mount: undefined, teardown: undefined };
	});
	// What a frame costs the renderer: the root's draw list rebuilt, and the filter passes pushed.
	const groups = app.renderer.renderGroup;
	const build = groups._buildInstructions.bind(groups);
	const counted = { frames: 0, rebuilds: 0, passes: 0 };
	groups._buildInstructions = (group, renderer) => {
		if (group === app.stage.renderGroup) counted.rebuilds++;
		return build(group, renderer);
	};
	const filters = app.renderer.filter;
	const push = filters.push.bind(filters);
	filters.push = (instruction) => {
		counted.passes++;
		return push(instruction);
	};
	let time = 0;
	const frame = () => {
		time += 1000 / 60;
		for (const p of placed) {
			const { b } = p;
			const t = time / 1000;
			const x = b.x + b.vx * t;
			const y = b.y + b.vy * t;
			const at = project(x, y);
			p.holder.position.set(at.x, at.y);
			const z = b.leap ? Math.max(0, Math.sin(t * 3) * 70) : 0;
			if (b.swipe && Math.floor(time / 400) % 2 === 0 && time % 400 < 17) p.look.event('ability', time);
			p.look.frame({ atMs: time, x, y, status: STATUS_FREE, z, held: !!b.held, marked: !!b.marked, project });
			const mount = wading.mount(b.id, p.look.mount, { character: b.character, x, y, atMs: time, middle: p.look.middle, width: 80 });
			if (mount !== p.mount) {
				p.teardown?.();
				const into = new Container();
				p.lift.addChild(into);
				p.into = into;
				p.mount = mount;
				p.teardown = mount(into, app);
			}
		}
		app.renderer.render(app.stage);
		counted.frames++;
	};
	const shots = [];
	const boxes = [];
	const warned = [];
	const warn = console.warn;
	console.warn = (...args) => {
		warned.push(String(args[0]) + ' | ' + new Error().stack.split('\\n').slice(2, 14).join(' < '));
		warn(...args);
	};
	for (let s = 0; s < c.stops; s++) {
		if (c.ladder && s === 3) app.renderer.resolution = c.resolution * 0.75;
		if (c.ladder && s === 6) app.renderer.resolution = c.resolution;
		for (let i = 0; i < c.every; i++) frame();
		shots.push(app.canvas.toDataURL('image/png'));
		boxes.push(
			placed.map((p) => {
				const box = p.holder.getBounds();
				const r = c.resolution;
				const d = p.look.drawn();
				return { id: p.b.id, x: box.minX * r, y: box.minY * r, w: box.width * r, h: box.height * r, under: d.underwater === true };
			}),
		);
	}
	const drawn = Object.fromEntries(placed.map((p) => [p.b.id, p.look.drawn()]));
	for (const p of placed) {
		p.teardown?.();
		p.look.destroy();
	}
	river?.teardown();
	wading.destroy();
	looks.destroy();
	app.destroy(true);
	console.warn = warn;
	return { shots, drawn, boxes, counted, warned };
}

window.bodiesPixels = { render };
`;

const CASES = [
	{ w: 960, h: 600, zoom: 1, antialias: true, resolution: 1 },
	{ w: 960, h: 600, zoom: 1.5, antialias: false, resolution: 1 },
	{ w: 960, h: 600, zoom: 0.8, antialias: true, resolution: 1 },
	{ w: 480, h: 400, zoom: 1, antialias: true, resolution: 2 },
	{ w: 480, h: 400, zoom: 1, antialias: true, resolution: 2, ladder: true },
].filter((c, i) => opt.only === undefined || opt.only.split(',').includes(String(i)));

const work = mkdtempSync(join(tmpdir(), 'salmons-bodies-pixels-'));
const trees = { base: resolve(opt.base), here: ROOT };
for (const [name, root] of Object.entries(trees)) {
	await esbuild.build({
		stdin: {
			contents: entry(root),
			resolveDir: join(root, 'packages/engine-layout'),
			loader: 'ts',
			sourcefile: 'bodies-pixels.ts',
		},
		bundle: true,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		outfile: join(work, name, 'bundle.js'),
		logLevel: 'warning',
	});
	cpSync(
		join(root, 'packages/engine-layout/src/lib/salmonsArt/sheets'),
		join(work, name, 'sheets'),
		{ recursive: true },
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
const totals = { pixels: 0, differ: 0, one: 0 };
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
		const run = JSON.stringify({ ...c, stops: 14, every: 9 });
		const [base, here] = await Promise.all(
			[pages.base, pages.here].map((page) => page.evaluate(`window.bodiesPixels.render(${run})`)),
		);
		const tag = `${c.w}x${c.h}-z${c.zoom}-${c.antialias ? 'aa' : 'noaa'}-r${c.resolution}`;
		base.shots.forEach((shot, i) => {
			const a = decode(shot);
			const b = decode(here.shots[i]);
			const map = new PNG({ width: a.width, height: a.height });
			let differ = 0;
			let one = 0;
			let most = 0;
			/** Each body's differing pixels and its largest difference; `-` for none's. */
			const whose = {};
			for (let k = 0; k < a.data.length; k += 4) {
				let d = 0;
				for (let ch = 0; ch < 4; ch++) d = Math.max(d, Math.abs(a.data[k + ch] - b.data[k + ch]));
				if (d) {
					differ++;
					const px = (k / 4) % a.width;
					const py = Math.floor(k / 4 / a.width);
					const box = here.boxes[i].find(
						(o) => px >= o.x && px < o.x + o.w && py >= o.y && py < o.y + o.h,
					);
					const key = box ? `${box.id}${box.under ? '~' : ''}` : '-';
					const w = (whose[key] ??= { n: 0, most: 0 });
					w.n++;
					w.most = Math.max(w.most, d);
				}
				if (d === 1) one++;
				most = Math.max(most, d);
				for (let ch = 0; ch < 3; ch++) map.data[k + ch] = d ? (ch ? 0 : 255) : a.data[k + ch] >> 2;
				map.data[k + 3] = 255;
			}
			totals.pixels += a.width * a.height;
			totals.differ += differ;
			totals.one += one;
			const name = `${tag}-stop${i + 1}`;
			if (differ) {
				writeFileSync(join(out, `${name}.base.png`), PNG.sync.write(a));
				writeFileSync(join(out, `${name}.here.png`), PNG.sync.write(b));
				writeFileSync(join(out, `${name}.diff.png`), PNG.sync.write(map));
			}
			if (most > tolerance) failed++;
			const by = Object.entries(whose)
				.map(([id, w]) => `${id} ${w.n}/${w.most}`)
				.join(', ');
			console.log(
				`  ${differ ? (most > tolerance ? 'DIFF' : 'near') : 'same'}  ${name}: ${differ} px differ (${one} by 1), by up to ${most}${by ? ` [${by}]` : ''}`,
			);
		});
		for (const [name, r] of [
			['base', base],
			['here', here],
		])
			for (const w of r.warned) console.log(`  ${name} warned: ${w}`);
		const per = (n) =>
			`rebuilds ${(n.rebuilds / n.frames).toFixed(2)}, filter passes ${(n.passes / n.frames).toFixed(2)} a frame`;
		console.log(`  ${tag}: base ${per(base.counted)}; here ${per(here.counted)}`);
		if (JSON.stringify(base.drawn) !== JSON.stringify(here.drawn)) {
			failed++;
			console.log(`  DIFF  ${tag}: what the bodies drew differs`);
		}
	}
} finally {
	for (const page of Object.values(pages)) await page.close();
	server.close();
	rmSync(work, { recursive: true, force: true });
}
console.log(
	`\nbodies-pixels: ${totals.differ} of ${totals.pixels} px differ (${totals.one} by one level)` +
		(failed ? ` — ${failed} stop(s) over ${tolerance} → ${out}` : ''),
);
process.exit(failed ? 1 : 0);
