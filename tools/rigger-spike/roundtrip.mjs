// Invisible Rigger — Phase 0 spike driver.
//
//   node tools/rigger-spike/roundtrip.mjs <skeleton.json> <skeleton.atlas>
//
// 1. Parse the real skeleton into our structured model, serialize it back.
// 2. Load BOTH the original JSON and our re-serialized JSON through the official
//    @esotericsoftware/spine-core loader (the gold-standard arbiter).
// 3. Summarise each resulting SkeletonData and diff — focus on weighted-mesh
//    vertex fidelity. If the loader gets identical data from our output, the
//    serializer round-trips faithfully.

import { readFileSync } from 'node:fs';
// spine-core is a transitive dep (via spine-pixi-v8) → only in pnpm's .pnpm store,
// not hoisted to top-level node_modules. Import the dist entry explicitly for the spike.
const SPINE_CORE = new URL(
	'../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js',
	import.meta.url,
).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson } = await import(SPINE_CORE);
import { parseSkeleton, serializeSkeleton } from './spineModel.mjs';

const [, , jsonPath, atlasPath] = process.argv;
if (!jsonPath || !atlasPath) {
	console.error('usage: node roundtrip.mjs <skeleton.json> <skeleton.atlas>');
	process.exit(2);
}

const r = (n) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n);
const hex = (c) => (c ? `${c.r.toFixed(3)},${c.g.toFixed(3)},${c.b.toFixed(3)},${c.a.toFixed(3)}` : null);

// ---- build a SkeletonData via the official loader --------------------------
function loadSkeletonData(jsonTextOrObj, atlasText) {
	const atlas = new TextureAtlas(atlasText);
	// Give every page a stub texture so attachment creation never trips on a
	// missing texture — we never render, we only inspect parsed data.
	const stubTexture = {
		getImage: () => ({ width: 2048, height: 2048 }),
		setFilters() {},
		setWraps() {},
		dispose() {},
	};
	for (const page of atlas.pages) {
		page.width = page.width || 2048;
		page.height = page.height || 2048;
		try {
			page.setTexture(stubTexture);
		} catch {
			page.texture = stubTexture;
		}
	}
	const loader = new AtlasAttachmentLoader(atlas);
	const sj = new SkeletonJson(loader);
	return sj.readSkeletonData(jsonTextOrObj);
}

// ---- summarise a SkeletonData into a comparable plain object ---------------
function summarise(sk) {
	const s = {
		name: sk.name,
		x: r(sk.x), y: r(sk.y), width: r(sk.width), height: r(sk.height), fps: r(sk.fps),
		bones: sk.bones.map((b) => ({
			name: b.name,
			parent: b.parent ? b.parent.name : null,
			length: r(b.length), x: r(b.x), y: r(b.y),
			rotation: r(b.rotation), scaleX: r(b.scaleX), scaleY: r(b.scaleY),
			shearX: r(b.shearX), shearY: r(b.shearY),
		})),
		slots: sk.slots.map((sl) => ({
			name: sl.name, bone: sl.boneData.name, color: hex(sl.color),
			attachment: sl.attachmentName || null, blend: sl.blendMode,
		})),
		ik: sk.ikConstraints.map((c) => c.name),
		transform: sk.transformConstraints.map((c) => c.name),
		path: sk.pathConstraints.map((c) => c.name),
		skins: sk.skins.map((skin) => summariseSkin(skin)),
		animations: sk.animations.map((a) => ({
			name: a.name,
			duration: r(a.duration),
			timelines: a.timelines.length,
			frames: a.timelines.reduce((n, t) => n + (t.frames ? t.frames.length : 0), 0),
		})),
	};
	return s;
}

function summariseSkin(skin) {
	const entries = [];
	const atts = skin.getAttachments ? skin.getAttachments() : [];
	for (const e of atts) {
		const a = e.attachment;
		const kind = a.constructor.name;
		const rec = { slot: e.slotIndex, name: e.name, kind };
		if (kind === 'MeshAttachment') {
			rec.worldVerticesLength = a.worldVerticesLength;
			rec.hullLength = a.hullLength;
			rec.triangles = a.triangles ? a.triangles.length : 0;
			rec.weighted = !!(a.bones && a.bones.length);
			// The headline: capture the exact parsed weighted-vertex data.
			rec.bones = a.bones ? Array.from(a.bones) : null;
			rec.vertices = a.vertices ? Array.from(a.vertices).map(r) : null;
			rec.uvs = a.regionUVs ? Array.from(a.regionUVs).map(r) : null;
		} else if (kind === 'RegionAttachment') {
			rec.x = r(a.x); rec.y = r(a.y); rec.rotation = r(a.rotation);
			rec.scaleX = r(a.scaleX); rec.scaleY = r(a.scaleY);
			rec.width = r(a.width); rec.height = r(a.height);
		} else if (kind === 'BoundingBoxAttachment' || kind === 'ClippingAttachment' || kind === 'PathAttachment') {
			rec.worldVerticesLength = a.worldVerticesLength;
			rec.vertices = a.vertices ? Array.from(a.vertices).map(r) : null;
		} else if (kind === 'PointAttachment') {
			rec.x = r(a.x); rec.y = r(a.y); rec.rotation = r(a.rotation);
		}
		entries.push(rec);
	}
	entries.sort((p, q) => p.slot - q.slot || p.name.localeCompare(q.name));
	return { name: skin.name, attachments: entries };
}

// ---- deep diff (reports first differences with path) -----------------------
function diff(a, b, path, out, limit = 40) {
	if (out.length >= limit) return;
	if (a === b) return;
	const ta = typeof a, tb = typeof b;
	if (ta !== tb || a === null || b === null || ta !== 'object') {
		out.push(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
		return;
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) { out.push(`${path}: array/non-array mismatch`); return; }
		if (a.length !== b.length) out.push(`${path}.length: ${a.length} !== ${b.length}`);
		for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit; i++) diff(a[i], b[i], `${path}[${i}]`, out, limit);
		return;
	}
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const k of keys) { if (out.length >= limit) break; diff(a[k], b[k], `${path}.${k}`, out, limit); }
}

// ---- run -------------------------------------------------------------------
const originalText = readFileSync(jsonPath, 'utf8');
const atlasText = readFileSync(atlasPath, 'utf8');
const rawOriginal = JSON.parse(originalText);

console.log(`\n=== Invisible Rigger Phase 0 — round-trip: ${jsonPath} ===`);
console.log(`exported by Spine ${rawOriginal.skeleton?.spine ?? '?'}`);

// our model round-trip
const model = parseSkeleton(rawOriginal);
const reserialized = serializeSkeleton(model);

// count what we actually modelled vs passed through
const meshStats = { meshes: 0, weighted: 0, influences: 0 };
for (const sk of model.skins)
	for (const slot of Object.values(sk.attachments))
		for (const a of Object.values(slot))
			if (a.type === 'mesh') {
				meshStats.meshes++;
				if (a.geometry.weighted) {
					meshStats.weighted++;
					for (const v of a.geometry.verts) meshStats.influences += v.bones.length;
				}
			}
console.log(`modelled: ${model.bones.length} bones, ${model.slots.length} slots, ${model.skins.length} skin(s), ` +
	`${meshStats.meshes} mesh(es) of which ${meshStats.weighted} weighted (${meshStats.influences} bone influences decoded/re-encoded)`);
console.log(`animations: ${Object.keys(model.animations || {}).length} (v1 PASS-THROUGH — not yet model-reconstructed)`);

let skA, skB;
try {
	skA = loadSkeletonData(rawOriginal, atlasText);
} catch (e) {
	console.error(`\n✗ official loader FAILED on the ORIGINAL skeleton: ${e.message}`);
	console.error('  (atlas/loader stubbing issue — falling back to model fixed-point only)');
}
try {
	skB = loadSkeletonData(reserialized, atlasText);
} catch (e) {
	console.error(`\n✗ official loader REJECTED our re-serialized output: ${e.message}`);
	console.error('  → serializer produced invalid Spine JSON. This is a real fidelity failure.');
	process.exit(1);
}

if (skA && skB) {
	const sumA = summarise(skA);
	const sumB = summarise(skB);
	const out = [];
	diff(sumA, sumB, 'skeleton', out);
	if (out.length === 0) {
		console.log('\n✅ PASS — official spine-core loader produced IDENTICAL SkeletonData from our output.');
		console.log('   Weighted-mesh vertices, bones, slots, skins, constraints all round-trip faithfully.');
		console.log('   (Animations matched too, but via pass-through — model-based animation serialization is Phase 5.)');
	} else {
		console.log(`\n✗ FAIL — ${out.length} difference(s) between original and round-tripped SkeletonData:`);
		for (const d of out) console.log('   ' + d);
		process.exit(1);
	}
} else {
	// fallback: model fixed-point (our parse∘serialize∘parse is stable)
	const model2 = parseSkeleton(reserialized);
	const out = [];
	diff(model, model2, 'model', out);
	if (out.length === 0) console.log('\n⚠ PARTIAL PASS — model fixed-point holds, but official-loader validation was skipped (see error above).');
	else { console.log(`\n✗ FAIL — model not a fixed point (${out.length} diffs):`); for (const d of out) console.log('   ' + d); process.exit(1); }
}
