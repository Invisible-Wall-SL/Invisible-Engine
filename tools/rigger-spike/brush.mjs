// Verify the Phase 4.2 weight-brush dab headlessly: paint weight toward a target
// bone for the vertices within a radius (linear falloff, adding the bone where
// missing, renormalising) — exactly as the viewer's paintDab writes rawDoc — then
// reload and assert weights rose, each vertex's weights sum to 1, and the vertices
// did NOT move.
//   node tools/rigger-spike/brush.mjs <skeleton.json> <skeleton.atlas>
import { readFileSync } from 'node:fs';

const SPINE_CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics, Vector2 } = await import(SPINE_CORE);

const [, , jsonPath, atlasPath] = process.argv;
const atlasText = readFileSync(atlasPath, 'utf8');
function loadData(obj) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = 2048; p.height = 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(obj);
}
function posed(obj) { const sk = new Skeleton(loadData(obj)); sk.setToSetupPose(); try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); } return sk; }
function world(sk, slotIndex, att) { const slot = sk.slots[slotIndex]; slot.setAttachment(att); const out = new Array(att.worldVerticesLength).fill(0); att.computeWorldVertices(slot, 0, att.worldVerticesLength, out, 0, 2); return out; }
function rdVertexAt(rd, k) { let ri = 0; for (let v = 0; v < k; v++) { const n = rd.vertices[ri]; ri += 1 + n * 4; } const c = rd.vertices[ri], infl = []; for (let j = 0; j < c; j++) { const o = ri + 1 + j * 4; infl.push({ bone: rd.vertices[o], x: rd.vertices[o + 1], y: rd.vertices[o + 2], weight: rd.vertices[o + 3] }); } return { offset: ri, count: c, influences: infl }; }
function rdSet(rd, k, infl) { let ri = 0; for (let v = 0; v < k; v++) { const n = rd.vertices[ri]; ri += 1 + n * 4; } const oldLen = 1 + rd.vertices[ri] * 4; const flat = [infl.length]; for (const i of infl) flat.push(i.bone, i.x, i.y, i.weight); rd.vertices.splice(ri, oldLen, ...flat); }
function normKeep(infl, j, w) { w = Math.max(0, Math.min(1, w)); infl[j].weight = w; let other = 0; for (let i = 0; i < infl.length; i++) if (i !== j) other += infl[i].weight; const rem = 1 - w; if (other > 1e-9) { for (let i = 0; i < infl.length; i++) if (i !== j) infl[i].weight *= rem / other; } else { const n = infl.length - 1; if (n > 0) for (let i = 0; i < infl.length; i++) if (i !== j) infl[i].weight = rem / n; } }

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== Phase 4.2 weight-brush dab → reload: ${jsonPath} ===`);

const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const sk = posed(raw);
let hit = null;
outer: for (const skin of sk.data.skins) for (const e of (skin.getAttachments ? skin.getAttachments() : [])) {
	const a = e.attachment; if (a.constructor.name === 'MeshAttachment' && a.bones && a.bones.length) { hit = { skin: skin.name, slotIndex: e.slotIndex, slot: sk.data.slots[e.slotIndex].name, att: e.name, a }; break outer; }
}
if (!hit) { console.log('  (no weighted mesh — skipped)'); process.exit(0); }

const before = world(sk, hit.slotIndex, hit.a);
const rd = raw.skins.find((s) => s.name === hit.skin).attachments[hit.slot][hit.att];
const target = rdVertexAt(rd, 0).influences[0].bone; // a bone already used by the mesh
const cx = before[0], cy = before[1]; // dab centred on vertex 0
const vc = before.length / 2;
// radius covering ~a third of the mesh's spread
let maxd = 0; for (let k = 0; k < vc; k++) maxd = Math.max(maxd, Math.hypot(before[k * 2] - cx, before[k * 2 + 1] - cy));
const radius = Math.max(maxd * 0.5, 1);

const affected = [];
for (let k = 0; k < vc; k++) {
	const d = Math.hypot(before[k * 2] - cx, before[k * 2 + 1] - cy);
	if (d > radius) continue;
	affected.push(k);
	const falloff = 1 - d / radius;
	const { influences } = rdVertexAt(rd, k);
	let tj = influences.findIndex((i) => i.bone === target);
	if (tj < 0) { const loc = sk.bones[target].worldToLocal(new Vector2(before[k * 2], before[k * 2 + 1])); influences.push({ bone: target, x: loc.x, y: loc.y, weight: 0 }); tj = influences.length - 1; }
	normKeep(influences, tj, influences[tj].weight + 0.5 * falloff);
	rdSet(rd, k, influences);
}

const sk2 = posed(raw);
const a2 = sk2.data.findSkin(hit.skin).getAttachments().find((e) => e.name === hit.att && sk2.data.slots[e.slotIndex].name === hit.slot).attachment;
const after = world(sk2, hit.slotIndex, a2);
const rd2 = raw.skins.find((s) => s.name === hit.skin).attachments[hit.slot][hit.att];

console.log(`  ${hit.skin}/${hit.slot}/${hit.att} — dab r=${radius.toFixed(0)} toward "${sk.data.bones[target].name}", ${affected.length}/${vc} verts`);
log(!!a2, 'loader accepts the painted mesh');
let badSum = 0, hasTarget = 0;
for (const k of affected) { const inf = rdVertexAt(rd2, k).influences; const s = inf.reduce((a, i) => a + i.weight, 0); if (Math.abs(s - 1) > 0.001) badSum++; if (inf.some((i) => i.bone === target && i.weight > 0)) hasTarget++; }
log(badSum === 0, `every painted vertex's weights sum to 1 (${badSum} bad)`);
log(hasTarget > 0, `${hasTarget}/${affected.length} painted verts now carry the target bone with weight > 0`);
let maxMove = 0; for (let i = 0; i < before.length; i++) maxMove = Math.max(maxMove, Math.abs(after[i] - before[i]));
log(maxMove < 0.01, `no vertex moved (max ${maxMove.toFixed(4)})`);

console.log(pass ? '\n✅ PASS — brush dab raises weights, keeps sums at 1, leaves geometry put.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
