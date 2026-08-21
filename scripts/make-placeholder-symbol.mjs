/**
 * Draw a placeholder multiplier symbol — the letter M — as a 200x200 RGBA PNG plus a
 * TexturePacker-hash manifest, so it drops into `_shared/sheets/` and is read by
 * `texturePackerToInvisible` with no conversion step.
 *
 * 200x200 because that is the engine sheet's frame size (`symbolsStatic.json`), so the M sits at
 * the same scale as H1..S rather than being contain-fitted from some other size.
 *
 * No image library: the PNG is encoded by hand (zlib + CRC32) and the glyph is rasterised from
 * four stroke segments with 3x3 supersampling, which is plenty for a placeholder and avoids
 * depending on a font being installed.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const W = 200;
const H = 200;
const SS = 3; // supersampling factor per axis

// --- the glyph, as stroke segments in a unit box (y down) --------------------
const SEGMENTS = [
	[0.2, 0.8, 0.2, 0.2], // left stem
	[0.2, 0.2, 0.5, 0.63], // left diagonal
	[0.5, 0.63, 0.8, 0.2], // right diagonal
	[0.8, 0.2, 0.8, 0.8], // right stem
];
const STROKE = 0.115; // half-width of the fill stroke, unit box
const OUTLINE = 0.038; // extra half-width for the dark keyline

const distToSegment = (px, py, [x1, y1, x2, y2]) => {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len2 = dx * dx + dy * dy;
	let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
	t = t < 0 ? 0 : t > 1 ? 1 : t;
	const cx = x1 + t * dx;
	const cy = y1 + t * dy;
	return Math.hypot(px - cx, py - cy);
};

const distToGlyph = (px, py) => {
	let d = Infinity;
	for (const s of SEGMENTS) {
		const v = distToSegment(px, py, s);
		if (v < d) d = v;
	}
	return d;
};

/** Vertical gradient down the glyph: pale gold at the top, deeper gold at the foot. */
const fillAt = (ty) => {
	const t = Math.max(0, Math.min(1, (ty - 0.18) / 0.64));
	const lerp = (a, b) => Math.round(a + (b - a) * t);
	return [lerp(255, 226), lerp(233, 154), lerp(160, 34)];
};
const OUTLINE_RGB = [58, 36, 8];

const px = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
	for (let x = 0; x < W; x++) {
		let fill = 0;
		let line = 0;
		let gy = 0;
		for (let sy = 0; sy < SS; sy++) {
			for (let sx = 0; sx < SS; sx++) {
				const ux = (x + (sx + 0.5) / SS) / W;
				const uy = (y + (sy + 0.5) / SS) / H;
				const d = distToGlyph(ux, uy);
				if (d <= STROKE) {
					fill += 1;
					gy += uy;
				} else if (d <= STROKE + OUTLINE) {
					line += 1;
				}
			}
		}
		const n = SS * SS;
		const fa = fill / n;
		const la = line / n;
		const i = (y * W + x) * 4;
		if (fa <= 0 && la <= 0) continue;
		const [fr, fg, fb] = fa > 0 ? fillAt(gy / fill) : [0, 0, 0];
		// Composite fill over outline, then set alpha to their union.
		const a = Math.min(1, fa + la);
		const wf = fa / (fa + la || 1);
		px[i] = Math.round(fr * wf + OUTLINE_RGB[0] * (1 - wf));
		px[i + 1] = Math.round(fg * wf + OUTLINE_RGB[1] * (1 - wf));
		px[i + 2] = Math.round(fb * wf + OUTLINE_RGB[2] * (1 - wf));
		px[i + 3] = Math.round(a * 255);
	}
}

// --- minimal PNG encoder ----------------------------------------------------
const CRC_TABLE = (() => {
	const t = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c;
	}
	return t;
})();
const crc32 = (buf) => {
	let c = -1;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
	raw[y * (W * 4 + 1)] = 0; // filter: none
	px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const png = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	chunk('IHDR', ihdr),
	chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
	chunk('IEND', Buffer.alloc(0)),
]);

const OUT = process.argv[2] ?? '.';
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/multiplier.png`, png);

// --- the manifest, in the format the engine's own atlases already use --------
const manifest = {
	frames: {
		m: {
			frame: { x: 0, y: 0, w: W, h: H },
			rotated: false,
			trimmed: false,
			spriteSourceSize: { x: 0, y: 0, w: W, h: H },
			sourceSize: { w: W, h: H },
		},
	},
	meta: {
		app: 'Invisible Engine — generated placeholder',
		version: '1.0',
		image: 'multiplier.png',
		format: 'RGBA8888',
		size: { w: W, h: H },
		scale: '1',
	},
};
fs.writeFileSync(`${OUT}/multiplier.json`, JSON.stringify(manifest, null, 2) + '\n');

console.log(`wrote ${OUT}/multiplier.png (${png.length} bytes) + multiplier.json`);
let opaque = 0;
for (let i = 3; i < px.length; i += 4) if (px[i] > 8) opaque++;
console.log(`coverage: ${((opaque / (W * H)) * 100).toFixed(1)}% of the frame has ink`);
