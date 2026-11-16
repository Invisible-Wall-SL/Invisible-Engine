// The coin spike's art (Invisible Shader Graph step 8f.1, docs/design/shader-graph-3d-particles.md
// §4): one square frame of four tiles, as the `calCoin` graph (`engine-shadergraph` `coinSpike.ts`)
// reads them:
//
//     front  | back       a gold face with a raised star / a ring of studs round a disc, each
//     -------+-------     inside a rim; light is high, so the graph's relief raises it
//     edge   | matcap     reeded gold, the grooves running across the edge / a grey sphere lit
//                         from the top left: 0.5 grey leaves the art as it is, white doubles it
//
// Drawn here, not committed as a binary, so the page is reproducible and its look is in the diff.
// Dependency-free, so the `/fx` page harness (`tools/fx-spike/fxPage/entry.ts`) draws it in the
// browser; `particle-calibration.mjs` writes it as a PNG for the phone check.

export const COIN_SPIKE_FRAME = 'coin3d';
/** The page's side, px: each tile is half of it. */
export const COIN_SPIKE_SIZE = 512;

const GOLD = [0.95, 0.72, 0.25];
const DARK_GOLD = [0.62, 0.38, 0.1];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (e0, e1, x) => {
	const t = clamp01((x - e0) / (e1 - e0));
	return t * t * (3 - 2 * t);
};

/** Five-pointed star: 1 inside, with a soft edge `soft` wide, in tile space (−1…1). */
function star(x, y, outer, inner, soft) {
	const a = Math.atan2(x, -y);
	const r = Math.hypot(x, y);
	const sector = (2 * Math.PI) / 5;
	const local = Math.abs(((((a % sector) + sector) % sector) / sector) * 2 - 1);
	const edge = inner + (outer - inner) * local;
	return 1 - smooth(edge - soft, edge + soft, r);
}

/** A face, in tile space (−1…1, y down): the field, a raised motif, the rim at r > 0.86. */
function face(x, y, back) {
	const r = Math.hypot(x, y);
	const rim = smooth(0.84, 0.88, r);
	const grain = 0.04 * Math.sin(r * 90);
	let motif;
	if (back) {
		const a = Math.atan2(y, x);
		const stud = Math.hypot(
			r - 0.62,
			((a / (2 * Math.PI)) * 12 - Math.round((a / (2 * Math.PI)) * 12)) *
				0.62 *
				((2 * Math.PI) / 12),
		);
		motif = Math.max(1 - smooth(0.06, 0.09, stud), 1 - smooth(0.3, 0.34, r));
	} else motif = star(x, y, 0.62, 0.27, 0.025);
	const height = Math.max(motif * 0.9, rim);
	return mix(mix(DARK_GOLD, GOLD, 0.55 + grain), mix(GOLD, [1, 0.93, 0.66], 0.5), height);
}

/** The edge strip, u round the coin, v across it: reeded, darker at the corners where it bevels. */
function edge(u, v) {
	const groove = 0.5 + 0.5 * Math.cos(u * 2 * Math.PI * 72);
	const across = 1 - 0.35 * Math.abs(v * 2 - 1) ** 3;
	return mix(DARK_GOLD, GOLD, (0.45 + 0.55 * groove) * across);
}

/** A matcap: the sphere's normal at (x, y) (−1…1, y down), lit from the top left; grey at 0.5. */
function matcap(x, y) {
	const r2 = Math.min(1, x * x + y * y);
	const n = [x, y, Math.sqrt(1 - r2)];
	const l = [-0.5, -0.6, 0.62];
	const len = Math.hypot(...l);
	const dot = (n[0] * l[0] + n[1] * l[1] + n[2] * l[2]) / len;
	const diffuse = 0.18 + 0.42 * Math.max(dot, 0);
	const half = [l[0] / len, l[1] / len, l[2] / len + 1];
	const hl = Math.hypot(...half);
	const spec = Math.max((n[0] * half[0] + n[1] * half[1] + n[2] * half[2]) / hl, 0) ** 40;
	const rimLight = 0.25 * smooth(0.7, 1, Math.sqrt(r2)) * clamp01(0.5 + y);
	const v = diffuse + 0.55 * spec + rimLight;
	return [v, v * 0.98, v * 0.95];
}

/** The page's RGBA pixels, `size` × `size`: the four tiles. */
export function coinSpikePixels(size = COIN_SPIKE_SIZE) {
	const data = new Uint8ClampedArray(size * size * 4);
	const half = size / 2;
	for (let py = 0; py < size; py++)
		for (let px = 0; px < size; px++) {
			const tx = px % half;
			const ty = py % half;
			const x = ((tx + 0.5) / half) * 2 - 1;
			const y = ((ty + 0.5) / half) * 2 - 1;
			const right = px >= half;
			const bottom = py >= half;
			const rgb = bottom
				? right
					? matcap(x, y)
					: edge((tx + 0.5) / half, (ty + 0.5) / half)
				: face(x, y, right);
			const i = (py * size + px) * 4;
			for (let c = 0; c < 3; c++) data[i + c] = Math.round(clamp01(rgb[c]) * 255);
			data[i + 3] = 255;
		}
	return data;
}

/** A Pixi spritesheet for the page `image`: one frame, the whole page. */
export function coinSpikeSheet({ size = COIN_SPIKE_SIZE, image = `${COIN_SPIKE_FRAME}.png` } = {}) {
	const rect = { x: 0, y: 0, w: size, h: size };
	return {
		frames: {
			[COIN_SPIKE_FRAME]: {
				frame: rect,
				rotated: false,
				trimmed: false,
				spriteSourceSize: rect,
				sourceSize: { w: size, h: size },
			},
		},
		meta: { image, format: 'RGBA8888', size: { w: size, h: size }, scale: '1' },
	};
}
