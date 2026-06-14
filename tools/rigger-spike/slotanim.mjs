// Phase 5.4 spike — prove the SLOT timelines (attachment swap + rgba colour) the slot
// animator will write load through spine-core and play as expected.
//   slots[slot].attachment = [{time, name|null}]            (stepped)
//   slots[slot].rgba       = [{time, color:"rrggbbaa", curve?}]
//   node tools/rigger-spike/slotanim.mjs <skeleton.json> <skeleton.atlas>
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
function apply(raw, t) {
	const data = loadData(raw); const anim = data.findAnimation('slotAnim'); const sk = new Skeleton(data);
	sk.setToSetupPose(); anim.apply(sk, 0, t, false, null, 1, MixBlend.setup, MixDirection.mixIn);
	try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }
	return sk;
}

const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
// a slot with a setup attachment (so we have a valid attachment name to swap)
const slot = (raw.slots || []).find((s) => s.attachment);
let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== Phase 5.4 slot timelines → reload: ${jsonPath} ===`);
if (!slot) { console.log('  (no slot with a setup attachment — skipped)'); process.exit(0); }
const sName = slot.name, aName = slot.attachment;
console.log(`  slot "${sName}" · attachment "${aName}"`);

// (1) attachment swap: name → null at 0.5 (stepped)
raw.animations = { slotAnim: { slots: { [sName]: { attachment: [{ time: 0, name: aName }, { time: 0.5, name: null }] } } } };
{
	const before = apply(raw, 0.2).findSlot(sName).attachment;
	const after = apply(raw, 0.6).findSlot(sName).attachment;
	log(before && before.name === aName, `@0.2 shows "${aName}" (${before ? before.name : 'none'})`);
	log(after == null, `@0.6 shows nothing (stepped swap to null)`);
}

// (2) rgba: white(ffffffff) → half-red-fade(ff000080) linearly; @0.5 ≈ (1, .5, .5, .5)
raw.animations = { slotAnim: { slots: { [sName]: { rgba: [{ time: 0, color: 'ffffffff' }, { time: 1, color: 'ff000080' }] } } } };
{
	const c0 = apply(raw, 0).findSlot(sName).color;
	log(Math.abs(c0.r - 1) < 1e-3 && Math.abs(c0.g - 1) < 1e-3 && Math.abs(c0.a - 1) < 1e-3, `@0 colour = white (r${c0.r.toFixed(2)} g${c0.g.toFixed(2)} a${c0.a.toFixed(2)})`);
	const c = apply(raw, 0.5).findSlot(sName).color;
	// 0x80/255 = .502 ; midpoint g = (1+0)/2 = .5 ; a = (1+.502)/2 = .751
	log(Math.abs(c.r - 1) < 1e-2, `@0.5 r stays 1 (${c.r.toFixed(3)})`);
	log(Math.abs(c.g - 0.5) < 1e-2, `@0.5 g ≈ 0.5 (${c.g.toFixed(3)})`);
	log(Math.abs(c.a - 0.751) < 1e-2, `@0.5 a ≈ 0.75 (${c.a.toFixed(3)})`);
}

console.log(pass ? '\n✅ PASS — slot attachment-swap + rgba colour timelines load + play as authored.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
