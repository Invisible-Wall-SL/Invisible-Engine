// Screen comparison with the tunable tolerance of `scripts/current-games/tolerance.json`
// (ADR-0004 §6). A screen passes when BOTH hold:
//   - differing pixels / all pixels ≤ `maxDiffRatio`
//   - no `blockSize`×`blockSize` block has more than `blockThreshold` of its pixels differing
// `threshold` is pixelmatch's per-pixel colour distance (0–1); `antiAliasing: 'count'` counts
// pixels pixelmatch classifies as anti-aliasing, `'ignore'` does not. `masks` are rectangles
// (`{x, y, w, h}`, CSS px at DPR 1) excluded from both rules — only for content that is time-based
// by design, and reviewed like code.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const KNOBS = ['maxDiffRatio', 'blockSize', 'blockThreshold', 'threshold', 'antiAliasing', 'masks'];

/** The tolerance one screen runs with: default ← game type ← `<gameType>/<screen>`. */
export function toleranceFor(config, gameType, screen) {
	const merged = {
		...config.default,
		...(config.gameTypes?.[gameType] ?? {}),
		...(config.screens?.[`${gameType}/${screen}`] ?? {}),
	};
	return Object.fromEntries(KNOBS.map((k) => [k, merged[k]]));
}

export function loadTolerance(path) {
	const config = JSON.parse(readFileSync(path, 'utf8'));
	const missing = KNOBS.filter((k) => config.default?.[k] === undefined);
	if (missing.length) throw new Error(`${path}: default is missing ${missing.join(', ')}`);
	return config;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const pairHash = (a, b) => sha(`${sha(a.data)}:${sha(b.data)}`).slice(0, 16);

const inMask = (masks, x, y) =>
	masks.some((m) => x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h);

/**
 * Compare two PNG buffers. Returns the measurements (always — they are the noise record), the
 * verdict, the diff PNG when anything differs, and `diffHash`: the identity of THIS difference
 * (before + after pixels), the stable half of an approval id.
 */
export function compareScreens(beforePng, afterPng, tolerance) {
	const a = PNG.sync.read(beforePng);
	const b = PNG.sync.read(afterPng);
	const total = a.width * a.height;
	if (a.width !== b.width || a.height !== b.height) {
		return {
			pass: false,
			reason: `size ${a.width}×${a.height} vs ${b.width}×${b.height}`,
			diffPixels: total,
			diffRatio: 1,
			maxBlockRatio: 1,
			diffHash: pairHash(a, b),
		};
	}
	const diff = new PNG({ width: a.width, height: a.height });
	pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
		threshold: tolerance.threshold,
		includeAA: tolerance.antiAliasing === 'count',
		alpha: 0.2,
		diffMask: false,
	});
	// pixelmatch paints differing pixels red (255,0,0) and, with includeAA off, AA pixels yellow;
	// only red counts.
	const masks = tolerance.masks ?? [];
	const size = tolerance.blockSize;
	const blocksX = Math.ceil(a.width / size);
	const blocks = new Uint32Array(blocksX * Math.ceil(a.height / size));
	let diffPixels = 0;
	const box = { x0: a.width, y0: a.height, x1: -1, y1: -1 };
	for (let y = 0; y < a.height; y++)
		for (let x = 0; x < a.width; x++) {
			const o = (y * a.width + x) * 4;
			const red = diff.data[o] === 255 && diff.data[o + 1] === 0 && diff.data[o + 2] === 0;
			if (!red || inMask(masks, x, y)) continue;
			diffPixels++;
			box.x0 = Math.min(box.x0, x);
			box.y0 = Math.min(box.y0, y);
			box.x1 = Math.max(box.x1, x);
			box.y1 = Math.max(box.y1, y);
			blocks[Math.floor(y / size) * blocksX + Math.floor(x / size)]++;
		}
	// An edge block is cut short by the image border: its ratio is over its real area.
	const blocksY = Math.ceil(a.height / size);
	let maxBlockRatio = 0;
	for (let by = 0; by < blocksY; by++)
		for (let bx = 0; bx < blocksX; bx++) {
			const area =
				(Math.min(size, a.width - bx * size) || size) *
				(Math.min(size, a.height - by * size) || size);
			maxBlockRatio = Math.max(maxBlockRatio, blocks[by * blocksX + bx] / area);
		}
	// Where the difference is, 64×24 cells: ' ' none, '.' under 1 % of the cell, ':' under 10 %, '#'
	// more — readable in a job log, where the images are not.
	const [hx, hy] = [64, 24];
	const heat = new Uint32Array(hx * hy);
	if (diffPixels)
		for (let y = 0; y < a.height; y++)
			for (let x = 0; x < a.width; x++) {
				const o = (y * a.width + x) * 4;
				if (
					diff.data[o] === 255 &&
					diff.data[o + 1] === 0 &&
					diff.data[o + 2] === 0 &&
					!inMask(masks, x, y)
				)
					heat[Math.floor((y * hy) / a.height) * hx + Math.floor((x * hx) / a.width)]++;
			}
	const cell = (a.width / hx) * (a.height / hy);
	const heatmap = diffPixels
		? Array.from({ length: hy }, (_, r) =>
				Array.from(heat.subarray(r * hx, r * hx + hx), (n) =>
					!n ? ' ' : n / cell < 0.01 ? '.' : n / cell < 0.1 ? ':' : '#',
				).join(''),
			)
		: undefined;
	const diffRatio = diffPixels / total;
	const pass = diffRatio <= tolerance.maxDiffRatio && maxBlockRatio <= tolerance.blockThreshold;
	return {
		pass,
		reason: pass
			? undefined
			: diffRatio > tolerance.maxDiffRatio
				? `${diffPixels} px differ (${(diffRatio * 100).toFixed(4)}% > ${(tolerance.maxDiffRatio * 100).toFixed(4)}%)`
				: `a ${size}×${size} block has ${(maxBlockRatio * 100).toFixed(1)}% of its pixels differing (> ${(tolerance.blockThreshold * 100).toFixed(1)}%)`,
		diffPixels,
		diffRatio,
		maxBlockRatio,
		box: diffPixels ? box : undefined,
		heatmap,
		diffPng: diffPixels ? PNG.sync.write(diff) : undefined,
		diffHash: diffPixels ? pairHash(a, b) : undefined,
	};
}

/** Byte-identical captures need no decode. */
export const identical = (a, b) => a.equals(b);

/**
 * A `w`×`h` window of before / after / diff around the densest part of a difference, as PNGs —
 * small enough to print into a job log as base64 when the artifact cannot be fetched.
 */
export function cropAround(beforePng, afterPng, diffPng, w = 256, h = 128) {
	const imgs = [beforePng, afterPng, diffPng].map((b) => PNG.sync.read(b));
	const d = imgs[2];
	// Half-overlapping windows, the last one flush with the far edge so no row or column is missed.
	const starts = (size, win) => {
		const out = [];
		for (let p = 0; p + win < size; p += win / 2) out.push(p);
		return [...out, Math.max(0, size - win)];
	};
	let best = { n: -1, x: 0, y: 0 };
	for (const y of starts(d.height, h))
		for (const x of starts(d.width, w)) {
			let n = 0;
			for (let yy = y; yy < y + h; yy++)
				for (let xx = x; xx < x + w; xx++) {
					const o = (yy * d.width + xx) * 4;
					if (d.data[o] === 255 && d.data[o + 1] === 0 && d.data[o + 2] === 0) n++;
				}
			if (n > best.n) best = { n, x, y };
		}
	const crop = (img) => {
		const c = new PNG({ width: w, height: h });
		PNG.bitblt(img, c, best.x, best.y, w, h, 0, 0);
		return PNG.sync.write(c).toString('base64');
	};
	return { x: best.x, y: best.y, w, h, images: imgs.map(crop) };
}
