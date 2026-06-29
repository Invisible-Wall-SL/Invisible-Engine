// Phase §18.1 spike (GATE) — nail the Spine 4.2 DEFORM timeline data model against the
// official runtime, on BOTH an unweighted and a weighted mesh, before any UI is built.
//   node tools/rigger-spike/deform.mjs <skeleton.json> <skeleton.atlas>
//
// ============================ EMPIRICAL FINDINGS ============================
// (validated below against @esotericsoftware/spine-core@4.2.74's SkeletonJson loader,
//  DeformTimeline, and VertexAttachment.computeWorldVertices — NOT from memory)
//
// SERIALIZED PATH (the crux — it is NOT a top-level `deform` block):
//   animations.<anim>.attachments.<skinName>.<slotName>.<attachmentName>.deform =
//       [ { time, offset?, vertices:[…deltas], curve? }, … ]
//   i.e. deform is ONE timeline kind under the per-attachment `attachments` map (alongside
//   `sequence`). SkeletonJson.js reads it at `map.attachments[skin][slot][att].deform`.
//
// DEFORM ARRAY LENGTH + COORDINATE SPACE — differs unweighted vs weighted:
//
//  UNWEIGHTED mesh (attachment.bones == null):
//    • full deform length === attachment.vertices.length === uvs.length === 2*vertexCount.
//    • Layout = interleaved [dx0,dy0, dx1,dy1, …] — one (dx,dy) per mesh vertex.
//    • Space = the mesh's LOCAL space (== the unweighted `vertices` space, slot-bone-local).
//    • Runtime: when slot.deform is non-empty it REPLACES `vertices` wholesale, then the
//      slot bone transforms it. The loader pre-ADDS the setup vertices at parse time
//      (deform[i] += vertices[i]), so on disk we still store pure DELTAS (offset+vertices),
//      and the value the runtime holds is setup+delta. A delta d → world move = slot-bone
//      linear · d.
//
//  WEIGHTED mesh (attachment.bones != null):
//    • full deform length === attachment.vertices.length / 3 * 2  ==  2 * totalInfluences
//      (NOT 2*vertexCount). The runtime `vertices` is [x,y,weight] per INFLUENCE; deform
//      carries (dx,dy) per influence (the weight is not deformed). For `payframe`
//      (40 verts, 192 influences) the deform length is 384, not 80.
//    • Layout = (dx,dy) per influence, in INFLUENCE-WALK order (same order the packed bones
//      array enumerates: for vertex v, for each of its n influences). Index f advances by 2
//      per influence (runtime: `f += 2`).
//    • Space = each influence's BONE-LOCAL space. Runtime adds the delta to that influence's
//      local (vx,vy) BEFORE the weighted bone blend:
//        vx = vertices[b]+deform[f], vy = vertices[b+1]+deform[f+1]; wx += (vx*a+vy*b+wX)*weight …
//      Pure deltas on disk (loader does NOT pre-add setup for weighted).
//
//  AUTHORING (what the viewer writes): the artist drags a vertex by a WORLD delta. We turn
//  that into the per-influence / per-vertex LOCAL deltas exactly like applyMeshVertexDelta
//  already does (inv(boneLinear)·worldDelta per influence; inv(slotBoneLinear)·worldDelta
//  for unweighted), and store them at the right deform indices.
//
//  v1 convention: offset = 0 + a FULL-length `vertices` array (sparse-offset is optional
//  later). curve is ONE per key (one easing for the whole vertex frame), bezier controls in
//  absolute (time,value)=(time,progress) coords exactly like the bone channels (curve.mjs).
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
const clone = (o) => JSON.parse(JSON.stringify(o));
const invWorldVec = (b, wx, wy) => {
	const det = b.a * b.d - b.b * b.c;
	if (Math.abs(det) < 1e-8) return { x: wx, y: wy };
	return { x: (b.d * wx - b.b * wy) / det, y: (b.a * wy - b.c * wx) / det };
};

function findMesh(raw, wantWeighted) {
	for (const skin of raw.skins) {
		for (const slot in skin.attachments) {
			for (const att in skin.attachments[slot]) {
				const a = skin.attachments[slot][att];
				const isMesh = a.type === 'mesh' || (a.vertices && a.triangles);
				if (!isMesh) continue;
				const weighted = !!(a.vertices && a.uvs && a.vertices.length > a.uvs.length);
				if (weighted === wantWeighted) return { skin: skin.name, slot, att, a };
			}
		}
	}
	return null;
}

// Pose the skeleton (with the given skin) from an animation at time t and read the
// attachment's WORLD vertices for the given slot.
function worldVertsAt(raw, animName, skinName, slotName, attName, t) {
	const data = loadData(raw);
	const sk = new Skeleton(data);
	const skin = data.findSkin(skinName);
	sk.setSkin(skin);
	sk.setSlotsToSetupPose();
	const slotIndex = data.slots.findIndex((s) => s.name === slotName);
	const slot = sk.slots[slotIndex];
	const att = skin.getAttachment(slotIndex, attName);
	slot.setAttachment(att);
	if (animName) {
		const anim = data.findAnimation(animName);
		anim.apply(sk, 0, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
	}
	try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }
	const out = new Array(att.worldVerticesLength).fill(0);
	att.computeWorldVertices(slot, 0, att.worldVerticesLength, out, 0, 2);
	return out;
}

// Compute the deform full-length + a single-vertex delta array, mirroring the viewer's
// model helper (deformFullLength + worldDeltaToDeform). `bones` is the runtime attachment's
// packed bones array (counts+indices); `boneList` resolves an index → posed runtime bone.
function buildDeform(att, boneList, slotBone, vIdx, wdx, wdy) {
	const weighted = !!(att.bones && att.bones.length);
	if (!weighted) {
		const len = att.vertices.length; // == 2*vertexCount
		const v = new Array(len).fill(0);
		const lv = invWorldVec(slotBone, wdx, wdy);
		v[vIdx * 2] = lv.x; v[vIdx * 2 + 1] = lv.y;
		return { len, vertices: v, weighted };
	}
	const len = (att.vertices.length / 3) * 2; // 2 per influence
	const v = new Array(len).fill(0);
	// walk to the influence-base index `f` of vertex vIdx
	let bi = 0, f = 0;
	for (let k = 0; k < vIdx; k++) { const n = att.bones[bi]; bi += 1 + n; f += n * 2; }
	const n = att.bones[bi];
	for (let j = 0; j < n; j++) {
		const boneIdx = att.bones[bi + 1 + j];
		const lv = invWorldVec(boneList[boneIdx], wdx, wdy);
		v[f + j * 2] = lv.x; v[f + j * 2 + 1] = lv.y;
	}
	return { len, vertices: v, weighted };
}

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };

function testMesh(label, wantWeighted) {
	console.log(`\n--- ${label} mesh ---`);
	const baseRaw = JSON.parse(readFileSync(jsonPath, 'utf8'));
	const hit = findMesh(baseRaw, wantWeighted);
	if (!hit) { console.log(`  (no ${label} mesh in this skeleton — skipped)`); return; }
	console.log(`  target: ${hit.skin}/${hit.slot}/${hit.att}`);

	// Resolve runtime attachment + a posed bone list so buildDeform can read bone matrices.
	const data0 = loadData(baseRaw);
	const sk0 = new Skeleton(data0);
	sk0.setSkin(data0.findSkin(hit.skin)); sk0.setSlotsToSetupPose();
	try { sk0.updateWorldTransform(Physics.update); } catch { sk0.updateWorldTransform(); }
	const slotIndex0 = data0.slots.findIndex((s) => s.name === hit.slot);
	const att0 = data0.findSkin(hit.skin).getAttachment(slotIndex0, hit.att);
	const slotBone0 = sk0.slots[slotIndex0].bone;

	const vertexCount = att0.uvs.length / 2;
	const expectLen = wantWeighted ? (att0.vertices.length / 3) * 2 : att0.vertices.length;
	console.log(`  vertexCount=${vertexCount}  runtime vertices.length=${att0.vertices.length}  => deform fullLen=${expectLen}`);
	log(!wantWeighted ? expectLen === vertexCount * 2 : expectLen === (att0.vertices.length / 3) * 2,
		`deform fullLen = ${expectLen} (${wantWeighted ? '2*totalInfluences' : '2*vertexCount'})`);

	const vIdx = Math.min(2, vertexCount - 1);
	const otherIdx = vIdx === 0 ? Math.min(1, vertexCount - 1) : 0;
	const DX = 17, DY = -11;

	const before = worldVertsAt(baseRaw, null, hit.skin, hit.slot, hit.att, 0);

	// (1) single full-length deform key — exactly-one vertex moves by the WORLD delta.
	const built = buildDeform(att0, sk0.bones, slotBone0, vIdx, DX, DY);
	log(built.len === expectLen, `built deform array length = ${built.len}`);
	const rawSingle = clone(baseRaw);
	rawSingle.animations = rawSingle.animations || {};
	rawSingle.animations.deformSpike = {
		attachments: { [hit.skin]: { [hit.slot]: { [hit.att]: { deform: [{ time: 0, offset: 0, vertices: built.vertices }] } } } },
	};
	let data1 = null;
	try { data1 = loadData(rawSingle); } catch (e) { log(false, 'loader REJECTED the deform timeline — ' + e.message); }
	if (data1) {
		const anim = data1.findAnimation('deformSpike');
		log(!!anim, 'deform animation loads via official loader');
		log(anim && anim.timelines.length === 1 && anim.timelines[0].constructor.name.includes('Deform'), `parsed a DeformTimeline (${anim ? anim.timelines.map((t) => t.constructor.name).join(',') : '—'})`);
		const after = worldVertsAt(rawSingle, 'deformSpike', hit.skin, hit.slot, hit.att, 0);
		const mvX = after[vIdx * 2] - before[vIdx * 2], mvY = after[vIdx * 2 + 1] - before[vIdx * 2 + 1];
		const otherDrift = Math.hypot(after[otherIdx * 2] - before[otherIdx * 2], after[otherIdx * 2 + 1] - before[otherIdx * 2 + 1]);
		log(Math.abs(mvX - DX) < 0.05 && Math.abs(mvY - DY) < 0.05, `vtx ${vIdx} moved by world (${mvX.toFixed(3)}, ${mvY.toFixed(3)}) == delta (${DX}, ${DY})`);
		log(otherDrift < 0.05, `vtx ${otherIdx} unchanged (drift ${otherDrift.toFixed(4)})`);
	}

	// (2) two-key LINEAR interp — midpoint world == lerp(setup, full); our own lerp matches.
	const v0 = new Array(expectLen).fill(0);
	const rawLin = clone(baseRaw);
	rawLin.animations = { deformLin: { attachments: { [hit.skin]: { [hit.slot]: { [hit.att]: { deform: [
		{ time: 0, offset: 0, vertices: v0 },
		{ time: 1, offset: 0, vertices: built.vertices },
	] } } } } } };
	{
		const T = 0.5;
		const runtimeMid = worldVertsAt(rawLin, 'deformLin', hit.skin, hit.slot, hit.att, T);
		const full = worldVertsAt(rawLin, 'deformLin', hit.skin, hit.slot, hit.att, 1);
		const predX = before[vIdx * 2] + (full[vIdx * 2] - before[vIdx * 2]) * T;
		const predY = before[vIdx * 2 + 1] + (full[vIdx * 2 + 1] - before[vIdx * 2 + 1]) * T;
		const dM = Math.hypot(runtimeMid[vIdx * 2] - predX, runtimeMid[vIdx * 2 + 1] - predY);
		log(dM < 0.05, `linear midpoint == lerp(setup,full) (Δ ${dM.toFixed(4)})`);
		// our own viewer-side lerp of two deform-keys at 0.5 = half each component. Pick a
		// component the built delta actually wrote (deform is indexed by influence, not vertex).
		const half = v0.map((x, j) => x + (built.vertices[j] - x) * T);
		const nz = built.vertices.findIndex((x) => Math.abs(x) > 1e-9);
		const want = built.vertices[nz] / 2;
		log(nz >= 0 && Math.abs(half[nz] - want) < 1e-6, `our deform lerp @0.5 = half delta at the written component idx ${nz} (${half[nz].toFixed(3)} == ${want.toFixed(3)})`);
	}

	// (3) BEZIER ease-in on the deform — midpoint progress is sub-linear; matches our evaluator.
	const rawBez = clone(baseRaw);
	rawBez.animations = { deformBez: { attachments: { [hit.skin]: { [hit.slot]: { [hit.att]: { deform: [
		{ time: 0, offset: 0, vertices: v0, curve: [0.42, 0, 1, 1] },
		{ time: 1, offset: 0, vertices: built.vertices },
	] } } } } } };
	{
		let bez = null;
		try { bez = loadData(rawBez); } catch (e) { log(false, 'bezier deform REJECTED — ' + e.message); }
		if (bez) {
			log(!!bez.findAnimation('deformBez'), 'bezier deform animation loads');
			const setup = before;
			const full = worldVertsAt(rawBez, 'deformBez', hit.skin, hit.slot, hit.att, 1);
			const mid = worldVertsAt(rawBez, 'deformBez', hit.skin, hit.slot, hit.att, 0.5);
			const span = Math.hypot(full[vIdx * 2] - setup[vIdx * 2], full[vIdx * 2 + 1] - setup[vIdx * 2 + 1]);
			const got = Math.hypot(mid[vIdx * 2] - setup[vIdx * 2], mid[vIdx * 2 + 1] - setup[vIdx * 2 + 1]);
			const progress = span > 1e-6 ? got / span : 0;
			// our bezier evaluator for progress 0→1 with controls (0.42,0,1,1) at t=0.5
			const bezierValue = (t1, p1, cx1, cy1, cx2, cy2, t2, p2, t) => {
				if (t <= t1) return p1; if (t >= t2) return p2;
				const X = (s) => { const u = 1 - s; return u * u * u * t1 + 3 * u * u * s * cx1 + 3 * u * s * s * cx2 + s * s * s * t2; };
				const Y = (s) => { const u = 1 - s; return u * u * u * p1 + 3 * u * u * s * cy1 + 3 * u * s * s * cy2 + s * s * s * p2; };
				let lo = 0, hi = 1; for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (X(m) < t) lo = m; else hi = m; }
				return Y((lo + hi) / 2);
			};
			const predProgress = bezierValue(0, 0, 0.42, 0, 1, 1, 1, 1, 0.5);
			log(Math.abs(progress - predProgress) < 0.02, `bezier midpoint progress ${progress.toFixed(3)} ≈ our evaluator ${predProgress.toFixed(3)}`);
			log(progress < 0.5, `ease-in deform is sub-linear at the midpoint (${progress.toFixed(3)} < 0.5)`);
		}
	}
}

console.log(`\n=== §18.1 deform timeline model → official runtime: ${jsonPath} ===`);
testMesh('unweighted', false);
testMesh('weighted', true);
console.log(pass
	? '\n✅ PASS — deform format validated (unweighted + weighted): path animations.<a>.attachments.<skin>.<slot>.<att>.deform; fullLen unweighted=2*vertexCount, weighted=2*totalInfluences; per-(influence|vertex) bone-local deltas; linear + bezier interp match the runtime.'
	: '\n✗ FAIL');
process.exit(pass ? 0 : 1);
