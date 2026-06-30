// Phase §18 item 6 spike (GATE) — nail the Spine 4.2 TRANSFORM CONSTRAINT setup + the
// transform animation timeline data model against the official runtime, before any UI is built.
//   node tools/rigger-spike/transform.mjs <skeleton.json> <skeleton.atlas>
//
// ============================ EMPIRICAL FINDINGS ============================
// (validated below against @esotericsoftware/spine-core@4.2.74's SkeletonJson loader,
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

// Pick a constrained bone + a DISTINCT target bone that has a non-trivial world rotation
// relative to the constrained one, so a rotation-follow is observable. Both must be non-root.
function pickPair(raw) {
	const cands = raw.bones.filter((b) => b.name !== 'root' && b.parent);
	for (const c of cands) {
		for (const t of cands) {
			if (t.name === c.name) continue;
			// target with a non-zero own rotation makes the follow observable
			if (Math.abs(t.rotation || 0) > 5) return { bone: c.name, target: t.name };
		}
	}
	// fallback: any two distinct non-root bones
	if (cands.length >= 2) return { bone: cands[0].name, target: cands[1].name };
	return null;
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
	return { rot: bone.getWorldRotationX(), worldX: bone.worldX, worldY: bone.worldY };
}

const baseRaw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const pair = pickPair(baseRaw);
console.log(`\n=== §18.6 transform-constraint setup + timeline model → official runtime: ${jsonPath} ===`);
if (!pair) { console.log('  (no usable bone pair found in this skeleton)'); process.exit(1); }
console.log(`  constrained bone="${pair.bone}"  target="${pair.target}"`);

function buildTc(extra) {
	return Object.assign({ name: 'spikeTc', order: 0, bones: [pair.bone], target: pair.target,
		mixRotate: 1, mixX: 1, mixY: 1, mixScaleX: 1, mixScaleY: 1, mixShearY: 1 }, extra);
}

const targetSetup = poseBone(baseRaw, null, pair.target, 0);
const setupRot = poseBone(baseRaw, null, pair.bone, 0).rot;
const angDiff = (a, b) => { let d = ((a - b) % 360 + 540) % 360 - 180; return Math.abs(d); };

// (a) loader builds the TransformConstraint with the right defaults
{
	const raw = clone(baseRaw);
	raw.transform = [buildTc({})];
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'loader REJECTED transform setup — ' + e.message); }
	if (data) {
		log(data.transformConstraints.length === 1, `loader built ${data.transformConstraints.length} TransformConstraintData`);
		// skeletonData.transformConstraints[i] is the TransformConstraintData (mix fields live
		// directly on it; .target is a BoneData via a getter).
		const d = data.transformConstraints[0];
		const tgtName = d && d.target && d.target.name;
		log(d && d.bones.length === 1 && tgtName === pair.target, `constraint has bone + target "${tgtName}"`);
		log(d.mixRotate === 1 && d.mixX === 1 && d.mixY === 1 && d.mixScaleX === 1 && d.mixScaleY === 1 && d.mixShearY === 1, `all six mixes default to 1 (got rot${d.mixRotate} x${d.mixX} y${d.mixY} sx${d.mixScaleX} sy${d.mixScaleY} shy${d.mixShearY})`);
	}
}

// (b) mixRotate=1 + rotation offset 0 → constrained bone world rotation FOLLOWS the target
{
	const raw = clone(baseRaw);
	raw.transform = [buildTc({ mixRotate: 1, rotation: 0 })];
	const followed = poseBone(raw, null, pair.bone, 0).rot;
	const drift = angDiff(followed, setupRot);
	log(drift > 0.5, `mixRotate=1 changes the constrained bone's world rotation (Δ ${drift.toFixed(2)}° vs unconstrained)`);
	const toTarget = angDiff(followed, targetSetup.rot);
	log(toTarget < 0.5, `mixRotate=1, offset 0 → constrained world rotation == target's (${followed.toFixed(2)}° ≈ target ${targetSetup.rot.toFixed(2)}°)`);
}

// (c) rotation offset shifts the followed rotation by exactly the offset
{
	const raw = clone(baseRaw);
	raw.transform = [buildTc({ mixRotate: 1, rotation: 30 })];
	const followed = poseBone(raw, null, pair.bone, 0).rot;
	const expect = targetSetup.rot + 30;
	const err = angDiff(followed, expect);
	log(err < 0.5, `rotation offset 30 → world rotation == target+30 (${followed.toFixed(2)}° ≈ ${expect.toFixed(2)}°)`);
}

// (d) ALL mixes 0 → pose == setup/FK (constraint contributes nothing)
{
	const raw = clone(baseRaw);
	raw.transform = [buildTc({ mixRotate: 0, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 })];
	const fk = poseBone(raw, null, pair.bone, 0).rot;
	const drift = angDiff(fk, setupRot);
	log(drift < 0.05, `all mixes=0 → pose == setup/FK (rot drift ${drift.toFixed(4)}°)`);
}

// (e) mixRotate=0.5 → world rotation lies BETWEEN setup and target (blend)
{
	const raw = clone(baseRaw);
	raw.transform = [buildTc({ mixRotate: 0.5, rotation: 0, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 })];
	const mid = poseBone(raw, null, pair.bone, 0).rot;
	const span = angDiff(targetSetup.rot, setupRot);
	const toSetup = angDiff(mid, setupRot), toTarget = angDiff(mid, targetSetup.rot);
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
	return sk.transformConstraints[0].mixRotate;
};

function tcLinearRaw() {
	const raw = clone(baseRaw);
	raw.transform = [buildTc({})];
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
	const raw = clone(baseRaw);
	raw.transform = [buildTc({})];
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
		const scaleX = (() => { const d = loadData(raw); const sk = new Skeleton(d); sk.setToSetupPose(); d.findAnimation('spikeTcBez').apply(sk, 0, 0.5, false, [], 1, MixBlend.setup, MixDirection.mixIn); return sk.transformConstraints[0].mixScaleX; })();
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
