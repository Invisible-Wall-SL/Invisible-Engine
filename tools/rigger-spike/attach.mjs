// Verify Phase A2 headlessly:
//  (1) the atlas region-name parser matches the official TextureAtlas regions.
//  (2) attaching a packed region to a slot (as the viewer's attachRegion writes
//      rawDoc) produces a skeleton whose slot resolves to a RegionAttachment.
//   node tools/rigger-spike/attach.mjs <skeleton.json> <skeleton.atlas>
import { readFileSync } from 'node:fs';

const SPINE_CORE = new URL('../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js', import.meta.url).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson } = await import(SPINE_CORE);

const [, , jsonPath, atlasPath] = process.argv;
const atlasText = readFileSync(atlasPath, 'utf8');
function mkAtlas() {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = 2048; p.height = 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return atlas;
}

// replicate spine.ts atlasRegionNames
function atlasRegionNames(t) { const out = []; let expectPage = true; for (const line of t.split(/\r?\n/)) { if (line.trim() === '') { expectPage = true; continue; } if (/^\s/.test(line) || line.includes(':')) { expectPage = false; continue; } if (expectPage) { expectPage = false; continue; } out.push(line.trim()); } return out; }

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
console.log(`\n=== Phase A2 atlas-parse + attach: ${atlasPath} ===`);

// (1) parser vs official
const official = new Set(mkAtlas().regions.map((r) => r.name));
const parsed = new Set(atlasRegionNames(atlasText));
const missing = [...official].filter((n) => !parsed.has(n));
const extra = [...parsed].filter((n) => !official.has(n));
log(official.size > 0, `atlas has ${official.size} regions`);
log(missing.length === 0 && extra.length === 0, `parser matches official regions (missing ${missing.length}, extra ${extra.length})`);

// (2) attach a region to a slot on a blank skeleton
const region = mkAtlas().regions[0].name;
const doc = {
	skeleton: { spine: '4.2' },
	bones: [{ name: 'root' }],
	slots: [{ name: 'slot1', bone: 'root' }],
	skins: [{ name: 'default', attachments: { slot1: { [region]: { width: 64, height: 64 } } } }],
	animations: {},
};
doc.slots[0].attachment = region;
let data = null;
try { data = new SkeletonJson(new AtlasAttachmentLoader(mkAtlas())).readSkeletonData(JSON.parse(JSON.stringify(doc))); }
catch (e) { log(false, 'loader threw: ' + e.message); }
if (data) {
	log(true, `loader accepts a rig with region "${region}" attached`);
	const e = data.findSkin('default').getAttachments().find((x) => x.name === region && data.slots[x.slotIndex].name === 'slot1');
	log(!!e, 'attachment present on slot1 in default skin');
	log(e && e.attachment.constructor.name === 'RegionAttachment', `attachment is a RegionAttachment (${e && e.attachment.constructor.name})`);
	log(e && e.attachment.region, 'attachment resolved to an atlas region');
}

console.log(pass ? '\n✅ PASS — parser matches; attaching a packed region yields a valid rig.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
