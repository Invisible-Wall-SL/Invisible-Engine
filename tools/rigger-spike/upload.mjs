// Verify the A3 raw-image-upload path headlessly:
//  (1) the shelf packer produces non-overlapping rects within the page bounds.
//  (2) the packed region rects → regionsToSpineAtlas → official TextureAtlas
//      re-parse: region count + on-page rects round-trip (what the server writes).
//   node tools/rigger-spike/upload.mjs
import { fileURLToPath } from 'node:url';

const SPINE_CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
const { TextureAtlas } = await import(SPINE_CORE);

// replicate spine.ts regionsToSpineAtlas
function regionsToSpineAtlas(pageImage, pw, ph, regions) {
	const out = [pageImage, `size:${Math.round(pw)},${Math.round(ph)}`, 'filter:Linear,Linear'];
	for (const r of regions) {
		const w = Math.round(r.w), h = Math.round(r.h);
		out.push(r.name);
		out.push(`bounds:${Math.round(r.x)},${Math.round(r.y)},${w},${h}`);
		const ow = Math.round(r.origW ?? r.w), oh = Math.round(r.origH ?? r.h);
		const ox = Math.round(r.offX ?? 0), oy = Math.round(r.offY ?? 0);
		if (ox !== 0 || oy !== 0 || ow !== w || oh !== h) out.push(`offsets:${ox},${oy},${ow},${oh}`);
	}
	return out.join('\n') + '\n';
}
// replicate the viewer's shelf packer (sizes only)
function pack(sizes) {
	const MAX_W = 2048, pad = 2;
	const items = sizes.map((s, i) => ({ name: 'img' + i, w: s[0], h: s[1] })).sort((a, b) => b.h - a.h);
	let x = pad, y = pad, rowH = 0, pageW = 0;
	const regions = [];
	for (const it of items) {
		if (x + it.w + pad > MAX_W && x > pad) { y += rowH + pad; x = pad; rowH = 0; }
		regions.push({ name: it.name, x, y, w: it.w, h: it.h });
		x += it.w + pad; rowH = Math.max(rowH, it.h); pageW = Math.max(pageW, x + pad);
	}
	return { regions, pageW, pageH: y + rowH + pad };
}

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== A3 raw-upload pack + synth ===`);

// a mix that forces multiple rows
const sizes = [[300, 200], [500, 180], [120, 120], [800, 400], [64, 64], [1000, 300], [256, 256], [40, 900], [700, 90], [333, 333]];
const { regions, pageW, pageH } = pack(sizes);

// (1) no overlaps + in bounds
let overlaps = 0, oob = 0;
const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
for (let i = 0; i < regions.length; i++) {
	const r = regions[i];
	if (r.x < 0 || r.y < 0 || r.x + r.w > pageW || r.y + r.h > pageH) oob++;
	for (let j = i + 1; j < regions.length; j++) if (overlap(r, regions[j])) overlaps++;
}
console.log(`  packed ${regions.length} images → page ${pageW}×${pageH}`);
log(overlaps === 0, `no overlapping regions (${overlaps})`);
log(oob === 0, `all regions within page bounds (${oob} out)`);

// (2) regions → atlas → reparse
const atlasText = regionsToSpineAtlas('page.png', pageW, pageH, regions);
let atlas = null;
try { atlas = new TextureAtlas(atlasText); } catch (e) { log(false, 'loader threw on synth atlas: ' + e.message); }
if (atlas) {
	log(atlas.regions.length === regions.length, `atlas has all ${regions.length} regions (${atlas.regions.length})`);
	let bad = 0;
	const by = new Map(atlas.regions.map((r) => [r.name, r]));
	for (const r of regions) {
		const a = by.get(r.name);
		if (!a || Math.round(a.x) !== r.x || Math.round(a.y) !== r.y || Math.round(a.width) !== r.w || Math.round(a.height) !== r.h) bad++;
	}
	log(bad === 0, `every region's rect round-trips (${bad} bad)`);
}

console.log(pass ? '\n✅ PASS — packer is sound + the synth atlas reproduces the packed regions.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
