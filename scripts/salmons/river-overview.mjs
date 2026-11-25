// A WHOLE RIVER AT A GLANCE (Salmons): draws the level a seed makes as the game's screen shows it
// (isometric, mirrored unless `--unmirrored`), small enough to see from the sea to the source, with
// each waterfall's cliff as high as the river is raised there. A debug view of the generator's
// output, not the game's art: water, sand, rocks, whirlpools, bridges, waterfalls, spawn places.
// It prints, per seed, the waterfalls' heights and what the course measures (`courseFacts`).
//
//   node scripts/salmons/river-overview.mjs --seeds 1,2,3 --out <dir> [--levels <json file>]
//     [--shipped] [--unmirrored] [--scale 16]
//
// `--levels` is a config's `arcade.online.levels`; `--shipped` is Salmons' own (`SALMONS_LEVELS`).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { PNG } from 'pngjs';

import { ONLINE_GENERATORS } from '../../packages/engine-mechanics/src/onlineGenerators.js';
import { SALMONS_LEVELS } from '../../packages/engine-mechanics/src/salmons.js';
import { CELL, courseFacts } from '../../packages/engine-mechanics/src/salmonsMap.js';

const { values: opt } = parseArgs({
	options: {
		seeds: { type: 'string', default: '1,2,3,4,5,6,7,8' },
		out: { type: 'string', default: '.cache/salmons-overview' },
		levels: { type: 'string' },
		shipped: { type: 'boolean', default: false },
		unmirrored: { type: 'boolean', default: false },
		scale: { type: 'string', default: '16' },
	},
});
const levels = opt.levels
	? JSON.parse(readFileSync(resolve(opt.levels), 'utf8'))
	: opt.shipped
		? SALMONS_LEVELS
		: undefined;
const scale = Number(opt.scale);
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });

/** The old client's cliff under a waterfall of `h` cells and the step it raises the river by, px
 *  (`engine-layout` `salmonsElevation.ts`). */
const K = CELL / 32;
const cliffPx = (h) => (32 + h * 16) * K;
const stepPx = (h) => cliffPx(h) - 16 * K;

const COLOR = {
	land: [38, 60, 34],
	bank: [70, 110, 56],
	water: [63, 134, 198],
	sand: [217, 195, 138],
	rock: [120, 120, 120],
	whirlpool: [25, 60, 110],
	fall: [240, 248, 255],
	cliff: [110, 90, 60],
	bridge: [150, 100, 50],
	salmon: [255, 120, 160],
	catcher: [255, 220, 60],
	source: [200, 240, 255],
};

for (const seed of opt.seeds.split(',').map(Number)) {
	const river = ONLINE_GENERATORS.salmonsMap.make(seed, levels);
	const falls = (river.waterfalls ?? [])
		.map((f) => ({ line: f.y + f.h / 2, height: f.height ?? 1 }))
		.sort((a, b) => b.line - a.line);
	let foot = 0;
	for (const f of falls) {
		f.foot = foot;
		foot += stepPx(f.height);
		f.top = foot;
	}
	const liftAt = (y) => {
		let lift = 0;
		for (const f of falls) {
			if (f.line <= y) break;
			lift = f.top;
		}
		return lift;
	};
	const { w: W, h: H } = river.world;
	const project = (x, y) =>
		opt.unmirrored ? { x: x - y + H, y: (x + y) / 2 } : { x: y - x + W, y: (x + y) / 2 };
	const width = Math.ceil((W + H) / scale) + 2;
	const top = Math.ceil(foot / scale) + 2;
	const height = Math.ceil((W + H) / 2 / scale) + top + 2;
	const png = new PNG({ width, height });
	for (let i = 0; i < png.data.length; i += 4) png.data.set([18, 22, 26, 255], i);
	const plot = (px, py, c) => {
		const x = Math.round(px);
		const y = Math.round(py);
		if (x < 0 || y < 0 || x >= width || y >= height) return;
		png.data.set([...c, 255], (y * width + x) * 4);
	};
	const fill = (r, c, raise = 0) => {
		for (let y = r.y; y < r.y + r.h; y += scale / 2)
			for (let x = r.x; x < r.x + r.w; x += scale / 2) {
				const at = project(x, y);
				plot(at.x / scale, (at.y - liftAt(y) - raise) / scale + top, c);
			}
	};
	const bank = 6 * CELL;
	for (const b of river.bands)
		fill({ x: b.left - bank, y: b.y, w: b.right - b.left + 2 * bank, h: b.h }, COLOR.bank);
	fill(river.sea, [31, 79, 122]);
	fill(river.source, COLOR.source);
	for (const b of river.bands)
		fill({ x: b.left, y: b.y, w: b.right - b.left, h: b.h }, COLOR.water);
	for (const s of river.sandbanks ?? []) fill(s, COLOR.sand);
	for (const p of river.whirlpools)
		fill({ x: p.x - CELL, y: p.y - CELL, w: 2 * CELL, h: 2 * CELL }, COLOR.whirlpool);
	for (const r of river.rocks ?? []) fill(r, COLOR.rock);
	for (const b of river.bridges ?? []) fill(b, COLOR.bridge, 40);
	for (const f of falls) {
		const band = river.bands.find((b) => b.y === f.line);
		if (!band) continue;
		for (let x = band.left; x < band.right; x += scale / 2) {
			const at = project(x, f.line);
			const cliff = cliffPx(f.height);
			for (let d = 0; d <= cliff; d += scale / 2)
				plot(
					at.x / scale,
					(at.y - f.top + d) / scale + top,
					d < cliff * 0.2 ? COLOR.fall : COLOR.cliff,
				);
		}
	}
	const dot = (p, c) => fill({ x: p.x - CELL, y: p.y - CELL, w: 2 * CELL, h: 2 * CELL }, c);
	for (const p of river.botSpawns ?? []) dot(p, COLOR.catcher);
	for (const p of river.salmonSpawns ?? []) dot(p, COLOR.salmon);
	const file = join(out, `river-${seed}.png`);
	writeFileSync(file, PNG.sync.write(png));
	console.log(
		JSON.stringify({
			seed,
			file,
			world: river.world,
			bands: river.bands.length,
			waterfalls: falls.map((f) => f.height).reverse(),
			cliffsPx: falls.map((f) => cliffPx(f.height)).reverse(),
			...courseFacts(river),
		}),
	);
}
