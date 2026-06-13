// Verify the Phase 2.2 reparent contract headlessly: change a bone's parent in the
// JSON, topologically sort bones (parents before children — Spine's requirement),
// reload through the official loader, and assert it loads, the new parent took, no
// bone was lost, and the parent-precedes-child invariant holds.
//   node tools/rigger-spike/reparent.mjs <skeleton.json> <skeleton.atlas>
import { readFileSync } from 'node:fs';

const SPINE_CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson } = await import(SPINE_CORE);

const [, , jsonPath, atlasPath] = process.argv;
const atlasText = readFileSync(atlasPath, 'utf8');
function load(obj) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = 2048; p.height = 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(obj);
}

// same topo-sort the viewer uses
function topoSort(doc) {
	const byName = new Map(doc.bones.map((b) => [b.name, b]));
	const out = [], seen = new Set();
	const visit = (b) => {
		if (!b || seen.has(b.name)) return;
		seen.add(b.name);
		const p = b.parent && byName.get(b.parent);
		if (p) visit(p);
		out.push(b);
	};
	doc.bones.forEach(visit);
	doc.bones = out;
}

const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const before = load(JSON.parse(JSON.stringify(raw)));

// descendants of a bone (by current parent links) — exclude to avoid cycles
const descOf = (name) => {
	const set = new Set();
	for (const b of before.bones) for (let p = b.parent; p; p = p.parent) if (p.name === name) { set.add(b.name); break; }
	return set;
};

// pick a child bone with a parent, and a NEW parent that isn't it or a descendant
const child = raw.bones.find((b) => b.parent) || raw.bones[1];
const banned = descOf(child.name); banned.add(child.name);
const newParent = raw.bones.find((b) => !banned.has(b.name) && b.name !== child.parent);

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== Phase 2.2 reparent → reload: ${jsonPath} ===`);
if (!newParent) { console.log('  (no valid alternate parent — skipping)'); process.exit(0); }
console.log(`reparent "${child.name}": ${child.parent} → ${newParent.name}`);

raw.bones.find((b) => b.name === child.name).parent = newParent.name;
topoSort(raw);

// invariant: every parent precedes its child in the array
const idx = new Map(raw.bones.map((b, i) => [b.name, i]));
let bad = 0;
raw.bones.forEach((b, i) => { if (b.parent && idx.get(b.parent) > i) bad++; });
log(bad === 0, `parent-precedes-child invariant holds (${bad} violations)`);

const after = load(JSON.parse(JSON.stringify(raw)));
log(!!after, 'official loader accepts the reparented skeleton');
const ab = after.bones.find((b) => b.name === child.name);
log(ab && ab.parent && ab.parent.name === newParent.name, `bone's parent is now "${ab && ab.parent && ab.parent.name}"`);
log(after.bones.length === before.bones.length, `bone count unchanged (${after.bones.length})`);
log(after.animations.length === before.animations.length, `animations intact (${after.animations.length})`);

console.log(pass ? '\n✅ PASS — reparent + topo-sort round-trips through the loader.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
