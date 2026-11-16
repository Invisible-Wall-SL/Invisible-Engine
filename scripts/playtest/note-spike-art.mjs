// The banknote spike's art (Invisible Shader Graph step 8f, docs/design/shader-graph-3d-particles.md
// §5, interim): one square frame of tiles, as the `calNote` graph (`engine-shadergraph`
// `noteSpike.ts`) reads them:
//
//     front              rows 0–223 (512 × 224, the note's 16 : 7)
//     back               rows 224–447, drawn readable: the graph mirrors it as the note turns over
//     matcap | (spare)   rows 448–511: a 64 px grey sphere lit from the top left (0.5 grey leaves
//                        the art as it is, white doubles it); the rest is left black
//
// A placeholder note of our own, no real currency: violet ink on cream, fine wavy lines, a border,
// a rosette medallion and a large "100" (a bar and two rings) on the front; a teal guilloche rose
// and the "100" again on the back. The corners are rounded in the alpha, which the graph keeps.
//
// Drawn here, not committed as a binary, so the page is reproducible and its look is in the diff.
// Dependency-free, so the `/fx` page harness (`tools/fx-spike/fxPage/entry.ts`) draws it in the
// browser; `particle-calibration.mjs` writes it as a PNG for the phone check.

export const NOTE_SPIKE_FRAME = 'note3d';
/** The page's side, px. */
export const NOTE_SPIKE_SIZE = 512;
/** The note's half width when its half length is 1 (`NOTE_SPIKE_HALF_WIDTH` in the graph). */
const HALF_WIDTH = 0.4375;

const PAPER = [0.95, 0.93, 0.86];
const VIOLET = [0.36, 0.25, 0.55];
const DEEP = [0.2, 0.13, 0.33];
const TEAL = [0.16, 0.5, 0.5];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (e0, e1, x) => {
	const t = clamp01((x - e0) / (e1 - e0));
	return t * t * (3 - 2 * t);
};
/** 1 on a line `width` wide where `d` is 0, soft over `soft`. */
const line = (d, width, soft) => 1 - smooth(width, width + soft, Math.abs(d));

/** "100" centred at (cx, cy), `h` tall: a bar and two rings, as ink coverage 0…1. */
function hundred(x, y, cx, cy, h) {
	const u = (x - cx) / h;
	const v = (y - cy) / h;
	const stroke = 0.075;
	const bar = line(u + 0.62, stroke, 0.02) * (1 - smooth(0.46, 0.48, Math.abs(v)));
	const ring = (ox) => line(Math.hypot((u - ox) / 0.24, v / 0.47) - 1, stroke / 0.3, 0.06);
	return Math.max(bar, ring(-0.12), ring(0.46));
}

/** The front at (x, y): x along the note (−1…1), y across it (±HALF_WIDTH), y down. */
function front(x, y) {
	const ex = 1 - Math.abs(x);
	const ey = HALF_WIDTH - Math.abs(y);
	const edge = Math.min(ex, ey);
	const tint = 0.5 + 0.5 * Math.sin(x * 2.1 + 0.6);
	let c = mix(PAPER, [0.92, 0.89, 0.95], 0.5 * tint);
	const waves =
		line(Math.sin(70 * (y + 0.025 * Math.sin(11 * x))), 0.2, 0.25) * 0.5 +
		line(Math.sin(55 * (x + 0.03 * Math.sin(14 * y))), 0.15, 0.25) * 0.3;
	c = mix(c, VIOLET, 0.16 * waves);
	const border = Math.max(line(edge - 0.035, 0.012, 0.006), line(edge - 0.06, 0.004, 0.005));
	const band = edge < 0.035 ? 0.55 + 0.45 * line(Math.sin(160 * (x + y)), 0.4, 0.3) : 0;
	c = mix(c, VIOLET, Math.max(border, band * 0.7));
	const mx = x + 0.56;
	const r = Math.hypot(mx, y);
	const a = Math.atan2(y, mx);
	const rose = line(r - (0.2 + 0.035 * Math.cos(12 * a)), 0.006, 0.006);
	const rings = r < 0.3 ? line(Math.sin(r * 120), 0.25, 0.3) * smooth(0.3, 0.24, r) : 0;
	const star = r < 0.13 ? 1 - smooth(0.06, 0.07 + 0.04 * Math.cos(6 * a), r) : 0;
	c = mix(c, VIOLET, Math.max(rose, rings * 0.35));
	c = mix(c, TEAL, star * 0.85);
	c = mix(c, DEEP, line(r - 0.3, 0.007, 0.006));
	c = mix(c, DEEP, hundred(x, y, 0.42, 0.02, 0.42));
	c = mix(c, VIOLET, hundred(x, y, -0.84, -0.33, 0.1) + hundred(x, y, 0.84, 0.33, 0.1));
	const micro =
		Math.abs(y - 0.3) < 0.012 && x > -0.12 && x < 0.62 ? line(Math.sin(x * 260), 0.5, 0.3) : 0;
	return mix(c, DEEP, micro * 0.6);
}

/** The back at (x, y), as seen when the note is turned over end to end. */
function back(x, y) {
	const edge = Math.min(1 - Math.abs(x), HALF_WIDTH - Math.abs(y));
	let c = mix(PAPER, [0.86, 0.93, 0.91], 0.6);
	const r = Math.hypot(x - 0.15, y);
	const a = Math.atan2(y, x - 0.15);
	let rose = 0;
	for (let i = 0; i < 4; i++)
		rose = Math.max(
			rose,
			line(r - (0.14 + i * 0.05 + 0.03 * Math.sin(9 * a + i * 0.8)), 0.005, 0.006),
		);
	c = mix(c, TEAL, rose * 0.85);
	c = mix(c, TEAL, 0.12 * line(Math.sin(48 * (x - y * 0.5)), 0.2, 0.3));
	c = mix(c, TEAL, Math.max(line(edge - 0.035, 0.012, 0.006), line(edge - 0.06, 0.004, 0.005)));
	c = mix(c, DEEP, hundred(x, y, -0.6, 0.02, 0.36));
	return mix(c, VIOLET, hundred(x, y, 0.82, -0.32, 0.1));
}

/** The note's alpha at (x, y): its outline with rounded corners, soft over `px`. */
function outline(x, y, px) {
	const rad = 0.05;
	const dx = Math.max(Math.abs(x) - (1 - rad), 0);
	const dy = Math.max(Math.abs(y) - (HALF_WIDTH - rad), 0);
	return 1 - smooth(rad - px, rad, Math.hypot(dx, dy));
}

/** The matcap at normal (x, y) (−1…1, y down): matte paper lit from the top left. */
function matcap(x, y) {
	const r = Math.min(Math.hypot(x, y), 1);
	const z = Math.sqrt(1 - r * r);
	const l = [-0.45, -0.55, 0.7];
	const lambert = Math.max(0, x * l[0] + y * l[1] + z * l[2]);
	const sheen = Math.pow(Math.max(0, 2 * lambert * z - l[2]), 6);
	const v = 0.26 + 0.34 * lambert + 0.06 * sheen;
	return [v, v, v * 0.99];
}

/** The page's RGBA pixels, `size` × `size`. */
export function noteSpikePixels(size = NOTE_SPIKE_SIZE) {
	const data = new Uint8ClampedArray(size * size * 4);
	const tile = Math.round((size * 7) / 16);
	const cap = size / 8;
	for (let py = 0; py < size; py++)
		for (let px = 0; px < size; px++) {
			const i = (py * size + px) * 4;
			let rgb = [0, 0, 0];
			let alpha = 1;
			if (py < 2 * tile) {
				const ty = py % tile;
				const x = ((px + 0.5) / size) * 2 - 1;
				const y = (((ty + 0.5) / tile) * 2 - 1) * HALF_WIDTH;
				rgb = py < tile ? front(x, y) : back(x, y);
				alpha = outline(x, y, 2 / size);
			} else if (py >= size - cap && px < cap) {
				const x = ((px + 0.5) / cap) * 2 - 1;
				const y = ((py - (size - cap) + 0.5) / cap) * 2 - 1;
				rgb = matcap(x, y);
			}
			for (let c = 0; c < 3; c++) data[i + c] = Math.round(clamp01(rgb[c]) * 255);
			data[i + 3] = Math.round(alpha * 255);
		}
	return data;
}

/** A Pixi spritesheet for the page `image`: one frame, the whole page. */
export function noteSpikeSheet({ size = NOTE_SPIKE_SIZE, image = `${NOTE_SPIKE_FRAME}.png` } = {}) {
	const rect = { x: 0, y: 0, w: size, h: size };
	return {
		frames: {
			[NOTE_SPIKE_FRAME]: {
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
