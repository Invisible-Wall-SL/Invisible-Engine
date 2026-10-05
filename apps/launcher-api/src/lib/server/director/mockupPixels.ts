import sharp from 'sharp';

/** The long edge the model sees (ADR-0005); the original is kept. */
export const MODEL_LONG_EDGE = 1568;

export type MockupMediaType = 'image/png' | 'image/jpeg';

/**
 * The pixel work behind the mockup adapters (ADR-0005): the downscaled copy the model sees, the
 * dominant colours the palette check is verified against, and the crops of matched elements. All of
 * it runs here, where the originals are, so the worker never decodes an image.
 */

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface DominantColor {
	hex: string;
	/** The fraction of sampled pixels in this cluster, 0–1. */
	share: number;
}

export async function imageDimensions(bytes: Uint8Array): Promise<{ w: number; h: number }> {
	const meta = await sharp(bytes).metadata();
	if (!meta.width || !meta.height) throw new Error('The image has no dimensions.');
	// EXIF orientation 5–8 swaps the axes when the image is displayed.
	const swapped = (meta.orientation ?? 1) >= 5;
	return swapped ? { w: meta.height, h: meta.width } : { w: meta.width, h: meta.height };
}

/** The factor the model's copy is scaled by: 1 when the original already fits. */
export function modelScale(w: number, h: number, longEdge = MODEL_LONG_EDGE): number {
	const edge = Math.max(w, h);
	return edge <= longEdge ? 1 : longEdge / edge;
}

/** A box in the model's (downscaled) pixel space mapped back onto the original. */
export function unscaleBox(box: Box, scale: number): Box {
	return {
		x: Math.round(box.x / scale),
		y: Math.round(box.y / scale),
		w: Math.round(box.w / scale),
		h: Math.round(box.h / scale),
	};
}

/** `box` clamped inside a `w`×`h` image; null when nothing of it is inside. */
export function clampBox(box: Box, w: number, h: number): Box | null {
	const x0 = Math.max(0, Math.min(w, Math.round(box.x)));
	const y0 = Math.max(0, Math.min(h, Math.round(box.y)));
	const x1 = Math.max(0, Math.min(w, Math.round(box.x + box.w)));
	const y1 = Math.max(0, Math.min(h, Math.round(box.y + box.h)));
	if (x1 <= x0 || y1 <= y0) return null;
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export interface ModelImage {
	bytes: Uint8Array;
	mediaType: MockupMediaType;
	w: number;
	h: number;
	scale: number;
}

/**
 * The copy the model sees: at most `longEdge` on the long side, same format as the original. An
 * original that already fits is passed through untouched (`scale` 1).
 */
export async function downscaleForModel(
	bytes: Uint8Array,
	mediaType: MockupMediaType,
	longEdge = MODEL_LONG_EDGE,
): Promise<ModelImage> {
	const { w, h } = await imageDimensions(bytes);
	const scale = modelScale(w, h, longEdge);
	if (scale === 1) return { bytes, mediaType, w, h, scale };
	let pipeline = sharp(bytes)
		.rotate()
		.resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true });
	pipeline = mediaType === 'image/png' ? pipeline.png() : pipeline.jpeg({ quality: 90 });
	const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
	return {
		bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		mediaType,
		w: info.width,
		h: info.height,
		scale,
	};
}

/** A PNG of `box` (in original pixels) cut from the original. Null when the box is outside it. */
export async function cropImage(bytes: Uint8Array, box: Box): Promise<Uint8Array | null> {
	const { w, h } = await imageDimensions(bytes);
	const inside = clampBox(box, w, h);
	if (!inside) return null;
	const data = await sharp(bytes)
		.rotate()
		.extract({ left: inside.x, top: inside.y, width: inside.w, height: inside.h })
		.png()
		.toBuffer();
	return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export const hexToRgb = (hex: string): [number, number, number] => [
	parseInt(hex.slice(1, 3), 16),
	parseInt(hex.slice(3, 5), 16),
	parseInt(hex.slice(5, 7), 16),
];

export const rgbToHex = (rgb: readonly number[]): string =>
	`#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

const sq = (n: number) => n * n;
const luminance = (p: readonly number[]) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

/**
 * Plain k-means over RGB points with DETERMINISTIC seeding — seeds are quantiles of the points
 * sorted by luminance, not random picks — so the same image always gives the same clusters, and a
 * palette check is reproducible. Empty clusters are dropped; the result is sorted by share.
 */
export function kmeans(
	points: readonly (readonly number[])[],
	k: number,
	iterations = 16,
): { center: [number, number, number]; share: number }[] {
	if (points.length === 0) return [];
	const sorted = [...points].sort((a, b) => luminance(a) - luminance(b));
	const kk = Math.min(k, sorted.length);
	let centers = Array.from({ length: kk }, (_, i) => {
		const p = sorted[Math.floor(((i + 0.5) * sorted.length) / kk)];
		return [p[0], p[1], p[2]];
	});
	let assignment = new Array<number>(points.length).fill(0);
	for (let iter = 0; iter < iterations; iter++) {
		const next = points.map((p) => {
			let best = 0;
			let bestD = Infinity;
			for (let c = 0; c < centers.length; c++) {
				const d = sq(p[0] - centers[c][0]) + sq(p[1] - centers[c][1]) + sq(p[2] - centers[c][2]);
				if (d < bestD) {
					bestD = d;
					best = c;
				}
			}
			return best;
		});
		const sums = centers.map(() => [0, 0, 0, 0]);
		points.forEach((p, i) => {
			const s = sums[next[i]];
			s[0] += p[0];
			s[1] += p[1];
			s[2] += p[2];
			s[3]++;
		});
		const moved = sums.map((s, c) =>
			s[3] === 0 ? centers[c] : [s[0] / s[3], s[1] / s[3], s[2] / s[3]],
		);
		const stable = moved.every((m, c) => m.every((v, i) => Math.abs(v - centers[c][i]) < 0.5));
		centers = moved;
		assignment = next;
		if (stable) break;
	}
	const counts = centers.map(() => 0);
	for (const a of assignment) counts[a]++;
	return centers
		.map((c, i) => ({
			center: [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])] as [number, number, number],
			share: counts[i] / points.length,
		}))
		.filter((c) => c.share > 0)
		.sort((a, b) => b.share - a.share);
}

/** How many colours the k-means asks for: more than the palette's 8, so an accent survives. */
export const DOMINANT_K = 12;
/** Sampling thumbnail: 64² pixels is enough for colour clusters and fast on any mockup. */
const SAMPLE_EDGE = 64;

/** The image's dominant colours, as the palette check's ground truth. */
export async function dominantColors(bytes: Uint8Array, k = DOMINANT_K): Promise<DominantColor[]> {
	const { data, info } = await sharp(bytes)
		.rotate()
		.resize({ width: SAMPLE_EDGE, height: SAMPLE_EDGE, fit: 'inside' })
		.flatten({ background: '#000000' })
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const points: number[][] = [];
	for (let i = 0; i + 2 < data.length; i += info.channels) {
		points.push([data[i], data[i + 1], data[i + 2]]);
	}
	return kmeans(points, k).map((c) => ({
		hex: rgbToHex(c.center),
		share: Math.round(c.share * 1000) / 1000,
	}));
}
