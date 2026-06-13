// Invisible Rigger — Phase 0 spike 2: auto-weights quality.
//   node tools/rigger-spike/autoweights.mjs
//
// The research-grade risk (design §5.2): can a CHEAP auto-weight algorithm produce
// usable initial weights, given Spine's real one is proprietary?
//
// Objective arbiter: real artist-rigged weighted meshes carry GROUND-TRUTH weights.
// We run our algorithm on the same mesh (same bone set, same setup-pose geometry)
// and measure agreement with the artist:
//   - top-1 match: does our heaviest bone per vertex match the artist's heaviest?
//   - cosine similarity / L1 distance between the two weight vectors per vertex.
// High agreement ⇒ the auto-weight approximation is viable. Low ⇒ we learn it now.
//
// Algorithm under test: per vertex, weight_i = 1 / (dist_to_bone_segment_i^2 + eps),
// keep top-4 bones (Spine's per-vertex cap), normalise to sum 1. Bone set = the
// bones the artist actually used (isolates WEIGHTING quality from BONE-SELECTION).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

const SPINE_CORE = new URL(
	'../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js',
	import.meta.url,
).href;
const spine = await import(SPINE_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics } = spine;

const MAX_BONES = 4;
const EPS = 1e-3;

function loadSkeletonData(jsonText, atlasText) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = p.width || 2048; p.height = p.height || 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(jsonText);
}

// point-to-segment squared distance
function segDist2(px, py, ax, ay, bx, by) {
	const dx = bx - ax, dy = by - ay;
	const len2 = dx * dx + dy * dy;
	let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
	t = Math.max(0, Math.min(1, t));
	const cx = ax + t * dx, cy = ay + t * dy;
	return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

function decodeArtistWeights(att) {
	// runtime MeshAttachment: .bones = [count, idx...] packed; .vertices = [x,y,weight ...] per influence
	const verts = [];
	let bi = 0, vi = 0;
	const vertexCount = att.worldVerticesLength / 2;
	for (let v = 0; v < vertexCount; v++) {
		const n = att.bones[bi++];
		const infl = [];
		for (let k = 0; k < n; k++) { const bone = att.bones[bi++]; vi += 2; const w = att.vertices[vi++]; infl.push({ bone, w }); }
		verts.push(infl);
	}
	return verts;
}

function autoWeights(worldVerts, boneSegs, candidateBoneIds) {
	const out = [];
	for (let v = 0; v < worldVerts.length / 2; v++) {
		const px = worldVerts[v * 2], py = worldVerts[v * 2 + 1];
		const scored = candidateBoneIds.map((id) => {
			const s = boneSegs[id];
			const d2 = segDist2(px, py, s.ax, s.ay, s.bx, s.by);
			return { bone: id, w: 1 / (d2 + EPS) };
		});
		scored.sort((a, b) => b.w - a.w);
		const top = scored.slice(0, MAX_BONES);
		const sum = top.reduce((n, t) => n + t.w, 0) || 1;
		out.push(top.map((t) => ({ bone: t.bone, w: t.w / sum })));
	}
	return out;
}

// compare two influence lists (artist vs ours) as weight vectors over union of bones
function compareVertex(artist, ours) {
	const ma = new Map(artist.map((i) => [i.bone, i.w]));
	const mo = new Map(ours.map((i) => [i.bone, i.w]));
	const bones = new Set([...ma.keys(), ...mo.keys()]);
	let dot = 0, na = 0, no = 0, l1 = 0;
	for (const b of bones) { const a = ma.get(b) || 0, o = mo.get(b) || 0; dot += a * o; na += a * a; no += o * o; l1 += Math.abs(a - o); }
	const cos = na && no ? dot / Math.sqrt(na * no) : 0;
	const topA = artist.reduce((m, i) => (i.w > m.w ? i : m), { w: -1 }).bone;
	const topO = ours.reduce((m, i) => (i.w > m.w ? i : m), { w: -1 }).bone;
	return { cos, l1, top1: topA === topO ? 1 : 0 };
}

// ---- scan corpus for weighted meshes ---------------------------------------
function walk(dir, acc) { for (const n of readdirSync(dir)) { const p = join(dir, n); const st = statSync(p); if (st.isDirectory()) { if (!/node_modules|\.svelte-kit|[\\/]build[\\/]?/.test(p)) walk(p, acc); } else if (n.endsWith('.json')) acc.push(p); } return acc; }
function findAtlas(jsonPath) { const dir = dirname(jsonPath), stem = basename(jsonPath, '.json'); const as = readdirSync(dir).filter((f) => f.endsWith('.atlas')); if (!as.length) return null; return join(dir, as.find((a) => basename(a, '.atlas') === stem) ?? as[0]); }

const jsons = [];
for (const root of ['apps/cluster/static/assets/spines', 'apps/lines/static/assets/spines']) { try { walk(root, jsons); } catch {} }

let meshes = 0, vertsTotal = 0;
let cosSum = 0, l1Sum = 0, top1Sum = 0;
const perMesh = [];

for (const jsonPath of jsons) {
	let raw; try { raw = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch { continue; }
	if (!raw.skeleton || !raw.bones) continue;
	const atlasPath = findAtlas(jsonPath); if (!atlasPath) continue;
	let data; try { data = loadSkeletonData(raw, readFileSync(atlasPath, 'utf8')); } catch { continue; }

	const skeleton = new Skeleton(data);
	skeleton.setToSetupPose();
	try { skeleton.updateWorldTransform(Physics.update); } catch { skeleton.updateWorldTransform(); }

	// bone segments in setup-pose world space
	const boneSegs = skeleton.bones.map((b) => ({ ax: b.worldX, ay: b.worldY, bx: b.worldX + b.data.length * b.a, by: b.worldY + b.data.length * b.c }));

	for (const skin of data.skins) {
		for (const e of (skin.getAttachments ? skin.getAttachments() : [])) {
			const att = e.attachment;
			if (att.constructor.name !== 'MeshAttachment' || !(att.bones && att.bones.length)) continue;
			const slot = skeleton.slots[e.slotIndex];
			slot.setAttachment(att);
			const world = new Array(att.worldVerticesLength).fill(0);
			att.computeWorldVertices(slot, 0, att.worldVerticesLength, world, 0, 2);

			const artist = decodeArtistWeights(att);
			const candidateBoneIds = [...new Set(artist.flat().map((i) => i.bone))];
			if (candidateBoneIds.length < 2) continue; // single-bone mesh: trivial
			const ours = autoWeights(world, boneSegs, candidateBoneIds);

			let mCos = 0, mL1 = 0, mTop = 0;
			for (let v = 0; v < artist.length; v++) { const c = compareVertex(artist[v], ours[v]); mCos += c.cos; mL1 += c.l1; mTop += c.top1; }
			const n = artist.length;
			meshes++; vertsTotal += n;
			cosSum += mCos; l1Sum += mL1; top1Sum += mTop;
			perMesh.push({ name: `${basename(dirname(jsonPath))}/${e.name}`, verts: n, bones: candidateBoneIds.length, cos: mCos / n, top1: mTop / n });
		}
	}
}

console.log(`\n=== Invisible Rigger Phase 0 — auto-weights vs artist ground truth ===`);
console.log(`weighted meshes evaluated: ${meshes}   vertices: ${vertsTotal}`);
console.log(`algorithm: inverse-squared distance-to-bone-segment, top-${MAX_BONES}, normalised\n`);
console.log(`AGGREGATE agreement with artist weights:`);
console.log(`   top-1 bone match : ${(100 * top1Sum / vertsTotal).toFixed(1)}%   (our heaviest bone == artist's heaviest)`);
console.log(`   cosine similarity: ${(cosSum / vertsTotal).toFixed(3)}   (1.0 = identical weight vector)`);
console.log(`   mean L1 distance : ${(l1Sum / vertsTotal).toFixed(3)}   (0 = identical, 2 = opposite)`);

perMesh.sort((a, b) => a.cos - b.cos);
console.log(`\nworst 5 meshes by cosine similarity:`);
for (const m of perMesh.slice(0, 5)) console.log(`   ${m.cos.toFixed(3)} cos, ${(100 * m.top1).toFixed(0)}% top-1  — ${m.name} (${m.verts} verts, ${m.bones} bones)`);
console.log(`best 5:`);
for (const m of perMesh.slice(-5).reverse()) console.log(`   ${m.cos.toFixed(3)} cos, ${(100 * m.top1).toFixed(0)}% top-1  — ${m.name} (${m.verts} verts, ${m.bones} bones)`);
