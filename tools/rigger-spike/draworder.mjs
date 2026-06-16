// Phase 5.4 spike — prove the draw-order `offsets` we generate reconstruct to the exact
// target order through spine-core (the reader interleaves "unchanged" slots, so a naive
// offset list can silently produce the wrong order). Format:
//   animations[a].drawOrder = [{ time, offsets:[{slot, offset}] }]   (offset = newDrawPos - setupIndex)
//   node tools/rigger-spike/draworder.mjs <skeleton.json> <skeleton.atlas>
import { readFileSync } from 'node:fs';

const CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics, MixBlend, MixDirection } = await import(CORE);

const [, , jsonPath, atlasPath] = process.argv;
const atlasText = readFileSync(atlasPath, 'utf8');
function loadData(obj) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = 2048; p.height = 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(obj);
}
// THE generator the viewer will use: target[drawPos] = setupSlotIndex → offsets (moved only, sorted by setup index).
function offsetsFor(target, slotNames) {
	const drawPosOf = new Array(target.length);
	for (let pos = 0; pos < target.length; pos++) drawPosOf[target[pos]] = pos;
	const offs = [];
	for (let oi = 0; oi < target.length; oi++){ const off = drawPosOf[oi] - oi; if (off !== 0) offs.push({ slot: slotNames[oi], offset: off }); }
	return offs;
}

const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const slotNames = (raw.slots || []).map((s) => s.name);
const n = slotNames.length;
let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== Phase 5.4 draw-order offsets → reload: ${jsonPath} (${n} slots) ===`);

// deterministic pseudo-random permutations (no Math.random — keep it reproducible)
function shuffle(seed) {
	const a = Array.from({ length: n }, (_, i) => i);
	let s = seed;
	for (let i = n - 1; i > 0; i--){ s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
	return a;
}
let bad = 0, tested = 0;
for (const seed of [1, 7, 42, 1000, 99999]){
	const target = shuffle(seed); // target[drawPos] = setupIndex
	const offsets = offsetsFor(target, slotNames);
	raw.animations = { doAnim: { drawOrder: [{ time: 0, offsets }] } };
	let data; try { data = loadData(raw); } catch (e) { log(false, 'loader threw: ' + e.message); break; }
	const anim = data.findAnimation('doAnim'); const sk = new Skeleton(data);
	sk.setToSetupPose();
	anim.apply(sk, 0, 0.1, false, [], 1, MixBlend.setup, MixDirection.mixIn);
	try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }
	const got = sk.drawOrder.map((s) => s.data.index);
	const ok = got.length === target.length && got.every((v, i) => v === target[i]);
	tested++; if (!ok){ bad++; if (bad <= 2) console.log('   seed ' + seed + ' MISMATCH\n     want ' + target.slice(0, 12) + '…\n     got  ' + got.slice(0, 12) + '…'); }
}
log(bad === 0, `all ${tested} random permutations reconstruct exactly (${bad} mismatched)`);

console.log(pass ? '\n✅ PASS — moved-only offsets reproduce the target draw order through spine-core.' : '\n✗ FAIL — need the full-list fallback.');
process.exit(pass ? 0 : 1);
