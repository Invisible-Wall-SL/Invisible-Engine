// Batch round-trip across every spine skeleton in the repo's game assets.
//   node tools/rigger-spike/batch.mjs
// Pairs each <dir>/*.json skeleton with an atlas in the same dir (stem-matched,
// else the lone .atlas) and runs the model round-trip through the official loader.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { parseSkeleton, serializeSkeleton } from './spineModel.mjs';

const SPINE_CORE = new URL(
	'../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js',
	import.meta.url,
).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson } = await import(SPINE_CORE);

const r = (n) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n);
const hex = (c) => (c ? `${c.r.toFixed(3)},${c.g.toFixed(3)},${c.b.toFixed(3)},${c.a.toFixed(3)}` : null);

function loadSkeletonData(jsonTextOrObj, atlasText) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = p.width || 2048; p.height = p.height || 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(jsonTextOrObj);
}

function summariseSkin(skin) {
	const entries = [];
	for (const e of (skin.getAttachments ? skin.getAttachments() : [])) {
		const a = e.attachment, kind = a.constructor.name, rec = { slot: e.slotIndex, name: e.name, kind };
		if (kind === 'MeshAttachment') {
			rec.wvl = a.worldVerticesLength; rec.hull = a.hullLength; rec.tris = a.triangles?.length ?? 0;
			rec.bones = a.bones ? Array.from(a.bones) : null;
			rec.vertices = a.vertices ? Array.from(a.vertices).map(r) : null;
			rec.uvs = a.regionUVs ? Array.from(a.regionUVs).map(r) : null;
		} else if (kind === 'RegionAttachment') {
			rec.x = r(a.x); rec.y = r(a.y); rec.rot = r(a.rotation); rec.sx = r(a.scaleX); rec.sy = r(a.scaleY); rec.w = r(a.width); rec.h = r(a.height);
		} else if (['BoundingBoxAttachment', 'ClippingAttachment', 'PathAttachment'].includes(kind)) {
			rec.wvl = a.worldVerticesLength; rec.vertices = a.vertices ? Array.from(a.vertices).map(r) : null;
		} else if (kind === 'PointAttachment') { rec.x = r(a.x); rec.y = r(a.y); rec.rot = r(a.rotation); }
		entries.push(rec);
	}
	entries.sort((p, q) => p.slot - q.slot || p.name.localeCompare(q.name));
	return { name: skin.name, attachments: entries };
}

function summarise(sk) {
	return {
		name: sk.name, x: r(sk.x), y: r(sk.y), width: r(sk.width), height: r(sk.height), fps: r(sk.fps),
		bones: sk.bones.map((b) => ({ name: b.name, parent: b.parent?.name ?? null, length: r(b.length), x: r(b.x), y: r(b.y), rotation: r(b.rotation), scaleX: r(b.scaleX), scaleY: r(b.scaleY), shearX: r(b.shearX), shearY: r(b.shearY) })),
		slots: sk.slots.map((sl) => ({ name: sl.name, bone: sl.boneData.name, color: hex(sl.color), attachment: sl.attachmentName || null, blend: sl.blendMode })),
		ik: sk.ikConstraints.map((c) => c.name), transform: sk.transformConstraints.map((c) => c.name), path: sk.pathConstraints.map((c) => c.name),
		skins: sk.skins.map(summariseSkin),
		animations: sk.animations.map((a) => ({ name: a.name, duration: r(a.duration), timelines: a.timelines.length, frames: a.timelines.reduce((n, t) => n + (t.frames?.length ?? 0), 0) })),
	};
}

function diff(a, b, path, out, limit = 12) {
	if (out.length >= limit || a === b) return;
	const ta = typeof a, tb = typeof b;
	if (ta !== tb || a === null || b === null || ta !== 'object') { out.push(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); return; }
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) { out.push(`${path}: array/non-array`); return; }
		if (a.length !== b.length) out.push(`${path}.length: ${a.length} !== ${b.length}`);
		for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit; i++) diff(a[i], b[i], `${path}[${i}]`, out, limit);
		return;
	}
	for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { if (out.length >= limit) break; diff(a[k], b[k], `${path}.${k}`, out, limit); }
}

// ---- scan -------------------------------------------------------------------
function walk(dir, acc) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) { if (!/node_modules|\.svelte-kit|[\\/]build[\\/]?/.test(p)) walk(p, acc); }
		else if (name.endsWith('.json')) acc.push(p);
	}
	return acc;
}

const roots = ['apps/cluster/static/assets/spines', 'apps/lines/static/assets/spines', 'apps/ways/static/assets/spines', 'apps/scatter/static/assets/spines'];
const jsons = [];
for (const root of roots) { try { walk(root, jsons); } catch {} }

function findAtlas(jsonPath) {
	const dir = dirname(jsonPath), stem = basename(jsonPath, '.json');
	const atlases = readdirSync(dir).filter((f) => f.endsWith('.atlas'));
	if (!atlases.length) return null;
	return join(dir, atlases.find((a) => basename(a, '.atlas') === stem) ?? atlases[0]);
}

const featureTotals = { skeletons: 0, region: 0, mesh: 0, weightedMesh: 0, linkedmesh: 0, clipping: 0, boundingbox: 0, path: 0, point: 0, influences: 0 };
let pass = 0, fail = 0, skipped = 0;
const failures = [];

for (const jsonPath of jsons) {
	let raw;
	try { raw = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch { continue; }
	if (!raw.skeleton || !raw.bones) { skipped++; continue; } // not a skeleton
	const atlasPath = findAtlas(jsonPath);
	if (!atlasPath) { skipped++; continue; }
	const atlasText = readFileSync(atlasPath, 'utf8');

	let model;
	try { model = parseSkeleton(raw); } catch (e) { fail++; failures.push(`${jsonPath}: parse threw ${e.message}`); continue; }
	// feature tally
	featureTotals.skeletons++;
	for (const sk of model.skins) for (const slot of Object.values(sk.attachments)) for (const a of Object.values(slot)) {
		if (a.type === 'mesh') { featureTotals.mesh++; if (a.geometry.weighted) { featureTotals.weightedMesh++; for (const v of a.geometry.verts) featureTotals.influences += v.bones.length; } }
		else if (a.type in featureTotals) featureTotals[a.type]++;
	}

	let reser;
	try { reser = serializeSkeleton(model); } catch (e) { fail++; failures.push(`${jsonPath}: serialize threw ${e.message}`); continue; }

	let skA, skB;
	try { skA = loadSkeletonData(raw, atlasText); } catch (e) { skipped++; continue; } // can't establish baseline (atlas mismatch etc.)
	try { skB = loadSkeletonData(reser, atlasText); } catch (e) { fail++; failures.push(`${jsonPath}: loader REJECTED our output — ${e.message}`); continue; }

	const out = [];
	diff(summarise(skA), summarise(skB), 'sk', out);
	if (out.length === 0) pass++;
	else { fail++; failures.push(`${jsonPath}:\n      ${out.slice(0, 6).join('\n      ')}`); }
}

console.log(`\n=== Invisible Rigger Phase 0 — batch round-trip ===`);
console.log(`skeletons tested: ${pass + fail}   ✅ pass: ${pass}   ✗ fail: ${fail}   (skipped non-skeleton/unpairable: ${skipped})`);
console.log(`feature coverage across corpus:`);
console.log(`   region=${featureTotals.region}  mesh=${featureTotals.mesh} (weighted=${featureTotals.weightedMesh}, ${featureTotals.influences} influences)  ` +
	`linkedmesh=${featureTotals.linkedmesh}  clipping=${featureTotals.clipping}  boundingbox=${featureTotals.boundingbox}  path=${featureTotals.path}  point=${featureTotals.point}`);
if (failures.length) { console.log(`\nfailures:`); for (const f of failures.slice(0, 25)) console.log('   ' + f); process.exit(1); }
else console.log(`\n✅ ALL PASS — every skeleton round-trips identically through the official spine-core loader.`);
