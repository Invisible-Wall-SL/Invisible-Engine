// Verify the Phase 2.4 contracts headlessly:
//  (a) draw-order reorder: swap two entries in slots[] → reload → order changed, all present.
//  (b) region attachment placement: mutate a region attachment's x/rotation in a skin
//      → reload → the new values are present on the reloaded RegionAttachment.
//   node tools/rigger-spike/slotedit.mjs <skeleton.json> <skeleton.atlas>
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
const clone = (o) => JSON.parse(JSON.stringify(o));

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };

console.log(`\n=== Phase 2.4 slot edits → reload: ${jsonPath} ===`);

// ---- (a) draw-order reorder ----
{
	const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
	if (raw.slots && raw.slots.length >= 2) {
		const before = load(clone(raw));
		const n0 = raw.slots[0].name, n1 = raw.slots[1].name;
		[raw.slots[0], raw.slots[1]] = [raw.slots[1], raw.slots[0]];
		const after = load(clone(raw));
		console.log(`draw-order: swap slot[0]="${n0}" <-> slot[1]="${n1}"`);
		log(!!after, 'loader accepts the reordered skeleton');
		log(after.slots[0].name === n1 && after.slots[1].name === n0, `order swapped (now [0]="${after.slots[0].name}", [1]="${after.slots[1].name}")`);
		log(after.slots.length === before.slots.length, `slot count unchanged (${after.slots.length})`);
	} else console.log('  (fewer than 2 slots — skipping draw-order test)');
}

// ---- (b) region attachment placement ----
{
	const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
	const sd = load(clone(raw));
	// find a region attachment + its slot/skin
	let found = null;
	for (const skin of sd.skins) {
		for (const e of (skin.getAttachments ? skin.getAttachments() : [])) {
			if (e.attachment.constructor.name === 'RegionAttachment') { found = { skin: skin.name, slot: sd.slots[e.slotIndex].name, att: e.name, before: e.attachment }; break; }
		}
		if (found) break;
	}
	if (!found) { console.log('  (no region attachment — skipping placement test)'); }
	else {
		const NEW_X = (found.before.x || 0) + 23.5;
		const NEW_ROT = Math.round(((found.before.rotation || 0) + 12.5) * 10) / 10;
		// mutate the skin entry in rawDoc (as applyAttachmentEdit does)
		const skinEntry = raw.skins.find((s) => s.name === found.skin);
		const a = skinEntry.attachments[found.slot][found.att];
		a.x = NEW_X; a.rotation = NEW_ROT;
		const after = load(clone(raw));
		const skin2 = after.findSkin(found.skin);
		const reAtt = skin2.getAttachments().find((e) => e.name === found.att && after.slots[e.slotIndex].name === found.slot)?.attachment;
		console.log(`placement: ${found.skin}/${found.slot}/${found.att}  x→${NEW_X}, rotation→${NEW_ROT}`);
		log(!!reAtt, 'reloaded region attachment found');
		log(reAtt && Math.abs(reAtt.x - NEW_X) < 0.001, `x present on reload (${reAtt && reAtt.x})`);
		log(reAtt && Math.abs(reAtt.rotation - NEW_ROT) < 0.001, `rotation present on reload (${reAtt && reAtt.rotation})`);
	}
}

console.log(pass ? '\n✅ PASS — slot reorder + attachment placement round-trip through the loader.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
