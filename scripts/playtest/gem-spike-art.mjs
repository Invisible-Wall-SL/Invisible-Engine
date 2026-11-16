// The gem spike's art (Invisible Shader Graph step 8f.1, docs/design/shader-graph-3d-particles.md
// §4 "Gem"): one square frame of tiles, as the `calGem` graph (`engine-shadergraph` `gemSpike.ts`)
// reads them:
//
//     outside | inside      what the facets reflect / what they refract, each a sphere map of
//     --------+--------     directions (the centre faces the viewer, up is up), grey so the
//     (spare) | (spare)     gem's Tint colours it. The bottom row is not read, left black.
//
// `outside` is a studio: a dim floor-to-ceiling gradient, a large soft box at the top left (where
// the graph's glint light is, so a facet that flashes also reflects it), a strip light on the right.
// `inside` is high contrast on purpose: bright and dark wedges round the middle and rings across
// them, so each facet the light leaves by shows a different patch, the gem's sparkle, and Fire
// splits colour where bright meets dark.
//
// Drawn here, not committed as a binary, so the page is reproducible and its look is in the diff.
// Dependency-free, so the `/fx` page harness (`tools/fx-spike/fxPage/entry.ts`) draws it in the
// browser; `particle-calibration.mjs` writes it as a PNG for the phone check.

export const GEM_SPIKE_FRAME = 'gem3d';
/** The page's side, px: each tile is half of it. */
export const GEM_SPIKE_SIZE = 512;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (e0, e1, x) => {
	const t = clamp01((x - e0) / (e1 - e0));
	return t * t * (3 - 2 * t);
};
/** 1 inside a rounded box centred at (cx, cy), half size (w, h), soft over `soft`. */
const box = (x, y, cx, cy, w, h, soft) => {
	const dx = Math.max(Math.abs(x - cx) - w, 0);
	const dy = Math.max(Math.abs(y - cy) - h, 0);
	return 1 - smooth(0, soft, Math.hypot(dx, dy));
};

/** The studio the facets reflect, at direction (x, y) (−1…1, y down). */
function outside(x, y) {
	const r = Math.hypot(x, y);
	const room = 0.18 + 0.2 * clamp01(0.5 - y * 0.5) + 0.08 * smooth(0.6, 1, r);
	const softBox = box(x, y, -0.45, -0.52, 0.22, 0.16, 0.12);
	const strip = box(x, y, 0.72, 0, 0.05, 0.42, 0.06);
	const v = room + 1.1 * softBox + 0.75 * strip;
	return [v, v, v * 0.98];
}

/** The pattern the facets refract, at direction (x, y): wedges and rings, bright on dark. */
function inside(x, y) {
	const r = Math.hypot(x, y);
	const a = Math.atan2(y, x);
	const wedge = 0.5 + 0.5 * Math.cos(a * 8 + Math.sin(r * 7) * 0.8);
	const ring = 0.5 + 0.5 * Math.cos(r * 19);
	const bright = smooth(0.55, 0.8, wedge) * (0.45 + 0.55 * smooth(0.3, 0.7, ring));
	const spark = 1 - smooth(0, 0.09, Math.hypot(x + 0.3, y + 0.35));
	const v = 0.12 + 0.95 * bright + 0.9 * spark + 0.25 * (1 - smooth(0, 0.35, r));
	return [v, v, v];
}

/** The page's RGBA pixels, `size` × `size`: the two tiles over a black row. */
export function gemSpikePixels(size = GEM_SPIKE_SIZE) {
	const data = new Uint8ClampedArray(size * size * 4);
	const half = size / 2;
	for (let py = 0; py < size; py++)
		for (let px = 0; px < size; px++) {
			const i = (py * size + px) * 4;
			data[i + 3] = 255;
			if (py >= half) continue;
			const tx = px % half;
			const x = ((tx + 0.5) / half) * 2 - 1;
			const y = ((py + 0.5) / half) * 2 - 1;
			const rgb = px >= half ? inside(x, y) : outside(x, y);
			for (let c = 0; c < 3; c++) data[i + c] = Math.round(clamp01(rgb[c]) * 255);
		}
	return data;
}

/** A Pixi spritesheet for the page `image`: one frame, the whole page. */
export function gemSpikeSheet({ size = GEM_SPIKE_SIZE, image = `${GEM_SPIKE_FRAME}.png` } = {}) {
	const rect = { x: 0, y: 0, w: size, h: size };
	return {
		frames: {
			[GEM_SPIKE_FRAME]: {
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
