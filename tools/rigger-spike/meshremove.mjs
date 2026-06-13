// Verify the Phase 3.3 remove-mesh-vertex contract headlessly: remove an INTERIOR
// vertex by ear-clipping its fan's hole + reindexing (exactly as the viewer's
// removeMeshVertex writes rawDoc), reload through the official loader, and assert
// the mesh is still valid: vertex -1, all triangle indices in range, mesh poses.
//   node tools/rigger-spike/meshremove.mjs <skeleton.json> <skeleton.atlas>
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
function worldVerts(sk, slotIndex, att) { const slot = sk.slots[slotIndex]; slot.setAttachment(att); const out = new Array(att.worldVerticesLength).fill(0); att.computeWorldVertices(slot, 0, att.worldVerticesLength, out, 0, 2); return out; }

function earClip(ring, w) {
	const P = ring.map((i) => ({ i, x: w[i * 2], y: w[i * 2 + 1] }));
	let area = 0; for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; area += P[i].x * P[j].y - P[j].x * P[i].y; }
	if (area < 0) P.reverse();
	const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const inTri = (p, a, b, c) => { const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p); return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0))); };
	const v = P.slice(), tris = []; let g = 0;
	while (v.length > 3 && g++ < 2000) {
		let clipped = false;
		for (let i = 0; i < v.length; i++) {
			const a = v[(i - 1 + v.length) % v.length], b = v[i], c = v[(i + 1) % v.length];
			if (cross(a, b, c) <= 0) continue;
			let ear = true; for (const q of v) { if (q === a || q === b || q === c) continue; if (inTri(q, a, b, c)) { ear = false; break; } }
			if (!ear) continue;
			tris.push([a.i, b.i, c.i]); v.splice(i, 1); clipped = true; break;
		}
		if (!clipped) return null;
	}
	if (v.length === 3) tris.push([v[0].i, v[1].i, v[2].i]);
	return tris;
}

// build the ordered boundary ring around interior vertex k; null if not a clean fan
function ringAround(tris, k) {
	const edges = [];
	for (let t = 0; t < tris.length; t += 3) {
		const a = tris[t], b = tris[t + 1], c = tris[t + 2];
		if (a !== k && b !== k && c !== k) continue;
		if (a === k) edges.push([b, c]); else if (b === k) edges.push([c, a]); else edges.push([a, b]);
	}
	if (edges.length < 3) return null;
	const nxt = new Map(); for (const [f, to] of edges) nxt.set(f, to);
	const start = edges[0][0], ring = [start]; let cur = nxt.get(start), g = 0;
	while (cur !== undefined && cur !== start && g++ < edges.length + 2) { ring.push(cur); cur = nxt.get(cur); }
	if (cur !== start || ring.length !== edges.length) return null;
	return ring;
}

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== Phase 3.3 remove-mesh-vertex → reload: ${jsonPath} ===`);

function test(label, wantWeighted) {
	const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
	const sk = posed(raw);
	let hit = null;
	outer: for (const skin of sk.data.skins) for (const e of (skin.getAttachments ? skin.getAttachments() : [])) {
		const a = e.attachment; if (a.constructor.name !== 'MeshAttachment') continue;
		if (!!(a.bones && a.bones.length) === wantWeighted) { hit = { skin: skin.name, slotIndex: e.slotIndex, slot: sk.data.slots[e.slotIndex].name, att: e.name, a }; break outer; }
	}
	if (!hit) { console.log(`  (${label}: none — skipped)`); return; }

	const rd = raw.skins.find((s) => s.name === hit.skin).attachments[hit.slot][hit.att];
	const hull = rd.hull || 0, vc = rd.uvs.length / 2;
	const w = worldVerts(sk, hit.slotIndex, hit.a);
	// find an interior vertex with a clean fan
	let k = -1, ring = null;
	for (let cand = hull; cand < vc; cand++) { const r = ringAround(rd.triangles, cand); if (r) { k = cand; ring = r; break; } }
	if (k < 0) { console.log(`  (${label}: no interior vertex with a clean fan — skipped)`); return; }
	const filled = earClip(ring, w);
	if (!filled) { log(false, `ear-clip failed for vtx ${k}`); return; }

	const kept = [];
	for (let t = 0; t < rd.triangles.length; t += 3) { const a = rd.triangles[t], b = rd.triangles[t + 1], c = rd.triangles[t + 2]; if (a !== k && b !== k && c !== k) kept.push(a, b, c); }
	for (const tri of filled) kept.push(tri[0], tri[1], tri[2]);
	rd.uvs.splice(k * 2, 2);
	if (!hit.a.bones || !hit.a.bones.length) rd.vertices.splice(k * 2, 2);
	else { let ri = 0; for (let v = 0; v < k; v++) { const n = rd.vertices[ri]; ri += 1 + n * 4; } const n = rd.vertices[ri]; rd.vertices.splice(ri, 1 + n * 4); }
	for (let i = 0; i < kept.length; i++) if (kept[i] > k) kept[i]--;
	rd.triangles = kept;
	delete rd.edges;

	const sk2 = posed(raw);
	const a2 = sk2.data.findSkin(hit.skin).getAttachments().find((e) => e.name === hit.att && sk2.data.slots[e.slotIndex].name === hit.slot).attachment;
	const newVc = a2.worldVerticesLength / 2;
	const w2 = worldVerts(sk2, hit.slotIndex, a2);
	console.log(`  ${label}: ${hit.skin}/${hit.slot}/${hit.att} — removed interior vtx ${k} (hull ${hull}, ${vc} verts)`);
	log(!!a2, 'loader accepts the reduced mesh');
	log(newVc === vc - 1, `vertex count -1 (${vc} → ${newVc})`);
	log(a2.triangles.length % 3 === 0 && a2.triangles.length > 0, `triangles valid (${a2.triangles.length} indices)`);
	log(Array.from(a2.triangles).every((ix) => ix >= 0 && ix < newVc), 'all triangle indices in range');
	log(w2.every((v) => Number.isFinite(v)), 'all world verts finite (mesh poses cleanly)');
}

test('weighted', true);
test('unweighted', false);
console.log(pass ? '\n✅ PASS — remove-vertex (ear-clip + reindex) yields a valid mesh.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
