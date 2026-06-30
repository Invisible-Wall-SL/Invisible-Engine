// Phase §18 item 8 spike (GATE) — nail the Spine 4.2 PHYSICS CONSTRAINT setup + the physics
// animation timeline data model against the official runtime, before any UI is built.
//   node tools/rigger-spike/physics.mjs <skeleton.json> <skeleton.atlas>
//
// Physics is NEW in 4.2 and is a SIMULATION (secondary motion for hair/cloth/jiggle), so it is
// NON-deterministic frame-to-frame — we assert STRUCTURALLY (finite, changes, stable, resets),
// not exact values.
//
// ============================ EMPIRICAL FINDINGS ============================
// (validated below against @esotericsoftware/spine-core@4.2.74's SkeletonJson loader,
//  PhysicsConstraint(Data), and the eight Physics*Timeline classes — NOT from memory. Read off
//  SkeletonJson.js: setup at L221-256, timeline at L870-912; readTimeline1 at L1072.)
//
// SETUP — top-level `physics` array (skeletonData.physicsConstraints):
//   rawDoc.physics = [{
//     name,                 // unique constraint name (required)
//     order: 0,             // int, default 0 — solve order across ALL constraint kinds (must be
//                           //   contiguous 0..N-1 across ik+transform+path+physics on save)
//     skin: false,          // bool, default false (constraintMap.skin → data.skinRequired)
//     bone: boneName,       // a SINGLE driven bone NAME (required — NOT a bones[] array). The
//                           //   loader throws "Physics bone not found" if absent/unknown.
//     // WHICH channels physics drives — these are 0..1 AMOUNTS (how much of the simulated
//     // offset is applied to each transform component), ALL DEFAULT 0 (off):
//     x: 0,                 // translate-X amount
//     y: 0,                 // translate-Y amount
//     rotate: 0,            // rotation amount
//     scaleX: 0,            // scale-X amount
//     shearX: 0,            // shear-X amount
//     //   (the runtime treats rotate>0 OR shearX>0 as "rotate-or-shear" driven; x/y/scaleX gate
//     //    their own channels — see PhysicsConstraint.update: `x = data.x > 0`, etc.)
//     limit: 5000,          // px clamp on per-step movement (default 5000, * skeleton scale)
//     fps: 60,              // sim rate; loader stores data.step = 1/fps (so JSON key is `fps`,
//                           //   NOT `step`; default 60 → step ~0.0167)
//     // SIM PROPERTIES (the secondary-motion feel):
//     inertia: 1,           // 0..1, how much the bone keeps its motion (default 1)
//     strength: 100,        // spring strength pulling back to rest (default 100)
//     damping: 1,           // velocity damping (default 1)
//     mass: 1,              // JSON key is `mass`; loader stores data.massInverse = 1/mass
//                           //   (default 1 → massInverse 1). NOT `massInverse` in JSON.
//     wind: 0,              // constant wind force X (default 0)
//     gravity: 0,           // constant gravity force Y (default 0)
//     mix: 1,               // 0..1 overall blend of the physics result (default 1; mix==0 ⇒ the
//                           //   constraint early-returns and contributes nothing)
//     // *Global booleans (default false) — whether a property is scaled by skeleton.physics:
//     inertiaGlobal, strengthGlobal, dampingGlobal, massGlobal, windGlobal, gravityGlobal,
//     mixGlobal,            //   all bool, all default false
//   }, …]
//   CRUX: `bone` is singular; `mass`/`fps` in JSON (loader → `massInverse`/`step`); x/y/rotate/
//   scaleX/shearX are 0..1 amounts defaulting 0; limit 5000, inertia 1, strength 100, damping 1,
//   mix 1.
//
// SIMULATE (verified): a physics constraint produces no offset at rest. When the driven bone's
//   PARENT is moved over successive frames (advancing skeleton.time, then
//   updateWorldTransform(Physics.update) each step), the constraint accumulates an inertial
//   offset → the driven bone's world transform LAGS/JIGGLES (FINITE, CHANGES vs a no-physics
//   baseline, no NaN). Physics.reset (or constraint.reset()) re-initialises the sim so the bone
//   snaps back to following its parent with zero accumulated offset.
//
// ANIMATION TIMELINE — `animations.<anim>.physics.<name>` (a map of per-property timelines):
//   animations.<a>.physics.<name> = {
//     inertia:  [ {time, value, curve?}, … ],   // PhysicsConstraintInertiaTimeline
//     strength: [ {time, value, curve?}, … ],   // PhysicsConstraintStrengthTimeline
//     damping:  [ {time, value, curve?}, … ],   // PhysicsConstraintDampingTimeline
//     mass:     [ {time, value, curve?}, … ],   // PhysicsConstraintMassTimeline  (animates massInverse)
//     wind:     [ {time, value, curve?}, … ],   // PhysicsConstraintWindTimeline
//     gravity:  [ {time, value, curve?}, … ],   // PhysicsConstraintGravityTimeline
//     mix:      [ {time, value, curve?}, … ],   // PhysicsConstraintMixTimeline
//     reset:    [ {time}, … ],                   // PhysicsConstraintResetTimeline (STEP — no value)
//   }
//   • Each non-reset channel is a SINGLE-VALUE timeline read by readTimeline1: per key
//     {time(0), value(0), curve?}. The JSON key is `value` (NOT the property name). value
//     interpolates LINEAR, or bezier via a per-key `curve` ([cx1,cy1,cx2,cy2] — ONE channel,
//     channel 0, exactly like a bone rotate/translate single channel; or "stepped").
//   • `reset` is a STEP timeline: per key just {time}; on apply it calls constraint.reset() at
//     that frame (re-initialises the sim — used to snap secondary motion to rest).
//   • Authoring v1: key the seven sim params (inertia/strength/damping/mass/wind/gravity/mix) +
//     the reset step at the playhead; linear by default, bezier via the shared curve menu.
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

// Pick a driven bone that HAS a parent (so we can move the parent to induce secondary motion)
// and a non-zero length (so a rotate-driven offset is observable). Prefer a leaf.
function pickBone(raw) {
	const byName = Object.fromEntries(raw.bones.map((b) => [b.name, b]));
	const hasChild = new Set(raw.bones.map((b) => b.parent).filter(Boolean));
	const cands = raw.bones.filter((b) => b.name !== 'root' && b.parent && byName[b.parent]);
	// prefer a leaf with length
	const leaf = cands.find((b) => !hasChild.has(b.name) && (b.length || 0) > 1);
	if (leaf) return { bone: leaf.name, parent: leaf.parent };
	const anyLen = cands.find((b) => (b.length || 0) > 1);
	if (anyLen) return { bone: anyLen.name, parent: anyLen.parent };
	return cands.length ? { bone: cands[0].name, parent: cands[0].parent } : null;
}

const baseRaw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const pick = pickBone(baseRaw);
console.log(`\n=== §18.8 physics-constraint setup + timeline model → official runtime: ${jsonPath} ===`);
if (!pick) { console.log('  (no non-root bone with a parent found in this skeleton)'); process.exit(1); }
console.log(`  driven bone="${pick.bone}"  parent="${pick.parent}"`);

// CRUX: `order` must be UNIQUE/contiguous across ALL constraint kinds (ik+transform+path+
// physics). SkeletonJson.updateCache dispatches by `constraint.data.order == i` and takes at
// most one constraint per i — a physics order that collides with an existing ik/transform/path
// order is NEVER sorted → constraint.active stays false → the constraint (and its timeline)
// silently does nothing. So append at the next free order.
const nextOrder = () => {
	const all = [...(baseRaw.ik || []), ...(baseRaw.transform || []), ...(baseRaw.path || []), ...(baseRaw.physics || [])];
	return all.length;
};
function buildPc(extra) {
	return Object.assign({
		name: 'spikePc', order: nextOrder(), bone: pick.bone,
		x: 1, y: 1, rotate: 1, scaleX: 0, shearX: 0,
		limit: 5000, fps: 60, inertia: 1, strength: 100, damping: 1, mass: 1, wind: 0, gravity: 0, mix: 1,
	}, extra);
}

// Run the sim: pose the PARENT bone by `parentDx` over `frames` steps of `dt`, stepping the
// physics each frame, and return the driven bone's final world transform + a snapshot history.
function simulate(raw, { frames = 20, dt = 1 / 60, parentDx = 200, resetAt = -1 } = {}) {
	const data = loadData(raw);
	const sk = new Skeleton(data);
	sk.setToSetupPose();
	const parent = sk.findBone(pick.parent);
	const baseX = parent.x;
	// initialise the sim
	sk.time = 0;
	sk.updateWorldTransform(Physics.reset);
	const hist = [];
	for (let f = 0; f < frames; f++) {
		sk.update(dt); // advances skeleton.time so the physics step has elapsed time
		// drive the parent along a ramp so the child has to chase it (induces lag/jiggle)
		parent.x = baseX + parentDx * ((f + 1) / frames);
		const phys = f === resetAt ? Physics.reset : Physics.update;
		sk.updateWorldTransform(phys);
		const b = sk.findBone(pick.bone);
		hist.push({ x: b.worldX, y: b.worldY, rot: b.getWorldRotationX() });
	}
	const b = sk.findBone(pick.bone);
	return { final: { x: b.worldX, y: b.worldY, rot: b.getWorldRotationX() }, hist, constraint: sk.physicsConstraints[0] };
}

// Same parent ramp but with NO physics constraint (baseline) — gives the "rigid" path the
// physics result must DIFFER from (secondary motion = lag away from the rigid follow).
function simulateBaseline({ frames = 20, dt = 1 / 60, parentDx = 200 } = {}) {
	const data = loadData(baseRaw);
	const sk = new Skeleton(data);
	sk.setToSetupPose();
	const parent = sk.findBone(pick.parent);
	const baseX = parent.x;
	const hist = [];
	for (let f = 0; f < frames; f++) {
		sk.update(dt);
		parent.x = baseX + parentDx * ((f + 1) / frames);
		try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }
		const b = sk.findBone(pick.bone);
		hist.push({ x: b.worldX, y: b.worldY, rot: b.getWorldRotationX() });
	}
	return { hist };
}

// (a) loader builds the PhysicsConstraint with the right defaults
{
	const raw = clone(baseRaw);
	raw.physics = [buildPc({})];
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'loader REJECTED physics setup — ' + e.message); }
	if (data) {
		log(data.physicsConstraints.length === 1, `loader built ${data.physicsConstraints.length} PhysicsConstraintData`);
		const d = data.physicsConstraints[0];
		log(d && d.bone && d.bone.name === pick.bone, `constraint drives bone "${d && d.bone && d.bone.name}"`);
		log(Math.abs(d.step - 1 / 60) < 1e-9, `fps 60 → data.step ${d.step.toFixed(5)} (== 1/60)`);
		log(d.massInverse === 1, `mass 1 → data.massInverse ${d.massInverse} (1/mass)`);
		log(d.inertia === 1 && d.strength === 100 && d.damping === 1 && d.mix === 1, `defaults: inertia ${d.inertia}, strength ${d.strength}, damping ${d.damping}, mix ${d.mix}`);
	}
}

// (a2) defaults when ALL optional fields are omitted (only name + bone given)
{
	const raw = clone(baseRaw);
	raw.physics = [{ name: 'spikePcMin', order: nextOrder(), bone: pick.bone, rotate: 1 }];
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'minimal physics setup REJECTED — ' + e.message); }
	if (data) {
		const d = data.physicsConstraints[0];
		log(Math.abs(d.step - 1 / 60) < 1e-9 && d.inertia === 1 && d.strength === 100 && d.damping === 1 && d.massInverse === 1 && d.wind === 0 && d.gravity === 0 && d.mix === 1 && Math.abs(d.limit - 5000) < 1e-6, `omitted-field defaults all correct (step ${d.step.toFixed(5)}, inertia ${d.inertia}, strength ${d.strength}, limit ${d.limit}, wind ${d.wind}, gravity ${d.gravity})`);
	}
}

// (b) SIMULATE — secondary motion: the driven bone's transform is FINITE, CHANGES over frames,
//     and DIFFERS from the no-physics rigid baseline.
{
	const raw = clone(baseRaw);
	raw.physics = [buildPc({})];
	const sim = simulate(raw, {});
	const allFinite = sim.hist.every((h) => Number.isFinite(h.x) && Number.isFinite(h.y) && Number.isFinite(h.rot));
	log(allFinite, `simulated transforms are all FINITE (no NaN) over ${sim.hist.length} frames`);
	const first = sim.hist[0], last = sim.hist[sim.hist.length - 1];
	const moved = Math.hypot(last.x - first.x, last.y - first.y) + Math.abs(last.rot - first.rot);
	log(moved > 1e-4, `driven bone CHANGES over the sim (Δ ${moved.toFixed(3)} across frames — secondary motion present)`);
	const base = simulateBaseline({});
	// compare the physics path to the rigid path at the LAST frame — physics should lag/differ
	const bl = base.hist[base.hist.length - 1];
	const diff = Math.hypot(last.x - bl.x, last.y - bl.y) + Math.abs(last.rot - bl.rot);
	log(diff > 1e-3, `physics path DIFFERS from the rigid no-physics baseline (Δ ${diff.toFixed(3)} — lag/jiggle vs rigid follow)`);
}

// (c) mix=0 → constraint contributes nothing: path == rigid baseline
{
	const raw = clone(baseRaw);
	raw.physics = [buildPc({ mix: 0 })];
	const sim = simulate(raw, {});
	const base = simulateBaseline({});
	const last = sim.hist[sim.hist.length - 1], bl = base.hist[base.hist.length - 1];
	const diff = Math.hypot(last.x - bl.x, last.y - bl.y) + Math.abs(last.rot - bl.rot);
	log(diff < 1e-3, `mix=0 → physics contributes nothing (Δ vs baseline ${diff.toFixed(5)})`);
}

// (d) reset re-initialises the sim — a Physics.reset mid-run snaps accumulated offset toward the
//     rigid follow (the post-reset frame is closer to the rigid baseline than the no-reset run).
{
	const raw = clone(baseRaw);
	raw.physics = [buildPc({})];
	const N = 20;
	const noReset = simulate(raw, { frames: N });
	const withReset = simulate(raw, { frames: N, resetAt: N - 1 }); // reset on the final frame
	const base = simulateBaseline({ frames: N });
	const bl = base.hist[N - 1];
	const dNo = Math.hypot(noReset.hist[N - 1].x - bl.x, noReset.hist[N - 1].y - bl.y);
	const dReset = Math.hypot(withReset.hist[N - 1].x - bl.x, withReset.hist[N - 1].y - bl.y);
	log(dReset <= dNo + 1e-6, `Physics.reset re-initialises the sim (post-reset dist-to-rigid ${dReset.toFixed(3)} ≤ accumulated ${dNo.toFixed(3)})`);
	const finite = Number.isFinite(withReset.final.x) && Number.isFinite(withReset.final.y) && Number.isFinite(withReset.final.rot);
	log(finite, `post-reset transform is finite & stable (x ${withReset.final.x.toFixed(2)} y ${withReset.final.y.toFixed(2)})`);
}

// -------------------------------------------------------------------- timeline tests
// Read the LIVE PhysicsConstraint sim-param the runtime sets at time t (the animated value).
const physParamAt = (raw, animName, t, prop) => {
	const data = loadData(raw);
	const sk = new Skeleton(data);
	sk.setToSetupPose();
	sk.time = 0;
	sk.updateWorldTransform(Physics.reset);
	data.findAnimation(animName).apply(sk, 0, t, false, [], 1, MixBlend.setup, MixDirection.mixIn);
	return sk.physicsConstraints[0][prop];
};

// (e) each sim-param channel loads as its own timeline and animates the live constraint value.
{
	const raw = clone(baseRaw);
	raw.physics = [buildPc({})];
	raw.animations = raw.animations || {};
	raw.animations.spikePcAnim = { physics: { spikePc: {
		inertia: [{ time: 0, value: 0 }, { time: 1, value: 1 }],
		strength: [{ time: 0, value: 50 }, { time: 1, value: 150 }],
		damping: [{ time: 0, value: 0.5 }, { time: 1, value: 1 }],
		mass: [{ time: 0, value: 1 }, { time: 1, value: 2 }],
		wind: [{ time: 0, value: 0 }, { time: 1, value: 10 }],
		gravity: [{ time: 0, value: 0 }, { time: 1, value: 20 }],
		mix: [{ time: 0, value: 0 }, { time: 1, value: 1 }],
		reset: [{ time: 0 }],
	} } };
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'physics timeline REJECTED — ' + e.message); }
	if (data) {
		const anim = data.findAnimation('spikePcAnim');
		log(!!anim, 'physics timeline animation loads');
		const names = anim ? anim.timelines.map((t) => t.constructor.name) : [];
		const want = ['Inertia', 'Strength', 'Damping', 'Mass', 'Wind', 'Gravity', 'Mix', 'Reset'];
		log(want.every((w) => names.some((n) => n.includes('PhysicsConstraint' + w))), `parsed all 8 physics timelines (${names.join(',')})`);

		log(Math.abs(physParamAt(raw, 'spikePcAnim', 0, 'inertia') - 0) < 1e-4, `inertia @t=0 == 0`);
		log(Math.abs(physParamAt(raw, 'spikePcAnim', 1, 'inertia') - 1) < 1e-4, `inertia @t=1 == 1`);
		log(Math.abs(physParamAt(raw, 'spikePcAnim', 0.5, 'inertia') - 0.5) < 1e-4, `inertia LINEAR @0.5 == 0.5`);
		log(Math.abs(physParamAt(raw, 'spikePcAnim', 0.5, 'strength') - 100) < 1e-3, `strength LINEAR @0.5 == 100 (mid of 50→150)`);
		// mass timeline animates massInverse: at t=1 mass 2 → massInverse 0.5
		const mi1 = physParamAt(raw, 'spikePcAnim', 1, 'massInverse');
		log(Math.abs(mi1 - 0.5) < 1e-3, `mass timeline @t=1 (mass 2) → massInverse ${mi1.toFixed(3)} (== 0.5)`);
		log(Math.abs(physParamAt(raw, 'spikePcAnim', 1, 'wind') - 10) < 1e-3, `wind @t=1 == 10`);
		log(Math.abs(physParamAt(raw, 'spikePcAnim', 1, 'gravity') - 20) < 1e-3, `gravity @t=1 == 20`);
		log(Math.abs(physParamAt(raw, 'spikePcAnim', 1, 'mix') - 1) < 1e-4, `mix @t=1 == 1`);
	}
}

// (f) bezier curve on a single channel (mix) — ease-in: value @0.5 < 0.5 and matches our evaluator
{
	const raw = clone(baseRaw);
	raw.physics = [buildPc({})];
	raw.animations = { spikePcBez: { physics: { spikePc: {
		mix: [{ time: 0, value: 0, curve: [0.42, 0, 1, 1] }, { time: 1, value: 1 }],
	} } } };
	let data = null;
	try { data = loadData(raw); } catch (e) { log(false, 'bezier physics timeline REJECTED — ' + e.message); }
	if (data) {
		log(!!data.findAnimation('spikePcBez'), 'bezier physics timeline loads');
		const v = physParamAt(raw, 'spikePcBez', 0.5, 'mix');
		const bezierValue = (t1, p1, cx1, cy1, cx2, cy2, t2, p2, t) => {
			if (t <= t1) return p1; if (t >= t2) return p2;
			const X = (s) => { const u = 1 - s; return u * u * u * t1 + 3 * u * u * s * cx1 + 3 * u * s * s * cx2 + s * s * s * t2; };
			const Y = (s) => { const u = 1 - s; return u * u * u * p1 + 3 * u * u * s * cy1 + 3 * u * s * s * cy2 + s * s * s * p2; };
			let lo = 0, hi = 1; for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (X(m) < t) lo = m; else hi = m; }
			return Y((lo + hi) / 2);
		};
		const pred = bezierValue(0, 0, 0.42, 0, 1, 1, 1, 1, 0.5);
		log(pred < 0.5, `our bezier evaluator ease-in @0.5 = ${pred.toFixed(3)} (< 0.5)`);
		log(Math.abs(v - pred) < 0.02, `runtime bezier mix VALUE @0.5 ${v.toFixed(3)} ≈ our evaluator ${pred.toFixed(3)}`);
	}
}

// -------------------------------------------------------------------- parity test
{
	loadData(baseRaw);
	log(!baseRaw.physics, 'base skeleton carries no `physics` array (parity)');
}

console.log(pass
	? '\n✅ PASS — physics setup (top-level `physics` array: SINGLE `bone`; x/y/rotate/scaleX/shearX 0..1 amounts default 0; `fps`→step=1/fps; `mass`→massInverse=1/mass; limit 5000, inertia 1, strength 100, damping 1, wind 0, gravity 0, mix 1; *Global bools) + physics timeline (animations.<a>.physics.<name> = {inertia|strength|damping|mass|wind|gravity|mix: [{time,value,curve?}], reset: [{time}]}) validated: loader builds it, sim is finite + changes + differs from rigid baseline, mix=0 is inert, Physics.reset re-inits, each channel animates the live param, linear + bezier(single channel) match the runtime.'
	: '\n✗ FAIL');
process.exit(pass ? 0 : 1);
