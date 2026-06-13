// Verify the "draw mesh from scratch" math headlessly: over a region's quad, the
// affine-inverse UVs hit the expected corner UVs; and building a mesh from drawn
// world points (bone-local verts + affine UVs + ear-clipped tris) yields a mesh that
// loads and whose vertices land where they were drawn.
//   node tools/rigger-spike/drawmesh.mjs <skeleton.json> <skeleton.atlas>
import { readFileSync } from 'node:fs';

const SPINE_CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics, Vector2 } = await import(SPINE_CORE);

const [, , jsonPath, atlasPath] = process.argv;
const atlasText = readFileSync(atlasPath, 'utf8');
function mkAtlas() { const a = new TextureAtlas(atlasText); const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} }; for (const p of a.pages) { p.width = 2048; p.height = 2048; try { p.setTexture(stub); } catch { p.texture = stub; } } return a; }
function posed(obj) { const sk = new Skeleton(new SkeletonJson(new AtlasAttachmentLoader(mkAtlas())).readSkeletonData(obj)); sk.setToSetupPose(); try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); } return sk; }
function affineUV(c, Px, Py) { const ulx = c[2], uly = c[3], urx = c[4], ury = c[5], blx = c[0], bly = c[1]; const eux = urx - ulx, euy = ury - uly, evx = blx - ulx, evy = bly - uly; const det = eux * evy - evx * euy; if (Math.abs(det) < 1e-8) return { u: 0.5, v: 0.5 }; const rx = Px - ulx, ry = Py - uly; return { u: (rx * evy - evx * ry) / det, v: (eux * ry - rx * euy) / det }; }
function earClip(ring, w) { const P = ring.map((i) => ({ i, x: w[i * 2], y: w[i * 2 + 1] })); let area = 0; for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; area += P[i].x * P[j].y - P[j].x * P[i].y; } if (area < 0) P.reverse(); const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); const inTri = (p, a, b, c) => { const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p); return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0))); }; const v = P.slice(), t = []; let g = 0; while (v.length > 3 && g++ < 2000) { let cl = false; for (let i = 0; i < v.length; i++) { const a = v[(i - 1 + v.length) % v.length], b = v[i], c = v[(i + 1) % v.length]; if (cross(a, b, c) <= 0) continue; let ear = true; for (const q of v) { if (q === a || q === b || q === c) continue; if (inTri(q, a, b, c)) { ear = false; break; } } if (!ear) continue; t.push([a.i, b.i, c.i]); v.splice(i, 1); cl = true; break; } if (!cl) return null; } if (v.length === 3) t.push([v[0].i, v[1].i, v[2].i]); return t; }

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== draw-mesh-from-scratch: ${jsonPath} ===`);

const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const sk = posed(raw);
let hit = null;
outer: for (const skin of sk.data.skins) for (const e of (skin.getAttachments ? skin.getAttachments() : [])) {
	if (e.attachment.constructor.name === 'RegionAttachment') { hit = { skin: skin.name, slotIndex: e.slotIndex, slot: sk.data.slots[e.slotIndex].name, att: e.name, a: e.attachment }; break outer; }
}
if (!hit) { console.log('  (no region attachment — skipped)'); process.exit(0); }

const slot = sk.slots[hit.slotIndex]; slot.setAttachment(hit.a);
const c = new Array(8).fill(0); hit.a.computeWorldVertices(slot, c, 0, 2); // BL,UL,UR,BR
// (1) corner UVs
const ul = affineUV(c, c[2], c[3]), ur = affineUV(c, c[4], c[5]), bl = affineUV(c, c[0], c[1]);
const ctr = affineUV(c, (c[0] + c[2] + c[4] + c[6]) / 4, (c[1] + c[3] + c[5] + c[7]) / 4);
const near = (a, b) => Math.abs(a - b) < 0.01;
log(near(ul.u, 0) && near(ul.v, 0), `UL → (${ul.u.toFixed(2)},${ul.v.toFixed(2)}) ≈ (0,0)`);
log(near(ur.u, 1) && near(ur.v, 0), `UR → (${ur.u.toFixed(2)},${ur.v.toFixed(2)}) ≈ (1,0)`);
log(near(bl.u, 0) && near(bl.v, 1), `BL → (${bl.u.toFixed(2)},${bl.v.toFixed(2)}) ≈ (0,1)`);
log(near(ctr.u, 0.5) && near(ctr.v, 0.5), `center → (${ctr.u.toFixed(2)},${ctr.v.toFixed(2)}) ≈ (0.5,0.5)`);

// (2) build a mesh from 5 drawn points (4 corners + center) and reload
const pts = [{ x: c[0], y: c[1] }, { x: c[2], y: c[3] }, { x: c[4], y: c[5] }, { x: c[6], y: c[7] }, { x: (c[0] + c[4]) / 2, y: (c[1] + c[5]) / 2 }];
const bone = slot.bone, verts = [], uvs = [], wf = [];
for (const p of pts) { const loc = bone.worldToLocal(new Vector2(p.x, p.y)); verts.push(loc.x, loc.y); const uv = affineUV(c, p.x, p.y); uvs.push(uv.u, uv.v); wf.push(p.x, p.y); }
const tris = earClip(pts.map((_, i) => i), wf) || []; const flat = []; for (const t of tris) flat.push(t[0], t[1], t[2]);
const sk2skin = raw.skins.find((s) => s.name === hit.skin);
sk2skin.attachments[hit.slot][hit.att] = { type: 'mesh', uvs, triangles: flat, vertices: verts, hull: pts.length, width: hit.a.width, height: hit.a.height };

const sk2 = posed(raw);
const a2 = sk2.data.findSkin(hit.skin).getAttachments().find((e) => e.name === hit.att && sk2.data.slots[e.slotIndex].name === hit.slot).attachment;
log(a2 && a2.constructor.name === 'MeshAttachment', `attachment is now a mesh (${a2 && a2.constructor.name})`);
log(a2 && a2.worldVerticesLength === pts.length * 2, `mesh has ${pts.length} vertices`);
const slot2 = sk2.slots[hit.slotIndex]; slot2.setAttachment(a2);
const w2 = new Array(a2.worldVerticesLength).fill(0); a2.computeWorldVertices(slot2, 0, a2.worldVerticesLength, w2, 0, 2);
let maxOff = 0; for (let i = 0; i < pts.length; i++) maxOff = Math.max(maxOff, Math.hypot(w2[i * 2] - pts[i].x, w2[i * 2 + 1] - pts[i].y));
log(maxOff < 0.05, `drawn vertices land where placed (max off ${maxOff.toFixed(4)})`);
log(flat.length > 0, `triangulated (${flat.length / 3} triangles)`);

console.log(pass ? '\n✅ PASS — affine UVs correct; drawn mesh builds + loads + lands.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
