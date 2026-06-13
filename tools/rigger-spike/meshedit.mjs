// Verify the Phase 3.1 mesh-vertex-move math headlessly: move a vertex by a WORLD
// delta by editing the rawDoc PACKED vertices (the persisted format the viewer's
// applyMeshVertexDelta writes), reload through the official loader, and assert the
// vertex's setup-pose WORLD position moved by ~that delta while another vertex did
// not. Covers weighted (per-influence, bone-local) and unweighted (slot-bone local).
//   node tools/rigger-spike/meshedit.mjs <skeleton.json> <skeleton.atlas>
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
const clone = (o) => JSON.parse(JSON.stringify(o));
function posed(obj) {
	const sk = new Skeleton(loadData(obj));
	sk.setToSetupPose();
	try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }
	return sk;
}
function worldVerts(sk, slotIndex, att) {
	const slot = sk.slots[slotIndex];
	slot.setAttachment(att);
	const out = new Array(att.worldVerticesLength).fill(0);
	att.computeWorldVertices(slot, 0, att.worldVerticesLength, out, 0, 2);
	return out;
}
const invWorldVec = (b, wx, wy) => {
	const det = b.a * b.d - b.b * b.c;
	if (Math.abs(det) < 1e-8) return { x: wx, y: wy };
	return { x: (b.d * wx - b.b * wy) / det, y: (b.a * wy - b.c * wx) / det };
};

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== Phase 3.1 mesh-vertex move → reload: ${jsonPath} ===`);

function testMesh(label, wantWeighted) {
	const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
	const sk = posed(raw);
	const data = sk.data;
	// find a mesh attachment of the requested kind
	let hit = null;
	for (const skin of data.skins) {
		for (const e of (skin.getAttachments ? skin.getAttachments() : [])) {
			const a = e.attachment;
			if (a.constructor.name !== 'MeshAttachment') continue;
			const weighted = !!(a.bones && a.bones.length);
			if (weighted === wantWeighted) { hit = { skin: skin.name, slotIndex: e.slotIndex, slot: data.slots[e.slotIndex].name, att: e.name, a, weighted }; break; }
		}
		if (hit) break;
	}
	if (!hit) { console.log(`  (${label}: none in this skeleton — skipped)`); return; }

	const before = worldVerts(sk, hit.slotIndex, hit.a);
	const vc = hit.a.worldVerticesLength / 2;
	const k = Math.min(2, vc - 1), k2 = 0 === k ? Math.min(1, vc - 1) : 0;
	const WDX = 19, WDY = -13;

	// edit the rawDoc PACKED vertices exactly as the viewer's applyMeshVertexDelta does
	const rd = raw.skins.find((s) => s.name === hit.skin).attachments[hit.slot][hit.att];
	if (hit.weighted) {
		let ri = 0;
		for (let v = 0; v < k; v++) { const nn = rd.vertices[ri]; ri += 1 + nn * 4; }
		const n = rd.vertices[ri];
		for (let j = 0; j < n; j++) {
			const boneIdx = rd.vertices[ri + 1 + j * 4];
			const lv = invWorldVec(sk.bones[boneIdx], WDX, WDY);
			rd.vertices[ri + 1 + j * 4 + 1] += lv.x;
			rd.vertices[ri + 1 + j * 4 + 2] += lv.y;
		}
	} else {
		const bone = sk.slots[hit.slotIndex].bone;
		const lv = invWorldVec(bone, WDX, WDY);
		rd.vertices[k * 2] += lv.x; rd.vertices[k * 2 + 1] += lv.y;
	}

	// reload + recompute
	const sk2 = posed(raw);
	const a2 = sk2.data.findSkin(hit.skin).getAttachments().find((e) => e.name === hit.att && sk2.data.slots[e.slotIndex].name === hit.slot).attachment;
	const after = worldVerts(sk2, hit.slotIndex, a2);

	const movedX = after[k * 2] - before[k * 2], movedY = after[k * 2 + 1] - before[k * 2 + 1];
	const otherDrift = Math.hypot(after[k2 * 2] - before[k2 * 2], after[k2 * 2 + 1] - before[k2 * 2 + 1]);
	console.log(`  ${label}: ${hit.skin}/${hit.slot}/${hit.att} vtx ${k} by world (${WDX},${WDY})`);
	log(Math.abs(movedX - WDX) < 0.05 && Math.abs(movedY - WDY) < 0.05, `vtx ${k} moved by (${movedX.toFixed(2)}, ${movedY.toFixed(2)})`);
	log(otherDrift < 0.05, `vtx ${k2} unchanged (drift ${otherDrift.toFixed(3)})`);
}

testMesh('weighted', true);
testMesh('unweighted', false);
console.log(pass ? '\n✅ PASS — mesh vertex move persists with the right world displacement.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
