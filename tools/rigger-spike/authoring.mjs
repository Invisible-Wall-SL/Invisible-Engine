// Verify the Phase 5.1 authoring primitives headlessly: starting from a MINIMAL
// blank skeleton, apply add-bone / add-slot / add-skin (as the viewer's ops mutate
// rawDoc) and confirm the result loads through the official loader with the new
// bone/slot/skin present and correctly parented. No atlas regions are referenced
// (empty default skin + attachment-less slot), so an empty atlas suffices.
//   node tools/rigger-spike/authoring.mjs
import { fileURLToPath } from 'node:url';

const SPINE_CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson } = await import(SPINE_CORE);

function load(doc) {
	const atlas = new TextureAtlas('\n'); // empty atlas — no regions needed
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(doc);
}
const uniqueName = (base, names) => { let n = 1; while (names.has(base + n)) n++; return base + n; };

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== Phase 5.1 authoring primitives (from a blank skeleton) ===`);

// a minimal blank skeleton (what "New rig" will produce)
const doc = { skeleton: { spine: '4.2' }, bones: [{ name: 'root' }], slots: [], skins: [{ name: 'default', attachments: {} }], animations: {} };

// addBone(root) → bone1 ; addBone(bone1) → bone2
function addBone(parent) { const name = uniqueName('bone', new Set(doc.bones.map((b) => b.name))); doc.bones.push({ name, parent, x: 0, y: 0 }); return name; }
const b1 = addBone('root');
const b2 = addBone(b1);
// addSlot(bone1) → slot1
function addSlot(bone) { const name = uniqueName('slot', new Set(doc.slots.map((s) => s.name))); doc.slots.push({ name, bone }); return name; }
const s1 = addSlot(b1);
// addSkin → skin1
function addSkin() { const name = uniqueName('skin', new Set(doc.skins.map((s) => s.name))); doc.skins.push({ name, attachments: {} }); return name; }
const sk1 = addSkin();

// serialize → reload
const out = JSON.stringify(doc);
let data = null;
try { data = load(JSON.parse(out)); } catch (e) { log(false, 'loader threw: ' + e.message); }

if (data) {
	log(true, 'official loader accepts the from-scratch skeleton');
	const bn = data.bones.map((b) => b.name);
	log(bn.includes('root') && bn.includes(b1) && bn.includes(b2), `bones present: ${bn.join(', ')}`);
	const bb2 = data.bones.find((b) => b.name === b2);
	log(bb2 && bb2.parent && bb2.parent.name === b1, `${b2}.parent === ${b1} (${bb2 && bb2.parent && bb2.parent.name})`);
	const sl = data.slots.find((s) => s.name === s1);
	log(sl && sl.boneData.name === b1, `slot ${s1} on bone ${b1} (${sl && sl.boneData.name})`);
	log(data.skins.some((s) => s.name === sk1) && data.skins.some((s) => s.name === 'default'), `skins present: ${data.skins.map((s) => s.name).join(', ')}`);
}

console.log(pass ? '\n✅ PASS — a rig built from scratch via the authoring ops loads cleanly.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
