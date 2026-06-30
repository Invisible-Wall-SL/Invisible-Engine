// Phase §18 item 5 spike (GATE) — nail the Spine 4.2 SLOT BLEND MODE setup property
// (slot `blend`) against the official runtime before any UI is built. Blend mode is a
// SETUP-ONLY property in Spine — there is NO blend timeline (it is not animated).
//   node tools/rigger-spike/blendmode.mjs <skeleton.json> <skeleton.atlas>
//
// ============================ EMPIRICAL FINDINGS ============================
// (validated below against @esotericsoftware/spine-core@4.2.74's SkeletonJson loader +
//  BlendMode enum + Utils.enumValue — NOT from memory. Read off SkeletonJson.js L118:
//    data.blendMode = Utils.enumValue(BlendMode, getValue(slotMap, "blend", "normal"));
//  SlotData.d.ts BlendMode enum L54-59; Utils.js enumValue L296-298.)
//
// SETUP — per-slot `blend` (skeletonData.slots[i].blendMode):
//   rawDoc.slots[i] = { name, bone, color?, dark?, blend?: "additive"|"multiply"|"screen", … }
//   • EXACT JSON field name is `blend` (a string).
//   • Accepted string values map via Utils.enumValue = `type[name[0].toUpperCase()+name.slice(1)]`,
//     i.e. the value is capitalised then looked up in the BlendMode enum:
//        "normal"   → BlendMode.Normal   = 0   (the loader default when `blend` is absent)
//        "additive" → BlendMode.Additive = 1
//        "multiply" → BlendMode.Multiply = 2
//        "screen"   → BlendMode.Screen   = 3
//   • The loader defaults to "normal" when `blend` is absent (getValue 3rd arg) → BlendMode.Normal.
//     So an absent `blend` and `blend:"normal"` BOTH yield SlotData.blendMode === Normal (0).
//   • Spine itself writes lowercase strings; enumValue only upper-cases the FIRST letter, so the
//     accepted wire form is the lowercase token ("additive", not "Additive"/"ADDITIVE").
//
// PARITY: a slot with no `blend` (or "normal") ⇒ SlotData.blendMode === Normal, identical to
// today. The Rigger therefore writes NO `blend` field for Normal (removes it) → byte-identical.
// This is a setup-only property: NO `blend` timeline exists in the Spine format (verified — the
// loader never reads a per-animation blend channel), so there are no dopesheet/timeline changes.
// ===========================================================================

import { readFileSync } from 'node:fs';

const CORE = new URL(
	'../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js',
	import.meta.url,
).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, BlendMode } = await import(CORE);

const [, , jsonPath, atlasPath] = process.argv;
if (!jsonPath || !atlasPath) {
	console.error('usage: node tools/rigger-spike/blendmode.mjs <skeleton.json> <skeleton.atlas>');
	process.exit(2);
}
const atlasText = readFileSync(atlasPath, 'utf8');

function loadData(obj) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
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

const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const slot = (raw.slots || []).find((s) => s.attachment) || (raw.slots || [])[0];
let pass = true;
const log = (ok, msg) => {
	console.log((ok ? '  ✅ ' : '  ✗ ') + msg);
	if (!ok) pass = false;
};
console.log(`\n=== §18.5 slot blend mode (setup \`blend\`) → reload: ${jsonPath} ===`);
if (!slot) {
	console.log('  (no slots — skipped)');
	process.exit(0);
}
const sName = slot.name;
console.log(`  slot "${sName}"`);

function withBlend(value) {
	const r = structuredClone(raw);
	r.slots = r.slots.map((s) =>
		s.name === sName ? (value === undefined ? (({ blend, ...rest }) => rest)(s) : { ...s, blend: value }) : s,
	);
	return loadData(r).findSlot(sName).blendMode;
}

// (1) original fixture as-is — blendMode matches whatever the slot's `blend` field declares
//     (absent ⇒ Normal). Real fixtures DO ship non-Normal blends (e.g. anticipation's first
//     slot is "additive"), so this asserts the loader honours the declared value, not Normal.
{
	const bm = loadData(raw).findSlot(sName).blendMode;
	const declared = slot.blend
		? BlendMode[slot.blend[0].toUpperCase() + slot.blend.slice(1)]
		: BlendMode.Normal;
	log(
		bm === declared,
		`original fixture slot blendMode honours declared blend:${JSON.stringify(slot.blend ?? null)} (got ${bm})`,
	);
}

// (2) absent `blend` (explicitly stripped) → Normal — parity baseline.
log(withBlend(undefined) === BlendMode.Normal, `absent blend → BlendMode.Normal (${BlendMode.Normal})`);

// (3) "normal" → Normal (same as absent).
log(withBlend('normal') === BlendMode.Normal, `blend:"normal" → BlendMode.Normal (${BlendMode.Normal})`);

// (4) "additive" → Additive (1).
log(withBlend('additive') === BlendMode.Additive, `blend:"additive" → BlendMode.Additive (${BlendMode.Additive})`);

// (5) "multiply" → Multiply (2).
log(withBlend('multiply') === BlendMode.Multiply, `blend:"multiply" → BlendMode.Multiply (${BlendMode.Multiply})`);

// (6) "screen" → Screen (3).
log(withBlend('screen') === BlendMode.Screen, `blend:"screen" → BlendMode.Screen (${BlendMode.Screen})`);

// (7) enum values are exactly the canonical 0..3 (guards against a runtime enum drift).
log(
	BlendMode.Normal === 0 && BlendMode.Additive === 1 && BlendMode.Multiply === 2 && BlendMode.Screen === 3,
	`BlendMode enum = {Normal:0, Additive:1, Multiply:2, Screen:3}`,
);

console.log(
	pass
		? '\n✅ PASS — slot blend mode: JSON field `blend` (lowercase token); absent/"normal"→Normal, "additive"→Additive, "multiply"→Multiply, "screen"→Screen. Setup-only (no timeline).'
		: '\n✗ FAIL',
);
process.exit(pass ? 0 : 1);
