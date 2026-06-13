// Demo/verify the Phase 1 inspector read-model on a real skeleton.
//   node tools/rigger-spike/inspect-demo.mjs <skeleton.json> <skeleton.atlas>
import { readFileSync } from 'node:fs';
import { buildInspector } from './inspectModel.mjs';

const SPINE_CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
const spine = await import(SPINE_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson } = spine;

const [, , jsonPath, atlasPath] = process.argv;
const atlas = new TextureAtlas(readFileSync(atlasPath, 'utf8'));
const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
for (const p of atlas.pages) { p.width = 2048; p.height = 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(readFileSync(jsonPath, 'utf8')));

const v = buildInspector(data, spine);

console.log('meta   :', JSON.stringify(v.meta));
console.log('counts :', JSON.stringify(v.counts));

const printTree = (nodes, depth = 0, max = 14, state = { n: 0 }) => {
	for (const b of nodes) {
		if (state.n++ >= max) { if (state.n === max + 1) console.log('  '.repeat(depth + 1) + '…'); continue; }
		console.log('  ' + '  '.repeat(depth) + `${b.name}  [world ${b.world.x},${b.world.y} → tip ${b.world.tipX},${b.world.tipY}, rot ${b.world.rotation}°]`);
		printTree(b.children, depth + 1, max, state);
	}
};
console.log('\nbone hierarchy (setup-pose world transforms — the overlay geometry):');
printTree(v.boneTree);

console.log('\nslots (draw order, first 10):');
for (const s of v.slots.slice(0, 10)) console.log(`  z${s.z}  ${s.name} → bone ${s.bone}, attachment ${s.attachment ?? '∅'}, blend ${s.blend}`);

console.log('\nskins:');
for (const sk of v.skins) console.log(`  ${sk.name}: ${sk.attachmentCount} attachments  (weighted meshes: ${sk.attachments.filter((a) => a.weighted).length})`);

console.log('\nanimations:');
for (const a of v.animations.slice(0, 12)) console.log(`  ${a.name}  ${a.duration}s  (${a.timelines} timelines)`);

console.log('\nconstraints:', JSON.stringify(v.constraints));
