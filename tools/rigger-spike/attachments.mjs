// Phase §18 item 9 spike (GATE) — nail the Spine 4.2 EXTRA ATTACHMENT types (point, boundingbox,
// clipping, linkedmesh) JSON format + loader behaviour against the official runtime, before any UI.
//   node tools/rigger-spike/attachments.mjs <skeleton.json> <skeleton.atlas>
//
// ============================ EMPIRICAL FINDINGS ============================
// (validated below against @esotericsoftware/spine-core@4.2.74's SkeletonJson loader +
//  PointAttachment / BoundingBoxAttachment / ClippingAttachment / MeshAttachment — NOT from memory.
//  Read off SkeletonJson.js: readAttachment L363-473 (boundingbox L389, mesh/linkedmesh L399,
//  point L445, clipping L457), readVertices L483-510, LinkedMesh resolve L324-337 + class L1058.)
//
// ── POINT (slot attachment, lives in a skin like region/mesh) ────────────────────────────────────
//   skins.<skin>.attachments.<slot>.<name> = {
//     type: "point",
//     x: 0,            // float, default 0 — slot-bone-local X (* skeleton scale on load)
//     y: 0,            // float, default 0 — slot-bone-local Y (* scale)
//     rotation: 0,     // float degrees, default 0 — NOT scaled
//     color?: "RRGGBBAA",  // optional editor display colour (points aren't usually rendered)
//   }
//   ⚠ A point is NOT a vertex list — x/y/rotation are SCALARS (it extends VertexAttachment but the
//   loader reads plain x/y/rotation, never readVertices). Builds a PointAttachment.
//   computeWorldPosition(bone, vec) → {x,y} in WORLD space; computeWorldRotation(bone) → degrees.
//
// ── BOUNDING BOX (slot attachment, a polygon hit/collision region) ────────────────────────────────
//   { type: "boundingbox",
//     vertexCount: N,  // int — number of polygon points
//     vertices: [...], // EXACTLY the VertexAttachment packed format (same as mesh/path):
//                      //   UNWEIGHTED ⇒ flat [x,y, x,y, …] length vertexCount*2 (slot-bone-local);
//                      //   WEIGHTED  ⇒ packed [boneCount, boneIdx,vx,vy,weight, …] per point.
//                      //   loader picks unweighted iff vertices.length == vertexCount*2.
//     color?: "RRGGBBAA" }
//   ⚠ loader calls readVertices(map, box, vertexCount << 1) (i.e. expected length = vertexCount*2).
//   Builds a BoundingBoxAttachment; computeWorldVertices(slot,0,worldVerticesLength,out,0,2) → polygon.
//
// ── CLIPPING (slot attachment — a polygon MASK clipping a RANGE of slots) ─────────────────────────
//   { type: "clipping",
//     end: "<endSlotName>",  // REQUIRED in practice — the LAST slot the mask affects. Resolved via
//                            //   skeletonData.findSlot(end) → attachment.endSlot. The clip is active
//                            //   from the slot holding this attachment THROUGH the `end` slot.
//     vertexCount: N,        // int — polygon point count (same packed `vertices` as boundingbox)
//     vertices: [...],       // packed like boundingbox/mesh (readVertices, length vertexCount*2)
//     color?: "RRGGBBAA" }   // editor display colour
//   ⚠ `end` referencing a missing slot ⇒ endSlot stays null (loader getValue default null; findSlot
//   returns null — no throw). Builds a ClippingAttachment; SkeletonClipping consumes endSlot.
//
// ── LINKED MESH (a mesh that REFERENCES another mesh's geometry/UVs/triangles across skins) ───────
//   { type: "linkedmesh",   // (also accepted as "mesh" + a `parent` field — SAME loader case)
//     parent: "<sourceMeshName>", // REQUIRED — the source mesh attachment NAME in the source skin
//     skin?: "<sourceSkin>",      // optional, default null → source resolves in the DEFAULT skin
//     timelines?: true,           // optional bool, default TRUE → inheritTimeline (deform-inherit):
//                                 //   true ⇒ mesh.timelineAttachment = parent (shares deform keys);
//                                 //   false ⇒ timelineAttachment = self (own deform). Spine editor's
//                                 //   "Inherit Deform/Timeline" checkbox. (field name is `timelines`,
//                                 //   NOT `deform`/`inheritDeform` — those are pre-4.x.)
//     path: "<atlasRegion>",      // ⚠ REQUIRED IN PRACTICE — a linkedmesh STILL goes through
//                                 //   newMeshAttachment, which resolves `path` (default = name)
//                                 //   against the atlas BEFORE the deferred parent-resolve. So it
//                                 //   MUST carry a `path` pointing at the SAME region as its parent
//                                 //   (Spine editor always exports this). Omit → "Region not found".
//     width?, height?,            // optional editor dims (* scale)
//     color?, sequence? }         // optional like a normal mesh
//   ⚠ A linkedmesh has NO own vertices/uvs/triangles in JSON — the loader DEFERS it (pushes a
//   LinkedMesh) and post-load calls setParentMesh(parent), copying the parent's bones/vertices/
//   worldVerticesLength/regionUVs/triangles/hullLength. parent must exist in the named (or default)
//   skin at the SAME slot index, else loader THROWS "Parent mesh not found".
import { readFileSync, existsSync } from 'node:fs';

const SPINE = '.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js';
// resolve spine-core from the nearest node_modules up the tree (worktrees may lack their own)
let CORE = null;
for (let up = 2; up <= 8; up++) {
	const cand = new URL('../'.repeat(up) + 'node_modules/' + SPINE, import.meta.url);
	if (existsSync(cand)) { CORE = cand; break; }
}
if (!CORE) throw new Error('spine-core@4.2.74 not found in any ancestor node_modules');
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics, Vector2 } = await import(CORE.href);

const [, , jsonPath, atlasPath] = process.argv;
if (!jsonPath || !atlasPath) { console.log('usage: node tools/rigger-spike/attachments.mjs <skeleton.json> <skeleton.atlas>'); process.exit(1); }
const atlasText = readFileSync(atlasPath, 'utf8');
function loadData(obj) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = 2048; p.height = 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(obj);
}
const clone = (o) => JSON.parse(JSON.stringify(o));

let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };

const baseRaw = JSON.parse(readFileSync(jsonPath, 'utf8'));
console.log(`\n=== §18.9 extra attachments (point / boundingbox / clipping / linkedmesh) → official runtime: ${jsonPath} ===`);

const skinName = (baseRaw.skins && baseRaw.skins[0] && baseRaw.skins[0].name) || 'default';
const hostSlot = baseRaw.slots && baseRaw.slots.find((s) => s.bone);
if (!hostSlot) { console.log('  (no slot with a bone — cannot host an attachment)'); process.exit(1); }
const slotName = hostSlot.name;
const slotIndexOf = (data, n) => data.slots.findIndex((s) => s.name === n);
console.log(`  host skin="${skinName}" slot="${slotName}" (bone ${hostSlot.bone})`);

// place an attachment of given name into the host slot in the host skin, return the cloned doc
function withAttachment(raw, attName, attDef, targetSlot = slotName, targetSkin = skinName) {
	const r = clone(raw);
	r.skins = r.skins || [{ name: 'default', attachments: {} }];
	let skin = r.skins.find((s) => s.name === targetSkin);
	if (!skin) { skin = { name: targetSkin, attachments: {} }; r.skins.push(skin); }
	skin.attachments = skin.attachments || {};
	skin.attachments[targetSlot] = skin.attachments[targetSlot] || {};
	skin.attachments[targetSlot][attName] = attDef;
	return r;
}

function getAtt(data, attName, n = slotName, sk = skinName) {
	const skin = data.findSkin(sk) || data.defaultSkin;
	return skin.getAttachment(slotIndexOf(data, n), attName);
}

// =================================================================================================
// POINT
// =================================================================================================
console.log('\n  ── POINT ─────────────────────────────────────────────');
{
	const raw = withAttachment(baseRaw, 'spikePoint', { type: 'point', x: 30, y: -45, rotation: 90, color: 'ff8800ff' });
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'loader REJECTED point — ' + e.message); }
	if (data) {
		const att = getAtt(data, 'spikePoint');
		log(!!att && att.constructor.name === 'PointAttachment', `built a PointAttachment (${att && att.constructor.name})`);
		if (att) {
			log(att.x === 30 && att.y === -45 && att.rotation === 90, `x/y/rotation preserved (x${att.x} y${att.y} rot${att.rotation})`);
			const sk = new Skeleton(data);
			sk.setToSetupPose();
			try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }
			const bone = sk.findBone(hostSlot.bone) || sk.bones[0];
			const wp = att.computeWorldPosition(bone, new Vector2());
			const wr = att.computeWorldRotation(bone);
			log(Number.isFinite(wp.x) && Number.isFinite(wp.y), `computeWorldPosition → world (${wp.x.toFixed(1)}, ${wp.y.toFixed(1)})`);
			log(Number.isFinite(wr), `computeWorldRotation → ${wr.toFixed(1)}°`);
		}
	}
}
// point defaults: omitted x/y/rotation → 0
{
	const raw = withAttachment(baseRaw, 'spikePointDef', { type: 'point' });
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'minimal point REJECTED — ' + e.message); }
	if (data) {
		const att = getAtt(data, 'spikePointDef');
		log(att && att.x === 0 && att.y === 0 && att.rotation === 0, `omitted x/y/rotation → 0/0/0 (got ${att && att.x}/${att && att.y}/${att && att.rotation})`);
	}
}

// =================================================================================================
// BOUNDING BOX
// =================================================================================================
console.log('\n  ── BOUNDING BOX ──────────────────────────────────────');
const bboxPts = [-50, -50, 50, -50, 50, 50, -50, 50]; // a 100×100 box, 4 points
{
	const raw = withAttachment(baseRaw, 'spikeBox', { type: 'boundingbox', vertexCount: 4, vertices: bboxPts.slice(), color: '00ff00ff' });
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'loader REJECTED boundingbox — ' + e.message); }
	if (data) {
		const att = getAtt(data, 'spikeBox');
		log(!!att && att.constructor.name === 'BoundingBoxAttachment', `built a BoundingBoxAttachment (${att && att.constructor.name})`);
		if (att) {
			log(att.worldVerticesLength === 8, `worldVerticesLength == vertexCount*2 (${att.worldVerticesLength})`);
			log(att.vertices.length === 8, `unweighted vertices stored flat (len ${att.vertices.length})`);
			const sk = new Skeleton(data);
			sk.setToSetupPose();
			try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }
			const slot = sk.slots[slotIndexOf(data, slotName)];
			slot.setAttachment(att);
			const out = new Array(att.worldVerticesLength).fill(0);
			att.computeWorldVertices(slot, 0, att.worldVerticesLength, out, 0, 2);
			const xs = out.filter((_, i) => i % 2 === 0), ys = out.filter((_, i) => i % 2 === 1);
			const spanX = Math.max(...xs) - Math.min(...xs), spanY = Math.max(...ys) - Math.min(...ys);
			log(spanX > 50 && spanY > 50, `computeWorldVertices yields the polygon (Δx ${spanX.toFixed(1)}, Δy ${spanY.toFixed(1)})`);
		}
	}
}

// =================================================================================================
// CLIPPING
// =================================================================================================
console.log('\n  ── CLIPPING ──────────────────────────────────────────');
const clipPts = [-60, -60, 60, -60, 60, 60, -60, 60]; // 4-point clip polygon
{
	// pick a DIFFERENT slot as the `end` slot (the last slot the mask affects); fall back to self
	const endSlotName = (baseRaw.slots.find((s) => s.name !== slotName) || hostSlot).name;
	const raw = withAttachment(baseRaw, 'spikeClip', { type: 'clipping', end: endSlotName, vertexCount: 4, vertices: clipPts.slice(), color: 'ce3a3aff' });
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'loader REJECTED clipping — ' + e.message); }
	if (data) {
		const att = getAtt(data, 'spikeClip');
		log(!!att && att.constructor.name === 'ClippingAttachment', `built a ClippingAttachment (${att && att.constructor.name})`);
		if (att) {
			log(att.worldVerticesLength === 8, `worldVerticesLength == vertexCount*2 (${att.worldVerticesLength})`);
			log(!!att.endSlot && att.endSlot.name === endSlotName, `end "${endSlotName}" resolved → endSlot "${att.endSlot && att.endSlot.name}"`);
		}
	}
}
// clipping default: omitted `end` → endSlot null (no throw)
{
	const raw = withAttachment(baseRaw, 'spikeClipNoEnd', { type: 'clipping', vertexCount: 4, vertices: clipPts.slice() });
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'clipping w/o end REJECTED — ' + e.message); }
	if (data) {
		const att = getAtt(data, 'spikeClipNoEnd');
		log(att && (att.endSlot === null || att.endSlot === undefined), `omitted end → endSlot null (got ${att && att.endSlot})`);
	}
}

// =================================================================================================
// LINKED MESH
// =================================================================================================
console.log('\n  ── LINKED MESH ───────────────────────────────────────');
// the source mesh needs a real atlas region (AtlasAttachmentLoader.newMeshAttachment resolves
// `path` against the atlas). Parse the first REGION name (a name line followed by a `bounds:`/`xy:`
// line — page-header lines like the .webp are followed by `size:`). The linkedmesh itself needs no
// region (it inherits the parent's via setParentMesh).
const atlasRegion = (() => {
	const lines = atlasText.split(/\r?\n/);
	for (let i = 0; i < lines.length - 1; i++) {
		const nm = lines[i].trim();
		const next = lines[i + 1].trim();
		if (nm && !nm.includes(':') && (next.startsWith('bounds:') || next.startsWith('xy:'))) return nm;
	}
	return 'dust1';
})();
{
	// Build a REAL source mesh on the host slot in the host skin, then a linkedmesh that references
	// it (in the SAME skin — same slot index — so the loader's post-load resolve succeeds).
	const srcMesh = {
		type: 'mesh',
		path: atlasRegion,
		uvs: [0, 0, 1, 0, 1, 1, 0, 1],
		triangles: [0, 1, 2, 0, 2, 3],
		vertices: [-40, -40, 40, -40, 40, 40, -40, 40],
		hull: 4,
		width: 80, height: 80,
	};
	let raw = withAttachment(baseRaw, 'srcMesh', srcMesh);
	// ⚠ a linkedmesh STILL goes through newMeshAttachment, which resolves its OWN `path` (default =
	// name) against the atlas BEFORE the deferred parent-resolve. So it MUST carry a `path` pointing
	// at the same region as its parent (Spine editor always exports this). Omitting path → name
	// "spikeLinked" → "Region not found".
	raw = withAttachment(raw, 'spikeLinked', { type: 'linkedmesh', path: atlasRegion, parent: 'srcMesh', skin: skinName, timelines: true, width: 80, height: 80 });
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'loader REJECTED linkedmesh — ' + e.message); }
	if (data) {
		const parent = getAtt(data, 'srcMesh');
		const linked = getAtt(data, 'spikeLinked');
		log(!!linked && linked.constructor.name === 'MeshAttachment', `built a MeshAttachment for linkedmesh (${linked && linked.constructor.name})`);
		if (linked && parent) {
			log(linked.getParentMesh() === parent, `parent mesh resolved (setParentMesh → "${linked.getParentMesh() && linked.getParentMesh().name}")`);
			log(linked.vertices === parent.vertices && linked.triangles === parent.triangles, 'shares parent vertices + triangles (geometry inherited)');
			log(linked.worldVerticesLength === parent.worldVerticesLength, `shares worldVerticesLength (${linked.worldVerticesLength})`);
			// timelines:true ⇒ deform timelines target the PARENT (inheritTimeline)
			log(linked.timelineAttachment === parent, 'timelines:true → timelineAttachment == parent (deform-inherit)');
		}
	}
}
// linkedmesh timelines:false ⇒ own deform (timelineAttachment == self)
{
	const srcMesh = { type: 'mesh', path: atlasRegion, uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], vertices: [0, 0, 20, 0, 20, 20], hull: 3 };
	let raw = withAttachment(baseRaw, 'srcMesh2', srcMesh);
	raw = withAttachment(raw, 'spikeLinked2', { type: 'linkedmesh', path: atlasRegion, parent: 'srcMesh2', timelines: false });
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'linkedmesh timelines:false REJECTED — ' + e.message); }
	if (data) {
		const linked = getAtt(data, 'spikeLinked2');
		log(linked && linked.timelineAttachment === linked, 'timelines:false → timelineAttachment == self (own deform)');
		log(linked && linked.getParentMesh() && linked.getParentMesh().name === 'srcMesh2', `default skin (omitted skin) resolves parent (${linked && linked.getParentMesh() && linked.getParentMesh().name})`);
	}
}
// linkedmesh with a MISSING parent ⇒ loader throws
{
	const raw = withAttachment(baseRaw, 'spikeLinkedBad', { type: 'linkedmesh', path: atlasRegion, parent: '__nope__' });
	let msg = '';
	try { loadData(raw); } catch (e) { msg = e.message; }
	log(/Parent mesh not found/.test(msg), `missing parent → loader throws "Parent mesh not found" (got "${msg}")`);
}

// =================================================================================================
// PARITY — base skeleton round-trips and carries no spike attachments
// =================================================================================================
console.log('\n  ── PARITY ────────────────────────────────────────────');
{
	loadData(baseRaw);
	const names = ['spikePoint', 'spikePointDef', 'spikeBox', 'spikeClip', 'spikeClipNoEnd', 'srcMesh', 'spikeLinked', 'srcMesh2', 'spikeLinked2', 'spikeLinkedBad'];
	const clean = (baseRaw.skins || []).every((s) => !s.attachments || Object.values(s.attachments).every((slotAtts) => names.every((nm) => !(nm in slotAtts))));
	log(clean, 'base skeleton carries no spike attachment (parity)');
}

console.log(pass
	? '\n✅ PASS — point {x,y,rotation,color?} (scalars, NOT a vertex list) → PointAttachment w/ computeWorldPosition+computeWorldRotation; boundingbox {vertexCount,vertices(packed like mesh),color?} → BoundingBoxAttachment w/ computeWorldVertices polygon; clipping {end:slotName,vertexCount,vertices,color?} → ClippingAttachment w/ endSlot resolved (omitted end → null); linkedmesh {parent:meshName, skin?:default-null, timelines?:true→inheritDeform, width?,height?} (or "mesh"+parent) → deferred MeshAttachment, post-load setParentMesh shares parent vertices/triangles/UVs/worldVerticesLength; timelines true⇒timelineAttachment=parent, false⇒self; missing parent throws.'
	: '\n✗ FAIL');
process.exit(pass ? 0 : 1);
