// Verify the rename ref-rewrite headlessly: rename a bone (with children + maybe
// constraint/animation refs) and a slot, then reload through the official loader —
// it accepts (so no dangling parent/bone/slot ref), the new names are present, the
// old gone, and a renamed bone's child parent + slot bone updated.
//   node tools/rigger-spike/rename.mjs <skeleton.json> <skeleton.atlas>
import { readFileSync } from 'node:fs';

const SPINE_CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson } = await import(SPINE_CORE);

const [, , jsonPath, atlasPath] = process.argv;
const atlasText = readFileSync(atlasPath, 'utf8');
function load(obj) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = 2048; p.height = 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(obj);
}
const clean = (n) => (n || '').trim().replace(/[^\w\-. ]/g, '_');

function renameBone(raw, oldName, newName) {
	for (const b of raw.bones) { if (b.name === oldName) b.name = newName; if (b.parent === oldName) b.parent = newName; }
	for (const s of raw.slots || []) if (s.bone === oldName) s.bone = newName;
	for (const grp of ['ik', 'transform', 'path']) for (const c of raw[grp] || []) { if (Array.isArray(c.bones)) c.bones = c.bones.map((n) => (n === oldName ? newName : n)); if (c.target === oldName) c.target = newName; if (c.bone === oldName) c.bone = newName; }
	for (const an of Object.values(raw.animations || {})) if (an.bones && an.bones[oldName]) { an.bones[newName] = an.bones[oldName]; delete an.bones[oldName]; }
}
function renameSlot(raw, oldName, newName) {
	for (const s of raw.slots || []) if (s.name === oldName) s.name = newName;
	for (const sk of raw.skins || []) if (sk.attachments && sk.attachments[oldName]) { sk.attachments[newName] = sk.attachments[oldName]; delete sk.attachments[oldName]; }
	for (const an of Object.values(raw.animations || {})) {
		if (an.slots && an.slots[oldName]) { an.slots[newName] = an.slots[oldName]; delete an.slots[oldName]; }
		if (an.deform) for (const sm of Object.values(an.deform)) if (sm && sm[oldName]) { sm[newName] = sm[oldName]; delete sm[oldName]; }
		if (Array.isArray(an.drawOrder)) for (const fr of an.drawOrder) if (Array.isArray(fr.offsets)) for (const o of fr.offsets) if (o.slot === oldName) o.slot = newName;
	}
}

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== rename → reload: ${jsonPath} ===`);

const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
// pick a bone WITH children (so parent-ref rewrite is exercised)
const childOf = new Map();
for (const b of raw.bones) { if (!b.parent) continue; if (!childOf.has(b.parent)) childOf.set(b.parent, []); childOf.get(b.parent).push(b.name); }
const boneOld = [...childOf.keys()][0] || (raw.bones[1] && raw.bones[1].name);
const boneNew = clean(boneOld + '_R');
const aChild = childOf.has(boneOld) ? childOf.get(boneOld)[0] : null;
renameBone(raw, boneOld, boneNew);
// rename a slot if any
let slotOld = null, slotNew = null;
if (raw.slots && raw.slots.length) { slotOld = raw.slots[0].name; slotNew = clean(slotOld + '_R'); renameSlot(raw, slotOld, slotNew); }

let data = null;
try { data = load(JSON.parse(JSON.stringify(raw))); } catch (e) { log(false, 'loader threw (dangling ref?): ' + e.message); }
if (data) {
	const bn = data.bones.map((b) => b.name);
	log(true, 'loader accepts the renamed skeleton (no dangling refs)');
	log(bn.includes(boneNew) && !bn.includes(boneOld), `bone "${boneOld}" → "${boneNew}"`);
	if (aChild) {
		const child = data.bones.find((b) => b.name === aChild);
		log(child && child.parent && child.parent.name === boneNew, `child "${aChild}".parent → "${boneNew}" (${child && child.parent && child.parent.name})`);
	}
	if (slotOld) {
		const sn = data.slots.map((s) => s.name);
		log(sn.includes(slotNew) && !sn.includes(slotOld), `slot "${slotOld}" → "${slotNew}"`);
	}
}

console.log(pass ? '\n✅ PASS — rename rewrites refs; skeleton stays valid.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
