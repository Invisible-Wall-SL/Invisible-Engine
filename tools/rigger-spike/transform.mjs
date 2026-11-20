// Phase §18 item 6 spike (GATE) — nail the 4.2-format TRANSFORM CONSTRAINT setup + the
// transform animation timeline data model against the official runtime, before any UI is built.
//   node tools/rigger-spike/transform.mjs <skeleton.json> <skeleton.atlas>
//
// ============================ EMPIRICAL FINDINGS ============================
// (validated below against the rig runtime's SkeletonJson loader (engine-rig, held to the 4.2-format reference),
//  TransformConstraint, and TransformConstraintTimeline — NOT from memory. Read off
//  SkeletonJson.js: setup at L151-184, timeline at L761-813.)
//
// SETUP — top-level `transform` array (skeletonData.transformConstraints):
//   rawDoc.transform = [{
//     name,                  // unique constraint name (required)
//     order: 0,              // int, default 0 — solve order across ALL constraints
//     skin: false,           // bool, default false (constraintMap.skin → data.skinRequired)
//     bones: [boneName, …],  // 1+ CONSTRAINED bone NAMES (required)
//     target: targetBone,    // the SOURCE bone NAME the constrained bones follow (required)
//     // MIX channels — fraction (0..1) of the target transform applied. THE LOADER DEFAULTS
//     // EVERY MIX TO 1 (full follow). mixY defaults to mixX; mixScaleY defaults to mixScaleX.
//     mixRotate: 1, mixX: 1, mixY: 1, mixScaleX: 1, mixScaleY: 1, mixShearY: 1,
//     // OFFSET channels — note the JSON KEYS are the SHORT names below (NOT offsetRotation/…).
//     // The runtime stores them as data.offset{Rotation,X,Y,ScaleX,ScaleY,ShearY}.
//     rotation: 0,           // → data.offsetRotation (degrees)
//     x: 0, y: 0,            // → data.offsetX/Y (* skeleton scale)
//     scaleX: 0, scaleY: 0,  // → data.offsetScaleX/Y
//     shearY: 0,             // → data.offsetShearY
//     relative: false,       // bool, default false
//     local: false,          // bool, default false
//   }, …]
//   CRUX: offset JSON keys are `rotation/x/y/scaleX/scaleY/shearY` (short), mix keys are
//   `mixRotate/mixX/mixY/mixScaleX/mixScaleY/mixShearY`. ALL SIX MIXES default to 1; all six
//   offsets default to 0. Absent mixY → mixX; absent mixScaleY → mixScaleX (loader fallbacks).
//
// BEHAVIOUR (verified): with mixRotate=1 + a rotation OFFSET, the constrained bone's world
//   rotation tracks the target's world rotation + the offset. With ALL mixes=0 the pose ==
//   setup/FK (the constraint contributes nothing). Intermediate mix blends FK → fully-followed.
//
// ANIMATION TIMELINE — `animations.<anim>.transform.<name>` (a TransformConstraintTimeline):
//   animations.<a>.transform.<name> = [ { time, mixRotate, mixX, mixY, mixScaleX, mixScaleY,
//                                         mixShearY, curve? }, … ]
//   • Per key the runtime reads the SIX mixes (each defaulting to 1; mixY→mixX, mixScaleY→
//     mixScaleX as above) + time(0).
//   • All six mixes interpolate (linear, or bezier via `curve`). There are NO stepped-only
//     fields here (unlike IK's bend/compress/stretch) — every channel is a mix.
//   • `curve` is read off the CURRENT key (keyMap.curve) and drives SIX bezier channels in
//     this order: 0=mixRotate, 1=mixX, 2=mixY, 3=mixScaleX, 4=mixScaleY, 5=mixShearY.
//   • CRUX (verified — a single 4-value curve is NOT enough): readCurve indexes
//     `curve[channel << 2]`, so the flat `curve` array must hold a FULL [cx1,cy1,cx2,cy2]
//     PER CHANNEL → 4*6 = 24 numbers (exactly like rgba=16 / rgba2=28). Authoring just ONE
//     [cx1,cy1,cx2,cy2] feeds channel 0 only; channels 1-5 read undefined → NaN. So a shared
//     ease must be BAKED across all six channels (same time handles, per-channel value
//     handles in ABSOLUTE value-space). `"stepped"` and omitting `curve` (linear) are the
//     other two options.
//   • Authoring v1: we key the SIX MIXES (the FK→follow reveal). Linear by default, bezier via
//     the shared curve menu — ONE easing baked into all six channels. Offsets stay setup-only.
import { readFileSync } from 'node:fs';
import { RIG_CORE } from './rig.mjs';

const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics, MixBlend, MixDirection } = await import(RIG_CORE);

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

// Pick a constrained bone + a DISTINCT target bone (not under it) whose setup WORLD rotations differ
// by more than 5°, so a rotation-follow is observable. A bone's own `rotation` says nothing about its
// world rotation. Where no two bones are turned apart (12 lines rigs), the pair follows its target
// at a 30° rotation OFFSET instead (`off`), so the follow still shows: before, those rigs measured a
// 0.00° effect and failed. Both bones are non-root.
function pickPair(raw) {
	const byName = Object.fromEntries(raw.bones.map((b) => [b.name, b]));
	const under = (n, anc) => { for (let p = byName[n]; p; p = byName[p.parent]) if (p.name === anc) return true; return false; };
	const sk = new Skeleton(loadData(clone(raw)));
	sk.setToSetupPose();
	try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }
	const rot = (n) => sk.findBone(n).getWorldRotationX();
	const cands = raw.bones.filter((b) => b.name !== 'root' && b.parent);
	let fallback = null;
	for (const c of cands) {
		for (const t of cands) {
			if (t.name === c.name || under(t.name, c.name)) continue;
			if (angDiff(rot(t.name), rot(c.name)) > 5) return { bone: c.name, target: t.name, off: 0 };
			fallback = fallback || { bone: c.name, target: t.name, off: 30 };
		}
	}
	return fallback;
}

// Pose with an animation (or just setup) and return the constrained bone's world rotation.
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
	// `flip` -1 where the bone's world is reflected (a negative scale): the runtime turns a rotation
	// offset the other way there (TransformConstraint: offset × sign of the target's determinant).
	return { rot: bone.getWorldRotationX(), worldX: bone.worldX, worldY: bone.worldY, flip: bone.a * bone.d - bone.b * bone.c > 0 ? 1 : -1 };
}

const angDiff = (a, b) => { let d = ((a - b) % 360 + 540) % 360 - 180; return Math.abs(d); };
const baseRaw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const pair = pickPair(baseRaw);
console.log(`\n=== §18.6 transform-constraint setup + timeline model → official runtime: ${jsonPath} ===`);
// Not a failure: a rig of root plus one bone has no pair to constrain.
if (!pair) { console.log('  (skip: no two non-root bones to pair in this skeleton)'); process.exit(0); }
console.log(`  constrained bone="${pair.bone}"  target="${pair.target}"${pair.off ? `  (no bone turned apart: a ${pair.off}° offset)` : ''}`);

// The spike's constraint joins the rig's own at the next free order, as ＋ Add transform adds one:
// replacing the list instead broke a rig whose clip keys one of its constraints (`mm_bg`'s `dust`
// keys `particle_control2`: "not found"), and order 0 would share an order with the rig's first.
const ORDER = ['ik', 'transform', 'path', 'physics'].reduce((n, k) => n + (baseRaw[k] || []).length, 0);
function buildTc(extra) {
	return Object.assign({ name: 'spikeTc', order: ORDER, bones: [pair.bone], target: pair.target,
		mixRotate: 1, mixX: 1, mixY: 1, mixScaleX: 1, mixScaleY: 1, mixShearY: 1 }, extra);
}
const withTc = (raw, c) => { raw.transform = [...(raw.transform || []), c]; return raw; };
const spikeOf = (list) => list.find((c) => c.name === 'spikeTc' || c.data?.name === 'spikeTc');
// The constraints engine-rig runs (its update cache), by name: the spike's must join the rig's own,
// every one of which still runs.
const runningOf = (raw) => {
	const sk = new Skeleton(loadData(clone(raw)));
	return [...sk.ikConstraints, ...sk.transformConstraints, ...sk.pathConstraints, ...sk.physicsConstraints]
		.filter((c) => sk._updateCache.includes(c)).map((c) => c.data.name).sort();
};
const ranBefore = runningOf(baseRaw);

const targetSetup = poseBone(baseRaw, null, pair.target, 0);
const setupRot = poseBone(baseRaw, null, pair.bone, 0).rot;

// (a) loader builds the TransformConstraint with the right defaults
{
	const raw = withTc(clone(baseRaw), buildTc({}));
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'loader REJECTED transform setup — ' + e.message); }
	if (data) {
		log(data.transformConstraints.length === (baseRaw.transform || []).length + 1, `loader built ${data.transformConstraints.length} TransformConstraintData`);
		// skeletonData.transformConstraints[i] is the TransformConstraintData (mix fields live
		// directly on it; .target is a BoneData via a getter).
		const d = spikeOf(data.transformConstraints);
		const ran = runningOf(raw);
		log(ran.includes('spikeTc') && ranBefore.every((n) => ran.includes(n)), `the spike constraint runs and so do the rig's own ${ranBefore.length} constraint(s)${ranBefore.length ? ` (${ranBefore.join(', ')})` : ''}`);
		const tgtName = d && d.target && d.target.name;
		log(d && d.bones.length === 1 && tgtName === pair.target, `constraint has bone + target "${tgtName}"`);
		log(d.mixRotate === 1 && d.mixX === 1 && d.mixY === 1 && d.mixScaleX === 1 && d.mixScaleY === 1 && d.mixShearY === 1, `all six mixes default to 1 (got rot${d.mixRotate} x${d.mixX} y${d.mixY} sx${d.mixScaleX} sy${d.mixScaleY} shy${d.mixShearY})`);
	}
}

// (b) mixRotate=1 + rotation offset `off` (0 where the pair is turned apart) → constrained bone
// world rotation FOLLOWS the target (plus the offset)
const followRot = targetSetup.rot + pair.off * targetSetup.flip;
{
	const raw = withTc(clone(baseRaw), buildTc({ mixRotate: 1, rotation: pair.off }));
	const followed = poseBone(raw, null, pair.bone, 0).rot;
	const drift = angDiff(followed, setupRot);
	log(drift > 0.5, `mixRotate=1 changes the constrained bone's world rotation (Δ ${drift.toFixed(2)}° vs unconstrained)`);
	const toTarget = angDiff(followed, followRot);
	log(toTarget < 0.5, `mixRotate=1, offset ${pair.off} → constrained world rotation == target's + ${pair.off} (${followed.toFixed(2)}° ≈ ${followRot.toFixed(2)}°)`);
}

// (c) rotation offset shifts the followed rotation by exactly the offset
{
	const raw = withTc(clone(baseRaw), buildTc({ mixRotate: 1, rotation: pair.off + 30 }));
	const followed = poseBone(raw, null, pair.bone, 0).rot;
	const expect = followRot + 30 * targetSetup.flip;
	const err = angDiff(followed, expect);
	log(err < 0.5, `rotation offset ${pair.off + 30} → world rotation == target+${pair.off + 30} (${followed.toFixed(2)}° ≈ ${expect.toFixed(2)}°)`);
}

// (d) ALL mixes 0 → pose == setup/FK (constraint contributes nothing)
{
	const raw = withTc(clone(baseRaw), buildTc({ mixRotate: 0, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 }));
	const fk = poseBone(raw, null, pair.bone, 0).rot;
	const drift = angDiff(fk, setupRot);
	log(drift < 0.05, `all mixes=0 → pose == setup/FK (rot drift ${drift.toFixed(4)}°)`);
}

// (e) mixRotate=0.5 → world rotation lies BETWEEN setup and target (blend)
{
	const raw = withTc(clone(baseRaw), buildTc({ mixRotate: 0.5, rotation: pair.off, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 }));
	const mid = poseBone(raw, null, pair.bone, 0).rot;
	const span = angDiff(followRot, setupRot);
	const toSetup = angDiff(mid, setupRot), toTarget = angDiff(mid, followRot);
	log(span > 1e-3 && toSetup > span * 0.05 && toTarget > span * 0.05, `mixRotate=0.5 blends (toSetup ${toSetup.toFixed(1)}°, toTarget ${toTarget.toFixed(1)}°, span ${span.toFixed(1)}°)`);
}

// -------------------------------------------------------------------- timeline tests
// Read the LIVE TransformConstraint.mixRotate the runtime sets at time t (the mix is what we
// animate; geometric rotation is non-linear in mix when the target is far, so read mix directly).
const tcMixAt = (raw, animName, t) => {
	const data = loadData(raw);
	const sk = new Skeleton(data);
	sk.setToSetupPose();
	data.findAnimation(animName).apply(sk, 0, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
	return spikeOf(sk.transformConstraints).mixRotate;
};

function tcLinearRaw() {
	const raw = withTc(clone(baseRaw), buildTc({}));
	raw.animations = raw.animations || {};
	raw.animations.spikeTcAnim = { transform: { spikeTc: [
		{ time: 0, mixRotate: 0, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 },
		{ time: 1, mixRotate: 1, mixX: 1, mixY: 1, mixScaleX: 1, mixScaleY: 1, mixShearY: 1 },
	] } };
	return raw;
}

{
	const raw = tcLinearRaw();
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'transform timeline REJECTED — ' + e.message); }
	if (data) {
		const anim = data.findAnimation('spikeTcAnim');
		log(!!anim, 'transform timeline animation loads');
		log(anim && anim.timelines.length === 1 && anim.timelines[0].constructor.name.includes('TransformConstraint'), `parsed a TransformConstraintTimeline (${anim ? anim.timelines.map((t) => t.constructor.name).join(',') : '—'})`);

		const t0 = tcMixAt(raw, 'spikeTcAnim', 0);
		const t1 = tcMixAt(raw, 'spikeTcAnim', 1);
		log(Math.abs(t0 - 0) < 1e-4, `timeline @t=0 mixRotate == 0 (${t0.toFixed(4)})`);
		log(Math.abs(t1 - 1) < 1e-4, `timeline @t=1 mixRotate == 1 (${t1.toFixed(4)})`);
		const mid = tcMixAt(raw, 'spikeTcAnim', 0.5);
		log(Math.abs(mid - 0.5) < 1e-4, `runtime LINEAR mixRotate @0.5 = ${mid.toFixed(4)} (== our 0.5)`);
	}
}

// bezier curve baked across all six channels — ease-in: midpoint mix VALUE < 0.5 (sub-linear)
// and matches our evaluator. The shared ease MUST be baked per-channel (24 numbers).
const sharedEaseCurve = (a, b, F) => {
	const dt = b.time - a.time, curve = [];
	const chans = ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'];
	chans.forEach((ch, vi) => {
		const va = a[ch], vb = b[ch], dv = vb - va;
		curve[vi * 4 + 0] = a.time + dt * F[0];
		curve[vi * 4 + 1] = va + dv * F[1];
		curve[vi * 4 + 2] = a.time + dt * F[2];
		curve[vi * 4 + 3] = va + dv * F[3];
	});
	return curve;
};
{
	const raw = withTc(clone(baseRaw), buildTc({}));
	const k0 = { time: 0, mixRotate: 0, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 };
	const k1 = { time: 1, mixRotate: 1, mixX: 1, mixY: 1, mixScaleX: 1, mixScaleY: 1, mixShearY: 1 };
	k0.curve = sharedEaseCurve(k0, k1, [0.42, 0, 1, 1]);
	raw.animations = { spikeTcBez: { transform: { spikeTc: [k0, k1] } } };
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'bezier transform timeline REJECTED — ' + e.message); }
	if (data) {
		log(!!data.findAnimation('spikeTcBez'), 'bezier transform timeline loads');
		const progress = tcMixAt(raw, 'spikeTcBez', 0.5); // mix range 0→1 so mixRotate == progress
		const bezierValue = (t1, p1, cx1, cy1, cx2, cy2, t2, p2, t) => {
			if (t <= t1) return p1; if (t >= t2) return p2;
			const X = (s) => { const u = 1 - s; return u * u * u * t1 + 3 * u * u * s * cx1 + 3 * u * s * s * cx2 + s * s * s * t2; };
			const Y = (s) => { const u = 1 - s; return u * u * u * p1 + 3 * u * u * s * cy1 + 3 * u * s * s * cy2 + s * s * s * p2; };
			let lo = 0, hi = 1; for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (X(m) < t) lo = m; else hi = m; }
			return Y((lo + hi) / 2);
		};
		const pred = bezierValue(0, 0, 0.42, 0, 1, 1, 1, 1, 0.5);
		log(pred < 0.5, `our bezier evaluator ease-in @0.5 = ${pred.toFixed(3)} (< 0.5)`);
		log(Math.abs(progress - pred) < 0.02, `runtime bezier mixRotate VALUE @0.5 ${progress.toFixed(3)} ≈ our evaluator ${pred.toFixed(3)}`);
		// also verify the shared curve eases mixScaleX identically (channel 3)
		const scaleX = (() => { const d = loadData(raw); const sk = new Skeleton(d); sk.setToSetupPose(); d.findAnimation('spikeTcBez').apply(sk, 0, 0.5, false, [], 1, MixBlend.setup, MixDirection.mixIn); return spikeOf(sk.transformConstraints).mixScaleX; })();
		log(Math.abs(scaleX - pred) < 0.02, `shared curve eases mixScaleX identically @0.5 (${scaleX.toFixed(3)} ≈ ${pred.toFixed(3)})`);
	}
}

// -------------------------------------------------------------------- parity test
{
	loadData(baseRaw);
	log((baseRaw.transform || []).every((c) => c.name !== 'spikeTc'), 'base skeleton carries no spike transform constraint (parity)');
}

console.log(pass
	? '\n✅ PASS — transform setup (top-level `transform` array: bones[]/target/mix{Rotate,X,Y,ScaleX,ScaleY,ShearY} default 1 / offset keys rotation,x,y,scaleX,scaleY,shearY default 0 / relative,local) + transform timeline (animations.<a>.transform.<name> = [{time, mix*, curve?}], shared curve channels 0=mixRotate 1=mixX 2=mixY 3=mixScaleX 4=mixScaleY 5=mixShearY) validated: mixRotate=1 follows target, offset shifts it, all-mix-0==FK, mid blends, linear + bezier(shared) match the runtime.'
	: '\n✗ FAIL');
process.exit(pass ? 0 : 1);
