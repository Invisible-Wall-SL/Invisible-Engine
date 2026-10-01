// Verify the Phase 4.1 weight-editing contracts headlessly:
//  (a) edit a weighted vertex's weight (normalise keeping) → reload → weights present,
//      sum ≈ 1, and the vertex's setup-pose WORLD position is exactly Σ w'ᵢ·pᵢ, where pᵢ
//      is influence i's offset through its bone. That equals the old position only when
//      the influences agree: each offset is in its bone's BIND pose, and a bone moved in
//      setup after binding (what Spine's "Update Bindings" fixes) makes them disagree —
//      by 20px on the lines l1–l4 symbols, so a 0.5 weight shift there moves the vertex
//      10px. The edit keeps the bind pose (as Spine does), so that move is correct.
//  (b) bind an unweighted mesh to its slot bone → reload → now weighted, 1 influence
//      per vertex at weight 1, world positions unchanged.
//   node tools/rigger-spike/weights.mjs <skeleton.json> <skeleton.atlas>
import { readFileSync } from 'node:fs';
import { SPINE_CORE } from './spine.mjs';

const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics } = await import(
	SPINE_CORE
);

const [, , jsonPath, atlasPath] = process.argv;
const atlasText = readFileSync(atlasPath, 'utf8');
function loadData(obj) {
	const atlas = new TextureAtlas(atlasText);
	const stub = {
		getImage: () => ({ width: 2048, height: 2048 }),
		setFilters() {},
		setWraps() {},
		dispose() {},
	};
	for (const p of atlas.pages) {
		p.width = 2048;
		p.height = 2048;
		try {
			p.setTexture(stub);
		} catch {
			p.texture = stub;
		}
	}
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(obj);
}
function posed(obj) {
	const sk = new Skeleton(loadData(obj));
	sk.setToSetupPose();
	try {
		sk.updateWorldTransform(Physics.update);
	} catch {
		sk.updateWorldTransform();
	}
	return sk;
}
function world(sk, slotIndex, att) {
	const slot = sk.slots[slotIndex];
	slot.setAttachment(att);
	const out = new Array(att.worldVerticesLength).fill(0);
	att.computeWorldVertices(slot, 0, att.worldVerticesLength, out, 0, 2);
	return out;
}
function rdVertexAt(rd, k) {
	let ri = 0;
	for (let v = 0; v < k; v++) {
		const n = rd.vertices[ri];
		ri += 1 + n * 4;
	}
	const count = rd.vertices[ri],
		infl = [];
	for (let j = 0; j < count; j++) {
		const o = ri + 1 + j * 4;
		infl.push({
			bone: rd.vertices[o],
			x: rd.vertices[o + 1],
			y: rd.vertices[o + 2],
			weight: rd.vertices[o + 3],
		});
	}
	return { offset: ri, count, influences: infl };
}
function rdSet(rd, k, infl) {
	let ri = 0;
	for (let v = 0; v < k; v++) {
		const n = rd.vertices[ri];
		ri += 1 + n * 4;
	}
	const oldLen = 1 + rd.vertices[ri] * 4;
	const flat = [infl.length];
	for (const i of infl) flat.push(i.bone, i.x, i.y, i.weight);
	rd.vertices.splice(ri, oldLen, ...flat);
}
function normKeep(infl, j, w) {
	w = Math.max(0, Math.min(1, w));
	infl[j].weight = w;
	let other = 0;
	for (let i = 0; i < infl.length; i++) if (i !== j) other += infl[i].weight;
	const rem = 1 - w;
	if (other > 1e-9) {
		for (let i = 0; i < infl.length; i++) if (i !== j) infl[i].weight *= rem / other;
	}
}

let pass = true;
const log = (ok, msg) => {
	console.log((ok ? '  ✅ ' : '  ✗ ') + msg);
	if (!ok) pass = false;
};
console.log(`\n=== Phase 4.1 weight editing → reload: ${jsonPath} ===`);

// (a) edit a weighted vertex with >= 2 influences
{
	const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
	const sk = posed(raw);
	let hit = null;
	outer: for (const skin of sk.data.skins)
		for (const e of skin.getAttachments ? skin.getAttachments() : []) {
			const a = e.attachment;
			if (a.constructor.name !== 'MeshAttachment' || !(a.bones && a.bones.length)) continue;
			hit = {
				skin: skin.name,
				slotIndex: e.slotIndex,
				slot: sk.data.slots[e.slotIndex].name,
				att: e.name,
				a,
			};
			break outer;
		}
	if (!hit) console.log('  (weight edit: no weighted mesh — skipped)');
	else {
		const rd = raw.skins.find((s) => s.name === hit.skin).attachments[hit.slot][hit.att];
		// find a vertex with >=2 influences
		let k = -1;
		for (let v = 0; v < hit.a.worldVerticesLength / 2; v++) {
			if (rdVertexAt(rd, v).count >= 2) {
				k = v;
				break;
			}
		}
		if (k < 0) console.log('  (weight edit: no multi-influence vertex — skipped)');
		else {
			const before = world(sk, hit.slotIndex, hit.a);
			const { influences } = rdVertexAt(rd, k);
			const pOf = (i) => {
				const b = sk.bones[i.bone];
				return [i.x * b.a + i.y * b.b + b.worldX, i.x * b.c + i.y * b.d + b.worldY];
			};
			const blend = () =>
				influences.reduce(
					(s, i) => {
						const p = pOf(i);
						return [s[0] + i.weight * p[0], s[1] + i.weight * p[1]];
					},
					[0, 0],
				);
			const modelled = blend();
			let spread = 0;
			for (const a of influences)
				for (const b of influences) {
					const pa = pOf(a),
						pb = pOf(b);
					spread = Math.max(spread, Math.hypot(pa[0] - pb[0], pa[1] - pb[1]));
				}
			normKeep(influences, 0, 0.7);
			const predicted = blend();
			rdSet(rd, k, influences);
			const sk2 = posed(raw);
			const a2 = sk2.data
				.findSkin(hit.skin)
				.getAttachments()
				.find(
					(e) => e.name === hit.att && sk2.data.slots[e.slotIndex].name === hit.slot,
				).attachment;
			const after = world(sk2, hit.slotIndex, a2);
			const ri = rdVertexAt(
				raw.skins.find((s) => s.name === hit.skin).attachments[hit.slot][hit.att],
				k,
			);
			const sum = ri.influences.reduce((s, i) => s + i.weight, 0);
			console.log(
				`  weight edit: ${hit.skin}/${hit.slot}/${hit.att} vtx ${k} (${ri.count} influences) → infl0 weight 0.7`,
			);
			log(!!a2, 'loader accepts the re-weighted mesh');
			log(
				Math.abs(ri.influences[0].weight - 0.7) < 0.001,
				`infl0 weight = ${ri.influences[0].weight.toFixed(3)}`,
			);
			log(Math.abs(sum - 1) < 0.001, `weights sum to 1 (${sum.toFixed(4)})`);
			// Float32 vertex storage at |coord| ~1e3 is good to ~1e-4; 1e-3 leaves headroom.
			const modelErr = Math.hypot(modelled[0] - before[k * 2], modelled[1] - before[k * 2 + 1]);
			log(
				modelErr < 1e-3,
				`the Σ wᵢ·pᵢ model reproduces the loader's setup pose (err ${modelErr.toFixed(5)})`,
			);
			const moved = Math.hypot(after[k * 2] - before[k * 2], after[k * 2 + 1] - before[k * 2 + 1]);
			const err = Math.hypot(after[k * 2] - predicted[0], after[k * 2 + 1] - predicted[1]);
			log(
				err < 1e-3,
				`vertex lands where its new weights put it (err ${err.toFixed(5)}; moved ${moved.toFixed(4)} — its influences disagree by ${spread.toFixed(4)})`,
			);
		}
	}
}

// (b) bind an unweighted mesh
{
	const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
	const sk = posed(raw);
	let hit = null;
	outer2: for (const skin of sk.data.skins)
		for (const e of skin.getAttachments ? skin.getAttachments() : []) {
			const a = e.attachment;
			if (a.constructor.name !== 'MeshAttachment' || (a.bones && a.bones.length)) continue;
			hit = {
				skin: skin.name,
				slotIndex: e.slotIndex,
				slot: sk.data.slots[e.slotIndex].name,
				att: e.name,
				a,
			};
			break outer2;
		}
	if (!hit) console.log('  (bind: no unweighted mesh — skipped)');
	else {
		const before = world(sk, hit.slotIndex, hit.a);
		const rd = raw.skins.find((s) => s.name === hit.skin).attachments[hit.slot][hit.att];
		const bi = sk.data.bones.findIndex((b) => b.name === sk.slots[hit.slotIndex].bone.data.name);
		const vc = rd.uvs.length / 2,
			nv = [];
		for (let k = 0; k < vc; k++) nv.push(1, bi, rd.vertices[k * 2], rd.vertices[k * 2 + 1], 1);
		rd.vertices = nv;
		const sk2 = posed(raw);
		const a2 = sk2.data
			.findSkin(hit.skin)
			.getAttachments()
			.find((e) => e.name === hit.att && sk2.data.slots[e.slotIndex].name === hit.slot).attachment;
		const after = world(sk2, hit.slotIndex, a2);
		let maxMove = 0;
		for (let i = 0; i < before.length; i++)
			maxMove = Math.max(maxMove, Math.abs(after[i] - before[i]));
		console.log(
			`  bind: ${hit.skin}/${hit.slot}/${hit.att} → weighted to bone "${sk.data.bones[bi].name}"`,
		);
		log(a2 && a2.bones && a2.bones.length > 0, 'mesh is now weighted on reload');
		log(maxMove < 0.01, `all vertex world positions UNCHANGED (max move ${maxMove.toFixed(4)})`);
	}
}

console.log(
	pass
		? '\n✅ PASS — weight edits + bind round-trip; vertices land where their weights put them.'
		: '\n✗ FAIL',
);
process.exit(pass ? 0 : 1);
