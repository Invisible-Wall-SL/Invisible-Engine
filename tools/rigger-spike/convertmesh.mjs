// Verify the Phase 3.4 region→mesh conversion headlessly: replace a region
// attachment with a quad mesh built from its bone-local corner offsets (as the
// viewer's convertRegionToMesh writes rawDoc), reload through the official loader,
// and assert the result is a MeshAttachment whose 4 world corners match the
// region's original world corners (geometry preserved).
//   node tools/rigger-spike/convertmesh.mjs <skeleton.json> <skeleton.atlas>
import { readFileSync } from 'node:fs';

const SPINE_CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics } = await import(SPINE_CORE);

const [, , jsonPath, atlasPath] = process.argv;
const atlasText = readFileSync(atlasPath, 'utf8');
function loadData(obj) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = 2048; p.height = 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(obj);
}
function posed(obj) { const sk = new Skeleton(loadData(obj)); sk.setToSetupPose(); try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); } return sk; }

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== Phase 3.4 region→mesh convert → reload: ${jsonPath} ===`);

const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const sk = posed(raw);
// find a region attachment + slot/skin
let hit = null;
outer: for (const skin of sk.data.skins) for (const e of (skin.getAttachments ? skin.getAttachments() : [])) {
	if (e.attachment.constructor.name === 'RegionAttachment') { hit = { skin: skin.name, slotIndex: e.slotIndex, slot: sk.data.slots[e.slotIndex].name, att: e.name, a: e.attachment }; break outer; }
}
if (!hit) { console.log('  (no region attachment — skipped)'); process.exit(0); }

const slot = sk.slots[hit.slotIndex];
slot.setAttachment(hit.a);
if (hit.a.updateRegion) hit.a.updateRegion();
// region's 4 world corners
const before = new Array(8).fill(0);
hit.a.computeWorldVertices(slot, before, 0, 2);

// build the mesh entry (matches convertRegionToMesh)
const region = raw.skins.find((s) => s.name === hit.skin).attachments[hit.slot][hit.att];
const mesh = { type: 'mesh', uvs: [0, 1, 0, 0, 1, 0, 1, 1], triangles: [0, 1, 2, 2, 3, 0], vertices: Array.from(hit.a.offset), hull: 4, width: hit.a.width, height: hit.a.height };
if (region.path) mesh.path = region.path;
raw.skins.find((s) => s.name === hit.skin).attachments[hit.slot][hit.att] = mesh;

const sk2 = posed(raw);
const a2 = sk2.data.findSkin(hit.skin).getAttachments().find((e) => e.name === hit.att && sk2.data.slots[e.slotIndex].name === hit.slot).attachment;
console.log(`  ${hit.skin}/${hit.slot}/${hit.att} — region → quad mesh`);
log(!!a2, 'loader accepts the converted skeleton');
log(a2 && a2.constructor.name === 'MeshAttachment', `attachment is now a mesh (${a2 && a2.constructor.name})`);
log(a2 && a2.worldVerticesLength === 8, `mesh has 4 vertices (worldVerticesLength ${a2 && a2.worldVerticesLength})`);
const slot2 = sk2.slots[hit.slotIndex]; slot2.setAttachment(a2);
const after = new Array(a2.worldVerticesLength).fill(0);
a2.computeWorldVertices(slot2, 0, a2.worldVerticesLength, after, 0, 2);
let maxOff = 0; for (let i = 0; i < 8; i++) maxOff = Math.max(maxOff, Math.abs(after[i] - before[i]));
log(maxOff < 0.05, `mesh corners match the region's world corners (max off ${maxOff.toFixed(4)})`);

console.log(pass ? '\n✅ PASS — region→mesh preserves geometry (same world corners).' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
