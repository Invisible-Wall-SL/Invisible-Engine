// Verify the Phase 3.5 UV-edit contract headlessly: change a mesh vertex's region UV
// in rawDoc (as the viewer's applyVertexUV does), reload through the official loader,
// and assert the new UV is present on the reloaded mesh's regionUVs (and the page
// uvs recompute finite).
//   node tools/rigger-spike/uvedit.mjs <skeleton.json> <skeleton.atlas>
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
const clone = (o) => JSON.parse(JSON.stringify(o));

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== Phase 3.5 UV-edit → reload: ${jsonPath} ===`);

const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const before = load(clone(raw));
let hit = null;
outer: for (const skin of before.skins) for (const e of (skin.getAttachments ? skin.getAttachments() : [])) {
	if (e.attachment.constructor.name === 'MeshAttachment') { hit = { skin: skin.name, slot: before.slots[e.slotIndex].name, att: e.name, a: e.attachment }; break outer; }
}
if (!hit) { console.log('  (no mesh attachment — skipped)'); process.exit(0); }

const i = 1; // edit vertex 1's u
const rd = raw.skins.find((s) => s.name === hit.skin).attachments[hit.slot][hit.att];
const oldU = rd.uvs[i * 2];
const NEW_U = Math.min(1, Math.max(0, oldU + 0.15));
rd.uvs[i * 2] = NEW_U;

const after = load(clone(raw));
const a2 = after.findSkin(hit.skin).getAttachments().find((e) => e.name === hit.att && after.slots[e.slotIndex].name === hit.slot).attachment;
console.log(`  ${hit.skin}/${hit.slot}/${hit.att} vtx ${i} u: ${oldU.toFixed(3)} → ${NEW_U.toFixed(3)}`);
log(!!a2, 'loader accepts the UV-edited mesh');
log(a2 && Math.abs(a2.regionUVs[i * 2] - NEW_U) < 0.001, `regionUVs u present on reload (${a2 && a2.regionUVs[i * 2].toFixed(3)})`);
log(a2 && Array.from(a2.uvs).every((v) => Number.isFinite(v)), 'computed page uvs all finite');

console.log(pass ? '\n✅ PASS — UV edit persists onto the reloaded mesh.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
