// Phase §18 item 4 spike (GATE) — nail the Spine 4.2 SLOT DARK COLOUR (two-color tinting,
// "tint black", rgba2) setup + animation timeline data model against the official runtime,
// before any UI is built.
//   node tools/rigger-spike/darkcolor.mjs <skeleton.json> <skeleton.atlas>
//
// ============================ EMPIRICAL FINDINGS ============================
// (validated below against @esotericsoftware/spine-core@4.2.74's SkeletonJson loader +
//  Color.setFromString + RGBA2Timeline.apply — NOT from memory. Read off SkeletonJson.js
//  setup L114-116 + rgba2 timeline L591-623; Animation.js RGBA2Timeline L950-1058;
//  Utils.js Color.setFromString L102-109.)
//
// SETUP — per-slot `dark` (skeletonData.slots[i].darkColor):
//   rawDoc.slots[i] = { name, bone, color?: "rrggbbaa", dark?: "rrggbb", … }
//   • `dark` is a hex string. The loader does `data.darkColor = Color.fromString(dark)`.
//   • A slot has TWO-COLOR TINTING enabled IFF `dark` is present → SlotData.darkColor is a
//     real Color (non-null). With NO `dark` key, SlotData.darkColor stays null.
//   • `dark` is RGB-ONLY (6 hex). Color.setFromString sets a=1 when length != 8, so the
//     dark alpha is meaningless and never used (RGBA2Timeline only animates dark r,g,b).
//   • `color` (light) is the existing rgba (8 hex, carries alpha) — unchanged by this work.
//
// ANIMATION TIMELINE — `animations.<anim>.slots.<slot>.rgba2` (an RGBA2Timeline):
//   animations.<a>.slots.<slot>.rgba2 = [ { time, light: "rrggbbaa", dark: "rrggbb",
//                                           curve? }, … ]
//   • Per key the runtime reads keyMap.light (→ Color, rgba) and keyMap.dark (→ Color, rgb).
//     setFrame stores 8 entries: time, R,G,B,A (light), R2,G2,B2 (dark). Dark alpha is NOT
//     stored/animated.
//   • On apply (MixBlend.setup, time≥frame0) the runtime sets slot.color.{r,g,b,a} from the
//     light channel AND slot.darkColor.{r,g,b} from the dark channel (dark.a left as setup).
//   • light r,g,b,a AND dark r,g,b interpolate (linear, or bezier via `curve`). `curve` is
//     a single shared key curve driving SEVEN bezier channels (0=R 1=G 2=B 3=A 4=R2 5=G2
//     6=B2) — same flat bezier-controls array form as every other multi-channel timeline.
//   • A slot WITHOUT a setup `dark`: SkeletonJson still BUILDS the RGBA2Timeline (it does
//     not check darkColor at load), and apply still writes slot.darkColor.{r,g,b}. BUT
//     slot.darkColor is null on a non-two-color slot at construction (Slot ctor only makes
//     darkColor when data.darkColor != null) → applying rgba2 to such a slot THROWS at
//     runtime (null darkColor). Hence the Rigger rule: only key rgba2 on slots that HAVE a
//     setup `dark`; everything else stays on the plain `rgba` timeline.
//
// PARITY: a slot with no `dark` is byte-identical to today (rgba light timeline only); rgba2
// is additive and isolated to two-color slots.
// ===========================================================================

import { readFileSync } from 'node:fs';

const CORE = new URL(
	'../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js',
	import.meta.url,
).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics, MixBlend, MixDirection } =
	await import(CORE);

const [, , jsonPath, atlasPath] = process.argv;
if (!jsonPath || !atlasPath) {
	console.error('usage: node tools/rigger-spike/darkcolor.mjs <skeleton.json> <skeleton.atlas>');
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
function applyAnim(raw, t) {
	const data = loadData(raw);
	const anim = data.findAnimation('darkAnim');
	const sk = new Skeleton(data);
	sk.setToSetupPose();
	anim.apply(sk, 0, t, false, null, 1, MixBlend.setup, MixDirection.mixIn);
	try {
		sk.updateWorldTransform(Physics.update);
	} catch {
		sk.updateWorldTransform();
	}
	return sk;
}

const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const slot = (raw.slots || []).find((s) => s.attachment) || (raw.slots || [])[0];
let pass = true;
const log = (ok, msg) => {
	console.log((ok ? '  ✅ ' : '  ✗ ') + msg);
	if (!ok) pass = false;
};
console.log(`\n=== §18.4 slot dark colour (rgba2) → reload: ${jsonPath} ===`);
if (!slot) {
	console.log('  (no slots — skipped)');
	process.exit(0);
}
const sName = slot.name;
console.log(`  slot "${sName}"`);

// (1) SETUP — dark colour: a slot WITHOUT `dark` has null darkColor (no two-color);
//     adding `dark:"rrggbb"` gives the SlotData a non-null darkColor (two-color enabled).
{
	const noDark = loadData(raw).findSlot(sName).darkColor;
	log(noDark == null, `setup with NO dark → SlotData.darkColor is null (two-color OFF)`);

	const withDarkRaw = structuredClone(raw);
	withDarkRaw.slots = withDarkRaw.slots.map((s) => (s.name === sName ? { ...s, dark: '804020' } : s));
	const dd = loadData(withDarkRaw).findSlot(sName).darkColor;
	log(dd != null, `setup with dark:"804020" → SlotData.darkColor non-null (two-color ON)`);
	if (dd) {
		log(
			Math.abs(dd.r - 0x80 / 255) < 1e-3 && Math.abs(dd.g - 0x40 / 255) < 1e-3 && Math.abs(dd.b - 0x20 / 255) < 1e-3,
			`dark rgb parsed: r${dd.r.toFixed(3)} g${dd.g.toFixed(3)} b${dd.b.toFixed(3)} (804020)`,
		);
		// dark is 6-hex RGB-only — Color.setFromString sets a=1 when length != 8.
		log(Math.abs(dd.a - 1) < 1e-6, `dark is RGB-only (6 hex) → alpha defaults to 1 (a${dd.a.toFixed(3)})`);
	}
}

// (2) TIMELINE — rgba2 on a two-color slot. light white→half-red-fade, dark black→grey.
//     light: ffffffff → ff000080 ; dark: 000000 → 808080
{
	const r2Raw = structuredClone(raw);
	r2Raw.slots = r2Raw.slots.map((s) => (s.name === sName ? { ...s, dark: '000000' } : s));
	r2Raw.animations = {
		darkAnim: {
			slots: {
				[sName]: {
					rgba2: [
						{ time: 0, light: 'ffffffff', dark: '000000' },
						{ time: 1, light: 'ff000080', dark: '808080' },
					],
				},
			},
		},
	};
	const data = loadData(r2Raw);
	const tl = data.findAnimation('darkAnim').timelines[0];
	log(tl && tl.constructor.name === 'RGBA2Timeline', `loads as RGBA2Timeline (${tl ? tl.constructor.name : 'none'})`);

	// @0 — light white, dark black
	{
		const sl = applyAnim(r2Raw, 0).findSlot(sName);
		const c = sl.color,
			d = sl.darkColor;
		log(
			Math.abs(c.r - 1) < 1e-3 && Math.abs(c.g - 1) < 1e-3 && Math.abs(c.a - 1) < 1e-3,
			`@0 light = white (r${c.r.toFixed(2)} g${c.g.toFixed(2)} a${c.a.toFixed(2)})`,
		);
		log(
			d && Math.abs(d.r) < 1e-3 && Math.abs(d.g) < 1e-3 && Math.abs(d.b) < 1e-3,
			`@0 dark = black (r${d.r.toFixed(2)} g${d.g.toFixed(2)} b${d.b.toFixed(2)})`,
		);
	}
	// @0.5 LINEAR midpoint — light: r1 g.5 b.5 a.751 ; dark: .251 each (0→0x80/255 /2)
	{
		const sl = applyAnim(r2Raw, 0.5).findSlot(sName);
		const c = sl.color,
			d = sl.darkColor;
		log(Math.abs(c.r - 1) < 1e-2, `@0.5 light r stays 1 (${c.r.toFixed(3)})`);
		log(Math.abs(c.g - 0.5) < 1e-2, `@0.5 light g ≈ 0.5 (${c.g.toFixed(3)})`);
		log(Math.abs(c.a - 0.751) < 1e-2, `@0.5 light a ≈ 0.75 (${c.a.toFixed(3)})`);
		const darkMid = 0x80 / 255 / 2; // 0.251
		log(Math.abs(d.r - darkMid) < 1e-2, `@0.5 dark r ≈ 0.25 (${d.r.toFixed(3)})`);
		log(Math.abs(d.g - darkMid) < 1e-2, `@0.5 dark g ≈ 0.25 (${d.g.toFixed(3)})`);
		log(Math.abs(d.b - darkMid) < 1e-2, `@0.5 dark b ≈ 0.25 (${d.b.toFixed(3)})`);
	}
}

// (3) BEZIER curve — a shared single key curve drives ALL 7 channels (0=R 1=G 2=B 3=A
//     4=R2 5=G2 6=B2). `curve` = [cx1,cy1,cx2,cy2] × 7; the cy values are ABSOLUTE value-space
//     handle y-coords (Spine, not normalized). We animate two ASCENDING channels — light
//     ALPHA (0→1) and dark R (0→1) — with the same ease-out handles, and assert the runtime's
//     midpoint sample is clearly pulled off the linear 0.5 by an equal amount on BOTH the
//     light and the dark channel (so each gets its own per-channel curve).
{
	const easeOut = [0.1, 0.7, 0.3, 0.95]; // handles high → midpoint well above linear 0.5
	const curveRaw = structuredClone(raw);
	curveRaw.slots = curveRaw.slots.map((s) => (s.name === sName ? { ...s, dark: '000000' } : s));
	// 7 channels × 4 control values = 28-length curve array (cx1,cy1,cx2,cy2 per channel)
	const curve = [];
	for (let ch = 0; ch < 7; ch++) curve.push(...easeOut);
	curveRaw.animations = {
		darkAnim: {
			slots: {
				[sName]: {
					rgba2: [
						{ time: 0, light: '00ff0000', dark: '000000', curve }, // light alpha 0, dark black
						{ time: 1, light: '00ff00ff', dark: 'ffffff' }, // light alpha 1, dark white
					],
				},
			},
		},
	};
	// linear reference (no curve) — same keys
	const linRaw = structuredClone(curveRaw);
	linRaw.animations.darkAnim.slots[sName].rgba2[0] = { time: 0, light: '00ff0000', dark: '000000' };

	const cMid = applyAnim(curveRaw, 0.5).findSlot(sName);
	const lMid = applyAnim(linRaw, 0.5).findSlot(sName);
	log(Math.abs(lMid.color.a - 0.5) < 1e-2, `@0.5 linear light a = 0.5 (${lMid.color.a.toFixed(3)})`);
	log(Math.abs(lMid.darkColor.r - 0.5) < 1e-2, `@0.5 linear dark r = 0.5 (${lMid.darkColor.r.toFixed(3)})`);
	log(
		cMid.color.a > lMid.color.a + 0.1,
		`@0.5 bezier light a (${cMid.color.a.toFixed(3)}) bent above linear — light curve applies`,
	);
	log(
		cMid.darkColor.r > lMid.darkColor.r + 0.1,
		`@0.5 bezier dark r (${cMid.darkColor.r.toFixed(3)}) bent above linear — dark curve applies`,
	);
	// shared curve ⇒ identical bend on both ascending channels (runtime's own sampling agrees)
	log(
		Math.abs(cMid.color.a - cMid.darkColor.r) < 1e-3,
		`@0.5 light a (${cMid.color.a.toFixed(3)}) == dark r (${cMid.darkColor.r.toFixed(3)}) — shared curve, per-channel`,
	);
}

console.log(
	pass
		? '\n✅ PASS — slot dark colour: setup `dark` (6-hex RGB) enables two-color; rgba2 {light,dark} timeline loads + drives slot.color + slot.darkColor; linear + bezier both verified.'
		: '\n✗ FAIL',
);
process.exit(pass ? 0 : 1);
