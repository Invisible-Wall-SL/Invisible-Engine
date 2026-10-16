/**
 * Offline fixture: a clockwise-packed region (`rotate:270`) draws the same texels as the rig bundle's
 * 180°-flipped copy of it (`rotate:90`). Run: pnpm exec tsx packages/engine-rig/src/clockwiseRegions.fixture.ts
 *
 * Our Atlas and Sheet Makers pack a rotated region 90° CLOCKWISE. The reference runtime this format
 * comes from reads only counter-clockwise (`rotate:90`) on a plain region, so every rig bundle used
 * to flip each rotated region 180° in a private, LOSSLESS copy of its sheet's page. On the Book of
 * Borut remake that copy is 3–4× the size of the lossy sheet page it was made from (11.35 MB against
 * 3.24 MB for one cinematic page) and is downloaded as a second texture beside it. Once regions read
 * `rotate:270`, a rig can point at the sheet's own page instead. That only holds if the two
 * representations are the same picture, which is what this proves: for every region and mesh vertex,
 * the page point sampled on the original page under `rotate:270` is the 180° image, inside the
 * region's on-page footprint, of the point sampled on the flipped page under `rotate:90`.
 */

import { MeshAttachment, RegionAttachment } from './attachments.ts';
import { TextureAtlas } from './atlas.ts';

let failures = 0;
let checks = 0;
let worst = 0;
// In page pixels. The runtime keeps UVs in a Float32Array, which on a 6000 px page rounds to a few
// ten-thousandths of a pixel; a texel is 1. Anything a hundredth of a texel apart is the same sample.
const EPS = 0.01;

interface RegionSpec {
	name: string;
	x: number;
	y: number;
	/** Trimmed size, unrotated — the `bounds:` width/height. */
	w: number;
	h: number;
	offsetX?: number;
	offsetY?: number;
	origW?: number;
	origH?: number;
}

const PAGE_W = 4096;
const PAGE_H = 6000;

const atlasText = (rotate: 90 | 270, regions: RegionSpec[]): string =>
	[
		'page.webp',
		`size:${PAGE_W},${PAGE_H}`,
		'filter:Linear,Linear',
		...regions.flatMap((r) => [
			r.name,
			`bounds:${r.x},${r.y},${r.w},${r.h}`,
			...(r.origW === undefined
				? []
				: [`offsets:${r.offsetX ?? 0},${r.offsetY ?? 0},${r.origW},${r.origH}`]),
			`rotate:${rotate}`,
		]),
	].join('\n');

/** The 180° turn the bundle applies to a region's footprint, in continuous page pixels. */
const flip = (r: RegionSpec, px: number, py: number): [number, number] => [
	2 * r.x + r.h - px,
	2 * r.y + r.w - py,
];

const samePoint = (label: string, flipped: [number, number], original: [number, number]): void => {
	checks += 1;
	const off = Math.max(Math.abs(flipped[0] - original[0]), Math.abs(flipped[1] - original[1]));
	worst = Math.max(worst, off);
	if (off < EPS) return;
	failures += 1;
	console.log(
		`FAIL  ${label}\n        flipped page → ${flipped.join(',')}\n        original page → ${original.join(',')}`,
	);
};

const pagePoints = (uvs: ArrayLike<number>): [number, number][] => {
	const out: [number, number][] = [];
	for (let i = 0; i < uvs.length; i += 2) out.push([uvs[i] * PAGE_W, uvs[i + 1] * PAGE_H]);
	return out;
};

const regionUvs = (atlas: TextureAtlas, name: string): Float32Array => {
	const region = atlas.findRegion(name);
	if (!region) throw new Error(`no region ${name}`);
	const a = new RegionAttachment(name, name);
	a.region = region;
	a.width = region.originalWidth;
	a.height = region.originalHeight;
	a.updateRegion();
	return a.uvs;
};

/** A deterministic spread of mesh vertices over the whole untrimmed image, corners included. */
const MESH_UVS = (() => {
	const pts = [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5];
	let seed = 7;
	for (let i = 0; i < 40; i++) {
		seed = (seed * 16807) % 2147483647;
		pts.push((seed % 10007) / 10006);
	}
	return new Float32Array(pts);
})();

const meshUvs = (atlas: TextureAtlas, name: string): Float32Array => {
	const region = atlas.findRegion(name);
	if (!region) throw new Error(`no region ${name}`);
	const m = new MeshAttachment(name, name);
	m.region = region;
	m.regionUVs = MESH_UVS;
	m.updateRegion();
	return m.uvs;
};

const prove = (title: string, regions: RegionSpec[]): void => {
	console.log(`\n${title}`);
	const flipped = new TextureAtlas(atlasText(90, regions));
	const original = new TextureAtlas(atlasText(270, regions));
	for (const r of regions) {
		const a = original.findRegion(r.name);
		const b = flipped.findRegion(r.name);
		checks += 1;
		if (!a || !b || a.u2 !== b.u2 || a.v2 !== b.v2) {
			failures += 1;
			console.log(`FAIL  ${r.name}: the two packings disagree on the footprint`);
		}
		const regionFlipped = pagePoints(regionUvs(flipped, r.name));
		const regionOriginal = pagePoints(regionUvs(original, r.name));
		regionFlipped.forEach((p, i) =>
			samePoint(`${r.name} region corner ${i}`, flip(r, p[0], p[1]), regionOriginal[i]),
		);
		const meshFlipped = pagePoints(meshUvs(flipped, r.name));
		const meshOriginal = pagePoints(meshUvs(original, r.name));
		meshFlipped.forEach((p, i) =>
			samePoint(`${r.name} mesh vertex ${i}`, flip(r, p[0], p[1]), meshOriginal[i]),
		);
		console.log(`  ok  ${r.name}`);
	}
};

// Verbatim from the remake's R_Cinematic2 bundle atlas (4096×6000 page): untrimmed rotated regions.
prove('untrimmed regions (the live R_Cinematic2 page)', [
	{ name: 'T_BigWin_Background', x: 2462, y: 0, w: 1920, h: 1080 },
	{ name: 'T_BigWin_Mooh', x: 1082, y: 1154, w: 631, h: 835 },
	{ name: 'T_BigWin_Boyo_shine', x: 0, y: 1154, w: 765, h: 1080 },
	{ name: 'T_WinScreen_Mega_zoom', x: 3544, y: 0, w: 1536, h: 453 },
	{ name: 'T_WinScreen_Big_zoom', x: 3590, y: 4794, w: 1185, h: 453 },
]);

// Trimmed regions: transparent margins cut on every side, unequal, so a swapped or mirrored trim
// lands somewhere else and fails.
prove('trimmed regions', [
	{ name: 'trim_all', x: 100, y: 200, w: 300, h: 140, offsetX: 7, offsetY: 19, origW: 330, origH: 171 },
	{ name: 'trim_left_bottom', x: 900, y: 50, w: 64, h: 512, offsetX: 31, offsetY: 3, origW: 95, origH: 515 },
	{ name: 'trim_right_top', x: 1500, y: 3000, w: 777, h: 333, offsetX: 0, offsetY: 0, origW: 801, origH: 360 },
]);

console.log(`\n${checks} checks, ${failures} failed, worst offset ${worst.toFixed(5)} px`);
if (failures > 0) process.exit(1);
