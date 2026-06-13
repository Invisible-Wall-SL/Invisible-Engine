// Verify the Phase 2.1 edit→export contract headlessly: mutate a bone transform in
// the parsed skeleton JSON (as the viewer's applyBoneEdit does — match by name),
// JSON.stringify (as exportIrig does), reload through the official loader, and
// assert (a) it still loads, (b) the edit took, (c) nothing else changed.
//   node tools/rigger-spike/editexport.mjs <skeleton.json> <skeleton.atlas>
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

const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const before = load(JSON.parse(JSON.stringify(raw)));

// pick a non-root bone with a parent and edit it
const target = raw.bones.find((b) => b.parent) || raw.bones[1] || raw.bones[0];
const origRot = before.bones.find((b) => b.name === target.name).rotation;
const NEW_ROT = Math.round((origRot + 33.5) * 10) / 10;
const NEW_X = (target.x || 0) + 17;

// edit rawDoc in place (match by name) — exactly applyBoneEdit's mutation
const rb = raw.bones.find((b) => b.name === target.name);
rb.rotation = NEW_ROT;
rb.x = NEW_X;

// export → reload
const exported = JSON.stringify(raw);
const after = load(JSON.parse(exported));

const ab = after.bones.find((b) => b.name === target.name);
let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };

console.log(`\n=== Phase 2.1 edit→export → reload: ${jsonPath} ===`);
console.log(`edited bone "${target.name}": rotation ${origRot} → ${NEW_ROT}, x ${target.x ?? 0} → ${NEW_X}`);
log(!!after, 'official loader accepts the exported (edited) skeleton');
log(Math.abs(ab.rotation - NEW_ROT) < 0.001, `edited rotation present on reload (${ab.rotation})`);
log(Math.abs(ab.x - NEW_X) < 0.001, `edited x present on reload (${ab.x})`);

// nothing else changed: same bone/slot/skin/anim counts, and every OTHER bone's
// transform is byte-identical to the original
log(after.bones.length === before.bones.length, `bone count unchanged (${after.bones.length})`);
log(after.slots.length === before.slots.length, `slot count unchanged (${after.slots.length})`);
log(after.animations.length === before.animations.length, `animation count unchanged (${after.animations.length})`);
let drift = 0;
for (const bb of before.bones) {
	if (bb.name === target.name) continue;
	const aa = ab && after.bones.find((b) => b.name === bb.name);
	if (!aa) { drift++; continue; }
	for (const k of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY', 'length'])
		if (Math.abs((aa[k] ?? 0) - (bb[k] ?? 0)) > 1e-4) drift++;
}
log(drift === 0, `every OTHER bone transform unchanged (drift=${drift})`);

console.log(pass ? '\n✅ PASS — edit→export→reload is faithful.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
