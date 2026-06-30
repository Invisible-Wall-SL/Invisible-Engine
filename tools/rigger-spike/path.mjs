// Phase §18 item 7 spike (GATE) — nail the Spine 4.2 PATH ATTACHMENT + PATH CONSTRAINT setup
// + the path animation timeline data model against the official runtime, before any UI is built.
//   node tools/rigger-spike/path.mjs <skeleton.json> <skeleton.atlas>
//
// ============================ EMPIRICAL FINDINGS ============================
// (validated below against @esotericsoftware/spine-core@4.2.74's SkeletonJson loader,
//  PathAttachment, PathConstraint(Data), and the three PathConstraint*Timelines — NOT from
//  memory. Read off SkeletonJson.js: attachment L428-444, constraint L187-219, timeline
//  L815-868, readTimeline1 L1072, readCurve L1120. Cross-checked vs a REAL rig
//  (apps/cluster/.../anticipation.json) which ships 12 path constraints + 2 path attachments
//  + a `path.<name>.position` timeline per constraint.)
//
// ── PATH ATTACHMENT (a slot attachment, lives in a skin like mesh/region) ──────────────────
//   skins.<skin>.attachments.<slot>.<name> = {
//     type: "path",
//     closed:        false,   // bool, default false — is the spline a closed loop
//     constantSpeed: true,    // bool, default TRUE — even arc-length spacing
//     vertexCount:   N,       // int — number of spline CONTROL POINTS (cubic bezier handles).
//                             //   A path is a chain of CUBIC curves; control points run
//                             //   [p0, c0a, c0b, p1, c1a, c1b, p2, …]. #curves = vertexCount/3.
//                             //   closed paths wrap (last curve returns to p0).
//     vertices:      [...],   // the control-point geometry, EXACTLY the VertexAttachment packed
//                             //   format (same as mesh): UNWEIGHTED ⇒ flat [x,y, x,y, …] of
//                             //   length vertexCount*2 (slot-bone-local); WEIGHTED ⇒ packed
//                             //   [boneCount, boneIdx,vx,vy,weight, …] per control point. The
//                             //   loader picks unweighted iff vertices.length == vertexCount*2.
//     lengths:       [...],   // REQUIRED — one float PER CUBIC CURVE ⇒ length == vertexCount/3.
//                             //   Per-curve arc length (px, * skeleton scale). Spine editor bakes
//                             //   these; we recompute them from the control points on save.
//     color?:        "RRGGBBAA",  // optional editor display colour (paths aren't textured).
//   }
//   computeWorldVertices(slot, 0, vertexCount*2, out, 0, 2) yields the control points in WORLD
//   space (the spline polyline the constraint walks).
//
// ── PATH CONSTRAINT (top-level `path` array → skeletonData.pathConstraints) ─────────────────
//   rawDoc.path = [{
//     name,                    // unique (required)
//     order: 0,                // int, default 0 — solve order across ALL constraints
//     skin: false,             // bool, default false (→ data.skinRequired)
//     bones: [boneName, …],    // 1+ CONSTRAINED bone NAMES — laid out ALONG the path (required)
//     target: <SLOT name>,     // ⚠ a SLOT name (the slot holding the path attachment), NOT a bone
//     positionMode: "percent", // "fixed" | "percent"          (default "percent") — enumValue
//     spacingMode:  "length",  // "length"|"fixed"|"percent"|"proportional" (default "length")
//     rotateMode:   "tangent", // "tangent"|"chain"|"chainScale"           (default "tangent")
//     position: 0,             // along-path position (Fixed ⇒ * scale)
//     spacing:  0,             // bone spacing (Length|Fixed ⇒ * scale)
//     rotation: 0,             // → data.offsetRotation (degrees), default 0
//     mixRotate: 1, mixX: 1, mixY: 1,  // 0..1 mix, ALL DEFAULT 1; absent mixY falls back to mixX.
//   }, …]
//   ⚠ ENUM STRINGS are case-INSENSITIVE on the first letter: enumValue() does
//   `name[0].toUpperCase()+name.slice(1)`, so "percent"/"Percent" both → PositionMode.Percent.
//   Spine editor exports lowercase ("percent","length","tangent","chainScale"); we author lower.
//   ⚠ path constraints have ONLY mixRotate/mixX/mixY — NO mixScale*/mixShear* (unlike transform).
//   BEHAVIOUR (verified): a constrained bone is repositioned ONTO the path (world pos changes vs
//   unconstrained). All mixes 0 ⇒ pose == setup/FK (constraint contributes nothing).
//
// ── PATH ANIMATION TIMELINE — animations.<a>.path.<name> = { <channel>: [keys] } ─────────────
//   THREE INDEPENDENT sub-timelines (NOT one combined key list):
//     • "position": [{ time, value, curve? }]  — readTimeline1, single channel.
//                   value default 0; Fixed positionMode ⇒ value * scale. curve = ONE
//                   [cx1,cy1,cx2,cy2] (channel 0) or "stepped".
//     • "spacing":  [{ time, value, curve? }]  — readTimeline1, single channel.
//                   value default 0; Length|Fixed spacingMode ⇒ value * scale.
//     • "mix":      [{ time, mixRotate, mixX, mixY, curve? }] — PathConstraintMixTimeline.
//                   each mix default 1 (mixY→mixX). The shared `curve` drives THREE bezier
//                   channels in order 0=mixRotate 1=mixX 2=mixY ⇒ a FLAT 12-number curve
//                   ([cx1,cy1,cx2,cy2] PER channel), or "stepped". A single 4-number curve only
//                   feeds channel 0; channels 1-2 read undefined → NaN. So bake one shared ease
//                   across all three (per-channel value handles in absolute value-space).
//   poseAtTime preview reads the live PathConstraint.{position,spacing,mixRotate,mixX,mixY} that
//   the runtime sets at time t, before updateWorld.
import { readFileSync, existsSync } from 'node:fs';

const SPINE = '.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js';
// resolve spine-core from the nearest node_modules up the tree (worktrees may lack their own)
let CORE = null;
for (let up = 2; up <= 8; up++) {
	const cand = new URL('../'.repeat(up) + 'node_modules/' + SPINE, import.meta.url);
	if (existsSync(cand)) { CORE = cand; break; }
}
if (!CORE) throw new Error('spine-core@4.2.74 not found in any ancestor node_modules');
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics, MixBlend, MixDirection } = await import(CORE.href);

const [, , jsonPath, atlasPath] = process.argv;
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
console.log(`\n=== §18.7 path attachment + path-constraint setup + path timeline → official runtime: ${jsonPath} ===`);

// ---------------------------------------------------------------------------------------------
// Build a SYNTHETIC open path attachment (2 cubic curves = 7 control points = vertexCount 7)
// in slot-bone-local space, in the FIRST skin, on a real slot. control points run
// [p0, c0a, c0b, p1, c1a, c1b, p2]. We place them as a gentle S so the spline is non-degenerate.
// lengths == ceil/floor? NO — vertexCount/3 must be an INTEGER, so vertexCount is a multiple of 3
// for a CLOSED path and (3*curves+1) for an OPEN path. Spine stores OPEN paths with vertexCount =
// 3*curves+1 BUT lengths.length = vertexCount/3 (integer division → floor). Real anticipation rig:
// vertexCount 18 (=3*6, closed-style packing) lengths 6. We mirror that: use vertexCount that is a
// multiple of 3 (closed=true OR open with editor's 3*curves+1 → here we use the multiple-of-3 form
// which both real rigs use) so lengths.length = vertexCount/3 is exact.
const skinName = (baseRaw.skins && baseRaw.skins[0] && baseRaw.skins[0].name) || 'default';
// Host slot: one with a bone that is NOT already a path-constraint target (we repurpose its setup
// attachment to our synthetic path). Constrained bone (below) must differ from the host bone.
const existingTargets = new Set((baseRaw.path || []).map((c) => c.target));
const hostSlot = (baseRaw.slots && baseRaw.slots.find((s) => s.bone && !existingTargets.has(s.name))) || (baseRaw.slots && baseRaw.slots.find((s) => s.bone));
if (!hostSlot) { console.log('  (no slot with a bone — cannot host a path attachment)'); process.exit(1); }
const slotName = hostSlot.name;
console.log(`  host skin="${skinName}" slot="${slotName}" (bone ${hostSlot.bone})`);

// 6 control points = a multiple of 3 → 2 curves (closed wraps last→first). Local coords.
const ctrlPts = [
	0, 0,      // p0
	40, 60,    // c0a
	80, 60,    // c0b
	120, 0,    // p1  (also end of curve 0 / start of curve 1)
	160, -60,  // c1a
	200, -60,  // c1b
];
const VC = ctrlPts.length / 2; // 6
function makePathAttachment(extra) {
	// lengths: vertexCount/3 per-curve arc lengths (rough straight-segment estimate is fine for
	// the loader — it just stores them; the runtime recomputes when constantSpeed needs it).
	const lengths = [];
	for (let c = 0; c < VC / 3; c++) lengths.push(100 + c * 50);
	return Object.assign({ type: 'path', closed: true, constantSpeed: true, vertexCount: VC, vertices: ctrlPts.slice(), lengths }, extra);
}
function withPathAttachment(raw, attName) {
	const r = clone(raw);
	r.skins = r.skins || [{ name: 'default', attachments: {} }];
	const skin = r.skins.find((s) => s.name === skinName) || r.skins[0];
	skin.attachments = skin.attachments || {};
	skin.attachments[slotName] = skin.attachments[slotName] || {};
	skin.attachments[slotName][attName] = makePathAttachment({});
	// ⚠ A path constraint is only ACTIVE when its TARGET SLOT's CURRENT attachment is a
	// PathAttachment. Point the host slot's setup attachment at our path so the constraint solves.
	const slotDef = r.slots.find((s) => s.name === slotName);
	if (slotDef) slotDef.attachment = attName;
	return r;
}

// (1) loader builds a PathAttachment + computeWorldVertices yields the control points
{
	const raw = withPathAttachment(baseRaw, 'spikePath');
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'loader REJECTED path attachment — ' + e.message); }
	if (data) {
		const slotIndex = data.slots.findIndex((s) => s.name === slotName);
		const skin = data.findSkin(skinName) || data.defaultSkin;
		const att = skin.getAttachment(slotIndex, 'spikePath');
		log(!!att && att.constructor.name === 'PathAttachment', `built a PathAttachment (${att && att.constructor.name})`);
		if (att) {
			log(att.closed === true && att.constantSpeed === true, `closed=${att.closed} constantSpeed=${att.constantSpeed}`);
			log(att.worldVerticesLength === VC * 2, `worldVerticesLength == vertexCount*2 (${att.worldVerticesLength})`);
			log(att.lengths.length === VC / 3, `lengths.length == vertexCount/3 (${att.lengths.length})`);
			const sk = new Skeleton(data);
			sk.setToSetupPose();
			try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }
			const slot = sk.slots[slotIndex];
			slot.setAttachment(att);
			const out = new Array(att.worldVerticesLength).fill(0);
			att.computeWorldVertices(slot, 0, att.worldVerticesLength, out, 0, 2);
			// the spread of control points should be non-zero (matches our S-shape extent)
			const xs = out.filter((_, i) => i % 2 === 0), ys = out.filter((_, i) => i % 2 === 1);
			const spanX = Math.max(...xs) - Math.min(...xs), spanY = Math.max(...ys) - Math.min(...ys);
			log(spanX > 50 && spanY > 50, `computeWorldVertices spans the control points (Δx ${spanX.toFixed(1)}, Δy ${spanY.toFixed(1)})`);
		}
	}
}

// (2) defaults: closed false / constantSpeed true when omitted
{
	const raw = clone(baseRaw);
	const skin = (raw.skins = raw.skins || [{ name: 'default', attachments: {} }]).find((s) => s.name === skinName) || raw.skins[0];
	skin.attachments = skin.attachments || {};
	skin.attachments[slotName] = skin.attachments[slotName] || {};
	skin.attachments[slotName].spikePathDef = { type: 'path', vertexCount: VC, vertices: ctrlPts.slice(), lengths: [100, 150] };
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'minimal path attachment REJECTED — ' + e.message); }
	if (data) {
		const slotIndex = data.slots.findIndex((s) => s.name === slotName);
		const att = (data.findSkin(skinName) || data.defaultSkin).getAttachment(slotIndex, 'spikePathDef');
		log(att && att.closed === false && att.constantSpeed === true, `omitted closed/constantSpeed → defaults false/true (got ${att && att.closed}/${att && att.constantSpeed})`);
	}
}

// ---------------------------------------------------------------------------------------------
// PATH CONSTRAINT setup. constrained bone = a non-root bone distinct from the host slot's bone
// and not already driven by an existing path constraint (so the move is cleanly observable).
const drivenBones = new Set((baseRaw.path || []).flatMap((c) => c.bones));
const constrainedBone = (baseRaw.bones.find((b) => b.name !== 'root' && b.parent && b.name !== hostSlot.bone && !drivenBones.has(b.name))
	|| baseRaw.bones.find((b) => b.name !== 'root' && b.parent) || baseRaw.bones[1] || baseRaw.bones[0]).name;
console.log(`  constrained bone="${constrainedBone}"  target slot="${slotName}"`);

function poseBoneWorld(raw, animName, boneName, t) {
	const data = loadData(raw);
	const sk = new Skeleton(data);
	sk.setToSetupPose();
	if (animName) data.findAnimation(animName).apply(sk, 0, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
	try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }
	const b = sk.findBone(boneName);
	return { x: b.worldX, y: b.worldY };
}

// ⚠ CRUX: `order` MUST be a contiguous index in [0, totalConstraintCount). Skeleton.updateCache
// loops i=0..constraintCount-1 and only sorts a constraint whose data.order==i; an out-of-range
// order (e.g. 999) is NEVER sorted, so its `active` stays false and NO timeline applies. The next
// free order = the count of ALL constraints already present (ik+transform+path+physics).
const totalConstraints = (raw) => (raw.ik || []).length + (raw.transform || []).length + (raw.path || []).length + (raw.physics || []).length;
function buildPc(raw, extra) {
	return Object.assign({ name: 'spikePc', order: totalConstraints(raw), bones: [constrainedBone], target: slotName,
		positionMode: 'percent', spacingMode: 'length', rotateMode: 'tangent',
		position: 0, spacing: 50, mixRotate: 1, mixX: 1, mixY: 1 }, extra);
}
// APPEND the spike constraint to any pre-existing `path` array (some rigs already ship path
// constraints whose animations reference them — replacing would orphan those timelines).
const withPc = (raw, mkExtra) => { raw.path = (raw.path || []).filter((c) => c.name !== 'spikePc'); raw.path.push(buildPc(raw, mkExtra || {})); return raw; };

const unconstrained = poseBoneWorld(baseRaw, null, constrainedBone, 0);

// (3) loader builds PathConstraintData with the right defaults + enum parsing
{
	const raw = withPc(withPathAttachment(baseRaw, slotName), {}); // att name == slot name (Spine convention)
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'loader REJECTED path constraint — ' + e.message); }
	if (data) {
		log(data.pathConstraints.length >= 1, `loader built ${data.pathConstraints.length} PathConstraintData`);
		const d = data.pathConstraints.find((c) => c.name === 'spikePc');
		log(d && d.bones.length === 1 && d.target && d.target.name === slotName, `constraint has bone + target SLOT "${d && d.target && d.target.name}"`);
		// enums: Percent=1, Length=0, Tangent=0 (read off enums); just assert the resolved mix defaults
		log(d.mixRotate === 1 && d.mixX === 1 && d.mixY === 1, `mixes default to 1 (rot${d.mixRotate} x${d.mixX} y${d.mixY})`);
		log(d.positionMode === 1, `positionMode "percent" → Percent (${d.positionMode})`);
		log(d.spacingMode === 0, `spacingMode "length" → Length (${d.spacingMode})`);
		log(d.rotateMode === 0, `rotateMode "tangent" → Tangent (${d.rotateMode})`);
	}
}

// (3b) enum string parsing — "chainScale" / "proportional" / "fixed" accepted
{
	const raw = withPc(withPathAttachment(baseRaw, slotName), { positionMode: 'fixed', spacingMode: 'proportional', rotateMode: 'chainScale' });
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'enum strings REJECTED — ' + e.message); }
	if (data) {
		const d = data.pathConstraints.find((c) => c.name === 'spikePc');
		log(d.positionMode === 0 && d.spacingMode === 3 && d.rotateMode === 2, `fixed/proportional/chainScale → ${d.positionMode}/${d.spacingMode}/${d.rotateMode} (want 0/3/2)`);
	}
}

// (4) the constraint APPLIES — constrained bone is repositioned onto the path (world pos changes)
{
	const raw = withPc(withPathAttachment(baseRaw, slotName), { mixRotate: 1, mixX: 1, mixY: 1 });
	const constrained = poseBoneWorld(raw, null, constrainedBone, 0);
	const moved = Math.hypot(constrained.x - unconstrained.x, constrained.y - unconstrained.y);
	log(moved > 0.5, `mixX/Y=1 REPOSITIONS the bone onto the path (world moved ${moved.toFixed(2)}px vs unconstrained)`);
}

// (5) all mixes 0 → pose == setup/FK (constraint contributes nothing)
{
	const raw = withPc(withPathAttachment(baseRaw, slotName), { mixRotate: 0, mixX: 0, mixY: 0 });
	const fk = poseBoneWorld(raw, null, constrainedBone, 0);
	const drift = Math.hypot(fk.x - unconstrained.x, fk.y - unconstrained.y);
	log(drift < 0.05, `all mixes=0 → pose == setup/FK (world drift ${drift.toFixed(4)})`);
}

// ---------------------------------------------------------------------------------------------
// PATH TIMELINE tests. Read the LIVE PathConstraint field the runtime sets at time t.
const pcFieldAt = (raw, animName, field, t) => {
	const data = loadData(raw);
	const sk = new Skeleton(data);
	sk.setToSetupPose();
	data.findAnimation(animName).apply(sk, 0, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
	return sk.pathConstraints.find((c) => c.data.name === 'spikePc')[field];
};

function pathTimelineRaw(channels) {
	const raw = withPc(withPathAttachment(baseRaw, slotName), {});
	raw.animations = raw.animations || {};
	raw.animations.spikePathAnim = { path: { spikePc: channels } };
	return raw;
}

// (6) position timeline: value 0 → 80, linear @0.5 == 40
{
	const raw = pathTimelineRaw({ position: [{ time: 0, value: 0 }, { time: 1, value: 80 }] });
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'position timeline REJECTED — ' + e.message); }
	if (data) {
		const anim = data.findAnimation('spikePathAnim');
		log(anim && anim.timelines.some((tl) => tl.constructor.name.includes('PathConstraintPosition')), `parsed a PathConstraintPositionTimeline (${anim ? anim.timelines.map((tl) => tl.constructor.name).join(',') : '—'})`);
		const mid = pcFieldAt(raw, 'spikePathAnim', 'position', 0.5);
		log(Math.abs(mid - 40) < 1e-3, `position linear @0.5 == 40 (${mid.toFixed(3)})`);
	}
}

// (7) spacing timeline: value 10 → 90, linear @0.5 == 50
{
	const raw = pathTimelineRaw({ spacing: [{ time: 0, value: 10 }, { time: 1, value: 90 }] });
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'spacing timeline REJECTED — ' + e.message); }
	if (data) {
		const anim = data.findAnimation('spikePathAnim');
		log(anim && anim.timelines.some((tl) => tl.constructor.name.includes('PathConstraintSpacing')), `parsed a PathConstraintSpacingTimeline`);
		const mid = pcFieldAt(raw, 'spikePathAnim', 'spacing', 0.5);
		log(Math.abs(mid - 50) < 1e-3, `spacing linear @0.5 == 50 (${mid.toFixed(3)})`);
	}
}

// (8) mix timeline: mixRotate/X/Y 0 → 1, linear @0.5 == 0.5 across all three channels
{
	const raw = pathTimelineRaw({ mix: [
		{ time: 0, mixRotate: 0, mixX: 0, mixY: 0 },
		{ time: 1, mixRotate: 1, mixX: 1, mixY: 1 },
	] });
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'mix timeline REJECTED — ' + e.message); }
	if (data) {
		const anim = data.findAnimation('spikePathAnim');
		log(anim && anim.timelines.some((tl) => tl.constructor.name.includes('PathConstraintMix')), `parsed a PathConstraintMixTimeline`);
		const r = pcFieldAt(raw, 'spikePathAnim', 'mixRotate', 0.5);
		const x = pcFieldAt(raw, 'spikePathAnim', 'mixX', 0.5);
		const y = pcFieldAt(raw, 'spikePathAnim', 'mixY', 0.5);
		log(Math.abs(r - 0.5) < 1e-4 && Math.abs(x - 0.5) < 1e-4 && Math.abs(y - 0.5) < 1e-4, `mix linear @0.5 == 0.5 all channels (rot${r.toFixed(3)} x${x.toFixed(3)} y${y.toFixed(3)})`);
	}
}

// (9) position bezier ease-in (one 4-number curve) — value VALUE@0.5 sub-linear & matches evaluator
const bezierValue = (t1, p1, cx1, cy1, cx2, cy2, t2, p2, t) => {
	if (t <= t1) return p1; if (t >= t2) return p2;
	const X = (s) => { const u = 1 - s; return u * u * u * t1 + 3 * u * u * s * cx1 + 3 * u * s * s * cx2 + s * s * s * t2; };
	const Y = (s) => { const u = 1 - s; return u * u * u * p1 + 3 * u * u * s * cy1 + 3 * u * s * s * cy2 + s * s * s * p2; };
	let lo = 0, hi = 1; for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (X(m) < t) lo = m; else hi = m; }
	return Y((lo + hi) / 2);
};
{
	// single-channel curve in ABSOLUTE space: x in time, y in value. ease-in [.42,0, 1,1] baked.
	const t1 = 0, t2 = 1, v1 = 0, v2 = 80;
	const F = [0.42, 0, 1, 1];
	const curve = [t1 + (t2 - t1) * F[0], v1 + (v2 - v1) * F[1], t1 + (t2 - t1) * F[2], v1 + (v2 - v1) * F[3]];
	const raw = pathTimelineRaw({ position: [{ time: t1, value: v1, curve }, { time: t2, value: v2 }] });
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'bezier position timeline REJECTED — ' + e.message); }
	if (data) {
		const runtime = pcFieldAt(raw, 'spikePathAnim', 'position', 0.5);
		const pred = bezierValue(t1, v1, curve[0], curve[1], curve[2], curve[3], t2, v2, 0.5);
		log(pred < 40, `our position bezier evaluator ease-in @0.5 = ${pred.toFixed(2)} (< 40)`);
		log(Math.abs(runtime - pred) < 0.5, `runtime bezier position @0.5 ${runtime.toFixed(2)} ≈ our evaluator ${pred.toFixed(2)}`);
	}
}

// (10) mix bezier SHARED across all 3 channels (12-number curve) — each channel eases identically
{
	const t1 = 0, t2 = 1;
	const chans = ['mixRotate', 'mixX', 'mixY'];
	const k0 = { time: t1, mixRotate: 0, mixX: 0, mixY: 0 };
	const k1 = { time: t2, mixRotate: 1, mixX: 1, mixY: 1 };
	const F = [0.42, 0, 1, 1];
	const curve = [];
	chans.forEach((ch, vi) => {
		const va = k0[ch], vb = k1[ch], dv = vb - va;
		curve[vi * 4 + 0] = t1 + (t2 - t1) * F[0];
		curve[vi * 4 + 1] = va + dv * F[1];
		curve[vi * 4 + 2] = t1 + (t2 - t1) * F[2];
		curve[vi * 4 + 3] = va + dv * F[3];
	});
	k0.curve = curve;
	const raw = pathTimelineRaw({ mix: [k0, k1] });
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'bezier mix timeline REJECTED — ' + e.message); }
	if (data) {
		const pred = bezierValue(0, 0, 0.42, 0, 1, 1, 1, 1, 0.5);
		const r = pcFieldAt(raw, 'spikePathAnim', 'mixRotate', 0.5);
		const x = pcFieldAt(raw, 'spikePathAnim', 'mixX', 0.5);
		const y = pcFieldAt(raw, 'spikePathAnim', 'mixY', 0.5);
		log(pred < 0.5, `our mix bezier evaluator ease-in @0.5 = ${pred.toFixed(3)} (< 0.5)`);
		log(Math.abs(r - pred) < 0.02 && Math.abs(x - pred) < 0.02 && Math.abs(y - pred) < 0.02, `shared 12-num curve eases all 3 mix channels identically @0.5 (rot${r.toFixed(3)} x${x.toFixed(3)} y${y.toFixed(3)} ≈ ${pred.toFixed(3)})`);
	}
}

// ---------------------------------------------------------------------------------------------
// (11) PARITY — the base skeleton round-trips and carries no spike path artefacts.
{
	loadData(baseRaw);
	const noAtt = (baseRaw.skins || []).every((s) => !s.attachments || !s.attachments[slotName] || (!s.attachments[slotName].spikePath && !s.attachments[slotName].spikePathDef));
	log(noAtt, 'base skeleton carries no spike path attachment (parity)');
	log((baseRaw.path || []).every((c) => c.name !== 'spikePc'), 'base skeleton carries no spike path constraint (parity)');
}

console.log(pass
	? '\n✅ PASS — path attachment ({type:path, closed(false)/constantSpeed(true), vertexCount, vertices[packed like mesh], lengths[vertexCount/3]}) builds + computeWorldVertices yields the control points; path constraint (top-level `path`: bones[]/target=SLOT/positionMode(percent)/spacingMode(length)/rotateMode(tangent)/position/spacing/rotation/mix{Rotate,X,Y}=1, enums case-insensitive first letter) loads + REPOSITIONS the bone (all-mix-0==FK); path timeline (animations.<a>.path.<name> = {position:[{time,value,curve}], spacing:[{time,value,curve}], mix:[{time,mixRotate,mixX,mixY,curve}]} — position/spacing single-channel curve, mix shared 12-num curve ch 0=mixRotate 1=mixX 2=mixY) interpolates linear + bezier matching the runtime.'
	: '\n✗ FAIL');
process.exit(pass ? 0 : 1);
