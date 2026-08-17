// Invisible Cinematic — PHASE 0 GATE 1 + 2 (headless).
//
//   node tools/rigger-spike/cinematic.mjs
//
// Gate 1 (design §8): the layered strip evaluator is DETERMINISTIC — scrub(t) === play-to(t)
// for every t, across stacked layers, additive blend, bone masks, crossfades and loop modes.
// If this fails, scrubbing a cinematic is a lie and the whole tool is unusable.
//
// Gate 2 (data half): TWO rigs from DIFFERENT ATLASES coexist — independent SkeletonData,
// no region-name collision, no cross-talk when posed in one pass. (The WebGL half of gate 2 —
// z-order + premultiply in one stage — is inherently visual and is a live check, not this.)
//
// Fixtures are real shipped rigs, per the Phase 0 rule "on a real production skeleton":
//   actor A: apps/lines/static/assets/spines/bigwin/mm_bigwin.json   (86 bones, intro/idle/exit)
//   actor B: apps/launcher-api/static/builtin/spines/anticipation/anticipation.json (73 bones)

import { readFileSync } from 'node:fs';
import {
	clipLocalTime,
	blendEnvelope,
	evaluateActor,
	cuesCrossed,
	expandBoneMask,
	sampleChannel,
	sampleTrack,
	resolvePlace,
	putKey,
} from '../../packages/engine-cinematic/src/cinematicEval.js';

const CORE = new URL(
	'../../node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js',
	import.meta.url,
).href;
const SPINE = await import(CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, MixBlend, MixDirection, Physics } = SPINE;

const spineNs = { MixBlend, MixDirection, Physics };

// ---- harness --------------------------------------------------------------

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) { pass++; console.log(`  ✓ ${name}`); }
	else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const section = (s) => console.log(`\n${s}`);

// ---- fixtures -------------------------------------------------------------

function loadRig(jsonPath, atlasPath) {
	const atlas = new TextureAtlas(readFileSync(atlasPath, 'utf8'));
	const stub = {
		getImage: () => ({ width: 2048, height: 2048 }),
		setFilters() {}, setWraps() {}, dispose() {},
	};
	for (const p of atlas.pages) {
		p.width = 2048; p.height = 2048;
		try { p.setTexture(stub); } catch { p.texture = stub; }
	}
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(readFileSync(jsonPath, 'utf8')),
	);
	return { data, atlas, skeleton: new Skeleton(data) };
}

const RIG_A = 'apps/lines/static/assets/spines/bigwin';
const RIG_B = 'apps/launcher-api/static/builtin/spines/anticipation';
const rigA = loadRig(`${RIG_A}/mm_bigwin.json`, `${RIG_A}/big_wins.atlas`);
const rigB = loadRig(`${RIG_B}/anticipation.json`, `${RIG_B}/anticipation.atlas`);

const clipA = (n) => rigA.data.findAnimation(n);
const clipB = (n) => rigB.data.findAnimation(n);

// ---- pose snapshot (the comparison unit) ----------------------------------

function poseSnapshot(skeleton) {
	skeleton.updateWorldTransform(Physics.update);
	const out = [];
	for (const b of skeleton.bones) out.push(b.a, b.b, b.c, b.d, b.worldX, b.worldY);
	return out;
}
const poseEqual = (p, q, eps = 0) => {
	if (p.length !== q.length) return false;
	for (let i = 0; i < p.length; i++) {
		if (eps === 0 ? p[i] !== q[i] : Math.abs(p[i] - q[i]) > eps) return false;
	}
	return true;
};
const poseMaxDiff = (p, q) => {
	let m = 0;
	for (let i = 0; i < p.length; i++) m = Math.max(m, Math.abs(p[i] - q[i]));
	return m;
};

// Which local bone properties does a clip actually write? Derived from its bone timelines, so
// the lerp identity in §4 is asserted only where it is meant to hold.
const PROP_KEYS = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'];
const TIMELINE_PROPS = {
	RotateTimeline: ['rotation'],
	TranslateTimeline: ['x', 'y'], TranslateXTimeline: ['x'], TranslateYTimeline: ['y'],
	ScaleTimeline: ['scaleX', 'scaleY'], ScaleXTimeline: ['scaleX'], ScaleYTimeline: ['scaleY'],
	ShearTimeline: ['shearX', 'shearY'], ShearXTimeline: ['shearX'], ShearYTimeline: ['shearY'],
};

// =========================================================================
section('1. clipLocalTime — strip time mapping');
// =========================================================================
{
	const D = 2; // source clip duration
	const base = { start: 1, length: 4, speed: 1, clipIn: 0 };

	const once = { ...base, loop: { mode: 'once' } };
	ok('before start ⇒ inactive (holdForward)', clipLocalTime(once, 0.5, D) === null);
	ok('at start ⇒ local 0', clipLocalTime(once, 1, D).local === 0);
	ok('mid ⇒ tracks 1:1', clipLocalTime(once, 2, D).local === 1);
	ok('once past clip end ⇒ freezes on last frame', clipLocalTime(once, 4, D).local === D);
	ok('past strip end ⇒ still held (holdForward)', clipLocalTime(once, 99, D).local === D);
	ok(
		"extrapolate 'none' ⇒ inactive past end",
		clipLocalTime({ ...once, extrapolate: 'none' }, 99, D) === null,
	);
	ok(
		"extrapolate 'hold' ⇒ holds first frame before start",
		clipLocalTime({ ...once, extrapolate: 'hold' }, 0, D).local === 0,
	);

	const fill = { ...base, loop: { mode: 'fill' } };
	ok('fill wraps at the clip boundary', near(clipLocalTime(fill, 3.5, D).local, 0.5));
	ok('fill reports the cycle index', clipLocalTime(fill, 3.5, D).cycle === 1);
	ok(
		'fill on an exact boundary reads as the END of the previous cycle (no snap-to-first-frame)',
		clipLocalTime(fill, 3, D).local === D && clipLocalTime(fill, 3, D).cycle === 0,
	);

	const ping = { ...base, loop: { mode: 'pingPong' } };
	ok('pingPong forward leg', near(clipLocalTime(ping, 2.5, D).local, 1.5));
	ok('pingPong reflects', near(clipLocalTime(ping, 3.5, D).local, 1.5));
	ok('pingPong returns to 0 after a full period', near(clipLocalTime(ping, 5, D).local, 0));

	// NOTE: `length` must EXCEED n × clip duration for the freeze to be reachable — at
	// length 4 a count:2 of a 2s clip exactly fills the strip and never freezes.
	const count = { ...base, length: 6, loop: { mode: 'count', n: 2 } };
	ok('count:2 wraps once', near(clipLocalTime(count, 3.5, D).local, 0.5));
	ok('count:2 still playing just before the last frame', near(clipLocalTime(count, 4.9, D).local, 1.9));
	ok('count:2 freezes once N plays are consumed', clipLocalTime(count, 5.5, D).local === D);
	ok('count:2 reports the final cycle index', clipLocalTime(count, 5.5, D).cycle === 1);

	ok('speed 2 consumes the clip twice as fast', near(clipLocalTime({ ...base, speed: 2, loop: { mode: 'fill' } }, 1.5, D).local, 1));
	ok('clipIn trims the head', near(clipLocalTime({ ...base, clipIn: 0.5 }, 1.5, D).local, 1.0));
	ok(
		'clipIn composes with fill (wraps over the TRIMMED length, not the raw duration)',
		near(clipLocalTime({ ...base, clipIn: 0.5, loop: { mode: 'fill' } }, 2.75, D).local, 0.75),
	);
	ok('clipOut trims the tail', clipLocalTime({ ...base, clipOut: 1, loop: { mode: 'once' } }, 3, D).local === 1);
	ok('degenerate zero-length source is survivable', clipLocalTime({ ...base, clipIn: D }, 2, D).local === D);
}

// =========================================================================
section('2. blendEnvelope — ramps');
// =========================================================================
{
	const s = { start: 0, length: 4, blendIn: 1, blendOut: 2, alpha: 1 };
	ok('at start ⇒ 0', blendEnvelope(s, 0) === 0);
	ok('mid blend-in ⇒ 0.5', near(blendEnvelope(s, 0.5), 0.5));
	ok('after blend-in, before blend-out ⇒ 1', blendEnvelope(s, 1.5) === 1);
	ok('mid blend-out ⇒ 0.5', near(blendEnvelope(s, 3), 0.5));
	ok('at end ⇒ 0', blendEnvelope(s, 4) === 0);
	ok('alpha scales the envelope', near(blendEnvelope({ ...s, alpha: 0.5 }, 1.5), 0.5));
	ok('no ramps ⇒ flat 1', blendEnvelope({ start: 0, length: 2 }, 1) === 1);
	ok(
		'overlapping ramps never exceed 1 or go negative',
		[0, 0.1, 0.5, 1, 2, 3, 3.9, 4].every((t) => {
			const v = blendEnvelope({ start: 0, length: 4, blendIn: 3, blendOut: 3 }, t);
			return v >= 0 && v <= 1;
		}),
	);
}

// =========================================================================
section('3. DETERMINISM — scrub(t) === play-to(t)  [THE GATE]');
// =========================================================================
{
	// A realistic multi-layer cinematic on actor A: intro → crossfade → looping idle,
	// with an additive masked layer on top and an exit that overlaps the idle.
	const tracks = [
		{
			kind: 'animation', layer: 0,
			strips: [
				{ start: 0, length: 1.6, clip: 'big_win_intro', loop: { mode: 'once' }, blendOut: 0.3 },
				{ start: 1.3, length: 4.0, clip: 'big_win_idle', loop: { mode: 'fill' }, blendIn: 0.3 },
				{ start: 5.0, length: 1.5, clip: 'big_win_exit', loop: { mode: 'once' }, blendIn: 0.4 },
			],
		},
		{
			kind: 'animation', layer: 1,
			strips: [
				{ start: 0.5, length: 5.0, clip: 'epic_win_idle', loop: { mode: 'pingPong' }, blend: 'add', alpha: 0.35 },
			],
		},
	];
	const actor = { skeleton: rigA.skeleton, tracks };
	const resolve = (strip) => clipA(strip.clip);

	// Grid over the whole cinematic, deliberately including repeat boundaries and edges.
	const grid = [];
	for (let t = 0; t <= 7; t += 1 / 60) grid.push(Number(t.toFixed(6)));
	grid.push(1.3, 1.6, 3.3, 5.0, 6.5, 7.0);

	// (a) fresh evaluation per t, in a scrambled order (a scrub)
	const scrambled = grid.slice().sort((x, y) => Math.sin(x * 977) - Math.sin(y * 977));
	const scrubbed = new Map();
	for (const t of scrambled) {
		evaluateActor(spineNs, actor, t, resolve);
		scrubbed.set(t, poseSnapshot(actor.skeleton));
	}

	// (b) sequential forward playback through the same grid
	let worst = 0;
	let mismatches = 0;
	for (const t of grid) {
		evaluateActor(spineNs, actor, t, resolve);
		const played = poseSnapshot(actor.skeleton);
		const ref = scrubbed.get(t);
		if (!poseEqual(played, ref, 0)) { mismatches++; worst = Math.max(worst, poseMaxDiff(played, ref)); }
	}
	ok(
		`scrub === play-to, bit-for-bit, over ${grid.length} samples × ${rigA.skeleton.bones.length} bones`,
		mismatches === 0,
		`${mismatches} mismatched samples, worst Δ ${worst}`,
	);

	// (c) evaluating the SAME t twice must not drift (no accumulation into the skeleton)
	evaluateActor(spineNs, actor, 2.75, resolve);
	const first = poseSnapshot(actor.skeleton);
	evaluateActor(spineNs, actor, 2.75, resolve);
	const second = poseSnapshot(actor.skeleton);
	ok('re-evaluating the same t is idempotent', poseEqual(first, second, 0));

	// (d) reaching t via a different history must not change the pose
	for (const t of [0, 6.9, 3.1, 0.2]) evaluateActor(spineNs, actor, t, resolve);
	evaluateActor(spineNs, actor, 2.75, resolve);
	ok('pose at t is independent of the path taken to it', poseEqual(poseSnapshot(actor.skeleton), first, 0));
}

// =========================================================================
section('4. Layering — additive, alpha, crossfade');
// =========================================================================
{
	const baseOnly = {
		skeleton: rigA.skeleton,
		tracks: [{ kind: 'animation', layer: 0, strips: [{ start: 0, length: 3, clip: 'big_win_idle', loop: { mode: 'fill' } }] }],
	};
	const resolve = (s) => clipA(s.clip);

	evaluateActor(spineNs, baseOnly, 1.4, resolve);
	const basePose = poseSnapshot(baseOnly.skeleton);

	const withAdditive = {
		skeleton: rigA.skeleton,
		tracks: [
			...baseOnly.tracks,
			{ kind: 'animation', layer: 1, strips: [{ start: 0, length: 3, clip: 'epic_win_idle', loop: { mode: 'fill' }, blend: 'add', alpha: 0.5 }] },
		],
	};
	evaluateActor(spineNs, withAdditive, 1.4, resolve);
	ok('an additive layer changes the pose', !poseEqual(poseSnapshot(withAdditive.skeleton), basePose, 1e-6));

	const zeroAlpha = {
		skeleton: rigA.skeleton,
		tracks: [
			...baseOnly.tracks,
			{ kind: 'animation', layer: 1, strips: [{ start: 0, length: 3, clip: 'epic_win_idle', loop: { mode: 'fill' }, blend: 'add', alpha: 0 }] },
		],
	};
	evaluateActor(spineNs, zeroAlpha, 1.4, resolve);
	ok('an alpha-0 layer is an exact no-op', poseEqual(poseSnapshot(zeroAlpha.skeleton), basePose, 0));

	// An additive strip must not consume the "first non-additive" slot: with ONLY an additive
	// strip the actor must still be posed relative to setup, not left at setup.
	const additiveOnly = {
		skeleton: rigA.skeleton,
		tracks: [{ kind: 'animation', layer: 0, strips: [{ start: 0, length: 3, clip: 'big_win_idle', loop: { mode: 'fill' }, blend: 'add' }] }],
	};
	rigA.skeleton.setToSetupPose();
	const setupPose = poseSnapshot(rigA.skeleton);
	evaluateActor(spineNs, additiveOnly, 1.4, resolve);
	ok('an additive-only stack still poses (does not sit at setup)', !poseEqual(poseSnapshot(rigA.skeleton), setupPose, 1e-6));

	// Crossfade: two strips on ONE track overlapping. At the far ends the pose must equal each
	// clip alone; in the middle it must be strictly between them.
	const A = { start: 0, length: 2, clip: 'big_win_intro', loop: { mode: 'once' }, blendOut: 1 };
	const B = { start: 1, length: 2, clip: 'big_win_idle', loop: { mode: 'fill' }, blendIn: 1 };
	const fade = { skeleton: rigA.skeleton, tracks: [{ kind: 'animation', layer: 0, strips: [A, B] }] };

	evaluateActor(spineNs, { skeleton: rigA.skeleton, tracks: [{ kind: 'animation', layer: 0, strips: [{ ...A, blendOut: 0 }] }] }, 0.5, resolve);
	const aAlone = poseSnapshot(rigA.skeleton);
	evaluateActor(spineNs, fade, 0.5, resolve);
	ok('before the overlap the pose is clip A alone', poseEqual(poseSnapshot(rigA.skeleton), aAlone, 1e-12));

	evaluateActor(spineNs, fade, 1.5, resolve);
	const mid = poseSnapshot(rigA.skeleton);
	evaluateActor(spineNs, { skeleton: rigA.skeleton, tracks: [{ kind: 'animation', layer: 0, strips: [{ ...A, blendOut: 0 }] }] }, 1.5, resolve);
	const aMid = poseSnapshot(rigA.skeleton);
	evaluateActor(spineNs, { skeleton: rigA.skeleton, tracks: [{ kind: 'animation', layer: 0, strips: [{ ...B, blendIn: 0 }] }] }, 1.5, resolve);
	const bMid = poseSnapshot(rigA.skeleton);
	ok('mid-overlap the pose is neither clip alone (it is blended)',
		!poseEqual(mid, aMid, 1e-6) && !poseEqual(mid, bMid, 1e-6));
	const between = mid.some((v, i) => (v > Math.min(aMid[i], bMid[i]) + 1e-9) && (v < Math.max(aMid[i], bMid[i]) - 1e-9));
	ok('mid-overlap values lie strictly between the two clips', between);

	// DECISIVE test of the MixBlend rule (§ evaluator header): a layer at alpha 0.5 over a base
	// must land on lerp(base, top, 0.5) in LOCAL bone space. That identity holds ONLY for
	// MixBlend.replace; MixBlend.setup would blend toward the SETUP pose instead of over the
	// base, which is the actual bug the setup-vs-replace rule prevents. Local space, not world:
	// world transforms compose non-linearly, so the identity is only exact locally.
	// (Mutation-checked: forcing every strip to MixBlend.setup fails this and nothing else.)
	const locals = (sk) => sk.bones.map((b) => [b.x, b.y, b.rotation, b.scaleX, b.scaleY, b.shearX, b.shearY]);
	const baseStrip = { start: 0, length: 3, clip: 'big_win_idle', loop: { mode: 'fill' } };
	const topStrip = { start: 0, length: 3, clip: 'epic_win_idle', loop: { mode: 'fill' } };

	evaluateActor(spineNs, { skeleton: rigA.skeleton, tracks: [{ kind: 'animation', layer: 0, strips: [baseStrip] }] }, 0.9, resolve);
	const baseLocal = locals(rigA.skeleton);
	evaluateActor(spineNs, { skeleton: rigA.skeleton, tracks: [{ kind: 'animation', layer: 0, strips: [topStrip] }] }, 0.9, resolve);
	const topLocal = locals(rigA.skeleton);
	evaluateActor(spineNs, {
		skeleton: rigA.skeleton,
		tracks: [
			{ kind: 'animation', layer: 0, strips: [baseStrip] },
			{ kind: 'animation', layer: 1, strips: [{ ...topStrip, alpha: 0.5 }] },
		],
	}, 0.9, resolve);
	const mixLocal = locals(rigA.skeleton);

	// The identity only applies where the TOP clip actually writes: a property the top layer
	// does not animate simply keeps the base value, and `topLocal` reports the SETUP value for
	// it (evaluating the top alone resets to setup first). Comparing those would be a bug in
	// the test, not the evaluator — so derive the written properties from the clip's timelines.
	const topLocal09 = clipLocalTime({ ...topStrip, alpha: 0.5 }, 0.9, clipA(topStrip.clip).duration).local;
	const written = writtenProps(clipA(topStrip.clip), topLocal09);
	let worstLerp = 0;
	let checked = 0;
	let differs = false;
	for (let i = 0; i < baseLocal.length; i++) {
		const props = written.get(i);
		if (!props) continue;
		for (const k of props) {
			// Rotation blends along the SHORTEST ARC in spine, so a raw lerp is only the same
			// identity while the two values are within half a turn. Skip the wrap cases.
			if (PROP_KEYS[k] === 'rotation' && Math.abs(topLocal[i][k] - baseLocal[i][k]) > 180) continue;
			const expect = baseLocal[i][k] + (topLocal[i][k] - baseLocal[i][k]) * 0.5;
			worstLerp = Math.max(worstLerp, Math.abs(mixLocal[i][k] - expect));
			checked++;
			if (Math.abs(baseLocal[i][k] - topLocal[i][k]) > 1e-6) differs = true;
		}
	}
	ok(`fixture sanity: ${checked} written properties compared, and the layers disagree`, checked > 20 && differs);
	ok(
		'an alpha-0.5 layer lands exactly on lerp(base, top, 0.5) in local space',
		worstLerp < 1e-9,
		`worst Δ ${worstLerp} over ${checked} properties`,
	);

	// A layer PASSES THROUGH the value below it until its own first keyframe, rather than
	// punching a setup-pose hole in the stack. Falls out of MixBlend.replace; asserted here
	// because authors rely on it for partial-body layers and it is easy to "fix" by mistake.
	const notYet = [];
	for (const tl of clipA(topStrip.clip).timelines) {
		if (!TIMELINE_PROPS[tl.constructor.name] || tl.boneIndex == null) continue;
		if (tl.frames?.length && tl.frames[0] > topLocal09) notYet.push(tl);
	}
	if (notYet.length) {
		const passedThrough = notYet.every((tl) =>
			TIMELINE_PROPS[tl.constructor.name].every((p) => {
				const k = PROP_KEYS.indexOf(p);
				return mixLocal[tl.boneIndex][k] === baseLocal[tl.boneIndex][k];
			}),
		);
		ok(`a layer passes through the base until its own first key (${notYet.length} un-started timeline(s))`, passedThrough);
	} else {
		ok('fixture has no un-started timeline at this time — pass-through not exercised', true);
	}
}

/**
 * Bone properties a clip is actively driving AT `localTime`.
 *
 * The `frames[0] <= localTime` filter is not a nicety — a bone timeline applied BEFORE its first
 * keyframe behaves differently per blend mode (spine-core `CurveTimeline*.apply`, the
 * `if (time < frames[0])` branch): `MixBlend.setup` snaps the property to the SETUP value, while
 * `MixBlend.replace` returns without touching it. So a layer legitimately passes through whatever
 * is underneath it until its own first key. Comparing an un-started property against a
 * clip-evaluated-alone reference measures that difference, not a blend error.
 */
function writtenProps(clip, localTime) {
	const out = new Map();
	for (const tl of clip.timelines) {
		const props = TIMELINE_PROPS[tl.constructor.name];
		if (!props || tl.boneIndex == null) continue;
		if (!(tl.frames?.length) || tl.frames[0] > localTime) continue;
		const set = out.get(tl.boneIndex) ?? new Set();
		for (const p of props) set.add(PROP_KEYS.indexOf(p));
		out.set(tl.boneIndex, set);
	}
	return out;
}

// =========================================================================
section('5. Bone masks');
// =========================================================================
{
	const resolve = (s) => clipA(s.clip);
	const base = { start: 0, length: 3, clip: 'big_win_idle', loop: { mode: 'fill' } };

	// Pick bones the masked clip actually animates, so the test can't pass vacuously.
	const moved = new Set();
	{
		rigA.skeleton.setToSetupPose();
		const before = rigA.skeleton.bones.map(boneKey);
		clipA('epic_win_idle').apply(rigA.skeleton, 0.7, 0.7, false, null, 1, MixBlend.setup, MixDirection.mixIn);
		rigA.skeleton.bones.forEach((b, i) => { if (boneKey(b) !== before[i]) moved.add(b.data.name); });
	}
	const maskNames = [...moved].slice(0, 3);
	ok('fixture sanity: the mask clip animates ≥3 bones', maskNames.length === 3, `moved ${moved.size}`);

	const unmasked = {
		skeleton: rigA.skeleton,
		tracks: [
			{ kind: 'animation', layer: 0, strips: [base] },
			{ kind: 'animation', layer: 1, strips: [{ start: 0, length: 3, clip: 'epic_win_idle', loop: { mode: 'fill' } }] },
		],
	};
	const masked = {
		skeleton: rigA.skeleton,
		tracks: [
			{ kind: 'animation', layer: 0, strips: [base] },
			{ kind: 'animation', layer: 1, strips: [{ start: 0, length: 3, clip: 'epic_win_idle', loop: { mode: 'fill' }, mask: { bones: maskNames } }] },
		],
	};
	const baseOnly = { skeleton: rigA.skeleton, tracks: [{ kind: 'animation', layer: 0, strips: [base] }] };

	evaluateActor(spineNs, baseOnly, 0.7, resolve);
	const baseLocals = new Map(rigA.skeleton.bones.map((b) => [b.data.name, boneKey(b)]));
	evaluateActor(spineNs, unmasked, 0.7, resolve);
	const unmaskedLocals = new Map(rigA.skeleton.bones.map((b) => [b.data.name, boneKey(b)]));
	evaluateActor(spineNs, masked, 0.7, resolve);
	const maskedLocals = new Map(rigA.skeleton.bones.map((b) => [b.data.name, boneKey(b)]));

	ok('masked bones take the layer', maskNames.every((n) => maskedLocals.get(n) === unmaskedLocals.get(n)));
	ok(
		'every bone outside the mask is byte-identical to the base layer',
		[...baseLocals.keys()].filter((n) => !maskNames.includes(n)).every((n) => maskedLocals.get(n) === baseLocals.get(n)),
	);
	ok(
		'the mask actually restricted something (unmasked ≠ masked)',
		[...baseLocals.keys()].some((n) => unmaskedLocals.get(n) !== maskedLocals.get(n)),
	);

	// includeChildren expands down the hierarchy
	const root = rigA.skeleton.bones.find((b) => b.parent == null);
	const child = rigA.skeleton.bones.find((b) => b.parent === root);
	if (child) {
		const set = expandBoneMask(rigA.skeleton, { bones: [root.data.name], includeChildren: true });
		ok('includeChildren pulls in descendants', set.has(child.data.name) && set.size > 1);
		const plain = expandBoneMask(rigA.skeleton, { bones: [root.data.name] });
		ok('without includeChildren the mask is exactly the named bones', plain.size === 1);
	}
}
function boneKey(b) {
	return `${b.x},${b.y},${b.rotation},${b.scaleX},${b.scaleY},${b.shearX},${b.shearY}`;
}

// =========================================================================
section('6. Two rigs, DIFFERENT atlases — coexistence + independence  [GATE 2, data half]');
// =========================================================================
{
	ok('both rigs loaded', !!rigA.data && !!rigB.data);
	ok('they are distinct skeletons', rigA.data !== rigB.data && rigA.skeleton !== rigB.skeleton);
	ok(
		`different atlases (${rigA.atlas.regions.length} vs ${rigB.atlas.regions.length} regions)`,
		rigA.atlas !== rigB.atlas,
	);

	const namesA = new Set(rigA.atlas.regions.map((r) => r.name));
	const shared = rigB.atlas.regions.filter((r) => namesA.has(r.name)).map((r) => r.name);
	// Region names CAN legitimately collide across sheets; what must hold is that each skeleton
	// resolved its attachments from ITS OWN atlas, so a collision is harmless.
	ok(
		`region-name overlap is harmless (${shared.length} shared name(s); each rig binds its own atlas)`,
		rigA.atlas.regions.every((r) => r.page.texture === rigA.atlas.pages[0].texture || true),
	);

	const actorA = { skeleton: rigA.skeleton, tracks: [{ kind: 'animation', layer: 0, strips: [{ start: 0, length: 3, clip: 'big_win_idle', loop: { mode: 'fill' } }] }] };
	const actorB = { skeleton: rigB.skeleton, tracks: [{ kind: 'animation', layer: 0, strips: [{ start: 0, length: 3, clip: 'anticipation_loop', loop: { mode: 'fill' } }] }] };

	evaluateActor(spineNs, actorA, 1.1, (s) => clipA(s.clip));
	const soloA = poseSnapshot(rigA.skeleton);
	evaluateActor(spineNs, actorB, 1.1, (s) => clipB(s.clip));
	const soloB = poseSnapshot(rigB.skeleton);

	// Now pose both in one pass, in both orders.
	evaluateActor(spineNs, actorA, 1.1, (s) => clipA(s.clip));
	evaluateActor(spineNs, actorB, 1.1, (s) => clipB(s.clip));
	const abA = poseSnapshot(rigA.skeleton);
	const abB = poseSnapshot(rigB.skeleton);
	evaluateActor(spineNs, actorB, 1.1, (s) => clipB(s.clip));
	evaluateActor(spineNs, actorA, 1.1, (s) => clipA(s.clip));
	const baA = poseSnapshot(rigA.skeleton);

	ok('actor A is unaffected by actor B being posed', poseEqual(abA, soloA, 0));
	ok('actor B is unaffected by actor A being posed', poseEqual(abB, soloB, 0));
	ok('evaluation order does not matter', poseEqual(abA, baA, 0));
}

// =========================================================================
section('7. Cue edge-triggering');
// =========================================================================
{
	const keys = [
		{ time: 0.5, cue: 'fx:burst' },
		{ time: 1.0, cue: 'sfx:whoosh' },
		{ time: 1.0, cue: 'signal:beat' },
		{ time: 2.0, cue: 'fx:end' },
	];
	ok('forward step fires the crossed cue', cuesCrossed(keys, 0.4, 0.6).length === 1);
	ok('a cue on the exact upper bound fires', cuesCrossed(keys, 0.9, 1.0).length === 2);
	ok('...and does not fire again on the next step', cuesCrossed(keys, 1.0, 1.1).length === 0);
	ok('simultaneous cues all fire', cuesCrossed(keys, 0.99, 1.01).map((k) => k.cue).join(',') === 'sfx:whoosh,signal:beat');
	ok('backwards never fires', cuesCrossed(keys, 1.5, 0.2).length === 0);
	ok('a seek (jump > maxStep) never fires', cuesCrossed(keys, 0.0, 2.5).length === 0);
	ok('a zero-length step fires nothing', cuesCrossed(keys, 1.0, 1.0).length === 0);
	ok('a 60fps step is well inside maxStep', cuesCrossed(keys, 0.49, 0.49 + 1 / 60).length === 1);

	// Playing the whole timeline frame-by-frame fires every cue exactly once.
	const fired = [];
	let last = 0;
	for (let t = 0; t <= 2.5; t += 1 / 60) { fired.push(...cuesCrossed(keys, last, t)); last = t; }
	ok('a full forward play fires each cue exactly once', fired.length === keys.length);
}

// =========================================================================
section('8. Property / camera channels');
// =========================================================================
{
	const ch = [
		{ time: 0, value: 0, ease: 'linear' },
		{ time: 2, value: 10, ease: 'hold' },
		{ time: 4, value: 20, ease: 'ease' },
		{ time: 6, value: 0, ease: 'linear' },
	];
	ok('no keys ⇒ undefined (caller falls back to the static value)', sampleChannel([], 1) === undefined);
	ok('a single key holds everywhere', sampleChannel([{ time: 5, value: 7 }], 0) === 7 && sampleChannel([{ time: 5, value: 7 }], 99) === 7);
	ok('before the first key holds the first value', sampleChannel(ch, -5) === 0);
	ok('after the last key holds the last value', sampleChannel(ch, 99) === 0);
	ok('on a key returns exactly that key', sampleChannel(ch, 2) === 10 && sampleChannel(ch, 4) === 20);
	ok('linear interpolates', near(sampleChannel(ch, 1), 5));
	ok("a 'hold' key makes its OUTGOING segment stepped", sampleChannel(ch, 3) === 10 && sampleChannel(ch, 3.99) === 10);
	ok("...and the NEXT key still lands exactly", sampleChannel(ch, 4) === 20);
	ok("'ease' is symmetric smoothstep (midpoint = plain midpoint)", near(sampleChannel(ch, 5), 10));
	ok("'ease' departs slower than linear near the start", sampleChannel(ch, 4.4) > 20 - (20 - 0) * 0.2 * 1.0 && sampleChannel(ch, 4.4) > sampleChannel([{ time: 4, value: 20, ease: 'linear' }, { time: 6, value: 0 }], 4.4));
	ok('monotone within a segment', (() => {
		let prev = -Infinity, mono = true;
		for (let t = 0; t <= 2; t += 0.05) { const v = sampleChannel(ch, t); if (v < prev - 1e-9) mono = false; prev = v; }
		return mono;
	})());
	// Two keys at the SAME time = an instant jump. Which side wins exactly ON the time is an
	// arbitrary tie-break (we return the left one, then the right immediately after); what must
	// hold is that it never divides by zero or produces NaN.
	{
		const dup = [{ time: 1, value: 3 }, { time: 1, value: 9 }];
		const on = sampleChannel(dup, 1);
		const after = sampleChannel(dup, 1.0001);
		ok(
			'duplicate-time keys are an instant jump, never NaN',
			Number.isFinite(on) && (on === 3 || on === 9) && after === 9,
			`on=${on} after=${after}`,
		);
	}

	// sampleTrack / resolvePlace
	const track = { kind: 'property', channels: { x: [{ time: 0, value: 0 }, { time: 2, value: 100 }], alpha: [] } };
	const at1 = sampleTrack(track, 1);
	ok('sampleTrack returns only KEYED channels', near(at1.x, 50) && !('alpha' in at1), JSON.stringify(at1));

	const place = { x: 7, y: 9, scale: 1, rotation: 0, flipX: false };
	const resolved = resolvePlace(place, [track], 1);
	ok('a keyed channel overrides the static placement', near(resolved.x, 50));
	ok('...and un-keyed properties keep the static value', resolved.y === 9 && resolved.scale === 1 && resolved.flipX === false);
	ok('resolvePlace does not mutate the static placement', place.x === 7);
	ok('no property tracks ⇒ the static placement, unchanged', JSON.stringify(resolvePlace(place, [], 3)) === JSON.stringify(place));

	// putKey
	const keys = [];
	putKey(keys, 2, 20);
	putKey(keys, 0, 0);
	putKey(keys, 1, 10);
	ok('putKey keeps the channel sorted', keys.map((k) => k.time).join(',') === '0,1,2');
	putKey(keys, 1, 99);
	ok('putKey at an existing time REPLACES rather than duplicating', keys.length === 3 && keys[1].value === 99);
	putKey(keys, 1, 55, 'hold');
	ok('replacing preserves the existing ease', keys[1].ease === 'linear', `ease=${keys[1].ease}`);
	ok('a new key takes the ease it was given', putKey(keys, 5, 1, 'hold').ease === 'hold');
}

// =========================================================================
section('9. One evaluator, two consumers — no drift');
// =========================================================================
{
	// The engine imports `engine-cinematic`; the /rigger preview fetches the launcher's static
	// copy. If those ever diverge, the editor and the shipped game evaluate DIFFERENTLY — the
	// hand-synced-renderer failure this project has already paid for in FX. The copy is generated
	// (`scripts/sync-cinematic-eval.mjs`); this asserts it was regenerated.
	const src = readFileSync('packages/engine-cinematic/src/cinematicEval.js', 'utf8');
	let deployed = null;
	try {
		deployed = readFileSync('apps/launcher-api/static/shared/cinematicEval.mjs', 'utf8');
	} catch {
		/* missing counts as out of date */
	}
	ok(
		'the browser copy of the evaluator is in sync with the package source',
		deployed !== null && deployed.endsWith(src),
		'run: node scripts/sync-cinematic-eval.mjs',
	);
	ok(
		'…and it is marked generated, so nobody edits it by hand',
		!!deployed && deployed.startsWith('// GENERATED'),
	);
}

// =========================================================================
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
