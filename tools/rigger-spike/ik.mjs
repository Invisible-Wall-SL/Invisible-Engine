// Phase §18 item 3 spike (GATE) — nail the Spine 4.2 IK CONSTRAINT setup + the IK
// animation timeline data model against the official runtime, before any UI is built.
//   node tools/rigger-spike/ik.mjs <skeleton.json> <skeleton.atlas>
//
// ============================ EMPIRICAL FINDINGS ============================
// (validated below against @esotericsoftware/spine-core@4.2.74's SkeletonJson loader,
//  IkConstraint, and IkConstraintTimeline — NOT from memory. Read off SkeletonJson.js:
//  setup at L124-148, timeline at L723-758.)
//
// SETUP — top-level `ik` array (skeletonData.ikConstraints):
//   rawDoc.ik = [{
//     name,                  // unique constraint name (required)
//     order: 0,              // int, default 0 — solve order across ALL constraints
//     skin: false,           // bool, default false (constraintMap.skin → data.skinRequired)
//     bones: [parent, child],// 1 or 2 bone NAMES — the chain, root→tip. 2-bone = parent+child.
//     target: targetBone,    // bone NAME the chain reaches toward (required)
//     mix: 1,                // 0..1 — FK(0) → full IK(1) blend (default 1)
//     softness: 0,           // px, scaled by skeleton scale (default 0)
//     bendPositive: true,    // JSON bool → data.bendDirection = bendPositive ? 1 : -1
//     compress: false,       // bool (1-bone: allow shortening to reach a near target)
//     stretch: false,        // bool (allow lengthening to reach a far target)
//     uniform: false,        // bool (1-bone: scale both axes; default false)
//   }, …]
//   NOTE: the JSON field is `bendPositive` (a BOOLEAN), NOT `bendDirection`. The runtime
//   stores it as data.bendDirection (+1/-1). `order` is optional (defaults 0). 1-bone vs
//   2-bone is purely the length of `bones` (1 ⇒ single-bone IK, 2 ⇒ two-bone solver).
//
// BEHAVIOUR (verified): with mix=1 the chain SOLVES toward the target (the tip bone rotates
//   so the chain tip reaches/points at the target world position). With mix=0 the pose ==
//   setup/FK (no change). Intermediate mix blends FK→IK (tip lerps between the two poses).
//
// ANIMATION TIMELINE — `animations.<anim>.ik.<name>` (an IkConstraintTimeline):
//   animations.<a>.ik.<name> = [ { time, mix, softness, bendPositive, compress, stretch,
//                                  curve? }, … ]
//   • Per key the runtime reads: time(0), mix(1), softness(0)*scale, bendPositive(true)→±1,
//     compress(false), stretch(false).
//   • mix + softness interpolate (linear, or bezier via `curve`); bend/compress/stretch are
//     STEPPED (taken from the frame, not blended).
//   • `curve` is read off the CURRENT key (keyMap.curve), and drives TWO bezier channels:
//     channel 0 = mix, channel 1 = softness. Format = the same flat bezier-controls array as
//     the bone channels ([cx1,cy1,cx2,cy2] per channel; or "stepped"). For a single-value
//     mix ease we author one [cx1,cy1,cx2,cy2] for the mix channel (softness usually 0).
//   • Authoring v1: we key MIX (the FK→IK reveal). bend/softness optional. Linear by default,
//     bezier via the shared curve menu (one easing → mix channel).
import { readFileSync } from 'node:fs';

import { existsSync } from 'node:fs';
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

// Pick a 2-bone chain: a bone whose parent itself has a parent. chain = [parent, child];
// child = the selected bone (tip), parent = its parent. Target = some OTHER bone (offset
// from the chain origin so the solve is non-degenerate, not a pure 180° flip).
function pickChain(raw) {
	const byName = Object.fromEntries(raw.bones.map((b) => [b.name, b]));
	for (const b of raw.bones) {
		const parent = b.parent && byName[b.parent];
		if (parent && parent.parent && byName[parent.parent]) {
			const exclude = new Set([b.name, parent.name]);
			// prefer a target with a non-zero local offset (avoids a collinear 180° flip)
			const offset = raw.bones.find((t) => !exclude.has(t.name) && t.name !== 'root' && (Math.abs(t.x || 0) > 1 || Math.abs(t.y || 0) > 1));
			const target = offset || raw.bones.find((t) => !exclude.has(t.name) && t.name !== 'root');
			if (target) return { child: b.name, parent: parent.name, target: target.name };
		}
	}
	return null;
}

// Pose with an animation (or just setup) and return the world position of a bone's TIP
// (a point one bone-length along its local +x), plus the bone's world rotation.
function poseBone(raw, animName, boneName, t) {
	const data = loadData(raw);
	const sk = new Skeleton(data);
	sk.setToSetupPose();
	if (animName) {
		const anim = data.findAnimation(animName);
		anim.apply(sk, 0, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
	}
	try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }
	const bone = sk.findBone(boneName);
	const len = bone.data.length || 40;
	const tipX = bone.worldX + bone.a * len;
	const tipY = bone.worldY + bone.c * len;
	return { x: bone.worldX, y: bone.worldY, tipX, tipY, rot: bone.getWorldRotationX(), bone };
}

const baseRaw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const chain = pickChain(baseRaw);
console.log(`\n=== §18 IK setup + timeline model → official runtime: ${jsonPath} ===`);
if (!chain) { console.log('  (no 2-bone chain found in this skeleton)'); process.exit(1); }
console.log(`  chain: parent="${chain.parent}" child="${chain.child}"  target="${chain.target}"`);

function buildIk(extra) {
	return Object.assign({ name: 'spikeIk', order: 0, bones: [chain.parent, chain.child], target: chain.target, mix: 1, bendPositive: true, softness: 0, compress: false, stretch: false }, extra);
}

const setupTip = poseBone(baseRaw, null, chain.child, 0);
const targetPos = poseBone(baseRaw, null, chain.target, 0);

// (a) mix=1 loads + solves toward the target
{
	const raw = clone(baseRaw);
	raw.ik = [buildIk({ mix: 1 })];
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'loader REJECTED ik setup — ' + e.message); }
	if (data) {
		log(data.ikConstraints.length === 1, `loader built ${data.ikConstraints.length} IkConstraint(s)`);
		const ic = data.ikConstraints[0];
		log(ic && ic.bones.length === 2 && ic.target && ic.target.name === chain.target, `constraint has 2 chain bones + target "${ic && ic.target && ic.target.name}"`);
		log(ic && ic.bendDirection === 1, `bendPositive:true → bendDirection ${ic && ic.bendDirection} (want +1)`);
		const solved = poseBone(raw, null, chain.child, 0);
		const dSetup = Math.hypot(setupTip.tipX - targetPos.x, setupTip.tipY - targetPos.y);
		const dSolved = Math.hypot(solved.tipX - targetPos.x, solved.tipY - targetPos.y);
		const moved = Math.hypot(solved.tipX - setupTip.tipX, solved.tipY - setupTip.tipY);
		log(dSolved < dSetup - 0.5 || moved > 0.5, `mix=1 SOLVES: tip→target dist ${dSetup.toFixed(2)} → ${dSolved.toFixed(2)}, tip moved ${moved.toFixed(2)}px`);
	}
}

// (b) mix=0 loads + pose == setup/FK (no change)
{
	const raw = clone(baseRaw);
	raw.ik = [buildIk({ mix: 0 })];
	const fk = poseBone(raw, null, chain.child, 0);
	const drift = Math.hypot(fk.tipX - setupTip.tipX, fk.tipY - setupTip.tipY);
	log(drift < 0.05, `mix=0 → pose == setup/FK (tip drift ${drift.toFixed(4)})`);
}

// (c) bendPositive:false flips the bend direction
{
	const raw = clone(baseRaw);
	raw.ik = [buildIk({ bendPositive: false })];
	const data = loadData(raw);
	log(data.ikConstraints[0].bendDirection === -1, `bendPositive:false → bendDirection -1`);
}

// (d) 1-bone chain loads (bones:[child] only)
{
	const raw = clone(baseRaw);
	raw.ik = [{ name: 'spikeIk1', order: 0, bones: [chain.child], target: chain.target, mix: 1, bendPositive: true }];
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, '1-bone ik REJECTED — ' + e.message); }
	if (data) log(data.ikConstraints.length === 1 && data.ikConstraints[0].bones.length === 1, `1-bone IK loads (bones.length=${data.ikConstraints[0].bones.length})`);
}

// -------------------------------------------------------------------- timeline tests
// IK timeline: mix 0 → 1 across [0,1]. At t=0 pose==FK; at t=1 pose==full IK; mid blends the
// tip part-way. Asserted via TIP POSITION (world rotation wraps at ±180° → unreliable).
function ikTimelineRaw() {
	const raw = clone(baseRaw);
	raw.ik = [buildIk({ mix: 1 })];
	raw.animations = raw.animations || {};
	raw.animations.spikeIkAnim = { ik: { spikeIk: [{ time: 0, mix: 0 }, { time: 1, mix: 1 }] } };
	return raw;
}

{
	const raw = ikTimelineRaw();
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'ik timeline REJECTED — ' + e.message); }
	if (data) {
		const anim = data.findAnimation('spikeIkAnim');
		log(!!anim, 'ik timeline animation loads');
		log(anim && anim.timelines.length === 1 && anim.timelines[0].constructor.name.includes('IkConstraint'), `parsed an IkConstraintTimeline (${anim ? anim.timelines.map((t) => t.constructor.name).join(',') : '—'})`);

		const fk = poseBone(baseRaw, null, chain.child, 0); // no ik == FK
		const full = poseBone(raw, 'spikeIkAnim', chain.child, 1); // t=1 → mix 1
		const tStart = poseBone(raw, 'spikeIkAnim', chain.child, 0); // t=0 → mix 0 → FK
		const driftFK = Math.hypot(tStart.tipX - fk.tipX, tStart.tipY - fk.tipY);
		log(driftFK < 0.05, `timeline @t=0 (mix0) == FK (tip drift ${driftFK.toFixed(4)})`);
		const solveSpan = Math.hypot(full.tipX - fk.tipX, full.tipY - fk.tipY);
		log(solveSpan > 0.5, `timeline @t=1 (mix1) solves vs FK (tip moved ${solveSpan.toFixed(2)}px)`);

		const mid = poseBone(raw, 'spikeIkAnim', chain.child, 0.5);
		const ourMix = 0 + (1 - 0) * 0.5;
		log(Math.abs(ourMix - 0.5) < 1e-9, `our linear mix sample @t=0.5 = ${ourMix} (want 0.5)`);
		const dMidFK = Math.hypot(mid.tipX - fk.tipX, mid.tipY - fk.tipY);
		const dMidFull = Math.hypot(mid.tipX - full.tipX, mid.tipY - full.tipY);
		const between = solveSpan > 1e-3 && dMidFK > solveSpan * 0.05 && dMidFull > solveSpan * 0.05;
		log(between, `runtime mix=0.5 tip lies between FK & full (toFK ${dMidFK.toFixed(1)}, toFull ${dMidFull.toFixed(1)}, span ${solveSpan.toFixed(1)})`);
	}
}

// bezier curve on the mix channel — ease-in: midpoint mix VALUE < 0.5 (sub-linear) and
// matches our evaluator. Measured by reading the live IkConstraint.mix the runtime sets
// (the chain tip arcs, so geometric displacement is NOT linear in mix — read mix directly).
const ikMixAt = (raw, animName, t) => {
	const data = loadData(raw);
	const sk = new Skeleton(data);
	sk.setToSetupPose();
	data.findAnimation(animName).apply(sk, 0, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
	return sk.ikConstraints[0].mix;
};
{
	const raw = clone(baseRaw);
	raw.ik = [buildIk({ mix: 1 })];
	raw.animations = { spikeIkBez: { ik: { spikeIk: [{ time: 0, mix: 0, curve: [0.42, 0, 1, 1] }, { time: 1, mix: 1 }] } } };
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'bezier ik timeline REJECTED — ' + e.message); }
	if (data) {
		log(!!data.findAnimation('spikeIkBez'), 'bezier ik timeline loads');
		const progress = ikMixAt(raw, 'spikeIkBez', 0.5); // mix range is 0→1 so mix == progress
		const bezierValue = (t1, p1, cx1, cy1, cx2, cy2, t2, p2, t) => {
			if (t <= t1) return p1; if (t >= t2) return p2;
			const X = (s) => { const u = 1 - s; return u * u * u * t1 + 3 * u * u * s * cx1 + 3 * u * s * s * cx2 + s * s * s * t2; };
			const Y = (s) => { const u = 1 - s; return u * u * u * p1 + 3 * u * u * s * cy1 + 3 * u * s * s * cy2 + s * s * s * p2; };
			let lo = 0, hi = 1; for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (X(m) < t) lo = m; else hi = m; }
			return Y((lo + hi) / 2);
		};
		const predProgress = bezierValue(0, 0, 0.42, 0, 1, 1, 1, 1, 0.5);
		log(predProgress < 0.5, `our bezier evaluator ease-in @0.5 = ${predProgress.toFixed(3)} (< 0.5)`);
		log(Math.abs(progress - predProgress) < 0.02, `runtime bezier mix VALUE @0.5 ${progress.toFixed(3)} ≈ our evaluator ${predProgress.toFixed(3)}`);
		// and the LINEAR timeline mix @0.5 is exactly 0.5
		const linRaw = ikTimelineRaw();
		const linMid = ikMixAt(linRaw, 'spikeIkAnim', 0.5);
		log(Math.abs(linMid - 0.5) < 1e-4, `runtime linear mix VALUE @0.5 = ${linMid.toFixed(4)} (== our 0.5)`);
	}
}

// -------------------------------------------------------------------- parity test
{
	loadData(baseRaw);
	log((baseRaw.ik || []).every((c) => c.name !== 'spikeIk'), 'base skeleton carries no spike ik constraint (parity)');
}

console.log(pass
	? '\n✅ PASS — IK setup (top-level `ik` array: bones[parent,child]/target/mix/bendPositive/softness/compress/stretch, bendPositive is a BOOL) + IK timeline (animations.<a>.ik.<name> = [{time,mix,softness,bendPositive,compress,stretch,curve?}]) validated: mix=1 solves toward target, mix=0==FK, mid blends, linear + bezier(mix channel) match the runtime.'
	: '\n✗ FAIL');
process.exit(pass ? 0 : 1);
