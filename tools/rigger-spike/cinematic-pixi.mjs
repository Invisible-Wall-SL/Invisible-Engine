// ⚠️ WHAT THIS GATE CANNOT PROVE (learned the hard way, 2026-08-17)
//
// It verifies the POSE contract against spine-pixi-v8 — which hook runs when, what an emptied
// AnimationState does, what a leftover track does. It has NO PIXI RENDER LOOP, so it cannot
// prove that a posed skeleton produces a CHANGED FRAME.
//
// That gap shipped a real bug: `<CinematicActor>` set `spine.autoUpdate = false` (the obvious
// reading of "we drive the pose ourselves"), which stops Pixi running its own update+render pass.
// Bones moved every frame and nothing was ever re-uploaded — rigs appeared, frozen in setup pose,
// in the first real game mount. `autoUpdate` must stay ON; an emptied AnimationState is inert
// (this gate proves that), so Pixi's own per-frame update is safe AND is what marks the geometry
// dirty.
//
// Anything about RENDERING belongs in a browser harness, not here.

// Invisible Cinematic — PHASE 0 GATE 3 (headless).
//
//   node tools/rigger-spike/cinematic-pixi.mjs
//
// The question (design §8 gate 3): can the shared evaluator drive a spine object rendered by
// `@esotericsoftware/spine-pixi-v8` — i.e. the game's renderer — with the object's own
// AnimationState bypassed? **If this fails, design decision 2 (a live in-game player) is wrong**
// and the fallback is per-actor AnimationState scheduling, which cannot express strip alpha,
// bone masks or deterministic scrubbing.
//
// It is proved in two halves, because Pixi 8 needs a GPU:
//   A. BEHAVIOURAL (real, headless) — `_updateAndApplyState`'s exact call sequence is replayed
//      with real spine-core objects, and the resulting pose is compared against the evaluator's.
//      This is where the actual risk lives: does an idle AnimationState corrupt our pose?
//   B. CALL-ORDER (asserted against the shipped dist source, not from memory) — that the
//      sequence replayed in A really is what Spine.js does, and that the view is marked dirty.
//
// The residual — that Pixi re-uploads the geometry and the frame visibly changes — is a LIVE
// check, listed in docs/status/cinematic.md. Do not read this gate as "verified in a browser".
//
// ======================= WHAT THE GATE ESTABLISHED =======================
//
// THE INTEGRATION CONTRACT (this is the shape the `<Cinematic>` component must use):
//
//   spine.autoUpdate = false;          // detaches it from Ticker.shared — nothing self-advances
//   spine.state.clearTracks();         // see "leftover tracks" below
//   spine.beforeUpdateWorldTransforms = () => evaluateActor(SPINE, actor, t, resolveClip);
//   // per frame:
//   t += dt * timeScale;
//   spine.update(dt);                  // → state.update → skeleton.update(physics) → OUR HOOK
//                                      //   → updateWorldTransform → slot objects → view dirty
//
// WHY `beforeUpdateWorldTransforms` AND NOT `after`: the hook runs AFTER `state.apply(skeleton)`
// and BEFORE `skeleton.updateWorldTransform()`. That is the only window where a pose both
// overrides the AnimationState and still gets its world transforms (and therefore its attachment
// vertices) computed. Posing in `afterUpdateWorldTransforms` writes local values that nothing
// re-resolves — the frame renders the PREVIOUS pose.
//
// AN EMPTY AnimationState IS INERT — `state.apply()` on a state with no tracks does not touch a
// single bone (proved below), so bypassing it costs nothing and needs no patched runtime.
//
// LEFTOVER TRACKS ARE NOT A POSE HAZARD BUT ARE AN EVENT HAZARD — because our evaluator opens
// with `setToSetupPose()`, anything `state.apply` wrote is discarded, so the POSE is safe. But
// `state.apply` still FIRES THE CLIP'S SPINE EVENTS every frame (proved below), which would
// spray phantom FX/sound cues through the game's event bus. `clearTracks()` is mandatory, and
// the reason is events, not pose — worth knowing when someone later "optimises" it away.
//
// PHYSICS still works: `skeleton.update(dt)` is called with the REAL frame delta before our
// hook, so physics constraints integrate normally while the cinematic's own clock is scrubbable.

import { readFileSync } from 'node:fs';
import { evaluateActor } from '../../packages/engine-cinematic/src/cinematicEval.js';

const CORE = new URL(
	'../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js',
	import.meta.url,
).href;
const SPINE = await import(CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, AnimationState, AnimationStateData, MixBlend, MixDirection, Physics } = SPINE;
const spineNs = { MixBlend, MixDirection, Physics };

const SPINE_PIXI_DIST = new URL(
	'../../node_modules/.pnpm/@esotericsoftware+spine-pixi-v8@4.2.74_pixi.js@8.8.1/node_modules/@esotericsoftware/spine-pixi-v8/dist/Spine.js',
	import.meta.url,
);

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) { pass++; console.log(`  ✓ ${name}`); }
	else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const section = (s) => console.log(`\n${s}`);

// ---- fixture --------------------------------------------------------------

const DIR = 'apps/lines/static/assets/spines/bigwin';
const atlas = new TextureAtlas(readFileSync(`${DIR}/big_wins.atlas`, 'utf8'));
const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
for (const p of atlas.pages) {
	p.width = 2048; p.height = 2048;
	try { p.setTexture(stub); } catch { p.texture = stub; }
}
const skeletonData = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
	JSON.parse(readFileSync(`${DIR}/mm_bigwin.json`, 'utf8')),
);
const skeleton = new Skeleton(skeletonData);

const poseSnapshot = (sk) => {
	sk.updateWorldTransform(Physics.update);
	const out = [];
	for (const b of sk.bones) out.push(b.a, b.b, b.c, b.d, b.worldX, b.worldY);
	return out;
};
const poseEqual = (p, q) => p.length === q.length && p.every((v, i) => v === q[i]);

// The cinematic under test: two layers, a crossfade and an additive masked top layer.
const actor = {
	skeleton,
	tracks: [
		{ kind: 'animation', layer: 0, strips: [
			{ start: 0, length: 1.6, clip: 'big_win_intro', loop: { mode: 'once' }, blendOut: 0.3 },
			{ start: 1.3, length: 4.0, clip: 'big_win_idle', loop: { mode: 'fill' }, blendIn: 0.3 },
		] },
		{ kind: 'animation', layer: 1, strips: [
			{ start: 0, length: 6, clip: 'epic_win_idle', loop: { mode: 'pingPong' }, blend: 'add', alpha: 0.4 },
		] },
	],
};
const resolveClip = (strip) => skeletonData.findAnimation(strip.clip);

// =========================================================================
section('A. Behavioural — the evaluator survives Spine.js\'s update sequence');
// =========================================================================
{
	// The evaluator's pose, standing alone (the reference).
	evaluateActor(spineNs, actor, 2.4, resolveClip);
	const reference = poseSnapshot(skeleton);

	// Replay `_updateAndApplyState(dt)` exactly, with the evaluator installed as
	// `beforeUpdateWorldTransforms`. (Order asserted against the dist source in part B.)
	const state = new AnimationState(new AnimationStateData(skeletonData));
	const replayUpdateAndApplyState = (dt, t, beforeUpdateWorldTransforms) => {
		state.update(dt);
		skeleton.update(dt);
		state.apply(skeleton);
		beforeUpdateWorldTransforms();
		skeleton.updateWorldTransform(Physics.update);
	};

	replayUpdateAndApplyState(1 / 60, 2.4, () => evaluateActor(spineNs, actor, 2.4, resolveClip));
	ok('pose survives the full update sequence, bit-for-bit', poseEqual(poseSnapshot(skeleton), reference));

	// An empty AnimationState must not touch the skeleton at all.
	skeleton.setToSetupPose();
	const setupPose = poseSnapshot(skeleton);
	const emptyState = new AnimationState(new AnimationStateData(skeletonData));
	emptyState.update(1 / 60);
	const applied = emptyState.apply(skeleton);
	ok('state.apply() with no tracks reports "nothing applied"', applied === false, `returned ${applied}`);
	ok('state.apply() with no tracks leaves the pose untouched', poseEqual(poseSnapshot(skeleton), setupPose));

	// A LEFTOVER track: pose stays safe (setToSetupPose discards it) …
	const dirty = new AnimationState(new AnimationStateData(skeletonData));
	dirty.setAnimation(0, 'mega_win_idle', true);
	dirty.update(0.5);
	replayUpdateAndApplyState(1 / 60, 2.4, () => evaluateActor(spineNs, actor, 2.4, resolveClip));
	ok('a leftover AnimationState track cannot corrupt the pose', poseEqual(poseSnapshot(skeleton), reference));

	// … but it DOES keep firing the clip's spine events — the real reason to clearTracks().
	const heard = [];
	dirty.addListener({ event: (_entry, ev) => heard.push(ev.data.name) });
	const evAnim = [...skeletonData.animations].find((a) => a.timelines.some((tl) => tl.constructor.name.includes('Event')));
	if (evAnim) {
		dirty.setAnimation(0, evAnim.name, true);
		for (let i = 0; i < 120; i++) { dirty.update(1 / 60); dirty.apply(skeleton); }
		ok('a leftover track sprays phantom events ⇒ clearTracks() is mandatory', heard.length > 0, `heard ${heard.length}`);
	} else {
		ok('fixture has no event timeline — event hazard asserted from the API contract only', true);
	}

	// Posing in `after…` instead would render the PREVIOUS pose: prove the world transforms
	// do not reflect a local-value write that happens after updateWorldTransform.
	skeleton.setToSetupPose();
	skeleton.updateWorldTransform(Physics.update);
	const beforeWrite = skeleton.bones.map((b) => [b.a, b.b, b.c, b.d, b.worldX, b.worldY].join(','));
	const bone = skeleton.bones.find((b) => b.parent != null);
	bone.rotation += 30; // a post-updateWorldTransform local write, i.e. the `after` hook
	const afterWrite = skeleton.bones.map((b) => [b.a, b.b, b.c, b.d, b.worldX, b.worldY].join(','));
	ok(
		'posing after updateWorldTransform does NOT reach the world transforms (⇒ use the BEFORE hook)',
		beforeWrite.join('|') === afterWrite.join('|'),
	);

	// Determinism holds through the integration too: scrub vs play, via the same sequence.
	const scrubbed = new Map();
	for (const t of [3.1, 0.4, 2.0, 1.45, 5.9]) {
		replayUpdateAndApplyState(0, t, () => evaluateActor(spineNs, actor, t, resolveClip));
		scrubbed.set(t, poseSnapshot(skeleton));
	}
	let drift = 0;
	for (let t = 0; t <= 6; t += 1 / 60) {
		const tt = Number(t.toFixed(6));
		replayUpdateAndApplyState(1 / 60, tt, () => evaluateActor(spineNs, actor, tt, resolveClip));
		if (scrubbed.has(tt) && !poseEqual(poseSnapshot(skeleton), scrubbed.get(tt))) drift++;
	}
	for (const [t, ref] of scrubbed) {
		replayUpdateAndApplyState(1 / 60, t, () => evaluateActor(spineNs, actor, t, resolveClip));
		if (!poseEqual(poseSnapshot(skeleton), ref)) drift++;
	}
	ok('scrub === play through the pixi update sequence', drift === 0, `${drift} drifted samples`);
}

// =========================================================================
section('B. Call order — asserted against the SHIPPED spine-pixi-v8 dist');
// =========================================================================
{
	const src = readFileSync(SPINE_PIXI_DIST, 'utf8');
	const body = src.slice(src.indexOf('_updateAndApplyState(time)'));
	const at = (needle) => body.indexOf(needle);

	const iStateUpdate = at('this.state.update(time)');
	const iSkelUpdate = at('this.skeleton.update(time)');
	const iApply = at('this.state.apply(skeleton)');
	const iBefore = at('this.beforeUpdateWorldTransforms(this)');
	const iWorld = at('skeleton.updateWorldTransform(Physics.update)');
	const iAfter = at('this.afterUpdateWorldTransforms(this)');
	const iSlots = at('this.updateSlotObjects()');
	const iDirty = at('this._stateChanged = true');
	const iView = at('this.onViewUpdate()');

	ok('all nine steps found in the shipped source', [iStateUpdate, iSkelUpdate, iApply, iBefore, iWorld, iAfter, iSlots, iDirty, iView].every((i) => i > 0));
	ok(
		'order is state.update → skeleton.update → state.apply → BEFORE hook → updateWorldTransform → AFTER hook → slots',
		iStateUpdate < iSkelUpdate && iSkelUpdate < iApply && iApply < iBefore && iBefore < iWorld && iWorld < iAfter && iAfter < iSlots,
	);
	ok('the update marks the view dirty (so the pose we wrote actually re-renders)', iDirty > iSlots && iView > iDirty);

	ok('`update(dt)` is public and routes into that sequence', /update\(dt\)\s*\{\s*this\.internalUpdate\(0, dt\)/.test(src));
	ok('`autoUpdate = false` detaches the shared ticker', /set autoUpdate\(value\)[\s\S]{0,220}Ticker\.shared\.remove\(this\.internalUpdate, this\)/.test(src));
	ok('`skeleton` and `state` are public fields we may drive', /^\s*skeleton;/m.test(src) && /^\s*state;/m.test(src));
	ok('`beforeUpdateWorldTransforms` is an assignable no-op hook', /beforeUpdateWorldTransforms = \(\) => \{/.test(src) || /beforeUpdateWorldTransforms\s*=/.test(src));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail}`);
console.log('\nRESIDUAL (live check, not proved here): that Pixi re-uploads the geometry and the');
console.log('frame visibly changes. Tracked in docs/status/cinematic.md.');
process.exit(fail === 0 ? 0 : 1);
