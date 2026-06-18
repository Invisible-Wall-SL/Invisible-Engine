// Phase 5.8 spike — prove the namespaced WHOLE-RIG merge (importRig in view.html) is
// byte-valid Spine 4.2 and lossless. We replicate the browser transform here:
//   prefixRigNames(src, p)  — namespace every internal name + rewrite every ref
//   mergeRigInto(dst, src)  — drop imported root, re-parent its children onto dst's
//                             root, append + topo-sort bones, append slots/skins/
//                             constraints/animations.
// Then load the merged skeleton through the OFFICIAL spine-core loader and assert:
//   - loader accepts it (no dangling ref);
//   - parent-precedes-child invariant holds;
//   - no bone/slot/skin/anim name collisions;
//   - every imported animation is present;
//   - weighted-mesh bone indices are in range;
//   - the ORIGINAL rig's bones + anims are unchanged.
//   node tools/rigger-spike/rigmerge.mjs [dstSkel.json dstAtlas] [srcSkel.json srcAtlas]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

const SPINE_CORE = new URL(
	'../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js',
	import.meta.url,
).href;
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson } = await import(SPINE_CORE);

function load(obj, atlasText) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = 2048; p.height = 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(obj);
}

// ---- the merge transform (mirror of view.html importRig core) --------------
function prefixRigNames(src, p) {
	const bones = Array.isArray(src.bones) ? src.bones : [];
	for (const b of bones) {
		if (typeof b.name === 'string') b.name = p + b.name;
		if (typeof b.parent === 'string') b.parent = p + b.parent;
	}
	for (const s of src.slots || []) {
		if (typeof s.name === 'string') s.name = p + s.name;
		if (typeof s.bone === 'string') s.bone = p + s.bone;
	}
	for (const sk of src.skins || []) {
		if (typeof sk.name === 'string') sk.name = p + sk.name;
		const att = sk.attachments || {};
		const rekeyed = {};
		for (const slotName of Object.keys(att)) {
			const slot = att[slotName];
			for (const a of Object.values(slot || {}))
				if (a && a.type === 'linkedmesh' && typeof a.skin === 'string') a.skin = p + a.skin;
			rekeyed[p + slotName] = slot;
		}
		sk.attachments = rekeyed;
	}
	for (const grp of ['ik', 'transform', 'path']) for (const c of src[grp] || []) {
		if (typeof c.name === 'string') c.name = p + c.name;
		if (typeof c.bone === 'string') c.bone = p + c.bone;
		if (typeof c.target === 'string') c.target = p + c.target;
		if (Array.isArray(c.bones)) c.bones = c.bones.map((n) => (typeof n === 'string' ? p + n : n));
	}
	const rekey = (obj) => { if (!obj || typeof obj !== 'object') return obj; const out = {}; for (const k of Object.keys(obj)) out[p + k] = obj[k]; return out; };
	// Prefix the animation NAMES too, so imported clips never collide with the open rig's.
	if (src.animations) src.animations = rekey(src.animations);
	for (const an of Object.values(src.animations || {})) {
		if (an.bones) an.bones = rekey(an.bones);
		if (an.slots) an.slots = rekey(an.slots);
		if (an.ik) an.ik = rekey(an.ik);
		if (an.transform) an.transform = rekey(an.transform);
		if (an.path) an.path = rekey(an.path);
		if (an.deform) { const skinMap = {}; for (const sn of Object.keys(an.deform)) skinMap[p + sn] = rekey(an.deform[sn] || {}); an.deform = skinMap; }
		// Spine 4.2 `attachments` channel: skin → slot → attachment → {deform|sequence}.
		// Prefix the skin + slot keys (attachment-name keys are within-slot ids, left as-is).
		if (an.attachments) { const skinMap = {}; for (const sn of Object.keys(an.attachments)) skinMap[p + sn] = rekey(an.attachments[sn] || {}); an.attachments = skinMap; }
		if (Array.isArray(an.drawOrder)) for (const fr of an.drawOrder) if (Array.isArray(fr.offsets)) for (const o of fr.offsets) if (typeof o.slot === 'string') o.slot = p + o.slot;
	}
}
function topoSortBones(doc) {
	const byName = new Map(doc.bones.map((b) => [b.name, b]));
	const out = [], seen = new Set();
	const visit = (b) => { if (!b || seen.has(b.name)) return; seen.add(b.name); const par = b.parent && byName.get(b.parent); if (par) visit(par); out.push(b); };
	doc.bones.forEach(visit);
	doc.bones = out;
}
function mergeRigInto(dst, src, attachBone) {
	const srcBones = Array.isArray(src.bones) ? src.bones : [];
	const srcRoot = srcBones[0] ? srcBones[0].name : null;
	// The imported root is DROPPED — re-point every reference to it onto attachBone so no
	// slot/constraint/anim-key dangles (the loader rejects a slot on a missing bone).
	if (srcRoot && srcRoot !== attachBone) {
		for (const b of srcBones) if (b.parent === srcRoot) b.parent = attachBone;
		for (const s of src.slots || []) if (s.bone === srcRoot) s.bone = attachBone;
		for (const grp of ['ik', 'transform', 'path']) for (const c of src[grp] || []) {
			if (c.bone === srcRoot) c.bone = attachBone;
			if (c.target === srcRoot) c.target = attachBone;
			if (Array.isArray(c.bones)) c.bones = c.bones.map((n) => (n === srcRoot ? attachBone : n));
		}
		for (const an of Object.values(src.animations || {})) if (an.bones && an.bones[srcRoot]) {
			// merge keys: a root bone-timeline folds onto attachBone's (rare; keep src's).
			an.bones[attachBone] = an.bones[attachBone] || an.bones[srcRoot];
			delete an.bones[srcRoot];
		}
	}
	for (const b of srcBones) { if (b.name === srcRoot) continue; if (!b.parent) b.parent = attachBone; dst.bones.push(b); }
	topoSortBones(dst);
	dst.slots = dst.slots || []; for (const s of src.slots || []) dst.slots.push(s);
	dst.skins = dst.skins || []; for (const sk of src.skins || []) dst.skins.push(sk);
	for (const grp of ['ik', 'transform', 'path']) if (Array.isArray(src[grp])) { dst[grp] = dst[grp] || []; for (const c of src[grp]) dst[grp].push(c); }
	dst.animations = dst.animations || {}; for (const k of Object.keys(src.animations || {})) dst.animations[k] = src.animations[k];
}

// ---- corpus discovery (mirror batch.mjs) -----------------------------------
function walk(dir, acc) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name); const st = statSync(p);
		if (st.isDirectory()) { if (!/node_modules|\.svelte-kit|[\\/]build[\\/]?/.test(p)) walk(p, acc); }
		else if (name.endsWith('.json')) acc.push(p);
	}
	return acc;
}
function findAtlas(jsonPath) {
	const dir = dirname(jsonPath), stem = basename(jsonPath, '.json');
	const atlases = readdirSync(dir).filter((f) => f.endsWith('.atlas'));
	if (!atlases.length) return null;
	return join(dir, atlases.find((a) => basename(a, '.atlas') === stem) ?? atlases[0]);
}
function loadablePair(jsonPath) {
	let raw; try { raw = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch { return null; }
	if (!raw.skeleton || !Array.isArray(raw.bones)) return null;
	const atlasPath = findAtlas(jsonPath); if (!atlasPath) return null;
	const atlasText = readFileSync(atlasPath, 'utf8');
	try { load(JSON.parse(JSON.stringify(raw)), atlasText); } catch { return null; } // must load on its own
	return { raw, atlasText, jsonPath };
}

let dstPair, srcPair;
const argv = process.argv.slice(2);
if (argv.length >= 4) {
	dstPair = { raw: JSON.parse(readFileSync(argv[0], 'utf8')), atlasText: readFileSync(argv[1], 'utf8'), jsonPath: argv[0] };
	srcPair = { raw: JSON.parse(readFileSync(argv[2], 'utf8')), atlasText: readFileSync(argv[3], 'utf8'), jsonPath: argv[2] };
} else {
	const roots = ['apps/cluster/static/assets/spines', 'apps/lines/static/assets/spines', 'apps/ways/static/assets/spines', 'apps/scatter/static/assets/spines'];
	const jsons = []; for (const r of roots) { try { walk(r, jsons); } catch {} }
	const pairs = [];
	for (const jp of jsons) { const p = loadablePair(jp); if (p) pairs.push(p); if (pairs.length >= 40) break; }
	// destination: prefer one WITH animations; source: prefer one with weighted mesh + anims
	const withAnims = pairs.filter((p) => p.raw.animations && Object.keys(p.raw.animations).length);
	const isWeighted = (att) => att && att.type === 'mesh' && Array.isArray(att.vertices) && Array.isArray(att.uvs) && att.vertices.length !== att.uvs.length;
	const hasWeighted = (p) => (p.raw.skins || []).some((sk) => Object.values(sk.attachments || {}).some((slot) => Object.values(slot).some(isWeighted)));
	srcPair = withAnims.find(hasWeighted) || withAnims[0] || pairs[0];
	dstPair = withAnims.find((p) => p !== srcPair) || pairs.find((p) => p !== srcPair) || pairs[0];
}
if (!dstPair || !srcPair) { console.log('✗ FAIL — could not find two loadable skeletons in the corpus'); process.exit(1); }

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
const isWeighted = (att) => att && att.type === 'mesh' && Array.isArray(att.vertices) && Array.isArray(att.uvs) && att.vertices.length !== att.uvs.length;

console.log(`\n=== Phase 5.8 rig-merge → reload ===`);
console.log(`  dst (open rig): ${dstPair.jsonPath}`);
console.log(`  src (imported): ${srcPair.jsonPath}`);

// snapshot the ORIGINAL dst before merge
const dstOrig = JSON.parse(JSON.stringify(dstPair.raw));
const dstOrigBones = dstOrig.bones.map((b) => b.name);
const dstOrigAnims = Object.keys(dstOrig.animations || {}).sort();

// run the transform
const dst = JSON.parse(JSON.stringify(dstPair.raw));
const src = JSON.parse(JSON.stringify(srcPair.raw));
const srcAnims = Object.keys(src.animations || {});
const prefix = 'imp_';
prefixRigNames(src, prefix);
const attachBone = dst.bones[0].name;
mergeRigInto(dst, src, attachBone);

// (1) loader accepts the merged skeleton. In the LIVE tool the open rig keeps its own
// atlas, so imported region names don't resolve until the user re-attaches B's art
// (documented behavior). To validate the merged STRUCTURE here we feed a combined atlas
// (dst pages + src pages) so every region name exists and the loader exercises every
// bone/slot/constraint/anim reference. We prefix the src page lines' region names to
// match the prefixed attachment `name`/`path` entries the merge produced... but spine
// attachments key by attachment NAME, not slot — region names inside skins were NOT
// prefixed by the transform, so the src atlas region names still apply as-is.
const combinedAtlas = dstPair.atlasText.trimEnd() + '\n\n' + srcPair.atlasText.trimStart();
let data = null;
try { data = load(JSON.parse(JSON.stringify(dst)), combinedAtlas); }
catch (e) { log(false, 'loader REJECTED the merged skeleton — ' + e.message); }
if (data) {
	log(true, 'loader accepts the merged skeleton (no dangling ref)');

	// (2) parent-precedes-child invariant
	const pos = new Map(dst.bones.map((b, i) => [b.name, i]));
	let order = true;
	for (let i = 0; i < dst.bones.length; i++) { const par = dst.bones[i].parent; if (par && pos.get(par) > i) order = false; }
	log(order, 'every parent precedes its children (topo-sort holds)');

	// (3) no name collisions
	const dup = (arr) => { const s = new Set(), d = []; for (const n of arr) { if (s.has(n)) d.push(n); s.add(n); } return d; };
	const bDup = dup(dst.bones.map((b) => b.name));
	const sDup = dup((dst.slots || []).map((s) => s.name));
	const kDup = dup((dst.skins || []).map((s) => s.name));
	log(bDup.length === 0, `no duplicate bone names (${bDup.join(', ') || 'none'})`);
	log(sDup.length === 0, `no duplicate slot names (${sDup.join(', ') || 'none'})`);
	log(kDup.length === 0, `no duplicate skin names (${kDup.join(', ') || 'none'})`);

	// (4) every imported animation present, under its prefixed name
	const mergedAnims = new Set(Object.keys(dst.animations || {}));
	const missing = srcAnims.filter((a) => !mergedAnims.has(prefix + a));
	log(missing.length === 0, `all ${srcAnims.length} imported animation(s) present (missing: ${missing.join(', ') || 'none'})`);

	// (5) weighted-mesh bone indices in range
	let oob = 0, weighted = 0;
	for (const sk of dst.skins || []) for (const slot of Object.values(sk.attachments || {})) for (const att of Object.values(slot)) {
		if (!isWeighted(att)) continue;
		weighted++;
		const vc = att.uvs.length / 2; let ri = 0;
		for (let v = 0; v < vc; v++) { const n = att.vertices[ri++]; for (let j = 0; j < n; j++) { const bi = att.vertices[ri]; ri += 4; if (bi < 0 || bi >= dst.bones.length) oob++; } }
	}
	log(oob === 0, `all weighted-mesh bone indices in range (${weighted} weighted mesh(es), ${oob} out of range)`);

	// (6) original rig untouched: its bones still present (unprefixed) + its anims intact
	const mergedBoneNames = new Set(dst.bones.map((b) => b.name));
	const origLost = dstOrigBones.filter((n) => !mergedBoneNames.has(n));
	log(origLost.length === 0, `original rig's bones all still present (${origLost.join(', ') || 'none'} lost)`);
	const origAnimsLost = dstOrigAnims.filter((a) => !mergedAnims.has(a));
	log(origAnimsLost.length === 0, `original rig's animations intact (${origAnimsLost.join(', ') || 'none'} lost)`);
	// and the imported names are all prefixed (no unprefixed import leaked into dst beyond originals)
	const importedBoneCount = (src.bones.length - 1); // minus dropped root
	const gained = dst.bones.length - dstOrigBones.length;
	log(gained === importedBoneCount, `bone count grew by exactly the imported bones (${dstOrigBones.length} → ${dst.bones.length}, +${gained}, want +${importedBoneCount})`);
}

console.log(pass ? '\n✅ PASS — namespaced rig-merge loads, stays valid, is lossless + collision-free.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
