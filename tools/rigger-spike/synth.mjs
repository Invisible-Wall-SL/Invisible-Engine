// Verify the Phase A2-fix .atlas synthesis: take a real atlas's regions, synthesise
// a Spine .atlas via the same logic as spine.ts regionsToSpineAtlas, re-parse it with
// the official TextureAtlas, and assert the regions round-trip (same names + on-page
// rects + original sizes). This is what New-rig writes into the spine bundle.
//   node tools/rigger-spike/synth.mjs <skeleton.atlas>
import { readFileSync } from 'node:fs';

const SPINE_CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
const { TextureAtlas } = await import(SPINE_CORE);

const atlasPath = process.argv[2];
const atlasText = readFileSync(atlasPath, 'utf8');

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
		if (r.rotated) out.push('rotate:90');
	}
	return out.join('\n') + '\n';
}
const reg = (a) => a.regions.map((r) => ({ name: r.name, x: r.x, y: r.y, w: r.width, h: r.height, rotated: r.degrees === 90 || r.rotate === true, offX: r.offsetX, offY: r.offsetY, origW: r.originalWidth, origH: r.originalHeight }));

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== A2-fix atlas synthesis round-trip: ${atlasPath} ===`);

const orig = new TextureAtlas(atlasText);
const pw = orig.pages[0]?.width || 2048, ph = orig.pages[0]?.height || 2048;
const regions = reg(orig);
const synth = regionsToSpineAtlas('page.png', pw, ph, regions);
let re = null;
try { re = new TextureAtlas(synth); } catch (e) { log(false, 'official loader threw on the synthesised atlas: ' + e.message); }
if (re) {
	log(true, `loader parses the synthesised atlas (${orig.regions.length} regions)`);
	const after = new Map(reg(re).map((r) => [r.name, r]));
	let mismatch = 0, rotated = 0;
	for (const r of regions) {
		if (r.rotated) rotated++;
		const a = after.get(r.name);
		if (!a) { mismatch++; continue; }
		if (Math.round(a.x) !== Math.round(r.x) || Math.round(a.y) !== Math.round(r.y) || Math.round(a.w) !== Math.round(r.w) || Math.round(a.h) !== Math.round(r.h)) mismatch++;
		else if (Math.round(a.origW) !== Math.round(r.origW) || Math.round(a.origH) !== Math.round(r.origH)) mismatch++;
	}
	log(after.size === regions.length, `region count preserved (${after.size}/${regions.length})`);
	log(mismatch === 0, `all regions round-trip (rect+orig) — ${mismatch} mismatch (${rotated} rotated)`);
}

console.log(pass ? '\n✅ PASS — synthesised .atlas reproduces the regions.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
