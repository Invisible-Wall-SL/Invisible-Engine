// Verify the Phase 3.2 add-mesh-vertex math headlessly: split a triangle by adding
// a vertex at its centroid, with barycentric-interpolated UV + (weighted) bone
// influences — exactly as the viewer's addMeshVertex writes rawDoc — then reload
// through the official loader and assert the mesh grew correctly and still poses.
//   node tools/rigger-spike/meshadd.mjs <skeleton.json> <skeleton.atlas>
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
function worldVerts(sk, slotIndex, att) { const slot = sk.slots[slotIndex]; slot.setAttachment(att); const out = new Array(att.worldVerticesLength).fill(0); att.computeWorldVertices(slot, 0, att.worldVerticesLength, out, 0, 2); return out; }
function packedInfluences(v, i) { let ri = 0; for (let k = 0; k < i; k++) { const n = v[ri]; ri += 1 + n * 4; } const n = v[ri], o = []; for (let j = 0; j < n; j++) o.push({ bone: v[ri + 1 + j * 4], w: v[ri + 1 + j * 4 + 3] }); return o; }

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== Phase 3.2 add-mesh-vertex → reload: ${jsonPath} ===`);

function test(label, wantWeighted) {
	const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
	const sk = posed(raw);
	let hit = null;
	outer: for (const skin of sk.data.skins) for (const e of (skin.getAttachments ? skin.getAttachments() : [])) {
		const a = e.attachment; if (a.constructor.name !== 'MeshAttachment') continue;
		if (!!(a.bones && a.bones.length) === wantWeighted) { hit = { skin: skin.name, slotIndex: e.slotIndex, slot: sk.data.slots[e.slotIndex].name, att: e.name, a }; break outer; }
	}
	if (!hit) { console.log(`  (${label}: none — skipped)`); return; }

	const w = worldVerts(sk, hit.slotIndex, hit.a);
	const rd = raw.skins.find((s) => s.name === hit.skin).attachments[hit.slot][hit.att];
	const triBefore = rd.triangles.length, vcBefore = rd.uvs.length / 2;
	// centroid of triangle 0
	const ia = rd.triangles[0], ib = rd.triangles[1], ic = rd.triangles[2];
	const Px = (w[ia * 2] + w[ib * 2] + w[ic * 2]) / 3, Py = (w[ia * 2 + 1] + w[ib * 2 + 1] + w[ic * 2 + 1]) / 3;
	// barycentric of centroid is (1/3,1/3,1/3)
	const n = rd.uvs.length / 2;
	const U = 1 / 3;
	rd.uvs.push(U * rd.uvs[ia * 2] + U * rd.uvs[ib * 2] + U * rd.uvs[ic * 2], U * rd.uvs[ia * 2 + 1] + U * rd.uvs[ib * 2 + 1] + U * rd.uvs[ic * 2 + 1]);
	if (!hit.a.bones || !hit.a.bones.length) {
		const loc = sk.slots[hit.slotIndex].bone.worldToLocal(new Vector2(Px, Py));
		rd.vertices.push(loc.x, loc.y);
	} else {
		const map = new Map();
		for (const corner of [ia, ib, ic]) for (const inf of packedInfluences(rd.vertices, corner)) map.set(inf.bone, (map.get(inf.bone) || 0) + U * inf.w);
		const entries = [...map.entries()].filter(([, x]) => x > 1e-6);
		let sum = 0; for (const [, x] of entries) sum += x; if (sum <= 0) sum = 1;
		rd.vertices.push(entries.length);
		for (const [bi, wt] of entries) { const loc = sk.bones[bi].worldToLocal(new Vector2(Px, Py)); rd.vertices.push(bi, loc.x, loc.y, wt / sum); }
	}
	rd.triangles.splice(0, 3, ia, ib, n, ib, ic, n, ic, ia, n);

	const sk2 = posed(raw);
	const a2 = sk2.data.findSkin(hit.skin).getAttachments().find((e) => e.name === hit.att && sk2.data.slots[e.slotIndex].name === hit.slot).attachment;
	const w2 = worldVerts(sk2, hit.slotIndex, a2);
	console.log(`  ${label}: ${hit.skin}/${hit.slot}/${hit.att} — split tri 0, new vtx ${n} at centroid`);
	log(!!a2, 'loader accepts the grown mesh');
	log(rd.uvs.length / 2 === vcBefore + 1, `vertex count +1 (${vcBefore} → ${rd.uvs.length / 2})`);
	log(rd.triangles.length === triBefore + 6, `triangle indices +6 (${triBefore} → ${rd.triangles.length})`);
	const dx = w2[n * 2] - Px, dy = w2[n * 2 + 1] - Py;
	log(Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05, `new vertex world pos ≈ centroid (off by ${Math.hypot(dx, dy).toFixed(3)})`);
	log(w2.every((v) => Number.isFinite(v)), 'all world verts finite (mesh poses cleanly)');
}

test('weighted', true);
test('unweighted', false);
console.log(pass ? '\n✅ PASS — add-vertex (triangle split + barycentric UV/weights) round-trips.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
