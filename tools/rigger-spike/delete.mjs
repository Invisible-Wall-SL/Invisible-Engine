// Verify the Phase A-delete contracts headlessly. The risky one is BONE delete:
// weighted-mesh vertices reference bones by INDEX, so removing a bone shifts every
// higher index. We mirror the viewer's deleteBone/deleteSlot rawDoc logic, reload
// through the official loader, and assert:
//  (bone) loader accepts (no dangling ref), the bone is gone, all weighted bone
//    indices stay in range, every vertex keeps >=1 influence summing to 1, and any
//    weighted vertex NOT influenced by the deleted (leaf) bone stays put EXACTLY —
//    proving the by-name reindex didn't corrupt the rest.
//  (slot) the slot + its attachments vanish and the skeleton still loads.
//   node tools/rigger-spike/delete.mjs <skeleton.json> <skeleton.atlas>
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
function world(sk, slotIndex, att) { const slot = sk.slots[slotIndex]; slot.setAttachment(att); const out = new Array(att.worldVerticesLength).fill(0); att.computeWorldVertices(slot, 0, att.worldVerticesLength, out, 0, 2); return out; }
const isWeighted = (att) => att && att.type === 'mesh' && Array.isArray(att.vertices) && Array.isArray(att.uvs) && att.vertices.length !== att.uvs.length;

// per-vertex influence list straight from a raw weighted-mesh `vertices` array
function readVerts(att) {
	const vc = att.uvs.length / 2, out = []; let ri = 0;
	for (let v = 0; v < vc; v++) { const n = att.vertices[ri++], infl = []; for (let j = 0; j < n; j++) { infl.push({ bone: att.vertices[ri++], x: att.vertices[ri++], y: att.vertices[ri++], w: att.vertices[ri++] }); } out.push(infl); }
	return out;
}

// ---- mirror of the viewer's deleteBone (rawDoc only) ------------------------
function deleteBoneRaw(rd, name) {
	const idx = rd.bones.findIndex((b) => b.name === name);
	if (idx <= 0) return;
	const parentName = rd.bones[idx].parent;
	const oldNames = rd.bones.map((b) => b.name);
	for (const b of rd.bones) if (b.parent === name) b.parent = parentName;
	for (const s of rd.slots || []) if (s.bone === name) s.bone = parentName;
	for (const grp of ['ik', 'transform', 'path']) {
		if (!Array.isArray(rd[grp])) continue;
		rd[grp] = rd[grp].filter((c) => { if (Array.isArray(c.bones)) c.bones = c.bones.filter((n) => n !== name); return !(c.target === name || c.bone === name || (Array.isArray(c.bones) && c.bones.length === 0)); });
		if (!rd[grp].length) delete rd[grp];
	}
	rd.bones.splice(idx, 1);
	for (const an of Object.values(rd.animations || {})) if (an.bones) delete an.bones[name];
	const newIndexByName = new Map(rd.bones.map((b, i) => [b.name, i]));
	const parentIdx = newIndexByName.get(parentName);
	for (const sk of rd.skins || []) for (const slot of Object.values(sk.attachments || {})) for (const att of Object.values(slot)) {
		if (!isWeighted(att)) continue;
		const vc = att.uvs.length / 2, out = []; let ri = 0;
		for (let v = 0; v < vc; v++) {
			const n = att.vertices[ri++], infl = [];
			for (let j = 0; j < n; j++) { const bi = att.vertices[ri++], x = att.vertices[ri++], y = att.vertices[ri++], w = att.vertices[ri++]; infl.push({ bi, x, y, w }); }
			let dropped = false;
			let kept = infl.filter((f) => { const keep = oldNames[f.bi] !== name; if (!keep) dropped = true; return keep; }).map((f) => ({ bone: newIndexByName.get(oldNames[f.bi]), x: f.x, y: f.y, w: f.w })).filter((f) => { if (f.bone === undefined) { dropped = true; return false; } return true; });
			if (!kept.length && parentIdx !== undefined) { const r = infl[0] || { x: 0, y: 0 }; kept = [{ bone: parentIdx, x: r.x, y: r.y, w: 1 }]; dropped = true; }
			if (dropped) { let sum = 0; for (const k of kept) sum += k.w; if (sum > 1e-9) for (const k of kept) k.w /= sum; else { const eq = kept.length ? 1 / kept.length : 1; for (const k of kept) k.w = eq; } }
			out.push(kept.length); for (const k of kept) out.push(k.bone, k.x, k.y, k.w);
		}
		att.vertices = out;
	}
}
function deleteSlotRaw(rd, name) {
	rd.slots = (rd.slots || []).filter((s) => s.name !== name);
	for (const sk of rd.skins || []) if (sk.attachments) delete sk.attachments[name];
	for (const an of Object.values(rd.animations || {})) { if (an.slots) delete an.slots[name]; if (an.deform) for (const sm of Object.values(an.deform)) if (sm) delete sm[name]; if (Array.isArray(an.drawOrder)) for (const fr of an.drawOrder) if (Array.isArray(fr.offsets)) fr.offsets = fr.offsets.filter((o) => o.slot !== name); }
}

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== Phase A-delete → reload: ${jsonPath} ===`);

// ---- (1) delete a LEAF bone referenced by a weighted mesh -------------------
{
	const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
	const childCount = new Map();
	for (const b of raw.bones) if (b.parent) childCount.set(b.parent, (childCount.get(b.parent) || 0) + 1);
	const isLeaf = (n) => !childCount.get(n) && raw.bones[0].name !== n;
	// find a leaf bone referenced by some weighted mesh, and that mesh
	let target = null, mesh = null;
	outer: for (const sk of raw.skins || []) for (const [slotName, slot] of Object.entries(sk.attachments || {})) for (const [attName, att] of Object.entries(slot)) {
		if (!isWeighted(att)) continue;
		const names = new Set(); for (const infl of readVerts(att)) for (const f of infl) names.add(raw.bones[f.bone] && raw.bones[f.bone].name);
		for (const n of names) if (isLeaf(n)) { target = n; mesh = { skin: sk.name, slot: slotName, att: attName }; break outer; }
	}
	if (!target) console.log('  (bone delete: no leaf bone referenced by a weighted mesh — skipped)');
	else {
		const skBefore = posed(raw);
		const slotIndex = skBefore.data.slots.findIndex((s) => s.name === mesh.slot);
		const aBefore = skBefore.data.findSkin(mesh.skin).getAttachments().find((e) => e.name === mesh.att && skBefore.data.slots[e.slotIndex].name === mesh.slot).attachment;
		const before = world(skBefore, slotIndex, aBefore);
		// which vertices are NOT influenced by the deleted bone (should stay put)
		const rdMeshBefore = raw.skins.find((s) => s.name === mesh.skin).attachments[mesh.slot][mesh.att];
		const untouched = readVerts(rdMeshBefore).map((infl) => !infl.some((f) => raw.bones[f.bone] && raw.bones[f.bone].name === target));
		const beforeBoneCount = raw.bones.length;
		const child = raw.bones.find((b) => b.parent === target); // (leaf → none, but assert if any)

		deleteBoneRaw(raw, target);

		let sk2 = null; try { sk2 = posed(raw); } catch (e) { log(false, 'loader REJECTED skeleton after bone delete — ' + e.message); }
		console.log(`  deleted leaf bone "${target}" (referenced by weighted mesh ${mesh.skin}/${mesh.slot}/${mesh.att})`);
		log(!!sk2, 'loader accepts the skeleton after bone delete');
		if (sk2) {
			log(raw.bones.length === beforeBoneCount - 1 && !raw.bones.some((b) => b.name === target), `bone gone, count ${beforeBoneCount} → ${raw.bones.length}`);
			log(!child || raw.bones.find((b) => b.name === child.name).parent !== target, 'any child reparented off the deleted bone');
			// every weighted mesh: indices in range + each vertex sums to 1
			let oob = 0, badSum = 0, empty = 0;
			for (const sk of raw.skins || []) for (const slot of Object.values(sk.attachments || {})) for (const att of Object.values(slot)) {
				if (!isWeighted(att)) continue;
				for (const infl of readVerts(att)) { if (!infl.length) empty++; let s = 0; for (const f of infl) { if (f.bone < 0 || f.bone >= raw.bones.length) oob++; s += f.w; } if (Math.abs(s - 1) > 1e-4) badSum++; }
			}
			log(oob === 0, `all weighted bone indices in range (${oob} out of range)`);
			log(empty === 0, `no vertex left with 0 influences (${empty})`);
			log(badSum === 0, `every weighted vertex sums to 1 (${badSum} off)`);
			// untouched vertices stay put EXACTLY
			const a2 = sk2.data.findSkin(mesh.skin).getAttachments().find((e) => e.name === mesh.att && sk2.data.slots[e.slotIndex].name === mesh.slot).attachment;
			const after = world(sk2, slotIndex, a2);
			let maxMove = 0, moved = 0;
			for (let v = 0; v < untouched.length; v++) if (untouched[v]) { const d = Math.hypot(after[v * 2] - before[v * 2], after[v * 2 + 1] - before[v * 2 + 1]); maxMove = Math.max(maxMove, d); if (d > 0.001) moved++; }
			log(moved === 0, `vertices not influenced by the bone are UNCHANGED (${moved} moved, max ${maxMove.toFixed(5)})`);
		}
	}
}

// ---- (2) delete a slot ------------------------------------------------------
{
	const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
	const victim = (raw.slots || []).find((s) => s.name)?.name;
	if (!victim) console.log('  (slot delete: no slot — skipped)');
	else {
		const before = raw.slots.length;
		deleteSlotRaw(raw, victim);
		let sk2 = null; try { sk2 = posed(raw); } catch (e) { log(false, 'loader REJECTED skeleton after slot delete — ' + e.message); }
		console.log(`  deleted slot "${victim}"`);
		log(!!sk2, 'loader accepts the skeleton after slot delete');
		log(raw.slots.length === before - 1 && !raw.slots.some((s) => s.name === victim), `slot gone, count ${before} → ${raw.slots.length}`);
		let leftover = 0; for (const sk of raw.skins || []) if (sk.attachments && sk.attachments[victim]) leftover++;
		log(leftover === 0, `slot's attachments removed from every skin (${leftover} leftover)`);
	}
}

console.log(pass ? '\n✅ PASS — bone delete reindexes weighted meshes cleanly; slot delete is clean.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
