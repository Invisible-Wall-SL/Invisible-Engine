// Phase 5.8 spike — prove the namespaced WHOLE-RIG merge (importRig in view.html) is
// byte-valid 4.2-format and lossless. It runs the SHIPPED transform, pulled out of view.html:
//   prefixRigNames(src, p)  — namespace every internal name + rewrite every ref
//   mergeRigInto(dst, src)  — drop imported root, re-parent its children onto dst's
//                             root, append + topo-sort bones, append slots/skins/
//                             constraints/animations.
// Then load the merged skeleton through the engine-rig loader and assert:
//   - loader accepts it (no dangling ref);
//   - parent-precedes-child invariant holds;
//   - no bone/slot/skin/anim name collisions;
//   - every imported animation is present;
//   - weighted-mesh bone indices are in range;
//   - the ORIGINAL rig's bones + anims are unchanged;
//   - EVENTS travel with the import: an imported key names the imported definition, under the
//     prefix, even where the open rig defines an event of the same name (a rig's FX / flipbook
//     bindings are event keys, so without this a rig with bindings could not be imported).
//   node tools/rigger-spike/rigmerge.mjs [dstSkel.json dstAtlas] [srcSkel.json srcAtlas]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import vm from 'node:vm';
import { RIG_CORE } from './rig.mjs';

const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson } = await import(RIG_CORE);

function load(obj, atlasText) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = 2048; p.height = 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(obj);
}

// ---- the merge transform: view.html's own, with everything it calls -----------------------
const html = readFileSync(new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url), 'utf8');
const TOP = new Map();
for (const m of html.matchAll(/\n(function|const) ([A-Za-z_$][\w$]*)[ (]/g)) if (!TOP.has(m[2])) TOP.set(m[2], { kind: m[1], at: m.index });
function pull(name) {
	const { kind, at } = TOP.get(name);
	const eol = html.indexOf('\n', at + 1), first = html.slice(at, eol);
	let n = 0; for (const c of first) { if (c === '{' || c === '[') n++; else if (c === '}' || c === ']') n--; }
	if (n === 0 && (kind === 'const' || first.includes('{'))) return first;
	const end = html.indexOf(kind === 'const' ? '\n};' : '\n}', at);
	return html.slice(at, end + (kind === 'const' ? 3 : 2));
}
const pulled = [], seen = new Set();
for (const q = ['prefixRigNames', 'mergeRigInto']; q.length; ) {
	const name = q.shift();
	if (seen.has(name)) continue;
	if (!TOP.has(name)) { console.error(`✗ ${name} not found in view.html`); process.exit(2); }
	seen.add(name);
	const src = pull(name);
	pulled.push(src);
	// a function is followed only where it is CALLED — a local named like one is not it
	for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\b(\s*\()?/g)) {
		const t = TOP.get(m[1]);
		if (t && (t.kind === 'const' || m[2]) && !seen.has(m[1])) q.push(m[1]);
	}
}
const shipped = { rawDoc: null };
vm.createContext(shipped);
vm.runInContext(pulled.join('\n'), shipped, { filename: 'view.html#rigmerge' });
const { prefixRigNames, mergeRigInto } = shipped;

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
// match the prefixed attachment `name`/`path` entries the merge produced... but rig
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

// (7) events: the source keys one the open rig lacks and one it defines differently
{
	const host = JSON.parse(JSON.stringify(dstPair.raw));
	host.events = { ...(host.events || {}), shared: { int: 1 } };
	const lib = JSON.parse(JSON.stringify(srcPair.raw));
	lib.events = { ...(lib.events || {}), shared: { int: 2 }, fx_hit: { string: 'boom' } };
	lib.animations = lib.animations || {};
	const anim = Object.keys(lib.animations)[0] ?? 'keyed';
	lib.animations[anim] = { ...(lib.animations[anim] || {}), events: [{ time: 0, name: 'fx_hit' }, { time: 0.1, name: 'shared' }] };
	prefixRigNames(lib, 'ev_');
	mergeRigInto(host, lib, host.bones[0].name);
	let merged = null;
	try { merged = load(JSON.parse(JSON.stringify(host)), combinedAtlas); }
	catch (e) { log(false, 'loader REJECTED a merge whose source keys events — ' + e.message); }
	if (merged) {
		const keyed = merged.findAnimation('ev_' + anim).timelines.find((t) => t.events)?.events ?? [];
		const names = keyed.map((e) => e.data.name).join(', ');
		log(names === 'ev_fx_hit, ev_shared', `imported event keys name the imported definitions (${names || 'none'})`);
		log(merged.findEvent('ev_shared')?.intValue === 2 && merged.findEvent('shared')?.intValue === 1, "a same-named event keeps both definitions: the open rig's and the imported one");
	}
}

console.log(pass ? '\n✅ PASS — namespaced rig-merge loads, stays valid, is lossless + collision-free.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
