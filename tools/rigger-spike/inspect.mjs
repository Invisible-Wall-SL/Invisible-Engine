import { readFileSync } from 'node:fs';
const SPINE_CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics } = await import(SPINE_CORE);

const raw = JSON.parse(readFileSync('apps/cluster/static/assets/spines/symbols/h1.json', 'utf8'));
const atlas = new TextureAtlas(readFileSync('apps/cluster/static/assets/spines/symbols/symbols.atlas', 'utf8'));
const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
for (const p of atlas.pages) { p.width = 2048; p.height = 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(raw);
const sk = new Skeleton(data); sk.setToSetupPose(); try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }

let zero = 0; for (const b of sk.bones) if (!b.data.length) zero++;
console.log(`bones total ${sk.bones.length}, zero-length ${zero}`);

for (const skin of data.skins) for (const e of skin.getAttachments()) {
	const a = e.attachment;
	if (a.constructor.name === 'MeshAttachment' && a.bones && a.bones.length && e.name.includes('eyebrow')) {
		const slot = sk.slots[e.slotIndex]; slot.setAttachment(a);
		const w = new Array(a.worldVerticesLength).fill(0); a.computeWorldVertices(slot, 0, a.worldVerticesLength, w, 0, 2);
		let bi = 0, vi = 0; const vc = a.worldVerticesLength / 2;
		console.log(`\nmesh ${e.name} — ${vc} verts`);
		for (let v = 0; v < vc; v++) {
			const n = a.bones[bi++]; const infl = [];
			for (let k = 0; k < n; k++) { const bone = a.bones[bi++]; vi += 2; const wt = a.vertices[vi++]; infl.push(`${data.bones[bone].name} w=${wt.toFixed(2)} (len${sk.bones[bone].data.length.toFixed(0)} @${sk.bones[bone].worldX.toFixed(0)},${sk.bones[bone].worldY.toFixed(0)})`); }
			console.log(`  vtx${v} @${w[v * 2].toFixed(0)},${w[v * 2 + 1].toFixed(0)} -> ${infl.join('  |  ')}`);
		}
		process.exit(0);
	}
}
console.log('no eyebrow mesh found');
